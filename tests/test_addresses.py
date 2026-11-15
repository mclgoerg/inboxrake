"""Your addresses: the receiving address the scan reads per mail (headers
only, backfilled for older index entries), its kinds, the leak rule, the
actions (retire / restore an alias, strangers to Junk, "not a leak") and the
per-tenant / per-account stores. The alias services are mocked at the
`aliasservice.request` seam - no test touches the network."""

import email
import json
import logging
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import addresses
from backend import addresspick
from backend import addressstore
from backend import aliasservice
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import secretbox
from backend import tenants
from backend.main import app

from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)

MAIN = "me@home.example"
DAY = 86400
NOW = int(time.time())


def imap_date(days_ago: float) -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(NOW - days_ago * DAY))


@pytest.fixture(autouse=True)
def main_address(monkeypatch):
    # the invented alias domain stands in for a service's public one
    monkeypatch.setattr(addresspick, "ALIAS_DOMAINS",
                        addresspick.ALIAS_DOMAINS | {"alias.example"})
    monkeypatch.setitem(cfgmod.ENV_IMAP, "user", MAIN)
    monkeypatch.setitem(cfgmod.DEFAULT_CONFIG["accounts"]["default"],
                        "user", MAIN)


def msg_of(**headers):
    lines = [f"{k.replace('_', '-')}: {v}" for k, v in headers.items()]
    return email.message_from_string("\n".join(lines) + "\n\nbody\n")


CTX = addresspick.Context(MAIN, frozenset({"mine@custom.example"}))


# ------------------------------------------------------------------ picker

@pytest.mark.parametrize("headers, want", [
    # the delivery headers win when they name something other than main
    (dict(X_Original_To="library@home.example", Delivered_To=MAIN,
          To="library@home.example"), "library@home.example"),
    (dict(Delivered_To="me+news@home.example", To="x@other.example"),
     "me+news@home.example"),
    # X-Original-To before Delivered-To
    (dict(X_Original_To="old@elsewhere.example", Delivered_To="mid@x.example"),
     "old@elsewhere.example"),
    # an alias service delivers to the real mailbox: To names the alias
    (dict(Delivered_To=MAIN, To="Shop <acme.x7k2@alias.example>"),
     "acme.x7k2@alias.example"),
    (dict(Delivered_To=MAIN, Cc="mine@custom.example"), "mine@custom.example"),
    # a tag in To while delivery only names main
    (dict(Delivered_To=MAIN, To="me+tag@home.example"), "me+tag@home.example"),
    # a lone catch-all recipient counts, one among several does not
    (dict(Delivered_To=MAIN, To="shop@home.example"), "shop@home.example"),
    (dict(Delivered_To=MAIN, To="shop@home.example, boss@home.example"), MAIN),
    # main only
    (dict(Delivered_To=MAIN, To=MAIN), MAIN),
    (dict(Delivered_To=MAIN, To="list@lists.example"), MAIN),
    # no delivery headers: a matching To / Cc, else the first To
    (dict(To="a@other.example, " + MAIN), MAIN),
    (dict(To="first@other.example, second@other.example"),
     "first@other.example"),
    (dict(Subject="no recipient"), ""),
    # quoted names, comments, mixed shapes go through the full parser
    (dict(Delivered_To=MAIN, To='"Doe, Jane" <me+x@home.example>'),
     "me+x@home.example"),
    (dict(Delivered_To=MAIN, To="Shop (promo) <acme.x7k2@alias.example>"),
     "acme.x7k2@alias.example"),
    (dict(Delivered_To=MAIN, To="Name <a@other.example>, me+tag@home.example"),
     "me+tag@home.example"),
    (dict(Delivered_To=MAIN, To="a@other.example, <me+t@home.example>"),
     "me+t@home.example"),
])
def test_receiving_address(headers, want):
    assert addresspick.receiving_address(msg_of(**headers), CTX) == want


def test_an_unreadable_header_never_raises():
    raw = ("To: Müller <me+t@home.example>\nDelivered-To: "
           + MAIN + "\n\nbody\n").encode()           # raw 8-bit, no RFC 2047
    m = email.message_from_bytes(raw)
    assert addresspick.receiving_address(m, CTX) == "me+t@home.example"

    class Broken:
        def get_all(self, name, default=None):
            raise RuntimeError("boom")
    assert addresspick.receiving_address(Broken(), CTX) == ""


def test_receiving_address_is_lower_cased_and_parsed():
    m = msg_of(Delivered_To="Me+News@Home.Example", To="x@y.example")
    assert addresspick.receiving_address(m, CTX) == "me+news@home.example"


@pytest.mark.parametrize("addr, kind", [
    (MAIN, "main"),
    ("me+news@home.example", "tag"),
    ("acme.x7k2@alias.example", "alias"),
    ("x@sub.alias.example", "alias"),
        ("mine@custom.example", "alias"),            # in the service's own list
    ("library@home.example", "catchall"),
    ("old@elsewhere.example", "other"),
    ("meX@home.example", "catchall"),            # not "me+", just another name
])
def test_address_kind(addr, kind):
    assert addresspick.address_kind(addr, CTX) == kind


def test_every_public_alias_domain_is_an_alias_domain():
    for domain in addresspick.ALIAS_DOMAINS:
        assert addresspick.address_kind(f"x@{domain}", CTX) == "alias"


def test_firefox_relay_addresses_are_aliases():
    assert addresspick.address_kind("abc123@mozmail.com", CTX) == "alias"
    m = msg_of(Delivered_To=MAIN, To="Shop <abc123@mozmail.com>")
    assert addresspick.receiving_address(m, CTX) == "abc123@mozmail.com"


