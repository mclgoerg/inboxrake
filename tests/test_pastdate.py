"""Mail past its date (backend/pastdate.py): what each subject says it is, the
date reader, the four reasons with their lifetimes, the receipts that are
kept, the pinned mail and protected senders that are never listed, the
account-level answers (summary / items / `is:expired` / the kept view), the
trash step the listed mails end up in, and the per-account cache."""

import datetime as dt
import random
import re
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops, mcptools, pastdate, pinstore, tenants
from backend import smartkinds
from backend.main import app

from conftest import make_msg, wait_delete_done

client = TestClient(app)

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 26, 12, 0, tzinfo=UTC).timestamp()
DAY = 86400
_uids = iter(range(1, 10**6))


def mail(subject, days_ago=10, addr="orders@shop.example", size=1000,
         msgid=None, folder="INBOX", ts=None):
    n = next(_uids)
    return {"folder": folder, "uid": n, "msgid": msgid or f"<{n}@x.example>",
            "addr": addr, "subject": subject, "size": size,
            "ts": int(ts if ts is not None else NOW - days_ago * DAY)}


def find(mails, pins=(), protected=(), now=NOW):
    return pastdate.find(mails, set(pins), list(protected), now)


def reasons(res):
    return sorted(r for r, _size in res["flagged"].values())


def ids(res, mails):
    """The subjects of the mails that were listed."""
    handles = set(res["flagged"])
    return sorted(m["subject"] for m in mails
                  if (m["folder"], m["uid"]) in handles)


# ------------------------------------------------------ what a subject is

CODES = ["Your sign-in code", "Confirm your email address",
         "Your verification code is 123456", "Ihr Anmeldecode",
         "Bestätige deine Adresse", "Your one-time passcode",
         "Your magic link", "Login-Link für dein Konto", "Verify your account",
         "Dein Code: 4711", "Security code for your sign-in"]
NOT_CODES = ["Welcome to Shop", "Your 20% discount code", "Weekly digest",
             "Your promo code expires soon", "Password changed",
             "Booking confirmation code ABC123",
             "Your code: WELCOME10 for 10% off", "Your code review is ready",
             "Your code of conduct update", "Dein Code SOMMER10 für 10 % Rabatt",
             "Your discount code: SAVE20", "Verify your email to get 10% off",
             "Your code is in the mail", "Ihr Code zum Gewinnspiel",
             # worth money, with digits
             "Your code 12345 for a 25 EUR gift card",
             "Dein Code 4711 - jetzt einlösen",
             "Your voucher code 55555", "Geschenkkarte: Ihr Code 123456",
             "Guthaben aufladen: Ihr Code 998877",
             "Redeem your code 123456 today"]
UPDATES = ["Your order #12345 has shipped", "Out for delivery: order #12345",
           "Your parcel is on its way - order 55512",
           "Ihre Sendung ist unterwegs", "Your package is in transit",
           "Your order #12345 will be delivered tomorrow",
           "Versandbestätigung zu Bestellung 12345"]
DELIVERED = ["Your order #12345 was delivered", "Delivered: order #12345",
             "Your package has been delivered", "Ihre Bestellung 12345 wurde zugestellt",
             "Paket geliefert: 12345", "Your parcel has arrived"]
NOT_DELIVERED = ["Out for delivery: order #12345",
                 "Your order will be delivered tomorrow",
                 "Delivery failed: order #12345",
                 "Your parcel could not be delivered",
                 "Zustellversuch für Sendung 12345",
                 "Ihr Paket wird heute zugestellt",
                 "Your parcel is being delivered",
                 "Expected delivery: Friday", "Estimated delivery date",
                 "Your parcel arrives tomorrow", "Not delivered: order 12345",
                 "Return label for order #12345 delivered to us",
                 # on its way, not at the door
                 "Your parcel has arrived at the sorting facility",
                 "Ihr Paket ist im Paketzentrum angekommen",
                 "Your parcel was delivered to a pickup point",
                 "Your package is delivered tomorrow",
                 "Your order is delivered tomorrow",
                 "Ihr Paket wurde in der Filiale abgegeben",
                 "Your order has arrived at the depot",
                 "Ihre Sendung ist am Zustellstützpunkt angekommen",
                 "Your parcel has arrived at the hub",
                 "Ihr Paket wird morgen geliefert",
                 "Your parcel is at the parcel shop",
                 "Delivered: your parcel is coming tomorrow",
                 "Geliefert: Ihr Paket kommt morgen"]
REMINDERS = ["Reminder: your appointment on 12 Nov",
             "Your table on Friday", "Terminerinnerung: 12.11.",
             "Reminder: webinar on 3 Dec", "Erinnerung: Ihr Termin morgen",
             "Reminder: your booking on 12 Nov",
             "Don't forget your visit tomorrow"]
