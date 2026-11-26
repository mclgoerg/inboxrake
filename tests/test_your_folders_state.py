"""Your folders: what a rename carries over - the stored Undo steps of every
shape (plain, exact copies, a Time machine restore's parts, an assistant's,
what a merge may recreate / repoint) and the account's confirmed roles - and
the pure pieces (look-alike keys, the renamer)."""

import pytest

from backend import config as cfgmod
from backend import mailops
from backend import yourfolders as yf
from conftest import wait_scan_done
from test_your_folders import _add, _mails, acc, box, err, rule, rule_of  # noqa: F401


# ------------------------------------------------------------- the renamer

def test_the_renamer_maps_the_folder_and_what_is_below_it_only():
    fn = yf._mapper("/", "Projects", "Work")
    assert fn("Projects") == "Work"
    assert fn("Projects/Alpha") == "Work/Alpha"
    assert fn("Projects/Alpha/Beta") == "Work/Alpha/Beta"
    # a sibling with the same start, another folder, an empty dest are theirs
    assert fn("Projects 2019") == "Projects 2019"
    assert fn("ProjectsX/Alpha") == "ProjectsX/Alpha"
    assert fn("Other") == "Other"
    assert fn("") == ""
    # no delimiter: only the folder itself
    flat = yf._mapper("", "Projects", "Work")
    assert flat("Projects/Alpha") == "Projects/Alpha"


@pytest.mark.parametrize("a,b,same", [
    ("Receipts", "Receipts 2019", True), ("Receipts", "receipts-old", True),
    ("Receipts 2019", "receipts-old", True), ("Newsletters", "Newsletter", True),
    ("Receipts", "Travel", False), ("Taxes", "Tax", False),
    ("Bills 2020", "Bills 2021", True), ("Café", "Cafe 2019", True)])
def test_look_alike_keys(a, b, same):
    assert (yf._alike_key(a) == yf._alike_key(b)) is same


@pytest.mark.parametrize("name", ["Archive", "Archive 2019", "2019", "Old",
                                  "backup", "123"])
def test_a_name_made_only_of_noise_has_no_look_alikes(name):
    assert yf._alike_key(name) == ""


# ------------------------------------------------- stored Undo step shapes

def _entry(**over):
    return {"id": "e1", "ts": 1, "label": "x", "count": 2,
            "items": [("Old", "<a@x>"), ("Old/Sub", "<b@x>"),
                      ("Other", "<c@x>")],
            "in": "Old", **over}


def test_a_plain_step_follows_the_rename():
    fn = yf._mapper("/", "Old", "New")
    out = yf._remap_entry(_entry(), fn)
    assert out["items"] == [("New", "<a@x>"), ("New/Sub", "<b@x>"),
                            ("Other", "<c@x>")]
    assert out["in"] == "New"
    # a copy: the stored step itself is not touched
    assert _entry()["items"][0][0] == "Old"


def test_exact_copies_the_parts_of_a_restore_and_the_merge_fields_follow():
    fn = yf._mapper("/", "Old", "New")
    entry = _entry(
        copies=[{"folder": "Old", "in": "Old", "uid": 3, "uv": 1,
                 "msgid": "<a@x>"},
                {"folder": "Other", "in": "Old", "uid": 4, "uv": 1}],
        parts=[{"head": {"in": "Old", "id": "p"},
                "mails": [("Old", "<a@x>", "a@x", 10),
                          ("Other", "<c@x>", "c@x", 20)]}],
        recreate=["Old/Sub"],
        folder_rules=[{"id": "r1", "from": "Old", "to": "Other"}])
    out = yf._remap_entry(entry, fn)
    assert [c["folder"] for c in out["copies"]] == ["New", "Other"]
    assert [c["in"] for c in out["copies"]] == ["New", "New"]
    assert out["parts"][0]["head"]["in"] == "New"
    assert out["parts"][0]["mails"] == [("New", "<a@x>", "a@x", 10),
                                        ("Other", "<c@x>", "c@x", 20)]
    assert out["recreate"] == ["New/Sub"]
    assert out["folder_rules"] == [{"id": "r1", "from": "New", "to": "Other"}]