def test_icloud_other_address_is_an_alias_and_freemail_has_no_catchall():
    icloud = addresspick.Context("me@icloud.com", frozenset())
    assert addresspick.address_kind("hide.x@icloud.com", icloud) == "alias"
    assert addresspick.address_kind("a@me.com", icloud) == "alias"
    gmail = addresspick.Context("me@gmail.com", frozenset())
    assert addresspick.address_kind("other@gmail.com", gmail) == "other"


def test_tag_of():
    assert addresspick.tag_of("me+news@home.example", CTX) == "news"
    assert addresspick.tag_of(MAIN, CTX) == ""


# -------------------------------------------------------------------- scan

def mail(uid, days_ago, sender, to=None, delivered=MAIN, original=None,
         name="Sender"):
    return make_msg(uid, frm=f'"{name}" <{sender}>', subject=f"Mail {uid}",
                    date=imap_date(days_ago), to=to or MAIN,
                    delivered_to=delivered, original_to=original)


def install(monkeypatch, mails, **kw):
    fake = FakeIMAP({"INBOX": mails, "Sent": [], "Trash": [], "Junk": []},
                    flags={"Junk": "\\Junk"}, **kw)
    monkeypatch.setattr(mailops, "connect", lambda im, n=None: fake)
    return fake


def scan():
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def to_of(acc=None):
    acc = acc or accountsmod.get()
    return {m["uid"]: m["to"] for m in acc.index.values()}


def test_scan_stores_the_receiving_address(monkeypatch):
    install(monkeypatch, [
        mail(1, 10, "a@shop.example"),
        mail(2, 9, "b@shop.example", to="me+news@home.example",
             delivered="me+news@home.example"),
        mail(3, 8, "c@shop.example", to="x@alias.example"),
    ])
    scan()
    assert to_of() == {1: MAIN, 2: "me+news@home.example", 3: "x@alias.example"}


def test_scan_backfills_old_records_in_the_flags_request(monkeypatch):
    fake = install(monkeypatch, [mail(1, 10, "a@shop.example"),
                                 mail(2, 9, "b@shop.example",
                                      to="me+news@home.example",
                                      delivered="me+news@home.example")])
    scan()
    acc = accountsmod.get()
    for m in acc.index.values():          # an index from before this field
        del m["to"]
    specs: list[str] = []
    real = fake.uid
    fake.uid = lambda cmd, *a: (specs.append(a[-1]) if cmd == "FETCH" else None,
                                real(cmd, *a))[1]
    scan()
    assert to_of() == {1: MAIN, 2: "me+news@home.example"}
    fetches = [s for s in specs if s.startswith("(UID FLAGS")]
    assert len(fetches) == 1 and "HEADER.FIELDS (TO CC DELIVERED-TO" in fetches[0]
    # nothing new to fetch beyond the flags once every record has `to`
    specs.clear()
    scan()
    assert specs == ["(UID FLAGS)"]


def test_backfill_keeps_flags_and_marks_unanswered_mails(monkeypatch):
    install(monkeypatch, [mail(1, 3, "a@shop.example")])
    scan()
    acc = accountsmod.get()
    for m in acc.index.values():
        del m["to"]
    fake = install(monkeypatch, [mail(1, 3, "a@shop.example")])
    fake.mailbox["INBOX"][0]["seen"] = True
    scan()
    (rec,) = acc.index.values()
    assert rec["seen"] is True and rec["to"] == MAIN


def test_role_scans_do_not_read_the_address(monkeypatch):
    fake = install(monkeypatch, [mail(1, 3, "a@shop.example")])
    fake.mailbox["Junk"] = [mail(5, 4, "j@shop.example")]
    scan()
    acc = accountsmod.get()
    conn = mailops.connect({})
    out: list = []
    mailops.scan_folder(conn, "Junk", out, lambda *a: None, acc, index={},
                        uv={})
    assert out and "to" not in out[0]


# ------------------------------------------------------------- leak report

ALIAS = "acme.x7k2@alias.example"


def alias_mail(uid, days_ago, sender, name="Sender", to=ALIAS):
    return mail(uid, days_ago, sender, to=to, name=name)


def leaked_mails(quiet_days=100, strangers=("prizes@win.example",
                                            "offer@loan.example")):
    """ACME wrote alone for `quiet_days`, then the strangers started."""
    start = 300
    mails = [alias_mail(1, start, "shop@acme.example", "ACME Store"),
             alias_mail(2, start - quiet_days + 1, "shop@acme.example",
                        "ACME Store")]
    for i, s in enumerate(strangers):
        mails.append(alias_mail(10 + i, start - quiet_days - i, s,
                                name=f"S{i}"))
        mails.append(alias_mail(20 + i, start - quiet_days - i - 3, s,
                                name=f"S{i}"))
    return mails


def report(monkeypatch, mails):
    install(monkeypatch, mails)
    scan()
    return addresses.report()


def row_of(rep, addr):
    return next(r for r in rep["addresses"] if r["address"] == addr)


def test_leak_rule(monkeypatch):
    rep = report(monkeypatch, leaked_mails())
    row = row_of(rep, ALIAS)
    assert row["kind"] == "alias" and row["status"] == "leaked"
    assert rep["leaked"] == 1
    leak = row["leak"]
    assert row["given_to"]["name"] == "ACME Store"
    assert leak["quiet_days"] >= 60
    assert {s["party"] for s in leak["strangers"]} == {"win.example",
                                                      "loan.example"}
    assert leak["stranger_mails"] == 4
    assert leak["first_stranger"]["party"] == "win.example"
    assert leak["dmarc_failed"] is None
    assert row["mails"] == 6 and row["senders"] == 3


def test_not_a_leak_before_60_days(monkeypatch):
    rep = report(monkeypatch, leaked_mails(quiet_days=59))
    row = row_of(rep, ALIAS)
    assert row["status"] == "clean" and row["leak"] is None


