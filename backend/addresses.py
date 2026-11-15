"""Your addresses: which of your addresses did mail arrive on, and did one
leak (the page behind GET /api/addresses).

Built from the scan index only (`to` per mail, backend/addresspick.py): no
mailbox access, nothing sent anywhere. Per address: its kind (main / +tag /
alias / catch-all / other), how many mails and senders, who it was given to
(the first sender) and - for aliases and catch-all addresses - whether it
leaked: only that sender (plus senders the user marked "same company") used it
for at least LEAK_QUIET_DAYS, then at least LEAK_MIN_STRANGERS unrelated
senders started to. Senders are compared by registrable domain (one freemail
address per person).

The actions (retire / restore an alias, strangers to Junk, "not a leak") are
here too; they go through the alias-service client, the existing reversible
move pipeline and the audit log.
"""

from __future__ import annotations

import logging
import time
from collections import Counter

from . import accounts
from . import addresspick
from . import addressstore
from . import aliasservice
from . import auditlog
from . import config as cfgmod
from . import mailops
from . import pinstore
from . import rules as rulesmod
from . import smartkinds
from . import tenants

log = logging.getLogger("inboxrake.addresses")

LEAK_QUIET_DAYS = 60       # one sender (and its own) for at least this long...
LEAK_MIN_STRANGERS = 2     # ...then this many unrelated senders start writing
FOLLOWED_DAYS = 14         # "N more followed within 2 weeks"
OTHER_MIN_MAILS = 3        # an "other" address needs this many mails to be listed
MAX_ROWS = 300
MAX_STRANGER_ADDRS = 10    # sender addresses kept per stranger (what Block acts on)
DAY = 86400

# kinds whose address can leak: the ones the user hands out themselves
_LEAKABLE = (addresspick.ALIAS, addresspick.CATCHALL)


def main_address(acc, im: dict | None = None) -> str:
    """The account's own address: its login when that is an address, else the
    activity digest's recipient, else (a login like "bob" on a server that
    delivers to an address) the delivery address most of the scanned mail
    carries, else ""."""
    im = im if im is not None else cfgmod.load_config()["accounts"].get(
        acc.name, {})
    for text in (im.get("user"), (im.get("digest") or {}).get("recipient")):
        text = str(text or "").strip().lower()
        if "@" in text:
            return text
    with acc.lock:
        common = Counter(m["to"] for m in acc.index.values() if m.get("to"))
    return common.most_common(1)[0][0] if common else ""


def context(acc) -> addresspick.Context:
    """The picker's view of the account (also what the page classifies by)."""
    return addresspick.Context(main_address(acc), aliasservice.cached_aliases())


def party_of(addr: str) -> str:
    """Who a sender is, for "unrelated": the registrable domain, or the whole
    address on a freemail domain (two Gmail users are two people)."""
    domain = addr.rpartition("@")[2]
    return addr if smartkinds.is_freemail(domain) \
        else smartkinds.registrable_domain(domain)


class _Agg:
    """What one address collected during the pass over the index."""
    __slots__ = ("mails", "parties", "first", "last", "events", "info")

    def __init__(self, leakable: bool):
        self.mails = 0
        self.parties: set[str] = set()
        self.first: tuple | None = None          # (ts, addr, name, subject)
        self.last = 0
        self.events: list[tuple[int, str]] | None = [] if leakable else None
        # party -> [mails, name, Counter of sender addresses]
        self.info: dict[str, list] | None = {} if leakable else None


def _label(name: str, addr: str) -> str:
    return name.strip() or addr


