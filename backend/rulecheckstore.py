"""What the user decided about the Rule checkup (backend/rulecheck.py).

Per tenant, per account: the findings they chose to Ignore, each named by its
FINGERPRINT (a hash of what the finding is about - the kind, the rules and
what was found: their definitions, the missing folder, the report's date -
never a name, an address or a subject). When that changes (a rule is edited,
the target folder is another, a newer report has aged) it is a new finding
and shows again; "Show again" forgets an ignore.

Mirrors substore.py's persistence (per-tenant file, atomic write, tolerant
read, per-tenant cache) and like it stays STRICTLY per account: the account
rename and drop hooks live next to the other stores in main.py.

File shape: {"accounts": {name: {"ignored": [fingerprint, ...]}}}. A damaged
file only forgets what it cannot understand; an older release ignores the file.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

from . import accounts
from . import tenants

RULE_CHECKUP_PATH = Path(os.environ.get("RULE_CHECKUP_PATH",
                                        "/data/rule_checkup.json"))

MAX_IGNORED = 200       # per account; the oldest ignores fall off first
_FP_RE = re.compile(r"[0-9a-f]{16}")

_LOCK = threading.Lock()

# Per-tenant cache (keyed by tenant id), like substore: never reads the file
# per request and never mixes tenants.
_cache: dict[str, dict[str, list[str]]] = {}


def valid_fingerprint(fp) -> bool:
    return isinstance(fp, str) and bool(_FP_RE.fullmatch(fp))


def _path() -> Path:
    return tenants.current().file("rule_checkup.json", RULE_CHECKUP_PATH)


def _read() -> dict[str, list[str]]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    out: dict[str, list[str]] = {}
    for name, block in accs.items():
        raw = block.get("ignored") if isinstance(block, dict) else None
        if isinstance(name, str) and isinstance(raw, list):
            keep = [f for f in raw if valid_fingerprint(f)]
            if keep:
                out[name] = list(dict.fromkeys(keep))[-MAX_IGNORED:]
    return out


def _load() -> dict[str, list[str]]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, list[str]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(
        {"accounts": {n: {"ignored": ids} for n, ids in data.items()}}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def ignored(account: str | None = None) -> set[str]:
    """The fingerprints this account's user chose to ignore."""
    account = account or accounts.default_name()
    with _LOCK:
        return set(_load().get(account, ()))


def set_ignored(fp: str, on: bool, account: str | None = None) -> None:
    """Ignore a finding (`on`) or show it again."""
    if not valid_fingerprint(fp):
        raise ValueError("bad finding")
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        have = list(data.get(account, ()))
        if on and fp not in have:
            have = (have + [fp])[-MAX_IGNORED:]
        elif not on and fp in have:
            have.remove(fp)
        else:
            return
        moved = {k: v for k, v in data.items() if k != account}
        if have:
            moved[account] = have
        _persist(moved)


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
