"""Your folders: see and tidy one account's own folders.

The page lists every folder of the account with what the last scan knows of
it (mails, size, newest mail, the rules that use it) and offers four
operations on the server: create, rename, merge into another folder and
delete an empty one. Everything here is server-side and strict:

* LOCKED, never renamed / merged / deleted: INBOX, every special-use / role
  folder (Archive, Sent, Drafts, Junk, Trash and their look-alikes, the roles
  the user confirmed in Settings), the provider's own folders (Gmail's
  "[Gmail]/..." tree, Starred, Important, All Mail, Proton Bridge's "Folders"
  / "Labels" parents) and anything \\Noselect.
* LABELS (a mail can carry several: Gmail labels, Proton Bridge "Labels/..."):
  merging into / out of one is off - a move there adds or removes a label and
  nobody can promise that no other label goes with it. Rename and create are
  plain, delete needs the same zero as everywhere.
* DELETE only when the server itself says 0 messages right now (STATUS,
  SELECT and a UID SEARCH all agree), the folder has no subfolders and no rule
  moves mail into it; the UIDVALIDITY the confirm saw must still be the one.
* MERGE is `mailops.move_lookalike` for any folder: chunked UID MOVEs with
  exact copy receipts, one Undo step (action `move_contents`, so Activity and
  the Time machine already know it) recorded BEFORE anything else happens -
  before the rules are repointed and before the emptied folder is deleted.
  The step remembers the folder it may have to recreate (`recreate`), the
  rules it repointed (`folder_rules`) and is flagged `folder_merge`; Undo
  creates the folder again, moves the mails back and points the rules that
  are still at the target back to the source (still Report only).
* A rule whose target changes (a merge, a rename) goes back to Report only,
  as every edit of a target does; the confirm names the rules and the server
  refuses when the rules are not the ones the confirm named.
* Nothing runs while a move job is queued or running, a scan runs, an undo
  runs or an account copy writes into / reads from the account; and a move job
  refuses to start while one of these runs (`acc.folder_lock`).

Nothing new is stored on disk: the rules, the Undo steps and the account's
exclusion list are updated in their own stores, the Undo steps with two
optional fields an older release ignores.
"""

from __future__ import annotations

import copy
import logging
import re
import time
import unicodedata
from collections import Counter
from contextlib import contextmanager

from . import accountcopy
from . import auditlog
from . import config as cfgmod
from . import mailops
from . import pinstore
from . import rules as rulesmod

log = logging.getLogger("inboxrake.yourfolders")

QUIET_YEARS = 3                  # "gone quiet": nothing new for this long
TOP_SENDERS = 3                  # "Most mail from" in a folder's pane
FOLDER_MAX = accountcopy.FOLDER_MAX

# SPECIAL-USE attributes (RFC 6154, XLIST, Gmail): a folder that carries one
# is the server's, not the user's
_SPECIAL_USE = frozenset({
    "\\all", "\\allmail", "\\archive", "\\drafts", "\\flagged", "\\important",
    "\\junk", "\\spam", "\\sent", "\\trash", "\\starred", "\\snoozed",
    "\\scheduled"})
_GMAIL_ROOTS = ("[gmail]", "[google mail]")
# names a provider uses for its own top-level folders (Proton Bridge)
_SYSTEM_TOP = frozenset({"all mail", "starred", "folders", "labels"})

# words that do not tell two folder names apart ("Receipts 2019", "receipts-old")
_NOISE = frozenset({"old", "alt", "copy", "kopie", "backup", "bak", "tmp",
                    "temp", "neu", "new", "archive", "archiv"})


# ------------------------------------------------------------------ context

class _Ctx:
    """What the server says about the account's folders right now."""

    def __init__(self, conn, acc):
        self.pairs = mailops.list_folders_ex(conn)
        self.names = [n for n, _ in self.pairs]
        self.flags = {n: f for n, f in self.pairs}
        self.delims = getattr(self.pairs, "delims", {})
        self.delim_default = self.delims.get("INBOX") or next(
            iter(self.delims.values()), "")
        found = mailops.resolve_roles(conn, acc, pairs=self.pairs)
        self.roles = found["roles"]
        self.looks_like = found["looks_like"]
        self.role_of: dict[str, str] = {}
        for role in (*mailops.EXCLUDED_ROLES, "archive"):
            if role in self.roles:
                self.role_of.setdefault(self.roles[role], role)
        self.views = mailops.virtual_views(pairs=self.pairs)
        self.noselect = mailops.unselectable(pairs=self.pairs)
        self.gmail = mailops.has_gmail_ext(conn)
        self.move_ok = (mailops._supports_move(conn)
                        or mailops._supports_uidplus(conn))

    def delim_of(self, raw: str) -> str:
        return self.delims.get(raw) or self.delim_default

    def segments(self, raw: str) -> list[str]:
        shown, d = mailops.decode_mutf7(raw), self.delim_of(raw)
        return shown.split(d) if d else [shown]

    def children(self, raw: str) -> list[str]:
        d = self.delim_of(raw)
        return [n for n in self.names
                if d and n != raw and n.startswith(raw + d)]

    def role_name(self, raw: str) -> str | None:
        return self.role_of.get(raw) or self.looks_like.get(raw)

    def _provider_folder(self, raw: str) -> bool:
        segs = [s.lower() for s in self.segments(raw)]
        return bool(segs) and (segs[0] in _GMAIL_ROOTS
                               or (len(segs) == 1 and segs[0] in _SYSTEM_TOP))

    def lock_why(self, raw: str) -> str | None:
        """Why the folder may not be renamed / merged / deleted, else None:
        `inbox`, `noselect`, `provider` or `role`."""
        if raw.upper() == "INBOX":
            return "inbox"
        if raw in self.noselect:
            return "noselect"
        if raw in self.views:
            return "provider"
        if self.flags.get(raw, set()) & _SPECIAL_USE \
                or raw in self.role_of or raw in self.looks_like:
            return "role"
        if self._provider_folder(raw):
            return "provider"
        return None

    def is_label(self, raw: str) -> bool:
        """A label: a mail can be in several of them (every folder of a Gmail
        server; Proton Bridge's "Labels/..."). Only asked of unlocked ones."""
        if self.gmail:
            return True
        segs = self.segments(raw)
        return len(segs) > 1 and segs[0].lower() == "labels"


