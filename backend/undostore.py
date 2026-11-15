"""The undo log on disk, per tenant and per account.

Undo steps used to live in memory only (the last 10, gone on every restart).
The Time machine keeps them for 30 days, which is meaningless if every
restart or update empties them, so each account's two lists (the user's own
steps and the AI assistants' steps) are written to a small file of their own
next to the scan snapshot: `undo_<account>_<hash>.json`.

A separate file keeps the scan snapshot (and its format version) untouched: an
older release never reads this file, so rolling back costs nothing - it simply
starts with an empty undo list, as it always did.

The file holds mail METADATA only (folder, Message-ID, sender address, size),
the same data class as the scan snapshot, written with mode 0600. Atomic
(tmp + replace). A damaged or unknown file is ignored, never fatal.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path

log = logging.getLogger("inboxrake.undostore")

_VERSION = 1


def _path(name: str, tenant, base: Path) -> Path:
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:40]
    h = hashlib.sha1(name.encode()).hexdigest()[:8]
    return tenant.dir(base) / f"undo_{slug}_{h}.json"


def _entry_ok(e) -> bool:
    """A step read back from disk is usable only with the fields the undo
    code indexes (anything else is dropped, never repaired)."""
    return (isinstance(e, dict) and isinstance(e.get("ts"), int)
            and isinstance(e.get("label"), str)
            and isinstance(e.get("count"), int)
            and isinstance(e.get("items"), list)
            and isinstance(e.get("in", ""), str)
            and (e.get("copies") is None or isinstance(e["copies"], list))
            and (e.get("parts") is None or isinstance(e["parts"], list)))


def _revive(e: dict) -> dict:
    """JSON turned the item pairs into lists: back to tuples (the in-memory
    shape); every other field is as it was."""
    e["items"] = [tuple(i) for i in e["items"]
                  if isinstance(i, (list, tuple)) and len(i) == 2]
    if isinstance(e.get("parts"), list):
        for p in e["parts"]:
            if isinstance(p, dict):
                p["mails"] = [tuple(m) for m in p.get("mails", [])]
    return e


def _saved(entry: dict) -> dict:
    """What goes to disk of one step: the bookkeeping of a half-done restore
    (`attempt`: every UID the target folder held, shared by the copies of one
    chunk) stays in memory - written per copy it would be huge, and a restart
    can do without it (a copy it cannot place is found by its UID or skipped)."""
    copies = entry.get("copies")
    if not copies or not any("attempt" in c for c in copies):
        return entry
    return {**entry, "copies": [{k: v for k, v in c.items() if k != "attempt"}
                                for c in copies]}


def save(name: str, tenant, base: Path, user: list[dict],
         assistant: list[dict]) -> None:
    """Write both lists (the file is removed when both are empty). Raises
    OSError; the caller logs it - a failed write never fails the action."""
    path = _path(name, tenant, base)
    if not user and not assistant:
        path.unlink(missing_ok=True)
        return
    blob = json.dumps({"version": _VERSION, "account": name,
                       "undo": [_saved(e) for e in user],
                       "assistant": [_saved(e) for e in assistant]},
                      separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(blob)
    tmp.chmod(0o600)
    tmp.replace(path)


def load(name: str, tenant, base: Path) -> tuple[list[dict], list[dict]]:
    """`(user steps, assistant steps)` as last saved; empty when there is no
    file, or it cannot be read."""
    try:
        data = json.loads(_path(name, tenant, base).read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return [], []
    if not isinstance(data, dict) or data.get("version") != _VERSION:
        return [], []

    def pick(key: str, assistant: bool) -> list[dict]:
        out = []
        for e in data.get(key) or []:
            if _entry_ok(e) and bool(e.get("token")) == assistant:
                out.append(_revive(e))
        return sorted(out, key=lambda e: e["ts"])

    return pick("undo", False), pick("assistant", True)


def rename(old: str, new: str, tenant, base: Path) -> None:
    """A renamed account keeps its undo file under the new name."""
    src = _path(old, tenant, base)
    try:
        if not src.exists():
            return
        data = json.loads(src.read_text())
        data["account"] = new
        dst = _path(new, tenant, base)
        tmp = dst.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")))
        tmp.chmod(0o600)
        tmp.replace(dst)
        src.unlink()
    except (OSError, json.JSONDecodeError):
        log.exception("could not rename the undo file")


def drop(name: str, tenant, base: Path) -> None:
    try:
        _path(name, tenant, base).unlink(missing_ok=True)
    except OSError:
        log.exception("could not drop the undo file")
