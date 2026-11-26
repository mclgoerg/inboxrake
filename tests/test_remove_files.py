"""Keep the mail, remove the file: copy without the files, check the copy,
only then the original to Trash; Undo swaps them back."""

import email
import imaplib

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops, mimecut, pinstore, removefiles
from backend.main import app
from conftest import (FakeIMAP, make_msg, wait_delete_done, wait_scan_done)
from rmfiles_util import (FILES, KEEP, CRLF, analyse, b64, blob, body, listed,
                          mail, raw_mail, server)

client = TestClient(app)
SIZES = [(n, len(b64(d).rstrip(CRLF))) for n, d in FILES]
IDS = [f"<doc{i}@photoarchive.example>" for i in (1, 2, 3)]


def _world(monkeypatch, **kw):
    mails = [mail(i + 1, IDS[i], [*FILES, KEEP], seen=i == 0,
                  date=f"0{i + 1}-Sep-2024 10:00:00 +0000")
             for i in range(3)]
    originals = [m["raw"] for m in mails]
    fake = server(monkeypatch, mails, **kw)
    analyse(client)
    return fake, originals


ITEMS = [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]]


def _remove(files=SIZES, items=ITEMS, confirm=None, lang="en"):
    return client.post("/api/attachments/remove", json=body(
        files, items, confirm=len(items) if confirm is None else confirm,
        lang=lang))


def _msg(m):
    return email.message_from_bytes(m["raw"])


def _commands(fake, name):
    return [c for c in fake.commands if c[0] == name]


def _notice():
    return client.get("/api/state").json()["notice"]


# ------------------------------------------------------------- the happy path

def test_the_mail_stays_without_the_files_and_the_original_goes_to_trash(
        monkeypatch):
    fake, originals = _world(monkeypatch)
    chk = client.post("/api/attachments/remove/check",
                      json=body(SIZES, ITEMS)).json()
    assert chk["refused"] is None and chk["blocked"] == []
    assert [m["skip"] for m in chk["mails"]] == ["", "", ""]
    assert [f["mails"] for f in chk["files"]] == [3, 3]
    assert chk["zip"]["bytes"] == sum(s for _, s in SIZES)

    r = _remove()
    assert r.status_code == 200 and r.json()["queued"] == 3
    wait_delete_done()

    inbox, trash = fake.mailbox["INBOX"], fake.mailbox["Trash"]
    assert [m["raw"] for m in trash] == originals          # untouched bytes
    assert len(inbox) == 3
    for i, copy in enumerate(sorted(inbox, key=lambda m: m["msgid"])):
        msg = _msg(copy)
        # same mail: Message-ID, headers, date, read state
        assert msg["Message-ID"] == IDS[i] == copy["msgid"]
        assert msg["Subject"] == "Scans from the family archive"
        assert copy["date"] == f"0{i + 1}-Sep-2024 10:00:00 +0000"
        assert bool(copy["seen"]) == (i == 0)
        # only the unticked parts are replaced by a short note
        root = mimecut.parse(copy["raw"])
        assert [a.name for a in mimecut.attachments(root)] == ["keep.png"]
        orig = mimecut.parse(originals[i])
        assert mimecut.payload(copy["raw"], root.children[3]) \
            == mimecut.payload(originals[i], orig.children[3])
        assert mimecut.payload(copy["raw"], root.children[0]) \
            == mimecut.payload(originals[i], orig.children[0])
        assert [r["name"] for r in mimecut.removed_of(msg)] == [
            "scan-1.pdf", "scan-2.pdf"]
        assert b"was removed by Inboxrake" in copy["raw"].replace(
            b"=\r\n", b"")
    assert {m["uid"] for m in inbox}.isdisjoint({1, 2, 3})
    # the original only moved after its copy was in place and checked
    log = [c for c in fake.commands if c[0] in ("APPEND",)
           or (c[0] == "UID" and c[1] == "MOVE")]
    assert [c[0] if c[0] == "APPEND" else "MOVE" for c in log] == [
        "APPEND"] * 3 + ["MOVE"]


