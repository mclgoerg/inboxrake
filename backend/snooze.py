"""Not now: snooze mail until a time you pick, and let a noisy sender deliver
in batches.

A snoozed mail leaves the inbox for the account's own server folder
`Snoozed` (created on first use, so other mail apps do not show the mail
either) and comes back to the folder it was in, UNREAD, when its time is
due. `snoozestore.py` remembers where each one belongs (by Message-ID) and
which senders deliver in batches.

  * Snoozing is an ordinary background move (`mailops._start_delete`, action
    `snooze`): the same queue, undo step (Undo puts the mail back where it
    was) and audit entry as a move to Trash. Pinned mails are never snoozed;
    protected senders' mail is skipped by every group / selection snooze and
    by batches (only one mail named by hand may be snoozed).
  * Returning is a direct move out of `Snoozed` (like leaving Junk), driven
    by the scheduler tick every minute (`tick`), by "Back now", by switching a
    batch off, and by every scan. It clears \\Seen first, so the mail
    arrives unread, and is audited as `snooze_return`.
  * A batch ("deliver once a day / a week") holds every NEW inbox mail of one
    sender after each scan until the next slot, in the user's own time zone,
    and returns what it holds together, with one push per batch.
  * A mail gone from `Snoozed` (another client moved it) is dropped from the
    store, never trusted; its Message-ID is remembered so a batch does not
    catch it again. A folder that cannot be found drops NOTHING: the page
    shows what is remembered and says so.
  * Every mail moved into `Snoozed` has a store record that brings it back
    (one record per Message-ID: a mail whose id is already snoozed, queued or
    twice in one pick stays where it is; the store's cap is checked before
    anything moves), and a delivered mail is never caught again (its id is
    remembered while it sits in the inbox).

Nothing here uses AI, and nothing is deleted: every step is a reversible
move.
"""

from __future__ import annotations

import datetime
import email
import logging
import threading
import time
from collections import Counter
from zoneinfo import ZoneInfo

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import mailkinds
from . import mailops
from . import pinstore
from . import snoozestore
from . import tenants
from . import webpush
from . import yourfolders

log = logging.getLogger("inboxrake.snooze")

FOLDER = "Snoozed"
ALT_FOLDER = "Inboxrake Snoozed"    # when a folder of that name is somebody else's
MAX_TRIES = 3                       # failed returns to one folder before the inbox
RETRY_AFTER = 300                   # s a failing return waits before it is tried again
ACTION = "snooze"                   # the job-queue action (mailops.JOB_ACTIONS)
ACTOR = "snooze"                    # who the automatic steps are (audit log)
WEEKLY = (5, 9, 0)                  # a weekly batch: Saturday (Mon = 0) 09:00
DAILY = (18, 0)                     # a daily batch: 18:00
MAX_AHEAD_DAYS = 800                # the furthest "Pick a date" may reach
LABEL_SENDERS = 3                   # senders named in an undo / audit label
HOLD_CHUNK = 500


class NoFolder(RuntimeError):
    """The account's Snoozed folder cannot be found on the server (the
    records are kept)."""

    def __init__(self):
        super().__init__(mailops.coded(mailops.SNOOZE_NO_FOLDER))


def _utc() -> datetime.tzinfo:
    return datetime.timezone.utc


def _zone(tz: str) -> datetime.tzinfo:
    """The user's time zone; UTC when the name is unknown or the host has no
    zone data (the in-browser demo)."""
    try:
        return ZoneInfo(tz)
    except Exception:
        return _utc()


# ------------------------------------------------------------------ slots

def next_slot(slot: str, tz: str, after: float) -> int:
    """The first delivery of `slot` strictly after `after` (epoch s), in the
    time zone `tz`: a daily batch at 18:00, a weekly one on Saturday 09:00 of
    the user's own clock. Wall-clock arithmetic, so a slot keeps its hour
    across a clock change (the absolute time moves by an hour, as it
    should)."""
    local = datetime.datetime.fromtimestamp(after, _zone(tz))
    if slot == "weekly":
        day, hour, minute = WEEKLY
        cand = local.replace(hour=hour, minute=minute, second=0,
                             microsecond=0)
        cand += datetime.timedelta(days=(day - local.weekday()) % 7)
        if cand <= local:
            cand += datetime.timedelta(days=7)
    else:
        hour, minute = DAILY
        cand = local.replace(hour=hour, minute=minute, second=0,
                             microsecond=0)
        if cand <= local:
            cand += datetime.timedelta(days=1)
    return int(cand.timestamp())


