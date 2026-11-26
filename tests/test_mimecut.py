"""mimecut: taking files out of a mail's bytes and leaving the rest as it was."""

import email
import time

import pytest

from backend import mailops, mimecut
from rmfiles_util import CRLF, FILES, KEEP, b64, blob, part, raw_mail

WHEN = time.gmtime(1_700_000_000)          # 14 Nov 2023


def _cut(raw, files, lang="en"):
    root = mimecut.parse(raw)
    found, missing = mimecut.pick(root, files)
    notes = [mimecut.note_text(a.name, a.size, WHEN, lang) for a in found]
    lines = [mimecut.removed_header_line(a.name, a.size, WHEN) for a in found]
    return root, found, missing, mimecut.build_copy(raw, root, found, notes,
                                                    lines)


def _sizes(files):
    return [(n, len(b64(d).rstrip(CRLF))) for n, d in files]


def test_the_parts_and_their_byte_ranges():
    raw = raw_mail("<a@x.example>", [*FILES, KEEP])
    root = mimecut.parse(raw)
    assert root.ctype == "multipart/mixed" and len(root.children) == 4
    assert [c.ctype for c in root.children] == [
        "text/plain", "application/pdf", "application/pdf", "application/pdf"]
    for child in root.children:
        # a part is its own header + body and nothing of the delimiters
        assert not raw[child.start:child.end].startswith(b"--bnd")
        assert not raw[child.start:child.end].endswith(b"--")
    assert [a.name for a in mimecut.attachments(root)] == [
        "scan-1.pdf", "scan-2.pdf", "keep.png"]


def test_attachment_rule_is_the_one_of_the_attachment_index():
    """The same mail through BODYSTRUCTURE and through mimecut: the same
    names and sizes (that is how a chosen file is found again)."""
    from conftest import FakeIMAP
    raw = raw_mail("<a@x.example>", [*FILES, KEEP], text="x")
    root = mimecut.parse(raw)
    out: list = []
    parsed = mailops._bs_parse(mailops._bs_tokenize(
        FakeIMAP._bs_of_raw(raw).encode()))
    mailops._bs_attachments(parsed[0], out)
    assert [(a["name"], a["size"]) for a in out] == [
        (a.name, a.size) for a in mimecut.attachments(root)]
    assert [a.size for a in mimecut.attachments(root)] == [
        s for _, s in _sizes([*FILES, KEEP])]


def test_the_copy_is_the_mail_minus_the_chosen_files_and_nothing_else():
    raw = raw_mail("<a@x.example>", [*FILES, KEEP])
    root, found, missing, new = _cut(raw, _sizes(FILES[:1]))
    assert missing == [] and [a.name for a in found] == ["scan-1.pdf"]
    first = root.children[1]
    # every byte outside the removed part and the added lines is as it was
    head = raw[:root.hdr_end]
    assert new.startswith(head)
    tail = raw[first.end:]
    assert new.endswith(tail)
    middle = new[len(head):len(new) - len(tail)]
    assert middle.startswith(b"X-Inboxrake-Removed: v=1; date=2023-11-14;")
    # the note stands where the file was, with its delimiters around it
    size = mimecut._size_text(_sizes(FILES[:1])[0][1]).encode()
    assert b"scan-1.pdf (" + size + b") was removed by Inboxrake on 14 Nov " \
        b"2023" in new.replace(b"=\r\n", b"")
    again = mimecut.parse(new)
    assert [a.name for a in mimecut.attachments(again)] == [
        "scan-2.pdf", "keep.png"]
    # the kept files and the text are byte for byte the same
    for i in (0, 2, 3):
        assert mimecut.payload(raw, root.children[i]) \
            == mimecut.payload(new, again.children[i])
    assert [a.part.path for a in mimecut.attachments(again)] == [(2,), (3,)]


def test_every_header_and_the_message_id_survive_with_one_added():
    raw = raw_mail("<a@x.example>", FILES, extra=b"X-Custom: 1" + CRLF)
    _, _, _, new = _cut(raw, _sizes(FILES))
    old = email.message_from_bytes(raw)
    got = email.message_from_bytes(new)
    for key in old.keys():
        assert got.get_all(key) == old.get_all(key)
    assert got["Message-ID"] == "<a@x.example>"
    assert len(got.get_all(mimecut.REMOVED_HEADER)) == 2     # a line per file
    assert [r["name"] for r in mimecut.removed_of(got)] == [
        "scan-1.pdf", "scan-2.pdf"]
    assert {r["size"] for r in mimecut.removed_of(got)} == {
        s for _, s in _sizes(FILES)}


