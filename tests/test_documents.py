"""Your documents: which mails are documents (Keep-safe's classes plus tax &
official), the per-year list, the one-file download and the guards of it."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auth as authmod
from backend import config as cfgmod
from backend import documents, mailops, removefiles, tenants
from backend.main import app
from docs_util import (ASSESSMENT, INBOX_UID, INVOICE, LOGO_ONLY, NEWSLETTER,
                       NOVEMBER, OLD, POLICY, TICKETS, WORLD, YEARLY,
                       analyse, content, doc, file_body, msgid, rows, server,
                       world, years)

client = TestClient(app)


def _m(subject, addr="x@sender.example", unsub=False):
    return {"subject": subject, "addr": addr, "unsub": "<u>" if unsub else ""}


# ------------------------------------------------------------ the kinds

@pytest.mark.parametrize("subject,kind", [
    # invoices & bills (Keep-safe's class)
    ("Invoice 2026-1187", "invoices"),
    ("Ihre Rechnung Nr. 4711", "invoices"),
    ("Your receipt from Corner Shop", "invoices"),
    ("Ihre Jahresabrechnung 2025", "invoices"),
    ("Kontoauszug Oktober", "invoices"),
    ("Payment received - thank you", "invoices"),
    # contracts & policies (Keep-safe's class + the contract words of the page)
    ("Terms of service update", "contracts"),
    ("Your policy documents", "contracts"),
    ("Mietvertrag: Nachtrag", "contracts"),
    ("Your service agreement", "contracts"),
    ("Versicherungsschein 2026", "contracts"),
    # bookings & tickets (Keep-safe's class)
    ("Your tickets for 14 Dec", "bookings"),
    ("Buchungsbestätigung Nr. 77", "bookings"),
    ("Your boarding pass", "bookings"),
    # tax & official (the new pattern set, EN + DE)
    ("Bescheid für 2025", "tax"),
    ("Einkommensteuerbescheid 2025", "tax"),
    ("Ihre Lohnsteuerbescheinigung", "tax"),
    ("Ihre Steuererklärung ist eingegangen", "tax"),
    ("Einkommensteuer 2025: Zahlungserinnerung", "tax"),
    ("Tax assessment notice 2025", "tax"),
    ("Your notice of assessment", "tax"),
    ("Parking fine notice", "tax"),
    ("Your W-2 for 2025", "tax"),
    ("Residence permit decision", "tax"),
    ("Anhörung zum Bußgeldbescheid", "tax"),
])
def test_what_a_subject_is(subject, kind):
    assert documents.kind_of(_m(subject)) == kind


@pytest.mark.parametrize("subject,addr,unsub", [
    ("Big Sale 42", "news@shop.example", False),
    ("This week in gadgets", "news@shop.example", True),
    ("Willkommen bei Example", "hello@sender.example", False),
    ("Your application was received", "jobs@sender.example", False),
    # a request to rate or review is none of them, whatever it names
    ("Please rate your purchase - survey", "x@sender.example", False),
    ("Wie war Ihre Rechnung? Umfrage", "x@sender.example", False),
    ("", "x@sender.example", False),
    # promotional or newsletter mail is no tax mail, whatever words it uses
    ("Steuer sparen: 20% Rabatt auf Steuerberatung", "x@sender.example",
     False),
    ("Steuerbescheid Tipps", "news@kanzlei.example", True),
    ("Bitte kurz Bescheid geben", "x@sender.example", False),
    ("How was our tax return service? Take the survey", "x@sender.example",
     False),
    ("How was your contract? Take our survey", "x@sender.example", False),
    ("Order 1099 confirmed", "x@sender.example", False),
])
def test_what_a_subject_is_not(subject, addr, unsub):
    assert documents.kind_of(_m(subject, addr, unsub)) is None


def test_the_priority_of_the_kinds():
    # the explicit invoice words win over the tax words of the same subject
    assert documents.kind_of(_m("Invoice for tax return preparation")) \
        == "invoices"
    # the contract words win over the weak bill words of an insurer's paper
    assert documents.kind_of(_m("Ihre Versicherungspolice")) == "contracts"
    assert documents.kind_of(_m("Versicherung: Beitragsrechnung")) \
        == "invoices"


def test_the_three_classes_are_the_ones_of_keep_safe():
    """A subject Keep-safe puts in invoices / bookings / contracts is the
    same kind here - the page does not read the subject differently."""
    from backend import keepsafe
    for subject, kind in [("Invoice 2026-1187", "invoices"),
                          ("Your tickets for 14 Dec", "bookings"),
                          ("Terms of service update", "contracts")]:
        assert kind in keepsafe.classes_of(subject)
        assert documents.kind_of(_m(subject)) == kind
    # keep-safe's other classes are not documents
    for subject in ("Your application was received", "Willkommen bei Example"):
        assert keepsafe.classes_of(subject)
        assert documents.kind_of(_m(subject)) is None


def test_the_tax_patterns_use_generic_words_only():
    # no company, no authority's name: the one name in the pattern is the
    # generic word for the German tax office
    words = documents.TAX_RE.pattern.lower()
    for brand in ("elster", "hmrc", "irs", "turbotax", "datev"):
        assert brand not in words


# ------------------------------------------------------------ the files

def test_the_files_of_a_mail_leave_out_logos_and_signature_files():
    m = {"atts": [{"name": "logo.png", "size": 2000},
                  {"name": "scan.jpg", "size": 300_000},
                  {"name": "invoice.pdf", "size": 90_000},
                  {"name": "smime.p7s", "size": 3000},
                  {"name": "event.ics", "size": 900},
                  {"name": "card.vcf", "size": 500}]}
    assert [f["name"] for f in documents.doc_files(m)] \
        == ["scan.jpg", "invoice.pdf"]
    # the size limit is about pictures only
    assert documents.doc_files({"atts": [{"name": "a.pdf", "size": 100}]}) \
        == [{"name": "a.pdf", "size": 100}]


# ------------------------------------------------------------ file names

def test_a_download_name_is_safe_in_the_header():
    cd = documents.content_disposition
    assert cd("invoice.pdf") \
        == "attachment; filename=\"invoice.pdf\"; filename*=UTF-8''invoice.pdf"
    for evil in ("../../etc/passwd", "..\\..\\boot.ini", "C:\\x\\y.pdf",
                 'evil"\r\nX-Injected: 1.pdf', "a\x00b.pdf", ".hidden",
                 "tab\there.pdf", "a;b=c.pdf"):
        value = cd(evil)
        assert "\r" not in value and "\n" not in value and "\x00" not in value
        head, _, ext = value.partition("; filename*=UTF-8''")
        assert head.startswith('attachment; filename="')
        assert head.count('"') == 2           # the quote cannot be broken out of
        plain = head[len('attachment; filename="'):-1]
        assert "/" not in plain and "\\" not in plain and ":" not in plain
        assert not plain.startswith(".")
        assert "%2F" not in ext and "/" not in ext
    # umlauts: an ASCII name for old clients, the real one as filename*
    value = cd("Übersicht für März.pdf")
    assert value.isascii()
    assert "%C3%9Cbersicht%20f%C3%BCr%20M%C3%A4rz.pdf" in value
    assert cd("") .startswith('attachment; filename="file"')


# ------------------------------------------------------------ the page

def _ready(monkeypatch, **kw):
    fake = world(monkeypatch, **kw)
    analyse(client)
    return fake


def test_the_years_the_tiles_and_the_rows(monkeypatch):
    _ready(monkeypatch)
    got = years(client)
    assert sorted(got) == [2025, 2026]
    y = got[2026]
    # six document mails with seven files; the newsletter and the invoice
    # that only carries a logo are none
    assert (y["mails"], y["files"]) == (6, 7)
    assert {k: (v["mails"], v["files"]) for k, v in y["kinds"].items()} == {
        "invoices": (3, 3), "contracts": (1, 2), "bookings": (1, 1),
        "tax": (1, 1)}
    assert y["bytes"] == sum(v["bytes"] for v in y["kinds"].values()) > 0
    assert (got[2025]["mails"], got[2025]["files"]) == (1, 1)
    page = client.get("/api/documents", params={"year": 2026}).json()
    assert (page["year"], page["total"], page["capped"]) == (2026, 6, False)
    # newest first
    assert [r["subject"] for r in page["rows"]] == [
        NOVEMBER[0], INVOICE[0], YEARLY[0], POLICY[0], TICKETS[0],
        ASSESSMENT[0]]
    by = {r["subject"]: r for r in page["rows"]}
    row = by[POLICY[0]]
    assert row["kind"] == "contracts"
    assert [f["name"] for f in row["files"]] == ["policy.pdf", "terms.pdf"]
    assert row["addr"] == "service@insure.example" and row["name"] \
        == "Insure Example"
    assert row["folder"] == "INBOX" and row["uid"] == INBOX_UID[POLICY[0]]
    assert (row["pinned"], row["pinnable"], row["seen"]) == (False, True, False)
    assert by[ASSESSMENT[0]]["kind"] == "tax"
    assert by[TICKETS[0]]["kind"] == "bookings"
    assert NEWSLETTER[0] not in by and LOGO_ONLY[0] not in by
    assert [r["subject"] for r in rows(client, 2025)] == [OLD[0]]
    assert rows(client, 2030) == []


def test_a_mail_in_two_folders_is_one_document(monkeypatch):
    _ready(monkeypatch, archive=[(50, INVOICE, msgid(1))])
    r = rows(client)
    assert [x["subject"] for x in r].count(INVOICE[0]) == 1
    (one,) = [x for x in r if x["subject"] == INVOICE[0]]
    assert one["folder"] == "INBOX"          # the INBOX copy is the one
    assert years(client)[2026]["mails"] == 6


def test_analyze_comes_first(monkeypatch):
    world(monkeypatch)
    got = client.get("/api/documents/summary").json()
    assert (got["scanned"], got["analyzed"], got["years"]) == (False, False, [])
    mailops.run_scan()
    got = client.get("/api/documents/summary").json()
    assert (got["scanned"], got["analyzed"], got["analyzing"]) \
        == (True, False, False)
    assert got["years"] == []
    # without the analysis no mail is known to carry a file: no rows either
    assert client.get("/api/documents", params={"year": 2026}).json() \
        == {"year": 2026, "total": 0, "capped": False, "rows": []}
    assert client.post("/api/attachments", json={}).json() == {"ok": True}
    analyse(client)
    got = client.get("/api/documents/summary").json()
    assert got["analyzed"] is True and len(got["years"]) == 2


def test_the_list_waits_for_a_running_analysis(monkeypatch):
    """Mails keep the files an earlier analysis found while a new one runs,
    but the page is only drawn from a finished analysis."""
    _ready(monkeypatch)
    assert years(client)
    acc = accountsmod.get()
    with acc.lock:
        acc.state["atts"]["status"] = "running"
    got = client.get("/api/documents/summary").json()
    assert (got["analyzed"], got["analyzing"], got["years"]) \
        == (False, True, [])
    assert client.get("/api/documents", params={"year": 2026}).json()["rows"] \
        == []
    with acc.lock:
        acc.state["atts"]["status"] = "done"
    assert years(client)


def test_the_rows_say_which_mails_are_pinned(monkeypatch):
    _ready(monkeypatch)
    uid = INBOX_UID[INVOICE[0]]
    assert client.post("/api/pin", json={"folder": "INBOX", "uid": uid,
                                         "pinned": True}).status_code == 200
    by = {r["subject"]: r for r in rows(client)}
    assert by[INVOICE[0]]["pinned"] is True
    assert by[NOVEMBER[0]]["pinned"] is False


def test_a_year_of_many_documents_is_capped(monkeypatch):
    _ready(monkeypatch)
    monkeypatch.setattr(documents, "ROWS_MAX", 2)
    page = client.get("/api/documents", params={"year": 2026}).json()
    assert (page["total"], page["capped"], len(page["rows"])) == (6, True, 2)
    assert client.get("/api/documents",
                      params={"year": 1800}).status_code == 422


def test_a_mail_without_a_date_has_no_year(monkeypatch):
    _ready(monkeypatch)
    acc = accountsmod.get()
    with acc.lock:
        for m in acc.index.values():
            if m["subject"] == INVOICE[0]:
                m["ts"] = 0
    assert INVOICE[0] not in {r["subject"] for r in rows(client)}


def test_the_page_only_reads_the_index(monkeypatch):
    fake = _ready(monkeypatch)
    before = len(fake.commands)
    years(client)
    rows(client)
    assert len(fake.commands) == before        # nothing asked of the server


# ------------------------------------------------------ one file, downloaded

def _download(row, index=0, **kw):
    return client.post("/api/documents/file", json=file_body(row, index), **kw)


def test_a_file_is_read_from_the_server_and_handed_over(monkeypatch):
    fake = _ready(monkeypatch)
    by = {r["subject"]: r for r in rows(client)}
    mark = len(fake.commands)
    r = _download(by[INVOICE[0]])
    assert r.status_code == 200
    assert r.content == content(INBOX_UID[INVOICE[0]], INVOICE)
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["content-disposition"].startswith(
        'attachment; filename="invoice-2026-1187.pdf"')
    assert r.headers["x-content-type-options"] == "nosniff"
    # the second file of a mail with two
    uid = INBOX_UID[POLICY[0]]
    second = _download(by[POLICY[0]], 1)
    assert second.content == content(uid, POLICY, 1)
    assert 'filename="terms.pdf"' in second.headers["content-disposition"]
    # reads only: read-only selects, BODY.PEEK (nothing marked read), no write
    asked = fake.commands[mark:]
    assert {c[0] for c in asked} <= {"SELECT", "UID"}
    assert all(c[2] is True for c in asked if c[0] == "SELECT")
    assert all(c[1] == "FETCH" and "BODY.PEEK[]" in c[3]
               for c in asked if c[0] == "UID")
    acc = accountsmod.get()
    with acc.lock:
        assert not any(m["seen"] for m in acc.index.values())
    assert fake.logged_out
    for m in fake.mailbox["INBOX"]:
        assert not m["seen"] and not m.get("deleted")


def test_only_what_the_page_lists_can_be_downloaded(monkeypatch):
    _ready(monkeypatch)
    by = {r["subject"]: r for r in rows(client)}
    good = file_body(by[INVOICE[0]])

    def post(**change):
        return client.post("/api/documents/file", json={**good, **change})

    assert post().status_code == 200
    # the file is named and sized like the list says, or it is not there
    r = post(size=good["size"] + 1)
    assert (r.status_code, r.json()["detail"]) == (404, "docs_gone")
    assert post(name="other.pdf").status_code == 404
    assert post(name=good["name"].upper()).status_code == 200   # case only
    # another mail, another folder, no such mail
    assert post(uid=999).status_code == 404
    assert post(folder="Archive").status_code == 404
    assert post(folder="Nowhere").status_code == 404
    # a mail with a file that is no document (a newsletter), or a file that is
    # no document file (a logo): not served, though the mail has the file
    for spec in (NEWSLETTER, LOGO_ONLY):
        uid = INBOX_UID[spec[0]]
        acc = accountsmod.get()
        with acc.lock:
            atts = acc.index[mailops.ikey("INBOX", uid)]["atts"]
        r = client.post("/api/documents/file", json={
            "folder": "INBOX", "uid": uid, "name": atts[0]["name"],
            "size": atts[0]["size"]})
        assert (r.status_code, r.json()["detail"]) == (404, "docs_gone")
    # a malformed request is a 422, not a read
    for bad in ({"name": ""}, {"uid": -1}, {"size": -5}):
        assert post(**bad).status_code == 422


def test_an_unknown_account_is_refused_everywhere(monkeypatch):
    _ready(monkeypatch)
    by = {r["subject"]: r for r in rows(client)}
    body = file_body(by[INVOICE[0]])
    assert client.post("/api/documents/file?account=nope",
                       json=body).status_code == 400
    assert client.get("/api/documents/summary?account=nope").status_code == 400
    assert client.get("/api/documents?year=2026&account=nope"
                      ).status_code == 400


def test_a_scan_that_has_not_run_is_refused_by_code(monkeypatch):
    world(monkeypatch)
    r = client.post("/api/documents/file", json={
        "folder": "INBOX", "uid": 1, "name": "a.pdf", "size": 1})
    assert (r.status_code, r.json()["detail"]) == (409, "docs_not_scanned")


def test_the_mail_on_the_server_must_be_the_one_the_scan_saw(monkeypatch):
    fake = _ready(monkeypatch)
    by = {r["subject"]: r for r in rows(client)}
    body = file_body(by[INVOICE[0]])
    uid = INBOX_UID[INVOICE[0]]
    # the folder was renumbered: a UID may now be another mail
    fake.uv["INBOX"] = 2
    r = client.post("/api/documents/file", json=body)
    assert (r.status_code, r.json()["detail"]) == (409, "docs_changed")
    fake.uv["INBOX"] = 1
    assert client.post("/api/documents/file", json=body).status_code == 200
    # the same UID holds another mail (another Message-ID) with that file
    mail = next(m for m in fake.mailbox["INBOX"] if m["uid"] == uid)
    mail["raw"] = mail["raw"].replace(
        msgid(uid).encode(), b"<replaced@example.example>")
    r = client.post("/api/documents/file", json=body)
    assert (r.status_code, r.json()["detail"]) == (409, "docs_changed")
    # the mail is gone from the server
    fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                             if m["uid"] != uid]
    assert client.post("/api/documents/file", json=body).status_code == 404


def test_a_mail_over_the_read_cap_is_refused_before_it_is_read(monkeypatch):
    fake = _ready(monkeypatch)
    by = {r["subject"]: r for r in rows(client)}
    mark = len(fake.commands)
    monkeypatch.setattr(removefiles, "MAIL_CAP", 1000)
    r = client.post("/api/documents/file", json=file_body(by[INVOICE[0]]))
    assert r.status_code == 409 and r.json()["detail"].startswith("docs_too_big")
    assert len(fake.commands) == mark            # not even asked


def test_a_server_failure_is_a_code_never_its_text(monkeypatch):
    fake = _ready(monkeypatch)
    by = {r["subject"]: r for r in rows(client)}

    def boom(*a, **k):
        raise OSError("secret-host.internal refused the connection")
    monkeypatch.setattr(mailops, "connect", boom)
    r = client.post("/api/documents/file", json=file_body(by[INVOICE[0]]))
    assert (r.status_code, r.json()["detail"]) == (502, "docs_failed")
    assert "secret-host" not in r.text
    # a well-known connection failure keeps its own code
    import socket

    def unknown_host(*a, **k):
        raise socket.gaierror("secret-host.internal")
    monkeypatch.setattr(mailops, "connect", unknown_host)
    r = client.post("/api/documents/file", json=file_body(by[INVOICE[0]]))
    assert r.status_code == 502 and "secret-host" not in r.text
    assert r.json()["detail"].startswith("host_not_found")


def test_a_file_that_cannot_be_decoded_is_a_failure_not_a_crash(monkeypatch):
    from docs_util import CRLF, b64, blob
    spec = ("Invoice 7", [("broken.pdf", 3000)], INVOICE[2], INVOICE[3])
    m = doc(1, spec)
    good = b64(blob(10, 3000)).rstrip(CRLF)
    assert good in m["raw"]
    m["raw"] = m["raw"].replace(good, b"QUJDA")        # 5 characters: damaged
    m["size"] = len(m["raw"])
    server(monkeypatch, [m], {"Archive": []})
    analyse(client)
    (row,) = rows(client)
    r = client.post("/api/documents/file", json=file_body(row))
    assert (r.status_code, r.json()["detail"]) == (502, "docs_failed")


def test_a_hostile_file_name_is_made_safe(monkeypatch):
    # "../Übersicht für März.pdf" as a mail carries it (RFC 2047)
    coded_name = "=?utf-8?B?Li4vw5xiZXJzaWNodCBmw7xyIE3DpHJ6LnBkZg==?="
    spec = ("Invoice 7", [(coded_name, 3000)],
            '"Northwind Invoices" <billing@northwind.example>',
            "15-Nov-2026 12:00:00 +0000")
    world(monkeypatch, specs=[spec])
    analyse(client)
    (row,) = rows(client)
    assert row["files"][0]["name"] == "../Übersicht für März.pdf"
    r = client.post("/api/documents/file", json=file_body(row))
    assert r.status_code == 200
    head = r.headers["content-disposition"]
    assert head.isascii() and "/" not in head
    assert 'filename="' in head and "%C3%9Cbersicht" in head
    assert r.content == content(1, spec)


# --------------------------------------------------------- tenants / accounts

ADMIN = "admin@corp.example"


def _client_as(sub):
    c = TestClient(app)
    c.cookies.set("pmc_session", authmod.make_session(sub))
    return c


def test_another_user_cannot_read_your_documents(monkeypatch):
    _ready(monkeypatch)
    by = {r["subject"]: r for r in rows(client)}
    body = file_body(by[INVOICE[0]])
    cfgmod.update_config({"auth": {
        "mode": "oidc", "admin": ADMIN,
        "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                 "client_secret": "sst"}}})
    admin, alice = _client_as(ADMIN), _client_as("alice@x.example")
    # the admin owns the workspace that was scanned
    got = admin.get("/api/documents/summary").json()
    assert got["scanned"] and len(got["years"]) == 2
    assert admin.post("/api/documents/file", json=body).status_code == 200
    # alice has a workspace of her own: nothing of it, same ids or not
    assert alice.get("/api/documents/summary").json()["years"] == []
    assert alice.get("/api/documents", params={"year": 2026}).json()["rows"] \
        == []
    r = alice.post("/api/documents/file", json=body)
    assert r.status_code in (404, 409) and r.status_code != 200
    assert r.json()["detail"] in ("docs_gone", "docs_not_scanned")
    # and an account name of someone else's workspace is no account of hers
    assert alice.post("/api/documents/file?account=proton",
                      json=body).status_code == 400
    # signed out: nothing at all
    anon = TestClient(app)
    for resp in (anon.get("/api/documents/summary"),
                 anon.get("/api/documents?year=2026"),
                 anon.post("/api/documents/file", json=body)):
        assert resp.status_code == 401


def test_the_tenant_of_the_call_decides_what_is_listed(monkeypatch):
    _ready(monkeypatch)
    assert years(client)
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        acc = accountsmod.get()
        assert documents.summary(acc)["years"] == []
        with pytest.raises(documents.Refused) as e:
            documents.read_file(acc, "INBOX", 1, "invoice-2026-1187.pdf", 8000)
        assert e.value.code == "docs_not_scanned"
    assert years(client)


def test_the_account_of_the_call_decides_what_is_read(monkeypatch):
    """Two accounts: the same folder and UID is another mail in each; a
    download pinned to one account reads that account's mail."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    from conftest import FakeIMAP
    a = doc(1, INVOICE)
    b = doc(1, ("Invoice 9-9999", [("other.pdf", 4000)], INVOICE[2],
                INVOICE[3]), msgid="<other@example.example>")
    fakes = {"host-one": FakeIMAP({"INBOX": [a], "Trash": []}),
             "host-two": FakeIMAP({"INBOX": [b], "Trash": []})}
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    for name in ("one", "two"):
        acc = accountsmod.get(name)
        mailops.run_scan(acc)
        mailops._run_atts(acc)
    one = client.get("/api/documents?year=2026&account=one").json()["rows"]
    two = client.get("/api/documents?year=2026&account=two").json()["rows"]
    assert [r["files"][0]["name"] for r in one] == ["invoice-2026-1187.pdf"]
    assert [r["files"][0]["name"] for r in two] == ["other.pdf"]
    ok = client.post("/api/documents/file?account=one", json=file_body(one[0]))
    assert ok.status_code == 200
    assert ok.content == content(1, INVOICE)
    # the file of account one is not a file of account two
    r = client.post("/api/documents/file?account=two", json=file_body(one[0]))
    assert (r.status_code, r.json()["detail"]) == (404, "docs_gone")
    ok = client.post("/api/documents/file?account=two", json=file_body(two[0]))
    assert ok.status_code == 200
    assert ok.content != content(1, INVOICE)
