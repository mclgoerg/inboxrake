"""The "All accounts" page: one read-only look across every mailbox of the
signed-in user's workspace.

It is a PAGE, never a mode: nothing here selects an account, talks to a mail
server or acts on a mailbox. It only reads what each account already holds in
memory (its last scan: sender groups, index, counts) and the small
per-account stores, one account after the other, each under its own lock -
the accounts are never merged into one state. Acting stays per account: the
UI runs one step per account through the ordinary per-account endpoints
(`?account=`), each with its own Undo and Activity entry, and the
unsubscribe of each account runs in that account (its method, its SMTP
settings, its own unsubscribe record and "still mailing" watchdog).

Only the CURRENT TENANT's accounts exist here: `accounts.names()` /
`accounts.get()` are tenant-scoped, so another user's mailboxes can never
appear in the answer.

Two parts:
- `accounts`: per mailbox its size, mails, senders, how many mails arrived
  since a given moment (the visit the UI remembers per account), when it was
  last scanned and whether the last scan failed;
- `same_sender`: the senders (newsletters, shops) that write to more than one
  of the accounts - matched by company domain (smartkinds.company_id, which
  also covers the same address in two accounts; never freemail, never a
  shared platform host - those only by exact address). One row per sender with
  one entry per account; a sender with fewer than SAME_SENDER_MIN_MAILS mails
  in total is no pattern worth a row. Protected senders and the people you
  write to are left out; pinned mails are counted apart (they never move).
"""

from __future__ import annotations

import logging
import time

from . import accounts as accountsmod
from . import config as cfgmod
from . import mailops
from . import pinstore
from . import rules as rulesmod
from . import smartkinds
from . import unsub
from . import unsubstore

log = logging.getLogger("inboxrake.allaccounts")

# Rows of "Same sender, several accounts" the answer carries (the UI shows the
# first few and "All N").
SAME_SENDER_MAX = 200
# A sender is listed once it has at least this many mails across the accounts
# (a one-off mail in two accounts is not "the same newsletter twice").
SAME_SENDER_MIN_MAILS = 4
# "+N new" without a remembered visit counts the last week.
NEW_WINDOW_S = 7 * 86400


def _new_since(acc, since: float) -> int:
    """Mails of one account dated at or after `since` (lock held)."""
    return sum(1 for m in acc.index.values() if m["ts"] and m["ts"] >= since)


def _job_failed(state: dict) -> dict | None:
    """The move / unsubscribe job of an account that ended with an error, as
    `{id, error}` (`id` is the job's sequence number: one toast per job),
    else None. A job still running is no failure yet."""
    for kind, key in (("delete", "d"), ("unsub", "u")):
        job = state[kind]
        if job["status"] != "running" and job.get("error"):
            return {"id": f"{key}{job.get('seq', 0)}", "error": job["error"]}
    return None


def _undo_last(state: dict) -> dict | None:
    """The newest step of the account's own Undo list (what "Undo all N"
    picks up once a step it started has finished), else None."""
    for u in reversed(state["undo"]):
        if u.get("quiet"):
            continue
        return {"id": u.get("id"), "ts": u["ts"], "label": u["label"],
                "count": u["count"], "action": u.get("action", "")}
    return None


def _account_row(name: str, im: dict, since: float | None, now: float,
                 rules: list[dict]) -> tuple[dict, list[dict]]:
    """One account's card and its sender candidates for the join (protected
    ones are flagged, not dropped: the join reports them as left out)."""
    acc = accountsmod.get(name)
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    entries = unsubstore.load_account(name)
    pinned = pinstore.load_account(name)
    # the senders this account already blocks (a "Block" rule, from:<addr>)
    blocked = {r["query"] for r in rules
               if r.get("origin") == "block" and r["grouping"] == "sender"
               and (r.get("account") or accountsmod.default_name()) == name}
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
            # when the newest scan failed (None: it did not, or the server
            # restarted since) - the card's "scan failed 2 h ago"
            "failed_ts": acc.scan_failed_ts if status == "error" else None,
            "mails": sum(r["count"] for r in senders.values()),
            "size": sum(r["size"] for r in senders.values()),
            "senders": len(senders),
            "junk": acc.state.get("junk_count"),
            "trash": acc.state.get("trash_count"),
            "new": _new_since(acc, since if since is not None
                              else now - NEW_WINDOW_S),
            "new_basis": "visit" if since is not None else "week",
            # what the page follows: a finished scan or a move that patched
            # the index moves `rev`; `busy` = a move / unsubscribe job is
            # still running there
            "rev": acc.state["groups_rev"],
            "busy": (acc.state["delete"]["status"] == "running"
                     or acc.state["unsub"]["status"] == "running"),
            # a move / unsubscribe that failed after it was queued (the
            # client says so once per job, naming the account)
            "job_failed": _job_failed(acc.state),
            # the account's newest Undo step: "Undo all N" reads it
            "undo_last": _undo_last(acc.state),
        }
        for addr, rec in senders.items():
            if not (rec.get("bulk") or rec.get("unsub")):
                continue            # newsletters / shops only
            if rec.get("replied"):
                continue            # people you wrote to
            held = sum(len(u) for u in
                       mailops.pinned_uids(rec, acc, pinned).values())
            cands.append({
                "account": name, "addr": addr, "name": rec["label"],
                "count": rec["count"], "size": rec["size"],
                "unread": rec["unread"], "pinned": held,
                "unsub": bool(rec.get("unsub")),
                "state": (entries.get(addr) or {}).get("status"),
                "blocked": f"from:{addr}" in blocked,
                "protected": cfgmod.is_protected(addr, plist)})
    return row, cands


