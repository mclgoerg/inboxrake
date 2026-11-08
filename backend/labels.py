"""Sender labels: the operations behind /api/labels.

labelstore.py holds what the user decided per sender - a verdict (Safe to
delete / Review / Keep) and / or the category tags. This module validates a
request, saves it, and brings the scanned state in line WITHOUT a rescan: the
sender row and the one-sender Smart row show the verdict, the sender rows are
re-tagged and Smart is re-derived (mailops.rebuild_smart, which re-reads the
tags). Reset removes the override and the automatic AI verdict / keyword tags
apply again.

Privacy: nothing here logs an address, a verdict or a tag - counts only.
"""

from __future__ import annotations

import logging

from . import accounts
from . import config as cfgmod
from . import labelstore as ls
from . import mailops
from . import verdictstore

log = logging.getLogger("inboxrake.labels")
LabelError = ls.LabelError

# Tags offered next to the sender's own (besides the user's categories).
BASE_SUGGESTIONS = ("newsletter", "automated")


def _sender_rec(acc, addr: str) -> dict | None:
    with acc.lock:
        if acc.state["status"] == "scanning":
            raise LabelError(ls.SCAN_RUNNING)    # the rows are being rebuilt
        if acc.state["status"] != "done":
            raise LabelError(ls.UNSCANNED)
        rec = acc.state["groups"]["sender"].get(addr)
        return dict(rec) if rec else None


def auto_tags(acc, addr: str, bulk: bool, categories) -> list[str]:
    """The tags the keyword rules give one sender - what "Reset" restores -
    from the same haystack the scan and retag_senders use."""
    hay = ""
    with acc.lock:
        for m in acc.index.values():
            if m["addr"] == addr:
                hay += f" {addr} {m['name']} {m['subject']}"
                if len(hay) >= 600:
                    break
    return mailops.categorize(hay, addr.split("@", 1)[0], bulk, categories)


def detail(acc, key) -> dict:
    """Everything the Edit labels sheet needs for one sender: its labels now,
    what automatic would be, and the tags it may add."""
    addr = ls.normalize_key(key)
    rec = _sender_rec(acc, addr)
    if rec is None:
        raise LabelError(ls.UNKNOWN)
    cfg = cfgmod.load_config()
    categories = mailops.effective_categories(cfg.get("categories"))
    plist = cfgmod.normalize_protected(cfg.get("protected"))
    mine = ls.load_account(acc.name).get(addr, {})
    auto = auto_tags(acc, addr, bool(rec.get("bulk")), categories)
    now = mine["tags"] if "tags" in mine else auto
    cached = verdictstore.load_account(acc.name).get("sender", {}).get(addr)
    pool = [c for c, _ in categories] + list(BASE_SUGGESTIONS)
    return {
        "key": addr,
        "verdict": mine.get("verdict"),
        "tags": mine.get("tags"),
        "tags_now": now,
        "auto_tags": auto,
        "ai": ({"verdict": cached["verdict"], "reason": cached["reason"]}
               if cached else None),
        "protected": cfgmod.is_protected(addr, plist),
        "suggestions": [t for t in dict.fromkeys(pool) if t not in now][:8],
    }


def refresh(acc, addrs) -> None:
    """Bring the rows of these senders in line with their labels (no rescan):
    the verdict of the Sender row and the one-sender Smart row is re-derived
    from the AI cache + the user's override, then the tags / Smart placement.
    A no-op for an account without a finished scan."""
    cfg = cfgmod.load_config()
    plist = cfgmod.normalize_protected(cfg.get("protected"))
    cached = verdictstore.load_account(acc.name)
    with acc.lock:
        if acc.state["status"] != "done":
            return
        groups = acc.state["groups"]
        for addr in addrs:
            for grouping, key in (("sender", addr), ("smart", f"s:{addr}")):
                rec = (groups.get(grouping) or {}).get(key)
                if rec is not None:
                    v = (cached.get(grouping) or {}).get(key)
                    rec["ai"] = ({"verdict": v["verdict"],
                                  "reason": v["reason"]} if v else None)
        verdictstore.sync_borrowed(groups, cached)
        ls.apply_to_groups(groups, acc.name,
                           lambda a: cfgmod.is_protected(a, plist))
        acc.state["groups_rev"] += 1
    mailops.rebuild_smart(acc, cfg)       # re-tags + re-places when tags moved


def put(acc, body) -> dict:
    """PUT /api/labels: `{key, verdict?, tags?}` - a key left out stays, null
    goes back to automatic, `{key, reset: true}` removes both. Returns the
    sender's detail (as GET)."""
    if not isinstance(body, dict):
        raise LabelError(ls.BAD_REQUEST)
    addr = ls.normalize_key(body.get("key"))
    if _sender_rec(acc, addr) is None:
        raise LabelError(ls.UNKNOWN)
    if body.get("reset") is True:
        args = {"verdict": None, "tags": None}
    else:
        args = {k: body[k] for k in ("verdict", "tags") if k in body}
    if not args:
        raise LabelError(ls.BAD_REQUEST)
    ls.set_labels(acc.name, addr, **args)
    refresh(acc, [addr])
    log.info("sender labels: 1 sender changed")
    return detail(acc, addr)
