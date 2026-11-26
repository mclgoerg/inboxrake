"""The All accounts page (backend/allaccounts.py, GET /api/accounts/overview):
per-account cards, the sender join, tenant separation, and the per-account
steps the page's confirm runs (each account's own unsubscribe, delete, undo
and audit entry, with the server-side protection guards)."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import allaccounts
from backend import auditlog
from backend import auth as authmod
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import smtpout
from backend import unsub
from backend import unsubstore
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

DEALS = '"Deals Daily" <deals@dealsdaily.example>'
PROMO = '"Deals Daily" <promo@dealsdaily.example>'
UNSUB = dict(unsub="<https://dealsdaily.example/u>", unsub_post=True)
PAGE = dict(unsub="<https://dealsdaily.example/page>")
MAILTO = dict(unsub="<mailto:stop@dealsdaily.example?subject=stop>")


def _mails(frm, n, start=1, **kw):
    return [make_msg(start + i, frm=frm, subject=f"offer {i}",
                     msgid=f"<{frm[-12:-1]}-{start + i}@x.example>", **kw)
            for i in range(n)]


@pytest.fixture
def three(monkeypatch):
    """Three accounts. Deals Daily writes to all of them (the same address to
    one and two, another address of the same company to three); a freemail
    newsletter reaches one and two from the same address; a protected sender
    and a person the user wrote to are in two accounts as well."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({
        "accounts": {n: {"host": f"host-{n}", "user": f"{n}@mine.example",
                         "password": "pw"} for n in ("one", "two", "three")},
        "protected": ["keep@boss.example"]}))
    fakes = {
        "host-one": FakeIMAP({
            "INBOX": _mails(DEALS, 5, 1, **UNSUB)
            + _mails('"Free" <letter@gmail.com>', 3, 20, **UNSUB)
            + _mails('"Boss" <keep@boss.example>', 2, 30, **UNSUB)
            + _mails('"Pal" <pal@pal.example>', 3, 40, **UNSUB)
            + [make_msg(50, frm='"Solo" <solo@solo.example>')],
            "Sent": [make_msg(90, frm="one@mine.example", subject="re",
                              to="pal@pal.example")],
            "Trash": []}),
        "host-two": FakeIMAP({
            "INBOX": _mails(DEALS, 3, 1, seen=True, **UNSUB)
            + _mails('"Free" <letter@gmail.com>', 1, 20, **UNSUB)
            + _mails('"Free" <other@gmail.com>', 4, 25, **UNSUB)
            + _mails('"Boss" <keep@boss.example>', 1, 30, **UNSUB)
            + _mails('"Pal" <pal@pal.example>', 2, 40, **UNSUB),
            "Sent": [make_msg(90, frm="two@mine.example", subject="re",
                              to="pal@pal.example")],
            "Trash": []}),
        "host-three": FakeIMAP({
            "INBOX": _mails(PROMO, 2, 1, **PAGE)
            + _mails('"Free" <other@gmail.com>', 1, 25, **UNSUB),
            "Sent": [], "Trash": []}),
    }
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    for n in ("one", "two", "three"):
        mailops.run_scan(accountsmod.get(n))
    return fakes


def _overview(c=client, since=None):
    r = c.get("/api/accounts/overview",
              params={"since": json.dumps(since)} if since is not None else {})
    assert r.status_code == 200
    return r.json()


def _row(body, key):
    return next(r for r in body["same_sender"] if r["key"] == key)


def _part(row, account):
    return next(a for a in row["accounts"] if a["account"] == account)


def _cand(account, addr, count, unsub=False, state=None, protected=False):
    return {"account": account, "addr": addr, "name": addr, "count": count,
            "size": 1, "unread": 0, "pinned": 0, "unsub": unsub,
            "state": state, "blocked": False, "protected": protected}


