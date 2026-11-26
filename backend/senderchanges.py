"""Sender changes: which senders got louder, which came back.

Every scan keeps a small number per sender and week (how many mails reached
the mailbox that week - numbers only, no subjects, ~26 weeks rolling) plus
the time of the sender's last mail, because the mail still in the mailbox
cannot tell: a sender you cleaned would look "louder" next to the few mails
left. Persisted PER TENANT and PER ACCOUNT (mirrors pinstore.py / the other
stores: per-tenant file, atomic write, per-tenant cache, account rename and
drop hooks in main.py).

  louder    in a window (the last 7 days - or the part of "since your last
            visit" inside them) more than twice the sender's usual week
            (the median of the counted weeks before it, up to 26) and at
            least 4 mails. A sender needs a few weeks of history to have a
            usual week at all.
  came back the first mail of a sender after 6+ months of silence (found
            when a scan sees it, or - for the mail already in the mailbox
            the first time - in the gaps between its mails).

Before 8 weeks of counts exist the mailbox is all we have, so only senders
the user never cleaned are compared: a trashed sender's weeks are missing
from it. "Cleaned" = Inboxrake moved its mail out (`note_cleaned`, called by
the move pipeline) or, for what happened before this feature, the audit log
names it in a trash / archive / move entry. A "came back" that rests on mail
from before the counting began is held to the same rule.

Nothing here changes a mail or a setting; it is read by the Overview, the
sender list (`is:louder` / `is:back`) and the Statistics card.

File shape: {"accounts": {name: {"since": ts, "weeks": {addr: {week: n}},
"last": {addr: ts}, "back": {addr: {ts, gap, t}}, "cleaned": {addr: ts}}}}.
An older release ignores the file.
"""

from __future__ import annotations

import json
import logging
import os
import statistics
import threading
import time
from collections import defaultdict
from pathlib import Path

from . import accounts
from . import auditlog
from . import stats as statsmod
from . import tenants

log = logging.getLogger("inboxrake.senderchanges")

SENDER_CHANGES_PATH = Path(
    os.environ.get("SENDER_CHANGES_PATH", "/data/sender_changes.json"))

WEEK_S = 7 * 86400
KEEP_WEEKS = 26                 # weekly counts older than this are dropped
LOUDER_FACTOR = 2               # MORE than this many times the usual week ...
LOUDER_MIN_MAILS = 4            # ... and at least this many mails
BASELINE_MIN_WEEKS = 3          # weeks of history a "usual week" needs
TRUST_WEEKS = 8                 # before this many weeks, cleaned senders out
DORMANT_S = 183 * 86400         # "6+ months of silence"
BACK_DAYS = 30                  # `is:back` without `in:` (and the card)
MAX_CLEANED = 20000             # cleaned senders remembered per account
# The Statistics card looks at the last 30 days in weekly steps: the last 7
# days, the 7 before, ... (the oldest step takes the 9 days left).
CARD_DAYS = 30
_STEPS = ((0, 7), (7, 14), (14, 21), (21, CARD_DAYS))

_LOCK = threading.Lock()
# Per-tenant cache (keyed by tenant id): public_state() never re-reads the
# file and never mixes tenants. Entries of an account are replaced as a
# whole, never edited in place, so a reader can keep one without a lock.
_cache: dict[str, dict] = {}
_rev: dict[str, int] = {}       # bumped on every write (the memo key)
_memo: dict[tuple, dict] = {}


def _path() -> Path:
    return tenants.current().file("sender_changes.json", SENDER_CHANGES_PATH)


def _read() -> dict:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    return {n: e for n, e in accs.items() if isinstance(e, dict)}


def _load() -> dict:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"accounts": data}))
    tmp.chmod(0o600)
    tmp.replace(path)
    tid = tenants.current().id
    _cache[tid] = data
    _rev[tid] = _rev.get(tid, 0) + 1


def _store(account: str, entry: dict) -> None:
    """Replace one account's entry (lock held by the caller)."""
    _persist({**_load(), account: entry})


def load_account(account: str | None = None) -> dict:
    """One account's entry (read-only: never edit it). Empty when the
    account has none yet."""
    account = account or accounts.default_name()
    with _LOCK:
        return _load().get(account) or {}


