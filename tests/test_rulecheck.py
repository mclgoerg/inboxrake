"""Rule checkup (backend/rulecheck.py): overlap / conflict between rules on the
mails they would REALLY act on (retention, pins, Keep-safe, protected senders
and the per-run cap respected), a "move" target that is gone, rules that never
match / only meet protected mail, old reports, purge rules compared with each
other, Ignore (per tenant + account), and that nothing is ever changed by it."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import rulecheck
from backend import rulecheckstore
from backend import rules as rulesmod
from backend import tenants
from backend.main import app

from conftest import FakeIMAP, make_msg

client = TestClient(app)

FORUM = "forum@old.example"
RETRO = "retro@old.example"
SHOP = "news@shop.example"


def ago(days: float) -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(time.time() - days * 86400))


def forum_mails(start=1, ages=(500, 450, 400, 350, 300, 250, 200, 150)):
    return [make_msg(start + i, frm=f'"Old Forum" <{FORUM}>',
                     subject=f"Thread digest {i}", date=ago(a), seen=True)
            for i, a in enumerate(ages)]


@pytest.fixture
def box(monkeypatch):
    """Eight forum mails (150-500 days old), six retro mails, four shop mails
    and one friend, scanned."""
    fake = FakeIMAP({
        "INBOX": forum_mails(1) + [
            make_msg(20 + i, frm=f'"Retro Weekly" <{RETRO}>',
                     subject=f"Issue {i}", date=ago(a), seen=True)
            for i, a in enumerate((600, 500, 400, 300, 200, 100))] + [
            make_msg(40 + i, frm=f'"Shop" <{SHOP}>', subject=f"Deal {i}",
                     date=ago(a))
            for i, a in enumerate((5, 10, 20, 400))] + [
            make_msg(60, frm="Alice <alice@friends.example>",
                     subject="Hello", date=ago(3), seen=True)],
        "Archive": [], "Receipts": [], "Sent": [], "Trash": [], "Spam": [],
    })
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


def make(name, query, action="trash", **kw):
    return rulesmod.create_rule({"name": name, "query": query,
                                 "action": action, **kw})


def check():
    return rulecheck.checkup(accountsmod.get())


def kinds(res):
    return [f["kind"] for f in res["findings"]]


def of(res, kind):
    return [f for f in res["findings"] if f["kind"] == kind]


# ------------------------------------------------------------------ overlap

def test_keep_newest_against_trash_all_is_an_overlap(box):
    keep = make("Keep the latest 2", "old.example", keep_latest=2)
    sweep = make("Sweep the forum", "forum")
    res = check()
    assert kinds(res) == ["overlap"]
    f = res["findings"][0]
    assert f["rules"] == [keep["id"], sweep["id"]]
    assert f["defeated"] == keep["id"] and f["by"] == sweep["id"]
    assert f["n"] == 2                       # the newest 2 of the forum
    assert f["keep_latest"] == 2 and f["older_than_days"] is None
    # the senders both rules match: only the forum (the sweep is only that)
    assert [s["addr"] for s in f["senders"]] == [FORUM]
    assert f["senders"][0]["n"] == 2 and f["senders"][0]["label"] == "Old Forum"
    assert f["compare"] == {"unit": "senders", "only_a": 1, "both": 1,
                            "only_b": 0}
    assert not f["ignored"]


def test_the_overlap_names_the_mails_for_show_the_mails(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    f = check()["findings"][0]
    got = client.get("/api/mails", params={"finding": f["id"]}).json()
    assert got["total"] == 2
    assert {m["addr"] for m in got["mails"]} == {FORUM}
    # the two NEWEST forum mails: the ones keep-latest leaves
    assert sorted(m["uid"] for m in got["mails"]) == [7, 8]


def test_older_than_is_a_keep_window_too(box):
    old = make("Only the old ones", "forum", older_than_days=320)
    make("Sweep the forum", "forum")
    f = of(check(), "overlap")[0]
    assert f["defeated"] == old["id"] and f["older_than_days"] == 320
    assert f["n"] == 4                      # the mails of 300, 250, 200, 150 days


def test_same_retention_on_the_same_senders_is_no_overlap(box):
    make("Keep 2 (a)", "forum", keep_latest=2)
    make("Keep 2 (b)", "forum", keep_latest=2)
    assert check()["findings"] == []


def test_the_slower_of_two_older_than_rules_never_holds(box):
    quick = make("Older than 1 year", "forum", older_than_days=365)
    slow = make("Older than 2 years", "forum", older_than_days=730)
    f = of(check(), "overlap")
    # the quicker rule takes the year-old mails the slower one waits for
    assert len(f) == 1 and f[0]["defeated"] == slow["id"]
    assert f[0]["by"] == quick["id"] and f[0]["n"] == 3


def test_a_narrower_keep_in_the_other_rule_still_defeats(box):
    make("Keep 5", "forum", keep_latest=5)
    make("Keep 1", "forum", keep_latest=1)
    f = of(check(), "overlap")
    assert len(f) == 1 and f[0]["n"] == 4    # newest 5 minus the newest 1


def test_the_cap_decides_what_a_run_touches(box, monkeypatch):
    # the sweep's group (8 mails) does not fit the cap of 3: a run would
    # take nothing of it, so there is nothing to clash over
    monkeypatch.setattr(rulesmod, "RULE_CAP", 3)
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    assert of(check(), "overlap") == []
    monkeypatch.setattr(rulesmod, "RULE_CAP", 500)
    assert len(of(check(), "overlap")) == 1


def test_pinned_mails_are_not_taken_so_no_overlap_on_them(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    for uid in (7, 8):                       # the two the keep-rule leaves
        pinstore.set_pinned(f"<m{uid}@shop.example>", True,
                            accountsmod.default_name())
    assert of(check(), "overlap") == []


def test_keep_safe_mails_are_not_taken_by_a_trash_rule(box):
    cfgmod.update_config({"keep_safe": {"rules": True, "invoices": True}})
    # the forum's two newest mails look like invoices
    acc = accountsmod.get()
    for uid in (7, 8):
        acc.index[mailops.ikey("INBOX", uid)]["subject"] = f"Invoice no. {uid}"
    make("Keep the latest 2", "old.example", keep_latest=2)
    sweep = make("Sweep the forum", "forum")
    assert of(check(), "overlap") == []
    # an ARCHIVE rule is not softened by Keep-safe: it takes them, and it
    # sends them somewhere else than the trash rule would
    rulesmod.delete_rule(sweep["id"])
    make("Archive the forum", "forum", action="archive")
    assert len(of(check(), "conflict")) == 1


def test_protected_senders_are_out_of_every_comparison(box):
    cfgmod.update_config({"protected": [FORUM]})
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    res = check()
    assert of(res, "overlap") == []
    # ... and the sweep only meets a protected sender
    assert kinds(res) == ["only_protected"]


def test_mark_read_rules_never_clash(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Read the forum", "forum", action="mark_read")
    assert check()["findings"] == []


def test_a_block_rule_takes_part_like_a_trash_rule(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    r = client.post("/api/block", json={"grouping": "sender", "key": FORUM,
                                        "label": "Old Forum"}).json()["rule"]
    f = of(check(), "overlap")
    assert len(f) == 1 and r["id"] in f[0]["rules"]
    # and a Block rule is never reported as idle
    assert of(check(), "never_matches") == []


# ----------------------------------------------------------------- conflict

def test_archive_against_trash_on_the_same_mails_is_a_conflict(box):
    first = make("Archive the forum", "forum", action="archive")
    second = make("Sweep the forum", "forum")
    f = of(check(), "conflict")
    assert len(f) == 1 and of(check(), "overlap") == []
    f = f[0]
    assert f["rules"] == [first["id"], second["id"]]
    assert f["first"] == first["id"]          # created first, acts first
    assert f["n"] == 8
    assert f["senders"][0]["addr"] == FORUM and f["senders"][0]["n"] == 8
    assert f["compare"] == {"unit": "mails", "only_a": 0, "both": 8,
                            "only_b": 0}
    got = client.get("/api/mails", params={"finding": f["id"]}).json()
    assert got["total"] == 8


def test_two_folders_are_a_conflict_the_same_folder_is_not(box):
    a = make("To receipts", "forum", action="move", dest="Receipts")
    b = make("To archive", "forum", action="move", dest="Archive")
    assert [f["rules"] for f in of(check(), "conflict")] == [[a["id"], b["id"]]]
    c = make("Also to receipts", "forum", action="move", dest="Receipts")
    pairs = [f["rules"] for f in of(check(), "conflict")]
    assert [a["id"], b["id"]] in pairs and [b["id"], c["id"]] in pairs
    assert [a["id"], c["id"]] not in pairs


def test_same_action_on_the_same_mails_is_harmless(box):
    make("Sweep one", "forum")
    make("Sweep two", "forum")
    assert check()["findings"] == []


# -------------------------------------------------------- single-rule checks

def test_a_move_target_that_is_gone(box):
    r = make("Receipts away", "shop", action="move", dest="Gone",
             schedule="daily")
    f = of(check(), "dest_missing")
    assert len(f) == 1 and f[0]["rules"] == [r["id"]]
    assert f[0]["folder"] == "Gone" and f[0]["due"] is True
    rulesmod.delete_rule(r["id"])
    make("Receipts there", "shop", action="move", dest="Receipts")
    assert of(check(), "dest_missing") == []


def test_a_manual_rule_with_a_gone_target_is_not_due(box):
    make("Receipts away", "shop", action="move", dest="Gone")
    assert of(check(), "dest_missing")[0]["due"] is False


def test_only_protected_and_pinned_mail(box):
    cfgmod.update_config({"protected": [SHOP]})
    only_prot = make("Shop sweep", "shop")
    fp = of(check(), "only_protected")
    assert [f["rules"] for f in fp] == [[only_prot["id"]]]
    assert fp[0]["protected"] == 1 and fp[0]["pinned"] == 0
    cfgmod.update_config({"protected": []})
    assert of(check(), "only_protected") == []
    # every mail of the retro sender pinned
    acc = accountsmod.get()
    for uid in range(20, 26):
        pinstore.set_pinned(f"<m{uid}@shop.example>", True, acc.name)
    pinned_only = make("Retro sweep", "retro")
    fp = of(check(), "only_protected")
    assert [f["rules"] for f in fp] == [[pinned_only["id"]]]
    assert fp[0]["pinned"] == 6
    # a mark-read rule does not care about pins
    rulesmod.delete_rule(pinned_only["id"])
    make("Retro read", "retro", action="mark_read")
    assert of(check(), "only_protected") == []


def write_audit(rule, counts_days, outcome="ok", action="rule_report",
                kept_safe=0):
    """Audit entries of `rule`'s runs: [(count, days ago)], any order."""
    with rulesmod._LOCK:                 # the rule is older than its runs
        rules = rulesmod.load_rules()
        for r in rules:
            if r["id"] == rule["id"]:
                r["created"] = int(time.time() - 100 * 86400)
                r.pop("edited", None)
        rulesmod._save(rules)
    path = auditlog._path()
    with path.open("a") as f:
        for count, days in counts_days:
            f.write(json.dumps({
                "ts": int(time.time() - days * 86400), "account":
                accountsmod.default_name(), "actor": f"rule:{rule['id']}",
                "action": action, "count": count, "bytes": 0, "label": "",
                "outcome": outcome, "error": "",
                **({"kept_safe": kept_safe} if kept_safe else {})}) + "\n")


