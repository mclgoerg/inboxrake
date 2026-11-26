"""The All accounts page's "Same mails in several accounts"
(backend/allaccounts.py copies / trash_copies, GET /api/accounts/copies,
POST /api/accounts/copies/trash), the lasting record of the mails "Move to
another account" copied (backend/copystore.py), "Just show them"
(`/api/mails?finding=copies:<account>`) and Search across accounts
(GET /api/accounts/search)."""

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend import accountcopy
from backend import accounts as accountsmod
from backend import allaccounts
from backend import auditlog
from backend import auth as authmod
from backend import config as cfgmod
from backend import copystore
from backend import mailops
from backend import pinstore
from backend import tenants
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

BOSS = '"Boss" <boss@work.example>'
SHOP = '"Shop" <news@shop.example>'


def _m(uid, mid, frm=SHOP, size=1000, **kw):
    return make_msg(uid, frm=frm, subject=f"mail {mid}", msgid=f"<{mid}@x.example>",
                    size=size, **kw)


def _old():
    out = [_m(i, f"c{i}") for i in range(1, 6)]               # 5 exact copies
    out.append(_m(6, "diff", size=1000))                       # size differs
    out += [_m(7, "moved1"), _m(8, "moved2")]                  # made by a copy job
    out += [_m(9, "pin1"), _m(10, "pin2")]                     # pinned in old
    out += [_m(11, "boss1", frm=BOSS), _m(12, "boss2", frm=BOSS)]   # protected
    out += [_m(13, "rep"), _m(14, "rep")]                      # twice in old
    out.append(_m(15, "only"))                                 # old only
    return out


def _proton():
    out = [_m(100 + i, f"c{i}") for i in range(1, 6)]
    out.append(_m(106, "diff", size=1200))
    out += [_m(107, "moved1"), _m(108, "moved2")]
    out += [_m(109, "pin1"), _m(110, "pin2")]
    out += [_m(111, "boss1", frm=BOSS), _m(112, "boss2", frm=BOSS)]
    out.append(_m(113, "rep"))
    out.append(_m(114, "mine"))                                # proton only
    return out


@pytest.fixture
def pair(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({
        "protected": ["boss@work.example"],
        "accounts": {n: {"host": f"host-{n}", "user": f"{n}@mine.example",
                         "password": "pw"} for n in ("old", "proton", "third")}}))
    fakes = {
        "host-old": FakeIMAP({"INBOX": _old(), "Sent": [], "Trash": []}),
        "host-proton": FakeIMAP({"INBOX": _proton(), "Sent": [], "Trash": []}),
        "host-third": FakeIMAP({"INBOX": [_m(200, "c1"), _m(201, "solo")],
                                "Sent": [], "Trash": []}),
    }
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    for n in ("old", "proton", "third"):
        mailops.run_scan(accountsmod.get(n))
    copystore.record("old", "proton", ["<moved1@x.example>", "<moved2@x.example>"])
    pinstore.set_many({"<pin1@x.example>", "<pin2@x.example>"}, True, "old")
    return fakes


def _pairs():
    r = client.get("/api/accounts/copies")
    assert r.status_code == 200
    return r.json()


def _row(body, a, b):
    return next(p for p in body["pairs"] if (p["a"], p["b"]) == (a, b))


