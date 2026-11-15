"""Time machine: 30-day undo steps (kept on disk), sessions, the preview and
the restore to a point - newest first, stopping exactly at the point, leaving
pinned / protected mail and what can't come back alone, itself undoable."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import rules as rulesmod
from backend import tenants
from backend import timemachine
from backend import undostore
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)
NOW = int(time.time())
MIN = 60


def _fake(monkeypatch, **kw):
    """Three senders, two mails each (a, b, c), one of d; a server that
    renumbers UIDs and answers COPYUID, like a real one."""
    msgs = []
    uid = 1
    for who, n in (("a", 2), ("b", 2), ("c", 2), ("d", 1)):
        for _ in range(n):
            msgs.append(make_msg(uid, frm=f"{who}@x.example", size=1000 * uid))
            uid += 1
    fake = FakeIMAP({"INBOX": msgs, "Trash": [], "Keep": []},
                    renumber=True, copyuid=True, **kw)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    # a restore starts a rescan: not what these tests are about
    monkeypatch.setattr(mailops, "_rescan_after_restore",
                        lambda *a, **k: False)
    mailops.run_scan()
    return fake


def _acc():
    return accountsmod.get()


def _trash(sender):
    mailops.delete_groups("sender", [f"{sender}@x.example"])
    assert wait_delete_done()["moved"] > 0


def _where(fake, sender):
    """{folder: n} of one sender's mails on the server."""
    out = {}
    for folder, mails in fake.mailbox.items():
        n = sum(1 for m in mails if m["from"].startswith(f"{sender}@"))
        if n:
            out[folder] = n
    return out


def _retime(times):
    """Give the undo steps (oldest first) and their audit entries these
    timestamps (seconds ago)."""
    acc = _acc()
    with acc.lock:
        steps = sorted(acc.undo_log, key=lambda e: e["ts"])
        for e, ago in zip(steps, times):
            e["ts"] = NOW - ago
        acc.undo_log.sort(key=lambda e: e["ts"])
        mailops._sync_undo(acc)
        by_id = {e["audit_id"]: e["ts"] for e in acc.undo_log
                 if e.get("audit_id")}
    path = auditlog._path()
    lines = [json.loads(x) for x in path.read_text().splitlines()]
    for a in lines:
        if a.get("id") in by_id:
            a["ts"] = by_id[a["id"]]
    path.write_text("".join(json.dumps(a) + "\n" for a in lines))


def _wait_restore(acc=None, timeout=10.0):
    acc = acc or _acc()
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["restore"]["status"] != "running":
                return dict(acc.state["restore"])
        time.sleep(0.01)
    raise TimeoutError("restore did not finish")


def _steps():
    return timemachine.listing(_acc())["steps"]


@pytest.fixture
def three(monkeypatch):
    """Three trashed senders: a (3 h ago), b (14 min ago), c (10 min ago)."""
    fake = _fake(monkeypatch)
    for who in "abc":
        _trash(who)
    _retime([3 * 3600, 14 * MIN, 10 * MIN])
    return fake


# ------------------------------------------------------- steps and sessions

def test_steps_come_newest_first_with_sessions_and_senders(three):
    listing = timemachine.listing(_acc())
    steps = listing["steps"]
    assert [s["action"] for s in steps] == ["trash"] * 3
    assert [s["ts"] for s in steps] == sorted((s["ts"] for s in steps),
                                              reverse=True)
    assert [s["status"] for s in steps] == ["back"] * 3
    assert steps[0]["mails"] == 2 and steps[0]["bytes"] > 0
    assert steps[0]["senders"] == [{"addr": "c@x.example", "n": 2}]
    assert steps[0]["actor"] == "user"
    # b and c are 4 minutes apart (one session), a is 3 hours before
    sessions = listing["sessions"]
    assert [(s["steps"], s["mails"]) for s in sessions] == [(2, 4), (1, 2)]
    assert sessions[0]["first"] == steps[1]["id"]
    assert sessions[0]["last"] == steps[0]["id"]
    assert listing["keep_days"] == 30