def test_the_lists_follow_without_a_rescan(monkeypatch):
    fake, _ = _world(monkeypatch)
    _remove()
    wait_delete_done()
    got = listed(client)
    assert [k[0] for k in got] == ["keep.png"]
    assert len(got[next(iter(got))]) == 3
    new_uids = {u for _, u in got[next(iter(got))]}
    assert new_uids == {m["uid"] for m in fake.mailbox["INBOX"]}
    groups = mailops.public_state()["groups"]["sender"]
    rec = groups["hello@photoarchive.example"]
    assert rec["count"] == 3
    assert rec["size"] == sum(m["size"] for m in fake.mailbox["INBOX"])
    assert rec["att_size"] == 3 * len(b64(KEEP[1]).rstrip(CRLF))
    assert rec["unread"] == 2
    # the copy is a mail of the index with the same Message-ID, marked
    acc = accountsmod.get()
    with acc.lock:
        marked = [m for m in acc.index.values() if m.get("removed")]
    assert len(marked) == 3 and {m["msgid"] for m in marked} == set(IDS)


def test_one_undo_step_activity_entry_and_the_reader(monkeypatch):
    fake, _ = _world(monkeypatch)
    _remove()
    wait_delete_done()
    st = client.get("/api/state").json()
    assert len(st["undo"]) == 1
    step = st["undo"][0]
    assert step["action"] == "remove_files" and step["count"] == 3
    assert step["label_key"] == "undo.remove_files"
    assert step["label_params"] == {"files": 2, "n": 3}   # 2 files, 3 mails
    entry = auditlog.load(accountsmod.get().name, 0, 10)["entries"][0]
    assert entry["action"] == "remove_files" and entry["count"] == 3
    assert entry["bytes"] == 3 * sum(
        len(b64(d).rstrip(CRLF)) for _, d in FILES)
    # the reader says which files were taken out
    copy = fake.mailbox["INBOX"][0]
    detail = client.get("/api/message", params={
        "folder": "INBOX", "uid": copy["uid"]}).json()
    assert [r["name"] for r in detail["removed"]] == ["scan-1.pdf",
                                                      "scan-2.pdf"]
    assert detail["removed"][0]["size"] == SIZES[0][1]


def test_only_the_ticked_files_go(monkeypatch):
    fake, originals = _world(monkeypatch)
    assert _remove(files=SIZES[:1]).status_code == 200
    wait_delete_done()
    for copy in fake.mailbox["INBOX"]:
        names = [a.name for a in mimecut.attachments(mimecut.parse(
            copy["raw"]))]
        assert names == ["scan-2.pdf", "keep.png"]
    got = listed(client)
    assert sorted(k[0] for k in got) == ["keep.png", "scan-2.pdf"]


def test_the_german_note(monkeypatch):
    fake, _ = _world(monkeypatch)
    _remove(lang="de")
    wait_delete_done()
    text = fake.mailbox["INBOX"][0]["raw"].replace(b"=\r\n", b"").decode()
    assert "von Inboxrake entfernt" in text


# --------------------------------------------------- the copy is checked first

def test_a_copy_that_differs_is_never_trusted(monkeypatch):
    """The server stores something else than what was sent: the check fails,
    the odd copy is taken out again and the original stays where it is."""
    fake, originals = _world(monkeypatch)
    real = fake.append
    fake.append = lambda q, f, d, msg: real(
        q, f, d, msg.replace(b"the scans are attached",
                             b"the scans are attacheD"))
    assert _remove().status_code == 200
    wait_delete_done()
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    assert fake.mailbox["Trash"] == []
    assert not [c for c in fake.commands if c[:2] == ("UID", "MOVE")]
    assert _notice()["key"] == "remove_files_skipped"
    assert _notice()["params"] == {"n": 3, "why": "verify_failed"}
    assert client.get("/api/state").json()["undo"] == []