def _wait(acc, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["delete"]["status"] != "running" \
                    and not acc.delete_pending and not acc.inflight:
                return
        time.sleep(0.01)
    raise TimeoutError("job did not finish")


# --------------------------------------------------------------- the finder

def test_exact_copies_are_found_by_message_id_and_size(pair):
    body = _pairs()
    row = _row(body, "old", "proton")
    # c1-c5 + pin1, pin2, boss1, boss2 (moved1/2 are left out, diff / rep /
    # only / mine are not exact copies)
    assert row["mails"] == 9
    assert row["size"] == 9000
    assert row["first"] and row["last"] >= row["first"]


def test_a_different_size_a_repeat_in_one_account_and_a_single_account_are_no_copies(
        pair):
    ids = set()
    acc = accountsmod.get("old")
    snaps, _ = allaccounts._pairs(["old", "proton"])
    ids = {k[0] for k in allaccounts._shared("old", "proton", snaps,
                                              {"copied": {"old": set(),
                                                          "proton": set()}})[0]}
    assert "<diff@x.example>" not in ids        # same Message-ID, other size
    assert "<rep@x.example>" not in ids         # twice in old: Duplicates' job
    assert "<only@x.example>" not in ids and "<mine@x.example>" not in ids
    assert {"<c1@x.example>", "<c5@x.example>"} <= ids
    assert acc is not None


def test_mails_made_by_move_to_another_account_are_left_out_and_counted(pair):
    body = _pairs()
    assert body["left_out"] == 2
    snaps, info = allaccounts._pairs(["old", "proton"])
    keys, made = allaccounts._shared("old", "proton", snaps, info)
    assert made == 2
    assert not any(k[0].startswith("<moved") for k in keys)


def test_the_record_of_either_side_is_enough(pair):
    """A mail recorded only for proton (it was copied INTO proton from a third
    account) is no copy to remove between old and proton either."""
    copystore.record("third", "proton", ["<c3@x.example>"])
    row = _row(_pairs(), "old", "proton")
    assert row["mails"] == 8
    only_old = {"<c3@x.example>"}
    copystore.record("old", "third", list(only_old))      # and recorded in old
    assert _row(_pairs(), "old", "proton")["mails"] == 8


def test_pinned_and_protected_are_taken_out_of_the_account_they_would_leave(pair):
    row = _row(_pairs(), "old", "proton")
    # in old: pin1, pin2 (pinned there) and boss1, boss2 (protected) are held
    assert row["in_a"] == {"trash": 5, "size": 5000, "held": 4}
    # in proton nothing is pinned there, only the protected pair is held
    assert row["in_b"] == {"trash": 7, "size": 7000, "held": 2}


def test_a_pair_without_copies_is_not_listed(pair):
    body = _pairs()
    pairs = {(p["a"], p["b"]) for p in body["pairs"]}
    assert ("old", "third") in pairs and ("proton", "third") in pairs
    assert _row(body, "old", "third")["mails"] == 1          # c1 is in all three


def test_a_mail_without_a_message_id_is_never_matched(pair):
    for name in ("old", "proton"):
        acc = accountsmod.get(name)
        with acc.lock:
            for m in acc.index.values():
                m["msgid"] = ""
    assert _pairs()["pairs"] == []


def test_the_finder_is_read_only(pair):
    before = [json.dumps(sorted(accountsmod.get(n).index)) for n in
              ("old", "proton")]
    cfg = cfgmod.CONFIG_PATH.read_text()
    _pairs()
    assert before == [json.dumps(sorted(accountsmod.get(n).index)) for n in
                      ("old", "proton")]
    assert cfgmod.CONFIG_PATH.read_text() == cfg
    assert not accountsmod.get("old").undo_log


# ------------------------------------------------------------- the one step

def _trash(keep, drop, expect=10_000):
    return client.post("/api/accounts/copies/trash",
                       json={"keep": keep, "drop": drop, "expect": expect})


def test_the_copies_in_the_chosen_account_go_to_trash_in_one_step_with_undo(pair):
    old_before = len(pair["host-old"].mailbox["INBOX"])
    r = _trash("proton", "old")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queued"] == 5 and body["job"] and body["held"] == 4
    assert (body["keep"], body["drop"]) == ("proton", "old")
    _wait(accountsmod.get("old"))
    # one step with its own Undo in old, the five copies are in its Trash
    assert len(accountsmod.get("old").undo_log) == 1
    assert accountsmod.get("old").undo_log[0]["count"] == 5
    assert accountsmod.get("old").undo_log[0]["job"] == body["job"]
    assert len(pair["host-old"].mailbox["Trash"]) == 5
    assert len(pair["host-old"].mailbox["INBOX"]) == old_before - 5
    left = {m["msgid"] for m in pair["host-old"].mailbox["INBOX"]}
    # the pinned, the protected and the made-by-Move copies are still there
    assert {"<pin1@x.example>", "<boss1@x.example>",
            "<moved1@x.example>"} <= left
    # the account that keeps them is not touched at all
    assert len(pair["host-proton"].mailbox["INBOX"]) == 14
    assert not pair["host-proton"].mailbox["Trash"]
    assert not accountsmod.get("proton").undo_log
    assert "trash" in {e["action"] for e in auditlog.load("old", 0, 100)["entries"]}
    assert not any(e["action"] == "trash"
                   for e in auditlog.load("proton", 0, 100)["entries"])
    # and Undo brings them back
    mailops.undo_last(acc=accountsmod.get("old"))
    assert len(pair["host-old"].mailbox["INBOX"]) == old_before


def test_the_other_direction_trashes_in_the_other_account_only(pair):
    r = _trash("old", "proton")
    assert r.status_code == 200 and r.json()["queued"] == 7
    _wait(accountsmod.get("proton"))
    assert len(pair["host-proton"].mailbox["Trash"]) == 7
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log
    kept = {m["msgid"] for m in pair["host-old"].mailbox["INBOX"]}
    assert {"<c1@x.example>", "<c5@x.example>"} <= kept       # old keeps them


def test_the_step_is_worked_out_again_from_the_accounts_as_they_are_now(pair):
    """What the page showed is not trusted: a pin, a protection or a record
    that appeared since is honoured, and so is a twin that is gone."""
    pinstore.set_many({"<c1@x.example>"}, True, "old")
    copystore.record("old", "proton", ["<c2@x.example>"])
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["protected"].append("news@shop.example")
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))
    r = _trash("proton", "old")
    # every sender is protected now: nothing is left to move
    assert r.status_code == 400 and r.json()["detail"] == "copies_none"
    assert not pair["host-old"].mailbox["Trash"]


