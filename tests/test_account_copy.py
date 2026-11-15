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


def test_a_mail_without_a_message_id_is_checked_by_its_fingerprint(env):
    for m in env["host-g"].mailbox["INBOX"]:
        if m["subject"] == "Verify your account":
            m["msgid"] = ""
    for m in accountsmod.get("gmail").index.values():
        if m["subject"] == "Verify your account":
            m["msgid"] = ""
    _start()
    job = _wait()
    assert job["status"] == "done"
    assert job["copied"] == 7 and job["checked"] == 7 and job["unchecked"] == 0


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


@pytest.mark.parametrize("name", ["", "   ", '"/\\'])
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
        answer = real(qname, flags, date_time, message)
        if state["n"] == 2:
            raise OSError("connection reset")      # AFTER the mail landed
        return answer
    env["host-p"].append = flaky
    _start()
    job = _wait()
    assert job["status"] == "done"
    ids = [m["msgid"] for m in _folder(env)]
    assert len(ids) == 7 and len(set(ids)) == 7
    # the mail the first try appended is ours: copied, not "already there"
    assert job["copied"] == 7 and job["skipped"] == 0 and job["checked"] == 7


# ------------------------------------------------------------ free space

def test_free_space_is_reported_only_when_the_server_has_quota(env):
    r = client.get("/api/account_copy/space", params={"target": "proton"})
    assert r.json() == {"free": (12_000_000 - 100_000) * 1024,
                        "exists": False, "reserved": False}
    env["host-p"].capabilities = tuple(c for c in env["host-p"].capabilities
                                       if c != "QUOTA")
    env["host-p"].quota = None
    r = client.get("/api/account_copy/space", params={"target": "proton"})
    assert r.json()["free"] is None
    r = client.get("/api/account_copy/space", params={"target": "nope"})
    assert (r.status_code, r.json()["detail"]) == (400, "copy_unknown_account")


def test_an_unreadable_quota_leaves_the_line_out(env, monkeypatch):
    monkeypatch.setattr(env["host-p"], "getquotaroot",
                        lambda q: (_ for _ in ()).throw(OSError("x")))
    r = client.get("/api/account_copy/space", params={"target": "proton"})
    assert r.json()["free"] is None


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
    accountcopy._run([])
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


# ------------------------------- mails without a Message-ID, crashes, resumes

class Crash(BaseException):
    """The process dies right here: nothing after it runs, no clean-up."""


def _strip_ids(env, subjects):
    """These mails of the source have no Message-ID (in the server and in the
    scan)."""
    fake = env["host-g"]
    for m in fake.mailbox["INBOX"]:
        if m["subject"] in subjects:
            m["msgid"] = ""
            # a real server's RFC822.SIZE is the size of the message it serves
            m["size"] = len(fake._header_blob(m) + fake._payload(m))
    sizes = {m["subject"]: m["size"] for m in fake.mailbox["INBOX"]}
    for m in accountsmod.get("gmail").index.values():
        if m["subject"] in subjects:
            m["msgid"] = ""
            m["size"] = sizes[m["subject"]]


IDLESS = ("Your order #1 has shipped", "Your order #2 has shipped",
          "Verify your account")


def _subjects(env):
    return sorted(m["subject"] for m in _folder(env))


def _crash_when_the_chunk_is_final(monkeypatch):
    """The process dies after the APPENDs of a chunk, before its final
    ledger lines are written."""
    real = accountcopy._ledger_append

    def append(rows, sync=True):
        if any(st in accountcopy.FINAL for _, st in rows):
            raise Crash()
        return real(rows, sync)
    monkeypatch.setattr(accountcopy, "_ledger_append", append)
    return real


def _wait_thread_gone():
    end = time.time() + 10
    while time.time() < end and "default" in accountcopy._THREADS:
        time.sleep(0.01)
    assert "default" not in accountcopy._THREADS


@pytest.mark.filterwarnings(
    "ignore::pytest.PytestUnhandledThreadExceptionWarning")