def test_a_rule_that_found_nothing_in_its_last_runs(box):
    r = make("Nothing here", "nobody-sends-this")
    write_audit(r, [(0, 30), (0, 20), (0, 10), (0, 3)])
    f = of(check(), "never_matches")
    assert len(f) == 1 and f[0]["rules"] == [r["id"]]
    assert f[0]["runs"] == 4
    assert abs(f[0]["since"] - (time.time() - 30 * 86400)) < 60


def test_never_matches_needs_enough_runs_over_enough_days(box):
    few = make("Few runs", "nobody-sends-this")
    write_audit(few, [(0, 9), (0, 5)])                  # two runs: too few
    quick = make("Quick runs", "nobody-sends-that")
    write_audit(quick, [(0, 1.5), (0, 1.0), (0, 0.5)])  # three, within 2 days
    assert of(check(), "never_matches") == []
    write_audit(few, [(0, 2.5)])                        # a third, over 9 days
    assert [f["rules"] for f in of(check(), "never_matches")] \
        == [[few["id"]]]


def test_a_run_that_found_something_resets_the_count(box):
    r = make("Sometimes", "nobody-sends-this")
    write_audit(r, [(0, 40), (4, 30), (0, 20), (0, 10), (0, 3)])
    assert of(check(), "never_matches")[0]["runs"] == 3
    write_audit(r, [(2, 1)])
    assert of(check(), "never_matches") == []


