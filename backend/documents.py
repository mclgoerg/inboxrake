"""Your documents: the mails with a file that you may need at tax time.

Insights > Your documents lists, year by year, the mails that carry a file AND
read like a document: the three classes of Keep-safe (invoices & bills,
contracts & policies, bookings & tickets - `keepsafe.classes_of`) plus a
pattern set of its own for tax & official mail (EN + DE, generic words only).
Nothing is stored and nothing is asked of the mail server to build the list:
it is derived from the scan index and the attachment analysis (the page offers
"Analyze" first when that has not run), the pins and nothing else.

Reads only. The one thing that reaches the mail server is a download: the
file of ONE mail is read from the server when the user asks for it (the same
full-mail read as "Download the files first" of #411, `removefiles._fetch_one`)
and handed to the browser; nothing is sent anywhere else and nothing is
changed or deleted.

* A mail is listed once: copies of the same Message-ID in several folders are
  one document row (the pin is by Message-ID anyway).
* "Files" are what the attachment analysis lists for the mail, less the noise:
  tiny images (logos, signatures) and signature / calendar / contact files.
* A download is only served for a file the page lists: the mail must be in
  THIS account's index (so the tenant and the account are the ones the request
  is pinned to), be a document and carry the file (name + size as listed); the
  server then looks at the mail itself (UIDVALIDITY, Message-ID, the part) and
  refuses when it is not the mail the scan saw.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from urllib.parse import quote

from . import config as cfgmod
from . import keepsafe
from . import mailops
from . import mimecut
from . import pinstore
from . import removefiles
from . import smartkinds

log = logging.getLogger("inboxrake.documents")

# The kinds, in the order the page shows them.
INVOICES, CONTRACTS, BOOKINGS, TAX = "invoices", "contracts", "bookings", "tax"
KINDS = (INVOICES, CONTRACTS, BOOKINGS, TAX)

ROWS_MAX = 5000                 # rows of one year the list returns
SMALL_IMAGE = 40 * 1024         # a picture below this is a logo, not a document
# signatures, calendar entries, business cards: files, but no documents
NOT_DOCUMENTS = frozenset({"p7s", "asc", "sig", "ics", "vcf"})

# error codes of the downloads (mailops.coded; the interface words them)
NOT_SCANNED = mailops.DOCS_NOT_SCANNED
GONE = mailops.DOCS_GONE
CHANGED = mailops.DOCS_CHANGED
TOO_BIG = mailops.DOCS_TOO_BIG
FAILED = mailops.DOCS_FAILED
BUSY = mailops.DOCS_BUSY


class _Slots:
    """How many reads of one (tenant, account) are going on: a download holds
    a whole mail (up to the cap) and its decoded file in memory, so only a few
    may run at once."""

    def __init__(self):
        self._n: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    def take(self, key: tuple[str, str], limit: int) -> bool:
        with self._lock:
            if self._n.get(key, 0) >= limit:
                return False
            self._n[key] = self._n.get(key, 0) + 1
            return True

    def drop(self, key: tuple[str, str]) -> None:
        with self._lock:
            left = self._n.get(key, 0) - 1
            if left > 0:
                self._n[key] = left
            else:
                self._n.pop(key, None)


FILE_PARALLEL = 2               # one-file downloads of an account at a time
_FILES = _Slots()


class Refused(Exception):
    """A download that cannot be served: a coded `detail` and the HTTP status
    (404 = not in the list, 409 = the server's mail is not the scanned one)."""

    def __init__(self, code: str, status: int = 409):
        super().__init__(code)
        self.code = code
        self.status = status


# ---------------------------------------------------------------- patterns

_I = re.IGNORECASE

# Tax & official mail: authorities, assessments and certificates. Generic
# words only (no company, no authority's name); EN + DE. A subject that is a
# request to rate something or promotional is never matched (see `kind_of`).
TAX_RE = re.compile(
    # DE: tax, notices from authorities
    r"steuer(bescheid|bescheide|erkl[aä]rung|bescheinigung|nummer|-?id\b|"
    r"festsetzung|vorauszahlung|nachzahlung|erstattung|jahr\b)|"
    r"(lohn|einkommen|umsatz|grund|kirchen|gewerbe|kfz)-?steuer|\bfinanzamt|"
    # "Bescheid" alone is also "let me know" ("sag Bescheid"): only a compound
    # (Gebührenbescheid) or the notice's own words ("Bescheid für 2025")
    r"[a-zäöüß]bescheid(e|s)?\b|"
    r"\bbescheid(e|s)?\s+(?:f[uü]r|[uü]ber|vom|zum|zur|nr\b)|"
    r"bescheinigung|\bbeh[oö]rde|\bamtlich|"
    r"b[uü](ß|ss)geld|ordnungswidrigkeit|\banh[oö]rung\b|"
    r"rentenanpassung|\bzoll(amt|anmeldung)|"
    # EN
    r"\btax (return|assessment|notice|statement|certificate|refund|"
    r"document|form|office|authority|code|summary)s?\b|"
    r"\b(notice|certificate) of assessment|\bassessment notice|"
    r"self[- ]assessment|\bw-2\b|\bform w-?2\b|\b1099[- ]?(int|div|misc|nec|k)\b|"
    r"\bform 1099|\bp60\b|\bp45\b|"
    r"\bvat (return|certificate)|"
    r"\b(penalty|parking|speeding|fixed[- ]penalty) (notice|charge|fine)|"
    r"\b(government|council|court|authority|ministry|municipal|"
    r"official) (notice|letter|decision|order|summons)|"
    r"\b(residence|work) permit|\bcustoms (declaration|duty|duties)", _I)

# What the page adds to Keep-safe's "contracts & policies" (that class is the
# terms / privacy notices): the contract itself and the insurance papers. Only
# for this page - Keep-safe keeps what it has.
CONTRACT_RE = re.compile(
    r"vertr[aä]g|\bcontracts?\b|\bagreements?\b|versicherungs(schein|police)|"
    r"\bihre police\b|\bpolic(y|ies) (documents?|schedule|certificate)|"
    r"insurance (certificate|documents?)|\bsubscription terms\b", _I)

# The explicit words of an invoice (Keep-safe's invoice rule, less its payment
# words): a subject that names one is an invoice whatever else it names.
INVOICE_WORDS_RE = re.compile(
    r"rechnung(?!sadresse)|\binvoice\b|\breceipt\b|zahlungsbeleg|quittung",
    _I)


def kind_of(m: dict) -> str | None:
    """The kind of document one index entry is, or None. Decided from the
    subject (and what the sender's address says of it, `smartkinds.sender_hint`)
    like Keep-safe does, first match wins: a subject that names an invoice or
    receipt is an invoice; then tax & official (its words are specific); then
    contracts & policies; then the weaker bill and payment words (invoices &
    bills); then bookings & tickets. A mail without a subject and a request to
    rate or review belong to none; promotional mail and newsletters are no tax
    mail and no contract by the page's own contract words (Keep-safe's class
    of terms and privacy notices is as it is)."""
    subject = m.get("subject") or ""
    if not subject or smartkinds.SURVEY_RE.search(subject):
        return None
    hint = smartkinds.sender_hint(m.get("addr") or "", bool(m.get("unsub")))
    classes = keepsafe.classes_of(subject, hint)
    if "invoices" in classes and INVOICE_WORDS_RE.search(subject):
        return INVOICES
    soft = "p" in hint or bool(smartkinds.PROMO_RE.search(subject))
    if not soft and TAX_RE.search(subject):
        return TAX
    if "contracts" in classes or (not soft and CONTRACT_RE.search(subject)):
        return CONTRACTS
    if "invoices" in classes:
        return INVOICES
    if "bookings" in classes:
        return BOOKINGS
    return None


def doc_files(m: dict) -> list[dict]:
    """The files of a mail the page counts: what the attachment analysis
    lists, less tiny pictures (logos, signatures) and signature, calendar and
    contact files."""
    out = []
    for a in m.get("atts") or ():
        ext = mailops.att_ext(a["name"])
        if ext in NOT_DOCUMENTS:
            continue
        if mailops.att_kind(a["name"]) == "images" and a["size"] < SMALL_IMAGE:
            continue
        out.append({"name": a["name"], "size": a["size"]})
    return out


# -------------------------------------------------------------- the list

def _year(ts: int) -> int:
    return time.localtime(ts).tm_year


def _collect(acc) -> list[dict]:
    """One entry per document mail: `{m (a copy of the index record), kind,
    files, year}`, in no particular order. A Message-ID seen in several
    folders is ONE mail (the INBOX copy first)."""
    with acc.lock:
        mails = [dict(m) for m in acc.index.values() if m.get("atts")]
    mails.sort(key=lambda m: (m["folder"] != "INBOX", m["folder"], m["uid"]))
    seen: set[str] = set()
    out = []
    for m in mails:
        if not m.get("ts"):
            continue                          # no date, no year
        mid = m.get("msgid") or ""
        if mid and mid in seen:
            continue
        kind = kind_of(m)
        files = doc_files(m) if kind else []
        if not files:
            continue
        if mid:
            seen.add(mid)
        out.append({"m": m, "kind": kind, "files": files,
                    "year": _year(m["ts"])})
    return out


def _state(acc) -> dict:
    with acc.lock:
        return {"scanned": acc.state["status"] == "done",
                "analyzed": acc.state["atts"]["status"] == "done",
                "analyzing": acc.state["atts"]["status"] == "running"}


def _empty_kinds() -> dict:
    return {k: {"mails": 0, "files": 0, "bytes": 0} for k in KINDS}


def summary(acc) -> dict:
    """What the page's header, tiles and card show: `{scanned, analyzed,
    analyzing, years: [{year, mails, files, bytes, kinds: {kind: {mails,
    files, bytes}}}]}` (years oldest first). Without a finished scan and the
    attachment analysis there are no years - the page offers to analyze."""
    out = _state(acc)
    out["years"] = []
    if not (out["scanned"] and out["analyzed"]):
        return out
    years: dict[int, dict] = {}
    for d in _collect(acc):
        y = years.setdefault(d["year"], {
            "year": d["year"], "mails": 0, "files": 0, "bytes": 0,
            "kinds": _empty_kinds()})
        n, size = len(d["files"]), sum(f["size"] for f in d["files"])
        for tot in (y, y["kinds"][d["kind"]]):
            tot["mails"] += 1
            tot["files"] += n
            tot["bytes"] += size
    out["years"] = [years[k] for k in sorted(years)]
    return out


def _row(d: dict, pinned: set[str]) -> dict:
    m = d["m"]
    mid = m.get("msgid") or ""
    return {"folder": m["folder"], "uid": m["uid"], "ts": m["ts"],
            "date": m.get("date") or "", "subject": m.get("subject") or "",
            "addr": m["addr"], "name": m.get("name") or "",
            "size": m.get("size") or 0, "seen": bool(m.get("seen")),
            "kind": d["kind"], "files": d["files"],
            "pinned": bool(mid) and mid in pinned, "pinnable": bool(mid)}


def listing(acc, year: int) -> dict:
    """The documents of one year, newest first: `{year, total, capped, rows}`
    (at most ROWS_MAX rows; `total` is the real number)."""
    out = {"year": year, "total": 0, "capped": False, "rows": []}
    st = _state(acc)
    if not (st["scanned"] and st["analyzed"]):
        return out
    pinned = pinstore.load_account(acc.name)
    docs = sorted((d for d in _collect(acc) if d["year"] == year),
                  key=lambda d: (-d["m"]["ts"], d["m"]["folder"],
                                 d["m"]["uid"]))
    out["total"] = len(docs)
    out["capped"] = len(docs) > ROWS_MAX
    out["rows"] = [_row(d, pinned) for d in docs[:ROWS_MAX]]
    return out


# ----------------------------------------------------- one file, downloaded

def content_disposition(name: str) -> str:
    """The `Content-Disposition` of a download named `name` (a file name from
    a mail - hostile input): no path, no control or reserved characters, an
    ASCII `filename` for old clients and the real name as `filename*`."""
    safe = mimecut.safe_file_name(name, set(), "file")
    plain = re.sub(r"[^\x20-\x7e]", "_", safe)
    return (f'attachment; filename="{plain}"; '
            f"filename*=UTF-8''{quote(safe, safe='')}")


def _listed_mail(acc, folder: str, uid: int, name: str, size: int) -> dict:
    """The index entry of the mail, when it is a document of THIS account
    that carries the file `name` / `size`; else the refusal."""
    with acc.lock:
        scanned = acc.state["status"] == "done"
        m = acc.index.get(mailops.ikey(folder, uid))
        m = dict(m) if m else None
    if not scanned:
        raise Refused(NOT_SCANNED, 409)
    if not m or kind_of(m) is None:
        raise Refused(GONE, 404)
    want = (name.casefold(), size)
    if not any((f["name"].casefold(), f["size"]) == want
               for f in doc_files(m)):
        raise Refused(GONE, 404)
    return m


def _failure(exc: Exception, acc) -> str:
    try:
        host = cfgmod.account_imap(acc.name)["host"]
    except Exception:
        host = ""
    return mailops.classify_connect_error(exc, host) \
        or mailops.coded(FAILED)


def read_mail(acc, m: dict) -> bytes:
    """The raw bytes of the mail `m` (an index copy), read from the server
    with BODY.PEEK (nothing is marked read) and checked to be the mail the
    scan saw: UIDVALIDITY of the folder, then its Message-ID. Raises
    `Refused`."""
    if (m.get("size") or 0) > removefiles.MAIL_CAP:
        raise Refused(mailops.coded(
            TOO_BIG, mb=removefiles.MAIL_CAP // 1048576), 409)
    conn = None
    try:
        conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
        status, _ = conn.select(mailops.quote_folder(m["folder"]),
                                readonly=True)
        if status != "OK":
            raise Refused(GONE, 404)
        with acc.lock:
            known = acc.folder_uv.get(m["folder"])
        uv = mailops.uidvalidity(conn)
        if known not in (None, 0) and uv and uv != known:
            raise Refused(CHANGED, 409)
        got = removefiles._fetch_one(conn, m["uid"])
    except Refused:
        raise
    except Exception as exc:
        log.warning("could not read a mail for a download: %s",
                    type(exc).__name__)
        raise Refused(_failure(exc, acc), 502)
    finally:
        if conn is not None:
            try:
                conn.logout()
            except Exception:
                pass
    if got is None:
        raise Refused(GONE, 404)
    raw = got["raw"]
    if len(raw) > removefiles.MAIL_CAP:
        raise Refused(mailops.coded(
            TOO_BIG, mb=removefiles.MAIL_CAP // 1048576), 409)
    return raw


def read_file(acc, folder: str, uid: int, name: str, size: int
              ) -> tuple[bytes, str]:
    """`(content, file name)` of one file of one listed mail, read from the
    mail server now. Raises `Refused`."""
    m = _listed_mail(acc, folder, uid, name, size)
    key = (acc.tenant, acc.name)
    if not _FILES.take(key, FILE_PARALLEL):
        raise Refused(BUSY, 409)
    try:
        raw = read_mail(acc, m)
        try:
            root = mimecut.parse(raw)
        except mimecut.MimeError:
            raise Refused(CHANGED, 409)
        msgid = (m.get("msgid") or "").strip()
        if msgid and str(root.msg.get("Message-ID", "")).strip() != msgid:
            raise Refused(CHANGED, 409)
        found, _missing = removefiles._pick_for(root, m, [(name, size)], [0])
        if not found:
            raise Refused(CHANGED, 409)
        try:
            return mimecut.payload(raw, found[0].part), name
        except Exception:
            # a part whose content cannot be decoded (damaged base64)
            log.warning("a file of a mail could not be decoded")
            raise Refused(FAILED, 502)
    finally:
        _FILES.drop(key)
