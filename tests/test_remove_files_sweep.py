"""The sweep of copies a crash left behind must never race a removal: after a
restart a RETRY of the same mail makes a new copy that looks exactly like a
leftover (our header, above the old UIDNEXT, original present) - deleting it
and then trashing the original would leave the mail only in Trash. The sweep
holds the mailbox (the folder lock of the account and of every name of the
same mailbox) and waits for a running job; a removal refuses to start while it
runs. A line that knows its copy's UID deletes only that UID."""

import json
import threading
import time

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops, removefiles, removejournal
from backend.main import app
from conftest import FakeIMAP, wait_delete_done
from rmfiles_util import (CRLF, FILES, KEEP, analyse, b64, body, mail, server)

client = TestClient(app)
IDS = [f"<doc{i}@photoarchive.example>" for i in (1, 2, 3)]
SIZES = [(n, len(b64(d).rstrip(CRLF))) for n, d in FILES]
MARK = (b'X-Inboxrake-Removed: v=1; date=2024-09-01; size=8108; '
        b'name="scan-1.pdf"\r\n')


def _world(monkeypatch, **kw):
    mails = [mail(i + 1, IDS[i], [*FILES, KEEP]) for i in range(3)]
    fake = server(monkeypatch, mails, **kw)
    analyse(client)
    return fake


def _old_line(acc, monkeypatch, **fields):
    """A journal line a crashed earlier run left (another boot)."""
    real = removejournal.BOOT
    monkeypatch.setattr(removejournal, "BOOT", "the-crashed-boot")
    jid = removejournal.add(acc.name, acc.tenant, mailops.SNAPSHOT_DIR, {
        "folder": "INBOX", "uv": 1, "floor": 1, "orig": 1,
        "msgid": IDS[0], **fields})
    monkeypatch.setattr(removejournal, "BOOT", real)
    return jid


def _lines(acc):
    return removejournal.load(acc.name, acc.tenant, mailops.SNAPSHOT_DIR)


def _remove(files, items):
    return client.post("/api/attachments/remove", json=body(
        files, items, confirm=len(items)))


# ------------------------------------------------------ the same account

def test_a_sweep_that_works_keeps_a_removal_from_starting(monkeypatch):
    fake = _world(monkeypatch)
    acc = accountsmod.get()
    _old_line(acc, monkeypatch)
    entered, release = threading.Event(), threading.Event()
    real = removefiles._sweep_one

    def slow(conn, e):
        entered.set()
        assert release.wait(10)
        return real(conn, e)
    monkeypatch.setattr(removefiles, "_sweep_one", slow)
    t = threading.Thread(target=removefiles.sweep_startup)
    t.start()
    assert entered.wait(10)
    # the retry of the very mail the old line is about: refused, nothing made
    r = _remove(SIZES, [["INBOX", 1]])
    assert r.status_code == 409 and r.json()["detail"] == "busy_action"
    assert [c for c in fake.commands if c[0] == "APPEND"] == []
    release.set()
    t.join(10)
    assert not t.is_alive() and _lines(acc) == []
    # and once the sweep is done the retry goes through
    assert _remove(SIZES, [["INBOX", 1]]).status_code == 200
    wait_delete_done()
    assert len(fake.mailbox["Trash"]) == 1


def test_a_sweep_waits_for_a_running_removal(monkeypatch):
    """The sweep thread comes up while the retry is between its checked copy
    and the move: it must not touch the copy (it looks like a leftover of the
    old line)."""
    fake = _world(monkeypatch)
    acc = accountsmod.get()
    seen = {}
    real_move = mailops._move_uids

    def move(by_folder, action, dest, a, *rest, **kw):
        _old_line(acc, monkeypatch)
        seen["swept"] = removefiles.sweep(acc, startup=True)
        removefiles.sweep_startup()
        return real_move(by_folder, action, dest, a, *rest, **kw)
    monkeypatch.setattr(mailops, "_move_uids", move)
    assert _remove(SIZES, [["INBOX", 1]]).status_code == 200
    wait_delete_done()
    assert seen["swept"] is False                     # busy: not now
    # the mail is in its folder, as the lighter copy; the original in Trash
    inbox = [m for m in fake.mailbox["INBOX"] if m["msgid"] == IDS[0]]
    assert len(inbox) == 1 and b"X-Inboxrake-Removed" in inbox[0]["raw"]
    assert [m["msgid"] for m in fake.mailbox["Trash"]] == [IDS[0]]
    assert [m["uid"] for m in fake.mailbox["INBOX"]] == [
        2, 3, inbox[0]["uid"]]
    # the old line waits; once the job is over it finds its original gone
    # (moved on) and settles without deleting anything
    assert len(_lines(acc)) == 1
    assert removefiles.sweep(acc, startup=True) is True
    assert _lines(acc) == []
    assert [m["msgid"] for m in fake.mailbox["INBOX"]
            if m["msgid"] == IDS[0]] == [IDS[0]]