def _name(raw: str) -> str:
    return mailops.decode_mutf7(raw)


def _connect(acc):
    return mailops.connect(cfgmod.account_imap(acc.name), acc.name)


def _logout(conn) -> None:
    try:
        conn.logout()
    except Exception:
        pass


def _refuse(code: str, **params) -> RuntimeError:
    return RuntimeError(mailops.coded(code, **params))


# --------------------------------------------------------------------- busy

def _busy(acc) -> str | None:
    """The code of what keeps the account from a folder operation now."""
    with acc.lock:
        if acc.state["status"] == "scanning":
            return mailops.BUSY_SCAN
        if (acc.delete_pending or acc.inflight or acc.undo_busy
                or acc.state["delete"]["status"] == "running"
                or acc.state["restore"]["status"] == "running"):
            return mailops.BUSY_ACTION
    if acc.purge_lock.locked():
        return mailops.BUSY_PURGE
    try:
        job = accountcopy.status().get("job") or {}
    except Exception:
        job = {}
    if job.get("status") in ("running", "paused") \
            and acc.name in (job.get("source"), job.get("target")):
        return mailops.COPY_BUSY
    return None


@contextmanager
def _operation(acc, mails: bool = True):
    """One folder operation at a time per account. `mails`: it changes where
    mail is, so nothing else may be moving it (create does not)."""
    if not acc.folder_lock.acquire(blocking=False):
        raise _refuse(mailops.BUSY_ACTION)
    try:
        why = _busy(acc) if mails else None
        if why:
            raise _refuse(why)
        yield
    finally:
        acc.folder_lock.release()


# ------------------------------------------------------------------ helpers

def _alike_key(name: str) -> str:
    """What two look-alike folder names share: lower case, no accents, no
    digits, no "old" / "backup" noise, no separators, no plural s."""
    low = unicodedata.normalize("NFKD", name.lower())
    low = "".join(c for c in low if not unicodedata.combining(c))
    words = [w for w in re.split(r"[^a-z]+", low) if w and w not in _NOISE]
    key = "".join(words)
    return key[:-1] if len(key) > 3 and key.endswith("s") else key


def _parent(ctx: _Ctx, raw: str) -> str:
    d = ctx.delim_of(raw)
    return raw[:raw.rfind(d) + len(d)] if d and d in raw else ""


def _index_stats(acc) -> dict[str, dict]:
    """Per raw folder what the last scan holds: mails, bytes, the newest mail,
    how many are unread and the senders with most mail in it (label copies
    count: they are mails of that label)."""
    out: dict[str, dict] = {}
    senders: dict[str, Counter] = {}
    with acc.lock:
        for m in (*acc.index.values(), *acc.label_copies.values()):
            s = out.setdefault(m["folder"], {"mails": 0, "size": 0,
                                             "newest": 0, "unread": 0})
            s["mails"] += 1
            s["size"] += int(m.get("size") or 0)
            s["newest"] = max(s["newest"], int(m.get("ts") or 0))
            s["unread"] += 0 if m.get("seen") else 1
            if m.get("addr"):
                senders.setdefault(m["folder"], Counter())[m["addr"]] += 1
        recs = acc.state["groups"].get("sender") or {}
        for folder, counter in senders.items():
            out[folder]["top"] = [
                {"addr": a, "label": (recs.get(a) or {}).get("label") or a,
                 "n": n} for a, n in counter.most_common(TOP_SENDERS)]
    return out


def _scan_off(im: dict, raw: str) -> tuple[str | None, str]:
    """`(how, pattern)`: how the user's exclusion list keeps this folder out
    of the scan - `pattern` (a wildcard entry, named) or `switch` (the
    folder's own switch is off) - else (None, "")."""
    rules = [str(r) for r in (im.get("excluded_folders") or [])]
    shown = _name(raw)
    for r in rules:
        if r.strip().endswith("*") and (mailops.excluded(raw, [r])
                                        or mailops.excluded(shown, [r])):
            return "pattern", r.strip()
    if mailops.excluded(raw, rules) or mailops.excluded(shown, rules):
        return "switch", ""
    return None, ""


