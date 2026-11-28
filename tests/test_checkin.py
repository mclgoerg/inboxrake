"""The Weekly check-in (backend/checkin.py, backend/checkinstore.py): which
places have something (and that empty ones are skipped), the window it shares
with Overview's Last week card, the per-user Monday push (on by default, once a
week, nothing at zero, names nobody), the store, the API, and the one extra
button of the activity digest mail (its five buttons keep their targets).
Invented `.example` data and generic words only."""

import datetime
import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import checkin as checkinmod
from backend import checkinstore
from backend import config as cfgmod
from backend import digest as digestmod
from backend import knownsenders, mailops, overview, pastdate, rulecheck
from backend import tenants, unsubstore, waiting, webpush
from backend.main import app

from test_webpush import ENDPOINT, _decrypt, _wait, device, network  # noqa: F401

client = TestClient(app)

NOW = 1_800_000_000
DAY = 86400
# a Monday, local time (the push follows the server's clock like the digest)
MONDAY = datetime.datetime(2026, 11, 23, 9, 0).timestamp()
WEEK = "2026-11-23"


def _mail(days_ago, addr="a@x.example", n=[0]):
    n[0] += 1
    return {"ts": int(NOW - days_ago * DAY), "size": 10, "seen": True,
            "bulk": False, "addr": addr, "msgid": f"<{n[0]}@x.example>"}


def _acc(mails=(), name="acct", junk=None, status="done"):
    groups = {}
    for m in mails:
        groups.setdefault(m["addr"], {"key": m["addr"], "tags": []})
    return SimpleNamespace(
        name=name, lock=threading.RLock(), tenant=tenants.DEFAULT,
        index={i: m for i, m in enumerate(mails)},
        state={"groups": {"sender": groups}, "junk_count": junk,
               "status": status, "scanned_ts": NOW})


@pytest.fixture
def quiet(monkeypatch):
    """Every place that does not come from the Overview is empty."""
    monkeypatch.setattr(pastdate, "summary", lambda acc, now=None: {"mails": 0})
    monkeypatch.setattr(waiting, "summary",
                        lambda acc, now=None: {"overdue": 0})
    monkeypatch.setattr(rulecheck, "checkup", lambda acc: {"findings": []})


def _new_and_still(name="acct"):
    """One new sender and one that kept mailing after an unsubscribe, both
    inside the last 3 days; first-seen / unsubscribe records for `name`."""
    knownsenders.update_scan(name, {"old@x.example"}, now=NOW - 30 * DAY)
    knownsenders.update_scan(name, {"old@x.example", "new@x.example",
                                    "late@x.example"}, now=NOW - 2 * DAY)
    unsubstore.save({"late@x.example": {
        "status": "done", "method": "", "detail": "", "error": "",
        "ts": NOW - 30 * DAY}}, name)
    return _acc([_mail(5, "old@x.example"), _mail(2, "new@x.example"),
                 _mail(1, "late@x.example")], name)


def _ids(rows):
    return [r["id"] for r in rows]


# ------------------------------------------------------------ the places

def test_only_the_places_with_something_are_steps(quiet):
    acc = _new_and_still()
    assert checkinmod.places(acc, None, NOW) == [
        {"id": "new", "n": 2}, {"id": "still", "n": 1}]


def test_every_place_in_walking_order(monkeypatch):
    monkeypatch.setattr(pastdate, "summary",
                        lambda acc, now=None: {"mails": 137})
    monkeypatch.setattr(waiting, "summary",
                        lambda acc, now=None: {"overdue": 8})
    monkeypatch.setattr(rulecheck, "checkup", lambda acc: {"findings": [
        {"id": "a"}, {"id": "b"}, {"id": "c"}]})
    acc = _new_and_still()
    acc.state["junk_count"] = 11
    assert checkinmod.places(acc, None, NOW) == [
        {"id": "new", "n": 2}, {"id": "still", "n": 1},
        {"id": "past", "n": 137}, {"id": "waiting", "n": 8},
        {"id": "rules", "n": 3}, {"id": "junk", "n": 11}]
    assert checkinmod.PLACES == ("new", "still", "past", "waiting", "rules",
                                 "junk")