def test_a_copy_whose_twin_is_gone_from_the_other_account_is_not_moved(pair):
    proton = accountsmod.get("proton")
    with proton.lock:
        for key in [k for k, m in proton.index.items()
                    if m["msgid"] == "<c1@x.example>"]:
            del proton.index[key]
    assert _row(_pairs(), "old", "proton")["mails"] == 8
    r = _trash("proton", "old")
    assert r.json()["queued"] == 4
    _wait(accountsmod.get("old"))
    left = {m["msgid"] for m in pair["host-old"].mailbox["INBOX"]}
    assert "<c1@x.example>" in left              # no twin left: it stays


def test_a_pin_made_after_the_page_loaded_stays(pair):
    pinstore.set_many({"<c4@x.example>"}, True, "old")
    r = _trash("proton", "old")
    assert r.json()["queued"] == 4
    _wait(accountsmod.get("old"))
    assert "<c4@x.example>" in {m["msgid"] for m in pair["host-old"].mailbox["INBOX"]}


def test_nothing_left_is_refused_and_moves_nothing(pair):
    for n in ("c1", "c2", "c3", "c4", "c5"):
        copystore.record("old", "proton", [f"<{n}@x.example>"])
    r = _trash("proton", "old")
    assert r.status_code == 400 and r.json()["detail"] == "copies_none"
    assert not accountsmod.get("old").undo_log


def test_same_unknown_and_unscanned_accounts_are_refused(pair):
    assert _trash("old", "old").status_code == 400
    assert _trash("old", "nobody").status_code == 400
    assert _trash("nobody", "old").status_code == 400
    accountsmod.get("old").state["status"] = "scanning"
    assert _trash("proton", "old").status_code == 409
    accountsmod.get("old").state["status"] = "done"
    accountsmod.get("proton").state["status"] = "scanning"
    assert _trash("proton", "old").status_code == 409       # the keeper too
    assert not accountsmod.get("old").undo_log


# ----------------------------- one mailbox twice, busy accounts, live checks

def _one_box(monkeypatch, kind):
    """Two accounts that reach ONE mailbox, scanned. kind: "login" (the same
    host and login added twice) or "alias" (another host name and login that
    land in the same mailbox). Returns the one fake server."""
    mails = [_m(i, f"c{i}") for i in range(1, 6)]
    box = FakeIMAP({"INBOX": mails, "Sent": [], "Trash": []})
    login = {"host": "host-one", "user": "me@mine.example", "password": "pw"}
    second = login if kind == "login" else {
        "host": "host-two", "user": "alias@mine.example", "password": "pw"}
    cfgmod.CONFIG_PATH.write_text(json.dumps({
        "accounts": {"first": login, "second": second}}))
    monkeypatch.setattr(mailops, "connect", lambda im, name=None: box)
    for n in ("first", "second"):
        mailops.run_scan(accountsmod.get(n))
    return box


def _renumber(name, by=1000):
    """The account's index as if its mails had other UIDs (the index no longer
    gives the one mailbox away)."""
    acc = accountsmod.get(name)
    with acc.lock:
        rows = list(acc.index.values())
        acc.index.clear()
        for m in rows:
            m["uid"] += by
            acc.index[mailops.ikey(m["folder"], m["uid"])] = m