def _can(ctx: _Ctx, raw: str, why: str | None, mails: int | None,
         rules: list, kids: list) -> dict:
    """The reason (a stable code) each operation is off, None = allowed."""
    merge = why or ("label" if ctx.is_label(raw) else None) \
        or (None if ctx.move_ok else "move_unsafe")
    delete = why or ("children" if kids else None) \
        or ("rules" if rules else None) or ("not_empty" if mails else None)
    return {"rename": why, "merge": merge, "delete": delete}


# ----------------------------------------------------------------- overview

def overview(acc) -> dict:
    """GET /api/your_folders: the rows, the hints and the totals. The numbers
    come from the last scan (no per-folder round trip); a folder the scan did
    not read has none."""
    conn = _connect(acc)
    try:
        ctx = _Ctx(conn, acc)
    finally:
        _logout(conn)
    im = cfgmod.account_imap(acc.name)
    stats = _index_stats(acc)
    with acc.lock:
        scanned = set(acc.state.get("folders_raw") or [])
        done = bool(scanned) or acc.state.get("scanned_ts") is not None
    move_rules = rulesmod.moving_into(acc.name, lambda d: True)
    archive_rules = rulesmod.moving_into(acc.name, lambda d: True,
                                         action="archive")
    rows: list[dict] = []
    special: list[dict] = []
    for raw in ctx.names:
        why = ctx.lock_why(raw)
        role = ctx.role_name(raw)
        shown = _name(raw)
        if raw in ctx.noselect or raw in ctx.views or why == "provider" \
                or (role and role != "archive"):
            special.append({"raw": raw, "name": shown, "why": why,
                            "role": role})
            continue
        used = [r for r in move_rules if r["dest"] == raw]
        if role == "archive":
            used = used + archive_rules
        kids = ctx.children(raw)
        off, pattern = _scan_off(im, raw)
        is_scanned = raw in scanned
        s = stats.get(raw) if is_scanned else None
        if is_scanned and s is None:
            s = {"mails": 0, "size": 0, "newest": 0, "unread": 0}
        rows.append({
            "raw": raw, "name": shown, "delim": ctx.delim_of(raw) or None,
            "lock": why, "role": role, "label": not why and ctx.is_label(raw),
            "scanned": is_scanned,
            "off": off,
            "pattern": pattern,
            "mails": s["mails"] if s else None,
            "size": s["size"] if s else None,
            "newest": (s["newest"] or None) if s else None,
            "unread": s["unread"] if s else None,
            "top": s.get("top", []) if s else [],
            "used_by": [{k: r[k] for k in ("id", "name", "mode", "schedule")}
                        for r in used],
            "children": len(kids), "hints": [], "twin": None,
            "can": _can(ctx, raw, why, s["mails"] if s else None, used, kids),
        })
    hints = _hints(rows, ctx)
    mails_total = sum(r["mails"] or 0 for r in rows)
    size_total = sum(r["size"] or 0 for r in rows)
    n_scanned = sum(1 for r in rows if r["scanned"])
    rows.sort(key=lambda r: (r["mails"] is None, -(r["mails"] or 0),
                             r["name"].lower()))
    return {"rows": rows, "hints": hints, "special": special,
            "totals": {"scanned": n_scanned, "mails": mails_total,
                       "size": size_total,
                       "not_scanned": len(rows) - n_scanned},
            "scanned": done, "gmail": ctx.gmail, "busy": _busy(acc),
            "scanned_ts": acc.state.get("scanned_ts")}


def _hints(rows: list[dict], ctx: _Ctx) -> list[dict]:
    """Look-alike names, empty folders, folders gone quiet - set on each row
    (`hints`, `twin`) and returned as the cards of the page."""
    out: list[dict] = []
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        key = _alike_key(r["name"].split(r["delim"] or "\0")[-1])
        if key:
            groups.setdefault((_parent(ctx, r["raw"]), key), []).append(r)
    alike = [g for g in groups.values() if len(g) > 1]
    for g in alike:
        for r in g:
            r["hints"].append("look")
            others = [o for o in g if o is not r and o["scanned"]]
            best = max(others, key=lambda o: (o["mails"] or 0,
                                              -len(o["name"])), default=None)
            r["twin"] = (best or next(o for o in g if o is not r))["raw"]
    now = time.time()
    for r in rows:
        if r["lock"]:
            continue
        if r["scanned"] and r["mails"] == 0:
            r["hints"].append("empty")
        elif r["scanned"] and r["newest"] \
                and now - r["newest"] > QUIET_YEARS * 365.25 * 86400:
            r["hints"].append("stale")
    for kind in ("look", "empty", "stale"):
        have = [r["raw"] for r in rows if kind in r["hints"]]
        if have:
            out.append({"kind": kind, "folders": have})
    return out


# ------------------------------------------------------------------- checks

