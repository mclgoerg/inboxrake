"""Subscriptions: the senders that bill you on a schedule (Insights ->
Subscriptions).

All local, no AI, nothing leaves the server. Everything is read from what the
scan index already holds (sender, subject, date, read flag):

  * a RECEIPT is a mail whose subject says receipt / invoice / bill - the
    `orders` invoice rule and the bill pattern of smartkinds.py - per sender
    company (the registrable domain);
  * a SUBSCRIPTION is a company with at least MIN_RECEIPTS receipts on a
    regular cadence: monthly (a typical gap of 28-35 days, every gap within
    +-MONTH_TOL days of it, or of a whole multiple of it for a receipt that
    never came) or yearly (365 +- YEAR_TOL). Only the latest
    regular run counts, and one that is still going (the next receipt is not
    overdue by more than half a period);
  * the AMOUNT comes from the receipt's subject ("Your receipt - EUR 7.99"),
    always. An opt-in (`read_amounts`, Settings) additionally reads the
    TEXT of the LATEST receipt of a subscription whose subject has no
    amount, through the existing local body-fetch path of the mail reader
    (a read-only BODY.PEEK fetch from the user's own IMAP server). It keeps
    only the amount and its currency (substore.py) - never the text;
  * a yearly subscription whose next receipt is within RENEW_DAYS "renews
    soon" (the pill and the tile); monthly ones renew all the time;
  * STILL IN USE? is read from mail already here: sign-in / security alerts
    of the same company (Smart kind Accounts) and whether the user opened
    ("\\Seen") any of its other mails, both within USE_DAYS;
  * a REMINDER the user asked for fires LEAD_DAYS before the next expected
    receipt, once per expected date (`tick`), through the existing Web Push
    kinds (webpush.reminder) and the open page.

Inboxrake never cancels anything and never follows a link. Names the user
sees (service names, subjects) come from the user's own mail at request
time; nothing here knows a company.
"""

from __future__ import annotations

import datetime
import functools
import logging
import math
import re
import statistics
import threading
import time
from collections import Counter

from . import accounts
from . import pinstore
from . import smartkinds
from . import substore
from . import tenants

log = logging.getLogger("inboxrake.subscriptions")

DAY = 86400
MIN_RECEIPTS = 3
MONTH_MIN, MONTH_MAX, MONTH_TOL = 28, 35, 4      # days
YEAR_DAYS, YEAR_TOL = 365, 10
MERGE_DAYS = 3          # an invoice and its receipt a day apart count once
MAX_RECEIPTS = 60       # most recent receipts looked at per company
USE_DAYS = 90           # the "still in use?" window
RENEW_DAYS = 60         # "renews within 60 days"
LEAD_DAYS = 3           # reminder lead
LATEST = 3              # receipts listed in the pane
MAX_SLOTS = 24          # squares of the receipt rhythm
READ_BATCH = 20         # mails per body read (mailops.MESSAGES_BATCH_MAX)
TICK_SECONDS = 600


# ----------------------------------------------------------------- receipts

_INVOICE_RULE = next(rx for _, rid, rx in smartkinds.PURPOSE_RULES
                     if rid == "invoice")


@functools.lru_cache(maxsize=65536)
def is_receipt(subject: str) -> bool:
    """Whether a subject reads like a receipt, invoice or bill: the Smart
    kind `orders` invoice rule plus the bill pattern; a request to review or
    rate something is never one."""
    s = subject or ""
    if smartkinds.SURVEY_RE.search(s):
        return False
    return bool(_INVOICE_RULE.search(s) or smartkinds.BILL_SUBJECT_RE.search(s))


def company_key(addr: str) -> str | None:
    """The sender's company, or None for people (freemail) and unparseable
    senders. A mail platform that serves many companies has no company of
    its own: its senders stay apart, by full address."""
    if "@" not in (addr or ""):
        return None
    domain = addr.rsplit("@", 1)[1].lower().strip(".")
    if not domain or smartkinds.is_freemail(domain):
        return None
    return smartkinds.company_id(domain) or (
        addr.lower() if smartkinds.platform_of(domain) else None)