RECEIPTS = ["Order confirmation #12345", "Invoice for order #12345",
            "Rechnung 12345", "Booking confirmed: 12 Nov",
            "Terminbestätigung 12.11.", "Ihr Termin am 12.11.",
            "Your tickets for Friday", "Bestellbestätigung 12345",
            "Thank you for your order", "Your order #12345",
            "Appointment confirmation", "Buchung bestätigt"]
# Ambiguous: it may be the confirmation of an order or a booking. Never listed,
# whatever date or "delivered" mail comes later.
CONFIRMATIONS = [
    "Your order #12345 has been received and will be shipped soon",
    "Bestellung 12345 eingegangen - wird bald versendet",
    "Thanks for your booking - see you tomorrow",
    "Confirmed: your appointment tomorrow",
    "Your table on Friday is confirmed",
    "We received your order #12345",
    "Your order #12345 is confirmed",
    "Order placed: #12345 - shipping soon",
    "Buchung eingegangen: wir freuen uns auf morgen",
    "Your reservation is confirmed for Friday",
    "Ihr Termin ist bestätigt - bis Freitag",
    "Termin morgen bestätigt",
    "Danke für Ihre Reservierung am Freitag",
    "Your appointment has been booked for Friday",
    "Vielen Dank für Ihren Einkauf, Bestellung 12345 wird versendet",
    "Reservation received - Friday evening",
    "Bestellung 12345 aufgegeben, Lieferung folgt",
    "Your flight on Friday is confirmed",
    "Registration confirmed: Friday workshop",
    "Ihr Tisch am Freitag ist reserviert",
    "Appointment scheduled for Friday",
    "Thanks! Your order #12345 will ship soon",
    "Termin vereinbart für Freitag",
    "Confirm your appointment on Friday",
    "Bitte bestätigen Sie Ihren Termin am Freitag",
]
OFFERS = ["Deal ends at midnight", "Only today: flash prices",
          "Sale ends Sunday", "Bis Sonntag: 20% Rabatt",
          "Flash sale ends tomorrow", "Offer valid until 25 Nov"]
NOT_OFFERS = ["Bis zu 50% Rabatt", "Black Friday sale: 30% off",
              "Weekly digest", "Our new collection is here",
              "Rechnung zahlbar bis Freitag"]


def test_the_smartkinds_rules_it_reuses_still_exist():
    ids = {rid for _p, rid, _rx in smartkinds.PURPOSE_RULES}
    assert {"shipping", "invoice", "order", "appointment", "booking"} <= ids
    assert pastdate.SHIPPING_RX is smartkinds.PURPOSE_RULES[1][2]


@pytest.mark.parametrize("subject", CODES)
def test_codes(subject):
    assert pastdate.classify(subject) == pastdate.CODE


@pytest.mark.parametrize("subject", NOT_CODES)
def test_not_codes(subject):
    assert pastdate.classify(subject) != pastdate.CODE


@pytest.mark.parametrize("subject", UPDATES)
def test_shipping_updates(subject):
    assert pastdate.classify(subject) == pastdate.SHIPPING


@pytest.mark.parametrize("subject", DELIVERED)
def test_the_delivered_matcher_says_arrived(subject):
    assert pastdate.classify(subject) == pastdate.DELIVERED


@pytest.mark.parametrize("subject", NOT_DELIVERED)
def test_the_delivered_matcher_does_not_say_arrived_for_a_parcel_on_its_way(
        subject):
    assert pastdate.classify(subject) != pastdate.DELIVERED


@pytest.mark.parametrize("subject", REMINDERS)
def test_reminders(subject):
    assert pastdate.classify(subject) == pastdate.EVENT


@pytest.mark.parametrize("subject", RECEIPTS)
def test_receipts_invoices_and_bookings_are_decided_first(subject):
    assert pastdate.classify(subject) == pastdate.RECEIPT


@pytest.mark.parametrize("subject", OFFERS)
def test_offers(subject):
    assert pastdate.classify(subject) == pastdate.OFFER


@pytest.mark.parametrize("subject", NOT_OFFERS)
def test_not_offers(subject):
    assert pastdate.classify(subject) != pastdate.OFFER


def test_a_receipt_that_also_says_shipped_or_reminder_stays_a_receipt():
    for s in ["Invoice and shipping confirmation #12345",
              "Order confirmation: shipped 12345",
              "Terminbestätigung und Erinnerung 12.11."]:
        assert pastdate.classify(s) == pastdate.RECEIPT


@pytest.mark.parametrize("subject", CONFIRMATIONS)
def test_whatever_may_confirm_an_order_or_a_booking_is_a_receipt(subject):
    assert pastdate.classify(subject) == pastdate.RECEIPT


