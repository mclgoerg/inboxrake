"""Subscriptions (backend/subscriptions.py, backend/substore.py): the cadence
finder, the amount patterns, "still in use?", the opt-in receipt read,
reminders, the user's decisions and the API around them. Local data only:
invented `.example` senders and generic words."""

import datetime
import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import (mailops, pinstore, subscriptions as subs, substore,
                     tenants, webpush)
from backend.main import app

NOW = 1_800_000_000          # a Friday in January 2027 (UTC)
DAY = 86400
FIT = "billing@fittrack.example"
client = TestClient(app)


def _ts(days_ago):
    return int(NOW - days_ago * DAY)


def _mail(days_ago, subject, addr=FIT, name="FitTrack", seen=False,
          msgid=None, folder="INBOX", _n=[0]):
    _n[0] += 1
    return {"ts": _ts(days_ago), "subject": subject, "addr": addr,
            "name": name, "seen": seen, "folder": folder, "uid": _n[0],
            "msgid": msgid if msgid is not None else f"<m{_n[0]}@x.example>",
            "size": 10, "bulk": False}


def _acc(mails, name="acct"):
    return SimpleNamespace(
        name=name, lock=threading.RLock(), tenant=tenants.DEFAULT,
        index={(m["folder"], m["uid"]): m for m in mails},
        state={"groups_rev": 1, "status": "done"})


def _receipts(gaps, last_ago=5, subject="Your receipt", **kw):
    """Receipts `gaps` days apart, the newest `last_ago` days ago."""
    ago = [last_ago]
    for g in reversed(gaps):
        ago.append(ago[-1] + g)
    return [_mail(a, subject, **kw) for a in ago]


def _one(mails, now=NOW):
    found = subs.detect(_acc(mails), now)
    assert len(found) == 1, found
    return found[0]


# ---------------------------------------------------------------- cadence

def test_a_monthly_cadence_is_found_with_its_next_date():
    s = _one(_receipts([31, 30, 31, 30, 31]))
    assert s["cadence"] == "monthly" and s["receipts"] == 6
    assert s["every_days"] == 31
    assert s["next"] == s["last"] + 31 * DAY       # last + the median gap
    assert s["name"] == "FitTrack" and s["addr"] == FIT
    assert s["since"] == _ts(5 + 31 + 30 + 31 + 30 + 31)


def test_a_yearly_cadence_is_found():
    s = _one(_receipts([365, 366], last_ago=100))
    assert s["cadence"] == "yearly" and s["receipts"] == 3
    assert s["every_days"] in (365, 366)


@pytest.mark.parametrize("gaps", [
    [28, 38],        # 33 +- 5: outside the +-4 tolerance
    [24, 41],
    [10, 50, 33, 90],
    [365, 330],      # not a month, not a year
    [350, 380],      # yearly, but 15 days off the median
    [60, 60],        # every two months
    [7, 7, 7],       # weekly
])
def test_irregular_or_other_cadences_are_rejected(gaps):
    assert subs.detect(_acc(_receipts(gaps)), NOW) == []


@pytest.mark.parametrize("gaps", [[29, 37], [28, 36], [31, 30], [355, 375]])
def test_the_tolerance_edge_is_inside(gaps):
    assert len(subs.detect(_acc(_receipts(gaps, last_ago=20)), NOW)) == 1


def test_at_least_three_receipts_are_needed():
    assert subs.detect(_acc(_receipts([30])), NOW) == []     # two
    assert subs.detect(_acc(_receipts([30, 30])), NOW) != [] # three


def test_only_the_latest_regular_run_counts():
    old = [_mail(400 + i * 11, "Your receipt") for i in range(4)]  # irregular
    s = _one(old + _receipts([30, 30, 30]))
    assert s["receipts"] == 4


def test_a_few_receipts_that_line_up_among_many_are_no_subscription():
    scattered = [_mail(400 + i * 13 + (i % 3) * 9, "Your receipt")
                 for i in range(14)]
    assert subs.detect(_acc(scattered + _receipts([30, 30])), NOW) == []
    # the same tail after a short irregular start is one
    assert len(subs.detect(_acc(
        [_mail(400 + i * 13, "Your receipt") for i in range(3)]
        + _receipts([30, 30, 30])), NOW)) == 1


def test_a_stopped_subscription_is_not_listed():
    gaps = [30, 30, 30]
    assert len(subs.detect(_acc(_receipts(gaps, last_ago=40)), NOW)) == 1
    assert subs.detect(_acc(_receipts(gaps, last_ago=90)), NOW) == []
    # a yearly one is given half a year
    assert len(subs.detect(_acc(_receipts([365, 365], last_ago=500)), NOW)) == 1
    assert subs.detect(_acc(_receipts([365, 365], last_ago=900)), NOW) == []


def test_next_days_counts_up_and_goes_negative_when_overdue():
    assert _one(_receipts([30, 30, 30], last_ago=10))["next_days"] == 20
    assert _one(_receipts([30, 30, 30], last_ago=36))["next_days"] == -6


