"""Not now: snooze and batch delivery (backend/snooze.py, snoozestore.py).

Snoozing moves mail into the account's own `Snoozed` folder through the
ordinary undoable move queue; it comes back to where it was, UNREAD, when it
is due; a batch holds a sender's new inbox mail until the next slot of the
user's own clock. Everything runs against the in-memory FakeIMAP double."""

import datetime
import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import snooze
from backend import snoozestore
from backend import tenants
from backend import webpush
from backend.main import app

from conftest import FakeIMAP, join_scan_threads, make_msg, wait_delete_done

client = TestClient(app)

DEALS = "deals@promo.example"
NEWS = "news@weekly.example"
PAT = "pat@people.example"
HOUR = 3600


def mail(uid, frm, **kw):
    return make_msg(uid, frm=f"<{frm}>", subject=f"Subject {uid}", **kw)


@pytest.fixture
def box(monkeypatch):
    """INBOX: four mails of the deals sender (three unread, one read), one
    of a person and one of a newsletter; Archive: one more unread deals mail.
    Moves renumber the copies and answer with COPYUID, like a real server."""
    fake = FakeIMAP({
        "INBOX": [mail(1, DEALS), mail(2, DEALS), mail(3, DEALS),
                  mail(4, DEALS, seen=True), mail(5, PAT), mail(6, NEWS)],
        "Archive": [mail(10, DEALS)],
        "Sent": [], "Trash": [],
    }, renumber=True, copyuid=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def acc():
    return accountsmod.get()


def scan():
    mailops.run_scan()
    join_scan_threads()          # (a return starts a scan of its own)
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def subjects(box, folder):
    return sorted(m["subject"] for m in box.mailbox.get(folder, []))


def later(hours=1):
    return int(time.time()) + hours * HOUR


def snooze_deals(until=None, **kw):
    r = snooze.snooze_groups(acc(), "sender", [DEALS], until or later(), **kw)
    wait_delete_done()
    return r


def the_store():
    return snoozestore.load_account(acc().name)


# ------------------------------------------------------------------- slots

def utc(*a):
    return int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp())


def test_a_daily_slot_is_18_00_on_the_users_own_clock():
    # Berlin is UTC+1 in winter: 18:00 local = 17:00 UTC
    after = utc(2027, 1, 12, 9, 0)
    assert snooze.next_slot("daily", "Europe/Berlin", after) \
        == utc(2027, 1, 12, 17, 0)
    # the same instant on a UTC clock lands at 18:00 UTC: the zone matters
    assert snooze.next_slot("daily", "UTC", after) == utc(2027, 1, 12, 18, 0)
    # past today's slot (or exactly on it): tomorrow's
    assert snooze.next_slot("daily", "Europe/Berlin", utc(2027, 1, 12, 17, 0)) \
        == utc(2027, 1, 13, 17, 0)


def test_a_weekly_slot_is_saturday_09_00_local():
    # Tuesday 2027-01-12 -> Saturday the 16th, 09:00 CET = 08:00 UTC
    assert snooze.next_slot("weekly", "Europe/Berlin", utc(2027, 1, 12, 9, 0)) \
        == utc(2027, 1, 16, 8, 0)
    # Saturday after 09:00: next week
    assert snooze.next_slot("weekly", "Europe/Berlin", utc(2027, 1, 16, 9, 0)) \
        == utc(2027, 1, 23, 8, 0)
    # Saturday before 09:00: that very morning
    assert snooze.next_slot("weekly", "Europe/Berlin", utc(2027, 1, 16, 6, 0)) \
        == utc(2027, 1, 16, 8, 0)


def test_slots_keep_their_wall_clock_hour_across_clock_changes():
    # Spring forward in Berlin on Sunday 2027-03-28: Saturday 09:00 is CET
    # (08:00 UTC) on the 27th but CEST (07:00 UTC) a week later.
    assert snooze.next_slot("weekly", "Europe/Berlin", utc(2027, 3, 27, 8, 30)) \
        == utc(2027, 4, 3, 7, 0)
    # daily: 18:00 CET (17:00 UTC) on the 27th, 18:00 CEST (16:00 UTC) after
    assert snooze.next_slot("daily", "Europe/Berlin", utc(2027, 3, 27, 17, 30)) \
        == utc(2027, 3, 28, 16, 0)
    # Fall back on Sunday 2027-10-31: Saturday 09:00 CEST = 07:00 UTC, a week
    # later CET = 08:00 UTC
    assert snooze.next_slot("weekly", "Europe/Berlin", utc(2027, 10, 30, 7, 30)) \
        == utc(2027, 11, 6, 8, 0)
    # another zone, another change day (US: Sunday 2027-03-14)
    assert snooze.next_slot("daily", "America/New_York", utc(2027, 3, 13, 23, 30)) \
        == utc(2027, 3, 14, 22, 0)