@pytest.mark.parametrize("idless", [(), IDLESS])
def test_a_crash_between_append_and_the_ledger_never_duplicates_a_mail(
        env, monkeypatch, idless):
    """The mails are in the target, their final ledger lines are not: the
    resume finds them again (by Message-ID, or by date + size + subject for
    a mail without one), counts them as copied and appends nothing twice."""
    _strip_ids(env, idless)
    real = _crash_when_the_chunk_is_final(monkeypatch)
    _start()
    _wait_thread_gone()
    assert len(_folder(env)) == 7                    # all of them landed
    assert accountcopy.status()["job"]["status"] == "running"
    monkeypatch.setattr(accountcopy, "_ledger_append", real)
    appends = len([c for c in env["host-p"].commands if c[0] == "APPEND"])
    accountcopy.resume_all()                         # the next start-up
    job = _wait()
    assert job["status"] == "done"
    assert len([c for c in env["host-p"].commands
                if c[0] == "APPEND"]) == appends      # nothing appended again
    assert len(_folder(env)) == 7 and len(set(_subjects(env))) == 7
    assert job["copied"] == 7 and job["skipped"] == 0 and job["failed"] == 0


@pytest.mark.filterwarnings(
    "ignore::pytest.PytestUnhandledThreadExceptionWarning")
def test_an_idless_mail_whose_append_never_answered_is_not_appended_again(
        env, monkeypatch):
    """`pending` is on disk before the APPEND. If the process dies before it
    is known whether the target got the mail, the resume reports it
    "unchecked" instead of risking a second copy."""
    _strip_ids(env, IDLESS)
    state = {"died": False}

    def hook(name, flags, date_time, message):
        if b"Verify your account" in message and not state["died"]:
            state["died"] = True
            raise Crash()
        return None
    env["host-p"].append_hook = hook
    _start()
    _wait_thread_gone()
    pending = accountcopy._ledger_read(accountcopy.status()["job"]["id"])
    assert [k for k, v in pending.items() if v == "pending"]
    env["host-p"].append_hook = None
    accountcopy.resume_all()
    job = _wait()
    assert job["status"] == "done"
    # never acknowledged and not in the target: "may not be there", NOT
    # counted as copied - and not appended a second time
    assert job["unsure"] == 1 and job["unchecked"] == 0
    assert job["copied"] == 6 and job["processed"] == 7
    assert not [m for m in _folder(env) if m["subject"] == IDLESS[2]]
    assert len(_folder(env)) == 6


def test_a_dropped_connection_never_duplicates_an_idless_mail(env):
    _strip_ids(env, IDLESS)
    state = {"n": 0}
    real = env["host-p"].append

    def flaky(qname, flags, date_time, message):
        state["n"] += 1
        answer = real(qname, flags, date_time, message)
        if state["n"] == 3:
            raise OSError("connection reset")        # AFTER the mail landed
        return answer
    env["host-p"].append = flaky
    _start()
    job = _wait()
    assert job["status"] == "done"
    assert len(_folder(env)) == 7 and len(set(_subjects(env))) == 7
    assert job["copied"] == 7 and job["skipped"] == 0


def test_a_mail_already_in_the_target_is_found_without_a_message_id(env):
    """Same date, size and subject in the target's index: already there."""
    _strip_ids(env, IDLESS)
    src = accountsmod.get("gmail")
    twin = next(m for m in src.index.values() if m["subject"] == IDLESS[2])
    proton = accountsmod.get("proton")
    proton.index["INBOX\x007"] = {**twin, "folder": "INBOX", "uid": 7}
    _start()
    job = _wait()
    assert job["status"] == "done" and job["skipped"] == 1
    assert IDLESS[2] not in _subjects(env)


def test_the_ledger_knows_an_idless_mail_by_a_stable_fingerprint(env):
    _strip_ids(env, IDLESS)
    items = accountcopy.classify(accountsmod.get("gmail"))
    a = next(i for i in items if i["subject"] == IDLESS[2])
    key = accountcopy._key(a)
    assert key.startswith("fp:")
    # the same mail under a new UID (a rescan, a new UIDVALIDITY) is the same
    assert accountcopy._key({**a, "uid": 999}) == key
    assert accountcopy._key({**a, "subject": "other"}) != key


# ------------------------------------------------- two names for one mailbox

def _config(env, **proton):
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["proton"].update(proton)
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))


