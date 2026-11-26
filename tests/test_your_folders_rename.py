"""Your folders: rename, and the guards every folder operation shares (one at
a time, nothing while a job runs)."""

import json

import pytest

from backend import accountcopy
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import tenants
from backend import yourfolders as yf
from conftest import wait_delete_done, wait_scan_done
from test_your_folders import (_add, _mails, acc, arm, box, err,  # noqa: F401
                               rows, rule, rule_of)


def _wait():
    wait_scan_done()


def test_rename_moves_the_folder_and_keeps_its_mail(box):
    out = yf.rename(acc(), "Receipts 2019", "Receipts 2020")
    _wait()
    assert out["raw"] == "Receipts 2020" and out["rules"] == []
    assert "Receipts 2019" not in box.mailbox
    assert [m["uid"] for m in box.mailbox["Receipts 2020"]] == [10, 11]
    assert ("RENAME", "Receipts 2019", "Receipts 2020") in box.commands
    assert ("SUBSCRIBE", "Receipts 2020") in box.commands
    e = auditlog.load(acc().name)["entries"][0]
    assert e["action"] == "folder_rename"
    assert e["label"] == "Receipts 2019 → Receipts 2020"
    # the scan knows the folder under its new name
    rr = rows()
    assert rr["Receipts 2020"]["mails"] == 2 and "Receipts 2019" not in rr
    assert "Receipts 2020" in mailops.STATE["folders_raw"]


def test_rename_keeps_the_scan_index_without_a_rescan(box, monkeypatch):
    def busy(*a, **k):
        raise RuntimeError("busy")
    monkeypatch.setattr(mailops, "start_scan", busy)
    yf.rename(acc(), "Receipts 2019", "Receipts 2020")
    # no scan could start: the index, groups and folder list follow anyway
    assert {m["folder"] for m in mailops.INDEX.values()} >= {"Receipts 2020"}
    assert not any(m["folder"] == "Receipts 2019"
                   for m in mailops.INDEX.values())
    assert "Receipts 2019" not in mailops.STATE["folders_raw"]
    recs = mailops.STATE["groups"]["sender"].values()
    assert all("Receipts 2019" not in rec["folders"] for rec in recs)
    assert any("Receipts 2020" in rec["folders"] for rec in recs)
    assert mailops.STATE["notice"]["key"] == "folder_renamed_rescan"


def test_rename_points_rules_at_the_new_name_and_back_to_report(box):
    active = arm(rule("Receipts 2019"))
    assert active["mode"] == "execute"
    other = rule("Travel", name="Trips")
    out = yf.rename(acc(), "Receipts 2019", "Receipts 2020",
                    rules=[active["id"]])
    _wait()
    assert [r["id"] for r in out["rules"]] == [active["id"]]
    got = rule_of(active["id"])
    assert got["dest"] == "Receipts 2020" and got["mode"] == "report"
    assert got["report_runs"] == 0
    assert rule_of(other["id"])["dest"] == "Travel"
    # what the file holds and what the UI is told is Report only too - not
    # merely what a later read of the rules would make of it
    on_disk = next(r for r in json.loads(rulesmod.RULES_PATH.read_text())[
        "rules"] if r["id"] == active["id"])
    assert on_disk["mode"] == "report" and on_disk["reset_reason"] == "edited"
    shown = next(r for r in mailops.STATE["rules"] if r["id"] == active["id"])
    assert shown["mode"] == "report" and shown["dest"] == "Receipts 2020"


def test_rename_refuses_when_the_rules_are_not_the_ones_the_confirm_named(box):
    r = rule("Receipts 2019")
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", "Receipts 2020", rules=[])
    assert err(e) == "folder_rules_changed"
    assert "Receipts 2019" in box.mailbox
    assert rule_of(r["id"])["dest"] == "Receipts 2019"
    yf.rename(acc(), "Receipts 2019", "Receipts 2020", rules=[r["id"]])
    _wait()
    assert rule_of(r["id"])["dest"] == "Receipts 2020"


