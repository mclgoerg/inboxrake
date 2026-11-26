"""Shared helpers for the "keep the mail, remove the file" tests: real MIME
mails (a note, kept and removed files as base64) in a FakeIMAP, and the
steps every test starts with (scan, attachment analysis)."""

import base64
import time

from conftest import FakeIMAP, make_msg

CRLF = b"\r\n"


def blob(seed: int, n: int) -> bytes:
    """`n` bytes of content that differs per `seed`."""
    unit = bytes((seed * 31 + i) % 251 for i in range(251))
    return (unit * (n // 251 + 1))[:n]


def b64(data: bytes) -> bytes:
    return base64.encodebytes(data).replace(b"\n", CRLF)


def part(name: str, data: bytes, ctype: str = "application/pdf",
         disposition: bool = True) -> bytes:
    lines = [f'Content-Type: {ctype}; name="{name}"'.encode(),
             b"Content-Transfer-Encoding: base64"]
    if disposition:
        lines.append(f'Content-Disposition: attachment; filename="{name}"'
                     .encode())
    return CRLF.join(lines) + CRLF + CRLF + b64(data).rstrip(CRLF)


def raw_mail(msgid: str, files: list[tuple[str, bytes]],
             text: str = "Hello, the scans are attached.",
             frm: str = '"Photo Archive" <hello@photoarchive.example>',
             subject: str = "Scans from the family archive",
             top: str = "multipart/mixed", extra: bytes = b"") -> bytes:
    head = CRLF.join([
        f"From: {frm}".encode(), f"Subject: {subject}".encode(),
        f"Message-ID: {msgid}".encode(),
        b"Date: Mon, 16 Sep 2024 10:00:00 +0000", b"MIME-Version: 1.0",
        f'Content-Type: {top}; boundary="bnd"'.encode()]) + CRLF + extra
    body = (b"--bnd" + CRLF
            + b'Content-Type: text/plain; charset="utf-8"' + CRLF + CRLF
            + text.encode() + CRLF)
    for name, data in files:
        body += b"--bnd" + CRLF + part(name, data) + CRLF
    return head + CRLF + body + b"--bnd--" + CRLF


def mail(uid: int, msgid: str, files, **kw) -> dict:
    """A FakeIMAP mail with a real MIME body (`raw`): its BODYSTRUCTURE
    comes from the body, so the attachment sizes are the real ones."""
    seen = kw.pop("seen", False)
    date = kw.pop("date", None)
    frm = kw.get("frm", '"Photo Archive" <hello@photoarchive.example>')
    subject = kw.get("subject", "Scans from the family archive")
    raw = kw.pop("raw", None) or raw_mail(msgid, files, **kw)
    extra = {"date": date} if date else {}
    m = make_msg(uid, frm=frm, subject=subject, msgid=msgid, size=len(raw),
                 seen=seen, **extra)
    m["raw"] = raw
    return m


FILES = [("scan-1.pdf", blob(1, 6000)), ("scan-2.pdf", blob(2, 6000))]
KEEP = ("keep.png", blob(3, 3000))


def server(monkeypatch, mails_inbox, extra_folders=None, **kw) -> FakeIMAP:
    from backend import mailops
    folders = {"INBOX": mails_inbox, "Sent": [], "Trash": [], "Drafts": [],
               **(extra_folders or {})}
    fake = FakeIMAP(folders, **kw)
    monkeypatch.setattr(mailops, "connect",
                        lambda cfg, name=None: fake)
    return fake


def analyse(client):
    """Scan, then the attachment analysis (what the page needs)."""
    from backend import mailops
    mailops.run_scan()
    assert client.post("/api/attachments", json={}).json() == {"ok": True}
    end = time.time() + 5
    while time.time() < end:
        with mailops.STATE_LOCK:
            if mailops.STATE["atts"]["status"] != "running":
                break
        time.sleep(0.02)
    with mailops.STATE_LOCK:
        assert mailops.STATE["atts"]["status"] == "done", mailops.STATE["atts"]


def body(files, items, **kw):
    return {"items": items, "files": [{"name": n, "size": s}
                                      for n, s in files], **kw}


def listed(client):
    """{(name, size): [(folder, uid)]} of the attachment list."""
    out: dict = {}
    for m in client.get("/api/attachments").json():
        for a in m["atts"]:
            out.setdefault((a["name"], a["size"]), []).append(
                (m["folder"], m["uid"]))
    return out
