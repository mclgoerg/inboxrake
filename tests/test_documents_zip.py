"""Your documents, the year's .zip: the plan, the folders by kind and month, the
index.csv (formula-safe, the amount from the subject only), the safe names, the
split above the cap, the pin step, one build at a time, no temp file left, and
the tenant / account guards."""

import csv
import io
import json
import tempfile
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auth as authmod
from backend import config as cfgmod
from backend import documents, mailops, pinstore, removefiles
from backend.main import app
from conftest import FakeIMAP
from docs_util import (ASSESSMENT, INBOX_UID, INVOICE, NOVEMBER, POLICY,
                       TICKETS, YEARLY, analyse, content, doc, msgid, rows,
                       world)

client = TestClient(app)
PLAN = "/api/documents/zip/plan"
ZIP = "/api/documents/zip"
ALL = ["invoices", "contracts", "bookings", "tax"]
EN = {"invoices": "Invoices and bills", "contracts": "Contracts and policies",
      "bookings": "Bookings and tickets", "tax": "Tax and official"}


def _ready(monkeypatch, **kw):
    fake = world(monkeypatch, **kw)
    analyse(client)
    return fake


def _plan(kinds=ALL, year=2026, **kw):
    return client.post(PLAN, json={"year": year, "kinds": kinds}, **kw)


def _zip(plan, part=1, kinds=ALL, year=2026, **over):
    body = {"year": year, "kinds": kinds, "part": part, "parts": plan["parts"],
            "plan": plan["plan"], **over}
    return client.post(ZIP, json=body)


def _open(resp) -> zipfile.ZipFile:
    assert resp.status_code == 200, resp.text
    return zipfile.ZipFile(io.BytesIO(resp.content))


def _table(zf):
    raw = zf.read("index.csv")
    assert raw.startswith(b"\xef\xbb\xbf")
    return list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))


def _files(zf):
    return [n for n in zf.namelist() if n != "index.csv"]


# ---------------------------------------------------------------- the plan

def test_the_plan_counts_what_would_go_in(monkeypatch):
    _ready(monkeypatch)
    p = _plan().json()
    assert (p["year"], p["mails"], p["files"], p["parts"]) == (2026, 6, 7, 1)
    assert p["kinds"] == ALL and p["cap"] == removefiles.ZIP_CAP
    assert p["pinnable"] == 6 and p["bytes"] > 0 and p["plan"]
    only = _plan(["tax", "invoices"]).json()
    assert (only["mails"], only["files"]) == (4, 4)
    assert only["kinds"] == ["invoices", "tax"]          # the page's order
    assert only["plan"] != p["plan"]
    # asked twice, the same plan
    assert _plan().json()["plan"] == p["plan"]


def test_the_summary_says_where_a_year_splits(monkeypatch):
    _ready(monkeypatch)
    assert client.get("/api/documents/summary").json()["cap"] \
        == removefiles.ZIP_CAP


def test_a_plan_needs_a_year_with_documents_and_a_known_kind(monkeypatch):
    _ready(monkeypatch)
    r = _plan(year=2019)
    assert (r.status_code, r.json()["detail"]) == (409, "docs_nothing")
    r = _plan(["nonsense"])
    assert (r.status_code, r.json()["detail"]) == (409, "docs_nothing")
    assert client.post(PLAN, json={"year": 2026, "kinds": []}
                       ).status_code == 422
    assert client.post(PLAN, json={"year": 1800, "kinds": ALL}
                       ).status_code == 422
    # a kind that has none that year is no plan either
    assert _plan(["bookings"], year=2025).status_code == 409


def test_a_plan_needs_a_scan_and_a_known_account(monkeypatch):
    world(monkeypatch)
    r = _plan()
    assert (r.status_code, r.json()["detail"]) == (409, "docs_not_scanned")
    analyse(client)
    assert _plan(params={"account": "nope"}).status_code == 400
    assert client.post(ZIP + "?account=nope", json={
        "year": 2026, "kinds": ALL, "plan": "x"}).status_code == 400


