"""You keep doing this: rules from your own habits.

Every manual mail action is written to the audit log; since this feature it
also names the sender groups it covered (habitlog.py). The miner reads that
log - local, no AI, nothing sent anywhere - and looks, per tenant and
account, for the SAME action on the SAME sender done by hand at least
MIN_TIMES times on at least MIN_DAYS different days within the last
WINDOW_DAYS days. Each find becomes a ready rule suggestion in the app's own
terms (Sender grouping, `from:<address>`, the action, "if older than N
days", a schedule) plus the evidence it is based on and what it would catch
now. Nothing is created until the user says "Make it a rule" (an ordinary
rule through the ordinary create path: report mode first).

Counted: the user's own steps (actor "user") that ended ok, were not undone
(an undo / Time machine entry names the step's id), and did not move mail
out of Junk / Trash. Left out of the result: protected senders, senders a
rule of this account already covers, senders the user hid ("Not this one",
habitstore.py). One suggestion per sender: the habit with the most steps.
"""

from __future__ import annotations

import hashlib
import statistics
import time
from datetime import datetime, timezone

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import habitlog
from . import habitstore
from . import keepsafe
from . import mailops
from . import pinstore
from . import rules as rulesmod

WINDOW_DAYS = 60          # how far back the audit log is read
MIN_TIMES = 3             # the same step this often ...
MIN_DAYS = MIN_TIMES      # ... on this many different days (never fewer)
AGE_STEPS = (1, 3, 7, 14, 30)   # "if older than N days": N rounds down to one
DAILY_BELOW_DAYS = 5      # median gap between the steps below this: daily
STEPS_SHOWN = 12          # steps listed as evidence (the newest ones)
SUGGESTIONS_MAX = 20

DAY_S = 86400


def round_age(days: int) -> int:
    """The largest of AGE_STEPS that is <= `days` (1 for anything younger:
    a rule never touches today's mail on the strength of a habit)."""
    return max([s for s in AGE_STEPS if s <= days], default=AGE_STEPS[0])


def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def _undone_ids(entries: list[dict]) -> set[str]:
    """Ids of the steps an undo / Time machine restore put (back) in place."""
    out: set[str] = set()
    for e in entries:
        for u in [e.get("undoes"), *(e.get("undoes_many") or [])]:
            if isinstance(u, dict) and u.get("id") and int(
                    u.get("count") or 0) > 0:
                out.add(u["id"])
    return out


def _steps(entries: list[dict], now: float) -> dict[tuple, list[dict]]:
    """{(sender key, action, destination): [step, ...]} of the counted steps
    in the window, oldest first. A step = {id, ts, n, unread, youngest_days,
    label} (`label`: the step's own label when it covered one sender - what
    names the sender once none of its mail is left to read a name from)."""
    cutoff = now - WINDOW_DAYS * DAY_S
    undone = _undone_ids(entries)
    out: dict[tuple, list[dict]] = {}
    for e in entries:
        keys = e.get("keys")
        if (e.get("actor") != "user" or e.get("outcome") != "ok"
                or e.get("action") not in habitlog.HABIT_ACTIONS
                or e.get("from_role") or not isinstance(keys, list)
                or not keys or e["ts"] < cutoff
                or (e.get("id") and e["id"] in undone)):
            continue
        per = e.get("per") if isinstance(e.get("per"), dict) else {}
        dest = str(e.get("dest") or "") if e["action"] == "move" else ""
        if e["action"] == "move" and not dest:
            continue                      # a move without a known target
        for key in keys:
            if not isinstance(key, str) or not key:
                continue
            f = per.get(key) if isinstance(per.get(key), dict) else None
            n = int(f["n"] if f else e.get("count") or 0)
            if n <= 0:
                continue
            young = f.get("youngest_days") if f else e.get("youngest_days")
            out.setdefault((key, e["action"], dest), []).append({
                "id": e.get("id") or "", "ts": int(e["ts"]), "n": n,
                "label": str(e.get("label") or "") if len(keys) == 1 else "",
                "unread": int(f.get("unread", 0) if f
                              else e.get("unread") or 0),
                "youngest_days": young if isinstance(young, int) else None})
    for steps in out.values():
        steps.sort(key=lambda s: s["ts"])
    return out


