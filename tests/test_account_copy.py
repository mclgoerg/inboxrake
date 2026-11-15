"""Copy to another account (backend/accountcopy.py): the kinds and their
de-duplicated counts, an APPEND copy that keeps dates and flags and never
touches the source, duplicate skipping and verification, a ledger that makes
a pause / restart continue without copying twice, the size cap, the free
space line, "Tell them", and the tenant / account-rename rules."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accountcopy
from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import tenants
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

NOW = int(time.time())


def _date(days_ago: int, hour: int = 10) -> str:
    return time.strftime("%d-%b-%Y ", time.gmtime(NOW - days_ago * 86400)) \
        + f"{hour:02d}:15:00 +0000"


def _mails() -> list[dict]:
    """A small mailbox that has every kind in it."""
    out, uid = [], 0

    def add(frm, subject, **kw):
        nonlocal uid
        uid += 1
        out.append(make_msg(uid, frm=frm, subject=subject,
                            date=kw.pop("date", _date(10 + uid)), **kw))
    for n in (1, 2):
        add('"Acme Store" <shop@acme.example>', f"Your order #{n} has shipped",
            size=2000, seen=n == 1)
    add('"Bank of Example" <service@bank.example>', "Verify your account",
        size=1000, seen=True)
    add('"City Clinic" <desk@clinic.example>', "Appointment confirmation",
        size=3000)
    add('"Friend" <friend@friends.example>', "Dinner on Friday?", size=1500,
        seen=True, date=_date(2))
    add('"Boss" <boss@work.example>', "Quarterly numbers", size=2500)
    add('"Misc" <misc@misc.example>', "Pinned thing", size=700,
        msgid="<pinned@misc.example>")
    for n in range(3):
        add('"Promo" <news@promo.example>', f"Big Sale {n}", size=4000,
            unsub="<https://promo.example/u>", date=_date(5))
    add('"Other" <other@else.example>', "Just a note", size=500)
    return out


SENT = [make_msg(90, frm="Me <demo@example.com>", subject="Re: Dinner",
                 to="Friend <friend@friends.example>", seen=True)]


@pytest.fixture
def env(monkeypatch):
    """Accounts `gmail` (the source, scanned) and `proton` (the target)."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({
        "protected": ["boss@work.example"],
        "accounts": {
            "gmail": {"host": "host-g", "user": "old.demo@gmail.example",
                      "password": "pw"},
            "proton": {"host": "host-p", "user": "demo@example.com",
                       "password": "pw"}}}))
    fakes = {
        "host-g": FakeIMAP({"INBOX": _mails(), "Sent": list(SENT),
                            "Trash": []}),
        "host-p": FakeIMAP({"INBOX": [], "Sent": [], "Trash": []},
                           quota=(100_000, 12_000_000)),
    }
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    src = accountsmod.get("gmail")
    mailops.run_scan(src)
    pinstore.set_pinned("<pinned@misc.example>", True, "gmail")
    mailops.rebuild_smart(src, force=True)
    return fakes


def _snapshot(fake) -> dict:
    return {f: [dict(m) for m in msgs] for f, msgs in fake.mailbox.items()}


def _wait(timeout=10.0) -> dict:
    """The job once its thread has ended."""
    end = time.time() + timeout
    while time.time() < end:
        job = accountcopy.status()["job"]
        t = accountcopy._THREADS.get("default")
        if job and job["status"] != "running" and not (t and t.is_alive()):
            return job
        time.sleep(0.01)
    raise TimeoutError(accountcopy.status())


def _start(kinds=None, folder="", **over):
    r = client.post("/api/account_copy/start", json={
        "source": "gmail", "target": "proton",
        "kinds": list(accountcopy.DEFAULT_KINDS) if kinds is None else kinds,
        "folder": folder,
        **over})
    return r


def _folder(fakes, name="From gmail"):
    return fakes["host-p"].mailbox.get(name, [])


# ----------------------------------------------------------------- kinds