def test_exactly_60_days_is_a_leak(monkeypatch):
    mails = [alias_mail(1, 120, "shop@acme.example", "ACME Store"),
             alias_mail(2, 60, "a@win.example"),
             alias_mail(3, 30, "b@loan.example")]
    assert row_of(report(monkeypatch, mails), ALIAS)["status"] == "leaked"


def test_one_stranger_is_not_a_leak(monkeypatch):
    rep = report(monkeypatch, leaked_mails(strangers=("a@win.example",)))
    assert row_of(rep, ALIAS)["status"] == "clean"


def test_unrelated_means_unrelated_domains(monkeypatch):
    # two senders of ONE registrable domain (the given-to company's own
    # sub-brands, or one stranger company) are not two unrelated domains
    mails = [alias_mail(1, 200, "shop@acme.example", "ACME"),
             alias_mail(2, 20, "a@mail.win.example"),
             alias_mail(3, 10, "b@news.win.example")]
    assert row_of(report(monkeypatch, mails), ALIAS)["status"] == "clean"
    # ... and the given-to company's other hosts are related, not strangers
    mails = [alias_mail(1, 200, "shop@acme.example", "ACME"),
             alias_mail(2, 20, "a@mail.acme.example"),
             alias_mail(3, 10, "b@win.example")]
    assert row_of(report(monkeypatch, mails), ALIAS)["status"] == "clean"


def test_two_freemail_senders_are_two_parties(monkeypatch):
    mails = [alias_mail(1, 200, "shop@acme.example", "ACME"),
             alias_mail(2, 20, "a@gmail.com"),
             alias_mail(3, 10, "b@gmail.com")]
    assert row_of(report(monkeypatch, mails), ALIAS)["status"] == "leaked"


def test_main_and_plus_tags_never_leak(monkeypatch):
    mails = [mail(1, 300, "shop@acme.example")]
    for i in range(2, 8):
        mails.append(mail(i, 20 - i, f"s{i}@x{i}.example"))
    tag = "me+news@home.example"
    mails += [mail(30, 300, "n@one.example", to=tag, delivered=tag),
              mail(31, 10, "n@two.example", to=tag, delivered=tag),
              mail(32, 5, "n@three.example", to=tag, delivered=tag)]
    rep = report(monkeypatch, mails)
    main, tagged = row_of(rep, MAIN), row_of(rep, tag)
    assert main["kind"] == "main" and main["status"] == "" \
        and main["leak"] is None
    assert tagged["kind"] == "tag" and tagged["tag"] == "news" \
        and tagged["status"] == "clean" and tagged["leak"] is None
    assert rep["leaked"] == 0


def test_catch_all_can_leak_and_other_is_last_seen(monkeypatch):
    own = "library@home.example"
    mails = [mail(1, 200, "desk@library.example", to=own, delivered=own,
                  name="City Library"),
             mail(2, 20, "a@win.example", to=own, delivered=own),
             mail(3, 10, "b@loan.example", to=own, delivered=own)]
    fwd = "old@elsewhere.example"
    mails += [mail(10 + i, 3 + i, f"s{i}@n{i}.example", to=fwd, delivered=MAIN,
                   original=fwd) for i in range(4)]
    rep = report(monkeypatch, mails)
    assert row_of(rep, own)["kind"] == "catchall" \
        and row_of(rep, own)["status"] == "leaked"
    old = row_of(rep, fwd)
    assert old["kind"] == "other" and old["status"] == "last_seen" \
        and old["days_ago"] == 3 and old["leak"] is None


def test_other_addresses_need_a_few_mails(monkeypatch):
    mails = [mail(1, 5, "a@shop.example", to="x@elsewhere.example",
                  delivered=MAIN, original="x@elsewhere.example")]
    rep = report(monkeypatch, mails)
    assert all(r["address"] != "x@elsewhere.example"
               for r in rep["addresses"])


def test_same_company_marks_end_the_leak(monkeypatch):
    install(monkeypatch, leaked_mails())
    scan()
    acc = accountsmod.get()
    r = client.post("/api/addresses/related", json={"address": ALIAS})
    assert r.status_code == 200 and r.json()["previous"] == []
    assert addresses.report(acc)["leaked"] == 0
    row = row_of(addresses.report(acc), ALIAS)
    assert row["status"] == "clean" and sorted(row["related"]) \
        == ["loan.example", "win.example"]
    # Undo puts the earlier marks back
    r = client.post("/api/addresses/related",
                    json={"address": ALIAS, "undo": []})
    assert r.status_code == 200
    assert addresses.report(acc)["leaked"] == 1


def test_a_retired_alias_does_not_count_as_leaked(monkeypatch):
    install(monkeypatch, leaked_mails())
    scan()
    acc = accountsmod.get()
    addressstore.set_retired(ALIAS, "7", NOW, acc.name)
    rep = addresses.report(acc)
    assert rep["leaked"] == 0 and row_of(rep, ALIAS)["retired"] is True


def test_report_before_the_first_scan_and_unread_records(monkeypatch):
    rep = addresses.report()
    assert rep["scanned"] is False and rep["addresses"] == []
    install(monkeypatch, [mail(1, 3, "a@shop.example")])
    scan()
    for m in accountsmod.get().index.values():
        del m["to"]
    addresses._cache.clear()
    rep = addresses.report()
    assert rep["read"] == 0 and rep["mails"] == 1 and rep["addresses"] == []


def test_endpoints(monkeypatch):
    install(monkeypatch, leaked_mails())
    scan()
    assert client.get("/api/addresses/summary").json() == {
        "leaked": 1, "total": 1, "scanned": True}
    body = client.get("/api/addresses").json()
    assert body["leaked"] == 1 and body["service"]["connected"] is False
    assert client.get("/api/addresses?account=nope").status_code == 400
    r = client.post("/api/addresses/retire", json={"address": "ghost@x.example"})
    assert r.status_code == 400 and r.json()["detail"] == "alias_bad_address"


