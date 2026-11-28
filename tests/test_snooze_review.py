"""Not now (IZ131), the review round: Proton Bridge (user folders only below
`Folders/`), records filed BEFORE a move (a restart in the middle strands
nothing), mail in the folder with no record is listed and can come back, a
folder is only the Snoozed folder when Inboxrake made it, a return that keeps
failing goes to the inbox and is not retried every minute, and Your folders
waits while a return runs. FakeIMAP double throughout."""

import time

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import snooze
from backend import snoozestore
from backend import yourfolders as yf
from backend.main import app

from conftest import FakeIMAP, join_scan_threads, wait_delete_done
from test_snooze import (DEALS, PAT, acc, box, mail, scan, snooze_deals,
                         subjects, the_store)

client = TestClient(app)
HOUR = 3600


def later(hours=1):
    return int(time.time()) + hours * HOUR


def far():
    return time.time() + 10 * HOUR


class BridgeFake(FakeIMAP):
    """Proton Bridge: no namespace, and a folder of your own may only be made
    below `Folders/` (anything else is refused)."""

    def create(self, qname):
        if not qname.strip('"').startswith("Folders/"):
            return "NO", [b"[CANNOT] Invalid mailbox name"]
        return super().create(qname)


@pytest.fixture
def bridge(monkeypatch):
    fake = BridgeFake({
        "INBOX": [mail(1, DEALS), mail(2, DEALS), mail(3, PAT)],
        "Folders": [], "Labels": [], "Sent": [], "Trash": [], "Spam": [],
    }, renumber=True, copyuid=True)
    fake.noselect["Folders"] = "\\Noselect"
    fake.noselect["Labels"] = "\\Noselect"
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


# ------------------------------------------------------ Proton Bridge

def test_on_proton_bridge_the_folder_is_made_below_folders(bridge):
    scan()
    snooze_deals()
    assert "Folders/Snoozed" in bridge.mailbox and "Snoozed" not in bridge.mailbox
    assert subjects(bridge, "Folders/Snoozed") == ["Subject 1", "Subject 2"]
    assert snoozestore.folder_of(acc().name) == "Folders/Snoozed"
    # no attempt at the top level that Bridge refuses
    assert [c[1] for c in bridge.commands if c[0] == "CREATE"] == [
        "Folders/Snoozed"]


def test_the_bridge_folder_is_the_role_folder_locked_and_out_of_the_scans(bridge):
    scan()
    snooze_deals()
    scan()
    assert not any(m["folder"] == "Folders/Snoozed" for m in acc().index.values())
    out = yf.overview(acc())
    assert "Folders/Snoozed" not in {r["raw"] for r in out["rows"]}
    assert any(sp["raw"] == "Folders/Snoozed" and sp["role"] == "snoozed"
               for sp in out["special"])
    for call in (lambda: yf.check(acc(), "delete", "Folders/Snoozed"),
                 lambda: yf.check(acc(), "rename", "Folders/Snoozed", name="x"),
                 lambda: yf.check(acc(), "merge", "Folders/Snoozed", "INBOX")):
        with pytest.raises(RuntimeError, match="folder_locked"):
            call()
    assert snooze.listing(acc())["folder"] == "Folders/Snoozed"


def test_a_bridge_return_goes_back_unread_and_the_folder_is_found_again(bridge):
    scan()
    snooze_deals()
    snoozestore._cache.clear()                      # a fresh process
    out = snooze.release(acc(), None, due=far())
    assert out["returned"] == 2
    assert subjects(bridge, "Folders/Snoozed") == []
    assert sorted(subjects(bridge, "INBOX")) == ["Subject 1", "Subject 2",
                                                  "Subject 3"]


# ------------------------------------- records come first, mail is never lost

def test_the_records_are_filed_before_the_mail_moves(box, monkeypatch):
    scan()
    seen = {}
    real = mailops._start_delete

    def spy(by_folder, label, acc_, *a, **k):
        seen["records"] = dict(the_store()["mails"])
        seen["inbox"] = len(subjects(box, "INBOX"))
        return real(by_folder, label, acc_, *a, **k)
    monkeypatch.setattr(mailops, "_start_delete", spy)
    snooze_deals()
    assert len(seen["records"]) == 4 and seen["inbox"] == 6
    assert all(r["pending"] for r in seen["records"].values())
    # once the move is seen to finish they are settled
    assert not any(r["pending"] for r in the_store()["mails"].values())


