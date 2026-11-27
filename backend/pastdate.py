"""Mail past its date: mail that was only useful until a date and has done
its job - read from the subject and the date, locally, no AI.

  codes     a sign-in / verification code or link, older than a day
  parcels   a shipping update whose order (order number in the subject) has a
            LATER "delivered" mail of the same sender, delivered 3+ days ago
  events    an appointment / event reminder whose date in the subject is over
            (no date: a reminder older than 30 days)
  offers    an offer whose end date in the subject has passed

and three more at the end, for mail a machine sent in answer to yours:

  ooo       an out-of-office reply (the subject says so, or `Auto-Submitted:
            auto-replied` on a subject that says nothing else), a week old
  bounces   a delivery failure: a delivery status report (header) or a
            subject like "Undelivered Mail Returned to Sender", a week old
  answers   a read receipt (a disposition-notification report) or a calendar
            answer (a text/calendar part with METHOD:REPLY), a week old -
            ONLY with that header evidence, a subject alone never lists them

The receipt, invoice or booking of the same order or appointment is never
listed ("kept"); pinned mail and protected senders are never listed either -
they are filtered out here, because the trash step they end up in refuses a
selection that contains one. Mail in one of Keep-safe's classes (a job
application, an invoice, a booking, a contract, an account notice) is never
listed as automatic mail either, whatever its headers say.

The subject patterns are the ones `smartkinds.PURPOSE_RULES` already uses
(shipping, invoice, order, appointment, booking) plus a few narrower ones of
this module (codes, delivered, reminders, offers); each reason carries its
own lifetime below. A subject is classified into exactly ONE kind, receipts
first, so a mail is never listed twice and never listed AND kept.

Nothing is stored: every answer is derived from the scan index, the pins and
the protected list, and cached on the account object (so it is per tenant and
per account by construction) until a scan / pin / action changes them.
"""

from __future__ import annotations

import bisect
import datetime as dt
import functools
import re
import time

from . import config as cfgmod
from . import pinstore
from . import smartkinds
from .smartkinds import PROMO_RE, PURPOSE_RULES, company_id

DAY = 86400

# ------------------------------------------------------------- lifetimes

CODES, PARCELS, EVENTS, OFFERS = "codes", "parcels", "events", "offers"
# Automatic mail (a machine's answer to yours), added after the four above:
# out-of-office replies, delivery failures, read receipts + calendar answers
OOO, BOUNCES, ANSWERS = "ooo", "bounces", "answers"
AUTO_REASONS = (OOO, BOUNCES, ANSWERS)
REASONS = (CODES, PARCELS, EVENTS, OFFERS) + AUTO_REASONS
# What the sheet ticks at first. Offers that have ended may still be wanted
# (a coupon code in the mail), so they start unticked (maintainer 2026-11-25);
# so do read receipts and calendar answers (maintainer 2026-11-27: "like
# offers") - a decline of next week's meeting is still news.
TICKED = {CODES: True, PARCELS: True, EVENTS: True, OFFERS: False,
          OOO: True, BOUNCES: True, ANSWERS: False}

# The `finding` value of GET /api/mails that lists the kept receipts
KEPT_VIEW = "past-kept"

CODE_LIFETIME = 1 * DAY                 # a code / link older than this
DELIVERED_AFTER = 3 * DAY               # the "delivered" mail is this old
UNDATED_REMINDER_AFTER = 30 * DAY       # a reminder without a date
AUTO_AFTER = 7 * DAY                    # automatic mail older than this
# A date is "over" once its whole day is over in every time zone: the mail
# only carries a date, not a zone (the widest UTC offset is +14 h).
ZONE_GRACE = 14 * 3600
# A receipt belongs to an undated reminder when it is from the same sender
# and arrived within this long before it.
RECEIPT_WINDOW = 45 * DAY

_I = re.IGNORECASE


def _rule(rule_id: str) -> re.Pattern:
    for _purpose, rid, rx in PURPOSE_RULES:
        if rid == rule_id:
            return rx
    raise KeyError(rule_id)


# Reused from smartkinds.PURPOSE_RULES (one source of subject patterns)
SHIPPING_RX = _rule("shipping")
INVOICE_RX = _rule("invoice")
ORDER_RX = _rule("order")
APPOINTMENT_RX = _rule("appointment")
BOOKING_RX = _rule("booking")

# ------------------------------------------------------- subject patterns