def test_an_invoice_and_its_receipt_count_once():
    mails = []
    for ago in (5, 35, 65, 95):
        mails += [_mail(ago, "Invoice"), _mail(ago - 1, "Your receipt")]
    assert _one(mails)["receipts"] == 4


def test_what_is_not_a_receipt_or_a_company_is_ignored():
    # people (freemail), surveys, ordinary mail
    people = _receipts([30, 30, 30], addr="jane@gmail.com")
    survey = _receipts([30, 30, 30], subject="Rate your receipt experience")
    plain = _receipts([30, 30, 30], subject="Our weekly news")
    assert subs.detect(_acc(people + survey + plain), NOW) == []


def test_each_company_is_its_own_subscription():
    a = _receipts([30, 30, 30], addr="billing@a.example", name="Alpha")
    b = _receipts([30, 30, 30], last_ago=12, addr="x@b.example", name="Beta")
    got = subs.detect(_acc(a + b), NOW)
    assert [s["name"] for s in got] == ["Beta", "Alpha"]  # next date first
    assert [s["key"] for s in got] == ["b.example", "a.example"]


def test_a_shared_platform_does_not_pool_companies():
    a = _receipts([30, 30, 30], addr="receipts@stripe.com", name="Shop A")
    got = subs.detect(_acc(a), NOW)
    assert got and got[0]["key"] == "receipts@stripe.com"


def test_the_rhythm_has_one_square_per_month():
    s = _one(_receipts([31, 30, 31, 61, 31, 30], last_ago=5))
    assert s["slots"].count(1) == 7 and s["slots"][-1] == 1
    assert s["slots"].count(0) == 1              # the month that skipped
    long = _one(_receipts([30] * 40, last_ago=5))
    assert len(long["slots"]) == subs.MAX_SLOTS


# ---------------------------------------------------------------- amounts

@pytest.mark.parametrize("text,want", [
    ("Your receipt - €7.99", (7.99, "EUR")),
    ("Quittung: 7,99 €", (7.99, "EUR")),
    ("Invoice $12.99", (12.99, "USD")),
    ("Receipt £3", (3.0, "GBP")),
    ("Rechnung CHF 39.00", (39.0, "CHF")),
    ("Rechnung 39,00 CHF", (39.0, "CHF")),
    ("Your payment EUR 1.234,56 was received", (1234.56, "EUR")),
    ("Receipt USD 1,234.56", (1234.56, "USD")),
    ("Invoice 12.99 EUR", (12.99, "EUR")),
    ("Receipt € 7,99 (VAT €1,28)", (7.99, "EUR")),
    ("Your receipt - €1.234", (1234.0, "EUR")),
])
def test_amounts_in_a_subject(text, want):
    assert subs.amount_from_subject(text) == want


@pytest.mark.parametrize("text", [
    "Your receipt", "Invoice 12345", "Order #123456 receipt",
    "Invoice 2024-11-05", "Receipt 12345 EUR",     # a bare code needs decimals
    "Invoice AB12 EURO", "Receipt 7,99", "Receipt for room 4.5",
    "Quittung 5 CHF", "Receipt €0", "", None,
    # order / invoice numbers next to a currency are not the price
    "Invoice 2025-11 €", "Invoice no. 2025-0042 EUR", "Receipt 12/2025 EUR",
    "Receipt #4711 EUR", "Receipt 4711 $", "Receipt 4711 €", "Invoice 4711 EUR"])
def test_no_false_hit_on_order_numbers(text):
    assert subs.amount_from_subject(text or "") is None


@pytest.mark.parametrize("text,want", [
    ("Your receipt #4711 €9.99", 9.99),
    ("Invoice 12/2025 €9.99", 9.99),
    ("Invoice 10023 $9.99", 9.99),
    ("Invoice 2025-11 €9.99", 9.99),
    ("Receipt CB-4711 9,99 €", 9.99),
    ("Invoice no. 2025-0042 EUR 9.99", 9.99),
    ("Order #12 / 2025: 9.99 EUR", 9.99),
    ("Receipt 10023 USD 12.50", 12.5),
    ("Invoice 2025-11 - 9,99 €", 9.99),
])
def test_an_order_number_next_to_the_price_is_not_the_price(text, want):
    assert subs.amount_from_subject(text)[0] == want


def test_the_amount_comes_with_the_total_and_a_monthly_equivalent():
    s = _one(_receipts([30, 30, 30], subject="Your receipt - €7.99"))
    assert (s["amount"], s["currency"], s["amount_source"]) \
        == (7.99, "EUR", "subject")
    assert s["monthly"] == 7.99
    assert s["total"] == pytest.approx(31.96) and not s["total_estimated"]
    y = _one(_receipts([365, 365], last_ago=100, subject="Receipt $120.00"))
    assert y["cadence"] == "yearly" and y["monthly"] == pytest.approx(10.0)


def test_receipts_without_a_price_count_at_the_latest_and_say_so():
    mails = _receipts([30, 30, 30], subject="Your receipt")
    mails[0]["subject"] = "Your receipt - €5.00"            # the newest
    s = _one(mails)
    assert s["amount"] == 5.0 and s["total_estimated"]
    assert s["total"] == 20.0