def test_too_many_downloads_are_refused_with_the_limit(monkeypatch):
    _ready(monkeypatch)
    monkeypatch.setattr(documents, "ZIP_CAP", 9000)
    monkeypatch.setattr(documents, "MAX_PARTS", 2)
    r = _plan()
    assert r.status_code == 409
    assert r.json()["detail"] == "docs_too_many:max=2,mb=0"


# ---------------------------------------------------------- the .zip itself

def test_the_year_as_one_zip_with_folders_by_kind_and_month(monkeypatch):
    fake = _ready(monkeypatch)
    plan = _plan().json()
    mark = len(fake.commands)
    r = _zip(plan)
    zf = _open(r)
    assert r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"] \
        == 'attachment; filename="inboxrake-documents-2026.zip"'
    assert (r.headers["x-docs-mails"], r.headers["x-docs-files"],
            r.headers["x-docs-skipped"], r.headers["x-docs-pinned"]) \
        == ("6", "7", "0", "0")
    assert sorted(zf.namelist()) == sorted([
        f"{EN['invoices']}/2026-11/invoice-2026-1187.pdf",
        f"{EN['invoices']}/2026-11/cloudbox-nov.pdf",
        f"{EN['invoices']}/2026-11/jahresabrechnung.pdf",
        f"{EN['contracts']}/2026-10/policy.pdf",
        f"{EN['contracts']}/2026-10/terms.pdf",
        f"{EN['bookings']}/2026-10/tickets.pdf",
        f"{EN['tax']}/2026-10/bescheid-2025.pdf", "index.csv"])
    # every file is what the mail carried, byte for byte
    names = _files(zf)
    for spec, uid in ((INVOICE, INBOX_UID[INVOICE[0]]),
                      (POLICY, INBOX_UID[POLICY[0]])):
        for i, (fname, _size) in enumerate(spec[1]):
            (hit,) = [n for n in names if n.endswith("/" + fname)]
            assert zf.read(hit) == content(uid, spec, i)
    # the other year, the newsletter and the logo-only mail: not in it
    assert not any("2025-" in n for n in names)
    assert not any("flyer" in n or "logo" in n for n in names)
    # read only: read-only selects and BODY.PEEK fetches, nothing else
    asked = fake.commands[mark:]
    assert {c[0] for c in asked} <= {"SELECT", "UID"}
    assert all(c[2] is True for c in asked if c[0] == "SELECT")
    assert all(c[1] == "FETCH" and "BODY.PEEK[]" in c[3]
               for c in asked if c[0] == "UID")
    assert fake.logged_out
    for m in fake.mailbox["INBOX"]:
        assert not m["seen"] and not m.get("deleted")
    assert pinstore.load_account("default") == set()


def test_only_the_ticked_kinds_go_in(monkeypatch):
    _ready(monkeypatch)
    plan = _plan(["invoices", "tax"]).json()
    zf = _open(_zip(plan, kinds=["invoices", "tax"]))
    assert {n.split("/")[0] for n in zf.namelist()} \
        == {EN["invoices"], EN["tax"], "index.csv"}
    assert {r[3].split("/")[0] for r in _table(zf)[1:]} \
        == {EN["invoices"], EN["tax"]}


