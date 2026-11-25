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
    catch it again.

Nothing here uses AI, and nothing is deleted: every step is a reversible
move.
"""

from __future__ import annotations

import datetime
import logging
import time
from zoneinfo import ZoneInfo

from . import accountcopy
from . import accounts
from . import auditlog
from . import config as cfgmod
from . import mailops
from . import pinstore
from . import snoozestore
from . import tenants
from . import webpush

log = logging.getLogger("inboxrake.snooze")

FOLDER = "Snoozed"
ACTION = "snooze"                   # the job-queue action (mailops.JOB_ACTIONS)
ACTOR = "snooze"                    # who the automatic steps are (audit log)
WEEKLY = (5, 9, 0)                  # a weekly batch: Saturday (Mon = 0) 09:00
DAILY = (18, 0)                     # a daily batch: 18:00
MAX_AHEAD_DAYS = 800                # the furthest "Pick a date" may reach
LABEL_SENDERS = 3                   # senders named in an undo / audit label
HOLD_CHUNK = 500


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


def folder(conn, acc, create: bool = False) -> str | None:
    """Raw name of the account's `Snoozed` folder; with `create`, made on
    first use (under the server's personal namespace where it announces one).
    None when there is none and `create` is off."""
    found = mailops.resolve_roles(conn, acc)
    acc.folder_roles.update(found["roles"])
    name = found["roles"].get("snoozed")
    if name and not _gmail_system(name):
        return name
    if not create:
        return None
    pairs = mailops.list_folders_ex(conn)
    prefix, _ = accountcopy._layout(conn, pairs)
    new = prefix + FOLDER
    status, data = conn.create(mailops.quote_folder(new))
    text = b" ".join(d for d in (data or []) if isinstance(d, bytes))
    if status != "OK" and b"ALREADYEXISTS" not in text.upper():
        raise RuntimeError(mailops.coded(mailops.SNOOZE_CANNOT_CREATE,
                                         folder=FOLDER))
    acc.folder_roles["snoozed"] = new
    log.info("[%s] created the %r folder", acc.name, new)
    return new


# --------------------------------------------------------------- snoozing

def _protected_list() -> list:
    return cfgmod.normalize_protected(cfgmod.load_config().get("protected"))


def _remember(acc, until: int, batch: str = ""):
    """The `on_moved` hook of a snooze job: file what moved in the store."""
    def hook(meta: dict, copies: list[dict]) -> None:
        records = {}
        for src, by_uid in meta.items():
            for m in by_uid.values():
                if m.get("msgid"):
                    records[m["msgid"]] = {
                        "origin": src, "until": until, "addr": m["addr"],
                        "name": m.get("name", ""),
                        "subject": m.get("subject", ""), "batch": batch}
        snoozestore.add_mails(records, acc.name)
    return hook


def _plan(acc, picks: list[dict], explicit: bool) -> tuple[dict, dict]:
    """`({folder: {uid}}, skipped counts)` of the index entries `picks`:
    pinned mails never, protected senders' mails unless `explicit` (one mail
    named by hand), mails without a Message-ID cannot be tracked."""
    pinned = pinstore.load_account(acc.name)
    plist = _protected_list()
    by_folder: dict[str, set[int]] = {}
    skipped = {"pinned": 0, "protected": 0, "no_id": 0}
    for m in picks:
        if not m.get("msgid"):
            skipped["no_id"] += 1
        elif m["msgid"] in pinned:
            skipped["pinned"] += 1
        elif not explicit and cfgmod.is_protected(m["addr"], plist):
            skipped["protected"] += 1
        else:
            by_folder.setdefault(m["folder"], set()).add(m["uid"])
    return by_folder, skipped


def _enqueue(acc, by_folder: dict, label: str, until: int, skipped: dict,
             batch: str = "", actor: str = "user",
             quiet: bool = False) -> dict:
    """Queue the move (acc.lock held)."""
    n = sum(len(s) for s in by_folder.values())
    if n:
        mailops._start_delete(by_folder, label, acc, ACTION,
                              "", actor, None, "", _remember(acc, until, batch),
                              quiet)
    return {"ok": True, "queued": n, "until": until,
            "skipped_pinned": skipped["pinned"],
            "skipped_protected": skipped["protected"],
            "skipped_no_id": skipped["no_id"]}


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
        by_folder, skipped = _plan(acc, picks, explicit=False)
        label = ", ".join(labels[:LABEL_SENDERS]) \
            + ("…" if len(labels) > LABEL_SENDERS else "")
        return _enqueue(acc, by_folder, label, until, skipped)


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
        by_folder, skipped = _plan(acc, picks, explicit=len(items) == 1)
        n = sum(len(s) for s in by_folder.values())
        return _enqueue(acc, by_folder, f"{n} selected mails", until, skipped)


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
    skip = set(block["released"]) | set(block["mails"]) | pinned
    with acc.lock:
        mails = [m for m in acc.index.values() if m["folder"] == inbox]
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
        picks = [m for m in mails if m["addr"] == key and m["uid"] > b["after"]
                 and m.get("msgid") and m["msgid"] not in skip]
        if not picks:
            continue
        until = next_slot(b["slot"], b["tz"], time.time())
        try:
            with acc.lock:
                _enqueue(acc, {inbox: {m["uid"] for m in picks}},
                         b["label"] or key, until,
                         {"pinned": 0, "protected": 0, "no_id": 0},
                         batch=key, actor=ACTOR, quiet=True)
            queued += len(picks)
        except RuntimeError:
            log.info("[%s] batch %r: busy, tried again after the next scan",
                     acc.name, key)
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
    Raises RuntimeError(BUSY_ACTION) while a move job runs."""
    chosen = _records(snoozestore.load_account(acc.name), msgids, due)
    out: dict = {"returned": 0, "gone": 0, "batches": {}}
    if not chosen:
        return out
    with acc.lock:
        if mailops._job_running(acc):
            raise RuntimeError(mailops.BUSY_ACTION)
    conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    try:
        src = folder(conn, acc)
        if src is None:                       # no folder: nothing waits
            snoozestore.drop_mails(list(chosen), acc.name)
            out["gone"] = len(chosen)
            return out
        uv, listed = mailops.refresh_role_index(conn, "snoozed", src, acc)
        uid_of = {m["msgid"]: m["uid"] for m in listed if m.get("msgid")}
        vanished = [m for m in chosen if m not in uid_of]
        if vanished:
            snoozestore.drop_mails(vanished, acc.name, returned=True)
            out["gone"] = len(vanished)
        wanted = {m: r for m, r in chosen.items() if m in uid_of}
        if not wanted:
            return out
        conn.select(mailops.quote_folder(src), readonly=False)
        uids = sorted(uid_of[m] for m in wanted)
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
        dest = rec["origin"] if rec["origin"] in folders else inbox
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
                    snoozestore.drop_mails(got, acc.name, returned=True)
                    done.extend(got)
    except Exception as exc:                  # fold in what DID return
        error = exc
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
        log.info("[%s] %d snoozed mails are back", acc.name, len(done))
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