def test_steps_30_minutes_apart_are_two_sessions_29_one(monkeypatch):
    _fake(monkeypatch)
    _trash("a")
    _trash("b")
    _retime([40 * MIN, 10 * MIN])                    # 30 minutes apart
    assert len(timemachine.listing(_acc())["sessions"]) == 2
    _retime([39 * MIN, 10 * MIN])                    # 29 minutes
    assert len(timemachine.listing(_acc())["sessions"]) == 1


def test_non_undoable_steps_are_listed_with_their_status(three):
    acc = _acc()
    auditlog.record("unsubscribe", account=acc.name, count=1, label="a@x",
                    outcome="ok")
    auditlog.record("unsubscribe", account=acc.name, count=1, label="a@x",
                    outcome="failed")           # nothing happened: no step
    auditlog.record("empty_trash", account=acc.name, count=4)
    auditlog.record("rule_execute", actor="rule:r1", account=acc.name,
                    count=3)                    # the move is its own entry
    steps = _steps()
    kinds = [(s["action"], s["status"]) for s in steps[:2]]
    assert ("empty_trash", "cant") in kinds
    assert ("unsubscribe", "stays") in kinds
    assert not any(s["action"] == "rule_execute" for s in steps)
    assert sum(1 for s in steps if s["action"] == "unsubscribe") == 1


def test_a_bulk_unsubscribe_is_one_step(three):
    acc = _acc()
    for i in range(6):                         # one entry per sender
        auditlog.record("unsubscribe", account=acc.name, count=1,
                        label=f"s{i}@x.example", outcome="ok")
    auditlog.record("unsubscribe", actor="rule:r1", account=acc.name,
                    count=1, label="other@x.example", outcome="ok")
    steps = [s for s in _steps() if s["action"] == "unsubscribe"]
    assert sorted(s["count"] for s in steps) == [1, 6]
    p = timemachine.preview(acc, _steps()[-1]["id"])
    assert {"kind": "unsubscribe", "n": 7} in p["stays"]


def test_a_step_without_an_undo_entry_says_why(three):
    acc = _acc()
    with acc.lock:                         # as if the step had been emptied
        gone = acc.undo_log.pop(1)
        mailops._sync_undo(acc)
    auditlog.record("empty_trash", account=acc.name, count=2)
    steps = {s["id"]: s for s in _steps()}
    cant = steps[gone["audit_id"]]
    assert cant["status"] == "cant" and cant["reason"] == "emptied"
    assert cant["at"] >= cant["ts"]


def test_an_undone_step_shows_as_undone(three):
    mailops.undo_last()                                   # c
    steps = _steps()
    assert [s["status"] for s in steps if s["action"] == "trash"] == [
        "undone", "back", "back"]


def test_assistant_steps_are_listed_by_their_token(monkeypatch):
    _fake(monkeypatch)
    acc = _acc()
    meta = {"INBOX": {1: {"msgid": "<m1@shop.example>", "size": 5,
                          "addr": "a@x.example"}}}
    with acc.lock:
        mailops._record_undo("1 mail", meta, "trash", "Trash", acc,
                             audit_id="abc123", token="tok-1",
                             actor="mcp:Laptop")
    auditlog.record("trash", actor="mcp:Laptop", account=acc.name, count=1,
                    entry_id="abc123")
    (step,) = _steps()
    assert step["actor"] == "mcp:Laptop" and step["token"] == "tok-1"
    assert step["status"] == "back"


# ------------------------------------------------- retention, caps, on disk

def _entry(ts, n=1, **kw):
    return {"id": f"{ts:x}{n}", "ts": ts, "label": "x", "action": "trash",
            "count": n, "in": "Trash", "quiet": False,
            "items": [("INBOX", f"<{i}@x.example>") for i in range(n)], **kw}


def test_steps_are_kept_30_days_not_10(monkeypatch):
    _fake(monkeypatch)
    acc = _acc()
    with acc.lock:
        for i in range(25):                        # a day apart, 25 days
            acc.undo_log.append(_entry(NOW - i * 86400 - 60))
        acc.undo_log.sort(key=lambda e: e["ts"])
        mailops._sync_undo(acc)
    assert len(acc.undo_log) == 25                 # the old cut was 10
    assert len(acc.state["undo"]) == 25