# ------------------------------------------------------------------ amounts

CURRENCIES = {"€": "EUR", "$": "USD", "£": "GBP",
              "EUR": "EUR", "USD": "USD", "GBP": "GBP", "CHF": "CHF"}
_CUR = r"(?:€|\$|£|(?<![A-Za-z])(?:EUR|USD|GBP|CHF)(?![A-Za-z]))"
_NUM = (r"(?:\d{1,3}(?:[.,\u202f\u00a0 ]\d{3})+(?:[.,]\d{1,2})?"
        r"|\d+(?:[.,]\d{1,2})?)")
_PREFIX_RE = re.compile(rf"(?P<cur>{_CUR})[\u00a0 ]?(?P<num>{_NUM})(?!\d)")
_SUFFIX_RE = re.compile(rf"(?<![\d.,])(?P<num>{_NUM})[\u00a0 ]?(?P<cur>{_CUR})")
MAX_AMOUNT = 1_000_000


def _to_number(num: str) -> float | None:
    """"1.234,56" / "1,234.56" / "7,99" / "7.99" / "1.234" -> a float."""
    s = re.sub(r"[\u202f\u00a0 ]", "", num)
    dot, comma = s.rfind("."), s.rfind(",")
    if dot >= 0 and comma >= 0:                  # the later mark is decimal
        dec = max(dot, comma)
        s = s[:dec].replace(".", "").replace(",", "") + "." + s[dec + 1:]
    elif dot >= 0 or comma >= 0:
        sep = "." if dot >= 0 else ","
        parts = s.split(sep)
        if len(parts) > 2 or (len(parts[1]) == 3 and len(parts[0]) <= 3):
            s = "".join(parts)                   # thousands marks only
        else:
            s = parts[0] + "." + parts[1]
    try:
        v = float(s)
    except ValueError:
        return None
    return v if 0 < v < MAX_AMOUNT else None


def parse_amounts(text: str) -> list[tuple[int, float, str]]:
    """Every price in `text`: (position, amount, currency), in order. A price
    is a currency sign or code next to a number; a bare code needs decimals,
    so "Order 12345 EUR" and plain order numbers never count."""
    found = []
    for rx in (_PREFIX_RE, _SUFFIX_RE):
        for m in rx.finditer(text or ""):
            cur = m.group("cur")
            num = m.group("num")
            if cur[0].isalpha() and not re.search(r"[.,]\d{1,2}$", num):
                continue
            v = _to_number(num)
            if v is not None:
                found.append((m.start(), v, CURRENCIES[cur]))
    found.sort()
    out, last_end = [], -1
    for pos, v, cur in found:                   # one hit per spot
        if pos >= last_end:
            out.append((pos, v, cur))
            last_end = pos + 1
    return out


def amount_from_subject(subject: str) -> tuple[float, str] | None:
    hits = parse_amounts(subject or "")
    return (hits[0][1], hits[0][2]) if hits else None


_TOTAL_RE = re.compile(
    r"(?<!sub)(?<!sub-)total|amount (due|paid|charged)|gesamt|summe|betrag|"
    r"zu zahlen|charged|bezahlt|\bpaid\b|zahlbetrag|rechnungsbetrag|brutto",
    re.IGNORECASE)
_PART_RE = re.compile(r"sub-?total|zwischensumme|\btax\b|\bvat\b|mwst|\bust\b",
                      re.IGNORECASE)
MAX_TEXT = 20000


def amount_from_text(text: str) -> tuple[float, str] | None:
    """The price a receipt's text states: the one on the last "total" line
    (parts such as sub-total and tax do not count), else the largest. The
    text is looked at and dropped - the caller keeps only what is returned."""
    text = (text or "")[:MAX_TEXT]
    totals = []
    for line in text.splitlines():
        if _TOTAL_RE.search(line) and not _PART_RE.search(line):
            hits = parse_amounts(line)
            if hits:
                totals.append(hits[0])
    if totals:
        return totals[-1][1], totals[-1][2]
    hits = parse_amounts(text)
    if not hits:
        return None
    best = max(hits, key=lambda h: h[1])
    return best[1], best[2]