# ------------------------------------------------------------------ stores

def test_store_is_per_account_per_tenant_and_follows_renames(tmp_path):
    addressstore.set_retired("a@x.example", "1", 5, "one")
    addressstore.add_related("a@x.example", {"p.example"}, "one")
    assert addressstore.retired("two") == {}
    assert addressstore.related("two") == {}
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert addressstore.retired("one") == {}
        addressstore.set_retired("z@x.example", "9", 1, "one")
    assert set(addressstore.retired("one")) == {"a@x.example"}
    assert (alice.root / "addresses.json").is_file()
    addressstore.rename_account("one", "uno")
    assert addressstore.retired("one") == {}
    assert addressstore.related("uno") == {"a@x.example": {"p.example"}}
    addressstore._cache.clear()
    assert addressstore.retired("uno")["a@x.example"] == {"ts": 5,
                                                          "alias_id": "1"}
    addressstore.drop_account("uno")
    assert addressstore.retired("uno") == {}


def test_store_tolerates_a_corrupt_file(tmp_path):
    (tmp_path / "addresses.json").write_text('{"accounts": {"a": "x", "b": '
                                             '{"retired": {"k": 3}}}}')
    addressstore._cache.clear()
    assert addressstore.retired("a") == {} and addressstore.retired("b") == {}


def test_rename_and_delete_account_carry_the_store(monkeypatch):
    addressstore.set_retired("a@x.example", "1", 5, "default")
    r = client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "main"}})
    assert r.status_code == 200, r.text
    assert "a@x.example" in addressstore.retired("main")
    assert addressstore.retired("default") == {}


def test_reports_are_per_account(monkeypatch):
    install(monkeypatch, leaked_mails())
    scan()
    assert addresses.report()["leaked"] == 1
    other = accountsmod.get("default")
    assert addresses.report(other)["leaked"] == 1
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert addresses.report(accountsmod.get())["total"] == 0


# ------------------------------------------------------------ the client

class FakeService:
    """An in-memory alias service speaking both APIs; records the calls."""

    def __init__(self, kind, aliases=None, fail=None):
        self.kind = kind
        self.aliases = aliases if aliases is not None else {
            "acme.x7k2@alias.example": {"id": "11", "on": True},
            "old.z@alias.example": {"id": "12", "on": False}}
        self.calls: list[tuple] = []
        self.fail = fail or {}

    def __call__(self, method, url, headers, body=None):
        self.calls.append((method, url, dict(headers), body))
        for needle, outcome in self.fail.items():
            if needle in url:
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome, None
        data = json.loads(body) if body else {}
        sl = self.kind == "simplelogin"
        base = aliasservice.SERVICES[self.kind]
        assert url.startswith(base)
        path = url[len(base):]
        if method == "GET" and "aliases" in path and "domain" not in path:
            rows = [{"id": a["id"], "email": e,
                     ("enabled" if sl else "active"): a["on"]}
                    for e, a in self.aliases.items()]
            if sl:
                return 200, {"aliases": rows if "page_id=0" in path else []}
            return 200, {"data": rows}
        if sl and method == "POST" and path.endswith("/toggle"):
            for a in self.aliases.values():
                if f"/aliases/{a['id']}/" in path:
                    a["on"] = not a["on"]
                    return 200, {"enabled": a["on"]}
            return 404, None
        if sl and "/alias/random/new" in path:
            self.aliases["fresh.k1@alias.example"] = {"id": "99", "on": True}
            self.note = data.get("note")
            return 201, {"email": "fresh.k1@alias.example", "id": 99}
        if not sl and method == "DELETE" and "/active-aliases/" in path:
            for a in self.aliases.values():
                if path.endswith(f"/{a['id']}"):
                    a["on"] = False
                    return 204, None
            return 404, None
        if not sl and method == "POST" and path == "/active-aliases":
            for a in self.aliases.values():
                if a["id"] == data["id"]:
                    a["on"] = True
                    return 200, {"data": {"active": True}}
        if not sl and path == "/domain-options":
            return 200, {"data": ["one.example"],
                         "defaultAliasDomain": "addy-default.example"}
        if not sl and method == "POST" and path == "/aliases":
            self.note = data.get("description")
            self.domain = data["domain"]
            self.aliases["fresh@addy-default.example"] = {"id": "5", "on": True}
            return 201, {"data": {"email": "fresh@addy-default.example",
                                  "id": "5"}}
        raise AssertionError(f"unexpected {method} {url}")


@pytest.fixture(params=["simplelogin", "addy"])
def service(request, monkeypatch):
    fake = FakeService(request.param)
    monkeypatch.setattr(aliasservice, "request", fake)
    fake.name = request.param
    return fake


def connect_service(fake, key="sl-secret-key-123"):
    aliasservice.configure(fake.name, key)
    return aliasservice.refresh()