def test_a_rule_of_another_account_or_tenant_is_left_alone(box):
    mine = rule("Receipts 2019")
    theirs = rule("Receipts 2019", name="elsewhere")
    data = rulesmod.load_rules()
    for r in data:
        if r["id"] == theirs["id"]:
            r["account"] = "other"          # another account's rule
    rulesmod._save(data)
    yf.rename(acc(), "Receipts 2019", "Receipts 2020", rules=[mine["id"]])
    _wait()
    assert rule_of(mine["id"])["dest"] == "Receipts 2020"
    assert rule_of(theirs["id"])["dest"] == "Receipts 2019"
    # ... and another tenant's rules are neither read nor written
    bob = tenants.for_subject("bob@y.example")
    assert tenants.call_in(bob, rulesmod.load_rules) == []
    assert tenants.call_in(bob, rulesmod.moving_into, acc().name,
                           lambda d: True) == []


def test_rename_follows_the_scan_switch_and_the_patterns(box):
    cfgmod.update_config({"account": acc().name, "excluded_folders": [
        "Receipts 2019", "Travel*", "Trash", "Spam", "Sent"]})
    mailops.run_scan()
    chk = yf.check(acc(), "rename", "Receipts 2019", name="Receipts 2020")
    assert chk["stops_scanning"] is False
    yf.rename(acc(), "Receipts 2019", "Receipts 2020")
    _wait()
    ex = cfgmod.account_imap(acc().name)["excluded_folders"]
    assert "Receipts 2020" in ex and "Receipts 2019" not in ex
    assert "Travel*" in ex                       # the pattern stays as it was
    # a folder that only a pattern kept out stays out under a new name
    yf.rename(acc(), "Travel", "Trips")
    _wait()
    ex = cfgmod.account_imap(acc().name)["excluded_folders"]
    assert "Trips" in ex and "Travel*" in ex
    assert rows()["Trips"]["mails"] is None


def test_rename_into_an_exclude_pattern_is_said_before(box):
    cfgmod.update_config({"account": acc().name, "excluded_folders": [
        "Hidden*", "Trash", "Spam", "Sent"]})
    mailops.run_scan()
    chk = yf.check(acc(), "rename", "Travel", name="Hidden trips")
    assert chk["stops_scanning"] is True


def test_rename_updates_the_undo_steps_and_undo_still_works(box):
    mailops.delete_messages([["Receipts", 1], ["Receipts", 2]], "trash")
    wait_delete_done()
    step = acc().undo_log[-1]
    assert {f for f, _ in step["items"]} == {"Receipts"}
    yf.rename(acc(), "Receipts", "Bills")
    _wait()
    step = acc().undo_log[-1]
    assert {f for f, _ in step["items"]} == {"Bills"}
    assert {c["folder"] for c in step["copies"]} == {"Bills"}
    assert acc().state["undo"][-1]["count"] == 2
    mailops.undo_last()
    assert {m["uid"] for m in box.mailbox["Bills"]} == {1, 2, 3}


def test_rename_follows_a_folder_with_subfolders(box):
    _add(box, "Projects", _mails("P", 1, first=60))
    _add(box, "Projects/Alpha", _mails("A", 2, first=70))
    mailops.run_scan()
    r = rule("Projects/Alpha", name="Alpha rule")
    cfgmod.update_config({"account": acc().name, "excluded_folders": [
        "Projects/Alpha", "Trash", "Spam", "Sent"]})
    out = yf.rename(acc(), "Projects", "Work", rules=[r["id"]])
    _wait()
    assert "Work/Alpha" in box.mailbox and "Projects/Alpha" not in box.mailbox
    assert rule_of(r["id"])["dest"] == "Work/Alpha"
    assert "Work/Alpha" in cfgmod.account_imap(acc().name)[
        "excluded_folders"]
    assert out["raw"] == "Work"


@pytest.mark.parametrize("name,code", [
    ("travel", "folder_exists"), ("Receipts", "folder_exists"),
    ("Drafts", "folder_reserved"), ("", "folder_name_bad")])