# ------------------------------------------------------------------ cadence

def _near(gap: float, med: float, tol: float) -> bool:
    """A gap is regular when it is the typical one - or two or three of them
    (a receipt that never came, or was deleted) - give or take `tol` per
    period."""
    return any(abs(gap - k * med) <= tol * k for k in (1, 2, 3))


def cadence_of(gaps: list[float]) -> tuple[str, float] | None:
    """("monthly" | "yearly", the typical gap in days) when every gap sits
    close to their median, else None."""
    if not gaps:
        return None
    med = statistics.median(gaps)
    if MONTH_MIN <= med <= MONTH_MAX \
            and all(_near(g, med, MONTH_TOL) for g in gaps):
        return "monthly", med
    if abs(med - YEAR_DAYS) <= YEAR_TOL \
            and all(_near(g, med, YEAR_TOL) for g in gaps):
        return "yearly", med
    return None


def find_run(stamps: list[int]) -> tuple[int, str, float] | None:
    """The longest tail of the (ascending) receipt times that has a cadence,
    at least MIN_RECEIPTS receipts and at least half of all of them (three
    receipts that happen to line up among twenty are no subscription):
    (index it starts at, kind, median gap in days), or None."""
    n = len(stamps)
    need = max(MIN_RECEIPTS, math.ceil(n / 2))
    for start in range(max(0, n - MAX_RECEIPTS), n - need + 1):
        tail = stamps[start:]
        gaps = [(b - a) / DAY for a, b in zip(tail, tail[1:])]
        found = cadence_of(gaps)
        if found:
            return start, found[0], found[1]
    return None


def _utc(ts: float) -> datetime.datetime:
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc)


def _bucket(kind: str, ts: float) -> int:
    d = _utc(ts)
    return d.year * 12 + d.month - 1 if kind == "monthly" else d.year


def _slots(kind: str, stamps: list[int]) -> tuple[list[int], int]:
    """One square per month (per year): 1 where a receipt came. The last
    MAX_SLOTS periods only. Returns (squares, epoch s of the first one)."""
    got = {_bucket(kind, t) for t in stamps}
    last = max(got)
    first = max(min(got), last - MAX_SLOTS + 1)
    squares = [1 if b in got else 0 for b in range(first, last + 1)]
    if kind == "monthly":
        y, m = divmod(first, 12)
        start = datetime.datetime(y, m + 1, 1, tzinfo=datetime.timezone.utc)
    else:
        start = datetime.datetime(first, 1, 1, tzinfo=datetime.timezone.utc)
    return squares, int(start.timestamp())




# --------------------------------------------------------------- detection

def _fields(m: dict) -> tuple:
    """What detection needs of one index record."""
    return (m["ts"], m.get("subject") or "", bool(m.get("seen")),
            (m.get("name") or "").strip(), m["addr"], m.get("msgid") or "",
            m["folder"], m["uid"])


def _cluster(receipts: list[dict]) -> list[dict]:
    """Receipts of one company, oldest first, with those less than
    MERGE_DAYS apart (an invoice and its receipt) counted once. The merged
    ones keep their Message-IDs (`ids`) and a price from any of them."""
    out: list[dict] = []
    for r in sorted(receipts, key=lambda r: r["ts"]):
        if out and r["ts"] - out[-1]["ts"] < MERGE_DAYS * DAY:
            if out[-1]["amount"] is None and r["amount"] is not None:
                out[-1]["amount"] = r["amount"]
            if r["msgid"]:
                out[-1]["ids"].append(r["msgid"])
            continue
        out.append({**r, "ids": [r["msgid"]] if r["msgid"] else []})
    return out


def _signin_mail(subject: str) -> bool:
    """A sign-in / new device / security / verification mail: Smart kind
    Accounts, without the weak words (welcome, ...) that open promotions."""
    return bool(smartkinds.STRONG_ACCOUNT_RE.search(subject or ""))


def _monthly(amount: float | None, kind: str) -> float | None:
    if amount is None:
        return None
    return amount if kind == "monthly" else amount / 12