def test_plan_counts_every_kind_and_a_mail_in_two_kinds_counts_once(env):
    plan = client.get("/api/account_copy/plan",
                      params={"source": "gmail", "target": "proton"}).json()
    by = {k["id"]: k for k in plan["kinds"]}
    assert by["orders"]["mails"] == 2 and by["orders"]["size"] == 4000
    assert by["accounts"]["mails"] == 1
    assert by["appointments"]["mails"] == 1
    assert by["replied"]["mails"] == 1          # the friend the user wrote to
    assert by["protected"]["mails"] == 1        # boss@work.example
    assert by["pinned"]["mails"] == 1
    assert by["newsletter"]["mails"] == 3
    assert by["other"]["mails"] == 1            # only mails in no other kind
    assert plan["source"]["mails"] == 11
    assert plan["source"]["address"] == "old.demo@gmail.example"
    assert plan["target"]["address"] == "demo@example.com"
    assert plan["folder"] == "From gmail"
    assert [k["id"] for k in plan["kinds"] if k["default"]] == \
        list(accountcopy.DEFAULT_KINDS)
    # the combos sum to the mailbox, each mail once
    assert sum(c["mails"] for c in plan["combos"]) == 11
    bits = plan["bits"]
    ticked = sum(bits[k] for k in accountcopy.DEFAULT_KINDS)
    assert sum(c["mails"] for c in plan["combos"] if c["mask"] & ticked) == 7


def test_a_mail_that_is_both_protected_and_pinned_is_one_mail(env):
    pinstore.set_pinned(
        next(m["msgid"] for m in env["host-g"].mailbox["INBOX"]
             if "boss" in m["from"]), True, "gmail")
    src = accountsmod.get("gmail")
    items = accountcopy.classify(src)
    both = [i for i in items if i["mask"] & accountcopy.BIT["protected"]
            and i["mask"] & accountcopy.BIT["pinned"]]
    assert len(both) == 1
    plan = client.get("/api/account_copy/plan",
                      params={"source": "gmail", "target": "proton"}).json()
    ticked = sum(plan["bits"][k] for k in ("protected", "pinned"))
    assert sum(c["mails"] for c in plan["combos"] if c["mask"] & ticked) == 2
    by = {k["id"]: k["mails"] for k in plan["kinds"]}
    assert by["protected"] + by["pinned"] == 3        # 1 + 2, one overlap


def test_the_plan_needs_a_scanned_source(env):
    accountsmod.get("proton")        # never scanned
    r = client.get("/api/account_copy/plan",
                   params={"source": "proton", "target": "gmail"})
    assert r.status_code == 200 and r.json()["scanned"] is False


def test_same_and_unknown_accounts_are_refused(env):
    for src, tgt, code in (("gmail", "gmail", "copy_same_account"),
                           ("gmail", "nope", "copy_unknown_account"),
                           ("nope", "proton", "copy_unknown_account")):
        r = client.get("/api/account_copy/plan",
                       params={"source": src, "target": tgt})
        assert (r.status_code, r.json()["detail"]) == (400, code)
        r = client.post("/api/account_copy/start", json={
            "source": src, "target": tgt, "kinds": ["orders"]})
        assert (r.status_code, r.json()["detail"]) == (400, code)


# ------------------------------------------------------------------ copy

def test_the_copy_lands_in_a_new_folder_with_dates_and_flags(env):
    src_before = _snapshot(env["host-g"])
    r = _start()
    assert r.status_code == 200 and r.json()["job"]["status"] == "running"
    job = _wait()
    assert job["status"] == "done", job
    assert job["total"] == 7 and job["copied"] == 7 and job["checked"] == 7
    assert job["skipped"] == 0 and job["failed"] == 0 and job["unchecked"] == 0
    landed = _folder(env)
    assert len(landed) == 7
    by_id = {m["msgid"]: m for m in landed}
    order1 = next(m for m in env["host-g"].mailbox["INBOX"]
                  if m["subject"] == "Your order #1 has shipped")
    got = by_id[order1["msgid"]]
    assert got["date"] == order1["date"]        # INTERNALDATE kept
    assert got["seen"] is True                  # read stays read
    order2 = by_id[next(m["msgid"] for m in env["host-g"].mailbox["INBOX"]
                        if m["subject"] == "Your order #2 has shipped")]
    assert order2["seen"] is False              # unread stays unread
    assert got["raw"].startswith(b"From: ")     # the whole message
    # newsletters and the rest were left behind
    assert not any("promo" in m["from"] or "else.example" in m["from"]
                   for m in landed)
    # nothing at all changed in the source
    assert _snapshot(env["host-g"]) == src_before