def test_a_price_older_than_the_last_receipts_is_not_current():
    mails = _receipts([30] * 6, subject="Your receipt")
    mails[-1]["subject"] = "Your receipt - €5.00"         # the oldest only
    assert _one(mails)["amount"] is None


@pytest.mark.parametrize("text,want", [
    ("Thanks!\nSubtotal: €6.71\nTax: €1.28\nTotal: €7.99\n", (7.99, "EUR")),
    ("Amount due 12,50 EUR\nPaid with card", (12.5, "EUR")),
    ("Summe 9,99 €\nMwSt 1,60 €", (9.99, "EUR")),
    ("Items: €2.00 and €3.50 and €1.25", (3.5, "EUR")),   # no total: largest
    ("Plan renewed. Order 1234567", None),
    # the amount on the line under its label; savings are not the price
    ("Total\n€9.99\nThanks", (9.99, "EUR")),
    ("Price\n\n€9.99\nYou saved €120", (9.99, "EUR")),
    ("Price / €9.99 / You saved €120".replace(" / ", "\n"), (9.99, "EUR")),
    ("You saved €120\nItems: €9.99", (9.99, "EUR")),
    ("Total\nSubtotal €5.00\nTax €1.00\nTotal €6.00", (6.0, "EUR")),
    ("Preis:\n9,99 €\nSie sparen 20 €", (9.99, "EUR")),
    ("", None)])
def test_amounts_in_a_receipt_text(text, want):
    assert subs.amount_from_text(text) == want


# ----------------------------------------------------------- still in use?

def _with(mails, *extra, **kw):
    return _one(list(mails) + list(extra), **kw)["use"]


BASE = _receipts([30, 30, 30], last_ago=10)


def test_a_recent_sign_in_alert_means_in_use():
    u = _with(BASE, _mail(20, "New sign-in to your account"))
    assert u["state"] == "signin" and u["in_use"] and u["ts"] == _ts(20)


def test_an_opened_mail_of_theirs_means_in_use():
    u = _with(BASE, _mail(30, "What's new", seen=True))
    assert u["state"] == "read" and u["in_use"] and u["ts"] == _ts(30)
    # an unread one is no evidence
    assert not _with(BASE, _mail(30, "What's new", seen=False))["in_use"]


def test_the_receipts_themselves_are_no_evidence():
    mails = [dict(m, seen=True) for m in BASE]
    assert _with(mails)["state"] == "never"


def test_the_window_is_90_days():
    inside = _with(BASE, _mail(89, "New sign-in to your account"))
    assert inside["in_use"]
    out = _with(BASE, _mail(91, "New sign-in to your account"))
    assert out["state"] == "unused" and not out["in_use"]
    assert out["since"] == "signin" and out["ts"] == _ts(91)
    out = _with(BASE, _mail(120, "What's new", seen=True))
    assert out["state"] == "unused" and out["since"] == "read"


def test_unused_counts_their_other_mails_since_then():
    u = _with(BASE, _mail(200, "New sign-in to your account"),
              _mail(150, "News"), _mail(100, "More news"))
    assert (u["state"], u["others"]) == ("unused", 2)


def test_never_opened_without_any_evidence():
    u = _with(BASE, _mail(50, "News"), _mail(60, "More news"))
    assert (u["state"], u["in_use"], u["others"]) == ("never", False, 2)


def test_weak_account_words_are_no_sign_in():
    assert _with(BASE, _mail(10, "Welcome to FitTrack"))["state"] == "never"


# ---------------------------------------------------------------- listing

def _sub(addr, name, days_ago, price=None, **kw):
    subject = "Your receipt" + (f" - {price}" if price else "")
    return _receipts([30, 30, 30], last_ago=days_ago, subject=subject,
                     addr=addr, name=name, **kw)


def test_the_kpis_sum_the_main_currency_only():
    mails = (_sub("a@a.example", "A", 5, "€10.00",)
             + _sub("a@b.example", "B", 6, "€5.00")
             + _sub("a@c.example", "C", 7)
             + _sub("a@d.example", "D", 8, "$3.00"))
    mails += [_mail(20, "New sign-in", addr="a@a.example", name="A"),
              _mail(25, "New sign-in", addr="a@d.example", name="D")]
    out = subs.listing(_acc(mails), NOW)
    t = out["totals"]
    assert t["count"] == 4 and t["currency"] == "EUR"
    assert t["with_amount"] == 2 and t["monthly"] == 15.0
    assert t["other_currencies"] == ["USD"]
    assert t["unused"] == 2                      # B and C have no evidence
    assert t["unused_monthly"] == 5.0
    assert t["renewing"] == 0                    # monthly ones do not count
    assert [i["name"] for i in out["items"]] == ["D", "C", "B", "A"]