def test_lf_only_mail_stays_lf_only():
    raw = raw_mail("<a@x.example>", FILES).replace(CRLF, b"\n")
    first = mimecut.attachments(mimecut.parse(raw))[0]
    _, found, _, new = _cut(raw, [(first.name, first.size)])
    assert len(found) == 1 and b"\r" not in new


def test_a_file_that_is_the_whole_mail():
    data = blob(5, 4000)
    raw = (b"From: A <a@x.example>\r\nMessage-ID: <w@x.example>\r\n"
           b"Subject: s\r\nContent-Type: application/pdf; name=\"w.pdf\"\r\n"
           b"Content-Transfer-Encoding: base64\r\n"
           b"Content-Disposition: attachment; filename=\"w.pdf\"\r\n\r\n"
           + b64(data))
    root = mimecut.parse(raw)
    found, _ = mimecut.pick(root, [("w.pdf", root.size)])
    new = mimecut.build_copy(raw, root, found, ["w.pdf is gone"],
                             ["X-Inboxrake-Removed: v=1"])
    msg = email.message_from_bytes(new)
    assert msg["Message-ID"] == "<w@x.example>" and msg["Subject"] == "s"
    assert msg.get_content_type() == "text/plain"
    assert msg["Content-Disposition"] == "inline"
    assert "w.pdf is gone" in msg.get_payload(decode=True).decode()
    assert not mimecut.attachments(mimecut.parse(new))


def test_nested_and_inline_files():
    inner = (b"--in" + CRLF + b"Content-Type: text/html\r\n\r\n<p>hi</p>" + CRLF
             + b"--in" + CRLF + part("logo.png", blob(8, 500), "image/png",
                                     disposition=False) + CRLF
             + b"--in--" + CRLF)
    raw = (b"Message-ID: <n@x.example>\r\nMIME-Version: 1.0\r\n"
           b'Content-Type: multipart/mixed; boundary="out"\r\n\r\n'
           b"--out\r\nContent-Type: multipart/related; boundary=\"in\"\r\n\r\n"
           + inner + b"--out" + CRLF + part("a.zip", blob(9, 900),
                                            "application/zip") + CRLF
           + b"--out--" + CRLF)
    root = mimecut.parse(raw)
    assert [a.name for a in mimecut.attachments(root)] == ["logo.png", "a.zip"]
    assert [a.part.path for a in mimecut.attachments(root)] == [(0, 1), (1,)]
    atts = mimecut.attachments(root)
    _, found, _, new = _cut(raw, [(atts[0].name, atts[0].size)])
    again = mimecut.parse(new)
    assert [a.name for a in mimecut.attachments(again)] == ["a.zip"]
    assert mimecut.payload(raw, root.children[1]) \
        == mimecut.payload(new, again.children[1])


def test_exact_size_wins_and_a_missing_file_is_reported():
    raw = raw_mail("<a@x.example>", FILES)
    root = mimecut.parse(raw)
    size = _sizes(FILES)[0][1]
    found, missing = mimecut.pick(root, [("scan-1.pdf", size),
                                         ("nothere.pdf", 10),
                                         ("scan-2.pdf", size + 2)])
    assert [a.name for a in found] == ["scan-1.pdf", "scan-2.pdf"]   # +2: a CRLF
    assert missing == [("nothere.pdf", 10)]
    # a size far off is another file
    assert mimecut.pick(root, [("scan-1.pdf", size + 500)])[0] == []
    # the same name twice in a mail, only one of them the asked size
    twin = raw_mail("<t@x.example>", [("a.pdf", blob(1, 3000)),
                                       ("a.pdf", blob(2, 900))])
    r2 = mimecut.parse(twin)
    sizes = [a.size for a in mimecut.attachments(r2)]
    got, _ = mimecut.pick(r2, [("a.pdf", sizes[1])])
    assert [a.size for a in got] == [sizes[1]]


def test_the_same_file_twice_in_one_mail_goes_twice():
    raw = raw_mail("<d@x.example>", [("d.pdf", blob(1, 900)),
                                      ("d.pdf", blob(1, 900))])
    root = mimecut.parse(raw)
    size = mimecut.attachments(root)[0].size
    found, _ = mimecut.pick(root, [("d.pdf", size)])
    assert len(found) == 2


@pytest.mark.parametrize("ctype,extra,want", [
    ("multipart/signed", "", "signed"),
    ("multipart/encrypted", "", "encrypted"),
])
def test_signed_and_encrypted_mail_is_recognised(ctype, extra, want):
    raw = raw_mail("<s@x.example>", FILES, top=ctype)
    assert mimecut.secure_kind(mimecut.parse(raw), raw) == want


