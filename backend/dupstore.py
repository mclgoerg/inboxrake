"""Duplicate sets the user chose to keep ("Keep all" on the Duplicates page).

    {"version": 1, "accounts": {<account>: {
        "identical": [<set key>, ...], "versions": [...], "possible": [...]}}}

A set key is what mailops._dup_key derives from the set: the shared
Message-ID for identical / versions sets, a digest of the members' ids for
possible ones (see there). A dismissed set stays out of the three duplicate
lists and of the summary until the user restores it - and so also out of the
one-tap "Remove N copies", which only ever acts on what the page lists.
Hiding a set never touches a mail.

Strictly per account, like pins and labels. Mirrors pinstore.py's persistence
(per-tenant file, atomic write, tolerant read, mode 0600, one in-process
lock): a damaged file only forgets what it cannot read. A key is a Message-ID
(private data), so it is never logged.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

from . import accounts
from . import tenants

DUPS_PATH = Path(os.environ.get("DUPS_PATH", "/data/duplicates_kept.json"))
VERSION = 1
KINDS = ("identical", "versions", "possible")
MAX_KEYS = 5000        # per account and kind; the oldest are forgotten first
KEY_MAX = 400          # a stored Message-ID is cut at 300

_LOCK = threading.Lock()
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

# Per-tenant cache (keyed by tenant id), like pinstore: the list endpoints
# never re-read the file, and one tenant's choices never reach another.
_cache: dict[str, dict[str, dict[str, list[str]]]] = {}


def _path() -> Path:
    return tenants.current().file("duplicates_kept.json", DUPS_PATH)


def valid(kind, key) -> bool:
    return kind in KINDS and isinstance(key, str) \
        and 0 < len(key) <= KEY_MAX and not _CONTROL.search(key)


def _read() -> dict[str, dict[str, list[str]]]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    out: dict[str, dict[str, list[str]]] = {}
    for name, kinds in (accs if isinstance(accs, dict) else {}).items():
        if not isinstance(kinds, dict):
            continue
        mine = {}
        for kind in KINDS:
            keys = kinds.get(kind)
            if isinstance(keys, list):
                good = [k for k in dict.fromkeys(keys) if valid(kind, k)]
                if good:
                    mine[kind] = good[-MAX_KEYS:]
        if mine:
            out[name] = mine
    return out


def _load() -> dict[str, dict[str, list[str]]]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, dict[str, list[str]]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": VERSION, "accounts": {
        n: k for n, k in data.items() if k}}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> dict[str, set[str]]:
    """{kind: {set key}} of one account (a copy - safe to keep)."""
    account = account or accounts.default_name()
    with _LOCK:
        return {k: set(v) for k, v in _load().get(account, {}).items()}


def dismiss(kind: str, key: str, account: str | None = None) -> bool:
    """Hide one set. False = it was hidden already; ValueError on a bad
    kind / key (nothing is written)."""
    if not valid(kind, key):
        raise ValueError("bad_duplicate_set")
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        keys = list(data.get(account, {}).get(kind, ()))
        if key in keys:
            return False
        keys.append(key)
        _persist({**data, account: {**data.get(account, {}),
                                    kind: keys[-MAX_KEYS:]}})
        return True


def restore(kind: str, key: str, account: str | None = None) -> bool:
    """Show one hidden set again. False = it was not hidden."""
    if not valid(kind, key):
        raise ValueError("bad_duplicate_set")
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        mine = data.get(account, {})
        if key not in mine.get(kind, ()):
            return False
        left = [k for k in mine[kind] if k != key]
        rest = {k: v for k, v in mine.items() if k != kind}
        _persist({**data, account: {**rest, kind: left} if left else rest})
        return True


def restore_all(account: str | None = None) -> int:
    """Show every hidden set of the account again; returns how many keys
    were stored."""
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        n = sum(len(v) for v in data.get(account, {}).values())
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
