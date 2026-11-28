"""You keep doing this (backend/habits.py): what a manual step records in the
audit log (habitlog.py), the miner (>= 3 times on >= 3 days in 60 days, undone
steps and other actors do not count, rounding, schedule), the filters
(protected, an existing rule, hidden senders, the Settings switch), the
hidden-sender store per tenant and account, and the API."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import habitlog
from backend import habits
from backend import habitstore
from backend import mailops
from backend import rules as rulesmod
from backend import tenants
from backend.main import app

from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)

DAY = 86400
CARRIER = "noreply@dhl.example"   # the shared conftest fixture sender
CARRIER_LABEL = "DHL Paket"
NEWS = "news@shop.example"


@pytest.fixture(autouse=True)
def _hidden_store(tmp_path, monkeypatch):
    monkeypatch.setattr(habitstore, "HIDDEN_PATH", tmp_path / "hidden.json")
    habitstore._cache.clear()
    yield
    habitstore._cache.clear()


def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def entries(account="default"):
    return auditlog.load(account, 0, 10_000)["entries"]


# ------------------------------------------------------------ audit facts

NOW = 1_800_000_000


def test_step_facts_names_senders_unread_and_youngest_age():
    mails = [("a@x.example", NOW - 10 * DAY, False),
             ("a@x.example", NOW - 3 * DAY - 5, True),
             ("a@x.example", 0, False)]                   # no date: skipped
    f = habitlog.step_facts(mails, "trash", "", NOW)
    assert f == {"keys": ["a@x.example"], "unread": 2, "youngest_days": 3}


def test_step_facts_per_sender_only_when_several():
    mails = [("a@x.example", NOW - 5 * DAY, False),
             ("b@x.example", NOW - 9 * DAY, True)]
    f = habitlog.step_facts(mails, "archive", "", NOW)
    assert f["keys"] == ["a@x.example", "b@x.example"]
    assert f["per"] == {
        "a@x.example": {"n": 1, "unread": 1, "youngest_days": 5},
        "b@x.example": {"n": 1, "unread": 0, "youngest_days": 9}}
    assert "per" not in habitlog.step_facts(mails[:1], "archive", "", NOW)


def test_step_facts_move_carries_its_target_and_mark_read_no_age():
    mails = [("a@x.example", NOW - DAY, False)]
    assert habitlog.step_facts(mails, "move", "Finance", NOW)["dest"] == \
        "Finance"
    f = habitlog.step_facts(mails, "mark_read", "", NOW)
    assert "youngest_days" not in f and f["unread"] == 1
    assert "dest" not in f


def test_step_facts_zero_is_a_fact_and_nothing_to_say_is_empty():
    f = habitlog.step_facts([("a@x.example", NOW - 100, True)], "trash", "",
                            NOW)
    assert f["unread"] == 0 and f["youngest_days"] == 0
    assert habitlog.step_facts([], "trash", "", NOW) == {}
    assert habitlog.step_facts([("", NOW, True)], "trash", "", NOW) == {}
    assert habitlog.step_facts([("a@x.example", NOW, True)], "purge", "",
                               NOW) == {}
    many = [(f"s{i}@x.example", NOW, True)
            for i in range(habitlog.KEYS_CAP + 1)]
    assert habitlog.step_facts(many, "trash", "", NOW) == {}


def test_manual_trash_records_keys_unread_and_youngest_age(bridge):
    scan(bridge)
    mailops.delete_groups("sender", [CARRIER])
    wait_delete_done()
    e = [x for x in entries() if x["action"] == "trash"][-1]
    assert e["keys"] == [CARRIER]
    assert e["unread"] == 1                 # uid 1 unread, 2 and 10 read
    assert e["youngest_days"] == 3
    assert "per" not in e and "dest" not in e


def test_manual_mark_read_and_move_record_their_facts(bridge):
    scan(bridge)
    mailops.delete_groups("sender", [NEWS], "mark_read")
    wait_delete_done()
    mr = [x for x in entries() if x["action"] == "mark_read"][-1]
    assert mr["keys"] == [NEWS] and mr["unread"] == 1
    assert "youngest_days" not in mr
    mailops.delete_groups("sender", ["alice@friends.example"], "move",
                          "Archive")
    wait_delete_done()
    mv = [x for x in entries() if x["action"] == "move"][-1]
    assert mv["keys"] == ["alice@friends.example"] and mv["dest"] == "Archive"


def test_a_selection_of_mails_names_every_sender(bridge):
    scan(bridge)
    mailops.delete_messages([["INBOX", 3], ["INBOX", 4]])
    wait_delete_done()
    e = [x for x in entries() if x["action"] == "trash"][-1]
    assert e["keys"] == ["alice@friends.example", NEWS]
    assert set(e["per"]) == set(e["keys"])
    assert e["per"][NEWS]["unread"] == 1 and e["per"]["alice@friends.example"][
        "unread"] == 0


def test_a_record_missing_its_fields_never_breaks_the_step(bridge):
    # the habit facts are read from the index before the mails leave it: a
    # record without its sender must not stop the step or lose its undo
    # entry (see test_sender_changes), it just names nobody
    scan(bridge)
    acc = accountsmod.get("default")
    with acc.lock:
        for m in acc.index.values():
            if m["addr"] == CARRIER:
                m.pop("addr")
    mailops.delete_groups("sender", [CARRIER])
    d = wait_delete_done()
    assert d["moved"] >= 1 and acc.undo_log
    e = [x for x in entries() if x["action"] == "trash"][-1]
    assert e["outcome"] == "ok" and "keys" not in e


def test_rule_and_assistant_steps_carry_no_habit_facts(bridge):
    scan(bridge)
    mailops.delete_groups("sender", [CARRIER], actor="rule:abc12345")
    wait_delete_done()
    scan(bridge)
    mailops.delete_groups("sender", [NEWS], "archive", actor="mcp:Helper")
    wait_delete_done()
    done = [e for e in entries() if e["action"] in ("trash", "archive")]
    assert len(done) == 2
    for e in done:
        assert "keys" not in e and "unread" not in e


def test_a_failed_step_carries_no_habit_facts(bridge, monkeypatch):
    scan(bridge)

    def boom(*a, **kw):
        raise RuntimeError("server exploded")
    monkeypatch.setattr(mailops, "_move_uids", boom)
    mailops.delete_groups("sender", [CARRIER])
    wait_delete_done()
    e = entries()[-1]
    assert e["outcome"] == "error" and "keys" not in e


def test_old_entries_without_keys_are_ignored_by_the_miner():
    old = [{"ts": NOW - i * 10 * DAY, "account": "default", "actor": "user",
            "action": "trash", "count": 5, "bytes": 0, "label": "Shop",
            "outcome": "ok", "error": "", "id": f"{i:x}"} for i in range(4)]
    assert habits.mine(old, NOW) == []


# ------------------------------------------------------------- the miner

def step(days_ago, key="a@x.example", action="trash", n=10, unread=None,
         young=8, dest="", actor="user", outcome="ok", sid=None, **extra):
    """An audit entry as `auditlog._load_all` returns it."""
    e = {"ts": NOW - int(days_ago * DAY), "account": "default",
         "actor": actor, "action": action, "count": n, "bytes": 0,
         "label": "Shop", "outcome": outcome, "error": "",
         "id": sid or f"id{days_ago}-{key.split('@')[0]}-{action}",
         "keys": [key], "unread": n if unread is None else unread}
    if young is not None and action != "mark_read":
        e["youngest_days"] = young
    if dest:
        e["dest"] = dest
    e.update(extra)
    return e


def test_three_steps_on_three_days_make_a_suggestion():
    got = habits.mine([step(30), step(20), step(10)], NOW)
    assert len(got) == 1
    c = got[0]
    assert (c["key"], c["action"], c["times"], c["days"]) == (
        "a@x.example", "trash", 3, 3)
    assert c["since"] == NOW - 30 * DAY and c["last"] == NOW - 10 * DAY


def test_two_steps_are_not_a_habit():
    assert habits.mine([step(30), step(10)], NOW) == []


def test_three_steps_on_two_days_are_not_a_habit():
    assert habits.mine([step(30), step(20), step(20.2)], NOW) == []


def test_a_step_older_than_sixty_days_does_not_count():
    assert habits.mine([step(61), step(20), step(10)], NOW) == []
    assert len(habits.mine([step(59), step(20), step(10)], NOW)) == 1


def test_undone_steps_do_not_count():
    undo = {"ts": NOW - 9 * DAY, "account": "default", "actor": "user",
            "action": "undo", "count": 10, "bytes": 0, "label": "Shop",
            "outcome": "ok", "error": "",
            "undoes": {"id": "id20-a-trash", "count": 10}}
    steps = [step(30), step(20), step(10)]
    assert habits.mine(steps, NOW) != []
    assert habits.mine([*steps, undo], NOW) == []
    # a Time machine restore names several steps at once
    tm = {**undo, "action": "restore", "undoes": None,
          "undoes_many": [{"id": "id30-a-trash", "count": 10}]}
    assert habits.mine([*steps, tm], NOW) == []
    # an undo that restored nothing cancels nothing
    nothing = {**undo, "undoes": {"id": "id20-a-trash", "count": 0}}
    assert len(habits.mine([*steps, nothing], NOW)) == 1


def test_only_the_users_own_successful_steps_count():
    for bad in ({"actor": "rule:abc"}, {"actor": "mcp:Helper"},
                {"outcome": "error"}, {"outcome": "cancelled"},
                {"from_role": "trash"}):
        steps = [step(30), step(20), step(10, **bad)]
        assert habits.mine(steps, NOW) == [], bad


def test_actions_a_rule_cannot_repeat_do_not_count():
    steps = [step(30, action="unsubscribe"), step(20, action="unsubscribe"),
             step(10, action="unsubscribe")]
    assert habits.mine(steps, NOW) == []


def test_steps_are_counted_per_action_and_per_move_target():
    mixed = [step(30), step(20, action="archive"), step(10)]
    assert habits.mine(mixed, NOW) == []
    moves = [step(30, action="move", dest="A"), step(20, action="move",
                                                      dest="B"),
             step(10, action="move", dest="A")]
    assert habits.mine(moves, NOW) == []
    same = [step(d, action="move", dest="Finance") for d in (30, 20, 10)]
    c = habits.mine(same, NOW)[0]
    assert c["action"] == "move" and c["dest"] == "Finance"
    assert c["older_than_days"] is None


def test_a_move_without_a_known_target_is_not_mined():
    assert habits.mine([step(d, action="move") for d in (30, 20, 10)],
                       NOW) == []


def test_one_suggestion_per_sender_the_stronger_habit():
    steps = [step(d) for d in (40, 30, 20, 10)] \
        + [step(d, action="archive") for d in (25, 15, 5)]
    got = habits.mine(steps, NOW)
    assert [(c["action"], c["times"]) for c in got] == [("trash", 4)]


def test_age_rounds_down_to_a_known_step_from_the_youngest_mail():
    def n_for(young):
        steps = [step(30, young=young + 6), step(20, young=young),
                 step(10, young=young + 20)]
        return habits.mine(steps, NOW)[0]["older_than_days"]
    assert [n_for(y) for y in (0, 1, 2, 3, 6, 7, 13, 14, 29, 30, 400)] == [
        1, 1, 1, 3, 3, 7, 7, 14, 14, 30, 30]


def test_no_age_for_mark_read_and_when_no_date_was_known():
    mr = [step(d, action="mark_read") for d in (30, 20, 10)]
    assert habits.mine(mr, NOW)[0]["older_than_days"] is None
    undated = [step(d, young=None) for d in (30, 20, 10)]
    assert habits.mine(undated, NOW)[0]["older_than_days"] is None


def test_age_uses_the_smallest_youngest_age_seen():
    steps = [step(30, young=40), step(20, young=9), step(10, young=100)]
    assert habits.mine(steps, NOW)[0]["older_than_days"] == 7


def test_schedule_daily_when_the_median_gap_is_under_five_days():
    daily = [step(d) for d in (12, 9, 6, 3, 0.5)]            # gaps 3,3,3,2.5
    assert habits.mine(daily, NOW)[0]["schedule"] == "daily"
    weekly = [step(d) for d in (40, 33, 19, 12, 5)]         # gaps 7,14,7,7
    assert habits.mine(weekly, NOW)[0]["schedule"] == "weekly"
    edge = [step(d) for d in (15, 10, 5, 0.5)]                # median 5 days
    assert habits.mine(edge, NOW)[0]["schedule"] == "weekly"


def test_evidence_all_unread_and_the_range_of_mails():
    steps = [step(30, n=14), step(20, n=22), step(10, n=18)]
    c = habits.mine(steps, NOW)[0]
    assert c["always_unread"] is True
    assert (c["min_n"], c["max_n"]) == (14, 22)
    assert [s["n"] for s in c["steps"]] == [14, 22, 18]
    some = [step(30, n=14), step(20, n=22, unread=3), step(10, n=18)]
    assert habits.mine(some, NOW)[0]["always_unread"] is False


def test_evidence_every_n_days_and_all_the_mails():
    # "every 3-5 days · 41 mails": the gap range in whole days between the
    # days the steps were done on, and the mails of ALL the counted steps
    # (the list of steps shown is cut at STEPS_SHOWN, the figures are not)
    steps = [step(d, n=9) for d in (20, 16, 11, 8, 3)]         # gaps 4,5,3,5
    c = habits.mine(steps, NOW)[0]
    assert (c["gap_min"], c["gap_max"]) == (3, 5)
    assert c["mails"] == 45
    many = [step(d, n=2) for d in range(1, 31)]                # a step a day
    c = habits.mine(many, NOW)[0]
    assert len(c["steps"]) == habits.STEPS_SHOWN
    assert c["mails"] == 60 and (c["gap_min"], c["gap_max"]) == (1, 1)
    # two steps on one day are one day: no gap of 0
    twice = [step(d, sid=f"t{d}") for d in (30, 20, 10)] + [
        step(10, sid="again")]
    assert habits.mine(twice, NOW)[0]["gap_min"] == 10


def test_a_multi_sender_step_uses_the_per_sender_figures():
    def both(days_ago):
        e = step(days_ago, n=30)
        e["keys"] = ["a@x.example", "b@x.example"]
        e["per"] = {"a@x.example": {"n": 20, "unread": 20, "youngest_days": 9},
                    "b@x.example": {"n": 10, "unread": 4, "youngest_days": 2}}
        e["id"] = f"both{days_ago}"
        return e
    got = {c["key"]: c for c in habits.mine(
        [both(30), both(20), both(10)], NOW)}
    assert got["a@x.example"]["max_n"] == 20 and got[
        "a@x.example"]["older_than_days"] == 7
    assert got["b@x.example"]["max_n"] == 10 and got[
        "b@x.example"]["older_than_days"] == 1
    assert got["b@x.example"]["always_unread"] is False


def test_suggestion_ids_are_stable_and_distinct():
    a = habits.mine([step(d) for d in (30, 20, 10)], NOW)[0]["id"]
    assert a == habits.mine([step(d) for d in (30, 20, 10)], NOW)[0]["id"]
    b = habits.mine([step(d, key="b@x.example") for d in (30, 20, 10)],
                    NOW)[0]["id"]
    assert a != b


# ------------------------------------------------- suggestions (the filters)

def put(rows, account="default"):
    """Append audit entries (as `step()` builds them) to this tenant's log."""
    auditlog._path().parent.mkdir(parents=True, exist_ok=True)
    with auditlog._path().open("a") as f:
        for r in rows:
            f.write(json.dumps({**r, "account": account}) + "\n")


