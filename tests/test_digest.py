"""Activity digest email: composition from seeded audit entries, period
boundary via last_sent, empty-period skip, the /test endpoint (incl. its
demo-data fallback), scheduler due-logic (incl. the configurable time of
day), the shared SMTP helper (used by both digest and unsubscribe),
tenant/account separation, and config persistence."""

import datetime
import json
import time

from fastapi.testclient import TestClient

from backend import auditlog
from backend import config as cfgmod
from backend import digest as digestmod
from backend import rules as rulesmod
from backend import smtpout
from backend import tenants
from backend import unsub
from backend.main import app

client = TestClient(app)


def _configure_account(user="me@x.example", schedule="off", recipient=""):
    cfgmod.update_config({"account": "default", "imap": {
        "host": "h", "user": user, "password": "pw",
        "digest": {"schedule": schedule, "recipient": recipient}}})


# -------------------------------------------------------------- composition

def test_compose_aggregates_seeded_entries_and_respects_since_boundary():
    rule = rulesmod.create_rule({"name": "r", "query": "x"})
    auditlog.record("trash", account="default", count=5, size=7168)
    # D10: "Space freed" counts permanent deletes only - the 7 KB
    # moved to Trash above no longer count, a purge / Empty Trash does
    auditlog.record("purge", account="default", count=4, size=5000)
    auditlog.record("empty_trash", account="default", count=3, size=1024)
    auditlog.record("archive", account="default", count=2)
    auditlog.record("unsubscribe", account="default", count=1,
                    label="a@x.example", outcome="done")
    auditlog.record("unsubscribe", account="default", count=1,
                    label="b@x.example", outcome="link")
    auditlog.record("unsubscribe", account="default", count=1,
                    label="c@x.example", outcome="failed")
    auditlog.record("rule_report", actor=f"rule:{rule['id']}",
                    account="default", count=10)
    auditlog.record("rule_execute", actor=f"rule:{rule['id']}",
                    account="default", count=3)

    subject, text, html = digestmod.compose("default", 0)
    # 5 trashed + 2 archived + 3 rule-moved = 10 cleaned up
    assert subject == "Last 7 days: 0 in, 10 cleaned up"   # not weekly
    for body in (text, html):
        assert "5 moved to Trash" in body
        assert "7 deleted for good" in body     # purge + empty_trash
        # 5000 + 1024 bytes of purge + empty_trash; the 7168 moved bytes
        # (a different figure) must not be in it
        assert "5.9 KB freed" in body
        assert "7.0 KB" not in body
        assert "2 archived" in body
        assert "10 mails waiting in rule previews" in body
        assert "ran 1 time" in body
        assert "3 mails handled" in body
        assert "1 unsubscribed" in body
        assert "1 waiting for your confirmation" in body
        assert "1 failed" in body
    # the HTML part is a real, non-trivial document (branded, no
    # external assets) - not just the text thrown into a <pre>
    assert "<!doctype html>" in html.lower()
    assert "<img" not in html.lower() and "http://" not in html \
        and "https://" not in html
    # mail-client safe: tables + inline styles, no flex / svg / web fonts
    for banned in ("display:flex", "<svg", "@font-face", "<script"):
        assert banned not in html.lower()
    assert "color-scheme" in html and "prefers-color-scheme: dark" in html
    assert "max-width:100%" in html and 'width="480"' in html


def test_freed_is_zero_when_mail_was_only_moved_to_trash():
    """Moving to Trash frees nothing: no "Space freed" row without a
    permanent delete (D10)."""
    auditlog.record("trash", account="default", count=5, size=5000)
    _, text, _ = digestmod.compose("default", 0)
    assert "5 moved to Trash" in text
    assert "freed" not in text
    assert "deleted for good" not in text