def detect(acc, now: float | None = None) -> list[dict]:
    """Every subscription found in the scan index of `acc` (the caller marks
    the hidden ones), next expected receipt first. Pure over the index:
    nothing is fetched."""
    now = time.time() if now is None else now
    per: dict[str, list[tuple]] = {}
    with acc.lock:
        for m in acc.index.values():
            if not m.get("ts"):
                continue
            key = company_key(m["addr"])
            if key:
                per.setdefault(key, []).append(_fields(m))
    out = []
    for key, mails in per.items():
        receipts = [dict(ts=ts, subject=s, msgid=mid, folder=f, uid=u,
                         amount=amount_from_subject(s))
                    for ts, s, _seen, _n, _a, mid, f, u in mails
                    if is_receipt(s)]
        if len(receipts) < MIN_RECEIPTS:
            continue
        clusters = _cluster(receipts)
        run = find_run([c["ts"] for c in clusters])
        if run is None:
            continue
        start, kind, gap = run
        tail = clusters[start:]
        next_ts = int(tail[-1]["ts"] + gap * DAY)
        if now > next_ts + gap * DAY / 2:       # stopped: not a subscription
            continue
        out.append(_build(key, kind, gap, tail, next_ts, mails, now))
    out.sort(key=lambda s: (s["next"], s["name"].lower(), s["key"]))
    return out


def _use(mails: list[tuple], now: float) -> dict:
    """Still in use? From mail that is already here: a sign-in / security
    alert of the company, or one of its other mails the user opened, within
    USE_DAYS. Receipts are no evidence."""
    others = [(t, seen) for t, s, seen, *_ in mails
              if not is_receipt(s) and not _signin_mail(s)]
    last_signin = max((t for t, s, *_ in mails
                       if not is_receipt(s) and _signin_mail(s)), default=0)
    last_read = max((t for t, seen in others if seen), default=0)
    cut = now - USE_DAYS * DAY
    if last_signin >= cut:
        use = {"state": "signin", "ts": int(last_signin)}
    elif last_read >= cut:
        use = {"state": "read", "ts": int(last_read)}
    else:
        ref = max(last_signin, last_read)
        use = {"state": "unused" if ref else "never", "ts": int(ref),
               "since": "signin" if ref and ref == last_signin else "read",
               # their other mails since then (none of them was opened)
               "others": sum(1 for t, _s in others if t > ref)}
    use["in_use"] = use["state"] in ("signin", "read")
    return use


def _build(key: str, kind: str, gap: float, tail: list[dict], next_ts: int,
           mails: list[tuple], now: float) -> dict:
    addrs = Counter(a for _t, s, _r, _n, a, *_ in mails if is_receipt(s))
    # the name the receipts come under (a company has other senders too)
    names = Counter(n for _t, s, _r, n, *_ in mails if n and is_receipt(s)) \
        or Counter(n for _t, _s, _r, n, *_ in mails if n)
    name = (names.most_common(1)[0][0] if names
            else key.rsplit("@", 1)[-1].split(".")[0].capitalize())[:80]
    # The price: the latest of the last receipts whose subject names one.
    recent = [c["amount"] for c in tail[-LATEST:] if c["amount"]]
    amount, currency = recent[-1] if recent else (None, "")
    squares, slots_from = _slots(kind, [c["ts"] for c in tail])
    s = {
        "key": key, "name": name,
        "addr": addrs.most_common(1)[0][0] if addrs else "",
        "cadence": kind, "every_days": round(gap),
        "day": int(statistics.median(_utc(c["ts"]).day for c in tail)),
        "since": int(tail[0]["ts"]), "last": int(tail[-1]["ts"]),
        "next": next_ts, "next_days": math.ceil((next_ts - now) / DAY),
        "receipts": len(tail),
        "amount_source": "subject" if amount is not None else None,
        "slots": squares, "slots_from": slots_from,
        "use": _use(mails, now),
        "latest": [{"subject": c["subject"][:150], "ts": c["ts"],
                    "folder": c["folder"], "uid": c["uid"]}
                   for c in reversed(tail[-LATEST:])],
        # kept out of the API answer (see listing)
        "_ids": sorted({i for c in tail for i in c["ids"]}),
        "_prices": [c["amount"] for c in tail],
        "_latest": (tail[-1]["folder"], tail[-1]["uid"], tail[-1]["ts"]),
    }
    _price(s, amount, currency)
    return s