def test_flags_travel_and_deleted_never_does(env):
    meta = (b'1 (UID 5 FLAGS (\\Seen \\Flagged \\Answered \\Deleted \\Recent '
            b'$Junk) INTERNALDATE "05-Mar-2024 10:15:00 +0100" BODY[] {3}')
    out = {}
    accountcopy._Run._record(out, meta, b"abc")
    assert out[5] == ("\\Seen \\Flagged \\Answered",
                      "05-Mar-2024 10:15:00 +0100", b"abc")


def test_a_date_that_is_not_an_internaldate_is_never_passed_on():
    out = {}
    accountcopy._Run._record(
        out, b'1 (UID 5 FLAGS (\\Seen) INTERNALDATE "x\r\nA1 DELETE INBOX" '
             b'BODY[] {3}', b"abc")
    assert out[5] == ("\\Seen", None, b"abc")


def test_the_reply_may_put_flags_and_date_after_the_literal():
    """Some servers answer `BODY[] {n}` first and the rest after it."""
    class Conn:
        def select(self, *a, **k):
            return "OK", [b"1"]

        def response(self, key):
            return key, [b"1"]

        def uid(self, *a):
            return "OK", [(b"1 (BODY[] {3}", b"abc"),
                          b' UID 7 FLAGS (\\Seen) INTERNALDATE '
                          b'"01-Jan-2024 00:00:00 +0000")']
    acc = type("A", (), {"folder_uv": {}})()
    run = accountcopy._Run({"folder": "x"}, acc, acc)
    run.s = Conn()
    assert run._fetch("INBOX", [7]) == {
        7: ("\\Seen", "01-Jan-2024 00:00:00 +0000", b"abc")}


def test_the_source_is_only_ever_read(env):
    """Every select of the source is read-only, nothing is stored, moved,
    copied or expunged there, and mails are fetched with BODY.PEEK[]."""
    _start()
    assert _wait()["status"] == "done"
    src = env["host-g"]
    names = {c[0] for c in src.commands}
    assert not names & {"STORE", "EXPUNGE", "APPEND", "CREATE"}
    uid_cmds = {c[1] for c in src.commands if c[0] == "UID"}
    assert not uid_cmds & {"STORE", "MOVE", "COPY", "EXPUNGE"}
    selects = [c for c in src.commands if c[0] == "SELECT"]
    assert selects and all(c[2] is True for c in selects)
    fetches = [c[3] for c in src.commands
               if c[0] == "UID" and c[1] == "FETCH" and "BODY" in c[3]]
    assert any("BODY.PEEK[])" in f for f in fetches)
    assert all("BODY[]" not in f.replace("BODY.PEEK[]", "") for f in fetches)


def test_mails_already_in_the_target_are_skipped(env):
    """Same Message-ID in the target's index (scanned) is "already there"."""
    ids = {m["subject"]: m["msgid"] for m in env["host-g"].mailbox["INBOX"]}
    env["host-p"].mailbox["INBOX"].append(make_msg(
        1, frm='"Acme Store" <shop@acme.example>', subject="forwarded",
        msgid=ids["Your order #1 has shipped"]))
    mailops.run_scan(accountsmod.get("proton"))
    _start()
    job = _wait()
    assert job["status"] == "done"
    assert job["skipped"] == 1 and job["copied"] == 6
    assert job["total"] == 7 and job["processed"] == 7
    assert ids["Your order #1 has shipped"] not in {
        m["msgid"] for m in _folder(env)}
    # ... and the mail was not even read from the source
    dup_uid = next(m["uid"] for m in env["host-g"].mailbox["INBOX"]
                   if m["msgid"] == ids["Your order #1 has shipped"])
    fetched = {int(u) for c in env["host-g"].commands
               if c[0] == "UID" and c[1] == "FETCH" and "BODY.PEEK[])" in c[3]
               for u in c[2].split(",")}
    assert dup_uid not in fetched and len(fetched) == 6


