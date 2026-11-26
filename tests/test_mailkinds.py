"""What they send (backend/mailkinds.py and what hangs on the kind): the kind
of every mail, read from the subject; the kind stored in the scan index and
the snapshot; the per-mail filter word `kind:`; "Protect these N"
(`/api/pin_mails`); and the rule's third retention choice "only <kind>"
(exclusive with the other two, report-only start, bound to the report it was
checked in, Keep-safe on its runs, one step with Undo)."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailkinds, mailops, mcptools, pinstore, rulecheck
from backend import rules as rulesmod
from backend import smartkinds as sk
from backend import tenants
from backend.main import app

from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)

SHOP = "shop@acme.example"
FROM_SHOP = f'"ACME Store" <{SHOP}>'
UNSUB = "<mailto:unsub@acme.example>"


def kind(subject, addr=SHOP, unsub=False):
    return mailkinds.kind_of(subject, addr, unsub)


# ------------------------------------------------------ what a subject is

KINDS = [
    # order confirmations
    ("Your order 77243 is confirmed", False, "orders"),
    ("Order confirmation #123", True, "orders"),
    ("Bestellung 4711 eingegangen", True, "orders"),
    ("Thank you for your purchase", True, "orders"),
    # "received, will be shipped soon" is the order's confirmation, not a
    # shipping update
    ("Your order #12345 has been received and will be shipped soon", True,
     "orders"),
    # shipping updates
    ("Your order has shipped", True, "shipping"),
    ("Your parcel is out for delivery", False, "shipping"),
    ("Ihr Paket wurde versendet", True, "shipping"),
    ("Delivered: order #88", False, "shipping"),
    # invoices and receipts
    ("Invoice 2026-11", True, "invoices"),
    ("Rechnung Nr. 5512", False, "invoices"),
    ("Your receipt - order 88213", True, "invoices"),
    ("Kontoauszug Juni", True, "invoices"),
    # the other purposes
    ("Reminder: your appointment on 12 Nov", True, "appointments"),
    ("Your booking for 3 Dec", False, "appointments"),
    ("Your application was received", False, "jobs"),
    ("Interview invitation", False, "jobs"),
    ("Your support ticket #4412", False, "support"),
    ("Your sign-in code is 123456", True, "accounts"),
    ("Neue Anmeldung erkannt", True, "accounts"),
    ("Privacy policy update", True, "accounts"),
    ("Welcome to the shop", False, "accounts"),
    # ads and offers: newsletter-style mail that has no purpose
    ("Autumn collection is here", True, "ads"),
    ("20% off everything this weekend", False, "ads"),
    ("Neu im Shop: Herbstkollektion", True, "ads"),
    ("Deal ends at midnight", True, "ads"),
    ("Your discount code: SAVE20", True, "ads"),
    ("Weekly digest", True, "ads"),
]


@pytest.mark.parametrize("subject,unsub,want", KINDS)
def test_the_kind_of_a_subject(subject, unsub, want):
    assert kind(subject, unsub=unsub) == want


def test_every_kind_is_reached_and_listed():
    assert {w for _s, _u, w in KINDS} == set(mailkinds.KINDS)
    assert len(set(mailkinds.KINDS)) == len(mailkinds.KINDS)
    assert all(mailkinds.valid(k) for k in mailkinds.KINDS)
    assert not mailkinds.valid("") and not mailkinds.valid("bogus")
    assert not mailkinds.valid(None) and not mailkinds.valid(["ads"])


# Mail a List-Unsubscribe sender may well send that is NOT marketing. None of
# it may become "ads": an order confirmation in "Ads and offers" would be one
# click from the Trash.
NEVER_ADS = [
    "Order confirmation #12345", "Your order #12345", "Your order is confirmed",
    "Thank you for your order", "Bestellbestätigung 12345",
    "We received your order #12345", "Order placed: #12345 - shipping soon",
    "Vielen Dank für Ihren Einkauf, Bestellung 12345 wird versendet",
    "Invoice for order #12345", "Rechnung 12345", "Payment received",
    "Zahlungsbestätigung", "Stromrechnung November", "Kontoauszug Juni",
    "Your order #12345 has shipped", "Your parcel arrives tomorrow",
    "Your parcel is in transit", "Delivery attempt failed",
    "Ihre Sendung ist unterwegs", "Your package was delivered",
    "Return label for order #12345", "Refund for your order #12345",
    "Your booking is confirmed", "Your tickets for Friday",
    "Reminder: your appointment on 12 Nov", "Terminbestätigung 12.11.",
    "Your sign-in code", "Verify your email address",
    "Your verification code is 123456", "Password changed",
    "Your subscription renews tomorrow", "Your monthly statement is ready",
    "Security alert: new sign-in", "Your application was received",
    "Confirm your registration", "Order now and get free delivery",
    "How was your order?", "Please rate your purchase",
    "Order confirmation - 20% off your next order",
    # nothing transactional in the words, but pastdate has read it as a
    # reminder, a thank-you (a receipt) or a code
    "Reminder: webinar on 3 Dec", "Your table on Friday",
    "Don't forget your visit tomorrow", "Thank you for joining us",
    "Thanks for shopping with us", "Danke für Ihren Besuch",
    "Your one-time passcode", "Your magic link",
]


@pytest.mark.parametrize("subject", NEVER_ADS)
@pytest.mark.parametrize("unsub", [True, False])
def test_what_is_no_ad_never_lands_in_ads(subject, unsub):
    assert kind(subject, unsub=unsub) != "ads"
    # nor from a sender that is a shop under another name
    assert kind(subject, "orders@another-shop.example", unsub) != "ads"


def test_a_plain_mail_without_a_newsletter_header_is_no_ad():
    assert kind("Autumn collection is here", unsub=False) == ""
    assert kind("Autumn collection is here", unsub=True) == "ads"


def test_a_biller_is_never_an_ad():
    assert kind("Weekly news", "news@stadtwerke.example", True) == ""
    assert kind("Stromrechnung November", "kunde@stadtwerke.example",
                True) == "invoices"


def test_people_have_no_kind():
    for subject in ("Your order is confirmed", "20% off", "Weekly digest",
                    "Your booking for 3 Dec"):
        for addr in ("friend@gmail.com", "x@outlook.de", "y@web.de"):
            assert kind(subject, addr, True) == ""


def test_an_automatic_notification_is_no_ad():
    assert kind("[repo] new issue", "ci@forge.example", True) == ""
    assert kind("Re: [list] weekly sync", "ci@forge.example", True) == ""


def test_two_purposes_are_no_kind():
    assert kind("Your order and your support ticket #4412") == ""
    assert kind("Your order has shipped - invoice attached") == ""
    assert kind("Your application and your appointment on 12 Nov") == ""


def test_a_return_or_refund_is_no_shipping_update():
    assert kind("Return label for order #12345") == ""
    assert kind("Refund for your order #123") == ""
    assert kind("Your parcel was returned to us") != "shipping"


def test_a_ticket_sellers_orders_are_bookings():
    assert kind("Order #5 confirmed", "x@tickets.example") == "appointments"
    assert kind("Your order has shipped", "x@tickets.example") == "appointments"


def test_no_subject_no_kind():
    assert kind("") == "" and kind("   ") == ""
    assert mailkinds.kind_of(None, SHOP, True) == ""


def test_a_sender_without_a_domain_has_no_kind():
    assert kind("20% off", "", True) == ""
    assert kind("20% off", "(unparseable sender)", True) == ""


def test_smartkinds_still_reads_the_same_purposes():
    """`message_rule_hits` is the per-rule view of `message_purposes`."""
    for subject in ("Your order has shipped", "Invoice 12", "Welcome",
                    "Your support ticket #4412", "Weekly digest"):
        for hint in ("", "p", "b", "t", "pt"):
            hits = sk.message_rule_hits(subject, hint)
            assert {p for p, _r in hits} == sk.message_purposes(subject, hint)


# ----------------------------------------------- the record in the index

def test_of_trusts_a_stored_kind_and_works_out_a_missing_one():
    m = {"subject": "20% off", "addr": SHOP, "unsub": UNSUB}
    assert mailkinds.of(m) == "ads"
    assert mailkinds.of({**m, "kind": "orders"}) == "orders"    # stored wins
    assert mailkinds.of({**m, "kind": ""}) == ""                # "none" stays
    assert mailkinds.of({**m, "kind": "bogus"}) == "ads"        # unusable
    assert mailkinds.of({**m, "kind": None}) == "ads"
    assert mailkinds.of({"subject": "x"}) == ""                 # no sender


def test_stamp_fills_only_what_is_missing():
    a = {"subject": "20% off", "addr": SHOP, "unsub": UNSUB}
    b = {"subject": "20% off", "addr": SHOP, "unsub": UNSUB, "kind": "jobs"}
    c = {"subject": "20% off", "addr": SHOP, "unsub": UNSUB, "kind": "x"}
    mailkinds.stamp([a, b, c])
    assert (a["kind"], b["kind"], c["kind"]) == ("ads", "jobs", "ads")


def shop_box(monkeypatch, extra=()):
    """One shop that sends four kinds, one friend; scanned."""
    inbox = [
        make_msg(1, frm=FROM_SHOP, subject="Autumn collection is here",
                 unsub=UNSUB, size=3000),
        make_msg(2, frm=FROM_SHOP, subject="20% off everything this weekend",
                 unsub=UNSUB, size=4000),
        make_msg(3, frm=FROM_SHOP, subject="Weekly digest", unsub=UNSUB,
                 size=5000, seen=True),
        make_msg(4, frm=FROM_SHOP, subject="Order confirmation #7701",
                 unsub=UNSUB, size=6000, seen=True),
        make_msg(5, frm=FROM_SHOP, subject="Your order 7702 is confirmed",
                 size=7000, seen=True),
        make_msg(6, frm=FROM_SHOP, subject="Your order #7701 has shipped",
                 size=8000, seen=True),
        make_msg(7, frm=FROM_SHOP, subject="Invoice for order #7701",
                 size=9000, seen=True),
        make_msg(8, frm=FROM_SHOP, subject="Something else entirely",
                 size=1000, seen=True),
        make_msg(20, frm="Alice <alice@friends.example>",
                 subject="Hello", size=2000, seen=True),
        *extra,
    ]
    fake = FakeIMAP({"INBOX": inbox, "Archive": [], "Sent": [], "Trash": [],
                     "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


EXPECTED = {1: "ads", 2: "ads", 3: "ads", 4: "orders", 5: "orders",
            6: "shipping", 7: "invoices", 8: "", 20: ""}


def uid_kinds():
    acc = accountsmod.get()
    return {m["uid"]: m["kind"] for m in acc.index.values()}


def test_a_scan_stores_the_kind_of_every_mail(monkeypatch):
    shop_box(monkeypatch)
    assert uid_kinds() == EXPECTED
    # stored: the record carries it, `kind` is never absent after a scan
    acc = accountsmod.get()
    assert all("kind" in m for m in acc.index.values())


def test_the_group_listing_carries_the_kind(monkeypatch):
    shop_box(monkeypatch)
    rows = client.get("/api/group", params={"grouping": "sender",
                                            "key": SHOP}).json()
    assert {m["uid"]: m["kind"] for m in rows} == {
        u: k for u, k in EXPECTED.items() if u != 20}


def test_the_snapshot_keeps_the_kinds_and_their_version(monkeypatch):
    shop_box(monkeypatch)
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    assert data["kinds_version"] == mailkinds.VERSION
    assert {m["uid"]: m["kind"] for m in data["index"]} == EXPECTED
    # a restart reads them back as stored (the stored one is trusted: made-up
    # here to prove it is read, not worked out again)
    for m in data["index"]:
        if m["uid"] == 1:
            m["kind"] = "jobs"
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    assert {m["uid"]: m["kind"] for m in acc2.index.values()}[1] == "jobs"


def test_a_snapshot_of_other_patterns_drops_its_stored_kinds(monkeypatch):
    shop_box(monkeypatch)
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    for bad in (None, mailkinds.VERSION - 1, mailkinds.VERSION + 1):
        data = json.loads(path.read_text())
        data["kinds_version"] = bad
        if bad is None:
            data.pop("kinds_version")
        for m in data["index"]:
            m["kind"] = "jobs"                    # what old patterns said
        path.write_text(json.dumps(data))
        accountsmod.reset()
        acc2 = accountsmod.get()
        assert mailops.load_snapshot(acc2)
        # nothing stored is left: every record reads its kind afresh
        assert all("kind" not in m for m in acc2.index.values())
        assert {m["uid"]: mailkinds.of(m)
                for m in acc2.index.values()} == EXPECTED


def test_a_snapshot_without_kinds_still_loads(monkeypatch):
    """Rollback / upgrade: a snapshot an older image wrote has no kinds."""
    shop_box(monkeypatch)
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data.pop("kinds_version")
    for m in data["index"]:
        m.pop("kind")
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    rows = mailops.group_mails("sender", SHOP, acc=acc2)
    assert {m["uid"]: m["kind"] for m in rows}[4] == "orders"


# ------------------------------------------------------ the filter word

def test_kind_is_a_per_mail_word():
    f = mailops.parse_mail_query("kind:ads from:a@b.example plain")
    assert f["kinds"] == {"ads"} and f["from_addr"] == "a@b.example"
    assert f["text"] == ["plain"] and f["ignored"] == []
    assert mailops.parse_mail_query("")["kinds"] == set()
    # a kind that does not exist is a free word (matches nothing), not a
    # silently dropped condition
    f = mailops.parse_mail_query("kind:bogus kind:")
    assert f["kinds"] == set() and f["text"] == ["kind:bogus", "kind:"]


def test_all_mail_narrows_to_one_kind(monkeypatch):
    shop_box(monkeypatch)

    def uids(q):
        return sorted(m["uid"] for m in client.get(
            "/api/mails", params={"q": q}).json()["mails"])
    assert uids("kind:ads") == [1, 2, 3]
    assert uids("kind:orders") == [4, 5]
    assert uids("kind:shipping") == [6]
    assert uids("kind:invoices") == [7]
    assert uids("kind:jobs") == []
    assert uids("kind:ads is:unread") == [1, 2]       # narrows with the rest
    assert uids("kind:ads from:alice@friends.example") == []
    assert uids("kind:ads kind:ads") == [1, 2, 3]
    # two different kinds: no mail is both
    assert uids("kind:ads kind:orders") == []
    assert uids("kind:bogus") == []


def test_the_word_is_not_a_group_or_rule_word():
    """Rules match groups: `kind:` is a free word to the group filter and a
    rule refuses it (the retention choice is the way to say it)."""
    assert rulesmod.validate_filter("kind:ads") == ["kind:ads"]
    assert rulesmod.parse_filter("kind:ads")["text"] == ["kind:ads"]
    r = client.post("/api/rules", json={
        "name": "x", "query": "kind:ads", "action": "trash"})
    assert r.status_code == 400, r.text


def test_an_assistant_without_subject_access_cannot_ask_for_a_kind(
        monkeypatch):
    """The kind is decided from the subject line: its answer would tell a
    token that may not see subjects what they say."""
    shop_box(monkeypatch)
    acc = accountsmod.get()
    blind = mcptools.Ctx(accounts=[acc.name], subjects=False)
    with pytest.raises(mcptools.ToolError, match="subject"):
        mcptools._list_mails(blind, mcptools.ListMailsIn(query="kind:ads"))
    seeing = mcptools.Ctx(accounts=[acc.name], subjects=True)
    got = mcptools._list_mails(seeing, mcptools.ListMailsIn(query="kind:ads"))
    assert got["total"] == 3
    # the group's mail rows never carry the kind to a token
    rows = mcptools._list_mails(seeing, mcptools.ListMailsIn(
        key=SHOP, grouping="sender"))["mails"]
    assert rows and all("kind" not in r for r in rows)


# ------------------------------------------------- "Protect these N"

def test_pin_mails_protects_the_given_mails(monkeypatch):
    shop_box(monkeypatch)
    r = client.post("/api/pin_mails", json={
        "items": [["INBOX", 1], ["INBOX", 2], ["INBOX", 99]], "pinned": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "pinned": True, "changed": 2,
                        "skipped": 0}
    rows = {m["uid"]: m["pinned"] for m in client.get(
        "/api/group", params={"grouping": "sender", "key": SHOP}).json()}
    assert [u for u, p in rows.items() if p] == [1, 2]
    # again: nothing new; and off again
    assert client.post("/api/pin_mails", json={
        "items": [["INBOX", 1]]}).json()["changed"] == 0
    assert client.post("/api/pin_mails", json={
        "items": [["INBOX", 1]], "pinned": False}).json()["changed"] == 1
    assert len(pinstore.load_account("default")) == 1


def test_pin_mails_skips_a_mail_without_a_message_id(monkeypatch):
    shop_box(monkeypatch)
    acc = accountsmod.get()
    acc.index[mailops.ikey("INBOX", 3)]["msgid"] = ""
    r = client.post("/api/pin_mails", json={
        "items": [["INBOX", 3], ["INBOX", 4]]}).json()
    assert r["changed"] == 1 and r["skipped"] == 1


def test_pin_mails_validates_its_body(monkeypatch):
    shop_box(monkeypatch)
    assert client.post("/api/pin_mails", json={"items": []}
                       ).status_code == 422
    assert client.post("/api/pin_mails", json={"items": [["INBOX"]]}
                       ).status_code == 422


def test_pins_go_to_the_named_account_and_tenant(monkeypatch):
    shop_box(monkeypatch)
    cfgmod.update_config({"add_account": "two"})
    r = client.post("/api/pin_mails?account=default",
                    json={"items": [["INBOX", 1]]})
    assert r.status_code == 200
    assert len(pinstore.load_account("default")) == 1
    assert pinstore.load_account("two") == set()
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert pinstore.load_account("default") == set()


# ------------------------------------------------- retention: only a kind

def rule_for(only_kind="ads", **kw):
    return rulesmod.create_rule({
        "name": "ads", "grouping": "sender", "query": f"from:{SHOP}",
        "action": "trash", "schedule": "daily", "only_kind": only_kind, **kw})


def test_a_new_rule_starts_in_report_only(monkeypatch):
    r = client.post("/api/rules", json={
        "name": "ads", "query": f"from:{SHOP}", "action": "trash",
        "schedule": "daily", "only_kind": "ads", "mode": "execute"})
    assert r.status_code == 200, r.text
    rule = r.json()
    assert rule["only_kind"] == "ads" and rule["mode"] == "report"
    assert rule["report_runs"] == 0
    # ... and it cannot be armed before a report ran
    r = client.post(f"/api/rules/{rule['id']}", json={"mode": "execute"})
    assert r.status_code == 400
    assert rulesmod.load_rules()[0]["mode"] == "report"


def test_the_three_retention_choices_exclude_each_other():
    for other in ({"keep_latest": 2}, {"older_than_days": 5}):
        with pytest.raises(ValueError, match="mutually exclusive"):
            rule_for(**other)
    rule = rule_for()
    for body in ({"keep_latest": 2}, {"older_than_days": 5}):
        with pytest.raises(ValueError, match="mutually exclusive"):
            rulesmod.update_rule(rule["id"], body)
    # taking the kind away first makes room for another choice
    rule = rulesmod.update_rule(rule["id"], {"only_kind": None,
                                             "keep_latest": 2})
    assert rule["only_kind"] is None and rule["keep_latest"] == 2
    with pytest.raises(ValueError, match="mutually exclusive"):
        rulesmod.update_rule(rule["id"], {"only_kind": "ads"})
    rule = rulesmod.update_rule(rule["id"], {"keep_latest": None,
                                             "only_kind": "orders"})
    assert rule["only_kind"] == "orders" and rule["keep_latest"] is None


def test_the_api_refuses_two_choices_and_unknown_kinds():
    r = client.post("/api/rules", json={
        "name": "x", "query": f"from:{SHOP}", "only_kind": "ads",
        "keep_latest": 2})
    assert r.status_code == 400 and "mutually exclusive" in r.json()["detail"]
    for bad in ("bogus", "", "ADS", 7):
        r = client.post("/api/rules", json={
            "name": "x", "query": f"from:{SHOP}", "only_kind": bad})
        assert r.status_code in (400, 422), (bad, r.text)
    assert rulesmod.load_rules() == []


def test_a_purge_rule_cannot_be_limited_to_a_kind():
    with pytest.raises(ValueError, match="kind"):
        rulesmod.create_rule({"name": "p", "scope": "trash",
                              "older_than_days": 30, "only_kind": "ads"})
    r = client.post("/api/rules", json={"name": "p", "scope": "mail",
                                        "query": f"from:{SHOP}"})
    rule = r.json()
    with pytest.raises(ValueError):
        rulesmod.update_rule(rule["id"], {"scope": "trash", "action": "purge",
                                          "older_than_days": 30,
                                          "only_kind": "ads"})


def test_an_old_rules_file_reads_without_a_kind(monkeypatch):
    rule = rulesmod.create_rule({"name": "old", "query": "x"})
    path = rulesmod._path()
    data = json.loads(path.read_text())
    for r in data["rules"]:
        r.pop("only_kind", None)
    path.write_text(json.dumps(data))
    assert rulesmod.load_rules()[0]["only_kind"] is None
    assert rule["only_kind"] is None


def old_signature(rule):
    """The definition signature as it was before "only <kind>"."""
    import hashlib
    fields = ("scope", "grouping", "query", "action", "dest", "keep_latest",
              "older_than_days")
    blob = json.dumps([rule.get(k) for k in fields])
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def test_a_rule_without_a_kind_keeps_its_signature():
    """Every rule saved before this change keeps the signature its report was
    recorded with, so none is sent back to report mode by an upgrade."""
    rule = rulesmod.create_rule({"name": "old", "query": "tag:news",
                                 "keep_latest": 3})
    assert rulesmod.definition_sig(rule) == old_signature(rule)


def test_a_kind_is_part_of_the_signature_an_older_image_cannot_match():
    rule = rule_for()
    assert rulesmod.definition_sig(rule) != old_signature(rule)
    other = rule_for("orders")
    assert rulesmod.definition_sig(rule) != rulesmod.definition_sig(other)


def test_an_armed_kind_rule_is_taken_back_by_an_older_image(monkeypatch):
    """Rollback: an older image does not know `only_kind`, computes the old
    signature, finds it unlike the one the report recorded and takes the
    rule back to report mode - it never runs on all of the sender's mail."""
    shop_box(monkeypatch)
    rule = rule_for()
    rulesmod.run_rule(rule["id"], rescan=False)
    rule = rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert rule["mode"] == "execute" and rule["report_sig"] != \
        old_signature(rule)
    # what the old image's `purge_armed` compares:
    assert rule["report_sig"] == rulesmod.definition_sig(rule)
    assert rule["report_sig"] != old_signature(rule)