def test_a_step_older_than_30_days_goes(monkeypatch):
    _fake(monkeypatch)
    acc = _acc()
    with acc.lock:
        acc.undo_log[:] = [_entry(NOW - 31 * 86400),
                           _entry(NOW - 29 * 86400)]
        mailops._sync_undo(acc)
    assert [e["ts"] for e in acc.undo_log] == [NOW - 29 * 86400]


def test_the_step_cap_is_a_safety_net_that_drops_the_oldest(monkeypatch):
    _fake(monkeypatch)
    monkeypatch.setattr(mailops, "UNDO_MAX", 5)
    acc = _acc()
    with acc.lock:
        acc.undo_log[:] = [_entry(NOW - 100 + i) for i in range(9)]
        mailops._sync_undo(acc)
    assert [e["ts"] for e in acc.undo_log] == [NOW - 100 + i
                                               for i in range(4, 9)]


def test_the_mail_cap_drops_old_steps_but_never_the_newest(monkeypatch):
    _fake(monkeypatch)
    monkeypatch.setattr(mailops, "UNDO_MAIL_CAP", 10)
    acc = _acc()
    with acc.lock:
        acc.undo_log[:] = [_entry(NOW - 300, n=6), _entry(NOW - 200, n=6),
                           _entry(NOW - 100, n=30)]
        mailops._sync_undo(acc)
    assert [e["count"] for e in acc.undo_log] == [30]      # newest survives


def test_the_assistant_list_is_cut_by_age_and_per_token(monkeypatch):
    _fake(monkeypatch)
    monkeypatch.setattr(mailops, "ASSISTANT_UNDO_MAX", 2)
    acc = _acc()
    with acc.lock:
        acc.assistant_undo[:] = [
            _entry(NOW - 40 * 86400, token="t", actor="mcp:T"),
            *[_entry(NOW - 50 + i, token="t", actor="mcp:T")
              for i in range(4)]]
        mailops._sync_undo(acc)
    assert [e["ts"] for e in acc.assistant_undo] == [NOW - 48, NOW - 47]


def test_undo_steps_survive_a_restart(three, monkeypatch):
    acc = _acc()
    before = [dict(e) for e in acc.undo_log]
    assert before and all(isinstance(i, tuple) for e in before
                          for i in e["items"])
    path = undostore._path(acc.name, acc.tenant, mailops.SNAPSHOT_DIR)
    assert path.exists() and oct(path.stat().st_mode)[-3:] == "600"
    accountsmod.reset()                                  # the process restarts
    fresh = accountsmod.get()
    assert fresh.undo_log == []
    mailops.load_undo(fresh)
    assert fresh.undo_log == before
    assert fresh.state["undo"] and fresh.assistant_undo == []
    # ... and a step brought back that way can still be restored
    mailops.undo_last(acc=fresh)


def test_the_assistant_list_is_persisted_too(monkeypatch):
    _fake(monkeypatch)
    acc = _acc()
    with acc.lock:
        acc.assistant_undo[:] = [_entry(NOW - 5, token="t", actor="mcp:T")]
        mailops._sync_undo(acc)
    accountsmod.reset()
    fresh = accountsmod.get()
    mailops.load_undo(fresh)
    assert [e["actor"] for e in fresh.assistant_undo] == ["mcp:T"]
    assert fresh.undo_log == []


def test_a_damaged_or_foreign_undo_file_is_ignored(monkeypatch):
    _fake(monkeypatch)
    acc = _acc()
    path = undostore._path(acc.name, acc.tenant, mailops.SNAPSHOT_DIR)
    path.parent.mkdir(parents=True, exist_ok=True)
    for text in ("{not json", json.dumps({"version": 99, "undo": [1]}),
                 json.dumps({"version": 1, "undo": [{"ts": "x"}, 5, None],
                             "assistant": "nope"})):
        path.write_text(text)
        assert undostore.load(acc.name, acc.tenant,
                              mailops.SNAPSHOT_DIR) == ([], [])