# A sign-in / verification code or link. Narrower than the "accounts" purpose:
# a welcome mail or a password notice has no lifetime, a code does.
CODE_RE = re.compile(
    r"(sign-?in|log-?in|verification|verify|security|one-?time|single-?use|"
    r"authentication|2fa|otp|anmelde|anmeldung|sicherheits|verifizierungs|"
    r"bestätigungs|einmal)[- ]?(code|pin|passcode|tan|link)\b|"
    r"\bmagic link\b|login-?tan|"
    # a bare "your code" only when what follows is a number (not a coupon)
    r"\b(your|ihr|dein)\s+code\s*(is|ist|:|-)?\s*\d{4,8}\b|"
    r"\b\d{4,8}\s+(is|ist)\s+(your|ihr|dein)\s+(\w+\s+)?code\b|"
    r"\b(confirm|verify)\s+your\s+(e-?mail|email address|account|sign-?in|"
    r"login|identity)|"
    r"(e-?mail|account)\s+(address\s+)?confirmation\b|"
    r"(e-?mail|konto|account)[- ]?(adresse\s+)?best[aä]tig|"
    r"best[aä]tige\s+(deine|ihre)\s+(e-?mail|konto|adresse)", _I)

# A mail that says the parcel HAS arrived ...
DELIVERED_RE = re.compile(
    r"\b(has|have|was|were|been|got)\s+(been\s+)?delivered\b|"
    r"\bdelivered\b\s*[:!.\-–]|^\s*delivered\b|\bdelivery complete|"
    r"\bzugestellt\b|\bgeliefert\b|\bangekommen\b|\bhas arrived\b|"
    r"\bwas handed over\b", _I)
# ... which is not one that says it has not / will / is being delivered.
NOT_YET_RE = re.compile(
    r"out for delivery|will be (delivered|arriving)|to be delivered|"
    r"being delivered|not (been )?delivered|undelivered|couldn.?t be delivered|"
    r"could not be delivered|failed|delivery attempt|expected|estimated|"
    r"nicht (zugestellt|geliefert)|wird (heute |morgen |bald |gleich )?"
    r"(zugestellt|geliefert)|werden .{0,20}geliefert|zustellversuch|"
    r"konnte nicht|voraussichtlich|ready for pick-?up|abholbereit|"
    r"will (arrive|be delivered)|arrives?\b|"
    # on its way, not at the door: a facility, a pickup point, a day to come
    r"facility|depot|\bhub\b|sorting|sortier|warehouse|distribution|"
    r"paketzentrum|verteilzentrum|zustellbasis|zustellst[uü]tzpunkt|"
    r"zustelldepot|pick-?up|abholstation|paketshop|parcel ?shop|"
    r"filiale|service ?point|collection point|locker|customs|zoll|"
    r"\btomorrow\b|(?<!guten )\bmorgen\b|[uü]bermorgen|tonight|"
    r"heute abend|\b(is|are|gets?)\s+delivered\b", _I)

# More ways a parcel update says "on its way"
SHIPPING_MORE_RE = re.compile(
    r"\b(parcel|package|shipment|order|delivery|sendung|paket|bestellung)\b"
    r".{0,30}\b(on its way|on the way|is coming|arriving|dispatched|"
    r"in transit|unterwegs|auf dem weg|ist unterwegs)\b|"
    r"\bdispatched\b|\bin transit\b|delivery (update|notification|status)|"
    r"zustell(info|ung)|lieferstatus", _I)
# A return, a refund: not an update for a parcel that arrives
RETURN_RE = re.compile(
    r"refund|erstattung|retoure|r[uü]cksendung|\breturns?\b|r[uü]ckgabe|"
    r"gutschrift|storno|cancel", _I)

# Words that make a mail a receipt, invoice or booking itself. Ambiguity goes
# the safe way: a mail that may be the confirmation of an order or a booking
# is never listed.
RECEIPT_RE = re.compile(
    r"order (confirm\w*|received|placed|summary)|"
    r"confirmation of your (order|booking|appointment|reservation|purchase)|"
    r"(booking|reservation|appointment) (is )?(confirm\w*|summary)|"
    r"bestellbest[aä]tigung|bestellung (ist |wurde )?(best[aä]tigt|eingegangen|"
    r"aufgegeben)|bestelleingang|(buchungs|termin|reservierungs)best[aä]tigung|"
    r"(buchung|termin|reservierung) (ist |wurde )?best[aä]tigt|"
    r"\bthank(s| you)\b|\b(danke|vielen dank)\b|"
    r"your (e-?)?tickets?\b|ihre (e-?)?tickets?\b|your boarding pass|"
    r"booking (reference|number)|buchungs(nummer|referenz)", _I)