@pytest.mark.parametrize("over", [
    {"host": "host-g", "user": "old.demo@gmail.example"},
    {"host": "HOST-G", "user": "Old.Demo@Gmail.Example"},
    {"host": " host-g ", "user": "old.demo@gmail.example "}])
def test_the_same_host_and_login_is_refused(env, over):
    _config(env, **over)
    r = client.get("/api/account_copy/plan",
                   params={"source": "gmail", "target": "proton"})
    assert (r.status_code, r.json()["detail"]) == (400, "copy_same_mailbox")
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (400, "copy_same_mailbox")
    assert accountcopy.status() == {"job": None}
    assert not [c for c in env["host-p"].commands if c[0] == "APPEND"]
    r = client.get("/api/account_copy/tell",
                   params={"source": "gmail", "target": "proton"})
    assert r.json()["detail"] == "copy_same_mailbox"


@pytest.mark.parametrize("src, dst", [
    ("a.b+news@gmail.com", "ab@googlemail.com"),
    ("A.B@GMAIL.COM", "ab@gmail.com")])
def test_gmail_logins_that_differ_only_in_dots_or_tags_are_one_mailbox(
        env, src, dst):
    _config(env, host="imap.gmail.com", user=dst)
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["gmail"].update(host="imap.gmail.com", user=src)
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match="copy_same_mailbox"):
        accountcopy._resolve("gmail", "proton")


def test_other_logins_on_one_host_are_two_mailboxes(env):
    _config(env, host="host-g", user="somebody.else@gmail.example")
    assert accountcopy._resolve("gmail", "proton")


def _alias(env, empty_inbox=False):
    """`proton` is another name for the source's mailbox (a second host name
    and login the config does not reveal)."""
    _config(env, host="host-alias", user="alias@other.example")
    if empty_inbox:
        env["host-g"].mailbox["Archive"] = list(env["host-g"].mailbox["INBOX"])
        env["host-g"].mailbox["INBOX"] = []
    fakes = {"host-g": env["host-g"], "host-alias": env["host-g"]}
    mailops.connect = lambda im, name=None: fakes[im["host"]]


def _no_writes(env):
    return not [c for c in env["host-g"].commands
                if c[0] in ("APPEND", "CREATE")]


def _record(**over):
    return {"id": "x", "source": "gmail", "target": "proton",
            "folder": "From gmail", "folder_enc": "From gmail",
            "kinds": list(accountcopy.DEFAULT_KINDS), "status": "running",
            "total": 7, "bytes_total": 1, "copied": 0, "skipped": 0,
            "checked": 0, "unchecked": 0, "too_large": 0, "missing": 0,
            "failed": 0, "unsure": 0, "bytes_done": 0, "started": 1,
            "finished": 0, "error": "", "active_s": 0.0, **over}


@pytest.mark.parametrize("empty_inbox", [False, True])
def test_one_mailbox_under_two_names_is_refused_before_anything_is_written(
        env, empty_inbox):
    _alias(env, empty_inbox)
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (400, "copy_same_mailbox")
    assert accountcopy.status() == {"job": None} and _no_writes(env)


@pytest.mark.parametrize("empty_inbox", [False, True])
def test_the_guard_also_runs_when_a_run_connects_and_resume_is_refused(
        env, empty_inbox):
    """Resume and Start over cannot walk round the check: a run that
    connects looks first, and an error of this kind has nothing to resume."""
    _alias(env, empty_inbox)
    accountcopy._write({"job": _record(), "tell": {}})
    accountcopy._ledger_reset("x")
    accountcopy.resume_all()                    # a start-up picks it up
    job = _wait()
    assert job["status"] == "error" and job["error"] == "copy_same_mailbox"
    assert _no_writes(env)
    r = client.post("/api/account_copy/resume")          # the card's button
    assert (r.status_code, r.json()["detail"]) == (400, "copy_same_mailbox")
    assert accountcopy.status()["job"]["status"] == "error"
    # a job someone forces back to running still stops at connect()
    data = accountcopy._read()
    data["job"].update(status="running", error="")
    accountcopy._write(data)
    accountcopy.resume_all()
    assert _wait()["error"] == "copy_same_mailbox" and _no_writes(env)
    # Start over: the same refusal, still nothing written
    assert client.post("/api/account_copy/dismiss").status_code == 200
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (400, "copy_same_mailbox")
    assert _no_writes(env)


