"""Take chosen files out of a mail and leave everything else as it was.

"Keep the mail, remove the file" works on the mail's raw bytes: the MIME
tree is walked once to learn where every part starts and ends, and only the
bytes of the parts to remove are replaced by a short text note. Every other
byte - the headers (Message-ID included), the text, the files that stay, the
boundaries - is copied as it is, so the copy is the same mail minus the
chosen files and not a re-serialised one. One header line per removed file,
`X-Inboxrake-Removed`, tells the copy apart from the original (same
Message-ID) wherever the two meet: Undo, Duplicates, the reader.

Pure functions on bytes - no IMAP, no state (see removefiles.py). Mail is
hostile input: depth and part counts are capped, nothing is evaluated, a
file name never becomes a path.
"""

from __future__ import annotations

import email
import email.header
import quopri
import re
import time
import unicodedata
from dataclasses import dataclass, field
from email import policy as _policy
from email.parser import BytesParser

REMOVED_HEADER = "X-Inboxrake-Removed"
ACTION = "remove_files"        # the move job / undo step / audit entry of a removal
MAX_DEPTH = 20
MAX_PARTS = 3000
NAME_MAX = 120                 # the attachment index keeps names this long

_HEADER_END = re.compile(rb"\r?\n\r?\n")
_NAME_FIELDS = ("content-type", "content-transfer-encoding",
                "content-disposition", "content-description", "content-md5")


class MimeError(ValueError):
    """The mail's structure cannot be read with certainty (too deep, too many
    parts): nothing is removed from it."""


@dataclass
class Part:
    path: tuple[int, ...]
    start: int            # first byte of the part (its header)
    hdr_end: int          # end of the last header line, its line break included
    body: int             # first byte of the body
    end: int              # end of the body (the line break before the next
    #                       delimiter belongs to the delimiter, not to the part)
    msg: object           # the parsed header block (email.message.Message)
    ctype: str
    children: list["Part"] = field(default_factory=list)

    @property
    def multipart(self) -> bool:
        return self.ctype.startswith("multipart/")

    @property
    def size(self) -> int:
        """Octets of the (transfer-encoded) body - what BODYSTRUCTURE says."""
        return self.end - self.body


@dataclass
class Attach:
    """A part the attachment index lists: a named file or one disposed so."""
    part: Part
    name: str             # the file name as the mail states it
    index_name: str       # the name the attachment index stores for it
    size: int


# ---------------------------------------------------------------- parsing

def _header_span(raw: bytes, start: int, end: int) -> tuple[int, int]:
    """(end of the last header line, first body byte) of the part at `start`.
    A part may have no header at all (it starts with an empty line)."""
    if raw.startswith(b"\r\n", start) and start + 2 <= end:
        return start, start + 2
    if raw.startswith(b"\n", start) and start + 1 <= end:
        return start, start + 1
    m = _HEADER_END.search(raw, start, end)
    if not m:
        return end, end                      # headers only, no body
    first = 2 if raw[m.start():m.start() + 1] == b"\r" else 1
    return m.start() + first, m.end()


def _decode_header_value(value) -> str:
    try:
        return str(email.header.make_header(email.header.decode_header(
            str(value))))
    except Exception:
        return str(value)


def parse(raw: bytes) -> Part:
    """The MIME tree of `raw` with the byte range of every part. Raises
    MimeError for a structure too deep or with too many parts."""
    counter = [0]
    return _parse_part(raw, 0, len(raw), (), counter)


def _parse_part(raw: bytes, start: int, end: int, path: tuple,
                counter: list) -> Part:
    counter[0] += 1
    if len(path) > MAX_DEPTH or counter[0] > MAX_PARTS:
        raise MimeError("too deep")
    hdr_end, body = _header_span(raw, start, end)
    msg = BytesParser(policy=_policy.compat32).parsebytes(
        raw[start:hdr_end], headersonly=True)
    part = Part(path, start, hdr_end, body, end, msg, msg.get_content_type())
    boundary = msg.get_boundary() if part.multipart else None
    if boundary:
        part.children = _children(raw, part, boundary.encode("latin-1",
                                                             "replace"),
                                  counter)
    return part