def test_undo_files_follow_a_rename_and_go_with_a_dropped_account(three):
    acc = _acc()
    base = mailops.SNAPSHOT_DIR
    old = undostore._path("default", acc.tenant, base)
    new = undostore._path("renamed", acc.tenant, base)
    assert old.exists()
    mailops.rename_undo("default", "renamed")
    assert not old.exists() and new.exists()
    assert undostore.load("renamed", acc.tenant, base)[0]
    mailops.drop_undo("renamed")
    assert not new.exists()


def test_the_undo_files_of_two_tenants_never_mix(three):
    acc = _acc()
    other = tenants.Tenant("t2", root=tenants.TENANTS_DIR / "t2")
    undostore.save("default", other, mailops.SNAPSHOT_DIR,
                   [_entry(NOW - 5)], [])
    assert len(undostore.load("default", other, mailops.SNAPSHOT_DIR)[0]) == 1
    mine = undostore.load("default", acc.tenant, mailops.SNAPSHOT_DIR)[0]
    assert len(mine) == 3
    assert undostore._path("default", other, mailops.SNAPSHOT_DIR) != \
        undostore._path("default", acc.tenant, mailops.SNAPSHOT_DIR)


# --------------------------------------------------------------- preview

def test_the_preview_counts_what_a_restore_moves(three):
    steps = _steps()                       # c, b, a (newest first)
    p = timemachine.preview(_acc(), steps[2]["id"])   # point after a
    assert p["steps"] == 2 and p["mails"] == 4
    assert p["bytes"] == sum(m["size"] for who in "bc"
                             for m in three.mailbox["Trash"]
                             if m["from"].startswith(f"{who}@"))
    assert p["folders"] == [{"folder": "INBOX", "name": "INBOX", "mails": 4}]
    assert {s["addr"]: s["mails"] for s in p["senders"]} == {
        "b@x.example": 2, "c@x.example": 2}
    assert p["cant"] == [] and p["stays"] == []
    timemachine.start(_acc(), steps[2]["id"], p["top"], None, [])
    assert _wait_restore()["moved"] == 4
    assert _where(three, "b") == {"INBOX": 2} and \
        _where(three, "c") == {"INBOX": 2}
    assert _where(three, "a") == {"Trash": 2}


def test_the_preview_reports_the_middle_of_two_steps_as_the_point(three):
    steps = _steps()
    p = timemachine.preview(_acc(), steps[1]["id"])
    assert p["point_ts"] == (steps[1]["ts"] + steps[0]["ts"]) // 2
    p = timemachine.preview(_acc(), "")            # before everything
    assert p["point_ts"] == steps[-1]["ts"] - 60 and p["steps"] == 3


def test_an_unknown_point_is_refused(three):
    with pytest.raises(RuntimeError, match=mailops.UNKNOWN_POINT):
        timemachine.preview(_acc(), "no-such-step")
    r = client.post("/api/timemachine/preview", json={"point": "nope"})
    assert r.status_code == 409 and r.json()["detail"] == "unknown_point"


def test_nothing_to_restore_when_the_line_is_above_every_step(three):
    steps = _steps()
    p = timemachine.preview(_acc(), steps[0]["id"])
    assert p["mails"] == 0 and p["steps"] == 0
    with pytest.raises(RuntimeError, match=mailops.NOTHING_TO_UNDO):
        timemachine.start(_acc(), steps[0]["id"], None, None, [])


