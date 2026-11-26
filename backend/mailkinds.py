"""What kind of mail one message is: the split behind "What they send".

One sender often mixes mail you need (order confirmations, invoices) with mail
you do not (ads, shipping updates). The kind is read from the subject line,
locally and deterministically, with the very patterns Smart and Keep-safe
already use (`smartkinds.PURPOSE_RULES`, read per mail):

  orders        order confirmations (the order rules)
  shipping      shipping updates (the shipping rule; a return or a refund is
                no shipping update)
  invoices      invoices and receipts (the invoice rule and regular bills,
                like Keep-safe's "invoices")
  appointments  appointments and bookings (a ticket seller's orders too)
  jobs          job applications
  support       support and inquiries
  accounts      account and security mail
  ads           newsletter-style mail that has no purpose at all (a List-
                Unsubscribe sender or a promotional subject)

Every mail has ONE kind or none (""). A kind that leads to "Trash N" or to a
rule errs on the side of NOT classifying: a subject that matches two purposes,
a sender on a freemail domain (people, not shops), and anything that reads as
a receipt, a code, a parcel update, a bill or a booking never becomes "ads" -
an order confirmation must never land in "Ads and offers".

The kind is stored in the scan index (`m["kind"]`, "" = none) when a scan
writes it. A record without one (a snapshot of an older version) is read with
`of`, which works it out. `VERSION` goes into the scan snapshot: a snapshot
written under other patterns drops its stored kinds on load, so they are read
again.
"""

from __future__ import annotations

import functools
import re
from typing import Iterable

from . import pastdate
from . import smartkinds as sk

VERSION = 1

ADS, ORDERS, SHIPPING, INVOICES = "ads", "orders", "shipping", "invoices"
APPOINTMENTS, JOBS, SUPPORT, ACCOUNTS = (
    "appointments", "jobs", "support", "accounts")
# the order the box lists equal counts in
KINDS = (ADS, ORDERS, SHIPPING, INVOICES, APPOINTMENTS, JOBS, SUPPORT,
         ACCOUNTS)

# the purposes (smartkinds) that are a kind of their own
_PURPOSE_KIND = {"appointments": APPOINTMENTS, "jobs": JOBS,
                 "support": SUPPORT, "accounts": ACCOUNTS}
# the rules of the "orders" purpose (smartkinds.PURPOSE_RULES rule ids)
_ORDER_RULES = frozenset({"order", "shipping", "invoice"})

# What an ad is not, however it is mailed: pastdate has read these already
# (a receipt, a confirmation, a code, a parcel update, a reminder). An offer
# with an end date IS an ad.
_ADS_OK = (None, pastdate.OFFER)

# A newsletter header (List-Unsubscribe) is no proof that every mail of the
# sender is marketing: shops send their receipts and parcel updates through
# the same system. A subject that talks about an order, a parcel, a payment,
# a booking or an account is never an ad - an ad that says "order now" is
# merely left unclassified, which costs nothing.
_TRANSACTIONAL_RE = re.compile(
    r"order|bestell|auftrag|purchase|parcel|package|paket|shipment|shipping|"
    r"shipped|deliver|lieferung|geliefert|zustell|sendung|versand|tracking|"
    r"invoice|rechnung|receipt|quittung|beleg|payment|zahlung|\bbills?\b|"
    r"abbuchung|refund|erstattung|\breturns?\b|retoure|booking|buchung|"
    r"reservation|reservierung|appointment|termin|ticket|flight|flug|"
    r"account|konto|password|passwort|log-?in|sign-?in|verif|best[aä]tig|"
    r"confirm|subscription|\babo\b|statement|security|sicherheit|renew|"
    r"verl[aä]nger|bewerbung|application|interview", re.IGNORECASE)


def valid(kind) -> bool:
    return isinstance(kind, str) and kind in KINDS


@functools.lru_cache(maxsize=65536)
def kind_of(subject: str, addr: str = "", unsub: bool = False) -> str:
    """The kind of one mail ("" = none), from its subject, the sender's
    address and whether it carries a List-Unsubscribe header."""
    s = (subject or "").strip()
    _local, at, domain = (addr or "").lower().rpartition("@")
    if not s or not at or not domain or sk.is_freemail(domain):
        return ""
    hint = sk.sender_hint(addr, unsub)
    hits = sk.message_rule_hits(s, hint)
    # a purpose that is not "orders" (an order rule of a ticket seller is
    # reported under "appointments" by smartkinds - it is read by rule id here)
    others = {p for p, rid in hits if rid not in _ORDER_RULES}
    rids = {rid for _p, rid in hits if rid in _ORDER_RULES}
    # a regular bill is an invoice whoever sends it (Keep-safe's "invoices");
    # a request to rate something is none (smartkinds reads no purpose in it)
    if not sk.SURVEY_RE.search(s) and (pastdate.INVOICE_RX.search(s)
                                       or sk.BILL_SUBJECT_RE.search(s)):
        rids.add("invoice")
    if others and rids:
        return ""                                 # two purposes: not clear
    if len(others) > 1:
        return ""
    if others:
        return _PURPOSE_KIND[next(iter(others))]
    if rids:
        if "t" in hint:
            return APPOINTMENTS                   # a ticket seller's orders
        if "shipping" in rids:
            if "invoice" in rids or pastdate.RETURN_RE.search(s):
                return ""
            what = pastdate.classify(s)
            if what == pastdate.RECEIPT:
                # "received, will be shipped soon": the order's confirmation
                return ORDERS if "order" in rids else ""
            return SHIPPING if what in (pastdate.SHIPPING,
                                        pastdate.DELIVERED) else ""
        return INVOICES if "invoice" in rids else ORDERS
    # no evidence of a purpose: a newsletter-style mail is an ad - unless it
    # reads as something else (never guess towards "ads")
    if "b" in hint or sk.message_kind(s, hint) != "newsletter" \
            or _TRANSACTIONAL_RE.search(s):
        return ""
    return ADS if pastdate.classify(s) in _ADS_OK else ""


def of(m: dict) -> str:
    """The kind of an index record: the stored one, else worked out."""
    k = m.get("kind")
    if k == "" or valid(k):
        return k
    return kind_of(m.get("subject") or "", m.get("addr") or "",
                   bool(m.get("unsub")))


def stamp(mails: Iterable[dict]) -> None:
    """Store the kind in every record that has none yet (a scan's last step
    before the index is swapped in)."""
    for m in mails:
        if m.get("kind") is None or not (m["kind"] == "" or valid(m["kind"])):
            m["kind"] = kind_of(m.get("subject") or "", m.get("addr") or "",
                                bool(m.get("unsub")))