def test_failed_runs_and_older_definitions_say_nothing(box):
    r = make("Nothing here", "nobody-sends-this")
    write_audit(r, [(0, 30), (0, 20), (0, 10)], outcome="error")
    assert of(check(), "never_matches") == []
    write_audit(r, [(0, 30), (0, 20), (0, 10)])
    assert len(of(check(), "never_matches")) == 1
    # the filter is edited: the older runs were of another definition
    rulesmod.update_rule(r["id"], {"query": "nobody-sends-that"})
    assert of(check(), "never_matches") == []


def test_keep_safe_leftovers_are_not_idle(box):
    r = make("Nothing here", "nobody-sends-this")
    write_audit(r, [(0, 30), (0, 20), (0, 10)], kept_safe=3)
    assert of(check(), "never_matches") == []


def test_it_matches_now_so_it_is_not_idle(box):
    r = make("Shop sweep", "shop")
    write_audit(r, [(0, 30), (0, 20), (0, 10)])          # old runs: nothing
    assert of(check(), "never_matches") == []            # but it matches now


def test_block_and_a_blank_purge_rule_may_sit_idle(box):
    blocked = client.post("/api/block", json={
        "grouping": "sender", "key": "gone@nowhere.example",
        "label": "Gone"}).json()["rule"]
    write_audit(blocked, [(0, 30), (0, 20), (0, 10)], action="rule_execute")
    trash = rulesmod.create_rule({"name": "Empty Trash", "scope": "trash",
                                  "older_than_days": 30})
    write_audit(trash, [(0, 30), (0, 20), (0, 10)])
    assert of(check(), "never_matches") == []
    filtered = rulesmod.create_rule({
        "name": "Trash from one sender", "scope": "trash",
        "query": "from:x@old.example", "older_than_days": 30})
    write_audit(filtered, [(0, 30), (0, 20), (0, 10)])
    assert [f["rules"] for f in of(check(), "never_matches")] \
        == [[filtered["id"]]]