def _live(conn, folder: str) -> tuple[int, list[int]]:
    """`(UIDVALIDITY, every UID)` of the folder as the server has it now."""
    status, _ = conn.select(mailops.quote_folder(folder), readonly=True)
    if status != "OK":
        raise _refuse(mailops.CANNOT_OPEN, folder=_name(folder))
    return mailops.uidvalidity(conn), mailops._all_uids(conn)


def _assert_empty(conn, folder: str) -> int:
    """The folder's UIDVALIDITY, after STATUS, SELECT and a UID SEARCH agreed
    on 0 messages; anything else is refused with the count. The folder is not
    left selected."""
    st = accountcopy._status(conn, folder)
    if "MESSAGES" not in st:
        raise _refuse(mailops.FOLDER_GONE, folder=_name(folder))
    status, data = conn.select(mailops.quote_folder(folder), readonly=True)
    if status != "OK":
        raise _refuse(mailops.CANNOT_OPEN, folder=_name(folder))
    try:
        exists = int((data or [b"0"])[0] or 0)
    except (TypeError, ValueError):
        exists = 1
    uv = mailops.uidvalidity(conn)
    uids = mailops._all_uids(conn)
    n = max(st["MESSAGES"], exists, len(uids))
    try:
        conn.close()                 # read only: nothing is expunged
    except Exception:
        pass
    if n:
        raise _refuse(mailops.FOLDER_NOT_EMPTY, folder=_name(folder), n=n)
    if uv <= 0:
        raise _refuse(mailops.UV_UNREADABLE, role=_name(folder))
    return uv


def _same_folder(conn, a: str, b: str) -> bool:
    """Whether two names are ONE folder (INBOX in any case, an alias): the
    same UIDVALIDITY, UIDNEXT and count and the same Message-ID on the newest
    UID. Never merge a folder into itself - that would be a no-op at best and
    a deleted folder at worst."""
    if a == b or (a.upper() == "INBOX" and b.upper() == "INBOX"):
        return True
    x, y = accountcopy._status(conn, a), accountcopy._status(conn, b)
    if not x or x != y:
        return False
    if x.get("MESSAGES", 0) == 0:
        return True                          # nothing to tell them apart by
    top = []
    for name in (a, b):
        status, _ = conn.select(mailops.quote_folder(name), readonly=True)
        uids = mailops._all_uids(conn) if status == "OK" else []
        if not uids:
            return False
        top.append(mailops._fetch_msgid_map(conn, [uids[-1]]).get(uids[-1]))
    return bool(top[0]) and top[0] == top[1]


def _require_folder(ctx: _Ctx, raw: str) -> None:
    if raw not in ctx.names:
        raise _refuse(mailops.FOLDER_GONE, folder=_name(raw))


def _require_unlocked(ctx: _Ctx, raw: str) -> None:
    _require_folder(ctx, raw)
    why = ctx.lock_why(raw)
    if why:
        raise _refuse(mailops.FOLDER_LOCKED, folder=_name(raw), why=why)


def _require_target(ctx: _Ctx, raw: str) -> None:
    """A merge goes into an ordinary folder, the Archive folder or the inbox
    - never into Sent, Drafts, Junk, Trash, a provider's own folder or a
    label."""
    _require_folder(ctx, raw)
    why = ctx.lock_why(raw)
    if why not in (None, "inbox") and not (
            why == "role" and ctx.role_of.get(raw) == "archive"):
        raise _refuse(mailops.FOLDER_TARGET_BAD, folder=_name(raw))
    if ctx.is_label(raw):
        raise _refuse(mailops.FOLDER_LABEL, folder=_name(raw))


def _prepare_merge(conn, ctx: _Ctx, acc, folder: str, target: str) -> list:
    """Every refusal of a merge, in one place: the rules that point at the
    folder (what the confirm names) when it may go ahead."""
    _require_unlocked(ctx, folder)
    if ctx.is_label(folder):
        raise _refuse(mailops.FOLDER_LABEL, folder=_name(folder))
    _require_target(ctx, target)
    if not ctx.move_ok:
        # without MOVE or UIDPLUS a move can only fall back to a plain
        # EXPUNGE, which another client's \Deleted mail would ride on
        raise _refuse(mailops.MOVE_UNSAFE)
    if _same_folder(conn, folder, target):
        raise _refuse(mailops.FOLDER_SAME)
    return rulesmod.moving_into(acc.name, lambda d: d == folder)


def _new_name(conn, ctx: _Ctx, acc, parent: str, typed: str,
              current: str = "") -> tuple[str, str]:
    """`(raw name, shown leaf)` of a folder called `typed` below the raw
    prefix `parent`: cleaned, the delimiter replaced, modified-UTF-7 encoded,
    refused when it exists (in any case) or is a name the server uses."""
    try:
        leaf = accountcopy.clean_folder(typed)
    except ValueError:
        raise _refuse(mailops.FOLDER_NAME_BAD)
    d = ctx.delim_of(parent) if parent else ctx.delim_default
    if d:
        leaf = leaf.replace(d, "-").strip()
    if not leaf:
        raise _refuse(mailops.FOLDER_NAME_BAD)
    raw = parent + accountcopy.encode_mutf7(leaf)
    if raw == current:
        raise _refuse(mailops.FOLDER_SAME)
    for n in ctx.names:
        if n != current and (n == raw or _name(n).casefold()
                             == _name(raw).casefold()):
            raise _refuse(mailops.FOLDER_EXISTS, folder=_name(raw))
    if accountcopy._reserved(conn, acc, raw, ctx.pairs, d):
        raise _refuse(mailops.FOLDER_RESERVED, folder=_name(raw))
    return raw, leaf