def test_an_unknown_or_missing_zone_falls_back_to_utc():
    after = utc(2027, 1, 12, 9, 0)
    assert snooze.next_slot("daily", "Mars/Base", after) == utc(2027, 1, 12, 18, 0)
    assert snooze.next_slot("daily", "", after) == utc(2027, 1, 12, 18, 0)


@pytest.mark.parametrize("bad", [None, "soon", 1.5, True, 0,
                                 int(time.time()) - 86400,
                                 int(time.time()) + 900 * 86400])
def test_a_return_time_must_be_a_near_future_instant(bad):
    with pytest.raises(ValueError, match="snooze_bad_time"):
        snooze.check_until(bad)
    assert snooze.check_until(later()) > time.time()


# ------------------------------------------------------------- the store

def test_the_store_survives_a_restart_and_the_file_is_private(tmp_path):
    snoozestore.add_mails({"<a@x>": {"origin": "INBOX", "until": 5,
                                     "addr": DEALS, "name": "Promo Deals",
                                     "subject": "Hi", "batch": ""}}, "acc")
    snoozestore.set_batch(DEALS, {"slot": "weekly", "tz": "Europe/Berlin",
                                  "label": "Promo Deals", "uv": 1,
                                  "after": 7}, "acc")
    f = tmp_path / "snoozed.json"
    assert oct(f.stat().st_mode & 0o777) == "0o600"
    assert not f.with_suffix(".tmp").exists()
    snoozestore._cache.clear()                       # a fresh process
    b = snoozestore.load_account("acc")
    assert b["mails"]["<a@x>"]["until"] == 5
    assert b["batches"][DEALS]["slot"] == "weekly"
    assert snoozestore.summary("acc") == {
        "count": 1, "until": {DEALS: 5}, "batches": {DEALS: "weekly"}}
    assert snoozestore.load_account("nobody") == {
        "mails": {}, "batches": {}, "released": []}


@pytest.mark.parametrize("content", [
    "{not json", "", "[]", "null", '{"accounts": []}',
    '{"accounts": {"acc": "nope"}}',
    '{"accounts": {"acc": {"mails": {"<a@x>": {"origin": "", "until": 5},'
    ' "<b@x>": {"origin": "INBOX", "until": "soon"},'
    ' "<c@x>": {"origin": "INBOX", "until": -1}, "": 1},'
    ' "batches": {"k": {"slot": "monthly", "tz": "UTC"},'
    ' "j": {"slot": "daily", "tz": "../etc"}}, "released": [3, ""]}}}',
    b"\xff\xfe\x00garbage"])
def test_a_damaged_file_only_forgets_what_it_cannot_read(tmp_path, content):
    (tmp_path / "snoozed.json").write_bytes(
        content if isinstance(content, bytes) else content.encode())
    snoozestore._cache.clear()
    assert snoozestore.load_account("acc") == {
        "mails": {}, "batches": {}, "released": []}
    snoozestore.add_mails({"<ok@x>": {"origin": "INBOX", "until": 9}}, "acc")
    assert list(snoozestore.load_account("acc")["mails"]) == ["<ok@x>"]


def test_the_store_is_capped_and_ignores_bad_records():
    n = snoozestore.add_mails({
        "<a@x>": {"origin": "INBOX", "until": 5},
        "<b@x>": {"origin": "", "until": 5},
        "<c@x>": {"origin": "INBOX", "until": "x"},
        "": {"origin": "INBOX", "until": 5}}, "acc")
    assert n == 1
    with pytest.raises(ValueError):
        snoozestore.set_batch("", None, "acc")
    snoozestore.drop_mails([f"<r{i}@x>" for i in range(
        snoozestore.MAX_RELEASED + 5)], "acc", returned=True)
    assert len(snoozestore.load_account("acc")["released"]) \
        == snoozestore.MAX_RELEASED