def test_compose_ignores_runs_of_a_since_deleted_rule():
    """A deleted rule's past report/execute runs stay in the (append-
    only) audit log, but the digest's "open Rules and review it" isn't
    actionable for a rule that's gone - those entries must not show up
    or count towards anything."""
    rule = rulesmod.create_rule({"name": "temp", "query": "x"})
    auditlog.record("rule_report", actor=f"rule:{rule['id']}",
                    account="default", count=7)
    rulesmod.delete_rule(rule["id"])
    # that was the ONLY activity in the period -> nothing to send
    assert digestmod.compose("default", 0) is None

    # mixed with real activity: the phantom rule line is dropped, the
    # rest of the digest still goes out normally
    auditlog.record("trash", account="default", count=2, size=200)
    subject, text, html = digestmod.compose("default", 0)
    assert "rule preview" not in text
    assert "ran " not in text
    assert "2 moved to Trash" in text


def test_compose_only_counts_entries_after_since_ts():
    auditlog.record("trash", account="default", count=1, size=100)
    cutoff = int(time.time()) + 10          # pretend the digest was just sent
    auditlog.record("trash", account="default", count=9, size=900)
    # Both entries have ~the same real timestamp in a fast test run, so
    # force the boundary explicitly instead of racing the clock.
    entries = auditlog._load_all("default")
    entries[0]["ts"] = cutoff - 100         # old: before the cutoff
    entries[1]["ts"] = cutoff + 100         # new: after the cutoff
    auditlog._rewrite(auditlog._path(), [json.dumps(e) for e in entries])

    subject, text, html = digestmod.compose("default", cutoff)
    assert "9 moved to Trash" in text
    assert "1 moved to Trash" not in text


def test_compose_ignores_its_own_digest_sent_entries():
    auditlog.record("digest_sent", account="default", label="me@x.example",
                    outcome="ok")
    assert digestmod.compose("default", 0) is None


def test_compose_returns_none_for_an_empty_period():
    assert digestmod.compose("default", 0) is None


# ------------------------------------------------------------- send_digest

def test_send_digest_skips_when_nothing_happened(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda *a, **k: calls.append((a, k)))
    _configure_account()
    assert digestmod.send_digest("default") == {"sent": False, "demo": False}
    assert not calls


def test_send_digest_sends_and_records_last_sent_and_audit(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda im, to, subj, text, html=None,
                        account_name=None: calls.append((to, subj, text)))
    _configure_account(recipient="digest@elsewhere.example")
    auditlog.record("trash", account="default", count=1, size=100)

    before = int(time.time())
    result = digestmod.send_digest("default")
    assert result == {"sent": True, "demo": False}
    assert calls[0][0] == "digest@elsewhere.example"
    assert digestmod.last_sent("default") >= before

    entries = auditlog.load("default", 0, 10)["entries"]
    assert entries[0]["action"] == "digest_sent"
    assert entries[0]["label"] == "digest@elsewhere.example"

    # last_sent advanced -> composing again right away finds nothing new
    assert digestmod.compose("default", digestmod.last_sent("default")) \
        is None


def test_send_digest_logs_the_recipient_masked(monkeypatch, caplog):
    monkeypatch.setattr(smtpout, "send",
                        lambda im, to, subj, text, html=None,
                        account_name=None: None)
    _configure_account(recipient="digest@elsewhere.example")
    auditlog.record("trash", account="default", count=1, size=100)
    with caplog.at_level("INFO", logger="inboxrake.digest"):
        digestmod.send_digest("default")
    text = caplog.text
    assert "d***@elsewhere.example" in text
    assert "digest@elsewhere.example" not in text
    assert digestmod._masked("no-at-sign") == "***"


def test_send_digest_falls_back_to_the_accounts_own_address(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda im, to, subj, text, html=None,
                        account_name=None: calls.append(to))
    _configure_account(user="me@x.example", recipient="")
    auditlog.record("trash", account="default", count=1, size=100)
    digestmod.send_digest("default")
    assert calls == ["me@x.example"]


def test_send_digest_raises_without_any_recipient(monkeypatch):
    monkeypatch.setattr(smtpout, "send", lambda *a, **k: None)
    _configure_account(user="", recipient="")
    auditlog.record("trash", account="default", count=1, size=100)
    try:
        digestmod.send_digest("default")
        assert False, "should have raised"
    except ValueError as exc:
        assert "recipient" in str(exc)