def _two(a_ids, b_ids, uv=(1, 1)):
    mk = lambda ids, v: FakeIMAP({"INBOX": [
        make_msg(i + 1, msgid=m) for i, m in enumerate(ids)]})
    a, b = mk(a_ids, uv[0]), mk(b_ids, uv[1])
    a.uv["INBOX"], b.uv["INBOX"] = uv
    return a, b


def test_two_different_mailboxes_with_the_same_numbers_are_not_the_same():
    """Equal UIDVALIDITY, UIDNEXT and count by coincidence: the Message-IDs
    of the newest mails tell them apart."""
    a, b = _two(["<a1@x>", "<a2@x>"], ["<b1@x>", "<b2@x>"])
    assert accountcopy.same_server_mailbox(a, b) is False
    a, b = _two(["<s1@x>", "<s2@x>"], ["<s1@x>", "<s2@x>"])
    assert accountcopy.same_server_mailbox(a, b) is True
    a, b = _two(["<s1@x>"], ["<s1@x>"], uv=(1, 2))
    assert accountcopy.same_server_mailbox(a, b) is False


def test_two_empty_inboxes_are_compared_by_every_folders_mail_count():
    a = FakeIMAP({"INBOX": [], "Archive": [make_msg(1)]})
    b = FakeIMAP({"INBOX": [], "Archive": [make_msg(1)]})
    assert accountcopy.same_server_mailbox(a, b) is True
    c = FakeIMAP({"INBOX": [], "Archive": [make_msg(1), make_msg(2)]})
    assert accountcopy.same_server_mailbox(a, c) is False
    # two fresh, empty accounts are not "the same" (there is nothing to tell)
    assert accountcopy.same_server_mailbox(
        FakeIMAP({"INBOX": [], "Sent": []}),
        FakeIMAP({"INBOX": [], "Sent": []})) is False


def test_a_server_that_cannot_answer_is_not_called_the_same():
    a, b = _two(["<s1@x>"], ["<s1@x>"])
    a.status = lambda *x: (_ for _ in ()).throw(OSError("no"))
    assert accountcopy.same_server_mailbox(a, b) is None


def _arrival_after_first_status(fake):
    """A mail arrives in the (shared) mailbox between the two STATUS calls."""
    real = fake.status
    state = {"n": 0}

    def status(q, what):
        answer = real(q, what)
        state["n"] += 1
        if state["n"] == 1:
            fake.mailbox["INBOX"].append(make_msg(
                99, msgid="<late@x>", subject="arrived meanwhile"))
        return answer
    fake.status = status


def test_a_mail_arriving_between_the_two_looks_does_not_hide_an_alias(env):
    _alias(env)
    _arrival_after_first_status(env["host-g"])
    r = _start()                                          # start()
    assert (r.status_code, r.json()["detail"]) == (400, "copy_same_mailbox")
    assert _no_writes(env)
    # ... and connect() of a run
    env["host-g"].mailbox["INBOX"] = [m for m in env["host-g"].mailbox["INBOX"]
                                      if m["uid"] != 99]
    _arrival_after_first_status(env["host-g"])
    accountcopy._write({"job": _record(), "tell": {}})
    accountcopy._ledger_reset("x")
    accountcopy.resume_all()
    job = _wait()
    assert job["status"] == "error" and job["error"] == "copy_same_mailbox"
    assert _no_writes(env)


def test_the_same_uids_are_compared_not_the_newest_mail():
    ids = [f"<s{i}@x>" for i in range(1, 6)]
    a, b = _two(ids, ids)
    b.mailbox["INBOX"].append(make_msg(6, msgid="<new@x>"))   # arrived in b
    assert accountcopy.same_server_mailbox(a, b) is True
    c, d = _two([f"<a{i}@x>" for i in range(1, 6)],
                [f"<b{i}@x>" for i in range(1, 6)])
    d.mailbox["INBOX"].append(make_msg(6, msgid="<new@x>"))
    assert accountcopy.same_server_mailbox(c, d) is False