def test_editing_the_kind_sends_an_armed_rule_back_to_report(monkeypatch):
    shop_box(monkeypatch)
    rule = rule_for()
    rulesmod.run_rule(rule["id"], rescan=False)
    rule = rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert rule["mode"] == "execute"
    edited = rulesmod.update_rule(rule["id"], {"only_kind": "orders"})
    assert edited["mode"] == "report" and edited["reset_reason"] == "edited"
    with pytest.raises(ValueError):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})


def run_report(rule):
    return rulesmod.run_rule(rule["id"], rescan=False)


def execute(rule):
    run_report(rule)
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    return rulesmod.run_rule(rule["id"], rescan=False)


def test_the_report_counts_only_the_kind(monkeypatch):
    shop_box(monkeypatch)
    assert run_report(rule_for("ads"))["mails"] == 3
    assert run_report(rule_for("orders"))["mails"] == 2
    assert run_report(rule_for("shipping"))["mails"] == 1
    assert run_report(rule_for("jobs"))["mails"] == 0
    # the sender's whole group without a kind: everything it sent (8), less
    # the invoice Keep-safe holds back
    plain = rulesmod.create_rule({"name": "all", "query": f"from:{SHOP}"})
    res = run_report(plain)
    assert res["mails"] == 7 and res["kept_safe"] == {"invoices": 1}