def real_steps(key=CARRIER, **kw):
    now = time.time()
    return [{**step(d, key=key, **kw), "ts": int(now - d * DAY)}
            for d in (30, 20, 10)]


def test_suggestions_carry_the_rule_and_what_it_would_catch(bridge):
    scan(bridge)
    put(real_steps(young=7))
    got = habits.suggestions(accountsmod.get("default"))
    assert got["enabled"] is True and got["hidden"] == 0
    (s,) = got["suggestions"]
    assert s["key"] == CARRIER and s["label"] == CARRIER_LABEL
    assert s["rule"] == {"grouping": "sender", "query": f"from:{CARRIER}",
                         "action": "trash", "dest": "", "schedule": "weekly",
                         "older_than_days": 7}
    # 3 carrier mails: two 3 days old, one from 2025; only the old one is > 7 days
    assert s["catch"] == 1


def test_a_sender_with_no_mail_left_is_named_by_its_steps_label(bridge):
    # trashing the last mail of a sender removes its row: the name then comes
    # from the label the steps carried (never from a step of several senders)
    scan(bridge)
    put(real_steps(key="gone@x.example"))                  # step() says "Shop"
    (s,) = habits.suggestions(accountsmod.get("default"))["suggestions"]
    assert s["label"] == "Shop" and s["catch"] == 0
    assert "label_hint" not in s and all("label" not in x for x in s["steps"])

    def both(days_ago):
        e = step(days_ago, n=30)
        e["keys"] = ["a@x.example", "b@x.example"]
        e["per"] = {k: {"n": 15, "unread": 15} for k in e["keys"]}
        e["id"] = f"both{days_ago}"
        return e
    got = habits.mine([both(30), both(20), both(10)], NOW)
    assert got and all(c["label_hint"] == "" for c in got)


