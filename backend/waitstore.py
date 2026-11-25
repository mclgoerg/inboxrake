"""What "Waiting for a reply" keeps (backend/waiting.py).

Two per-tenant files, both STRICTLY per account like pins and subscriptions
(a decision about one mailbox must never reach another one). Mirrors
pinstore.py's persistence: per-tenant file, atomic write, tolerant read - a
damaged file only forgets what it cannot understand.

`waiting.json` is what the user decided:
  {"accounts": {name: {"track": bool, "days": 2|3|7,
                       "needed": [message-id],
                       "reminders": {message-id: {"at": epoch, "fired": epoch|0}}}}}

`sent_index.json` is the index of the Sent folder the matcher works on (headers
only, the last INDEX_DAYS days; no mail text is ever read or kept):
  {"accounts": {name: {"folder": str, "uv": int, "ts": epoch,
                       "mails": [{"uid", "id", "ts", "subj", "from",
                                  "to": [[address, name]], "irt": [id],
                                  "refs": [id]}]}}}

Both are new files: an older image ignores them.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

from . import accounts
from . import tenants

WAITING_PATH = Path(os.environ.get("WAITING_PATH", "/data/waiting.json"))
SENT_INDEX_PATH = Path(os.environ.get("SENT_INDEX_PATH",
                                      "/data/sent_index.json"))

INDEX_DAYS = 90
DAY_CHOICES = (2, 3, 7)
DEFAULT_DAYS = 3
MAX_NEEDED = 2000        # "No answer needed" marks per account
MAX_REMINDERS = 200
MAX_MAILS = 20000        # sent mails kept per account
ID_MAX = 300

_LOCK = threading.Lock()

# Per-tenant caches (keyed by tenant id), like pinstore: the page never reads
# a file per request and one tenant never sees another's data.
_cache: dict[str, dict[str, dict]] = {}
_index_cache: dict[str, dict[str, dict]] = {}


def _path() -> Path:
    return tenants.current().file("waiting.json", WAITING_PATH)


def _index_path() -> Path:
    return tenants.current().file("sent_index.json", SENT_INDEX_PATH)


def valid_id(value) -> bool:
    return (isinstance(value, str) and 0 < len(value) <= ID_MAX
            and not any(ord(c) < 32 for c in value))


def _int(value, default: int = 0) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) \
        else default


def _block(raw) -> dict:
    """One account's decisions from whatever the file holds."""
    raw = raw if isinstance(raw, dict) else {}
    needed = [i for i in raw.get("needed") or [] if valid_id(i)] \
        if isinstance(raw.get("needed"), list) else []
    reminders = {}
    if isinstance(raw.get("reminders"), dict):
        for i, r in raw["reminders"].items():
            if valid_id(i) and isinstance(r, dict) and _int(r.get("at")) > 0:
                reminders[i] = {"at": _int(r["at"]),
                                "fired": max(0, _int(r.get("fired")))}
    return {"track": raw.get("track") is not False,
            "days": raw["days"] if raw.get("days") in DAY_CHOICES
            else DEFAULT_DAYS,
            "needed": needed[:MAX_NEEDED],
            "reminders": dict(list(reminders.items())[:MAX_REMINDERS])}


def _read() -> dict[str, dict]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    return {n: _block(b) for n, b in accs.items() if isinstance(n, str)}


def _load() -> dict[str, dict]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.chmod(0o600)
    tmp.replace(path)


def _persist(data: dict[str, dict]) -> None:
    _write(_path(), {"accounts": data})
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> dict:
    """One account's decisions (a copy: safe to keep and to change)."""
    account = account or accounts.default_name()
    with _LOCK:
        b = _load().get(account) or _block({})
        return {"track": b["track"], "days": b["days"],
                "needed": list(b["needed"]),
                "reminders": {i: dict(r) for i, r in b["reminders"].items()}}


def _change(account: str, fn) -> bool:
    """Apply `fn(block)` to a copy of the account's block; written only when
    it changed."""
    with _LOCK:
        data = _load()
        mine = _block(data.get(account))
        before = json.dumps(mine, sort_keys=True)
        fn(mine)
        if json.dumps(mine, sort_keys=True) == before:
            return False
        _persist({**data, account: _block(mine)})
        return True


def set_settings(track: bool | None = None, days: int | None = None,
                 account: str | None = None) -> None:
    account = account or accounts.default_name()

    def fn(b):
        if track is not None:
            b["track"] = bool(track)
        if days in DAY_CHOICES:
            b["days"] = days
    _change(account, fn)


def set_needed(msgid: str, needed: bool, account: str | None = None) -> bool:
    """Mark one sent mail "No answer needed" (or bring it back)."""
    account = account or accounts.default_name()

    def fn(b):
        mine = [i for i in b["needed"] if i != msgid]
        b["needed"] = (mine + [msgid]) if needed else mine
        del b["needed"][:-MAX_NEEDED]
    return _change(account, fn)