def _new_prefix(ctx: _Ctx, conn) -> str:
    """Where this user's own folders live: the personal namespace the server
    announces, `INBOX.` where every folder sits below it, and Proton Bridge's
    "Folders/" where it has that parent beside "Labels"."""
    prefix, delim = accountcopy._layout(conn, ctx.pairs)
    if not prefix:
        top = {_name(n).lower(): n for n in ctx.names
               if ctx.delim_of(n) not in _name(n)}
        if "folders" in top and "labels" in top and delim:
            return top["folders"] + delim
    return prefix


def check(acc, op: str, folder: str = "", target: str = "",
          name: str = "") -> dict:
    """The live numbers and the refusals of one operation, for its confirm.
    Raises the coded refusal the operation itself would raise; nothing is
    changed."""
    why = _busy(acc)
    if why:
        raise _refuse(why)
    conn = _connect(acc)
    try:
        ctx = _Ctx(conn, acc)
        if op == "merge":
            rules = _prepare_merge(conn, ctx, acc, folder, target)
            uv, uids = _live(conn, folder)
            pinned, protected = _held_in(acc, folder)
            kids = ctx.children(folder)
            return {"folder": folder, "name": _name(folder),
                    "target": target, "target_name": _name(target),
                    "count": len(uids), "uv": uv,
                    "max_uid": uids[-1] if uids else 0,
                    "rules": [_public_rule(r) for r in rules],
                    "pinned": pinned, "protected": protected,
                    "can_delete": None if not kids else "children"}
        if op == "rename":
            _require_unlocked(ctx, folder)
            raw, leaf = _new_name(conn, ctx, acc, _parent(ctx, folder), name,
                                  current=folder)
            im = cfgmod.account_imap(acc.name)
            was = _scan_off(im, folder)[0]
            # a pattern that now matches the new name keeps it out of the scan
            now_pat = _scan_off({"excluded_folders": [
                r for r in (im.get("excluded_folders") or [])
                if str(r).strip().endswith("*")]}, raw)[0]
            rules = rulesmod.moving_into(
                acc.name, lambda d: _mapper(ctx, folder, raw)(d) != d)
            return {"folder": folder, "name": _name(folder), "new": raw,
                    "new_name": _name(raw), "rules": [_public_rule(r)
                                                      for r in rules],
                    "children": len(ctx.children(folder)),
                    "stops_scanning": was is None and now_pat is not None}
        if op == "delete":
            _require_unlocked(ctx, folder)
            return {"folder": folder, "name": _name(folder), "count": 0,
                    "uv": _prepare_delete(conn, ctx, acc, folder)}
        raise ValueError("bad operation")
    finally:
        _logout(conn)


def _public_rule(r: dict) -> dict:
    return {k: r[k] for k in ("id", "name", "mode", "schedule")}


def _held_in(acc, folder: str) -> tuple[int, int]:
    """(pinned, protected) mails of the folder as the last scan knows them:
    they move with it and stay pinned / protected (both are kept by sender and
    Message-ID, not by place)."""
    pinned = pinstore.load_account(acc.name)
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    p = q = 0
    with acc.lock:
        for m in acc.index.values():
            if m["folder"] != folder:
                continue
            p += 1 if m.get("msgid") and m["msgid"] in pinned else 0
            q += 1 if cfgmod.is_protected(m.get("addr", ""), plist) else 0
    return p, q


def _confirmed(affected: list[dict], ids) -> None:
    """The rules the confirm named must be the rules that are there now (more
    is refused: a rule would change that nobody was told about)."""
    if ids is None:
        return
    if {r["id"] for r in affected} - set(ids):
        raise _refuse(mailops.FOLDER_RULES_CHANGED)


# ------------------------------------------------------------ local follow-up

def _mapper(ctx_or_delim, old: str, new: str):
    """`fn(name)` -> the name a folder (or one below it) has after `old` was
    renamed to `new`."""
    d = (ctx_or_delim.delim_of(old) if isinstance(ctx_or_delim, _Ctx)
         else ctx_or_delim)

    def fn(name):
        if name == old:
            return new
        if d and isinstance(name, str) and name.startswith(old + d):
            return new + name[len(old):]
        return name
    return fn


def _remap_entry(entry: dict, fn) -> dict:
    """A copy of an Undo step with every folder name it holds passed through
    `fn` (a renamed folder): the mails' source folders, the exact copies, the
    destination, the parts of a restore step, what it may recreate and the
    rules it repointed."""
    e = copy.deepcopy(entry)
    e["items"] = [(fn(f), m) for f, m in e["items"]]
    if e.get("in"):
        e["in"] = fn(e["in"])
    for c in e.get("copies") or []:
        c["folder"] = fn(c["folder"])
        if c.get("in"):
            c["in"] = fn(c["in"])
    for p in e.get("parts") or []:
        if p.get("head", {}).get("in"):
            p["head"]["in"] = fn(p["head"]["in"])
        p["mails"] = [(fn(m[0]), *m[1:]) for m in p.get("mails", [])]
    if e.get("recreate"):
        e["recreate"] = [fn(f) for f in e["recreate"]]
    for r in e.get("folder_rules") or []:
        r["from"], r["to"] = fn(r["from"]), fn(r["to"])
    return e


