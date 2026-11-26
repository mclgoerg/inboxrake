"""Keep the mail, remove the file with several accounts: a removal acts on one
account only, its Undo step stays in that account's list (and file), and
follows the account when it is renamed."""

import json
import time

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops, removefiles, timemachine, undostore
from conftest import FakeIMAP
from rmfiles_util import FILES, KEEP, CRLF, b64, mail

SIZES = [(n, len(b64(d).rstrip(CRLF))) for n, d in FILES]


def _wait(acc, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["delete"]["status"] != "running":
                return
        time.sleep(0.02)
    raise TimeoutError("the removal did not finish")


def _two_accounts(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    fakes = {h: FakeIMAP({"INBOX": [mail(1, f"<{h}@photoarchive.example>",
                                         [*FILES, KEEP])],
                          "Trash": []}, renumber=True, copyuid=True)
             for h in ("host-one", "host-two")}
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    monkeypatch.setattr(mailops, "_rescan_after_restore",
                        lambda *a, **k: False)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    for acc in (one, two):
        mailops.run_scan(acc)
        mailops._run_atts(acc)
    return fakes, one, two


def test_a_removal_acts_on_its_account_only(monkeypatch):
    fakes, one, two = _two_accounts(monkeypatch)
    out = removefiles.start(one, [["INBOX", 1]], SIZES, 1)
    assert out["queued"] == 1
    _wait(one)
    assert len(fakes["host-one"].mailbox["Trash"]) == 1
    assert [b"X-Inboxrake-Removed" in m["raw"]
            for m in fakes["host-one"].mailbox["INBOX"]] == [True]
    # the other mailbox, its index and its steps are as they were
    assert fakes["host-two"].mailbox["Trash"] == []
    assert not any(b"X-Inboxrake-Removed" in m["raw"]
                   for m in fakes["host-two"].mailbox["INBOX"])
    assert timemachine.listing(two)["steps"] == []
    (step,) = timemachine.listing(one)["steps"]
    assert step["action"] == "remove_files" and step["mails"] == 1
    with two.lock:
        assert not any(m.get("removed") for m in two.index.values())
    # a mail id of the other account is not a mail of this one
    assert removefiles.check(two, [["INBOX", 99]], SIZES)["mails"] == []


def test_the_step_is_kept_in_the_accounts_own_file_and_follows_a_rename(
        monkeypatch):
    fakes, one, two = _two_accounts(monkeypatch)
    removefiles.start(one, [["INBOX", 1]], SIZES, 1)
    _wait(one)
    mailops.flush_undo(one)
    base = mailops.SNAPSHOT_DIR
    kept, _ = undostore.load("one", one.tenant, base)
    assert [e["action"] for e in kept] == ["remove_files"]
    assert all(c["strip"]["uid"] for c in kept[0]["copies"])
    assert undostore.load("two", two.tenant, base) == ([], [])
    mailops.rename_undo("one", "uno")
    assert undostore.load("one", one.tenant, base) == ([], [])
    moved, _ = undostore.load("uno", one.tenant, base)
    assert [e["action"] for e in moved] == ["remove_files"]
    assert moved[0]["copies"][0]["strip"] == kept[0]["copies"][0]["strip"]
