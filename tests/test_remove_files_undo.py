"""Undo, the Time machine and Duplicates after "remove the files": the copy
and the original share a Message-ID, the X-Inboxrake-Removed header (and the
step's own record) tell them apart."""

import time

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import mailops, timemachine, undostore
from backend.main import app
from conftest import wait_delete_done, wait_scan_done
from rmfiles_util import (FILES, KEEP, CRLF, analyse, b64, body, mail,
                          server)

client = TestClient(app)
SIZES = [(n, len(b64(d).rstrip(CRLF))) for n, d in FILES]
IDS = [f"<doc{i}@photoarchive.example>" for i in (1, 2, 3)]
ITEMS = [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]]


def _world(monkeypatch, **kw):
    mails = [mail(i + 1, IDS[i], [*FILES, KEEP], seen=i == 0,
                  date=f"0{i + 1}-Sep-2024 10:00:00 +0000")
             for i in range(3)]
    originals = {m["msgid"]: m["raw"] for m in mails}
    fake = server(monkeypatch, mails, renumber=True, copyuid=True, **kw)
    analyse(client)
    return fake, originals


def _remove(items=ITEMS):
    r = client.post("/api/attachments/remove", json=body(
        SIZES, items, confirm=len(items)))
    assert r.status_code == 200, r.text
    wait_delete_done()


def _ids(fake, folder, marked=None):
    """The Message-IDs of a folder's mails (only the lighter copies / only
    the others with `marked`)."""
    return sorted(m["msgid"] for m in fake.mailbox[folder]
                  if marked is None
                  or (b"X-Inboxrake-Removed" in m["raw"]) == marked)


def _undo():
    r = client.post("/api/undo", json={"index": -1})
    wait_scan_done()
    return r


def _restore_all():
    acc = accountsmod.get()
    timemachine.start(acc, "", None, None, [])
    end = time.time() + 10
    while time.time() < end:
        with acc.lock:
            if acc.state["restore"]["status"] != "running":
                break
        time.sleep(0.01)
    wait_scan_done()


# --------------------------------------------------------------------- Undo

def test_undo_swaps_the_original_back_and_sends_the_copy_to_trash(
        monkeypatch):
    fake, originals = _world(monkeypatch)
    _remove()
    assert _ids(fake, "INBOX", marked=True) == IDS
    r = _undo()
    assert r.status_code == 200 and r.json()["restored"] == 3
    inbox, trash = fake.mailbox["INBOX"], fake.mailbox["Trash"]
    assert {m["msgid"]: m["raw"] for m in inbox} == originals   # the originals
    assert _ids(fake, "INBOX", marked=True) == []
    assert _ids(fake, "Trash", marked=True) == IDS             # the copies
    assert _ids(fake, "Trash", marked=False) == []
    assert client.get("/api/state").json()["undo"] == []


def test_undo_never_trashes_a_copy_whose_original_cannot_come_back(
        monkeypatch):
    """Trash was emptied: the lighter copy is now the only version of the
    mail, so Undo leaves it where it is."""
    fake, _ = _world(monkeypatch)
    _remove()
    fake.mailbox["Trash"] = []                     # emptied meanwhile
    r = _undo()
    assert r.status_code == 200 and r.json()["restored"] == 0
    assert _ids(fake, "INBOX", marked=True) == IDS
    assert fake.mailbox["Trash"] == []


def test_undo_with_one_original_missing_only_swaps_the_others(monkeypatch):
    fake, originals = _world(monkeypatch)
    _remove()
    fake.mailbox["Trash"] = [m for m in fake.mailbox["Trash"]
                             if m["msgid"] != IDS[1]]
    r = _undo()
    assert r.json()["restored"] == 2
    assert _ids(fake, "INBOX", marked=False) == [IDS[0], IDS[2]]
    assert _ids(fake, "INBOX", marked=True) == [IDS[1]]      # kept: only copy
    assert _ids(fake, "Trash", marked=True) == [IDS[0], IDS[2]]


def test_the_copy_is_found_by_message_id_and_header_when_its_uid_is_stale(
        monkeypatch):
    """The folder was renumbered meanwhile (a new UIDVALIDITY): the copy is
    searched by Message-ID, and the header tells it from the original that
    just came back under the same Message-ID."""
    fake, originals = _world(monkeypatch)
    _remove()
    fake.uv["INBOX"] = 9
    r = _undo()
    assert r.json()["restored"] == 3
    assert {m["msgid"]: m["raw"] for m in fake.mailbox["INBOX"]} == originals
    assert _ids(fake, "Trash", marked=True) == IDS


def test_a_copy_that_was_moved_away_stays_where_the_user_put_it(monkeypatch):
    fake, originals = _world(monkeypatch)
    _remove()
    fake.mailbox["Archive"] = [m for m in fake.mailbox["INBOX"]
                               if m["msgid"] == IDS[0]]
    fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                             if m["msgid"] != IDS[0]]
    _undo()
    assert _ids(fake, "Archive", marked=True) == [IDS[0]]
    assert [m["raw"] for m in fake.mailbox["INBOX"]
            if m["msgid"] == IDS[0]] == [originals[IDS[0]]]