# What an order, a booking or an appointment is called ...
BOOKING_WORDS_RE = re.compile(
    r"\b(order|booking|appointment|reservation|table|ticket|flight|purchase|"
    r"registration|bestellung|buchung|termin|reservierung|tisch|flug|"
    r"einkauf|anmeldung)\w*", _I)
# ... and what a confirmation of one says (a shipping confirmation is a parcel
# update, not a confirmation of the order: those compounds are taken out first)
CONFIRM_WORDS_RE = re.compile(
    r"\b(confirm\w*|booked|reserved|scheduled|registered|received|placed|"
    r"best[aä]tig\w*|gebucht|reserviert|vereinbart|eingegangen|aufgegeben|"
    r"angemeldet)\b", _I)
SHIP_CONFIRM_RE = re.compile(
    r"(shipping|shipment|delivery|dispatch)\s+confirm\w*|"
    r"(versand|liefer|zustell)\w*best[aä]tig\w*", _I)


def is_confirmation(s: str) -> bool:
    """The subject confirms (or acknowledges) an order, booking, appointment,
    reservation, ticket ..., in any word order."""
    return bool(CONFIRM_WORDS_RE.search(SHIP_CONFIRM_RE.sub(" ", s))
                and BOOKING_WORDS_RE.search(s))


# A reminder (as against the booking itself)
REMINDER_RE = re.compile(
    r"reminder|erinnerung|erinnern|don.?t forget|vergiss|upcoming|"
    r"bevorstehend|coming up|heads[- ]up|\b(is|are|starts?|begins?)\s+"
    r"(tomorrow|today|soon|tonight)|\b(ist|beginnt|startet|findet)\s+"
    r"(morgen|heute|bald)\b|"
    r"\byour table\b|\b(ihr|dein)\s+tisch\b", _I)
# What a reminder can be about
EVENT_WORDS_RE = re.compile(
    r"\btable\b|\btisch\b|\bevent\b|veranstaltung|webinar|workshop|"
    r"\bclass\b|\bkurs\b|\bvisit\b|\bbesuch\b|concert|konzert|\bflight\b|"
    r"\bflug\b|check-?in|\bmeeting\b|\bcall\b|\bpickup\b|\bpick-up\b|"
    r"\bslot\b|\bzeitfenster\b", _I)

# The end of an offer
OFFER_END_RE = re.compile(
    r"\b(ends?|ending|endet|enden|ended|until|till|bis(?! zu\b)|expires?|"
    r"expiring|l[aä]uft ab|valid (until|through|thru)|g[uü]ltig|last day|"
    r"letzter tag|only today|today only|nur heute|noch heute|final hours|"
    r"midnight|mitternacht)\b", _I)
OFFER_WORDS_RE = re.compile(
    r"\bflash\b|\bprices?\b|\bpreise?\b|\bsale\b|\bdeals?\b|\boffers?\b|"
    r"angebot|rabatt|discount|\d\s?%|special|\baktion\b|gutschein|voucher|"
    r"coupon|promo|only today|today only|nur heute", _I)

# A code that is worth money or a gift is no sign-in code, digits or not
CODE_SKIP_RE = re.compile(
    r"gift|geschenk|gutschein|einl[oö]s|redeem|guthaben|credit|voucher", _I)

# An order / parcel number in a subject: a few digits in a token that follows
# one of these words (or a bare "#")
ORDER_NO_RE = re.compile(
    r"(?:order|bestell\w*|auftrag|sendung|paket|"
    r"parcel|package|shipment|tracking|#)\s*(?:no\.?|nr\.?|number|nummer|id|"
    r"code)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})", _I)


def order_number(subject: str) -> str | None:
    """The order / parcel number in `subject`: the first token after an
    order-ish word that carries at least three digits, lower-cased."""
    for m in ORDER_NO_RE.finditer(subject or ""):
        tok = m.group(1).strip("-").lower()
        if sum(c.isdigit() for c in tok) >= 3:
            return tok
    return None


# ------------------------------------------------------------ date reader

_MONTHS = {
    "january": 1, "januar": 1, "jan": 1, "february": 2, "februar": 2,
    "feb": 2, "march": 3, "märz": 3, "maerz": 3, "mär": 3, "mrz": 3,
    "mar": 3, "april": 4, "apr": 4, "may": 5, "mai": 5, "june": 6,
    "juni": 6, "jun": 6, "july": 7, "juli": 7, "jul": 7, "august": 8,
    "aug": 8, "september": 9, "sept": 9, "sep": 9, "october": 10,
    "oktober": 10, "oct": 10, "okt": 10, "november": 11, "nov": 11,
    "december": 12, "dezember": 12, "dec": 12, "dez": 12}
