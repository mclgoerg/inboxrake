"""Mute a conversation (backend/mute.py): a rule that archives and marks read
the NEW mail of one conversation after each scan - the `thread:` filter word,
the one-click POST /api/mute, what a run touches and leaves alone, the
"after each scan" schedule, Unmute, and the sealing that makes an older
release refuse the rule instead of running it with `thread:` ignored."""

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import mute
from backend import pinstore
from backend import rulecheck
from backend import rules as rulesmod
from backend import tenants
from backend.main import app

from conftest import make_msg, wait_delete_done, wait_scan_done

client = TestClient(app)

ALICE = "Alice <alice@friends.example>"
BOB = "Bob <bob@corp.example>"
CAROL = "Carol <carol@team.example>"


def stamp(delta: float = 0.0) -> str:
    """An INTERNALDATE `delta` seconds from now."""
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(time.time() + delta))


@pytest.fixture
def convo(bridge):
    """One conversation of Alice and Bob (three mails in the Inbox, from days
    ago), set up by their reply headers."""
    bridge.mailbox["INBOX"] += [
        make_msg(30, frm=ALICE, subject="Plan", msgid="<c1@x>",
                 date=stamp(-5 * 86400)),
        make_msg(31, frm=BOB, subject="Re: Plan", msgid="<c2@x>",
                 irt="<c1@x>", refs="<c1@x>", date=stamp(-4 * 86400)),
        make_msg(32, frm=ALICE, subject="Re: Plan", msgid="<c3@x>",
                 irt="<c2@x>", refs="<c1@x> <c2@x>", date=stamp(-3 * 86400)),
    ]
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return bridge


def key_of(label: str = "Plan") -> str:
    return next(k for k, r in mailops.STATE["groups"]["thread"].items()
                if r["label"] == label)


def do_mute(label: str = "Plan", **kw):
    r = client.post("/api/mute", json={"key": key_of(label), **kw})
    assert r.status_code == 200, r.text
    return r.json()


def rule_of(label: str = "Plan") -> dict:
    return next(r for r in rulesmod.load_rules()
                if r["query"] == f"thread:{key_of(label)}")


def reply(uid, frm, msgid, irt, refs, subject="Re: Plan", delta=120, **kw):
    """A new mail of the conversation, arriving `delta` s from now."""
    return make_msg(uid, frm=frm, subject=subject, msgid=msgid, irt=irt,
                    refs=refs, date=stamp(delta), **kw)


def settle():
    """The runs a scan started (their own thread) and the mail job they
    queued have finished."""
    join_runs()
    wait_delete_done()


def scan_and_settle():
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    settle()


@pytest.fixture(autouse=True)
def _no_run_outlives_its_test():
    yield
    join_runs()


def join_runs():
    for th in threading.enumerate():
        args = getattr(th, "_args", ()) or ()
        if th is not threading.current_thread() and len(args) > 1 \
                and args[1] is rulesmod._after_scan_runs:
            th.join(10)


def uids(bridge, folder="INBOX"):
    return {m["uid"] for m in bridge.mailbox.get(folder, [])}


def mail(bridge, folder, uid):
    return next(m for m in bridge.mailbox[folder] if m["uid"] == uid)


# ------------------------------------------------------------ the `thread:` word

def test_thread_word_matches_exactly_one_conversation(convo):
    key = key_of()
    f = rulesmod.parse_filter(f"thread:{key}")
    assert f["thread"] == key and f["text"] == []
    groups = mailops.public_state(accountsmod.get())["groups"]["thread"]
    hits = [k for k, g in groups.items() if rulesmod.match_group(g, f)]
    assert hits == [key]
    # a prefix or another key matches nothing: the match is exact
    for other in (key[:8], key.upper() + "0", "0" * 16):
        f2 = rulesmod.parse_filter(f"thread:{other.lower()}")
        assert not any(rulesmod.match_group(g, f2) for g in groups.values())


def test_thread_word_is_known_to_the_grammar_and_the_validator():
    assert rulesmod.validate_filter("thread:4f9c1e0a7b2d3c58") == []
    # an empty value, and a second thread: (the parsers keep the last one)
    assert rulesmod.validate_filter("thread:") == ["thread:"]
    assert rulesmod.validate_filter(
        "thread:aaaaaaaaaaaaaaaa thread:bbbbbbbbbbbbbbbb") == [
        "thread:bbbbbbbbbbbbbbbb"]
    assert "thread" in {g["qualifier"] for g in rulesmod.FILTER_GRAMMAR}


