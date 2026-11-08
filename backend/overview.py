"""Numbers behind the Overview page, for ONE account: the 8-week arrivals
series, the "last week" / "since last visit" counts, the last 30 days by
kind and the size trend from the scan history.

Read-only and metadata only (counts, no subjects or addresses): one pass
over the scan index under the account lock, plus the small per-account
stores (first-seen senders, AI verdicts, unsubscribe records, scan
history). Windows are rolling (the last 7 days, not calendar weeks), so
nothing depends on the browser's time zone.
"""

from __future__ import annotations

import time

from . import knownsenders
from . import labelstore
from . import mailops
from . import stats as statsmod
from . import unsubstore
from . import verdictstore

WEEKS = 8
WEEK_S = 7 * 86400
KIND_DAYS = 30
# A scan this much older than the newest one is worth comparing with.
TREND_MIN_AGE_S = 2 * 86400
TREND_TARGET_S = 30 * 86400
# Kinds that are not a category name: shown by the UI in its own words.
KIND_NEWSLETTER = "newsletter"
KIND_AUTOMATED = "automated"
KIND_OTHER = "other"


def kind_of(tags: list[str]) -> str:
    """One kind per sender (the groups' tags overlap, a share must not):
    newsletters first, then the first category tag, then automated senders,
    else other."""
    if KIND_NEWSLETTER in tags:
        return KIND_NEWSLETTER
    for tag in tags:
        if tag != KIND_AUTOMATED:
            return tag
    return KIND_AUTOMATED if KIND_AUTOMATED in tags else KIND_OTHER


def trend(account: str, now: float,
          history: list[dict] | None = None) -> dict | None:
    """The scan snapshot nearest to 30 days back ({ts, size, mails}); when
    the history is younger, the oldest one - the UI words the age. None when
    there is no scan older than two days to compare with."""
    scans = [s for s in (history if history is not None
                         else statsmod.load(account)["scans"])
             if s.get("ts") and now - s["ts"] >= TREND_MIN_AGE_S]
    if not scans:
        return None
    best = min(scans, key=lambda s: abs(now - TREND_TARGET_S - s["ts"]))
    return {"ts": int(best["ts"]), "size": int(best.get("size", 0)),
            "mails": int(best.get("mails", 0))}


def weekly_arrivals(scans: list[dict], estimate: list[int],
                    now: float) -> tuple[list[int], list[bool]]:
    """Arrivals per bucket: from the per-scan records (mails new since the
    previous scan, so mails cleaned later still count) for every bucket that
    lies fully inside the tracked period; the index `estimate` (mails still
    here, by date) for older buckets, flagged as estimated."""
    tracked = [s for s in scans if s.get("new_since") is not None]
    if not tracked:
        return list(estimate), [True] * WEEKS
    since = min(s["new_since"] for s in tracked)
    counted = [0] * WEEKS
    for s in tracked:
        for day, n in (s.get("new_days") or {}).items():
            # a day counts at its midday (UTC day number -> epoch)
            i = WEEKS - 1 - int(max(0.0, now - (int(day) * 86400 + 43200))
                                // WEEK_S)
            if i >= 0:
                counted[i] += n
    weeks, est = [], []
    for i in range(WEEKS):
        start = now - (WEEKS - i) * WEEK_S
        exact = start >= since
        weeks.append(counted[i] if exact else estimate[i])
        est.append(not exact)
    return weeks, est


def _empty_window(start: float) -> dict:
    return {"from": int(start), "mails": 0, "senders": 0, "newsletters": 0,
            "new_senders": 0, "still_mailing": 0, "verdicts": 0,
            "verdicts_safe": 0}


def build(acc, since: int | None = None, now: float | None = None) -> dict:
    """The Overview payload of `acc`. `since` (epoch s) adds the "since last
    visit" window; None = no earlier visit known."""
    now = now if now is not None else time.time()
    starts = {"week": now - WEEK_S}
    if since is not None:
        starts["since"] = float(min(since, now))
    out = {name: _empty_window(s) for name, s in starts.items()}
    senders = {name: set() for name in starts}
    still = {name: set() for name in starts}
    weeks = [0] * WEEKS
    kind_floor = now - KIND_DAYS * 86400
    kinds: dict[str, int] = {}

    entries = unsubstore.load_account(acc.name)
    cut = mailops._still_mailing_cutoffs(entries)
    first_seen = knownsenders.load_account(acc.name)
    verdicts = (verdictstore.load_account(acc.name).get("sender") or {})
    # a verdict the user set by hand is not an AI verdict (the group shows
    # the user's, which has no date): its sender is left out of the count
    by_user = labelstore.verdicts(acc.name)

    with acc.lock:
        sender_groups = acc.state["groups"].get("sender") or {}
        kind_by_addr: dict[str, str] = {}
        for m in acc.index.values():
            ts = m["ts"]
            if not ts:
                continue
            idx = WEEKS - 1 - int(max(0.0, now - ts) // WEEK_S)
            if idx >= 0:
                weeks[idx] += 1
            addr = m["addr"]
            for name, start in starts.items():
                if ts < start:
                    continue
                w = out[name]
                w["mails"] += 1
                w["newsletters"] += 1 if m["bulk"] else 0
                senders[name].add(addr)
                if addr in cut and ts > cut[addr] and ts >= start:
                    still[name].add(addr)
            if ts >= kind_floor:
                k = kind_by_addr.get(addr)
                if k is None:
                    rec = sender_groups.get(addr)
                    k = kind_by_addr[addr] = kind_of(
                        rec["tags"] if rec else [])
                kinds[k] = kinds.get(k, 0) + 1
        keys = set(sender_groups)

    for name, start in starts.items():
        w = out[name]
        w["senders"] = len(senders[name])
        w["still_mailing"] = len(still[name])
        # first_seen 0 = known before the first scan: never "new"
        w["new_senders"] = sum(1 for a, ts in first_seen.items()
                               if ts and ts >= start and a in keys)
        for key, v in verdicts.items():
            if key in keys and key not in by_user \
                    and (v.get("ts") or 0) >= start:
                w["verdicts"] += 1
                w["verdicts_safe"] += 1 if v.get("verdict") == "delete_safe" \
                    else 0

    items = [{"kind": k, "count": n} for k, n in
             sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0]))]
    history = statsmod.load(acc.name)["scans"]
    arrived, estimated = weekly_arrivals(history, weeks, now)
    return {"now": int(now), "weeks": arrived, "weeks_estimated": estimated,
            "week": out["week"],
            "since": out.get("since"),
            "kinds": {"days": KIND_DAYS, "total": sum(kinds.values()),
                      "items": items},
            "trend": trend(acc.name, now, history)}