def test_cards_hold_each_accounts_own_numbers(three):
    body = _overview()
    by = {a["name"]: a for a in body["accounts"]}
    assert list(by) == ["one", "two", "three"]
    assert by["one"]["user"] == "one@mine.example"
    assert by["one"]["mails"] == 14 and by["two"]["mails"] == 11
    assert by["three"]["mails"] == 3
    assert by["one"]["senders"] == 5
    assert body["totals"] == {
        "mails": 28, "size": sum(a["size"] for a in body["accounts"]),
        "senders": sum(a["senders"] for a in body["accounts"])}
    assert all(a["scanned_ts"] and not a["failed"] for a in by.values())
    assert all(a["status"] == "done" for a in by.values())
    assert all(a["failed_ts"] is None for a in by.values())


def test_a_failed_scan_is_flagged_with_its_time_and_keeps_the_last_good_one(
        three, monkeypatch):
    def boom(im, name=None):
        raise OSError("down")
    good = accountsmod.get("two").state["scanned_ts"]
    monkeypatch.setattr(mailops, "connect", boom)
    before = int(time.time())
    mailops.run_scan(accountsmod.get("two"))
    body = _overview()
    two = next(a for a in body["accounts"] if a["name"] == "two")
    assert two["failed"] and two["status"] == "error"
    assert two["failed_ts"] >= before
    assert two["scanned_ts"] in (good, accountsmod.get("two").prev_scan_ts)
    # the others are untouched
    assert not any(a["failed"] or a["failed_ts"]
                   for a in body["accounts"] if a["name"] != "two")


def test_a_good_scan_after_a_failed_one_clears_the_failure(three, monkeypatch):
    real = mailops.connect

    def boom(im, name=None):
        raise OSError("down")
    monkeypatch.setattr(mailops, "connect", boom)
    mailops.run_scan(accountsmod.get("two"))
    assert accountsmod.get("two").scan_failed_ts
    monkeypatch.setattr(mailops, "connect", real)
    mailops.run_scan(accountsmod.get("two"))
    two = next(a for a in _overview()["accounts"] if a["name"] == "two")
    assert not two["failed"] and two["failed_ts"] is None
    assert accountsmod.get("two").scan_failed_ts is None


def test_a_renamed_account_keeps_its_failure_time(three, monkeypatch):
    def boom(im, name=None):
        raise OSError("down")
    monkeypatch.setattr(mailops, "connect", boom)
    mailops.run_scan(accountsmod.get("two"))
    ts = accountsmod.get("two").scan_failed_ts
    assert ts
    r = client.post("/api/config", json={
        "rename_account": {"from": "two", "to": "second"}})
    assert r.status_code == 200
    assert accountsmod.get("second").scan_failed_ts == ts
    second = next(a for a in _overview()["accounts"] if a["name"] == "second")
    assert second["failed"] and second["failed_ts"] == ts


def test_a_move_or_unsubscribe_that_failed_is_flagged_once_per_job(three):
    """The client says "a step in <account> did not finish" from this (the
    job's own sequence number makes it one message per job)."""
    two = accountsmod.get("two")
    by = lambda: {a["name"]: a for a in _overview()["accounts"]}   # noqa: E731
    assert all(a["job_failed"] is None for a in by().values())
    with two.lock:
        two.state["delete"].update(status="running", error="", seq=7)
    assert by()["two"]["busy"] and by()["two"]["job_failed"] is None
    with two.lock:
        two.state["delete"].update(status="error", error="Connection lost")
    row = by()["two"]
    assert not row["busy"]
    assert row["job_failed"] == {"id": "d7", "error": "Connection lost"}
    assert by()["one"]["job_failed"] is None            # per account
    with two.lock:
        two.state["delete"].update(status="idle", error="")
        two.state["unsub"].update(status="error", error="no link", seq=3)
    assert by()["two"]["job_failed"] == {"id": "u3", "error": "no link"}


