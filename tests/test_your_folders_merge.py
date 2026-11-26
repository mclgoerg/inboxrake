"""Your folders: merge a folder into another (one step with an Undo, the rules
that point at it, the optional delete of the emptied folder) and the Undo of
it - recreating a deleted folder, pointing the rules back."""

import pytest

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import rules as rulesmod
from backend import yourfolders as yf
from conftest import FakeIMAP, wait_scan_done
from test_your_folders import (_add, _mails, acc, arm, box, err,  # noqa: F401
                               rows, rule, rule_of)


def merge(folder="Receipts 2019", target="Receipts", **kw):
    chk = yf.check(acc(), "merge", folder, target)
    # the rules the confirm names are the rules the call confirms
    kw.setdefault("rules", [r["id"] for r in chk["rules"]])
    return yf.merge(acc(), folder, target, chk["uv"], chk["max_uid"], **kw)


def uids(fake, folder):
    return sorted(m["uid"] for m in fake.mailbox[folder])


# ------------------------------------------------------------------ check

def test_check_counts_live_names_the_rules_and_the_kept_mail(box):
    r = rule("Receipts 2019")
    box.mailbox["Receipts 2019"].append(            # arrived after the scan
        _mails("late", 1, first=99, frm="late@store.example")[0])
    mailops.set_pin("Receipts 2019", 10, True)
    cfgmod.update_config({"protected": ["old@store.example"]})
    chk = yf.check(acc(), "merge", "Receipts 2019", "Receipts")
    assert chk["count"] == 3 and chk["max_uid"] == 99 and chk["uv"] == 1
    assert chk["target_name"] == "Receipts"
    assert [x["id"] for x in chk["rules"]] == [r["id"]]
    assert chk["protected"] == 2          # the two scanned mails of old@
    assert chk["pinned"] == 1
    assert chk["can_delete"] is None
    assert not any(c[0] in ("MOVE", "COPY") for c in box.commands)
    assert len(box.mailbox["Receipts 2019"]) == 3         # nothing moved


def test_check_says_a_folder_with_subfolders_cannot_be_deleted_after(box):
    _add(box, "Receipts 2019/Extra", _mails("E", 1, first=60))
    assert yf.check(acc(), "merge", "Receipts 2019", "Receipts")[
        "can_delete"] == "children"


# ------------------------------------------------------------------ merge

def test_merge_moves_every_mail_as_one_step_with_an_undo(box):
    out = merge()
    wait_scan_done()
    assert out["moved"] == 2 and out["deleted"] is False
    assert out["target"] == "Receipts" and out["rules"] == []
    assert uids(box, "Receipts") == [1, 2, 3, 10, 11]
    assert box.mailbox["Receipts 2019"] == []          # the folder stays
    step = acc().undo_log[-1]
    assert step["action"] == "move_contents" and step["folder_merge"] is True
    assert step["count"] == 2 and step["in"] == "Receipts"
    assert {c["folder"] for c in step["copies"]} == {"Receipts 2019"}
    assert "recreate" not in step and "folder_rules" not in step
    assert out["undo"]["id"] == step["id"]
    e = auditlog.load(acc().name)["entries"][0]
    assert e["action"] == "move_contents" and e["count"] == 2
    assert e["label"] == "Receipts 2019 → Receipts"
    assert e["id"] == step["audit_id"]
    # the scan sees the mails where they are now
    assert rows()["Receipts"]["mails"] == 5
    assert rows()["Receipts 2019"]["mails"] == 0


def test_merge_pinned_and_protected_mail_moves_along_and_stays_so(box):
    cfgmod.update_config({"protected": ["old@store.example"]})
    mailops.set_pin("Receipts 2019", 10, True)
    out = merge()
    assert out["moved"] == 2
    assert uids(box, "Receipts 2019") == []
    assert "<Receipts2019-10@x.example>" in pinstore.load_account(
        acc().name)


def test_merge_into_the_archive_folder_or_the_inbox_is_allowed(box):
    assert merge("Receipts 2019", "Archive")["moved"] == 2
    wait_scan_done()
    assert merge("Receipts", "INBOX")["moved"] == 3
    assert {m["uid"] for m in box.mailbox["INBOX"]} >= {1, 2, 3, 4}