def _leak(agg: _Agg, marks: set[str]) -> dict | None:
    """The leak analysis of an alias / catch-all address, None when it did
    not leak (the sender it was given to is the only one, or others were
    there from the start)."""
    if not agg.events or agg.first is None:
        return None
    events = sorted(agg.events)
    first_ts, given_addr = events[0][0], agg.first[1]
    related = {party_of(given_addr)} | marks
    # One stray mail from someone else early on (a typo, a forwarded mail)
    # does not end the quiet stretch: a single mail inside the first
    # LEAK_QUIET_DAYS from an unrelated sender is left out of the analysis.
    window_end = first_ts + LEAK_QUIET_DAYS * DAY
    info = agg.info or {}
    strays = {p for ts, p in events if p not in related
              and info.get(p, [0])[0] == 1 and ts < window_end}
    events = [e for e in events if e[1] not in strays]
    if not events:
        return None
    stranger_at = next((i for i, (_, p) in enumerate(events)
                        if p not in related), None)
    if stranger_at is None:
        return None
    t1 = events[stranger_at][0]
    quiet_days = (t1 - first_ts) // DAY
    stranger_parties = {p for _, p in events[stranger_at:]
                        if p not in related}
    if quiet_days < LEAK_QUIET_DAYS or len(stranger_parties) < LEAK_MIN_STRANGERS:
        return None
    firsts: dict[str, int] = {}
    for ts, p in events[stranger_at:]:
        if p not in related:
            firsts.setdefault(p, ts)
    first_party = events[stranger_at][1]
    strangers = []
    for p in stranger_parties:
        mails, name, addrs = info[p]
        strangers.append({
            "party": p, "name": _label(name, addrs.most_common(1)[0][0]),
            "addr": addrs.most_common(1)[0][0],
            "addrs": [a for a, _ in addrs.most_common(MAX_STRANGER_ADDRS)],
            "addr_total": len(addrs),
            "mails": mails})
    strangers.sort(key=lambda s: (-s["mails"], s["party"]))
    top = info[first_party]
    return {
        "quiet_days": int(quiet_days),
        "quiet_mails": stranger_at,
        "first_stranger": {"ts": t1, "party": first_party,
                           "name": _label(top[1],
                                          top[2].most_common(1)[0][0]),
                           "addr": top[2].most_common(1)[0][0]},
        "followed": sum(1 for p, ts in firsts.items()
                        if p != first_party and ts <= t1 + FOLLOWED_DAYS * DAY),
        "stranger_mails": sum(s["mails"] for s in strangers),
        # The index keeps no Authentication-Results, so there is no "failed
        # their sender check" count (it would need a new fetch): the UI
        # leaves the DMARC line out while this is null.
        "dmarc_failed": None,
        "strangers": strangers,
    }


def _blocked_senders() -> set[str]:
    return {r["query"][len("from:"):] for r in rulesmod.load_rules()
            if r.get("origin") == "block" and r.get("grouping") == "sender"
            and str(r.get("query", "")).startswith("from:")}


_cache: dict[tuple[str, str], tuple[tuple, dict]] = {}