def test_renewing_within_60_days_counts_yearly_renewals_only():
    monthly = _sub("a@a.example", "A", 5) + _sub("a@b.example", "B", 5)
    far = _receipts([365, 365], last_ago=100, addr="a@y.example", name="Y")
    near = _receipts([365, 365], last_ago=320, addr="a@z.example", name="Z")
    out = subs.listing(_acc(monthly + far), NOW)
    assert out["totals"]["renewing"] == 0        # ~265 days out; monthly ones never
    out = subs.listing(_acc(monthly + far + near), NOW)
    assert out["totals"]["renewing"] == 1
    assert {i["key"]: i["next_days"] for i in out["items"]}["z.example"] == 45


def test_hidden_ones_stay_listed_but_leave_the_figures():
    acc = _acc(_sub("a@a.example", "A", 5, "€10.00")
               + _sub("a@b.example", "B", 6, "€5.00"))
    substore.set_hidden("b.example", True, "acct")
    out = subs.listing(acc, NOW)
    assert {i["key"]: i["hidden"] for i in out["items"]} == {
        "a.example": False, "b.example": True}
    assert out["totals"]["count"] == 1 and out["totals"]["monthly"] == 10.0
    substore.set_hidden("b.example", False, "acct")
    assert subs.listing(acc, NOW)["totals"]["count"] == 2


def test_nothing_private_leaks_into_the_answer():
    out = subs.listing(_acc(_sub("a@a.example", "A", 5)), NOW)
    assert not any(k.startswith("_") for k in out["items"][0])


# --------------------------------------------- the opt-in receipt text read

class Reader:
    """Stands in for mailops.fetch_messages (the local body fetch)."""

    def __init__(self, monkeypatch, text="Total: €7.99\n"):
        self.calls, self.text = [], text
        monkeypatch.setattr(mailops, "fetch_messages", self.fetch)

    def fetch(self, items, acc=None):
        self.calls.append([tuple(i) for i in items])
        return [{"folder": f, "uid": u, "text": self.text}
                for f, u in items]


def _two_subs():
    priced = _sub("a@a.example", "A", 5, "€10.00")
    bare = _sub("a@b.example", "B", 6)
    return _acc(priced + bare), bare


def test_nothing_is_read_while_the_opt_in_is_off(monkeypatch):
    reader = Reader(monkeypatch)
    acc, _ = _two_subs()
    with pytest.raises(ValueError):
        subs.read_amounts(acc, NOW)
    assert reader.calls == []
    r = client.post("/api/subscriptions/amounts")
    assert r.status_code == 400 and reader.calls == []


def test_only_the_latest_receipt_of_a_subscription_without_a_price_is_read(
        monkeypatch):
    reader = Reader(monkeypatch)
    acc, bare = _two_subs()
    substore.set_body_amounts(True, "acct")
    assert subs.read_amounts(acc, NOW) == {"read": 1, "found": 1}
    latest = max(bare, key=lambda m: m["ts"])
    assert reader.calls == [[(latest["folder"], latest["uid"])]]
    out = subs.listing(acc, NOW)
    b = next(i for i in out["items"] if i["key"] == "b.example")
    assert (b["amount"], b["currency"], b["amount_source"]) \
        == (7.99, "EUR", "receipt")
    assert out["unread_amounts"] == 0
    # nothing new to read the second time
    assert subs.read_amounts(acc, NOW) == {"read": 0, "found": 0}
    assert len(reader.calls) == 1


def test_a_newer_receipt_is_read_again(monkeypatch):
    reader = Reader(monkeypatch)
    acc = _acc(_sub("a@b.example", "B", 36))        # next one is overdue
    substore.set_body_amounts(True, "acct")
    subs.read_amounts(acc, NOW)
    fresh = _mail(6, "Your receipt", addr="a@b.example", name="B")
    acc.index[(fresh["folder"], fresh["uid"])] = fresh
    assert subs.listing(acc, NOW)["unread_amounts"] == 1
    subs.read_amounts(acc, NOW)
    assert reader.calls[-1] == [(fresh["folder"], fresh["uid"])]


def test_only_the_amount_and_currency_are_kept(monkeypatch, tmp_path):
    Reader(monkeypatch, text="Hello Jane Doe, thanks for paying.\n"
                             "Card ending 4242. Total: €7.99\nsecret-token-123")
    acc, _ = _two_subs()
    substore.set_body_amounts(True, "acct")
    subs.read_amounts(acc, NOW)
    saved = json.loads((tmp_path / "subscriptions.json").read_text())
    block = saved["accounts"]["acct"]
    assert set(block["amounts"]["b.example"]) == {"amount", "currency", "ts"}
    raw = json.dumps(saved)
    for leaked in ("Jane", "4242", "secret-token", "thanks"):
        assert leaked not in raw


def test_a_receipt_without_a_price_is_remembered_as_looked_at(monkeypatch):
    reader = Reader(monkeypatch, text="Thank you for your payment.")
    acc, _ = _two_subs()
    substore.set_body_amounts(True, "acct")
    assert subs.read_amounts(acc, NOW) == {"read": 1, "found": 0}
    assert subs.read_amounts(acc, NOW) == {"read": 0, "found": 0}
    assert len(reader.calls) == 1
    b = next(i for i in subs.listing(acc, NOW)["items"]
             if i["key"] == "b.example")
    assert b["amount"] is None