def test_a_restart_in_the_middle_of_a_move_strands_nothing(box, monkeypatch):
    """The process dies after the mails moved but before the job's own
    bookkeeping ran: the mail is in the folder WITH its record."""
    scan()
    monkeypatch.setattr(snooze, "_reconcile",
                        lambda acc_, ids: (lambda meta, copies: None))
    snooze_deals()
    assert len(subjects(box, "Snoozed")) == 4
    assert all(r["pending"] for r in the_store()["mails"].values())
    page = snooze.listing(acc())
    assert page["count"] == 4 and [r["kind"] for r in page["rows"]] == ["sender"]
    assert not any(r["pending"] for r in the_store()["mails"].values())
    out = snooze.release(acc(), None, due=far())
    assert out["returned"] == 4 and subjects(box, "Snoozed") == []


def test_a_restart_before_the_move_leaves_no_record_behind(box, monkeypatch):
    scan()
    real = mailops._start_delete
    monkeypatch.setattr(mailops, "_start_delete", lambda *a, **k: "j")
    snooze.snooze_groups(acc(), "sender", [DEALS], later())
    assert len(the_store()["mails"]) == 4              # (the job never runs)
    monkeypatch.setattr(mailops, "_start_delete", real)
    page = snooze.listing(acc())     # ... and the next look drops them
    assert page["no_folder"] and page["count"] == 0
    assert the_store()["mails"] == {}
    assert len(subjects(box, "INBOX")) == 6


def test_a_job_that_fails_takes_its_records_back(box, monkeypatch):
    scan()
    monkeypatch.setattr(
        snooze, "_make_folder",
        lambda *a, **k: (_ for _ in ()).throw(
            RuntimeError(mailops.coded(mailops.SNOOZE_CANNOT_CREATE,
                                       folder="Snoozed"))))
    snooze.snooze_groups(acc(), "sender", [DEALS], later())
    wait_delete_done()
    assert the_store()["mails"] == {}
    assert len(subjects(box, "INBOX")) == 6


def test_a_cancelled_queue_takes_the_records_of_jobs_that_never_ran(box, monkeypatch):
    scan()
    hooks = []
    real = snooze._reconcile
    monkeypatch.setattr(snooze, "_reconcile",
                        lambda acc_, ids: hooks.append(ids) or real(acc_, ids))
    # a job cancelled before it ran tells its hook that nothing moved
    mailops._told_moved(real(acc(), {"<m1@shop.example>"}), {}, [])
    assert the_store()["mails"] == {}


# ------------------------------------------------- unrecorded mail is listed

def test_mail_in_the_folder_with_no_record_is_listed_and_can_come_back(box):
    scan()
    snooze_deals()
    box.mailbox["Snoozed"].append(mail(90, PAT))        # no record of it
    page = snooze.listing(acc())
    lost = [r for r in page["rows"] if r["kind"] == "unrecorded"]
    assert len(lost) == 1 and lost[0]["addr"] == PAT and lost[0]["count"] == 1
    assert lost[0]["subject"] == "Subject 90" and page["count"] == 5
    r = client.post("/api/snoozed/back", json={"msgids": lost[0]["msgids"]})
    assert r.status_code == 200 and r.json()["returned"] == 1
    wait_delete_done()
    assert "Subject 90" in subjects(box, "INBOX")
    assert all(not m["seen"] for m in box.mailbox["INBOX"]
               if m["subject"] == "Subject 90")
    assert len(subjects(box, "Snoozed")) == 4
    assert the_store()["mails"]               # the recorded ones stay


def test_unrecorded_mail_without_a_message_id_is_named_by_its_uid(box):
    assert snooze._key_of({"uid": 7, "msgid": ""}) == "uid:7"
    assert snooze._key_of({"uid": 7, "msgid": "<a@x>"}) == "<a@x>"
    scan()
    snooze_deals()
    box.mailbox["Snoozed"].append(mail(91, PAT))
    out = snooze.release(acc(), ["uid:91"])      # (by its UID, whatever its id)
    assert out["returned"] == 1 and "Subject 91" in subjects(box, "INBOX")


def test_the_listing_while_a_job_runs_invents_no_unrecorded_mail(box):
    scan()
    snooze_deals()
    a = acc()
    with a.lock:
        a.state["delete"]["status"] = "running"
    try:
        assert not [r for r in snooze.listing(a)["rows"]
                    if r["kind"] == "unrecorded"]
    finally:
        with a.lock:
            a.state["delete"]["status"] = "done"


# ------------------------------------ the folder is the one Inboxrake made

def test_a_store_from_before_the_record_keeps_using_its_folder(box):
    """Records, but no remembered folder (an older store): the folder called
    Snoozed that holds the recorded mail is adopted - and remembered."""
    box.mailbox["Snoozed"] = [mail(1, DEALS)]
    box.uv["Snoozed"] = 1
    snoozestore.add_mails({"<m1@shop.example>": {
        "origin": "INBOX", "until": later(), "addr": DEALS, "name": "Deals",
        "subject": "Subject 1"}}, acc().name)
    scan()
    assert snooze.listing(acc())["count"] == 1
    assert snoozestore.folder_of(acc().name) == "Snoozed"
    scan()                         # (the next scan leaves it out)
    assert not any(m["folder"] == "Snoozed" for m in acc().index.values())