def test_a_report_only_rule_with_an_old_report(box):
    r = make("Old report", "shop")
    now = time.time()
    with rulesmod._LOCK:
        rules = rulesmod.load_rules()
        rules[0]["last_run"] = {"ts": int(now - 40 * 86400), "mode": "report",
                                "mails": 4, "groups": 1, "acted": 0,
                                "capped": 0, "skipped_protected": 0,
                                "skipped_pinned": 0, "preview": [],
                                "error": ""}
        rulesmod._save(rules)
    f = of(check(), "stale_report")
    assert len(f) == 1 and f[0]["rules"] == [r["id"]] and f[0]["days"] == 40
    with rulesmod._LOCK:
        rules = rulesmod.load_rules()
        rules[0]["last_run"]["ts"] = int(now - 29 * 86400)
        rulesmod._save(rules)
    assert of(check(), "stale_report") == []
    with rulesmod._LOCK:
        rules = rulesmod.load_rules()
        rules[0]["last_run"]["ts"] = int(now - 90 * 86400)
        rules[0].update(mode="execute", report_runs=1,   # armed: Active
                        report_sig=rulesmod.definition_sig(rules[0]),
                        report_box=rulesmod.box_sig(rules[0]))
        rulesmod._save(rules)
    assert rulesmod.load_rules()[0]["mode"] == "execute"
    assert of(check(), "stale_report") == []


# ------------------------------------------------------------- purge rules

def purge(name, scope="trash", query="", days=30):
    return rulesmod.create_rule({"name": name, "scope": scope, "query": query,
                                 "older_than_days": days})