def test_merge_then_delete_the_emptied_folder(box):
    out = merge(delete_after=True)
    wait_scan_done()
    assert out["deleted"] is True and out["kept"] == ""
    assert "Receipts 2019" not in box.mailbox
    assert "Receipts 2019" not in mailops.STATE["folders_raw"]
    assert acc().undo_log[-1]["recreate"] == ["Receipts 2019"]
    actions = [e["action"] for e in auditlog.load(acc().name)["entries"]]
    assert "folder_delete" in actions and "move_contents" in actions


def test_undo_of_a_merge_moves_the_mail_back_and_rescans(box):
    merge()
    wait_scan_done()
    res = mailops.undo_last()
    wait_scan_done()
    assert res["restored"] == 2 and res["rescan"] is True
    assert uids(box, "Receipts 2019") == [10, 11]
    assert uids(box, "Receipts") == [1, 2, 3]
    assert rows()["Receipts 2019"]["mails"] == 2


def test_undo_recreates_the_deleted_folder_and_points_the_rule_back(box):
    r = arm(rule("Receipts 2019"))
    assert r["mode"] == "execute"
    out = merge(delete_after=True, rules=[r["id"]])
    wait_scan_done()
    assert [x["id"] for x in out["rules"]] == [r["id"]]
    got = rule_of(r["id"])
    assert got["dest"] == "Receipts" and got["mode"] == "report"
    shown = next(x for x in mailops.STATE["rules"] if x["id"] == r["id"])
    assert shown["mode"] == "report"            # the UI is told, too
    assert "Receipts 2019" not in box.mailbox
    res = mailops.undo_last()
    wait_scan_done()
    assert res["restored"] == 2
    assert uids(box, "Receipts 2019") == [10, 11]        # re-created, refilled
    assert ("CREATE", "Receipts 2019") in box.commands
    assert ("SUBSCRIBE", "Receipts 2019") in box.commands
    back = rule_of(r["id"])
    assert back["dest"] == "Receipts 2019" and back["mode"] == "report"
    assert "Receipts 2019" in mailops.STATE["folders_raw"]


def test_undo_leaves_a_rule_alone_that_was_edited_since(box):
    r = rule("Receipts 2019")
    merge(rules=[r["id"]])
    rulesmod.update_rule(r["id"], {"dest": "Travel"})      # the user's own
    mailops.undo_last()
    wait_scan_done()
    assert rule_of(r["id"])["dest"] == "Travel"


def test_undo_does_not_point_rules_back_when_the_mail_did_not_go_back(
        box, monkeypatch):
    r = rule("Receipts 2019")
    merge(rules=[r["id"]])
    wait_scan_done()
    box.mailbox["Receipts"] = [m for m in box.mailbox["Receipts"]
                               if m["uid"] not in (10, 11)]   # gone meanwhile
    mailops.undo_last()
    assert rule_of(r["id"])["dest"] == "Receipts"


def test_a_merge_changes_only_the_rules_that_point_at_the_folder(box):
    a = rule("Receipts 2019", name="a")
    b = rule("Travel", name="b")
    c = rulesmod.create_rule({"name": "c", "grouping": "sender",
                              "query": "from:x@y.example",
                              "action": "archive"})
    merge()
    assert rule_of(a["id"])["dest"] == "Receipts"
    assert rule_of(b["id"])["dest"] == "Travel"
    assert rule_of(c["id"])["action"] == "archive"


# ----------------------------------------------------- order is the safety