def test_new_counts_from_the_remembered_visit_else_the_last_week(three):
    soon = time.time() + 400 * 86400        # the mails are a year old by then
    week = {a["name"]: a["new"]
            for a in allaccounts.build({}, now=soon)["accounts"]}
    assert week == {"one": 0, "two": 0, "three": 0}
    assert {a["name"]: a["new"]
            for a in _overview()["accounts"]} == {"one": 14, "two": 11,
                                                  "three": 3}
    assert {a["new_basis"] for a in _overview()["accounts"]} == {"week"}
    # a remembered visit counts from THAT account's moment, per account
    body = allaccounts.build({"one": 0, "two": soon}, now=soon)
    by = {a["name"]: a for a in body["accounts"]}
    assert by["one"]["new"] == 14 and by["two"]["new"] == 0
    assert by["one"]["new_basis"] == "visit"
    assert by["three"]["new_basis"] == "week"


def test_junk_values_in_since_are_ignored(three):
    for bad in ("not json", "[1, 2]", '{"one": "x", "two": true, "three": -4}'):
        r = client.get("/api/accounts/overview", params={"since": bad})
        assert r.status_code == 200
        assert {a["new_basis"] for a in r.json()["accounts"]} == {"week"}


def test_same_sender_joins_by_address_then_by_company_domain(three):
    body = _overview()
    deals = _row(body, "dealsdaily.example")
    assert deals["name"] == "Deals Daily"
    assert [a["account"] for a in deals["accounts"]] == ["one", "two", "three"]
    one, two, three_ = deals["accounts"]
    assert (one["addr"], one["mails"]) == ("deals@dealsdaily.example", 5)
    assert (two["addr"], two["mails"]) == ("deals@dealsdaily.example", 3)
    # another address of the same company in the third account
    assert (three_["addr"], three_["mails"]) == ("promo@dealsdaily.example", 2)
    assert deals["mails"] == 10 and deals["match"] == "domain"
    assert [a["unsub"] for a in deals["accounts"]] == [True, True, True]
    # three read of ten (the two account's mails are seen)
    assert deals["opened"] == 30
    assert deals["left_out"] == []


def test_each_account_names_how_its_own_unsubscribe_would_run(three):
    """The method is read from THAT account's newest List-Unsubscribe header:
    one-click in two accounts, a page in the third."""
    deals = _row(_overview(), "dealsdaily.example")
    assert {a["account"]: a["via"] for a in deals["accounts"]} == {
        "one": "one_click", "two": "one_click", "three": "http"}


def test_freemail_is_matched_by_exact_address_only(three):
    body = _overview()
    keys = {r["key"] for r in body["same_sender"]}
    # the same freemail ADDRESS in two accounts joins ...
    letter = _row(body, "letter@gmail.com")
    assert letter["match"] == "address"
    assert [a["account"] for a in letter["accounts"]] == ["one", "two"]
    # ... a freemail DOMAIN never does: other@gmail.com is in two and three,
    # and is a row of its own, not pooled with letter@gmail.com
    other = _row(body, "other@gmail.com")
    assert {a["account"] for a in other["accounts"]} == {"two", "three"}
    assert "gmail.com" not in keys


def test_protected_replied_and_single_account_senders_are_left_out(three):
    keys = {r["key"] for r in _overview()["same_sender"]}
    # (the person has 3 + 2 mails across two accounts: only the reply the
    # user wrote keeps them off the list)
    assert "boss.example" not in keys and "keep@boss.example" not in keys
    assert "pal.example" not in keys and "pal@pal.example" not in keys
    assert "solo.example" not in keys


def test_a_sender_protected_in_every_account_it_is_in_is_no_row_any_more(
        three):
    """Protection is read each time, never cached: a company whose addresses
    are now protected in two of its three accounts has one account left,
    which is no pattern."""
    assert "dealsdaily.example" in {r["key"]
                                    for r in _overview()["same_sender"]}
    _protect("deals@dealsdaily.example")
    assert "dealsdaily.example" not in {r["key"]
                                        for r in _overview()["same_sender"]}