def tick() -> None:
    """Every scheduler minute, in the current tenant: return what is due, in
    each account that has something due. A busy / unreachable account waits
    for the next tick."""
    now = time.time()
    for name in accounts.names():
        block = snoozestore.load_account(name)
        if not _records(block, None, now):
            continue
        try:
            acc = accounts.get(name)
            release_due(acc, now)
        except RuntimeError as exc:
            log.info("[%s] snooze tick: %s", name, exc)
        except Exception:
            log.exception("[%s] snooze tick failed", name)


def after_scan(acc) -> None:
    """A scan finished: forget snoozed mails another client moved away, hold
    what the batches catch, return what is due. Never raises."""
    try:
        block = snoozestore.load_account(acc.name)
        if block["mails"]:
            _verify(acc)
        catch_batches(acc)
        if _records(snoozestore.load_account(acc.name), None, time.time()):
            release_due(acc)
    except Exception:
        log.exception("[%s] snooze after the scan failed", acc.name)


def _verify(acc) -> list[dict]:
    """Drop the store's mails that are no longer in `Snoozed`; the live
    listing of the rest."""
    conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    try:
        src = folder(conn, acc)
        listed = []
        if src is not None:
            _, listed = mailops.refresh_role_index(conn, "snoozed", src, acc)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    here = {m["msgid"] for m in listed if m.get("msgid")}
    block = snoozestore.load_account(acc.name)
    gone = [m for m in block["mails"] if m not in here]
    if gone:
        snoozestore.drop_mails(gone, acc.name, returned=src is not None)
    return listed


# ------------------------------------------------------------------- page

def listing(acc, now: float | None = None) -> dict:
    """The Snoozed page: `batches` (a sender's batch and what it holds so
    far) and `rows` (snoozed mails: one row per sender and return time, or
    the subject for a single mail), soonest first. Looks at the server first
    (a mail another client moved is dropped); an unreachable server shows
    what the store remembers."""
    now = time.time() if now is None else now
    stale = False
    try:
        _verify(acc)
    except Exception:
        log.exception("[%s] could not check the Snoozed folder", acc.name)
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
        rows.append({"kind": "mail" if len(items) == 1 else "sender",
                     "addr": addr, "label": first["name"] or addr,
                     "count": len(items), "until": until,
                     "subject": first["subject"] if len(items) == 1 else "",
                     "msgids": [m for m, _ in items][:HOLD_CHUNK]})
    return {"count": len(block["mails"]), "batches": batches, "rows": rows,
            "stale": stale, "now": int(now)}
