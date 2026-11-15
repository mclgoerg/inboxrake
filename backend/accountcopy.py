"""Copy what matters from one account to another (a provider switch, or
merging two mailboxes).

Both accounts belong to the SAME tenant. The mails travel server -> server
through this process (nothing leaves the user's own servers): IMAP `APPEND`
into a new folder of the target, keeping INTERNALDATE and the `\\Seen`,
`\\Flagged` and `\\Answered` flags (never `\\Deleted`). The source is only
ever READ: its folders are opened read-only (EXAMINE) and fetched with
`BODY.PEEK[]` (which never sets `\\Seen`); nothing is stored, moved or
expunged there. A mail whose Message-ID is already in the target (its scan
index, or the new folder) is skipped, and every chunk is verified by
Message-ID in the target afterwards.

The job is a background thread like a scan. Its progress and a LEDGER (one
line per finished mail, append-only) live next to the other per-tenant files,
so a restart - or Pause / Resume - continues without copying a mail twice.
Rolling back to an older image just leaves both files unread.

"Tell them" is the list of senders that wrote to the source address in the
last 90 days (newsletters excluded: those are unsubscribed instead), with
the user's ticks.
"""

from __future__ import annotations

import base64
import email
import email.parser
import hashlib
import imaplib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import demo
from . import mailops
from . import pinstore
from . import smartkinds
from . import tenants

log = logging.getLogger("inboxrake.accountcopy")

ACCOUNT_COPY_PATH = Path(os.environ.get("ACCOUNT_COPY_PATH",
                                        "/data/account_copy.json"))
LEDGER_PATH = Path(os.environ.get("ACCOUNT_COPY_LEDGER_PATH",
                                  "/data/account_copy_ledger.jsonl"))

# The kinds of the "What to bring" list, in the order the board shows them.
# A mail can be in several (a pinned mail from a shop is "Pinned" and
# "Orders"); `mask` is the set of bits. Ticked by default: all but the last
# two.
KINDS = ("replied", "orders", "accounts", "appointments", "protected",
         "pinned", "newsletter", "other")
BIT = {k: 1 << i for i, k in enumerate(KINDS)}
DEFAULT_KINDS = KINDS[:6]

CHUNK_MAILS = 25                   # mails fetched + appended per round
CHUNK_BYTES = 15 * 1024 * 1024     # ... or as many bytes as this
MAX_MAIL_BYTES = 50 * 1024 * 1024  # a bigger mail is skipped and reported
# Throttle: after each chunk the worker rests this fraction of the time the
# chunk took (at most THROTTLE_MAX_S), so a big copy cannot starve a scan
# or the user's own mail program on a small server.
THROTTLE_RATIO = 0.5
THROTTLE_MAX_S = 2.0
FAIL_STREAK = 5                    # appends refused in a row end the job
TELL_DAYS = 90
TELL_SHOWN = 300                   # senders listed (the count is the total)
FOLDER_MAX = 100

# Counted the same way a scan's index counts: sizes in bytes.
_FLAGS_KEEP = (("\\Seen", b"\\seen"), ("\\Flagged", b"\\flagged"),
               ("\\Answered", b"\\answered"))
# The source server's INTERNALDATE goes into the target's APPEND command, so
# only the exact RFC 3501 shape is passed on (anything else: the scan's time).
_INTERNALDATE_RE = re.compile(
    rb'INTERNALDATE "(\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2} [+-]\d{4})"')

_LOCK = threading.RLock()
_THREADS: dict[str, threading.Thread] = {}   # tenant id -> the running job
_STOP: dict[str, str] = {}                   # tenant id -> "pause" | "cancel"

LIVE = ("running", "paused")                 # a job in these blocks a new one


# ------------------------------------------------------------- storage

def _path() -> Path:
    return tenants.current().file("account_copy.json", ACCOUNT_COPY_PATH)


def _ledger_path() -> Path:
    return tenants.current().file("account_copy_ledger.jsonl", LEDGER_PATH)


def _read() -> dict:
    """{"job": {...}|None, "tell": {source: {target: [addr, ...]}}}. A
    damaged file only forgets what it cannot understand."""
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    job = data.get("job")
    tell = data.get("tell")
    return {"job": job if isinstance(job, dict) else None,
            "tell": tell if isinstance(tell, dict) else {}}


def _write(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def _ledger_reset(job_id: str) -> None:
    path = _ledger_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"job": job_id}) + "\n")
    path.chmod(0o600)


# What a ledger line says about one mail (the last line of a key wins):
#   pending    a mail without a Message-ID is about to be appended
#   appended   the target acknowledged the APPEND
#   ok / unchecked / unsure / dup / big / gone   final (see `_Run.copy_chunk`)
FINAL = ("ok", "unchecked", "unsure", "dup", "big", "gone")


def _ledger_read(job_id: str) -> dict[str, str]:
    """{key: last status} of the job's mails ({} for a ledger that
    belongs to another job - the Message-ID check of the target still keeps
    a mail from being copied twice)."""
    out: dict[str, str] = {}
    try:
        lines = _ledger_path().read_text().splitlines()
    except OSError:
        return out
    try:
        if json.loads(lines[0]).get("job") != job_id:
            return out
    except (IndexError, ValueError, AttributeError):
        return out
    for line in lines[1:]:
        try:
            key, status = json.loads(line)
        except (ValueError, TypeError):
            continue          # a line cut off by a crash: that mail is redone
        if isinstance(key, str) and isinstance(status, str):
            out[key] = status
    return out


def _ledger_append(rows: list[tuple[str, str]], sync: bool = True) -> None:
    """Append lines. `sync`: also to disk (one mail's line is only flushed to
    the OS - a crashed process loses nothing - and the chunk's final lines
    are synced)."""
    if not rows:
        return
    with _ledger_path().open("a") as f:
        f.write("".join(json.dumps(list(r)) + "\n" for r in rows))
        f.flush()
        if sync:
            try:
                os.fsync(f.fileno())
            except OSError:
                pass        # a file system without fsync: the flush is all



# --------------------------------------------------------- the accounts

_GMAIL_HOSTS = ("gmail.com", "googlemail.com")


def _identity(name: str) -> tuple[str, str]:
    """Which mailbox an account points at: (IMAP host, login), compared
    case-insensitively; a gmail.com / googlemail.com login ignores dots and
    +tags (and the two domains are one)."""
    try:
        im = cfgmod.account_imap(name)
    except ValueError:
        return ("", name)
    host = str(im.get("host") or "").strip().lower()
    user = str(im.get("user") or "").strip().lower()
    local, _, domain = user.rpartition("@")
    if domain in _GMAIL_HOSTS:           # only the consumer logins: a Workspace
        user = local.split("+")[0].replace(".", "") + "@gmail.com"  # domain
    # on imap.gmail.com keeps its dots and tags
    return (host, user)


