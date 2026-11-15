"""Keep-safe: the classes (subject rules of smartkinds at rule-id level), the
batched check + pin endpoints behind the confirm's green box, the per-tenant
switches, and rule runs that skip keep-safe mails WITHOUT pinning them."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import keepsafe
from backend import mailops
from backend import pinstore
from backend import rules as rulesmod
from backend import tenants
from backend.main import app

from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)

SHOP = '"ACME Store" <shop@acme.example>'
TRAVEL = '"Travelly" <trips@travelly.example>'
BANK = '"Bank of Example" <service@bank.example>'
HR = '"Careers" <jobs@careers.example>'
ID = '"Account Team" <security@id.example>'
NEWS = '"Newsletter" <news@promo.example>'


# ------------------------------------------------------------- the classes

@pytest.mark.parametrize("subject,cls", [
    # invoices & receipts (orders / invoice + the bill pattern)
    ("Invoice 2026-0412 for your order", "invoices"),
    ("Your receipt - order 88213", "invoices"),
    ("Rechnung Nr. 5512", "invoices"),
    ("Kontoauszug Juni", "invoices"),                 # the bill pattern
    ("Payment received, thank you", "invoices"),
    # bookings & tickets (appointments / booking)
    ("Your booking for 3 Dec", "bookings"),
    ("Boarding pass for your flight", "bookings"),
    ("Buchungsbestätigung", "bookings"),
    ("Your e-ticket", "bookings"),
    # contracts & policy notices (accounts / policy_notice)
    ("Changes to our Terms of Service", "contracts"),
    ("Update zu den Allgemeinen Geschäftsbedingungen (AGB)", "contracts"),
    ("Privacy policy update", "contracts"),
    # job applications (jobs / application)
    ("Your application was received", "jobs"),
    ("Bewerbung: Unterlagen erhalten", "jobs"),
    ("Interview invitation", "jobs"),
    # account & security (accounts / account) - a class of its own
    ("Your sign-in code is 123456", "accounts"),
    ("Neue Anmeldung erkannt", "accounts"),
    ("Verify your email address", "accounts"),
])
def test_each_class_matches(subject, cls):
    assert classes_first(subject) == cls


@pytest.mark.parametrize("subject", [
    "SALE! 50% off everything",
    "Dinner on Friday?",
    "Your order has shipped",                # shipping is not an invoice
    "How was your booking? Rate us",         # a survey is no booking
    "Bitte bewerten Sie Ihre Rechnung",      # nor a receipt
    "Appointment reminder",                  # the appointment rule: not here
    "",
])
def test_non_matches(subject):
    assert keepsafe.classes_of(subject) == []


def test_weak_account_words_in_promotional_mail_do_not_count():
    assert keepsafe.classes_of("Welcome to the club - 20% off") == []
    # ... but the same subject from a plain sender is an account mail
    assert keepsafe.classes_of("Welcome to Example") == ["accounts"]
    assert keepsafe.classes_of("Welcome to Example", hint="p") == []


def test_priority_when_a_subject_fits_two_classes():
    both = "Invoice for your booking"
    assert keepsafe.classes_of(both) == ["invoices", "bookings"]


def classes_first(subject):
    got = keepsafe.classes_of(subject)
    assert got, f"no class for {subject!r}"
    return got[0]


# -------------------------------------------------------------- the fixture

def _mails(n_news=25):
    inbox = [
        make_msg(1, frm=SHOP, subject="Invoice 2026-0412 for your order"),
        make_msg(2, frm=SHOP, subject="Your receipt - order 88213"),
        make_msg(3, frm=SHOP, subject="SALE! 50% off everything"),
        make_msg(4, frm=TRAVEL, subject="Your booking for 3 Dec"),
        make_msg(5, frm=BANK, subject="Changes to our Terms of Service"),
        make_msg(6, frm=HR, subject="Your application was received"),
        make_msg(7, frm=ID, subject="Your sign-in code is 123456"),
        # no Message-ID: cannot be pinned, so never offered
        make_msg(8, frm=SHOP, subject="Invoice without an id", msgid=""),
    ]
    inbox[-1]["msgid"] = ""
    for i in range(n_news):
        inbox.append(make_msg(100 + i, frm=NEWS, subject=f"Deal number {i}"))
    return inbox


@pytest.fixture
def box(monkeypatch):
    fake = FakeIMAP({"INBOX": _mails(), "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


SENDERS = ["shop@acme.example", "trips@travelly.example",
           "service@bank.example", "jobs@careers.example",
           "security@id.example", "news@promo.example"]


def check(scope=None, **kw):
    body = scope or {"grouping": "sender", "keys": SENDERS}
    r = client.post("/api/keepsafe/check", json={**body, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def by_id(res):
    return {c["id"]: c for c in res["classes"]}


# ------------------------------------------------------------------ check

def test_check_groups_the_keep_safe_mails_by_class(box):
    res = check()
    cls = by_id(res)
    assert list(cls) == ["invoices", "bookings", "contracts", "jobs"]
    assert cls["invoices"]["count"] == 2          # uid 8 has no Message-ID
    assert cls["bookings"]["count"] == 1
    assert res["kept"] == 5
    assert res["total"] == 8 + 25
    inv = cls["invoices"]
    assert inv["senders"] == [{"name": "ACME Store", "count": 2}]
    assert {s["subject"] for s in inv["subjects"]} == {
        "Invoice 2026-0412 for your order", "Your receipt - order 88213"}
    assert set(inv["subjects"][0]) == {"subject", "sender", "ts"}


def test_account_and_security_is_off_by_default_and_switchable(box):
    assert "accounts" not in by_id(check())
    cfgmod.update_config({"keep_safe": {"accounts": True}})
    res = by_id(check())
    assert res["accounts"]["count"] == 1
    assert res["accounts"]["subjects"][0]["subject"] == \
        "Your sign-in code is 123456"


@pytest.mark.parametrize("cls", ["invoices", "bookings", "contracts", "jobs"])
def test_a_class_switched_off_is_not_looked_for(box, cls):
    cfgmod.update_config({"keep_safe": {cls: False}})
    res = check()
    assert cls not in by_id(res)
    assert res["kept"] == 5 - by_id_count_before(cls)


def by_id_count_before(cls):
    return {"invoices": 2, "bookings": 1, "contracts": 1, "jobs": 1}[cls]


def test_pinned_mails_are_not_offered_again(box):
    pinstore.set_pinned("<m1@shop.example>", True, "default")
    assert by_id(check())["invoices"]["count"] == 1


def test_protected_groups_are_left_out_like_the_move_does(box):
    cfgmod.update_config({"protected": ["shop@acme.example"]})
    res = by_id(check())
    assert "invoices" not in res and res["bookings"]["count"] == 1


def test_group_retention_and_sender_limits_follow_the_move(box):
    # keep the newest 1 mail of the shop group: the older ones move
    res = check(keep_latest=1)
    assert by_id(res)["invoices"]["count"] <= 1
    only = check(only_addrs=["trips@travelly.example"])
    assert list(by_id(only)) == ["bookings"] and only["total"] == 1


def test_selection_scope_by_mail_items(box):
    res = check({"items": [["INBOX", 1], ["INBOX", 3], ["INBOX", 4],
                           ["INBOX", 999]]})
    assert res["total"] == 3 and res["kept"] == 2
    assert list(by_id(res)) == ["invoices", "bookings"]


def test_check_is_read_only(box):
    before = pinstore.load_account("default")
    check()
    assert pinstore.load_account("default") == before
    assert not box.mailbox["Trash"]


def test_check_validates_the_grouping(box):
    r = client.post("/api/keepsafe/check",
                    json={"grouping": "nope", "keys": ["x"]})
    assert r.status_code == 400


# -------------------------------------------------------------------- pin

def pin(classes, scope=None):
    body = scope or {"grouping": "sender", "keys": SENDERS}
    r = client.post("/api/keepsafe/pin", json={**body, "classes": classes})
    assert r.status_code == 200, r.text
    return r.json()


def test_pin_pins_only_the_ticked_classes_and_the_move_skips_them(box):
    res = pin(["invoices", "contracts"])
    assert res["pinned"] == 3
    assert {tuple(i) for i in res["items"]} == {
        ("INBOX", 1), ("INBOX", 2), ("INBOX", 5)}
    assert pinstore.load_account("default") == {
        "<m1@shop.example>", "<m2@shop.example>", "<m5@shop.example>"}
    # the existing bulk path now skips them: ticked -> pinned -> skipped
    r = client.post("/api/delete", json={
        "grouping": "sender", "keys": SENDERS, "action": "trash"})
    assert r.status_code == 200, r.text
    wait_delete_done()
    gone = {m["uid"] for m in box.mailbox["Trash"]}
    assert not gone & {1, 2, 5}
    # unticked groups (bookings, jobs, ...) moved with everything else
    assert {3, 4, 6, 7, 8} <= gone


def test_pin_with_no_classes_pins_nothing_unticked_groups_move(box):
    assert pin([])["pinned"] == 0
    assert pinstore.load_account("default") == set()
    client.post("/api/delete", json={
        "grouping": "sender", "keys": SENDERS, "action": "trash"})
    wait_delete_done()
    assert {1, 2, 4, 5, 6}.issubset({m["uid"] for m in box.mailbox["Trash"]})


def test_pin_decides_the_class_itself_not_from_the_client(box):
    # a class the tenant did not switch on cannot be forced in
    assert pin(["accounts"])["pinned"] == 0
    assert pin(["no-such-class"])["pinned"] == 0
    assert pinstore.load_account("default") == set()


def test_pin_by_selection_returns_the_items_to_drop(box):
    res = pin(["invoices"], {"items": [["INBOX", 1], ["INBOX", 3]]})
    assert res == {"pinned": 1, "items": [["INBOX", 1]]}
    r = client.post("/api/delete_messages", json={
        "items": [["INBOX", 3]], "action": "trash"})
    assert r.status_code == 200


def test_pin_is_per_account(monkeypatch, box):
    pin(["invoices"])
    assert pinstore.load_account("default")
    assert pinstore.load_account("other") == set()


# ---------------------------------------------------------------- settings

def test_defaults_and_validation_of_the_switches():
    ks = cfgmod.load_config()["keep_safe"]
    assert ks == {"invoices": True, "bookings": True, "contracts": True,
                  "jobs": True, "accounts": False, "rules": True}
    cfgmod.update_config({"keep_safe": {"jobs": False, "bogus": True,
                                        "accounts": "yes"}})
    ks = cfgmod.load_config()["keep_safe"]
    assert ks["jobs"] is False and ks["accounts"] is True
    assert "bogus" not in ks
    masked = client.get("/api/config").json()["keep_safe"]
    assert masked["jobs"] is False and masked["rules"] is True


def test_a_damaged_value_falls_back_to_the_default(tmp_path):
    cfgmod.update_config({"keep_safe": {"jobs": False}})
    path = cfgmod.config_path()
    data = json.loads(path.read_text())
    data["keep_safe"] = {"jobs": "maybe", "invoices": False, "x": 1}
    path.write_text(json.dumps(data))
    ks = cfgmod.load_config()["keep_safe"]
    assert ks["jobs"] is True and ks["invoices"] is False


def test_the_switches_are_per_tenant():
    cfgmod.update_config({"keep_safe": {"invoices": False}})
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert cfgmod.load_config()["keep_safe"]["invoices"] is True
        assert keepsafe.enabled_classes() == [
            "invoices", "bookings", "contracts", "jobs"]
        cfgmod.update_config({"keep_safe": {"accounts": True}})
    assert "accounts" not in keepsafe.enabled_classes()
    assert "invoices" not in keepsafe.enabled_classes()


def test_the_switches_ride_along_in_a_settings_backup():
    cfgmod.update_config({"keep_safe": {"bookings": False}})
    data = json.loads(client.get("/api/export_config").content)
    assert data["config"]["keep_safe"]["bookings"] is False
    cfgmod.update_config({"keep_safe": {"bookings": True}})
    assert client.post("/api/import_config", json=data).status_code == 200
    assert cfgmod.load_config()["keep_safe"]["bookings"] is False


def test_check_is_per_tenant_and_per_account_state(box):
    # a tenant's pins and switches do not touch another's
    alice = tenants.for_subject("alice@x.example")
    cfgmod.update_config({"keep_safe": {"invoices": False}})
    assert "invoices" not in by_id(check())
    with tenants.use(alice):
        assert keepsafe.enabled_classes()[0] == "invoices"
        assert pinstore.load_account("default") == set()


# ------------------------------------------------------------------- rules

def _rule(**kw):
    return rulesmod.create_rule({
        "name": "sweep", "grouping": "sender",
        "query": "from:shop@acme.example", "action": "trash", **kw})


def _execute(rule):
    rulesmod.run_rule(rule["id"], rescan=False)         # the report run first
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    return rulesmod.run_rule(rule["id"], rescan=False)


def test_rule_report_counts_kept_safe_mails_and_does_not_pin(box):
    res = rulesmod.run_rule(_rule()["id"], rescan=False)
    # shop group: 4 mails (invoice, receipt, sale, no-id invoice)
    assert res["kept_safe"] == {"invoices": 2}
    assert res["mails"] == 2 and res["skipped_pinned"] == 0
    assert pinstore.load_account("default") == set()


def test_rule_execute_skips_kept_safe_mails_without_pinning(box):
    res = _execute(_rule())
    assert res["acted"] == 2 and res["kept_safe"] == {"invoices": 2}
    wait_delete_done()
    assert {m["uid"] for m in box.mailbox["Trash"]} == {3, 8}
    assert pinstore.load_account("default") == set()        # skipped, not pinned
    assert {m["uid"] for m in box.mailbox["INBOX"]} >= {1, 2}


def test_rule_runs_unchecked_when_the_switch_is_off(box):
    cfgmod.update_config({"keep_safe": {"rules": False}})
    res = rulesmod.run_rule(_rule()["id"], rescan=False)
    assert res["kept_safe"] == {} and res["mails"] == 4


def test_rule_respects_a_class_switch(box):
    cfgmod.update_config({"keep_safe": {"invoices": False}})
    res = rulesmod.run_rule(_rule()["id"], rescan=False)
    assert res["kept_safe"] == {} and res["mails"] == 4


def test_rule_checks_the_off_by_default_class_once_switched_on(box):
    rule = _rule(query="from:security@id.example")
    assert rulesmod.run_rule(rule["id"], rescan=False)["mails"] == 1
    cfgmod.update_config({"keep_safe": {"accounts": True}})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["kept_safe"] == {"accounts": 1} and res["mails"] == 0


def test_only_trash_rules_are_checked(box):
    res = rulesmod.run_rule(_rule(action="archive")["id"], rescan=False)
    assert res["kept_safe"] == {} and res["mails"] == 4
    res = rulesmod.run_rule(_rule(action="mark_read")["id"], rescan=False)
    assert res["kept_safe"] == {}


def test_a_block_rule_is_not_softened(box):
    res = rulesmod.run_rule(_rule(origin="block")["id"], rescan=False)
    assert res["kept_safe"] == {} and res["mails"] == 4


def test_kept_safe_counts_next_to_protected_and_pinned(box):
    pinstore.set_pinned("<m3@shop.example>", True, "default")
    res = rulesmod.run_rule(_rule()["id"], rescan=False)
    assert res["skipped_pinned"] == 1 and res["kept_safe"] == {"invoices": 2}
    assert res["mails"] == 1                       # only the no-id invoice


def test_rule_report_with_retention_counts_only_what_would_move(box):
    rule = _rule(keep_latest=3)
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["mails"] + sum(res["kept_safe"].values()) <= 1


def test_the_rule_run_is_logged_with_the_kept_safe_count(box):
    _execute(_rule())
    entries = auditlog._load_all("default")
    run = [e for e in entries if e["action"] == "rule_execute"][-1]
    assert run["kept_safe"] == 2 and run["count"] == 2
    report = [e for e in entries if e["action"] == "rule_report"][-1]
    assert report["kept_safe"] == 2


def test_a_run_without_kept_mails_logs_no_field(box):
    cfgmod.update_config({"keep_safe": {"rules": False}})
    rulesmod.run_rule(_rule()["id"], rescan=False)
    assert all("kept_safe" not in e for e in auditlog._load_all("default"))


def test_delete_groups_exempt_is_not_a_pin(box):
    mailops.delete_groups("sender", ["shop@acme.example"], "trash",
                          exempt={"<m1@shop.example>"})
    wait_delete_done()
    assert 1 not in {m["uid"] for m in box.mailbox["Trash"]}
    assert pinstore.load_account("default") == set()


def test_kept_safe_counts_only_the_groups_the_cap_takes(box, monkeypatch):
    """A group RULE_CAP leaves for the next run is not 'kept safe' yet."""
    monkeypatch.setattr(rulesmod, "RULE_CAP", 26)
    # every sender group: news (25) and the id mail (1) fit; the shop group
    # (2 movable + 2 kept invoices) does not and is capped; the groups made
    # only of kept-safe mails have nothing to cap and are reported
    res = rulesmod.run_rule(_rule(query="")["id"], rescan=False)
    assert res["capped"] == 2
    assert res["kept_safe"] == {"bookings": 1, "contracts": 1, "jobs": 1}


def test_a_group_with_only_kept_safe_mails_still_reports_them(box):
    rule = _rule(query="from:trips@travelly.example")
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["mails"] == 0 and res["kept_safe"] == {"bookings": 1}


def test_check_names_the_account_and_a_role_folder_selection(box):
    assert check()["account"] == "default"


def test_role_items_read_the_special_folders_own_cache(box):
    acc = accountsmod.get()
    rec = mailops.ikey("Spam", 900)
    with acc.lock:
        acc.role_index["junk"] = {rec: {
            "folder": "Spam", "uid": 900, "subject": "Invoice 1",
            "msgid": "<j900@x.example>", "addr": "a@x.example", "name": "A",
            "ts": 1, "unsub": False}}
    res = check({"items": [["Spam", 900]], "role": "junk"})
    assert res["kept"] == 1 and list(by_id(res)) == ["invoices"]
    # the same pair is unknown to the main index
    assert check({"items": [["Spam", 900]]})["kept"] == 0
    got = pin(["invoices"], {"items": [["Spam", 900]], "role": "junk"})
    assert got["items"] == [["Spam", 900]]
    assert "<j900@x.example>" in pinstore.load_account("default")
    r = client.post("/api/keepsafe/check",
                    json={"items": [["Spam", 900]], "role": "nope"})
    assert r.status_code == 422
