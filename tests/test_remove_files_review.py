"""Regression tests for the ways a removal of files could lose a mail or a file
the user kept: files cut from a mail the confirm did not list them for, a
server that merges the copy into the mail it holds, a second removal whose
"copy" is really the restored original, and copies a crash left behind."""

import io
import zipfile

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import mailops, mimecut, removefiles, removejournal
from backend.main import app
from conftest import wait_delete_done
from rmfiles_util import (CRLF, FILES, KEEP, analyse, b64, blob, body, mail,
                          server)

client = TestClient(app)
IDS = [f"<doc{i}@photoarchive.example>" for i in (1, 2, 3)]
SIZES = [(n, len(b64(d).rstrip(CRLF))) for n, d in FILES]


def _remove(files, items, lang="en"):
    r = client.post("/api/attachments/remove", json=body(
        files, items, confirm=len(items), lang=lang))
    assert r.status_code == 200, r.text
    wait_delete_done()
    return r


def _names(raw):
    return [a.name for a in mimecut.attachments(mimecut.parse(raw))]


def _notice():
    return client.get("/api/state").json()["notice"]


def _commands(fake, name):
    return [c for c in fake.commands if c[0] == name]


def _moves(fake):
    return [c for c in fake.commands if c[:2] == ("UID", "MOVE")]


def _world(monkeypatch, **kw):
    mails = [mail(i + 1, IDS[i], [*FILES, KEEP]) for i in range(3)]
    originals = {m["msgid"]: m["raw"] for m in mails}
    fake = server(monkeypatch, mails, **kw)
    analyse(client)
    return fake, originals


# ------------------------------------------------- 1: each mail its own files

def test_a_mail_is_cut_only_of_the_files_the_confirm_listed_for_it(
        monkeypatch):
    """Mail 1 has inv.pdf, mail 2 has stmt.pdf and ANOTHER inv.pdf whose size
    is a few bytes off. The user ticks inv.pdf (of mail 1) and stmt.pdf: the
    confirm lists only stmt.pdf for mail 2, and only stmt.pdf goes from it -
    its own inv.pdf (not in the zip either) stays."""
    inv1, inv2, stmt = blob(1, 6000), blob(3, 6003), blob(2, 6000)
    mails = [mail(1, IDS[0], [("inv.pdf", inv1)]),
             mail(2, IDS[1], [("stmt.pdf", stmt), ("inv.pdf", inv2)])]
    originals = [m["raw"] for m in mails]
    fake = server(monkeypatch, mails)
    analyse(client)
    sizes = {a["name"] + str(i): a["size"] for i, m in enumerate(
        client.get("/api/attachments").json()) for a in m["atts"]}
    size_inv1 = len(b64(inv1).rstrip(CRLF))
    size_inv2 = len(b64(inv2).rstrip(CRLF))
    assert abs(size_inv1 - size_inv2) <= 8 and size_inv1 != size_inv2
    asked = [("inv.pdf", size_inv1), ("stmt.pdf", len(b64(stmt).rstrip(CRLF)))]
    items = [["INBOX", 1], ["INBOX", 2]]
    chk = client.post("/api/attachments/remove/check",
                      json=body(asked, items)).json()
    assert [m["files"] for m in chk["mails"]] == [[0], [1]]
    assert chk["files"][0]["mails"] == 1
    # the archive of the same selection: mail 2 gives stmt.pdf only
    z = client.post("/api/attachments/remove/zip", json=body(asked, items))
    assert sorted(zipfile.ZipFile(io.BytesIO(z.content)).namelist()) == [
        "inv.pdf", "stmt.pdf"]
    assert zipfile.ZipFile(io.BytesIO(z.content)).read("inv.pdf") == inv1
    assert sizes                                           # (index built)
    _remove(asked, items)
    by_id = {m["msgid"]: m["raw"] for m in fake.mailbox["INBOX"]}
    assert _names(by_id[IDS[0]]) == []
    assert _names(by_id[IDS[1]]) == ["inv.pdf"]            # its own, kept
    root = mimecut.parse(by_id[IDS[1]])
    (kept,) = mimecut.attachments(root)
    assert mimecut.payload(by_id[IDS[1]], kept.part) == inv2
    assert [m["raw"] for m in fake.mailbox["Trash"]] == originals