def test_catch_follows_the_rule_run_semantics_pinned_mails_are_left(bridge):
    from backend import pinstore
    scan(bridge)
    put(real_steps(action="archive", young=1))
    pinstore.set_pinned("<m10@shop.example>", True, "default")
    (s,) = habits.suggestions(accountsmod.get("default"))["suggestions"]
    assert s["catch"] == 2          # the two recent ones; the pinned one stays


def test_no_catch_number_without_a_scan():
    put(real_steps())
    (s,) = habits.suggestions(accountsmod.get("default"))["suggestions"]
    assert s["catch"] is None


def test_protected_senders_are_never_suggested(bridge):
    scan(bridge)
    put(real_steps())
    cfgmod.update_config({"protected": [CARRIER]})
    assert habits.suggestions(accountsmod.get("default"))["suggestions"] == []
    cfgmod.update_config({"protected": ["@dhl.example"]})
    assert habits.suggestions(accountsmod.get("default"))["suggestions"] == []


def test_a_sender_an_existing_rule_covers_is_skipped(bridge):
    scan(bridge)
    put(real_steps())
    acc = accountsmod.get("default")
    assert len(habits.suggestions(acc)["suggestions"]) == 1
    rule = rulesmod.create_rule({"name": "Carrier", "query": f"from:{CARRIER}",
                                 "action": "archive"})
    assert habits.suggestions(acc)["suggestions"] == []
    rulesmod.delete_rule(rule["id"])
    # a rule on the sender's domain covers it too; an unrelated rule does not
    rulesmod.create_rule({"name": "Other", "query": f"from:{NEWS}",
                          "action": "trash"})
    assert len(habits.suggestions(acc)["suggestions"]) == 1
    rulesmod.create_rule({"name": "Domain", "grouping": "domain",
                          "query": "domain:dhl.example", "action": "trash"})
    assert habits.suggestions(acc)["suggestions"] == []


