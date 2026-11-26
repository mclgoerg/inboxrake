"""Keep the mail, remove the file: the mailbox side (mimecut.py has the bytes).

The Attachments page and the reader's attachment chips can take chosen files
out of mails while the mails stay. For each mail: read the full original
(locally only, never sent anywhere), build the same mail minus the chosen
files (a short note where each was; every header, the Message-ID included,
and every other byte as they were, plus an `X-Inboxrake-Removed` header),
APPEND it to the SAME folder with the original's flags and INTERNALDATE,
CHECK the copy (APPENDUID or a search by Message-ID + header, then a re-read
of the kept parts), and only then move the original to Trash through the
existing move job, which records the Undo step. Undo swaps them back: the
original out of Trash, the copy to Trash (`trash_lighter_copies`).

Nothing is lost on the way: any failure before the move leaves the original
untouched and takes a half-made copy out again (`finish`, and `sweep` after a
crash, see removejournal.py); the copy
is only ever moved to Trash after its original is back; a mail is never
touched when it is pinned, from a protected sender, signed, encrypted, too
big, when it also sits in a Proton Bridge label folder, or on a Gmail account
(where one Message-ID is one mail, so the copy cannot be made safely).
Refusals are coded (`mailops.coded`), exception text never reaches a client.
"""

from __future__ import annotations

import email
import imaplib
import logging
import re
import tempfile
import time
import zipfile
from email import policy as _policy

from . import config as cfgmod
from . import keepsafe
from . import mailops
from . import mimecut
from . import pinstore
from . import removejournal
from . import yourfolders

log = logging.getLogger("inboxrake.removefiles")

MAIL_CAP = 64 * 1024 * 1024        # a bigger mail is left alone
ZIP_CAP = 256 * 1024 * 1024        # the "Download the files first" archive
ZIP_READ_CAP = 4 * ZIP_CAP         # what may be read from the server for it
ITEMS_MAX = 2000                   # mails per request
FILES_MAX = 200                    # files per request
LANGS = ("en", "de")

# why a mail is left as it is (`rmf.why.<reason>` in the interface)
SIGNED, ENCRYPTED = "signed", "encrypted"
TOO_BIG, NO_MSGID, LABELS = "too_big", "no_msgid", "labels"
GMAIL = "gmail"
LABEL_FOLDER, DELETED, NOT_FOUND = "label_folder", "deleted", "not_found"
UNKNOWN, UNSUPPORTED, CHANGED = "unknown", "unsupported", "changed"
PINNED, PROTECTED = "pinned", "protected"
FAILED, VERIFY_FAILED, NO_ROLE = "failed", "verify_failed", "no_trash"

_UID_RE = re.compile(rb"UID (\d+)")
_FLAGS_RE = re.compile(rb"FLAGS \(([^)]*)\)")
_IDATE_RE = re.compile(
    rb'INTERNALDATE "(\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2} [+-]\d{4})"')
_APPENDUID_RE = re.compile(rb"APPENDUID (\d+) (\d+)")
_KEEP_FLAGS = {"\\seen", "\\flagged", "\\answered", "\\draft"}


# ------------------------------------------------------------ small helpers

def _clean_files(files) -> list[tuple[str, int]]:
    """The (name, size) pairs a request names, validated and de-duplicated."""
    out: list[tuple[str, int]] = []
    for f in files or ():
        try:
            name, size = (f["name"], f["size"]) if isinstance(f, dict) \
                else (f[0], f[1])
            name, size = str(name), int(size)
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        if name and size > 0 and (name, size) not in out:
            out.append((name, size))
    return out[:FILES_MAX]


def _wanted(files: list[tuple[str, int]]) -> dict[tuple[str, int], int]:
    return {(n.lower(), s): i for i, (n, s) in enumerate(files)}


def _rows(acc, items, files) -> list[dict]:
    """The mails of `items` (folder, uid) the index knows to hold one of
    `files`: `{m (a copy of the index record), files (their positions)}`."""
    want = _wanted(files)
    rows: list[dict] = []
    seen: set[tuple[str, int]] = set()
    with acc.lock:
        for it in list(items or ())[:ITEMS_MAX]:
            if not (isinstance(it, (list, tuple)) and len(it) == 2):
                continue
            try:
                folder, uid = str(it[0]), int(it[1])
            except (TypeError, ValueError):
                continue
            if (folder, uid) in seen:
                continue
            seen.add((folder, uid))
            m = acc.index.get(mailops.ikey(folder, uid))
            if not m:
                continue
            hit = sorted({want[(a["name"].lower(), a["size"])]
                          for a in m.get("atts") or ()
                          if (a["name"].lower(), a["size"]) in want})
            if hit:
                rows.append({"m": dict(m), "files": hit})
    return rows