def test_what_was_emptied_is_reported_and_skipped(three):
    acc = _acc()
    # b's mails leave Trash for good (what Empty Trash does to a step)
    gone = [m for m in three.mailbox["Trash"] if m["from"].startswith("b@")]
    for m in gone:
        three.mailbox["Trash"].remove(m)
    mailops._prune_undo(acc, "Trash", {m["msgid"] for m in gone},
                        {m["uid"] for m in gone})
    auditlog.record("empty_trash", account=acc.name, count=len(gone))
    steps = _steps()
    assert steps[0]["action"] == "empty_trash"
    assert steps[0]["status"] == "cant" and steps[0]["reason"] == "deleted"
    p = timemachine.preview(acc, steps[-1]["id"])
    assert p["mails"] == 2 + 0                    # c only; a is the point
    assert [(c["reason"], c["mails"]) for c in p["cant"]] == [("emptied", 2)]
    assert p["cant"][0]["at"] == steps[0]["ts"]
    timemachine.start(acc, steps[-1]["id"], p["top"], None, [])
    done = _wait_restore()
    assert done["status"] == "done" and done["moved"] == 2
    assert _where(three, "c") == {"INBOX": 2}
    assert _where(three, "a") == {"Trash": 2}


def test_a_step_whose_mails_the_provider_removed_is_reported(three):
    for m in list(three.mailbox["Trash"]):
        if m["from"].startswith("c@"):
            three.mailbox["Trash"].remove(m)
    p = timemachine.preview(_acc(), _steps()[2]["id"])
    assert p["mails"] == 2                         # b; c's are gone
    assert [(c["reason"], c["mails"]) for c in p["cant"]] == [("provider", 2)]


def test_unsubscribes_stay_and_are_named(three):
    acc = _acc()
    auditlog.record("unsubscribe", account=acc.name, count=1, label="x",
                    outcome="ok")
    p = timemachine.preview(acc, _steps()[-1]["id"])
    assert {"kind": "unsubscribe", "n": 1} in p["stays"]


# --------------------------------------------------------------- restore

def test_a_restore_stops_exactly_at_the_point(three):
    steps = _steps()
    timemachine.start(_acc(), steps[1]["id"], None, None, [])    # undo c only
    assert _wait_restore()["moved"] == 2
    assert _where(three, "c") == {"INBOX": 2}
    assert _where(three, "b") == {"Trash": 2}
    assert _where(three, "a") == {"Trash": 2}
    # b and a are still steps that can be undone; c's is gone, the restore
    # itself is a new one
    left = [e for e in _acc().undo_log if e["action"] == "trash"]
    assert {m["addr"] for e in left for m in mailops.undo_mails(e)} == {
        "a@x.example", "b@x.example"}
    assert [e["action"] for e in _acc().undo_log].count("restore") == 1


def test_a_restore_goes_newest_first(monkeypatch):
    """a mail moved into Keep, then trashed from there (two steps): going
    back past both must undo the trashing first - the other way round the
    mails would stay in Keep or Trash."""
    fake = _fake(monkeypatch)
    mailops.delete_groups("sender", ["a@x.example"], "move", "Keep")
    assert wait_delete_done()["moved"] == 2
    assert _where(fake, "a") == {"Keep": 2}
    mailops.run_scan()                              # Keep is indexed now
    _trash("a")
    assert _where(fake, "a") == {"Trash": 2}
    _retime([20 * MIN, 5 * MIN])
    assert [s["status"] for s in _steps()] == ["back", "back"]
    timemachine.start(_acc(), "", None, None, [])
    assert _wait_restore()["moved"] == 4            # 2 mails, 2 steps
    assert fake.mailbox["Keep"] == [] and fake.mailbox["Trash"] == []
    assert _where(fake, "a") == {"INBOX": 2}


def test_pinned_mails_and_protected_senders_stay_where_they_are(three):
    acc = _acc()
    pinned = next(m for m in three.mailbox["Trash"]
                  if m["from"].startswith("b@"))
    pinstore.set_pinned(pinned["msgid"], True, acc.name)
    cfgmod.update_config({"protected": ["c@x.example"]})
    steps = _steps()
    p = timemachine.preview(acc, steps[2]["id"])
    assert p["mails"] == 1 and p["skipped"] == {"protected": 2, "pinned": 1}
    timemachine.start(acc, steps[2]["id"], p["top"], None, [])
    assert _wait_restore()["moved"] == 1
    assert _where(three, "b") == {"INBOX": 1, "Trash": 1}   # the pinned one
    assert _where(three, "c") == {"Trash": 2}
    # what was left alone is still a step that can be undone later
    left = [e for e in acc.undo_log if e["action"] == "trash"]
    assert sum(e["count"] for e in left) == 2 + 1 + 2