def test_test_send_never_advances_last_sent(monkeypatch):
    monkeypatch.setattr(smtpout, "send", lambda *a, **k: None)
    _configure_account(recipient="digest@elsewhere.example")
    auditlog.record("trash", account="default", count=1, size=100)

    assert digestmod.send_digest("default", test=True) == \
        {"sent": True, "demo": False}
    assert digestmod.last_sent("default") == 0     # untouched

    # a REAL digest afterwards still sees the same (full) period
    assert digestmod.send_digest("default") == {"sent": True, "demo": False}
    assert digestmod.last_sent("default") > 0


# --------------------------------------------------------------- /api/test

def test_api_digest_test_endpoint_sends_a_demo_when_nothing_real_happened(
        monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda *a, **k: calls.append(a))
    _configure_account(recipient="digest@elsewhere.example")
    r = client.post("/api/digest/test")
    assert r.status_code == 200
    assert r.json() == {"sent": True, "demo": True}
    assert calls
    assert digestmod.last_sent("default") == 0      # demo never counts

    auditlog.record("trash", account="default", count=1, size=100)
    calls.clear()
    r = client.post("/api/digest/test")
    assert r.status_code == 200
    assert r.json() == {"sent": True, "demo": False}
    assert calls


def test_api_digest_test_unknown_account_404():
    assert client.post("/api/digest/test?account=nope").status_code == 400


# ------------------------------------------------------------ due logic

def _ts(*dt_args) -> int:
    return int(datetime.datetime(*dt_args).timestamp())


def test_due_logic():
    # due() reads last_sent() from disk - seed it directly. All times
    # below are deterministic (no dependency on the real wall clock).
    assert not digestmod.due("acct", "off", now=_ts(2026, 1, 2, 8, 0))
    assert digestmod.due("new-acct", "daily", now=_ts(2026, 1, 1, 0, 0))

    digestmod._record_sent("acct", _ts(2026, 1, 1, 8, 0))
    # daily at the default 08:00: due once Jan 2 08:00 arrives, not before
    assert not digestmod.due("acct", "daily", now=_ts(2026, 1, 2, 7, 59))
    assert digestmod.due("acct", "daily", now=_ts(2026, 1, 2, 8, 0))
    # the same last_sent is nowhere near due weekly yet
    assert not digestmod.due("acct", "weekly", now=_ts(2026, 1, 2, 8, 0))
    assert digestmod.due("acct", "weekly", now=_ts(2026, 1, 8, 8, 0))


def test_due_logic_respects_a_configured_time_of_day():
    digestmod._record_sent("acct", _ts(2026, 1, 1, 8, 0))
    # configured for 20:30: still not due earlier the same next day...
    assert not digestmod.due("acct", "daily", hour=20, minute=30,
                             now=_ts(2026, 1, 2, 20, 0))
    # ...but is right at (and after) that time
    assert digestmod.due("acct", "daily", hour=20, minute=30,
                         now=_ts(2026, 1, 2, 20, 30))
    assert digestmod.due("acct", "daily", hour=20, minute=30,
                         now=_ts(2026, 1, 2, 23, 0))


def test_tick_sends_due_digests_and_skips_busy_accounts(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda *a, **k: calls.append(a))
    _configure_account(schedule="daily")
    auditlog.record("trash", account="default", count=1, size=100)
    digestmod._tick()
    assert calls                                    # due + not busy -> sent
    assert digestmod.last_sent("default") > 0

    calls.clear()
    from backend import accounts as accountsmod
    auditlog.record("trash", account="default", count=1, size=100)
    # force it due again (0 = "never sent", always due regardless of
    # the configured time of day - keeps this deterministic), then mark
    # the account busy
    digestmod._record_sent("default", 0)
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["status"] = "scanning"
    digestmod._tick()
    assert not calls                                # busy -> skipped


# -------------------------------------------------- shared SMTP helper