def _gaps(steps: list[dict]) -> list[int]:
    """Whole days between the days the steps were done on (never 0: several
    steps on one day are one day), oldest first."""
    days = sorted({int(s["ts"] // DAY_S) for s in steps})
    return [b - a for a, b in zip(days, days[1:])]


def _schedule(steps: list[dict]) -> str:
    """"daily" when the median gap between the steps is under
    DAILY_BELOW_DAYS days, else "weekly"."""
    gaps = [(b["ts"] - a["ts"]) / DAY_S for a, b in zip(steps, steps[1:])]
    return "daily" if gaps and statistics.median(gaps) < DAILY_BELOW_DAYS \
        else "weekly"


def mine(entries: list[dict], now: float | None = None) -> list[dict]:
    """The habits in these audit entries (one account's, oldest first): one
    candidate per sender, newest habit first. Pure - no protected / rule /
    hidden filtering (see `suggestions`)."""
    now = now if now is not None else time.time()
    best: dict[str, tuple[tuple, dict]] = {}
    for (key, action, dest), steps in _steps(entries, now).items():
        days = {_day(s["ts"]) for s in steps}
        if len(steps) < MIN_TIMES or len(days) < MIN_DAYS:
            continue
        young = [s["youngest_days"] for s in steps
                 if s["youngest_days"] is not None]
        older = round_age(min(young)) if young and action in (
            "trash", "archive") else None
        gaps = _gaps(steps)
        cand = {
            "id": hashlib.sha1(
                f"{key}|{action}|{dest}".encode()).hexdigest()[:12],
            "key": key, "action": action, "dest": dest,
            "times": len(steps), "days": len(days),
            "since": steps[0]["ts"], "last": steps[-1]["ts"],
            "steps": [{k: v for k, v in s.items() if k != "label"}
                      for s in steps[-STEPS_SHOWN:]],
            "label_hint": next((s["label"] for s in reversed(steps)
                                if s["label"]), ""),
            # the evidence line: "every 3-5 days · 41 mails · all unread"
            "mails": sum(s["n"] for s in steps),
            "gap_min": min(gaps), "gap_max": max(gaps),
            "min_n": min(s["n"] for s in steps),
            "max_n": max(s["n"] for s in steps),
            "always_unread": all(s["unread"] >= s["n"] for s in steps),
            "older_than_days": older, "schedule": _schedule(steps)}
        rank = (len(steps), steps[-1]["ts"])
        if key not in best or rank > best[key][0]:
            best[key] = (rank, cand)
    return sorted((c for _, c in best.values()),
                  key=lambda c: (-c["last"], c["key"]))


def _stand_in(key: str) -> dict:
    """What a rule's filter sees of a sender that has no mail left in the scan
    (everything was trashed, which is exactly what makes it a habit): its key
    and nothing else. A rule that names the sender (`from:`, `domain:`, a plain
    word of its address) still matches it; a filter that needs anything the
    mails would say (tags, age, unread) does not."""
    return {"key": key, "label": "", "sub": key, "tags": [], "count": 0,
            "unread": 0, "size": 0, "ai": None, "protected": False,
            "unsub": False, "replied": False, "pinned": 0}


def _covered(acc, keys: list[str]) -> set[str]:
    """The keys an existing rule of this account already matches (a rule of
    any mode and action, on the sender or its domain - a Block rule too), also
    when the sender has no mail left to look at."""
    mine_ = [r for r in rulesmod.load_rules()
             if r.get("scope", "mail") == "mail"
             and (r.get("account") or accounts.default_name()) == acc.name
             and r.get("grouping") in ("sender", "domain")]
    if not mine_ or not keys:
        return set()
    groups = mailops.public_state(acc)["groups"]
    out: set[str] = set()
    for r in mine_:
        f = rulesmod.parse_filter(r.get("query", ""))
        pool = groups.get(r["grouping"]) or {}
        for key in keys:
            gkey = key if r["grouping"] == "sender" else key.rsplit(
                "@", 1)[-1]
            g = pool.get(gkey) or _stand_in(gkey)
            if rulesmod.match_group(g, f):
                out.add(key)
    return out


def _catch(acc, cand: dict, pinned: set[str], enabled: list[str]
           ) -> int | None:
    """How many mails the suggested rule would act on in this scan - what its
    report run will say (retention, pinned and keep-safe mails left out)."""
    with acc.lock:
        if acc.state["status"] != "done":
            return None
        rec = (acc.state["groups"].get("sender") or {}).get(cand["key"])
        if rec is None:
            return 0
        older = cand["older_than_days"]
        skip = pinned if cand["action"] != "mark_read" else set()
        n = mailops.group_act_count(rec, acc, None, older, skip)
        if cand["action"] == "trash" and enabled:
            kept, _ = keepsafe.rule_kept(rec, acc, None, older, skip, enabled)
            n -= sum(kept.values())
        return max(0, n)


def rule_body(cand: dict) -> dict:
    """The ordinary rule a suggestion stands for (the client adds its name)."""
    return {"grouping": "sender", "query": f"from:{cand['key']}",
            "action": cand["action"], "dest": cand["dest"],
            "schedule": cand["schedule"],
            "older_than_days": cand["older_than_days"]}


def suggestions(acc=None) -> dict:
    """{enabled, suggestions, hidden} of one account for the API. Disabled in
    Settings: nothing is mined at all."""
    acc = acc or accounts.get()
    cfg = cfgmod.load_config()
    hidden = habitstore.hidden(acc.name)
    if not cfgmod.habits_of(cfg)["suggest"]:
        return {"enabled": False, "suggestions": [], "hidden": len(hidden)}
    now = time.time()
    cands = mine(auditlog.since(acc.name, now - WINDOW_DAYS * DAY_S), now)
    plist = cfgmod.normalize_protected(cfg.get("protected"))
    cands = [c for c in cands if c["key"] not in hidden
             and not cfgmod.is_protected(c["key"], plist)]
    covered = _covered(acc, [c["key"] for c in cands])
    cands = [c for c in cands if c["key"] not in covered][:SUGGESTIONS_MAX]
    pinned = pinstore.load_account(acc.name)
    enabled = keepsafe.enabled_classes() if keepsafe.settings().get(
        "rules") else []
    with acc.lock:
        sender = acc.state["groups"].get("sender") or {}
        labels = {c["key"]: (sender.get(c["key"]) or {}).get("label")
                  or c["label_hint"] or c["key"] for c in cands}
    out = []
    for c in cands:
        out.append({**{k: v for k, v in c.items() if k != "label_hint"},
                    "label": labels[c["key"]],
                    "dest_name": mailops.decode_mutf7(c["dest"]),
                    "catch": _catch(acc, c, pinned, enabled),
                    "rule": rule_body(c)})
    return {"enabled": True, "suggestions": out, "hidden": len(hidden)}