def _rename_state(acc, fn) -> None:
    """The renamed folder in everything the account keeps in memory: the scan
    index (and its label copies and UIDVALIDITYs), the group records, the
    scanned-folder list and the Undo steps - then the snapshot."""
    def moved(store: dict) -> dict:
        out = {}
        for k, m in store.items():
            new = fn(m["folder"])
            if new != m["folder"]:
                m = {**m, "folder": new}
                k = mailops.ikey(new, m["uid"])
            out[k] = m
        return out

    with acc.lock:
        for store in (acc.index, acc.label_copies):
            fresh = moved(store)
            store.clear()
            store.update(fresh)
        acc.folder_uv = {fn(f): uv for f, uv in acc.folder_uv.items()}
        acc.folder_roles = {r: fn(f) for r, f in acc.folder_roles.items()}
        for recs in acc.state["groups"].values():
            for rec in recs.values():
                if any(fn(f) != f for f in rec.get("folders", {})):
                    rec["folders"] = {fn(f): u
                                      for f, u in rec["folders"].items()}
        acc.state["folders_raw"] = [fn(f) for f in acc.state["folders_raw"]]
        acc.state["folders"] = [_name(f) for f in acc.state["folders_raw"]]
        acc.undo_log[:] = [_remap_entry(e, fn) for e in acc.undo_log]
        acc.assistant_undo[:] = [_remap_entry(e, fn)
                                 for e in acc.assistant_undo]
        acc.state["groups_rev"] += 1
        mailops._sync_undo(acc)
    mailops.flush_undo(acc)
    try:
        mailops.save_snapshot(acc)
    except Exception:
        log.exception("could not persist the snapshot after a rename")


def _rename_config(acc, ctx: _Ctx, old: str, new: str, fn) -> None:
    """The account's exclusion list and confirmed roles follow the rename:
    the folder keeps its scan switch (an explicit entry moves with it; one
    that only a wildcard excluded stays excluded by name when the new name
    escapes the pattern), the wildcards themselves stay as they are."""
    im = cfgmod.account_imap(acc.name)
    rules = [str(r) for r in (im.get("excluded_folders") or [])]
    names = [old, *ctx.children(old)]
    new_rules = [fn(r) if not r.strip().endswith("*") else r for r in rules]
    # the decoded spelling an older configuration may hold
    for n in names:
        shown = _name(n)
        new_rules = [_name(fn(n)) if r == shown else r for r in new_rules]
    for n in names:
        was = mailops.excluded(n, rules) or mailops.excluded(_name(n), rules)
        m = fn(n)
        now = mailops.excluded(m, new_rules) \
            or mailops.excluded(_name(m), new_rules)
        if was and not now:
            new_rules.append(m)
    body: dict = {}
    if new_rules != rules:
        body["excluded_folders"] = new_rules
    overrides = dict(im.get("role_overrides") or {})
    moved = {r: fn(f) for r, f in overrides.items()}
    imap = {"role_overrides": moved} if moved != overrides else None
    if body or imap:
        cfgmod.update_config({"account": acc.name, **body,
                              **({"imap": imap} if imap else {})})


def _scanned_after_create(acc, raw: str) -> None:
    """A new (empty) folder is a target for moves and rules right away when
    the scan would read it."""
    im = cfgmod.account_imap(acc.name)
    if _scan_off(im, raw)[0]:
        return
    with acc.lock:
        if raw not in acc.state["folders_raw"]:
            acc.state["folders_raw"] = [*acc.state["folders_raw"], raw]
            acc.state["folders"] = [*acc.state["folders"], _name(raw)]
        acc.state["groups_rev"] += 1


def _forget_folder(acc, raw: str) -> None:
    with acc.lock:
        acc.state["folders_raw"] = [f for f in acc.state["folders_raw"]
                                    if f != raw]
        acc.state["folders"] = [_name(f) for f in acc.state["folders_raw"]]
        acc.folder_uv.pop(raw, None)
        acc.state["groups_rev"] += 1


def _subscribe(conn, raw: str, on: bool = True) -> None:
    try:
        (conn.subscribe if on else conn.unsubscribe)(
            mailops.quote_folder(raw))
    except Exception:
        pass            # only makes the folder (not) show up in some apps


# ---------------------------------------------------------------- operations