def test_one_shared_message_id_in_a_tiny_mailbox_is_not_an_alias():
    """A forwarded copy at the same UID: too little to call it one mailbox."""
    a, b = _two(["<s1@x>"], ["<s1@x>"])
    b.mailbox["INBOX"].append(make_msg(2, msgid="<other@x>"))
    assert accountcopy.same_server_mailbox(a, b) is False


@pytest.mark.parametrize("gap", [45, 400, 5000])
def test_an_alias_is_found_although_the_newest_uids_were_all_expunged(env, gap):
    """A cleaned-up inbox: UIDNEXT is far above the mails that are left."""
    _alias(env)
    env["host-g"]._high["INBOX"] = 11 + gap
    assert env["host-g"].status('"INBOX"', "")[1][0].decode().count(
        f"UIDNEXT {12 + gap}") == 1
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (400, "copy_same_mailbox")
    assert _no_writes(env)
    a, b = _two([f"<s{i}@x>" for i in range(1, 4)],
                [f"<s{i}@x>" for i in range(1, 4)])
    a._high["INBOX"] = b._high["INBOX"] = 3 + gap
    assert accountcopy.same_server_mailbox(a, b) is True


def test_with_no_uid_to_compare_the_folder_counts_decide(env, monkeypatch):
    monkeypatch.setattr(accountcopy, "_newest_below", lambda c, top: [])
    a = FakeIMAP({"INBOX": [make_msg(1, msgid="<a@x>")],
                  "Archive": [make_msg(1, msgid="<b@x>")]})
    assert accountcopy.same_server_mailbox(a, a) is True
    c = FakeIMAP({"INBOX": [make_msg(1, msgid="<a@x>")], "Archive": []})
    assert accountcopy.same_server_mailbox(a, c) is False


def test_a_check_that_cannot_be_answered_fails_closed_on_one_host(env):
    """Same host, other login: the config says "close", the check cannot be
    answered - refuse instead of risking a write into the source."""
    _config(env, host="host-g", user="somebody.else@gmail.example")
    fakes = {"host-g": env["host-g"]}
    mailops.connect = lambda im, name=None: fakes[im["host"]]
    env["host-g"].status = lambda *x: (_ for _ in ()).throw(OSError("no"))
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (400, "copy_cannot_confirm")
    assert _no_writes(env)
    # a run that connects meets it as well
    accountcopy._write({"job": _record(), "tell": {}})
    accountcopy._ledger_reset("x")
    accountcopy.resume_all()
    job = _wait()
    assert job["status"] == "error" and job["error"] == "copy_cannot_confirm"
    assert _no_writes(env)


def test_a_check_that_cannot_be_answered_goes_on_across_two_hosts(env, caplog):
    for f in env.values():
        f.status = lambda *x: (_ for _ in ()).throw(OSError("no"))
    with caplog.at_level("WARNING", logger="inboxrake.accountcopy"):
        r = _start()
        assert r.status_code == 200
        job = _wait()
    assert job["status"] == "done" and job["copied"] == 7
    assert "could not confirm" in caplog.text


def test_google_workspace_logins_keep_their_dots_and_tags(env):
    _config(env, host="imap.gmail.com", user="a.b@work.example")
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["gmail"].update(host="imap.gmail.com",
                                    user="ab@work.example")
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))
    assert accountcopy._resolve("gmail", "proton")      # two mailboxes


def test_a_start_while_a_finishing_thread_is_still_registered_is_refused(env):
    import threading
    accountcopy._THREADS["default"] = threading.Thread()
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (409, "copy_busy")
    assert accountcopy.status() == {"job": None}
    accountcopy._THREADS.clear()
    assert _start().status_code == 200
    _wait()


def test_tell_them_keeps_a_shop_with_promos_and_orders_on_the_checklist(env):
    for m in accountsmod.get("gmail").index.values():
        if m["addr"] == "shop@acme.example":
            m["unsub"] = "<https://acme.example/u>"        # promo header too
    body = client.get("/api/account_copy/tell",
                      params={"source": "gmail", "target": "proton"}).json()
    assert "shop@acme.example" in [s["addr"] for s in body["senders"]]
    assert "shop@acme.example" not in body["newsletter_keys"]


# ------------------------------------------------------------ the new folder

RESERVED = ["INBOX", "inbox", "Trash", "Bin", "Papierkorb", "Gesendet",
            "Sent", "Drafts", "Entwürfe", "Archive", "Junk", "Spam",
            "All Mail"]