def _resolve(source: str, target: str):
    """(source AccountState, target AccountState) - two different accounts
    of the CURRENT tenant that point at two different mailboxes, else a
    coded refusal."""
    known = accounts.names()
    if source not in known or target not in known:
        raise ValueError(mailops.COPY_UNKNOWN_ACCOUNT)
    if source == target:
        raise ValueError(mailops.COPY_SAME_ACCOUNT)
    a, b = _identity(source), _identity(target)
    if a[0] and a == b:
        raise ValueError(mailops.COPY_SAME_MAILBOX)
    src, tgt = accounts.get(source), accounts.get(target)
    tid = tenants.current().id
    if src.tenant.id != tid or tgt.tenant.id != tid:
        raise ValueError(mailops.COPY_UNKNOWN_ACCOUNT)
    return src, tgt


def _address(name: str) -> str:
    try:
        return str(cfgmod.account_imap(name).get("user") or "")
    except ValueError:
        return ""


def default_folder(source: str) -> str:
    return f"From {source}"


def clean_folder(name: str) -> str:
    """The new folder's name as typed, made safe: no control characters,
    quotes, backslash or slash, single spaces, <= FOLDER_MAX characters;
    never empty."""
    name = "".join(c for c in str(name or "")
                   if c.isprintable() and c not in '"\\/')
    name = re.sub(r"\s+", " ", name).strip()[:FOLDER_MAX].strip()
    if not name:
        raise ValueError(mailops.COPY_FOLDER_NAME)
    return name


def encode_mutf7(name: str) -> str:
    """IMAP modified UTF-7 (RFC 3501 5.1.3) - the inverse of
    `mailops.decode_mutf7`."""
    out: list[str] = []
    run: list[str] = []

    def flush() -> None:
        if run:
            b64 = base64.b64encode("".join(run).encode("utf-16-be")).decode()
            out.append("&" + b64.rstrip("=").replace("/", ",") + "-")
            run.clear()

    for ch in name:
        if 0x20 <= ord(ch) <= 0x7e:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            run.append(ch)
    flush()
    return "".join(out)


# ------------------------------------------------------ classification

def classify(acc) -> list[dict]:
    """Every indexed mail of `acc` with the kinds it belongs to (`mask`).

    Overlays: `pinned` (the mail's Message-ID is pinned), `protected` (its
    sender is), `replied` (the user writes to the sender). The kind of the
    content: orders / accounts / appointments - from the Smart row the sender
    sits in, else from the mail's own subject - or `newsletter`. A mail with
    none of those is `other`."""
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    pinned = pinstore.load_account(acc.name)
    out: list[dict] = []
    with acc.lock:
        senders = acc.state["groups"].get("sender") or {}
        for m in acc.index.values():
            addr = m.get("addr") or ""
            rec = senders.get(addr) or {}
            mask = 0
            if m.get("msgid") and m["msgid"] in pinned:
                mask |= BIT["pinned"]
            if cfgmod.is_protected(addr, plist):
                mask |= BIT["protected"]
            if rec.get("replied"):
                mask |= BIT["replied"]
            row = str(rec.get("smart_key") or "")
            pooled = row[2:] if row.startswith("k:") else ""
            if pooled in ("orders", "accounts", "appointments", "newsletter"):
                mask |= BIT[pooled]
            elif pooled not in ("individuals", "other", "jobs", "support") \
                    and not pooled.startswith("cat:"):
                # an own / company row, or the replied / protected pool:
                # read the mail itself
                kind = smartkinds.message_kind(
                    m.get("subject") or "",
                    smartkinds.sender_hint(addr, bool(m.get("unsub"))))
                if kind in ("orders", "accounts", "appointments",
                            "newsletter"):
                    mask |= BIT[kind]
            out.append({
                "folder": m["folder"], "uid": int(m["uid"]),
                "msgid": m.get("msgid") or "", "size": int(m.get("size") or 0),
                "ts": int(m.get("ts") or 0), "addr": addr,
                "name": m.get("name") or "",
                "subject": m.get("subject") or "",
                "bulk": bool(m.get("unsub")),
                "mask": mask or BIT["other"]})
    return out


def _mask(kinds) -> int:
    mask = 0
    for k in kinds:
        mask |= BIT[k]
    return mask


def _valid_kinds(kinds) -> list[str]:
    picked = [k for k in KINDS if isinstance(kinds, (list, tuple))
              and k in kinds]
    if not picked:
        raise ValueError(mailops.COPY_NOTHING)
    return picked


def plan(source: str, target: str) -> dict:
    """The "What to bring" page: per kind the mails and bytes, and the
    de-duplicated figures for any ticked set (`combos`: how many mails and
    bytes carry each distinct set of kinds - a mail in two kinds is one
    combo, so the page sums the combos that touch the ticked kinds and
    counts it once)."""
    src, tgt = _resolve(source, target)
    items = classify(src)
    kinds = []
    for k in KINDS:
        hit = [i for i in items if i["mask"] & BIT[k]]
        kinds.append({"id": k, "mails": len(hit),
                      "size": sum(i["size"] for i in hit),
                      "default": k in DEFAULT_KINDS})
    combos: dict[int, list[int]] = {}
    for i in items:
        c = combos.setdefault(i["mask"], [0, 0])
        c[0] += 1
        c[1] += i["size"]
    with src.lock:
        scanning = src.state["status"] == "scanning"
        scanned = bool(src.index) or src.state.get("scanned_ts") is not None
    return {
        "source": {"name": source, "address": _address(source),
                   "mails": len(items),
                   "size": sum(i["size"] for i in items)},
        "target": {"name": target, "address": _address(target)},
        "folder": default_folder(source),
        "kinds": kinds,
        "bits": BIT,
        "combos": [{"mask": m, "mails": c[0], "size": c[1]}
                   for m, c in sorted(combos.items())],
        "scanned": scanned and bool(items), "scanning": scanning,
    }


def _connect(acc):
    """A connection to `acc`; a failure names that account's host."""
    try:
        return mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    except Exception as exc:
        raise RuntimeError(mailops.error_text(
            exc, _host(acc.name), mailops.INTERNAL_ERROR)) from exc


def _host(name: str) -> str:
    try:
        return str(cfgmod.account_imap(name).get("host") or "")
    except ValueError:
        return ""


