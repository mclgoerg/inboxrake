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

* The year's .zip (`plan` / `build_zip`): the files of the ticked kinds in
  folders by kind and month, an optional `index.csv` (date, sender, subject,
  file, amount - the amount read from the SUBJECT only, never from the mail's
  text or a file), built here from the mails read one by one (read only) into a
  spooled temp file that the caller closes. Above `ZIP_CAP` (the cap of #411)
  the year is split into several downloads - a `plan` digest ties them
  together, so a scan between two of them stops the next instead of leaving a
  mail out or taking it twice. One .zip of an account is made at a time. With
  "keep these mails safe" the mails that went in are pinned afterwards through
  the ordinary pin path (`mailops.set_mail_pins`).
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

import csv
import hashlib
import io
import json
import logging
import re
import tempfile
import threading
import time
import zipfile
from urllib.parse import quote

from . import config as cfgmod
from . import csvsafe
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
NOTHING = mailops.DOCS_NOTHING
BUSY = mailops.DOCS_BUSY
TOO_MANY = mailops.DOCS_TOO_MANY

# The year's .zip: capped like the one of #411; above the cap it is split into
# several downloads (`parts`), at most MAX_PARTS of them.
ZIP_CAP = removefiles.ZIP_CAP
MAX_PARTS = 40
INDEX_NAME = "index.csv"
INDEX_HEADER = ("date", "sender", "subject", "file", "amount")
# the folders of the .zip: by kind, then by month (YYYY-MM)
KIND_DIRS = {
    "en": {INVOICES: "Invoices and bills", CONTRACTS: "Contracts and policies",
           BOOKINGS: "Bookings and tickets", TAX: "Tax and official"},
    "de": {INVOICES: "Rechnungen und Belege",
           CONTRACTS: "Verträge und Policen",
           BOOKINGS: "Buchungen und Tickets", TAX: "Steuern und Behörden"},
}


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


# ------------------------------------------------------------ the amounts

_CODES = {"€": "EUR", "euro": "EUR", "$": "USD", "£": "GBP", "¥": "JPY"}
# a thousands separator besides . and ,: no-break space, thin space, '. NEVER a
# plain space - "Rate 2 von 3 120,00 EUR" has two numbers, not 3120
_SPACES = r"\u00a0\u202f'"
_GROUP = rf"[.,{_SPACES}]"
_NUM = (rf"(?:\d{{1,3}}(?:{_GROUP}\d{{3}})+(?:[.,]\d{{1,2}})?"
        r"|\d+(?:[.,]\d{1,2})?)")
_CUR = (r"(?:€|(?<![A-Za-z])\$|£|¥|\b(?:EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN|CZK|CAD|AUD|JPY"
        r"|Euro)\b)")
# a number that is followed (before) or preceded (after) by a plain-spaced
# digit run is part of a longer, ambiguous run: no amount
_BEFORE = re.compile(rf"({_CUR})\s?({_NUM})(?!\d)(?!\s\d)", _I)
_AFTER = re.compile(rf"(?<![\w.,-])(?<!\d\s)({_NUM})\s?({_CUR})", _I)


def _plain(num: str) -> str | None:
    """`1.234,56` / `1,234.56` / `24,9` -> `1234.56` / `1234.56` / `24.90`."""
    s = re.sub(rf"[{_SPACES}]", "", num)
    if "," in s and "." in s:
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        s = s.replace("." if dec == "," else ",", "").replace(dec, ".")
    elif "," in s or "." in s:
        sep = "," if "," in s else "."
        head, _, tail = s.rpartition(sep)
        if s.count(sep) > 1 or (len(tail) == 3 and 1 <= len(head) <= 3):
            s = s.replace(sep, "")          # a thousands separator
        else:
            s = head + "." + tail
    whole, _, frac = s.partition(".")
    if not whole.isdigit() or len(whole) > 12 or (frac and not frac.isdigit()):
        return None
    return whole + ("." + (frac + "0")[:2] if frac else "")


def _code(token: str) -> str:
    return _CODES.get(token.lower(), token.upper())


def amount_of(subject: str) -> str:
    """The amount a subject names, as `24.90 EUR`, or "" - read from the
    subject ONLY (never the mail's text or its file), and only next to a
    currency sign or code (`Invoice 2026-1187` has none). Several different
    amounts are no answer: a wrong figure in a tax list is worse than none."""
    text = subject or ""
    found: set[str] = set()
    taken: list[tuple[int, int]] = []       # currency tokens a number follows
    for m in _BEFORE.finditer(text):
        num = _plain(m.group(2))
        if num is not None:
            found.add(f"{num} {_code(m.group(1))}")
            taken.append(m.span(1))
    for m in _AFTER.finditer(text):
        a, b = m.span(2)
        if any(a < y and x < b for x, y in taken):
            # "1187 EUR 24,90": one currency between two numbers - which one
            # is the amount? No answer.
            return ""
        num = _plain(m.group(1))
        if num is not None:
            found.add(f"{num} {_code(m.group(2))}")
    return found.pop() if len(found) == 1 else ""


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
    analyzing, cap, years: [{year, mails, files, bytes, kinds: {kind: {mails,
    files, bytes}}}]}` (years oldest first; `cap` the size above which a
    year's .zip comes in several downloads). Without a finished scan and the
    attachment analysis there are no years - the page offers to analyze."""
    out = _state(acc)
    out["cap"] = ZIP_CAP
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


# ------------------------------------------------------------ the year's zip

def _kinds_of(kinds) -> list[str]:
    """The asked kinds that exist, in the page's order; none is a refusal."""
    want = {k for k in kinds or () if isinstance(k, str)}
    out = [k for k in KINDS if k in want]
    if not out:
        raise Refused(NOTHING, 409)
    return out


def _selected(acc, year: int, kinds: list[str]) -> list[dict]:
    """The documents of `year` in the asked kinds, in the order of the .zip:
    by kind, then oldest first (so a month is one run)."""
    docs = [d for d in _collect(acc)
            if d["year"] == year and d["kind"] in kinds]
    docs.sort(key=lambda d: (KINDS.index(d["kind"]), d["m"]["ts"],
                             d["m"]["folder"], d["m"]["uid"]))
    return docs


def _weight(d: dict) -> int:
    return sum(f["size"] for f in d["files"])


def _split(docs: list[dict]) -> list[list[dict]]:
    """The documents in downloads of at most ZIP_CAP bytes of files each (by
    the sizes of the attachment index, which are the larger transfer-encoded
    ones): consecutive, never a mail cut in two."""
    parts: list[list[dict]] = []
    cur: list[dict] = []
    size = 0
    for d in docs:
        w = _weight(d)
        if cur and size + w > ZIP_CAP:
            parts.append(cur)
            cur, size = [], 0
        cur.append(d)
        size += w
    if cur:
        parts.append(cur)
    return parts


def _digest(year: int, kinds: list[str], parts: list[list[dict]]) -> str:
    """What the downloads of one plan have in common: if the list changes
    between two of them (a scan came in) the digest differs and the next one is
    refused instead of leaving a mail out or taking it twice."""
    body = json.dumps(
        [year, kinds, [[[d["m"]["folder"], d["m"]["uid"],
                         [[f["name"], f["size"]] for f in d["files"]]]
                        for d in p] for p in parts]],
        separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()[:24]


def _planned(acc, year: int, kinds) -> tuple[list[str], list[list[dict]]]:
    if not _state(acc)["scanned"]:
        raise Refused(NOT_SCANNED, 409)
    want = _kinds_of(kinds)
    docs = _selected(acc, year, want)
    if not docs:
        raise Refused(NOTHING, 409)
    parts = _split(docs)
    if len(parts) > MAX_PARTS:
        raise Refused(mailops.coded(TOO_MANY, max=MAX_PARTS,
                                    mb=ZIP_CAP // 1048576), 409)
    return want, parts


def plan(acc, year: int, kinds) -> dict:
    """What a download of `year` in these kinds would hold (nothing is read
    from the mail server): `{year, kinds, mails, files, bytes, pinnable, parts,
    cap, plan}` - `parts` downloads when it is over the cap, `plan` the digest
    each of them must name."""
    want, parts = _planned(acc, year, kinds)
    docs = [d for p in parts for d in p]
    return {"year": year, "kinds": want, "mails": len(docs),
            "files": sum(len(d["files"]) for d in docs),
            "bytes": sum(_weight(d) for d in docs),
            "pinnable": sum(1 for d in docs if d["m"].get("msgid")),
            "parts": len(parts), "cap": ZIP_CAP,
            "plan": _digest(year, want, parts)}


ZIP_PARALLEL = 1                # .zip builds of an account at a time
_ZIPS = _Slots()


class Built:
    """One finished download: the spooled .zip, its size, what is in it and
    what was left out. The account's place stays taken (a .zip holds up to the
    cap in a temp file) until `close()`, which the response calls when it ends
    - whether it was read to the end or the client went away."""

    def __init__(self, fh, size: int, mails: int, files: int, skipped: int,
                 pinned: int, release):
        self.fh = fh
        self.size = size
        self.mails = mails
        self.files = files
        self.skipped = skipped      # mails that could not be read now
        self.pinned = pinned        # mails kept safe in the same step
        self._release = release

    def close(self) -> None:
        """Close the temp file and give the account's place back (again and
        again is fine)."""
        try:
            self.fh.close()
        finally:
            release, self._release = self._release, None
            if release:
                release()


def index_csv(rows: list[tuple]) -> bytes:
    """The list of the .zip: date, sender, subject, file (its place in the
    .zip), amount (read from the subject only, "" when it names none). Every
    cell is made safe for a spreadsheet (a formula cannot start in one) and the
    text is UTF-8 with a byte order mark, which spreadsheets read as UTF-8."""
    buf = io.StringIO(newline="")
    w = csv.writer(buf)
    w.writerow(INDEX_HEADER)
    for row in rows:
        w.writerow(csvsafe.row(row))
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")


def _sender(m: dict) -> str:
    name, addr = (m.get("name") or "").strip(), m.get("addr") or ""
    return f"{name} <{addr}>" if name and name != addr else addr


def _fill(conn, acc, docs: list[dict], zf, lang: str, index: bool) -> tuple:
    """Write the documents into `zf` (and `index.csv`): `(files, kept mails
    [[folder, uid], ...], skipped)`. A mail that cannot be read right now is
    counted, not guessed at; a changed folder stops everything."""
    dirs = KIND_DIRS.get(lang) or KIND_DIRS["en"]
    taken: dict[str, set[str]] = {}
    rows: list[tuple] = []
    kept: list[list] = []
    skipped = files = total = 0
    selected: str | None = None
    usable = True
    for d in docs:
        m = d["m"]
        if m["folder"] != selected:
            selected = m["folder"]
            status, _ = conn.select(mailops.quote_folder(selected),
                                    readonly=True)
            usable = status == "OK"
            if usable:
                with acc.lock:
                    known = acc.folder_uv.get(selected)
                uv = mailops.uidvalidity(conn)
                if known not in (None, 0) and uv and uv != known:
                    raise Refused(CHANGED, 409)
        if not usable:
            skipped += 1
            continue
        if (m.get("size") or 0) > removefiles.MAIL_CAP:
            skipped += 1                    # not even fetched
            continue
        got = removefiles._fetch_one(conn, m["uid"])
        if got is None or len(got["raw"]) > removefiles.MAIL_CAP:
            skipped += 1
            continue
        raw = got["raw"]
        try:
            root = mimecut.parse(raw)
        except mimecut.MimeError:
            skipped += 1
            continue
        msgid = (m.get("msgid") or "").strip()
        if msgid and str(root.msg.get("Message-ID", "")).strip() != msgid:
            skipped += 1
            continue
        found, _missing = removefiles._pick_for(
            root, m, [(f["name"], f["size"]) for f in d["files"]],
            list(range(len(d["files"]))))
        if not found:
            skipped += 1
            continue
        when = time.localtime(m["ts"])
        folder = f"{dirs[d['kind']]}/{when.tm_year:04d}-{when.tm_mon:02d}"
        names = taken.setdefault(folder, set())
        stamp = when[:6] if when.tm_year >= 1980 else (1980, 1, 1, 0, 0, 0)
        try:
            # every file of the mail first: one that cannot be decoded (damaged
            # base64) leaves the whole mail out, never half of it in
            blobs = [(a, mimecut.payload(raw, a.part)) for a in found]
        except Exception:
            skipped += 1
            continue
        for a, data in blobs:
            total += len(data)
            if total > ZIP_CAP:
                raise Refused(CHANGED, 409)     # not the mails the scan saw
            path = f"{folder}/" + mimecut.safe_file_name(
                a.index_name or a.name, names, "file")
            info = zipfile.ZipInfo(path, date_time=stamp)
            info.compress_type = zipfile.ZIP_STORED
            zf.writestr(info, data)
            files += 1
            rows.append((time.strftime("%Y-%m-%d", when), _sender(m),
                         m.get("subject") or "", path,
                         amount_of(m.get("subject") or "")))
        kept.append([m["folder"], m["uid"]])
    if index:
        info = zipfile.ZipInfo(INDEX_NAME, date_time=time.localtime()[:6])
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, index_csv(rows))
    return files, kept, skipped


def build_zip(acc, year: int, kinds, part: int, parts: int, plan_id: str,
              index: bool, pin: bool, lang: str = "en") -> Built:
    """Download `part` of `parts` of the year's documents as one .zip, made
    here from the mails on the mail server (read only) with the files in
    folders by kind and month and, if asked, an `index.csv`; if asked, the mails
    that went in are pinned afterwards by the ordinary pin path. The plan the
    client holds must still be the plan of the index (`docs_changed` if a scan
    changed it meanwhile), only one .zip of an account is made at a time, and
    nothing is left on disk: the spooled file is the caller's to close.
    Raises `Refused`."""
    want, chunks = _planned(acc, year, kinds)
    if parts != len(chunks) or not 1 <= part <= len(chunks) \
            or plan_id != _digest(year, want, chunks):
        raise Refused(CHANGED, 409)
    key = (acc.tenant, acc.name)
    if not _ZIPS.take(key, ZIP_PARALLEL):
        raise Refused(BUSY, 409)
    out = tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    try:
        conn = None
        try:
            conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
            with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
                files, kept, skipped = _fill(conn, acc, chunks[part - 1], zf,
                                             lang, index)
        finally:
            if conn is not None:
                try:
                    conn.logout()
                except Exception:
                    pass
        if not kept:
            raise Refused(CHANGED, 409)         # nothing of the plan is there
        size = out.tell()
        out.seek(0)
        pinned = 0
        if pin:
            # the app's own "Protect these mails": by Message-ID, and the
            # groups' pinned counts follow
            res = mailops.set_mail_pins(kept, True, acc)
            pinned = len(kept) - res["skipped"]
        return Built(out, size, len(kept), files, skipped, pinned,
                     lambda: _ZIPS.drop(key))
    except Refused:
        out.close()
        _ZIPS.drop(key)
        raise
    except Exception as exc:
        out.close()
        _ZIPS.drop(key)
        log.warning("could not build the download: %s", type(exc).__name__)
        raise Refused(_failure(exc, acc), 502)