def test_an_empty_mailbox_has_no_steps(quiet):
    s = checkinmod.summary(_acc(), None, NOW)
    assert s["steps"] == [] and s["things"] == 0 and s["minutes"] == 0


def test_junk_counts_and_unknown_junk_does_not(quiet):
    assert _ids(checkinmod.places(_acc(junk=4), None, NOW)) == ["junk"]
    assert checkinmod.places(_acc(junk=0), None, NOW) == []
    assert checkinmod.places(_acc(junk=None), None, NOW) == []


def test_ignored_rule_findings_are_not_a_thing_to_do(monkeypatch, quiet):
    monkeypatch.setattr(rulecheck, "checkup", lambda acc: {"findings": [
        {"id": "a", "ignored": True}, {"id": "b", "ignored": False},
        {"id": "c"}]})
    assert checkinmod.places(_acc(), None, NOW) == [{"id": "rules", "n": 2}]
    monkeypatch.setattr(rulecheck, "checkup", lambda acc: {"findings": [
        {"id": "a", "ignored": True}]})
    assert checkinmod.places(_acc(), None, NOW) == []


def test_a_place_that_cannot_be_worked_out_is_empty_not_an_error(
        monkeypatch, quiet):
    def boom(*a, **k):
        raise RuntimeError("index not ready")
    monkeypatch.setattr(rulecheck, "checkup", boom)
    monkeypatch.setattr(pastdate, "summary", boom)
    assert _ids(checkinmod.places(_new_and_still(), None, NOW)) \
        == ["new", "still"]


def test_the_minutes_grow_with_the_steps():
    assert [checkinmod.minutes_for(n) for n in (1, 2, 3, 4, 6)] \
        == [1, 1, 1, 2, 2]
    assert checkinmod.minutes_for(0) == 1


def test_the_summary_says_things_and_minutes(quiet):
    s = checkinmod.summary(_new_and_still(), None, NOW)
    assert s["things"] == 2 and s["minutes"] == 1
    assert s["window"] == "week" and s["from"] == NOW - 7 * DAY
    assert s["steps"] == [{"id": "new", "n": 2}, {"id": "still", "n": 1}]


# ------------------------------------------- the same window as Last week

def test_the_window_is_the_one_of_the_last_week_card(quiet):
    """New senders and still mailing are read from `overview.build` itself:
    for the last 7 days and for "since your last visit" alike."""
    acc = _new_and_still()
    for since in (None, NOW - 3 * DAY, NOW - 1.5 * DAY, NOW - 6 * 3600):
        built = overview.build(acc, since, NOW)
        card = built["week"] if since is None else built["since"]
        steps = {r["id"]: r["n"]
                 for r in checkinmod.places(acc, since, NOW)}
        assert steps.get("new", 0) == card["new_senders"], since
        assert steps.get("still", 0) == card["still_mailing"], since
        s = checkinmod.summary(acc, since, NOW)
        assert s["from"] == card["from"]
        assert s["window"] == ("week" if since is None else "since")


def test_since_a_recent_visit_narrows_new_senders_and_mailing(quiet):
    acc = _new_and_still()
    assert _ids(checkinmod.places(acc, None, NOW)) == ["new", "still"]
    # a visit an hour ago: the new sender was first seen 2 days ago
    assert checkinmod.places(acc, NOW - 3600, NOW) == []
    # the unsubscribed sender's late mail came 1 day ago
    assert _ids(checkinmod.places(acc, NOW - 2.5 * DAY, NOW)) \
        == ["new", "still"]


def test_the_places_that_are_not_windowed_ignore_since(monkeypatch):
    monkeypatch.setattr(pastdate, "summary",
                        lambda acc, now=None: {"mails": 5})
    monkeypatch.setattr(waiting, "summary",
                        lambda acc, now=None: {"overdue": 2})
    monkeypatch.setattr(rulecheck, "checkup", lambda acc: {"findings": []})
    acc = _acc(junk=3)
    assert checkinmod.places(acc, NOW - 60, NOW) == [
        {"id": "past", "n": 5}, {"id": "waiting", "n": 2},
        {"id": "junk", "n": 3}]