def test_a_rule_covers_a_sender_with_no_mail_left(bridge):
    # "trash everything from X" leaves X no mail in the scan - the rule made
    # from the suggestion has to cover it all the same, or the card stays
    scan(bridge)
    gone = "gone@x.example"
    put(real_steps(key=gone))
    acc = accountsmod.get("default")
    assert gone not in mailops.STATE["groups"]["sender"]
    assert len(habits.suggestions(acc)["suggestions"]) == 1
    rule = rulesmod.create_rule({"name": "Gone", "query": f"from:{gone}",
                                 "action": "trash"})
    assert habits.suggestions(acc)["suggestions"] == []
    rulesmod.delete_rule(rule["id"])
    # a domain rule and a Block rule of the sender or its domain do too
    domain = rulesmod.create_rule({"name": "D", "grouping": "domain",
                                   "query": "domain:x.example",
                                   "action": "trash"})
    assert habits.suggestions(acc)["suggestions"] == []
    rulesmod.delete_rule(domain["id"])
    assert client.post("/api/block", json={
        "grouping": "sender", "key": gone, "label": "Gone"}).status_code == 200
    assert habits.suggestions(acc)["suggestions"] == []


def test_a_filter_that_needs_mails_does_not_cover_a_sender_without_any(bridge):
    scan(bridge)
    put(real_steps(key="gone@x.example"))
    acc = accountsmod.get("default")
    # (the rule names the sender AND asks something of its mails: with none
    # left it cannot be judged, so the suggestion stays - for every word
    # match_group would otherwise read off defaults)
    for query in ("tag:newsletter", "age:>1y", "unread:>50", "is:unsub",
                  "from:other@x.example", "from:gone@x.example tag:news",
                  "from:gone@x.example age:>1y", "from:gone@x.example is:unsub",
                  "from:gone@x.example eng:low",
                  "from:gone@x.example is:noreply-ever",
                  "from:gone@x.example is:not-unsubscribed",
                  "from:gone@x.example unread:>0",
                  "from:gone@x.example is:new", "from:gone@x.example has:pinned"):
        rule = rulesmod.create_rule({"name": "Q", "query": query,
                                     "action": "trash"})
        assert len(habits.suggestions(acc)["suggestions"]) == 1, query
        rulesmod.delete_rule(rule["id"])
    # plain words of the address do cover it (they only read the key)
    rule = rulesmod.create_rule({"name": "W", "query": "gone x.example",
                                 "action": "trash"})
    assert habits.suggestions(acc)["suggestions"] == []


