"""What "Waiting for a reply" keeps (backend/waiting.py).

Two per-tenant files. The decisions are STRICTLY per account like pins and
subscriptions (a decision about one mailbox must never reach another one);
the notification settings are per user, like the push switch they hang under.
Mirrors pinstore.py's persistence: per-tenant file, atomic write, tolerant
read - a damaged file only forgets what it cannot understand.

`waiting.json` is what the user decided:
  {"settings": {"notify": bool, "notify_since": epoch,
                "mode": "usual" | "fixed", "days": 2|3|7, "subject": bool},
   "accounts": {name: {"watch": bool,
                       "needed": [message-id],
                       "alerted": {message-id: epoch},
                       "reminders": {message-id: {"at": epoch,
                                                  "fired": epoch|0}}}}}
`watch` (Settings > Account, per account) is OFF until it is switched on. A
file of an earlier, withdrawn version (a per-account "track" and "days") is
read with those keys ignored: nothing starts watching by itself.

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
MODES = ("usual", "fixed")       # "Overdue after": their usual time | fixed
DEFAULT_MODE = "usual"
MAX_NEEDED = 2000        # "No answer needed" marks per account
MAX_REMINDERS = 200
MAX_ALERTED = 500        # mails already announced as overdue, per account
MAX_MAILS = 20000        # sent mails kept per account
ID_MAX = 300

_LOCK = threading.Lock()

# Per-tenant caches (keyed by tenant id), like pinstore: the page never reads
# a file per request and one tenant never sees another's data.
_cache: dict[str, dict] = {}
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
    # reminders and announcements belong to a switch that was on: a block with
    # no `watch` key is one of the withdrawn first version, whose reminders
    # must not wake up when the switch is first turned on
    if "watch" in raw and isinstance(raw.get("reminders"), dict):
        for i, r in raw["reminders"].items():
            if valid_id(i) and isinstance(r, dict) and _int(r.get("at")) > 0:
                reminders[i] = {"at": _int(r["at"]),
                                "fired": max(0, _int(r.get("fired")))}
    alerted = {}
    if "watch" in raw and isinstance(raw.get("alerted"), dict):
        alerted = {i: _int(ts) for i, ts in raw["alerted"].items()
                   if valid_id(i) and _int(ts) > 0}
    return {"watch": raw.get("watch") is True,
            "needed": needed[:MAX_NEEDED],
            "alerted": dict(list(alerted.items())[-MAX_ALERTED:]),
            "reminders": dict(list(reminders.items())[:MAX_REMINDERS])}


def _settings(raw) -> dict:
    """The per-user notification settings from whatever the file holds."""
    raw = raw if isinstance(raw, dict) else {}
    return {"notify": raw.get("notify") is True,
            "notify_since": max(0, _int(raw.get("notify_since"))),
            "mode": raw["mode"] if raw.get("mode") in MODES
            else DEFAULT_MODE,
            "days": raw["days"] if raw.get("days") in DAY_CHOICES
            else DEFAULT_DAYS,
            "subject": raw.get("subject") is True}


def _read() -> dict:
    """{"settings": {...}, "accounts": {name: block}} from the file."""
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        data = None
    if not isinstance(data, dict):
        return {"settings": _settings(None), "accounts": {}}
    accs = data.get("accounts")
    return {"settings": _settings(data.get("settings")),
            "accounts": {n: _block(b) for n, b in accs.items()
                         if isinstance(n, str)}
            if isinstance(accs, dict) else {}}


def _load() -> dict:
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


def _persist(data: dict) -> None:
    _write(_path(), data)
    _cache[tenants.current().id] = data


def load_settings() -> dict:
    """The per-user notification settings (a copy)."""
    with _LOCK:
        return dict(_load()["settings"])


def load_account(account: str | None = None) -> dict:
    """One account's decisions (a copy: safe to keep and to change)."""
    account = account or accounts.default_name()
    with _LOCK:
        b = _load()["accounts"].get(account) or _block({})
        return {"watch": b["watch"], "needed": list(b["needed"]),
                "alerted": dict(b["alerted"]),
                "reminders": {i: dict(r) for i, r in b["reminders"].items()}}


def _change(account: str, fn) -> bool:
    """Apply `fn(block)` to a copy of the account's block; written only when
    it changed."""
    with _LOCK:
        data = _load()
        mine = _block(data["accounts"].get(account))
        before = json.dumps(mine, sort_keys=True)
        fn(mine)
        if json.dumps(mine, sort_keys=True) == before:
            return False
        _persist({**data,
                  "accounts": {**data["accounts"], account: _block(mine)}})
        return True


def set_watch(watch: bool, account: str | None = None) -> None:
    """Watch this account's sent mail for replies (off until switched on).
    Off also forgets the reminders and announcements: they are about mails of
    an index that is gone, and must not fire when the switch goes on again
    (the "No answer needed" marks are decisions and stay)."""
    account = account or accounts.default_name()

    def fn(b):
        b["watch"] = bool(watch)
        if not watch:
            b["reminders"] = {}
            b["alerted"] = {}
    _change(account, fn)


def set_settings(notify: bool | None = None, mode: str | None = None,
                 days: int | None = None, subject: bool | None = None,
                 now: float | None = None) -> bool:
    """Change the per-user notification settings; written only when one
    changed. Switching `notify` on notes the time: only mails that become
    overdue from then on are announced (a backlog never arrives as a burst)."""
    with _LOCK:
        data = _load()
        mine = dict(data["settings"])
        before = dict(mine)
        if notify is not None and bool(notify) != mine["notify"]:
            mine["notify"] = bool(notify)
            mine["notify_since"] = int(time.time() if now is None else now) \
                if notify else 0
        if mode in MODES:
            mine["mode"] = mode
        if days in DAY_CHOICES:
            mine["days"] = days
        if subject is not None:
            mine["subject"] = bool(subject)
        if mine == before:
            return False
        _persist({**data, "settings": _settings(mine)})
        return True


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


def mark_alerted(msgid: str, now: int, account: str | None = None) -> bool:
    """Note that "no answer yet" was announced for this mail; False when it
    already had been (an announcement goes out once)."""
    account = account or accounts.default_name()
    done = []

    def fn(b):
        if msgid not in b["alerted"]:
            b["alerted"][msgid] = max(1, int(now))
            done.append(True)
    _change(account, fn)
    return bool(done)


def drop_reminders(msgids, account: str | None = None) -> int:
    """Forget reminders and announcements (their mail was answered or marked
    not needed)."""
    account = account or accounts.default_name()
    gone = set(msgids)
    n = []

    def fn(b):
        for i in list(b["reminders"]):
            if i in gone:
                del b["reminders"][i]
                n.append(i)
        for i in list(b["alerted"]):
            if i in gone:
                del b["alerted"][i]
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
        data = _load()
        if old in data["accounts"]:
            moved = {k: v for k, v in data["accounts"].items() if k != old}
            moved[new] = data["accounts"][old]
            _persist({**data, "accounts": moved})
        idx = _load_index()
        if old in idx:
            moved = {k: v for k, v in idx.items() if k != old}
            moved[new] = idx[old]
            _persist_index(moved)


def drop_account(name: str) -> None:
    with _LOCK:
        data = _load()
        if name in data["accounts"]:
            _persist({**data, "accounts": {
                k: v for k, v in data["accounts"].items() if k != name}})
        idx = _load_index()
        if name in idx:
            _persist_index({k: v for k, v in idx.items() if k != name})
