"""The unsubscribe sheet's backend: the per-sender method preview (same
decision as the run), the per-run results and the trash scope offered with
it. Nothing here talks to a real server - the fake IMAP / SMTP only."""

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import unsub
from backend import unsubstore
from backend.main import app

from conftest import make_msg, wait_unsub_done

client = TestClient(app)

SHOP = "news@shop.example"        # https one-click (+ a mailto)
DHL = "noreply@dhl.example"       # plain https page, 3 mails in 2 folders
GADGET = "hello@gadget.example"   # mailto only


@pytest.fixture
def mailbox(bridge):
    bridge.mailbox["INBOX"].append(make_msg(
        5, frm='"Gadget Weekly" <hello@gadget.example>',
        subject="This week", unsub="<mailto:stop@gadget.example?subject=off>",
        size=7000))
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return bridge


def preview(keys, grouping="sender", single=False):
    return client.post("/api/unsubscribe/preview", json={
        "grouping": grouping, "keys": keys, "single": single})


@pytest.mark.parametrize("header,one_click,via", [
    ("<https://x.example/u>", True, "one_click"),
    ("<https://x.example/u>", False, "http"),
    ("<http://x.example/u>", True, "http"),          # one-click is https only
    ("<mailto:a@x.example>", False, "mailto"),
    ("<mailto:a@x.example>, <https://x.example/u>", False, "mailto"),
    ("<mailto:a@x.example>, <https://x.example/u>", True, "one_click"),
    ("", False, None),
    ("<ftp://x.example/u>", True, None),
])
def test_method_of_follows_the_run(header, one_click, via):
    assert unsub.method_of(unsub.parse_unsub(header, one_click)) == via


def test_preview_lists_the_method_per_sender(mailbox):
    r = preview([DHL, GADGET, SHOP])
    assert r.status_code == 200
    body = r.json()
    by = {s["addr"]: s for s in body["senders"]}
    assert [s["addr"] for s in body["senders"]] == [GADGET, SHOP, DHL]
    assert by[SHOP]["via"] == "one_click"
    assert by[GADGET]["via"] == "mailto"
    assert by[DHL]["via"] == "http"
    assert by[DHL]["name"] == "DHL Paket" and by[DHL]["mails"] == 3
    assert by[DHL]["size"] == 5000 + 4000 + 6000
    assert body["skipped_protected"] == body["skipped_done"] == 0
    assert body["skipped_no_header"] == 0