def test_accounts_are_strictly_separate_and_follow_a_rename_or_drop():
    rec = {"origin": "INBOX", "until": 5, "addr": DEALS}
    snoozestore.add_mails({"<same@x>": rec}, "one")
    assert "<same@x>" not in snoozestore.load_account("two")["mails"]
    snoozestore.drop_mails(["<same@x>"], "two")        # another account
    assert "<same@x>" in snoozestore.load_account("one")["mails"]
    snoozestore.rename_account("one", "uno")
    assert snoozestore.load_account("one")["mails"] == {}
    assert "<same@x>" in snoozestore.load_account("uno")["mails"]
    snoozestore.rename_account("ghost", "x")           # unknown: no-op
    snoozestore.drop_account("uno")
    snoozestore.drop_account("uno")                    # idempotent
    snoozestore._cache.clear()                         # persisted, too
    assert snoozestore.load_account("uno")["mails"] == {}


def test_tenants_are_separate():
    snoozestore.add_mails({"<a@x>": {"origin": "INBOX", "until": 5}},
                          "default")
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert snoozestore.load_account("default")["mails"] == {}
        snoozestore.add_mails({"<b@x>": {"origin": "INBOX", "until": 6}},
                              "default")
        assert list(snoozestore.load_account("default")["mails"]) == ["<b@x>"]
    assert list(snoozestore.load_account("default")["mails"]) == ["<a@x>"]
    assert (alice.root / "snoozed.json").is_file()


def test_account_rename_and_delete_carry_the_store_along():
    snoozestore.add_mails({"<a@x>": {"origin": "INBOX", "until": 5,
                                     "addr": DEALS}}, "default")
    cfg = cfgmod.load_config()
    r = client.post("/api/config", json={
        "accounts": cfg["accounts"],
        "rename_account": {"from": "default", "to": "private"}})
    assert r.status_code == 200, r.text
    assert snoozestore.load_account("default")["mails"] == {}
    assert "<a@x>" in snoozestore.load_account("private")["mails"]


# ----------------------------------------------------------------- snoozing

def test_a_sender_snooze_moves_the_unread_mails_to_a_new_snoozed_folder(box):
    scan()
    until = later(5)
    r = snooze_deals(until)
    assert r["queued"] == 4 and r["until"] == until
    # the three unread inbox mails and the unread archived one left; the
    # read one stays where it was
    assert subjects(box, "INBOX") == ["Subject 4", "Subject 5", "Subject 6"]
    assert subjects(box, "Archive") == []
    assert subjects(box, "Snoozed") == ["Subject 1", "Subject 10", "Subject 2",
                                        "Subject 3"]
    store = the_store()["mails"]
    assert {m: (r["origin"], r["until"], r["addr"]) for m, r in store.items()} == {
        "<m1@shop.example>": ("INBOX", until, DEALS),
        "<m2@shop.example>": ("INBOX", until, DEALS),
        "<m3@shop.example>": ("INBOX", until, DEALS),
        "<m10@shop.example>": ("Archive", until, DEALS)}
    # the snoozed mails are out of the lists and counts
    assert mailops.STATE["groups"]["sender"][DEALS]["count"] == 1
    scan()
    assert mailops.STATE["groups"]["sender"][DEALS]["count"] == 1
    assert not any(m["folder"] == "Snoozed" for m in acc().index.values())
    # the state says what waits
    assert mailops.public_state()["snoozed"] == {
        "count": 4, "until": {DEALS: until}, "batches": {}}
    assert mailops.public_status()["snoozed"]["count"] == 4


def test_snoozing_is_an_audited_undoable_move(box):
    scan()
    snooze_deals()
    entry = acc().undo_log[-1]
    assert entry["action"] == "snooze" and entry["count"] == 4
    logged = auditlog.since(acc().name, 0)[-1]
    assert (logged["action"], logged["actor"], logged["count"],
            logged["outcome"]) == ("snooze", "user", 4, "ok")
    mailops.undo_last(acc=acc())
    # Undo puts every mail back where it was
    assert subjects(box, "INBOX") == ["Subject 1", "Subject 2", "Subject 3",
                                      "Subject 4", "Subject 5", "Subject 6"]
    assert subjects(box, "Archive") == ["Subject 10"]
    assert subjects(box, "Snoozed") == []
    # ... and the store forgets them the next time it looks (they must not
    # be returned a second time, nor re-caught by a batch)
    assert snooze.listing(acc())["count"] == 0
    assert set(the_store()["released"]) >= {"<m1@shop.example>"}