def test_a_second_run_over_the_same_folder_adds_nothing(env):
    _start()
    assert _wait()["copied"] == 7
    client.post("/api/account_copy/dismiss")
    _start()
    job = _wait()
    assert job["copied"] == 0 and job["skipped"] == 7
    assert len(_folder(env)) == 7


def test_each_chunk_is_verified_by_message_id(env):
    """A server that says OK but stores nothing is not "checked"."""
    lost = []

    def hook(name, flags, date_time, message):
        if b"Appointment" in message:
            lost.append(1)
            return "OK", [b"[APPENDUID 1 99] Append completed"]   # not stored
        return None
    env["host-p"].append_hook = hook
    _start()
    job = _wait()
    assert lost and job["status"] == "done"
    assert job["failed"] == 1 and job["checked"] == 6 and job["copied"] == 6


def test_a_mail_without_a_message_id_is_copied_but_not_checked(env):
    for m in env["host-g"].mailbox["INBOX"]:
        if m["subject"] == "Verify your account":
            m["msgid"] = ""
    for m in accountsmod.get("gmail").index.values():
        if m["subject"] == "Verify your account":
            m["msgid"] = ""
    _start()
    job = _wait()
    assert job["status"] == "done"
    assert job["copied"] == 7 and job["unchecked"] == 1 and job["checked"] == 6


def test_a_mail_over_the_size_cap_is_skipped_and_reported(env, monkeypatch):
    monkeypatch.setattr(accountcopy, "MAX_MAIL_BYTES", 2200)
    _start()
    job = _wait()
    assert job["status"] == "done"
    assert job["too_large"] == 2        # the 3000 and 2500 byte mails
    assert len(_folder(env)) == 7 - job["too_large"]
    assert job["processed"] == 7


def test_the_new_folder_name_is_editable_and_made_safe(env):
    _start(folder='  Old / Mail  "x" ')
    job = _wait()
    assert job["folder"] == "Old Mail x"
    assert len(env["host-p"].mailbox["Old Mail x"]) == 7
    assert ("SUBSCRIBE", "Old Mail x") in env["host-p"].commands


@pytest.mark.parametrize("name", ["", "   ", "INBOX", "inbox", '"/\\'])
def test_an_unusable_folder_name_is_refused(env, name):
    if not name.strip():                 # blank = the default name
        assert _start(folder=name).status_code == 200
        return
    r = _start(folder=name)
    assert (r.status_code, r.json()["detail"]) == (400, "copy_folder_name")


def test_mutf7_round_trip():
    for name in ("From Gmail", "Büro & Privat", "日本語", "a&b", "Ärger/Zoé"):
        enc = accountcopy.encode_mutf7(name)
        assert enc.isascii() and mailops.decode_mutf7(enc) == name


def test_a_non_ascii_folder_is_created_encoded(env):
    _start(folder="Büro")
    job = _wait()
    assert job["status"] == "done"
    assert accountcopy.encode_mutf7("Büro") in env["host-p"].mailbox


def test_nothing_ticked_or_nothing_in_it_is_refused(env):
    r = _start(kinds=[])
    assert (r.status_code, r.json()["detail"]) == (400, "copy_nothing")
    r = _start(kinds=["bogus"])
    assert (r.status_code, r.json()["detail"]) == (400, "copy_nothing")


def test_a_source_that_was_never_scanned_is_refused(env):
    r = client.post("/api/account_copy/start", json={
        "source": "proton", "target": "gmail", "kinds": ["orders"]})
    assert r.status_code == 400
    assert r.json()["detail"] in ("copy_not_scanned", "copy_nothing")


def test_the_audit_log_gets_counts_and_no_subjects(env):
    _start()
    _wait()
    rows = [e for e in auditlog.load("gmail")["entries"]
            if e["action"] == "account_copy"]
    assert len(rows) == 1
    e = rows[0]
    assert e["count"] == 7 and e["outcome"] == "ok" and e["bytes"] > 0
    assert e["label"] == "gmail → proton"
    assert "order" not in json.dumps(e).lower()