def test_a_near_size_is_taken_only_for_the_one_file_of_that_name(monkeypatch):
    """The mail's own index says `a.pdf` once: a server that counts a byte
    more still finds it. Twice in one mail: exact sizes only."""
    data = blob(1, 6000)
    m = mail(1, IDS[0], [("a.pdf", data)])
    server(monkeypatch, [m])
    analyse(client)
    asked = [("a.pdf", len(b64(data).rstrip(CRLF)) + 2)]       # one CRLF more
    # (the index holds the exact size, so a request off by two is no file of it)
    chk = client.post("/api/attachments/remove/check",
                      json=body(asked, [["INBOX", 1]])).json()
    assert chk["mails"] == []


# ------------------------------------------------ 2: a server that merges mails

def _second_removal_world(monkeypatch, **kw):
    """Mail 1 had scan-1.pdf removed once; the lighter copy L1 (it carries our
    header) is what the second removal is about."""
    fake, originals = _world(monkeypatch, renumber=True, copyuid=True, **kw)
    _remove(SIZES[:1], [["INBOX", 1]])
    (l1,) = [m for m in fake.mailbox["INBOX"] if m["msgid"] == IDS[0]]
    assert b"X-Inboxrake-Removed" in l1["raw"]
    return fake, originals, l1


def _second(fake, l1):
    before = [(m["uid"], m["raw"]) for m in fake.mailbox["INBOX"]]
    trash = [(m["uid"], m["raw"]) for m in fake.mailbox["Trash"]]
    moves = len(_moves(fake))
    _remove(SIZES[1:], [["INBOX", l1["uid"]]])
    # the mail the user has is still there, untouched; nothing moved
    assert [(m["uid"], m["raw"]) for m in fake.mailbox["INBOX"]] == before
    assert [(m["uid"], m["raw"]) for m in fake.mailbox["Trash"]] == trash
    assert len(_moves(fake)) == moves
    assert _notice()["params"]["why"] in ("failed", "changed")


def test_a_server_that_answers_with_the_uid_of_the_mail_it_holds(monkeypatch):
    fake, _, l1 = _second_removal_world(monkeypatch)
    uv = fake.uv["INBOX"]
    fake.append = lambda q, f, d, msg: (
        "OK", [b"[APPENDUID %d %d] Append completed" % (uv, l1["uid"])])
    _second(fake, l1)


def test_a_server_that_answers_with_no_uid_and_stores_nothing(monkeypatch):
    fake, _, l1 = _second_removal_world(monkeypatch)
    fake.append = lambda q, f, d, msg: ("OK", [b"Append completed"])
    _second(fake, l1)


def test_the_same_without_uidplus(monkeypatch):
    fake, _ = _world(monkeypatch, uidplus=False)
    _remove(SIZES[:1], [["INBOX", 1]])
    (l1,) = [m for m in fake.mailbox["INBOX"] if m["msgid"] == IDS[0]]
    fake.append = lambda q, f, d, msg: ("OK", [b"Append completed"])
    _second(fake, l1)


def test_a_copy_is_never_taken_out_unless_it_is_provably_ours(monkeypatch):
    fake, _ = _world(monkeypatch)
    fake.select('"INBOX"')
    marked = mail(9, IDS[0], FILES, extra=(
        b'X-Inboxrake-Removed: v=1; date=2024-09-01; size=1; name="x"\r\n'))
    fake.mailbox["INBOX"].append(marked)
    conn = fake
    # below the UIDNEXT it was read at: not ours (it was there before)
    assert removefiles._discard(conn, "INBOX", 1, 9, 10, 1) is False
    # the original's own UID - even when the original is itself a lighter
    # copy of an earlier removal (it carries our header too)
    assert removefiles._discard(conn, "INBOX", 1, 1, 1, 1) is False
    assert removefiles._discard(conn, "INBOX", 1, 9, 5, 9) is False
    # its original is gone: it is the mail now
    assert removefiles._discard(conn, "INBOX", 1, 9, 5, 77) is False
    assert any(m["uid"] == 9 for m in fake.mailbox["INBOX"])
    # all of it holds
    assert removefiles._discard(conn, "INBOX", 1, 9, 5, 1) is True
    assert not any(m["uid"] == 9 for m in fake.mailbox["INBOX"])