def _primary(entries: list[dict]) -> dict:
    """The one address of an account that stands for the match: the biggest
    one that can still be unsubscribed from, else the biggest."""
    open_ = [e for e in entries if e["unsub"] and e["state"] != "done"]
    return max(open_ or entries, key=lambda e: (e["count"], e["addr"]))


def _via(account: str, addr: str) -> str | None:
    """How THAT account would unsubscribe from `addr` ("one_click" /
    "mailto" / "http", else None): the method of its newest mail's
    List-Unsubscribe header - what the step will really do there."""
    try:
        acc = accountsmod.get(account)
    except KeyError:                    # removed while the page was built
        return None
    with acc.lock:
        rec = (acc.state["groups"].get("sender") or {}).get(addr)
        found = mailops.group_unsub_senders(rec, acc).get(addr) \
            if rec else None
    if not found:
        return None
    return unsub.method_of(unsub.parse_unsub(*found))


def same_sender(cands: list[dict]) -> list[dict]:
    """The join over every account's candidates. A sender whose domain names
    a company (smartkinds.company_id) is matched by it - the same address in
    two accounts included; one on a freemail / shared-platform domain only by
    its exact address. A match needs at least two ACCOUNTS (protected senders
    do not count: they are left out, and named in `left_out`) and
    SAME_SENDER_MIN_MAILS mails in total."""
    by_key: dict[str, dict[str, list[dict]]] = {}
    held: dict[str, list[dict]] = {}
    for c in cands:
        domain = c["addr"].rsplit("@", 1)[-1]
        key = smartkinds.company_id(domain) or c["addr"]
        if c["protected"]:
            held.setdefault(key, []).append(c)
            continue
        by_key.setdefault(key, {}).setdefault(c["account"], []).append(c)
    rows = []
    for key, per in by_key.items():
        if len(per) < 2:
            continue
        chosen = [_primary(es) for es in per.values()]
        total = sum(e["count"] for e in chosen)
        if total < SAME_SENDER_MIN_MAILS:
            continue
        unread = sum(e["unread"] for e in chosen)
        biggest = max(chosen, key=lambda e: (e["count"], e["addr"]))
        rows.append({
            "key": key, "name": biggest["name"],
            "match": "address" if len({e["addr"] for e in chosen}) == 1
            else "domain",
            "accounts": [{"account": e["account"], "addr": e["addr"],
                          "mails": e["count"], "size": e["size"],
                          "pinned": e["pinned"], "blocked": e["blocked"],
                          "unsub": e["unsub"], "state": e["state"]}
                         for e in sorted(chosen, key=lambda e: -e["count"])],
            # protected there: never part of a step (named so the confirm can
            # say why)
            "left_out": [{"account": p["account"], "addr": p["addr"],
                          "why": "protected"} for p in held.get(key, [])],
            "mails": total, "size": sum(e["size"] for e in chosen),
            # the share of these mails the user opened
            "opened": round(100 * (total - unread) / total) if total else 0})
    rows.sort(key=lambda r: (-r["mails"], r["key"]))
    rows = rows[:SAME_SENDER_MAX]
    for row in rows:
        for a in row["accounts"]:
            a["via"] = _via(a["account"], a["addr"]) if a["unsub"] else None
    return rows


def build(since: dict[str, float] | None = None,
          now: float | None = None) -> dict:
    """The answer for the current tenant. `since`: per account name, the
    epoch second its "+N new" counts from (the browser's remembered visit);
    an account without one counts the last week."""
    now = now if now is not None else time.time()
    since = since or {}
    cfg = cfgmod.load_config()
    rules = rulesmod.load_rules()
    rows, cands = [], []
    for name, im in cfg["accounts"].items():
        row, found = _account_row(name, im, since.get(name), now, rules)
        rows.append(row)
        cands += found
    return {"now": int(now), "accounts": rows,
            "totals": {"mails": sum(r["mails"] for r in rows),
                       "size": sum(r["size"] for r in rows),
                       "senders": sum(r["senders"] for r in rows)},
            "same_sender": same_sender(cands)}