@pytest.mark.parametrize("subject", CONFIRMATIONS)
def test_a_possible_confirmation_is_never_listed_however_old(subject):
    old = mail(subject, 400)
    later = mail("Your order #12345 was delivered", 300)
    res = find([old, later])
    assert res["flagged"] == {}, subject


def test_a_shipping_confirmation_is_still_a_parcel_update():
    for s in ["Versandbestätigung zu Bestellung 12345",
              "Shipping confirmation for order #12345",
              "Delivery confirmation: your parcel is on its way - order 12345"]:
        assert pastdate.classify(s) == pastdate.SHIPPING, s
    ship = mail("Shipping confirmation for order #12345", 10)
    assert len(find([ship, mail("Your order #12345 was delivered", 5)]
                    )["flagged"]) == 1


def test_a_reminder_needs_a_reminder_word_a_bare_tomorrow_may_be_a_booking():
    assert pastdate.classify("Your appointment tomorrow at 10:00") \
        != pastdate.EVENT
    assert pastdate.classify("Ihr Termin morgen um 10 Uhr") != pastdate.EVENT
    assert pastdate.classify("Reminder: your appointment tomorrow") \
        == pastdate.EVENT
    assert pastdate.classify("Erinnerung: Ihr Termin morgen") \
        == pastdate.EVENT


def test_returns_and_refunds_are_no_parcel_updates():
    for s in ["Return label for order #12345", "Refund for order #12345",
              "Ihre Retoure 12345"]:
        assert pastdate.classify(s) != pastdate.SHIPPING


def test_order_numbers():
    assert pastdate.order_number("Your order #12345 has shipped") == "12345"
    assert pastdate.order_number("Order No. AB-4471 shipped") == "ab-4471"
    assert pastdate.order_number("Bestellnummer 4711-22") == "4711-22"
    assert pastdate.order_number("Ihre Sendung 123456 kommt") == "123456"
    assert pastdate.order_number("Bestellbestätigung 77123") == "77123"
    assert pastdate.order_number("Bestellnummer 4711-22 ist da") == "4711-22"
    assert pastdate.order_number("Your order has shipped") is None
    assert pastdate.order_number("Order #12 shipped") is None   # too short
    assert pastdate.order_number("") is None


# ----------------------------------------------------------- the date reader

REF = dt.datetime(2026, 11, 10, 12, tzinfo=UTC).timestamp()     # a Tuesday


@pytest.mark.parametrize("subject,want", [
    ("Reminder: your appointment on 12 Nov", (2026, 11, 12)),
    ("Termin am 12. November", (2026, 11, 12)),
    ("Terminerinnerung: 12.11.", (2026, 11, 12)),
    ("Termin am 12.11.2026", (2026, 11, 12)),
    ("Termin am 12.11.27", (2027, 11, 12)),
    ("Event on 2026-11-12", (2026, 11, 12)),
    ("Event on Nov 12", (2026, 11, 12)),
    ("Event on November 12, 2027", (2027, 11, 12)),
    ("Event on 1st of December", (2026, 12, 1)),
    ("Reminder: Jan 5", (2027, 1, 5)),               # next year
    ("Your table on Friday", (2026, 11, 13)),
    ("Sale ends Tuesday", (2026, 11, 10)),           # today counts
    ("Aktion bis Sonntag", (2026, 11, 15)),
    ("Deal ends at midnight", (2026, 11, 10)),
    ("Nur heute", (2026, 11, 10)),
    ("Reminder: tomorrow", (2026, 11, 11)),
    ("Erinnerung: morgen", (2026, 11, 11)),
    ("Event in 3 days", (2026, 11, 13)),
    ("Event the day after tomorrow", (2026, 11, 12)),
    ("Moved from 12 Nov to 15 Nov", (2026, 11, 15)),  # the latest wins
])
def test_read_date(subject, want):
    assert pastdate.read_date(subject, REF) == dt.date(*want)


@pytest.mark.parametrize("subject", [
    "Weekly digest", "Guten Morgen", "Version 1.2.345", "Nov 2026 news",
    "Your 2026 recap", "Order 30.02.", ""])
def test_read_date_finds_nothing(subject):
    assert pastdate.read_date(subject, REF) is None


def test_a_date_is_over_when_its_whole_day_is_over_everywhere():
    day = dt.date(2026, 11, 25)
    end = dt.datetime(2026, 11, 26, tzinfo=UTC).timestamp()
    assert not pastdate.is_over(day, end + 13 * 3600)
    assert pastdate.is_over(day, end + 14 * 3600)
    assert not pastdate.is_over(dt.date(2026, 11, 26), NOW)


