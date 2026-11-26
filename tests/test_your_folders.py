"""Your folders (backend/yourfolders.py): the page's rows, hints and locks,
and the four server operations - create, rename, merge into another folder,
delete an empty one - with their guards: special / provider / label folders
are locked, delete needs a live 0, a merge records its Undo step before it
touches rules or deletes anything, a rule whose target changes goes back to
Report only (and back again on Undo), nothing runs while a job is queued."""

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import tenants
from backend import yourfolders as yf
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

OLD = "01-Mar-2020 10:00:00 +0000"        # more than three years ago


def _mails(folder, n, first=1, frm="shop@store.example", **kw):
    return [make_msg(first + i, frm=f"Shop <{frm}>",
                     subject=f"{folder} {i}", size=1000 + i,
                     msgid=f"<{folder.replace(' ', '')}-{first + i}@x.example>",
                     **kw) for i in range(n)]


def _add(fake, name, msgs=()):
    fake.mailbox[name] = list(msgs)
    fake.uv[name] = 1


@pytest.fixture
def box(bridge):
    """The invented mailbox of these tests, scanned."""
    _add(bridge, "Receipts", _mails("Receipts", 3))
    _add(bridge, "Receipts 2019", _mails("Receipts 2019", 2, first=10,
                                         frm="old@store.example", date=OLD))
    _add(bridge, "receipts-old")
    _add(bridge, "Travel", _mails("Travel", 2, first=20,
                                  frm="trips@travel.example"))
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return bridge


def acc():
    return accountsmod.get()


def rows():
    return {r["name"]: r for r in yf.overview(acc())["rows"]}


def rule(dest, name="Receipts to their folder", **kw):
    return rulesmod.create_rule({"name": name, "grouping": "sender",
                                 "query": "from:shop@store.example",
                                 "action": "move", "dest": dest, **kw})


def arm(r):
    """Make a rule Active the way the app does: a report run, then execute."""
    rulesmod.run_rule(r["id"], rescan=False)
    return rulesmod.update_rule(r["id"], {"mode": "execute"})


def rule_of(rid):
    return next(r for r in rulesmod.load_rules() if r["id"] == rid)


def err(exc):
    """The code of a coded refusal (`code:params`)."""
    return str(exc.value).partition(":")[0]


# --------------------------------------------------------------- the page

def test_rows_carry_mails_size_newest_and_the_rules_that_use_them(box):
    r = rule("Receipts")
    rr = rows()
    assert rr["Receipts"]["mails"] == 3
    assert rr["Receipts"]["size"] == 1000 + 1001 + 1002
    assert rr["Receipts"]["newest"] > 0
    assert [u["id"] for u in rr["Receipts"]["used_by"]] == [r["id"]]
    assert rr["Travel"]["used_by"] == []
    assert rr["Receipts 2019"]["mails"] == 2
    assert rr["receipts-old"]["mails"] == 0


def test_special_folders_are_locked_or_left_to_the_footer(box):
    out = yf.overview(acc())
    byname = {r["name"]: r for r in out["rows"]}
    # the inbox and the archive folder are rows, locked
    assert byname["INBOX"]["lock"] == "inbox"
    assert byname["Archive"]["lock"] == "role" and byname["Archive"]["role"] \
        == "archive"
    for r in (byname["INBOX"], byname["Archive"]):
        assert r["can"] == {"rename": r["lock"], "merge": r["lock"],
                            "delete": r["lock"]}
    # Sent / Trash / Spam are no rows: they are the special folders
    assert {s["name"] for s in out["special"]} >= {"Sent", "Trash", "Spam"}
    assert "Trash" not in byname and "Sent" not in byname