def create(acc, name: str) -> dict:
    """CREATE a folder below the user's namespace (never a name the server
    uses for something else, never one that exists)."""
    with _operation(acc, mails=False):
        conn = _connect(acc)
        try:
            ctx = _Ctx(conn, acc)
            raw, leaf = _new_name(conn, ctx, acc, _new_prefix(ctx, conn), name)
            status, _ = conn.create(mailops.quote_folder(raw))
            if status != "OK" and raw not in mailops.list_folders(conn):
                raise _refuse(mailops.FOLDER_CREATE_FAILED, folder=_name(raw))
            _subscribe(conn, raw)
        finally:
            _logout(conn)
        _scanned_after_create(acc, raw)
        auditlog.record("folder_create", account=acc.name, label=_name(raw),
                        entry_id=auditlog.new_id())
        log.info("a folder was created")
        return {"raw": raw, "name": _name(raw)}


def rename(acc, folder: str, name: str, rules=None) -> dict:
    """RENAME a folder in place (same parent). The rules that move mail into
    it (or into a folder below it) follow it and go back to Report only; the
    exclusion list, confirmed roles, Undo steps and the scan index follow it
    too, and a scan starts so every number is the server's again."""
    with _operation(acc):
        conn = _connect(acc)
        try:
            ctx = _Ctx(conn, acc)
            _require_unlocked(ctx, folder)
            raw, leaf = _new_name(conn, ctx, acc, _parent(ctx, folder), name,
                                  current=folder)
            fn = _mapper(ctx, folder, raw)
            affected = rulesmod.moving_into(acc.name, lambda d: fn(d) != d)
            _confirmed(affected, rules)
            status, _ = conn.rename(mailops.quote_folder(folder),
                                    mailops.quote_folder(raw))
            if status != "OK":
                raise _refuse(mailops.FOLDER_RENAME_FAILED,
                              folder=_name(folder))
            _subscribe(conn, raw)
        finally:
            _logout(conn)
        # the server did it: from here on every step is bookkeeping, none of
        # which may stop the next (each failure is logged and reported)
        failed: list[str] = []
        for step, run in (
                ("config", lambda: _rename_config(acc, ctx, folder, raw, fn)),
                ("state", lambda: _rename_state(acc, fn)),
                ("rules", lambda: rulesmod.repoint_dest(acc.name, fn))):
            try:
                run()
            except Exception:
                log.exception("rename: could not update the %s", step)
                failed.append(step)
        auditlog.record("folder_rename", account=acc.name,
                        label=f"{_name(folder)} → {_name(raw)}",
                        count=len(affected), entry_id=auditlog.new_id())
        mailops._rescan_after_restore(acc, 1, "folder_renamed", {
            "from": _name(folder), "to": _name(raw)})
        return {"raw": raw, "name": _name(raw),
                "rules": [_public_rule(r) for r in affected],
                "failed": failed}


def _prepare_delete(conn, ctx: _Ctx, acc, folder: str) -> int:
    """Every refusal of a delete; the folder's UIDVALIDITY when it may go."""
    _require_unlocked(ctx, folder)
    if ctx.children(folder):
        raise _refuse(mailops.FOLDER_HAS_CHILDREN, folder=_name(folder))
    used = rulesmod.moving_into(acc.name, lambda d: d == folder)
    if used:
        raise _refuse(mailops.FOLDER_USED_BY_RULES, folder=_name(folder),
                      n=len(used))
    return _assert_empty(conn, folder)


def _drop(conn, acc, raw: str) -> None:
    """DELETE the (just checked) empty folder and forget it."""
    status, _ = conn.delete(mailops.quote_folder(raw))
    if status != "OK":
        raise _refuse(mailops.FOLDER_DELETE_FAILED, folder=_name(raw))
    _subscribe(conn, raw, on=False)
    _forget_folder(acc, raw)
    auditlog.record("folder_delete", account=acc.name, label=_name(raw),
                    entry_id=auditlog.new_id())
    log.info("an empty folder was deleted")


def delete(acc, folder: str, uv: int = 0) -> dict:
    """DELETE an empty folder - the server's own count decides, right now."""
    with _operation(acc):
        conn = _connect(acc)
        try:
            ctx = _Ctx(conn, acc)
            now = _prepare_delete(conn, ctx, acc, folder)
            if uv and now != uv:
                raise _refuse(mailops.FOLDER_CHANGED, folder=_name(folder))
            _drop(conn, acc, folder)
        finally:
            _logout(conn)
        return {"deleted": _name(folder)}


def merge(acc, folder: str, target: str, uv: int, max_uid: int,
          delete_after: bool = False, rules=None) -> dict:
    """Move every mail of `folder` (UIDs <= `max_uid`, as counted by the
    confirm, UIDVALIDITY `uv`) into `target` as one step with an Undo, point
    the rules at the target, and - when asked and the folder is empty - delete
    it. The order is the safety: mails first, the Undo step before anything
    else, the rules next, the delete last (and only on a fresh count of 0)."""
    if uv <= 0:
        raise _refuse(mailops.COUNT_REQUIRED)
    with _operation(acc):
        conn = _connect(acc)
        try:
            return _merge_locked(conn, acc, folder, target, uv, max_uid,
                                 delete_after, rules)
        finally:
            _logout(conn)


