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


def _ledger_read(job_id: str) -> dict[str, str]:
    """{key: final status} of the job's finished mails ({} for a ledger that
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


def _ledger_append(rows: list[tuple[str, str]]) -> None:
    if not rows:
        return
    with _ledger_path().open("a") as f:
        f.write("".join(json.dumps(list(r)) + "\n" for r in rows))
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass            # a file system without fsync: the flush is all



# --------------------------------------------------------- the accounts

def _resolve(source: str, target: str):
    """(source AccountState, target AccountState) - two different accounts
    of the CURRENT tenant, else a coded refusal."""
    known = accounts.names()
    if source not in known or target not in known:
        raise ValueError(mailops.COPY_UNKNOWN_ACCOUNT)
    if source == target:
        raise ValueError(mailops.COPY_SAME_ACCOUNT)
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
    never INBOX."""
    name = "".join(c for c in str(name or "")
                   if c.isprintable() and c not in '"\\/')
    name = re.sub(r"\s+", " ", name).strip()[:FOLDER_MAX].strip()
    if not name or name.upper() == "INBOX":
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


def free_space(target: str) -> int | None:
    """Free bytes in the target mailbox when its server has QUOTA, else None
    (the page leaves the line out: no guessing)."""
    if target not in accounts.names():
        raise ValueError(mailops.COPY_UNKNOWN_ACCOUNT)
    try:
        conn = mailops.connect(cfgmod.account_imap(target), target)
    except Exception:
        return None
    try:
        return _quota_free(conn)
    except Exception:
        return None
    finally:
        try:
            conn.logout()
        except Exception:
            pass


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
    out["processed"] = (job["copied"] + job["skipped"] + job["too_large"]
                        + job["missing"])
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
    tenant = tenants.current()
    with _LOCK:
        data = _read()
        old = data["job"]
        if old and old["status"] in LIVE:
            raise RuntimeError(mailops.COPY_BUSY)
        job = {"id": f"{time.time_ns():x}", "source": source,
               "target": target, "folder": name, "folder_enc": "",
               "kinds": picked, "status": "running",
               "total": len(items), "bytes_total": sum(i["size"]
                                                       for i in items),
               "copied": 0, "skipped": 0, "checked": 0, "unchecked": 0,
               "too_large": 0, "missing": 0, "failed": 0, "bytes_done": 0,
               "started": int(time.time()), "finished": 0, "error": "",
               "active_s": 0.0}
        _ledger_reset(job["id"])
        _write({**data, "job": job})
    _spawn(tenant)
    return {"job": _public(job)}


def _spawn(tenant) -> None:
    thread = threading.Thread(target=tenants.call_in,
                              args=(tenant, _run), daemon=True)
    with _LOCK:
        _STOP.pop(tenant.id, None)
        _THREADS[tenant.id] = thread
    thread.start()


def _alive() -> bool:
    t = _THREADS.get(tenants.current().id)
    return t is not None and t.is_alive()


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