def test_a_purge_rule_refuses_the_thread_word():
    assert rulesmod.purge_unsupported("thread:4f9c1e0a7b2d3c58") == ["thread:"]


# ---------------------------------------------------------------- the one click

def test_mute_makes_an_armed_visible_rule(convo):
    out = do_mute()
    rule = out["rule"]
    key = key_of()
    assert rule["origin"] == "mute" and rule["grouping"] == "thread"
    assert rule["query"] == f"thread:{key}"
    assert rule["action"] == "archive_read" and rule["schedule"] == "scan"
    assert rule["name"] == "Mute: Plan"
    # like Block: armed, through the report pass that satisfies the gate
    assert rule["mode"] == "execute" and rule["report_runs"] >= 1
    # who was in the conversation, and from when mail is new - the server
    # keeps the senders, the API shows the key and the date only
    stored = rule_of()["mute"]
    assert set(stored["senders"]) == {"alice@friends.example",
                                      "bob@corp.example"}
    assert rule["mute"] == {"key": key, "since": stored["since"]}
    newest = max(m["ts"] for m in accountsmod.get().index.values()
                 if m["addr"] in stored["senders"])
    assert stored["since"] >= newest
    listed = client.get("/api/rules").json()["rules"][0]
    assert listed["mute"] == rule["mute"]
    assert accountsmod.get().state["rules"][0]["mute"] == rule["mute"]
    # listed with the other rules
    assert [r["id"] for r in client.get("/api/rules").json()["rules"]] \
        == [rule["id"]]
    # nothing was moved by muting
    assert uids(convo) >= {30, 31, 32}


def test_mute_takes_the_localised_name_from_the_client(convo):
    rule = do_mute(name="Stumm: Plan")["rule"]
    assert rule["name"] == "Stumm: Plan"


def test_mute_refuses_an_unknown_conversation_and_a_second_mute(convo):
    r = client.post("/api/mute", json={"key": "0" * 16})
    assert r.status_code == 400
    assert r.json()["detail"] == mailops.coded(mailops.MUTE_UNKNOWN)
    r = client.post("/api/mute", json={"key": "not a key"})
    assert r.status_code == 400
    do_mute()
    r = client.post("/api/mute", json={"key": key_of()})
    assert r.status_code == 400
    assert r.json()["detail"] == mailops.coded(mailops.MUTE_ALREADY)
    assert len(rulesmod.load_rules()) == 1


def test_mute_preview_counts_what_is_there(convo):
    convo.mailbox["INBOX"].append(
        make_msg(33, frm=CAROL, subject="Re: Plan", msgid="<c9@x>",
                 irt="<c3@x>", refs="<c1@x> <c3@x>", date=stamp(-86400)))
    mailops.run_scan()
    cfgmod.update_config({"protected": ["carol@team.example"]})
    pinstore.set_pinned("<c1@x>", True, accountsmod.get().name)
    r = client.get("/api/mute/preview", params={"key": key_of()})
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "Plan" and body["mails"] == 4
    assert body["people"] == 3
    # 4 mails in the Inbox - 1 pinned - 1 from a protected sender
    assert (body["now"], body["pinned"], body["protected"]) == (2, 1, 1)
    assert body["archive"] is True and body["muted"] is None
    do_mute()
    assert client.get("/api/mute/preview", params={"key": key_of()}
                      ).json()["muted"] == rule_of()["id"]
    assert client.get("/api/mute/preview", params={"key": "0" * 16}
                      ).status_code == 400


# ------------------------------------------------------- what a run touches

