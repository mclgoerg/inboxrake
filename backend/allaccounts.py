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

from . import accountcopy
from . import accounts as accountsmod
from . import config as cfgmod
from . import copystore
from . import mailops
from . import pinstore
from . import rules as rulesmod
from . import smartkinds
from . import unsub
from . import unsubstore

log = logging.getLogger("inboxrake.allaccounts")

# All mail's `finding` for "Just show them": `copies:<account>` lists the mails
# that have an exact copy in that account.
COPIES_VIEW = "copies:"

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


# How many of an account's newest Undo steps `undo_jobs` names.
UNDO_JOBS_MAX = 30


def _undo_jobs(state: dict) -> dict[str, dict]:
    """The account's newest Undo steps by the id of the queued job that made
    them (`{job: {id, ts, label, count, action}}`): "Undo all N" asks for the
    step of ITS OWN job, so a move made elsewhere in the account meanwhile is
    never undone in its place."""
    out: dict[str, dict] = {}
    for u in state["undo"][-UNDO_JOBS_MAX:]:
        if u.get("job") and not u.get("quiet"):
            out[u["job"]] = {"id": u.get("id"), "ts": u["ts"],
                             "label": u["label"], "count": u["count"],
                             "action": u.get("action", "")}
    return out


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
            # its newest Undo steps by job: "Undo all N" finds its own
            "undo_jobs": _undo_jobs(acc.state),
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


# ------------------------------------------------ the same mails in several

# Exact copies are looked for by the pair (Message-ID, size) and by nothing
# else. The finder is built to LEAVE OUT whatever it is not sure about - the
# only thing that ever follows from it is a move to Trash (reversible, with
# Undo) of the copies in ONE account, never of the account that keeps them:
#  - a mail without a Message-ID is never matched;
#  - a Message-ID that is in an account more than once (the same mail in
#    Inbox and Archive, or two sizes) is left to that account's Duplicates;
#  - a Message-ID that "Move to another account" copied (copystore.py, kept
#    for good) is never a copy to remove;
#  - a pinned mail and a mail of a protected sender is taken out of the
#    account it would be trashed in.


def _snapshot(name: str) -> tuple[dict[tuple[str, int], dict], set[str]]:
    """One account's mails by (Message-ID, size): only keys that occur ONCE in
    the account, plus the Message-IDs that occur more than once there."""
    acc = accountsmod.get(name)
    seen: dict[str, int] = {}
    by_key: dict[tuple[str, int], dict] = {}
    with acc.lock:
        for m in acc.index.values():
            mid = m.get("msgid")
            if not mid:
                continue
            seen[mid] = seen.get(mid, 0) + 1
            by_key[(mid, m["size"])] = {
                "folder": m["folder"], "uid": m["uid"], "addr": m["addr"],
                "ts": m["ts"], "size": m["size"], "msgid": mid}
    repeated = {mid for mid, n in seen.items() if n > 1}
    return ({k: v for k, v in by_key.items() if k[0] not in repeated},
            repeated)


def _pairs(names: list[str]) -> tuple[dict, dict]:
    """(snapshots, protection info) of the accounts, read once."""
    accountcopy.fold_last_job()
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    snaps: dict[str, dict] = {}
    for n in names:
        snap, _repeated = _snapshot(n)
        snaps[n] = snap
    info = {"plist": plist,
            "copied": {n: copystore.load_account(n) for n in names},
            "pinned": {n: pinstore.load_account(n) for n in names}}
    return snaps, info


def _shared(a: str, b: str, snaps: dict, info: dict) -> tuple[list, int]:
    """The (Message-ID, size) keys that are in both accounts and were not made
    by "Move to another account", and how many that record left out."""
    keys = snaps[a].keys() & snaps[b].keys()
    made = info["copied"][a] | info["copied"][b]
    left_out = sum(1 for k in keys if k[0] in made)
    return sorted(k for k in keys if k[0] not in made), left_out


def _movable(name: str, keys: list, snaps: dict, info: dict) -> list[dict]:
    """The mails of `name` among `keys` that may be trashed there: not pinned
    in it, not from a protected sender."""
    out = []
    for k in keys:
        m = snaps[name][k]
        if k[0] in info["pinned"][name] \
                or cfgmod.is_protected(m["addr"], info["plist"]):
            continue
        out.append(m)
    return out