def test_the_folders_follow_the_language(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    zf = _open(_zip(plan, lang="de"))
    assert {n.split("/")[0] for n in zf.namelist()} == {
        "Rechnungen und Belege", "Verträge und Policen",
        "Buchungen und Tickets", "Steuern und Behörden", "index.csv"}
    # a language we do not have is English
    zf = _open(_zip(plan, lang="xx"))
    assert EN["tax"] in {n.split("/")[0] for n in zf.namelist()}


def test_the_list_is_optional(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    assert "index.csv" in _open(_zip(plan)).namelist()
    assert "index.csv" not in _open(_zip(plan, index=False)).namelist()


# ------------------------------------------------------------- the index.csv

def test_the_list_has_date_sender_subject_file_and_amount(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    table = _table(_open(_zip(plan)))
    assert table[0] == ["date", "sender", "subject", "file", "amount"]
    assert len(table) == 1 + 7
    by_subject = {r[2]: r for r in table[1:]}
    row = by_subject[INVOICE[0]]
    assert row[0] == "2026-11-15"
    assert row[1] == "Northwind Invoices <billing@northwind.example>"
    assert row[3] == f"{EN['invoices']}/2026-11/invoice-2026-1187.pdf"
    assert row[4] == ""                       # no amount in the subject
    # the amount is what the SUBJECT says, as a plain figure and a currency
    assert by_subject[NOVEMBER[0]][4] == "24.90 EUR"
    # a mail with two files has a row for each
    pol = [r for r in table[1:] if r[2] == POLICY[0]]
    assert sorted(r[3].rsplit("/", 1)[1] for r in pol) \
        == ["policy.pdf", "terms.pdf"]
    assert {r[0] for r in pol} == {"2026-10-28"}


def test_the_amount_is_never_read_from_the_mail_text_or_the_file_name(
        monkeypatch):
    spec = ("Invoice 2026-9", [("invoice 15,00 EUR.pdf", 3000)],
            '"Northwind Invoices" <billing@northwind.example>',
            "15-Nov-2026 12:00:00 +0000")
    fake = world(monkeypatch, specs=[spec])
    fake.mailbox["INBOX"][0] = doc(1, spec, text="Total due: 99,00 EUR")
    analyse(client)
    plan = _plan().json()
    (row,) = _table(_open(_zip(plan)))[1:]
    assert row[3].endswith("invoice 15,00 EUR.pdf") and row[4] == ""


@pytest.mark.parametrize("subject,amount", [
    ("Your invoice for November - 24,90 EUR", "24.90 EUR"),
    ("Rechnung über 1.234,56 €", "1234.56 EUR"),
    ("Receipt for $12.50", "12.50 USD"),
    ("Receipt for $1,234.56", "1234.56 USD"),
    ("Order 12\u00a0345 CHF", "12345 CHF"),
    ("Order 12\u202f345 CHF", "12345 CHF"),
    ("Order 12'345 CHF", "12345 CHF"),
    ("Receipt $1,234.56 and $1,234.56", "1234.56 USD"),
    ("Zahlung 49 Euro eingegangen", "49 EUR"),
    ("Betrag: 99,9 €", "99.90 EUR"),
    ("€24", "24 EUR"),
    ("Total £7.5", "7.50 GBP"),
    ("Same twice: 12,00 € / 12.00 EUR", "12.00 EUR"),
    # no currency, no amount: an invoice or order number is no amount
    ("Invoice 2026-1187", ""),
    ("Invoice #2026", ""),
    ("Order 1187 confirmed", ""),
    ("10% off", ""),
    ("Your 2026 invoice (EUR)", ""),
    ("", ""),
    # two different amounts are no answer (a wrong figure is worse than none)
    ("Refund of 12,00 € and 8,00 €", ""),
    ("Rechnung 1187 EUR 24,90", ""),
    ("€ 1234567890123456", ""),
    # a number grouped by a plain space is two numbers: no answer, never a merge
    ("Rate 2 von 3 120,00 €", ""),
    ("Rechnung KW 12 345,00 EUR", ""),
    ("Teilzahlung 1 von 4 250 €", ""),
    ("Order 12 345 CHF", ""),
    ("Total EUR 3 120,00", ""),
    ("Invoice 2026 24,90 EUR", ""),
    # R$, C$, A$, HK$ are no dollars
    ("Total R$ 12,50", ""),
    ("Total C$12.50 and A$ 3", ""),
    ("HK$ 99.00", ""),
    ("Total US $ 12.50", "12.50 USD"),
])
def test_the_amount_is_read_from_the_subject(subject, amount):
    assert documents.amount_of(subject) == amount


@pytest.mark.parametrize("cell", ["=1+1", "+1+1", "-2+3", "@SUM(1)", "\t=x",
                                  "\r=x"])
def test_a_cell_can_never_start_a_formula(cell):
    raw = documents.index_csv([("2026-01-01", cell, cell, cell, cell)])
    row = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))[1]
    assert all(c.startswith("'") for c in row[1:]), row
    assert row[0] == "2026-01-01"             # the date is ours
    # an ordinary cell is left as it is
    plain = list(csv.reader(io.StringIO(documents.index_csv(
        [("2026-01-01", "a@b.example", "Invoice 7", "x/y.pdf", "1.00 EUR")]
    ).decode("utf-8-sig"))))[1]
    assert plain == ["2026-01-01", "a@b.example", "Invoice 7", "x/y.pdf",
                     "1.00 EUR"]


def test_a_semicolon_is_no_way_into_a_formula_either():
    raw = documents.index_csv([("2026-01-01", "x;=1+1", "a;@b", "f;-1", "")])
    row = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))[1]
    assert row[1:4] == ["x;'=1+1", "a;'@b", "f;'-1"]
    # opened by a German Excel (split on ;) no part starts with a trigger
    for cell in ";".join(row).split(";"):
        assert not cell.startswith(("=", "+", "-", "@"))