@pytest.fixture
def roles(env):
    """The target has a folder with a role flag under an odd name."""
    p = env["host-p"]
    p.mailbox["Bin"] = []
    p.mailbox["Projects"] = []
    p.uv.update({"Bin": 1, "Projects": 1})
    p.flags["Bin"] = "\\Trash"
    return env


@pytest.mark.parametrize("name", RESERVED)
def test_a_folder_the_server_uses_for_something_else_is_refused(roles, name):
    r = _start(folder=name)
    assert r.status_code == 400
    assert r.json()["detail"] == f"copy_folder_reserved:folder={name}" \
        or r.json()["detail"].startswith("copy_folder_reserved:folder=")
    assert accountcopy.status() == {"job": None}
    cmds = {c[0] for c in roles["host-p"].commands}
    assert not cmds & {"APPEND", "CREATE"}
    r = client.get("/api/account_copy/space",
                   params={"target": "proton", "folder": name})
    assert r.json()["reserved"] is True


def test_an_existing_ordinary_folder_is_added_to_and_said_so(roles):
    roles["host-p"].mailbox["Projects"].append(make_msg(
        50, frm="x@y.example", subject="already here", msgid="<keep@y>"))
    r = client.get("/api/account_copy/space",
                   params={"target": "proton", "folder": "Projects"})
    assert r.json()["exists"] is True and r.json()["reserved"] is False
    r = client.get("/api/account_copy/space",
                   params={"target": "proton", "folder": "From gmail"})
    assert r.json()["exists"] is False
    _start(folder="Projects")
    job = _wait()
    assert job["status"] == "done" and job["folder"] == "Projects"
    held = roles["host-p"].mailbox["Projects"]
    assert len(held) == 8 and "<keep@y>" in {m["msgid"] for m in held}
    assert not [c for c in roles["host-p"].commands if c[0] == "CREATE"]


def test_the_folder_is_created_in_the_servers_personal_namespace(env):
    """A server that only allows folders below INBOX.: NAMESPACE says so."""
    env["host-p"] = FakeIMAP({"INBOX": [], "INBOX.Sent": [], "INBOX.Trash": []},
                             delimiter=".", namespace="INBOX.")
    _start(folder="Old mail")
    job = _wait()
    assert job["status"] == "done", job
    assert job["folder"] == "Old mail"
    assert len(env["host-p"].mailbox["INBOX.Old mail"]) == 7
    assert ("SUBSCRIBE", "INBOX.Old mail") in env["host-p"].commands


def test_without_namespace_the_prefix_of_the_existing_folders_is_used(env):
    env["host-p"] = FakeIMAP({"INBOX": [], "INBOX.Sent": [], "INBOX.Drafts": []},
                             delimiter=".")
    _start()
    job = _wait()
    assert job["status"] == "done"
    assert len(env["host-p"].mailbox["INBOX.From gmail"]) == 7


def test_the_separator_is_replaced_and_the_real_name_is_shown(env):
    env["host-p"] = FakeIMAP({"INBOX": []}, delimiter=".")
    r = _start(folder="Old.mail")
    assert r.json()["job"]["folder"] == "Old-mail"
    job = _wait()
    assert job["folder"] == "Old-mail"
    assert "Old-mail" in env["host-p"].mailbox


# ---------------------------------------- the checks of a chunk stay targeted

def test_each_chunk_is_verified_with_a_search_above_the_highest_uid(
        env, monkeypatch):
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)
    _start()
    assert _wait()["status"] == "done"
    cmds = [c for c in env["host-p"].commands
            if c[0] == "UID" and c[1] == "SEARCH"]
    ranged = [c for c in cmds if "UID" in c[2:]]
    assert len(ranged) == 4                # one targeted search per chunk
    # the copy lists the folder once, at its start (the scan that follows
    # the copy lists everything again)
    before = cmds[:cmds.index(ranged[-1])]
    assert [c for c in before if c[2:] == (None, "ALL") or c[2:] == ("ALL",)
            ] and len([c for c in before if "ALL" in c]) == 1
    assert [c[-1] for c in ranged] == ["1:*", "3:*", "5:*", "7:*"]


# --------------------------------------------------------- threads and errors