def test_a_protected_sender_is_found_by_message_id_when_the_step_has_no_sender(
        three):
    """A step recorded without its senders (a look-alike folder move) still
    leaves a protected sender's mail alone: the Trash listing knows it."""
    acc = _acc()
    mailops.role_list("trash")                  # reads Trash into its index
    for e in acc.undo_log:
        for c in e["copies"]:
            c["addr"] = ""
    cfgmod.update_config({"protected": ["c@x.example"]})
    p = timemachine.preview(acc, _steps()[2]["id"])
    assert p["mails"] == 2 and p["skipped"]["protected"] == 2
    timemachine.start(acc, _steps()[2]["id"], p["top"], None, [])
    _wait_restore()
    assert _where(three, "c") == {"Trash": 2}


def test_pick_senders_restores_only_those_senders(three):
    acc = _acc()
    steps = _steps()
    p = timemachine.preview(acc, steps[2]["id"], ["b@x.example"])
    assert p["mails"] == 2 and [s["addr"] for s in p["senders"]] == [
        "b@x.example"]
    timemachine.start(acc, steps[2]["id"], p["top"], ["b@x.example"], [])
    assert _wait_restore()["moved"] == 2
    assert _where(three, "b") == {"INBOX": 2}
    assert _where(three, "c") == {"Trash": 2}
    # c's mails are still an undoable step
    assert any(e["count"] == 2 and e["items"][0][0] == "INBOX"
               for e in acc.undo_log)


def test_the_restore_is_one_job_one_activity_entry_and_one_step(three):
    acc = _acc()
    n_audit = len(auditlog.load(acc.name, 0, 100)["entries"])
    steps = _steps()
    timemachine.start(acc, steps[2]["id"], None, None, [])
    done = _wait_restore()
    assert done["status"] == "done" and done["steps_total"] == 2
    assert done["moved"] == 4
    entries = auditlog.load(acc.name, 0, 100)["entries"]
    assert len(entries) == n_audit + 1 and entries[0]["action"] == "restore"
    assert entries[0]["count"] == 4 and entries[0]["actor"] == "user"
    assert entries[0]["label"].isdigit()            # the moment it went to
    assert len(entries[0]["undoes_many"]) == 2
    (step,) = [e for e in acc.undo_log if e["action"] == "restore"]
    assert step["count"] == 4 and step["quiet"] is True
    assert mailops.public_state(acc)["undo"][-1]["label_key"] == "undo.restore"
    # the steps it undid are marked undone in the log
    shown = {s["id"]: s["status"] for s in _steps()}
    assert list(shown.values()).count("undone") == 2


def test_the_restore_can_be_undone_and_brings_its_steps_back(three):
    acc = _acc()
    steps = _steps()
    timemachine.start(acc, steps[2]["id"], None, None, [])
    _wait_restore()
    assert _where(three, "b") == {"INBOX": 2}
    r = mailops.undo_last()                               # the restore
    assert r["restored"] == 4 and r["of"] == 4
    assert _where(three, "b") == {"Trash": 2}
    assert _where(three, "c") == {"Trash": 2}
    assert _where(three, "a") == {"Trash": 2}
    # the steps it had undone can be undone (and restored) again
    again = [s for s in _steps() if s["action"] == "trash"]
    assert [s["status"] for s in again] == ["back"] * 3
    p = timemachine.preview(acc, again[2]["id"])
    assert p["mails"] == 4


def test_two_restores_in_a_row_are_refused_while_one_runs(three, monkeypatch):
    acc = _acc()
    with acc.lock:
        acc.state["restore"]["status"] = "running"
    with pytest.raises(RuntimeError, match=mailops.BUSY_ACTION):
        timemachine.start(acc, _steps()[2]["id"], None, None, [])
    with pytest.raises(RuntimeError, match=mailops.BUSY_ACTION):
        mailops.undo_last()                      # nothing else meanwhile
    with pytest.raises(RuntimeError):
        mailops._start_delete({"INBOX": {1}}, "x", acc)
    with acc.lock:
        acc.state["restore"]["status"] = "idle"