def test_a_crafted_sender_or_subject_is_made_safe_in_the_real_list(
        monkeypatch):
    specs = [("=HYPERLINK(\"http://x.example\") Invoice 1",
              [("a.pdf", 3000)], '"@cmd" <billing@northwind.example>',
              "15-Nov-2026 12:00:00 +0000"),
             ("-2+3 Invoice 2", [("b.pdf", 3000)],
              '"+evil" <billing@northwind.example>',
              "16-Nov-2026 12:00:00 +0000")]
    world(monkeypatch, specs=specs)
    analyse(client)
    plan = _plan().json()
    table = _table(_open(_zip(plan)))[1:]
    assert len(table) == 2
    for row in table:
        assert row[1].startswith("'") and row[2].startswith("'")
    assert {r[1] for r in table} == {"'@cmd <billing@northwind.example>",
                                     "'+evil <billing@northwind.example>"}


# ------------------------------------------------------------- safe names

def test_file_names_in_the_zip_are_safe_and_unique(monkeypatch):
    # "../../etc\passwd: x.pdf" as a mail carries it (RFC 2047)
    coded_name = "=?utf-8?B?Li4vLi4vZXRjXHBhc3N3ZDogeC5wZGY=?="
    specs = [("Invoice 1", [(coded_name, 3000), ("a.pdf", 3000)],
              '"Northwind Invoices" <billing@northwind.example>',
              "15-Nov-2026 12:00:00 +0000"),
             ("Invoice 2", [("a.pdf", 3500), ("CON.pdf", 3000)],
              '"Northwind Invoices" <billing@northwind.example>',
              "16-Nov-2026 12:00:00 +0000")]
    world(monkeypatch, specs=specs)
    analyse(client)
    plan = _plan().json()
    zf = _open(_zip(plan))
    files = _files(zf)
    assert len(files) == 4
    for n in files:
        parts = n.split("/")
        assert not n.startswith("/") and ".." not in parts, n
        assert "\\" not in n and ":" not in n, n
        assert len(parts) == 3                # kind / month / name
    assert len({n.casefold() for n in files}) == 4
    # the same name twice in one month: the second is numbered
    names = sorted(n.rsplit("/", 1)[1] for n in files)
    assert "a.pdf" in names and "a (2).pdf" in names


# ------------------------------------------------------------ cap and split

def test_above_the_cap_the_year_comes_in_several_downloads(monkeypatch):
    _ready(monkeypatch)
    monkeypatch.setattr(documents, "ZIP_CAP", 12000)
    plan = _plan().json()
    assert plan["parts"] == 6 and plan["cap"] == 12000
    seen, rows_seen = [], []
    for part in range(1, plan["parts"] + 1):
        r = _zip(plan, part=part)
        zf = _open(r)
        assert r.headers["content-disposition"] == (
            f'attachment; filename="inboxrake-documents-2026-part-{part}'
            f'-of-6.zip"')
        files = _files(zf)
        # a part holds at most the cap (by the real bytes) and its own list
        assert sum(zf.getinfo(n).file_size for n in files) <= 12000
        assert {row[3] for row in _table(zf)[1:]} == set(files)
        seen += files
        rows_seen += _table(zf)[1:]
    # nothing twice, nothing missing: seven files, one row each
    assert len(seen) == len(set(seen)) == 7
    assert len(rows_seen) == 7
    # a plan is one plan: another part count, a part that is not there, or a
    # plan the list has since left behind are refused
    for bad in (_zip(plan, part=7), _zip({**plan, "parts": 5}),
                _zip({**plan, "plan": "0" * 24})):
        assert (bad.status_code, bad.json()["detail"]) == (409, "docs_changed")
    assert client.post(ZIP, json={"year": 2026, "kinds": ALL, "part": 0,
                                  "parts": 6, "plan": plan["plan"]}
                       ).status_code == 422


