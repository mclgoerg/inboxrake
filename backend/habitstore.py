"""Senders the user answered "Not this one" to in "You keep doing this"
(backend/habits.py): never suggested again, until they are shown again from
Settings > General > Hidden suggestions.

Per tenant and strictly per account (a decision about one mailbox's habit),
mirroring pinstore.py: per-tenant file, atomic write, tolerant read,
per-tenant cache. A sender is named by its sender-group key (the address).

File shape: {"accounts": {name: [sender key, ...]}}. Anything that does not
fit is ignored on read - a damaged file only forgets what it cannot read
(older releases never look at this file).
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import accounts
from . import tenants

HIDDEN_PATH = Path(os.environ.get("HABITS_PATH", "/data/habit_hidden.json"))

MAX_KEYS = 500          # per account
KEY_MAX = 200

_LOCK = threading.Lock()
_cache: dict[str, dict[str, list[str]]] = {}


def valid_key(key) -> bool:
    return (isinstance(key, str) and 0 < len(key) <= KEY_MAX
            and not any(ord(c) < 32 for c in key))


def _path() -> Path:
    return tenants.current().file("habit_hidden.json", HIDDEN_PATH)


def _read() -> dict[str, list[str]]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    return {name: [k for k in keys if valid_key(k)][:MAX_KEYS]
            for name, keys in accs.items()
            if isinstance(name, str) and isinstance(keys, list)}


def _load() -> dict[str, list[str]]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, list[str]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"accounts": {n: k for n, k in data.items()
                                            if k}}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def hidden(account: str | None = None) -> set[str]:
    """The sender keys hidden in one account (a copy)."""
    account = account or accounts.default_name()
    with _LOCK:
        return set(_load().get(account, ()))


def hide(key: str, account: str | None = None) -> bool:
    """Hide one sender. False when the key is not acceptable."""
    if not valid_key(key):
        return False
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        mine = list(data.get(account, ()))
        if key not in mine:
            mine.append(key)
            _persist({**data, account: mine[-MAX_KEYS:]})
    return True


def show_all(account: str | None = None) -> int:
    """Show every hidden sender of one account again; how many were hidden."""
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        n = len(data.get(account, ()))
        if n:
            _persist({k: v for k, v in data.items() if k != account})
        return n


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
