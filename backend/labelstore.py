"""Labels the user set by hand per sender: a verdict and / or the category tags.

    {"version": 1, "accounts": {<account>: {<sender address>: {
        "verdict": "delete_safe" | "review" | "keep"    (optional)
        "tags": ["<tag>", ...]                           (optional, may be [])
        "ts": <epoch>}}}}

A missing `verdict` / `tags` means "automatic": the AI verdict (verdictstore)
and the keyword tags (mailops.categorize) apply. A stored `tags: []` is the
user's own choice - no tags at all - and is different from "automatic".

Strictly per account, like the group verdicts: the same address can mean
different things in different mailboxes. The file is the user's private data
like the sender knowledge (mode 0600, atomic write, one in-process lock): an
address, a verdict or a tag is NEVER logged, only counts, and a refusal is a
stable code (the frontend maps it to a translated text).

This module only stores and validates. How an override reaches every reader of
a verdict (scan, snapshot restore, Smart rows, the AI review, rules, filters,
per-mail ratings) is `apply_to_groups` / `mail_verdicts` here plus the hooks in
mailops.py - see the "user labels" notes there.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable

from . import accounts
from . import tenants

LABELS_PATH = Path(os.environ.get("LABELS_PATH", "/data/sender_labels.json"))
VERSION = 1
VERDICTS = ("delete_safe", "review", "keep")
USER_SRC = "user"                  # `src` of a group verdict set by the user
MAX_ENTRIES = 5000                 # per account
MAX_TAGS = 20
TAG_MAX = 40
MAX_TS = 32_503_680_000

# Stable error codes (HTTP detail; frontend api.ts ERROR_CODES).
BAD_REQUEST = "labels_bad_request"
BAD_KEY = "labels_bad_key"
BAD_VERDICT = "labels_bad_verdict"
BAD_TAGS = "labels_bad_tags"
FULL = "labels_full"
UNSCANNED = "labels_unscanned"
SCAN_RUNNING = "labels_scan_running"
UNKNOWN = "labels_unknown_sender"


class LabelError(ValueError):
    """A refused request: `code` is one of the stable codes above. The
    message IS the code - never an address or a tag."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


_LOCK = threading.Lock()
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_SPACE = re.compile(r"\s+")
_UNSET = object()

# Per-tenant cache (keyed by tenant id) so public_state() never re-reads the
# file - and never leaks one tenant's labels into another.
_cache: dict[str, dict[str, dict[str, dict]]] = {}


def _path() -> Path:
    return tenants.current().file("sender_labels.json", LABELS_PATH)


# ------------------------------------------------------------- validation

def normalize_key(key) -> str:
    """The sender key (lowercase address), or raise BAD_KEY."""
    if not isinstance(key, str):
        raise LabelError(BAD_KEY)
    key = key.strip().lower()
    if not key or len(key) > 254 or "@" not in key or _SPACE.search(key) \
            or _CONTROL.search(key):
        raise LabelError(BAD_KEY)
    return key


def clean_tags(tags) -> list[str]:
    """The tags as stored: trimmed, lowercase (the `tag:` filter lowercases
    its value), de-duplicated in order; raise BAD_TAGS on anything else."""
    if not isinstance(tags, list) or len(tags) > MAX_TAGS * 2:
        raise LabelError(BAD_TAGS)
    out: list[str] = []
    for tag in tags:
        if not isinstance(tag, str):
            raise LabelError(BAD_TAGS)
        tag = _SPACE.sub(" ", _CONTROL.sub(" ", tag)).strip().lower()
        if not tag or len(tag) > TAG_MAX:
            raise LabelError(BAD_TAGS)
        if tag not in out:
            out.append(tag)
    if len(out) > MAX_TAGS:
        raise LabelError(BAD_TAGS)
    return out


# ---------------------------------------------------------------- storage

def _read_entry(raw) -> dict | None:
    """Read-side tolerance: a damaged entry is dropped, never a crash."""
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    if raw.get("verdict") in VERDICTS:
        out["verdict"] = raw["verdict"]
    tags = raw.get("tags")
    if isinstance(tags, list):
        try:
            out["tags"] = clean_tags(tags)
        except LabelError:
            pass
    if not out:
        return None
    ts = raw.get("ts")
    out["ts"] = ts if isinstance(ts, int) and not isinstance(ts, bool) \
        and 0 <= ts <= MAX_TS else 0
    return out


def _read() -> dict[str, dict[str, dict]]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    out: dict[str, dict[str, dict]] = {}
    for name, entries in (accs if isinstance(accs, dict) else {}).items():
        if not isinstance(entries, dict):
            continue
        mine = {}
        for addr, raw in entries.items():
            entry = _read_entry(raw)
            if entry and isinstance(addr, str) and "@" in addr:
                mine[addr] = entry
        if mine:
            out[name] = mine
    return out


def _load() -> dict[str, dict[str, dict]]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, dict[str, dict]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": VERSION, "accounts": {
        n: e for n, e in data.items() if e}}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> dict[str, dict]:
    """{address: {"verdict"?, "tags"?, "ts"}} of one account (a copy)."""
    account = account or accounts.default_name()
    with _LOCK:
        return {a: dict(e) for a, e in _load().get(account, {}).items()}