def _price(s: dict, amount: float | None, currency: str) -> None:
    """Set the amount fields: per receipt, per month and since the start (a
    receipt without a price of its own counts at the latest one - then the
    total is only an estimate)."""
    s["amount"], s["currency"] = amount, currency if amount else ""
    s["monthly"] = _monthly(amount, s["cadence"])
    s["total"], s["total_estimated"] = None, False
    if amount is not None:
        total, estimated = 0.0, False
        for p in s["_prices"]:
            if p and p[1] == currency:
                total += p[0]
            else:
                total += amount
                estimated = True
        s["total"], s["total_estimated"] = round(total, 2), estimated


# ----------------------------------------------------------------- listing

def _round(v: float | None) -> float | None:
    return None if v is None else round(v, 2)


def totals(items: list[dict]) -> dict:
    """The figures of the KPI tiles over the visible subscriptions. Money is
    summed in the currency most rows use; the others are named, not added."""
    cur = Counter(s["currency"] for s in items if s["amount"] is not None)
    main = sorted(cur.items(), key=lambda kv: (-kv[1], kv[0]))
    main_cur = main[0][0] if main else ""
    priced = [s for s in items if s["currency"] == main_cur and main_cur]
    unused = [s for s in items if not s["use"]["in_use"]]
    return {
        "count": len(items), "currency": main_cur,
        "other_currencies": sorted(c for c in cur if c != main_cur),
        "with_amount": len(priced),
        "monthly": _round(sum(s["monthly"] for s in priced)) if priced
        else None,
        "unused": len(unused),
        "unused_monthly": _round(sum(
            s["monthly"] for s in unused if s["currency"] == main_cur
            and main_cur)) if main_cur else None,
        # a yearly renewal is news; a monthly one always is "within 60 days"
        "renewing": sum(1 for s in items if s["cadence"] == "yearly"
                       and s["next_days"] <= RENEW_DAYS),
    }


def listing(acc, now: float | None = None) -> dict:
    """The page's data: every subscription with what the user decided about
    it, and the KPI figures of the visible ones."""
    now = time.time() if now is None else now
    block = substore.load_account(acc.name)
    pinned = pinstore.load_account(acc.name)
    items = detect(acc, now)
    pending = 0
    for s in items:
        if s["amount"] is None and block["body_amounts"]:
            read = block["amounts"].get(s["key"])
            if read and read["amount"] is not None:
                _price(s, read["amount"], read["currency"])
                s["amount_source"] = "receipt"
            # the latest receipt was not read yet (a newer one came)
            if (read or {}).get("ts") != s["_latest"][2] \
                    and s["key"] not in block["hidden"]:
                pending += 1
        s["hidden"] = s["key"] in block["hidden"]
        s["reminder"] = s["key"] in block["reminders"]
        s["kept"] = bool(s["_ids"]) and all(i in pinned for i in s["_ids"])
    visible = [s for s in items if not s["hidden"]]
    return {
        "now": int(now), "body_amounts": block["body_amounts"],
        "unread_amounts": pending,
        "totals": totals(visible),
        "items": [{k: v for k, v in s.items() if not k.startswith("_")}
                  for s in items],
    }


def item(acc, key: str, now: float | None = None) -> dict:
    """One detected subscription (with its private fields), or ValueError."""
    for s in detect(acc, now):
        if s["key"] == key:
            return s
    raise ValueError("unknown subscription")


# ----------------------------------------------------------- user actions

def keep_receipts(acc, key: str, pinned: bool = True) -> dict:
    """Pin (or unpin) every receipt of one subscription - pinned mails are
    skipped by every bulk action."""
    s = item(acc, key)
    changed = pinstore.set_many(set(s["_ids"]), pinned, acc.name)
    if changed:
        with acc.lock:
            acc.state["groups_rev"] += 1       # the groups' pinned counts
    return {"ok": True, "pinned": pinned, "changed": changed}


