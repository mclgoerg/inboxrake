"""The lasting record of the mails "Move to another account" copied.

A copy job appends the mails of one account to a folder of another one with
their Message-ID and size unchanged, so afterwards the very same mail is in
both accounts. The All accounts page looks for exact copies across accounts
(same Message-ID and size) and offers to trash the extra ones - and a copy the
user made on purpose must never be among them. The job's own ledger cannot say
which mails those are: it keeps the LAST job only. This file keeps them for
good, per account (both sides of a copy):

    {"accounts": {name: [message-id, ...]}, "jobs": [job id, ...]}

`jobs` = the copy jobs already folded in from their ledger (so the one job
that ran before this record existed is read once, never again).

Mirrors pinstore.py: per-tenant file, atomic write, tolerant read, strictly per
account, rename / drop hooks. A damaged file only forgets what it cannot
understand - and a forgotten Message-ID only means one more copy is *kept*
(the finder leaves out everything it is not sure about), never one more
trashed. An older image ignores the file.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import accounts
from . import tenants

COPIED_PATH = Path(os.environ.get("COPIED_PATH", "/data/copied_mails.json"))

_LOCK = threading.Lock()

# Per-tenant cache (keyed by tenant id): the copies finder reads this for every
# account on every look, and it must never leak across tenants.
_cache: dict[str, dict] = {}


def _path() -> Path:
    return tenants.current().file("copied_mails.json", COPIED_PATH)


def _read() -> dict:
    out: dict = {"accounts": {}, "jobs": []}
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        return out
    if not isinstance(data, dict):
        return out
    accs = data.get("accounts")
    if isinstance(accs, dict):
        out["accounts"] = {
            name: {m for m in mids if isinstance(m, str) and m}
            for name, mids in accs.items()
            if isinstance(name, str) and isinstance(mids, list)}
    jobs = data.get("jobs")
    if isinstance(jobs, list):
        out["jobs"] = [j for j in jobs if isinstance(j, str)][-50:]
    return out


def _load() -> dict:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({
        "accounts": {n: sorted(s) for n, s in data["accounts"].items() if s},
        "jobs": data["jobs"][-50:]}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> set[str]:
    """The Message-IDs of one account that a copy job copied FROM or TO (a
    copy - safe to keep)."""
    account = account or accounts.default_name()
    with _LOCK:
        return set(_load()["accounts"].get(account, ()))


def record(source: str, target: str, msgids) -> int:
    """Remember that these Message-IDs were copied between two accounts (both
    sides: the original stays in `source`, the copy is in `target`). Returns
    how many were new. One write."""
    ids = {m for m in msgids if isinstance(m, str) and m}
    if not ids:
        return 0
    with _LOCK:
        data = _load()
        accs = {n: set(s) for n, s in data["accounts"].items()}
        new = 0
        for name in (source, target):
            mine = accs.setdefault(name, set())
            fresh = ids - mine
            new = max(new, len(fresh))
            mine |= fresh
        if not new:
            return 0
        _persist({"accounts": accs, "jobs": list(data["jobs"])})
        return new


def job_known(job_id: str) -> bool:
    with _LOCK:
        return job_id in _load()["jobs"]


def mark_job(job_id: str) -> None:
    """This copy job's ledger has been folded in (never read again)."""
    if not job_id:
        return
    with _LOCK:
        data = _load()
        if job_id in data["jobs"]:
            return
        _persist({"accounts": {n: set(s) for n, s in data["accounts"].items()},
                  "jobs": [*data["jobs"], job_id]})


def rename_account(old: str, new: str) -> None:
    """Move one account's record to its new name."""
    with _LOCK:
        data = _load()
        if old in data["accounts"]:
            accs = {k: v for k, v in data["accounts"].items() if k != old}
            accs[new] = data["accounts"][old]
            _persist({"accounts": accs, "jobs": list(data["jobs"])})


def drop_account(name: str) -> None:
    with _LOCK:
        data = _load()
        if name in data["accounts"]:
            _persist({"accounts": {k: v for k, v in data["accounts"].items()
                                   if k != name},
                      "jobs": list(data["jobs"])})