def test_hidden_subscriptions_are_not_read(monkeypatch):
    reader = Reader(monkeypatch)
    acc, _ = _two_subs()
    substore.set_body_amounts(True, "acct")
    substore.set_hidden("b.example", True, "acct")
    assert subs.read_amounts(acc, NOW)["read"] == 0 and reader.calls == []


def test_a_failed_fetch_stores_nothing(monkeypatch):
    monkeypatch.setattr(mailops, "fetch_messages", lambda items, acc=None: [
        {"folder": f, "uid": u, "error": "gone"} for f, u in items])
    acc, _ = _two_subs()
    substore.set_body_amounts(True, "acct")
    assert subs.read_amounts(acc, NOW) == {"read": 0, "found": 0}
    assert substore.load_account("acct")["amounts"] == {}


def test_switching_the_opt_in_off_forgets_the_amounts(monkeypatch):
    Reader(monkeypatch)
    acc, _ = _two_subs()
    substore.set_body_amounts(True, "acct")
    subs.read_amounts(acc, NOW)
    substore.set_body_amounts(False, "acct")
    assert substore.load_account("acct")["amounts"] == {}
    b = next(i for i in subs.listing(acc, NOW)["items"]
             if i["key"] == "b.example")
    assert b["amount"] is None


def test_the_body_read_never_goes_beyond_the_local_fetch(monkeypatch):
    """The only way out is mailops.fetch_messages (IMAP to the user's own
    server): any socket or HTTP attempt fails the test."""
    import socket
    Reader(monkeypatch)

    def no_network(*a, **k):
        raise AssertionError("network used")
    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    acc, _ = _two_subs()
    substore.set_body_amounts(True, "acct")
    subs.read_amounts(acc, NOW)


# ------------------------------------------------------------- reminders

def _day(days_ahead, hour=9):
    d = datetime.datetime.fromtimestamp(NOW, datetime.timezone.utc).date()
    t = datetime.datetime.combine(d + datetime.timedelta(days=days_ahead),
                                  datetime.time(hour),
                                  datetime.timezone.utc)
    return int(t.timestamp())


@pytest.fixture
def pushes(monkeypatch):
    got = []
    monkeypatch.setattr(webpush, "job_finished",
                        lambda acc, kind, ok, **p: got.append((kind, p)))
    return got


def _remind_acc(next_in_days):
    """One subscription whose next expected receipt is `next_in_days` away."""
    mails = _receipts([30, 30, 30], last_ago=30 - next_in_days,
                      subject="Your receipt - €7.99")
    return _acc(mails)


@pytest.mark.parametrize("ahead,due", [(5, False), (4, False), (3, True),
                                       (2, True), (1, True), (0, True),
                                       (-1, False)])
def test_a_reminder_is_due_three_days_before(pushes, ahead, due):
    acc = _remind_acc(ahead)
    substore.set_reminder("fittrack.example", True, "acct")
    assert subs.tick_account(acc, NOW) == (1 if due else 0)
    assert len(pushes) == (1 if due else 0)


def test_a_reminder_is_delivered_once_per_expected_date(pushes):
    acc = _remind_acc(3)
    substore.set_reminder("fittrack.example", True, "acct")
    assert subs.tick_account(acc, NOW) == 1
    assert subs.tick_account(acc, NOW) == 0
    assert subs.tick_account(acc, NOW + DAY) == 0
    assert len(pushes) == 1
    kind, p = pushes[0]
    assert kind == "reminder" and p["name"] == "FitTrack"
    assert (p["days"], p["amount"], p["currency"]) == (3, 7.99, "EUR")
    # the next receipt comes in a month: a new expected date, a new reminder
    later = _acc(_receipts([30, 30, 30, 30], last_ago=0,
                           subject="Your receipt - €7.99"))
    assert subs.tick_account(later, NOW + 27 * DAY) == 1


def test_no_reminder_without_the_ask_and_none_for_hidden(pushes):
    acc = _remind_acc(2)
    assert subs.tick_account(acc, NOW) == 0
    substore.set_reminder("fittrack.example", True, "acct")
    substore.set_hidden("fittrack.example", True, "acct")
    assert subs.tick_account(acc, NOW) == 0 and pushes == []
    assert "fittrack.example" not in substore.load_account("acct")["reminders"]


def test_turning_a_reminder_off_and_on_again_announces_again(pushes):
    acc = _remind_acc(2)
    substore.set_reminder("fittrack.example", True, "acct")
    subs.tick_account(acc, NOW)
    substore.set_reminder("fittrack.example", False, "acct")
    assert subs.tick_account(acc, NOW) == 0
    substore.set_reminder("fittrack.example", True, "acct")
    assert subs.tick_account(acc, NOW) == 1


def test_the_page_gets_the_fired_reminder_for_a_while(pushes):
    acc = _remind_acc(2)
    substore.set_reminder("fittrack.example", True, "acct")
    subs.tick_account(acc, NOW)
    got = subs.recent_reminders(acc, NOW + 3600)
    assert [(r["key"], r["name"]) for r in got] == [("fittrack.example",
                                                      "FitTrack")]
    assert subs.recent_reminders(acc, NOW + 4 * DAY) == []