def test_the_target_is_rescanned_when_the_copy_is_done(env):
    _start()
    _wait()
    proton = accountsmod.get("proton")
    end = time.time() + 5
    while time.time() < end and proton.state["status"] != "done":
        time.sleep(0.01)
    assert any(m["folder"] == "From gmail" for m in proton.index.values())


# ------------------------------------------------- pause, cancel, resume

def test_pause_then_resume_never_copies_a_mail_twice(env, monkeypatch):
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)
    calls = []

    def hook(name, flags, date_time, message):
        calls.append(1)
        if len(calls) == 3:
            client.post("/api/account_copy/pause")
        return None
    env["host-p"].append_hook = hook
    _start()
    job = _wait()
    assert job["status"] == "paused"
    assert 0 < job["copied"] < 7
    partial = job["copied"]
    assert len(_folder(env)) == partial
    r = client.post("/api/account_copy/resume")
    assert r.status_code == 200
    job = _wait()
    assert job["status"] == "done" and job["copied"] == 7
    ids = [m["msgid"] for m in _folder(env)]
    assert len(ids) == 7 and len(set(ids)) == 7        # no duplicates


@pytest.mark.filterwarnings(
    "ignore::pytest.PytestUnhandledThreadExceptionWarning")
def test_a_restart_continues_from_the_ledger(env, monkeypatch):
    """The process stops mid-copy; the next start picks the job up."""
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)

    class Crash(BaseException):
        pass

    calls = []

    def hook(name, flags, date_time, message):
        calls.append(1)
        if len(calls) == 4:
            raise Crash()                     # the thread dies, no clean-up
        return None
    env["host-p"].append_hook = hook
    _start()
    end = time.time() + 5
    while time.time() < end and "default" in accountcopy._THREADS:
        time.sleep(0.01)
    job = accountcopy.status()["job"]
    assert job["status"] == "running"          # nothing said otherwise
    assert 0 < len(_folder(env)) < 7
    env["host-p"].append_hook = None
    accountcopy._THREADS.clear()
    accountcopy.resume_all()                   # what a start-up does
    job = _wait()
    assert job["status"] == "done" and job["copied"] + job["skipped"] == 7
    ids = [m["msgid"] for m in _folder(env)]
    assert len(ids) == 7 and len(set(ids)) == 7


def test_a_paused_copy_stays_paused_after_a_restart(env):
    _start()
    _wait()
    data = accountcopy._read()
    data["job"]["status"] = "paused"
    accountcopy._write(data)
    accountcopy.resume_all()
    assert accountcopy.status()["job"]["status"] == "paused"


def test_cancel_stops_and_deletes_nothing(env, monkeypatch):
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)
    src_before = _snapshot(env["host-g"])
    calls = []

    def hook(name, flags, date_time, message):
        calls.append(1)
        if len(calls) == 2:
            client.post("/api/account_copy/cancel")
        return None
    env["host-p"].append_hook = hook
    _start()
    job = _wait()
    assert job["status"] == "cancelled" and 0 < job["copied"] < 7
    assert _snapshot(env["host-g"]) == src_before
    rows = [e for e in auditlog.load("gmail")["entries"]
            if e["action"] == "account_copy"]
    assert rows and rows[0]["outcome"] == "cancelled"


def test_only_one_copy_at_a_time(env, monkeypatch):
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)
    state = {}

    def hook(name, flags, date_time, message):
        if "second" not in state:
            state["second"] = _start().json()
            client.post("/api/account_copy/pause")
        return None
    env["host-p"].append_hook = hook
    _start()
    _wait()
    assert state["second"]["detail"] == "copy_busy"
    # a paused copy still blocks a new one
    assert _start().json()["detail"] == "copy_busy"
    assert client.post("/api/account_copy/dismiss").status_code == 409


def test_nothing_to_pause_resume_or_cancel_without_a_job(env):
    for verb in ("pause", "resume", "cancel"):
        r = client.post(f"/api/account_copy/{verb}")
        assert (r.status_code, r.json()["detail"]) == (400, "copy_no_job")