def test_steps_newer_than_the_preview_are_left_alone(three):
    acc = _acc()
    steps = _steps()
    p = timemachine.preview(acc, steps[2]["id"])
    _trash("d")                                  # a new step after the preview
    timemachine.start(acc, steps[2]["id"], p["top"], None, [])
    assert _wait_restore()["moved"] == 4
    assert _where(three, "d") == {"Trash": 1}


def test_a_failure_stops_the_restore_and_keeps_the_rest(three, monkeypatch):
    acc = _acc()
    steps = _steps()
    real = three.uid
    seen = {"moves": 0}

    def flaky(cmd, *args):
        if cmd in ("MOVE", "COPY"):
            seen["moves"] += 1
            if seen["moves"] == 2:               # the second step's move
                raise OSError("connection reset")
        return real(cmd, *args)
    monkeypatch.setattr(three, "uid", flaky)
    timemachine.start(acc, steps[2]["id"], None, None, [])
    done = _wait_restore()
    assert done["status"] == "done" and done["error"]
    assert done["moved"] == 2                    # c came back, b did not
    assert _where(three, "c") == {"INBOX": 2}
    assert _where(three, "b") == {"Trash": 2}
    # b's step is still there for a retry; the partial restore is one step
    assert any(e["action"] == "restore" and e["count"] == 2
               for e in acc.undo_log)
    out = auditlog.load(acc.name, 0, 5)["entries"][0]
    assert out["action"] == "restore" and out["outcome"] == "partial"


def test_the_bookkeeping_of_a_half_done_restore_is_not_written_to_disk(three):
    acc = _acc()
    big = {"uv": 1, "before": list(range(5000))}
    with acc.lock:
        for c in acc.undo_log[0]["copies"]:
            c["attempt"] = big
        mailops._sync_undo(acc)
    path = undostore._path(acc.name, acc.tenant, mailops.SNAPSHOT_DIR)
    assert path.stat().st_size < 20_000          # not 2 x 5000 numbers
    assert "attempt" not in path.read_text()
    assert "attempt" in acc.undo_log[0]["copies"][0]    # memory keeps it