def _merge_locked(conn, acc, folder, target, uv, max_uid, delete_after,
                  rules) -> dict:
    moved = 0
    copies: list[dict] = []
    failure: Exception | None = None
    audit_id = auditlog.new_id()
    affected: list[dict] = []
    ctx = None
    try:
        ctx = _Ctx(conn, acc)
        affected = _prepare_merge(conn, ctx, acc, folder, target)
        _confirmed(affected, rules)
        if max_uid <= 0:
            return {"moved": 0, "undo": None, "rules": [], "deleted": False,
                    "kept": ""}
        status, _ = conn.select(mailops.quote_folder(folder), readonly=False)
        if status != "OK":
            raise _refuse(mailops.CANNOT_OPEN, folder=_name(folder))
        if mailops.uidvalidity(conn) != uv:
            raise _refuse(mailops.FOLDER_CHANGED, folder=_name(folder))
        chosen = [u for u in mailops._all_uids(conn) if u <= max_uid]
        for start in range(0, len(chosen), mailops.MOVE_CHUNK):
            chunk = chosen[start:start + mailops.MOVE_CHUNK]
            before = len(copies)
            try:
                if not mailops._move_with_receipt(
                        conn, folder, target, chunk, uv, copies):
                    raise RuntimeError(mailops.CANNOT_MOVE)
            finally:
                moved += len(copies) - before
    except Exception as exc:
        failure = exc
    undo = None
    if moved:
        undo = _record_merge(acc, folder, target, copies, moved, audit_id,
                             affected, delete_after, failure)
    if failure is not None:
        if moved:
            raise _refuse(mailops.MOVED_THEN_FAILED, n=moved,
                          cause=str(failure)) from failure
        raise failure
    changed = _repoint(acc, folder, target)
    deleted, kept = False, ""
    if delete_after:
        deleted, kept = _delete_emptied(conn, ctx, acc, folder)
    _after_merge(acc, folder, copies, moved, target)
    return {"moved": moved, "target": _name(target), "undo": undo,
            "rules": [{k: r[k] for k in ("id", "name", "mode")}
                      for r in changed],
            "deleted": deleted, "kept": kept}


def _record_merge(acc, folder, target, copies, moved, audit_id, affected,
                  delete_after, failure) -> dict | None:
    """The Undo step and the Activity entry of a merge, as soon as mail has
    moved (also a part-way one): nothing else of the merge runs before this."""
    items = [(folder, c.get("msgid", "")) for c in copies]
    label = _name(folder)
    undo = None
    with acc.lock:
        if items:
            entry = {"id": f"{time.time_ns():x}", "audit_id": audit_id,
                     "ts": int(time.time()), "label": label,
                     "action": "move_contents", "count": len(items),
                     "items": items, "in": target, "copies": copies,
                     "folder_merge": True}
            if failure is None:
                if delete_after:
                    entry["recreate"] = [folder]
                if affected:
                    entry["folder_rules"] = [
                        {"id": r["id"], "from": folder, "to": target}
                        for r in affected]
            acc.undo_log.append(entry)
            mailops._sync_undo(acc)
            undo = mailops._undo_ident(acc.undo_log[-1])
    mailops.flush_undo(acc)
    auditlog.record("move_contents", account=acc.name, count=moved,
                    label=f"{label} → {_name(target)}",
                    outcome="ok" if failure is None else "partial",
                    error="" if failure is None else str(failure),
                    entry_id=audit_id)
    log.info("merged %d mails into another folder", moved)
    return undo


def _repoint(acc, folder: str, target: str) -> list[dict]:
    try:
        return rulesmod.repoint_dest(
            acc.name, lambda d: target if d == folder else d)
    except Exception:
        log.exception("merge: could not repoint the rules")
        return []


def _delete_emptied(conn, ctx: _Ctx, acc, folder: str) -> tuple[bool, str]:
    """`(deleted, why not)` - the emptied folder goes only on a fresh count of
    0 and with no subfolder and no rule left on it; anything else keeps it,
    with the code of why."""
    try:
        if ctx.children(folder):
            return False, "children"
        if rulesmod.moving_into(acc.name, lambda d: d == folder):
            return False, "rules"
        _assert_empty(conn, folder)
        _drop(conn, acc, folder)
        return True, ""
    except RuntimeError as exc:
        text = str(exc)
        return False, text.partition(":")[0] or "failed"


def _after_merge(acc, folder: str, copies: list[dict], moved: int,
                 target: str) -> None:
    """The moved mails leave the scan index (they live in another folder under
    new UIDs): a scan brings them back where they are now."""
    gone = {c["source_uid"] for c in copies}
    if gone:
        with acc.lock:
            mailops._apply_removal({folder: gone}, acc)
    mailops._rescan_after_restore(acc, moved, "folder_merged", {
        "n": moved, "from": _name(folder), "to": _name(target)})


def undo_rules(acc, entry: dict) -> None:
    """After the Undo of a merge: the rules it had repointed go back to the
    folder they moved mail into - only those still at the target (one the user
    edited since is theirs) and still Report only."""
    by_pair: dict[tuple[str, str], set[str]] = {}
    for r in entry.get("folder_rules") or []:
        by_pair.setdefault((r["from"], r["to"]), set()).add(r["id"])
    for (src, tgt), ids in by_pair.items():
        rulesmod.repoint_dest(
            acc.name, lambda d, s=src, t=tgt: s if d == t else d, ids=ids)