def _layout(conn, names) -> tuple[str, str]:
    """(prefix, delimiter) where this user's own folders live: the personal
    namespace the server announces (NAMESPACE), else - when every folder
    sits below `INBOX<delimiter>` - that prefix, else none. Some servers
    refuse a folder anywhere else."""
    delim = names.delims.get("INBOX") or next(iter(names.delims.values()), "")
    caps = {str(c if isinstance(c, str) else c.decode()).upper()
            for c in (getattr(conn, "capabilities", ()) or ())}
    if "NAMESPACE" in caps and hasattr(conn, "namespace"):
        try:
            typ, data = conn.namespace()
            m = re.search(rb'\(\(\s*"([^"]*)"\s+(?:"([^"]*)"|NIL)',
                          data[0] if data and data[0] else b"")
            if typ == "OK" and m:
                return (m.group(1).decode("utf-8", "replace"),
                        m.group(2).decode("utf-8", "replace") if m.group(2)
                        else delim)
        except Exception:
            pass                              # fall through to the folders
    own = [n for n, _ in names if n.upper() != "INBOX"
           and not n.startswith("[")]
    if delim and own and all(n.startswith("INBOX" + delim) for n in own):
        return "INBOX" + delim, delim
    return "", delim


def _reserved(conn, acc, enc: str, names, delim: str) -> bool:
    """Whether the folder `enc` is one the server uses for something else:
    INBOX, or any role folder (Trash, Junk, Sent, Drafts, Archive, All Mail
    - by SPECIAL-USE flag or by a name in any language, as the rest of the app
    detects them, look-alikes included)."""
    if enc.upper() == "INBOX":
        return True
    found = mailops.resolve_roles(conn, acc, names)
    held = set(found["roles"].values()) | set(found["looks_like"]) | {
        n for c in found["candidates"].values() for n in c}
    if enc in held:
        return True
    full, short = mailops._name_keys(enc, delim or None)
    return any(full in v or (short is not None and short in v)
               for v in mailops._ROLE_NAMES.values())


def _status(conn, folder: str) -> dict[str, int]:
    st, data = conn.status(mailops.quote_folder(folder),
                           "(MESSAGES UIDNEXT UIDVALIDITY)")
    text = data[0].decode("utf-8", "replace") \
        if st == "OK" and data and data[0] else ""
    return {k: int(v) for k, v in re.findall(
        r"(MESSAGES|UIDNEXT|UIDVALIDITY) (\d+)", text)}


