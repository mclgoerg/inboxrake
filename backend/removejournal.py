"""The copies a removal of files has made and not yet settled, on disk.

"Keep the mail, remove the file" appends a lighter copy of a mail to its
folder and only afterwards moves the original to Trash. A crash (or a
restart) between the two would leave both in the folder. So before each APPEND
the job writes what it is about to do - folder, UIDVALIDITY, the folder's
UIDNEXT, the original's UID and Message-ID - and clears the line once the
copy is either the mail (the original went to Trash) or taken out again.
`removefiles.sweep` reads the lines that are left: a copy is deleted only
when its original is still in the folder, it carries our header and its UID
is above the recorded UIDNEXT (nothing the user had is ever touched).

One small file per tenant and account, next to the undo file: mail METADATA
only (folder, UID, Message-ID), mode 0600, atomic writes, a damaged or
unknown file is ignored. An older release never reads it.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
from pathlib import Path

log = logging.getLogger("inboxrake.removejournal")

_VERSION = 1
_LOCK = threading.Lock()
# this process: lines of another boot are leftovers of a crash
BOOT = f"{os.getpid()}-{time.time_ns():x}"


def _path(name: str, tenant, base: Path) -> Path:
    """One file per account; the name is encoded (not hashed), so two
    accounts never share a file and nothing is lost to a collision."""
    code = base64.urlsafe_b64encode(name.encode("utf-8")).decode().rstrip("=")
    return tenant.dir(base) / f"removals_{code}.json"


def _read(name: str, tenant, base: Path) -> list[dict]:
    try:
        data = json.loads(_path(name, tenant, base).read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []
    if not isinstance(data, dict) or data.get("version") != _VERSION:
        return []
    return [e for e in data.get("entries") or []
            if isinstance(e, dict) and isinstance(e.get("id"), str)
            and isinstance(e.get("folder"), str)
            and isinstance(e.get("orig"), int)
            and isinstance(e.get("floor"), int)]


def _write(name: str, tenant, base: Path, entries: list[dict]) -> None:
    path = _path(name, tenant, base)
    if not entries:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": _VERSION, "account": name,
                               "entries": entries}, separators=(",", ":")))
    tmp.chmod(0o600)
    tmp.replace(path)


def load(name: str, tenant, base: Path) -> list[dict]:
    with _LOCK:
        return _read(name, tenant, base)


def add(name: str, tenant, base: Path, entry: dict) -> str:
    """Record one copy about to be made; returns its id. Raises OSError: the
    caller then makes no copy."""
    jid = f"{time.time_ns():x}"
    with _LOCK:
        entries = _read(name, tenant, base)
        entries.append({**entry, "id": jid, "boot": BOOT,
                        "ts": int(time.time())})
        _write(name, tenant, base, entries)
    return jid


def update(name: str, tenant, base: Path, jid: str, **fields) -> None:
    """Add what became known (the copy's UID). Best effort."""
    try:
        with _LOCK:
            entries = _read(name, tenant, base)
            for e in entries:
                if e["id"] == jid:
                    e.update(fields)
            _write(name, tenant, base, entries)
    except OSError:
        log.warning("could not update the removal journal")


def clear(name: str, tenant, base: Path, ids) -> None:
    """The copies of these ids are settled. Best effort: a line that stays is
    swept (and found settled) later."""
    gone = {i for i in ids if i}
    if not gone:
        return
    try:
        with _LOCK:
            entries = _read(name, tenant, base)
            kept = [e for e in entries if e["id"] not in gone]
            if len(kept) != len(entries):
                _write(name, tenant, base, kept)
    except OSError:
        log.warning("could not clear the removal journal")


def rename(old: str, new: str, tenant, base: Path) -> None:
    """A renamed account keeps its journal under the new name."""
    src = _path(old, tenant, base)
    try:
        with _LOCK:
            if not src.exists():
                return
            entries = _read(old, tenant, base)
            _write(new, tenant, base, entries)
            src.unlink(missing_ok=True)
    except OSError:
        log.warning("could not rename the removal journal")


def drop(name: str, tenant, base: Path) -> None:
    try:
        with _LOCK:
            _path(name, tenant, base).unlink(missing_ok=True)
    except OSError:
        log.warning("could not drop the removal journal")