_MONTH_RX = "|".join(sorted(_MONTHS, key=len, reverse=True))
_WEEKDAYS = {
    "monday": 0, "montag": 0, "mon": 0, "tuesday": 1, "dienstag": 1,
    "tue": 1, "tues": 1, "wednesday": 2, "mittwoch": 2, "wed": 2,
    "thursday": 3, "donnerstag": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "freitag": 4, "fri": 4, "saturday": 5, "samstag": 5,
    "sonnabend": 5, "sunday": 6, "sonntag": 6}
_WEEKDAY_RX = "|".join(sorted(_WEEKDAYS, key=len, reverse=True))

_ISO_RE = re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b")
_DMY_DOT_RE = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)")
_DAY_MONTH_RE = re.compile(
    rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\.?\s*(?:of\s+)?({_MONTH_RX})\b\.?"
    r"(?:,?\s*(\d{4})\b)?", _I)
_MONTH_DAY_RE = re.compile(
    rf"\b({_MONTH_RX})\b\.?\s*(\d{{1,2}})(?:st|nd|rd|th)?\b(?!\d)"
    r"(?:,?\s*(\d{4})\b)?", _I)
_WEEKDAY_RE = re.compile(rf"\b({_WEEKDAY_RX})\b", _I)
_IN_DAYS_RE = re.compile(r"\b(?:in|innerhalb von)\s+(\d{1,2})\s+"
                         r"(?:days?|tagen?)\b", _I)
_DAY_AFTER_RE = re.compile(r"day after tomorrow|[uü]bermorgen", _I)
_TOMORROW_RE = re.compile(r"\btomorrow\b|(?<!guten )\bmorgen\b", _I)
_TODAY_RE = re.compile(
    r"\btoday\b|\btonight\b|\bmidnight\b|\bheute\b|\bmitternacht\b", _I)


def _roll(day: int, month: int, year: int | None,
          ref: dt.date) -> dt.date | None:
    """A date without a year is the one around the mail's own date: this
    year's, or next year's when that would be more than a month before the
    mail."""
    try:
        if year is not None:
            return dt.date(year + 2000 if year < 100 else year, month, day)
        d = dt.date(ref.year, month, day)
        if (ref - d).days > 30:
            d = dt.date(ref.year + 1, month, day)
        return d
    except ValueError:
        return None


def read_date(subject: str, ts: float) -> dt.date | None:
    """The date a subject names, relative to the mail's own date `ts`: an
    ISO / dotted / "12 Nov" / "Nov 12" date, a weekday (the next one, today
    counts), "today" / "tonight" / "tomorrow" / "in 3 days" (EN + DE). The
    LATEST date wins ("moved from 12 Nov to 15 Nov"): a mail is never read
    as over earlier than it is. None when the subject names no date."""
    s = subject or ""
    ref = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()
    found: list[dt.date] = []
    for m in _ISO_RE.finditer(s):
        d = _roll(int(m[3]), int(m[2]), int(m[1]), ref)
        if d:
            found.append(d)
    for m in _DMY_DOT_RE.finditer(s):
        d = _roll(int(m[1]), int(m[2]), int(m[3]) if m[3] else None, ref)
        if d:
            found.append(d)
    for m in _DAY_MONTH_RE.finditer(s):
        d = _roll(int(m[1]), _MONTHS[m[2].lower()],
                  int(m[3]) if m[3] else None, ref)
        if d:
            found.append(d)
    for m in _MONTH_DAY_RE.finditer(s):
        d = _roll(int(m[2]), _MONTHS[m[1].lower()],
                  int(m[3]) if m[3] else None, ref)
        if d:
            found.append(d)
    for m in _WEEKDAY_RE.finditer(s):
        ahead = (_WEEKDAYS[m[1].lower()] - ref.weekday()) % 7
        found.append(ref + dt.timedelta(days=ahead))
    for m in _IN_DAYS_RE.finditer(s):
        found.append(ref + dt.timedelta(days=int(m[1])))
    if _DAY_AFTER_RE.search(s):
        found.append(ref + dt.timedelta(days=2))
    elif _TOMORROW_RE.search(s):
        found.append(ref + dt.timedelta(days=1))
    if _TODAY_RE.search(s):
        found.append(ref)
    return max(found) if found else None


