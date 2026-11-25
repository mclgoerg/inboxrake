"""What is snoozed, and which senders deliver in batches (backend/snooze.py).

Per tenant, per account: every snoozed mail (by Message-ID: where it came
from, when it comes back, who sent it, the subject for the single-mail row)
and every batch (a sender whose new mail is held and delivered together: the
slot and the user's time zone), plus the Message-IDs recently returned to
the inbox (a batch must not catch its own delivery again). Mirrors
pinstore.py's persistence (per-tenant file, atomic write, tolerant read) and
like it stays STRICTLY per account.

The mails themselves wait in the account's `Snoozed` server folder; this file
only remembers where each one belongs. A mail gone from that folder (moved by
another client) is dropped from here by snooze.py, never trusted.

File shape: {"accounts": {name: {"mails": {message-id: {"origin": folder,
"until": epoch s, "addr": str, "name": str, "subject": str, "batch": key or
""}}, "batches": {key: {"slot": "weekly" | "daily", "tz": IANA name, "label":
str, "uv": int, "after": int}}, "released": [message-id]}}}. A damaged file
only forgets what it cannot understand.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

from . import accounts
from . import tenants

SNOOZE_PATH = Path(os.environ.get("SNOOZE_PATH", "/data/snoozed.json"))

SLOTS = ("weekly", "daily")
MAX_MAILS = 5000        # snoozed mails per account
MAX_BATCHES = 200       # batch senders per account
MAX_RELEASED = 2000     # returned Message-IDs remembered per account
TZ_RE = re.compile(r"[A-Za-z0-9_+\-]+(?:/[A-Za-z0-9_+\-]+){0,2}")

_LOCK = threading.Lock()

# Per-tenant cache (keyed by tenant id), like pinstore: the state payload
# never re-reads the file and never mixes tenants.
_cache: dict[str, dict[str, dict]] = {}


def valid_key(key) -> bool:
    return (isinstance(key, str) and 0 < len(key) <= 254
            and not any(ord(c) < 32 for c in key))


def valid_tz(tz) -> bool:
    return isinstance(tz, str) and len(tz) <= 64 \
        and TZ_RE.fullmatch(tz) is not None


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
    return {"origin": origin, "until": until, "addr": text("addr", 254),
            "name": text("name", 100), "subject": text("subject", 150),
            "batch": batch if valid_key(batch) else ""}


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
    released = [m for m in raw.get("released") or []
                if isinstance(m, str) and 0 < len(m) <= 300] \
        if isinstance(raw.get("released"), list) else []
    return {"mails": mails, "batches": batches,
            "released": released[-MAX_RELEASED:]}


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
        if b["mails"] or b["batches"] or b["released"]}}))
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
    does not catch them again. Returns how many were known."""
    gone = []

    def change(b):
        for mid in msgids:
            if b["mails"].pop(mid, None) is not None:
                gone.append(mid)
            if returned:
                if mid in b["released"]:
                    b["released"].remove(mid)
                b["released"].append(mid)
        b["released"] = b["released"][-MAX_RELEASED:]
    _update(account, change)
    return len(gone)


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
    soonest return of each sender's snoozed mails, by address) and `batches`
    ({address: slot}). Small: a count and two maps."""
    account = account or accounts.default_name()
    with _LOCK:                    # read in place: the state ticks every second
        block = _load().get(account) or _clean({})
        until: dict[str, int] = {}
        for rec in block["mails"].values():
            a = rec["addr"]
            if a and (a not in until or rec["until"] < until[a]):
                until[a] = rec["until"]
        return {"count": len(block["mails"]), "until": until,
                "batches": {k: b["slot"] for k, b in block["batches"].items()}}


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