def copies() -> dict:
    """The exact copies across the accounts of the workspace, per pair:
    `{pairs: [{a, b, mails, size, first, last, in_a: {trash, size, held},
    in_b: {...}}], left_out}`. `trash` = what a move of THAT account's copies
    to Trash would take (pinned and protected taken out), `held` = how many
    that left out; `left_out` = the copies "Move to another account" made.
    Read-only, one account at a time under its own lock, no mail server."""
    names = accountsmod.names()
    snaps, info = _pairs(names)
    out, made_total = [], 0
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            keys, made = _shared(a, b, snaps, info)
            made_total += made
            if not keys:
                continue
            row = {"a": a, "b": b, "mails": len(keys),
                   "size": sum(k[1] for k in keys),
                   "first": min((snaps[a][k]["ts"] for k in keys
                                 if snaps[a][k]["ts"]), default=0),
                   "last": max((snaps[a][k]["ts"] for k in keys), default=0)}
            for side, n in (("in_a", a), ("in_b", b)):
                free = _movable(n, keys, snaps, info)
                row[side] = {"trash": len(free),
                             "size": sum(m["size"] for m in free),
                             "held": len(keys) - len(free)}
            out.append(row)
    out.sort(key=lambda r: (-r["mails"], r["a"], r["b"]))
    return {"pairs": out, "left_out": made_total}


def copy_handles(name: str, other: str) -> frozenset[tuple[str, int]]:
    """The (folder, uid) of the mails of `name` that have an exact copy in
    `other` (the same list "Review" counts, pinned ones included): what All
    mail shows for "Just show them". A name that is not one of the
    workspace's raises KeyError."""
    accountsmod.get(name)
    accountsmod.get(other)
    if name == other:
        return frozenset()
    snaps, info = _pairs([name, other])
    keys, _made = _shared(name, other, snaps, info)
    return frozenset((snaps[name][k]["folder"], snaps[name][k]["uid"])
                     for k in keys)


def trash_copies(keep: str, drop: str) -> dict:
    """Move the copies in `drop` that are exact copies of mails in `keep` to
    Trash - ONE step in `drop` with its own Undo (the ordinary move job). The
    answer is worked out again HERE, from the two accounts as they are now:
    nothing the caller saw is trusted. The account that keeps them is never
    touched. Raises KeyError for an account that is not the workspace's,
    ValueError(COPIES_NONE) when nothing is left, RuntimeError when a scan
    is not finished in either account."""
    if keep == drop:
        raise ValueError("same account")
    kacc, dacc = accountsmod.get(keep), accountsmod.get(drop)
    for acc in (kacc, dacc):
        with acc.lock:
            if acc.state["status"] != "done":
                raise RuntimeError("No completed scan")
    snaps, info = _pairs([keep, drop])
    keys, _made = _shared(keep, drop, snaps, info)
    free = _movable(drop, keys, snaps, info)
    if not free:
        raise ValueError(mailops.COPIES_NONE)
    res = mailops.delete_messages([[m["folder"], m["uid"]] for m in free],
                                  "trash", acc=dacc)
    return {**res, "keep": keep, "drop": drop, "held": len(keys) - len(free)}


# ------------------------------------------------- Search across accounts

SEARCH_SENDERS_MAX = 8


def search(query: str, body: bool = False, limit: int = 500) -> dict:
    """Search over every account: the newest `limit` hits with their account
    (and whether the mail is pinned / from a protected sender, so a selection
    can leave those out before anything runs), the senders that match, and the
    notes of each search tagged with their account. Mail-text search follows
    each account's own setting (off there = the metadata hits and a note); one
    account failing is a note, not a failure of the others."""
    names = accountsmod.names()
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    terms = [t for t in query.lower().split() if t]
    found: list[dict] = []
    notes: list[dict] = []
    senders: list[dict] = []
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
            # (no account name in the log: this block also reads the
            # account's settings, and a log line must never be near them)
            log.exception("search failed in one account")
            notes.append({"key": "account_failed", "params": {},
                          "account": name})
            continue
        pins = pinstore.load_account(name)
        with acc.lock:
            for m in res["mails"]:
                idx = acc.index.get(mailops.ikey(m["folder"], m["uid"]))
                found.append({**m, "account": name,
                              "pinned": bool(idx and idx["msgid"] in pins),
                              "protected": cfgmod.is_protected(
                                  m["addr"], plist)})
            if terms:
                for key, rec in (acc.state["groups"].get("sender")
                                 or {}).items():
                    label = (rec.get("label") or "").lower()
                    if all(t in key or t in label for t in terms):
                        senders.append({"account": name, "key": key,
                                        "label": rec.get("label") or key,
                                        "count": rec["count"],
                                        "size": rec["size"]})
        notes += [{**n, "account": name} for n in res["notes"]]
    found.sort(key=lambda m: -m["ts"])
    senders.sort(key=lambda s: (-s["count"], s["account"], s["key"]))
    return {"mails": found[:limit], "notes": notes,
            "senders": senders[:SEARCH_SENDERS_MAX]}