def test_the_gate_lets_every_kind_through():
    for s in (CODES + UPDATES + DELIVERED + REMINDERS + OFFERS
              + ["Out for delivery"]):
        assert pastdate._gate(s), s
    assert not pastdate._gate("Photos from the weekend trip")


def test_the_gate_lets_through_every_subject_the_shipping_rule_knows():
    """The gate is a superset of the smartkinds rule it sits in front of: a
    new word there that the gate lacks would silently be missed."""
    from test_smartkinds import TABLES
    for s in TABLES["shipping"][0]:
        if pastdate.SHIPPING_RX.search(s) and not pastdate.RETURN_RE.search(s):
            assert pastdate._gate(s), s


def test_the_gate_pattern_means_contains_any_stem():
    rnd = random.Random(2)
    alphabet = "abcdefghilmnopqrstuvwxyz -äö"
    for _ in range(3000):
        s = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(1, 40)))

        want = any(k in s for k in pastdate.GATE_ANY) or any(
            re.search(r"\b" + re.escape(k), s) for k in pastdate.GATE_WORD)
        assert pastdate._gate(s) == want, s


# ------------------------------------------------------------------ codes

def test_a_code_is_listed_once_it_is_older_than_a_day():
    old = mail("Your sign-in code", days_ago=1.01)
    new = mail("Your sign-in code", days_ago=0.9)
    res = find([old, new])
    assert ids(res, [old, new]) == ["Your sign-in code"]
    assert (old["folder"], old["uid"]) in res["flagged"]
    assert (new["folder"], new["uid"]) not in res["flagged"]
    assert reasons(res) == ["codes"]


def test_a_welcome_mail_and_a_promo_code_have_no_lifetime():
    mails = [mail("Welcome to Shop", 400), mail("Your 20% discount code", 400)]
    assert find(mails)["flagged"] == {}


# ----------------------------------------------------------------- parcels

def test_a_shipping_update_goes_with_a_later_delivered_mail_three_days_old():
    ship = mail("Your order #12345 has shipped", 10)
    way = mail("Out for delivery: order #12345", 9)
    done = mail("Your order #12345 was delivered", 4)
    res = find([ship, way, done])
    assert reasons(res) == ["parcels", "parcels"]
    assert ids(res, [ship, way, done]) == sorted(
        [ship["subject"], way["subject"]])
    # the delivered mail itself is proof of delivery: it stays
    assert (done["folder"], done["uid"]) not in res["flagged"]


def test_delivered_less_than_three_days_ago_is_not_enough():
    ship = mail("Your order #12345 has shipped", 10)
    assert find([ship, mail("Your order #12345 was delivered", 2.9)]
                )["flagged"] == {}
    assert find([ship, mail("Your order #12345 was delivered", 3.0)]
                )["flagged"] != {}


def test_the_delivered_mail_must_come_later():
    done = mail("Your order #12345 was delivered", 20)
    ship = mail("Your order #12345 has shipped", 10)       # a second parcel
    assert find([done, ship])["flagged"] == {}


def test_out_for_delivery_is_not_delivered():
    ship = mail("Your order #12345 has shipped", 10)
    for later in ("Out for delivery: order #12345",
                  "Your order #12345 will be delivered tomorrow",
                  "Delivery failed: order #12345",
                  "Zustellversuch für Sendung 12345"):
        assert find([ship, mail(later, 5)])["flagged"] == {}, later


def test_another_order_or_another_sender_or_no_number_does_not_count():
    ship = mail("Your order #12345 has shipped", 10)
    assert find([ship, mail("Your order #99999 was delivered", 5)]
                )["flagged"] == {}
    assert find([ship, mail("Your order #12345 was delivered", 5,
                            addr="orders@other.example")])["flagged"] == {}
    nonum = mail("Your order has shipped", 10)
    assert find([nonum, mail("Your order was delivered", 5)])["flagged"] == {}


def test_one_company_is_one_sender_across_its_addresses():
    ship = mail("Your order #12345 has shipped", 10,
                addr="shipping@mail.shop.example")
    done = mail("Your order #12345 was delivered", 5,
                addr="orders@shop.example")
    assert len(find([ship, done])["flagged"]) == 1


def test_partial_deliveries_follow_each_other():
    a = mail("Order #12345 part 1 has shipped", 12)
    a_done = mail("Order #12345 part 1 was delivered", 8)
    b = mail("Order #12345 part 2 is on its way", 7)        # after the first
    res = find([a, a_done, b])
    assert ids(res, [a, a_done, b]) == [a["subject"]]
    b_done = mail("Order #12345 part 2 was delivered", 4)
    res = find([a, a_done, b, b_done])
    assert ids(res, [a, a_done, b, b_done]) == sorted(
        [a["subject"], b["subject"]])