def test_a_scan_between_two_downloads_stops_the_next_one(monkeypatch):
    fake = _ready(monkeypatch)
    monkeypatch.setattr(documents, "ZIP_CAP", 12000)
    plan = _plan().json()
    assert _zip(plan, part=1).status_code == 200
    # new mail with a document arrives and the mailbox is scanned again
    fake.mailbox["INBOX"].append(doc(
        50, ("Invoice 2026-2000", [("late.pdf", 3000)], INVOICE[2],
             "20-Nov-2026 12:00:00 +0000")))
    mailops.run_scan()
    mailops._run_atts(accountsmod.get())
    r = _zip(plan, part=2)
    assert (r.status_code, r.json()["detail"]) == (409, "docs_changed")
    # a fresh plan works again
    fresh = _plan().json()
    assert fresh["plan"] != plan["plan"]
    assert _zip(fresh, part=1).status_code == 200


def test_the_cap_is_kept_by_the_real_bytes_too(monkeypatch):
    """A mail whose files turn out bigger than the plan said stops the build."""
    fake = FakeIMAP({"INBOX": [doc(1, INVOICE)]})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    mailops._run_atts(accountsmod.get())
    acc = accountsmod.get()
    docs = documents._selected(acc, 2026, ["invoices"])
    monkeypatch.setattr(documents, "ZIP_CAP", 10)
    with pytest.raises(documents.Refused) as e, \
            zipfile.ZipFile(io.BytesIO(), "w") as zf:
        documents._fill(fake, acc, docs, zf, "en", False)
    assert e.value.code == "docs_changed"


# ------------------------------------------------------------------- the pin

def test_the_mails_can_be_kept_safe_in_the_same_step(monkeypatch):
    _ready(monkeypatch)
    plan = _plan(["invoices", "tax"]).json()
    called = []
    real = mailops.set_mail_pins

    def spy(items, pinned, acc=None):
        called.append((sorted(map(tuple, items)), pinned, acc.name))
        return real(items, pinned, acc)
    monkeypatch.setattr(mailops, "set_mail_pins", spy)
    r = _zip(plan, kinds=["invoices", "tax"], pin=True)
    assert _open(r) and r.headers["x-docs-pinned"] == "4"
    # the existing path, once, for exactly the mails that went in
    mails = (INVOICE, NOVEMBER, YEARLY, ASSESSMENT)
    assert called == [(sorted(("INBOX", INBOX_UID[s[0]]) for s in mails),
                       True, "default")]
    assert pinstore.load_account("default") \
        == {msgid(INBOX_UID[s[0]]) for s in mails}
    # the page shows them as protected, the others are as they were
    by = {r["subject"]: r for r in rows(client)}
    assert by[INVOICE[0]]["pinned"] and by[ASSESSMENT[0]]["pinned"]
    assert not by[POLICY[0]]["pinned"] and not by[TICKETS[0]]["pinned"]