def test_the_snoozed_folder_is_created_once(box):
    scan()
    snooze_deals()
    box.mailbox["INBOX"].append(mail(7, DEALS))
    scan()
    snooze_deals()
    assert [c for c in box.commands if c[0] == "CREATE"] \
        == [("CREATE", "Snoozed")]


def test_an_existing_snoozed_folder_is_used_not_created(box):
    box.mailbox["Snoozed"] = []
    box.uv["Snoozed"] = 1
    scan()
    snooze_deals()
    assert not [c for c in box.commands if c[0] == "CREATE"]
    assert len(box.mailbox["Snoozed"]) == 4


def test_the_folder_goes_under_the_servers_personal_namespace(monkeypatch):
    fake = FakeIMAP({"INBOX": [mail(1, DEALS)], "INBOX.Sent": [],
                     "INBOX.Trash": []}, delimiter=".", namespace="INBOX.",
                    renumber=True, copyuid=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    scan()
    snooze_deals()
    assert "INBOX.Snoozed" in fake.mailbox and "Snoozed" not in fake.mailbox
    assert len(fake.mailbox["INBOX.Snoozed"]) == 1
    # and it is the role folder now: never scanned as cleanup mail
    scan()
    assert not any(m["folder"] == "INBOX.Snoozed" for m in acc().index.values())


def test_gmails_own_snoozed_view_is_not_used(monkeypatch):
    fake = FakeIMAP({"INBOX": [mail(1, DEALS)], "[Gmail]": [],
                     "[Gmail]/Snoozed": [], "[Gmail]/Trash": []},
                    renumber=True, copyuid=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    scan()
    snooze_deals()
    assert len(fake.mailbox["Snoozed"]) == 1 and fake.mailbox["[Gmail]/Snoozed"] == []


def test_a_refused_folder_creation_names_the_folder_and_moves_nothing(box):
    box.create = lambda name: ("NO", [b"[CANNOT] nope"])
    scan()
    snooze_deals()
    assert len(box.mailbox["INBOX"]) == 6
    assert "snooze_cannot_create:folder=Snoozed" in mailops.STATE["delete"]["error"]
    assert the_store()["mails"] == {}


def test_pinned_mails_are_never_snoozed(box):
    scan()
    pinstore.set_pinned("<m2@shop.example>", True, acc().name)
    r = snooze_deals()
    assert r["queued"] == 3 and r["skipped_pinned"] == 1
    assert "Subject 2" in subjects(box, "INBOX")
    assert "<m2@shop.example>" not in the_store()["mails"]
    # a pinned mail named by hand is skipped too
    r = snooze.snooze_items(acc(), [["INBOX", 2]], later())
    assert r["queued"] == 0 and r["skipped_pinned"] == 1


def test_protected_senders_are_skipped_in_a_group_or_selection(box):
    cfgmod.update_config({"protected": [DEALS]})
    scan()
    r = snooze_deals()
    assert r["queued"] == 0 and r["skipped_protected"] == 4
    assert len(box.mailbox["INBOX"]) == 6
    r = snooze.snooze_items(acc(), [["INBOX", 1], ["INBOX", 2]], later())
    assert r["queued"] == 0 and r["skipped_protected"] == 2
    # one mail named by hand is the person's own choice
    r = snooze.snooze_items(acc(), [["INBOX", 1]], later())
    wait_delete_done()
    assert r["queued"] == 1
    assert "Subject 1" in subjects(box, "Snoozed")


def test_mails_without_a_message_id_are_skipped(box):
    box.mailbox["INBOX"].append(make_msg(8, frm=f"<{DEALS}>", msgid="",
                                         subject="No id"))
    scan()
    acc().index["INBOX\x008"]["msgid"] = ""
    r = snooze_deals()
    assert r["skipped_no_id"] == 1 and r["queued"] == 4


def test_all_mails_and_selected_mails_can_be_snoozed(box):
    scan()
    r = snooze_deals(unread_only=False)
    assert r["queued"] == 5                 # the read one too
    r = snooze.snooze_items(acc(), [["INBOX", 5], ["INBOX", 6], ["x", 99],
                                    "junk"], later(2))
    wait_delete_done()
    assert r["queued"] == 2
    assert len(the_store()["mails"]) == 7


def test_nothing_is_queued_before_a_scan_or_for_unknown_groups(box):
    with pytest.raises(RuntimeError, match="completed scan"):
        snooze.snooze_groups(acc(), "sender", [DEALS], later())
    scan()
    r = snooze.snooze_groups(acc(), "sender", ["nobody@x.example"], later())
    assert r["queued"] == 0


# ----------------------------------------------------------------- returning

def test_a_due_mail_returns_to_where_it_was_unread(box):
    scan()
    snooze_deals()
    # somebody read the snoozed mails meanwhile (another client)
    for m in box.mailbox["Snoozed"]:
        m["seen"] = True
    out = snooze.release_due(acc(), time.time() + 6 * HOUR)
    assert out["returned"] == 4 and out["gone"] == 0
    assert subjects(box, "Archive") == ["Subject 10"]
    assert subjects(box, "INBOX") == ["Subject 1", "Subject 2", "Subject 3",
                                      "Subject 4", "Subject 5", "Subject 6"]
    back = {m["subject"]: m for m in box.mailbox["INBOX"] + box.mailbox["Archive"]}
    assert not any(back[f"Subject {n}"]["seen"] for n in (1, 2, 3, 10))
    assert back["Subject 4"]["seen"]                  # untouched
    assert box.mailbox["Snoozed"] == []
    assert the_store()["mails"] == {}
    logged = auditlog.since(acc().name, 0)[-1]
    assert (logged["action"], logged["actor"], logged["count"]) \
        == ("snooze_return", "snooze", 4)


def test_only_what_is_due_returns(box):
    scan()
    snooze_deals(later(1))
    snooze.snooze_items(acc(), [["INBOX", 5]], later(48))
    wait_delete_done()
    out = snooze.release_due(acc(), time.time() + 2 * HOUR)
    assert out["returned"] == 4
    assert subjects(box, "Snoozed") == ["Subject 5"]
    assert list(the_store()["mails"]) == ["<m5@shop.example>"]


def test_a_mail_returns_to_its_origin_folder_not_the_inbox(box):
    scan()
    snooze.snooze_items(acc(), [["Archive", 10]], later())
    wait_delete_done()
    assert subjects(box, "Archive") == []
    snooze.release(acc(), {"<m10@shop.example>"})
    assert subjects(box, "Archive") == ["Subject 10"]
    assert "Subject 10" not in subjects(box, "INBOX")


def test_a_mail_whose_folder_is_gone_returns_to_the_inbox(box):
    scan()
    snooze.snooze_items(acc(), [["Archive", 10]], later())
    wait_delete_done()
    del box.mailbox["Archive"]
    snooze.release(acc(), {"<m10@shop.example>"})
    assert "Subject 10" in subjects(box, "INBOX")


def test_back_now_returns_the_named_mails_and_scans(box):
    scan()
    snooze_deals()
    out = snooze.release(acc(), {"<m1@shop.example>", "<m2@shop.example>"})
    assert out["returned"] == 2
    assert len(the_store()["mails"]) == 2
    assert subjects(box, "Snoozed") == ["Subject 10", "Subject 3"]
    join_scan_threads()
    logged = auditlog.since(acc().name, 0)[-1]
    assert logged["action"] == "snooze_return" and logged["actor"] == "user"


def test_mails_another_client_moved_away_are_dropped_not_trusted(box):
    scan()
    snooze_deals()
    box.mailbox["Snoozed"] = [m for m in box.mailbox["Snoozed"]
                              if m["subject"] != "Subject 1"]
    out = snooze.release(acc(), {"<m1@shop.example>", "<m2@shop.example>"})
    assert out == {"returned": 1, "gone": 1, "batches": {}}
    assert "<m1@shop.example>" not in the_store()["mails"]
    # remembered as returned: a batch will not catch it again
    assert "<m1@shop.example>" in the_store()["released"]


def test_the_listing_drops_vanished_mails(box):
    scan()
    snooze_deals()
    box.mailbox["Snoozed"] = box.mailbox["Snoozed"][:1]
    listed = snooze.listing(acc())
    assert listed["count"] == 1 and not listed["stale"]


def test_the_listing_shows_the_store_when_the_server_is_unreachable(box,
                                                                    monkeypatch):
    scan()
    snooze_deals()

    def down(cfg, name=None):
        raise OSError("down")
    monkeypatch.setattr(mailops, "connect", down)
    listed = snooze.listing(acc())
    assert listed["stale"] and listed["count"] == 4


def test_a_missing_snoozed_folder_forgets_the_store(box):
    snoozestore.add_mails({"<m1@shop.example>": {
        "origin": "INBOX", "until": 5, "addr": DEALS}}, acc().name)
    out = snooze.release(acc(), {"<m1@shop.example>"})
    assert out["gone"] == 1 and the_store()["mails"] == {}


def test_nothing_returns_while_a_move_job_runs(box):
    scan()
    snooze_deals()
    with acc().lock:
        acc().state["delete"]["status"] = "running"
    with pytest.raises(RuntimeError, match="busy_action"):
        snooze.release(acc(), {"<m1@shop.example>"})
    with acc().lock:
        acc().state["delete"]["status"] = "idle"
    assert len(box.mailbox["Snoozed"]) == 4


def test_the_scheduler_tick_returns_due_mail_and_does_not_connect_otherwise(
        box, monkeypatch):
    scan()
    snooze_deals(later(1))
    box.commands.clear()
    snooze.tick()
    assert box.commands == []                     # nothing due: no traffic
    snoozestore.add_mails({m: {**r, "until": int(time.time()) - 5}
                           for m, r in the_store()["mails"].items()},
                          acc().name)
    snooze.tick()
    assert len(box.mailbox["Snoozed"]) == 0
    assert len(box.mailbox["INBOX"]) + len(box.mailbox["Archive"]) == 7


def test_the_autoscan_thread_runs_the_tick(box, monkeypatch):
    from backend import autoscan
    calls = []
    monkeypatch.setattr(snooze, "tick", lambda: calls.append(1))
    autoscan._tick()
    assert calls == [1]


def test_every_scan_catches_up_with_what_is_due(box):
    scan()
    snooze_deals(later(1))
    snoozestore.add_mails({m: {**r, "until": int(time.time()) - 5}
                           for m, r in the_store()["mails"].items()},
                          acc().name)
    scan()                                       # after_scan returns them
    assert box.mailbox["Snoozed"] == []
    assert the_store()["mails"] == {}


# ------------------------------------------------------------------ batches

def set_batch(slot="weekly", tz="Europe/Berlin", key=DEALS):
    return snooze.set_batch(acc(), key, slot, tz, "Promo Deals")


def test_a_batch_holds_only_new_inbox_mail_of_that_sender(box):
    scan()
    r = set_batch()
    assert r["slot"] == "weekly"
    # nothing existing is held
    scan()
    wait_delete_done()
    assert len(box.mailbox["INBOX"]) == 6
    # new mail: the sender's (held), another sender's (not), the same
    # sender in another folder (never touched)
    box.mailbox["INBOX"] += [mail(21, DEALS), mail(22, DEALS), mail(23, PAT)]
    box.mailbox["Archive"].append(mail(24, DEALS))
    scan()
    wait_delete_done()
    assert subjects(box, "Snoozed") == ["Subject 21", "Subject 22"]
    assert "Subject 23" in subjects(box, "INBOX")
    assert "Subject 24" in subjects(box, "Archive")
    held = the_store()["mails"]
    assert {r["batch"] for r in held.values()} == {DEALS}
    until = {r["until"] for r in held.values()}
    assert until == {snooze.next_slot("weekly", "Europe/Berlin", time.time())}
    # a batch's step is quiet (no toast), audited as an automatic one
    assert acc().undo_log[-1]["quiet"] is True
    assert auditlog.since(acc().name, 0)[-1]["actor"] == "snooze"


def test_a_batch_skips_pinned_and_protected_mail(box):
    scan()
    set_batch()
    box.mailbox["INBOX"] += [mail(21, DEALS), mail(22, DEALS)]
    pinstore.set_pinned("<m22@shop.example>", True, acc().name)
    scan()
    wait_delete_done()
    assert subjects(box, "Snoozed") == ["Subject 21"]
    assert "Subject 22" in subjects(box, "INBOX")
    # a sender who is protected later is never held
    cfgmod.update_config({"protected": [DEALS]})
    box.mailbox["INBOX"].append(mail(23, DEALS))
    scan()
    wait_delete_done()
    assert "Subject 23" in subjects(box, "INBOX")
    # and one that is protected cannot be given a batch at all
    with pytest.raises(ValueError, match="snooze_protected"):
        set_batch()


def test_a_batch_arrives_together_at_its_slot_with_one_push(box, monkeypatch):
    pushes = []
    monkeypatch.setattr(webpush, "job_finished",
                        lambda a, kind, ok, **p: pushes.append((kind, p)))
    scan()
    set_batch()
    box.mailbox["INBOX"] += [mail(21, DEALS), mail(22, DEALS), mail(23, DEALS)]
    scan()
    wait_delete_done()
    assert len(box.mailbox["Snoozed"]) == 3
    slot = the_store()["mails"]["<m21@shop.example>"]["until"]
    # before the slot: nothing returns
    assert snooze.release_due(acc(), slot - 60)["returned"] == 0
    assert pushes == []
    out = snooze.release_due(acc(), slot + 60)
    assert out["returned"] == 3 and out["batches"] == {DEALS: 3}
    assert pushes == [("batch", {"n": 3, "label": "Promo Deals"})]
    assert {"Subject 21", "Subject 22", "Subject 23"} <= set(
        subjects(box, "INBOX"))
    assert not any(m["seen"] for m in box.mailbox["INBOX"]
                   if m["subject"] in ("Subject 21", "Subject 22"))
    # the delivery is not caught again by the batch that delivered it
    scan()
    wait_delete_done()
    assert box.mailbox["Snoozed"] == []


def test_back_now_and_a_batch_off_do_not_push(box, monkeypatch):
    pushes = []
    monkeypatch.setattr(webpush, "job_finished",
                        lambda a, kind, ok, **p: pushes.append(kind))
    scan()
    set_batch()
    box.mailbox["INBOX"] += [mail(21, DEALS), mail(22, DEALS)]
    scan()
    wait_delete_done()
    out = snooze.release(acc(), {"<m21@shop.example>"})
    assert out["returned"] == 1
    r = snooze.set_batch(acc(), DEALS, "off", "")
    assert r["slot"] == "off" and r["returned"] == 1
    assert pushes == []
    assert box.mailbox["Snoozed"] == []
    assert the_store()["batches"] == {}
    # off: new mail stays where it arrives
    box.mailbox["INBOX"].append(mail(23, DEALS))
    scan()
    wait_delete_done()
    assert "Subject 23" in subjects(box, "INBOX")


def test_changing_the_slot_retimes_what_is_held(box):
    scan()
    set_batch("weekly")
    box.mailbox["INBOX"].append(mail(21, DEALS))
    scan()
    wait_delete_done()
    weekly = the_store()["mails"]["<m21@shop.example>"]["until"]
    r = set_batch("daily")
    assert the_store()["mails"]["<m21@shop.example>"]["until"] == r["next"]
    assert r["next"] <= weekly
    assert the_store()["batches"][DEALS]["slot"] == "daily"


def test_a_new_uidvalidity_restarts_the_batch_baseline(box):
    scan()
    set_batch()
    box.uv["INBOX"] = 9
    box.mailbox["INBOX"].append(mail(21, DEALS))
    scan()
    wait_delete_done()
    assert "Subject 21" in subjects(box, "INBOX")          # not "new": a reset
    assert the_store()["batches"][DEALS]["uv"] == 9
    box.mailbox["INBOX"].append(mail(22, DEALS))
    scan()
    wait_delete_done()
    assert subjects(box, "Snoozed") == ["Subject 22"]


def test_a_batch_that_cannot_run_now_tries_again_after_the_next_scan(box):
    scan()
    set_batch()
    box.mailbox["INBOX"].append(mail(21, DEALS))
    with acc().lock:
        acc().state["restore"]["status"] = "running"
    scan()
    with acc().lock:
        acc().state["restore"]["status"] = "idle"
    assert "Subject 21" in subjects(box, "INBOX")
    scan()
    wait_delete_done()
    assert subjects(box, "Snoozed") == ["Subject 21"]


def test_a_bad_batch_request_is_refused(box):
    scan()
    for key, slot, tz in [("not an address", "weekly", "UTC"),
                          ("", "weekly", "UTC"),
                          (DEALS, "monthly", "UTC"),
                          (DEALS, "weekly", "../etc/passwd")]:
        with pytest.raises(ValueError):
            snooze.set_batch(acc(), key, slot, tz)
    assert the_store()["batches"] == {}


# -------------------------------------------------------------------- page

def test_the_listing_groups_rows_and_names_batches(box):
    scan()
    set_batch()
    box.mailbox["INBOX"] += [mail(21, DEALS), mail(22, DEALS)]
    scan()
    wait_delete_done()
    snooze.snooze_items(acc(), [["INBOX", 5]], later(30))
    snooze.snooze_groups(acc(), "sender", [NEWS], later(2))
    wait_delete_done()
    listed = snooze.listing(acc())
    assert listed["count"] == 4
    [batch] = listed["batches"]
    assert (batch["key"], batch["slot"], batch["held"], batch["label"]) \
        == (DEALS, "weekly", 2, "Promo Deals")
    assert batch["next"] > time.time()
    assert [(r["kind"], r["addr"], r["count"]) for r in listed["rows"]] == [
        ("mail", NEWS, 1), ("mail", PAT, 1)]
    assert listed["rows"][1]["subject"] == "Subject 5"
    assert listed["rows"][0]["until"] < listed["rows"][1]["until"]


# --------------------------------------------------------------------- API

def test_the_api_snoozes_lists_and_brings_back(box):
    scan()
    until = later(3)
    assert client.post("/api/snooze", json={}).status_code == 422
    assert client.post("/api/snooze", json={"until": until}).status_code == 400
    assert client.post("/api/snooze", json={
        "keys": [DEALS], "items": [["INBOX", 1]],
        "until": until}).status_code == 400
    assert client.post("/api/snooze", json={
        "keys": [DEALS], "until": 5}).json()["detail"] == "snooze_bad_time"
    assert client.post("/api/snooze", json={
        "grouping": "nope", "keys": [DEALS], "until": until}
    ).status_code == 400
    r = client.post("/api/snooze", json={"keys": [DEALS], "until": until})
    assert r.status_code == 200 and r.json()["queued"] == 4
    wait_delete_done()
    page = client.get("/api/snoozed").json()
    assert page["count"] == 4 and page["rows"][0]["until"] == until
    ids = page["rows"][0]["msgids"]
    back = client.post("/api/snoozed/back", json={"msgids": ids[:2]})
    assert back.status_code == 200 and back.json()["returned"] == 2
    assert client.post("/api/snoozed/back", json={}).status_code == 400
    r = client.post("/api/snooze", json={"items": [["INBOX", 5]],
                                         "until": until})
    wait_delete_done()
    assert r.json()["queued"] == 1


def test_the_api_sets_and_clears_a_batch(box):
    scan()
    r = client.post("/api/snooze/batch", json={
        "key": DEALS, "slot": "daily", "tz": "Europe/Berlin",
        "label": "Promo Deals"})
    assert r.status_code == 200 and r.json()["slot"] == "daily"
    assert mailops.public_state()["snoozed"]["batches"] == {DEALS: "daily"}
    assert client.post("/api/snooze/batch", json={
        "key": "nope", "slot": "daily", "tz": "UTC"}).status_code == 400
    assert client.post("/api/snooze/batch", json={
        "key": DEALS, "slot": "yearly", "tz": "UTC"}).status_code == 422
    box.mailbox["INBOX"].append(mail(21, DEALS))
    scan()
    wait_delete_done()
    back = client.post("/api/snoozed/back", json={"batch": DEALS})
    assert back.json()["returned"] == 1
    r = client.post("/api/snooze/batch", json={"key": DEALS, "slot": "off"})
    assert r.status_code == 200 and mailops.public_state()["snoozed"][
        "batches"] == {}


def test_the_api_keeps_accounts_apart(box):
    scan()
    snooze_deals()
    other = tenants.for_subject("bob@x.example")
    with tenants.use(other):
        assert snoozestore.load_account("default")["mails"] == {}
    assert json.loads(json.dumps(snoozestore.summary(acc().name)))["count"] == 4
    assert client.get("/api/snoozed?account=nope").status_code == 400


# -------------------------------------------------------------- web push

def test_the_batch_push_names_the_sender_but_never_an_address():
    p = webpush._payload("en", "batch", True, "work", False, 29, "Promo Deals")
    assert p["title"] == "Your Promo Deals batch is here: 29 mails"
    assert "unread" in p["body"] and p["url"] == "/#/snoozed"
    one = webpush._payload("en", "batch", True, "work", True, 1, "Promo Deals")
    assert one["title"].endswith("1 mail") and one["body"].startswith("work · ")
    de = webpush._payload("de", "batch", True, "work", False, 3, "Promo Deals")
    assert de["title"] == "Deine Sammellieferung von Promo Deals ist da: 3 Mails"
    anon = webpush._payload("en", "batch", True, "work", False, 2, DEALS)
    assert "@" not in json.dumps(anon) and anon["title"] \
        == "Your batch is here: 2 mails"