def test_smime_and_pgp_variants():
    def single(ctype, extra=""):
        raw = (b"Message-ID: <p@x.example>\r\nContent-Type: " + ctype.encode()
               + b"\r\n\r\n" + extra.encode())
        return mimecut.secure_kind(mimecut.parse(raw), raw)
    assert single('application/pkcs7-mime; smime-type=enveloped-data') \
        == "encrypted"
    assert single('application/pkcs7-mime; smime-type=signed-data') == "signed"
    assert single('application/x-pkcs7-mime') == "encrypted"
    assert single("text/plain", "-----BEGIN PGP MESSAGE-----\r\nabc") \
        == "encrypted"
    assert single("text/plain", "-----BEGIN PGP SIGNED MESSAGE-----\r\nabc") \
        == "signed"
    assert single("text/plain", "just text") == ""
    # a signature nested somewhere deep still counts
    deep = raw_mail("<q@x.example>", FILES).replace(
        b"--bnd--", b"--bnd\r\nContent-Type: application/pgp-signature\r\n\r\n"
        b"sig\r\n--bnd--")
    assert mimecut.secure_kind(mimecut.parse(deep), deep) == "signed"
    plain = raw_mail("<r@x.example>", FILES)
    assert mimecut.secure_kind(mimecut.parse(plain), plain) == ""


def test_a_hostile_mail_is_refused_not_followed():
    raw = b"Content-Type: multipart/mixed; boundary=\"b0\"\r\n\r\n"
    for i in range(mimecut.MAX_DEPTH + 3):
        raw += (b"--b%d\r\nContent-Type: multipart/mixed; boundary=\"b%d\"\r\n\r\n"
                % (i, i + 1))
    with pytest.raises(mimecut.MimeError):
        mimecut.parse(raw)
    wide = b"Content-Type: multipart/mixed; boundary=\"b\"\r\n\r\n" + (
        b"--b\r\nContent-Type: text/plain\r\n\r\nx\r\n"
        * (mimecut.MAX_PARTS + 5))
    with pytest.raises(mimecut.MimeError):
        mimecut.parse(wide)


def test_the_removed_header_round_trips_any_name_and_cannot_be_injected():
    for name in ['plain.pdf', 'Rechnung März 2024.pdf', 'a "quoted" b.pdf',
                 'back\\slash.pdf', '日本語.pdf']:
        line = mimecut.removed_header_line(name, 1234, WHEN)
        assert line.isascii() and "\n" not in line and "\r" not in line
        got = mimecut.parse_removed([line.split(": ", 1)[1]])
        assert got == [{"name": name, "size": 1234, "date": "2023-11-14"}]
    evil = mimecut.removed_header_line("x.pdf\r\nBcc: spy@x.example", 1, WHEN)
    assert "\n" not in evil and "\r" not in evil
    msg = email.message_from_string(evil + "\r\n\r\nbody")
    assert msg["Bcc"] is None
    assert mimecut.parse_removed(["garbage", "v=1; date=2023-11-14"]) == []


def test_the_note_names_file_size_and_date_in_the_language_asked():
    en = mimecut.note_text("a.pdf", 6_000_000, WHEN)
    assert en == ("a.pdf (5.7 MB) was removed by Inboxrake on 14 Nov 2023. "
                  "The original mail is in Trash until it is emptied.")
    de = mimecut.note_text("a.pdf", 6_000_000, WHEN, "de")
    assert de == ("a.pdf (5,7 MB) wurde am 14.11.2023 von Inboxrake entfernt. "
                  "Die ursprüngliche Mail liegt im Papierkorb, bis er "
                  "geleert wird.")
    assert mimecut.note_text("a.pdf", 5, WHEN, "xx").startswith("a.pdf (5 B)")
    assert "\n" not in mimecut.note_text("x\r\ny.pdf", 5, WHEN)


def test_safe_zip_names():
    taken: set = set()
    names = [mimecut.safe_file_name(n, taken) for n in [
        "../../etc/passwd", "/abs/path/evil.pdf", "C:\\win\\x.exe",
        "..", "", ".hidden", "a?b*c.txt", "same.pdf", "same.pdf", "SAME.pdf",
        "x" * 400 + ".pdf", "(unnamed)", "tab\tname.pdf"]]
    for n in names:
        assert "/" not in n and "\\" not in n and n not in (".", "..")
        assert not n.startswith(".") and len(n) <= mimecut.NAME_MAX + 8
        assert not any(ord(c) < 32 for c in n)
    assert names[:3] == ["_.._etc_passwd", "_abs_path_evil.pdf", "C__win_x.exe"]
    assert len({n.casefold() for n in names}) == len(names)
    assert "same.pdf" in names and "same (2).pdf" in names \
        and "SAME (3).pdf" in names
    assert names[3] == "file" and names[4] == "file (2)"
    assert names[10].endswith(".pdf")