@pytest.mark.parametrize("kind", ["login", "alias"])
def test_one_mailbox_added_twice_is_no_pair_and_nothing_is_ever_trashed(
        monkeypatch, kind):
    box = _one_box(monkeypatch, kind)
    # every mail of "first" has a "copy" in "second" - it is the same mails
    assert _pairs() == {"pairs": [], "left_out": 0}
    for keep, drop in (("first", "second"), ("second", "first")):
        r = _trash(keep, drop)
        assert r.status_code == 400 and r.json()["detail"] == "copy_same_mailbox"
    assert len(box.mailbox["INBOX"]) == 5 and not box.mailbox["Trash"]
    assert not accountsmod.get("first").undo_log
    assert not accountsmod.get("second").undo_log
    # "Just show them" shows nothing for it either
    for acct, other in (("first", "second"), ("second", "first")):
        r = client.get("/api/mails", params={"account": acct,
                                             "finding": f"copies:{other}"})
        assert r.json()["total"] == 0


def test_the_same_login_is_refused_before_any_mail_server_is_asked(monkeypatch):
    box = _one_box(monkeypatch, "login")
    box.commands.clear()
    assert _trash("first", "second").status_code == 400
    assert box.commands == []


def test_the_same_login_is_no_pair_even_when_the_scans_number_the_mails_apart(
        monkeypatch):
    """The settings alone say it is one mailbox - whatever the index looks
    like (a rescan, another folder layout): not offered, not refused later."""
    box = _one_box(monkeypatch, "login")
    _renumber("second")
    assert _pairs()["pairs"] == []
    box.commands.clear()
    r = _trash("first", "second")
    assert r.status_code == 400 and r.json()["detail"] == "copy_same_mailbox"
    assert box.commands == [] and len(box.mailbox["INBOX"]) == 5


def test_a_job_that_starts_in_the_keeper_during_the_look_stops_the_step(
        pair, monkeypatch):
    """Checked once more right before the step is queued: a move the keeper
    started while the two servers were being looked at."""
    real = allaccounts._verify_live

    def slow(*a, **kw):
        out = real(*a, **kw)
        accountsmod.get("proton").delete_pending.append(
            {"by_folder": {"INBOX": {101}}})
        return out
    monkeypatch.setattr(allaccounts, "_verify_live", slow)
    r = _trash("proton", "old")
    assert r.status_code == 409 and r.json()["detail"] == "busy_action"
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log


def test_two_accounts_whose_mails_sit_at_the_same_places_are_taken_for_one(
        pair):
    """Not one login in the settings (another host, another login), but the
    shared mails have the same folder and UID in both: most of them - one
    mailbox. No pair, no step, nothing moves."""
    proton = accountsmod.get("proton")
    with proton.lock:        # proton's index numbers c1..c5 as old's does
        for m in proton.index.values():
            if m["msgid"] in {f"<c{i}@x.example>" for i in range(1, 6)}:
                m["uid"] -= 100
        rows = list(proton.index.values())
        proton.index.clear()
        for m in rows:
            proton.index[mailops.ikey(m["folder"], m["uid"])] = m
    assert "proton" not in {p["b"] for p in _pairs()["pairs"]
                            if p["a"] == "old"}
    r = _trash("proton", "old")
    assert r.status_code == 400 and r.json()["detail"] == "copy_same_mailbox"
    assert not pair["host-old"].mailbox["Trash"]
    assert not pair["host-proton"].mailbox["Trash"]


def test_a_few_shared_places_do_not_make_two_mailboxes_one(pair):
    """One coincidence out of nine is no mailbox: the pair is still offered."""
    proton = accountsmod.get("proton")
    with proton.lock:
        m = next(m for m in proton.index.values()
                 if m["msgid"] == "<c1@x.example>")
        del proton.index[mailops.ikey(m["folder"], m["uid"])]
        m["uid"] = 1                     # c1 is at INBOX 1 in old, too
        proton.index[mailops.ikey(m["folder"], m["uid"])] = m
    assert _row(_pairs(), "old", "proton")["mails"] == 9