def test_a_protected_address_in_one_of_three_accounts_is_left_out_by_name(
        three):
    """Only account three holds promo@ - protect that one: the row stays for
    the two accounts with deals@ and says why three is not part of it (the
    confirm reads this fresh on open and blocks that line)."""
    assert _row(_overview(), "dealsdaily.example")["left_out"] == []
    _protect("promo@dealsdaily.example")
    deals = _row(_overview(), "dealsdaily.example")
    assert [a["account"] for a in deals["accounts"]] == ["one", "two"]
    assert deals["left_out"] == [{"account": "three",
                                  "addr": "promo@dealsdaily.example",
                                  "why": "protected"}]
    assert deals["mails"] == 8


def test_pinned_mails_are_counted_apart_per_account(three):
    acc = accountsmod.get("one")
    with acc.lock:
        ids = [m["msgid"] for m in acc.index.values()
               if m["addr"] == "deals@dealsdaily.example"][:2]
    pinstore.set_many(set(ids), True, "one")
    deals = _row(_overview(), "dealsdaily.example")
    assert _part(deals, "one")["pinned"] == 2
    assert _part(deals, "two")["pinned"] == 0
    assert _part(deals, "one")["mails"] == 5     # the count still includes them


def test_a_sender_needs_at_least_four_mails_across_the_accounts():
    # 2 + 1 = 3 mails in two accounts: no pattern yet; one more makes it a row
    assert allaccounts.same_sender([_cand("one", "a@shop.example", 2),
                                    _cand("two", "a@shop.example", 1)]) == []
    (row,) = allaccounts.same_sender([_cand("one", "a@shop.example", 2),
                                      _cand("two", "a@shop.example", 2)])
    assert row["mails"] == allaccounts.SAME_SENDER_MIN_MAILS == 4


def test_the_boundary_sender_is_on_the_page(three):
    # letter@gmail.com has 3 + 1 = 4 mails across two accounts: exactly the
    # minimum, so it is listed (and the count "All N" follows the list)
    body = _overview()
    assert _row(body, "letter@gmail.com")["mails"] == 4
    assert all(r["mails"] >= allaccounts.SAME_SENDER_MIN_MAILS
               for r in body["same_sender"])


def test_a_sender_in_one_account_only_is_no_row():
    assert allaccounts.same_sender([_cand("one", "a@shop.example", 3),
                                    _cand("one", "b@shop.example", 9)]) == []


def test_the_address_that_can_still_be_unsubscribed_stands_for_an_account():
    cands = [_cand("one", "big@shop.example", 50, True, "done"),
             _cand("one", "small@shop.example", 4, True, None),
             _cand("two", "big@shop.example", 6)]
    (row,) = allaccounts.same_sender(cands)
    one = _part(row, "one")
    assert one["addr"] == "small@shop.example" and one["state"] is None
    assert row["match"] == "domain"
    # none can: the biggest stands in
    cands[1]["state"] = "done"
    (row,) = allaccounts.same_sender(cands)
    assert _part(row, "one")["addr"] == "big@shop.example"


def test_already_unsubscribed_state_is_carried_per_account(three,
                                                           monkeypatch):
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    unsub.unsubscribe("sender", "deals@dealsdaily.example",
                      accountsmod.get("two"))
    deals = _row(_overview(), "dealsdaily.example")
    states = {a["account"]: a["state"] for a in deals["accounts"]}
    assert states == {"one": None, "two": "done", "three": None}