# ------------------------------------------------------------------ kept

def test_receipts_of_the_same_order_are_kept_and_never_listed():
    ship = mail("Your order #12345 has shipped", 10)
    done = mail("Your order #12345 was delivered", 5)
    conf = mail("Order confirmation #12345", 12)
    inv = mail("Invoice for order #12345", 11)
    other = mail("Order confirmation #77777", 12)
    res = find([ship, done, conf, inv, other])
    assert ids(res, [ship, done, conf, inv, other]) == [ship["subject"]]
    assert res["kept"] == {(conf["folder"], conf["uid"]),
                           (inv["folder"], inv["uid"])}


def test_a_german_order_confirmation_is_kept_by_its_number():
    ship = mail("Ihre Bestellung 77123 wurde versendet", 10)
    done = mail("Ihre Bestellung 77123 wurde zugestellt", 5)
    conf = mail("Bestellbestätigung 77123", 12)
    other = mail("Bestellbestätigung 88999", 12)
    res = find([ship, done, conf, other])
    assert ids(res, [ship, done, conf, other]) == [ship["subject"]]
    assert res["kept"] == {(conf["folder"], conf["uid"])}


def test_a_code_worth_money_is_never_listed_however_old():
    mails = [mail(s, 400) for s in (
        "Your code 12345 for a 25 EUR gift card",
        "Dein Code 4711 - jetzt einlösen")]
    assert find(mails)["flagged"] == {}


def test_an_order_that_is_not_listed_keeps_nothing():
    conf = mail("Order confirmation #12345", 12)
    ship = mail("Your order #12345 has shipped", 10)       # not delivered yet
    res = find([conf, ship])
    assert res["flagged"] == {} and res["kept"] == set()


def test_a_receipt_with_the_same_number_from_another_sender_is_not_kept():
    ship = mail("Your order #12345 has shipped", 10)
    done = mail("Your order #12345 was delivered", 5)
    conf = mail("Order confirmation #12345", 12, addr="orders@other.example")
    assert find([ship, done, conf])["kept"] == set()


def test_the_booking_of_an_appointment_is_kept():
    rem = mail("Reminder: your appointment on 12 Nov", 20, addr="a@clinic.example")
    book = mail("Booking confirmed: 12 Nov", 40, addr="b@clinic.example")
    elsewhere = mail("Booking confirmed: 3 Dec", 40, addr="b@clinic.example")
    res = find([rem, book, elsewhere])
    assert ids(res, [rem, book, elsewhere]) == [rem["subject"]]
    assert res["kept"] == {(book["folder"], book["uid"])}


def test_the_booking_of_an_undated_reminder_is_kept_within_45_days():
    rem = mail("Reminder: your appointment", 40, addr="a@clinic.example")
    near = mail("Terminbestätigung", 60, addr="a@clinic.example")
    far = mail("Terminbestätigung", 120, addr="a@clinic.example")
    res = find([rem, near, far])
    assert res["kept"] == {(near["folder"], near["uid"])}


def test_a_booking_is_not_a_reminder():
    mails = [mail("Booking confirmed: 12 Nov", 40),
             mail("Ihr Termin am 12.11.", 40),
             mail("Terminbestätigung 12.11.", 40),
             mail("Your tickets for Friday", 40),
             mail("Reservierung am Freitag", 40)]
    assert find(mails)["flagged"] == {}


# ----------------------------------------------------------------- events

def test_a_reminder_with_a_date_goes_when_the_date_is_over():
    past = mail("Reminder: your appointment on 12 Nov", 20)    # sent 6 Nov
    soon = mail("Reminder: your appointment on 30 Nov", 2)
    table = mail("Your table on Friday", 14)                   # Fri 13 Nov
    res = find([past, soon, table])
    assert ids(res, [past, soon, table]) == sorted(
        [past["subject"], table["subject"]])
    assert set(reasons(res)) == {"events"}


def test_a_reminder_without_a_date_goes_after_30_days():
    old = mail("Reminder: your appointment", 30)
    young = mail("Reminder: your appointment", 29)
    res = find([old, young])
    assert (old["folder"], old["uid"]) in res["flagged"]
    assert (young["folder"], young["uid"]) not in res["flagged"]


def test_a_date_of_yesterday_is_not_over_everywhere_yet():
    sent = NOW - 3 * DAY
    day = (dt.datetime.fromtimestamp(NOW, UTC).date() - dt.timedelta(days=1))
    sub = f"Reminder: your appointment on {day.day} " \
          f"{day.strftime('%b')}"
    m = mail(sub, ts=sent)
    # yesterday's last hours are still today in the far east: 12:00 UTC is
    # before 14:00 UTC of the next day
    assert find([m], now=NOW)["flagged"] == {}
    assert find([m], now=NOW + DAY)["flagged"] != {}


