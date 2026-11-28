"""What is snoozed, and which senders deliver in batches (backend/snooze.py).

Per tenant, per account: every snoozed mail (by Message-ID: where it came
from, when it comes back, who sent it, the subject for the single-mail row)
and every batch (a sender whose new mail is held and delivered together: the
slot and the user's time zone), plus the Message-IDs returned to
the inbox (a batch must not catch its own delivery again) - each one is
remembered while that mail still sits in the inbox, however many others have
returned since (`prune_released`). Mirrors
pinstore.py's persistence (per-tenant file, atomic write, tolerant read) and
like it stays STRICTLY per account.

The mails themselves wait in the account's `Snoozed` server folder; this file
only remembers where each one belongs. A record is written BEFORE its mail
moves (so a restart in the middle of a move strands nothing: the mail is in
the folder with its record, or still in the inbox with a record that the next
check drops). A mail gone from that folder (moved by another client) is
dropped from here by snooze.py, never trusted. The file also remembers WHICH
server folder Inboxrake made for the account (`folder`): only that one is the
Snoozed folder - a folder somebody else made, or one the server owns
(`\\Snoozed`), is never adopted by its name.

File shape: {"accounts": {name: {"folder": raw folder name or "", "mails":
{message-id: {"origin": folder, "until": epoch s, "addr": str, "name": str,
"subject": str, "kind": the kind of mail ("" = none, see mailkinds.py),
"batch": key or "", "tries": failed returns so far, "pending": true while
the move that files it has not been seen to finish}}, "batches": {key:
{"slot": "weekly" | "daily", "tz": IANA name, "label": str, "uv": int,
"after": int}}, "released": {message-id: epoch s}}}}. A damaged file only
forgets what it cannot understand.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

from . import accounts
from . import tenants

SNOOZE_PATH = Path(os.environ.get("SNOOZE_PATH", "/data/snoozed.json"))

SLOTS = ("weekly", "daily")
MAX_MAILS = 5000        # snoozed mails per account
MAX_BATCHES = 200       # batch senders per account
MAX_RELEASED = 50000    # sanity bound when READING a file; never a ring
RELEASED_GRACE = 86400  # s a returned id stays even if no scan has seen the
#                         mail back in the inbox yet (a scan may be mid-way)
TZ_PART = re.compile(r"[A-Za-z0-9_+\-]+")
KIND_RE = re.compile(r"[a-z_]*")

_LOCK = threading.Lock()

# Per-tenant cache (keyed by tenant id), like pinstore: the state payload
# never re-reads the file and never mixes tenants.
_cache: dict[str, dict[str, dict]] = {}


def valid_key(key) -> bool:
    return (isinstance(key, str) and 0 < len(key) <= 254
            and not any(ord(c) < 32 for c in key))


def valid_tz(tz) -> bool:
    """An IANA zone name: one to three `/`-separated parts of letters, digits
    and `_ + -` (checked part by part, so no pattern has to backtrack)."""
    if not isinstance(tz, str) or len(tz) > 64:
        return False
    parts = tz.split("/")
    return len(parts) <= 3 and all(TZ_PART.fullmatch(p) for p in parts)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _path() -> Path:
    return tenants.current().file("snoozed.json", SNOOZE_PATH)


def _clean_mail(msgid, rec) -> dict | None:
    if not (isinstance(msgid, str) and 0 < len(msgid) <= 300
            and isinstance(rec, dict)):
        return None
    origin, until = rec.get("origin"), rec.get("until")
    if not (isinstance(origin, str) and 0 < len(origin) <= 300
            and _is_int(until) and until > 0):
        return None
    text = lambda k, n: str(rec.get(k) or "")[:n]       # noqa: E731
    batch = rec.get("batch")
    kind = text("kind", 20)
    tries = rec.get("tries")
    return {"origin": origin, "until": until, "addr": text("addr", 254),
            "name": text("name", 100), "subject": text("subject", 150),
            "kind": kind if KIND_RE.fullmatch(kind) else "",
            "batch": batch if valid_key(batch) else "",
            "tries": tries if _is_int(tries) and 0 <= tries <= 1000 else 0,
            "pending": rec.get("pending") is True}


def _clean_batch(rec) -> dict | None:
    if not isinstance(rec, dict) or rec.get("slot") not in SLOTS \
            or not valid_tz(rec.get("tz")):
        return None
    uv, after = rec.get("uv"), rec.get("after")
    return {"slot": rec["slot"], "tz": rec["tz"],
            "label": str(rec.get("label") or "")[:100],
            "uv": uv if _is_int(uv) and uv >= 0 else 0,
            "after": after if _is_int(after) and after >= 0 else 0}


def _clean(raw) -> dict:
    """One account's block from whatever the file holds."""
    raw = raw if isinstance(raw, dict) else {}
    mails = {}
    if isinstance(raw.get("mails"), dict):
        for mid, rec in raw["mails"].items():
            if (c := _clean_mail(mid, rec)) is not None \
                    and len(mails) < MAX_MAILS:
                mails[mid] = c
    batches = {}
    if isinstance(raw.get("batches"), dict):
        for key, rec in raw["batches"].items():
            if valid_key(key) and (c := _clean_batch(rec)) is not None \
                    and len(batches) < MAX_BATCHES:
                batches[key] = c
    released: dict[str, int] = {}
    raw_rel = raw.get("released")
    if isinstance(raw_rel, list):                  # (a plain list: undated)
        raw_rel = {m: int(time.time()) for m in raw_rel
                   if isinstance(m, str)}
    if isinstance(raw_rel, dict):
        for mid, ts in raw_rel.items():
            if isinstance(mid, str) and 0 < len(mid) <= 300 and _is_int(ts):
                released[mid] = ts
    if len(released) > MAX_RELEASED:
        released = dict(sorted(released.items(), key=lambda kv: kv[1])
                        [-MAX_RELEASED:])
    folder = raw.get("folder")
    return {"folder": folder if isinstance(folder, str)
            and 0 < len(folder) <= 300 else "",
            "mails": mails, "batches": batches, "released": released}


