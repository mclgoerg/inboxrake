"""Mute a conversation: the new mail of one thread is archived and marked read
after each scan.

A mute is a rule (origin "mute", see rules.py), the way Block is, made by one
click on "Mute this conversation": Thread grouping, the filter word
`thread:<key>` (exactly this conversation), the action "archive_read"
(archive + mark read) and the schedule "scan" (after each scan). It is listed
with the other rules - Last report, Edit, the Rule checkup, Activity and Undo
work as for every rule - and "Unmute" deletes it.

What one run touches (`plan`) is narrower than the rule's filter:

  * the conversation is the Thread group of the scan: mails joined by their
    reply headers (`mailops.assign_threads`), never by subject, so a NEW
    conversation of the same people is not touched. A group's key is the hash
    of the thread's root Message-ID, and a later reply that lists only its
    parent can make another id the smallest root - the key changes while the
    conversation does not. So the mute also keeps the conversation's
    Message-IDs (`ids`, and every mail it handled): when its key is gone from
    the scan, the mails whose In-Reply-To / References hit one of them are
    the conversation, and the new key is remembered (`keys`);
  * only mail that arrived AFTER the mute (its arrival date is later than the
    newest mail of the conversation was when it was muted) - what was already
    there stays where it is, unless the user asked to archive it too;
  * only mail from the senders that were IN the conversation when it was
    muted - someone who joins later is let through;
  * only mail in the Inbox, where new mail lands;
  * each mail once: the mails a run handled are remembered (`done`, by
    Message-ID), so a mail the user puts back - with Undo, or by hand - is
    not archived again by the next scan;
  * never a pinned mail, never a protected sender's mail;
  * the mails are archived (and marked read as they move), or - with no
    Archive folder - only marked read. Nothing is trashed, nothing deleted.

The record of the mute (`rule["mute"]`: the key and the keys it had since, the
senders, the date, the Message-IDs, the mails handled) is no part of the rule's definition signature, so an older release - which reads the
same signature - sees an armed rule it then refuses for its unknown action and
its `thread:` word (see rules.py), and a rollback and roll-forward does not
disarm it.

This module knows no rule file: rules.py calls it, so it imports nothing of
it."""

from __future__ import annotations

import re
import time

from . import config as cfgmod
from . import mailops

ORIGIN = "mute"                # `origin` of the rule a mute makes
ACTION = "archive_read"        # its action: archive + mark read
SCHEDULE = "scan"              # its schedule: after each scan
MAX_SENDERS = 100              # senders remembered per conversation
DONE_MAX = 500                 # handled mails remembered per mute (newest)
MAX_IDS = 400                  # Message-IDs that identify the conversation
MAX_KEYS = 20                  # keys one conversation had (it drifts rarely)

_KEY_RE = re.compile(r"^[0-9a-f]{16}$")      # a Thread group's key


def query_of(info: dict) -> str:
    """The filter of a mute rule: exactly this conversation."""
    return f"thread:{info['key']}"


def mail_ids(m: dict) -> set[str]:
    """The Message-IDs that tie a scanned mail to its conversation: its own and
    the ones it answers (In-Reply-To, References)."""
    return {*mailops.header_ids(m.get("msgid"))[:1], *(m.get("irt") or []),
            *(m.get("refs") or [])}


def anchors(info: dict) -> frozenset:
    """What identifies the conversation of a mute by its headers: the ids it
    had when it was muted and the mails a run handled since."""
    out = set(info.get("ids") or ())
    for d in info.get("done") or ():
        out.update(mailops.header_ids(d)[:1])
    return frozenset(out)