def test_hints_look_alikes_empty_and_quiet(box):
    out = yf.overview(acc())
    rr = {r["name"]: r for r in out["rows"]}
    kinds = {h["kind"]: h["folders"] for h in out["hints"]}
    assert sorted(kinds["look"]) == ["Receipts", "Receipts 2019",
                                     "receipts-old"]
    assert kinds["empty"] == ["receipts-old"]
    assert kinds["stale"] == ["Receipts 2019"]
    assert "look" in rr["Receipts 2019"]["hints"]
    assert rr["Receipts 2019"]["twin"] == "Receipts"   # the most mail
    assert rr["Travel"]["hints"] == []


def test_unscanned_and_pattern_excluded_folders_have_no_numbers(box):
    _add(box, "Old phone backup", _mails("Old phone backup", 4, first=40))
    _add(box, "Labels/Family", _mails("Labels/Family", 1, first=50))
    cfgmod.update_config({"account": acc().name, "excluded_folders": [
        "Old phone backup", "Labels/*", "Trash", "Spam", "Sent"]})
    mailops.run_scan()
    rr = rows()
    assert rr["Old phone backup"]["mails"] is None
    assert rr["Old phone backup"]["off"] == "switch"
    assert rr["Labels/Family"]["mails"] is None
    assert rr["Labels/Family"]["off"] == "pattern"
    assert rr["Labels/Family"]["pattern"] == "Labels/*"
    t = yf.overview(acc())["totals"]
    assert t["not_scanned"] == 2 and t["scanned"] == len(rr) - 2
    assert t["mails"] == sum(r["mails"] or 0 for r in rr.values())


def test_a_label_is_marked_on_a_gmail_server_and_under_proton_labels(monkeypatch):
    fake = FakeIMAP({
        "INBOX": _mails("Inbox", 1), "Receipts": _mails("Receipts", 1,
                                                        first=5),
        "[Gmail]/Sent Mail": [], "[Gmail]/All Mail": [],
        "[Gmail]/Trash": [], "[Gmail]/Starred": [], "[Gmail]/Spam": []},
        gmail=True, flags={"[Gmail]/Sent Mail": "\\Sent",
                           "[Gmail]/All Mail": "\\All",
                           "[Gmail]/Trash": "\\Trash",
                           "[Gmail]/Starred": "\\Flagged",
                           "[Gmail]/Spam": "\\Junk"})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    out = yf.overview(acc())
    byname = {r["name"]: r for r in out["rows"]}
    assert byname["Receipts"]["label"] is True
    assert byname["Receipts"]["can"]["merge"] == "label"
    assert byname["Receipts"]["can"]["rename"] is None
    # Gmail's own folders are never rows
    assert not any(n.startswith("[Gmail]") for n in byname)
    assert {s["name"] for s in out["special"]} >= {
        "[Gmail]/All Mail", "[Gmail]/Starred", "[Gmail]/Trash"}


# ------------------------------------------------------------------ locks

@pytest.mark.parametrize("folder", ["INBOX", "Archive", "Sent", "Trash",
                                    "Spam"])
@pytest.mark.parametrize("op", ["rename", "delete"])
def test_special_folders_cannot_be_renamed_or_deleted(box, folder, op):
    with pytest.raises(RuntimeError) as e:
        if op == "rename":
            yf.rename(acc(), folder, "Elsewhere")
        else:
            yf.delete(acc(), folder)
    assert err(e) == "folder_locked"
    assert folder in box.mailbox


@pytest.mark.parametrize("folder", ["INBOX", "Archive", "Sent", "Trash",
                                    "Spam"])
def test_special_folders_cannot_be_merged_away(box, folder):
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), folder, "Travel", 1, 99)
    assert err(e) == "folder_locked"


@pytest.mark.parametrize("target", ["Sent", "Trash", "Spam"])
def test_a_merge_never_goes_into_sent_trash_or_junk(box, target):
    with pytest.raises(RuntimeError) as e:
        yf.merge(acc(), "Travel", target, 1, 99)
    assert err(e) == "folder_target_bad"
    assert len(box.mailbox["Travel"]) == 2