def test_smtp_helper_is_shared_by_unsub_and_digest(monkeypatch):
    calls = []
    monkeypatch.setattr(
        smtpout, "send",
        lambda im, to, subj, text, html=None, account_name=None:
        calls.append((to, subj, text, html)))

    im = {"user": "me@x.example", "host": "h", "smtp_host": "",
          "smtp_port": 465, "smtp_security": "ssl", "cafile": "",
          "oauth": None, "password": "pw"}
    unsub._send_mailto(im, "mailto:unsub@shop.example?subject=stop&body=bye")
    assert calls[0][0] == "unsub@shop.example"
    assert calls[0][1] == "stop"
    assert calls[0][3] is None               # unsub never sends HTML
    calls.clear()

    _configure_account(recipient="digest@elsewhere.example")
    auditlog.record("trash", account="default", count=1, size=100)
    digestmod.send_digest("default")
    assert calls[0][0] == "digest@elsewhere.example"


def test_smtp_send_builds_multipart_alternative_when_html_given(monkeypatch):
    import email

    sent = {}

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def login(self, user, password):
            pass

        def sendmail(self, frm, to, msg):
            sent["raw"] = msg

        def quit(self):
            pass

    monkeypatch.setattr(smtpout.smtplib, "SMTP_SSL", FakeSMTP)
    im = {"user": "me@x.example", "host": "h", "smtp_host": "",
          "smtp_port": 465, "smtp_security": "ssl", "cafile": "",
          "oauth": None, "password": "pw"}
    smtpout.send(im, "you@x.example", "Subject line", "plain body",
                 "<html><body>html body</body></html>")
    parsed = email.message_from_bytes(sent["raw"])
    assert parsed.is_multipart()
    parts = {p.get_content_type(): p.get_payload(decode=True).decode()
             for p in parsed.walk() if not p.is_multipart()}
    assert parts["text/plain"].strip() == "plain body"
    assert "html body" in parts["text/html"]


def test_smtp_send_stays_plain_text_without_html(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def login(self, user, password):
            pass

        def sendmail(self, frm, to, msg):
            sent["raw"] = msg

        def quit(self):
            pass

    monkeypatch.setattr(smtpout.smtplib, "SMTP_SSL", FakeSMTP)
    im = {"user": "me@x.example", "host": "h", "smtp_host": "",
          "smtp_port": 465, "smtp_security": "ssl", "cafile": "",
          "oauth": None, "password": "pw"}
    smtpout.send(im, "you@x.example", "Subject line", "plain body")
    assert b"plain body" in sent["raw"]
    assert b"multipart" not in sent["raw"].lower()


# --------------------------------------------------------- account lifecycle

def test_rename_account_follows():
    _configure_account()
    digestmod._record_sent("default", 12345)
    client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "renamed"}})
    assert digestmod.last_sent("default") == 0
    assert digestmod.last_sent("renamed") == 12345


def test_delete_account_drops_its_last_sent(monkeypatch):
    cfgmod.update_config({"add_account": "two"})
    digestmod._record_sent("default", 111)
    digestmod._record_sent("two", 222)
    client.post("/api/config", json={"delete_account": "two"})
    assert digestmod.last_sent("default") == 111
    assert digestmod.last_sent("two") == 0


# ------------------------------------------------------- config persistence

def test_digest_settings_persist_through_config_api():
    r = client.post("/api/config", json={"account": "default", "imap": {
        "host": "h", "digest": {"schedule": "weekly",
                                "recipient": "me@elsewhere.example",
                                "hour": 20, "minute": 30}}})
    assert r.status_code == 200
    saved = r.json()["accounts"]["default"]["digest"]
    assert saved == {"schedule": "weekly",
                     "recipient": "me@elsewhere.example",
                     "hour": 20, "minute": 30, "url": "", "lang": ""}

    # invalid schedule is silently rejected, not stored
    r = client.post("/api/config", json={"account": "default", "imap": {
        "digest": {"schedule": "hourly"}}})
    assert r.json()["accounts"]["default"]["digest"]["schedule"] == "weekly"