def test_trash_everything_three_times_then_make_it_a_rule(bridge):
    # the whole flow of the demo: the sender has no mail left each time
    deals = "deals@dealsdaily.example"
    now = time.time()
    for i in range(3):
        bridge.mailbox["INBOX"].append(make_msg(
            100 + i, frm='"Deal Daily" <deals@dealsdaily.example>',
            subject=f"Today {i}", seen=False))
        scan(bridge)
        mailops.delete_groups("sender", [deals])
        wait_delete_done()
    rows = [json.loads(x) for x in auditlog._path().read_text().splitlines()]
    k = 0
    for row in rows:                     # three steps on three different days
        if row.get("keys") == [deals]:
            row["ts"] = int(now - (30, 20, 10)[k] * DAY)
            k += 1
    auditlog._path().write_text("".join(json.dumps(r) + "\n" for r in rows))
    (s,) = client.get("/api/habits").json()["suggestions"]
    assert s["key"] == deals and s["label"] == "Deal Daily" and s["catch"] == 0
    r = client.post("/api/rules", json={"name": "Trash deals", **s["rule"]})
    assert r.status_code == 200
    run = client.post(f"/api/rules/{r.json()['id']}/run").json()
    assert run["mode"] == "report" and run["error"] == ""
    assert client.get("/api/habits").json()["suggestions"] == []