# -------------------------------------------------------------- the store

def test_the_push_is_on_until_it_is_switched_off():
    assert checkinstore.push_enabled() is True
    assert checkinmod.settings_view() == {"push": True}
    checkinmod.set_settings(False)
    assert checkinstore.push_enabled() is False
    checkinstore._cache.clear()                       # survives a restart
    assert checkinmod.settings_view() == {"push": False}
    checkinmod.set_settings(None)                     # nothing to change
    assert checkinstore.push_enabled() is False
    checkinmod.set_settings(True)
    assert checkinstore.push_enabled() is True


def test_a_damaged_file_means_the_default_not_a_crash():
    checkinstore.CHECKIN_PATH.write_text("{not json")
    assert checkinstore.push_enabled() is True
    checkinstore._cache.clear()
    checkinstore.CHECKIN_PATH.write_text(json.dumps({
        "push": "no", "week": 5, "done": "x"}))
    assert checkinstore.push_enabled() is True        # only False switches off
    assert checkinstore.handled(WEEK) == set()


def test_handled_accounts_belong_to_one_week():
    checkinstore.mark_handled(WEEK, "a")
    checkinstore.mark_handled(WEEK, "b")
    checkinstore.mark_handled(WEEK, "a")
    assert checkinstore.handled(WEEK) == {"a", "b"}
    assert checkinstore.handled("2026-11-30") == set()
    checkinstore.mark_handled("2026-11-30", "a")       # a new Monday restarts
    assert checkinstore.handled("2026-11-30") == {"a"}
    assert checkinstore.handled(WEEK) == set()


def test_a_renamed_account_keeps_its_mark_and_a_dropped_one_loses_it():
    checkinstore.mark_handled(WEEK, "old")
    checkinstore.rename_account("old", "new")
    assert checkinstore.handled(WEEK) == {"new"}
    checkinstore.drop_account("new")
    assert checkinstore.handled(WEEK) == set()
    checkinstore.drop_account("never-there")


def test_the_store_is_per_tenant(monkeypatch):
    alice = tenants.Tenant("alice", "alice@x.example",
                           checkinstore.CHECKIN_PATH.parent / "alice")
    checkinmod.set_settings(False)
    checkinstore.mark_handled(WEEK, "work")
    with tenants.use(alice):
        assert checkinstore.push_enabled() is True
        assert checkinstore.handled(WEEK) == set()
        checkinmod.set_settings(False)
        checkinstore.mark_handled(WEEK, "private")
        assert (alice.root / "checkin.json").is_file()
    assert checkinstore.handled(WEEK) == {"work"}
    checkinmod.set_settings(True)
    with tenants.use(alice):
        assert checkinstore.push_enabled() is False


# --------------------------------------------------------- the Monday push

@pytest.fixture
def monday(monkeypatch):
    """A tenant with one device, one scanned account with `things` places and
    a record of every push that would go out."""
    sent = []
    state = SimpleNamespace(things=6, minutes=2, ready=True, names=["acct"],
                            subs=[{"endpoint": ENDPOINT}])
    acc = _acc(name="acct")
    monkeypatch.setattr(accountsmod, "names", lambda: list(state.names))
    monkeypatch.setattr(accountsmod, "get", lambda name=None: acc)
    monkeypatch.setattr(webpush, "subscriptions",
                        lambda tenant=None: list(state.subs))
    monkeypatch.setattr(webpush, "checkin",
                        lambda acc, n, minutes: sent.append(
                            (acc.name, n, minutes)))
    monkeypatch.setattr(checkinmod, "summary", lambda acc, since=None,
                        now=None, ov=None: {
                            "things": state.things, "minutes": state.minutes,
                            "steps": [], "window": "week", "from": 0})
    monkeypatch.setattr(checkinmod, "_ready", lambda a: state.ready)
    state.sent, state.acc = sent, acc
    return state


def test_it_goes_out_on_monday_at_nine_with_the_count(monday):
    assert checkinmod.tick_tenant(MONDAY) == 1
    assert monday.sent == [("acct", 6, 2)]