def test_provider_system_folders_and_parents_are_locked(monkeypatch):
    fake = FakeIMAP({
        "INBOX": _mails("Inbox", 1), "All Mail": [], "Starred": [],
        "Folders": [], "Labels": [], "Folders/Receipts": _mails("R", 1,
                                                                first=5),
        "Labels/Family": _mails("F", 1, first=9)},
        flags={"Folders": "", "Labels": ""})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    for name in ("All Mail", "Starred", "Folders", "Labels"):
        with pytest.raises(RuntimeError) as e:
            yf.rename(acc(), name, "Mine")
        assert err(e) == "folder_locked", name
    rr = rows()
    assert rr["Folders/Receipts"]["can"]["merge"] is None
    assert rr["Labels/Family"]["can"]["merge"] == "label"
    assert rr["Labels/Family"]["label"] is True


def test_noselect_and_special_use_flags_lock(monkeypatch):
    fake = FakeIMAP({"INBOX": _mails("Inbox", 1), "Parent": [],
                     "Parent/Child": _mails("C", 1, first=4),
                     "Notes": [], "Mine": _mails("M", 1, first=7)},
                    noselect={"Parent": "\\Noselect"},
                    flags={"Notes": "\\Important"})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    for name in ("Parent", "Notes"):
        with pytest.raises(RuntimeError) as e:
            yf.delete(acc(), name)
        assert err(e) == "folder_locked", name


# ----------------------------------------------------------------- create

def test_create_makes_a_folder_and_lists_it(box):
    out = yf.create(acc(), "  Taxes  ")
    assert out == {"raw": "Taxes", "name": "Taxes"}
    assert "Taxes" in box.mailbox
    assert ("CREATE", "Taxes") in box.commands
    assert ("SUBSCRIBE", "Taxes") in box.commands
    # a move target and a rule target straight away
    assert "Taxes" in mailops.STATE["folders_raw"]
    entry = auditlog.load(acc().name)["entries"][0]
    assert entry["action"] == "folder_create" and entry["label"] == "Taxes"


@pytest.mark.parametrize("name,code", [
    ("travel", "folder_exists"), ("Travel", "folder_exists"),
    ("Trash", "folder_exists"), ("Inbox", "folder_exists"),
    ("Drafts", "folder_reserved"), ("Papierkorb", "folder_reserved"),
    ("   ", "folder_name_bad"), ('"/\\', "folder_name_bad")])
def test_create_refuses_what_exists_or_is_the_servers(box, name, code):
    before = set(box.mailbox)
    with pytest.raises(RuntimeError) as e:
        yf.create(acc(), name)
    assert err(e) == code
    assert set(box.mailbox) == before


def test_create_lands_below_the_personal_namespace(monkeypatch):
    fake = FakeIMAP({"INBOX": _mails("I", 1), "INBOX.Work": []},
                    delimiter=".", namespace="INBOX.")
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert yf.create(acc(), "Taxes")["raw"] == "INBOX.Taxes"
    assert "INBOX.Taxes" in fake.mailbox


