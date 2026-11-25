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

Three more reads follow the Overview - the lists across accounts (Senders,
All mail, Search; see `senders`, `mails`, `search` below). They only read what
the accounts hold in memory, one account at a time, and tag every row with the
account it belongs to; an action on such a row is the UI's job, one ordinary
per-account call per account.

Two parts of the Overview:
- `accounts`: per mailbox its size, mails, senders, how many mails arrived
  since a given moment (the visit the UI remembers per account), when it was
  last scanned and whether the last scan failed;
- `same_sender`: the senders (newsletters, shops) that write to more than one
  of the accounts - matched by exact sender address, then by the company
  domain (smartkinds.company_id: never freemail, never a shared platform
  host). One row per sender with a count per account; a sender with fewer
  than SAME_SENDER_MIN_MAILS mails in total is no pattern worth a row.
"""

from __future__ import annotations

import heapq
import logging
import time

from . import accounts as accountsmod
from . import config as cfgmod
from . import mailops
from . import smartkinds
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
            # what the lists across accounts follow: a finished scan or a
            # move that patched the index moves `rev`; `busy` = a move /
            # unsubscribe job is still running there
            "rev": acc.state["groups_rev"],
            "busy": (acc.state["delete"]["status"] == "running"
                     or acc.state["unsub"]["status"] == "running"),
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
    its exact address. A match needs at least two ACCOUNTS and
    SAME_SENDER_MIN_MAILS mails in total."""
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


# ------------------------------------------------- the lists across accounts

# How a sender's AI verdict is summed up when its accounts disagree: the most
# cautious one wins (a "keep" anywhere keeps the row off the "safe to delete"
# list).
_VERDICT_CAUTION = {"keep": 0, "review": 1, "delete_safe": 2}
# Unsubscribe status of a row across its accounts, worst first.
_UNSUB_WORST = ("failed", "link", "pending", "done")
# Fields only a single account's Sender record has a meaning for: a Smart
# placement, the grade (graded per account from that account's own figures).
_PER_ACCOUNT_ONLY = ("grade", "kind", "n_senders", "members", "smart_key",
                     "smart_why", "purposes", "addr", "domain", "category")


def _merge_unsub(recs: list[dict]) -> dict | None:
    """The unsubscribe state of one sender over its accounts. `of` counts the
    accounts whose mails carry an unsubscribe link, `n` those where it is
    done; the worst outstanding status wins, like a domain row's."""
    capable = [r for r in recs if r.get("unsub")]
    states = [r["unsubscribed"] for r in capable if r.get("unsubscribed")]
    if not states:
        return None
    done = sum(1 for u in states if u["status"] == "done")
    status = next((w for w in _UNSUB_WORST
                   if any(u["status"] == w for u in states)), "pending")
    if status == "done" and done < len(capable):
        status = "pending"
    pick = next((u for u in states if u["status"] == status), states[0])
    return {"n": done, "of": len(capable), "status": status,
            "link": pick.get("link", ""), "addr": pick.get("addr", "")}


def _merge_trackers(recs: list[dict]) -> dict | None:
    got = [r["trackers"] for r in recs if r.get("trackers")]
    if not got:
        return None
    hosts: list[str] = []
    for t in got:
        hosts += [h for h in t.get("hosts", []) if h not in hosts]
    out = {"checked": sum(t["checked"] for t in got),
           "pixel": sum(t["pixel"] for t in got),
           "click": sum(t["click"] for t in got), "hosts": hosts[:5]}
    if all("any" in t for t in got):
        out["any"] = sum(t["any"] for t in got)
    return out


def merge_sender(parts: list[tuple[str, dict]]) -> dict:
    """One row from the same sender address in several accounts: the biggest
    account's record with the counts summed and flags combined, plus
    `accounts` - one small part per account (what the chips, the detail pane
    and the per-account steps read). `parts` = [(account, public record)]."""
    parts = sorted(parts, key=lambda p: -p[1]["count"])
    recs = [r for _, r in parts]
    row = {k: v for k, v in recs[0].items() if k not in _PER_ACCOUNT_ONLY}
    total = sum(r["count"] for r in recs)
    row["count"] = total
    for k in ("size", "unread", "att_size", "pinned"):
        row[k] = sum(r.get(k, 0) for r in recs)
    row["first"] = min((r["first"] for r in recs if r["first"]), default="")
    row["last"] = max((r["last"] for r in recs if r["last"]), default="")
    row["tags"] = list(dict.fromkeys(t for r in recs for t in r["tags"]))
    row["samples"] = list(dict.fromkeys(
        s for r in recs for s in r["samples"]))[:mailops.MAX_SAMPLES]
    for k in ("bulk", "unsub", "protected", "replied", "new"):
        row[k] = any(r.get(k) for r in recs)
    row["new_ts"] = max((r.get("new_ts") or 0 for r in recs), default=0)
    ai = [r["ai"] for r in recs if r.get("ai")]
    row["ai"] = dict(min(ai, key=lambda a: _VERDICT_CAUTION.get(
        a["verdict"], 1))) if ai else None
    rated = [r["ratings"] for r in recs if r.get("ratings")]
    row["ratings"] = {k: sum(r[k] for r in rated)
                      for k in ("delete_safe", "review", "keep")} \
        if rated else None
    row["unsubscribed"] = _merge_unsub(recs)
    still = [r["still_mailing"] for r in recs if r.get("still_mailing")]
    row["still_mailing"] = max(still, key=lambda s: s["n"]) if still else None
    row["engagement"] = round(
        sum(r.get("engagement", 0) * r["count"] for r in recs) / total) \
        if total else 0
    tr = _merge_trackers(recs)
    if tr:
        row["trackers"] = tr
    else:
        row.pop("trackers", None)
    row["accounts"] = [{
        "account": a, "count": r["count"], "size": r["size"],
        "unread": r["unread"], "pinned": r.get("pinned", 0),
        "first": r["first"], "last": r["last"],
        "protected": bool(r.get("protected")),
        "unsub": bool(r.get("unsub")),
        "unsubscribed": (r.get("unsubscribed") or {}).get("status"),
        "grade": (r.get("grade") or {}).get("letter"),
        "verdict": (r.get("ai") or {}).get("verdict"),
        "still": (r.get("still_mailing") or {}).get("n", 0)}
        for a, r in parts]
    return row