def test_new_mail_of_the_conversation_is_archived_and_marked_read(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    assert 50 not in uids(convo)
    arrived = mail(convo, "Archive", 50)
    assert arrived["seen"] is True                 # read as it moved
    # what was already there stays: it is not "new mail"
    assert {30, 31, 32} <= uids(convo)
    assert not any(mail(convo, "INBOX", u)["seen"] for u in (30, 31, 32))
    last = rule_of()["last_run"]
    assert (last["mode"], last["mails"], last["acted"]) == ("execute", 1, 1)
    # the log carries the step with the rule as its actor, and Undo has it
    entry = next(e for e in auditlog.load("default", 0, 50)["entries"]
                 if e["action"] == "archive")
    assert entry["actor"] == f"rule:{rule_of()['id']}"
    assert entry["label"] == "Plan"


def test_the_archive_step_can_be_undone(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    assert 50 in uids(convo, "Archive")
    mailops.undo_last()
    wait_scan_done()
    assert 50 in uids(convo)                       # back in the Inbox
    # ... and it stays there: the rescan after the Undo (and every scan after
    # it) does not archive what the user just put back
    settle()
    scan_and_settle()
    assert 50 in uids(convo) and 50 not in uids(convo, "Archive")


def test_each_mail_is_handled_once(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    assert 50 in uids(convo, "Archive")
    assert "<c4@x>" in rule_of()["mute"]["done"]
    # the user moves it back by hand (a new UID in the Inbox, same Message-ID)
    back = dict(mail(convo, "Archive", 50), uid=77)
    convo.mailbox["Archive"] = [m for m in convo.mailbox["Archive"]
                                if m["uid"] != 50]
    convo.mailbox["INBOX"].append(back)
    scan_and_settle()
    assert 77 in uids(convo)                       # theirs now
    # a mail the run did not handle is still new
    convo.mailbox["INBOX"].append(
        reply(51, BOB, "<c5@x>", "<c4@x>", "<c1@x> <c2@x> <c3@x> <c4@x>",
              delta=300))
    scan_and_settle()
    assert 51 in uids(convo, "Archive") and 77 in uids(convo)
    assert rule_of()["mute"]["done"] == ["<c4@x>", "<c5@x>"]


def test_the_handled_mails_are_capped(convo, monkeypatch):
    monkeypatch.setattr(mute, "DONE_MAX", 3)
    rid = do_mute()["rule"]["id"]
    rulesmod._remember_handled(rid, ["<a@x>", "<b@x>", "<c@x>", "", "<d@x>",
                                     "<a@x>"])
    # (a repeated id keeps its place; only the newest three stay)
    assert rule_of()["mute"]["done"] == ["<b@x>", "<c@x>", "<d@x>"]
    rulesmod._remember_handled("nope", ["<z@x>"])      # a deleted rule: no-op


def test_mail_that_arrived_before_the_mute_is_never_new(convo):
    # arrived a moment before the mute, but after the conversation's last mail
    convo.mailbox["INBOX"].append(
        reply(40, BOB, "<c5@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>", delta=-60))
    mailops.run_scan()
    do_mute()
    scan_and_settle()
    assert 40 in uids(convo) and 40 not in uids(convo, "Archive")
    assert mail(convo, "INBOX", 40)["seen"] is False


def test_a_clock_ahead_of_ours_does_not_make_old_mail_new(convo):
    # the newest mail is dated in the future (a server clock running ahead)
    convo.mailbox["INBOX"].append(
        reply(41, BOB, "<c6@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>",
              delta=3600))
    mailops.run_scan()
    out = do_mute()
    assert out["rule"]["mute"]["since"] >= int(time.time()) + 3500
    scan_and_settle()
    assert 41 in uids(convo)


def test_someone_not_yet_in_the_conversation_is_let_through(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(51, CAROL, "<c7@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    convo.mailbox["INBOX"].append(
        reply(52, BOB, "<c8@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    assert 51 in uids(convo)                      # Carol: left in the Inbox
    assert mail(convo, "INBOX", 51)["seen"] is False
    assert 52 in uids(convo, "Archive")           # Bob was in it


def test_a_new_conversation_of_the_same_people_is_not_touched(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        make_msg(53, frm=ALICE, subject="Plan", msgid="<n1@x>",
                 date=stamp(120)))
    convo.mailbox["INBOX"].append(
        make_msg(54, frm=BOB, subject="Re: Plan", msgid="<n2@x>",
                 irt="<n1@x>", refs="<n1@x>", date=stamp(180)))
    scan_and_settle()
    assert {53, 54} <= uids(convo) and not uids(convo, "Archive") & {53, 54}


def test_the_subject_alone_never_joins_a_conversation(convo):
    do_mute()
    # the same subject, the same people, no reply headers at all
    convo.mailbox["INBOX"].append(
        make_msg(55, frm=ALICE, subject="Re: Plan", msgid="<s1@x>",
                 date=stamp(120)))
    scan_and_settle()
    assert 55 in uids(convo) and 55 not in uids(convo, "Archive")


def test_pinned_mail_is_never_touched(convo):
    do_mute()
    convo.mailbox["INBOX"] += [
        reply(56, ALICE, "<p1@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"),
        reply(57, BOB, "<p2@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>")]
    pinstore.set_pinned("<p1@x>", True, accountsmod.get().name)
    scan_and_settle()
    assert 56 in uids(convo) and mail(convo, "INBOX", 56)["seen"] is False
    assert 57 in uids(convo, "Archive")
    assert rule_of()["last_run"]["skipped_pinned"] == 1


def test_protected_senders_are_never_touched(convo):
    do_mute()
    convo.mailbox["INBOX"] += [
        reply(58, ALICE, "<q1@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"),
        reply(59, BOB, "<q2@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>")]
    cfgmod.update_config({"protected": ["alice@friends.example"]})
    scan_and_settle()
    assert 58 in uids(convo) and mail(convo, "INBOX", 58)["seen"] is False
    assert 59 in uids(convo, "Archive")
    # the conversation's other mail still moves: protection is per sender
    assert rule_of()["last_run"]["skipped_protected"] == 1


def test_only_the_inbox_is_touched(convo):
    do_mute()
    convo.mailbox["Archive"].append(
        reply(60, ALICE, "<a1@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>",
              seen=False))
    scan_and_settle()
    assert 60 in uids(convo, "Archive")
    assert mail(convo, "Archive", 60)["seen"] is False
    assert rule_of()["last_run"]["mails"] == 0     # (the report pass only)


def test_without_an_archive_folder_the_mail_is_only_marked_read(bridge):
    bridge.mailbox.pop("Archive")
    bridge.mailbox["INBOX"] += [
        make_msg(30, frm=ALICE, subject="Plan", msgid="<c1@x>",
                 date=stamp(-5 * 86400)),
        make_msg(31, frm=BOB, subject="Re: Plan", msgid="<c2@x>",
                 irt="<c1@x>", refs="<c1@x>", date=stamp(-4 * 86400))]
    mailops.run_scan()
    assert not accountsmod.get().folder_roles.get("archive")
    do_mute()
    bridge.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c2@x>", "<c1@x> <c2@x>"))
    scan_and_settle()
    assert 50 in uids(bridge)                      # it stays where it is ...
    assert mail(bridge, "INBOX", 50)["seen"] is True      # ... but is read
    assert "Archive" not in bridge.mailbox
    last = rule_of()["last_run"]
    assert last["read_only"] is True and last["acted"] == 1
    # a second scan finds it read already: nothing to do, nothing recorded
    ts = last["ts"]
    scan_and_settle()
    assert rule_of()["last_run"]["ts"] == ts


def test_nothing_is_ever_trashed(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    assert not convo.mailbox["Trash"]
    assert not [e for e in auditlog.load("default", 0, 50)["entries"]
                if e["action"] in ("trash", "purge")]


# ------------------------------------------------------- also archive what is there

def test_also_archive_what_is_there_is_one_step_with_undo(convo):
    pinstore.set_pinned("<c1@x>", True, accountsmod.get().name)
    cfgmod.update_config({"protected": ["bob@corp.example"]})
    out = do_mute(archive_existing=True)
    assert out["queued"] == 1                      # only Alice's unpinned mail
    wait_delete_done()
    assert uids(convo, "Archive") >= {32}
    assert {30, 31} <= uids(convo)                 # pinned and protected stay
    assert mail(convo, "Archive", 32)["seen"] is True
    mailops.undo_last()
    assert 32 in uids(convo)


def test_without_the_option_what_is_there_stays(convo):
    out = do_mute()
    assert "queued" not in out
    scan_and_settle()
    assert uids(convo) >= {30, 31, 32}


# ------------------------------------------------------- runs after a scan only

def test_the_scheduler_never_runs_a_mute(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    rules = rulesmod.load_rules()
    rules[0]["last_run"]["ts"] = 0                 # "due" for any period
    rulesmod._save(rules)
    assert rulesmod.due(rulesmod.load_rules()[0]) is False
    rulesmod._tick()
    wait_delete_done()
    assert 50 in uids(convo)                       # nothing ran


def test_a_run_after_a_scan_with_nothing_new_leaves_no_trace(convo):
    do_mute()
    before = rule_of()["last_run"]
    entries = auditlog.load("default", 0, 100)["total"]
    scan_and_settle()
    scan_and_settle()
    assert rule_of()["last_run"] == before
    assert auditlog.load("default", 0, 100)["total"] == entries


def test_a_scan_starts_the_runs_of_the_active_mutes_only(convo, monkeypatch):
    out = do_mute()["rule"]
    ran = []
    monkeypatch.setattr(rulesmod, "run_rule",
                        lambda rid, rescan=True, quiet=False:
                        ran.append((rid, rescan, quiet)))
    mailops.run_scan()
    settle()
    assert ran == [(out["id"], False, True)]
    # in Report only it does nothing by itself
    rulesmod.update_rule(out["id"], {"mode": "report"})
    ran.clear()
    mailops.run_scan()
    settle()
    assert ran == []


def test_a_run_waits_for_the_rule_run_that_asked_for_the_scan(convo, monkeypatch):
    # another rule's run is in progress (maybe the very one that started this
    # scan): the mute's run after the scan waits for it, then runs
    monkeypatch.setattr(rulesmod, "AFTER_SCAN_POLL", 0.05)
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    assert rulesmod._RUN_LOCK.acquire(blocking=False)
    try:
        mailops.run_scan()
        # (the thread keeps asking while the lock is held)
        join_runs_for(0.3)
        assert 50 in uids(convo)
    finally:
        rulesmod._RUN_LOCK.release()
    settle()
    assert 50 in uids(convo, "Archive")


def join_runs_for(seconds: float) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        threading.Event().wait(0.02)


def test_run_now_reports_what_a_run_would_do(convo):
    out = do_mute()["rule"]
    rulesmod.update_rule(out["id"], {"mode": "report"})
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    mailops.run_scan()
    settle()
    assert 50 in uids(convo)                       # Report only: nothing moved
    r = client.post(f"/api/rules/{out['id']}/run")
    assert r.status_code == 200
    run = r.json()
    assert (run["mode"], run["mails"], run["acted"]) == ("report", 1, 0)
    assert run["preview"][0]["label"] == "Plan" and 50 in uids(convo)
    # armed again, Run now acts on it
    rulesmod.update_rule(out["id"], {"mode": "execute"})
    assert client.post(f"/api/rules/{out['id']}/run").json()["acted"] == 1
    assert 50 in uids(convo, "Archive")


def test_a_run_is_capped_like_every_rule(convo, monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 2)
    do_mute()
    for i in range(4):
        convo.mailbox["INBOX"].append(
            reply(70 + i, ALICE, f"<k{i}@x>", "<c3@x>",
                  "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    last = rule_of()["last_run"]
    assert (last["mails"], last["acted"], last["capped"]) == (4, 2, 2)


# ------------------------------------------------------------------ Unmute

def test_unmute_removes_the_rule_and_later_mail_stays(convo):
    rid = do_mute()["rule"]["id"]
    assert client.delete(f"/api/rules/{rid}").status_code == 200
    assert rulesmod.load_rules() == []
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    assert 50 in uids(convo) and 50 not in uids(convo, "Archive")
    # and the conversation can be muted again
    do_mute()


# -------------------------------------------------- an older release refuses it

# What the release before this one (98f9a2d) knows: the rule actions and the
# filter qualifiers. Anything else it refuses to edit and cannot run.
OLD_ACTIONS = ("trash", "archive", "move", "mark_read", "purge")
OLD_QUALIFIERS = {"tag", "ai", "age", "unread", "is", "has", "eng", "att",
                  "from", "domain", "in"}


def test_an_older_release_refuses_the_rule_instead_of_running_it(convo):
    do_mute()
    stored = json.loads(rulesmod._path().read_text())["rules"][0]
    # (1) the action is none it knows: it would reject the rule ("bad action")
    # before anything is queued, and refuses to edit or arm it
    assert stored["action"] == "archive_read"
    assert stored["action"] not in OLD_ACTIONS
    assert not stored["action"].startswith(rulesmod.KIND_ACTION)
    # (2) the filter has a word it does not understand, so its execute runs
    # are skipped ("parts Inboxrake doesn't understand") - never run with
    # `thread:` ignored as a plain word
    quals = {t.split(":")[0] for t in stored["query"].split() if ":" in t}
    assert quals - OLD_QUALIFIERS == {"thread"}
    # (3) the schedule is none it knows, so it never starts the rule itself
    assert stored["schedule"] not in ("daily", "weekly")
    # (4) its signature of the armed rule equals ours: a rollback and a
    # roll-forward does not disarm the rule
    old_sig_parts = [stored.get(k) for k in (
        "scope", "grouping", "query", "action", "dest", "keep_latest",
        "older_than_days")]
    import hashlib
    assert hashlib.sha256(json.dumps(old_sig_parts).encode()).hexdigest()[:16] \
        == stored["report_sig"]
    assert stored["mode"] == "execute"


def test_the_rule_cannot_be_written_without_its_sealing_action(convo):
    do_mute()
    rules = rulesmod.load_rules()
    rules[0]["action"] = "archive"
    with pytest.raises(ValueError, match="mute rule can only"):
        rulesmod._save(rules)
    rules[0]["action"] = "archive_read"
    rules[0]["query"] = "from:alice@friends.example"
    with pytest.raises(ValueError, match="mute rule can only"):
        rulesmod._save(rules)


def test_only_a_mute_can_have_the_mute_action_or_schedule(convo):
    ok = rulesmod.create_rule({"name": "x", "query": "is:unsub"})
    for body in ({"action": "archive_read"}, {"schedule": "scan"}):
        with pytest.raises(ValueError):
            rulesmod.update_rule(ok["id"], body)
        with pytest.raises(ValueError):
            rulesmod.create_rule({"name": "y", "query": "is:unsub", **body})
    with pytest.raises(ValueError, match="bad origin"):
        rulesmod.update_rule(ok["id"], {"origin": "mute"})
    r = client.post("/api/rules", json={"name": "z", "origin": "mute"})
    assert r.status_code == 400


def test_a_mute_keeps_its_conversation_but_can_be_renamed_and_rescheduled(
        convo):
    rid = do_mute()["rule"]["id"]
    rule = rulesmod.update_rule(rid, {"name": "Quiet", "schedule": "manual"})
    assert (rule["name"], rule["schedule"], rule["mode"]) \
        == ("Quiet", "manual", "execute")            # not sent back to report
    with pytest.raises(ValueError, match="bad schedule"):
        rulesmod.update_rule(rid, {"schedule": "daily"})
    for body in ({"query": "from:alice@friends.example"},
                 {"grouping": "sender"}, {"action": "trash"},
                 {"dest": "Archive"}, {"keep_latest": 3},
                 {"origin": "manual"}):
        with pytest.raises(ValueError):
            rulesmod.update_rule(rid, body)
    again = rulesmod.update_rule(rid, {"schedule": "scan"})
    assert again["schedule"] == "scan" and again["mode"] == "execute"


def test_a_hand_edited_file_cannot_fake_a_mute(convo):
    rid = do_mute()["rule"]["id"]
    path = rulesmod._path()
    data = json.loads(path.read_text())
    data["rules"][0]["mute"] = {"key": "zz", "senders": "x", "since": 0}
    path.write_text(json.dumps(data))
    rule = next(r for r in rulesmod.load_rules() if r["id"] == rid)
    assert rule["origin"] == "manual"              # a plain rule now ...
    with pytest.raises(RuntimeError, match="bad action"):
        rulesmod.run_rule(rid, rescan=False)       # ... that no run accepts


# ------------------------------------------------------------ backup and import

def test_a_mute_survives_an_export_and_comes_back_in_report_mode(convo):
    do_mute()
    exported = client.get("/api/export_config").json()
    assert exported["rules"][0]["origin"] == "mute"
    r = client.post("/api/import_config", json=exported)
    assert r.status_code == 200, r.text
    rule = rulesmod.load_rules()[0]
    assert rule["origin"] == "mute" and rule["action"] == "archive_read"
    assert rule["mute"]["key"] == key_of()
    assert rule["mode"] == "report"                # the safety floor holds


# --------------------------------------------------------- the Rule checkup

def test_the_rule_checkup_sees_what_a_mute_would_do(convo):
    do_mute()
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    mailops.run_scan()
    settle()
    # (a mute that already ran: nothing is left to clash with)
    block = rulesmod.create_rule({"name": "other", "query": "tag:x",
                                  "action": "archive", "account": "default"})
    found = rulecheck.checkup(accountsmod.get())["findings"]
    assert not [f for f in found if f["kind"] == "conflict"]
    rulesmod.delete_rule(block["id"])
    # a rule that trashes what the mute archives clashes with it - but only
    # for mail the mute still has to act on
    mail_rule = rulesmod.create_rule({
        "name": "trash alice", "query": "from:alice@friends.example",
        "action": "trash", "account": "default"})
    rulesmod.update_rule(rule_of()["id"], {"mode": "report"})
    convo.mailbox["INBOX"].append(
        reply(51, ALICE, "<c5@x>", "<c4@x>", "<c1@x> <c2@x> <c3@x> <c4@x>",
              delta=240))
    mailops.run_scan()
    found = rulecheck.checkup(accountsmod.get())["findings"]
    clash = [f for f in found if f["kind"] == "conflict"]
    assert clash and set(clash[0]["rules"]) == {mail_rule["id"],
                                                rule_of()["id"]}


# ----------------------------------------------------- tenants and accounts

def test_a_mute_belongs_to_its_tenant(convo):
    rid = do_mute()["rule"]["id"]
    other = tenants.for_subject("someone@elsewhere.example")
    with tenants.use(other):
        assert rulesmod.load_rules() == []
    assert [r["id"] for r in rulesmod.load_rules()] == [rid]


def test_a_mute_follows_an_account_rename(convo):
    rid = do_mute()["rule"]["id"]
    assert rulesmod.load_rules()[0]["account"] == accountsmod.get().name
    rulesmod.rename_account(accountsmod.get().name, "renamed")
    rule = rulesmod.load_rules()[0]
    assert rule["id"] == rid and rule["account"] == "renamed"
    assert rule["origin"] == "mute"


# ---------------------------------------------------------------- the helpers

def test_clean_info_accepts_one_shape_only():
    ok = {"key": "4f9c1e0a7b2d3c58", "senders": ["A@x.example", "a@x.example",
                                                 " b@x.example "],
          "since": 1700000000.9}
    assert mute.clean_info(ok) == {"key": "4f9c1e0a7b2d3c58",
                                   "senders": ["a@x.example", "b@x.example"],
                                   "since": 1700000000, "done": []}
    assert mute.clean_info({**ok, "done": ["<a@x>", "", 5, "<a@x>"]})["done"] \
        == ["<a@x>"]
    for bad in (None, [], {}, {**ok, "key": "XYZ"}, {**ok, "key": 5},
                {**ok, "senders": "a@x.example"}, {**ok, "since": 0},
                {**ok, "since": True}, {**ok, "since": "1700000000"}):
        assert mute.clean_info(bad) is None
    many = {**ok, "senders": [f"u{i}@x.example" for i in range(500)]}
    assert len(mute.clean_info(many)["senders"]) == mute.MAX_SENDERS


def test_the_info_of_a_mute_starts_after_the_newest_mail(convo):
    conv = mute.conversation(accountsmod.get(), key_of())
    assert conv["mails"] == 3 and conv["people"] == 2
    assert conv["senders"][0] == "alice@friends.example"  # the most active
    assert mute.info_for(conv, now=1)["since"] == conv["newest"]
    assert mute.info_for(conv, now=conv["newest"] + 99)["since"] \
        == conv["newest"] + 99
    assert mute.conversation(accountsmod.get(), "0" * 16) is None
    assert mute.conversation(accountsmod.get(), "nope") is None


# ------------------------------------------------------------ assistants (MCP)

def test_mcp_list_rules_names_a_mute_only_for_a_token_with_subjects(convo):
    from backend import mcptools
    do_mute()
    acc = accountsmod.get()
    for subjects, name in ((False, mcptools.MUTE_NAME), (True, "Mute: Plan")):
        ctx = _ctx(subjects)
        out = mcptools._list_rules(ctx, mcptools.AccountIn(account=acc.name))
        assert out["rules"][0]["name"] == name
        assert out["rules"][0]["action"] == "archive_read"
    # the log's labels of the mute's runs and steps carry the subject, too
    convo.mailbox["INBOX"].append(
        reply(50, ALICE, "<c4@x>", "<c3@x>", "<c1@x> <c2@x> <c3@x>"))
    scan_and_settle()
    hidden = mcptools._recent_activity(
        _ctx(False), mcptools.RecentActivityIn(account=acc.name))
    mine = [e for e in hidden["entries"] if e["actor"].startswith("rule:")]
    assert mine and all(e["label"] == "" for e in mine)
    shown = mcptools._recent_activity(
        _ctx(True), mcptools.RecentActivityIn(account=acc.name))
    assert any(e["label"] for e in shown["entries"]
               if e["actor"].startswith("rule:"))


def _ctx(subjects: bool):
    from backend import mcptools
    return mcptools.Ctx(accounts=[accountsmod.get().name], subjects=subjects)
