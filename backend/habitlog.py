"""What a manual mail action leaves in the audit log for the habit miner
(backend/habits.py): which sender groups it covered and how old and how
unread the mails were. Pure functions over index entries - no I/O, no
mailops import (mailops uses this, not the other way round).

Only the user's own actions are described (a rule run or an assistant is
not a habit), and only the actions a rule can repeat: trash, archive, move
and mark_read.
"""

from __future__ import annotations

HABIT_ACTIONS = ("trash", "archive", "move", "mark_read")
KEYS_CAP = 20            # sender keys named by one entry; more = no habit data
DAY_S = 86400


def is_manual(actor: str) -> bool:
    """True for the user's own action (not a rule run, not an assistant)."""
    return not str(actor).startswith(("rule:", "mcp:"))


def _age_days(ts: float, now: float) -> int:
    return max(0, int((now - ts) // DAY_S))


def step_facts(mails: list[tuple[str, int, bool]], action: str, dest: str,
               now: float) -> dict:
    """The additive audit fields of one manual step: `keys` (the sender
    keys it covered), `unread` and `youngest_days` (the age of the youngest
    mail with a known date) for the whole step, `per` (the same per sender,
    only when it covered several) and `dest` (a move's target folder).
    `mails` = (sender address, date ts, was already read) of every mail the
    step acted on. Empty when there is nothing to say (an action a rule
    cannot repeat, no sender, more senders than KEYS_CAP)."""
    if action not in HABIT_ACTIONS:
        return {}
    by_key: dict[str, list[tuple[int, bool]]] = {}
    for addr, ts, seen in mails:
        if addr:
            by_key.setdefault(addr, []).append((ts, seen))
    if not by_key or len(by_key) > KEYS_CAP:
        return {}

    def figures(rows: list[tuple[int, bool]]) -> dict:
        known = [ts for ts, _ in rows if ts]
        out = {"n": len(rows), "unread": sum(1 for _, s in rows if not s)}
        if known:
            out["youngest_days"] = _age_days(max(known), now)
        return out

    whole = figures([r for rows in by_key.values() for r in rows])
    out: dict = {"keys": sorted(by_key), "unread": whole["unread"]}
    if "youngest_days" in whole and action in ("trash", "archive", "move"):
        out["youngest_days"] = whole["youngest_days"]
    if len(by_key) > 1:
        out["per"] = {k: figures(rows) for k, rows in by_key.items()}
    if action == "move" and dest:
        out["dest"] = dest
    return out