def test_the_tick_walks_every_tenant_and_account(pushes, monkeypatch):
    seen = []
    monkeypatch.setattr(subs, "tick_account",
                        lambda acc, now=None: seen.append(acc.name))
    monkeypatch.setattr(accountsmod, "names", lambda: ["one", "two"])
    monkeypatch.setattr(accountsmod, "get",
                        lambda n=None: SimpleNamespace(name=n))
    subs.tick(NOW)
    assert seen == ["one", "two"]


# ---------------------------------------------------------- keep / hide

def test_keep_the_receipts_pins_every_receipt_and_can_undo():
    mails = _receipts([30, 30, 30])
    mails.append(_mail(80, "Newsletter"))           # not a receipt
    acc = _acc(mails)
    ids = {m["msgid"] for m in mails if m["subject"] == "Your receipt"}
    assert subs.listing(acc, NOW)["items"][0]["kept"] is False
    out = subs.keep_receipts(acc, "fittrack.example", True)
    assert out["changed"] == 4
    assert pinstore.load_account("acct") == ids
    assert subs.listing(acc, NOW)["items"][0]["kept"] is True
    subs.keep_receipts(acc, "fittrack.example", False)
    assert pinstore.load_account("acct") == set()
    assert acc.state["groups_rev"] == 3


def test_keeping_the_receipts_of_an_unknown_subscription_is_refused():
    with pytest.raises(ValueError):
        subs.keep_receipts(_acc(_receipts([30, 30, 30])), "nobody.example")


# ------------------------------------------------------------------- API

@pytest.fixture
def api_acc():
    acc = accountsmod.get()
    mails = _receipts([30, 30, 30], last_ago=5, subject="Your receipt - €7.99")
    for m in mails:
        acc.index[(m["folder"], m["uid"])] = m
    with acc.lock:
        acc.state["status"] = "done"
    return acc


def test_the_page_endpoint_lists_the_subscriptions(api_acc):
    r = client.get("/api/subscriptions")
    assert r.status_code == 200
    body = r.json()
    assert body["scanned"] is True and body["body_amounts"] is False
    assert [i["key"] for i in body["items"]] == ["fittrack.example"]
    assert body["totals"]["count"] == 1
    assert client.get("/api/subscriptions",
                      params={"account": "nope"}).status_code == 400


def test_hide_remind_and_settings_round_trip(api_acc):
    post = lambda path, **body: client.post("/api/subscriptions/" + path,
                                            json=body)
    assert post("remind", key="fittrack.example", on=True).status_code == 200
    item = client.get("/api/subscriptions").json()["items"][0]
    assert item["reminder"] is True and item["hidden"] is False
    assert post("hide", key="fittrack.example").status_code == 200
    body = client.get("/api/subscriptions").json()
    assert body["items"][0]["hidden"] and body["totals"]["count"] == 0
    assert body["items"][0]["reminder"] is False       # no reminder when hidden
    assert post("hide", key="fittrack.example", hidden=False).status_code == 200
    assert client.get("/api/subscriptions").json()["totals"]["count"] == 1
    assert post("settings", body_amounts=True).json()["body_amounts"] is True
    assert client.get("/api/subscriptions").json()["body_amounts"] is True


def test_actions_refuse_unknown_subscriptions_and_bad_input(api_acc):
    for path, body in (("hide", {"key": "nobody.example"}),
                       ("remind", {"key": "nobody.example"}),
                       ("keep", {"key": "nobody.example"})):
        assert client.post("/api/subscriptions/" + path,
                           json=body).status_code == 400, path
    assert client.post("/api/subscriptions/hide", json={}).status_code == 422


def test_keep_endpoint_pins_the_receipts(api_acc):
    r = client.post("/api/subscriptions/keep", json={"key": "fittrack.example"})
    assert r.status_code == 200 and r.json()["changed"] == 4
    assert client.get("/api/subscriptions").json()["items"][0]["kept"] is True


def test_the_amounts_endpoint_reads_only_with_the_opt_in(api_acc, monkeypatch):
    reader = Reader(monkeypatch)
    bare = [_mail(a, "Your receipt", addr="a@b.example", name="B")
            for a in (5, 35, 65)]
    for m in bare:
        api_acc.index[(m["folder"], m["uid"])] = m
    assert client.post("/api/subscriptions/amounts").status_code == 400
    client.post("/api/subscriptions/settings", json={"body_amounts": True})
    r = client.post("/api/subscriptions/amounts")
    assert r.status_code == 200 and r.json() == {"read": 1, "found": 1}
    assert len(reader.calls) == 1
    names = {i["key"]: i["amount"]
             for i in client.get("/api/subscriptions").json()["items"]}
    assert names["b.example"] == 7.99