def test_a_kind_rule_moves_only_that_kind_in_one_undoable_step(monkeypatch):
    fake = shop_box(monkeypatch)
    res = execute(rule_for("ads"))
    assert res["acted"] == 3
    wait_delete_done()
    assert {m["uid"] for m in fake.mailbox["Trash"]} == {1, 2, 3}
    assert {m["uid"] for m in fake.mailbox["INBOX"]} == {4, 5, 6, 7, 8, 20}
    assert len(mailops.UNDO_LOG) == 1                       # one step, Undo
    assert client.post("/api/undo", json={}).status_code == 200
    wait_delete_done()
    assert {m["uid"] for m in fake.mailbox["INBOX"]} >= {1, 2, 3}


def test_a_kind_rule_leaves_pinned_mails_alone(monkeypatch):
    fake = shop_box(monkeypatch)
    client.post("/api/pin_mails", json={"items": [["INBOX", 2]]})
    res = execute(rule_for("ads"))
    assert res["acted"] == 2 and res["skipped_pinned"] == 1
    wait_delete_done()
    assert {m["uid"] for m in fake.mailbox["Trash"]} == {1, 3}


def test_keep_safe_still_holds_back_invoices_on_a_kind_rule(monkeypatch):
    fake = shop_box(monkeypatch)
    cfgmod.update_config({"keep_safe": {"rules": True}})
    res = execute(rule_for("invoices"))
    assert res["acted"] == 0 and res["kept_safe"] == {"invoices": 1}
    wait_delete_done()
    assert fake.mailbox["Trash"] == []
    # the invoice is out of an ads rule's scope: not its to hold back either
    res = execute(rule_for("ads"))
    assert res["acted"] == 3 and res["kept_safe"] == {}
    wait_delete_done()