def _read() -> dict[str, dict]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    return {name: _clean(block) for name, block in accs.items()
            if isinstance(name, str)}


def _load() -> dict[str, dict]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, dict]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"accounts": {
        n: b for n, b in data.items()
        if b["mails"] or b["batches"] or b["released"] or b["folder"]}}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> dict:
    """One account's block (a deep-enough copy - safe to keep)."""
    account = account or accounts.default_name()
    with _LOCK:
        block = _load().get(account) or _clean({})
        return json.loads(json.dumps(block))


def _update(account: str | None, change) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        block = json.loads(json.dumps(data.get(account) or _clean({})))
        before = json.dumps(block, sort_keys=True)
        change(block)
        if json.dumps(block, sort_keys=True) != before:
            _persist({**data, account: _clean(block)})


def add_mails(records: dict[str, dict], account: str | None = None) -> int:
    """Remember snoozed mails: {message-id: {origin, until, addr, name,
    subject, batch}}. A record that does not fit is ignored; returns how many
    were stored (a full store takes no more)."""
    stored = []

    def change(b):
        for mid, rec in records.items():
            c = _clean_mail(mid, rec)
            if c is not None and (mid in b["mails"]
                                  or len(b["mails"]) < MAX_MAILS):
                b["mails"][mid] = c
                stored.append(mid)
    _update(account, change)
    return len(stored)


def drop_mails(msgids, account: str | None = None,
               returned: bool = False) -> int:
    """Forget snoozed mails. `returned`: they went back to the inbox (or were
    moved there by another client) - remember their Message-IDs so a batch
    does not catch them again (until `prune_released` sees them leave the
    inbox). Returns how many were known."""
    gone = []
    now = int(time.time())

    def change(b):
        for mid in msgids:
            if b["mails"].pop(mid, None) is not None:
                gone.append(mid)
            if returned:
                b["released"][mid] = now
    _update(account, change)
    return len(gone)