def test_client_lists_toggles_and_creates(service):
    st = connect_service(service)
    assert st["service"] == service.name and st["aliases"] == 2 \
        and st["error"] == "" and st["key_set"] is True
    assert aliasservice.cached_aliases() == {"acme.x7k2@alias.example",
                                             "old.z@alias.example"}
    alias = aliasservice.set_enabled("ACME.x7k2@alias.example", False)
    assert alias.on is False and service.aliases[
        "acme.x7k2@alias.example"]["on"] is False
    # already off: no call that would flip it back
    n = len(service.calls)
    aliasservice.set_enabled("acme.x7k2@alias.example", False)
    assert [c[0] for c in service.calls[n:]] == ["GET"] * (
        len(service.calls) - n)
    aliasservice.set_enabled("acme.x7k2@alias.example", True)
    assert service.aliases["acme.x7k2@alias.example"]["on"] is True
    assert aliasservice.create_alias("For ACME Store", "acme.example") \
        .endswith(("@alias.example", "@addy-default.example"))
    assert service.note == "For ACME Store"
    # the key is sent as the service wants it, only to its own host
    method, url, headers, _ = service.calls[0]
    if service.name == "simplelogin":
        assert headers["Authentication"] == "sl-secret-key-123"
        assert url.startswith("https://app.simplelogin.io/api/")
    else:
        assert headers["Authorization"] == "Bearer sl-secret-key-123"
        assert url.startswith("https://app.addy.io/api/v1/")
    with pytest.raises(aliasservice.AliasError, match="alias_not_found"):
        aliasservice.find("ghost@alias.example")


@pytest.mark.parametrize("outcome, code", [
    (401, "alias_key"), (403, "alias_key"), (404, "alias_not_found"),
    (429, "alias_http:status=429"), (500, "alias_http:status=500"),
    (TimeoutError("slow"), "alias_unreachable"),
    (OSError("no route"), "alias_unreachable"),
])
def test_client_errors_are_coded(service, outcome, code):
    aliasservice.configure(service.name, "k-123456")
    service.fail = {"aliases": outcome}
    st = aliasservice.refresh()
    assert st["error"] == code and st["aliases"] is None


def test_a_failed_refresh_keeps_the_old_list(service):
    connect_service(service)
    service.fail = {"aliases": 500}
    st = aliasservice.refresh()
    assert st["error"].startswith("alias_http") and st["aliases"] == 2
    assert "acme.x7k2@alias.example" in aliasservice.cached_aliases()


def test_the_demo_denial_is_reported_as_not_available(monkeypatch):
    from backend import demo
    monkeypatch.setattr(aliasservice, "request",
                        lambda *a, **k: (_ for _ in ()).throw(
                            demo.NotAvailableInDemo()))
    aliasservice.configure("simplelogin", "k-123456")
    assert aliasservice.refresh()["error"] == "not_in_demo"


def test_no_service_is_a_coded_refusal():
    with pytest.raises(aliasservice.AliasError, match="alias_no_service"):
        aliasservice.list_aliases()
    with pytest.raises(aliasservice.AliasError):
        aliasservice.configure("nonsense", "k")
    assert aliasservice.status()["service"] == ""


def test_redirects_are_never_followed():
    handler = aliasservice._NoRedirect()
    assert handler.redirect_request(None, None, 302, "Found", {},
                                    "https://elsewhere.example/") is None


SECRET = "sl-secret-key-123"


def test_the_key_is_never_returned_logged_or_stored_in_plain(
        service, monkeypatch, caplog, tmp_path):
    monkeypatch.setenv(secretbox.ENV_VAR, "unit-test-secret")
    caplog.set_level(logging.DEBUG)
    r = client.put("/api/alias-service", json={"service": service.name,
                                               "api_key": SECRET})
    assert r.status_code == 200
    assert r.json()["key_set"] is True and r.json()["aliases"] == 2
    service.fail = {"aliases": 500}
    client.post("/api/alias-service/refresh")
    service.fail = {"aliases": 401}
    client.post("/api/alias-service/refresh")
    for text in (client.get("/api/alias-service").text,
                 client.get("/api/addresses").text,
                 client.get("/api/config").text, caplog.text,
                 *(p.read_text() for p in tmp_path.rglob("*.json")),
                 str(auditlog.load()), json.dumps(aliasservice.status())):
        assert SECRET not in text
    stored = json.loads((tmp_path / "alias_service.json").read_text())
    assert stored["key"].startswith(secretbox.PREFIX)
    # changing nothing but the service name keeps nothing of the old key
    r = client.put("/api/alias-service", json={"service": "addy"}) \
        if service.name == "simplelogin" else \
        client.put("/api/alias-service", json={"service": "simplelogin"})
    assert r.json()["key_set"] is False


def test_the_key_can_stay_when_only_the_service_row_is_saved(service):
    connect_service(service)
    r = client.put("/api/alias-service", json={"service": service.name})
    assert r.json()["key_set"] is True


def test_the_alias_service_is_per_tenant(service):
    connect_service(service)
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert aliasservice.status()["key_set"] is False
        assert aliasservice.cached_aliases() == frozenset()
    assert aliasservice.status()["key_set"] is True


def test_disconnect_forgets_everything(service):
    connect_service(service)
    assert client.delete("/api/alias-service").json()["key_set"] is False
    assert aliasservice.cached_aliases() == frozenset()


def test_the_scan_recognises_aliases_from_the_service_list(monkeypatch,
                                                           service):
    service.aliases = {"mine@custom.example": {"id": 1, "on": True}}
    connect_service(service)
    install(monkeypatch, [mail(1, 5, "a@shop.example", to="mine@custom.example")])
    scan()
    assert to_of() == {1: "mine@custom.example"}
    assert addresses.report()["addresses"][0]["kind"] == "alias"


# ----------------------------------------------------------------- actions

def leaked_setup(monkeypatch, fake):
    fake.aliases = {ALIAS: {"id": "11", "on": True}}
    connect_service(fake)
    install(monkeypatch, leaked_mails())
    scan()


def retire(**body):
    return client.post("/api/addresses/retire",
                       json={"address": ALIAS, **body})


def test_retire_only_switches_the_alias_off(monkeypatch, service):
    leaked_setup(monkeypatch, service)
    r = retire()
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "address": ALIAS}
    assert service.aliases[ALIAS]["on"] is False
    row = row_of(addresses.report(), ALIAS)
    assert row["retired"] is True
    assert addresses.report()["leaked"] == 0
    assert [e["action"] for e in auditlog.load()["entries"]] == ["alias_retired"]
    assert not any("MOVE" in str(c) for c in service.calls)
    # nothing was moved
    assert all(m["folder"] == "INBOX" for m in accountsmod.get().index.values())