def test_both_undo_lists_and_their_summaries_follow_a_rename(box):
    mailops.delete_messages([["Receipts", 1]], "trash")
    from conftest import wait_delete_done
    wait_delete_done()
    a = acc()
    with a.lock:
        a.assistant_undo.append({**a.undo_log[-1], "id": "bot", "token": "t1",
                                 "actor": "mcp:x"})
        mailops._sync_undo(a)
    yf.rename(a, "Receipts", "Bills")
    wait_scan_done()
    assert {f for f, _ in a.undo_log[-1]["items"]} == {"Bills"}
    assert {f for f, _ in a.assistant_undo[-1]["items"]} == {"Bills"}
    # written to disk too: a restart reads the new name
    from backend import undostore
    user, bots = undostore.load(a.name, a.tenant, mailops.SNAPSHOT_DIR)
    assert {f for f, _ in user[-1]["items"]} == {"Bills"}
    assert {f for f, _ in bots[-1]["items"]} == {"Bills"}


def test_a_confirmed_role_follows_the_folder_it_names(box):
    _add(box, "Projects")
    _add(box, "Projects/Bin")
    cfgmod.update_config({"account": acc().name, "imap": {
        "role_overrides": {"trash": "Projects/Bin"}}})
    mailops.run_scan()
    yf.rename(acc(), "Projects", "Work")
    wait_scan_done()
    assert cfgmod.account_imap(acc().name)["role_overrides"] == {
        "trash": "Work/Bin"}


# ---------------------------------------------------------- the checks

def test_an_unknown_operation_and_a_missing_folder_are_refused(box):
    with pytest.raises(ValueError):
        yf.check(acc(), "shred", "Travel")
    with pytest.raises(RuntimeError) as e:
        yf.check(acc(), "rename", "Nowhere", name="X")
    assert err(e) == "folder_gone"
    with pytest.raises(RuntimeError) as e:
        yf.check(acc(), "delete", "Nowhere")
    assert err(e) == "folder_gone"


def test_check_changes_nothing(box):
    rule("Receipts 2019")
    before = (dict(box.mailbox), list(box.commands))
    yf.check(acc(), "merge", "Receipts 2019", "Receipts")
    yf.check(acc(), "rename", "Receipts 2019", name="Receipts 2020")
    yf.check(acc(), "delete", "receipts-old")
    changing = [c for c in box.commands[len(before[1]):]
                if c[0] in ("CREATE", "RENAME", "DELETE", "MOVE", "COPY",
                            "STORE", "EXPUNGE", "SUBSCRIBE")]
    assert changing == []
    assert set(box.mailbox) == set(before[0])


def test_the_overview_says_what_keeps_folders_from_changing(box):
    assert yf.overview(acc())["busy"] is None
    acc().delete_pending.append({"by_folder": {"INBOX": {1}}})
    try:
        assert yf.overview(acc())["busy"] == "busy_action"
    finally:
        acc().delete_pending.clear()
    acc().state["status"] = "scanning"
    try:
        assert yf.overview(acc())["busy"] == "busy_scan"
    finally:
        acc().state["status"] = "done"


def test_the_archive_folder_counts_the_archive_rules_as_users(box):
    r = rule("Travel")
    from backend import rules as rulesmod
    a = rulesmod.create_rule({"name": "Archive old", "grouping": "sender",
                              "query": "age:>1y", "action": "archive"})
    rr = {x["name"]: x for x in yf.overview(acc())["rows"]}
    assert [u["id"] for u in rr["Archive"]["used_by"]] == [a["id"]]
    assert [u["id"] for u in rr["Travel"]["used_by"]] == [r["id"]]
    assert rr["Receipts"]["used_by"] == []


def test_sorted_by_mails_with_unscanned_folders_last(box):
    _add(box, "Old phone backup", _mails("P", 2, first=40))
    cfgmod.update_config({"account": acc().name, "excluded_folders": [
        "Old phone backup", "Trash", "Spam", "Sent"]})
    mailops.run_scan()
    names = [r["name"] for r in yf.overview(acc())["rows"]]
    assert names[-1] == "Old phone backup"
    counts = [r["mails"] for r in yf.overview(acc())["rows"]][:-1]
    assert counts == sorted(counts, reverse=True)
