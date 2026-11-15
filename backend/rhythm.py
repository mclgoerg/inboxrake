"""When mail arrives: how many mails reach the mailbox in each hour of the
week (GET /api/rhythm), and the same slots as a filter for the flat mail list.

Read-only, one pass over the scan index of ONE account under its lock. The
arrival time is the INTERNALDATE the scan already stores (`ts`); it is cut
into weekday x hour in the BROWSER's time zone (an IANA name, with the
current UTC offset as the fallback for a runtime that has no zone database -
the browser demo), so a mail that reached the server at 23:30 UTC lands on the
next day for someone in UTC+1.

Counts are per Smart kind (all / newsletters / people / orders). A mail's kind
is read from the mail itself: people = a sender the user has written to;
orders = an order / shipping / invoice subject (`smartkinds.message_kind`);
newsletters = what is left of promotional mail (List-Unsubscribe or a promo
subject). Everything else only counts in "all".
"""

from __future__ import annotations

import datetime as dt
import re
import time
from collections import Counter

from . import config as cfgmod
from . import smartkinds

PERIODS = ("30d", "12m", "all")
KINDS = ("all", "newsletters", "people", "orders")
TOP_SENDERS = 2           # named per slot; the rest is "N more"
# A "daily sender": at least one mail in the same hour (or an hour next to it)
# on this share of the days it has been mailing (and at least DAILY_MIN_DAYS of them, so a new
# sender with three mails is not "every day").
DAILY_SHARE = 0.8
DAILY_MIN_DAYS = 14
DAILY_MAX = 5
_ZONE_RE = re.compile(r"^[A-Za-z0-9_+\-/]{1,64}$")
_BUCKET_S = 900           # every UTC offset is a multiple of 15 minutes


def zone(name: str = "", offset: int = 0) -> dt.tzinfo:
    """The zone to bucket in: the IANA `name` when this runtime knows it, else
    the fixed `offset` (minutes east of UTC, clamped to what exists)."""
    if name and _ZONE_RE.match(name):
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(name)
        except Exception:         # unknown name / no tz database (Pyodide)
            pass
    off = max(-840, min(840, int(offset)))
    return dt.timezone(dt.timedelta(minutes=off))


def _slotter(tz: dt.tzinfo):
    """ts -> (weekday Mon=0, hour, local day number), memoised per quarter
    hour (a bucket never straddles a local hour)."""
    cache: dict[int, tuple[int, int, int] | None] = {}

    def slot(ts: int):
        k = int(ts) // _BUCKET_S
        if k not in cache:
            try:
                d = dt.datetime.fromtimestamp(k * _BUCKET_S, tz)
                cache[k] = (d.weekday(), d.hour, d.toordinal())
            except (OverflowError, OSError, ValueError):
                cache[k] = None
        return cache[k]
    return slot