def test_an_alias_the_settings_and_the_index_cannot_tell_is_refused_live(
        monkeypatch):
    box = _one_box(monkeypatch, "alias")
    _renumber("second")                  # the index gives nothing away now
    assert _row(_pairs(), "first", "second")["mails"] == 5
    box.commands.clear()
    r = _trash("first", "second")
    assert r.status_code == 400 and r.json()["detail"] == "copy_same_mailbox"
    assert len(box.mailbox["INBOX"]) == 5 and not box.mailbox["Trash"]
    assert not accountsmod.get("second").undo_log
    # only reads were sent
    assert not [c for c in box.commands if c[0] == "UID" and c[1] not in
                ("FETCH", "SEARCH")]


def test_a_check_that_cannot_be_answered_trashes_nothing(pair, monkeypatch):
    monkeypatch.setattr(accountcopy, "same_server_mailbox", lambda a, b: None)
    r = _trash("proton", "old")
    assert r.status_code == 400 and r.json()["detail"] == "copies_unverified"
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log


def test_an_unreachable_keeper_trashes_nothing(pair, monkeypatch):
    real = mailops.connect

    def connect(im, name=None):
        if im["host"] == "host-proton":
            raise OSError("connection refused")
        return real(im, name)
    monkeypatch.setattr(mailops, "connect", connect)
    r = _trash("proton", "old")
    assert r.status_code == 409
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log


def _server_side(pair, host, msgid):
    return next(m for m in pair[host].mailbox["INBOX"] if m["msgid"] == msgid)


def test_a_copy_that_left_the_keeping_account_since_the_scan_is_not_trashed(pair):
    """The scan says proton holds c1; on the server it is gone (moved or
    deleted by another client): old's c1 is then the only one - it stays."""
    box = pair["host-proton"]
    box.mailbox["INBOX"] = [m for m in box.mailbox["INBOX"]
                            if m["msgid"] != "<c1@x.example>"]
    r = _trash("proton", "old")
    assert r.status_code == 200 and r.json()["queued"] == 4
    _wait(accountsmod.get("old"))
    assert "<c1@x.example>" in {m["msgid"] for m in
                                pair["host-old"].mailbox["INBOX"]}
    assert len(pair["host-old"].mailbox["Trash"]) == 4


def test_a_copy_whose_twin_changed_on_the_server_is_not_trashed(pair):
    _server_side(pair, "host-proton", "<c2@x.example>")["size"] = 999    # edited
    _server_side(pair, "host-proton", "<c3@x.example>")["msgid"] = "<other@x>"
    r = _trash("proton", "old")
    assert r.json()["queued"] == 3
    _wait(accountsmod.get("old"))
    kept = {m["msgid"] for m in pair["host-old"].mailbox["INBOX"]}
    assert {"<c2@x.example>", "<c3@x.example>"} <= kept


def test_a_uid_that_now_holds_another_mail_in_the_keeper_is_not_a_twin(pair):
    """The keeper's UID was reused by a different mail (UIDVALIDITY changed):
    the Message-ID there is another one, so the copy in old stays."""
    box = pair["host-proton"]
    box.mailbox["INBOX"] = [m for m in box.mailbox["INBOX"]
                            if m["msgid"] != "<c4@x.example>"]
    box.mailbox["INBOX"].append(_m(104, "stranger"))
    r = _trash("proton", "old")
    assert r.json()["queued"] == 4
    _wait(accountsmod.get("old"))
    assert "<c4@x.example>" in {m["msgid"] for m in
                                pair["host-old"].mailbox["INBOX"]}


def test_a_copy_that_left_the_dropping_account_since_the_scan_is_not_asked_for(
        pair):
    box = pair["host-old"]
    box.mailbox["INBOX"] = [m for m in box.mailbox["INBOX"]
                            if m["msgid"] != "<c5@x.example>"]
    box.mailbox["INBOX"].append(_m(16, "arrived"))   # (not as many as proton)
    r = _trash("proton", "old")
    assert r.status_code == 200 and r.json()["queued"] == 4
    _wait(accountsmod.get("old"))
    assert len(box.mailbox["Trash"]) == 4


def test_when_no_twin_is_left_on_the_server_nothing_is_queued(pair):
    pair["host-proton"].mailbox["INBOX"] = []
    r = _trash("proton", "old")
    assert r.status_code == 400 and r.json()["detail"] == "copies_none"
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log