def test_a_busy_account_is_tried_again(monkeypatch):
    _world(monkeypatch)
    acc = accountsmod.get()
    _old_line(acc, monkeypatch)
    with acc.lock:
        acc.state["status"] = "scanning"
    calls = []
    real = removefiles.sweep

    def counting(a, startup=False, in_job=False):
        calls.append(1)
        if len(calls) == 2:
            with a.lock:
                a.state["status"] = "done"
        return real(a, startup=startup, in_job=in_job)
    monkeypatch.setattr(removefiles, "sweep", counting)
    removefiles.sweep_startup(rounds=3, pause=0.01)
    assert len(calls) == 2 and _lines(acc) == []


# -------------------------------------------------- two names, one mailbox

def _twins(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "h1", "user": "me", "password": "pw"},
        "two": {"host": "h1", "user": "me", "password": "pw"}}}))
    mails = [mail(i + 1, IDS[i], [*FILES, KEEP]) for i in range(3)]
    fake = FakeIMAP({"INBOX": mails, "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda im, name=None: fake)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    for acc in (one, two):
        mailops.run_scan(acc)
        mailops._run_atts(acc)
    return fake, one, two


def _wait(acc, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["delete"]["status"] != "running":
                return
        time.sleep(0.02)
    raise TimeoutError("the removal did not finish")


def test_a_sweep_of_the_other_name_holds_the_mailbox(monkeypatch):
    fake, one, two = _twins(monkeypatch)
    _old_line(two, monkeypatch)
    entered, release = threading.Event(), threading.Event()
    real = removefiles._sweep_one

    def slow(conn, e):
        entered.set()
        assert release.wait(10)
        return real(conn, e)
    monkeypatch.setattr(removefiles, "_sweep_one", slow)
    t = threading.Thread(target=removefiles.sweep_startup)
    t.start()
    assert entered.wait(10)
    # a removal under the OTHER name of the mailbox is refused too
    out = removefiles.start(one, [["INBOX", 1]], SIZES, 1)
    assert out == {"refused": "busy_action"}
    assert [c for c in fake.commands if c[0] == "APPEND"] == []
    release.set()
    t.join(10)
    assert removefiles.start(one, [["INBOX", 1]], SIZES, 1)["queued"] == 1
    _wait(one)


def test_a_sweep_under_one_name_waits_for_a_removal_under_the_other(
        monkeypatch):
    fake, one, two = _twins(monkeypatch)
    seen = {}
    real_move = mailops._move_uids

    def move(by_folder, action, dest, a, *rest, **kw):
        _old_line(two, monkeypatch)
        seen["swept"] = removefiles.sweep(two, startup=True)
        return real_move(by_folder, action, dest, a, *rest, **kw)
    monkeypatch.setattr(mailops, "_move_uids", move)
    assert removefiles.start(one, [["INBOX", 1]], SIZES, 1)["queued"] == 1
    _wait(one)
    assert seen["swept"] is False
    inbox = [m for m in fake.mailbox["INBOX"] if m["msgid"] == IDS[0]]
    assert len(inbox) == 1 and b"X-Inboxrake-Removed" in inbox[0]["raw"]
    assert [m["msgid"] for m in fake.mailbox["Trash"]] == [IDS[0]]


# ------------------------------------------------------------ what it deletes

def _sweep_world(monkeypatch, extra):
    mails = [mail(1, IDS[0], [*FILES, KEEP])] + extra
    fake = server(monkeypatch, mails)
    mailops.run_scan()
    return fake, accountsmod.get()


def test_a_line_that_knows_its_copy_deletes_only_that_uid(monkeypatch):
    ours = mail(5, IDS[0], [KEEP], extra=MARK)
    other = mail(6, IDS[0], [KEEP], extra=MARK)    # another removal's copy
    fake, acc = _sweep_world(monkeypatch, [ours, other])
    _old_line(acc, monkeypatch, floor=3, uid=5)
    assert removefiles.sweep(acc, startup=True) is True
    assert [m["uid"] for m in fake.mailbox["INBOX"]] == [1, 6]
    assert _lines(acc) == []


def test_a_line_without_the_uid_deletes_the_marked_copies_above_its_floor(
        monkeypatch):
    below = mail(2, IDS[0], [KEEP], extra=MARK)      # it was there before
    stray = mail(5, IDS[0], [KEEP], extra=MARK)
    fake, acc = _sweep_world(monkeypatch, [below, stray])
    _old_line(acc, monkeypatch, floor=3)
    removefiles.sweep(acc, startup=True)
    assert [m["uid"] for m in fake.mailbox["INBOX"]] == [1, 2]


def test_a_stray_copy_of_a_second_removal_is_swept_too(monkeypatch):
    """The original of the second removal is itself a lighter copy (it has
    our header): it is still the original, and the stray goes."""
    first = mail(5, IDS[0], [KEEP], extra=MARK)
    stray = mail(8, IDS[0], [KEEP], extra=MARK + (
        b'X-Inboxrake-Removed: v=1; date=2024-09-02; size=8108; '
        b'name="scan-2.pdf"\r\n'))
    fake, acc = _sweep_world(monkeypatch, [first, stray])
    _old_line(acc, monkeypatch, floor=6, orig=5, uid=8)
    removefiles.sweep(acc, startup=True)
    assert [m["uid"] for m in fake.mailbox["INBOX"]] == [1, 5]