def test_digest_hour_and_minute_are_clamped_to_valid_ranges():
    r = client.post("/api/config", json={"account": "default", "imap": {
        "digest": {"hour": 99, "minute": -5}}})
    saved = r.json()["accounts"]["default"]["digest"]
    assert saved["hour"] == 23 and saved["minute"] == 0

    r = client.post("/api/config", json={"account": "default", "imap": {
        "digest": {"hour": "nope", "minute": "nope"}}})
    saved = r.json()["accounts"]["default"]["digest"]
    assert saved["hour"] == 23 and saved["minute"] == 0   # unchanged, not 0


def test_digest_defaults_to_off_for_a_pre_digest_saved_config():
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "default": {"host": "h", "user": "u", "password": "pw"}}}))
    cfg = cfgmod.load_config()
    assert cfg["accounts"]["default"]["digest"] == \
        {"schedule": "off", "recipient": "", "hour": 8, "minute": 0,
         "url": "", "lang": ""}


# ------------------------------------------------------------ tenant isolation

def test_last_sent_is_isolated_per_tenant():
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        digestmod._record_sent("default", 999)
    assert digestmod.last_sent("default") == 0      # default tenant untouched
    with tenants.use(alice):
        assert digestmod.last_sent("default") == 999


# ------------------------------------------------ "your week" layout (V7)

def _demo(lang="en", url=""):
    return digestmod.compose_demo("default", lang=lang, url=url)


def test_demo_has_balance_needs_you_and_what_happened():
    subject, text, html = _demo()
    assert subject == "Preview - last 7 days: 81 in, 96 cleaned up"
    for body in (text, html):
        assert "PREVIEW with made-up example data" in body
        assert "81" in body and "96" in body and "227 MB" in body
    assert "7.3 MB less" in html
    assert "Needs you" in html and "What happened" in html
    assert "663 mails can go" in html and "11 mails in Junk" in html
    assert "42 moved to Trash, 12 deleted for good" in html
    assert "Rule &quot;Old newsletters&quot; ran 3 times" in html
    assert "2 unsubscribed" in html and "1 waiting for your confirmation" in html
    # 8 weekly bars per row (arrived up, cleaned down)
    assert html.count('class="bin"') == 8


def test_demo_in_german():
    subject, text, html = _demo("de")
    assert subject == "Vorschau - Letzte 7 Tage: 81 rein, 96 aufgeräumt"
    for body in (text, html):
        assert "Braucht dich" in body.replace("BRAUCHT DICH", "Braucht dich")
        assert "3 schreiben trotz Abmeldung weiter" in body
        assert "11 Mails im Junk-Ordner" in body
        assert "Alte Newsletter" in body and "lief 3-mal" in body
        assert "7,3 MB weniger" in body
        assert "2 abgemeldet" in body
    assert "Was passiert ist" in html


def test_buttons_only_with_an_app_address():
    _, text, html = _demo(url="")
    assert "href" not in html and "#/" not in text
    _, text, html = _demo(url="https://app.example/inboxrake")
    for route in ("senders", "junk", "rules"):
        assert f'href="https://app.example/inboxrake/#/{route}"' in html
        assert f"https://app.example/inboxrake/#/{route}" in text
    assert "Block</a>" in html and "Look</a>" in html and "Review</a>" in html
    _, _, html = _demo("de", "https://app.example")
    assert "Blockieren</a>" in html and "Ansehen</a>" in html


def test_rule_names_and_account_are_escaped():
    rule = rulesmod.create_rule({"name": "<b>x</b> & \"y\"", "query": "x"})
    auditlog.record("rule_execute", actor=f"rule:{rule['id']}",
                    account="default", count=4)
    _, text, html = digestmod.compose("default", 0)
    assert "<b>x</b>" not in html
    assert "&lt;b&gt;x&lt;/b&gt; &amp;" in html
    assert '<b>x</b> & "y"' in text          # the text part is not HTML


