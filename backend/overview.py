"""Numbers behind the Overview page, for ONE account: the 8-week arrivals
series, the "last week" / "since last visit" counts, the last 30 days by
kind and the size trend from the scan history.

Read-only and metadata only (counts, no subjects or addresses; the name of
the one loudest sender and the one that came back most recently): one pass
over the scan index under the account lock, plus the small per-account
stores (first-seen senders, AI verdicts, unsubscribe records, scan
history). Windows are rolling (the last 7 days, not calendar weeks), so
nothing depends on the browser's time zone.
"""

from __future__ import annotations

import time

from . import config as cfgmod
from . import knownsenders
from . import labelstore
from . import mailops
from . import senderchanges
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
            "verdicts_safe": 0, "louder": 0, "louder_top": None,
            "back": 0, "back_top": None}


def _sender_changes(w: dict, changed: dict, start: float) -> None:
    """Fill the window's `louder` / `back` counts (senders), and the loudest /
    latest one by name. Louder is a weekly idea: a louder sender carries the
    arrival times of its last 7 days only, so a window longer than that counts
    those 7 days and a shorter one counts what is inside it - the same rule
    `is:louder in:<window>` applies, so a row and the list it opens agree.
    Came back: the first mail after the silence arrived in the window."""
    louder = []
    for addr, row in changed["louder"].items():
        n = senderchanges.louder_in_window(row, start)
        if n is not None:
            louder.append((row["factor"], n, addr, row))
    if louder:
        _, n, _, row = max(louder, key=lambda x: x[:3])
        w["louder"] = len(louder)
        w["louder_top"] = {"label": row["label"], "n": n,
                           "usual": row["usual"]}
    back = [(row["ts"], addr, row) for addr, row in changed["back"].items()
            if row["ts"] >= start]
    if back:
        _, _, row = max(back, key=lambda x: x[:2])
        w["back"] = len(back)
        w["back_top"] = {"label": row["label"],
                         "months": senderchanges.months_of(
                             min(r["gap_days"] for _, _, r in back)),
                         "never_opened": row["never_opened"]}


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

    changed = senderchanges.changes(acc, now)     # takes the lock itself
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
        _sender_changes(w, changed, start)
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
            # what the index alone says (mails still here, by date): the UI
            # shows how many of a counted week are gone from the mailbox
            "weeks_in_mailbox": weeks,
            "week": out["week"],
            "since": out.get("since"),
            "kinds": {"days": KIND_DAYS, "total": sum(kinds.values()),
                      "items": items},
            "trend": trend(acc.name, now, history)}


def changes_card(acc, now: float | None = None) -> dict:
    """The Statistics card "Changes in the last 30 days" (GET
    /api/sender-changes): the senders that got louder (loudest first) and
    those that came back (newest first), with what the card needs to offer
    the fitting action - `unsub` (an unsubscribe is open), `protected`."""
    now = now if now is not None else time.time()
    changed = senderchanges.changes(acc, now)
    entries = unsubstore.load_account(acc.name)
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    floor = now - senderchanges.BACK_DAYS * 86400
    back = {a: r for a, r in changed["back"].items() if r["ts"] >= floor}
    wanted = set(changed["louder"]) | set(back)
    with acc.lock:
        recs = acc.state["groups"].get("sender") or {}
        unsub = {a: bool((recs.get(a) or {}).get("unsub")) for a in wanted}
    protected = {a for a in wanted if cfgmod.is_protected(a, plist)}

    def extra(addr: str) -> dict:
        done = (entries.get(addr) or {}).get("status") == "done"
        return {"key": addr, "unsub": unsub[addr] and not done,
                "protected": addr in protected}

    louder = [{**extra(a), "label": r["label"], "n": r["n"],
               "usual": r["usual"], "factor": r["factor"],
               "start": r["start"], "end": r["end"]}
              for a, r in changed["louder"].items()]
    louder.sort(key=lambda r: (-r["factor"], -r["n"], r["key"]))
    came = [{**extra(a), "label": r["label"], "ts": r["ts"],
             "gap_days": r["gap_days"], "n": r["n"]}
            for a, r in back.items()]
    came.sort(key=lambda r: (-r["ts"], r["key"]))
    return {"days": senderchanges.CARD_DAYS, "since": changed["since"],
            "louder": louder, "back": came}
