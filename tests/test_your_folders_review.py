"""Your folders, review round: a special folder below a folder, assistant
proposals, the confirm's own numbers being required, accounts that are one
mailbox, every other mailbox mover refusing while a folder is changed, older
Undo steps of a deleted folder, a rule the user switched back on."""

import json

import pytest

from backend import accountcopy
from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import timemachine
from backend import yourfolders as yf
from conftest import FakeIMAP, wait_delete_done, wait_scan_done
from test_multiaccount import _two_accounts
from test_your_folders import _add, _mails, acc, arm, box, err, rows, rule, rule_of  # noqa: F401


# ------------------------------------------- a special folder below a folder

@pytest.fixture
def mail(monkeypatch):
    """"Mail" holds a Trash-flagged "Mail/Bin" (a rename would rename it)."""
    fake = FakeIMAP({"INBOX": _mails("I", 1), "Mail": _mails("M", 2, first=5),
                     "Mail/Bin": [], "Other": _mails("O", 1, first=9)},
                    flags={"Mail/Bin": "\\Trash"})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    return fake


@pytest.mark.parametrize("op", ["rename", "merge", "delete", "check-rename"])
def test_nothing_is_done_to_a_folder_with_a_special_folder_below_it(mail, op):
    with pytest.raises(RuntimeError) as e:
        if op == "rename":
            yf.rename(acc(), "Mail", "Post")
        elif op == "merge":
            yf.merge(acc(), "Mail", "Other", 1, 9)
        elif op == "delete":
            yf.delete(acc(), "Mail", 1)
        else:
            yf.check(acc(), "rename", "Mail", name="Post")
    assert err(e) == "folder_locked"
    assert "folder=Mail%2FBin" in str(e.value) and "why=role" in str(e.value)
    assert set(mail.mailbox) == {"INBOX", "Mail", "Mail/Bin", "Other"}
    assert not any(c[0] in ("RENAME", "DELETE", "MOVE", "COPY")
                   for c in mail.commands)


def test_the_page_says_so_on_such_a_folder(mail):
    rr = rows()
    assert rr["Mail"]["can"] == {"rename": "locked_child",
                                 "merge": "locked_child",
                                 "delete": "locked_child"}
    assert rr["Other"]["can"]["rename"] is None


@pytest.mark.parametrize("flags,noselect", [
    ({"Mail/Bin": "\\Junk"}, {}), ({}, {"Mail/Bin": "\\Noselect"}),
    ({"Mail/Bin": "\\Sent"}, {})])
def test_any_kind_of_locked_child_counts(monkeypatch, flags, noselect):
    fake = FakeIMAP({"INBOX": _mails("I", 1), "Mail": _mails("M", 2, first=5),
                     "Mail/Bin": []}, flags=flags, noselect=noselect)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Mail", "Post")
    assert err(e) == "folder_locked"


# ------------------------------------------------------ assistant proposals

def _proposal(dest):
    return rulesmod.create_rule(
        {"name": "Proposed", "grouping": "sender", "query": "from:x@y.example",
         "action": "move", "dest": dest},
        proposed_by={"token_id": "t1", "name": "bot", "at": 1})


def test_a_waiting_proposal_stays_the_assistants_and_still_waits(box):
    p = _proposal("Receipts 2019")
    assert p["origin"] == "mcp"
    yf.rename(acc(), "Receipts 2019", "Receipts 2020", rules=[p["id"]])
    got = rule_of(p["id"])
    assert got["dest"] == "Receipts 2020" and got["mode"] == "report"
    assert got["origin"] == "mcp"                  # still an open proposal
    assert [r["id"] for r in rulesmod.open_proposals(rulesmod.load_rules())] \
        == [p["id"]]


def test_an_approved_assistant_rule_that_follows_becomes_the_users(box):
    p = _proposal("Receipts 2019")
    rulesmod.run_rule(p["id"], rescan=False)
    approved = rulesmod.update_rule(p["id"], {"mode": "execute"})
    assert approved["origin"] == "mcp" and approved["mode"] == "execute"
    yf.rename(acc(), "Receipts 2019", "Receipts 2020", rules=[p["id"]])
    got = rule_of(p["id"])
    assert got["origin"] == "manual" and got["mode"] == "report"