def test_a_protected_sender_is_not_touched_by_a_kind_rule(monkeypatch):
    fake = shop_box(monkeypatch)
    cfgmod.update_config({"protected": [SHOP]})
    res = execute(rule_for("ads"))
    assert res["skipped_protected"] == 1 and res["acted"] == 0
    assert fake.mailbox["Trash"] == []


def test_an_unknown_kind_in_a_rules_file_acts_on_nothing(monkeypatch):
    """A hand-edited / imported file cannot widen the rule: a kind nothing
    has is a kind no mail is."""
    fake = shop_box(monkeypatch)
    rule = rule_for("ads")
    path = rulesmod._path()
    data = json.loads(path.read_text())
    data["rules"][0]["only_kind"] = "bogus"
    path.write_text(json.dumps(data))
    assert run_report(rule)["mails"] == 0
    data["rules"][0]["only_kind"] = ""
    path.write_text(json.dumps(data))
    assert run_report(rule)["mails"] == 0
    assert fake.mailbox["Trash"] == []


def test_the_kind_survives_an_account_rename(monkeypatch):
    rule = rule_for()
    rulesmod.update_rule(rule["id"], {"account": "default"})
    rulesmod.rename_account("default", "main")
    kept = rulesmod.load_rules()[0]
    assert kept["account"] == "main" and kept["only_kind"] == "ads"