def read_amounts(acc, now: float | None = None) -> dict:
    """The opt-in: read the text of the LATEST receipt of each subscription
    whose subject names no price, and keep only the amount and its currency.
    Goes through the reader's local body fetch (a read-only BODY.PEEK from the
    user's own IMAP server) and nothing else - never an AI, never a URL.
    A receipt is read once (until a newer one arrives)."""
    block = substore.load_account(acc.name)
    if not block["body_amounts"]:
        raise ValueError("receipt amounts are switched off")
    todo = []
    for s in detect(acc, now):
        if s["amount"] is not None or s["key"] in block["hidden"]:
            continue
        folder, uid, ts = s["_latest"]
        if (block["amounts"].get(s["key"]) or {}).get("ts") == ts:
            continue
        todo.append((s["key"], folder, uid, ts))
    from . import mailops               # the existing local body fetch
    read = found = 0
    for i in range(0, len(todo), READ_BATCH):
        batch = todo[i:i + READ_BATCH]
        got = mailops.fetch_messages([[f, u] for _k, f, u, _t in batch], acc)
        for (key, _f, _u, ts), mail in zip(batch, got):
            if "error" in mail:
                continue
            hit = amount_from_text(mail.get("text") or "")
            substore.set_amount(key, hit[0] if hit else None,
                                hit[1] if hit else "", ts, acc.name)
            read += 1
            found += 1 if hit else 0
    return {"read": read, "found": found}


# --------------------------------------------------------------- reminders

def due(items: list[dict], block: dict, today: datetime.date) -> list[tuple]:
    """(subscription, expected date, days left) of the reminders that are on,
    inside their LEAD_DAYS window and not announced for this date yet."""
    out = []
    for s in items:
        r = block["reminders"].get(s["key"])
        if r is None or s["key"] in block["hidden"]:
            continue
        expected = _utc(s["next"]).date()
        left = (expected - today).days
        if 0 <= left <= LEAD_DAYS and r["sent"] != expected.isoformat():
            out.append((s, expected.isoformat(), left))
    return out


def tick_account(acc, now: float | None = None) -> int:
    """Announce the reminders of one account that are due; each expected date
    is announced once. Returns how many went out."""
    from . import webpush
    now = time.time() if now is None else now
    block = substore.load_account(acc.name)
    if not block["reminders"]:
        return 0
    sent = 0
    for s, iso, left in due(detect(acc, now), block, _utc(now).date()):
        if not substore.mark_sent(s["key"], iso, acc.name):
            continue
        substore.add_fired(s["key"], int(now), acc.name)
        use = s["use"]
        signed_in = use["state"] == "signin" or (
            use["state"] == "unused" and use["since"] == "signin")
        webpush.reminder(
            acc, name=s["name"], days=left, amount=s["amount"],
            currency=s["currency"], expected=s["next"],
            signin=use["ts"] if signed_in else 0)
        sent += 1
    return sent


def recent_reminders(acc, now: float | None = None) -> list[dict]:
    """The reminders that fired lately, for the open page to show once."""
    now = time.time() if now is None else now
    block = substore.load_account(acc.name)
    fired = [f for f in block["fired"] if now - f["ts"] < 3 * DAY]
    if not fired:
        return []
    by_key = {s["key"]: s for s in detect(acc, now)}
    return [{"key": f["key"], "ts": f["ts"], "name": by_key[f["key"]]["name"],
             "next": by_key[f["key"]]["next"],
             "amount": by_key[f["key"]]["amount"],
             "currency": by_key[f["key"]]["currency"]}
            for f in fired if f["key"] in by_key]


def tick(now: float | None = None) -> None:
    for tenant in tenants.known():
        with tenants.use(tenant):
            for name in accounts.names():
                try:
                    tick_account(accounts.get(name), now)
                except KeyError:
                    continue                 # account was deleted
                except Exception:
                    log.exception("[%s] subscription reminders failed", name)


_scheduler_started = False


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        while True:
            time.sleep(TICK_SECONDS)
            try:
                tick()
            except Exception:
                log.exception("subscription reminder tick failed")

    threading.Thread(target=loop, daemon=True).start()