def test_the_look_at_the_keeping_account_only_reads(pair):
    keeper = pair["host-proton"]
    keeper.commands.clear()
    assert _trash("proton", "old").status_code == 200
    _wait(accountsmod.get("old"))
    sent = keeper.commands
    assert sent                                         # it did look
    assert all(c[0] in ("SELECT", "UID") for c in sent), sent
    assert all(c[2] is True for c in sent if c[0] == "SELECT"), sent
    assert not [c for c in sent if c[0] == "UID" and c[1] not in
                ("FETCH", "SEARCH")]
    assert len(keeper.mailbox["INBOX"]) == 14 and not keeper.mailbox["Trash"]


@pytest.mark.parametrize("who,field", [
    ("proton", "pending"), ("proton", "inflight"), ("proton", "running"),
    ("proton", "restore"), ("old", "pending"), ("old", "running")])
def test_an_account_that_is_moving_mails_refuses_the_step(pair, who, field):
    """A mail the keeper is already moving is still in its index: both copies
    could end up in Trash. Refused (409) while either account is busy."""
    acc = accountsmod.get(who)
    with acc.lock:
        if field == "pending":
            acc.delete_pending.append({"by_folder": {"INBOX": {101}}})
        elif field == "inflight":
            acc.inflight = {"INBOX": {101}}
        elif field == "running":
            acc.state["delete"]["status"] = "running"
        else:
            acc.state["restore"]["status"] = "running"
    r = _trash("proton", "old")
    assert r.status_code == 409 and r.json()["detail"] == "busy_action"
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log


def test_a_move_the_keeper_has_queued_for_real_stops_the_step(pair, monkeypatch):
    """The user sends one of proton's copies to Trash (queued, not yet done);
    "keep in proton, trash in old" must not also take old's twin."""
    monkeypatch.setattr(mailops, "_delete_worker", lambda acc: None)
    res = mailops.delete_messages([["INBOX", 101]], "trash",
                                  acc=accountsmod.get("proton"))
    assert res["queued"] == 1
    r = _trash("proton", "old")
    assert r.status_code == 409 and r.json()["detail"] == "busy_action"
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log


def test_more_copies_than_the_user_confirmed_are_refused(pair):
    r = _trash("proton", "old", expect=4)
    assert r.status_code == 409 and r.json()["detail"] == "copies_changed"
    assert not pair["host-old"].mailbox["Trash"]
    assert not accountsmod.get("old").undo_log
    # the number that was confirmed goes through
    assert _trash("proton", "old", expect=5).status_code == 200


def test_fewer_copies_than_confirmed_are_fine(pair):
    r = _trash("proton", "old", expect=500)
    assert r.status_code == 200 and r.json()["queued"] == 5


def test_a_step_without_the_confirmed_number_is_not_accepted(pair):
    r = client.post("/api/accounts/copies/trash",
                    json={"keep": "proton", "drop": "old"})
    assert r.status_code == 422
    assert not pair["host-old"].mailbox["Trash"]


# --------------------------------------------------------- Just show them

def test_just_show_them_lists_the_mails_with_a_copy_in_the_other_account(pair):
    r = client.get("/api/mails", params={"account": "old",
                                         "finding": "copies:proton"})
    assert r.status_code == 200
    subjects = {m["subject"] for m in r.json()["mails"]}
    assert r.json()["total"] == 9
    assert "mail c1" in subjects and "mail pin1" in subjects   # pinned shown
    assert "mail moved1" not in subjects and "mail only" not in subjects
    r = client.get("/api/mails", params={"account": "proton",
                                         "finding": "copies:old"})
    assert r.json()["total"] == 9


def test_just_show_them_with_a_stranger_name_is_a_400(pair):
    r = client.get("/api/mails", params={"account": "old",
                                         "finding": "copies:nobody"})
    assert r.status_code == 400


# ------------------------------------------------------------------ tenants

ADMIN = "admin@corp.example"


def _client_as(sub):
    c = TestClient(app)
    c.cookies.set("pmc_session", authmod.make_session(sub))
    return c


