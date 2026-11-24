"""The "All accounts" Overview: one read-only look across every mailbox of the
signed-in user's workspace.

Nothing here talks to a mail server or acts on a mailbox. It only reads what
each account already holds in memory (its last scan: sender groups, index,
counts) and the small per-account stores, one account after the other, each
under its own lock - the accounts are never merged into one state. Acting
stays per account: the UI runs one step per account through the ordinary
per-account endpoints (`?account=`).

Only the CURRENT TENANT's accounts exist here: `accounts.names()` /
`accounts.get()` are tenant-scoped, so another user's mailboxes can never
appear in the answer.

Two parts:
- `accounts`: per mailbox its size, mails, senders, how many mails arrived
  since a given moment (the visit the UI remembers per account), when it was
  last scanned and whether the last scan failed;
- `same_sender`: the senders (newsletters, shops) that write to more than one
  of the accounts - matched by exact sender address, then by the company
  domain (smartkinds.company_id: never freemail, never a shared platform
  host). One row per sender with a count per account.
"""

from __future__ import annotations

import time

from . import accounts as accountsmod
from . import config as cfgmod
from . import smartkinds
from . import unsubstore

# Rows of "Same sender, several accounts" the answer carries (the UI shows the
# first few and "All N").
SAME_SENDER_MAX = 200
# "+N new" without a remembered visit counts the last week.
NEW_WINDOW_S = 7 * 86400


def _new_since(acc, since: float) -> int:
    """Mails of one account dated at or after `since` (lock held)."""
    return sum(1 for m in acc.index.values() if m["ts"] and m["ts"] >= since)


def _account_row(name: str, im: dict, since: float | None,
                 now: float) -> tuple[dict, list[dict]]:
    """One account's card and its sender candidates for the join."""
    acc = accountsmod.get(name)
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    entries = unsubstore.load_account(name)
    cands: list[dict] = []
    with acc.lock:
        senders = acc.state["groups"].get("sender") or {}
        status = acc.state["status"]
        row = {
            "name": name, "user": im.get("user", ""),
            "status": status,
            "progress": acc.state["progress"] if status == "scanning" else "",
            # the last good scan: while one runs or after a failed one
            # `scanned_ts` is cleared, the previous one is kept aside
            "scanned_ts": acc.state["scanned_ts"] or acc.prev_scan_ts,
            "failed": status == "error",
            "mails": sum(r["count"] for r in senders.values()),
            "size": sum(r["size"] for r in senders.values()),
            "senders": len(senders),
            "junk": acc.state.get("junk_count"),
            "trash": acc.state.get("trash_count"),
            "new": _new_since(acc, since if since is not None
                              else now - NEW_WINDOW_S),
            "new_basis": "visit" if since is not None else "week",
        }
        for addr, rec in senders.items():
            if not (rec.get("bulk") or rec.get("unsub")):
                continue            # newsletters / shops only
            if rec.get("replied") or cfgmod.is_protected(addr, plist):
                continue            # people you wrote to, protected senders
            cands.append({
                "account": name, "addr": addr, "name": rec["label"],
                "count": rec["count"], "size": rec["size"],
                "unread": rec["unread"], "unsub": bool(rec.get("unsub")),
                "state": (entries.get(addr) or {}).get("status")})
    return row, cands


def _primary(entries: list[dict]) -> dict:
    """The one address of an account that stands for the match: the biggest
    one that can still be unsubscribed from, else the biggest."""
    open_ = [e for e in entries if e["unsub"] and e["state"] != "done"]
    return max(open_ or entries, key=lambda e: (e["count"], e["addr"]))


def same_sender(cands: list[dict]) -> list[dict]:
    """The join over every account's candidates. A sender whose domain names
    a company (smartkinds.company_id) is matched by it - the same address in
    two accounts included; one on a freemail / shared-platform domain only by
    its exact address. A match needs at least two ACCOUNTS."""
    by_key: dict[str, dict[str, list[dict]]] = {}
    for c in cands:
        domain = c["addr"].rsplit("@", 1)[-1]
        key = smartkinds.company_id(domain) or c["addr"]
        by_key.setdefault(key, {}).setdefault(c["account"], []).append(c)
    rows = []
    for key, per in by_key.items():
        if len(per) < 2:
            continue
        chosen = [_primary(es) for es in per.values()]
        total = sum(e["count"] for e in chosen)
        unread = sum(e["unread"] for e in chosen)
        biggest = max(chosen, key=lambda e: (e["count"], e["addr"]))
        rows.append({
            "key": key, "name": biggest["name"],
            "match": "address" if len({e["addr"] for e in chosen}) == 1
            else "domain",
            "accounts": [{"account": e["account"], "addr": e["addr"],
                          "mails": e["count"], "size": e["size"],
                          "unsub": e["unsub"], "state": e["state"]}
                         for e in sorted(chosen, key=lambda e: -e["count"])],
            "mails": total, "size": sum(e["size"] for e in chosen),
            # the share of these mails the user opened
            "opened": round(100 * (total - unread) / total) if total else 0})
    rows.sort(key=lambda r: (-r["mails"], r["key"]))
    return rows[:SAME_SENDER_MAX]


def build(since: dict[str, float] | None = None,
          now: float | None = None) -> dict:
    """The answer for the current tenant. `since`: per account name, the
    epoch second its "+N new" counts from (the browser's remembered visit);
    an account without one counts the last week."""
    now = now if now is not None else time.time()
    since = since or {}
    cfg = cfgmod.load_config()
    rows, cands = [], []
    for name, im in cfg["accounts"].items():
        row, found = _account_row(name, im, since.get(name), now)
        rows.append(row)
        cands += found
    return {"now": int(now), "accounts": rows,
            "totals": {"mails": sum(r["mails"] for r in rows),
                       "size": sum(r["size"] for r in rows),
                       "senders": sum(r["senders"] for r in rows)},
            "same_sender": same_sender(cands)}