def is_over(day: dt.date, now: float) -> bool:
    """The whole of `day` is over, in every time zone."""
    end = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(),
                              dt.timezone.utc).timestamp()
    return now >= end + ZONE_GRACE


# ---------------------------------------------------------- classification

RECEIPT, CODE, SHIPPING, DELIVERED, EVENT, OFFER = (
    "receipt", "code", "shipping", "delivered", "event", "offer")


@functools.lru_cache(maxsize=65536)
def classify(subject: str) -> str | None:
    """What kind of mail the subject says it is, for this feature: ONE of
    receipt / code / shipping / delivered / event / offer, or None. Order
    matters and is the safety net: a receipt, invoice or booking is decided
    first, so it can never also be a candidate."""
    s = subject or ""
    if not s:
        return None
    # 1. a receipt, an invoice, a booking confirmation: never a candidate
    if INVOICE_RX.search(s) or RECEIPT_RE.search(s) or is_confirmation(s):
        return RECEIPT
    # 2. the parcel has arrived / is on its way
    if DELIVERED_RE.search(s) and not NOT_YET_RE.search(s) \
            and not RETURN_RE.search(s):
        return DELIVERED
    if (SHIPPING_RX.search(s) or SHIPPING_MORE_RE.search(s)) \
            and not RETURN_RE.search(s):
        return SHIPPING
    # 3. a code or a link that was only good for a short while (not a coupon
    #    code, not an offer for signing in)
    if CODE_RE.search(s) and not OFFER_WORDS_RE.search(s) \
            and not PROMO_RE.search(s) and not CODE_SKIP_RE.search(s):
        return CODE
    # 4. a reminder for something with a date
    if REMINDER_RE.search(s) and (APPOINTMENT_RX.search(s)
                                  or BOOKING_RX.search(s)
                                  or EVENT_WORDS_RE.search(s)):
        return EVENT
    # 5. an offer with an end
    if OFFER_END_RE.search(s) and (OFFER_WORDS_RE.search(s)
                                   or PROMO_RE.search(s)):
        return OFFER
    # 6. an order, a booking, an appointment itself (kept, never listed)
    if ORDER_RX.search(s) or BOOKING_RX.search(s) or APPOINTMENT_RX.search(s):
        return RECEIPT
    return None


# ----------------------------------------------------------- automatic mail

# The header fields the scan reads on top of the others (mailops
# ._fetch_full_chunk / ._backfill_chunk): Auto-Submitted (RFC 3834) and the
# Content-Type (its report type, RFC 3462 / 8098).
HEADER_FIELDS = "AUTO-SUBMITTED CONTENT-TYPE"
DSN, MDN = "delivery-status", "disposition-notification"
AUTO_REPLIED = "auto-replied"