def test_another_users_accounts_never_appear_in_copies_or_search():
    cfgmod.update_config({"auth": {
        "mode": "oidc", "admin": ADMIN,
        "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                 "client_secret": "sst"}}})
    alice, bob = _client_as("alice@x.example"), _client_as("bob@y.example")
    alice.post("/api/config", json={
        "account": "default", "imap": {"host": "imap.alice.example"}})
    alice.post("/api/config", json={
        "rename_account": {"from": "default", "to": "alices-secret-name"}})
    for c in (alice, bob):
        assert c.get("/api/accounts/copies").status_code == 200
        assert c.get("/api/accounts/search", params={"q": "ab"}).status_code == 200
    r = bob.post("/api/accounts/copies/trash", json={
        "keep": "alices-secret-name", "drop": "default", "expect": 1})
    assert r.status_code == 400
    assert "alices-secret-name" not in json.dumps(bob.get(
        "/api/accounts/search", params={"q": "ab"}).json())


def test_signed_out_users_get_nothing_in_login_mode():
    cfgmod.update_config({"auth": {"mode": "password", "password": "pw-1234567"}})
    anon = TestClient(app)
    assert anon.get("/api/accounts/copies").status_code == 401
    assert anon.post("/api/accounts/copies/trash",
                     json={"keep": "a", "drop": "b",
                           "expect": 1}).status_code == 401
    assert anon.get("/api/accounts/search", params={"q": "ab"}).status_code == 401


# -------------------------------------------------------------- the record

def test_the_record_keeps_both_sides_and_survives_a_restart(pair):
    copystore.record("a", "b", ["<one@x>", "", "<two@x>"])
    assert copystore.load_account("a") == {"<one@x>", "<two@x>"}
    assert copystore.load_account("b") == {"<one@x>", "<two@x>"}
    copystore._cache.clear()                       # a new process
    assert copystore.load_account("b") == {"<one@x>", "<two@x>"}
    assert copystore.record("a", "b", ["<one@x>"]) == 0     # nothing new


def test_the_record_follows_a_renamed_account_and_goes_with_a_dropped_one(pair):
    r = client.post("/api/config", json={
        "rename_account": {"from": "old", "to": "former"}})
    assert r.status_code == 200
    assert "<moved1@x.example>" in copystore.load_account("former")
    assert copystore.load_account("old") == set()
    # the renamed account still leaves them out
    assert _row(_pairs(), "former", "proton")["mails"] == 9
    client.post("/api/config", json={"delete_account": "former"})
    assert copystore.load_account("former") == set()
    assert "<moved1@x.example>" in copystore.load_account("proton")


def test_a_damaged_record_forgets_what_it_cannot_read_and_never_fails(pair):
    path = copystore._path()
    path.write_text("not json")
    copystore._cache.clear()
    assert copystore.load_account("old") == set()
    path.write_text(json.dumps({"accounts": {"old": ["<a@x>", 5, None],
                                             "bad": "x"}, "jobs": "no"}))
    copystore._cache.clear()
    assert copystore.load_account("old") == {"<a@x>"}
    assert copystore.job_known("anything") is False


def test_the_record_is_per_tenant(pair):
    """Two users may both have an account called "old": what one copied never
    leaves the other's mails out."""
    copystore.record("old", "proton", ["<t@x>"])
    other = tenants.for_subject("bob@y.example")
    assert tenants.call_in(other, copystore.load_account, "old") == set()
    tenants.call_in(other, copystore.record, "old", "proton", ["<b@x>"])
    assert copystore.load_account("old") >= {"<t@x>"}
    assert "<b@x>" not in copystore.load_account("old")
    assert tenants.call_in(other, copystore.load_account, "old") == {"<b@x>"}


def test_the_last_copy_job_that_ran_before_the_record_existed_is_folded_in_once(
        pair, monkeypatch):
    job = {"id": "job-1", "source": "old", "target": "proton",
           "status": "done"}
    monkeypatch.setattr(accountcopy, "_read",
                        lambda: {"job": job, "tell": {}})
    monkeypatch.setattr(accountcopy, "_ledger_read", lambda jid: {
        "<f1@x>": "ok", "<f2@x>": "unchecked", "<f3@x>": "dup",
        "<f4@x>": "big", "fp:abc": "ok"} if jid == "job-1" else {})
    accountcopy.fold_last_job()
    assert copystore.load_account("old") >= {"<f1@x>", "<f2@x>"}
    assert copystore.load_account("proton") >= {"<f1@x>", "<f2@x>"}
    # a mail the target already had (dup), too big, or without a Message-ID
    # is not a copy the job made
    assert not copystore.load_account("old") & {"<f3@x>", "<f4@x>", "fp:abc"}
    assert copystore.job_known("job-1")
    # never read again
    monkeypatch.setattr(accountcopy, "_ledger_read",
                        lambda jid: pytest.fail("read twice"))
    accountcopy.fold_last_job()


def test_the_finder_folds_the_last_job_in_before_it_counts(pair, monkeypatch):
    """A copy job that ran before the record existed: its ledger is read once,
    by the finder itself, so the mails it copied are not offered."""
    job = {"id": "job-3", "source": "old", "target": "proton", "status": "done"}
    monkeypatch.setattr(accountcopy, "_read", lambda: {"job": job, "tell": {}})
    monkeypatch.setattr(accountcopy, "_ledger_read", lambda jid: {
        "<c4@x.example>": "ok", "<c5@x.example>": "unchecked"})
    assert _row(_pairs(), "old", "proton")["mails"] == 7      # 9 - the two
    assert _pairs()["left_out"] == 4
    r = _trash("proton", "old")
    assert r.json()["queued"] == 3                            # c1, c2, c3
    _wait(accountsmod.get("old"))
    left = {m["msgid"] for m in pair["host-old"].mailbox["INBOX"]}
    assert {"<c4@x.example>", "<c5@x.example>"} <= left


def test_a_job_that_is_still_going_is_folded_as_far_as_it_got_and_not_marked(
        pair, monkeypatch):
    job = {"id": "job-2", "source": "old", "target": "proton",
           "status": "running"}
    monkeypatch.setattr(accountcopy, "_read", lambda: {"job": job, "tell": {}})
    monkeypatch.setattr(accountcopy, "_ledger_read",
                        lambda jid: {"<g1@x>": "ok"})
    accountcopy.fold_last_job()
    assert "<g1@x>" in copystore.load_account("old")
    assert not copystore.job_known("job-2")


# ---------------------------------------------------- Search across accounts

def test_search_over_every_account_with_their_account_and_protection(pair):
    r = client.get("/api/accounts/search", params={"q": "mail c1"})
    assert r.status_code == 200
    body = r.json()
    by = {m["account"]: m for m in body["mails"]}
    assert set(by) == {"old", "proton", "third"}
    assert all(m["subject"] == "mail c1" for m in body["mails"])
    # newest first across accounts, each hit says whether it may be moved
    assert [m["ts"] for m in body["mails"]] == sorted(
        (m["ts"] for m in body["mails"]), reverse=True)
    pinned = client.get("/api/accounts/search", params={"q": "mail pin1"}).json()
    assert {(m["account"], m["pinned"]) for m in pinned["mails"]} == {
        ("old", True), ("proton", False)}
    boss = client.get("/api/accounts/search", params={"q": "mail boss1"}).json()
    assert all(m["protected"] for m in boss["mails"])


def test_search_lists_the_matching_senders_of_every_account(pair):
    body = client.get("/api/accounts/search", params={"q": "shop"}).json()
    assert {s["account"] for s in body["senders"]} == {"old", "proton", "third"}
    assert all("shop" in s["key"] for s in body["senders"])
    counts = [s["count"] for s in body["senders"]]
    assert counts == sorted(counts, reverse=True)
    assert body["senders"][0]["label"]


def test_search_body_follows_each_accounts_own_setting_and_one_failure_is_a_note(
        pair, monkeypatch):
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["proton"]["body_search"] = "disabled"
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))

    def boom(*a, **k):
        raise OSError("down")
    real = mailops.search_body

    def pick(q, limit=500, acc=None, budget=None):
        if acc.name == "third":
            return boom()
        return real(q, limit, acc=acc, budget=budget)
    monkeypatch.setattr(mailops, "search_body", pick)
    body = client.get("/api/accounts/search",
                      params={"q": "mail c1", "scope": "body"}).json()
    notes = {(n["account"], n["key"]) for n in body["notes"]}
    assert ("proton", "body_off") in notes and ("third", "account_failed") in notes
    assert {m["account"] for m in body["mails"]} >= {"old", "proton"}


def test_search_is_read_only_and_selects_nothing(pair):
    cfg = cfgmod.CONFIG_PATH.read_text()
    client.get("/api/accounts/search", params={"q": "mail"})
    assert cfgmod.CONFIG_PATH.read_text() == cfg
    assert not accountsmod.get("old").undo_log


def test_delete_messages_returns_its_job_and_the_step_carries_it(pair):
    r = client.post("/api/delete_messages?account=old",
                    json={"items": [["INBOX", 15]]})
    assert r.status_code == 200 and r.json()["job"]
    _wait(accountsmod.get("old"))
    assert accountsmod.get("old").undo_log[-1]["job"] == r.json()["job"]