def clean_info(raw) -> dict | None:
    """The record of a mute (`{key, keys, senders, since, ids, done}`) in its
    one valid shape, or None when it is none - a hand-edited file, a restored
    backup. `keys` (the keys the conversation had, `key` first), `ids` and
    `done` (the Message-IDs of the mails a run handled) are optional."""
    if not isinstance(raw, dict):
        return None
    key, senders, since = raw.get("key"), raw.get("senders"), raw.get("since")
    if not isinstance(key, str) or not _KEY_RE.match(key) \
            or not isinstance(senders, list) \
            or isinstance(since, bool) or not isinstance(since, (int, float)) \
            or since <= 0:
        return None
    seen: list[str] = []
    for a in senders:
        a = str(a).strip().lower()[:320] if isinstance(a, str) else ""
        if a and a not in seen:
            seen.append(a)
    done = raw.get("done")
    handled = list(dict.fromkeys(
        d for d in done if isinstance(d, str) and d)) \
        if isinstance(done, list) else []
    ids = raw.get("ids")
    anchored = list(dict.fromkeys(
        i for i in ids if isinstance(i, str) and i)) \
        if isinstance(ids, list) else []
    had = raw.get("keys")
    keys = [key] + [k for k in (had if isinstance(had, list) else ())
                    if isinstance(k, str) and _KEY_RE.match(k)]
    return {"key": key, "keys": list(dict.fromkeys(keys))[:MAX_KEYS],
            "senders": seen[:MAX_SENDERS], "since": int(since),
            "ids": anchored[:MAX_IDS], "done": handled[-DONE_MAX:]}


def with_key(info: dict, key: str) -> dict | None:
    """`info` with `key` added to the keys its conversation has had (the
    newest last, the first one - the rule's own filter - never dropped), or
    None when it knows it already."""
    if key in info["keys"]:
        return None
    return {**info, "keys": [info["keys"][0], *info["keys"][1:][-(MAX_KEYS - 2):],
                             key]}


def _owners(groups: dict) -> dict:
    """{(folder, uid): thread key} of a scan's Thread groups."""
    return {(f, u): k for k, rec in groups.items()
            for f, uids in rec["folders"].items() for u in uids}


def locate(acc, info: dict) -> list[dict]:
    """The Thread group records of the muted conversation in the scan (lock
    held): the group under a key it had, else - its key drifted - the group(s)
    of the mails whose Message-IDs hit the conversation's `anchors`."""
    groups = acc.state["groups"].get("thread", {})
    known = [groups[k] for k in info["keys"] if k in groups]
    if known:
        return known
    ids = anchors(info)
    if not ids:
        return []
    owner = _owners(groups)
    hit = {owner[(m["folder"], m["uid"])] for m in acc.index.values()
           if (m["folder"], m["uid"]) in owner and mail_ids(m) & ids}
    return [groups[k] for k in sorted(hit)]


def current_key(acc, info: dict) -> str | None:
    """The key the muted conversation has in the scan now, None when the scan
    has no such conversation."""
    with acc.lock:
        recs = locate(acc, info)
    return recs[0]["key"] if recs else None


def same_conversation(acc, info: dict, key: str) -> bool:
    """Is the Thread group `key` the conversation `info` muted (by a key it
    had, or by the Message-IDs its mails carry)?"""
    if key in info["keys"]:
        return True
    ids = anchors(info)
    with acc.lock:
        rec = acc.state["groups"].get("thread", {}).get(key)
        if rec is None or not ids:
            return False
        return any(
            mail_ids(m) & ids for f, uids in rec["folders"].items()
            for u in uids if (m := acc.index.get(mailops.ikey(f, u))))