class _Run:
    """One run of the copy thread: both connections, what the target already
    holds, and the counters."""

    def __init__(self, job: dict, src, tgt):
        self.job, self.src, self.tgt = job, src, tgt
        self.s = self.t = None
        self.sel: str | None = None          # the folder open in the source
        self.dest = ""                       # the new folder, encoded
        self.dest_uids: set[int] = set()
        self.skip_ids: set[str] = set()      # Message-IDs the target has
        self.ledger: dict[str, str] = {}
        self.streak = 0

    # -- connections ---------------------------------------------------
    def connect(self) -> None:
        self.close()
        self.s = mailops.connect(cfgmod.account_imap(self.src.name),
                                 self.src.name)
        self.t = mailops.connect(cfgmod.account_imap(self.tgt.name),
                                 self.tgt.name)
        self.sel = None
        self._ensure_folder()
        self.dest_uids, ids = self._read_dest()
        with self.tgt.lock:
            ids |= {m["msgid"] for m in self.tgt.index.values()
                    if m.get("msgid")}
        self.skip_ids = ids

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
        names = mailops.list_folders_ex(self.t)
        delim = next(iter(names.delims.values()), "")
        raw = self.job["folder"].replace(delim, "-") if delim \
            else self.job["folder"]
        enc = self.job.get("folder_enc") or encode_mutf7(raw)
        if not any(n == enc for n, _ in names):
            st, _ = self.t.create(mailops.quote_folder(enc))
            if st != "OK":
                again = mailops.list_folders(self.t)
                if enc not in again:
                    raise RuntimeError(mailops.coded(
                        mailops.COPY_CANNOT_CREATE, folder=self.job["folder"]))
            try:
                self.t.subscribe(mailops.quote_folder(enc))
            except Exception:
                pass            # only makes the folder show up in some apps
        self.dest = enc
        self.job["folder_enc"] = enc

    def _read_dest(self) -> tuple[set[int], set[str]]:
        """(UIDs, Message-IDs) of the new folder."""
        st, _ = self.t.select(mailops.quote_folder(self.dest), readonly=True)
        if st != "OK":
            raise RuntimeError(mailops.coded(
                mailops.COPY_CANNOT_CREATE, folder=self.job["folder"]))
        st, data = self.t.uid("SEARCH", None, "ALL")
        uids = [int(u) for u in (data[0].split() if st == "OK" and data
                                 and data[0] else [])]
        return set(uids), self._header_ids(uids)

    def _header_ids(self, uids: list[int]) -> set[str]:
        ids: set[str] = set()
        for i in range(0, len(uids), mailops.MOVE_CHUNK):
            part = ",".join(str(u) for u in uids[i:i + mailops.MOVE_CHUNK])
            st, data = self.t.uid(
                "FETCH", part, "(UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
            if st != "OK":
                raise imaplib.IMAP4.error(f"FETCH failed: {st}")
            for item in data or []:
                if isinstance(item, tuple) and len(item) >= 2:
                    mid = mailops.header_text(
                        email.message_from_bytes(item[1]).get(
                            "Message-ID")).strip()[:300]
                    if mid:
                        ids.add(mid)
        return ids

    def _new_dest_ids(self) -> set[str]:
        """Message-IDs of what landed in the new folder since the last look."""
        st, _ = self.t.select(mailops.quote_folder(self.dest), readonly=True)
        if st != "OK":
            return set()
        st, data = self.t.uid("SEARCH", None, "ALL")
        uids = {int(u) for u in (data[0].split() if st == "OK" and data
                                 and data[0] else [])}
        new = sorted(uids - self.dest_uids)
        self.dest_uids |= uids
        return self._header_ids(new)

    # -- the source (read only) ----------------------------------------
    def _open_source(self, folder: str) -> None:
        if self.sel == folder:
            return
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
    def copy_chunk(self, folder: str, chunk: list[dict]) -> dict[str, str]:
        """Copy one chunk of one folder; returns {key: status} for what got
        a final answer: ok (copied + verified), unchecked (copied, no
        Message-ID to verify by), dup (already there), big, gone (no longer
        in the source), failed (retry on resume)."""
        result: dict[str, str] = {}
        todo = []
        for it in chunk:
            if it["size"] > MAX_MAIL_BYTES:
                result[it["key"]] = "big"
            elif it["msgid"] and it["msgid"] in self.skip_ids:
                result[it["key"]] = "dup"
            else:
                todo.append(it)
        appended: list[dict] = []
        if todo:
            fetched = self._fetch(folder, [it["uid"] for it in todo])
            for it in todo:
                got = fetched.get(it["uid"])
                if got is None:
                    result[it["key"]] = "gone"
                    continue
                flags, idate, raw = got
                if len(raw) > MAX_MAIL_BYTES:
                    result[it["key"]] = "big"
                    continue
                if it["msgid"] and it["msgid"] in self.skip_ids:
                    result[it["key"]] = "dup"     # twice in this very chunk
                    continue
                if self._append(flags, idate or it["ts"] or None, raw):
                    appended.append(it)
                    if it["msgid"]:
                        self.skip_ids.add(it["msgid"])
                else:
                    result[it["key"]] = "failed"
        if appended:
            landed = self._new_dest_ids()
            for it in appended:
                if not it["msgid"]:
                    result[it["key"]] = "unchecked"
                elif it["msgid"] in landed:
                    result[it["key"]] = "ok"
                else:
                    result[it["key"]] = "failed"
                    self.skip_ids.discard(it["msgid"])
        return result

    def _append(self, flags: str, date, raw: bytes) -> bool:
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


def _key(m: dict) -> str:
    return m["msgid"] or f"{m['folder']}\x00{m['uid']}"


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


def _run() -> None:
    """The copy thread (a tenant context is already entered)."""
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
        run.ledger = ledger
        sizes = {i["key"]: i["size"] for i in items}
        counts = {s: 0 for s in ("ok", "unchecked", "dup", "big", "gone")}
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
                   bytes_done=done_bytes, error="")
        todo = [i for i in items if i["key"] not in ledger]
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
                # holds now, and do this chunk once more
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
        host = ""
        try:
            host = cfgmod.account_imap(job["source"])["host"]
        except Exception:
            pass
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
        with _LOCK:
            _THREADS.pop(tid, None)
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
                                        "kept": False})
        s["mails"] += 1
        if it["ts"] >= s["last"]:
            s["last"] = it["ts"]
            s["name"] = it["name"] or s["name"]
        if it["mask"] & BIT["newsletter"]:
            s["news"] += 1
        if it["mask"] & (BIT["replied"] | BIT["protected"]):
            s["kept"] = True
    ticks = set(_read()["tell"].get(source, {}).get(target, ()))
    senders, news = [], []
    for s in per.values():
        if not s["kept"] and 2 * s["news"] >= s["mails"]:
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
