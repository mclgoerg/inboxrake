"""The lists across accounts (backend/allaccounts.py: GET /api/accounts/senders,
/api/accounts/mails, /api/accounts/search): the same sender in several accounts
is one row with one part per account, the flat mail list and the search merge
every account, another user's accounts never appear, and the per-account calls
the selection actions are made of keep working per account (own Undo + audit,
a failure is isolated, an unticked account is never touched)."""

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
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

DEALS = '"Deals Daily" <deals@dealsdaily.example>'
ONLY = '"Only Here" <only@one.example>'
UNSUB = dict(unsub="<https://dealsdaily.example/u>", unsub_post=True)
ADMIN = "admin@corp.example"


def _mails(frm, n, start=1, **kw):
    return [make_msg(start + i, frm=frm, subject=f"offer {i}",
                     msgid=f"<{frm[-12:-1]}-{start + i}@x.example>", **kw)
            for i in range(n)]


@pytest.fixture
def three(monkeypatch):
    """Three accounts. Deals Daily writes to one (5 mails, 2 unread-less) and
    two (3, all read) from the same address; a protected sender is in both;
    one sender exists only in one; three holds only a different sender."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({
        "accounts": {n: {"host": f"host-{n}", "user": f"{n}@mine.example",
                         "password": "pw"} for n in ("one", "two", "three")},
        "protected": ["keep@boss.example"]}))
    fakes = {
        "host-one": FakeIMAP({
            "INBOX": _mails(DEALS, 5, 1, **UNSUB)
            + _mails('"Boss" <keep@boss.example>', 2, 30)
            + _mails(ONLY, 2, 40, size=5000),
            "Sent": [], "Trash": []}),
        "host-two": FakeIMAP({
            "INBOX": _mails(DEALS, 3, 1, seen=True, **UNSUB)
            + _mails('"Boss" <keep@boss.example>', 1, 30),
            "Sent": [], "Trash": []}),
        "host-three": FakeIMAP({
            "INBOX": _mails('"Else" <else@three.example>', 4, 1),
            "Sent": [], "Trash": []}),
    }
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    for n in ("one", "two", "three"):
        mailops.run_scan(accountsmod.get(n))
    return fakes


def _senders(c=client):
    r = c.get("/api/accounts/senders")
    assert r.status_code == 200
    return r.json()


def _row(body, key):
    return next(r for r in body["senders"] if r["key"] == key)


# --------------------------------------------------------------- senders

def test_the_same_address_in_several_accounts_is_one_row(three):
    body = _senders()
    keys = [r["key"] for r in body["senders"]]
    assert len(keys) == len(set(keys))
    deals = _row(body, "deals@dealsdaily.example")
    assert deals["count"] == 8
    assert deals["unread"] == 5
    assert deals["size"] == 8 * 1000
    assert {p["account"]: p["count"] for p in deals["accounts"]} == {
        "one": 5, "two": 3}
    assert [p["account"] for p in deals["accounts"]] == ["one", "two"]
    assert deals["label"] == "Deals Daily"
    assert deals["unsub"] is True
    # a sender in one account only keeps its single part
    only = _row(body, "only@one.example")
    assert [p["account"] for p in only["accounts"]] == ["one"]
    assert only["count"] == 2


def test_rows_are_sorted_by_summed_mails(three):
    counts = [r["count"] for r in _senders()["senders"]]
    assert counts == sorted(counts, reverse=True)
    assert _senders()["senders"][0]["key"] == "deals@dealsdaily.example"


def test_accounts_carry_what_the_ui_follows(three):
    body = _senders()
    by = {a["name"]: a for a in body["accounts"]}
    assert list(by) == ["one", "two", "three"]
    assert all(a["status"] == "done" and a["scanned_ts"] for a in by.values())
    assert by["one"]["rev"] == accountsmod.get("one").state["groups_rev"]


def test_protection_is_per_sender_but_the_row_says_so(three):
    boss = _row(_senders(), "keep@boss.example")
    assert boss["protected"] is True
    assert all(p["protected"] for p in boss["accounts"])
    deals = _row(_senders(), "deals@dealsdaily.example")
    assert deals["protected"] is False
    assert not any(p["protected"] for p in deals["accounts"])


def test_pinned_mails_are_summed_and_per_part(three):
    r = client.post("/api/pin?account=one", json={
        "folder": "INBOX", "uid": 1, "pinned": True})
    assert r.status_code == 200
    deals = _row(_senders(), "deals@dealsdaily.example")
    assert deals["pinned"] == 1
    assert {p["account"]: p["pinned"] for p in deals["accounts"]} == {
        "one": 1, "two": 0}


def test_the_grade_stays_per_account(three):
    deals = _row(_senders(), "deals@dealsdaily.example")
    assert "grade" not in deals
    assert all(p["grade"] in "ABCDF" for p in deals["accounts"])


def test_an_unscanned_account_just_has_no_rows(three):
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["four"] = {"host": "host-four", "user": "f@mine.example",
                               "password": "pw"}
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))
    body = _senders()
    assert [a["name"] for a in body["accounts"]] == [
        "one", "two", "three", "four"]
    assert not any(p["account"] == "four"
                   for r in body["senders"] for p in r["accounts"])


def test_a_verdict_in_one_account_is_the_cautious_one(three):
    for name, verdict in (("one", "keep"), ("two", "delete_safe")):
        r = client.put(f"/api/labels?account={name}", json={
            "key": "deals@dealsdaily.example", "verdict": verdict})
        assert r.status_code == 200, r.text
    deals = _row(_senders(), "deals@dealsdaily.example")
    assert deals["ai"]["verdict"] == "keep"
    assert {p["account"]: p["verdict"] for p in deals["accounts"]} == {
        "one": "keep", "two": "delete_safe"}


def test_unsubscribe_state_is_combined(three, monkeypatch):
    from backend import unsub
    monkeypatch.setattr(unsub, "_post_one_click", lambda u: None)
    assert _row(_senders(), "deals@dealsdaily.example")["unsubscribed"] is None
    client.post("/api/unsubscribe?account=one", json={
        "grouping": "sender", "key": "deals@dealsdaily.example"})
    row = _row(_senders(), "deals@dealsdaily.example")
    # done in one of the two accounts: the row is still open
    assert row["unsubscribed"]["status"] == "pending"
    assert (row["unsubscribed"]["n"], row["unsubscribed"]["of"]) == (1, 2)
    client.post("/api/unsubscribe?account=two", json={
        "grouping": "sender", "key": "deals@dealsdaily.example"})
    row = _row(_senders(), "deals@dealsdaily.example")
    assert row["unsubscribed"]["status"] == "done"
    assert {p["account"]: p["unsubscribed"] for p in row["accounts"]} == {
        "one": "done", "two": "done"}


# ----------------------------------------------------------------- mails

def _mail_page(c=client, **params):
    r = c.get("/api/accounts/mails", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_flat_list_merges_every_account(three):
    body = _mail_page(limit=100)
    assert body["total"] == 9 + 4 + 4
    assert len(body["mails"]) == 17
    assert {m["account"] for m in body["mails"]} == {"one", "two", "three"}
    # the same (folder, uid) in two accounts stays two mails
    keys = {(m["account"], m["folder"], m["uid"]) for m in body["mails"]}
    assert len(keys) == 17


def test_the_merge_is_in_the_asked_order_and_pages_are_stable(three):
    one = _mail_page(sort="size", dir="desc", limit=100)
    sizes = [m["size"] for m in one["mails"]]
    assert sizes == sorted(sizes, reverse=True)
    pages = []
    for off in range(0, 17, 5):
        pages += _mail_page(sort="size", dir="desc", offset=off,
                            limit=5)["mails"]
    assert [(m["account"], m["uid"]) for m in pages] \
        == [(m["account"], m["uid"]) for m in one["mails"]]
    asc = _mail_page(sort="sender", dir="asc", limit=100)["mails"]
    addrs = [m["addr"] for m in asc]
    assert addrs == sorted(addrs)


def test_the_flat_list_filters_like_one_account(three):
    only_read = _mail_page(q="is:read", limit=100)
    assert only_read["total"] == 3
    assert {m["account"] for m in only_read["mails"]} == {"two"}
    assert _mail_page(q="from:else@three.example")["total"] == 4
    ignored = _mail_page(q="tag:x")["ignored"]
    assert ignored == ["tag:x"]


def test_a_single_accounts_list_is_what_it_was(three):
    r = client.get("/api/mails", params={"account": "two", "limit": 100})
    assert r.json()["total"] == 4
    assert all("account" not in m for m in r.json()["mails"])


def test_pins_are_per_account_in_the_flat_list(three):
    client.post("/api/pin?account=two", json={
        "folder": "INBOX", "uid": 1, "pinned": True})
    pinned = _mail_page(q="has:pinned", limit=100)
    assert [(m["account"], m["uid"]) for m in pinned["mails"]] == [("two", 1)]
    assert pinned["mails"][0]["pinned"] is True


def test_only_narrows_the_list_to_one_account(three):
    body = _mail_page(only="two", limit=100)
    assert body["total"] == 4
    assert {m["account"] for m in body["mails"]} == {"two"}
    assert client.get("/api/accounts/mails",
                      params={"only": "nope"}).status_code == 400


def test_a_bad_slot_is_a_400(three):
    r = client.get("/api/accounts/mails", params={"slot": "x-y"})
    assert r.status_code == 400


# ---------------------------------------------------------------- search

def test_search_spans_the_accounts_and_tags_each_hit(three):
    body = client.get("/api/accounts/search", params={"q": "dealsdaily"}).json()
    assert {m["account"] for m in body["mails"]} == {"one", "two"}
    assert len(body["mails"]) == 8
    assert body["notes"] == []
    stamps = [m["ts"] for m in body["mails"]]
    assert stamps == sorted(stamps, reverse=True)
    assert client.get("/api/accounts/search",
                      params={"q": "x"}).json()["mails"] == []


def test_body_search_follows_each_accounts_own_setting(three, monkeypatch):
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["two"]["body_search"] = "disabled"
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))
    calls = []

    def fake_body(q, limit=500, acc=None, budget=None):
        calls.append((acc.name, budget))
        return {"mails": mailops.search_mails(q, limit, acc=acc),
                "notes": [{"key": "partial", "params": {}}]}
    monkeypatch.setattr(mailops, "search_body", fake_body)
    body = client.get("/api/accounts/search",
                      params={"q": "offer", "scope": "body"}).json()
    assert [c[0] for c in calls] == ["one", "three"]
    assert all(b == pytest.approx(mailops.BODY_SEARCH_BUDGET_S / 3)
               for _, b in calls)
    notes = {(n["key"], n["account"]) for n in body["notes"]}
    assert ("body_off", "two") in notes and ("partial", "one") in notes
    # the disabled account still answered from the metadata
    assert {m["account"] for m in body["mails"]} >= {"one", "two"}


def test_one_failing_account_is_a_note_not_a_failure(three, monkeypatch):
    real = mailops.search_mails

    def flaky(q, limit=500, acc=None, subjects=True):
        if acc.name == "one":
            raise RuntimeError("boom")
        return real(q, limit, acc=acc, subjects=subjects)
    monkeypatch.setattr(mailops, "search_mails", flaky)
    body = client.get("/api/accounts/search", params={"q": "offer"}).json()
    assert {m["account"] for m in body["mails"]} == {"two", "three"}
    assert body["notes"] == [{"key": "account_failed", "params": {},
                              "account": "one"}]
    assert "boom" not in json.dumps(body)


# ------------------------------------------------------ tenant separation

def _client_as(sub):
    c = TestClient(app)
    c.cookies.set("pmc_session", authmod.make_session(sub))
    return c


def test_another_users_accounts_never_appear_in_any_list():
    cfgmod.update_config({"auth": {
        "mode": "oidc", "admin": ADMIN,
        "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                 "client_secret": "sst"}}})
    alice, bob = _client_as("alice@x.example"), _client_as("bob@y.example")
    alice.post("/api/config", json={
        "account": "default", "imap": {"host": "imap.alice.example"}})
    alice.post("/api/config", json={
        "rename_account": {"from": "default", "to": "alices-secret-name"}})
    for c, own in ((alice, "alices-secret-name"), (bob, "default")):
        names = [a["name"] for a in c.get("/api/accounts/senders")
                 .json()["accounts"]]
        assert names == [own]
    for path in ("senders", "mails", "search?q=anything"):
        body = bob.get(f"/api/accounts/{path}")
        assert body.status_code == 200
        assert "alices-secret-name" not in body.text
    # naming another user's account is refused like an unknown one
    probe = bob.get("/api/accounts/mails", params={"only": "alices-secret-name"})
    assert probe.status_code == 400


def test_signed_out_users_get_nothing_in_login_mode():
    cfgmod.update_config({"auth": {"mode": "password",
                                   "password": "pw-1234567"}})
    anon = TestClient(app)
    for path in ("senders", "mails", "search?q=anything"):
        assert anon.get(f"/api/accounts/{path}").status_code == 401


def test_the_merge_reads_the_current_tenants_accounts_only(three, monkeypatch):
    """The aggregate asks the tenant-scoped account list, never the registry
    of every tenant: with the list narrowed to one name only that account is
    read."""
    monkeypatch.setattr(accountsmod, "names", lambda: ["two"])
    body = _senders()
    assert [a["name"] for a in body["accounts"]] == ["two"]
    assert {p["account"] for r in body["senders"] for p in r["accounts"]} \
        == {"two"}
    assert {m["account"] for m in _mail_page(limit=100)["mails"]} == {"two"}


# ------------------------------------------ the per-account steps (actions)

def _wait(acc, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["delete"]["status"] != "running" \
                    and not acc.delete_pending and not acc.inflight:
                return
        time.sleep(0.01)
    raise TimeoutError("delete job did not finish")


def _scanned(acc, timeout=10.0):
    """An undo re-reads the account in the background: wait for that scan, or
    the combined list is read while the account is still being scanned."""
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["status"] != "scanning":
                return
        time.sleep(0.01)
    raise TimeoutError("scan did not finish")


def _audited(name):
    return {e["action"] for e in auditlog.load(name, 0, 1000)["entries"]}


def test_a_selection_runs_one_step_per_ticked_account(three):
    """What the multi-account confirm does for "Trash" on the row of Deals
    Daily with the accounts one and two ticked and three unticked: one
    ordinary /api/delete per account, each with its own undo and audit
    entry; the unticked account is never called."""
    for name in ("one", "two"):
        d = client.post(f"/api/delete?account={name}", json={
            "grouping": "sender", "keys": ["deals@dealsdaily.example"]})
        assert d.status_code == 200
        _wait(accountsmod.get(name))
    assert len(three["host-one"].mailbox["Trash"]) == 5
    assert len(three["host-two"].mailbox["Trash"]) == 3
    assert len(three["host-three"].mailbox["Trash"]) == 0
    for name, n in (("one", 5), ("two", 3)):
        undo = accountsmod.get(name).undo_log
        assert len(undo) == 1 and undo[0]["count"] == n
        assert "trash" in _audited(name)
    assert accountsmod.get("three").undo_log == []
    assert "trash" not in _audited("three")
    # the list follows: the row is gone from the combined view
    assert "deals@dealsdaily.example" not in {
        r["key"] for r in _senders()["senders"]}
    # undoing one account's step leaves the other's in place
    mailops.undo_last(acc=accountsmod.get("one"))
    _scanned(accountsmod.get("one"))
    assert len(three["host-two"].mailbox["Trash"]) == 3
    assert _row(_senders(), "deals@dealsdaily.example")["count"] == 5


def test_a_protected_sender_is_refused_per_account(three):
    r = client.post("/api/delete?account=one", json={
        "grouping": "sender", "keys": ["keep@boss.example"]})
    assert r.status_code >= 400
    assert len(three["host-one"].mailbox["Trash"]) == 0


def test_pinned_mails_stay_in_the_per_account_move(three):
    client.post("/api/pin?account=one", json={
        "folder": "INBOX", "uid": 1, "pinned": True})
    d = client.post("/api/delete?account=one", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"]})
    assert d.status_code == 200
    _wait(accountsmod.get("one"))
    assert len(three["host-one"].mailbox["Trash"]) == 4
    assert _row(_senders(), "deals@dealsdaily.example")["count"] == 4


def test_a_failing_account_does_not_stop_the_next(three, monkeypatch):
    real = three["host-one"]

    class Down(Exception):
        pass

    def conn(im, name=None):
        if im["host"] == "host-one":
            raise Down("down")
        return three[im["host"]]
    monkeypatch.setattr(mailops, "connect", conn)
    bad = client.post("/api/delete?account=one", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"]})
    _wait(accountsmod.get("one"))
    assert len(real.mailbox["Trash"]) == 0
    ok = client.post("/api/delete?account=two", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"]})
    assert ok.status_code == 200
    _wait(accountsmod.get("two"))
    assert len(three["host-two"].mailbox["Trash"]) == 3
    assert bad.status_code in (200, 409, 500)


def test_a_per_account_call_for_an_unknown_account_is_refused(three):
    r = client.post("/api/delete?account=nope", json={
        "grouping": "sender", "keys": ["deals@dealsdaily.example"]})
    assert r.status_code == 400
    assert len(three["host-one"].mailbox["Trash"]) == 0


def test_the_overview_rows_carry_rev_and_busy(three):
    rows = client.get("/api/accounts/overview").json()["accounts"]
    assert all(isinstance(a["rev"], int) and a["busy"] is False for a in rows)
    acc = accountsmod.get("two")
    with acc.lock:
        acc.state["delete"]["status"] = "running"
    try:
        by = {a["name"]: a for a in
              client.get("/api/accounts/overview").json()["accounts"]}
        assert by["two"]["busy"] is True and by["one"]["busy"] is False
    finally:
        with acc.lock:
            acc.state["delete"]["status"] = "idle"


def test_merge_sender_in_isolation():
    def rec(count, **kw):
        base = {"key": "a@x.example", "label": "A", "sub": "a@x.example",
                "count": count, "size": count * 10, "unread": count // 2,
                "first": "2025-01-05", "last": "2025-03-01", "tags": ["x"],
                "samples": ["s"], "bulk": False, "unsub": False, "ai": None,
                "ratings": None, "protected": False, "replied": False,
                "att_size": 0, "unsubscribed": None, "new": False,
                "pinned": 0, "engagement": 40}
        return {**base, **kw}
    row = allaccounts.merge_sender([
        ("b", rec(2, first="2024-12-01", last="2025-02-01", new=True,
                  tags=["y", "x"], engagement=100)),
        ("a", rec(6, replied=True, protected=True)),
    ])
    assert [p["account"] for p in row["accounts"]] == ["a", "b"]
    assert row["count"] == 8 and row["size"] == 80
    assert row["first"] == "2024-12-01" and row["last"] == "2025-03-01"
    assert row["tags"] == ["x", "y"]
    assert row["new"] and row["replied"] and row["protected"]
    assert row["engagement"] == round((40 * 6 + 100 * 2) / 8)
    assert row["ai"] is None and row["unsubscribed"] is None