def report(acc=None) -> dict:
    """The whole page for one account (cached until the scan data, the
    user's decisions or the alias list change)."""
    acc = acc or accounts.get()
    with acc.lock:
        done = acc.state["status"] == "done"
        stamp = (acc.state["groups_rev"], addressstore.revision(),
                 aliasservice.status()["synced_ts"], len(acc.index),
                 int(time.time() // DAY))
        recs = list(acc.index.values())
    ck = (tenants.current().id, acc.name)
    hit = _cache.get(ck)
    if hit and hit[0] == stamp:
        return _fresh(hit[1])
    out = _build(acc, recs, done)
    _cache[ck] = (stamp, out)
    return _fresh(out)


def _fresh(base: dict) -> dict:
    """The cached report with what changes without a scan filled in: which
    strangers are protected (Settings) or blocked (the rules) right now - a
    Block, or protecting a sender elsewhere, shows at once. `to_block` is the
    sender addresses of a stranger that have no block rule yet."""
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    blocked = _blocked_senders()
    rows = []
    for row in base["addresses"]:
        if row.get("leak"):
            strangers = []
            for s in row["leak"]["strangers"]:
                strangers.append({
                    **s,
                    "protected": any(cfgmod.is_protected(a, plist)
                                     for a in s["addrs"]),
                    "blocked": all(a in blocked for a in s["addrs"]),
                    "to_block": [a for a in s["addrs"] if a not in blocked
                                 and not cfgmod.is_protected(a, plist)]})
            row = {**row, "leak": {**row["leak"], "strangers": strangers}}
        rows.append(row)
    return {**base, "addresses": rows}


def _build(acc, recs: list[dict], done: bool) -> dict:
    ctx = context(acc)
    kinds: dict[str, str] = {}
    aggs: dict[str, _Agg] = {}
    read = 0
    for m in recs:
        to = m.get("to")
        if to is None:
            continue
        read += 1
        if not to:
            continue
        agg = aggs.get(to)
        if agg is None:
            kinds[to] = addresspick.address_kind(to, ctx)
            agg = aggs[to] = _Agg(kinds[to] in _LEAKABLE)
        agg.mails += 1
        addr, ts = m["addr"], m["ts"]
        party = party_of(addr)
        agg.parties.add(party)
        if ts:
            agg.last = max(agg.last, ts)
            if agg.first is None or ts < agg.first[0]:
                agg.first = (ts, addr, m.get("name", ""),
                             m.get("subject", ""))
            if agg.events is not None:
                agg.events.append((ts, party))
        if agg.info is not None:
            rec = agg.info.get(party)
            if rec is None:
                rec = agg.info[party] = [0, "", Counter()]
            rec[0] += 1
            rec[2][addr] += 1
            if m.get("name") and not rec[1]:
                rec[1] = m["name"]
    retired = addressstore.retired(acc.name)
    related = addressstore.related(acc.name)
    now = time.time()
    rows = []
    leaked = 0
    for addr, agg in aggs.items():
        kind = kinds[addr]
        if kind == addresspick.OTHER and agg.mails < OTHER_MIN_MAILS:
            continue
        row = {
            "address": addr, "kind": kind,
            "tag": addresspick.tag_of(addr, ctx),
            "mails": agg.mails, "senders": len(agg.parties),
            "first_ts": agg.first[0] if agg.first else 0,
            "last_ts": agg.last,
            "given_to": None, "story": None, "leak": None,
            "retired": addr in retired,
            "retired_ts": retired.get(addr, {}).get("ts", 0),
            "status": "",
        }
        if agg.first:
            ts, saddr, name, subject = agg.first
            row["given_to"] = {"name": _label(name, saddr), "addr": saddr,
                               "ts": ts, "subject": subject}
        if kind == addresspick.ALIAS:
            row["via"] = addresspick.alias_origin(addr, ctx)
        if kind in _LEAKABLE:
            leak = _leak(agg, related.get(addr, set()))
            if leak:
                row["leak"] = leak
            row["related"] = sorted(related.get(addr, ()))
            row["status"] = "leaked" if leak else "clean"
            if leak and not row["retired"]:
                leaked += 1
        elif kind in (addresspick.MAIN, addresspick.TAG):
            row["status"] = "" if kind == addresspick.MAIN else "clean"
        else:
            row["status"] = "last_seen"
            row["days_ago"] = max(0, int((now - agg.last) // DAY)) \
                if agg.last else None
        rows.append(row)
    rows.sort(key=lambda r: (r["status"] != "leaked" or r["retired"],
                             r["kind"] != addresspick.MAIN, -r["mails"],
                             r["address"]))
    return {
        "scanned": done, "main": ctx.main,
        "mails": len(recs), "read": read,
        "total": len(rows), "leaked": leaked,
        "addresses": rows[:MAX_ROWS],
        "service": {**aliasservice.status(),
                    "connected": aliasservice.connected()},
    }


def forget_picks(acc, values: tuple) -> int:
    """Drop the stored receiving address of the mails whose `to` is one of
    `values`, so the next scan's header backfill picks it again (they were
    read as main, which may have hidden an alias). Returns how many."""
    with acc.lock:
        n = 0
        for m in acc.index.values():
            if "to" in m and m["to"] in values:
                del m["to"]
                n += 1
        if n:
            acc.state["groups_rev"] += 1
    return n


def alias_list_changed(before: frozenset) -> int:
    """The alias service's list changed (connected, or a new alias): mail
    that was read as the main address may have been an alias after all.
    Forget the pick for the mails that read as main (or as nothing), save the
    snapshot (a restart must not bring the old picks back) - a scan running
    right now notices the change itself before it stores its records.
    Returns how many mails will be read again."""
    if aliasservice.cached_aliases() == before:
        return 0
    total = 0
    for name in cfgmod.load_config()["accounts"]:
        acc = accounts.get(name)
        n = forget_picks(acc, (main_address(acc), ""))
        if n:
            mailops.save_snapshot(acc)
        total += n
    return total


def summary(acc=None) -> dict:
    """The sidebar badge: how many addresses look leaked."""
    rep = report(acc)
    return {"leaked": rep["leaked"], "total": rep["total"],
            "scanned": rep["scanned"]}


# ---------------------------------------------------------------- actions

def _row(acc, address: str) -> dict:
    address = (address or "").strip().lower()
    for r in report(acc)["addresses"]:
        if r["address"] == address:
            return r
    raise ValueError(mailops.coded(mailops.ALIAS_BAD_ADDRESS))


def _stranger_items(acc, row: dict) -> tuple[list[list], int, int]:
    """([folder, uid] of every mail the strangers sent to `row`'s address
    that may be moved, protected senders skipped, pinned mails skipped)."""
    parties = {s["party"] for s in (row.get("leak") or {}).get("strangers", ())}
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    pinned = pinstore.load_account(acc.name)
    items: list[list] = []
    protected = pins = 0
    with acc.lock:
        recs = [m for m in acc.index.values()
                if m.get("to") == row["address"]]
    for m in recs:
        if party_of(m["addr"]) not in parties:
            continue
        if cfgmod.is_protected(m["addr"], plist):
            protected += 1
        elif m.get("msgid") and m["msgid"] in pinned:
            pins += 1
        else:
            items.append([m["folder"], m["uid"]])
    return items, protected, pins


def strangers_to_junk(acc, address: str) -> dict:
    """Move the mails the strangers sent to a leaked address to Junk (the
    reversible move pipeline: audit log and Undo like any move). Protected
    senders and pinned mails stay."""
    row = _row(acc, address)
    if not row.get("leak"):
        raise ValueError(mailops.coded(mailops.ALIAS_BAD_ADDRESS))
    items, protected, pinned = _stranger_items(acc, row)
    junk = acc.folder_roles.get("junk")
    if not junk:
        raise RuntimeError(mailops.coded(mailops.ROLE_MISSING, folder="Junk"))
    queued = 0
    if items:
        queued = mailops.delete_messages(items, "move", junk, acc=acc)["queued"]
    return {"ok": True, "queued": queued, "skipped_protected": protected,
            "skipped_pinned": pinned}


def retire(acc, address: str, new_alias: bool = False,
           to_junk: bool = False) -> dict:
    """Switch the alias off at the service; optionally make a fresh alias for
    the sender it was given to and / or move the strangers' mails to Junk.
    The switch-off comes first: if the service refuses, nothing else
    happens. A later step failing is reported next to what did work."""
    row = _row(acc, address)
    if row["kind"] != addresspick.ALIAS:
        raise ValueError(mailops.coded(mailops.ALIAS_BAD_ADDRESS))
    alias = aliasservice.set_enabled(row["address"], False)
    addressstore.set_retired(row["address"], alias.id, int(time.time()),
                             acc.name)
    auditlog.record("alias_retired", account=acc.name, label=row["address"])
    out: dict = {"ok": True, "address": row["address"]}
    given = row.get("given_to") or {}
    if new_alias:
        try:
            party = party_of(given["addr"]) if given else ""
            out["new_alias"] = aliasservice.create_alias(
                f"For {given.get('name', '')}".strip(),
                "" if "@" in party else party)
            auditlog.record("alias_created", account=acc.name,
                            label=out["new_alias"])
        except aliasservice.AliasError as exc:
            out["new_alias_error"] = str(exc)
    if to_junk and row.get("leak"):
        try:
            out["junk"] = strangers_to_junk(acc, row["address"])
        except (ValueError, RuntimeError) as exc:
            out["junk_error"] = str(exc)
    return out


def restore(acc, address: str) -> dict:
    """"Turn back on": the alias works again at the service."""
    address = (address or "").strip().lower()
    if address not in addressstore.retired(acc.name):
        raise ValueError(mailops.coded(mailops.ALIAS_BAD_ADDRESS))
    aliasservice.set_enabled(address, True)
    addressstore.clear_retired(address, acc.name)
    auditlog.record("alias_restored", account=acc.name, label=address)
    return {"ok": True, "address": address}


def mark_related(acc, address: str, undo: list[str] | None = None) -> dict:
    """"Not a leak": today's strangers of this address belong to the company
    it was given to - they stop counting. `undo` (the marks `previous`
    returned) puts the earlier marks back instead."""
    address = (address or "").strip().lower()
    previous = sorted(addressstore.related(acc.name).get(address, ()))
    if undo is not None:
        addressstore.set_related(address, set(undo), acc.name)
        return {"ok": True, "previous": previous}
    row = _row(acc, address)
    parties = {s["party"] for s in (row.get("leak") or {}).get("strangers", ())}
    if not parties:
        raise ValueError(mailops.coded(mailops.ALIAS_BAD_ADDRESS))
    addressstore.add_related(address, parties, acc.name)
    return {"ok": True, "previous": previous}