def test_a_server_that_drops_the_original_while_merging_keeps_the_copy(
        monkeypatch):
    """The original is gone after the APPEND and a mail with our header is
    there: it is the only mail now - never deleted, never 'verified away'."""
    fake, originals = _world(monkeypatch, renumber=True, copyuid=True)
    real = fake.append

    def merging(q, f, d, msg):
        out = real(q, f, d, msg)
        fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                                 if m["uid"] != 1]
        return out
    fake.append = merging
    _remove(SIZES[:1], [["INBOX", 1]])
    assert [m for m in fake.mailbox["INBOX"]
            if b"X-Inboxrake-Removed" in m["raw"]]
    assert _moves(fake) == []


# ------------------------------------------- 3: the copy found after a restore

def test_a_second_removal_undone_never_trashes_the_restored_original(
        monkeypatch):
    """The 'original' of the second removal is itself a lighter copy. If the
    newest copy is gone (and its UID is stale) the search by Message-ID must
    not pick the mail the Undo has just brought back."""
    fake, _, l1 = _second_removal_world(monkeypatch)
    _remove(SIZES[1:], [["INBOX", l1["uid"]]])
    (l2,) = [m for m in fake.mailbox["INBOX"] if m["msgid"] == IDS[0]]
    assert l2["uid"] != l1["uid"]
    # the user deletes the newest copy; the folder is renumbered meanwhile
    fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                             if m["msgid"] != IDS[0]]
    fake.uv["INBOX"] = 42
    r = client.post("/api/undo", json={"index": -1})
    assert r.status_code == 200 and r.json()["restored"] == 1
    back = [m for m in fake.mailbox["INBOX"] if m["msgid"] == IDS[0]]
    assert [m["raw"] for m in back] == [l1["raw"]]         # the first copy
    assert l1["raw"] not in [m["raw"] for m in fake.mailbox["Trash"]]


def test_a_copy_is_recognised_by_the_files_it_says_it_lost(monkeypatch):
    fake, _ = _world(monkeypatch)
    fake.select('"INBOX"')
    line = (b'X-Inboxrake-Removed: v=1; date=2024-09-01; size=8108; '
            b'name="scan-1.pdf"\r\n')
    fake.mailbox["INBOX"].append(mail(20, IDS[0], [KEEP], extra=line))
    c = {"msgid": IDS[0], "folder": "INBOX"}
    s = {"uid": 999, "uv": 1, "wrote": [["scan-1.pdf", 8108]]}
    assert removefiles._find_copy(fake, c, s) == 20
    # it must have said it lost every file of this step ...
    assert removefiles._find_copy(fake, c, {
        **s, "wrote": [["scan-1.pdf", 8108], ["scan-2.pdf", 8108]]}) is None
    assert removefiles._find_copy(fake, c, {**s, "wrote": [
        ["other.pdf", 8108]]}) is None
    # ... and a step that did not note it cannot be searched at all
    assert removefiles._find_copy(fake, c, {"uid": 999, "uv": 1}) is None
    # ... and it is not one of the UIDs the restore has just brought in
    c["attempt"] = {"uv": 1, "before": [1, 2, 3]}
    assert removefiles._find_copy(fake, c, s) is None
    c["attempt"] = {"uv": 1, "before": [1, 2, 3, 20]}
    assert removefiles._find_copy(fake, c, s) == 20


# ----------------------------------------------------- 5: a crash after APPEND