def check_until(until, now: float | None = None) -> int:
    """A return time the user picked (epoch s, from the browser's time zone):
    in the future and not absurdly far. Raises the coded refusal otherwise."""
    now = time.time() if now is None else now
    ok = isinstance(until, int) and not isinstance(until, bool) \
        and now - 60 <= until <= now + MAX_AHEAD_DAYS * 86400
    if not ok:
        raise ValueError(mailops.coded(mailops.SNOOZE_BAD_TIME))
    return until


# ----------------------------------------------------------------- folder

def _gmail_system(name: str) -> bool:
    """Gmail's own Snoozed view: not ours to move mail into."""
    return mailops.decode_mutf7(name).lower() in (
        "[gmail]/snoozed", "[google mail]/snoozed")


def _taken_names(pairs) -> set[str]:
    return {mailops.decode_mutf7(n).casefold() for n, _ in pairs}


def _server_owned(name: str, flags) -> bool:
    """The server's own Snoozed folder (Gmail's view, a `\\Snoozed`-flagged
    one): not ours to move mail into, and never taken for ours."""
    return "\\snoozed" in {str(f).lower() for f in flags} \
        or _gmail_system(name)


def _holds_any(conn, name: str, ids: set[str]) -> bool:
    """Whether the folder holds a mail with one of these Message-IDs."""
    status, _ = conn.select(mailops.quote_folder(name), readonly=True)
    if status != "OK":
        return False
    uids = mailops._all_uids(conn)
    for start in range(0, len(uids), 200):
        chunk = ",".join(map(str, uids[start:start + 200]))
        status, got = conn.uid(
            "FETCH", chunk, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
        for item in (got or []) if status == "OK" else []:
            if isinstance(item, tuple) and len(item) >= 2:
                mid = mailops.header_text(email.message_from_bytes(
                    item[1]).get("Message-ID")).strip()[:300]
                if mid in ids:
                    return True
    return False


def _legacy_folder(conn, pairs, ids: set[str]) -> str | None:
    """The folder a store that has no record of its folder (it predates the
    record) has been using: a folder called Snoozed - at the top or below a
    prefix such as `Folders/` - that holds mail the store knows. The name
    alone is not enough (it may be somebody else's folder), and a server's own
    `\\Snoozed` one is never taken."""
    delims = getattr(pairs, "delims", {})
    for name, flags in pairs:
        if _server_owned(name, flags):
            continue
        sep = delims.get(name) or "/"
        if mailops.decode_mutf7(name).split(sep)[-1].casefold() \
                == FOLDER.casefold() and _holds_any(conn, name, ids):
            return name
    return None


def folder(conn, acc, create: bool = False) -> str | None:
    """Raw name of the account's Snoozed folder: the one Inboxrake made and
    remembers (`snoozestore.folder_of`) while it is on the server - never a
    folder that merely has the name, nor one the server owns. With `create`
    it is made on first use, where this server wants the user's own folders
    (Your folders' rule: under the personal namespace, `INBOX.`, Proton
    Bridge's `Folders/`). None when there is none and `create` is off. While
    snoozed mail waits and its folder cannot be found there is NO second
    folder: NoFolder (the mail stays recorded)."""
    found = mailops.resolve_roles(conn, acc)
    name = found["roles"].get("snoozed")
    if name:
        acc.folder_roles["snoozed"] = name
        return name
    pairs = mailops.list_folders_ex(conn)
    block = snoozestore.load_account(acc.name)
    # (a record that is still pending is the very job asking: its mail is
    # not in the folder yet)
    waiting = {m for m, r in block["mails"].items() if not r["pending"]}
    if block["folder"]:
        # Inboxrake made one and it is not on the server now (renamed or
        # deleted by another app): with mail recorded as waiting there, NO
        # second folder is made - the records stay (see NoFolder)
        if waiting:
            if create:
                raise NoFolder()
            return None
    elif waiting:
        legacy = _legacy_folder(conn, pairs, waiting)
        if legacy:                      # (a store from before the record)
            snoozestore.set_folder(legacy, acc.name)
            acc.folder_roles["snoozed"] = legacy
            return legacy
    if not create:
        return None
    return _make_folder(conn, acc, pairs)


def _make_folder(conn, acc, pairs) -> str:
    prefix = yourfolders.new_folder_prefix(conn, acc)
    taken = _taken_names(pairs)
    for leaf in (FOLDER, ALT_FOLDER):
        new = prefix + leaf
        if mailops.decode_mutf7(new).casefold() in taken:
            continue                    # somebody else's: not ours, not touched
        status, data = conn.create(mailops.quote_folder(new))
        text = b" ".join(d for d in (data or []) if isinstance(d, bytes))
        if status == "OK":
            snoozestore.set_folder(new, acc.name)
            acc.folder_roles["snoozed"] = new
            log.info("created the Snoozed folder")
            return new
        if b"ALREADYEXISTS" not in text.upper():
            break
    raise RuntimeError(mailops.coded(mailops.SNOOZE_CANNOT_CREATE,
                                     folder=FOLDER))


# --------------------------------------------------------------- snoozing

def _protected_list() -> list:
    return cfgmod.normalize_protected(cfgmod.load_config().get("protected"))


def _reconcile(acc, ids: set[str]):
    """The `on_moved` hook of a snooze job. The records were filed BEFORE the
    move (see `_enqueue`), so a restart half way strands nothing; what the job
    did not move (it failed, it was cancelled, nothing was left to move) has
    its record dropped here."""
    def hook(meta: dict, copies: list[dict]) -> None:
        moved = {m["msgid"] for by_uid in meta.values()
                 for m in by_uid.values() if m.get("msgid")}
        missing = [i for i in ids if i not in moved]
        if missing:
            snoozestore.drop_mails(missing, acc.name)
        snoozestore.confirm(moved, acc.name)
    return hook


def _record(m: dict, until: int, batch: str) -> dict:
    """The store's record of the index entry `m` about to be snoozed."""
    return {"origin": m["folder"], "until": until, "addr": m["addr"],
            "name": m.get("name", ""), "subject": m.get("subject", ""),
            "kind": mailkinds.of(m), "batch": batch, "tries": 0,
            "pending": True}


def _taken(acc) -> set[str]:
    """The Message-IDs that already have (or are about to get) a record:
    the store's and those of the mails waiting in the move queue (acc.lock
    held)."""
    taken = set(snoozestore.load_account(acc.name)["mails"])
    for job in [*acc.delete_pending, {"by_folder": acc.inflight}]:
        for fld, uids in job["by_folder"].items():
            for uid in uids:
                m = acc.index.get(mailops.ikey(fld, uid))
                if m and m.get("msgid"):
                    taken.add(m["msgid"])
    return taken


def _plan(acc, picks: list[dict], explicit: bool) -> tuple[dict, dict, dict]:
    """`({folder: {uid}}, skipped counts, {Message-ID: index entry})` of the
    index entries `picks`:
    pinned mails never, protected senders' mails unless `explicit` (one mail
    named by hand), mails without a Message-ID cannot be tracked, and a
    Message-ID that is already snoozed, queued or picked twice gets one
    record only - the twin stays where it is (acc.lock held)."""
    pinned = pinstore.load_account(acc.name)
    plist = _protected_list()
    by_folder: dict[str, set[int]] = {}
    planned: dict[str, dict] = {}
    skipped = {"pinned": 0, "protected": 0, "no_id": 0, "duplicate": 0}
    taken = _taken(acc)
    for m in picks:
        if not m.get("msgid"):
            skipped["no_id"] += 1
        elif m["msgid"] in pinned:
            skipped["pinned"] += 1
        elif not explicit and cfgmod.is_protected(m["addr"], plist):
            skipped["protected"] += 1
        elif m["msgid"] in taken:
            skipped["duplicate"] += 1
        else:
            taken.add(m["msgid"])
            by_folder.setdefault(m["folder"], set()).add(m["uid"])
            planned[m["msgid"]] = m
    return by_folder, skipped, planned


def _enqueue(acc, by_folder: dict, label: str, until: int, skipped: dict,
             planned: dict, batch: str = "", actor: str = "user",
             quiet: bool = False) -> dict:
    """Queue the move (acc.lock held). Refuses (ValueError, coded) when the
    store would outgrow its cap: nothing moves without a record. The records
    are filed FIRST (the mails are still in the inbox), the job drops those
    of what it did not move (`_reconcile`); a job that could not even be
    queued drops them here."""
    n = sum(len(s) for s in by_folder.values())
    if n and snoozestore.count(acc.name) + n > snoozestore.MAX_MAILS:
        raise ValueError(mailops.coded(mailops.SNOOZE_FULL))
    if n:
        records = {mid: _record(m, until, batch) for mid, m in planned.items()}
        if snoozestore.add_mails(records, acc.name) < len(records):
            snoozestore.drop_mails(list(records), acc.name)
            raise ValueError(mailops.coded(mailops.SNOOZE_FULL))
        try:
            job = mailops._start_delete(
                by_folder, label, acc, ACTION, "", actor,
                on_moved=_reconcile(acc, set(records)), quiet=quiet)
        except Exception:
            snoozestore.drop_mails(list(records), acc.name)
            raise
        if not job:                      # nothing was left to queue
            snoozestore.drop_mails(list(records), acc.name)
    return {"ok": True, "queued": n, "until": until,
            "skipped_pinned": skipped["pinned"],
            "skipped_protected": skipped["protected"],
            "skipped_no_id": skipped["no_id"],
            "skipped_duplicate": skipped.get("duplicate", 0)}


def snooze_groups(acc, grouping: str, keys: list[str], until, *,
                  unread_only: bool = True) -> dict:
    """Snooze the (unread) mails of whole groups until `until`."""
    until = check_until(until)
    with acc.lock:
        if acc.state["status"] != "done":
            raise RuntimeError("No completed scan")
        recs = acc.state["groups"][grouping]
        picks: list[dict] = []
        labels: list[str] = []
        for key in keys:
            rec = recs.get(key)
            if not rec:
                continue
            labels.append(rec["label"])
            for fld, uids in rec["folders"].items():
                for uid in uids:
                    m = acc.index.get(mailops.ikey(fld, uid))
                    if m and not (unread_only and m["seen"]):
                        picks.append(m)
        by_folder, skipped, planned = _plan(acc, picks, explicit=False)
        label = ", ".join(labels[:LABEL_SENDERS]) \
            + ("…" if len(labels) > LABEL_SENDERS else "")
        return _enqueue(acc, by_folder, label, until, skipped, planned)


def snooze_items(acc, items: list, until) -> dict:
    """Snooze individual mails ([folder, uid] pairs) until `until`."""
    until = check_until(until)
    with acc.lock:
        if acc.state["status"] != "done":
            raise RuntimeError("No completed scan")
        picks = []
        for it in items:
            if isinstance(it, (list, tuple)) and len(it) == 2:
                m = acc.index.get(mailops.ikey(str(it[0]), int(it[1])))
                if m:
                    picks.append(m)
        by_folder, skipped, planned = _plan(acc, picks,
                                            explicit=len(items) == 1)
        n = sum(len(s) for s in by_folder.values())
        return _enqueue(acc, by_folder, f"{n} selected mails", until, skipped,
                        planned)


# ---------------------------------------------------------------- batches

def _inbox(acc) -> tuple[str | None, int, int]:
    """`(INBOX's raw name, its UIDVALIDITY, its highest known UID)` from the
    scan index (nothing is asked of the server)."""
    with acc.lock:
        name = next((f for f in acc.folder_uv if f.upper() == "INBOX"), None)
        if name is None:
            return None, 0, 0
        top = max((m["uid"] for m in acc.index.values()
                   if m["folder"] == name), default=0)
        return name, acc.folder_uv.get(name, 0), top


def set_batch(acc, key: str, slot: str, tz: str,
              label: str = "") -> dict:
    """Deliver every NEW mail of the sender `key` once a `slot` ("weekly" |
    "daily") from now on, or "off": return what is held and stop. Only mail
    that arrives after this call is held."""
    if not mailops.valid_block_key("sender", key):
        raise ValueError("bad key")
    if slot == "off":
        return stop_batch(acc, key)
    if slot not in snoozestore.SLOTS or not snoozestore.valid_tz(tz):
        raise ValueError("bad slot")
    if cfgmod.is_protected(key, _protected_list()):
        raise ValueError(mailops.coded(mailops.SNOOZE_PROTECTED))
    old = snoozestore.load_account(acc.name)["batches"].get(key)
    if old:
        base = {"uv": old["uv"], "after": old["after"]}
    else:
        _, uv, top = _inbox(acc)
        base = {"uv": uv, "after": top}
    snoozestore.set_batch(key, {"slot": slot, "tz": tz,
                                "label": (label or key)[:100], **base},
                          acc.name)
    # what is held already follows the new slot
    until = next_slot(slot, tz, time.time())
    held = {m: {**r, "until": until} for m, r in
            snoozestore.load_account(acc.name)["mails"].items()
            if r["batch"] == key}
    if held:
        snoozestore.add_mails(held, acc.name)
    return {"ok": True, "slot": slot, "next": until}


def stop_batch(acc, key: str) -> dict:
    """Switch a batch off: what it holds is due now."""
    block = snoozestore.load_account(acc.name)
    now = int(time.time())
    snoozestore.set_batch(key, None, acc.name)
    held = {m: {**r, "until": now, "batch": ""}
            for m, r in block["mails"].items() if r["batch"] == key}
    snoozestore.add_mails(held, acc.name)
    out = {"ok": True, "slot": "off", "returned": 0}
    if held:
        try:
            out["returned"] = release(acc, list(held), by="user")["returned"]
        except RuntimeError:
            pass          # busy: the next tick returns them (they are due)
    return out


def catch_batches(acc) -> int:
    """After a scan: hold every new inbox mail of a batch sender until its
    next slot. Returns how many mails were queued."""
    block = snoozestore.load_account(acc.name)
    if not block["batches"]:
        return 0
    inbox, uv, top = _inbox(acc)
    if inbox is None:
        return 0
    pinned = pinstore.load_account(acc.name)
    plist = _protected_list()
    skip = set(block["released"]) | pinned
    with acc.lock:
        mails = [m for m in acc.index.values() if m["folder"] == inbox]
        skip |= _taken(acc)
    queued = 0
    for key, b in block["batches"].items():
        if b["uv"] != uv:
            # a new UIDVALIDITY (or no baseline yet): what is there now is
            # not new - start counting from here
            snoozestore.set_batch(key, {**b, "uv": uv, "after": top},
                                  acc.name)
            continue
        if cfgmod.is_protected(key, plist):
            continue
        picks = []
        for m in mails:
            if m["addr"] == key and m["uid"] > b["after"] \
                    and m.get("msgid") and m["msgid"] not in skip:
                skip.add(m["msgid"])         # a twin id is held once
                picks.append(m)
        if not picks:
            continue
        until = next_slot(b["slot"], b["tz"], time.time())
        try:
            with acc.lock:
                _enqueue(acc, {inbox: {m["uid"] for m in picks}},
                         b["label"] or key, until,
                         {"pinned": 0, "protected": 0, "no_id": 0},
                         {m["msgid"]: m for m in picks},
                         batch=key, actor=ACTOR, quiet=True)
            queued += len(picks)
        except ValueError:
            log.warning("a batch could not hold new mail: the Snoozed store "
                        "is full (%d mails), it stays in the inbox",
                        snoozestore.MAX_MAILS)
        except RuntimeError:
            log.info("a batch is busy, tried again after the next scan")
    return queued


# ---------------------------------------------------------------- returning

def _records(block: dict, msgids=None, due: float | None = None) -> dict:
    return {m: r for m, r in block["mails"].items()
            if (msgids is None or m in msgids)
            and (due is None or r["until"] <= due)}


def release(acc, msgids=None, *, due: float | None = None,
            by: str = "user") -> dict:
    """Move snoozed mails back to where they came from, unread. `msgids`
    names them, `due` takes the ones whose time is up (epoch s); `by` is the
    audit actor ("user" or ACTOR). Returns `{"returned": n, "gone": n,
    "batches": {key: n}}` (`gone`: no longer in the folder, dropped).
    Raises RuntimeError(BUSY_ACTION) while a move job runs or another return
    of this account is in progress (a tick, a scan, Back now and a batch
    switch may all want the same mails: one runs, never two), and NoFolder
    when the Snoozed folder cannot be found (nothing is dropped then)."""
    if not acc.release_lock.acquire(blocking=False):
        raise RuntimeError(mailops.BUSY_ACTION)
    try:
        return _release(acc, msgids, due, by)
    finally:
        acc.release_lock.release()


def _key_of(m: dict) -> str:
    """What names a mail in the Snoozed folder: its Message-ID, else its UID."""
    return m.get("msgid") or f"uid:{m['uid']}"


def _release(acc, msgids, due, by) -> dict:
    block = snoozestore.load_account(acc.name)
    chosen = _records(block, msgids, due)
    # asked for by name but not in the store: mail that sits in the folder
    # with no record (see `listing`); it goes back to the inbox
    extra = {m for m in (msgids or ()) if m not in block["mails"]}
    out: dict = {"returned": 0, "gone": 0, "batches": {}}
    if not chosen and not extra:
        return out
    with acc.lock:
        if mailops._job_running(acc):
            raise RuntimeError(mailops.BUSY_ACTION)
    conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    try:
        src = folder(conn, acc)
        if src is None:                 # keep the records: not "gone"
            raise NoFolder()
        uv, listed = mailops.refresh_role_index(conn, "snoozed", src, acc)
        there = {_key_of(m): m for m in listed}
        for m in listed:                # (a Message-ID, or the UID as well)
            there.setdefault(f"uid:{m['uid']}", m)
        vanished = [m for m in chosen if m not in there]
        if vanished:
            snoozestore.drop_mails(vanished, acc.name, returned=True)
            out["gone"] = len(vanished)
        wanted = {m: r for m, r in chosen.items() if m in there}
        for key in extra:
            if key in there:
                m = there[key]
                wanted[key] = {"origin": "", "until": 0, "tries": 0,
                               "batch": "", "addr": m.get("addr", ""),
                               "name": m.get("name", "")}
        if not wanted:
            return out
        uid_of = {k: there[k]["uid"] for k in wanted}
        conn.select(mailops.quote_folder(src), readonly=False)
        uids = sorted(uid_of.values())
        for start in range(0, len(uids), mailops.MOVE_CHUNK):
            conn.uid("STORE", ",".join(map(str, uids[start:start + mailops.MOVE_CHUNK])),
                     "-FLAGS", r"(\Seen)")
        inbox = next((f for f in mailops.selectable_folders(conn)
                      if f.upper() == "INBOX"), None)
        folders = set(mailops.selectable_folders(conn))
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    by_dest: dict[str, list[str]] = {}
    for mid, rec in wanted.items():
        # the folder it came from - the inbox when that is gone, or when it
        # has refused the mail MAX_TRIES times (a full or read-only folder)
        dest = rec["origin"] if rec["origin"] in folders \
            and rec["tries"] < MAX_TRIES else inbox
        if dest:
            by_dest.setdefault(dest, []).append(mid)
    done: list[str] = []
    error: Exception | None = None
    try:
        for dest, mids in by_dest.items():
            moved: dict[str, set[int]] = {}
            try:
                mailops._move_uids({src: {uid_of[m] for m in mids}}, "move",
                                   dest, acc, moved_uids=moved)
            finally:
                back = moved.get(src, set())
                got = [m for m in mids if uid_of[m] in back]
                if got:
                    mailops.role_drop("snoozed", src, back, acc)
                    snoozestore.drop_mails(
                        [m for m in got if not m.startswith("uid:")],
                        acc.name, returned=True)
                    done.extend(got)
    except Exception as exc:                  # fold in what DID return
        error = exc
    if error:
        # what did not come back keeps its record and counts the failure;
        # after MAX_TRIES it is sent to the inbox instead of the same folder
        failed = [m for m in wanted if m not in done and m in block["mails"]]
        snoozestore.bump_tries(failed, acc.name)
        snoozestore.retarget(
            [m for m in failed if inbox and block["mails"][m]["origin"]
             != inbox and block["mails"][m]["tries"] + 1 >= MAX_TRIES],
            inbox, acc.name)
    for mid in done:
        key = wanted[mid]["batch"]
        if key:
            out["batches"][key] = out["batches"].get(key, 0) + 1
    out["returned"] = len(done)
    if done:
        label = ", ".join(dict.fromkeys(
            wanted[m]["name"] or wanted[m]["addr"] for m in done))[:200]
        auditlog.record("snooze_return", actor=by, account=acc.name,
                        count=len(done),
                        size=0, label=label,
                        outcome="error" if error else "ok",
                        error=mailops.error_text(error) if error else "")
        log.info("%d snoozed mails are back", len(done))
        _rescan(acc)
    if error:
        raise error
    return out


def _rescan(acc) -> None:
    """The mails are back under new UIDs: a scan shows them."""
    try:
        mailops.start_scan(acc)
    except RuntimeError:
        pass                                    # busy: the next scan will


def release_due(acc, now: float | None = None) -> dict:
    """The scheduler's step: whatever is due returns, a batch with one push
    to the person ("Your <sender> batch is here: N mails")."""
    now = time.time() if now is None else now
    out = release(acc, due=now, by=ACTOR)
    block = snoozestore.load_account(acc.name)
    for key, n in out["batches"].items():
        label = (block["batches"].get(key) or {}).get("label") or key
        webpush.job_finished(acc, "batch", True, n=n, label=label)
    return out


# (tenant, account) -> when a return that failed may be tried again: a
# folder that keeps refusing mail is not retried (and logged) every minute
_RETRY_AT: dict[tuple[str, str], float] = {}


def _tick_account(name: str, now: float) -> None:
    key = (tenants.current().id, name)
    try:
        release_due(accounts.get(name), now)
        _RETRY_AT.pop(key, None)
    except RuntimeError as exc:
        if not str(exc).startswith(mailops.BUSY_ACTION):
            _RETRY_AT[key] = now + RETRY_AFTER
        log.info("[%s] snooze tick: %s", name, exc)
    except Exception:
        _RETRY_AT[key] = now + RETRY_AFTER
        log.exception("[%s] snooze tick failed", name)


def tick() -> list[threading.Thread]:
    """Every scheduler minute, in the current tenant: return what is due, in
    each account that has something due. The IMAP work and the push run on a
    daemon thread per account (never waited on: a slow or unreachable server
    must not delay the auto-scans of the other accounts and tenants); the
    threads are returned for tests. A busy / unreachable account waits for
    the next tick. (In the in-browser demo the thread shim runs it inline.)"""
    now = time.time()
    tenant = tenants.current()
    started: list[threading.Thread] = []
    for name in accounts.names():
        if not _records(snoozestore.load_account(name), None, now):
            continue
        if _RETRY_AT.get((tenant.id, name), 0) > now:
            continue                      # it failed a moment ago
        try:
            if accounts.get(name).release_lock.locked():
                continue                  # the last return is still going
        except KeyError:
            continue
        worker = threading.Thread(
            target=tenants.call_in, args=(tenant, _tick_account, name, now),
            daemon=True)
        worker.start()
        started.append(worker)
    return started


def after_scan(acc) -> None:
    """A scan finished: forget snoozed mails another client moved away, hold
    what the batches catch, return what is due. Never raises."""
    try:
        block = snoozestore.load_account(acc.name)
        if block["released"]:
            snoozestore.prune_released(_inbox_ids(acc), acc.name)
        if block["mails"]:
            try:
                _verify(acc)
            except RuntimeError as exc:       # no folder: keep the records
                log.info("snooze after the scan: %s", exc)
        catch_batches(acc)
        if _records(snoozestore.load_account(acc.name), None, time.time()):
            try:
                release_due(acc)
            except RuntimeError as exc:       # busy (a job was just queued):
                log.info("snooze after the scan: %s", exc)
    except Exception:
        log.exception("snooze after the scan failed")


def _inbox_ids(acc) -> set[str]:
    """The Message-IDs of the inbox mails the last scan found."""
    inbox, _, _ = _inbox(acc)
    with acc.lock:
        return {m["msgid"] for m in acc.index.values()
                if m["folder"] == inbox and m.get("msgid")}


def _verify(acc) -> list[dict] | None:
    """Drop the store's mails that are no longer in `Snoozed`; the live
    listing of the rest. Reads the store BEFORE it lists the folder, so a
    record a running snooze job files meanwhile is never taken for a gone
    mail, and does nothing at all (None) while a move job runs: its records
    are filed before its mails move. Raises NoFolder when the folder cannot be
    found (nothing is dropped but the records of moves that never began).
    A record whose move was not seen to finish (`pending`: a restart in the
    middle) is settled by what the folder holds: confirmed when its mail is
    there, dropped - as never held - when it is not."""
    with acc.lock:
        if mailops._job_running(acc):
            return None
    block = snoozestore.load_account(acc.name)["mails"]
    known = list(block)
    pending = {m for m, r in block.items() if r["pending"]}
    conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    try:
        src = folder(conn, acc)
        if src is None:
            if pending:                 # no folder: those moves never began
                snoozestore.drop_mails(list(pending), acc.name)
            raise NoFolder()
        _, listed = mailops.refresh_role_index(conn, "snoozed", src, acc)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    here = {m["msgid"] for m in listed if m.get("msgid")}
    gone = [m for m in known if m not in here]
    if gone:
        snoozestore.drop_mails([m for m in gone if m not in pending],
                               acc.name, returned=True)
        snoozestore.drop_mails([m for m in gone if m in pending], acc.name)
    snoozestore.confirm([m for m in known if m in here], acc.name)
    return listed


# ------------------------------------------------------------------- page

def listing(acc, now: float | None = None) -> dict:
    """The Snoozed page: `batches` (a sender's batch and what it holds so
    far) and `rows` (snoozed mails: one row per sender and return time, or
    the subject for a single mail), soonest first. Looks at the server first
    (a mail another client moved is dropped); an unreachable server shows
    what the store remembers."""
    now = time.time() if now is None else now
    stale = no_folder = False
    listed: list[dict] | None = None
    try:
        listed = _verify(acc)
    except NoFolder:
        stale = no_folder = True        # the records stay, the page says so
    except Exception:
        log.exception("could not check the Snoozed folder")
        stale = True
    block = snoozestore.load_account(acc.name)
    held: dict[str, list[tuple[str, dict]]] = {}
    groups: dict[tuple[str, int], list[tuple[str, dict]]] = {}
    for mid, rec in block["mails"].items():
        if rec["batch"] and rec["batch"] in block["batches"]:
            held.setdefault(rec["batch"], []).append((mid, rec))
        else:
            groups.setdefault((rec["addr"], rec["until"]), []).append(
                (mid, rec))
    batches = [{"key": key, "label": b["label"] or key, "slot": b["slot"],
                "tz": b["tz"], "held": len(held.get(key, [])),
                "next": next_slot(b["slot"], b["tz"], now),
                "msgids": [m for m, _ in held.get(key, [])][:HOLD_CHUNK]}
               for key, b in sorted(block["batches"].items())]
    rows = []
    for (addr, until), items in sorted(groups.items(),
                                       key=lambda kv: (kv[0][1], kv[0][0])):
        first = items[0][1]
        kinds = Counter(r["kind"] for _, r in items if r.get("kind"))
        rows.append({"kind": "mail" if len(items) == 1 else "sender",
                     "addr": addr, "label": first["name"] or addr,
                     "count": len(items), "until": until,
                     "subject": first["subject"] if len(items) == 1 else "",
                     "what": kinds.most_common(1)[0][0] if kinds else "",
                     "msgids": [m for m, _ in items][:HOLD_CHUNK]})
    raw = acc.folder_roles.get("snoozed")
    # mail that sits in the folder with no record (a record lost, or mail put
    # there by hand): shown, with Back now to the inbox - never invisible
    known = set(block["mails"])
    lost: dict[str, list[tuple[str, dict]]] = {}
    for m in listed or ():
        if _key_of(m) not in known:
            lost.setdefault(m.get("addr") or "", []).append((_key_of(m), m))
    n_lost = 0
    for addr, items in sorted(lost.items()):
        first = items[0][1]
        n_lost += len(items)
        rows.append({"kind": "unrecorded", "addr": addr,
                     "label": first.get("name") or addr or first.get(
                         "subject", ""),
                     "count": len(items), "until": 0,
                     "subject": first.get("subject", "")
                     if len(items) == 1 else "", "what": "",
                     "msgids": [k for k, _ in items][:HOLD_CHUNK]})
    return {"count": len(block["mails"]) + n_lost, "batches": batches,
            "rows": rows, "folder": mailops.decode_mutf7(raw) if raw else FOLDER,
            "stale": stale, "no_folder": no_folder, "now": int(now)}