def test_rules_are_per_tenant(monkeypatch):
    rule_for()
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert rulesmod.load_rules() == []
        other = rule_for("orders")
        assert rulesmod.load_rules()[0]["only_kind"] == "orders"
    assert [r["only_kind"] for r in rulesmod.load_rules()] == ["ads"]
    assert other["id"] != rulesmod.load_rules()[0]["id"]


# ---------------------------------------------- delete_groups / the checkup

def test_delete_groups_acts_on_the_kind_only(monkeypatch):
    fake = shop_box(monkeypatch)
    r = mailops.delete_groups("sender", [SHOP], only_kind="orders")
    assert r["queued"] == 2
    wait_delete_done()
    assert {m["uid"] for m in fake.mailbox["Trash"]} == {4, 5}


def test_delete_groups_refuses_two_retention_choices(monkeypatch):
    shop_box(monkeypatch)
    for kw in ({"keep_latest": 1}, {"older_than_days": 1}):
        with pytest.raises(ValueError, match="mutually exclusive"):
            mailops.delete_groups("sender", [SHOP], only_kind="ads", **kw)


def test_retained_mails_exempts_every_other_kind(monkeypatch):
    shop_box(monkeypatch)
    acc = accountsmod.get()
    rec = acc.state["groups"]["sender"][SHOP]
    held = mailops.retained_mails(rec, acc, only_kind="ads")
    assert held == {"INBOX": {4, 5, 6, 7, 8}}
    assert mailops.group_act_count(rec, acc, only_kind="ads") == 3
    assert mailops.group_act_count(rec, acc) == 8
    # a mail the index no longer knows is left alone, never acted on
    assert mailops.retained_mails(rec, acc, only_kind="") == {
        "INBOX": {1, 2, 3, 4, 5, 6, 7, 8}}