def test_the_undo_step_exists_before_the_rules_move_and_before_the_delete(
        box, monkeypatch):
    r = rule("Receipts 2019")
    seen = {}
    real_repoint, real_drop = rulesmod.repoint_dest, yf._drop

    def repoint(account, remap, ids=None):
        seen["undo_at_repoint"] = [e["id"] for e in acc().undo_log]
        seen["on_disk_at_repoint"] = acc().undo_dirty
        return real_repoint(account, remap, ids)

    def drop(conn, a, raw):
        seen["rule_at_drop"] = rule_of(r["id"])["dest"]
        seen["undo_at_drop"] = [e["id"] for e in acc().undo_log]
        return real_drop(conn, a, raw)

    monkeypatch.setattr(rulesmod, "repoint_dest", repoint)
    monkeypatch.setattr(yf, "_drop", drop)
    out = merge(delete_after=True, rules=[r["id"]])
    assert out["undo"]["id"] in seen["undo_at_repoint"]
    assert seen["on_disk_at_repoint"] is False        # flushed to disk first
    assert out["undo"]["id"] in seen["undo_at_drop"]
    assert seen["rule_at_drop"] == "Receipts"          # rules, then delete


def test_a_part_way_failure_keeps_the_undo_and_touches_nothing_else(
        box, monkeypatch):
    r = rule("Receipts 2019")
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 1)
    real = mailops._uid_move
    calls = []

    def flaky(conn, uidstr, dest, src="", receipt=None):
        calls.append(uidstr)
        if len(calls) == 2:
            return False                       # the server says no
        return real(conn, uidstr, dest, src, receipt)

    monkeypatch.setattr(mailops, "_uid_move", flaky)
    chk = yf.check(acc(), "merge", "Receipts 2019", "Receipts")
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Receipts 2019", "Receipts", chk["uv"],
                 chk["max_uid"], delete_after=True, rules=[r["id"]])
    assert err(e) == "moved_then_failed" and "n=1" in str(e.value)
    # the one mail that went is in the step; nothing else happened
    step = acc().undo_log[-1]
    assert step["count"] == 1 and "recreate" not in step \
        and "folder_rules" not in step
    assert rule_of(r["id"])["dest"] == "Receipts 2019"
    assert "Receipts 2019" in box.mailbox
    assert auditlog.load(acc().name)["entries"][0]["outcome"] == "partial"
    mailops.undo_last()
    assert uids(box, "Receipts 2019") == [10, 11]


def test_after_a_part_way_failure_the_index_no_longer_holds_what_moved(
        box, monkeypatch):
    """The mails that did move are not where the index says: with no scan
    able to start they leave the index at once, and the notice says to rescan."""
    def busy(*a, **k):
        raise RuntimeError("busy")
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 1)
    real = mailops._uid_move
    calls = []

    def flaky(conn, uidstr, dest, src="", receipt=None):
        calls.append(uidstr)
        if len(calls) == 2:
            return False
        return real(conn, uidstr, dest, src, receipt)

    monkeypatch.setattr(mailops, "_uid_move", flaky)
    monkeypatch.setattr(mailops, "start_scan", busy)
    chk = yf.check(acc(), "merge", "Receipts 2019", "Receipts")
    with pytest.raises(RuntimeError):
        yf.merge(acc(), "Receipts 2019", "Receipts", chk["uv"],
                 chk["max_uid"], rules=[])
    left = {m["uid"] for m in mailops.INDEX.values()
            if m["folder"] == "Receipts 2019"}
    assert left == {11}                       # uid 10 moved, 11 did not
    assert mailops.STATE["notice"]["key"] == "folder_merged_rescan"


# ---------------------------------------------------------------- refusals

def test_a_merge_needs_the_counted_uidvalidity(box):
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Receipts 2019", "Receipts", 0, 11)
    assert err(e) == "count_required"
    box.uv["Receipts 2019"] = 7                 # re-created since the count
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Receipts 2019", "Receipts", 1, 11)
    assert err(e) == "folder_changed"
    assert uids(box, "Receipts 2019") == [10, 11]


def test_a_merge_only_moves_what_the_confirm_counted(box):
    chk = yf.check(acc(), "merge", "Receipts 2019", "Receipts")
    box.mailbox["Receipts 2019"].append(         # arrives after the count
        _mails("late", 1, first=50)[0])
    out = yf.merge(acc(), "Receipts 2019", "Receipts", chk["uv"],
                   chk["max_uid"], delete_after=True)
    assert out["moved"] == 2
    # the folder is not empty: it stays, and the answer says why
    assert out["deleted"] is False and out["kept"] == "folder_not_empty"
    assert uids(box, "Receipts 2019") == [50]