def test_not_before_nine_and_not_on_another_day(monday):
    before = MONDAY - 60                                   # 08:59
    assert checkinmod.tick_tenant(before) == 0
    for d in range(1, 7):
        assert checkinmod.tick_tenant(MONDAY + d * DAY) == 0
    assert monday.sent == []
    assert checkinmod.push_due(MONDAY) and not checkinmod.push_due(before)
    assert checkinmod.push_due(MONDAY + 11 * 3600)         # still Monday
    assert not checkinmod.push_due(MONDAY + 15 * 3600)     # Tuesday 00:00


def test_one_push_per_account_and_week(monday):
    assert checkinmod.tick_tenant(MONDAY) == 1
    assert checkinmod.tick_tenant(MONDAY + 300) == 0
    assert checkinmod.tick_tenant(MONDAY + 3 * 3600) == 0
    assert len(monday.sent) == 1
    # the next Monday it goes out again
    assert checkinmod.tick_tenant(MONDAY + 7 * DAY) == 1
    assert len(monday.sent) == 2


def test_no_push_when_there_is_nothing_and_the_week_is_done(monday):
    monday.things = 0
    assert checkinmod.tick_tenant(MONDAY) == 0
    monday.things = 4                    # later the same Monday: not again
    assert checkinmod.tick_tenant(MONDAY + 3600) == 0
    assert monday.sent == []
    assert checkinstore.handled(WEEK) == {"acct"}


def test_it_is_on_by_default_and_off_when_switched_off(monday):
    assert checkinstore.push_enabled() is True
    checkinmod.set_settings(False)
    assert checkinmod.tick_tenant(MONDAY) == 0 and monday.sent == []
    assert checkinstore.handled(WEEK) == set()        # nothing was decided
    checkinmod.set_settings(True)
    assert checkinmod.tick_tenant(MONDAY + 60) == 1


def test_nobody_without_a_notification_device_is_told(monday):
    monday.subs = []
    assert checkinmod.tick_tenant(MONDAY) == 0 and monday.sent == []
    assert checkinstore.handled(WEEK) == set()
    # a device registered later on Monday still hears about this week
    monday.subs = [{"endpoint": ENDPOINT}]
    assert checkinmod.tick_tenant(MONDAY + 3600) == 1


def test_an_account_that_is_not_ready_is_tried_again(monday):
    monday.ready = False
    assert checkinmod.tick_tenant(MONDAY) == 0 and monday.sent == []
    assert checkinstore.handled(WEEK) == set()
    monday.ready = True
    assert checkinmod.tick_tenant(MONDAY + 300) == 1


def test_every_account_is_told_once_with_its_own_count(monday, monkeypatch):
    other = _acc(name="other")
    accs = {"acct": monday.acc, "other": other}
    monday.names = ["acct", "other"]
    monkeypatch.setattr(accountsmod, "get", lambda name=None: accs[name])
    monkeypatch.setattr(checkinmod, "summary", lambda acc, since=None,
                        now=None, ov=None: {
                            "things": 3 if acc.name == "acct" else 0,
                            "minutes": 1, "steps": [], "window": "week",
                            "from": 0})
    assert checkinmod.tick_tenant(MONDAY) == 1
    assert monday.sent == [("acct", 3, 1)]
    assert checkinstore.handled(WEEK) == {"acct", "other"}


def test_a_deleted_account_is_skipped(monday, monkeypatch):
    monday.names = ["gone"]
    monkeypatch.setattr(accountsmod, "get",
                        lambda name=None: (_ for _ in ()).throw(KeyError(name)))
    assert checkinmod.tick_tenant(MONDAY) == 0


def test_the_tick_walks_every_tenant_and_survives_a_failure(monday,
                                                            monkeypatch):
    alice = tenants.Tenant("alice", "alice@x.example",
                           checkinstore.CHECKIN_PATH.parent / "alice")
    monkeypatch.setattr(tenants, "known", lambda: [tenants.DEFAULT, alice])
    seen = []

    def one(now):
        seen.append(tenants.current().id)
        if len(seen) == 1:
            raise RuntimeError("first tenant broke")
    monkeypatch.setattr(checkinmod, "tick_tenant", one)
    checkinmod.tick(MONDAY)
    assert seen == ["default", "alice"]