def test_group_move_mails_follows_the_kind(monkeypatch):
    shop_box(monkeypatch)
    got = mailops.group_move_mails("sender", [SHOP], only_kind="shipping")
    assert [m["uid"] for m in got] == [6]


def test_a_kind_rule_does_not_defeat_a_sweep_nor_is_it_defeated(monkeypatch):
    """The other kinds are out of its scope, not mails it leaves alone on
    purpose (that is what "except the newest N" says): no overlap."""
    shop_box(monkeypatch)
    rule_for("ads")
    rulesmod.create_rule({"name": "sweep", "query": f"from:{SHOP}"})
    res = rulecheck.checkup(accountsmod.get())
    assert [f for f in res["findings"]
            if f["kind"] in ("overlap", "conflict")] == []


def test_the_checkup_compares_kind_rules_on_their_own_mails(monkeypatch):
    shop_box(monkeypatch)
    archive_ads = rule_for("ads", action="archive", name="archive ads")
    trash_orders = rule_for("orders", name="trash orders")
    res = rulecheck.checkup(accountsmod.get())
    assert [f["kind"] for f in res["findings"]] == []        # disjoint mails
    trash_all = rulesmod.create_rule({"name": "all", "query": f"from:{SHOP}"})
    res = rulecheck.checkup(accountsmod.get())
    conflicts = [f for f in res["findings"] if f["kind"] == "conflict"]
    # the ads are archived by one and trashed by the other - and only those
    assert len(conflicts) == 1
    assert conflicts[0]["rules"] == [archive_ads["id"], trash_all["id"]]
    assert conflicts[0]["n"] == 3
    assert trash_orders["id"] not in conflicts[0]["rules"]