def test_a_copy_with_another_message_id_or_without_the_header_is_not_trusted(
        monkeypatch):
    """The Message-ID and the X-Inboxrake-Removed header are what Undo and
    Duplicates rely on: a server that changes either gets no original
    trashed."""
    fake, originals = _world(monkeypatch)
    real = fake.append
    fake.append = lambda q, f, d, msg: real(
        q, f, d, msg.replace(b"Message-ID: <doc1@", b"Message-ID: <other@"))
    _remove(items=[["INBOX", 1]])
    wait_delete_done()
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    assert fake.mailbox["Trash"] == []
    assert _notice()["params"]["why"] == "verify_failed"
    # (nothing proves the odd copy is ours when the header is gone: it is
    # left, and so is the original)
    fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                             if m["raw"] in originals]
    fake.append = lambda q, f, d, msg: real(
        q, f, d, msg.replace(b"X-Inboxrake-Removed", b"X-Something-Else"))
    _remove(items=[["INBOX", 1]])
    wait_delete_done()
    assert originals[0] in [m["raw"] for m in fake.mailbox["INBOX"]]
    assert fake.mailbox["Trash"] == []


def test_a_server_that_says_ok_but_stores_nothing(monkeypatch):
    fake, originals = _world(monkeypatch)
    fake.append_hook = lambda *a: ("OK", [b"[APPENDUID 1 999] Append completed"])
    _remove()
    wait_delete_done()
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    assert fake.mailbox["Trash"] == []
    assert _notice()["params"]["why"] == "verify_failed"


def test_a_refused_append_leaves_the_mail_alone(monkeypatch):
    fake, originals = _world(monkeypatch)
    fake.append_hook = lambda *a: ("NO", [b"[OVERQUOTA] full"])
    _remove()
    wait_delete_done()
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    assert fake.mailbox["Trash"] == []
    assert _notice()["params"] == {"n": 3, "why": "failed"}


def test_flags_and_the_date_must_come_back(monkeypatch):
    """A server that drops the flags or the date makes a different mail: not
    accepted."""
    fake, originals = _world(monkeypatch)
    real = fake.append
    fake.append = lambda q, f, d, msg: real(q, "()", d, msg)    # flags lost
    _remove(items=[["INBOX", 1]])
    wait_delete_done()
    assert fake.mailbox["Trash"] == [] and len(fake.mailbox["INBOX"]) == 3
    fake.append = lambda q, f, d, msg: real(q, f, None, msg)    # date lost
    _remove(items=[["INBOX", 1]])
    wait_delete_done()
    assert fake.mailbox["Trash"] == [] and len(fake.mailbox["INBOX"]) == 3


def test_flags_keywords_and_the_date_are_carried_over(monkeypatch):
    mails = [mail(1, IDS[0], [*FILES, KEEP], seen=True,
                  date="05-Jun-2024 08:30:00 +0200")]
    mails[0]["flagged"] = mails[0]["answered"] = True
    mails[0]["keywords"] = ["$Forwarded", "Receipts"]
    fake = server(monkeypatch, mails)
    analyse(client)
    assert _remove(items=[["INBOX", 1]]).status_code == 200
    wait_delete_done()
    (copy,) = fake.mailbox["INBOX"]
    assert copy["date"] == "05-Jun-2024 08:30:00 +0200"
    assert copy["seen"] and copy["flagged"] and copy["answered"]
    assert set(copy["keywords"]) == {"$Forwarded", "Receipts"}


def test_without_uidplus_the_copy_is_found_by_message_id_and_header(
        monkeypatch):
    fake, _ = _world(monkeypatch, uidplus=False)
    _remove()
    wait_delete_done()
    assert len(fake.mailbox["Trash"]) == 3 and len(fake.mailbox["INBOX"]) == 3
    assert all(m.get("raw") and b"X-Inboxrake-Removed" in m["raw"]
               for m in fake.mailbox["INBOX"])