def test_each_tenants_switch_is_its_own(monday, monkeypatch):
    alice = tenants.Tenant("alice", "alice@x.example",
                           checkinstore.CHECKIN_PATH.parent / "alice")
    with tenants.use(alice):
        checkinmod.set_settings(False)
    assert checkinmod.tick_tenant(MONDAY) == 1                # default: on
    with tenants.use(alice):
        assert checkinmod.tick_tenant(MONDAY) == 0            # alice: off


def test_the_week_starts_on_monday():
    assert checkinmod.week_of(MONDAY) == WEEK
    assert checkinmod.week_of(MONDAY + 6 * DAY + 14 * 3600) == WEEK
    assert checkinmod.week_of(MONDAY + 7 * DAY) == "2026-11-30"


# ------------------------------------------------------------- the text

def test_the_push_reads_like_the_board_in_both_languages():
    en = webpush._payload("en", "checkin", True, "default", False,
                          params={"n": 6, "minutes": 2})
    assert en["title"] == "Your weekly check-in: 6 things"
    assert en["body"] == "About 2 min. Tap to start."
    # the link names the account: the app opens that account's check-in
    assert en["url"] == "/#/overview/check-in?account=default"
    de = webpush._payload("de", "checkin", True, "default", False,
                          params={"n": 6, "minutes": 2})
    assert de["title"] == "Dein Wochen-Check: 6 Dinge"
    assert de["body"] == "Etwa 2 Min. Tippe zum Starten."


def test_the_push_words_one_thing_and_names_the_account_only_when_several():
    one = webpush._payload("en", "checkin", True, "work", True,
                           params={"n": 1, "minutes": 1})
    assert one["title"] == "Your weekly check-in: 1 thing"
    assert one["body"] == "work · About 1 min. Tap to start."
    assert webpush._payload("de", "checkin", True, "w", False,
                            params={"n": 1, "minutes": 1})["title"] \
        == "Dein Wochen-Check: 1 Ding"


def test_the_push_names_nobody_whatever_is_handed_in():
    p = webpush._payload("en", "checkin", True, "default", False, params={
        "n": 6, "minutes": 2, "name": "Travelly", "subject": "Booking 8821",
        "addr": "help@travelly.example", "label": "Acme Store"})
    text = json.dumps(p)
    for leak in ("Travelly", "8821", "@", "Acme", "travelly.example"):
        assert leak not in text
    assert p["tag"] == "default:checkin"


def test_the_checkin_push_is_delivered_encrypted_and_skips_a_visible_device(
        bridge, network):
    keys, key = device()
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"], "de")
    webpush.set_presence(ENDPOINT, True)
    webpush.checkin(accountsmod.get("default"), n=3, minutes=1)
    time.sleep(0.2)
    assert network.sent == []                    # the page shows it itself
    webpush.set_presence(ENDPOINT, False)
    webpush.checkin(accountsmod.get("default"), n=3, minutes=1)
    assert _wait(lambda: network.sent)
    got = _decrypt(network.sent[0][2], (keys, key))
    assert got == {"title": "Dein Wochen-Check: 3 Dinge",
                   "body": "Etwa 1 Min. Tippe zum Starten.",
                   "tag": "default:checkin",
                   "url": "/#/overview/check-in?account=default"}


def test_a_real_monday_push_names_no_sender_subject_or_address(bridge,
                                                               network):
    """Not stubbed: a scanned mailbox with a sender that kept mailing, the real
    count, the real delivery - what reaches the device is a number."""
    keys, key = device()
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"])
    mailops.run_scan()
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["junk_count"] = 7
    assert checkinmod.tick_tenant(MONDAY) == 1
    assert _wait(lambda: network.sent)
    got = _decrypt(network.sent[0][2], (keys, key))
    assert got["title"].startswith("Your weekly check-in: ")
    for leak in ("dhl", "shop", "alice", "@", "Sendung", "SALE", "Newsletter"):
        assert leak.lower() not in json.dumps(got).lower()