def test_a_failing_swap_keeps_the_step_so_a_retry_finishes_it(monkeypatch):
    fake, originals = _world(monkeypatch)
    _remove()
    real = mailops._uid_move
    state = {"fail": True}

    def flaky(conn, uidstr, dest, src="", receipt=None):
        if state["fail"] and src == "INBOX" and dest == "Trash":
            raise RuntimeError(mailops.CANNOT_MOVE)   # trashing a copy
        return real(conn, uidstr, dest, src, receipt)
    monkeypatch.setattr(mailops, "_uid_move", flaky)
    failed = _undo()
    assert failed.status_code == 409 and failed.json()["detail"] == "cannot_move"
    # the originals are back; the step is still there for the copies
    assert {m["msgid"] for m in fake.mailbox["INBOX"]
            if b"X-Inboxrake" not in m["raw"]} == set(IDS)
    assert len(client.get("/api/state").json()["undo"]) == 1
    state["fail"] = False
    assert _undo().status_code == 200
    assert _ids(fake, "INBOX", marked=True) == []
    assert _ids(fake, "Trash", marked=True) == IDS
    assert {m["msgid"]: m["raw"] for m in fake.mailbox["INBOX"]} == originals


def test_the_step_survives_a_restart_with_its_copies(monkeypatch):
    fake, _ = _world(monkeypatch)
    _remove()
    acc = accountsmod.get()
    mailops.flush_undo(acc)
    user, _ = undostore.load(acc.name, acc.tenant, mailops.SNAPSHOT_DIR)
    (step,) = user
    assert step["action"] == "remove_files"
    assert all(c["strip"]["uid"] and c["strip"]["uv"]
               for c in step["copies"])
    with acc.lock:
        acc.undo_log.clear()
    mailops.load_undo(acc)
    assert _undo().json()["restored"] == 3
    assert _ids(fake, "Trash", marked=True) == IDS


# ------------------------------------------------------------- Time machine

def test_the_time_machine_goes_back_through_a_removal(monkeypatch):
    fake, originals = _world(monkeypatch)
    _remove()
    acc = accountsmod.get()
    steps = timemachine.listing(acc)["steps"]
    assert [s["action"] for s in steps] == ["remove_files"]
    assert steps[0]["status"] == "back" and steps[0]["mails"] == 3
    _restore_all()
    assert {m["msgid"]: m["raw"] for m in fake.mailbox["INBOX"]} == originals
    assert _ids(fake, "Trash", marked=True) == IDS


def test_undoing_a_restore_that_went_back_through_a_removal_is_refused(
        monkeypatch):
    """Undoing it would send the original back to Trash and leave the lighter
    copy there too - emptying Trash would then lose the mail. It is refused
    with a code, nothing moves, and the mail stays in its folder."""
    fake, originals = _world(monkeypatch)
    _remove()
    _restore_all()
    before = {f: [(m["uid"], m["raw"]) for m in ms]
              for f, ms in fake.mailbox.items()}
    r = _undo()
    assert r.status_code == 409 and r.json()["detail"] == "undo_through_removal"
    assert {f: [(m["uid"], m["raw"]) for m in ms]
            for f, ms in fake.mailbox.items()} == before
    assert {m["msgid"]: m["raw"] for m in fake.mailbox["INBOX"]} == originals
    assert _ids(fake, "Trash", marked=False) == []      # no original in Trash
    # Trash may be emptied: the mail is in its folder, whole
    fake.mailbox["Trash"] = []
    assert {m["msgid"]: m["raw"] for m in fake.mailbox["INBOX"]} == originals
    # (the restore step stays on its list: asking again says the same)
    assert _undo().status_code == 409


def test_the_time_machine_preview_does_not_promise_that_undo(monkeypatch):
    """A later restore would have to undo the earlier one: it says it cannot
    (untracked) instead of failing half-way."""
    fake, _ = _world(monkeypatch)
    _remove()
    _restore_all()
    acc = accountsmod.get()
    with acc.lock:
        (restore,) = [e for e in acc.undo_log if e.get("action") == "restore"]
    live = timemachine._live(acc, [restore])
    skip = mailops.undo_skipper(acc)
    res = timemachine._assess(acc, restore, live, skip, set())
    assert res["untracked"] is True and res["come"] == []
    assert res["lost"]["untracked"] == 3


# ---------------------------------------------------------------- Duplicates

def _dups(monkeypatch, same_size=True):
    plain = mail(1, IDS[0], [*FILES, KEEP])
    light = mail(2, IDS[0], [KEEP], extra=b"X-Inboxrake-Removed: v=1; "
                 b'date=2024-09-01; size=8108; name="scan-1.pdf"\r\n')
    if same_size:
        light["size"] = plain["size"]
    other = mail(3, IDS[1], [KEEP])
    twin = mail(4, IDS[1], [KEEP])
    twin["size"] = other["size"]
    fake = server(monkeypatch, [plain, light, other, twin])
    mailops.run_scan()
    return fake


def test_a_lighter_copy_is_never_an_identical_copy(monkeypatch):
    _dups(monkeypatch)
    identical = client.get("/api/duplicates").json()
    versions = client.get("/api/duplicates/versions").json()
    # the two real twins are identical; original + lighter copy are two
    # versions of one mail even though their sizes agree
    assert [{m["uid"] for m in s["mails"]} for s in identical] == [{3, 4}]
    assert [{m["uid"] for m in s["mails"]} for s in versions] == [{1, 2}]
    marked = {m["uid"]: m.get("removed", 0) for m in versions[0]["mails"]}
    assert marked == {1: 0, 2: 1}
    assert versions[0]["wasted"] == 0                 # nothing is "reclaimable"


def test_the_scan_reads_the_header_into_the_index(monkeypatch):
    _dups(monkeypatch)
    acc = accountsmod.get()
    with acc.lock:
        removed = {m["uid"]: m.get("removed") for m in acc.index.values()}
    assert removed == {1: None, 2: 1, 3: None, 4: None}