def test_a_rule_of_another_account_does_not_cover(bridge, monkeypatch):
    scan(bridge)
    put(real_steps())
    cfgmod.update_config({"add_account": "other"})
    rulesmod.create_rule({"name": "Carrier", "query": f"from:{CARRIER}",
                          "action": "trash", "account": "other"})
    assert len(habits.suggestions(
        accountsmod.get("default"))["suggestions"]) == 1


def test_a_rule_saved_without_an_account_covers_the_default_account(bridge):
    # older rules carry no "account" field; they run on the default account
    scan(bridge)
    put(real_steps())
    rule = rulesmod.create_rule({"name": "Carrier", "query": f"from:{CARRIER}",
                                 "action": "trash"})
    stored = rulesmod.load_rules()
    for r in stored:
        if r["id"] == rule["id"]:
            r.pop("account", None)
    rulesmod._save(stored)
    assert habits.suggestions(accountsmod.get("default"))["suggestions"] == []


def test_hidden_senders_are_skipped_per_account_and_tenant(bridge):
    scan(bridge)
    put(real_steps())
    acc = accountsmod.get("default")
    habitstore.hide(CARRIER, "default")
    got = habits.suggestions(acc)
    assert got["suggestions"] == [] and got["hidden"] == 1
    # another account's dismissal does not hide it here
    habitstore.show_all("default")
    habitstore.hide(CARRIER, "other")
    assert len(habits.suggestions(acc)["suggestions"]) == 1
    # nor does another tenant's
    habitstore.hide(CARRIER, "default")
    bob = tenants.for_subject("bob@y.example")
    with tenants.use(bob):
        assert habitstore.hidden("default") == set()
        habitstore.hide("x@y.example", "default")
    assert habitstore.hidden("default") == {CARRIER}
    assert (bob.root / "habit_hidden.json").is_file()


def test_audit_entries_of_another_account_or_tenant_are_not_mined(bridge):
    scan(bridge)
    put(real_steps(), account="other")
    acc = accountsmod.get("default")
    assert habits.suggestions(acc)["suggestions"] == []
    bob = tenants.for_subject("bob@y.example")
    with tenants.use(bob):
        put(real_steps())
    assert habits.suggestions(acc)["suggestions"] == []
    with tenants.use(bob):
        bob_acc = accountsmod.get("default")
        assert len(habits.suggestions(bob_acc)["suggestions"]) == 1