def _ids_at(conn, uids: list[int]) -> set[str]:
    """Message-IDs of these UIDs of INBOX (read only)."""
    ids: set[str] = set()
    st, _ = conn.select(mailops.quote_folder("INBOX"), readonly=True)
    if st != "OK":
        return ids
    for u in uids:
        st, got = conn.uid("FETCH", str(u),
                           "(UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
        for item in (got or []) if st == "OK" else []:
            if isinstance(item, tuple) and len(item) >= 2:
                mid = mailops.header_text(email.message_from_bytes(
                    item[1]).get("Message-ID")).strip()[:300]
                if mid:
                    ids.add(mid)
    return ids


def _newest_below(conn, top: int) -> list[int]:
    """The five highest UIDs of INBOX below `top`. The newest UIDs may all be
    gone (a cleaned-up inbox): the window grows tenfold, up to the whole
    range, until it holds some."""
    st, _ = conn.select(mailops.quote_folder("INBOX"), readonly=True)
    if st != "OK" or top <= 1:
        return []
    width = 40
    while True:
        low = max(1, top - width)
        st, data = conn.uid("SEARCH", None, "UID", f"{low}:{top - 1}")
        found = sorted(int(u) for u in (data[0].split() if st == "OK"
                                        and data and data[0] else [])
                       if int(u) < top)
        if len(found) >= 5 or low == 1:
            return found[-5:]
        width *= 10


def _signature(conn) -> dict[str, tuple[int, int]]:
    """{folder: (UIDVALIDITY, mails)} of every folder (at most 60)."""
    out: dict[str, tuple[int, int]] = {}
    for name in mailops.selectable_folders(conn)[:60]:
        got = _status(conn, name)
        out[name] = (got.get("UIDVALIDITY", 0), got.get("MESSAGES", 0))
    return out


def same_server_mailbox(a, b) -> bool | None:
    """Whether two open connections reach the SAME mailbox (an alias, a second
    host name, a second login) - read only, before anything is created or
    written. True / False, or None when the servers could not answer.

    INBOX with the same UIDVALIDITY whose messages at the SAME fixed UIDs
    - the five highest below the smaller UIDNEXT - carry the same
    Message-IDs (UIDs never change, so a mail that arrives between the two
    looks cannot make one mailbox look like two); with an empty INBOX on both
    sides, every folder's UIDVALIDITY and mail count the same (and some mail
    in them). With fewer than three mails to compare the two mailboxes must
    also agree on UIDNEXT and mail count (one forwarded copy proves nothing)."""
    try:
        x, y = _status(a, "INBOX"), _status(b, "INBOX")
        if x and y:
            if x.get("UIDVALIDITY") != y.get("UIDVALIDITY"):
                return False
            top = min(x.get("UIDNEXT", 1), y.get("UIDNEXT", 1))
            uids = _newest_below(a, top)
            if 0 < len(uids) < 3 and (x.get("UIDNEXT"), x.get("MESSAGES")) \
                    != (y.get("UIDNEXT"), y.get("MESSAGES")):
                return False             # too few mails to tell by IDs alone
            if uids:
                ids = _ids_at(a, uids)
                return bool(ids) and ids == _ids_at(b, uids)
            # no UID to compare: the folders' counts decide (below)
        sig = _signature(a)
        return any(n for _, n in sig.values()) and sig == _signature(b)
    except (imaplib.IMAP4.error, OSError, ValueError):
        return None


def judge_distinct(src_name: str, tgt_name: str, a, b) -> None:
    """Refuse (copy_same_mailbox) when the two connections reach one mailbox;
    when the check itself could not be answered, fail closed if the config
    says the accounts are close (same host), else go on and log it."""
    same = same_server_mailbox(a, b)
    if same:
        raise ValueError(mailops.COPY_SAME_MAILBOX)
    if same is None:
        if _identity(src_name)[0] == _identity(tgt_name)[0]:
            raise ValueError(mailops.COPY_CANNOT_CONFIRM)
        log.warning("could not confirm that %r and %r are different "
                    "mailboxes (different hosts: going on)", src_name,
                    tgt_name)


def ensure_distinct(src, tgt) -> None:
    """The identity check on fresh connections (see `judge_distinct`)."""
    a = _connect(src)
    try:
        b = _connect(tgt)
        try:
            judge_distinct(src.name, tgt.name, a, b)
        finally:
            try:
                b.logout()
            except Exception:
                pass
    finally:
        try:
            a.logout()
        except Exception:
            pass


def folder_check(tgt, name: str) -> dict:
    """What the new folder would be on the target's server: its real name
    (separator replaced, below the personal namespace), whether it already
    exists (the mails are then added to it) and whether it is a folder the
    server uses for something else (refused). Reads only."""
    conn = _connect(tgt)
    try:
        try:
            names = mailops.list_folders_ex(conn)
            prefix, delim = _layout(conn, names)
            shown = name.replace(delim, "-") if delim else name
            enc = prefix + encode_mutf7(shown)
            return {"enc": enc, "shown": shown, "exists": enc in
                    {n for n, _ in names},
                    "reserved": _reserved(conn, tgt, enc, names, delim),
                    "free": _quota_free(conn)}
        except (imaplib.IMAP4.error, OSError) as exc:
            raise RuntimeError(mailops.error_text(
                exc, _host(tgt.name), mailops.INTERNAL_ERROR)) from exc
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def target_info(target: str, folder: str = "") -> dict:
    """The target's free space (None without QUOTA: the page leaves the line
    out, no guessing) and, for a folder name, whether it exists or is
    reserved."""
    if target not in accounts.names():
        raise ValueError(mailops.COPY_UNKNOWN_ACCOUNT)
    tgt = accounts.get(target)
    try:
        name = clean_folder(folder) if folder.strip() else ""
    except ValueError:
        name = ""
    try:
        info = folder_check(tgt, name or "x")
    except RuntimeError:
        return {"free": None, "exists": False, "reserved": False}
    return {"free": info["free"],
            "exists": bool(name) and info["exists"],
            "reserved": bool(name) and info["reserved"]}


def _quota_free(conn) -> int | None:
    caps = {str(c if isinstance(c, str) else c.decode()).upper()
            for c in (getattr(conn, "capabilities", ()) or ())}
    if "QUOTA" not in caps:
        return None
    typ, data = conn.getquotaroot("INBOX")
    if typ != "OK":
        return None
    for part in data or []:
        for line in part if isinstance(part, list) else [part]:
            if not line:
                continue
            text = line.decode("utf-8", "replace") \
                if isinstance(line, bytes) else str(line)
            m = re.search(r"STORAGE (\d+) (\d+)", text)
            if m:                                   # in units of 1024 bytes
                return max(0, (int(m.group(2)) - int(m.group(1))) * 1024)
    return None


# ------------------------------------------------------------ the job

def _public(job: dict | None) -> dict | None:
    if not job:
        return None
    out = {k: job.get(k) for k in (
        "id", "source", "target", "folder", "kinds", "status", "total",
        "bytes_total", "copied", "skipped", "checked", "unchecked",
        "too_large", "missing", "failed", "bytes_done", "started",
        "finished", "error", "active_s")}
    out["unsure"] = job.get("unsure", 0)
    out["processed"] = (job["copied"] + job["skipped"] + job["too_large"]
                        + job["missing"] + out["unsure"])
    rate = job["bytes_done"] / job["active_s"] if job["active_s"] >= 2 else 0
    out["eta_s"] = int(max(0, job["bytes_total"] - job["bytes_done"]) / rate) \
        if rate > 0 and job["status"] == "running" else None
    return out


def status() -> dict:
    """The tenant's copy job (None before the first), for the page."""
    with _LOCK:
        job = _read()["job"]
        # A job the file calls running but no thread holds (a restart that
        # has not resumed it yet) is still "running" for the page.
        return {"job": _public(job)}


def start(source: str, target: str, kinds, folder: str = "") -> dict:
    """Begin copying the chosen kinds. Refused: unknown / equal accounts, a
    copy already running or paused, nothing chosen, a source that was never
    scanned (or is being scanned)."""
    src, tgt = _resolve(source, target)
    picked = _valid_kinds(kinds)
    name = clean_folder(str(folder or "").strip() or default_folder(source))
    with src.lock:
        if src.state["status"] == "scanning":
            raise RuntimeError(mailops.BUSY_SCAN)
    items = [i for i in classify(src) if i["mask"] & _mask(picked)]
    if not items:
        raise ValueError(mailops.COPY_NOT_SCANNED if not src.index
                         else mailops.COPY_NOTHING)
    # the folder as the target's server will have it (and never one it uses
    # for something else); read before anything is written
    ensure_distinct(src, tgt)
    where = folder_check(tgt, name)
    if where["reserved"]:
        raise ValueError(mailops.coded(mailops.COPY_FOLDER_RESERVED,
                                       folder=where["shown"]))
    tenant = tenants.current()
    with _LOCK:
        data = _read()
        old = data["job"]
        if old and old["status"] in LIVE or tenant.id in _THREADS:
            raise RuntimeError(mailops.COPY_BUSY)   # (a finishing thread too)
        job = {"id": f"{time.time_ns():x}", "source": source,
               "target": target, "folder": where["shown"],
               "folder_enc": where["enc"],
               "kinds": picked, "status": "running",
               "total": len(items), "bytes_total": sum(i["size"]
                                                       for i in items),
               "copied": 0, "skipped": 0, "checked": 0, "unchecked": 0,
               "too_large": 0, "missing": 0, "failed": 0, "unsure": 0,
               "bytes_done": 0, "started": int(time.time()), "finished": 0, "error": "",
               "active_s": 0.0}
        _ledger_reset(job["id"])
        _write({**data, "job": job})
        _spawn(tenant)
    return {"job": _public(job)}


def _spawn(tenant) -> None:
    """Start the copy thread - at most one per tenant. Called with `_LOCK`
    held, so two Resumes (or a Resume and the start-up) cannot both start
    one; the thread stays registered until it has finished."""
    with _LOCK:
        if tenant.id in _THREADS:
            return
        mine: list[threading.Thread] = []
        thread = threading.Thread(target=tenants.call_in,
                                  args=(tenant, _run, mine), daemon=True)
        mine.append(thread)
        _STOP.pop(tenant.id, None)
        _THREADS[tenant.id] = thread
        try:
            thread.start()
        except Exception:
            _THREADS.pop(tenant.id, None)
            raise


def _alive() -> bool:
    """A copy thread is registered (started, or about to start)."""
    return tenants.current().id in _THREADS


def pause() -> dict:
    tid = tenants.current().id
    with _LOCK:
        data = _read()
        job = data["job"]
        if not job or job["status"] != "running":
            raise ValueError(mailops.COPY_NO_JOB)
        if _alive():
            _STOP[tid] = "pause"          # the worker ends after its chunk
        else:
            job["status"] = "paused"
            _write(data)
        return {"job": _public(job)}


def resume() -> dict:
    tid = tenants.current().id
    with _LOCK:
        data = _read()
        job = data["job"]
        if not job or job["status"] not in ("paused", "error", "running"):
            raise ValueError(mailops.COPY_NO_JOB)
        if job["status"] == "error" and str(job.get("error") or "").startswith(
                mailops.COPY_SAME_MAILBOX):
            raise ValueError(mailops.COPY_SAME_MAILBOX)   # nothing to resume
        if _alive():
            if _STOP.get(tid) == "pause":
                _STOP.pop(tid, None)      # pressed Resume before it paused
            return {"job": _public(job)}
        job.update(status="running", error="", finished=0)
        _write(data)
        _spawn(tenants.current())
    return {"job": _public(job)}


def cancel() -> dict:
    tid = tenants.current().id
    with _LOCK:
        data = _read()
        job = data["job"]
        if not job or job["status"] not in LIVE + ("error",):
            raise ValueError(mailops.COPY_NO_JOB)
        if _alive():
            _STOP[tid] = "cancel"
            return {"job": _public(job)}
        job.update(status="cancelled", finished=int(time.time()))
        _write(data)
    _audit(job)
    return {"job": _public(job)}


def dismiss() -> dict:
    """Forget a finished / cancelled / failed job (the Done card)."""
    with _LOCK:
        data = _read()
        job = data["job"]
        if job and job["status"] in LIVE:
            raise RuntimeError(mailops.COPY_BUSY)
        _write({**data, "job": None})
    return {"job": None}


def resume_all() -> None:
    """At start-up: every tenant's copy that was running when the process
    stopped carries on (a paused one stays paused). Not in the demo."""
    if demo.enabled():
        return
    for tenant in tenants.known():
        with tenants.use(tenant):
            try:
                job = _read()["job"]
            except Exception:
                continue
            if job and job.get("status") == "running":
                log.info("resuming the copy %s -> %s", job.get("source"),
                         job.get("target"))
                _spawn(tenant)


def rename_account(old: str, new: str) -> None:
    with _LOCK:
        data = _read()
        job = data["job"]
        if job:
            for k in ("source", "target"):
                if job.get(k) == old:
                    job[k] = new
        tell = data["tell"]
        moved: dict = {}
        for src, per in tell.items():
            if not isinstance(per, dict):
                continue
            moved[new if src == old else src] = {
                (new if tgt == old else tgt): v for tgt, v in per.items()}
        _write({"job": job, "tell": moved})


def drop_account(name: str) -> None:
    tid = tenants.current().id
    with _LOCK:
        data = _read()
        job = data["job"]
        if job and name in (job.get("source"), job.get("target")):
            if _alive():
                _STOP[tid] = "cancel"
            job = None
        tell = {s: {t: v for t, v in per.items() if t != name}
                for s, per in data["tell"].items()
                if s != name and isinstance(per, dict)}
        _write({"job": job, "tell": {s: per for s, per in tell.items()
                                     if per}})


# ----------------------------------------------------------- the worker

def _idate_epoch(text: str | None) -> int | None:
    """An INTERNALDATE string as epoch seconds (None if it is none)."""
    if not text:
        return None
    try:
        tt = imaplib.Internaldate2tuple(f'INTERNALDATE "{text}"'.encode())
        return int(time.mktime(tt)) if tt else None
    except (ValueError, OverflowError):
        return None


def _weak(epoch, size, subject: str) -> str:
    """A fingerprint to find a mail WITHOUT a Message-ID in the target:
    its date (to the second), size and subject."""
    return "%s:%s:%s" % (
        epoch, size, hashlib.sha1(
            (subject or "").strip().encode("utf-8", "replace")).hexdigest()[:12])


def _raw_subject(raw: bytes) -> str:
    msg = email.parser.BytesHeaderParser().parsebytes(raw[:262144])
    return mailops.decode_mime(msg.get("Subject", ""))[:150]


class _Run:
    """One run of the copy thread: both connections, what the target already
    holds, and what the ledger says about each mail."""

    def __init__(self, job: dict, src, tgt):
        self.job, self.src, self.tgt = job, src, tgt
        self.s = self.t = None
        self.side = "source"                 # which server the last call hit
        self.sel: str | None = None          # the folder open in the source
        self.dest = ""                       # the new folder, encoded
        self.top = 0                         # highest UID in the new folder
        self.skip_ids: set[str] = set()      # Message-IDs the target has
        self.skip_weak: set[str] = set()     # fingerprints of its id-less mails
        # keys this job already appended (or was about to): a mail of them
        # that the target now holds is OUR copy, not "already there"
        self.attempted: set[str] = set()
        self.prior: dict[str, str] = {}      # ledger: key -> pending|appended
        self.streak = 0

    @property
    def host(self) -> str:
        """The host of the side that was being talked to (for an error)."""
        return _host((self.src if self.side == "source" else self.tgt).name)

    # -- connections ---------------------------------------------------
    def connect(self) -> None:
        self.close()
        self.side = "source"
        self.s = mailops.connect(cfgmod.account_imap(self.src.name),
                                 self.src.name)
        self.side = "target"
        self.t = mailops.connect(cfgmod.account_imap(self.tgt.name),
                                 self.tgt.name)
        self.sel = None
        # before any CREATE or APPEND, on every (re)connect - a Resume too
        judge_distinct(self.src.name, self.tgt.name, self.s, self.t)
        self._ensure_folder()
        self.top, ids, weak = self._read_dest()
        with self.tgt.lock:
            ids |= {m["msgid"] for m in self.tgt.index.values()
                    if m.get("msgid")}
            weak |= {_weak(m.get("ts") or 0, m.get("size") or 0,
                           m.get("subject") or "")
                     for m in self.tgt.index.values() if not m.get("msgid")}
        self.skip_ids, self.skip_weak = ids, weak

    def close(self) -> None:
        for conn in (self.s, self.t):
            try:
                if conn is not None:
                    conn.logout()
            except Exception:
                pass
        self.s = self.t = None

    # -- the new folder ------------------------------------------------
    def _ensure_folder(self) -> None:
        """Create the folder if the target lacks it."""
        self.side = "target"
        enc = self.job["folder_enc"]
        names = mailops.list_folders_ex(self.t)
        if not any(n == enc for n, _ in names):
            st, _ = self.t.create(mailops.quote_folder(enc))
            if st != "OK" and enc not in mailops.list_folders(self.t):
                raise RuntimeError(mailops.coded(
                    mailops.COPY_CANNOT_CREATE, folder=self.job["folder"]))
            try:
                self.t.subscribe(mailops.quote_folder(enc))
            except Exception:
                pass            # only makes the folder show up in some apps
        self.dest = enc

    def _read_dest(self) -> tuple[int, set[str], set[str]]:
        """(highest UID, Message-IDs, fingerprints of the id-less mails) of
        the new folder."""
        self.side = "target"
        st, _ = self.t.select(mailops.quote_folder(self.dest), readonly=True)
        if st != "OK":
            raise RuntimeError(mailops.coded(
                mailops.COPY_CANNOT_CREATE, folder=self.job["folder"]))
        st, data = self.t.uid("SEARCH", None, "ALL")
        uids = [int(u) for u in (data[0].split() if st == "OK" and data
                                 and data[0] else [])]
        ids, weak = self._header_info(uids)
        return max(uids, default=0), ids, weak

    def _header_info(self, uids: list[int]) -> tuple[set[str], set[str]]:
        """(Message-IDs, fingerprints of the id-less mails) of these UIDs of
        the new folder (the folder is selected)."""
        ids: set[str] = set()
        weak: set[str] = set()
        for i in range(0, len(uids), mailops.MOVE_CHUNK):
            part = ",".join(str(u) for u in uids[i:i + mailops.MOVE_CHUNK])
            st, data = self.t.uid(
                "FETCH", part, "(UID INTERNALDATE RFC822.SIZE "
                "BODY.PEEK[HEADER.FIELDS (MESSAGE-ID SUBJECT)])")
            if st != "OK":
                raise imaplib.IMAP4.error(f"FETCH failed: {st}")
            for item in data or []:
                if not (isinstance(item, tuple) and len(item) >= 2):
                    continue
                msg = email.message_from_bytes(item[1])
                mid = mailops.header_text(msg.get("Message-ID")).strip()[:300]
                if mid:
                    ids.add(mid)
                    continue
                dm = _INTERNALDATE_RE.search(item[0])
                sm = re.search(rb"RFC822\.SIZE (\d+)", item[0])
                if dm and sm:
                    weak.add(_weak(
                        _idate_epoch(dm.group(1).decode()),
                        int(sm.group(1)),
                        mailops.decode_mime(msg.get("Subject", ""))[:150]))
        return ids, weak

    def _landed(self) -> tuple[int, set[str], set[str]]:
        """What arrived in the new folder since the last look: (how many
        mails, their Message-IDs, fingerprints) - one targeted SEARCH for the
        UIDs above the highest known one, not a listing of the folder."""
        self.side = "target"
        st, _ = self.t.select(mailops.quote_folder(self.dest), readonly=True)
        if st != "OK":
            return 0, set(), set()
        st, data = self.t.uid("SEARCH", None, "UID", f"{self.top + 1}:*")
        # `n:*` always answers the newest mail, even below n: filter
        new = sorted(u for u in (int(x) for x in (
            data[0].split() if st == "OK" and data and data[0] else []))
            if u > self.top)
        if new:
            self.top = new[-1]
        ids, weak = self._header_info(new)
        return len(new), ids, weak

    # -- the source (read only) ----------------------------------------
    def _open_source(self, folder: str) -> None:
        if self.sel == folder:
            return
        self.side = "source"
        st, _ = self.s.select(mailops.quote_folder(folder), readonly=True)
        if st != "OK":
            raise RuntimeError(mailops.coded(
                mailops.CANNOT_OPEN, folder=mailops.decode_mutf7(folder)))
        known = self.src.folder_uv.get(folder)
        if known and mailops.uidvalidity(self.s) != known:
            raise RuntimeError(mailops.coded(
                mailops.COPY_SOURCE_CHANGED,
                folder=mailops.decode_mutf7(folder)))
        self.sel = folder

    def _fetch(self, folder: str, uids: list[int]) -> dict[int, tuple]:
        """{uid: (flags, INTERNALDATE, raw bytes)} - BODY.PEEK[] never sets
        \\Seen. The reply may carry FLAGS / INTERNALDATE before or after the
        literal, so a record's metadata is every part that follows it."""
        self._open_source(folder)
        self.side = "source"
        st, data = self.s.uid(
            "FETCH", ",".join(str(u) for u in uids),
            "(UID FLAGS INTERNALDATE BODY.PEEK[])")
        if st != "OK":
            raise imaplib.IMAP4.error(f"FETCH failed: {st}")
        out: dict[int, tuple] = {}
        meta = raw = None
        for item in list(data or []) + [None]:
            if isinstance(item, tuple) or item is None:
                if raw is not None:
                    self._record(out, meta, raw)
                meta, raw = (item[0], item[1]) if item else (None, None)
            elif isinstance(item, (bytes, bytearray)) and raw is not None:
                meta = meta + b" " + bytes(item)
        return out

    @staticmethod
    def _record(out: dict, meta: bytes, raw: bytes) -> None:
        um = re.search(rb"UID (\d+)", meta)
        if not um:
            return
        fm = re.search(rb"FLAGS \(([^)]*)\)", meta)
        have = (fm.group(1).lower() if fm else b"").split()
        flags = " ".join(name for name, low in _FLAGS_KEEP if low in have)
        dm = _INTERNALDATE_RE.search(meta)
        out[int(um.group(1))] = (flags, dm.group(1).decode() if dm else None,
                                 bytes(raw))

    # -- one chunk -----------------------------------------------------
    def _note(self, key: str, state: str, sync: bool = False) -> None:
        _ledger_append([(key, state)], sync)
        self.prior[key] = state

    def copy_chunk(self, folder: str, chunk: list[dict]) -> dict[str, str]:
        """Copy one chunk of one folder; returns {key: status} for what got
        a final answer: ok (copied + verified), unchecked (copied, nothing to
        verify it by), dup (already there), big, gone (no longer in the
        source), failed (retried on resume).

        A mail WITHOUT a Message-ID is found again by its fingerprint (date,
        size, subject). Its ledger line says `pending` before the APPEND and
        `appended` right after it, so a crash, a dropped connection or a
        resume never appends it a second time: it is matched by fingerprint
        (ok) or, when the target answers differently, reported `unchecked`."""
        result: dict[str, str] = {}
        todo = []
        for it in chunk:
            key = it["key"]
            if it["size"] > MAX_MAIL_BYTES:
                result[key] = "big"
            elif it["msgid"]:
                if it["msgid"] in self.skip_ids:
                    # ours from before a restart / reconnect: copied, not
                    # "already there"
                    result[key] = "ok" if key in self.attempted \
                        or key in self.prior else "dup"
                else:
                    todo.append(it)
            elif key in self.prior:            # id-less, tried before
                weak = _weak(it["ts"], it["size"], it["subject"])
                # found: ok. Acknowledged but not found: unchecked. Never
                # acknowledged (pending) and not found: it may not be there
                result[key] = "ok" if weak in self.skip_weak else (
                    "unchecked" if self.prior[key] == "appended" else "unsure")
            else:
                todo.append(it)
        appended: list[dict] = []
        raws: dict[str, str] = {}
        if todo:
            fetched = self._fetch(folder, [it["uid"] for it in todo])
            for it in todo:
                key = it["key"]
                got = fetched.get(it["uid"])
                if got is None:
                    result[key] = "gone"
                    continue
                flags, idate, raw = got
                if len(raw) > MAX_MAIL_BYTES:
                    result[key] = "big"
                    continue
                if it["msgid"]:
                    if it["msgid"] in self.skip_ids:
                        result[key] = "dup"       # twice in this very chunk
                        continue
                else:
                    epoch = _idate_epoch(idate) or it["ts"]
                    fp = _weak(epoch, len(raw), _raw_subject(raw))
                    if fp in self.skip_weak or _weak(
                            it["ts"], it["size"], it["subject"]) \
                            in self.skip_weak:
                        result[key] = "dup"
                        continue
                    raws[key] = fp
                    self._note(key, "pending")
                self.attempted.add(key)       # from here on a copy of it in
                if self._append(flags, idate or it["ts"] or None, raw):
                    self._note(key, "appended")   # the target may be ours
                    appended.append(it)
                    if it["msgid"]:
                        self.skip_ids.add(it["msgid"])
                    else:
                        self.skip_weak.add(raws[key])
                else:
                    result[key] = "failed"
        if appended:
            count, ids, weak = self._landed()
            for it in appended:
                key = it["key"]
                if it["msgid"]:
                    ok = it["msgid"] in ids
                    if not ok:
                        self.skip_ids.discard(it["msgid"])
                    result[key] = "ok" if ok else "failed"
                elif raws[key] in weak:
                    result[key] = "ok"
                elif count >= len(appended):
                    result[key] = "unchecked"      # it landed, by another look
                else:
                    result[key] = "failed"
                    self.skip_weak.discard(raws[key])
        return result

    def _append(self, flags: str, date, raw: bytes) -> bool:
        self.side = "target"
        stamp = date if not isinstance(date, str) else f'"{date}"'
        st, data = self.t.append(
            mailops.quote_folder(self.dest), f"({flags})" if flags else None,
            stamp, raw)
        if st == "OK":
            self.streak = 0
            return True
        text = b" ".join(d for d in data or [] if isinstance(d, bytes)).upper()
        if b"QUOTA" in text or b"FULL" in text:
            raise RuntimeError(mailops.COPY_TARGET_FULL)
        self.streak += 1
        if self.streak >= FAIL_STREAK:
            raise RuntimeError(mailops.COPY_APPEND_REFUSED)
        return False


def _fingerprint(m: dict) -> str:
    return "fp:" + hashlib.sha1(("%s\0%s\0%s\0%s" % (
        m["addr"], m["subject"], m["ts"], m["size"])).encode(
            "utf-8", "replace")).hexdigest()


def _key(m: dict) -> str:
    """What the ledger knows a mail by: its Message-ID, else a fingerprint of
    what the scan recorded (sender, subject, date, size) - stable across a
    rescan, a new UID or a new UIDVALIDITY."""
    return m["msgid"] or _fingerprint(m)


class _Dropped(Exception):
    """The job was removed (an account was deleted) while it ran."""


def _save(job: dict) -> None:
    """Persist the worker's counters into the stored job. The names stay the
    stored ones (an account may have been renamed meanwhile); a job that is
    gone ends the run."""
    with _LOCK:
        data = _read()
        cur = data["job"]
        if not cur or cur.get("id") != job["id"]:
            raise _Dropped()
        cur.update({k: v for k, v in job.items()
                    if k not in ("source", "target")})
        _write(data)


def _stop_requested() -> str:
    return _STOP.get(tenants.current().id, "")


def _run(mine: list) -> None:
    """The copy thread (a tenant context is already entered). It stays
    registered until everything is done, the audit entry included, and only
    removes its own registration."""
    try:
        _work()
    finally:
        with _LOCK:
            tid = tenants.current().id
            me = mine[0] if mine else None
            if me is not None and _THREADS.get(tid) is me:
                del _THREADS[tid]


def _work() -> None:
    tid = tenants.current().id
    with _LOCK:
        job = _read()["job"]
    if not job or job["status"] != "running":
        return
    run = None
    try:
        # both accounts must be this thread's tenant's (`_resolve` checks it:
        # a renamed, removed or foreign one never runs)
        src, tgt = _resolve(job["source"], job["target"])
        picked = _mask(job["kinds"])
        every = [i for i in classify(src) if i["mask"] & picked]
        items, seen, repeats = [], set(), 0
        for i in every:
            i["key"] = _key(i)
            if i["key"] in seen:
                repeats += 1          # the same Message-ID twice in the source
                continue
            seen.add(i["key"])
            items.append(i)
        ledger = _ledger_read(job["id"])
        run = _Run(job, src, tgt)
        # what the ledger says: finished mails, and mails the previous run
        # appended (or was about to) without finishing them
        run.prior = {k: v for k, v in ledger.items() if v not in FINAL}
        run.attempted = set(run.prior)
        sizes = {i["key"]: i["size"] for i in items}
        counts = {s: 0 for s in FINAL}
        done_bytes = 0
        for key, st in ledger.items():
            if key in sizes and st in counts:
                counts[st] += 1
                done_bytes += sizes[key]
        job.update(total=len(every), bytes_total=sum(i["size"]
                                                     for i in every),
                   copied=counts["ok"] + counts["unchecked"],
                   checked=counts["ok"], unchecked=counts["unchecked"],
                   skipped=counts["dup"] + repeats,
                   too_large=counts["big"], missing=counts["gone"],
                   unsure=counts["unsure"], bytes_done=done_bytes, error="")
        todo = [i for i in items if ledger.get(i["key"]) not in FINAL]
        todo.sort(key=lambda i: (i["folder"], i["uid"]))
        run.connect()
        _save(job)
        last = time.monotonic()
        pos = 0
        while pos < len(todo):
            stop = _stop_requested()
            if stop:
                break
            folder = todo[pos]["folder"]
            chunk, size = [], 0
            while pos < len(todo) and todo[pos]["folder"] == folder \
                    and len(chunk) < CHUNK_MAILS \
                    and (not chunk or size + todo[pos]["size"] <= CHUNK_BYTES):
                chunk.append(todo[pos])
                size += todo[pos]["size"]
                pos += 1
            try:
                result = run.copy_chunk(folder, chunk)
            except (imaplib.IMAP4.abort, OSError):
                # a dropped connection: reconnect, read what the target
                # holds now, and do this chunk once more (what the first try
                # appended is in the ledger and counts as copied)
                run.connect()
                result = run.copy_chunk(folder, chunk)
            rows = []
            by_key = {i["key"]: i for i in chunk}
            for key, st in result.items():
                if st == "failed":
                    job["failed"] += 1
                    continue
                rows.append((key, st))
                weight = by_key[key]["size"]
                job["bytes_done"] += weight
                if st in ("ok", "unchecked"):
                    job["copied"] += 1
                    job["checked" if st == "ok" else "unchecked"] += 1
                elif st == "dup":
                    job["skipped"] += 1
                elif st == "unsure":
                    job["unsure"] = job.get("unsure", 0) + 1
                elif st == "big":
                    job["too_large"] += 1
                else:
                    job["missing"] += 1
            _ledger_append(rows)        # on disk BEFORE the counters say so
            now = time.monotonic()
            took, last = now - last, now
            job["active_s"] += took
            _save(job)
            if THROTTLE_RATIO and not demo.enabled():
                time.sleep(min(THROTTLE_MAX_S, took * THROTTLE_RATIO))
                last = time.monotonic()
        with _LOCK:
            stop = _stop_requested()
            if stop == "pause":
                job["status"] = "paused"
            elif stop == "cancel":
                job.update(status="cancelled", finished=int(time.time()))
            else:
                job.update(status="done", finished=int(time.time()))
            _STOP.pop(tid, None)
            _save(job)
    except _Dropped:
        job["status"] = "dropped"
    except Exception as exc:
        log.warning("account copy stopped: %s: %s", type(exc).__name__, exc)
        # the host of the side that failed (a connection error names it)
        host = run.host if run is not None else _host(job["source"])
        job.update(status="error", finished=int(time.time()),
                   error=mailops.error_text(exc, host, mailops.INTERNAL_ERROR))
        with _LOCK:
            _STOP.pop(tid, None)
            try:
                _save(job)
            except _Dropped:
                job["status"] = "dropped"
    finally:
        if run is not None:
            run.close()
    if job["status"] in ("done", "cancelled", "error"):
        _audit(job)
    if job["status"] == "done":
        _rescan_target(job["target"])


def _audit(job: dict) -> None:
    """One audit entry per finished job: counts only, no subjects."""
    outcome = {"done": "ok", "cancelled": "cancelled"}.get(job["status"],
                                                           "error")
    try:
        auditlog.record(
            "account_copy", actor="user", account=job["source"],
            count=job["copied"], size=job["bytes_done"],
            label=f"{job['source']} → {job['target']}",
            outcome=outcome, error=job["error"] if outcome == "error" else "")
    except Exception:
        log.exception("could not record the account copy")


def _rescan_target(name: str) -> None:
    """The copied mails are new in the target: let its next view show them."""
    try:
        mailops.start_scan(accounts.get(name))
    except Exception:
        pass            # busy or unknown: the next scan picks them up


# -------------------------------------------------------------- tell them

def tell(source: str, target: str) -> dict:
    """The "Tell them" page: senders that wrote to the source address in the
    last 90 days, newsletters apart (they are unsubscribed, not told)."""
    src, _ = _resolve(source, target)
    cutoff = time.time() - TELL_DAYS * 86400
    per: dict[str, dict] = {}
    for it in classify(src):
        if it["ts"] < cutoff or not it["addr"]:
            continue
        s = per.setdefault(it["addr"], {"addr": it["addr"], "name": "",
                                        "mails": 0, "last": 0, "news": 0,
                                        "kept": False, "bulk": False,
                                        "purpose": False})
        s["mails"] += 1
        if it["ts"] >= s["last"]:
            s["last"] = it["ts"]
            s["name"] = it["name"] or s["name"]
        if it["mask"] & BIT["newsletter"]:
            s["news"] += 1
        if it["bulk"]:
            s["bulk"] = True               # offers List-Unsubscribe
        if it["mask"] & (BIT["orders"] | BIT["accounts"]
                         | BIT["appointments"]):
            s["purpose"] = True            # order / account / booking mail
        if it["mask"] & (BIT["replied"] | BIT["protected"]):
            s["kept"] = True
    ticks = set(_read()["tell"].get(source, {}).get(target, ()))
    senders, news = [], []
    for s in per.values():
        # a newsletter: mostly newsletter mails, or any bulk sender (it
        # offers List-Unsubscribe) the user neither writes to nor protects
        # (a shop with a promo AND its order mails stays on the checklist)
        if not s["kept"] and not s["purpose"] and (
                s["bulk"] or 2 * s["news"] >= s["mails"]):
            news.append(s["addr"])
        else:
            senders.append({"addr": s["addr"], "name": s["name"],
                            "mails": s["mails"], "last": s["last"],
                            "done": s["addr"] in ticks})
    senders.sort(key=lambda s: (-s["mails"], s["addr"]))
    return {"source": {"name": source, "address": _address(source)},
            "target": {"name": target, "address": _address(target)},
            "total": len(senders),
            "done": sum(1 for s in senders if s["done"]),
            "senders": senders[:TELL_SHOWN],
            "newsletters": len(news), "newsletter_keys": sorted(news)[:500]}


def set_told(source: str, target: str, addr: str, done: bool) -> dict:
    _resolve(source, target)
    addr = str(addr or "").strip().lower()[:254]
    if not addr:
        raise ValueError(mailops.COPY_NOTHING)
    with _LOCK:
        data = _read()
        mine = set(data["tell"].setdefault(source, {}).get(target, ()))
        mine.add(addr) if done else mine.discard(addr)
        data["tell"][source][target] = sorted(mine)
        _write(data)
    return tell(source, target)