def test_the_state_ends_even_when_booking_the_restore_fails(three, monkeypatch):
    acc = _acc()

    def boom(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(auditlog, "record", boom)
    timemachine.start(acc, _steps()[2]["id"], None, None, [])
    done = _wait_restore()
    assert done["status"] == "done" and done["moved"] == 4
    assert done["error"]                        # said, not swallowed


def test_rules_and_the_digest_wait_while_a_restore_runs(three):
    from backend import digest
    acc = _acc()
    with acc.lock:
        acc.state["restore"]["status"] = "running"
    for module in (rulesmod, digest):
        src = open(module.__file__).read()
        assert 'acc.state["restore"]["status"] == "running"' in src
    with pytest.raises(RuntimeError):
        mailops.start_scan(acc)                  # no scan under a restore
    with acc.lock:
        acc.state["restore"]["status"] = "idle"


# ------------------------------------------------------------------ rules

def _scheduled_rule(query="from:b@x.example"):
    rule = rulesmod.create_rule({
        "name": "Sweep b", "scope": "mail", "query": query,
        "action": "trash", "schedule": "daily"})
    rulesmod.run_rule(rule["id"], rescan=False)         # the report first
    return rulesmod.update_rule(rule["id"], {"mode": "execute"})


def test_rules_that_would_catch_the_mails_again_are_offered(three):
    acc = _acc()
    rule = _scheduled_rule()
    p = timemachine.preview(acc, _steps()[2]["id"])
    assert [(r["id"], r["mails"]) for r in p["rules"]] == [(rule["id"], 2)]


def test_a_rule_is_paused_only_when_ticked(three):
    acc = _acc()
    rule = _scheduled_rule()
    steps = _steps()
    timemachine.start(acc, steps[2]["id"], None, None, [])      # not ticked
    _wait_restore()
    assert next(r for r in rulesmod.load_rules()
                if r["id"] == rule["id"])["mode"] == "execute"
    mailops.undo_last()                                  # the restore
    trashed = [s for s in _steps() if s["action"] == "trash"]
    timemachine.start(acc, trashed[2]["id"], None, None, [rule["id"]])
    done = _wait_restore()
    assert done["paused"] == ["Sweep b"]
    assert next(r for r in rulesmod.load_rules()
                if r["id"] == rule["id"])["mode"] == "report"
    actions = [e["action"] for e in auditlog.load(acc.name, 0, 20)["entries"]]
    assert "rule_paused" in actions


def test_the_rule_that_did_a_step_is_offered_even_without_a_filter_match(
        three):
    acc = _acc()
    rule = _scheduled_rule(query="from:nobody@x.example")
    entry = _acc().undo_log[-1]
    auditlog_entries = auditlog._path()
    lines = [json.loads(x) for x in auditlog_entries.read_text().splitlines()]
    for a in lines:
        if a.get("id") == entry["audit_id"]:
            a["actor"] = f"rule:{rule['id']}"
    auditlog_entries.write_text("".join(json.dumps(a) + "\n" for a in lines))
    p = timemachine.preview(acc, _steps()[1]["id"])
    assert [r["id"] for r in p["rules"]] == [rule["id"]]


# --------------------------------------------------- accounts and the API

def test_the_api_lists_previews_and_restores(three):
    r = client.get("/api/timemachine")
    assert r.status_code == 200 and len(r.json()["steps"]) == 3
    point = r.json()["steps"][2]["id"]
    p = client.post("/api/timemachine/preview", json={"point": point}).json()
    assert p["mails"] == 4
    r = client.post("/api/timemachine/restore", json={
        "point": point, "top": p["top"]})
    assert r.status_code == 200 and r.json()["started"] is True
    assert _wait_restore()["moved"] == 4
    state = client.get("/api/state").json()
    assert state["restore"]["status"] == "done"
    r = client.post("/api/timemachine/restore", json={
        "point": r.json() and "nope"})
    assert r.status_code == 409


def test_accounts_never_see_each_others_steps(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    fakes = {h: FakeIMAP({"INBOX": [make_msg(1, frm="a@x.example"),
                                    make_msg(2, frm="a@x.example")],
                          "Trash": []}, renumber=True, copyuid=True)
             for h in ("host-one", "host-two")}
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    monkeypatch.setattr(mailops, "_rescan_after_restore",
                        lambda *a, **k: False)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.run_scan(one)
    mailops.run_scan(two)
    mailops.delete_groups("sender", ["a@x.example"], acc=one)
    end = time.time() + 5
    while time.time() < end and not one.undo_log:
        time.sleep(0.01)
    assert timemachine.listing(two)["steps"] == []
    (step,) = timemachine.listing(one)["steps"]
    assert step["mails"] == 2
    with pytest.raises(RuntimeError, match=mailops.NOTHING_TO_UNDO):
        timemachine.start(two, "", None, None, [])
    timemachine.start(one, "", None, None, [])
    assert _wait_restore(one)["moved"] == 2
    assert fakes["host-one"].mailbox["INBOX"] and \
        not fakes["host-two"].mailbox["Trash"]
    # each account's undo steps sit in a file of their own
    base = mailops.SNAPSHOT_DIR
    assert undostore._path("one", one.tenant, base) != \
        undostore._path("two", two.tenant, base)


def test_a_step_without_remembered_senders_still_restores(monkeypatch):
    """Steps recorded before senders were remembered (legacy shape: no
    copies, no `who`) are checked against Trash by Message-ID."""
    fake = _fake(monkeypatch)
    _trash("a")
    acc = _acc()
    with acc.lock:
        acc.undo_log[0].pop("copies")
        acc.undo_log[0].pop("who", None)
    p = timemachine.preview(acc, "")
    assert p["mails"] == 2 and p["senders"][0]["addr"] == ""
    timemachine.start(acc, "", None, None, [])
    assert _wait_restore()["moved"] == 2
    assert _where(fake, "a") == {"INBOX": 2}