def conversation(acc, key: str, info: dict | None = None) -> dict | None:
    """What the Thread group `key` holds in the last scan (with `info`, the
    muted conversation wherever its key went - see `locate`): its label, its
    mails and people, `senders` (who is in it, the most active first, as many
    as a mute remembers), `newest` (the arrival date of its newest mail) and
    `ids` (the Message-IDs that identify it, newest mails first). None when
    the scan has no such conversation."""
    if not isinstance(key, str) or not _KEY_RE.match(key):
        return None
    with acc.lock:
        if info is not None:
            recs = locate(acc, info)
        else:
            rec = acc.state["groups"].get("thread", {}).get(key)
            recs = [rec] if rec is not None else []
        if not recs:
            return None
        counts: dict[str, int] = {}
        newest = 0
        mine: list[dict] = []
        for rec in recs:
            for folder, uids in rec["folders"].items():
                for uid in uids:
                    m = acc.index.get(mailops.ikey(folder, uid))
                    if m is None:
                        continue
                    mine.append(m)
                    counts[m["addr"]] = counts.get(m["addr"], 0) + 1
                    newest = max(newest, m.get("ts") or 0)
        ranked = sorted(counts, key=lambda a: (-counts[a], a))
        ids: list[str] = []
        for m in sorted(mine, key=lambda m: -(m.get("ts") or 0)):
            ids.extend(sorted(mail_ids(m)))
        return {"key": recs[0]["key"], "label": recs[0]["label"],
                "mails": sum(r["count"] for r in recs),
                "people": len(counts), "senders": ranked[:MAX_SENDERS],
                "newest": newest,
                "ids": list(dict.fromkeys(ids))[:MAX_IDS]}


def info_for(conv: dict, now: float | None = None) -> dict:
    """The record a mute of `conv` (see `conversation`) keeps: the senders in
    it and the date from which mail counts as new - now, or the newest mail
    of the conversation when that is later (a mail server whose clock runs
    ahead must not make what is already there look new)."""
    return {"key": conv["key"], "keys": [conv["key"]],
            "senders": list(conv["senders"]),
            "since": max(int(now if now is not None else time.time()),
                         int(conv["newest"])),
            "ids": list(conv["ids"]), "done": []}


def plan(acc, key: str, *, info: dict | None = None, senders=None,
         after: int | None = None, unread_only: bool = False,
         pinned=frozenset(), protected=(), done=frozenset()) -> dict:
    """The mails of the conversation `key` a mute run (or its one-time
    "archive what is there") acts on, from the last scan. With `info` (the
    record of a mute) the conversation is found wherever its key went (see
    `locate`):

      found      the conversation is in the scan
      key        the key it has in this scan (`info`: maybe a new one)
      label      its subject
      items      [(folder, uid)] in the Inbox, oldest first
      ids        the Message-ID of each of them ("" = it has none)
      protected  mails left alone because their sender is protected
      pinned     mails left alone because they are pinned

    `senders` (None = anybody) limits it to mail from those addresses, `after`
    (None = any date) to mail that arrived later than that (epoch seconds; a
    mail with no arrival date never counts), `unread_only` to unread mail (a
    run that only marks as read has nothing to do with the read ones).
    `protected` is the normalized protected list, `pinned` the Message-IDs of
    the pinned mails, `done` those of the mails a run handled before (never
    handled twice)."""
    out: dict = {"found": False, "key": key, "label": "", "items": [],
                 "ids": [], "protected": 0, "pinned": 0}
    plist = list(protected)
    with acc.lock:
        if info is not None:
            recs = locate(acc, info)
        else:
            rec = acc.state["groups"].get("thread", {}).get(key)
            recs = [rec] if rec is not None else []
        if not recs:
            return out
        out["found"], out["key"], out["label"] = \
            True, recs[0]["key"], recs[0]["label"]
        found: list[tuple[int, str, int, str]] = []
        inbox = {(f, u) for rec in recs for f, us in rec["folders"].items()
                 for u in us if f.upper() == "INBOX"}
        for folder, uid in inbox:
            m = acc.index.get(mailops.ikey(folder, uid))
            if m is None:
                continue
            if senders is not None and m["addr"] not in senders:
                continue                      # not in the conversation yet
            if after is not None and not (m.get("ts") or 0) > after:
                continue                      # was there before the mute
            if unread_only and m["seen"]:
                continue
            if m["msgid"] and m["msgid"] in done:
                continue                      # handled by an earlier run
            if cfgmod.is_protected(m["addr"], plist):
                out["protected"] += 1
            elif m["msgid"] and m["msgid"] in pinned:
                out["pinned"] += 1
            else:
                found.append((m.get("ts") or 0, folder, uid, m["msgid"]))
        found.sort()
        out["items"] = [(f, u) for _, f, u, _ in found]
        out["ids"] = [i for *_, i in found]
    return out