def test_a_failing_mail_server_is_a_coded_error_not_a_crash(api_acc,
                                                           monkeypatch):
    bare = [_mail(a, "Your receipt", addr="a@b.example", name="B")
            for a in (5, 35, 65)]
    for m in bare:
        api_acc.index[(m["folder"], m["uid"])] = m

    def boom(items, acc=None):
        raise OSError("connection refused")
    monkeypatch.setattr(mailops, "fetch_messages", boom)
    client.post("/api/subscriptions/settings", json={"body_amounts": True})
    assert client.post("/api/subscriptions/amounts").status_code == 500


# -------------------------------------------------- tenants and accounts

def _oidc():
    from backend import config as cfgmod
    cfgmod.SERVER_PATH.write_text(json.dumps(
        {"auth": {"mode": "oidc", "oidc": {"admin": "admin@x.example"}}}))


def test_each_tenant_has_its_own_decisions(tmp_path):
    alice = tenants.for_subject("alice@x.example")
    bob = tenants.for_subject("bob@x.example")
    with tenants.use(alice):
        substore.set_hidden("fittrack.example", True, "acct")
        substore.set_reminder("a.example", True, "acct")
        substore.set_body_amounts(True, "acct")
    with tenants.use(bob):
        assert substore.load_account("acct") == {
            "hidden": [], "kept": {}, "reminders": {}, "fired": [],
            "amounts": {},
            "body_amounts": False}
    assert substore.load_account("acct")["hidden"] == []     # the default one
    assert (alice.root / "subscriptions.json").is_file()
    assert not (bob.root / "subscriptions.json").exists() \
        if bob.root.exists() else True


def test_decisions_are_per_account_and_follow_a_rename_or_drop():
    substore.set_hidden("fittrack.example", True, "old")
    substore.set_reminder("fittrack.example", True, "old")
    assert substore.load_account("other")["hidden"] == []
    substore.rename_account("old", "new")
    assert substore.load_account("old")["hidden"] == []
    assert substore.load_account("new")["hidden"] == ["fittrack.example"]
    assert "fittrack.example" in substore.load_account("new")["reminders"]
    substore.drop_account("new")
    assert substore.load_account("new")["hidden"] == []


def test_the_account_hooks_are_wired_into_the_settings_save():
    """rename / delete of an account moves / drops the decisions (the same
    hooks as the pins)."""
    from backend import config as cfgmod
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "old": {"host": "h", "user": "u", "password": "pw"},
        "keep": {"host": "h", "user": "u", "password": "pw"}}}))
    accountsmod.reset()
    substore.set_hidden("fittrack.example", True, "old")
    r = client.post("/api/config", json={"rename_account": {"from": "old",
                                                            "to": "new"}})
    assert r.status_code == 200, r.text
    assert substore.load_account("new")["hidden"] == ["fittrack.example"]
    assert substore.load_account("old")["hidden"] == []
    r = client.post("/api/config", json={"delete_account": "new"})
    assert r.status_code == 200, r.text
    assert substore.load_account("new")["hidden"] == []


def test_a_receipt_that_never_came_does_not_break_the_cadence():
    s = _one(_receipts([30, 31, 61, 30, 31, 30]))
    assert s["cadence"] == "monthly" and s["receipts"] == 7
    # ... but a third of a period off is no cadence
    assert subs.detect(_acc(_receipts([30, 31, 45, 30, 31, 45])), NOW) == []


# ------------------------------------------------ review round: fixes

def test_keep_pins_the_older_receipts_too_and_unpins_only_its_own():
    older = [_mail(300 + i * 13, "Your receipt") for i in range(3)]  # irregular
    mails = _receipts([30, 30, 30]) + older
    acc = _acc(mails)
    mine = next(m for m in mails if m["subject"] == "Your receipt")
    pinstore.set_pinned(mine["msgid"], True, "acct")         # the user's own
    out = subs.keep_receipts(acc, "fittrack.example", True)
    assert out["changed"] == 6                               # 7 receipts, 1 pinned
    assert pinstore.load_account("acct") == {m["msgid"] for m in mails}
    assert subs.listing(acc, NOW)["items"][0]["kept"] is True
    out = subs.keep_receipts(acc, "fittrack.example", False)
    assert out["changed"] == 6
    assert pinstore.load_account("acct") == {mine["msgid"]}  # still theirs
    assert substore.load_account("acct")["kept"] == {}


def test_what_keep_pinned_follows_the_account_and_is_per_account():
    acc = _acc(_receipts([30, 30, 30]))
    subs.keep_receipts(acc, "fittrack.example", True)
    assert substore.load_account("other")["kept"] == {}
    substore.rename_account("acct", "new")
    assert list(substore.load_account("new")["kept"]) == ["fittrack.example"]


def test_a_newsletter_with_invoice_in_it_is_no_receipt():
    news = []
    for ago in (5, 35, 65, 95):
        m = _mail(ago, "Your invoice tips: save 20% on the next one")
        m["bulk"] = True
        news.append(m)
    assert subs.detect(_acc(news), NOW) == []
    # the same subject without List-Unsubscribe is a receipt-like mail
    for m in news:
        m["bulk"] = False
    assert len(subs.detect(_acc(news), NOW)) == 1
    # a plain receipt that merely carries List-Unsubscribe still counts
    real = _receipts([30, 30, 30])
    for m in real:
        m["bulk"] = True
    assert len(subs.detect(_acc(real), NOW)) == 1


