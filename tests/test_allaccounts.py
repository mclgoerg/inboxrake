"""The All accounts Overview (backend/allaccounts.py, GET
/api/accounts/overview): per-account cards, the sender join, tenant
separation, and the per-account steps the multi-account confirm runs (each
account's own unsubscribe, delete, undo and audit entry)."""

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
from backend import unsub
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)

DEALS = '"Deals Daily" <deals@dealsdaily.example>'
PROMO = '"Deals Daily" <promo@dealsdaily.example>'
UNSUB = dict(unsub="<https://dealsdaily.example/u>", unsub_post=True)
PAGE = dict(unsub="<https://dealsdaily.example/page>")


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
            + _mails('"Free" <letter@gmail.com>', 2, 20, **UNSUB)
            + _mails('"Boss" <keep@boss.example>', 2, 30, **UNSUB)
            + _mails('"Pal" <pal@pal.example>', 2, 40, **UNSUB)
            + [make_msg(50, frm='"Solo" <solo@solo.example>')],
            "Sent": [make_msg(90, frm="one@mine.example", subject="re",
                              to="pal@pal.example")],
            "Trash": []}),
        "host-two": FakeIMAP({
            "INBOX": _mails(DEALS, 3, 1, seen=True, **UNSUB)
            + _mails('"Free" <letter@gmail.com>', 1, 20, **UNSUB)
            + _mails('"Free" <other@gmail.com>', 4, 25, **UNSUB)
            + _mails('"Boss" <keep@boss.example>', 1, 30, **UNSUB)
            + _mails('"Pal" <pal@pal.example>', 1, 40, **UNSUB),
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


def test_cards_hold_each_accounts_own_numbers(three):
    body = _overview()
    by = {a["name"]: a for a in body["accounts"]}
    assert list(by) == ["one", "two", "three"]
    assert by["one"]["user"] == "one@mine.example"
    assert by["one"]["mails"] == 12 and by["two"]["mails"] == 10
    assert by["three"]["mails"] == 3
    assert by["one"]["senders"] == 5
    assert body["totals"] == {
        "mails": 25, "size": sum(a["size"] for a in body["accounts"]),
        "senders": sum(a["senders"] for a in body["accounts"])}
    assert all(a["scanned_ts"] and not a["failed"] for a in by.values())
    assert all(a["status"] == "done" for a in by.values())


def test_a_failed_scan_is_flagged_and_keeps_the_last_good_time(three,
                                                               monkeypatch):
    def boom(im, name=None):
        raise OSError("down")
    good = accountsmod.get("two").state["scanned_ts"]
    monkeypatch.setattr(mailops, "connect", boom)
    mailops.run_scan(accountsmod.get("two"))
    body = _overview()
    two = next(a for a in body["accounts"] if a["name"] == "two")
    assert two["failed"] and two["status"] == "error"
    assert two["scanned_ts"] in (good, accountsmod.get("two").prev_scan_ts)
    # the others are untouched
    assert not any(a["failed"] for a in body["accounts"] if a["name"] != "two")


def test_new_counts_from_the_remembered_visit_else_the_last_week(three):
    soon = time.time() + 400 * 86400        # the mails are a year old by then
    week = {a["name"]: a["new"]
            for a in allaccounts.build({}, now=soon)["accounts"]}
    assert week == {"one": 0, "two": 0, "three": 0}
    assert {a["name"]: a["new"]
            for a in _overview()["accounts"]} == {"one": 12, "two": 10,
                                                  "three": 3}
    assert {a["new_basis"] for a in _overview()["accounts"]} == {"week"}
    # a remembered visit counts from THAT account's moment, per account
    body = allaccounts.build({"one": 0, "two": soon}, now=soon)
    by = {a["name"]: a for a in body["accounts"]}
    assert by["one"]["new"] == 12 and by["two"]["new"] == 0
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
    assert "boss.example" not in keys and "keep@boss.example" not in keys
    assert "pal.example" not in keys and "pal@pal.example" not in keys
    assert "solo.example" not in keys


def test_a_sender_in_one_account_only_is_no_row(three):
    # promo@ alone would be a single-account match: drop the others
    rows = allaccounts.same_sender([
        {"account": "one", "addr": "a@shop.example", "name": "A", "count": 3,
         "size": 1, "unread": 3, "unsub": True, "state": None},
        {"account": "one", "addr": "b@shop.example", "name": "B", "count": 9,
         "size": 1, "unread": 9, "unsub": True, "state": None}])
    assert rows == []


def test_the_address_that_can_still_be_unsubscribed_stands_for_an_account():
    cands = [
        {"account": "one", "addr": "big@shop.example", "name": "Big",
         "count": 50, "size": 1, "unread": 0, "unsub": True, "state": "done"},
        {"account": "one", "addr": "small@shop.example", "name": "Small",
         "count": 4, "size": 1, "unread": 0, "unsub": True, "state": None},
        {"account": "two", "addr": "big@shop.example", "name": "Big",
         "count": 6, "size": 1, "unread": 0, "unsub": False, "state": None}]
    (row,) = allaccounts.same_sender(cands)
    one = next(a for a in row["accounts"] if a["account"] == "one")
    assert one["addr"] == "small@shop.example" and one["state"] is None
    assert row["match"] == "domain"
    # none can: the biggest stands in
    cands[1]["state"] = "done"
    (row,) = allaccounts.same_sender(cands)
    assert next(a for a in row["accounts"]
                if a["account"] == "one")["addr"] == "big@shop.example"


def test_already_unsubscribed_state_is_carried_per_account(three,
                                                           monkeypatch):
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    unsub.unsubscribe("sender", "deals@dealsdaily.example",
                      accountsmod.get("two"))
    deals = _row(_overview(), "dealsdaily.example")
    states = {a["account"]: a["state"] for a in deals["accounts"]}
    assert states == {"one": None, "two": "done", "three": None}


def test_the_aggregate_is_read_only(three):
    before = [json.dumps(mailops.public_state(accountsmod.get(n))["groups"]
                         ["sender"], sort_keys=True)
              for n in ("one", "two", "three")]
    _overview()
    _overview(since={"one": 0})
    after = [json.dumps(mailops.public_state(accountsmod.get(n))["groups"]
                        ["sender"], sort_keys=True)
             for n in ("one", "two", "three")]
    assert before == after


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
    # an unknown one - the multi-account confirm cannot reach it
    assert bob.post("/api/unsubscribe?account=alices-secret-name", json={
        "grouping": "sender", "key": "x@y.example"}).status_code == 400
    assert bob.post("/api/delete?account=alices-secret-name", json={
        "grouping": "sender", "keys": ["x@y.example"]}).status_code == 400


def test_signed_out_users_get_nothing_in_login_mode():
    cfgmod.update_config({"auth": {"mode": "password", "password": "pw-1234567"}})
    r = TestClient(app).get("/api/accounts/overview")
    assert r.status_code == 401


# ----------------------------------------------- the steps the confirm runs

def test_each_account_runs_its_own_step_with_its_own_undo_and_audit(
        three, monkeypatch):
    posted = []
    monkeypatch.setattr(unsub, "_post_one_click", lambda u: posted.append(u))
    # what the confirm does for the ticked accounts "one" and "two": a preview
    # and a single unsubscribe, then (the box ticked) a Trash move - each
    # pinned to its account by ?account=
    for name in ("one", "two"):
        p = client.post(f"/api/unsubscribe/preview?account={name}", json={
            "grouping": "sender", "keys": ["deals@dealsdaily.example"],
            "single": True}).json()
        assert [s["addr"] for s in p["senders"]] == ["deals@dealsdaily.example"]
        assert p["senders"][0]["via"] == "one_click"
        r = client.post(f"/api/unsubscribe?account={name}", json={
            "grouping": "sender", "key": "deals@dealsdaily.example"})
        assert r.status_code == 200 and r.json()["action"] == "done"
        d = client.post(f"/api/delete?account={name}", json={
            "grouping": "sender", "keys": ["deals@dealsdaily.example"],
            "only_addrs": ["deals@dealsdaily.example"]})
        assert d.status_code == 200
        wait_delete_done_for(accountsmod.get(name))
    assert len(posted) == 2
    # the unticked account is untouched: no mail moved, nothing recorded
    assert len(three["host-three"].mailbox["Trash"]) == 0
    assert len(accountsmod.get("three").undo_log) == 0
    # each ticked account has its own undo step and its own audit entries
    for name, mails in (("one", 5), ("two", 3)):
        acc = accountsmod.get(name)
        assert len(acc.undo_log) == 1 and acc.undo_log[0]["count"] == mails
        assert len(three[f"host-{name}"].mailbox["Trash"]) == mails
    for name in ("one", "two"):
        assert {"unsubscribe", "trash"} <= _audited(name)
    assert not _audited("three") & {"unsubscribe", "trash"}
    # undoing one account's step leaves the other's in place
    mailops.undo_last(acc=accountsmod.get("one"))
    assert len(accountsmod.get("two").undo_log) == 1
    assert len(three["host-two"].mailbox["Trash"]) == 3


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


def _audited(name):
    return {e["action"] for e in auditlog.load(name, 0, 1000)["entries"]}


def wait_delete_done_for(acc, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["delete"]["status"] != "running" \
                    and not acc.delete_pending and not acc.inflight:
                return
        time.sleep(0.01)
    raise TimeoutError("delete job did not finish")