def test_nothing_is_pinned_unless_asked(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    assert _open(_zip(plan))
    assert pinstore.load_account("default") == set()
    assert _zip(plan, pin=False).headers["x-docs-pinned"] == "0"


def test_nothing_is_pinned_when_the_zip_cannot_be_made(monkeypatch):
    fake = _ready(monkeypatch)
    plan = _plan().json()
    fake.uv["INBOX"] = 2                      # the folder was renumbered
    r = _zip(plan, pin=True)
    assert (r.status_code, r.json()["detail"]) == (409, "docs_changed")
    assert pinstore.load_account("default") == set()


def test_each_download_of_a_split_year_pins_its_own_mails(monkeypatch):
    _ready(monkeypatch)
    monkeypatch.setattr(documents, "ZIP_CAP", 12000)
    plan = _plan().json()
    assert _zip(plan, part=1, pin=True).headers["x-docs-pinned"] == "1"
    assert len(pinstore.load_account("default")) == 1


def test_a_mail_without_a_message_id_is_in_the_zip_but_cannot_be_pinned(
        monkeypatch):
    _ready(monkeypatch)
    plan = _plan(["tax"]).json()
    acc = accountsmod.get()
    with acc.lock:
        for m in acc.index.values():
            if m["subject"] == ASSESSMENT[0]:
                m["msgid"] = ""
    # the mail on the server still has its Message-ID, the scan's record lost it
    r = _zip(plan, kinds=["tax"], pin=True)
    zf = _open(r)
    assert len(_files(zf)) == 1
    assert (r.headers["x-docs-mails"], r.headers["x-docs-pinned"]) == ("1", "0")
    assert pinstore.load_account("default") == set()


# ------------------------------------------------- what is not there any more

def test_a_mail_that_is_gone_or_changed_is_counted_and_left_out(monkeypatch):
    fake = _ready(monkeypatch)
    plan = _plan().json()
    gone = INBOX_UID[TICKETS[0]]
    fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                             if m["uid"] != gone]
    other = next(m for m in fake.mailbox["INBOX"]
                 if m["uid"] == INBOX_UID[ASSESSMENT[0]])
    other["raw"] = other["raw"].replace(
        msgid(other["uid"]).encode(), b"<replaced@example.example>")
    r = _zip(plan, pin=True)
    zf = _open(r)
    assert (r.headers["x-docs-mails"], r.headers["x-docs-skipped"],
            r.headers["x-docs-pinned"]) == ("4", "2", "4")
    assert not any("tickets" in n or "bescheid" in n for n in zf.namelist())
    assert len(_table(zf)) == 1 + 5
    # the ones that were not read were not pinned
    assert msgid(gone) not in pinstore.load_account("default")


def test_a_mail_whose_file_cannot_be_decoded_is_left_out_whole(monkeypatch):
    from docs_util import CRLF, b64, blob, server
    two = ("Invoice 8", [("good.pdf", 3000), ("broken.pdf", 3000)], INVOICE[2],
           "16-Nov-2026 12:00:00 +0000")
    bad = doc(2, two)
    broken = b64(blob(2 * 10 + 1, 3000)).rstrip(CRLF)
    assert broken in bad["raw"]
    bad["raw"] = bad["raw"].replace(broken, b"QUJDA")     # damaged base64
    bad["size"] = len(bad["raw"])
    server(monkeypatch, [doc(1, INVOICE), bad], {"Archive": []})
    analyse(client)
    plan = _plan().json()
    assert (plan["mails"], plan["files"]) == (2, 3)
    r = _zip(plan)
    zf = _open(r)
    assert (r.headers["x-docs-mails"], r.headers["x-docs-skipped"]) == ("1", "1")
    # not half of it: the good file of that mail is not in either
    assert _files(zf) == [f"{EN['invoices']}/2026-11/invoice-2026-1187.pdf"]
    assert len(_table(zf)) == 2


def test_a_mail_over_the_cap_is_counted_and_not_even_fetched(monkeypatch):
    fake = _ready(monkeypatch)
    plan = _plan(["tax", "bookings"]).json()
    acc = accountsmod.get()
    with acc.lock:
        for m in acc.index.values():
            if m["subject"] == TICKETS[0]:
                m["size"] = removefiles.MAIL_CAP + 1
    mark = len(fake.commands)
    r = _zip(plan, kinds=["tax", "bookings"])
    zf = _open(r)
    assert (r.headers["x-docs-mails"], r.headers["x-docs-skipped"]) == ("1", "1")
    assert not any("tickets" in n for n in zf.namelist())
    fetched = [c for c in fake.commands[mark:] if c[0] == "UID"]
    assert len(fetched) == 1                  # the tax mail only


def test_nothing_left_to_read_is_no_empty_zip(monkeypatch):
    fake = _ready(monkeypatch)
    plan = _plan(["tax"]).json()
    fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                             if m["uid"] != INBOX_UID[ASSESSMENT[0]]]
    r = _zip(plan, kinds=["tax"])
    assert (r.status_code, r.json()["detail"]) == (409, "docs_changed")