def test_a_folder_of_that_name_without_the_recorded_mail_is_not_adopted(box):
    box.mailbox["Snoozed"] = [mail(70, PAT)]
    box.uv["Snoozed"] = 1
    snoozestore.add_mails({"<m1@shop.example>": {
        "origin": "INBOX", "until": later(), "addr": DEALS, "name": "Deals",
        "subject": "Subject 1"}}, acc().name)
    scan()
    snooze.listing(acc())
    assert snoozestore.folder_of(acc().name) == ""
    assert any(m["folder"] == "Snoozed" for m in acc().index.values())


def test_the_role_cannot_be_pointed_elsewhere_in_settings():
    assert "snoozed" not in cfgmod.SPECIAL_ROLES
    with pytest.raises(ValueError):
        mailops.set_role_override("snoozed", "Anywhere", acc())


def test_while_mail_waits_a_vanished_folder_is_not_replaced(box):
    """The folder was renamed in another app: nothing new is made, nothing is
    dropped, and a new snooze is refused with the code the page explains."""
    scan()
    snooze_deals()
    box.mailbox["Renamed"] = box.mailbox.pop("Snoozed")
    box.uv["Renamed"] = box.uv.pop("Snoozed")
    r = snooze.snooze_groups(acc(), "sender", [PAT], later())
    wait_delete_done()
    assert "Snoozed" not in box.mailbox and len(box.mailbox["Renamed"]) == 4
    assert len(the_store()["mails"]) == 4           # the new job's records left
    page = snooze.listing(acc())
    assert page["no_folder"] and page["count"] == 4
    assert r["queued"] == 1 and "Subject 5" in subjects(box, "INBOX")


def test_when_nothing_waits_a_vanished_folder_is_made_again(box):
    scan()
    snooze_deals()
    snooze.release(acc(), None, due=far())
    join_scan_threads()                  # (a return starts a scan)
    del box.mailbox["Snoozed"]
    snooze.snooze_groups(acc(), "sender", [PAT], later())
    wait_delete_done()
    assert subjects(box, "Snoozed") == ["Subject 5"]
    assert snoozestore.folder_of(acc().name) == "Snoozed"


# ------------------------------------------------- a return that keeps failing

def _origin_refusing(box, monkeypatch):
    box.mailbox["Offers"] = [mail(30, DEALS)]
    box.uv["Offers"] = 1
    scan()
    snooze.snooze_items(acc(), [["Offers", 30]], int(time.time()))  # (due at once)
    wait_delete_done()
    assert subjects(box, "Snoozed") == ["Subject 30"]
    real = mailops._move_uids

    def move(by_folder, action, dest, acc_, *a, **k):
        if dest == "Offers":
            raise RuntimeError("cannot_move")
        return real(by_folder, action, dest, acc_, *a, **k)
    monkeypatch.setattr(mailops, "_move_uids", move)


def test_a_folder_that_keeps_refusing_gets_the_mail_in_the_inbox_instead(box, monkeypatch):
    _origin_refusing(box, monkeypatch)
    for tries in (1, 2):
        with pytest.raises(RuntimeError):
            snooze.release(acc(), None, due=far())
        rec = the_store()["mails"]["<m30@shop.example>"]
        assert rec["tries"] == tries and rec["origin"] == "Offers"
    with pytest.raises(RuntimeError):                  # the third failure ...
        snooze.release(acc(), None, due=far())
    assert the_store()["mails"]["<m30@shop.example>"]["origin"] == "INBOX"
    snooze.release(acc(), None, due=far())             # ... and the next works
    assert "Subject 30" in subjects(box, "INBOX")
    assert subjects(box, "Snoozed") == []


def test_a_failing_return_is_not_retried_every_minute(box, monkeypatch):
    _origin_refusing(box, monkeypatch)
    for w in snooze.tick():
        w.join(5)
    started = snooze.tick()                  # the very next minute
    assert started == []
    snooze._RETRY_AT.clear()
    assert len(snooze.tick()) == 1           # after the wait it tries again
    for w in snooze.tick():
        w.join(5)


# ---------------------------------------------------------- other fixes

def test_your_folders_waits_while_snoozed_mail_is_coming_back(box):
    scan()
    a = acc()
    assert yf._busy(a) is None
    assert a.release_lock.acquire(blocking=False)
    try:
        assert yf._busy(a) == mailops.BUSY_ACTION
    finally:
        a.release_lock.release()


def test_a_selection_of_many_groups_is_not_refused_by_a_size_limit(box):
    scan()
    r = client.post("/api/snooze", json={
        "grouping": "sender", "keys": [f"k{i}@x.example" for i in range(2000)],
        "until": later()})
    assert r.status_code == 200 and r.json()["queued"] == 0