def _children(raw: bytes, parent: Part, boundary: bytes,
              counter: list) -> list[Part]:
    pattern = re.compile(rb"(?:\r?\n|^)--" + re.escape(boundary)
                         + rb"(--)?[ \t]*(?=\r?\n|\Z)", re.M)
    hits = list(pattern.finditer(raw, parent.body, parent.end))
    out: list[Part] = []
    for i, hit in enumerate(hits):
        if hit.group(1):                     # the closing delimiter
            break
        # a part starts on the line after its delimiter
        first = hit.end()
        if raw.startswith(b"\r\n", first):
            first += 2
        elif raw.startswith(b"\n", first):
            first += 1
        last = hits[i + 1].start() if i + 1 < len(hits) else parent.end
        out.append(_parse_part(raw, first, max(first, last),
                               (*parent.path, len(out)), counter))
    return out


def leaves(root: Part) -> list[Part]:
    """Every part that is not a container, in order."""
    if not root.multipart or not root.children:
        return [root]
    return [leaf for child in root.children for leaf in leaves(child)]


def walk(root: Part):
    yield root
    for child in root.children:
        yield from walk(child)


def _param(msg, key: str, header: str) -> str:
    """A plain (non RFC 2231) parameter, the way a server's BODYSTRUCTURE
    reports it: `key*=` forms are not seen."""
    value = msg.get(header)
    if value is None:
        return ""
    for piece in str(value).split(";")[1:]:
        k, _, v = piece.partition("=")
        if k.strip().lower() == key:
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] == '"':
                v = v[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            return v
    return ""


def _true_name(msg) -> str:
    try:
        name = msg.get_filename()
    except Exception:
        name = None
    return _decode_header_value(name) if name else ""


def attachments(root: Part) -> list[Attach]:
    """The parts the attachment index (BODYSTRUCTURE pass) counts: a leaf
    with a body that is disposed as an attachment, or carries a file name and
    is not text."""
    out: list[Attach] = []
    for part in leaves(root):
        if part.size <= 0:
            continue
        msg = part.msg
        dispo = (msg.get_content_disposition() or "").lower() \
            if msg.get("Content-Disposition") else ""
        index_name = _param(msg, "filename", "Content-Disposition") \
            or _param(msg, "name", "Content-Type")
        true_name = _true_name(msg)
        has_name = bool(index_name or true_name)
        if dispo == "attachment" or (has_name
                                     and part.ctype.split("/")[0] != "text"):
            shown = _decode_header_value(index_name) if index_name else ""
            out.append(Attach(part, true_name or shown or "(unnamed)",
                              (shown or "(unnamed)")[:NAME_MAX], part.size))
    return out


# ----------------------------------------------------------- what to skip

def _secure_kind(part: Part, raw: bytes) -> str:
    ctype = part.ctype
    if ctype == "multipart/signed" or ctype in (
            "application/pkcs7-signature", "application/x-pkcs7-signature",
            "application/pgp-signature"):
        return "signed"
    if ctype == "multipart/encrypted" or ctype == "application/pgp-encrypted":
        return "encrypted"
    if ctype in ("application/pkcs7-mime", "application/x-pkcs7-mime"):
        kind = (part.msg.get_param("smime-type") or "").lower()
        return "signed" if kind == "signed-data" else "encrypted"
    if ctype == "text/plain" and not part.multipart:
        head = raw[part.body:min(part.end, part.body + 4096)]
        if b"-----BEGIN PGP MESSAGE-----" in head:
            return "encrypted"
        if b"-----BEGIN PGP SIGNED MESSAGE-----" in head:
            return "signed"
    return ""


def secure_kind(root: Part, raw: bytes) -> str:
    """"signed" / "encrypted" when the mail carries a signature or is
    encrypted anywhere in its tree (removing a part would break it), else "".
    Encrypted wins over signed."""
    found = ""
    for part in walk(root):
        kind = _secure_kind(part, raw)
        if kind == "encrypted":
            return kind
        found = found or kind
    return found


# ------------------------------------------------------------ choosing

def _name_matches(a: Attach, want: str) -> bool:
    want = want.casefold()
    return want in (a.name[:NAME_MAX].casefold(), a.index_name.casefold())


def pick(root: Part, files: list[tuple[str, int]],
         near: set[tuple[str, int]] | None = None
         ) -> tuple[list[Attach], list[tuple]]:
    """`(parts to remove, files not found)`: every attachment named and sized
    like one of `files` (name, size as the attachment index lists them). The
    size must be exact. Only for a file in `near` (lower-cased name, size) -
    the ones the mail itself lists once under that name - a server that counts
    a line break more or less may be stood in for by the one part of that name
    within a few bytes: never a part another request took, and never a
    different file of the mail with the same name."""
    found: list[Attach] = []
    taken: set[int] = set()
    missing: list[tuple] = []
    pool = attachments(root)
    for name, size in files:
        same = [a for a in pool if _name_matches(a, name) and a.size == size
                and id(a.part) not in taken]
        if not same and (name.lower(), size) in (near or ()):
            like = [a for a in pool if _name_matches(a, name)]
            close = [a for a in like if id(a.part) not in taken
                     and abs(a.size - size) <= max(4, size // 1000)]
            # a second part of that name makes the choice a guess: none
            same = close if len(like) == 1 else []
        if not same:
            missing.append((name, size))
        for a in same:
            taken.add(id(a.part))
            found.append(a)
    return found, missing


def find_exact(root: Part, name: str, size: int) -> list[Attach]:
    """The attachments named and sized exactly so (no tolerance): what a
    copy is checked for after a removal."""
    return [a for a in attachments(root)
            if _name_matches(a, name) and a.size == size]


# ------------------------------------------------------------- building

def _size_text(n: int) -> str:
    """The same wording as the interface's fmtSize (MB with one decimal, KB
    rounded)."""
    if n >= 1048576:
        return f"{n / 1048576:.1f} MB"
    if n >= 1024:
        return f"{round(n / 1024)} KB"
    return f"{n} B"


def _clean_name(name: str, limit: int = NAME_MAX) -> str:
    """A name safe to print: no control characters, no line breaks."""
    cleaned = "".join(" " if unicodedata.category(c) in ("Cc", "Cf", "Zl",
                                                          "Zp") else c
                      for c in name)
    return " ".join(cleaned.split())[:limit] or "(unnamed)"


NOTES = {
    "en": "{name} ({size}) was removed by Inboxrake on {date}. The original "
          "mail is in Trash until it is emptied.",
    "de": "{name} ({size}) wurde am {date} von Inboxrake entfernt. Die "
          "ursprüngliche Mail liegt im Papierkorb, bis er geleert wird.",
}


def note_text(name: str, size: int, when: time.struct_time,
              lang: str = "en") -> str:
    lang = lang if lang in NOTES else "en"
    if lang == "de":
        date = time.strftime("%d.%m.%Y", when)
        size_s = _size_text(size).replace(".", ",")
    else:
        date = time.strftime("%d %b %Y", when).lstrip("0")
        size_s = _size_text(size)
    return NOTES[lang].format(name=_clean_name(name), size=size_s, date=date)


def removed_header_line(name: str, size: int, when: time.struct_time) -> str:
    """One `X-Inboxrake-Removed` header line (no line break): version, the
    day, the size in bytes and the file name - as a quoted string when it is
    plain ASCII, else as RFC 2047 words."""
    cleaned = _clean_name(name)
    if cleaned.isascii():
        shown = '"' + cleaned.replace("\\", "\\\\").replace('"', '\\"') + '"'
    else:
        shown = email.header.Header(cleaned, "utf-8").encode(maxlinelen=998)
        shown = " ".join(shown.split())          # one line
    return (f"{REMOVED_HEADER}: v=1; date={time.strftime('%Y-%m-%d', when)}; "
            f"size={int(size)}; name={shown}")


_REMOVED_RE = re.compile(
    r"^v=1;\s*date=(?P<date>[0-9-]{10});\s*size=(?P<size>\d+);\s*name=(?P<name>.*)$",
    re.S)


def parse_removed(values) -> list[dict]:
    """`[{name, size, date}]` from the `X-Inboxrake-Removed` header values of
    a mail (a value that does not parse is ignored)."""
    out = []
    for value in values or ():
        text = " ".join(str(value).split())
        m = _REMOVED_RE.match(text)
        if not m:
            continue
        name = m.group("name").strip()
        if len(name) >= 2 and name[0] == name[-1] == '"':
            name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        else:
            name = _decode_header_value(name)
        out.append({"name": _clean_name(name), "size": int(m.group("size")),
                    "date": m.group("date")})
    return out


def removed_of(msg) -> list[dict]:
    """The removed files a parsed message (email.message.Message) records."""
    return parse_removed(msg.get_all(REMOVED_HEADER) or [])


def _nl(raw: bytes, part: Part) -> bytes:
    return b"\r\n" if b"\r\n" in raw[part.start:part.hdr_end + 2] else b"\n"


def _note_part(text: str, nl: bytes) -> bytes:
    body = quopri.encodestring(text.encode("utf-8")).replace(b"\n", nl)
    return nl.join([b'Content-Type: text/plain; charset="utf-8"',
                    b"Content-Transfer-Encoding: quoted-printable",
                    b"Content-Disposition: inline", b"", body.rstrip(nl)])


def _logical_headers(block: bytes) -> list[tuple[str, bytes]]:
    """The header lines of `block` as (lower-case name, bytes with their
    folded continuation lines and line breaks) - concatenating the bytes
    gives the block back."""
    out: list[tuple[str, bytes]] = []
    for line in block.splitlines(keepends=True):
        if line[:1] in (b" ", b"\t") and out:
            out[-1] = (out[-1][0], out[-1][1] + line)
        else:
            name = line.split(b":", 1)[0].strip().decode("latin-1").lower()
            out.append((name, line))
    return out


def build_copy(raw: bytes, root: Part, remove: list[Attach], notes: list[str],
               header_lines: list[str]) -> bytes:
    """The mail without the files of `remove`: each one's part (header and
    body) is replaced by the matching entry of `notes` as a text part, the
    rest is copied untouched, and `header_lines` are added to the top-level
    header. Nothing is removed from a mail that is not multipart unless the
    file is the whole mail - then its content headers become the note's."""
    nl = _nl(raw, root)
    added = b"".join(line.encode("ascii", "replace") + nl
                     for line in header_lines)
    if not remove:
        raise MimeError("nothing to remove")
    if any(a.part is root for a in remove):
        # the file IS the mail: only the content headers change
        keep = b"".join(b for name, b in _logical_headers(
            raw[root.start:root.hdr_end]) if name not in _NAME_FIELDS)
        if keep and not keep.endswith(b"\n"):
            keep += nl
        note = _note_part(notes[0], nl)
        head, _, body = note.partition(nl + nl)
        return keep + added + head + nl + nl + body
    edits = sorted(zip((a.part for a in remove), notes),
                   key=lambda e: e[0].start)
    out = bytearray()
    pos = 0
    for part, note in edits:
        if part.start < pos:
            raise MimeError("overlapping parts")
        out += raw[pos:part.start]
        out += _note_part(note, _nl(raw, part))
        pos = part.end
    out += raw[pos:]
    # the top-level header grows at its end, before the empty line (every
    # edit lies behind it, so its offset is the same in the copy)
    at = root.hdr_end
    if at > root.start and out[at - 1:at] != b"\n":
        out[at:at] = nl
        at += len(nl)
    out[at:at] = added
    return bytes(out)


# --------------------------------------------------------------- decoding

def payload(raw: bytes, part: Part) -> bytes:
    """The decoded content of a part (base64 / quoted-printable undone)."""
    enc = str(part.msg.get("Content-Transfer-Encoding", "")).strip().lower()
    body = raw[part.body:part.end]
    if enc == "base64":
        import binascii
        try:
            return binascii.a2b_base64(body)
        except binascii.Error:
            # a stray character or missing padding: the alphabet only
            clean = re.sub(rb"[^A-Za-z0-9+/]", b"", body)
            clean += b"=" * (-len(clean) % 4)
            return binascii.a2b_base64(clean)
    if enc == "quoted-printable":
        return quopri.decodestring(body)
    return bytes(body)


def digest_map(raw: bytes, root: Part) -> dict[tuple, bytes]:
    """`{part path: decoded content}` of every leaf: what a copy is checked
    against (text with its line breaks normalised, a server may change
    them)."""
    out = {}
    for leaf in leaves(root):
        data = payload(raw, leaf)
        if leaf.ctype.startswith("text/"):
            data = data.replace(b"\r\n", b"\n")
        out[leaf.path] = data
    return out


# -------------------------------------------------------------- zip names

_BAD = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')


def safe_file_name(name: str, taken: set[str], fallback: str = "file") -> str:
    """A file name for a zip entry: no path (`/`, `\\`, drive letters,
    `..`), no control or reserved characters, no leading dots, at most 120
    characters with its extension kept, and unique among `taken` (which it
    joins): `a.pdf`, `a (2).pdf`."""
    base = _clean_name(name or "", 1000)
    base = _BAD.sub("_", base).strip(" .")
    while base.startswith("."):
        base = base[1:]
    if not base or base == "(unnamed)":
        base = fallback
    stem, dot, ext = base.rpartition(".")
    if not dot or not stem:
        stem, ext = base, ""
    else:
        ext = "." + ext[:16]
    stem = stem[:max(1, NAME_MAX - len(ext))]
    candidate, n = stem + ext, 1
    while candidate.casefold() in taken:
        n += 1
        candidate = f"{stem} ({n}){ext}"
    taken.add(candidate.casefold())
    return candidate