def test_a_date_in_the_next_year_is_not_over():
    m = mail("Reminder: your appointment on 5 Jan", 20)    # sent 6 Nov 2026
    assert find([m])["flagged"] == {}


# ----------------------------------------------------------------- offers

def test_an_offer_goes_when_its_end_has_passed():
    gone = mail("Sale ends Sunday: 20% off", 12)     # sent Fri 14 Nov
    midnight = mail("Deal ends at midnight", 5)
    future = mail("Offer valid until 30 Nov", 3)
    today = mail("Only today: flash prices", 0.2)
    res = find([gone, midnight, future, today])
    assert ids(res, [gone, midnight, future, today]) == sorted(
        [gone["subject"], midnight["subject"]])
    assert set(reasons(res)) == {"offers"}


def test_an_offer_without_an_end_date_is_never_listed():
    m = mail("Flash sale ends soon", 100)
    assert find([m])["flagged"] == {}


# ---------------------------------------------------- pinned and protected

def _everything():
    return [mail("Your sign-in code", 5),
            mail("Your order #12345 has shipped", 10),
            mail("Your order #12345 was delivered", 5),
            mail("Reminder: your appointment on 12 Nov", 20),
            mail("Deal ends at midnight", 5)]


def test_pinned_mail_is_never_listed():
    mails = _everything()
    base = find(mails)
    assert len(base["flagged"]) == 4
    for m in mails:
        got = find(mails, pins={m["msgid"]})
        assert (m["folder"], m["uid"]) not in got["flagged"]
    assert find(mails, pins={m["msgid"] for m in mails})["flagged"] == {}


def test_a_protected_sender_is_never_listed():
    mails = _everything()
    assert find(mails, protected=["orders@shop.example"])["flagged"] == {}
    assert find(mails, protected=["@shop.example"])["flagged"] == {}
    assert len(find(mails, protected=["@other.example"])["flagged"]) == 4


def test_a_pinned_delivered_mail_still_says_the_parcel_arrived():
    ship = mail("Your order #12345 has shipped", 10)
    done = mail("Your order #12345 was delivered", 5)
    assert len(find([ship, done], pins={done["msgid"]})["flagged"]) == 1


def test_a_mail_is_in_one_reason_only():
    res = find(_everything())
    assert sorted(reasons(res)) == ["codes", "events", "offers", "parcels"]


def test_mail_without_a_date_or_a_subject_is_left_alone():
    a = mail("Your sign-in code", ts=0)
    b = mail("", 5)
    assert find([a, b])["flagged"] == {}


# ------------------------------------------------------------ the account

def acc_of(mails, name="acct", rev=1):
    return SimpleNamespace(
        name=name, lock=threading.RLock(),
        index={i: m for i, m in enumerate(mails)},
        state={"groups_rev": rev})


def test_summary_counts_per_reason_and_ticks_everything_but_offers():
    mails = _everything() + [mail("Order confirmation #12345", 12)]
    for m in mails:
        m["size"] = 100
    acc = acc_of(mails)
    s = pastdate.summary(acc, NOW)
    assert s["mails"] == 4 and s["size"] == 400 and s["kept"] == 1
    assert [r["id"] for r in s["reasons"]] == list(pastdate.REASONS)
    # the four of this module, then the three automatic-mail reasons
    # (tests/test_automail.py) - nothing of those in these mails
    assert [r["mails"] for r in s["reasons"]] == [1, 1, 1, 1, 0, 0, 0]
    assert {r["id"]: r["ticked"] for r in s["reasons"]} == {
        "codes": True, "parcels": True, "events": True, "offers": False,
        "ooo": True, "bounces": True, "answers": False}


def test_a_summary_without_mail_is_all_zero():
    s = pastdate.summary(acc_of([]), NOW)
    assert s["mails"] == 0 and s["kept"] == 0
    assert all(r["mails"] == 0 and r["size"] == 0 for r in s["reasons"])


def test_items_by_reason():
    mails = _everything()
    acc = acc_of(mails)
    everything = pastdate.items(acc, None, NOW)
    assert len(everything) == 4
    only = pastdate.items(acc, ["codes"], NOW)
    assert only == [[mails[0]["folder"], mails[0]["uid"]]]
    assert pastdate.items(acc, [], NOW) == []
    with pytest.raises(ValueError):
        pastdate.items(acc, ["codes", "nope"], NOW)