def set_reminder(msgid: str, at: int | None,
                 account: str | None = None) -> bool:
    """Remind about one sent mail at `at` (epoch seconds); None clears it. A
    new time starts a fresh reminder (it fires once for each)."""
    account = account or accounts.default_name()

    def fn(b):
        if at is None:
            b["reminders"].pop(msgid, None)
        elif len(b["reminders"]) < MAX_REMINDERS or msgid in b["reminders"]:
            b["reminders"][msgid] = {"at": int(at), "fired": 0}
    return _change(account, fn)


def mark_fired(msgid: str, now: int, account: str | None = None) -> bool:
    """Note that a reminder went out; False when it already had (or is gone)."""
    account = account or accounts.default_name()
    done = []

    def fn(b):
        r = b["reminders"].get(msgid)
        if r is not None and not r["fired"]:
            r["fired"] = max(1, int(now))
            done.append(True)
    _change(account, fn)
    return bool(done)


def drop_reminders(msgids, account: str | None = None) -> int:
    """Forget reminders (their mail was answered or marked not needed)."""
    account = account or accounts.default_name()
    gone = set(msgids)
    n = []

    def fn(b):
        for i in list(b["reminders"]):
            if i in gone:
                del b["reminders"][i]
                n.append(i)
    _change(account, fn)
    return len(n)


# ------------------------------------------------------------- the index

def _clean_mail(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    uid, ts, mid = raw.get("uid"), raw.get("ts"), raw.get("id")
    if not (isinstance(uid, int) and isinstance(ts, int) and valid_id(mid)):
        return None
    to = []
    for pair in raw.get("to") or []:
        if isinstance(pair, list) and len(pair) == 2 \
                and isinstance(pair[0], str) and isinstance(pair[1], str):
            to.append([pair[0], pair[1]])
    ids = lambda v: [i for i in v or [] if valid_id(i)] \
        if isinstance(v, list) else []
    return {"uid": uid, "id": mid, "ts": ts,
            "subj": raw["subj"] if isinstance(raw.get("subj"), str) else "",
            "from": raw["from"] if isinstance(raw.get("from"), str) else "",
            "to": to, "irt": ids(raw.get("irt")), "refs": ids(raw.get("refs"))}


def _read_index() -> dict[str, dict]:
    try:
        data = json.loads(_index_path().read_text())
    except (OSError, ValueError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    out = {}
    for name, b in accs.items():
        if not (isinstance(name, str) and isinstance(b, dict)):
            continue
        mails = [m for m in (_clean_mail(x) for x in b.get("mails") or [])
                 if m] if isinstance(b.get("mails"), list) else []
        out[name] = {"folder": b["folder"] if isinstance(b.get("folder"), str)
                     else "", "uv": _int(b.get("uv")),
                     "ts": _int(b.get("ts")), "mails": mails[:MAX_MAILS]}
    return out


def _load_index() -> dict[str, dict]:
    tid = tenants.current().id
    if tid not in _index_cache:
        _index_cache[tid] = _read_index()
    return _index_cache[tid]


def _persist_index(data: dict[str, dict]) -> None:
    _write(_index_path(), {"accounts": data})
    _index_cache[tenants.current().id] = data


def load_index(account: str | None = None) -> dict:
    """The sent index of one account: {"folder", "uv", "ts", "mails"} (empty
    when there is none). The lists are shared with the cache: read only."""
    account = account or accounts.default_name()
    with _LOCK:
        return _load_index().get(account) or {"folder": "", "uv": 0,
                                              "ts": 0, "mails": []}


def save_index(folder: str, uv: int, mails: list[dict],
               account: str | None = None) -> None:
    account = account or accounts.default_name()
    kept = [m for m in (_clean_mail(x) for x in mails) if m][:MAX_MAILS]
    with _LOCK:
        data = _load_index()
        _persist_index({**data, account: {
            "folder": folder, "uv": int(uv), "ts": int(time.time()),
            "mails": kept}})


def drop_index(account: str | None = None) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        data = _load_index()
        if account in data:
            _persist_index({k: v for k, v in data.items() if k != account})


# ------------------------------------------------- account rename / drop

def rename_account(old: str, new: str) -> None:
    with _LOCK:
        for load, persist in ((_load, _persist),
                              (_load_index, _persist_index)):
            data = load()
            if old in data:
                moved = {k: v for k, v in data.items() if k != old}
                moved[new] = data[old]
                persist(moved)


def drop_account(name: str) -> None:
    with _LOCK:
        for load, persist in ((_load, _persist),
                              (_load_index, _persist_index)):
            data = load()
            if name in data:
                persist({k: v for k, v in data.items() if k != name})