def test_switched_off_mines_nothing(bridge):
    scan(bridge)
    put(real_steps())
    cfgmod.update_config({"habits": {"suggest": False}})
    got = habits.suggestions(accountsmod.get("default"))
    assert got == {"enabled": False, "suggestions": [], "hidden": 0}
    cfgmod.update_config({"habits": {"suggest": True}})
    assert len(habits.suggestions(
        accountsmod.get("default"))["suggestions"]) == 1


def test_setting_defaults_on_and_round_trips_through_the_config_api():
    assert client.get("/api/config").json()["habits"] == {"suggest": True}
    r = client.post("/api/config", json={"habits": {"suggest": False}})
    assert r.json()["habits"] == {"suggest": False}
    assert client.get("/api/config").json()["habits"] == {"suggest": False}
    assert client.get("/api/export_config").json()["config"]["habits"] == {
        "suggest": False}


# ----------------------------------------------------------------- the API

def test_habits_endpoint_dismiss_and_show(bridge):
    scan(bridge)
    put(real_steps())
    got = client.get("/api/habits").json()
    assert got["enabled"] is True and len(got["suggestions"]) == 1
    assert client.post("/api/habits/dismiss", json={"key": CARRIER}).status_code \
        == 200
    got = client.get("/api/habits").json()
    assert got["suggestions"] == [] and got["hidden"] == 1
    assert client.post("/api/habits/show").json() == {"shown": 1}
    got = client.get("/api/habits").json()
    assert len(got["suggestions"]) == 1 and got["hidden"] == 0
    assert client.post("/api/habits/dismiss", json={"key": ""}).status_code \
        == 400
    assert client.get("/api/habits?account=nope").status_code == 400


def test_making_the_suggested_rule_gives_a_report_mode_rule(bridge):
    """The client posts the suggestion's `rule` to the ordinary create path."""
    scan(bridge)
    put(real_steps(young=7))
    (s,) = client.get("/api/habits").json()["suggestions"]
    r = client.post("/api/rules", json={"name": "Trash carrier", **s["rule"]})
    assert r.status_code == 200
    rule = r.json()
    assert rule["mode"] == "report" and rule["report_runs"] == 0
    assert rule["query"] == f"from:{CARRIER}" and rule["older_than_days"] == 7
    assert rule["schedule"] == "weekly"
    run = client.post(f"/api/rules/{rule['id']}/run").json()
    assert run["mode"] == "report" and run["error"] == ""
    # the habit is covered now: it disappears
    assert client.get("/api/habits").json()["suggestions"] == []
    # nothing was moved
    assert len(mailops.STATE["groups"]["sender"][CARRIER]["folders"]) >= 1
    assert mailops.STATE["groups"]["sender"][CARRIER]["count"] == 3


def test_a_made_rule_cannot_start_active_even_when_asked(bridge):
    scan(bridge)
    put(real_steps())
    (s,) = client.get("/api/habits").json()["suggestions"]
    r = client.post("/api/rules", json={"name": "x", **s["rule"],
                                        "mode": "execute"})
    assert r.status_code == 200
    (rule,) = rulesmod.load_rules()
    assert rule["mode"] == "report" and rule["report_runs"] == 0


def test_end_to_end_three_manual_trashes_become_a_suggestion(bridge):
    """Real steps through the real action path, on three days."""
    fake = bridge
    now = time.time()
    for i, days in enumerate((30, 20, 10)):
        fake.mailbox["INBOX"].append(make_msg(
            100 + i, frm='"Deal Daily" <deals@dealsdaily.example>',
            subject=f"Today {i}", seen=False))
        scan(bridge)
        mailops.delete_groups("sender", ["deals@dealsdaily.example"])
        wait_delete_done()
    rows = [e for e in entries() if e["action"] == "trash"]
    assert len(rows) == 3 and all(
        e["keys"] == ["deals@dealsdaily.example"] for e in rows)
    # all three ran within this second: not three DAYS yet
    got = habits.suggestions(accountsmod.get("default"))
    assert got["suggestions"] == []
    # spread them over three days and it is a habit
    path = auditlog._path()
    lines = [json.loads(x) for x in path.read_text().splitlines()]
    k = 0
    for row in lines:
        if row.get("keys") == ["deals@dealsdaily.example"]:
            row["ts"] = int(now - (30, 20, 10)[k] * DAY)
            k += 1
    path.write_text("".join(json.dumps(r) + "\n" for r in lines))
    (s,) = habits.suggestions(accountsmod.get("default"))["suggestions"]
    assert s["key"] == "deals@dealsdaily.example" and s["times"] == 3
    assert s["always_unread"] is True