def verdicts(account: str | None = None) -> dict[str, str]:
    """{address: verdict} of the user's verdict overrides of one account."""
    return {a: e["verdict"] for a, e in load_account(account).items()
            if "verdict" in e}


def tag_overrides(account: str | None = None) -> dict[str, list[str]]:
    """{address: tags} of the user's tag overrides of one account."""
    return {a: list(e["tags"]) for a, e in load_account(account).items()
            if "tags" in e}


def tags_digest(over: dict[str, list[str]]) -> str:
    """Part of the category digest: what a re-tag reads from the overrides."""
    if not over:
        return ""
    blob = json.dumps(sorted(over.items()))
    return hashlib.sha1(blob.encode()).hexdigest()[:12]


def set_labels(account: str, addr: str, verdict=_UNSET, tags=_UNSET) -> dict | None:
    """Change one sender's labels in ONE atomic write. `verdict` / `tags` left
    out stay as they are; None removes that part (back to automatic); a
    validated value replaces it. Returns the entry now stored (None = the
    sender has no labels any more). Raises LabelError (nothing is written)."""
    addr = normalize_key(addr)
    if verdict is not _UNSET and verdict is not None \
            and verdict not in VERDICTS:
        raise LabelError(BAD_VERDICT)
    if tags is not _UNSET and tags is not None:
        tags = clean_tags(tags)
    with _LOCK:
        data = _load()
        mine = {a: dict(e) for a, e in data.get(account, {}).items()}
        entry = mine.get(addr, {})
        if verdict is not _UNSET:
            entry.pop("verdict", None)
            if verdict is not None:
                entry["verdict"] = verdict
        if tags is not _UNSET:
            entry.pop("tags", None)
            if tags is not None:
                entry["tags"] = tags
        if "verdict" not in entry and "tags" not in entry:
            mine.pop(addr, None)
            entry = {}
        else:
            entry["ts"] = int(time.time())
            mine[addr] = entry
        if len(mine) > MAX_ENTRIES and addr in mine \
                and addr not in data.get(account, {}):
            raise LabelError(FULL)
        if mine != data.get(account, {}):
            _persist({**data, account: mine})
        return mine.get(addr)


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


def export_section() -> dict:
    """The backup shape: {account: {address: entry}} (private, like replied)."""
    with _LOCK:
        return {n: {a: dict(e) for a, e in es.items()}
                for n, es in _load().items()}


def import_section(section, known_accounts: set[str]) -> int:
    """Merge a backup's labels (unknown accounts and damaged entries are
    dropped; an existing entry of this install wins). Returns how many were
    added."""
    if not isinstance(section, dict):
        return 0
    added = 0
    with _LOCK:
        data = {n: dict(e) for n, e in _load().items()}
        for name, entries in section.items():
            if name not in known_accounts or not isinstance(entries, dict):
                continue
            mine = data.setdefault(name, {})
            for addr, raw in entries.items():
                entry = _read_entry(raw)
                if not entry or not isinstance(addr, str) \
                        or addr in mine or len(mine) >= MAX_ENTRIES:
                    continue
                try:
                    mine[normalize_key(addr)] = entry
                except LabelError:
                    continue
                added += 1
        if added:
            _persist(data)
    return added


# --------------------------------------------------- reading a verdict

def user_ai(verdict: str, protected: bool) -> dict:
    """The group verdict a user override shows as. A protected sender is
    never "safe to delete", whatever the user chose (nor later, when it is
    protected after the choice - public_state re-applies this)."""
    if verdict == "delete_safe" and protected:
        verdict = "review"
    return {"verdict": verdict, "reason": "", "src": USER_SRC}


def is_user(ai) -> bool:
    return isinstance(ai, dict) and ai.get("src") == USER_SRC


def strip_user_marks(groups: dict) -> None:
    """Forget every user mark on the given groups (before the cached AI
    verdicts are applied: a stale mark - from a snapshot written before the
    override was reset - must not stop them)."""
    for recs in groups.values():
        for rec in recs.values():
            if is_user(rec.get("ai")):
                rec["ai"] = None


def apply_to_groups(groups: dict, account: str | None,
                    is_protected: Callable[[str], bool]) -> int:
    """Put the user's verdict overrides on the Sender rows and on the Smart
    rows that stand for exactly one sender (`s:<addr>`), replacing whatever
    the AI said. Returns how many rows got one. Pooled rows are NOT touched
    (see mailops._cap_by_members)."""
    over = verdicts(account)
    if not over:
        return 0
    n = 0
    for addr, verdict in over.items():
        for grouping, key in (("sender", addr), ("smart", f"s:{addr}")):
            rec = (groups.get(grouping) or {}).get(key)
            if rec is not None:
                rec["ai"] = user_ai(verdict, is_protected(addr))
                n += 1
    return n


def mail_verdicts(account: str | None, stored: dict[str, str],
                  paddr: Callable[[str], bool]) -> Callable[[dict], str | None]:
    """A function m -> the verdict of one MAIL: the sender's override when it
    has one, else the stored per-mail rating (keyed by Message-ID)."""
    over = verdicts(account)
    if not over:
        return lambda m: stored.get(m["msgid"]) or None

    def verdict_of(m: dict) -> str | None:
        v = over.get(m["addr"])
        if v is None:
            return stored.get(m["msgid"]) or None
        return "review" if v == "delete_safe" and paddr(m["addr"]) else v
    return verdict_of