def test_the_newest_undo_step_of_each_account_is_on_its_card(three):
    by = lambda: {a["name"]: a for a in _overview()["accounts"]}   # noqa: E731
    assert by()["one"]["undo_last"] is None
    client.post("/api/delete?account=one", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"]})
    _wait(accountsmod.get("one"))
    last = by()["one"]["undo_last"]
    assert last["count"] == 5 and last["action"] == "trash" and last["id"]
    assert by()["two"]["undo_last"] is None             # per account


def test_the_aggregate_is_read_only_and_selects_nothing(three):
    before = [json.dumps(mailops.public_state(accountsmod.get(n))["groups"]
                         ["sender"], sort_keys=True)
              for n in ("one", "two", "three")]
    cfg = cfgmod.CONFIG_PATH.read_text()
    _overview()
    _overview(since={"one": 0})
    after = [json.dumps(mailops.public_state(accountsmod.get(n))["groups"]
                        ["sender"], sort_keys=True)
             for n in ("one", "two", "three")]
    assert before == after
    assert cfgmod.CONFIG_PATH.read_text() == cfg        # nothing was written


# ------------------------------------------------------------------ tenants

ADMIN = "admin@corp.example"


def _client_as(sub):
    c = TestClient(app)
    c.cookies.set("pmc_session", authmod.make_session(sub))
    return c


def test_another_users_accounts_never_appear():
    cfgmod.update_config({"auth": {
        "mode": "oidc", "admin": ADMIN,
        "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                 "client_secret": "sst"}}})
    alice, bob = _client_as("alice@x.example"), _client_as("bob@y.example")
    alice.post("/api/config", json={
        "account": "default", "imap": {"host": "imap.alice.example"}})
    alice.post("/api/config", json={
        "rename_account": {"from": "default", "to": "alices-secret-name"}})
    a = _overview(alice)
    b = _overview(bob)
    assert [x["name"] for x in a["accounts"]] == ["alices-secret-name"]
    assert [x["name"] for x in b["accounts"]] == ["default"]
    assert "alices-secret-name" not in json.dumps(b)
    # a per-account step against someone else's account name is refused like
    # an unknown one - the page's confirm cannot reach it
    assert bob.post("/api/unsubscribe?account=alices-secret-name", json={
        "grouping": "sender", "key": "x@y.example"}).status_code == 400
    assert bob.post("/api/delete?account=alices-secret-name", json={
        "grouping": "sender", "keys": ["x@y.example"],
        "skip_protected": True}).status_code == 400


def test_signed_out_users_get_nothing_in_login_mode():
    cfgmod.update_config({"auth": {"mode": "password",
                                   "password": "pw-1234567"}})
    r = TestClient(app).get("/api/accounts/overview")
    assert r.status_code == 401


# ----------------------------------------------- the steps the confirm runs

def _audited(name):
    return {e["action"] for e in auditlog.load(name, 0, 1000)["entries"]}


def _wait(acc, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["delete"]["status"] != "running" \
                    and not acc.delete_pending and not acc.inflight:
                return
        time.sleep(0.01)
    raise TimeoutError("delete job did not finish")


def _protect(addr):
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["protected"] = [*cfg["protected"], addr]
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))


def test_each_account_runs_its_own_step_with_its_own_undo_and_audit(
        three, monkeypatch):
    posted = []
    monkeypatch.setattr(unsub, "_post_one_click", lambda u: posted.append(u))
    # what the confirm does for the ticked accounts "one" and "two": an
    # unsubscribe and a Trash move - each pinned to its account by ?account=
    for name in ("one", "two"):
        r = client.post(f"/api/unsubscribe?account={name}", json={
            "grouping": "sender", "key": "deals@dealsdaily.example",
            "skip_protected": True})
        assert r.status_code == 200 and r.json()["action"] == "done"
        d = client.post(f"/api/delete?account={name}", json={
            "grouping": "sender", "keys": ["deals@dealsdaily.example"],
            "skip_protected": True})
        assert d.status_code == 200
        _wait(accountsmod.get(name))
    assert len(posted) == 2
    # the unticked account is untouched: no mail moved, nothing recorded
    assert len(three["host-three"].mailbox["Trash"]) == 0
    assert len(accountsmod.get("three").undo_log) == 0
    assert unsubstore.load_account("three") == {}
    # each ticked account has its own undo step and its own audit entries
    for name, mails in (("one", 5), ("two", 3)):
        acc = accountsmod.get(name)
        assert len(acc.undo_log) == 1 and acc.undo_log[0]["count"] == mails
        assert len(three[f"host-{name}"].mailbox["Trash"]) == mails
        assert set(unsubstore.load_account(name)) == {
            "deals@dealsdaily.example"}
    for name in ("one", "two"):
        assert {"unsubscribe", "trash"} <= _audited(name)
    assert not _audited("three") & {"unsubscribe", "trash"}
    # undoing one account's step leaves the other's in place
    mailops.undo_last(acc=accountsmod.get("one"))
    assert len(accountsmod.get("two").undo_log) == 1
    assert len(three["host-two"].mailbox["Trash"]) == 3


def test_unsubscribing_in_an_account_uses_that_accounts_own_method_and_smtp(
        three, monkeypatch):
    """Two accounts, the same sender, an unsubscribe MAIL: each account sends
    it from its own address through its own SMTP settings, records it in its
    own unsubscribe record, and the other account stays untouched."""
    for host in ("host-one", "host-two"):
        three[host].mailbox["INBOX"][:] = _mails(DEALS, 5, 100, **MAILTO)
    for n in ("one", "two"):
        mailops.run_scan(accountsmod.get(n))
    sent = []

    def fake_send(im, to, subject, body, account_name=None):
        sent.append((account_name, im["user"], to))
    monkeypatch.setattr(smtpout, "send", fake_send)
    r = client.post("/api/unsubscribe?account=two", json={
        "grouping": "sender", "key": "deals@dealsdaily.example",
        "skip_protected": True})
    assert r.status_code == 200 and r.json()["via"] == "mailto"
    assert sent == [("two", "two@mine.example", "stop@dealsdaily.example")]
    assert unsubstore.load_account("one") == {}
    assert set(unsubstore.load_account("two")) == {"deals@dealsdaily.example"}
    client.post("/api/unsubscribe?account=one", json={
        "grouping": "sender", "key": "deals@dealsdaily.example",
        "skip_protected": True})
    assert sent[1] == ("one", "one@mine.example", "stop@dealsdaily.example")
    assert len(sent) == 2
    assert "unsubscribe" in _audited("one") and "unsubscribe" in _audited("two")


def test_a_sender_protected_after_the_page_loaded_is_refused_by_the_server(
        three, monkeypatch):
    posted = []
    monkeypatch.setattr(unsub, "_post_one_click", lambda u: posted.append(u))
    body = {"grouping": "sender", "key": "deals@dealsdaily.example"}
    _protect("deals@dealsdaily.example")
    # the step with skip_protected is refused: nothing sent, nothing
    # recorded, no audit entry
    r = client.post("/api/unsubscribe?account=one",
                    json={**body, "skip_protected": True})
    assert r.status_code == 400 and r.json()["detail"] == "unsub_protected"
    assert posted == []
    assert "unsubscribe" not in _audited("one")
    assert unsubstore.load_account("one") == {}
    # a deliberate single unsubscribe from the detail view is unchanged
    ok = client.post("/api/unsubscribe?account=one", json=body)
    assert ok.status_code == 200 and len(posted) == 1


@pytest.mark.parametrize("action", ["trash", "archive"])
def test_trash_and_archive_with_skip_protected_never_touch_a_protected_sender(
        three, action):
    _protect("deals@dealsdaily.example")
    body = {"grouping": "sender", "keys": ["deals@dealsdaily.example"],
            "action": action, "skip_protected": True}
    r = client.post("/api/delete?account=one", json=body)
    assert r.status_code == 400 and r.json()["detail"] == "delete_protected"
    # force does not lift it on this path
    r = client.post("/api/delete?account=one", json={**body, "force": True})
    assert r.status_code == 400 and r.json()["detail"] == "delete_protected"
    assert not three["host-one"].mailbox["Trash"]
    assert not accountsmod.get("one").undo_log
    assert len(three["host-one"].mailbox["INBOX"]) == 14   # nothing moved


def test_the_ordinary_move_keeps_its_own_protection_rule(three):
    """Without skip_protected nothing changed: trash of a protected group
    needs force, archive is the user's deliberate move."""
    _protect("deals@dealsdaily.example")
    r = client.post("/api/delete?account=one", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"]})
    assert r.status_code == 400
    assert r.json()["detail"] == "all selected groups are protected"
    ok = client.post("/api/delete?account=one", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"],
        "action": "archive"})
    assert ok.status_code == 200 and ok.json()["queued"] == 5


def test_skip_protected_leaves_only_the_protected_group_out_of_a_selection(
        three):
    _protect("letter@gmail.com")
    r = client.post("/api/delete?account=one", json={
        "grouping": "sender", "action": "trash", "skip_protected": True,
        "keys": ["deals@dealsdaily.example", "letter@gmail.com"]})
    assert r.status_code == 200
    body = r.json()
    assert body["queued"] == 5 and body["skipped"] == 1
    _wait(accountsmod.get("one"))
    left = {m["from"] for m in three["host-one"].mailbox["INBOX"]}
    assert '"Free" <letter@gmail.com>' in left
    assert DEALS not in left


def test_pinned_mails_stay_in_the_per_account_trash_step(three):
    acc = accountsmod.get("one")
    with acc.lock:
        ids = [m["msgid"] for m in acc.index.values()
               if m["addr"] == "deals@dealsdaily.example"][:2]
    pinstore.set_many(set(ids), True, "one")
    r = client.post("/api/delete?account=one", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"],
        "skip_protected": True})
    assert r.json()["queued"] == 3 and r.json()["skipped_pinned"] == 2
    _wait(acc)
    assert len(three["host-one"].mailbox["Trash"]) == 3


def test_a_sender_is_blocked_in_each_account_on_its_own(three):
    """Block in N = one ordinary Block per account: a rule in THAT account,
    refused only where it already exists - blocking in one account never
    makes the next one "already blocked"."""
    body = {"grouping": "sender", "key": "deals@dealsdaily.example",
            "label": "Deals Daily"}
    for name in ("one", "two"):
        r = client.post(f"/api/block?account={name}", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["rule"]["account"] == name
    # the same account twice is still refused
    again = client.post("/api/block?account=one", json=body)
    assert again.status_code == 400 and again.json()["detail"] == "already blocked"
    rules = [r for r in cfg_rules() if r["origin"] == "block"]
    assert sorted(r["account"] for r in rules) == ["one", "two"]
    # the page knows which accounts block it already; the third does not
    deals = _row(_overview(), "dealsdaily.example")
    assert {a["account"]: a["blocked"] for a in deals["accounts"]} == {
        "one": True, "two": True, "three": False}
    # unblocking in one account (deleting its rule) leaves the other
    one = next(r for r in rules if r["account"] == "one")
    assert client.delete(f"/api/rules/{one['id']}").status_code == 200
    deals = _row(_overview(), "dealsdaily.example")
    assert {a["account"]: a["blocked"] for a in deals["accounts"]} == {
        "one": False, "two": True, "three": False}


def test_block_still_refuses_a_protected_sender_per_account(three):
    _protect("deals@dealsdaily.example")
    r = client.post("/api/block?account=two", json={
        "grouping": "sender", "key": "deals@dealsdaily.example"})
    assert r.status_code == 400 and "protected" in r.json()["detail"]
    assert not [x for x in cfg_rules() if x["origin"] == "block"]


def cfg_rules():
    from backend import rules as rulesmod
    return rulesmod.load_rules()


def test_a_failed_account_does_not_stop_the_others(three, monkeypatch):
    def post(url):
        raise RuntimeError("boom")
    monkeypatch.setattr(unsub, "_post_one_click", post)
    bad = client.post("/api/unsubscribe?account=one", json={
        "grouping": "sender", "key": "deals@dealsdaily.example"})
    assert bad.status_code >= 400
    # the next account's step still works
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    ok = client.post("/api/unsubscribe?account=two", json={
        "grouping": "sender", "key": "deals@dealsdaily.example"})
    assert ok.status_code == 200
    states = {a["account"]: a["state"]
              for a in _row(_overview(), "dealsdaily.example")["accounts"]}
    assert states["one"] in (None, "failed") and states["two"] == "done"
