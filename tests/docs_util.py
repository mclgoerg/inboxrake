"""Shared helpers for the "Your documents" tests: a mailbox of mails that read
like documents (real MIME files in a FakeIMAP, invented `.example` senders),
scanned and analysed, and the calls the page makes."""

from rmfiles_util import CRLF, analyse, b64, blob, mail, server  # noqa: F401

# (subject, [(file, size)], sender, date) - every file is real content
INVOICE = ("Invoice 2026-1187", [("invoice-2026-1187.pdf", 6000)],
           '"Northwind Invoices" <billing@northwind.example>',
           "15-Nov-2026 12:00:00 +0000")
NOVEMBER = ("Your invoice for November - 24,90 EUR",
            [("cloudbox-nov.pdf", 4000)],
            '"CloudBox" <billing@cloudbox.example>',
            "18-Nov-2026 12:00:00 +0000")
YEARLY = ("Ihre Jahresabrechnung 2025", [("jahresabrechnung.pdf", 7000)],
          '"Stadtwerke Example" <post@stadtwerke.example>',
          "03-Nov-2026 12:00:00 +0000")
POLICY = ("Your policy documents",
          [("policy.pdf", 5000), ("terms.pdf", 3000)],
          '"Insure Example" <service@insure.example>',
          "28-Oct-2026 12:00:00 +0000")
TICKETS = ("Your tickets for 14 Dec", [("tickets.pdf", 4500)],
           '"Ticketline" <orders@ticketline.example>',
           "12-Oct-2026 12:00:00 +0000")
ASSESSMENT = ("Bescheid für 2025", [("bescheid-2025.pdf", 4800)],
              '"Finanzamt Musterstadt" <post@finanzamt-musterstadt.example>',
              "02-Oct-2026 12:00:00 +0000")
OLD = ("Invoice 2025-044", [("invoice-2025-044.pdf", 5200)],
       '"Northwind Invoices" <billing@northwind.example>',
       "10-Jun-2025 12:00:00 +0000")
# not documents: a newsletter with a file, an invoice that only carries a logo
NEWSLETTER = ("Big Sale 42", [("flyer.pdf", 5000)],
              '"Shop News" <news@shop.example>',
              "20-Nov-2026 12:00:00 +0000")
LOGO_ONLY = ("Your receipt", [("logo.png", 2000)],
             '"Corner Shop" <till@cornershop.example>',
             "21-Nov-2026 12:00:00 +0000")

WORLD = [INVOICE, NOVEMBER, YEARLY, POLICY, TICKETS, ASSESSMENT, OLD,
         NEWSLETTER, LOGO_ONLY]
INBOX_UID = {s[0]: i + 1 for i, s in enumerate(WORLD)}


def msgid(uid: int) -> str:
    return f"<doc{uid}@example.example>"


def doc(uid: int, spec, **kw) -> dict:
    """The FakeIMAP mail of one spec: a real multipart mail whose files are
    `blob(uid * 10 + n, size)` bytes (so a download can be compared)."""
    subject, files, frm, date = spec
    return mail(uid, kw.pop("msgid", msgid(uid)),
                [(name, blob(uid * 10 + i, size))
                 for i, (name, size) in enumerate(files)],
                subject=subject, frm=frm, date=date, **kw)


def content(uid: int, spec, index: int = 0) -> bytes:
    """What the file `index` of the mail `uid` made of `spec` holds."""
    return blob(uid * 10 + index, spec[1][index][1])


def world(monkeypatch, specs=WORLD, archive=(), **kw):
    """A FakeIMAP with `specs` in the INBOX (uids 1..n) and `archive`
    ((uid, spec, msgid) triples) in an Archive folder; not scanned yet."""
    inbox = [doc(i + 1, s) for i, s in enumerate(specs)]
    arch = [doc(uid, s, msgid=mid) for uid, s, mid in archive]
    return server(monkeypatch, inbox, {"Archive": arch}, **kw)


def years(client) -> dict:
    """{year: summary of that year} of the page's summary."""
    got = client.get("/api/documents/summary").json()
    return {y["year"]: y for y in got["years"]}


def rows(client, year: int = 2026) -> list[dict]:
    return client.get("/api/documents", params={"year": year}).json()["rows"]


def file_body(row: dict, index: int = 0) -> dict:
    """What the page posts to download one file of a row."""
    f = row["files"][index]
    return {"folder": row["folder"], "uid": row["uid"], "name": f["name"],
            "size": f["size"]}