def test_retire_with_a_new_alias_and_strangers_to_junk(monkeypatch, service):
    leaked_setup(monkeypatch, service)
    fake = mailops.connect({})
    r = retire(new_alias=True, to_junk=True)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["new_alias"].startswith("fresh")
    assert out["junk"]["queued"] == 4
    assert service.note == "For ACME Store"
    wait_delete_done()
    assert {m["uid"] for m in fake.mailbox["Junk"]} == {10, 11, 20, 21}
    assert {m["uid"] for m in fake.mailbox["INBOX"]} == {1, 2}
    actions = [e["action"] for e in auditlog.load()["entries"]]
    assert "alias_retired" in actions and "alias_created" in actions


def test_retire_refused_by_the_service_changes_nothing(monkeypatch, service):
    leaked_setup(monkeypatch, service)
    service.fail = {"toggle": 500, "active-aliases": 500}
    r = retire(new_alias=True, to_junk=True)
    assert r.status_code == 502 and r.json()["detail"].startswith("alias_http")
    assert addressstore.retired("default") == {}
    assert auditlog.load()["entries"] == []


def test_a_failing_new_alias_is_reported_but_the_retire_stands(
        monkeypatch, service):
    leaked_setup(monkeypatch, service)
    service.fail = {"random/new": 500, "domain-options": 500}
    out = retire(new_alias=True).json()
    assert out["ok"] and out["new_alias_error"].startswith("alias_http")
    assert addressstore.retired("default")[ALIAS]["alias_id"] == "11"


def test_retire_without_a_service_or_for_the_wrong_address(monkeypatch):
    install(monkeypatch, leaked_mails())
    scan()
    r = retire()
    assert r.status_code == 400 and r.json()["detail"] == "alias_no_service"
    assert retire(address="x@y.example").json()["detail"] == "alias_bad_address"
    # a main address is no alias
    assert client.post("/api/addresses/retire",
                       json={"address": MAIN}).status_code == 400


def test_retire_an_alias_the_service_does_not_know(monkeypatch, service):
    leaked_setup(monkeypatch, service)
    service.aliases = {}
    r = retire()
    assert r.status_code == 400 and r.json()["detail"] == "alias_not_found"
    assert addressstore.retired("default") == {}


def test_restore_turns_the_alias_back_on(monkeypatch, service):
    leaked_setup(monkeypatch, service)
    retire()
    r = client.post("/api/addresses/restore", json={"address": ALIAS})
    assert r.status_code == 200
    assert service.aliases[ALIAS]["on"] is True
    assert addressstore.retired("default") == {}
    assert [e["action"] for e in auditlog.load()["entries"]][0] == "alias_restored"
    # only a retired address can be restored
    assert client.post("/api/addresses/restore",
                       json={"address": ALIAS}).status_code == 400


def test_strangers_to_junk_skips_protected_senders_and_pinned_mails(
        monkeypatch):
    install(monkeypatch, leaked_mails())
    scan()
    cfgmod.set_protected_many(["prizes@win.example"], True)
    acc = accountsmod.get()
    pinstore.set_pinned("<m21@shop.example>", True, acc.name)
    r = client.post("/api/addresses/strangers_to_junk",
                    json={"address": ALIAS})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "queued": 1, "skipped_protected": 2,
                        "skipped_pinned": 1}
    wait_delete_done()
    fake = mailops.connect({})
    assert {m["uid"] for m in fake.mailbox["Junk"]} == {11}