def test_compose_uses_the_accounts_language_and_link(monkeypatch):
    cfgmod.update_config({"account": "default", "imap": {
        "host": "h", "user": "me@x.example", "password": "pw",
        "digest": {"lang": "de", "url": "https://app.example/"}}})
    auditlog.record("trash", account="default", count=2, size=100)
    subject, text, html = digestmod.compose("default", 0)
    assert subject.startswith("Letzte 7 Tage:")
    assert "2 in den Papierkorb" in text
    assert "Inboxrake öffnen" in html and html.count("app.example") == 1


def test_cleaned_count_skips_rescues_and_subtracts_undo():
    now = time.time()
    auditlog.record("trash", account="default", count=10, size=1,
                    entry_id="a1")
    auditlog.record("undo", account="default", count=4,
                    undoes={"id": "a1", "count": 4})
    auditlog.record("move", account="default", count=5,
                    label="5 mails from Junk", from_role="junk")
    entries = auditlog._load_all("default")
    assert digestmod._cleaned_weeks(entries, [], now)[-1] == 6


def test_digest_url_and_language_settings():
    def save(d):
        return client.post("/api/config", json={
            "account": "default", "imap": {"digest": d}})
    r = save({"url": " https://app.example/x/ ", "lang": "de"})
    saved = r.json()["accounts"]["default"]["digest"]
    assert saved["url"] == "https://app.example/x" and saved["lang"] == "de"
    for bad in ("javascript:alert(1)", "ftp://x.example", "app.example",
                "https://", 'https://a.example/"x',
                "https://a.example/?x=1", "https://a.example/#/x"):
        assert save({"url": bad}).status_code == 400
    assert save({"lang": "fr"}).json()["accounts"]["default"][
        "digest"]["lang"] == "de"                  # unknown: unchanged
    assert save({"url": ""}).json()["accounts"]["default"][
        "digest"]["url"] == ""


def test_weekly_schedule_says_your_week_and_what_happened_has_its_start():
    cfgmod.update_config({"account": "default", "imap": {
        "host": "h", "user": "me@x.example", "password": "pw",
        "digest": {"schedule": "weekly"}}})
    auditlog.record("trash", account="default", count=2, size=100)
    subject, text, html = digestmod.compose("default", 0)
    assert subject.startswith("Your week:")
    assert "Your week in your inbox" in html and "Last 7 days" in html
    assert "What happened</div>" in html or "WHAT HAPPENED" in text
    since = int(time.time()) - 3 * 86400
    auditlog.record("trash", account="default", count=1, size=1)
    _, text, html = digestmod.compose("default", since)
    assert "What happened since " in html and "WHAT HAPPENED SINCE" in text


def test_cleaned_count_ignores_runs_of_a_deleted_rule():
    rule = rulesmod.create_rule({"name": "temp", "query": "x"})
    auditlog.record("rule_execute", actor=f"rule:{rule['id']}",
                    account="default", count=7)
    rulesmod.delete_rule(rule["id"])
    entries = auditlog._load_all("default")
    assert digestmod._cleaned_weeks(entries, rulesmod.load_rules(),
                                    time.time())[-1] == 0


def test_text_part_keeps_user_strings_on_one_line():
    rule = rulesmod.create_rule({"name": "a\nb\rc\x07d", "query": "x"})
    auditlog.record("rule_execute", actor=f"rule:{rule['id']}",
                    account="default", count=4)
    _, text, _ = digestmod.compose("default", 0)
    assert 'Rule "a b c d" ran 1 time' in text


def test_junk_line_counts_mails_from_people_you_replied_to(monkeypatch):
    from backend import accounts as accountsmod
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["junk_count"] = 3
        acc.role_index["junk"] = {
            "a": {"addr": "a@x.example"}, "b": {"addr": "b@x.example"},
            "c": {"addr": "c@x.example"}}
        acc.replied.add("b@x.example")
        acc.replied_loaded = True
    auditlog.record("trash", account="default", count=1, size=1)
    _, text, html = digestmod.compose("default", 0)
    assert "3 mails in Junk (1 from someone you replied to)" in text
    # none replied -> no extra line
    with acc.lock:
        acc.replied.clear()
    _, text, _ = digestmod.compose("default", 0)
    assert "replied" not in text