def _guards(acc, rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """`(blocked, rest)`: the rows of pinned mails or protected senders (they
    stop the action, like Move to Trash) and the others."""
    pinned = pinstore.load_account(acc.name)
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    blocked, rest = [], []
    for r in rows:
        m = r["m"]
        why = PROTECTED if cfgmod.is_protected(m["addr"], plist) \
            else PINNED if m.get("msgid") in pinned and m.get("msgid") \
            else ""
        (blocked if why else rest).append({**r, "why": why})
    return blocked, rest


def _row_json(r: dict) -> dict:
    m = r["m"]
    return {"folder": m["folder"], "uid": m["uid"],
            "subject": (m.get("subject") or "")[:150], "addr": m["addr"],
            "size": m["size"]}


def _static_skip(m: dict) -> str:
    """What the index alone says against touching a mail."""
    if not m.get("msgid"):
        return NO_MSGID
    if m["size"] > MAIL_CAP:
        return TOO_BIG
    return ""


# ---------------------------------------------------------- mail server bits

def _blob_of(item) -> bytes:
    if isinstance(item, tuple):
        return b" ".join(p for p in item if isinstance(p, (bytes, bytearray)))
    return bytes(item) if isinstance(item, (bytes, bytearray)) else b""


def _bs_blob(rec: bytes) -> bytes:
    """The BODYSTRUCTURE list of one FETCH answer (parentheses balanced, quoted
    strings skipped)."""
    at = rec.find(b"BODYSTRUCTURE ")
    if at < 0:
        return b""
    j = start = at + len(b"BODYSTRUCTURE ")
    depth = 0
    while j < len(rec):
        c = rec[j:j + 1]
        if c == b"(":
            depth += 1
        elif c == b")":
            depth -= 1
            if depth == 0:
                break
        elif c == b'"':
            j += 1
            while j < len(rec) and rec[j:j + 1] != b'"':
                j += 2 if rec[j:j + 1] == b"\\" else 1
        j += 1
    return rec[start:j + 1]


def _bs_secure(node) -> str:
    """"signed" / "encrypted" for a parsed BODYSTRUCTURE, like
    mimecut.secure_kind does for the whole message."""
    if not isinstance(node, list) or not node:
        return ""
    if isinstance(node[0], list):                    # a multipart
        sub = next((x for x in node if isinstance(x, str)), "").lower()
        if sub in ("signed", "encrypted"):
            return sub
        found = ""
        for child in node:
            kind = _bs_secure(child)
            if kind == "encrypted":
                return kind
            found = found or kind
        return found
    if len(node) < 2 or not isinstance(node[0], str):
        return ""
    ctype = f"{node[0]}/{node[1]}".lower()
    if ctype in ("application/pkcs7-signature", "application/x-pkcs7-signature",
                 "application/pgp-signature"):
        return "signed"
    if ctype == "application/pgp-encrypted":
        return "encrypted"
    if ctype in ("application/pkcs7-mime", "application/x-pkcs7-mime"):
        kind = mailops._bs_param(node[2] if len(node) > 2 else None,
                                 "smime-type").lower()
        return "signed" if kind == "signed-data" else "encrypted"
    return ""


class _Server:
    """What the checks need to know of the account's folders (one LIST, once):
    whether it is a Gmail account (the feature is off there) and, for Proton
    Bridge, the Message-IDs the label folders hold."""

    def __init__(self, conn, acc):
        self.conn = conn
        self.acc = acc
        self.ctx = yourfolders._Ctx(conn, acc)
        try:
            preset = cfgmod.account_imap(acc.name).get("preset")
        except Exception:
            preset = ""
        # Gmail keeps ONE mail per Message-ID (a second one with the same id
        # is merged into the first), so a lighter copy that must share the
        # original's Message-ID cannot be made there without risking the
        # mail: the feature is off for Gmail accounts
        self.gmail = bool(self.ctx.gmail) or preset == "gmail"
        self._label_ids: set[str] | None = None

    def label_folder(self, folder: str) -> bool:
        """Is `folder` a Proton Bridge label (`Labels/...`)? Not a home for a
        mail."""
        return not self.gmail and self.ctx.is_label(folder)

    def _proton_label_ids(self) -> set[str]:
        if self._label_ids is None:
            ids: set[str] = set()
            for name in self.ctx.names:
                segs = [s.lower() for s in self.ctx.segments(name)]
                if name in self.ctx.noselect or not (
                        (len(segs) > 1 and segs[0] == "labels")
                        or segs == ["starred"]):
                    continue
                status, _ = self.conn.select(mailops.quote_folder(name),
                                             readonly=True)
                if status != "OK":
                    continue
                ids |= {v for v in mailops._fetch_msgid_map(
                    self.conn, mailops._list_uids(self.conn)).values() if v}
            self._label_ids = ids
        return self._label_ids

    def label_guard(self, folder: str, msgid: str) -> str:
        """"" when nothing stands against a copy in `folder`: GMAIL on a Gmail
        account, LABEL_FOLDER for a label folder, LABELS for a mail that also
        sits in a Proton label folder."""
        if self.gmail:
            return GMAIL
        if self.label_folder(folder):
            return LABEL_FOLDER
        return LABELS if msgid in self._proton_label_ids() else ""


def _failure(exc: Exception, acc) -> str:
    """The code a client gets for a server problem: a well-known connection
    or sign-in failure by its own code, anything else `rm_failed` - never the
    exception's text."""
    try:
        host = cfgmod.account_imap(acc.name)["host"]
    except Exception:
        host = ""
    return mailops.classify_connect_error(exc, host) \
        or mailops.coded(mailops.RM_FAILED)


def _flags_of(blob: bytes) -> set[str]:
    m = _FLAGS_RE.search(blob)
    return {f.decode("latin-1") for f in m.group(1).split()} if m else set()


def _fetch_one(conn, uid: int) -> dict | None:
    """`{raw, flags, idate}` of one mail of the selected folder (BODY.PEEK:
    nothing is marked read), None when the server has none."""
    status, data = conn.uid(
        "FETCH", str(uid), "(UID FLAGS INTERNALDATE BODY.PEEK[])")
    if status != "OK":
        raise imaplib.IMAP4.error("FETCH failed")
    meta = raw = None
    for item in data or []:
        if isinstance(item, tuple) and len(item) >= 2:
            meta, raw = item[0], bytes(item[1])
        elif isinstance(item, (bytes, bytearray)) and meta is not None:
            meta += b" " + bytes(item)
    if meta is None or raw is None:
        return None
    um = _UID_RE.search(meta)
    if um and int(um.group(1)) != uid:
        return None
    dm = _IDATE_RE.search(meta)
    return {"raw": raw, "flags": _flags_of(meta),
            "idate": dm.group(1).decode() if dm else None}


def _idate_epoch(text: str | None) -> float | None:
    if not text:
        return None
    try:
        tt = imaplib.Internaldate2tuple(f'INTERNALDATE "{text}"'.encode())
        return time.mktime(tt) if tt else None
    except Exception:
        return None


def _header_of(raw: bytes, name: str) -> str:
    msg = email.message_from_bytes(raw, policy=_policy.compat32)
    return mailops.header_text(msg.get(name)).strip()


# --------------------------------------------------------------- the check

def _live_look(conn, acc, rows: list[dict], srv: _Server) -> None:
    """Fill `skip` of every row from the server (read only): a changed
    folder, a mail flagged deleted, a signature or encryption (from the
    BODYSTRUCTURE - the job looks at the whole mail again), Gmail labels or
    Proton label folders."""
    if srv.gmail:
        for r in rows:
            r["skip"] = GMAIL
        return
    by_folder: dict[str, list[dict]] = {}
    for r in rows:
        by_folder.setdefault(r["m"]["folder"], []).append(r)
    for folder, group in by_folder.items():
        group = [r for r in group if not r["skip"]]
        if not group:
            continue
        status, _ = conn.select(mailops.quote_folder(folder), readonly=True)
        if status != "OK":
            for r in group:
                r["skip"] = CHANGED
            continue
        expected = acc.folder_uv.get(folder)
        if expected and mailops.uidvalidity(conn) not in (0, expected):
            for r in group:
                r["skip"] = CHANGED
            continue
        if srv.label_folder(folder):
            for r in group:
                r["skip"] = LABEL_FOLDER
            continue
        seen: dict[int, bytes] = {}
        for start in range(0, len(group), mailops.FETCH_CHUNK):
            chunk = group[start:start + mailops.FETCH_CHUNK]
            status, data = conn.uid(
                "FETCH", ",".join(str(r["m"]["uid"]) for r in chunk),
                "(UID FLAGS BODYSTRUCTURE)")
            if status != "OK":
                raise imaplib.IMAP4.error("FETCH failed")
            for item in data or []:
                rec = _blob_of(item)
                um = _UID_RE.search(rec)
                if um:
                    seen[int(um.group(1))] = rec
        for r in group:
            rec = seen.get(r["m"]["uid"])
            if rec is None:
                r["skip"] = CHANGED
                continue
            if "\\Deleted" in _flags_of(rec):
                r["skip"] = DELETED
                continue
            blob = _bs_blob(rec)
            if blob:
                kind = _bs_secure((mailops._bs_parse(
                    mailops._bs_tokenize(blob)) or [None])[0])
                if kind:
                    r["skip"] = kind
                    continue
            why = srv.label_guard(folder, r["m"]["msgid"])
            if why:
                r["skip"] = why


def check(acc, items, files) -> dict:
    """What a removal of `files` from the mails of `items` would do, for the
    confirm (nothing is changed): `mails` (each with the positions of its
    files, the Keep-safe class that covers it and, when it would be left as
    it is, `skip` = the reason), `blocked` (pinned mails and protected
    senders: they stop the action), `files` (per file: mails, Keep-safe
    mails, classes) and the size of the "Download the files first" archive.
    A refusal comes back as `refused` (a code)."""
    files = _clean_files(files)
    out = {"mails": [], "blocked": [], "files": [], "refused": None,
           "zip": {"bytes": 0, "cap": ZIP_CAP}}
    if not files:
        out["refused"] = mailops.coded(mailops.RM_NOTHING)
        return out
    with acc.lock:
        if acc.state["status"] != "done":
            out["refused"] = mailops.coded(mailops.RM_NOT_SCANNED)
            return out
    blocked, rest = _guards(acc, _rows(acc, items, files))
    out["blocked"] = [{**_row_json(r), "why": r["why"]} for r in blocked]
    for r in rest:
        r["skip"] = _static_skip(r["m"])
    safe_classes = keepsafe.enabled_classes()
    live = [r for r in rest if not r["skip"]]
    if live:
        try:
            conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
            try:
                _live_look(conn, acc, live, _Server(conn, acc))
            finally:
                try:
                    conn.logout()
                except Exception:
                    pass
        except Exception as exc:
            log.warning("remove check failed: %s", type(exc).__name__)
            out["refused"] = _failure(exc, acc)
            return out
    per_file = [{"name": n, "size": s, "mails": 0, "safe": 0, "classes": []}
                for n, s in files]
    for r in rest:
        cls = keepsafe.mail_class(r["m"], safe_classes) or ""
        out["mails"].append({**_row_json(r), "files": r["files"],
                             "safe": cls, "skip": r["skip"]})
        if r["skip"]:
            continue
        for i in r["files"]:
            per_file[i]["mails"] += 1
            if cls:
                per_file[i]["safe"] += 1
                if cls not in per_file[i]["classes"]:
                    per_file[i]["classes"].append(cls)
    out["files"] = per_file
    out["zip"]["bytes"] = sum(f["size"] for f in per_file if f["mails"])
    return out


# ------------------------------------------------------------------- start

def start(acc, items, files, confirm: int, lang: str = "en") -> dict:
    """Queue the removal as one move job (see mailops._delete_worker).
    `confirm` is the number of mails the confirm named. Returns `{"ok",
    "queued", "job"}` or `{"refused": code}`: the same guard as Move to Trash
    (a pinned mail or a protected sender stops it), a scan / move / folder
    operation in the way, a confirm that no longer fits."""
    files = _clean_files(files)
    refuse = lambda code, **kw: {"refused": mailops.coded(code, **kw)}  # noqa: E731
    if not files:
        return refuse(mailops.RM_NOTHING)
    with acc.lock:
        if acc.state["status"] != "done":
            return refuse(mailops.RM_NOT_SCANNED)
    blocked, rest = _guards(acc, _rows(acc, items, files))
    if blocked:
        why = {r["why"] for r in blocked}
        return {"refused": mailops.PINNED_MAILS if PINNED in why
                else "protected_sender_selected"}
    if not rest:
        return refuse(mailops.RM_NOTHING)
    if confirm != len(rest):
        return refuse(mailops.RM_CHANGED)
    ready = [r for r in rest if not _static_skip(r["m"])]
    if not ready:
        return refuse(mailops.RM_NOTHING)
    why = yourfolders._busy(acc)
    if why:
        return {"refused": mailops.coded(why)}
    by_folder: dict[str, set[int]] = {}
    for r in ready:
        by_folder.setdefault(r["m"]["folder"], set()).add(r["m"]["uid"])
    n = sum(len(v) for v in by_folder.values())
    # each mail is cut only of the files the confirm listed FOR IT
    per_mail = {f"{r['m']['folder']}\0{r['m']['uid']}": r["files"]
                for r in ready}
    spec = {"files": [list(f) for f in files], "per_mail": per_mail,
            "lang": lang if lang in LANGS else "en", "ts": int(time.time())}
    with acc.lock:
        try:
            job = mailops._start_delete(
                by_folder, f"{n} mail{'' if n == 1 else 's'} without files",
                acc, mimecut.ACTION, strip=spec)
        except RuntimeError:
            return refuse(mailops.BUSY_ACTION)
    return {"ok": True, "queued": n, "job": job}


# --------------------------------------------------------------------- job

def _pick_for(root, m: dict, files, positions):
    """The parts of ONE mail that are the files asked for it (`positions`
    into `files`, from the mail's own index entry): exact name + size; a
    server that counts a line break more may be stood in for only by the one
    part of that name the mail's index lists once."""
    mine = [tuple(files[i]) for i in positions]
    own = [a["name"].lower() for a in m.get("atts") or ()]
    near = {(n.lower(), sz) for n, sz in mine if own.count(n.lower()) == 1}
    return mimecut.pick(root, mine, near)


def _requested_flags(flags: set[str]) -> str:
    keep = sorted(f for f in flags
                  if f.lower() in _KEEP_FLAGS
                  or (not f.startswith("\\") and f))
    return "(" + " ".join(keep) + ")" if keep else ""


def prepare(acc, job: dict, progress_cb, strips: dict, skipped: list
            ) -> dict[str, set[int]]:
    """The first half of a removal, run by the move worker: for every mail of
    the job make the lighter copy, put it in the folder and check it. Returns
    the originals that may now go to Trash (`{folder: uids}`); a copy that
    passed is also in `strips[(folder, uid)]`, what could not be done is in
    `skipped` as (folder, uid, reason). Cancelling or a lost connection
    raises; what was copied until then is in `strips` for `finish`."""
    spec = job["strip"]
    files = _clean_files(spec["files"])
    per_mail = spec.get("per_mail") or {}
    when = time.gmtime(spec["ts"])
    ready: dict[str, set[int]] = {}
    total = sum(len(u) for u in job["by_folder"].values())
    done = 0
    sweep(acc, in_job=True)     # copies a crashed earlier run left
    conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    try:
        srv = _Server(conn, acc)
        if not mailops.folder_roles(conn, acc).get("trash"):
            raise RuntimeError(mailops.coded(mailops.ROLE_MISSING,
                                             role="trash"))
        for folder, uids in job["by_folder"].items():
            for uid in sorted(uids):
                if mailops.cancel_requested("delete", acc):
                    raise mailops.Cancelled()
                try:
                    got = _one(conn, acc, srv, folder, uid, files,
                               per_mail.get(f"{folder}\0{uid}"), when,
                               spec["lang"])
                except (imaplib.IMAP4.abort, OSError):
                    raise
                except Exception as exc:
                    log.warning("remove files: one mail failed (%s)",
                                type(exc).__name__)
                    got = FAILED
                if isinstance(got, str):
                    skipped.append((folder, uid, got))
                else:
                    strips[(folder, uid)] = got
                    ready.setdefault(folder, set()).add(uid)
                done += 1
                progress_cb(done, total)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return ready


def _uidnext(conn, folder: str) -> int | None:
    """The folder's UIDNEXT: every UID the server hands out from now on is
    at least this. None when it cannot be read."""
    try:
        st, d = conn.status(mailops.quote_folder(folder), "(UIDNEXT)")
    except imaplib.IMAP4.error:
        return None
    m = re.search(rb"UIDNEXT (\d+)", b" ".join(
        x for x in d or [] if isinstance(x, bytes)))
    return int(m.group(1)) if st == "OK" and m else None


def _present(conn, folder: str, uid: int) -> bool:
    """Is the mail with this UID still in the folder?"""
    status, _ = conn.select(mailops.quote_folder(folder), readonly=True)
    return status == "OK" and uid in mailops._fetch_msgid_map(conn, [uid])


def _one(conn, acc, srv: _Server, folder: str, uid: int, files, positions,
         when, lang: str):
    """Copy one mail: the strip record once its lighter copy stands in the
    folder and has been checked, else the reason it is left alone. `positions`
    are the files (of `files`) the confirm listed for THIS mail."""
    with acc.lock:
        m = acc.index.get(mailops.ikey(folder, uid))
        m = dict(m) if m else None
    if m is None or not positions:
        return CHANGED
    pinned = pinstore.load_account(acc.name)
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    if cfgmod.is_protected(m["addr"], plist):
        return PROTECTED
    if m.get("msgid") and m["msgid"] in pinned:
        return PINNED
    if (why := _static_skip(m)):
        return why
    why = srv.label_guard(folder, m["msgid"])
    if why:
        return why
    status, _ = conn.select(mailops.quote_folder(folder), readonly=True)
    expected = acc.folder_uv.get(folder)
    uv = mailops.uidvalidity(conn)
    if status != "OK" or (expected and uv and uv != expected):
        return CHANGED
    got = _fetch_one(conn, uid)
    if got is None:
        return CHANGED
    raw, flags = got["raw"], got["flags"]
    if len(raw) > MAIL_CAP:
        return TOO_BIG
    if "\\Deleted" in flags:
        return DELETED
    if _header_of(raw, "Message-ID")[:300] != m["msgid"]:
        return CHANGED
    try:
        root = mimecut.parse(raw)
    except mimecut.MimeError:
        return UNSUPPORTED
    kind = mimecut.secure_kind(root, raw)
    if kind:
        return kind
    found, missing = _pick_for(root, m, files, positions)
    if not found:
        return NOT_FOUND
    mine = [list(files[i]) for i in positions]
    notes = [mimecut.note_text(a.name, a.size, when, lang) for a in found]
    lines = [mimecut.removed_header_line(a.name, a.size, when) for a in found]
    new = mimecut.build_copy(raw, root, found, notes, lines)
    want_flags = _requested_flags(flags)
    # Everything the server hands out from now on is >= floor: only such a
    # UID (and never the original's) can be our copy.
    floor = _uidnext(conn, folder)
    if floor is None:
        return FAILED
    base, tenant = mailops.SNAPSHOT_DIR, acc.tenant
    try:
        jid = removejournal.add(acc.name, tenant, base, {
            "folder": folder, "uv": uv, "floor": floor, "orig": uid,
            "msgid": m["msgid"]})
    except OSError:
        return FAILED          # no record of what is about to be made: none made
    new_uid, new_uv, sent = _append(conn, folder, uv, want_flags,
                                    got["idate"], new, m["msgid"], floor, uid)
    if new_uid is None:
        if not sent:           # nothing was stored: nothing to settle
            removejournal.clear(acc.name, tenant, base, [jid])
        return FAILED          # (stored but not identified: the sweep looks)
    removejournal.update(acc.name, tenant, base, jid, uid=new_uid)
    if not _present(conn, folder, uid):
        # the original is gone (a server that merges mails by Message-ID, or
        # another client): the copy is now the mail, never touched
        removejournal.clear(acc.name, tenant, base, [jid])
        return CHANGED
    try:
        ok = _verify(conn, folder, new_uv, new_uid, raw, root, found, files,
                     want_flags, got["idate"], m["msgid"], lines)
    except (imaplib.IMAP4.abort, OSError):
        raise
    except Exception:
        log.warning("remove files: the copy could not be read back",
                    exc_info=True)
        ok = False
    if not ok:
        if _discard(conn, folder, new_uv, new_uid, floor, uid):
            removejournal.clear(acc.name, tenant, base, [jid])
        return VERIFY_FAILED
    return {"uid": new_uid, "uv": new_uv, "size": len(new),
            "removed": [f for f in mine
                        if tuple(f) not in {tuple(x) for x in missing}],
            "bytes": sum(a.size for a in found), "jid": jid, "floor": floor,
            # what the copy's header says, to know it again
            "wrote": [[mimecut._clean_name(a.name), a.size] for a in found]}


def _append(conn, folder: str, uv: int, flags: str, idate: str | None,
            data: bytes, msgid: str, floor: int, orig: int):
    """APPEND the copy to `folder` with `flags` and `idate`. Returns `(uid,
    UIDVALIDITY, sent)`: the new mail's UID only when it can be trusted - at
    least `floor` and not the original's (a server that merges the copy into
    the mail it already holds answers with that mail's UID, or with none) -
    else `(None, None, sent)`; `sent` says whether the server took it."""
    stamp = f'"{idate}"' if idate else None
    status, answer = conn.append(mailops.quote_folder(folder), flags or None,
                                 stamp, data)
    if status != "OK":
        return None, None, False
    text = b" ".join(x for x in answer or [] if isinstance(x, bytes))
    m = _APPENDUID_RE.search(text)
    if m:
        got_uv, uid = int(m.group(1)), int(m.group(2))
        if uid >= floor and uid != orig and (not uv or got_uv == uv):
            return uid, got_uv, True
        return None, None, True
    # no APPENDUID: the new mail is the one with our header above `floor`
    status, _ = conn.select(mailops.quote_folder(folder), readonly=True)
    if status != "OK":
        return None, None, True
    hits = [int(u) for u in mailops._search_message_id(conn, msgid)
            if int(u) >= floor and int(u) != orig]
    hits = sorted(set(hits) & _marked(conn, hits)) if hits else []
    if len(hits) != 1:
        return None, None, True
    return hits[0], mailops.uidvalidity(conn), True


def _marked(conn, uids) -> set[int]:
    """The UIDs among `uids` (selected folder) that carry an
    `X-Inboxrake-Removed` header."""
    return mailops._removed_marked(conn, [int(u) for u in uids])


def _verify(conn, folder: str, uv: int, uid: int, raw: bytes, root, found,
            files, flags: str, idate: str | None, msgid: str,
            lines: list[str]) -> bool:
    """Read the copy back from the server and compare it with what was meant:
    our header and the same Message-ID, the same flags and date, every kept
    part with the content it had, the removed ones gone."""
    status, _ = conn.select(mailops.quote_folder(folder), readonly=True)
    if status != "OK":
        return False
    if uv and mailops.uidvalidity(conn) != uv:
        return False
    got = _fetch_one(conn, uid)
    if got is None:
        return False
    copy = got["raw"]
    if _header_of(copy, "Message-ID")[:300] != msgid:
        return False
    cmsg = email.message_from_bytes(copy, policy=_policy.compat32)
    named = mimecut.removed_of(cmsg)
    if not all(any(n["name"] == mimecut._clean_name(a.name)
                   and n["size"] == a.size for n in named) for a in found):
        return False
    wanted = {f.lower() for f in re.findall(r"[^\s()]+", flags)}
    if not wanted <= {f.lower() for f in got["flags"]}:
        return False
    a, b = _idate_epoch(idate), _idate_epoch(got["idate"])
    if a is not None and (b is None or abs(a - b) > 1):
        return False
    try:
        root2 = mimecut.parse(copy)
    except mimecut.MimeError:
        return False
    old, new = mimecut.digest_map(raw, root), mimecut.digest_map(copy, root2)
    gone = {a.part.path for a in found}
    if set(old) != set(new):
        return False
    if any(old[p] != new[p] for p in old if p not in gone):
        return False
    # nothing named and sized like a removed file is left
    return not any(mimecut.find_exact(root2, a.name, a.size) for a in found)


def _discard(conn, folder: str, uv: int, uid: int, floor: int,
             orig: int) -> bool:
    """Take our own half-made copy out of `folder`. Only the UID the APPEND
    reported, and only when ALL of this holds: it is at least `floor` (the
    folder's UIDNEXT before the APPEND) and not the original's UID, the
    UIDVALIDITY is the one it was reported for, the mail carries our
    `X-Inboxrake-Removed` header, and the ORIGINAL is still in the folder (a
    copy whose original is gone is the mail itself). Deleted with a UID
    EXPUNGE (or a plain one when nothing else is flagged deleted). Returns
    whether it is gone. Never raises."""
    try:
        if uid < floor or uid == orig:
            return False
        status, _ = conn.select(mailops.quote_folder(folder), readonly=False)
        if status != "OK" or (uv and mailops.uidvalidity(conn) != uv):
            return False
        if orig not in mailops._fetch_msgid_map(conn, [orig]):
            return False            # the copy is the only mail now
        if uid not in mailops._fetch_msgid_map(conn, [uid]):
            return True             # gone already
        if uid not in mailops._removed_marked(conn, [uid]):
            return False            # not ours: never touched
        mailops._expunge_one(conn, uid)
        return True
    except Exception:
        log.warning("remove files: could not take a half-made copy out again",
                    exc_info=True)
        return False


def finish(acc, strips: dict, moved: dict[str, set[int]]) -> None:
    """After a removal job (cancelled, failed or done): every copy whose
    original did NOT go to Trash is taken out again, so no mail is left
    twice; the journal lines of the copies that are settled (the mail, or
    gone) are cleared. A copy that cannot be removed stays and the sweep gets
    it later. Never raises."""
    base, tenant = mailops.SNAPSHOT_DIR, acc.tenant
    settled = [s.get("jid") for (f, u), s in strips.items()
               if u in moved.get(f, ())]
    todo = [(f, u, s) for (f, u), s in strips.items()
            if u not in moved.get(f, ())]
    if todo:
        try:
            conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
        except Exception:
            log.warning("remove files: could not reach the server to take "
                        "%d unused copies out", len(todo))
            conn = None
        if conn is not None:
            try:
                for folder, uid, s in todo:
                    if _discard(conn, folder, s["uv"], s["uid"],
                                s.get("floor", 1 << 62), uid):
                        settled.append(s.get("jid"))
                    else:
                        log.warning("remove files: a copy stayed in a folder")
            finally:
                try:
                    conn.logout()
                except Exception:
                    pass
    removejournal.clear(acc.name, tenant, base, settled)


def _sweep_one(conn, e: dict) -> bool:
    """Settle one journal line of a run that did not finish: True when it is
    settled (clear it). A copy is deleted only if its original is still in
    the folder (the original may itself be a lighter copy of an earlier
    removal), the copy is at or above the recorded UIDNEXT, is not the
    original, carries our header - and, when the line knows the copy's UID,
    ONLY that exact UID."""
    folder, orig, msgid = e["folder"], e["orig"], e.get("msgid", "")
    status, _ = conn.select(mailops.quote_folder(folder), readonly=False)
    if status != "OK":
        return True             # the folder is gone: nothing to settle
    uv = e.get("uv")
    if uv and mailops.uidvalidity(conn) != uv:
        return True             # a new generation: the UIDs mean nothing
    if not msgid or mailops._fetch_msgid_map(conn, [orig]).get(orig) != msgid:
        return True             # the original moved on: the copy is the mail
    floor = e["floor"]
    if isinstance(e.get("uid"), int):
        # the copy was identified: that UID and no other
        uid = e["uid"]
        if uid < floor or uid == orig:
            return True
        hits = [uid] if mailops._fetch_msgid_map(
            conn, [uid]).get(uid) == msgid else []
    else:
        hits = [int(u) for u in mailops._search_message_id(conn, msgid)
                if int(u) >= floor and int(u) != orig]
    for uid in sorted(set(hits) & mailops._removed_marked(conn, hits)):
        mailops._expunge_one(conn, uid)
    return True


def _sweep_lines(acc, startup: bool) -> None:
    """The journal lines of the account, settled one by one (no lock here:
    see `sweep`)."""
    base, tenant = mailops.SNAPSHOT_DIR, acc.tenant
    lines = [e for e in removejournal.load(acc.name, tenant, base)
             if not startup or e.get("boot") != removejournal.BOOT]
    if not lines:
        return
    conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    try:
        for e in lines:
            try:
                if _sweep_one(conn, e):
                    removejournal.clear(acc.name, tenant, base, [e["id"]])
            except (imaplib.IMAP4.abort, OSError):
                break
            except Exception:
                log.warning("remove files: could not settle a copy left by "
                            "an earlier run", exc_info=True)
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def sweep(acc, startup: bool = False, in_job: bool = False) -> bool:
    """Take out the copies a crashed run left behind (see removejournal).
    Returns False when it could not run now (something else is changing the
    mailbox), True otherwise; never raises, a line that cannot be settled
    now stays.

    Nothing else may move mail meanwhile - and a removal may not make its
    copies meanwhile: a copy of a RETRY of the same mail would look like a
    leftover. So outside a removal it holds the folder lock of the account
    and of every account that is the same mailbox, exactly like a folder
    operation: a removal, move, Undo or scan then refuses to start, and the
    sweep itself waits for a running job. `in_job`: the removal that calls it
    already owns the mailbox. `startup`: after a restart, only the lines of an
    earlier boot."""
    try:
        if in_job:
            _sweep_lines(acc, startup)
        else:
            with yourfolders._operation(acc):
                _sweep_lines(acc, startup)
        return True
    except RuntimeError as exc:
        if mailops.is_coded(str(exc)):
            return False                    # busy: later
        log.warning("remove files: the sweep failed", exc_info=True)
        return True
    except Exception:
        log.warning("remove files: the sweep failed", exc_info=True)
        return True


def start_sweep() -> None:
    """At start-up: a thread that settles what a crashed run left - only
    when some account has a journal at all (a normal start starts nothing)."""
    from . import accounts as accountsmod
    from . import tenants
    found = False
    for tenant in tenants.known():
        with tenants.use(tenant):
            for name in accountsmod.names():
                acc = accountsmod.get(name)
                found = found or bool(removejournal.load(
                    acc.name, acc.tenant, mailops.SNAPSHOT_DIR))
    if found:
        import threading
        threading.Thread(target=sweep_startup, args=(20, 30.0),
                         daemon=True).start()


def sweep_startup(rounds: int = 1, pause: float = 0.0) -> None:
    """After a restart: settle what a crashed run left, for every account that
    has a journal. An account that is busy (a scan, a job) is tried again
    after `pause` seconds, `rounds` times in all; one still busy then is
    settled by its next removal."""
    from . import accounts as accountsmod
    from . import tenants
    for n in range(max(1, rounds)):
        busy = False
        for tenant in tenants.known():
            with tenants.use(tenant):
                for name in accountsmod.names():
                    acc = accountsmod.get(name)
                    if removejournal.load(acc.name, acc.tenant,
                                          mailops.SNAPSHOT_DIR):
                        busy = (not sweep(acc, startup=True)) or busy
        if not busy:
            return
        if n + 1 < rounds:
            time.sleep(pause)


def skipped_notice(left: list[tuple[str, int, str]]) -> dict:
    """The notice a job leaves when it left mails as they were: how many and
    the most common reason."""
    reasons: dict[str, int] = {}
    for _, _, why in left:
        reasons[why] = reasons.get(why, 0) + 1
    top = max(reasons, key=lambda k: (reasons[k], k))
    return {"key": "remove_files_skipped",
            "params": {"n": len(left), "why": top}}


# -------------------------------------------------------------------- undo

def trash_lighter_copies(conn, acc, copies: list[dict], trash: str) -> None:
    """The second half of an Undo of a removal: the originals are back in
    their folders (`restored`), so each lighter copy goes to Trash - found by
    its UID, checked to still be the mail it was (UIDVALIDITY, our header, the
    Message-ID) or, when it moved, searched by Message-ID + header. A copy is
    NEVER moved before its original is back, and one that cannot be found
    safely is left (both stay: nothing is lost). Raises on a server failure;
    what was done is marked `done`, so a retry does only the rest."""
    for c in copies:
        s = c.get("strip")
        if not s or s.get("done") or not c.get("restored"):
            continue
        folder = c["folder"]
        status, _ = conn.select(mailops.quote_folder(folder), readonly=False)
        if status != "OK":
            raise RuntimeError(mailops.coded(mailops.CANNOT_OPEN,
                                             folder=mailops.decode_mutf7(
                                                 folder)))
        uid = _find_copy(conn, c, s)
        if uid is not None:
            if not mailops._uid_move(conn, str(uid), trash, folder):
                raise RuntimeError(mailops.CANNOT_MOVE)
        s["done"] = True


def _removed_lines(conn, uids) -> dict[int, list[dict]]:
    """`{uid: [{name, size, date}]}` of the `X-Inboxrake-Removed` lines of
    these mails (selected folder)."""
    out: dict[int, list[dict]] = {}
    ids = [int(u) for u in uids]
    for start in range(0, len(ids), mailops.FETCH_CHUNK):
        part = ids[start:start + mailops.FETCH_CHUNK]
        status, data = conn.uid(
            "FETCH", ",".join(str(u) for u in part),
            "(UID BODY.PEEK[HEADER.FIELDS (X-INBOXRAKE-REMOVED)])")
        if status != "OK":
            raise imaplib.IMAP4.error("FETCH failed")
        for item in data or []:
            if isinstance(item, tuple) and len(item) >= 2:
                um = _UID_RE.search(item[0])
                if um:
                    out[int(um.group(1))] = mimecut.removed_of(
                        email.message_from_bytes(item[1]))
    return out


def _fresh_uids(conn, c: dict) -> set[int]:
    """The UIDs that came into the (selected) folder with the restore that is
    undoing the step - the mails it brought back - as far as it noted what the
    folder held before."""
    attempt = c.get("attempt")
    if not attempt or attempt.get("uv") != mailops.uidvalidity(conn):
        return set()
    return set(mailops._list_uids(conn)) - set(attempt.get("before") or ())


def _find_copy(conn, c: dict, s: dict) -> int | None:
    """The UID of the lighter copy in the selected folder, or None. First by
    its UID (same UIDVALIDITY, our header, the Message-ID); else by
    Message-ID, accepting a mail only if its `X-Inboxrake-Removed` lines
    include EVERY file this step removed - so never the original that was
    just brought back, which on a second removal is itself a copy of the
    first - and it is not one of the UIDs the restore just brought in."""
    msgid = c.get("msgid", "")
    if s.get("uid") and mailops.uidvalidity(conn) == s.get("uv"):
        if s["uid"] in mailops._removed_marked(conn, [s["uid"]]) \
                and mailops._fetch_msgid_map(
                    conn, [s["uid"]]).get(s["uid"]) == msgid:
            return s["uid"]
    wrote = s.get("wrote")
    if not msgid or not wrote:
        return None
    fresh = _fresh_uids(conn, c)
    hits = [int(u) for u in mailops._search_message_id(conn, msgid)
            if int(u) not in fresh]
    lines = _removed_lines(conn, hits) if hits else {}
    good = [u for u, got in lines.items()
            if all(any(g["name"] == w[0] and g["size"] == w[1] for g in got)
                   for w in wrote)]
    return good[0] if len(good) == 1 else None


# --------------------------------------------------------------------- zip

def build_zip(acc, items, files):
    """The files of `items` as one .zip, read from the originals and built
    here (nothing leaves this server but the download): `(spooled file,
    byte size)` or `{"refused": code}`. Names are made safe (no path, no
    reserved characters), the same file seen twice is stored once, and the
    archive is capped. The mails are only read."""
    files = _clean_files(files)
    if not files:
        return {"refused": mailops.coded(mailops.RM_NOTHING)}
    with acc.lock:
        if acc.state["status"] != "done":
            return {"refused": mailops.coded(mailops.RM_NOT_SCANNED)}
    blocked, rest = _guards(acc, _rows(acc, items, files))
    rows = [r for r in [*rest, *blocked] if not _static_skip(r["m"])]
    # a download is only a read: pinned and protected mails may be saved
    if not rows:
        return {"refused": mailops.coded(mailops.RM_NOTHING)}
    distinct = {files[i] for r in rows for i in r["files"]}
    if sum(s for _, s in distinct) > ZIP_CAP or sum(
            files[i][1] for r in rows for i in r["files"]) > ZIP_READ_CAP:
        return {"refused": mailops.coded(mailops.RM_ZIP_TOO_BIG,
                                         mb=ZIP_CAP // 1048576)}
    out = tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    try:
        conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
        try:
            with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
                _fill_zip(conn, acc, rows, files, zf)
        finally:
            try:
                conn.logout()
            except Exception:
                pass
    except Exception as exc:
        out.close()
        log.warning("could not build the download: %s", type(exc).__name__)
        return {"refused": _failure(exc, acc)}
    size = out.tell()
    out.seek(0)
    return out, size


def _fill_zip(conn, acc, rows: list[dict], files, zf) -> None:
    import hashlib
    names: set[str] = set()
    seen: set[tuple[str, str]] = set()      # (file name, content digest)
    total = 0
    for r in rows:
        m = r["m"]
        status, _ = conn.select(mailops.quote_folder(m["folder"]),
                                readonly=True)
        if status != "OK":
            continue
        got = _fetch_one(conn, m["uid"])
        if got is None or len(got["raw"]) > MAIL_CAP:
            continue
        raw = got["raw"]
        try:
            root = mimecut.parse(raw)
        except mimecut.MimeError:
            continue
        found, _ = _pick_for(root, m, files, r["files"])
        for a in found:
            data = mimecut.payload(raw, a.part)
            key = (a.name.casefold(), hashlib.sha256(data).hexdigest())
            if key in seen:
                continue
            seen.add(key)
            total += len(data)
            if total > ZIP_CAP:
                raise RuntimeError(mailops.coded(mailops.RM_ZIP_TOO_BIG,
                                                 mb=ZIP_CAP // 1048576))
            stamp = time.localtime(m["ts"] or time.time())[:6]
            info = zipfile.ZipInfo(
                mimecut.safe_file_name(a.name, names, "file"),
                date_time=stamp if stamp[0] >= 1980 else (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            zf.writestr(info, data)