def test_strangers_to_junk_needs_a_leak_and_a_junk_folder(monkeypatch):
    install(monkeypatch, [mail(1, 3, "a@shop.example")])
    scan()
    r = client.post("/api/addresses/strangers_to_junk", json={"address": MAIN})
    assert r.status_code == 400
    fake = FakeIMAP({"INBOX": leaked_mails(), "Sent": [], "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda im, n=None: fake)
    accountsmod.get().index.clear()
    scan()
    accountsmod.get().folder_roles.pop("junk", None)
    r = client.post("/api/addresses/strangers_to_junk", json={"address": ALIAS})
    assert (r.status_code, r.json()["detail"]) == (409, "role_missing:folder=Junk")


# ------------------------------------------------- review round: robustness

def test_block_and_protect_show_at_once_not_after_the_next_scan(monkeypatch):
    install(monkeypatch, leaked_mails())
    scan()
    rep = addresses.report()                       # cached from here on
    s = {x["party"]: x for x in row_of(rep, ALIAS)["leak"]["strangers"]}
    assert s["win.example"]["blocked"] is False
    assert s["win.example"]["to_block"] == ["prizes@win.example"]
    r = client.post("/api/block", json={"grouping": "sender",
                                        "key": "prizes@win.example"})
    assert r.status_code == 200, r.text
    cfgmod.set_protected_many(["offer@loan.example"], True)
    s = {x["party"]: x for x in row_of(addresses.report(), ALIAS)
         ["leak"]["strangers"]}
    assert s["win.example"]["blocked"] is True \
        and s["win.example"]["to_block"] == []
    assert s["loan.example"]["protected"] is True \
        and s["loan.example"]["to_block"] == []
    # the endpoint answers the same (no second Block of the same sender)
    body = client.get("/api/addresses").json()
    got = {x["party"]: x for x in row_of(body, ALIAS)["leak"]["strangers"]}
    assert got["win.example"]["blocked"] is True


def test_a_stranger_keeps_all_its_sender_addresses(monkeypatch):
    mails = leaked_mails()
    for i in range(8):
        mails.append(alias_mail(100 + i, 3, f"promo{i}@win.example"))
    rep = report(monkeypatch, mails)
    s = next(x for x in row_of(rep, ALIAS)["leak"]["strangers"]
             if x["party"] == "win.example")
    assert len(s["addrs"]) == 9 and len(s["to_block"]) == 9 \
        and s["addr_total"] == 9
    # more than ten addresses: the ten most used, and the total is said
    for i in range(8, 14):
        mails.append(alias_mail(100 + i, 3, f"promo{i}@win.example"))
    addresses._cache.clear()
    accountsmod.get().index.clear()
    rep = report(monkeypatch, mails)
    s = next(x for x in row_of(rep, ALIAS)["leak"]["strangers"]
             if x["party"] == "win.example")
    assert len(s["addrs"]) == 10 and s["addr_total"] == 15


def test_connecting_the_service_after_a_scan_rereads_the_alias_mail(
        monkeypatch):
    mine = "mine@custom.example"                   # an alias on its own domain
    install(monkeypatch, [mail(1, 50, "a@shop.example", to=mine),
                          mail(2, 40, "b@shop.example", to=mine),
                          mail(3, 5, "c@shop.example")])
    scan()
    rep = addresses.report()
    assert [r["kind"] for r in rep["addresses"]] == ["main"]
    assert rep["addresses"][0]["mails"] == 3       # all three read as main
    fake = FakeService("simplelogin", {mine: {"id": "7", "on": True}})
    monkeypatch.setattr(aliasservice, "request", fake)
    r = client.put("/api/alias-service", json={"service": "simplelogin",
                                               "api_key": "k-123456"})
    assert r.status_code == 200 and r.json()["aliases"] == 1
    rep = addresses.report()
    # the mails that read as main wait for the next scan's header backfill
    assert rep["read"] == 0 and rep["mails"] == 3
    scan()
    rep = addresses.report()
    assert row_of(rep, mine)["kind"] == "alias" and row_of(rep, mine)["mails"] == 2
    assert row_of(rep, MAIN)["mails"] == 1
    # an unchanged list asks for nothing
    assert client.post("/api/alias-service/refresh").status_code == 200
    assert addresses.report()["read"] == 3


def test_one_early_stray_mail_does_not_end_the_quiet_stretch(monkeypatch):
    mails = leaked_mails(quiet_days=100)
    mails.append(alias_mail(50, 280, "typo@stray.example"))     # day 20
    row = row_of(report(monkeypatch, mails), ALIAS)
    assert row["status"] == "leaked"
    assert {s["party"] for s in row["leak"]["strangers"]} \
        == {"win.example", "loan.example"}
    # two mails of the early stranger are no stray any more
    mails.append(alias_mail(51, 270, "typo@stray.example"))
    addresses._cache.clear()
    accountsmod.get().index.clear()
    row = row_of(report(monkeypatch, mails), ALIAS)
    assert row["status"] == "clean"


@pytest.mark.parametrize("headers, want", [
    # qmail / ezmlm name the list, not you
    (dict(Delivered_To="mailing list dev@lists.example", To="dev@lists.example"),
     MAIN),
    (dict(Delivered_To=MAIN, X_Original_To="mailing list dev@lists.example"),
     MAIN),
    # a relay's own delivery address loses against one that is also a recipient
    (dict(X_Original_To="relay-7@mx.example", Delivered_To="me+news@home.example",
          To="me+news@home.example"), "me+news@home.example"),
    (dict(X_Original_To="old@elsewhere.example", Delivered_To="mid@x.example",
          To="old@elsewhere.example"), "old@elsewhere.example"),
])
def test_delivery_headers_that_are_not_you(headers, want):
    assert addresspick.receiving_address(msg_of(**headers), CTX) == want


def test_a_login_that_is_not_an_address(monkeypatch):
    monkeypatch.setitem(cfgmod.ENV_IMAP, "user", "bob")
    monkeypatch.setitem(cfgmod.DEFAULT_CONFIG["accounts"]["default"], "user",
                        "bob")
    acc = accountsmod.get()
    assert addresses.main_address(acc) == ""
    # the activity digest's recipient is the account's address
    im = {"user": "bob", "digest": {"recipient": "Bob@Home.Example"}}
    assert addresses.main_address(acc, im) == "bob@home.example"
    # else the delivery address most of the mail carries
    install(monkeypatch, [mail(i, 5 + i, "a@shop.example") for i in range(1, 5)]
            + [mail(9, 3, "b@shop.example", to="x@alias.example")])
    scan()
    assert addresses.main_address(acc) == MAIN
    rep = addresses.report()
    assert rep["main"] == MAIN and row_of(rep, MAIN)["kind"] == "main"


def test_alias_origin_and_the_via_of_a_row(monkeypatch):
    relay = addresspick.Context(MAIN, frozenset())
    assert addresspick.alias_origin("x@mozmail.com", relay) == "relay"
    icloud = addresspick.Context("me@icloud.com", frozenset())
    assert addresspick.alias_origin("x@icloud.com", icloud) == "icloud"
    assert addresspick.alias_origin("x@alias.example", relay) == "service"
    rep = report(monkeypatch, leaked_mails())
    assert row_of(rep, ALIAS)["via"] == "service"


def test_a_toggle_that_lands_the_wrong_way_is_flipped_back_or_refused(
        monkeypatch):
    calls = []

    def sl(method, url, headers, body=None):
        calls.append((method, url))
        if method == "GET" and "page_id=0" in url:
            return 200, {"aliases": [{"id": "a/b", "email": ALIAS,
                                      "enabled": True}]}
        if method == "GET":
            return 200, {"aliases": []}
        # the alias was switched off elsewhere meanwhile: the first toggle
        # turns it ON, the second off
        state = sum(1 for c in calls if c[0] == "POST") % 2 == 1
        return 200, {"enabled": state}
    monkeypatch.setattr(aliasservice, "request", sl)
    aliasservice.configure("simplelogin", "k-123456")
    assert aliasservice.set_enabled(ALIAS, False).on is False
    posts = [c for c in calls if c[0] == "POST"]
    assert len(posts) == 2 and "/aliases/a%2Fb/toggle" in posts[0][1]

    calls.clear()
    monkeypatch.setattr(aliasservice, "request", lambda m, u, h, b=None: (
        (200, {"aliases": [{"id": "1", "email": ALIAS, "enabled": True}]})
        if m == "GET" and "page_id=0" in u else
        (200, {"aliases": []}) if m == "GET" else (200, {"enabled": True})))
    with pytest.raises(aliasservice.AliasError, match="alias_http:status=409"):
        aliasservice.set_enabled(ALIAS, False)


# ------------------------------------------------------- last review notes

def _sl(aliases, toggle):
    """A SimpleLogin double: `toggle` answers the POST; `aliases` is the
    mutable list the GET returns."""
    calls = []

    def request(method, url, headers, body=None):
        calls.append(method)
        if method == "GET" and "page_id=0" in url:
            return 200, {"aliases": [dict(a) for a in aliases]}
        if method == "GET":
            return 200, {"aliases": []}
        return toggle(aliases)
    return request, calls


@pytest.mark.parametrize("answer", [{}, None, {"enabled": "yes"}])
def test_an_unreadable_toggle_answer_is_checked_not_repeated(
        monkeypatch, answer):
    aliases = [{"id": "1", "email": ALIAS, "enabled": True}]

    def toggle(rows):                    # it did switch off, but says nothing
        rows[0]["enabled"] = False
        return 200, answer
    request, calls = _sl(aliases, toggle)
    monkeypatch.setattr(aliasservice, "request", request)
    aliasservice.configure("simplelogin", "k-123456")
    assert aliasservice.set_enabled(ALIAS, False).on is False
    assert calls.count("POST") == 1          # no blind second toggle


def test_an_unreadable_answer_and_a_state_that_did_not_change_refuses(
        monkeypatch):
    aliases = [{"id": "1", "email": ALIAS, "enabled": True}]
    request, calls = _sl(aliases, lambda rows: (200, {}))   # nothing happens
    monkeypatch.setattr(aliasservice, "request", request)
    aliasservice.configure("simplelogin", "k-123456")
    with pytest.raises(aliasservice.AliasError, match="alias_http:status=409"):
        aliasservice.set_enabled(ALIAS, False)
    assert calls.count("POST") == 2


def test_forgetting_the_picks_is_saved_and_a_running_scan_cannot_undo_it(
        monkeypatch):
    mine = "mine@custom.example"
    install(monkeypatch, [mail(1, 50, "a@shop.example", to=mine),
                          mail(2, 5, "c@shop.example")])
    scan()
    acc = accountsmod.get()
    fake = FakeService("simplelogin", {mine: {"id": "7", "on": True}})
    monkeypatch.setattr(aliasservice, "request", fake)
    client.put("/api/alias-service", json={"service": "simplelogin",
                                           "api_key": "k-123456"})
    # the snapshot on disk has no picks left for the main-read mails
    saved = json.loads(mailops._snap_path(acc.name, acc.tenant).read_text())
    assert saved["index"] and all("to" not in m for m in saved["index"])
    # a scan that started before the change finishes after it
    real = mailops.scan_folder
    state = {"first": True}

    def slow(conn, folder, messages, *a, **k):
        out = real(conn, folder, messages, *a, **k)
        if state["first"] and folder == "INBOX":
            state["first"] = False
            for rec in messages:                 # what the scan has read
                rec["to"] = MAIN
            aliasservice.configure("simplelogin", "k-123456")
            monkeypatch.setattr(aliasservice, "request", FakeService(
                "simplelogin", {mine: {"id": "7", "on": True},
                                "other@custom.example": {"id": "8", "on": True}}))
            aliasservice.refresh()               # the list changes mid-scan
        return out
    monkeypatch.setattr(mailops, "scan_folder", slow)
    scan()
    assert all("to" not in m for m in acc.index.values())
    monkeypatch.setattr(mailops, "scan_folder", real)
    scan()
    assert row_of(addresses.report(), mine)["kind"] == "alias"


def test_a_login_that_was_not_an_address_rereads_once_it_is_known(monkeypatch):
    monkeypatch.setitem(cfgmod.ENV_IMAP, "user", "bob")
    monkeypatch.setitem(cfgmod.DEFAULT_CONFIG["accounts"]["default"], "user",
                        "bob")
    install(monkeypatch, [
        mail(1, 50, "a@shop.example", to="acme@alias.example"),
        mail(2, 40, "b@shop.example", to="acme@alias.example"),
        mail(3, 5, "c@shop.example")])
    scan()                                       # main unknown: all read as main
    acc = accountsmod.get()
    assert to_of(acc) == {1: MAIN, 2: MAIN, 3: MAIN}
    assert addressstore.picked_main(acc.name) == ""
    # the digest recipient makes the address known (any account setting would)
    monkeypatch.setitem(cfgmod.DEFAULT_CONFIG["accounts"]["default"], "digest",
                        {"schedule": "off", "recipient": MAIN})
    scan()
    assert to_of(acc) == {1: "acme@alias.example", 2: "acme@alias.example",
                          3: MAIN}
    assert addressstore.picked_main(acc.name) == MAIN
    # and it is not done again
    for m in acc.index.values():
        m["to"] = "x@y.example"
    scan()
    assert set(to_of(acc).values()) == {"x@y.example"}