def test_purge_rules_are_compared_only_with_each_other(box):
    slow = purge("Wait 30 days", query="from:x@old.example", days=30)
    quick = purge("Wait 7 days", days=7)             # every sender, sooner
    f = of(check(), "overlap")
    assert len(f) == 1 and f[0]["purge"] is True
    assert f[0]["defeated"] == slow["id"] and f[0]["by"] == quick["id"]
    assert f[0]["scope"] == "trash" and f[0]["senders"] == []
    assert f[0]["older_than_days"] == 30 and f[0]["winner_days"] == 7


def test_purge_rules_of_other_folders_or_other_senders_do_not_clash(box):
    purge("Trash 30", days=30)
    purge("Junk 7", scope="junk", days=7)
    purge("Trash one sender", query="from:a@x.example", days=7)
    purge("Trash other sender", query="from:b@x.example", days=3)
    assert check()["findings"] == []


def test_a_purge_rule_is_never_compared_with_a_mail_rule(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    purge("Wait 7 days", days=7)
    assert check()["findings"] == []


# ------------------------------------------------------------------ ignore

def test_ignore_is_kept_per_finding_and_can_be_undone(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    fp = check()["findings"][0]["id"]
    r = client.post("/api/rules/checkup/ignore", json={"id": fp})
    assert r.status_code == 200
    assert check()["findings"][0]["ignored"] is True
    rulecheckstore._cache.clear()                    # persisted, too
    assert check()["findings"][0]["ignored"] is True
    client.post("/api/rules/checkup/ignore", json={"id": fp, "ignored": False})
    assert check()["findings"][0]["ignored"] is False


def test_an_edited_rule_brings_its_finding_back(box):
    keep = make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    fp = check()["findings"][0]["id"]
    rulecheckstore.set_ignored(fp, True)
    rulesmod.update_rule(keep["id"], {"keep_latest": 3})
    f = check()["findings"][0]
    assert f["id"] != fp and f["ignored"] is False


def test_ignore_rejects_a_bad_id(box):
    assert client.post("/api/rules/checkup/ignore",
                       json={"id": "../x"}).status_code == 400
    assert client.post("/api/rules/checkup/ignore",
                       json={"id": "A" * 16}).status_code == 400


def test_ignore_follows_an_account_rename_and_drop():
    fp = "0123456789abcdef"
    rulecheckstore.set_ignored(fp, True, "one")
    rulecheckstore.rename_account("one", "uno")
    assert rulecheckstore.ignored("one") == set()
    assert rulecheckstore.ignored("uno") == {fp}
    rulecheckstore._cache.clear()
    assert rulecheckstore.ignored("uno") == {fp}
    rulecheckstore.drop_account("uno")
    assert rulecheckstore.ignored("uno") == set()
    rulecheckstore._cache.clear()
    assert rulecheckstore.ignored("uno") == set()


def test_the_config_endpoint_renames_and_drops_the_ignore_list():
    fp = "0123456789abcdef"
    rulecheckstore.set_ignored(fp, True, "default")
    r = client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "main"}})
    assert r.status_code == 200, r.text
    assert rulecheckstore.ignored("main") == {fp}
    assert rulecheckstore.ignored("default") == set()
    cfgmod.update_config({"add_account": "two"})
    rulecheckstore.set_ignored(fp, True, "two")
    client.post("/api/config", json={"delete_account": "two"})
    assert rulecheckstore.ignored("two") == set()
    assert rulecheckstore.ignored("main") == {fp}


def test_ignore_is_per_account_and_per_tenant():
    fp = "0123456789abcdef"
    rulecheckstore.set_ignored(fp, True, "one")
    assert rulecheckstore.ignored("two") == set()
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert rulecheckstore.ignored("one") == set()
        rulecheckstore.set_ignored("fedcba9876543210", True, "one")
        assert rulecheckstore.ignored("one") == {"fedcba9876543210"}
    assert rulecheckstore.ignored("one") == {fp}
    assert (alice.root / "rule_checkup.json").is_file()


@pytest.mark.parametrize("content", [
    "{not json", "", "[]", "null", '{"accounts": []}',
    '{"accounts": {"a": "nope"}}', '{"accounts": {"a": {"ignored": "x"}}}',
    b"\xff\xfegarbage"])