@pytest.mark.parametrize("subject", [
    "Ihr Kontoauszug 11/2026", "Your monthly statement is ready",
    "Depotauszug Oktober", "Account statement"])
def test_bank_statements_are_no_receipts(subject):
    assert subs.is_receipt(subject) is False
    assert subs.detect(_acc(_receipts([30, 30, 30], subject=subject)), NOW) == []


def test_the_monthly_day_is_the_day_of_the_next_receipt():
    s = _one(_receipts([30, 31, 29, 30], last_ago=10))
    nxt = datetime.datetime.fromtimestamp(s["next"], datetime.timezone.utc)
    assert s["day"] == nxt.day
    assert s["next_date"] == nxt.date().isoformat()


def test_detection_is_cached_per_index_revision_and_does_not_hold_the_lock():
    mails = _receipts([30, 30, 30])
    acc = _acc(mails)
    calls = []
    real = subs._fields

    held = []
    inner = acc.lock

    class Lock:
        def __enter__(self):
            held.append(1)
            return inner.__enter__()

        def __exit__(self, *a):
            return inner.__exit__(*a)
    acc.lock = Lock()
    try:
        subs._fields = lambda m: (calls.append(1), real(m))[1]
        subs.detect(acc, NOW)
        n = len(calls)
        assert n == len(mails)                       # one pass over the index
        subs.detect(acc, NOW)
        subs.listing(acc, NOW)
        subs.item(acc, "fittrack.example", NOW)
        assert len(calls) == n                       # a click is not a rescan
        acc.state["groups_rev"] += 1                 # the index changed
        subs.detect(acc, NOW)
        assert len(calls) == 2 * n
    finally:
        subs._fields = real
    # per mail work happens outside the lock: it is taken once per pass
    assert held.count(1) >= 2


def test_the_lock_is_not_held_while_the_mails_are_read():
    acc = _acc(_receipts([30, 30, 30]))
    real = subs._fields
    inside = []

    def other_thread_takes_it():
        got = acc.lock.acquire(timeout=0.5)
        if got:
            acc.lock.release()
        inside.append(got)

    def probe(m):
        # the lock is re-entrant for this thread, so ask from another one
        t = threading.Thread(target=other_thread_takes_it)
        t.start()
        t.join()
        return real(m)
    subs._fields = probe
    try:
        subs.detect(acc, NOW)
    finally:
        subs._fields = real
    assert inside and all(inside)


@pytest.mark.parametrize("text,want", [
    ("Receipt 4711 € - total 9,99 €", 9.99),
    ("Receipt 4711 € total €9.99", 9.99),
    ("Invoice 12 € / 9.99 EUR", 9.99),
    ("Receipt €3", 3.0),                       # a lone price without cents
])
def test_a_hit_with_decimals_wins_over_a_bare_number(text, want):
    assert subs.amount_from_subject(text)[0] == want


def test_a_subject_that_states_an_amount_is_never_a_newsletter():
    mails = []
    for ago in (5, 35, 65, 95):
        m = _mail(ago, "Your receipt - €9.99 incl. 19% VAT")
        m["bulk"] = True
        mails.append(m)
    got = subs.detect(_acc(mails), NOW)
    assert len(got) == 1 and got[0]["amount"] == 9.99
    for m in mails:                         # without an amount it still is one
        m["subject"] = "Your invoice - 19% off, free upgrade"
    assert subs.detect(_acc(mails), NOW) == []


@pytest.mark.parametrize("subject,receipt", [
    ("Your invoice/statement is ready", True),
    ("Your monthly bill statement: invoice", True),
    ("Your bank statement invoice", False),
    ("Account statement 11/2026", False),
    ("Your credit card statement is ready", False),
    ("Ihr Kontoauszug", False)])
def test_only_account_statements_are_excluded(subject, receipt):
    assert subs.is_receipt(subject) is receipt


def test_kept_shows_only_when_keep_pinned_them_itself():
    mails = _receipts([30, 30, 30])
    acc = _acc(mails)
    pinstore.set_many({m["msgid"] for m in mails}, True, "acct")   # by hand
    assert subs.listing(acc, NOW)["items"][0]["kept"] is False
    out = subs.keep_receipts(acc, "fittrack.example", True)
    assert out["changed"] == 0                      # nothing left to pin
    assert subs.listing(acc, NOW)["items"][0]["kept"] is False
    # a partly hand-pinned one: Keep pins the rest and shows kept; off unpins
    # only those
    pinstore.set_many({m["msgid"] for m in mails}, False, "acct")
    first = mails[0]["msgid"]
    pinstore.set_pinned(first, True, "acct")
    subs.keep_receipts(acc, "fittrack.example", True)
    assert subs.listing(acc, NOW)["items"][0]["kept"] is True
    subs.keep_receipts(acc, "fittrack.example", False)
    assert pinstore.load_account("acct") == {first}
    assert subs.listing(acc, NOW)["items"][0]["kept"] is False