def test_a_double_resume_starts_one_worker(env, monkeypatch):
    import threading
    monkeypatch.setattr(accountcopy, "CHUNK_MAILS", 2)
    calls = []

    def hook(name, flags, date_time, message):
        calls.append(1)
        if len(calls) == 3:
            client.post("/api/account_copy/pause")
        return None
    env["host-p"].append_hook = hook
    _start()
    assert _wait()["status"] == "paused"
    ran = []
    real = accountcopy._work
    monkeypatch.setattr(accountcopy, "_work",
                        lambda: (ran.append(1), real())[1])
    gate = threading.Barrier(2)
    answers = []

    def press():
        gate.wait()
        try:
            answers.append(accountcopy.resume())
        except Exception as exc:       # noqa: BLE001
            answers.append(exc)
    threads = [threading.Thread(target=press) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    job = _wait()
    assert job["status"] == "done" and len(answers) == 2
    assert len(ran) == 1                                   # one worker
    ids = [m["msgid"] for m in _folder(env)]
    assert len(ids) == 7 and len(set(ids)) == 7


def test_a_thread_only_removes_its_own_registration(env):
    import threading
    other = threading.Thread()
    accountcopy._THREADS["default"] = other
    accountcopy._run([])                       # a thread that never registered
    accountcopy._run([threading.Thread()])     # one that is not the current
    assert accountcopy._THREADS["default"] is other
    accountcopy._THREADS.clear()


def test_a_second_spawn_while_one_runs_does_nothing(env):
    import threading
    sentinel = threading.Thread()
    accountcopy._THREADS["default"] = sentinel
    accountcopy._spawn(tenants.current())
    assert accountcopy._THREADS["default"] is sentinel
    accountcopy._THREADS.clear()


def test_an_error_names_the_host_of_the_side_that_failed(env, monkeypatch):
    real = mailops.connect
    calls = {"host-p": 0}

    def connect(im, name=None):
        if im["host"] == "host-p":
            calls["host-p"] += 1
            if calls["host-p"] > 2:              # start() read it fine twice
                raise ConnectionRefusedError()
        return real(im, name)
    monkeypatch.setattr(mailops, "connect", connect)
    _start()
    job = _wait()
    assert job["status"] == "error" and job["error"] == "conn_refused:host=host-p"
    monkeypatch.setattr(mailops, "connect", real)
    accountcopy.cancel()
    accountcopy.dismiss()
    real2 = mailops.connect

    seen = {"n": 0}

    def connect2(im, name=None):
        if im["host"] == "host-g":
            seen["n"] += 1
            if seen["n"] > 1:                # start() read it fine once
                raise ConnectionRefusedError()
        return real2(im, name)
    monkeypatch.setattr(mailops, "connect", connect2)
    _start()
    job = _wait()
    assert job["error"] == "conn_refused:host=host-g"


def test_start_names_the_target_host_when_it_cannot_be_reached(env, monkeypatch):
    real = mailops.connect

    def connect(im, name=None):
        if im["host"] == "host-p":
            raise ConnectionRefusedError()
        return real(im, name)
    monkeypatch.setattr(mailops, "connect", connect)
    r = _start()
    assert (r.status_code, r.json()["detail"]) == (409, "conn_refused:host=host-p")


def test_a_bulk_sender_nobody_writes_to_is_a_newsletter_for_tell_them(env):
    for m in accountsmod.get("gmail").index.values():
        if m["addr"] == "misc@misc.example":
            m["unsub"] = "<https://misc.example/u>"
    body = client.get("/api/account_copy/tell",
                      params={"source": "gmail", "target": "proton"}).json()
    assert "misc@misc.example" not in [s["addr"] for s in body["senders"]]
    assert "misc@misc.example" in body["newsletter_keys"]
    # ... but never one the user writes to or protects
    for m in accountsmod.get("gmail").index.values():
        if m["addr"] in ("friend@friends.example", "boss@work.example"):
            m["unsub"] = "<https://x.example/u>"
    body = client.get("/api/account_copy/tell",
                      params={"source": "gmail", "target": "proton"}).json()
    kept = [s["addr"] for s in body["senders"]]
    assert "friend@friends.example" in kept and "boss@work.example" in kept