def test_the_answer_is_cached_until_something_changes(monkeypatch):
    acc = acc_of(_everything())
    calls = []
    real = pastdate.find
    monkeypatch.setattr(pastdate, "find",
                        lambda *a, **k: calls.append(1) or real(*a, **k))
    pastdate.summary(acc, NOW)
    pastdate.expired_handles(acc, NOW + 5)
    pastdate.items(acc, None, NOW + 9)
    assert len(calls) == 1
    acc.state["groups_rev"] += 1                    # a scan / an action
    pastdate.summary(acc, NOW)
    assert len(calls) == 2
    pastdate.summary(acc, NOW + 700)                # the clock moved on
    assert len(calls) == 3


def test_a_new_pin_or_protected_sender_changes_the_answer(monkeypatch):
    mails = _everything()
    acc = acc_of(mails)
    assert pastdate.summary(acc, NOW)["mails"] == 4
    monkeypatch.setattr(pinstore, "load_account",
                        lambda name=None: {mails[0]["msgid"]})
    assert pastdate.summary(acc, NOW)["mails"] == 3
    monkeypatch.setattr(cfgmod, "load_config",
                        lambda: {"protected": ["@shop.example"]})
    assert pastdate.summary(acc, NOW)["mails"] == 0


def test_the_cache_belongs_to_the_account():
    """Two accounts in the same state (same revision, same number of mails)
    must not share an answer."""
    a = acc_of([mail("Your sign-in code", 5)], name="one")
    b = acc_of([mail("Weekly digest", 5)], name="two")
    assert pastdate.summary(a, NOW)["mails"] == 1
    assert pastdate.summary(b, NOW)["mails"] == 0
    assert pastdate.summary(a, NOW)["mails"] == 1


def test_pins_are_per_account(monkeypatch):
    m = mail("Your sign-in code", 5)
    one, two = acc_of([m], name="one"), acc_of([dict(m)], name="two")
    monkeypatch.setattr(pinstore, "load_account",
                        lambda name=None: {m["msgid"]} if name == "one"
                        else set())
    assert pastdate.summary(one, NOW)["mails"] == 0
    assert pastdate.summary(two, NOW)["mails"] == 1


# ------------------------------------------------- the real scan and the API

def _stamp(days_ago):
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(time.time() - days_ago * DAY))


@pytest.fixture
def stale(bridge):
    """The bridge mailbox plus mail that is past its date, scanned."""
    box = bridge.mailbox["INBOX"]
    box += [
        make_msg(30, frm="Shop <orders@shop.example>",
                 subject="Your sign-in code", date=_stamp(3), size=1000),
        make_msg(31, frm="Shop <orders@shop.example>",
                 subject="Your order #12345 has shipped", date=_stamp(10),
                 size=2000),
        make_msg(32, frm="Shop <orders@shop.example>",
                 subject="Your order #12345 was delivered", date=_stamp(5),
                 size=2500),
        make_msg(33, frm="Shop <orders@shop.example>",
                 subject="Order confirmation #12345", date=_stamp(12),
                 size=3000),
        make_msg(34, frm="Shop <deals@shop.example>",
                 subject="Deal ends at midnight", date=_stamp(8), size=4000),
        make_msg(35, frm="Shop <orders@shop.example>",
                 subject="Your sign-in code", date=_stamp(0.2), size=1000),
    ]
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return bridge


def test_the_summary_endpoint(stale):
    r = client.get("/api/expired")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["mails"] == 3 and d["kept"] == 1
    assert {r["id"]: r["mails"] for r in d["reasons"]} == {
        "codes": 1, "parcels": 1, "events": 0, "offers": 1,
        "ooo": 0, "bounces": 0, "answers": 0}
    assert d["size"] == 1000 + 2000 + 4000
    assert "subject" not in r.text and "shop.example" not in r.text


def test_the_items_endpoint_and_a_bad_reason(stale):
    r = client.get("/api/expired/mails", params={"reasons": "codes,parcels"})
    assert r.status_code == 200
    assert len(r.json()["items"]) == 2
    assert all(isinstance(i, list) and len(i) == 2 for i in r.json()["items"])
    assert len(client.get("/api/expired/mails").json()["items"]) == 3
    assert client.get("/api/expired/mails",
                      params={"reasons": "codes,bogus"}).status_code == 400


def test_is_expired_lists_every_reason_in_all_mail(stale):
    res = client.get("/api/mails", params={"q": "is:expired"}).json()
    assert res["total"] == 3 and res["ignored"] == []
    assert sorted(m["subject"] for m in res["mails"]) == [
        "Deal ends at midnight", "Your order #12345 has shipped",
        "Your sign-in code"]
    # a word of the per-mail grammar: it narrows with the others
    res = client.get("/api/mails", params={"q": "is:expired from:deals@shop.example"}
                     ).json()
    assert [m["subject"] for m in res["mails"]] == ["Deal ends at midnight"]
    plain = client.get("/api/mails").json()["total"]
    assert plain > 3                          # the word did narrow the list