_AUTO_TOKEN_RE = re.compile(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def header_evidence(msg) -> dict:
    """What the headers of one message say about automatic mail, for the scan
    index: {"auto": the Auto-Submitted keyword ("" when the header is absent
    or says "no"), "rpt": the report type} - `rpt` only when the message is a
    multipart/report of a type this feature reads (a delivery status report
    or a read receipt). `auto` is always present: a record without it is one
    the scan has not read these headers of yet. Pure; never raises."""
    out = {"auto": ""}
    try:
        word = _AUTO_TOKEN_RE.match(str(msg.get("Auto-Submitted") or ""))
        if word and word.group(1).lower() != "no":
            out["auto"] = word.group(1).lower()[:32]
        if msg.get_content_type() == "multipart/report":
            kind = msg.get_param("report-type")
            if isinstance(kind, str) and kind.strip().lower() in (DSN, MDN):
                out["rpt"] = kind.strip().lower()
    except Exception:
        pass
    return out


_REPLY_PREFIX = r"^\s*(?:(?:re|aw|antw|fw|fwd|wg)\s*:\s*)*"
_SEP = r"\s*(?:[:\-–—]|$)"

# "Automatic reply: ...", "Out of Office: ...", "Abwesenheitsnotiz: ...": the
# words of the common mail programs, at the START of the subject followed by a
# separator (or the end) - "Out of office on Friday" is somebody's mail.
OOO_SUBJECT_RE = re.compile(
    _REPLY_PREFIX
    + r"(?:automatic\s+(?:reply|response)|auto[- ]?(?:reply|response)|"
      r"autoreply|autoresponder|"
      r"out[- ]of[- ](?:the[- ])?office(?:\s+auto[- ]?(?:reply|response|"
      r"message))?|vacation\s+(?:auto[- ]?)?(?:reply|response|message)|"
      r"automatische\s+antwort|automatische\s+abwesenheit\w*|"
      r"abwesenheits(?:notiz|nachricht|meldung))" + _SEP, _I)

# "Undelivered Mail Returned to Sender", "Mail delivery failed", "Delivery
# Status Notification (Failure)", "Undeliverable: ...", "Unzustellbar: ..."
BOUNCE_SUBJECT_RE = re.compile(
    _REPLY_PREFIX
    + r"(?:undelivered\s+mail\s+returned\s+to\s+sender|"
      r"mail\s+delivery\s+(?:failed|failure|system\s+failure)|"
      r"delivery\s+status\s+notification\s*\(|"
      r"undeliverable(?:\s+(?:mail|message|e-?mail))?" + _SEP + r"|"
      r"returned\s+mail\s*:|failure\s+notice" + _SEP + r"|"
      r"unzustellbar(?:e\s+(?:mail|nachricht|e-?mail))?" + _SEP + r"|"
      r"nicht\s+zustellbar" + _SEP + r"|"
      r"(?:e-?mail-?|mail-?)?zustellung\s+(?:fehlgeschlagen|nicht\s+m[oö]glich))",
    _I)
# A parcel is not a mail: a subject about one is never a bounce, whatever it
# starts with ("Undeliverable: your parcel").
NOT_A_BOUNCE_RE = re.compile(
    r"parcel|package|paket|shipment|sendung|order|bestellung|lieferung|"
    r"shipping|versand|tracking", _I)


def auto_reason(m: dict, subject: str) -> str | None:
    """Which automatic-mail reason an index entry belongs to, or None. A
    delivery failure is a delivery status report or a bounce subject; a read
    receipt or a calendar answer is ONLY ever read from its header evidence
    (`rpt` / `cal`, kept by the scan and the Attachments analysis) - a
    subject like "Read: ..." or "Accepted: ..." says nothing; an out-of-office
    reply is one by its subject, or by `Auto-Submitted: auto-replied` on a
    subject that names no purpose and no other kind of this feature (a ticket
    acknowledgement or a parcel update is no out-of-office reply)."""
    rpt = m.get("rpt") or ""
    if rpt == DSN or (BOUNCE_SUBJECT_RE.match(subject)
                      and not NOT_A_BOUNCE_RE.search(subject)):
        return BOUNCES
    if rpt == MDN or m.get("cal") == "reply":
        return ANSWERS
    if OOO_SUBJECT_RE.match(subject):
        return OOO
    if m.get("auto") == AUTO_REPLIED and subject \
            and not smartkinds.message_purposes(subject) \
            and classify(subject) is None:
        return OOO
    return None


def _keep_safe(m: dict) -> bool:
    """The mail is in one of Keep-safe's classes (invoices, bookings,
    contracts, job applications, account notices), switched on or not."""
    from . import keepsafe          # keepsafe imports mailops, which imports us
    hint = smartkinds.sender_hint(m.get("addr", ""), bool(m.get("unsub")))
    return bool(keepsafe.classes_of(m.get("subject") or "", hint))


# -------------------------------------------------------------- the finder

@functools.lru_cache(maxsize=65536)
def _who(addr: str) -> str:
    """The sender an order belongs to: its company when the address names
    one, else the address itself."""
    addr = (addr or "").lower()
    return company_id(addr.rpartition("@")[2]) or addr


# A cheap first look: only a subject that holds one of these stems can be a
# code, a parcel update, a reminder or an offer, so only those meet the real
# patterns (on a big mailbox the patterns are the cost). A superset on
# purpose - a missing stem would only mean a missed mail, never a wrong one.
# GATE_ANY stems may sit inside a word (German compounds: Anmeldecode,
# Terminerinnerung), GATE_WORD stems must start one.
GATE_ANY = (
    # codes and links
    "code", "link", "confirm", "verif", "bestät", "bestaet", "sign-in",
    "sign in", "signin", "log-in", "log in", "login", "2fa", "authent",
    "security", "sicherheit", "anmeld", "einmal", "one-time", "one time",
    "single-use",
    # parcels
    "ship", "deliver", "zustell", "sendung", "paket", "lieferung",
    "geliefert", "zugestellt", "handed over", "versand", "versendet",
    "verschickt", "track", "abhol",
    "dispatch", "transit", "unterwegs", "on its way", "on the way", "parcel",
    "package", "bald bei dir", "einlieferung", "angekommen", "arrived",
    # reminders
    "remind", "erinner", "forget", "vergiss", "upcoming", "bevorstehend",
    "coming up", "heads", "tomorrow", "morgen", "tonight", "tisch", "table",
    "beginnt", "startet", "findet",
    # offers
    "läuft ab", "laeuft ab", "gültig", "gueltig", "last day", "letzter tag",
    "only today", "nur heute", "midnight", "mitternacht",
)
GATE_WORD = (
    "pin", "tan", "today", "heute", "soon", "bald", "starts", "begins",
    "end", "until", "till", "bis", "expir", "valid",
)


def _trie(stems) -> str:
    """One pattern for "contains any of `stems`", grouped by first letters
    (a flat alternation of ~90 stems is ten times slower to search)."""
    root: dict = {}
    for stem in stems:
        node = root
        for ch in stem:
            node = node.setdefault(ch, {})
        node[""] = {}

    def emit(node: dict) -> str:
        if "" in node:                  # a whole stem is read: done
            return ""
        alts = [re.escape(ch) + emit(sub) for ch, sub in sorted(node.items())]
        return alts[0] if len(alts) == 1 else "(?:" + "|".join(alts) + ")"
    return emit(root)


_GATE_RX = re.compile(f"{_trie(GATE_ANY)}|\\b{_trie(GATE_WORD)}")


def _gate(subject: str) -> bool:
    return _GATE_RX.search(subject.lower()) is not None


def _within(times: list[float] | None, ts: float, window: float) -> bool:
    """Is one of `times` in [ts, ts + window]?"""
    if not times:
        return False
    i = bisect.bisect_left(times, ts)
    return i < len(times) and times[i] <= ts + window


def find(mails, pins: set[str], protected: list[str],
         now: float | None = None) -> dict:
    """Run the matchers over `mails` (index entries). Returns
    {"flagged": {(folder, uid): (reason, size)}, "kept": {(folder, uid)}}.
    `pins` are Message-IDs, `protected` the normalized protected list."""
    now = time.time() if now is None else now
    mails = mails if isinstance(mails, list) else list(mails)
    delivered: dict[tuple[str, str], float] = {}      # (who, no) -> latest ts
    cands: list[tuple[dict, str]] = []
    for m in mails:
        ts, subject = m.get("ts") or 0, m.get("subject") or ""
        if not ts or not subject or not _gate(subject):
            continue
        kind = classify(subject)
        if kind == DELIVERED:
            no = order_number(subject)
            if no:
                key = (_who(m.get("addr", "")), no)
                delivered[key] = max(delivered.get(key, 0), ts)
        elif kind in (CODE, SHIPPING, EVENT, OFFER):
            cands.append((m, kind))

    flagged: dict[tuple[str, int], tuple[str, int]] = {}
    parcel_keys: set[tuple[str, str]] = set()
    event_dates: set[tuple[str, dt.date]] = set()
    undated: dict[str, list[float]] = {}   # who -> ts of undated reminders
    for m, kind in cands:
        ts, subject = m["ts"], m["subject"]
        who = _who(m.get("addr", ""))
        reason = key = None
        if kind == CODE:
            if now - ts >= CODE_LIFETIME:
                reason = CODES
        elif kind == SHIPPING:
            no = order_number(subject)
            done = delivered.get((who, no)) if no else None
            if done and done > ts and now - done >= DELIVERED_AFTER:
                reason, key = PARCELS, (who, no)
        elif kind == EVENT:
            day = read_date(subject, ts)
            if day is not None:
                if is_over(day, now):
                    reason, key = EVENTS, (who, day)
            elif now - ts >= UNDATED_REMINDER_AFTER:
                reason, key = EVENTS, (who, None)
        elif kind == OFFER:
            day = read_date(subject, ts)
            if day is not None and is_over(day, now):
                reason = OFFERS
        if not reason:
            continue
        # pinned mail and protected senders are never listed
        if m.get("msgid") in pins or cfgmod.is_protected(m.get("addr", ""),
                                                         protected):
            continue
        flagged[(m["folder"], m["uid"])] = (reason, int(m.get("size") or 0))
        if reason == PARCELS:
            parcel_keys.add(key)
        elif reason == EVENTS:
            if key[1] is not None:
                event_dates.add(key)
            else:
                undated.setdefault(who, []).append(ts)

    # Automatic mail, after the four reasons above: a mail they list stays
    # theirs, and the receipts they keep are never listed here.
    for m in mails:
        ts = m.get("ts") or 0
        if not ts or now - ts < AUTO_AFTER \
                or (m["folder"], m["uid"]) in flagged:
            continue
        subject = m.get("subject") or ""
        reason = auto_reason(m, subject)
        if not reason:
            continue
        if m.get("msgid") in pins or cfgmod.is_protected(m.get("addr", ""),
                                                         protected):
            continue
        if _keep_safe(m):
            continue
        flagged[(m["folder"], m["uid"])] = (reason, int(m.get("size") or 0))

    # The receipts / invoices / bookings that belong to what is listed: only
    # the mail of the senders involved is looked at
    for times in undated.values():
        times.sort()
    kept: set[tuple[str, int]] = set()
    whos = {k[0] for k in parcel_keys} | {k[0] for k in event_dates} \
        | set(undated)
    if whos:
        for m in mails:
            ts, subject = m.get("ts") or 0, m.get("subject") or ""
            if not ts or not subject:
                continue
            who = _who(m.get("addr", ""))
            if who not in whos:
                continue
            # the cheap links first, the subject classes last
            no = order_number(subject) if parcel_keys else None
            if (no is not None and (who, no) in parcel_keys) \
                    or _within(undated.get(who), ts, RECEIPT_WINDOW):
                linked = True
            else:
                day = read_date(subject, ts) if event_dates else None
                linked = day is not None and (who, day) in event_dates
            if linked and classify(subject) == RECEIPT \
                    and (m["folder"], m["uid"]) not in flagged:
                kept.add((m["folder"], m["uid"]))
    return {"flagged": flagged, "kept": kept}


# ------------------------------------------------------------- the account

def _cached(acc, now: float | None = None) -> dict:
    """`find` over one account's scan index, cached on the account object
    until the index, the pins, the protected list or the clock (10 minutes)
    change - the Overview, the sheet and every page of `is:expired` share
    one pass."""
    now = time.time() if now is None else now
    pins = pinstore.load_account(acc.name)
    protected = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    sig = (acc.state.get("groups_rev"), len(acc.index), hash(frozenset(pins)),
           tuple(protected), int(now // 600))
    hit = getattr(acc, "_pastdate", None)
    if hit and hit[0] == sig:
        return hit[1]
    with acc.lock:
        mails = list(acc.index.values())
    res = find(mails, pins, protected, now)
    acc._pastdate = (sig, res)
    return res


def summary(acc, now: float | None = None) -> dict:
    """Counts only: {"mails", "size", "kept", "reasons": [{"id", "mails",
    "size", "ticked"}]} - every reason, in the order of REASONS."""
    res = _cached(acc, now)
    by = {r: [0, 0] for r in REASONS}
    for reason, size in res["flagged"].values():
        by[reason][0] += 1
        by[reason][1] += size
    return {"mails": sum(v[0] for v in by.values()),
            "size": sum(v[1] for v in by.values()),
            "kept": len(res["kept"]),
            "reasons": [{"id": r, "mails": by[r][0], "size": by[r][1],
                         "ticked": TICKED[r]} for r in REASONS]}


def items(acc, reasons=None, now: float | None = None) -> list[list]:
    """[folder, uid] of the listed mails of `reasons` (default: all), oldest
    handle first - what the trash step is given."""
    want = set(reasons) if reasons is not None else set(REASONS)
    bad = want - set(REASONS)
    if bad:
        raise ValueError(f"bad reason {sorted(bad)[0]!r}")
    res = _cached(acc, now)
    return [[f, u] for (f, u), (reason, _size) in sorted(res["flagged"].items())
            if reason in want]


def expired_handles(acc, now: float | None = None) -> frozenset:
    """(folder, uid) of every listed mail, whatever its reason: what the mail
    filter word `is:expired` keeps."""
    return frozenset(_cached(acc, now)["flagged"])


def auto_handles(acc, now: float | None = None) -> frozenset:
    """(folder, uid) of the listed automatic mail (out-of-office replies,
    delivery failures, read receipts and calendar answers): what the mail
    filter word `is:auto` keeps. A subset of `expired_handles`."""
    res = _cached(acc, now)
    return frozenset(h for h, (reason, _size) in res["flagged"].items()
                     if reason in AUTO_REASONS)


def kept_handles(acc, now: float | None = None) -> frozenset:
    """(folder, uid) of the receipts, invoices and bookings that are kept."""
    return frozenset(_cached(acc, now)["kept"])