def prune_released(present, account: str | None = None,
                   now: float | None = None) -> int:
    """Forget the returned Message-IDs of mails no longer in the inbox
    (`present`: the Message-IDs a fresh scan found there) - but only once
    `RELEASED_GRACE` has passed, so a scan that started before a return
    cannot make its delivery look new. Never by count. Returns how many."""
    now = time.time() if now is None else now
    dropped = []

    def change(b):
        for mid, ts in list(b["released"].items()):
            if mid not in present and now - ts >= RELEASED_GRACE:
                del b["released"][mid]
                dropped.append(mid)
    _update(account, change)
    return len(dropped)


def folder_of(account: str | None = None) -> str:
    """The raw name of the Snoozed folder Inboxrake made for the account ("" =
    none yet)."""
    account = account or accounts.default_name()
    with _LOCK:
        return (_load().get(account) or _clean({}))["folder"]


def set_folder(name: str, account: str | None = None) -> None:
    """Remember the folder Inboxrake made (or, for a store that predates this
    record, the one it has been using)."""
    def change(b):
        b["folder"] = name
    _update(account, change)


def confirm(msgids, account: str | None = None) -> None:
    """These mails were seen in the Snoozed folder: their records are no
    longer pending."""
    def change(b):
        for mid in msgids:
            if mid in b["mails"]:
                b["mails"][mid]["pending"] = False
    _update(account, change)


def bump_tries(msgids, account: str | None = None) -> None:
    """A return of these mails failed once more."""
    def change(b):
        for mid in msgids:
            if mid in b["mails"]:
                b["mails"][mid]["tries"] = min(1000, b["mails"][mid]["tries"] + 1)
    _update(account, change)


def retarget(msgids, origin: str, account: str | None = None) -> None:
    """These mails go back to `origin` from now on (the inbox, once the folder
    they came from keeps refusing them), with a fresh count of tries."""
    def change(b):
        for mid in msgids:
            if mid in b["mails"]:
                b["mails"][mid]["origin"] = origin
                b["mails"][mid]["tries"] = 0
    _update(account, change)


def count(account: str | None = None) -> int:
    """How many mails the account's store holds."""
    account = account or accounts.default_name()
    with _LOCK:
        return len((_load().get(account) or _clean({}))["mails"])


def set_batch(key: str, batch: dict | None,
              account: str | None = None) -> None:
    """Create / replace the batch of one sender; None removes it."""
    if not valid_key(key):
        raise ValueError("bad key")

    def change(b):
        if batch is None:
            b["batches"].pop(key, None)
        elif key in b["batches"] or len(b["batches"]) < MAX_BATCHES:
            b["batches"][key] = batch
    _update(account, change)


def summary(account: str | None = None) -> dict:
    """What the state payload shows: `count` snoozed mails, `until` (the
    soonest return of each sender's snoozed mails, by address), `mails` (how
    many each sender has snoozed, for the sender pane's line) and `batches`
    ({address: slot}). Small: a count and three maps."""
    account = account or accounts.default_name()
    with _LOCK:                    # read in place: the state ticks every second
        block = _load().get(account) or _clean({})
        until: dict[str, int] = {}
        mails: dict[str, int] = {}
        for rec in block["mails"].values():
            a = rec["addr"]
            if a:
                mails[a] = mails.get(a, 0) + 1
                if a not in until or rec["until"] < until[a]:
                    until[a] = rec["until"]
        return {"count": len(block["mails"]), "until": until, "mails": mails,
                "batches": {k: b["slot"] for k, b in block["batches"].items()}}


def remap_origins(fn, account: str | None = None) -> int:
    """A folder was renamed or merged (Your folders): the snoozed mails that
    were to go back to it follow it. `fn(name)` gives the folder's new name.
    Returns how many records changed."""
    changed = []

    def change(b):
        for mid, rec in b["mails"].items():
            new = fn(rec["origin"])
            if new != rec["origin"]:
                rec["origin"] = new
                changed.append(mid)
    _update(account, change)
    return len(changed)


def rename_account(old: str, new: str) -> None:
    with _LOCK:
        data = _load()
        if old in data:
            moved = {k: v for k, v in data.items() if k != old}
            moved[new] = data[old]
            _persist(moved)


def drop_account(name: str) -> None:
    with _LOCK:
        data = _load()
        if name in data:
            _persist({k: v for k, v in data.items() if k != name})
