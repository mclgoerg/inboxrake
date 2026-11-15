"""What the user decided about their addresses ("Your addresses").

Per tenant, per account (an address belongs to one mailbox; nothing is
shared across accounts):
  * `retired`  - addresses switched off at the alias service from here:
                 {address: {"ts": epoch, "alias_id": the service's id}},
  * `related`  - "Not a leak?": sender parties the user said belong to the
                 company the address was given to: {address: [party, ...]},
  * `main`     - the main address the last scan picked with ("" = unknown).

File shape: {"accounts": {name: {"retired": {...}, "related": {...}}}}.
Mirrors pinstore.py: per-tenant file, atomic write, tolerant read - a damaged
file only forgets what it cannot understand. An older image ignores the file.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import accounts
from . import tenants

ADDRESSES_PATH = Path(os.environ.get("ADDRESSES_PATH",
                                     "/data/addresses.json"))

_LOCK = threading.Lock()
_cache: dict[str, dict[str, dict]] = {}
# Bumped on every change: the page's cached report is valid for one value.
_rev = 0


def revision() -> int:
    return _rev


def _path() -> Path:
    return tenants.current().file("addresses.json", ADDRESSES_PATH)


def _clean(entry) -> dict:
    entry = entry if isinstance(entry, dict) else {}
    retired = {a: {"ts": int(v.get("ts") or 0),
                   "alias_id": str(v.get("alias_id") or "")}
               for a, v in (entry.get("retired") or {}).items()
               if isinstance(a, str) and isinstance(v, dict)}
    related = {a: sorted({p for p in ps if isinstance(p, str) and p})
               for a, ps in (entry.get("related") or {}).items()
               if isinstance(a, str) and isinstance(ps, list)}
    main = entry.get("main")
    return {"retired": retired,
            "related": {a: ps for a, ps in related.items() if ps},
            "main": main if isinstance(main, str) else None}


def _read() -> dict[str, dict]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    return {name: _clean(e) for name, e in accs.items()}


def _load() -> dict[str, dict]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, dict]) -> None:
    global _rev
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"accounts": {
        n: e for n, e in data.items()
        if e["retired"] or e["related"] or e["main"] is not None}}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data
    _rev += 1


def _entry(account: str) -> dict:
    return _load().get(account) or {"retired": {}, "related": {}, "main": None}


def retired(account: str | None = None) -> dict[str, dict]:
    account = account or accounts.default_name()
    with _LOCK:
        return {a: dict(v) for a, v in _entry(account)["retired"].items()}


def related(account: str | None = None) -> dict[str, set[str]]:
    account = account or accounts.default_name()
    with _LOCK:
        return {a: set(ps) for a, ps in _entry(account)["related"].items()}


def _change(account: str, mutate) -> None:
    data = _load()
    entry = _clean(_entry(account))
    mutate(entry)
    _persist({**data, account: entry})


def set_retired(address: str, alias_id: str, ts: int,
                account: str | None = None) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        _change(account, lambda e: e["retired"].__setitem__(
            address, {"ts": ts, "alias_id": alias_id}))


def clear_retired(address: str, account: str | None = None) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        if address in _entry(account)["retired"]:
            _change(account, lambda e: e["retired"].pop(address, None))


def add_related(address: str, parties: set[str],
                account: str | None = None) -> None:
    """The parties `address`'s owner said belong to the company it was
    given to (they stop counting as strangers)."""
    account = account or accounts.default_name()
    with _LOCK:
        _change(account, lambda e: e["related"].__setitem__(
            address, sorted(set(e["related"].get(address, ())) | parties)))


def set_related(address: str, parties: set[str],
                account: str | None = None) -> None:
    """Replace the marks of `address` (what an Undo restores)."""
    account = account or accounts.default_name()
    with _LOCK:
        def mutate(e):
            if parties:
                e["related"][address] = sorted(parties)
            else:
                e["related"].pop(address, None)
        _change(account, mutate)


def picked_main(account: str) -> str | None:
    """The main address the account's last scan picked receiving addresses
    with ("" = it had none, None = never recorded)."""
    with _LOCK:
        return _entry(account)["main"]


def set_picked_main(account: str, main: str) -> None:
    with _LOCK:
        if _entry(account)["main"] != main:
            _change(account, lambda e: e.__setitem__("main", main))


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