def rename_account(old: str, new: str) -> None:
    """Move one account's counts to a new account name."""
    with _LOCK:
        data = _load()
        if old in data:
            moved = {k: v for k, v in data.items() if k != old}
            moved[new] = data[old]
            _persist(moved)


def drop_account(name: str) -> None:
    with _LOCK:
        data = _load()
        if name in data:
            _persist({k: v for k, v in data.items() if k != name})


# ------------------------------------------------------------------ keeping

def _week(ts: float) -> int:
    return int(ts // WEEK_S)


def arrivals_by_sender(prev_mails, prev_ts: int | None, messages: list,
                       now: float) -> dict[str, list[int]] | None:
    """Mails of this scan that the previous scan's index did not hold, per
    sender, oldest first - the same mails `stats.arrivals` counts (restored
    or imported old mail is no arrival). None without a previous scan."""
    if not prev_ts or not prev_mails:
        return None
    seen = {statsmod._ident(m) for m in prev_mails}
    floor = prev_ts - statsmod.ARRIVAL_SLACK_S
    out: dict[str, list[int]] = defaultdict(list)
    for m in messages:
        ts = m.get("ts") or 0
        if ts >= floor and ts <= now + 86400 \
                and ts >= now - KEEP_WEEKS * WEEK_S \
                and statsmod._ident(m) not in seen:
            out[m["addr"]].append(int(ts))
    return {a: sorted(v) for a, v in out.items()}


def _seed(messages: list, now: float) -> dict:
    """The first counting of an account: what the mailbox holds now. Its
    weeks and each sender's last mail come from the index; gaps of 6+ months
    between a sender's mails become "came back" events (the newest one)."""
    horizon = now - KEEP_WEEKS * WEEK_S
    stamps: dict[str, list[int]] = defaultdict(list)
    for m in messages:
        ts = m.get("ts") or 0
        if 0 < ts <= now + 86400:
            stamps[m["addr"]].append(int(ts))
    weeks: dict[str, dict[str, int]] = {}
    last: dict[str, int] = {}
    back: dict[str, dict] = {}
    for addr, ts in stamps.items():
        ts.sort()
        last[addr] = ts[-1]
        for t in ts:
            if t >= horizon:
                w = weeks.setdefault(addr, {})
                k = str(_week(t))
                w[k] = w.get(k, 0) + 1
        for before, t in zip(ts, ts[1:]):
            if t - before >= DORMANT_S and t >= horizon:
                back[addr] = {"ts": t, "gap": (t - before) // 86400, "t": 0}
    return {"since": int(now), "weeks": weeks, "last": last, "back": back}


def _add(entry: dict, arrived: dict[str, list[int]]) -> dict:
    """`entry` with the arrivals of one scan counted (a new dict)."""
    weeks = {a: dict(w) for a, w in entry.get("weeks", {}).items()}
    last = dict(entry.get("last", {}))
    back = dict(entry.get("back", {}))
    since = int(entry.get("since") or 0)
    for addr, stamps in arrived.items():
        w = weeks.setdefault(addr, {})
        for t in stamps:
            k = str(_week(t))
            w[k] = w.get(k, 0) + 1
        prev = last.get(addr)
        for t in stamps:
            if prev is not None and t - prev >= DORMANT_S:
                # trusted: the silence is measured from a mail this counting
                # saw (it could not have been cleaned away unseen)
                back[addr] = {"ts": t, "gap": (t - prev) // 86400,
                              "t": 1 if prev >= since else 0}
            prev = max(prev or 0, t)
        last[addr] = prev
    return {**entry, "weeks": weeks, "last": last, "back": back}


def _prune(entry: dict, now: float) -> dict:
    floor = _week(now) - KEEP_WEEKS
    weeks = {}
    for addr, w in entry.get("weeks", {}).items():
        kept = {k: n for k, n in w.items() if int(k) >= floor}
        if kept:
            weeks[addr] = kept
    back = {a: b for a, b in entry.get("back", {}).items()
            if b["ts"] >= now - KEEP_WEEKS * WEEK_S}
    return {**entry, "weeks": weeks, "back": back}


def record_scan(account: str, prev_mails, prev_ts: int | None,
                messages: list, now: float | None = None) -> None:
    """Count one finished scan. `prev_mails` / `prev_ts` are the index and
    the time of the scan before it. The first call for an account seeds the
    counts from the mailbox; later ones add what arrived since the last
    scan. Never raises: a scan must not fail on this."""
    now = now if now is not None else time.time()
    try:
        with _LOCK:
            entry = _load().get(account) or {}
            if "since" not in entry:
                new = {**_seed(messages, now),
                       "cleaned": entry.get("cleaned", {})}
            else:
                arrived = arrivals_by_sender(prev_mails, prev_ts, messages,
                                             now)
                new = _add(entry, arrived) if arrived else entry
            _store(account, _prune(new, now))
    except Exception:
        log.exception("could not count the arrivals of the scan")


def note_cleaned(account: str, addrs, now: float | None = None) -> None:
    """Inboxrake moved mail of these senders out of the mailbox: their
    weeks no longer add up from what is left. Never raises."""
    addrs = {a for a in addrs if a}
    if not addrs:
        return
    now = int(now if now is not None else time.time())
    try:
        with _LOCK:
            entry = _load().get(account) or {}
            cleaned = dict(entry.get("cleaned", {}))
            if addrs <= set(cleaned):
                return
            for a in addrs:
                cleaned.setdefault(a, now)
            if len(cleaned) > MAX_CLEANED:       # the oldest ones go first
                keep = sorted(cleaned.items(), key=lambda kv: -kv[1])
                cleaned = dict(keep[:MAX_CLEANED])
            _store(account, {**entry, "cleaned": cleaned})
    except Exception:
        log.exception("could not note the cleaned senders")


# ----------------------------------------------------------------- the checks

def usual_week(weeks: dict[str, int], start: float) -> float | None:
    """A sender's usual week before `start`: the median of its counted weeks
    (up to 26, a week without mail counts as 0, from its first counted week
    on). None when there is no history of BASELINE_MIN_WEEKS weeks or more."""
    last = _week(start) - 1            # the week of `start` itself is partial
    first_allowed = last - KEEP_WEEKS + 1
    seen = [int(k) for k in weeks if first_allowed <= int(k) <= last]
    if not seen:
        return None
    first = min(seen)
    if last - first + 1 < BASELINE_MIN_WEEKS:
        return None
    return float(statistics.median(
        weeks.get(str(b), 0) for b in range(first, last + 1)))


def is_louder(n: float, usual: float) -> bool:
    """More than twice the usual week, and at least 4 mails."""
    return n >= LOUDER_MIN_MAILS and n > LOUDER_FACTOR * usual


def louder_in_window(entry: dict, start: float) -> int | None:
    """The mails of a louder sender's last 7 days (`entry["ts"]`) inside the
    window from `start`, when that is still louder than its usual week; else
    None. Windows shorter than a week are not scaled up."""
    n = sum(1 for t in entry.get("ts") or () if t >= start)
    return n if is_louder(n, entry.get("usual") or 0) else None


def _audit_text(account: str) -> str:
    """What the audit log says was moved out of the mailbox, as one lower-case
    text (the group labels of every trash / archive / move step)."""
    try:
        entries = auditlog._load_all(account)
    except Exception:
        return ""
    return "\n".join(
        str(e.get("label") or "").lower() for e in entries
        if e.get("action") in ("trash", "archive", "move")
        and not e.get("from_role") and (e.get("count") or 0) > 0
        and e.get("outcome") in ("ok", "partial"))


class _Cleaned:
    """Has this sender been cleaned? Asked lazily (the audit log is only
    read when a candidate needs the answer)."""

    def __init__(self, account: str, entry: dict):
        self.account = account
        self.known = entry.get("cleaned") or {}
        self._text: str | None = None

    def __call__(self, addr: str, label: str) -> bool:
        if addr in self.known:
            return True
        if self._text is None:
            self._text = _audit_text(self.account)
        label = (label or "").lower()
        return addr in self._text or (len(label) >= 3 and label in self._text)


def changes(acc, now: float | None = None) -> dict:
    """The sender changes of one account, from the scan index and the kept
    counts. Takes `acc.lock` itself (call it without holding it).

    {"since": when counting began (None = not yet),
     "louder": {addr: {label, n, usual, factor, start, end, ts?}} - the
        newest 7-day step of the last 30 days in which the sender was louder;
        `ts` (the mails' arrival times) only for the step ending now, which is
        what `is:louder` and the Overview rows are made from,
     "back": {addr: {label, ts, gap_days, n, never_opened}} - came back in the
        last 26 weeks (n = its mails since)}"""
    now = now if now is not None else time.time()
    key = (tenants.current().id, acc.name)
    with acc.lock:
        rev = acc.state.get("groups_rev", 0)
    memo_key = (rev, _rev.get(key[0], 0), int(now // 60))
    hit = _memo.get(key)
    if hit is not None and hit["key"] == memo_key:
        return hit["value"]
    value = _compute(acc, now)
    _memo[key] = {"key": memo_key, "value": value}
    return value


def _compute(acc, now: float) -> dict:
    entry = load_account(acc.name)
    since = entry.get("since")
    out: dict = {"since": since, "louder": {}, "back": {}}
    if since is None:
        return out
    weeks = entry.get("weeks") or {}
    back_events = {a: b for a, b in (entry.get("back") or {}).items()
                   if b["ts"] >= now - KEEP_WEEKS * WEEK_S}
    horizon = now - CARD_DAYS * 86400
    recent: dict[str, list[int]] = defaultdict(list)
    after: dict[str, int] = defaultdict(int)         # mails since the event
    before: dict[str, list[int]] = defaultdict(lambda: [0, 0])   # n, seen
    with acc.lock:
        for m in acc.index.values():
            ts, addr = m["ts"], m["addr"]
            if not ts:
                continue
            if horizon <= ts <= now:
                recent[addr].append(int(ts))
            ev = back_events.get(addr)
            if ev is not None:
                if ts >= ev["ts"]:
                    after[addr] += 1
                else:
                    before[addr][0] += 1
                    before[addr][1] += 1 if m.get("seen") else 0
        sender_groups = acc.state["groups"].get("sender") or {}
        cands = {a: sorted(v) for a, v in recent.items()
                 if len(v) >= LOUDER_MIN_MAILS}
        wanted = set(cands) | set(back_events)
        labels = {a: (sender_groups.get(a) or {}).get("label") or a
                  for a in wanted}
    young = now - since < TRUST_WEEKS * WEEK_S
    cleaned = _Cleaned(acc.name, entry)
    for addr, stamps in cands.items():
        w = weeks.get(addr)
        if not w:
            continue
        for k, (lo, hi) in enumerate(_STEPS):
            start, end = now - hi * 86400, now - lo * 86400
            n = sum(1 for t in stamps if start <= t <= end)
            usual = usual_week(w, start)
            if usual is None:
                continue
            # a step longer than a week counts as the week it adds up to
            per_week = n / max(1.0, (hi - lo) / 7)
            if n < LOUDER_MIN_MAILS or per_week <= LOUDER_FACTOR * usual:
                continue
            if young and cleaned(addr, labels[addr]):
                break
            row = {"label": labels[addr], "n": n,
                   "usual": round(usual, 1),
                   "factor": round(per_week / max(usual, 1.0), 1),
                   "start": int(start), "end": int(end)}
            if k == 0:
                row["ts"] = [t for t in stamps if t >= start][-200:]
            out["louder"][addr] = row
            break
    for addr, ev in back_events.items():
        if not after.get(addr):
            continue                     # its mail has left: nothing to show
        if not ev.get("t") and cleaned(addr, labels[addr]):
            continue
        old_n, old_seen = before.get(addr, (0, 0))
        out["back"][addr] = {
            "label": labels[addr], "ts": int(ev["ts"]),
            "gap_days": int(ev["gap"]), "n": after[addr],
            "never_opened": old_n > 0 and old_seen == 0}
    return out


def months_of(gap_days: int) -> int:
    """A gap in whole months (a month = 30.44 days)."""
    return int(gap_days / 30.44)


def reset_cache() -> None:
    """Forget the in-memory copies (tests, the demo's visitor reset)."""
    with _LOCK:
        _cache.clear()
        _rev.clear()
    _memo.clear()