def test_a_target_that_refuses_stops_the_copy_with_a_code(env):
    env["host-p"].append_hook = lambda *a: ("NO", [b"nope"])
    _start()
    job = _wait()
    assert job["status"] == "error" and job["error"] == "copy_append_refused"
    assert job["copied"] == 0
    env["host-p"].append_hook = None
    assert client.post("/api/account_copy/resume").status_code == 200
    job = _wait()
    assert job["status"] == "done" and job["copied"] == 7


def test_a_full_target_stops_the_copy_with_a_code(env):
    env["host-p"].append_hook = lambda *a: ("NO", [b"[OVERQUOTA] full"])
    _start()
    job = _wait()
    assert job["status"] == "error" and job["error"] == "copy_target_full"


def test_a_source_folder_that_changed_stops_the_copy(env):
    env["host-g"].uv["INBOX"] = 99          # UIDVALIDITY moved since the scan
    _start()
    job = _wait()
    assert job["status"] == "error"
    assert job["error"] == "copy_source_changed:folder=INBOX"
    assert _folder(env) == []


def test_a_dropped_connection_is_retried_once(env):
    state = {"n": 0}
    real = env["host-p"].append

    def flaky(qname, flags, date_time, message):
        state["n"] += 1
        if state["n"] == 2:
            raise OSError("connection reset")
        return real(qname, flags, date_time, message)
    env["host-p"].append = flaky
    _start()
    job = _wait()
    assert job["status"] == "done"
    ids = [m["msgid"] for m in _folder(env)]
    assert len(ids) == 7 and len(set(ids)) == 7


# ------------------------------------------------------------ free space

def test_free_space_is_reported_only_when_the_server_has_quota(env):
    r = client.get("/api/account_copy/space", params={"target": "proton"})
    assert r.json() == {"free": (12_000_000 - 100_000) * 1024}
    env["host-p"].capabilities = tuple(c for c in env["host-p"].capabilities
                                       if c != "QUOTA")
    env["host-p"].quota = None
    r = client.get("/api/account_copy/space", params={"target": "proton"})
    assert r.json() == {"free": None}
    r = client.get("/api/account_copy/space", params={"target": "nope"})
    assert (r.status_code, r.json()["detail"]) == (400, "copy_unknown_account")


def test_an_unreadable_quota_leaves_the_line_out(env, monkeypatch):
    monkeypatch.setattr(env["host-p"], "getquotaroot",
                        lambda q: (_ for _ in ()).throw(OSError("x")))
    r = client.get("/api/account_copy/space", params={"target": "proton"})
    assert r.json() == {"free": None}


# ------------------------------------------------------------- tell them

def test_tell_them_lists_senders_without_newsletters(env):
    body = client.get("/api/account_copy/tell",
                      params={"source": "gmail", "target": "proton"}).json()
    addrs = [s["addr"] for s in body["senders"]]
    assert "news@promo.example" not in addrs
    assert {"shop@acme.example", "service@bank.example",
            "desk@clinic.example", "friend@friends.example",
            "boss@work.example"} <= set(addrs)
    assert addrs[0] == "shop@acme.example"        # most mails first
    assert body["newsletters"] == 1
    assert body["newsletter_keys"] == ["news@promo.example"]
    assert body["source"]["address"] == "old.demo@gmail.example"
    assert body["target"]["address"] == "demo@example.com"
    assert body["done"] == 0 and body["total"] == len(addrs)


def test_tell_them_only_counts_the_last_90_days(env):
    src = accountsmod.get("gmail")
    for m in src.index.values():
        if "clinic" in m["addr"]:
            m["ts"] = NOW - 200 * 86400
    body = client.get("/api/account_copy/tell",
                      params={"source": "gmail", "target": "proton"}).json()
    assert "desk@clinic.example" not in [s["addr"] for s in body["senders"]]