def test_a_failed_move_takes_every_copy_out_again(monkeypatch):
    fake, originals = _world(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError(mailops.CANNOT_MOVE)
    monkeypatch.setattr(mailops, "_move_uids", boom)
    _remove()
    st = wait_delete_done()
    assert st["error"] == "cannot_move"
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    assert fake.mailbox["Trash"] == []
    assert client.get("/api/state").json()["undo"] == []


def test_cancelling_takes_the_copies_made_so_far_out_again(monkeypatch):
    fake, originals = _world(monkeypatch)
    calls = []
    real = mailops.cancel_requested

    def cancel(target, acc=None):
        if target == "delete":
            calls.append(1)
            return len(calls) >= 3          # the third mail is the last straw
        return real(target, acc)
    monkeypatch.setattr(mailops, "cancel_requested", cancel)
    _remove()
    wait_delete_done()
    assert len(_commands(fake, "APPEND")) == 2
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    assert fake.mailbox["Trash"] == []


def test_a_lost_connection_midway_leaves_originals_and_no_copy(monkeypatch):
    fake, originals = _world(monkeypatch)
    real = fake.append
    n = []

    def append(q, f, d, msg):
        n.append(1)
        if len(n) == 3:
            raise imaplib.IMAP4.abort("connection lost")
        return real(q, f, d, msg)
    fake.append = append
    _remove()
    st = wait_delete_done()
    assert st["error"]                       # the job says it stopped
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    assert fake.mailbox["Trash"] == []


def test_a_half_made_copy_that_is_not_ours_is_never_deleted(monkeypatch):
    """The removal of a copy checks UID, header and Message-ID first."""
    fake, _ = _world(monkeypatch)
    conn = fake
    conn.select('"INBOX"')
    other = mail(9, IDS[0], FILES)               # same id, no header
    fake.mailbox["INBOX"].append(other)
    assert removefiles._discard(conn, "INBOX", 1, 9) is False
    assert any(m["uid"] == 9 for m in fake.mailbox["INBOX"])


def test_the_copy_is_looked_for_in_the_folder_generation_it_was_made_in(
        monkeypatch):
    """The folder was renumbered while the copy was made: UIDs of the old
    generation mean nothing, so the copy is not trusted - the original stays
    where it is."""
    fake, originals = _world(monkeypatch)
    real = fake.append

    def renumbering(q, f, d, msg):
        answer = real(q, f, d, msg)
        fake.uv["INBOX"] = 42            # the server starts a new generation
        return answer
    fake.append = renumbering
    _remove(items=[["INBOX", 1]])
    wait_delete_done()
    assert originals[0] in [m["raw"] for m in fake.mailbox["INBOX"]]
    assert fake.mailbox["Trash"] == []
    assert not [c for c in fake.commands if c[:2] == ("UID", "MOVE")]
    assert _notice()["params"] == {"n": 1, "why": "verify_failed"}


# ------------------------------------------------------------ what is skipped

def _skip_world(monkeypatch, **kw):
    mails = [mail(1, IDS[0], [*FILES, KEEP], **kw),
             mail(2, IDS[1], [*FILES, KEEP])]
    originals = [m["raw"] for m in mails]
    fake = server(monkeypatch, mails)
    analyse(client)
    return fake, originals


@pytest.mark.parametrize("top,why", [("multipart/signed", "signed"),
                                     ("multipart/encrypted", "encrypted")])
def test_signed_and_encrypted_mail_is_left_with_the_reason(monkeypatch, top,
                                                           why):
    fake, originals = _skip_world(monkeypatch, top=top)
    items = [["INBOX", 1], ["INBOX", 2]]
    chk = client.post("/api/attachments/remove/check",
                      json=body(SIZES, items)).json()
    assert [m["skip"] for m in chk["mails"]] == [why, ""]
    assert chk["files"][0]["mails"] == 1          # only the plain mail counts
    # (the job looks at the whole mail again - see the next test - and the
    # mail that may change does)
    assert _remove(items=items).status_code == 200
    wait_delete_done()
    inbox = fake.mailbox["INBOX"]
    assert inbox[0]["raw"] == originals[0]          # never touched
    assert len(_commands(fake, "APPEND")) == 1
    assert _notice()["params"] == {"n": 1, "why": why}


def test_the_job_looks_at_the_whole_mail_not_at_the_structure_it_was_told(
        monkeypatch):
    """A mail whose BODYSTRUCTURE looks plain but whose body is signed (or
    PGP armoured): nothing is appended for it."""
    plain = raw_mail("<x@photoarchive.example>", FILES)
    signed = raw_mail(IDS[0], FILES, top="multipart/signed")
    pgp = raw_mail(IDS[1], FILES, text="-----BEGIN PGP MESSAGE-----\r\nabc")
    mails = [mail(1, IDS[0], FILES, raw=signed),
             mail(2, IDS[1], FILES, raw=pgp)]
    for m in mails:
        m["bs"] = FakeIMAP._bs_of_raw(plain)
    fake = server(monkeypatch, mails)
    analyse(client)
    chk = client.post("/api/attachments/remove/check", json=body(
        SIZES, [["INBOX", 1], ["INBOX", 2]])).json()
    assert [m["skip"] for m in chk["mails"]] == ["", ""]    # not visible yet
    _remove(items=[["INBOX", 1], ["INBOX", 2]])
    wait_delete_done()
    assert _commands(fake, "APPEND") == []
    assert fake.mailbox["Trash"] == []
    assert len(_notice()["params"]) == 2 and _notice()["params"]["n"] == 2


def test_pinned_mail_stops_the_action_and_is_named(monkeypatch):
    fake, originals = _skip_world(monkeypatch)
    assert client.post("/api/pin", json={"folder": "INBOX", "uid": 2,
                                         "pinned": True}).status_code == 200
    items = [["INBOX", 1], ["INBOX", 2]]
    chk = client.post("/api/attachments/remove/check",
                      json=body(SIZES, items)).json()
    assert [(b["uid"], b["why"]) for b in chk["blocked"]] == [(2, "pinned")]
    assert chk["blocked"][0]["subject"] == "Scans from the family archive"
    r = _remove(items=items)
    assert r.status_code == 409 and r.json()["detail"] == "pinned_mails"
    wait_delete_done()
    assert _commands(fake, "APPEND") == []
    assert [m["raw"] for m in fake.mailbox["INBOX"]] == originals
    # untick (leave it out) and the rest goes
    assert _remove(items=[["INBOX", 1]]).status_code == 200


def test_protected_sender_stops_the_action_too(monkeypatch):
    fake, originals = _skip_world(monkeypatch)
    cfgmod.set_protected("hello@photoarchive.example", True)
    chk = client.post("/api/attachments/remove/check", json=body(
        SIZES, [["INBOX", 1]])).json()
    assert [b["why"] for b in chk["blocked"]] == ["protected"]
    r = _remove(items=[["INBOX", 1]])
    assert r.status_code == 409
    assert r.json()["detail"] == "protected_sender_selected"
    wait_delete_done()
    assert _commands(fake, "APPEND") == []


def test_a_mail_without_a_message_id_and_a_huge_one_are_left(monkeypatch):
    nomid = raw_mail("", FILES).replace(b"Message-ID: \r\n", b"")
    mails = [mail(1, "", FILES, raw=nomid), mail(2, IDS[1], FILES)]
    mails[0]["msgid"] = ""
    fake = server(monkeypatch, mails)
    analyse(client)
    items = [["INBOX", 1], ["INBOX", 2]]
    chk = client.post("/api/attachments/remove/check",
                      json=body(SIZES, items)).json()
    assert [m["skip"] for m in chk["mails"]] == ["no_msgid", ""]
    monkeypatch.setattr(removefiles, "MAIL_CAP", 100)
    chk = client.post("/api/attachments/remove/check",
                      json=body(SIZES, items)).json()
    assert [m["skip"] for m in chk["mails"]] == ["no_msgid", "too_big"]
    # nothing to do at all: refused with a code
    r = _remove(items=items)
    assert r.status_code == 409 and r.json()["detail"] == "rm_nothing"
    assert _commands(fake, "APPEND") == []


def test_the_job_leaves_a_mail_that_was_flagged_deleted_since_the_check(
        monkeypatch):
    fake, originals = _skip_world(monkeypatch)
    fake.mailbox["INBOX"][0]["deleted"] = True        # flagged by a client
    _remove(items=[["INBOX", 1], ["INBOX", 2]])
    wait_delete_done()
    assert len(_commands(fake, "APPEND")) == 1
    assert fake.mailbox["INBOX"][0]["raw"] == originals[0]
    assert _notice()["params"] == {"n": 1, "why": "deleted"}


def test_a_mail_flagged_deleted_or_in_a_changed_folder_is_left(monkeypatch):
    fake, originals = _skip_world(monkeypatch)
    fake.mailbox["INBOX"][0]["deleted"] = True
    chk = client.post("/api/attachments/remove/check", json=body(
        SIZES, [["INBOX", 1], ["INBOX", 2]])).json()
    assert [m["skip"] for m in chk["mails"]] == ["deleted", ""]
    fake.uv["INBOX"] = 7
    chk = client.post("/api/attachments/remove/check", json=body(
        SIZES, [["INBOX", 2]])).json()
    assert [m["skip"] for m in chk["mails"]] == ["changed"]


def test_the_confirmed_count_must_fit(monkeypatch):
    fake, _ = _skip_world(monkeypatch)
    r = _remove(items=[["INBOX", 1], ["INBOX", 2]], confirm=1)
    assert r.status_code == 409 and r.json()["detail"] == "rm_changed"
    assert _commands(fake, "APPEND") == []


def test_unknown_files_and_unscanned_accounts_are_refused_by_code(
        monkeypatch):
    server(monkeypatch, [mail(1, IDS[0], FILES)])
    r = client.post("/api/attachments/remove/check",
                    json=body(SIZES, [["INBOX", 1]]))
    assert r.status_code == 409 and r.json()["detail"] == "rm_not_scanned"
    analyse(client)
    r = _remove(files=[("nothere.pdf", 5)], items=[["INBOX", 1]])
    assert r.status_code == 409 and r.json()["detail"] == "rm_nothing"


def test_nothing_starts_while_something_else_changes_the_mailbox(monkeypatch):
    fake, _ = _skip_world(monkeypatch)
    acc = accountsmod.get()
    items = [["INBOX", 1]]
    with acc.lock:
        acc.state["delete"]["status"] = "running"
    assert _remove(items=items).json()["detail"] == "busy_action"
    with acc.lock:
        acc.state["delete"]["status"] = "idle"
        acc.state["status"] = "scanning"
    assert _remove(items=items).json()["detail"] == "rm_not_scanned"
    with acc.lock:
        acc.state["status"] = "done"
    assert acc.folder_lock.acquire(blocking=False)
    try:
        assert _remove(items=items).json()["detail"] == "busy_action"
    finally:
        acc.folder_lock.release()
    assert _commands(fake, "APPEND") == []
    assert _remove(items=items).status_code == 200


# ------------------------------------------------------------------ servers

def test_gmail_labels_that_a_copy_would_lose_stop_the_mail(monkeypatch):
    plain = mail(1, IDS[0], [*FILES, KEEP])
    plain["gmid"] = "1001"
    plain["labels"] = ["\\Inbox"]
    labelled = mail(2, IDS[1], [*FILES, KEEP])
    labelled["gmid"] = "1002"
    labelled["labels"] = ["\\Inbox", "Holiday"]
    fake = server(monkeypatch, [plain, labelled], gmail=True,
                  extra_folders={"[Gmail]/Trash": []})
    analyse(client)
    items = [["INBOX", 1], ["INBOX", 2]]
    chk = client.post("/api/attachments/remove/check",
                      json=body(SIZES, items)).json()
    assert [m["skip"] for m in chk["mails"]] == ["", "labels"]
    _remove(items=items)
    wait_delete_done()
    assert len(_commands(fake, "APPEND")) == 1
    assert _notice()["params"] == {"n": 1, "why": "labels"}
    left = [m for m in fake.mailbox["INBOX"] if m["msgid"] == IDS[1]]
    assert len(left) == 1 and left[0]["uid"] == 2     # untouched


def test_proton_label_folders_stop_a_mail_that_also_sits_in_one(monkeypatch):
    a = mail(1, IDS[0], [*FILES, KEEP])
    b = mail(2, IDS[1], [*FILES, KEEP])
    labelled = mail(30, IDS[1], [*FILES, KEEP])
    fake = server(monkeypatch, [a, b],
                  extra_folders={"Labels": [], "Labels/Work": [labelled]})
    analyse(client)
    items = [["INBOX", 1], ["INBOX", 2]]
    chk = client.post("/api/attachments/remove/check",
                      json=body(SIZES, items)).json()
    assert [m["skip"] for m in chk["mails"]] == ["", "labels"]
    _remove(items=items)
    wait_delete_done()
    assert len(_commands(fake, "APPEND")) == 1
    assert fake.mailbox["Labels/Work"] == [labelled]


def test_a_label_folder_is_never_the_home_of_a_copy(monkeypatch):
    a = mail(5, IDS[0], [*FILES, KEEP])
    fake = server(monkeypatch, [mail(1, IDS[1], FILES)],
                  extra_folders={"Labels": [], "Labels/Work": [a]})
    cfgmod.update_config({"accounts": {accountsmod.get().name: {
        **cfgmod.account_imap(accountsmod.get().name),
        "excluded_folders": []}}})
    analyse(client)
    chk = client.post("/api/attachments/remove/check", json=body(
        SIZES, [["Labels/Work", 5]])).json()
    assert [m["skip"] for m in chk["mails"]] == ["label_folder"]
    _remove(items=[["Labels/Work", 5]])
    wait_delete_done()
    assert _commands(fake, "APPEND") == []


# ------------------------------------------------------------------- Keep-safe

def test_files_in_mails_keep_safe_covers_are_marked(monkeypatch):
    inv = mail(1, IDS[0], [*FILES, KEEP], subject="Your invoice 20241005")
    news = mail(2, IDS[1], [*FILES, KEEP], subject="Our newsletter")
    server(monkeypatch, [inv, news])
    analyse(client)
    chk = client.post("/api/attachments/remove/check", json=body(
        SIZES, [["INBOX", 1], ["INBOX", 2]])).json()
    assert [m["safe"] for m in chk["mails"]] == ["invoices", ""]
    assert chk["files"][0]["safe"] == 1 and chk["files"][0]["mails"] == 2
    assert chk["files"][0]["classes"] == ["invoices"]


# ------------------------------------------------------------------------ zip

def test_the_zip_has_the_files_with_safe_names(monkeypatch):
    import io
    import zipfile
    evil = ("../../evil.pdf", blob(4, 700))
    twin = ("scan-1.pdf", blob(9, 6000))        # same name, other content
    mails = [mail(1, IDS[0], [FILES[0], evil]),
             mail(2, IDS[1], [FILES[0]]),
             mail(3, IDS[2], [twin])]
    server(monkeypatch, mails)
    analyse(client)
    sizes = {a["name"]: a["size"] for m in client.get(
        "/api/attachments").json() for a in m["atts"]}
    files = [("scan-1.pdf", SIZES[0][1]), ("../../evil.pdf", sizes[
        "../../evil.pdf"])]
    r = client.post("/api/attachments/remove/zip", json=body(
        files, [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]]))
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert "inboxrake-files.zip" in r.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        assert sorted(names) == ["_.._evil.pdf", "scan-1 (2).pdf",
                                 "scan-1.pdf"]
        assert all("/" not in n and not n.startswith(".") for n in names)
        # the same file in two mails is stored once, another file of the
        # same name is kept beside it
        assert {zf.read("scan-1.pdf"), zf.read("scan-1 (2).pdf")} == {
            FILES[0][1], twin[1]}
        assert zf.read("_.._evil.pdf") == evil[1]
    # nothing was changed in the mailbox by a download
    assert len(accountsmod.get().index) == 3


def test_a_download_that_is_too_big_is_refused_by_code(monkeypatch):
    server(monkeypatch, [mail(1, IDS[0], FILES)])
    analyse(client)
    monkeypatch.setattr(removefiles, "ZIP_CAP", 1000)
    r = client.post("/api/attachments/remove/zip", json=body(
        SIZES, [["INBOX", 1]]))
    assert r.status_code == 409
    assert r.json()["detail"].startswith("rm_zip_too_big:mb=")


def test_a_pinned_mail_may_be_downloaded_but_not_cut(monkeypatch):
    import io
    import zipfile
    server(monkeypatch, [mail(1, IDS[0], FILES)])
    analyse(client)
    client.post("/api/pin", json={"folder": "INBOX", "uid": 1,
                                  "pinned": True})
    r = client.post("/api/attachments/remove/zip", json=body(
        SIZES, [["INBOX", 1]]))
    assert r.status_code == 200
    assert len(zipfile.ZipFile(io.BytesIO(r.content)).namelist()) == 2