def test_rename_refuses_a_taken_or_reserved_name(box, name, code):
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", name)
    assert err(e) == code and "Receipts 2019" in box.mailbox


def test_rename_to_the_same_name_is_refused(box):
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", "Receipts 2019")
    assert err(e) == "folder_same"


def test_a_renamed_leaf_stays_in_its_parent_and_loses_the_slash(box):
    _add(box, "Projects/Alpha", _mails("A", 1, first=70))
    out = yf.rename(acc(), "Projects/Alpha", "a/b")
    assert out["raw"] == "Projects/ab"


def test_a_failed_rename_changes_nothing_locally(box, monkeypatch):
    r = rule("Receipts 2019")
    monkeypatch.setattr(box, "rename", lambda a, b: ("NO", [b"nope"]))
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", "Receipts 2020", rules=[r["id"]])
    assert err(e) == "folder_rename_failed"
    assert rule_of(r["id"])["dest"] == "Receipts 2019"
    assert "Receipts 2019" in mailops.STATE["folders_raw"]


def test_a_local_step_that_fails_does_not_stop_the_next(box, monkeypatch):
    r = rule("Receipts 2019")

    def boom(*a):
        raise ZeroDivisionError
    monkeypatch.setattr(yf, "_rename_config", boom)
    out = yf.rename(acc(), "Receipts 2019", "Receipts 2020", rules=[r["id"]])
    _wait()
    assert out["failed"] == ["config"]
    assert rule_of(r["id"])["dest"] == "Receipts 2020"


# ------------------------------------------------- busy / one at a time

def test_nothing_runs_while_a_move_job_is_queued_or_running(box):
    ops = (lambda: yf.rename(acc(), "Receipts 2019", "X1"),
           lambda: yf.merge(acc(), "Receipts 2019", "Receipts", 1, 99),
           lambda: yf.delete(acc(), "receipts-old", 1),
           lambda: yf.check(acc(), "delete", "receipts-old"))
    for op in ops:
        acc().delete_pending.append({"by_folder": {"INBOX": {1}}})
        try:
            with pytest.raises(RuntimeError) as e:
                op()
            assert err(e) == "busy_action"
        finally:
            acc().delete_pending.clear()
    acc().inflight = {"Receipts": {1}}
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", "X1")
    assert err(e) == "busy_action"
    acc().inflight = {}
    assert set(box.mailbox) >= {"Receipts 2019", "receipts-old"}


def test_nothing_runs_during_a_scan_a_restore_or_an_undo(box):
    for key, val, code in (("status", "scanning", "busy_scan"),
                           ("restore", {"status": "running"},
                            "busy_action")):
        old = acc().state[key]
        acc().state[key] = val
        try:
            with pytest.raises(RuntimeError) as e:
                yf.rename(acc(), "Receipts 2019", "X1")
            assert err(e) == code
        finally:
            acc().state[key] = old
    acc().undo_busy = 1
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", "X1")
    assert err(e) == "busy_action"
    acc().undo_busy = 0


def test_a_move_job_cannot_start_while_a_folder_operation_runs(box):
    assert acc().folder_lock.acquire(blocking=False)
    try:
        with acc().lock:
            with pytest.raises(RuntimeError) as e:
                mailops._start_delete({"INBOX": {1}}, "x", acc())
        assert err(e) == "busy_action"
        with pytest.raises(RuntimeError) as e:        # and a second operation
            yf.rename(acc(), "Receipts 2019", "X1")
        assert err(e) == "busy_action"
    finally:
        acc().folder_lock.release()
    assert not acc().folder_lock.locked()


def test_the_lock_is_released_after_a_refusal(box):
    with pytest.raises(RuntimeError):
        yf.rename(acc(), "INBOX", "X1")
    assert not acc().folder_lock.locked()


def test_an_account_copy_into_this_account_blocks_folder_operations(
        box, monkeypatch):
    monkeypatch.setattr(accountcopy, "status", lambda: {"job": {
        "status": "paused", "source": "elsewhere", "target": acc().name}})
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", "X1")
    assert err(e) == "copy_unfinished"       # paused: not "pause it first"