def test_ticks_are_stored_per_pair_and_can_be_undone(env):
    r = client.post("/api/account_copy/tell", json={
        "source": "gmail", "target": "proton", "addr": "shop@acme.example"})
    body = r.json()
    assert body["done"] == 1
    assert next(s for s in body["senders"]
                if s["addr"] == "shop@acme.example")["done"] is True
    again = client.get("/api/account_copy/tell",
                       params={"source": "gmail", "target": "proton"}).json()
    assert again["done"] == 1
    r = client.post("/api/account_copy/tell", json={
        "source": "gmail", "target": "proton", "addr": "shop@acme.example",
        "done": False})
    assert r.json()["done"] == 0
    r = client.post("/api/account_copy/tell", json={
        "source": "gmail", "target": "proton", "addr": " "})
    assert r.status_code == 400


# -------------------------------------------------- tenants and accounts

def test_a_copy_belongs_to_its_tenant(env):
    _start()
    _wait()
    other = tenants.for_subject("someone@else.example")
    with tenants.use(other):
        assert accountcopy.status() == {"job": None}
        with pytest.raises(ValueError, match="copy_unknown_account"):
            accountcopy.start("gmail", "proton", ["orders"])
        with pytest.raises(ValueError, match="copy_unknown_account"):
            accountcopy.plan("gmail", "proton")
        with pytest.raises(ValueError, match="copy_unknown_account"):
            accountcopy.tell("gmail", "proton")


def test_two_accounts_of_different_tenants_never_meet(env):
    """Even if a name existed in both tenants, a job only runs for accounts
    whose state belongs to the job's tenant."""
    other = tenants.for_subject("someone@else.example")
    src, tgt = accountcopy._resolve("gmail", "proton")
    foreign = accountsmod.AccountState("proton", other)
    accountsmod._REGISTRY[(tenants.current().id, "proton")] = foreign
    with pytest.raises(ValueError, match="copy_unknown_account"):
        accountcopy._resolve("gmail", "proton")
    _start_job = accountcopy._read()
    assert _start_job["job"] is None


def test_the_worker_refuses_accounts_of_another_tenant(env):
    other = tenants.for_subject("someone@else.example")
    accountcopy._write({"job": {
        "id": "x", "source": "gmail", "target": "proton", "folder": "F",
        "folder_enc": "", "kinds": ["orders"], "status": "running",
        "total": 1, "bytes_total": 1, "copied": 0, "skipped": 0,
        "checked": 0, "unchecked": 0, "too_large": 0, "missing": 0,
        "failed": 0, "bytes_done": 0, "started": 1, "finished": 0,
        "error": "", "active_s": 0.0}, "tell": {}})
    accountsmod._REGISTRY[(tenants.current().id, "proton")] = \
        accountsmod.AccountState("proton", other)
    accountcopy._run()
    job = accountcopy.status()["job"]
    assert job["status"] == "error" and job["error"] == "copy_unknown_account"
    assert env["host-p"].mailbox["INBOX"] == [] and "F" not in \
        env["host-p"].mailbox


def test_renaming_an_account_carries_the_job_and_the_ticks(env):
    client.post("/api/account_copy/tell", json={
        "source": "gmail", "target": "proton", "addr": "shop@acme.example"})
    _start()
    _wait()
    accountcopy.rename_account("gmail", "oldmail")
    job = accountcopy.status()["job"]
    assert job["source"] == "oldmail" and job["target"] == "proton"
    assert accountcopy._read()["tell"] == {
        "oldmail": {"proton": ["shop@acme.example"]}}
    accountcopy.rename_account("proton", "newmail")
    assert accountcopy._read()["tell"] == {
        "oldmail": {"newmail": ["shop@acme.example"]}}
    assert accountcopy.status()["job"]["target"] == "newmail"


def test_dropping_an_account_drops_its_job_and_ticks(env):
    client.post("/api/account_copy/tell", json={
        "source": "gmail", "target": "proton", "addr": "shop@acme.example"})
    _start()
    _wait()
    accountcopy.drop_account("proton")
    assert accountcopy.status() == {"job": None}
    assert accountcopy._read()["tell"] == {}


def test_the_api_hooks_rename_and_delete(env):
    _start()
    _wait()
    r = client.post("/api/config", json={
        "rename_account": {"from": "gmail", "to": "oldmail"}})
    assert r.status_code == 200
    assert accountcopy.status()["job"]["source"] == "oldmail"
    r = client.post("/api/config", json={"delete_account": "proton"})
    assert r.status_code == 200
    assert accountcopy.status() == {"job": None}


