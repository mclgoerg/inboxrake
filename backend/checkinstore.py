"""What the Weekly check-in keeps (backend/checkin.py): the one notification
switch and which accounts the Monday push already went out for this week.

One per-tenant file, `checkin.json`:
  {"push": bool,                    # Settings > Notifications; default ON
   "week": "2026-11-23",            # the Monday the list below belongs to
   "done": [account, ...]}          # accounts handled for that week

`push` is ON until the person switches it off (the maintainer's decision: it
is on for everyone who has notifications set up; the push still needs a
registered device, so nobody without one hears anything). `week` / `done`
keep one account from being told twice in a week; a new Monday starts the list
over. Mirrors pinstore.py's persistence: per-tenant file, atomic write,
tolerant read - a damaged file only forgets what it cannot understand. The
file is new: an older image ignores it (and never sends the push).
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

from . import tenants

CHECKIN_PATH = Path(os.environ.get("CHECKIN_PATH", "/data/checkin.json"))
MAX_ACCOUNTS = 200

_LOCK = threading.Lock()
# per-tenant cache (keyed by tenant id): one tenant never sees another's data
_cache: dict[str, dict] = {}

_WEEK_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _path() -> Path:
    return tenants.current().file("checkin.json", CHECKIN_PATH)


def _clean(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    week = raw.get("week")
    done = raw.get("done")
    return {"push": raw.get("push") is not False,
            "week": week if isinstance(week, str) and _WEEK_RE.fullmatch(week)
            else "",
            "done": [a for a in done if isinstance(a, str) and a][:MAX_ACCOUNTS]
            if isinstance(done, list) else []}


def _read() -> dict:
    try:
        return _clean(json.loads(_path().read_text()))
    except (OSError, ValueError):
        return _clean(None)


def _load() -> dict:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def push_enabled() -> bool:
    """The Monday push switch of the current user (ON unless switched off)."""
    with _LOCK:
        return _load()["push"]


def set_push(on: bool) -> None:
    with _LOCK:
        data = dict(_load())
        if data["push"] == bool(on):
            return
        data["push"] = bool(on)
        _persist(data)


def handled(week: str) -> set[str]:
    """The accounts already dealt with for the week starting `week`."""
    with _LOCK:
        data = _load()
        return set(data["done"]) if data["week"] == week else set()


def mark_handled(week: str, account: str) -> None:
    with _LOCK:
        data = dict(_load())
        done = list(data["done"]) if data["week"] == week else []
        if account in done and data["week"] == week:
            return
        done.append(account)
        data.update(week=week, done=done[-MAX_ACCOUNTS:])
        _persist(data)


def rename_account(old: str, new: str) -> None:
    """A renamed account keeps its "already told this week" mark."""
    with _LOCK:
        data = dict(_load())
        if old in data["done"]:
            data["done"] = [new if a == old else a for a in data["done"]]
            _persist(data)


def drop_account(name: str) -> None:
    with _LOCK:
        data = dict(_load())
        if name in data["done"]:
            data["done"] = [a for a in data["done"] if a != name]
            _persist(data)