def test_a_failing_server_is_a_code_never_its_text(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()

    def boom(*a, **k):
        raise OSError("secret-host.internal refused the connection")
    monkeypatch.setattr(mailops, "connect", boom)
    r = _zip(plan)
    assert (r.status_code, r.json()["detail"]) == (502, "docs_failed")
    assert "secret-host" not in r.text
    assert documents._ZIPS._n == {}


# ------------------------------------------- one at a time, nothing left behind

def test_only_one_zip_of_an_account_is_made_at_a_time(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    acc = accountsmod.get()
    key = (acc.tenant, acc.name)
    seen = []
    real = documents._fill

    def fill(*a, **k):
        seen.append(dict(documents._ZIPS._n))   # marked busy while it is made
        return real(*a, **k)
    monkeypatch.setattr(documents, "_fill", fill)
    assert _open(_zip(plan))
    assert seen == [{key: 1}]
    assert documents._ZIPS._n == {}           # and free again after it
    # while one is being made a second is refused, not queued
    assert documents._ZIPS.take(key, documents.ZIP_PARALLEL)
    try:
        r = _zip(plan)
        assert (r.status_code, r.json()["detail"]) == (409, "docs_busy")
    finally:
        documents._ZIPS.drop(key)
    assert _open(_zip(plan))


def test_the_account_stays_busy_until_the_response_is_over(monkeypatch):
    """The .zip is built, but its temp file lives (and the account's place with
    it) until the response closes it - read to the end or dropped."""
    _ready(monkeypatch)
    plan = _plan().json()
    acc = accountsmod.get()
    key = (acc.tenant, acc.name)
    built = documents.build_zip(acc, 2026, ALL, 1, 1, plan["plan"], True,
                                False, "en")
    try:
        assert documents._ZIPS._n == {key: 1}
        assert not built.fh.closed
        with pytest.raises(documents.Refused) as e:
            documents.build_zip(acc, 2026, ALL, 1, 1, plan["plan"], True,
                                False, "en")
        assert e.value.code == "docs_busy"
    finally:
        built.close()
    assert built.fh.closed and documents._ZIPS._n == {}
    built.close()                             # again is fine
    assert documents._ZIPS._n == {}
    # and over HTTP: through the end of the stream, the place is free again
    assert _open(_zip(plan))
    assert documents._ZIPS._n == {}


def test_a_failed_build_releases_the_account(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    monkeypatch.setattr(documents, "_fill", lambda *a, **k: 1 / 0)
    assert _zip(plan).status_code == 502
    assert documents._ZIPS._n == {}


def test_no_temp_file_is_left_behind(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    real = tempfile.SpooledTemporaryFile
    made = []

    def spool(max_size=0, **k):
        # a tiny threshold: the .zip really goes to a temp file on disk
        fh = real(max_size=64, **k)
        made.append(fh)
        return fh
    monkeypatch.setattr(tempfile, "SpooledTemporaryFile", spool)
    assert _open(_zip(plan))                  # streamed to the end
    assert made and all(fh.closed for fh in made)
    # a build that fails closes its file too
    made.clear()
    real_fill = documents._fill
    monkeypatch.setattr(documents, "_fill", lambda *a, **k: 1 / 0)
    assert _zip(plan).status_code == 502
    assert made and all(fh.closed for fh in made)
    # and so does one that turns out to hold nothing
    made.clear()
    monkeypatch.setattr(documents, "_fill", lambda *a, **k: (0, [], 3))
    assert _zip(plan).status_code == 409
    assert made and all(fh.closed for fh in made)
    monkeypatch.setattr(documents, "_fill", real_fill)


# ------------------------------------------------------ tenants and accounts

ADMIN = "admin@corp.example"


def _client_as(sub):
    c = TestClient(app)
    c.cookies.set("pmc_session", authmod.make_session(sub))
    return c


def test_another_user_cannot_plan_or_download_your_year(monkeypatch):
    _ready(monkeypatch)
    plan = _plan().json()
    cfgmod.update_config({"auth": {
        "mode": "oidc", "admin": ADMIN,
        "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                 "client_secret": "sst"}}})
    admin, alice = _client_as(ADMIN), _client_as("alice@x.example")
    body = {"year": 2026, "kinds": ALL, "part": 1, "parts": plan["parts"],
            "plan": plan["plan"]}
    assert admin.post(PLAN, json={"year": 2026, "kinds": ALL}).json()["plan"] \
        == plan["plan"]
    assert admin.post(ZIP, json=body).status_code == 200
    for resp in (alice.post(PLAN, json={"year": 2026, "kinds": ALL}),
                 alice.post(ZIP, json=body)):
        assert resp.status_code == 409
        assert resp.json()["detail"] == "docs_not_scanned"
    assert alice.post(ZIP + "?account=proton", json=body).status_code == 400
    anon = TestClient(app)
    for resp in (anon.post(PLAN, json={"year": 2026, "kinds": ALL}),
                 anon.post(ZIP, json=body)):
        assert resp.status_code == 401


def test_a_zip_is_made_from_the_account_it_is_pinned_to(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
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
    got = {}
    for name in ("one", "two"):
        q = f"?account={name}"
        plan = client.post(PLAN + q, json={"year": 2026, "kinds": ALL}).json()
        r = client.post(ZIP + q, json={
            "year": 2026, "kinds": ALL, "part": 1, "parts": plan["parts"],
            "plan": plan["plan"], "pin": True})
        got[name] = _files(_open(r))
    assert got["one"] == [f"{EN['invoices']}/2026-11/invoice-2026-1187.pdf"]
    assert got["two"] == [f"{EN['invoices']}/2026-11/other.pdf"]
    # the pin went to the account that built the zip, each by its own Message-ID
    assert pinstore.load_account("one") == {msgid(1)}
    assert pinstore.load_account("two") == {"<other@example.example>"}
    # a plan of one account is no plan of the other
    plan_one = client.post(PLAN + "?account=one",
                           json={"year": 2026, "kinds": ALL}).json()
    r = client.post(ZIP + "?account=two", json={
        "year": 2026, "kinds": ALL, "part": 1, "parts": 1,
        "plan": plan_one["plan"]})
    assert (r.status_code, r.json()["detail"]) == (409, "docs_changed")


# ------------------------------------------------- the client goes away

def _hang_up(plan, when):
    """Run the zip's response as the server does, but hang up: at once
    (`start`: before anything of the body went out, so the stream is never
    read) or after the first chunk. (The endpoint is called directly: through
    the app's middleware a hang-up reaches the response only in a real server.)"""
    import asyncio
    from backend import main as mainmod

    response = mainmod.post_documents_zip(mainmod.DocumentZipBody(
        year=2026, kinds=ALL, part=1, parts=plan["parts"], plan=plan["plan"]),
        account=None)
    scope = {"type": "http", "asgi": {"version": "3.0"}, "method": "POST",
             "path": "/api/documents/zip", "headers": []}

    async def run():
        got_chunk = asyncio.Event()
        sent = []

        async def receive():
            if when == "first_chunk":
                await got_chunk.wait()
            return {"type": "http.disconnect"}

        async def send(msg):
            sent.append(msg["type"])
            if msg["type"] == "http.response.body" and msg.get("body"):
                got_chunk.set()
            if msg["type"] == "http.response.start":
                await asyncio.sleep(0.2)        # a slow client
        await response(scope, receive, send)
        return sent
    return asyncio.run(run())


@pytest.mark.parametrize("when", ["start", "first_chunk"])
def test_a_client_that_hangs_up_leaves_nothing_held(monkeypatch, when):
    """The temp file and the account's place are given back also when the
    response is cut off (the stream may never have been read at all)."""
    _ready(monkeypatch)
    plan = _plan().json()
    real = tempfile.SpooledTemporaryFile
    made = []

    def spool(max_size=0, **k):
        fh = real(max_size=64, **k)
        made.append(fh)
        return fh
    monkeypatch.setattr(tempfile, "SpooledTemporaryFile", spool)
    _hang_up(plan, when)
    assert made and all(fh.closed for fh in made)
    assert documents._ZIPS._n == {}
    # and the account can make the next one at once
    assert _open(_zip(plan))