def test_the_kept_view_lists_the_receipts(stale):
    res = client.get("/api/mails", params={"finding": pastdate.KEPT_VIEW}
                     ).json()
    assert [m["subject"] for m in res["mails"]] == ["Order confirmation #12345"]
    assert client.get("/api/mails", params={"finding": "nonsense"}
                      ).status_code == 400


def test_pinned_mail_and_protected_senders_leave_the_list(stale):
    r = client.get("/api/mails", params={"q": "is:expired"}).json()
    code = next(m for m in r["mails"] if m["subject"] == "Your sign-in code")
    client.post("/api/pin", json={"folder": code["folder"], "uid": code["uid"],
                                  "pinned": True})
    assert client.get("/api/expired").json()["mails"] == 2
    assert client.get("/api/mails", params={"q": "is:expired"}
                      ).json()["total"] == 2
    client.post("/api/protect", json={"entries": ["deals@shop.example"],
                                      "on": True})
    assert client.get("/api/expired").json()["mails"] == 1
    items = client.get("/api/expired/mails").json()["items"]
    assert len(items) == 1


def test_the_listed_mails_go_through_the_usual_trash_step_and_undo(stale):
    items = client.get("/api/expired/mails").json()["items"]
    # nothing in it is pinned or protected, so the step does not refuse
    r = client.post("/api/delete_messages",
                    json={"items": items, "action": "trash"})
    assert r.status_code == 200, r.text
    wait_delete_done()
    assert client.get("/api/expired").json()["mails"] == 0
    assert all(m["folder"] != "INBOX" or m["uid"] not in {u for _f, u in items}
               for m in client.get("/api/mails").json()["mails"])
    acc = accountsmod.get()
    assert acc.undo_log                       # the step was recorded
    assert client.post("/api/undo", json={}).status_code == 200
    wait_delete_done()
    assert client.get("/api/expired").json()["mails"] == 3


def test_the_trash_step_refuses_what_the_list_would_have_left_out(stale):
    """The list is pre-filtered because the step refuses a selection with a
    pinned mail or a protected sender in it."""
    items = client.get("/api/expired/mails").json()["items"]
    folder, uid = items[0]
    client.post("/api/pin", json={"folder": folder, "uid": uid, "pinned": True})
    r = client.post("/api/delete_messages",
                    json={"items": items, "action": "trash"})
    assert r.status_code == 400
    fresh = client.get("/api/expired/mails").json()["items"]
    assert [folder, uid] not in fresh
    assert client.post("/api/delete_messages",
                       json={"items": fresh, "action": "trash"}
                       ).status_code == 200
    wait_delete_done()


def test_the_answers_are_per_tenant(stale):
    assert client.get("/api/expired").json()["mails"] == 3
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert pastdate.summary(accountsmod.get())["mails"] == 0
        assert pastdate.items(accountsmod.get()) == []
    assert client.get("/api/expired").json()["mails"] == 3


def test_the_per_mail_word_is_not_a_group_word():
    f = mailops.parse_mail_query("is:expired is:unread bogus")
    assert f["expired"] is True and f["read"] is False
    assert f["text"] == ["bogus"] and f["ignored"] == []
    assert mailops.parse_mail_query("is:louder")["ignored"] == ["is:louder"]
    assert mailops.parse_mail_query("")["expired"] is False


def test_the_word_is_not_a_group_or_rule_word():
    """`is:expired` is a per-mail word of All mail: the group filter reads it
    as a free word, and a rule (which matches groups) refuses it."""
    from backend import rules as rulesmod
    assert rulesmod.validate_filter("is:expired") == ["is:expired"]
    assert rulesmod.parse_filter("is:expired")["text"] == ["is:expired"]
    r = client.post("/api/rules", json={
        "name": "x", "query": "is:expired", "action": "trash"})
    assert r.status_code == 400, r.text


def test_an_assistant_without_subject_access_cannot_ask_for_is_expired(stale):
    """is:expired is decided from the subject lines: its answer would tell a
    token that may not see subjects what they say."""
    acc = accountsmod.get()
    blind = mcptools.Ctx(accounts=[acc.name], subjects=False)
    with pytest.raises(mcptools.ToolError, match="subject"):
        mcptools._list_mails(blind, mcptools.ListMailsIn(query="is:expired"))
    # ... a token that may see subjects can; the same list as the app's
    seeing = mcptools.Ctx(accounts=[acc.name], subjects=True)
    got = mcptools._list_mails(seeing, mcptools.ListMailsIn(query="is:expired"))
    assert got["total"] == 3