def period_start(period: str, now: float, tz: dt.tzinfo) -> float:
    """First instant of the period: the last 30 local days, the last 12
    calendar months (this one included), or the beginning of time."""
    today = dt.datetime.fromtimestamp(now, tz)
    if period == "30d":
        first = (today - dt.timedelta(days=29)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        return first.timestamp()
    if period == "12m":
        months = today.year * 12 + today.month - 1 - 11
        first = today.replace(year=months // 12, month=months % 12 + 1, day=1,
                              hour=0, minute=0, second=0, microsecond=0)
        return first.timestamp()
    return 0.0


class Kinds:
    """Which Smart kind a mail of `acc` is. Build it with the account lock
    held (it reads the sender records) and use it anywhere."""

    def __init__(self, sender_recs: dict):
        self.replied = {a for a, r in sender_recs.items() if r.get("replied")}

    def of(self, m: dict) -> str:
        """`people`, `orders`, `newsletters` or `other`."""
        addr = m["addr"]
        if addr in self.replied:
            return "people"
        kind = smartkinds.message_kind(
            m.get("subject") or "", smartkinds.sender_hint(
                addr, bool(m.get("unsub"))))
        if kind == "orders":
            return "orders"
        if m.get("bulk") or kind == "newsletter":
            return "newsletters"
        return "other"


def clean_slot(slot: dict | None) -> dict | None:
    """Validate a slot filter ({kind, period, days, from, to, tz, offset});
    ValueError on anything out of range."""
    if not slot:
        return None
    kind, period = slot.get("kind", "all"), slot.get("period", "all")
    days = sorted({int(d) for d in slot.get("days", range(7))})
    lo, hi = int(slot.get("from", 0)), int(slot.get("to", 24))
    if kind not in KINDS or period not in PERIODS:
        raise ValueError("bad slot kind or period")
    if not days or days[0] < 0 or days[-1] > 6 or not 0 <= lo < hi <= 24:
        raise ValueError("bad slot days or hours")
    return {"kind": kind, "period": period, "days": days, "from": lo,
            "to": hi, "tz": str(slot.get("tz") or ""),
            "offset": int(slot.get("offset") or 0)}


def slot_matcher(slot: dict, sender_recs: dict, now: float):
    """A predicate over index mails: the mails of `slot` (the clicked cell /
    block of the card, see `clean_slot`)."""
    tz = zone(slot["tz"], slot["offset"])
    start = period_start(slot["period"], now, tz)
    slotter = _slotter(tz)
    kinds = Kinds(sender_recs)
    days, lo, hi = set(slot["days"]), slot["from"], slot["to"]

    def match(m: dict) -> bool:
        ts = m["ts"]
        if not ts or ts < start or ts > now + 86400:
            return False
        s = slotter(ts)
        if s is None or s[0] not in days or not lo <= s[1] < hi:
            return False
        return slot["kind"] == "all" or kinds.of(m) == slot["kind"]
    return match


def build(acc, period: str = "30d", tz_name: str = "", offset: int = 0,
          now: float | None = None) -> dict:
    """The card's numbers for `period`: per kind a 7 x 24 grid (Mon first),
    the top senders of every non-empty slot and the daily senders."""
    now = now if now is not None else time.time()
    tz = zone(tz_name, offset)
    start = period_start(period, now, tz)
    slotter = _slotter(tz)
    today = dt.datetime.fromtimestamp(now, tz).toordinal()
    protected = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))

    grids = {k: [[0] * 24 for _ in range(7)] for k in KINDS}
    tops: dict[str, dict[tuple[int, int], Counter]] = {k: {} for k in KINDS}
    # per sender: mails, read mails, first local day, distinct (day, hour)
    per: dict[str, dict] = {}
    with acc.lock:
        sender_recs = acc.state["groups"].get("sender") or {}
        kinds = Kinds(sender_recs)
        meta = {a: (r.get("label") or a, bool(r.get("unsub")))
                for a, r in sender_recs.items()}
        for m in acc.index.values():
            ts = m["ts"]
            if not ts or ts < start or ts > now + 86400:
                continue
            s = slotter(ts)
            if s is None:
                continue
            wd, hour, day = s
            kind = kinds.of(m)
            for k in ("all", kind):
                if k == "other":
                    continue
                grids[k][wd][hour] += 1
                tops[k].setdefault((wd, hour), Counter())[m["addr"]] += 1
            p = per.setdefault(m["addr"], {"n": 0, "read": 0, "first": day,
                                           "hours": {}})
            p["n"] += 1
            p["read"] += 1 if m["seen"] else 0
            p["first"] = min(p["first"], day)
            p["hours"].setdefault(hour, set()).add(day)

    def label(addr: str) -> str:
        return meta.get(addr, (addr, False))[0]

    out_kinds = {}
    for k in KINDS:
        top = {}
        for (wd, hour), c in tops[k].items():
            ranked = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))
            named = ranked[:TOP_SENDERS]
            top[f"{wd}-{hour}"] = {
                "senders": [{"key": a, "label": label(a), "count": n}
                            for a, n in named],
                "more": sum(c.values()) - sum(n for _, n in named)}
        out_kinds[k] = {"total": sum(map(sum, grids[k])), "grid": grids[k],
                        "top": top}

    first_day = dt.datetime.fromtimestamp(max(start, 1.0), tz).toordinal()
    daily = []
    for addr, p in per.items():
        span = today - max(p["first"], first_day) + 1
        if span < DAILY_MIN_DAYS or not meta.get(addr, ("", False))[1] \
                or addr in kinds.replied or cfgmod.is_protected(addr, protected):
            continue
        hour, days = max(p["hours"].items(), key=lambda kv: (len(kv[1]), -kv[0]))
        # the neighbouring hours count as "the same": clock changes shift a
        # sender's local hour by one, and a minute past the hour is no change
        near = days | p["hours"].get((hour - 1) % 24, set()) \
            | p["hours"].get((hour + 1) % 24, set())
        if len(near) < DAILY_SHARE * span:
            continue
        daily.append({"key": addr, "label": label(addr), "hour": hour,
                      "per_day": round(p["n"] / span, 1), "mails": p["n"],
                      "open_pct": round(100 * p["read"] / p["n"])})
    daily.sort(key=lambda d: (-d["per_day"], d["key"]))
    return {"period": period, "tz": getattr(tz, "key", "") or "",
            "from": int(start), "kinds": out_kinds, "daily": daily[:DAILY_MAX]}