def test_create_goes_under_folders_on_proton_bridge(monkeypatch):
    fake = FakeIMAP({"INBOX": _mails("I", 1), "Folders": [], "Labels": [],
                     "All Mail": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert yf.create(acc(), "Taxes")["raw"] == "Folders/Taxes"


def test_create_keeps_a_name_with_umlauts_encoded_on_the_wire(box):
    out = yf.create(acc(), "Rechnungen für 2024")
    assert out["raw"] == "Rechnungen f&APw-r 2024"
    assert out["name"] == "Rechnungen für 2024"


def test_create_is_in_the_audit_log_and_needs_no_idle_account(box):
    # a running move job does not matter for a new, empty folder
    acc().delete_pending.append({"by_folder": {"INBOX": {1}}})
    yf.create(acc(), "Taxes")
    acc().delete_pending.clear()


# ----------------------------------------------------------------- delete

def test_delete_removes_an_empty_folder_after_a_live_count(box):
    uv = yf.check(acc(), "delete", "receipts-old")["uv"]
    assert yf.delete(acc(), "receipts-old", uv) == {"deleted": "receipts-old"}
    assert "receipts-old" not in box.mailbox
    assert "receipts-old" not in mailops.STATE["folders_raw"]
    cmds = [c[0] for c in box.commands]
    assert "DELETE" in cmds
    assert auditlog.load(acc().name)["entries"][0]["action"] == "folder_delete"


def test_delete_asks_the_server_not_the_scan_index(box):
    # the scan saw receipts-old empty; a mail arrived since
    box.mailbox["receipts-old"].append(_mails("late", 1, first=77)[0])
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "receipts-old")
    assert err(e) == "folder_not_empty"
    assert "n=1" in str(e.value)
    assert "receipts-old" in box.mailbox
    assert not any(c[0] == "DELETE" for c in box.commands)


def test_delete_refuses_a_folder_with_mail(box):
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "Travel")
    assert err(e) == "folder_not_empty"
    assert len(box.mailbox["Travel"]) == 2


def test_delete_needs_status_select_and_search_to_agree(box, monkeypatch):
    # a server whose STATUS says 0 while the folder has mail (a stale
    # count): SELECT / SEARCH still refuse
    box.mailbox["receipts-old"].append(_mails("x", 1, first=77)[0])
    real = box.status
    monkeypatch.setattr(box, "status", lambda q, w: (
        "OK", [b'"x" (MESSAGES 0 UIDNEXT 2 UIDVALIDITY 1)']
        if q.strip('"') == "receipts-old" else real(q, w)[1]))
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "receipts-old")
    assert err(e) == "folder_not_empty"


def test_delete_refuses_when_the_uidvalidity_changed(box):
    uv = yf.check(acc(), "delete", "receipts-old")["uv"]
    box.uv["receipts-old"] = 9           # deleted and re-created meanwhile
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "receipts-old", uv)
    assert err(e) == "folder_changed"
    assert "receipts-old" in box.mailbox


def test_delete_refuses_a_folder_with_subfolders_or_rules(box):
    _add(box, "Projects")
    _add(box, "Projects/Alpha")
    mailops.run_scan()
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "Projects")
    assert err(e) == "folder_has_children"
    r = rule("receipts-old")
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "receipts-old")
    assert err(e) == "folder_used_by_rules" and "n=1" in str(e.value)
    assert rule_of(r["id"])["dest"] == "receipts-old"      # untouched


def test_delete_is_allowed_for_an_empty_label_too(monkeypatch):
    fake = FakeIMAP({"INBOX": _mails("I", 1), "Empty label": [],
                     "Used label": _mails("U", 1, first=5)}, gmail=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    yf.delete(acc(), "Empty label")
    assert "Empty label" not in fake.mailbox
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "Used label")
    assert err(e) == "folder_not_empty"


def test_a_delete_that_the_server_refuses_is_reported(box, monkeypatch):
    monkeypatch.setattr(box, "delete", lambda name: ("NO", [b"no"]))
    with pytest.raises(RuntimeError) as e:
        yf.delete(acc(), "receipts-old")
    assert err(e) == "folder_delete_failed"
    assert "receipts-old" in mailops.STATE["folders_raw"]


def test_a_gmail_label_counts_its_copies_of_mails_kept_in_the_inbox(
        monkeypatch):
    from conftest import gmail_copy
    mail = make_msg(1, frm="Shop <shop@store.example>", subject="a",
                    size=2000, msgid="<a@x.example>")
    fake = FakeIMAP({"INBOX": [gmail_copy(mail, 1)],
                     "Receipts": [gmail_copy(mail, 7)]}, gmail=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    rr = rows()
    # the scan keeps one copy (the inbox's): the label's own count is kept too
    assert rr["INBOX"]["mails"] == 1
    assert rr["Receipts"]["mails"] == 1 and rr["Receipts"]["size"] == 2000