def test_a_kind_rule_plans_only_its_kind(monkeypatch):
    shop_box(monkeypatch)
    acc = accountsmod.get()
    groups = mailops.public_state(acc)["groups"]
    plan = rulecheck._plan(rule_for("jobs"), acc, groups, set(), [])
    assert plan["wanted"] == 0 and plan["acts"] == set()
    plan = rulecheck._plan(rule_for("ads"), acc, groups, set(), [])
    assert plan["wanted"] == 3 and len(plan["acts"]) == 3
    assert plan["kept"] == set()


def test_a_kind_rule_survives_an_export_and_comes_back_in_report_mode(
        monkeypatch):
    shop_box(monkeypatch)
    rule = rule_for("ads")
    run_report(rule)
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    data = client.get("/api/export_config").json()
    assert [r["only_kind"] for r in data["rules"]] == ["ads"]
    r = client.post("/api/import_config", json=data)
    assert r.status_code == 200, r.text
    (back,) = rulesmod.load_rules()
    assert back["only_kind"] == "ads" and back["mode"] == "report"
    # a backup that carries a kind nobody has, or two choices, is skipped
    data["rules"][0]["only_kind"] = "bogus"
    assert client.post("/api/import_config", json=data).status_code == 200
    assert rulesmod.load_rules() == []
    data["rules"][0].update(only_kind="ads", keep_latest=2)
    assert client.post("/api/import_config", json=data).status_code == 200
    assert rulesmod.load_rules() == []