def test_a_merge_refuses_other_rules_than_the_confirm_named(box):
    rule("Receipts 2019")
    chk = yf.check(acc(), "merge", "Receipts 2019", "Receipts")
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Receipts 2019", "Receipts", chk["uv"],
                 chk["max_uid"], rules=[])
    assert err(e) == "folder_rules_changed"
    assert uids(box, "Receipts 2019") == [10, 11]       # nothing moved


def test_a_folder_never_merges_into_itself_or_its_alias(box):
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Receipts", "Receipts", 1, 3)
    assert err(e) == "folder_same"
    # one folder under two names (an alias): same list on the fake server
    box.mailbox["Receipts alias"] = box.mailbox["Receipts"]
    box.uv["Receipts alias"] = 1
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Receipts", "Receipts alias", 1, 3)
    assert err(e) == "folder_same"
    assert uids(box, "Receipts") == [1, 2, 3]
    # two different folders that merely look alike are not the same
    assert not yf._same_folder(box, "Receipts", "Receipts 2019")
    # the inbox has one name whatever its case; an empty folder equals only
    # itself (a fresh folder that happens to share counts is not an alias)
    assert yf._same_folder(box, "Inbox", "INBOX")
    assert yf._same_folder(box, "Receipts", "Receipts")
    _add(box, "Fresh A")
    _add(box, "Fresh B")
    assert yf._same_folder(box, "Fresh A", "Fresh B")      # cannot be told apart
    # ... which is why a merge of empty folders moves nothing and deletes
    # nothing: the folder is refused as "the same"
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Fresh A", "Fresh B", 1, 1, delete_after=True)
    assert err(e) == "folder_same"
    assert {"Fresh A", "Fresh B"} <= set(box.mailbox)


def test_a_merge_needs_a_server_that_can_move_safely(monkeypatch):
    fake = FakeIMAP({"INBOX": _mails("I", 1), "A": _mails("A", 2, first=5),
                     "B": _mails("B", 1, first=9)},
                    move=False, uidplus=False)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "A", "B", 1, 6)
    assert err(e) == "move_unsafe"
    assert rows()["A"]["can"]["merge"] == "move_unsafe"


def test_a_merge_refuses_a_missing_folder(box):
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Nowhere", "Receipts", 1, 3)
    assert err(e) == "folder_gone"
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Receipts 2019", "Nowhere", 1, 3)
    assert err(e) == "folder_gone"


# ------------------------------------------------------------------ labels

def test_labels_are_never_merged_on_gmail(monkeypatch):
    fake = FakeIMAP({"INBOX": _mails("I", 1), "A": _mails("A", 2, first=5),
                     "B": _mails("B", 1, first=9)}, gmail=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "A", "B", 1, 6)
    assert err(e) == "folder_label"
    assert uids(fake, "A") == [5, 6] and uids(fake, "B") == [9]
    assert not any(c[0] in ("MOVE", "COPY", "STORE", "EXPUNGE")
                   for c in fake.commands)


def test_proton_labels_are_not_merged_but_folders_are(monkeypatch):
    fake = FakeIMAP({
        "INBOX": _mails("I", 1), "Folders": [], "Labels": [],
        "Folders/A": _mails("A", 2, first=5),
        "Folders/B": _mails("B", 1, first=9),
        "Labels/L1": _mails("L1", 1, first=20),
        "Labels/L2": _mails("L2", 1, first=30)})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    for src, dst in (("Labels/L1", "Labels/L2"), ("Folders/A", "Labels/L2"),
                     ("Labels/L1", "Folders/B")):
        with pytest.raises(RuntimeError) as e:
            yf.merge(acc(), src, dst, 1, 99)
        assert err(e) == "folder_label", (src, dst)
    assert yf.merge(acc(), "Folders/A", "Folders/B", 1, 6)["moved"] == 2


# ---------------------------------------------------------------- Time machine

def test_the_time_machine_does_not_call_a_deleted_merge_source_gone(box):
    from backend import timemachine
    merge(delete_after=True)
    wait_scan_done()
    entries = [acc().undo_log[-1]]
    live = timemachine._live(acc(), entries)
    assert live["missing"] == set()