def test_preview_sends_and_writes_nothing(mailbox, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("preview must not act")
    monkeypatch.setattr(unsub, "_post_one_click", boom)
    monkeypatch.setattr(unsub, "_send_mailto", boom)
    assert preview([SHOP, GADGET, DHL]).status_code == 200
    assert unsubstore.load_account("default") == {}
    assert unsub.last_results()["items"] == []


def test_preview_mirrors_the_runs_skips(mailbox, monkeypatch):
    monkeypatch.setattr(unsub, "_send_mailto", lambda im, uri, name=None: None)
    cfgmod.update_config({"protected": [DHL]})
    unsubstore.record(SHOP, "done", "one-click POST", account="default")
    body = preview([SHOP, DHL, GADGET]).json()
    assert [s["addr"] for s in body["senders"]] == [GADGET]
    assert body["skipped_protected"] == 1 and body["skipped_done"] == 1
    # the run queues exactly what the preview listed
    r = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": [SHOP, DHL, GADGET]}).json()
    assert r["queued"] == 1 and r["skipped_protected"] == 1


def test_preview_counts_groups_without_a_header(mailbox):
    body = preview([SHOP, "alice@friends.example"]).json()
    assert [s["addr"] for s in body["senders"]] == [SHOP]
    assert body["skipped_no_header"] == 1


def test_preview_cap_matches_the_run(mailbox, monkeypatch):
    monkeypatch.setattr(unsub, "JOB_CAP", 1)
    body = preview([SHOP, DHL]).json()
    assert [s["addr"] for s in body["senders"]] == [SHOP] and body["capped"] == 1


def test_preview_single_is_the_detail_views_sender(mailbox):
    body = preview([SHOP], single=True).json()
    assert [(s["addr"], s["via"]) for s in body["senders"]] == \
        [(SHOP, "one_click")]
    # a protected sender is still offered: the explicit button never skipped
    cfgmod.update_config({"protected": [SHOP]})
    assert preview([SHOP], single=True).json()["senders"][0]["addr"] == SHOP
    assert preview([SHOP], single=True).json()["trash"]["groups"] == []


def test_preview_single_errors_are_coded(mailbox):
    r = preview(["alice@friends.example"], single=True)       # no header
    assert r.status_code == 400 and r.json()["detail"] == "unsub_no_method"
    r = preview(["nobody@x.example"], single=True)
    assert r.status_code == 400 and r.json()["detail"] == "unsub_unknown_group"


def test_preview_bad_grouping_and_empty_keys(mailbox):
    assert preview([DHL], grouping="nope").status_code == 400
    assert preview([]).status_code == 422


def test_preview_trash_scope_sender_groups(mailbox):
    body = preview([DHL, GADGET]).json()
    t = body["trash"]
    assert sorted(g["key"] for g in t["groups"]) == [GADGET, DHL]
    assert {g["key"]: g["addrs"] for g in t["groups"]} == {
        DHL: [DHL], GADGET: [GADGET]}
    assert t["mails"] == 4 and t["size"] == 5000 + 4000 + 6000 + 7000
    assert t["pinned"] == 0


def test_preview_trash_leaves_pinned_mails_out(mailbox):
    pinstore.set_pinned("<m1@shop.example>", True, "default")
    t = preview([DHL]).json()["trash"]
    assert [g["key"] for g in t["groups"]] == [DHL]
    assert t["mails"] == 2 and t["pinned"] == 1
    assert t["size"] == 4000 + 6000


def test_preview_trash_never_covers_protected_groups(mailbox):
    cfgmod.update_config({"protected": [DHL]})
    t = preview([DHL, GADGET]).json()["trash"]
    assert [g["key"] for g in t["groups"]] == [GADGET]


def test_preview_trash_only_when_the_group_is_all_theirs(mailbox):
    # a domain group holding a sender WITHOUT a header: trashing the group
    # would take that sender's mail too, so it is not offered
    mailbox.mailbox["INBOX"].append(make_msg(
        6, frm="Support <help@shop.example>", subject="Your ticket"))
    mailops.run_scan()
    body = preview(["shop.example"], grouping="domain").json()
    assert [s["addr"] for s in body["senders"]] == [SHOP]
    assert body["trash"]["groups"] == [] and body["trash"]["mails"] == 0


def test_bulk_run_reports_per_sender_results(mailbox, monkeypatch):
    def post(url):
        raise RuntimeError("endpoint down")
    monkeypatch.setattr(unsub, "_post_one_click", post)
    monkeypatch.setattr(unsub, "_send_mailto", lambda im, uri, name=None: None)
    r = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": [SHOP, GADGET, DHL]}).json()
    assert r["queued"] == 3 and r["run"]
    st = wait_unsub_done()
    assert st["seq"] == r["run"]
    res = client.get("/api/unsubscribe/results").json()
    assert res["run"] == r["run"]
    by = {i["addr"]: i for i in res["items"]}
    assert by[SHOP] == {"addr": SHOP, "status": "failed", "via": "one_click",
                        "link": "", "error": "unsub_failed"}
    assert by[GADGET]["status"] == "done" and by[GADGET]["via"] == "mailto"
    assert by[DHL]["status"] == "link" and by[DHL]["via"] == "http"
    assert by[DHL]["link"].startswith("https://dhl.example/")


def test_results_follow_the_newest_run_and_runs_are_numbered(mailbox,
                                                             monkeypatch):
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    a = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": [SHOP]}).json()["run"]
    wait_unsub_done()
    b = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": [DHL]}).json()["run"]
    wait_unsub_done()
    assert b == a + 1
    res = client.get("/api/unsubscribe/results").json()
    assert res["run"] == b and [i["addr"] for i in res["items"]] == [DHL]
    mailops.run_scan()          # a scan clears the counters, never the id
    assert mailops.STATE["unsub"]["seq"] == b


def test_single_unsubscribe_reports_how(mailbox, monkeypatch):
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    assert unsub.unsubscribe("sender", SHOP)["via"] == "one_click"
    assert unsub.unsubscribe("sender", DHL)["via"] == "http"


def test_results_are_per_account(mailbox):
    assert client.get("/api/unsubscribe/results?account=nope").status_code == 400
    assert accountsmod.get().unsub_results["items"] == []