def test_a_damaged_file_only_forgets(tmp_path, content):
    path = tmp_path / "rule_checkup.json"
    path.write_bytes(content if isinstance(content, bytes)
                     else content.encode())
    rulecheckstore._cache.clear()
    assert rulecheckstore.ignored("a") == set()
    rulecheckstore.set_ignored("0123456789abcdef", True, "a")   # recovers
    rulecheckstore._cache.clear()
    assert rulecheckstore.ignored("a") == {"0123456789abcdef"}


def test_the_ignore_list_is_capped(tmp_path):
    for i in range(rulecheckstore.MAX_IGNORED + 5):
        rulecheckstore.set_ignored(f"{i:016x}", True, "a")
    got = rulecheckstore.ignored("a")
    assert len(got) == rulecheckstore.MAX_IGNORED
    assert f"{0:016x}" not in got and f"{rulecheckstore.MAX_IGNORED + 4:016x}" in got


# -------------------------------------------- it only looks, it changes nothing

def test_nothing_is_changed_by_a_checkup(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    make("Receipts away", "shop", action="move", dest="Gone")
    with rulesmod._LOCK:                      # Active rules, as in real use
        rules = rulesmod.load_rules()
        for r in rules:
            r.update(mode="execute", report_runs=1,
                     report_sig=rulesmod.definition_sig(r),
                     report_box=rulesmod.box_sig(r))
        rulesmod._save(rules)
    assert {r["mode"] for r in rulesmod.load_rules()} == {"execute"}
    rules_before = rulesmod._path().read_text()
    audit_before = auditlog._path().exists() and auditlog._path().read_text()
    mail_before = {f: [m["uid"] for m in ms]
                   for f, ms in box.mailbox.items()}
    commands = len(box.commands)
    res = client.get("/api/rules/checkup").json()
    assert {"overlap", "dest_missing"} <= {f["kind"] for f in res["findings"]}
    assert rulesmod._path().read_text() == rules_before
    assert (auditlog._path().exists() and auditlog._path().read_text()) \
        == audit_before                       # not even a log entry
    assert {f: [m["uid"] for m in ms]
            for f, ms in box.mailbox.items()} == mail_before
    assert len(box.commands) == commands             # no IMAP traffic
    assert len(mailops.UNDO_LOG) == 0


def test_no_scan_yet_only_the_checks_that_need_none(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    make("Sweep the forum", "forum")
    accountsmod.reset()                              # a fresh start, no scan
    res = check()
    assert res["analysed"] is False and res["needs_scan"] is True
    assert res["findings"] == []


def test_other_accounts_rules_are_not_part_of_this_checkup(box):
    make("Keep the latest 2", "old.example", keep_latest=2)
    other = make("Sweep the forum", "forum")
    with rulesmod._LOCK:
        rules = rulesmod.load_rules()
        for r in rules:
            if r["id"] == other["id"]:
                r["account"] = "elsewhere"
        rulesmod._save(rules)
    assert check()["findings"] == []


def test_the_endpoint_answers_for_an_account_and_refuses_an_unknown_one(box):
    assert client.get("/api/rules/checkup").json()["findings"] == []
    assert client.get("/api/rules/checkup",
                      params={"account": "nope"}).status_code == 400
    assert client.get("/api/mails", params={"finding": "zz"}).status_code == 400
    # a finding nobody knows lists nothing
    assert client.get("/api/mails", params={
        "finding": "0123456789abcdef"}).json()["total"] == 0


def test_a_rule_edit_records_when_the_definition_changed(box):
    r = make("Shop sweep", "shop")
    created = rulesmod.load_rules()[0]["edited"]
    assert abs(created - time.time()) < 5
    rulesmod.update_rule(r["id"], {"name": "Renamed"})
    assert rulesmod.load_rules()[0]["edited"] == created   # a name is no edit
    with rulesmod._LOCK:
        rules = rulesmod.load_rules()
        rules[0]["edited"] = 1
        rulesmod._save(rules)
    rulesmod.update_rule(r["id"], {"query": "shop deal"})
    assert rulesmod.load_rules()[0]["edited"] > 1