def test_dismiss_forgets_a_finished_job_but_not_the_ticks(env):
    client.post("/api/account_copy/tell", json={
        "source": "gmail", "target": "proton", "addr": "shop@acme.example"})
    _start()
    _wait()
    assert client.post("/api/account_copy/dismiss").json() == {"job": None}
    assert accountcopy._read()["tell"]["gmail"]["proton"] == [
        "shop@acme.example"]


def test_a_damaged_file_only_forgets_what_it_cannot_read(env):
    accountcopy._path().write_text("{not json")
    assert accountcopy.status() == {"job": None}
    accountcopy._path().write_text(json.dumps({"job": 3, "tell": []}))
    assert accountcopy.status() == {"job": None}
    assert client.get("/api/account_copy/tell", params={
        "source": "gmail", "target": "proton"}).status_code == 200


def test_a_ledger_of_another_job_is_ignored(env):
    accountcopy._ledger_reset("old")
    accountcopy._ledger_append([("<x@y>", "ok")])
    assert accountcopy._ledger_read("old") == {"<x@y>": "ok"}
    assert accountcopy._ledger_read("new") == {}
    accountcopy._ledger_path().write_text('{"job": "a"}\n["k","ok"]\n["cut')
    assert accountcopy._ledger_read("a") == {"k": "ok"}


def test_a_job_removed_while_it_runs_ends_quietly(env, monkeypatch):
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)
    calls = []

    def hook(name, flags, date_time, message):
        calls.append(1)
        if len(calls) == 2:
            accountcopy.drop_account("proton")
        return None
    env["host-p"].append_hook = hook
    _start()
    end = time.time() + 5
    while time.time() < end and "default" in accountcopy._THREADS:
        time.sleep(0.01)
    assert accountcopy.status() == {"job": None}
    assert not [e for e in auditlog.load("gmail")["entries"]
                if e["action"] == "account_copy"]


def test_renaming_while_the_copy_runs_keeps_the_new_names(env, monkeypatch):
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)
    calls = []

    def hook(name, flags, date_time, message):
        calls.append(1)
        if len(calls) == 2:
            accountcopy.rename_account("gmail", "oldmail")
        return None
    env["host-p"].append_hook = hook
    _start()
    job = _wait()
    assert job["source"] == "oldmail" and job["status"] == "done"


def test_a_scan_of_the_source_blocks_a_start(env):
    src = accountsmod.get("gmail")
    with src.lock:
        src.state["status"] = "scanning"
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (409, "busy_scan")


# ------------------------------------------------------------------ the demo

def test_the_demo_runs_the_copy_inline_without_threads_or_sleeping(
        env, monkeypatch):
    """In the browser there are no threads to wait for: the job runs inside
    the request that started it (after the handler returned) and never rests."""
    import asyncio
    from backend import demo

    def call(method, path, body=None, query=""):
        res = asyncio.run(demo.request(method, path, query, body))
        return res["status"], json.loads(res["body"])
    monkeypatch.setenv(demo.ENV_VAR, "1")
    monkeypatch.setattr(accountcopy, "THROTTLE_RATIO", 5)
    monkeypatch.setattr(accountcopy.time, "sleep", lambda s: (_ for _ in ()).throw(
        AssertionError("the demo must not sleep")))
    demo.install(fernet=False)
    try:
        status, body = call("POST", "/api/account_copy/start", {
            "source": "gmail", "target": "proton",
            "kinds": list(accountcopy.DEFAULT_KINDS), "folder": ""})
        assert status == 200
        status, body = call("GET", "/api/account_copy/status")
        assert body["job"]["status"] == "done", body
        assert body["job"]["copied"] == 7 and body["job"]["checked"] == 7
        assert len(_folder(env)) == 7
        # reads of the page work the same
        status, body = call("GET", "/api/account_copy/tell",
                            query="source=gmail&target=proton")
        assert status == 200 and body["total"] > 0
    finally:
        demo.uninstall()