# ------------------------------------ the confirm's own numbers are required

def test_a_rename_or_merge_that_names_no_rules_is_refused_where_a_rule_is(box):
    r = rule("Receipts 2019")
    for call in (lambda: yf.rename(acc(), "Receipts 2019", "X", None),
                 lambda: yf.rename(acc(), "Receipts 2019", "X", []),
                 lambda: yf.merge(acc(), "Receipts 2019", "Receipts", 1, 11),
                 lambda: yf.merge(acc(), "Receipts 2019", "Receipts", 1, 11,
                                  rules=None)):
        with pytest.raises(RuntimeError) as e:
            call()
        assert err(e) == "folder_rules_changed"
    assert rule_of(r["id"])["dest"] == "Receipts 2019"
    assert [m["uid"] for m in box.mailbox["Receipts 2019"]] == [10, 11]
    # no rule, nothing to name
    assert yf.merge(acc(), "Travel", "Receipts", 1, 21)["moved"] == 2


def test_a_delete_needs_the_counted_uidvalidity(box):
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "receipts-old")
    assert err(e) == "count_required"
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "receipts-old", 0)
    assert err(e) == "count_required"
    assert "receipts-old" in box.mailbox


# -------------------------------------------- one mailbox under two names

@pytest.fixture
def twins(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "h1", "user": "me", "password": "pw"},
        "two": {"host": "h1", "user": "me", "password": "pw"}}}))
    fake = FakeIMAP({"INBOX": _mails("I", 1), "Bills": _mails("B", 2, first=5),
                     "Bills 2019": _mails("B9", 1, first=9), "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda im, name=None: fake)
    mailops.run_scan(accountsmod.get("one"))
    mailops.run_scan(accountsmod.get("two"))
    return fake


def _rule(account, dest, name):
    return rulesmod.create_rule({"name": name, "grouping": "sender",
                                 "query": "from:x@y.example",
                                 "action": "move", "dest": dest,
                                 "account": account})


def test_a_job_of_the_other_name_of_the_mailbox_blocks_a_folder_operation(twins):
    one, two = accountsmod.get("one"), accountsmod.get("two")
    two.delete_pending.append({"by_folder": {"INBOX": {1}}})
    for call in (lambda: yf.rename(one, "Bills 2019", "X"),
                 lambda: yf.check(one, "delete", "Bills 2019")):
        with pytest.raises(RuntimeError) as e:
            call()
        assert err(e) == "busy_action"
    two.delete_pending.clear()
    assert two.folder_lock.acquire(blocking=False)       # and its folder lock
    try:
        with pytest.raises(RuntimeError) as e:
            yf.rename(one, "Bills 2019", "X")
        assert err(e) == "busy_action"
        assert yf.overview(one)["busy"] == "busy_action"
    finally:
        two.folder_lock.release()
    two.state["status"] = "scanning"
    try:
        assert yf.overview(one)["busy"] == "busy_scan"
    finally:
        two.state["status"] = "done"


def test_rules_of_the_other_name_follow_the_rename(twins, monkeypatch):
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mine = _rule("one", "Bills 2019", "mine")
    theirs = _rule("two", "Bills 2019", "theirs")
    unrelated = _rule("two", "Bills", "unrelated")
    page = {r["name"]: r for r in yf.overview(one)["rows"]}
    assert {u["id"] for u in page["Bills 2019"]["used_by"]} \
        == {mine["id"], theirs["id"]}
    chk = yf.check(one, "rename", "Bills 2019", name="Bills 2020")
    assert {r["id"] for r in chk["rules"]} == {mine["id"], theirs["id"]}
    started = []
    monkeypatch.setattr(mailops, "start_scan",
                        lambda a, *x, **k: started.append(a.name))
    out = yf.rename(one, "Bills 2019", "Bills 2020",
                    rules=[mine["id"], theirs["id"]])
    assert {r["id"] for r in out["rules"]} == {mine["id"], theirs["id"]}
    assert rule_of(mine["id"])["dest"] == "Bills 2020"
    assert rule_of(theirs["id"])["dest"] == "Bills 2020"
    assert rule_of(unrelated["id"])["dest"] == "Bills"
    # the other name's numbers are stale: it scans too
    assert "two" in started


def test_a_rename_that_leaves_the_rule_of_the_other_name_out_is_refused(twins):
    one = accountsmod.get("one")
    mine = _rule("one", "Bills 2019", "mine")
    theirs = _rule("two", "Bills 2019", "theirs")
    with pytest.raises(RuntimeError) as e:
        yf.rename(one, "Bills 2019", "Bills 2020", rules=[mine["id"]])
    assert err(e) == "folder_rules_changed"
    assert rule_of(theirs["id"])["dest"] == "Bills 2019"


def test_the_other_names_rule_keeps_a_folder_from_being_deleted(twins):
    _add(twins, "Empty")
    _rule("two", "Empty", "theirs")
    one = accountsmod.get("one")
    with pytest.raises(RuntimeError) as e:
        yf.delete(one, "Empty", 1)
    assert err(e) == "folder_used_by_rules"


def test_accounts_of_another_mailbox_are_no_twins(monkeypatch):
    fakes = _two_accounts(monkeypatch)
    assert [a.name for a in yf._twins(accountsmod.get("one"))] == ["one"]


# ------------------------------------------ copy jobs, also one that failed

@pytest.mark.parametrize("status,code", [
    ("running", "copy_busy"), ("paused", "copy_unfinished"),
    ("error", "copy_unfinished")])
def test_an_account_copy_that_is_not_over_blocks_folder_operations(
        box, monkeypatch, status, code):
    monkeypatch.setattr(accountcopy, "status", lambda: {"job": {
        "status": status, "source": acc().name, "target": "elsewhere"}})
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "Receipts 2019", "X1")
    # a running copy is told to pause or cancel; a stopped one to finish or
    # cancel (it cannot be "paused" again)
    assert err(e) == code
    assert yf.overview(acc())["busy"] == code
    for over in ("done", "cancelled"):
        monkeypatch.setattr(accountcopy, "status", lambda o=over: {"job": {
            "status": o, "source": acc().name, "target": "elsewhere"}})
        assert yf.overview(acc())["busy"] is None


# ----------------------- every other mailbox mover refuses during a folder op

def test_nothing_else_starts_while_a_folder_operation_holds_its_lock(box):
    mailops.delete_messages([["Receipts", 1]], "trash")
    wait_delete_done()
    a = acc()
    assert a.folder_lock.acquire(blocking=False)
    try:
        with pytest.raises(RuntimeError) as e:
            mailops.start_scan(a)                         # also the scheduled one
        assert str(e.value) == "busy"
        with pytest.raises(RuntimeError) as e:
            mailops.undo_last()
        assert err(e) == "busy_action"
        with pytest.raises(RuntimeError) as e:
            timemachine.start(a, "", None, None, [])
        assert err(e) == "busy_action"
        with pytest.raises(RuntimeError) as e:
            mailops.empty_trash(a, 1, 1)
        assert err(e) == "busy_action"
        assert len(a.undo_log) == 1                       # the step is kept
        assert a.state["status"] == "done"
    finally:
        a.folder_lock.release()
    mailops.start_scan(a)                                 # fine again
    wait_scan_done()


def test_an_account_copy_does_not_start_while_a_folder_changes(monkeypatch):
    _two_accounts(monkeypatch)
    for name in ("one", "two"):
        mailops.run_scan(accountsmod.get(name))
    src, tgt = accountsmod.get("one"), accountsmod.get("two")
    for held in (src, tgt):
        assert held.folder_lock.acquire(blocking=False)
        try:
            with pytest.raises(RuntimeError) as e:
                accountcopy.start("one", "two", ["newsletter"])
            assert err(e) == "busy_action"
        finally:
            held.folder_lock.release()


def test_a_resumed_account_copy_waits_for_a_folder_operation(monkeypatch):
    _two_accounts(monkeypatch)
    src = accountsmod.get("one")
    accountcopy._write({"job": {"id": "j", "source": "one", "target": "two",
                                "status": "paused", "folder": "F",
                                "kinds": [], "error": "", "finished": 0}})
    assert src.folder_lock.acquire(blocking=False)
    try:
        with pytest.raises(RuntimeError) as e:
            accountcopy.resume()
        assert err(e) == "busy_action"
    finally:
        src.folder_lock.release()


# ---------------------------------- older Undo steps of a deleted folder

def test_a_deleted_empty_folder_does_not_strand_the_steps_that_came_from_it(box):
    box.mailbox["receipts-old"] = _mails("old", 2, first=60)
    mailops.run_scan()
    mailops.delete_messages([["receipts-old", 60], ["receipts-old", 61]],
                            "trash")
    wait_delete_done()
    wait_scan_done()
    step = acc().undo_log[-1]
    assert {f for f, _ in step["items"]} == {"receipts-old"}
    assert "recreate" not in step
    chk = yf.check(acc(), "delete", "receipts-old")
    yf.delete(acc(), "receipts-old", chk["uv"])
    assert "receipts-old" not in box.mailbox
    # the step knows - and it is on disk before the folder went
    assert acc().undo_log[-1]["recreate"] == ["receipts-old"]
    from backend import undostore
    user, _bots = undostore.load(acc().name, acc().tenant, mailops.SNAPSHOT_DIR)
    assert user[-1]["recreate"] == ["receipts-old"]
    res = mailops.undo_last()
    wait_scan_done()
    assert res["restored"] == 2
    assert sorted(m["uid"] for m in box.mailbox["receipts-old"]) == [60, 61]


def test_the_undo_steps_are_marked_before_the_delete_is_sent(box, monkeypatch):
    box.mailbox["receipts-old"] = _mails("old", 1, first=60)
    mailops.run_scan()
    mailops.delete_messages([["receipts-old", 60]], "trash")
    wait_delete_done()
    wait_scan_done()
    seen = {}
    real = box.delete

    def spy(name):
        seen["marked"] = [e.get("recreate") for e in acc().undo_log]
        seen["dirty"] = acc().undo_dirty
        return real(name)

    monkeypatch.setattr(box, "delete", spy)
    chk = yf.check(acc(), "delete", "receipts-old")
    yf.delete(acc(), "receipts-old", chk["uv"])
    assert seen["marked"] == [["receipts-old"]] and seen["dirty"] is False


def test_steps_from_other_folders_are_left_alone(box):
    mailops.delete_messages([["Travel", 20]], "trash")
    wait_delete_done()
    wait_scan_done()
    chk = yf.check(acc(), "delete", "receipts-old")
    yf.delete(acc(), "receipts-old", chk["uv"])
    assert "recreate" not in acc().undo_log[-1]


# ------------------------------------- a rule the user switched on again

def test_undo_leaves_a_rule_alone_that_was_switched_on_again(box):
    r = rule("Receipts 2019")
    from test_your_folders_merge import merge
    merge(rules=[r["id"]])
    wait_scan_done()
    again = arm(r)                                   # the user's own switch
    assert again["mode"] == "execute" and again["dest"] == "Receipts"
    mailops.undo_last()
    wait_scan_done()
    got = rule_of(r["id"])
    assert got["mode"] == "execute" and got["dest"] == "Receipts"
    # one still in Report only does go back
    r2 = rule("Receipts 2019", name="second")
    merge("Receipts 2019", "Receipts", rules=[r2["id"]])
    wait_scan_done()
    mailops.undo_last()
    wait_scan_done()
    assert rule_of(r2["id"])["dest"] == "Receipts 2019"


# ---------------------------------------- rename leaves the old name behind

def test_a_rename_unsubscribes_the_old_name_and_subscribes_the_new(box):
    yf.rename(acc(), "Travel", "Trips")
    wait_scan_done()
    assert ("SUBSCRIBE", "Trips") in box.commands
    assert ("UNSUBSCRIBE", "Travel") in box.commands
    assert box.commands.index(("SUBSCRIBE", "Trips")) \
        < box.commands.index(("UNSUBSCRIBE", "Travel"))


# ------------------------------------------- the rule scheduler waits, too

def _due_rule(**over):
    return rulesmod.create_rule({
        "name": "weekly", "grouping": "sender", "query": "from:x@y.example",
        "action": "move", "dest": "Receipts", "schedule": "weekly", **over})


@pytest.mark.parametrize("kind", ["move", "purge"])
def test_a_due_rule_is_skipped_quietly_while_a_folder_changes_and_runs_after(
        box, monkeypatch, kind):
    rule_ = _due_rule() if kind == "move" else rulesmod.create_rule({
        "name": "purge", "scope": "trash", "schedule": "weekly",
        "older_than_days": 30})
    ran = []
    monkeypatch.setattr(rulesmod, "run_rule",
                        lambda rid, rescan=True: ran.append(rid))
    a = acc()
    assert a.folder_lock.acquire(blocking=False)
    try:
        rulesmod._tick()
        assert ran == []                       # not run ...
        got = rule_of(rule_["id"])
        assert not got.get("last_run")         # ... and no failed run recorded
    finally:
        a.folder_lock.release()
    rulesmod._tick()                           # the next tick runs it
    assert ran == [rule_["id"]]


def test_the_scheduler_also_waits_for_a_folder_change_of_the_other_name(
        twins, monkeypatch):
    one, two = accountsmod.get("one"), accountsmod.get("two")
    r = _due_rule(account="two", dest="Bills")
    ran = []
    monkeypatch.setattr(rulesmod, "run_rule",
                        lambda rid, rescan=True: ran.append(rid))
    held = []

    def spy(*a, **k):
        held.append((one.folder_lock.locked(), two.folder_lock.locked()))
        raise RuntimeError("stop here")

    monkeypatch.setattr(yf, "_new_name", spy)
    with pytest.raises(RuntimeError):
        yf.rename(one, "Bills 2019", "X")
    assert held == [(True, True)]              # every name of the mailbox
    assert not one.folder_lock.locked() and not two.folder_lock.locked()
    # while one holds them, the other name's rules, jobs and scans wait
    with yf._operation(one):
        rulesmod._tick()
        assert ran == []
        with pytest.raises(RuntimeError) as e:
            mailops.start_scan(two)
        assert str(e.value) == "busy"
        with pytest.raises(RuntimeError) as e:
            with two.lock:
                mailops._start_delete({"INBOX": {1}}, "x", two)
        assert err(e) == "busy_action"
    rulesmod._tick()
    assert ran == [r["id"]]


# ------------------- a rename follows to the other name of the mailbox

def test_a_rename_reaches_the_other_names_undo_steps_and_scan_switch(twins):
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.delete_messages([["Bills 2019", 9]], "trash", acc=two)
    wait_delete_done()
    wait_scan_done()
    assert {f for f, _ in two.undo_log[-1]["items"]} == {"Bills 2019"}
    cfgmod.update_config({"account": "two", "excluded_folders": [
        "Bills 2019", "Trash"]})
    yf.rename(one, "Bills 2019", "Bills 2020")
    wait_scan_done()
    assert {f for f, _ in two.undo_log[-1]["items"]} == {"Bills 2020"}
    assert "Bills 2020" in cfgmod.account_imap("two")["excluded_folders"]
    assert "Bills 2019" not in cfgmod.account_imap("two")["excluded_folders"]
    # its scan index and folder list follow, too
    assert "Bills 2019" not in two.state["folders_raw"]


def test_a_merge_and_a_delete_reach_the_other_names_index(twins):
    one, two = accountsmod.get("one"), accountsmod.get("two")
    chk = yf.check(one, "merge", "Bills 2019", "Bills")
    yf.merge(one, "Bills 2019", "Bills", chk["uv"], chk["max_uid"],
             delete_after=True, rules=[])
    wait_scan_done()
    assert "Bills 2019" not in twins.mailbox
    assert not any(m["folder"] == "Bills 2019" for m in two.index.values())
    assert "Bills 2019" not in two.state["folders_raw"]


# -------------------------------------------------- a case-only rename

def test_a_rename_that_only_changes_the_case_is_allowed(box):
    chk = yf.check(acc(), "rename", "Travel", name="TRAVEL")
    assert chk["new"] == "TRAVEL"
    out = yf.rename(acc(), "Travel", "TRAVEL")
    wait_scan_done()
    assert out["raw"] == "TRAVEL" and "TRAVEL" in box.mailbox
    assert "Travel" not in box.mailbox
    # another folder's name in another case is still taken
    with pytest.raises(RuntimeError) as e:
        yf.rename(acc(), "TRAVEL", "receipts")
    assert err(e) == "folder_exists"