# ----------------------------------------------------------------- the API

def test_the_checkin_endpoint(bridge):
    mailops.run_scan()
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["junk_count"] = 5
    r = client.get("/api/checkin")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["window"] == "week" and d["things"] == len(d["steps"])
    assert {"id": "junk", "n": 5} in d["steps"]
    assert d["minutes"] == checkinmod.minutes_for(d["things"])
    # only counts: nothing of the mail itself is in it
    for leak in ("dhl", "shop.example", "Dinner", "alice"):
        assert leak not in r.text.lower()
    since = int(time.time()) - 600
    s = client.get("/api/checkin", params={"since": since}).json()
    assert s["window"] == "since" and s["from"] == since
    assert client.get("/api/checkin", params={"since": -1}).status_code == 422


def test_the_checkin_endpoint_is_per_account(bridge):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "h1", "user": "u1", "password": "pw"},
        "two": {"host": "h2", "user": "u2", "password": "pw"}}}))
    with accountsmod.get("one").lock:
        accountsmod.get("one").state["junk_count"] = 9
    with accountsmod.get("two").lock:
        accountsmod.get("two").state["junk_count"] = 2
    one = client.get("/api/checkin", params={"account": "one"}).json()
    two = client.get("/api/checkin", params={"account": "two"}).json()
    assert {"id": "junk", "n": 9} in one["steps"]
    assert {"id": "junk", "n": 2} in two["steps"]


def test_the_settings_endpoints_default_to_on_and_persist():
    assert client.get("/api/checkin/settings").json() == {"push": True}
    r = client.post("/api/checkin/settings", json={"push": False})
    assert r.status_code == 200 and r.json() == {"push": False}
    assert client.get("/api/checkin/settings").json() == {"push": False}
    assert client.post("/api/checkin/settings", json={}).json() \
        == {"push": False}                              # no change
    assert client.post("/api/checkin/settings", json={"push": True}).json() \
        == {"push": True}
    assert client.post("/api/checkin/settings",
                       json={"push": "maybe"}).status_code == 422


def test_renaming_and_deleting_an_account_carries_the_mark(bridge):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "h1", "user": "u1", "password": "pw"},
        "two": {"host": "h2", "user": "u2", "password": "pw"}}}))
    checkinstore.mark_handled(WEEK, "one")
    checkinstore.mark_handled(WEEK, "two")
    r = client.post("/api/config", json={"rename_account": {
        "from": "one", "to": "work"}})
    assert r.status_code == 200, r.text
    assert checkinstore.handled(WEEK) == {"work", "two"}
    r = client.post("/api/config", json={"delete_account": "two"})
    assert r.status_code == 200, r.text
    assert checkinstore.handled(WEEK) == {"work"}


def test_the_push_link_names_the_account_safely():
    p = webpush._payload("en", "checkin", True, "Work & mail/2", True,
                         params={"n": 2, "minutes": 1})
    assert p["url"] == "/#/overview/check-in?account=Work%20%26%20mail%2F2"


# ------------------------------------------------ the activity digest mail

URL = "https://app.example/inboxrake"


def _digest(monkeypatch, things, lang="en", url=URL, minutes=None):
    cfgmod.update_config({"account": "default", "imap": {
        "host": "h", "user": "me@x.example", "password": "pw",
        "digest": {"lang": lang, "url": url}}})
    monkeypatch.setattr(checkinmod, "summary", lambda acc, since=None,
                        now=None, ov=None: {
                            "things": things,
                            "minutes": minutes or checkinmod.minutes_for(
                                things) if things else 0,
                            "steps": [], "window": "week", "from": 0})
    auditlog.record("trash", account="default", count=2, size=100)
    return digestmod.compose("default", 0)


def test_the_digest_gets_one_more_button_after_all_the_others(monkeypatch):
    _, text, html = _digest(monkeypatch, 6)
    href = f'href="{URL}/#/overview/check-in?account=default"'
    assert href in html and "Start your weekly check-in</a>" in html
    assert (f"Start your weekly check-in: {URL}/#/overview/check-in"
            "?account=default") in text
    assert "6 things · about 2 min" in text
    # its own section, after Needs you AND What happened: the last button
    assert html.index(href) > html.index("What happened")
    assert text.index("Start your weekly check-in") > text.index(
        "WHAT HAPPENED")
    assert html.index(href) == html.rindex('href="' + URL + "/#/")