def senders() -> dict:
    """The Sender rows of every account of the workspace in ONE list: the
    same address in several accounts is one row (counts summed, one part per
    account). Read from each account's loaded state, one after the other; an
    account that was never scanned just has no rows. `accounts` carries what
    the UI follows to know when to read again (`rev`, `status`)."""
    per: dict[str, list[tuple[str, dict]]] = {}
    meta = []
    for name in accountsmod.names():
        acc = accountsmod.get(name)
        state = mailops.public_state(acc, only=("sender",))
        meta.append({"name": name, "rev": state["groups_rev"],
                     "status": state["status"],
                     "scanned_ts": state["scanned_ts"]})
        for key, rec in (state["groups"].get("sender") or {}).items():
            per.setdefault(key, []).append((name, rec))
    rows = [merge_sender(parts) for parts in per.values()]
    rows.sort(key=lambda r: (-r["count"], r["key"]))
    return {"accounts": meta, "senders": rows}


def mails(offset: int, limit: int, sort: str, direction: str | None,
          q: str, slot: dict | None = None, only: str | None = None) -> dict:
    """One page of the flat mail list over every account: each account's
    filtered, sorted mails are merged by the same sort, so the page is exactly
    what one account's list would show for the union. Rows carry `account`.
    `only`: just that account (a name that is not one of the workspace's
    raises KeyError). No mail server is contacted."""
    sort, direction = mailops.mail_sort_args(sort, direction)
    offset, limit = max(0, offset), max(1, min(limit, 1000))
    f = mailops.parse_mail_query(q)
    keyfn = mailops.MAIL_SORT_KEYS[sort]
    lists, accs = [], {}
    if only is not None:
        accountsmod.get(only)               # KeyError for a stranger's name
    for name in accountsmod.names():
        if only is not None and name != only:
            continue
        acc = accountsmod.get(name)
        accs[name] = acc
        lists.append([(name, m) for m in
                      mailops.mail_hits(f, acc, sort, direction, slot)])
    total = sum(len(lst) for lst in lists)
    merged = heapq.merge(*lists, key=lambda p: keyfn(p[1]),
                         reverse=direction == "desc")
    page = [p for _, p in zip(range(offset + limit), merged)][offset:]
    row_of: dict[tuple, dict] = {}
    for name, acc in accs.items():
        mine = [m for n, m in page if n == name]
        for m, row in zip(mine, mailops.mail_rows(acc, mine)):
            row_of[(name, m["folder"], m["uid"])] = {**row, "account": name}
    return {"total": total, "offset": offset,
            "mails": [row_of[(n, m["folder"], m["uid"])] for n, m in page],
            "ignored": f["ignored"]}


def search(query: str, body: bool = False, limit: int = 500) -> dict:
    """Search over every account: the newest `limit` matches with their
    account, and the notes of each search tagged with the account they came
    from. Mail-text search follows each account's own setting (off there =
    only the metadata hits and a note); one account failing is a note, not a
    failure of the others."""
    names = accountsmod.names()
    found: list[dict] = []
    notes: list[dict] = []
    for name in names:
        acc = accountsmod.get(name)
        try:
            mode = cfgmod.account_imap(name).get("body_search")
            if body and mode == "disabled":
                notes.append({"key": "body_off", "params": {},
                              "account": name})
                res = {"mails": mailops.search_mails(query, limit, acc=acc),
                       "notes": []}
            elif body and mode == "local":
                res = mailops.search_local(query, limit, acc=acc)
            elif body:
                res = mailops.search_body(
                    query, limit, acc=acc,
                    budget=mailops.BODY_SEARCH_BUDGET_S / len(names))
            else:
                res = {"mails": mailops.search_mails(query, limit, acc=acc),
                       "notes": []}
        except Exception:
            log.exception("search failed in account %s", name)
            notes.append({"key": "account_failed", "params": {},
                          "account": name})
            continue
        found += [{**m, "account": name} for m in res["mails"]]
        notes += [{**n, "account": name} for n in res["notes"]]
    found.sort(key=lambda m: -m["ts"])
    return {"mails": found[:limit], "notes": notes}
