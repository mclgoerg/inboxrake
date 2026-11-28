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
    conversation of the same people is not touched;
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

The record of the mute (`rule["mute"]`: the key, the senders, the date, the
mails handled) is no part of the rule's definition signature, so an older release - which reads the
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

_KEY_RE = re.compile(r"^[0-9a-f]{16}$")      # a Thread group's key


def query_of(info: dict) -> str:
    """The filter of a mute rule: exactly this conversation."""
    return f"thread:{info['key']}"


def clean_info(raw) -> dict | None:
    """The record of a mute (`{key, senders, since, done}`) in its one valid
    shape, or None when it is none - a hand-edited file, a restored backup.
    `done` (the Message-IDs of the mails a run handled) is optional."""
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
    return {"key": key, "senders": seen[:MAX_SENDERS], "since": int(since),
            "done": handled[-DONE_MAX:]}


def conversation(acc, key: str) -> dict | None:
    """What the Thread group `key` holds in the last scan: its label, its mails
    and people, `senders` (who is in it, the most active first, as many as a
    mute remembers) and `newest` (the arrival date of its newest mail). None
    when the scan has no such conversation."""
    if not isinstance(key, str) or not _KEY_RE.match(key):
        return None
    with acc.lock:
        rec = acc.state["groups"].get("thread", {}).get(key)
        if rec is None:
            return None
        counts: dict[str, int] = {}
        newest = 0
        for folder, uids in rec["folders"].items():
            for uid in uids:
                m = acc.index.get(mailops.ikey(folder, uid))
                if m is None:
                    continue
                counts[m["addr"]] = counts.get(m["addr"], 0) + 1
                newest = max(newest, m.get("ts") or 0)
        ranked = sorted(counts, key=lambda a: (-counts[a], a))
        return {"key": key, "label": rec["label"], "mails": rec["count"],
                "people": len(counts), "senders": ranked[:MAX_SENDERS],
                "newest": newest}


def info_for(conv: dict, now: float | None = None) -> dict:
    """The record a mute of `conv` (see `conversation`) keeps: the senders in
    it and the date from which mail counts as new - now, or the newest mail
    of the conversation when that is later (a mail server whose clock runs
    ahead must not make what is already there look new)."""
    return {"key": conv["key"], "senders": list(conv["senders"]),
            "since": max(int(now if now is not None else time.time()),
                         int(conv["newest"]))}


def plan(acc, key: str, *, senders=None, after: int | None = None,
         unread_only: bool = False, pinned=frozenset(), protected=(),
         done=frozenset()) -> dict:
    """The mails of the conversation `key` a mute run (or its one-time
    "archive what is there") acts on, from the last scan:

      found      the conversation is in the scan
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
    out: dict = {"found": False, "label": "", "items": [], "ids": [],
                 "protected": 0, "pinned": 0}
    plist = list(protected)
    with acc.lock:
        rec = acc.state["groups"].get("thread", {}).get(key)
        if rec is None:
            return out
        out["found"], out["label"] = True, rec["label"]
        found: list[tuple[int, str, int, str]] = []
        for folder, uids in rec["folders"].items():
            if folder.upper() != "INBOX":
                continue
            for uid in uids:
                m = acc.index.get(mailops.ikey(folder, uid))
                if m is None:
                    continue
                if senders is not None and m["addr"] not in senders:
                    continue                  # not in the conversation yet
                if after is not None and not (m.get("ts") or 0) > after:
                    continue                  # was there before the mute
                if unread_only and m["seen"]:
                    continue
                if m["msgid"] and m["msgid"] in done:
                    continue                  # handled by an earlier run
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