def _crashed(monkeypatch, moved: bool):
    """A run that dies after the copies were made: nothing settles them."""
    fake, originals = _world(monkeypatch)
    real_finish, real_move = removefiles.finish, mailops._move_uids
    monkeypatch.setattr(removefiles, "finish", lambda *a: None)
    if not moved:
        def boom(*a, **k):
            raise RuntimeError(mailops.CANNOT_MOVE)
        monkeypatch.setattr(mailops, "_move_uids", boom)
    _remove(SIZES, [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]])
    monkeypatch.setattr(removefiles, "finish", real_finish)    # a fresh start
    monkeypatch.setattr(mailops, "_move_uids", real_move)
    return fake, originals


def _journal():
    acc = accountsmod.get()
    return removejournal.load(acc.name, acc.tenant, mailops.SNAPSHOT_DIR)


def test_copies_a_crash_left_behind_are_swept_after_a_restart(monkeypatch):
    fake, originals = _crashed(monkeypatch, moved=False)
    assert len(fake.mailbox["INBOX"]) == 6            # originals + copies
    assert len(_journal()) == 3
    # (a line of THIS process is a run in progress: a start-up sweep skips it)
    removefiles.sweep(accountsmod.get(), startup=True)
    assert len(fake.mailbox["INBOX"]) == 6 and len(_journal()) == 3
    monkeypatch.setattr(removejournal, "BOOT", "a-later-boot")
    removefiles.sweep(accountsmod.get(), startup=True)
    assert {m["msgid"]: m["raw"] for m in fake.mailbox["INBOX"]} == originals
    assert len(fake.mailbox["INBOX"]) == 3 and _journal() == []


def test_copies_of_a_run_that_did_move_are_the_mails_and_stay(monkeypatch):
    fake, originals = _crashed(monkeypatch, moved=True)
    assert len(fake.mailbox["Trash"]) == 3 and len(_journal()) == 3
    monkeypatch.setattr(removejournal, "BOOT", "a-later-boot")
    removefiles.sweep(accountsmod.get(), startup=True)
    assert [b"X-Inboxrake-Removed" in m["raw"]
            for m in fake.mailbox["INBOX"]] == [True] * 3
    assert len(fake.mailbox["INBOX"]) == 3 and _journal() == []


def test_the_next_removal_sweeps_first(monkeypatch):
    fake, originals = _crashed(monkeypatch, moved=False)
    _remove(SIZES, [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]])
    # one lighter copy per mail - not two - and the originals in Trash
    assert len(fake.mailbox["INBOX"]) == 3
    assert sorted(m["msgid"] for m in fake.mailbox["INBOX"]) == IDS
    assert [m["raw"] for m in fake.mailbox["Trash"]] == [
        originals[i] for i in IDS]
    assert _journal() == []


def test_a_finished_run_leaves_no_journal(monkeypatch):
    fake, _ = _world(monkeypatch)
    _remove(SIZES, [["INBOX", 1], ["INBOX", 2]])
    assert _journal() == []


def test_a_failed_move_clears_its_lines_once_the_copies_are_out(monkeypatch):
    fake, originals = _world(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError(mailops.CANNOT_MOVE)
    monkeypatch.setattr(mailops, "_move_uids", boom)
    _remove(SIZES, [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]])
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == list(originals.values())
    assert _journal() == []


def test_no_record_no_copy(monkeypatch):
    """If what is about to be made cannot be written down, nothing is made."""
    fake, originals = _world(monkeypatch)

    def refuse(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(removejournal, "add", refuse)
    _remove(SIZES, [["INBOX", 1]])
    assert _commands(fake, "APPEND") == []
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == list(originals.values())


def test_the_journal_follows_a_rename_and_goes_with_a_dropped_account(
        monkeypatch):
    fake, _ = _world(monkeypatch)
    acc = accountsmod.get()
    base, tenant = mailops.SNAPSHOT_DIR, acc.tenant
    jid = removejournal.add("one", tenant, base, {
        "folder": "INBOX", "uv": 1, "floor": 4, "orig": 1, "msgid": IDS[0]})
    removejournal.rename("one", "uno", tenant, base)
    assert removejournal.load("one", tenant, base) == []
    assert [e["id"] for e in removejournal.load("uno", tenant, base)] == [jid]
    assert removejournal.load("two", tenant, base) == []       # separate
    removejournal.drop("uno", tenant, base)
    assert removejournal.load("uno", tenant, base) == []