def test_an_undo_through_the_real_path_cancels_the_step(bridge):
    now = time.time()
    fake = bridge
    ids = []
    for i in range(3):
        fake.mailbox["INBOX"].append(make_msg(
            100 + i, frm='"Deal Daily" <deals@dealsdaily.example>',
            subject=f"Today {i}"))
        scan(bridge)
        mailops.delete_groups("sender", ["deals@dealsdaily.example"])
        wait_delete_done()
        ids.append(entries()[0]["id"])      # newest first
    path = auditlog._path()
    lines = [json.loads(x) for x in path.read_text().splitlines()]
    k = 0
    for row in lines:
        if row.get("keys"):
            row["ts"] = int(now - (30, 20, 10)[k] * DAY)
            k += 1
    path.write_text("".join(json.dumps(r) + "\n" for r in lines))
    acc = accountsmod.get("default")
    assert len(habits.suggestions(acc)["suggestions"]) == 1
    mailops.undo_last(-1)             # undoes the newest step
    wait_delete_done()
    undone = [e for e in entries() if e["action"] == "undo"][0]
    assert undone["undoes"]["id"] == ids[-1]
    assert habits.suggestions(acc)["suggestions"] == []


# ------------------------------------------------------- account rename/drop

def test_store_rename_and_drop_account():
    habitstore.hide("a@x.example", "one")
    habitstore.hide("b@x.example", "two")
    habitstore.rename_account("one", "uno")
    assert habitstore.hidden("one") == set()
    assert habitstore.hidden("uno") == {"a@x.example"}
    habitstore.rename_account("ghost", "x")                  # no-op
    habitstore.drop_account("two")
    habitstore.drop_account("two")                           # idempotent
    habitstore._cache.clear()                                # persisted too
    assert habitstore.hidden("uno") == {"a@x.example"}
    assert habitstore.hidden("two") == set()


def test_config_rename_and_delete_account_carry_the_hidden_senders(monkeypatch):
    fakes = {"imap.one": FakeIMAP({"INBOX": [make_msg(1)]}),
             "imap.two": FakeIMAP({"INBOX": [make_msg(2)]})}
    monkeypatch.setattr(mailops, "connect",
                        lambda cfg, name=None: fakes[cfg["host"]])
    cfgmod.update_config({"accounts": {
        "one": {"host": "imap.one", "user": "u1", "password": "p"},
        "two": {"host": "imap.two", "user": "u2", "password": "p"}}})
    habitstore.hide("a@x.example", "one")
    habitstore.hide("b@x.example", "two")
    r = client.post("/api/config", json={
        "rename_account": {"from": "one", "to": "uno"}})
    assert r.status_code == 200
    assert habitstore.hidden("uno") == {"a@x.example"}
    assert habitstore.hidden("one") == set()
    r = client.post("/api/config", json={"delete_account": "two"})
    assert r.status_code == 200
    assert habitstore.hidden("two") == set()
    assert habitstore.hidden("uno") == {"a@x.example"}


def test_a_damaged_hidden_file_only_forgets_what_it_cannot_read(tmp_path):
    (tmp_path / "hidden.json").write_text("{nope")
    habitstore._cache.clear()
    assert habitstore.hidden("default") == set()
    (tmp_path / "hidden.json").write_text(json.dumps({"accounts": {
        "default": ["ok@x.example", 5, "", "bad\nkey"], "x": "nope"}}))
    habitstore._cache.clear()
    assert habitstore.hidden("default") == {"ok@x.example"}


def test_the_hidden_file_is_private_and_older_releases_ignore_it(tmp_path):
    habitstore.hide("a@x.example", "default")
    path = tmp_path / "hidden.json"
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    assert json.loads(path.read_text()) == {
        "accounts": {"default": ["a@x.example"]}}