def test_the_link_names_the_account_with_its_odd_characters(monkeypatch):
    _, text, html = _digest(monkeypatch, 2)
    d = {**digestmod._snapshot("default", 0, time.time()),
         "counts": {"trash": 2}, "freed": 0, "unsub_attempts": 0,
         "unsub_outcomes": {"done": 0, "link": 0, "failed": 0}, "rules": [],
         "weekly": True, "range": "r", "happened_title": "h"}
    S = digestmod.STRINGS
    _, text, html = digestmod._build("Work & mail", d, "en", URL, None, False)
    assert "overview/check-in?account=Work%20%26%20mail" in text
    assert "overview/check-in?account=Work%20%26%20mail" in html


def test_the_digest_in_german(monkeypatch):
    _, text, html = _digest(monkeypatch, 1, lang="de")
    assert "Deinen Wochen-Check starten</a>" in html
    assert "1 Ding · etwa 1 Min." in text


def test_no_button_when_there_is_nothing_or_no_app_address(monkeypatch):
    _, text, html = _digest(monkeypatch, 0)
    assert "check-in" not in html and "check-in" not in text
    _, text, html = _digest(monkeypatch, 4, url="")
    assert "href" not in html and "#/" not in text
    assert "YOUR WEEKLY CHECK-IN" in text                # the section, no link
    assert "4 things · about 2 min" in text


def test_the_five_buttons_keep_their_targets(monkeypatch):
    """The digest's buttons (Block, Look, Review, Show, Rules) point where they
    always did and come in the order they always did, with the new one added
    AFTER all of them - never in place of one."""
    from backend import waiting as waitingmod
    monkeypatch.setattr(waitingmod, "reminded", lambda acc, now=None: ["Pat"])
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["junk_count"] = 3
        acc.state["groups"]["sender"] = {"x@y.example": {
            "key": "x@y.example", "count": 4, "size": 40, "tags": []}}
    from backend import verdictstore
    verdictstore.save("sender", {"x@y.example": {
        "verdict": "delete_safe", "reason": "r", "ts": time.time()}},
        "default")
    for i in range(3):
        acc.index[("INBOX", i)] = {"ts": int(time.time()) - 100, "size": 10,
                                   "seen": True, "bulk": False,
                                   "addr": "late@x.example",
                                   "msgid": f"<{i}@x.example>"}
    unsubstore.save({"late@x.example": {
        "status": "done", "method": "", "detail": "", "error": "",
        "ts": time.time() - 30 * DAY}}, "default")
    from backend import rules as rulesmod
    rule = rulesmod.create_rule({"name": "r", "query": "x"})
    auditlog.record("rule_report", actor=f"rule:{rule['id']}",
                    account="default", count=10)
    _, text, html = _digest(monkeypatch, 5)
    import re
    # in the order of the mail, repeats included (Block and Review both open
    # the senders)
    found = [(label, route) for route, label in re.findall(
        r'href="[^"]*/#/([\w/?=%.-]+)"[^>]*>([\w -]+)</a>', html)]
    assert found == [
        ("Block", "senders"), ("Look", "junk"), ("Review", "senders"),
        ("Show", "waiting"), ("Rules", "rules"),
        ("Start your weekly check-in", "overview/check-in?account=default")]
    # the text part lists the same links in the same order
    links = re.findall(re.escape(URL) + r"/#/([\w/?=%.-]+)", text)
    assert links == [r for _, r in found]


def test_the_demo_digest_shows_the_button(monkeypatch):
    cfgmod.update_config({"account": "default", "imap": {
        "host": "h", "user": "me@x.example", "password": "pw",
        "digest": {"url": URL}}})
    _, text, html = digestmod.compose_demo("default")
    assert "Start your weekly check-in</a>" in html
    assert "6 things · about 2 min" in text
