"""The Propose level of the MCP endpoint (backend/mcptools.py `propose_rule` /
`withdraw_proposal`, backend/proposalmail.py): an assistant may only leave a
report-mode rule for the user to arm, never arm, run, purge or touch Junk /
Trash itself; and the user is told about it (Web Push with generic text,
batched email). Invented `.example` data only."""

import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog, mailops, mcptools, proposalmail, webpush
from backend import config as cfgmod
from backend import rules as rulesmod
from backend import smtpout
from backend.main import app

from test_mcp import (M_BODY, M_CAT, M_HOST, M_PASS, M_TAG, M_UNSUB, M_USER,
                      _cap, _token, call, legacy, mbox, ok)  # noqa: F401
from test_webpush import _decrypt, _wait, device, network  # noqa: F401

client = TestClient(app)
SNAPSHOT = Path(__file__).with_name("mcp_tools_list.propose.snapshot.json")
ENDPOINT = "https://web.push.apple.com/QXhfcGFzc3dvcmQ"

PROPOSAL = {"name": "Sweep old shop mails", "grouping": "sender",
            "query": "shop.example", "action": "trash"}


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    proposalmail._state.clear()
    monkeypatch.setattr(proposalmail, "_async", lambda fn, *a: fn(*a))
    monkeypatch.setattr(webpush, "PUSH_KEY_PATH", tmp_path / "vapid.pem")
    monkeypatch.setattr(webpush, "PUSH_SUBS_PATH", tmp_path / "subs.json")
    monkeypatch.setattr(webpush, "_key_cache", None)
    monkeypatch.setattr(webpush, "_presence", {})


@pytest.fixture(autouse=True)
def mails(monkeypatch):
    """Every mail the app would send: (to, subject, text, html). Always
    stubbed: a test never reaches a real SMTP server."""
    sent = []
    monkeypatch.setattr(smtpout, "send", lambda im, to, subject, text,
                        html=None, account_name=None:
                        sent.append((to, subject, text, html)))
    return sent


@pytest.fixture
def clock(monkeypatch):
    """The batching window's seam: a settable time and the timers it asks
    for (run one with `fire`)."""
    class Clock:
        now = 1_000_000.0
        timers: list = []

        def fire(self):
            _, fn, args = self.timers.pop(0)
            fn(*args)

    c = Clock()
    c.timers = []
    monkeypatch.setattr(proposalmail, "_now", lambda: c.now)
    monkeypatch.setattr(proposalmail, "_start_timer",
                        lambda delay, fn, *args: (c.timers.append(
                            (delay, fn, args)) or object()))
    return c


def propose(secret, **over):
    return call(secret, "propose_rule", {**PROPOSAL, **over})


def proposer(**over):
    _cap()
    return _token(level="propose", **over)


def rules():
    return rulesmod.load_rules()


# --------------------------------------------------------------- the tool

def test_a_proposal_is_a_report_mode_mcp_rule_with_its_report(mbox):
    secret = proposer(name="Claude Code")
    out = ok(secret, "propose_rule", PROPOSAL)
    assert out["state"] == "waiting" and out["origin"] == "mcp"
    assert out["report"]["mails"] == 2 and out["report"]["groups"] == 1
    assert out["report"]["top"][0]["count"] == 2
    assert out["link"] == "http://testserver/#/rules"
    assert "approves it in Inboxrake" in out["note"]
    (rule,) = rules()
    assert (rule["origin"], rule["mode"], rule["scope"]) == (
        "mcp", "report", "mail")
    assert rule["report_runs"] == 1              # one report was run
    assert rule["proposed_by"]["name"] == "Claude Code"
    assert rule["proposed_by"]["token_id"]
    assert not rulesmod.purge_armed(rule) or rule["mode"] == "report"
    # nothing moved
    assert all(m["folder"] == "INBOX"
               for m in accountsmod.get("default").index.values())


def test_a_proposal_cannot_be_armed_or_run_by_the_tool_arguments(mbox):
    secret = proposer()
    for extra in ({"mode": "execute"}, {"scope": "trash"},
                  {"origin": "manual"}, {"report_runs": 5}):
        res = propose(secret, **extra)
        assert res["isError"] is True
        assert "extra" in res["content"][0]["text"].lower() \
            or "invalid" in res["content"][0]["text"].lower()
    assert rules() == []
    res = propose(secret, action="purge")
    assert res["isError"] is True and rules() == []


def test_only_propose_tokens_can_call_the_propose_tools(mbox):
    _cap()
    read = _token(name="Reader", level="read")
    for name, args in (("propose_rule", PROPOSAL),
                       ("withdraw_proposal", {"rule_id": "abc"})):
        r = legacy(read, "tools/call", {"name": name, "arguments": args})
        assert r.json()["error"]["code"] == -32602
    names = [t["name"] for t in legacy(read, "tools/list").json()[
        "result"]["tools"]]
    assert "propose_rule" not in names and "withdraw_proposal" not in names
    assert rules() == []


def test_lowering_the_cap_takes_the_propose_tools_away(mbox):
    secret = proposer()
    _cap("read_propose")
    assert "propose_rule" in [t["name"] for t in legacy(
        secret, "tools/list").json()["result"]["tools"]]
    cfgmod.update_config({"assistants": {"access": "off"}})
    assert legacy(secret, "tools/list").status_code == 404


def test_tools_list_snapshot_for_a_propose_token(mbox):
    secret = proposer()
    tools = legacy(secret, "tools/list").json()["result"]["tools"]
    names = [t["name"] for t in tools]
    assert names[-2:] == ["propose_rule", "withdraw_proposal"]
    for t in tools[-2:]:
        assert t["annotations"]["readOnlyHint"] is False
        assert t["annotations"]["destructiveHint"] is False
        assert "approves" in t["description"] or "approved" in t[
            "description"]
    for t in tools[:-2]:
        assert t["annotations"]["readOnlyHint"] is True
    text = json.dumps(tools, indent=1, sort_keys=True) + "\n"
    if os.environ.get("UPDATE_SNAPSHOTS") or not SNAPSHOT.exists():
        SNAPSHOT.write_text(text)
    assert text == SNAPSHOT.read_text(), (
        "tools/list changed: review it, then UPDATE_SNAPSHOTS=1 pytest")


def test_a_bad_filter_or_name_is_a_tool_error(mbox):
    secret = proposer()
    for over in ({"query": "age:>zz"}, {"query": "is:nonsense"},
                 {"name": "\x07‮ "}, {"name": "x" * 81},
                 {"query": ""}):
        assert propose(secret, **over)["isError"] is True
    assert rules() == []


def test_the_reports_own_notice_does_not_pop_up_next_to_the_proposal(mbox):
    secret = proposer()
    ok(secret, "propose_rule", PROPOSAL)
    assert accountsmod.get("default").state["notice"] is None


def test_the_name_is_cleaned_and_capped(mbox):
    secret = proposer()
    out = ok(secret, "propose_rule", {
        **PROPOSAL, "name": "Sweep\x07 it ‮ now\n" + "x" * 60})
    assert "\x07" not in out["name"] and "‮" not in out["name"]
    assert "\n" not in out["name"] and len(out["name"]) <= 80
    assert rules()[0]["name"] == out["name"]


def test_user_written_tags_cannot_be_probed_through_a_proposal(mbox):
    secret = proposer()
    res = propose(secret, query=f"tag:{M_TAG}")
    assert res["isError"] is True and rules() == []
    ok(secret, "propose_rule", {**PROPOSAL, "query": "tag:newsletter"})


def _tag_alice(tag):
    assert client.put("/api/labels", json={
        "key": "alice@friends.example", "tags": [tag]}).status_code == 200


def test_a_partial_tag_is_refused_and_probes_nothing(mbox):
    """Regression: `tag:e` (a piece of "newsletter") used to pass, and the
    raw-group report then told the assistant which senders carry user tags."""
    secret = proposer()
    _tag_alice(M_TAG)
    for tag in ("e", "news", "usertag", M_TAG, "NEWSLETTERS"):
        res = propose(secret, query=f"from:alice@friends.example tag:{tag}")
        assert res["isError"] is True, tag
    assert rules() == []
    # count_matches (public view) and the refusal agree: nothing to learn
    assert ok(secret, "count_matches", {
        "filter": "from:alice@friends.example tag:e"})["mails"] == 0
    # an exact built-in tag still works, in any case
    ok(secret, "propose_rule", {**PROPOSAL, "query": "tag:Newsletter"})


def test_the_assistants_report_comes_from_the_public_view(mbox):
    secret = proposer()
    _tag_alice("newsletter-kids.example-marker")
    query = "from:alice@friends.example tag:newsletter"
    public = ok(secret, "count_matches", {"filter": query})
    assert public["mails"] == 0
    out = ok(secret, "propose_rule", {**PROPOSAL, "query": query})
    assert (out["report"]["groups"], out["report"]["mails"]) == (0, 0)
    assert out["report"]["top"] == []
    assert "alice@friends.example" not in json.dumps(out["report"])
    # the user's own stored report is the real one (their data)
    assert rules()[0]["last_run"]["mails"] == 1
    # nothing else the assistant can read repeats the real numbers
    row = ok(secret, "list_rules")["rules"][0]
    assert row["last_report"]["mails"] == 0
    acts = [a for a in ok(secret, "recent_activity")["entries"]
            if a["action"] == "rule_report"]
    assert acts and all(a["count"] == 0 for a in acts)
    entry = [a for a in ok(secret, "recent_activity")["entries"]
             if a["action"] == "rule_proposed"][0]
    assert entry["count"] == 0


def test_the_public_report_equals_count_matches_for_clean_data(mbox):
    secret = proposer()
    out = ok(secret, "propose_rule", {**PROPOSAL, "query": "shop"})
    cm = ok(secret, "count_matches", {"filter": "shop"})
    assert (out["report"]["groups"], out["report"]["mails"]) == (
        cm["groups"], cm["mails"])
    assert out["report"]["mails"] == rules()[0]["last_run"]["mails"]


def test_a_move_needs_an_existing_folder_that_is_not_junk_or_trash(mbox):
    secret = proposer()
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["folders_raw"] = ["INBOX", "Receipts", "Old Spam", "Bin"]
        acc.folder_roles.update({"junk": "Old Spam", "trash": "Bin"})
    for dest in (None, "Nowhere", "Bin", "Old Spam"):
        res = propose(secret, action="move", **({"dest": dest} if dest
                                                else {}))
        assert res["isError"] is True, dest
    assert rules() == []
    out = ok(secret, "propose_rule", {**PROPOSAL, "action": "move",
                                      "dest": "Receipts"})
    assert out["dest"] == "Receipts" and rules()[0]["dest"] == "Receipts"
    # dest is for move only
    assert propose(secret, dest="Receipts")["isError"] is True


def test_schedule_and_age_are_carried_over(mbox):
    secret = proposer()
    ok(secret, "propose_rule", {**PROPOSAL, "schedule": "weekly",
                                "older_than_days": 90, "grouping": "domain"})
    (rule,) = rules()
    assert (rule["schedule"], rule["older_than_days"],
            rule["grouping"]) == ("weekly", 90, "domain")
    assert rule["mode"] == "report"


def test_a_proposal_needs_a_finished_scan(monkeypatch):
    secret = proposer()
    res = propose(secret)
    assert res["isError"] is True and "scan" in res["content"][0]["text"]
    assert rules() == []


def test_at_most_ten_proposals_wait(mbox):
    secret = proposer()
    for i in range(rulesmod.PROPOSAL_LIMIT):
        ok(secret, "propose_rule", {**PROPOSAL, "name": f"rule {i}"})
    res = propose(secret, name="one too many")
    assert res["isError"] is True and "10" in res["content"][0]["text"]
    assert len(rules()) == 10
    # a withdrawn one makes room; approved ones no longer count
    ok(secret, "withdraw_proposal", {"rule_id": rules()[0]["id"]})
    ok(secret, "propose_rule", {**PROPOSAL, "name": "fits again"})
    assert len(rulesmod.open_proposals(rules())) == 10
    client.post(f"/api/rules/{rules()[0]['id']}", json={"mode": "execute"})
    assert len(rulesmod.open_proposals(rules())) == 9


def test_the_limit_is_per_workspace_not_per_token(mbox):
    _cap()
    a, b = _token(name="A", level="propose"), _token(name="B",
                                                    level="propose")
    for i in range(5):
        ok(a, "propose_rule", {**PROPOSAL, "name": f"a{i}"})
        ok(b, "propose_rule", {**PROPOSAL, "name": f"b{i}"})
    assert propose(a, name="late")["isError"] is True


# ------------------------------------------------------------- withdraw

def test_a_token_withdraws_only_its_own_open_proposals(mbox):
    _cap()
    a, b = _token(name="A", level="propose"), _token(name="B",
                                                    level="propose")
    mine = ok(a, "propose_rule", PROPOSAL)["rule_id"]
    theirs = ok(b, "propose_rule", {**PROPOSAL, "name": "other"})["rule_id"]
    res = call(a, "withdraw_proposal", {"rule_id": theirs})
    assert res["isError"] is True
    assert {r["id"] for r in rules()} == {mine, theirs}
    assert ok(a, "withdraw_proposal", {"rule_id": mine}) == {
        "withdrawn": True, "rule_id": mine}
    assert [r["id"] for r in rules()] == [theirs]
    assert call(a, "withdraw_proposal", {"rule_id": mine})["isError"]


def test_a_manual_rule_cannot_be_withdrawn(mbox):
    secret = proposer()
    manual = client.post("/api/rules", json={
        "name": "mine", "query": "shop", "action": "trash"}).json()
    assert call(secret, "withdraw_proposal",
                {"rule_id": manual["id"]})["isError"] is True
    assert len(rules()) == 1


def test_approved_or_edited_proposals_cannot_be_withdrawn(mbox):
    secret = proposer()
    approved = ok(secret, "propose_rule", PROPOSAL)["rule_id"]
    edited = ok(secret, "propose_rule", {**PROPOSAL, "name": "e"})["rule_id"]
    assert client.post(f"/api/rules/{approved}",
                       json={"mode": "execute"}).status_code == 200
    assert client.post(f"/api/rules/{edited}",
                       json={"name": "mine now"}).status_code == 200
    for rid in (approved, edited):
        assert call(secret, "withdraw_proposal",
                    {"rule_id": rid})["isError"] is True
    assert len(rules()) == 2


def test_withdraw_checks_and_deletes_under_the_rules_lock(mbox):
    """An approval cannot slip in between the check and the delete: the
    withdraw waits for the lock, then sees the approved (execute) rule."""
    import threading
    secret = proposer()
    rid = ok(secret, "propose_rule", PROPOSAL)["rule_id"]
    token = rules()[0]["proposed_by"]["token_id"]
    result = []
    with rulesmod._LOCK:                 # an approval is mid-way
        t = threading.Thread(target=lambda: result.append(
            rulesmod.withdraw_proposal(rid, token, ["default"])))
        t.start()
        t.join(0.3)
        assert t.is_alive() and result == []        # waiting for the lock
        data = json.loads(rulesmod._path().read_text())
        data["rules"][0]["mode"] = "execute"        # the approval lands
        rulesmod._path().write_text(json.dumps(data))
    t.join(5)
    assert result == [None]
    assert [r["id"] for r in rules()] == [rid]


def test_withdraw_is_bound_to_the_workspace(mbox):
    secret = proposer()
    assert call(secret, "withdraw_proposal",
                {"rule_id": "0" * 8})["isError"] is True


# -------------------------------------------------- the rules backend

def test_the_rules_api_can_never_set_origin_mcp(mbox):
    r = client.post("/api/rules", json={
        "name": "x", "query": "shop", "action": "trash", "origin": "mcp"})
    assert r.status_code == 400 and rules() == []
    made = client.post("/api/rules", json={
        "name": "x", "query": "shop", "action": "trash"}).json()
    r = client.post(f"/api/rules/{made['id']}", json={"origin": "mcp"})
    assert r.status_code == 400
    assert rules()[0]["origin"] == "manual"
    with pytest.raises(ValueError):
        rulesmod.create_rule({"name": "x", "query": "shop",
                              "action": "trash", "origin": "mcp"})
    # the one way in is the keyword only the tool passes
    with pytest.raises(ValueError):
        rulesmod.create_rule({"name": "x", "query": "shop", "scope": "trash",
                              "action": "purge"}, proposed_by={
                                  "token_id": "t", "name": "n", "at": 1})


def test_a_hand_edited_rules_file_cannot_fake_a_proposal(mbox):
    rulesmod.create_rule({"name": "x", "query": "shop", "action": "trash"})
    data = json.loads(rulesmod._path().read_text())
    data["rules"][0]["origin"] = "mcp"           # no proposed_by
    rulesmod._path().write_text(json.dumps(data))
    assert rules()[0]["origin"] == "manual"


def test_an_import_turns_a_proposal_into_a_manual_report_rule(mbox):
    secret = proposer()
    ok(secret, "propose_rule", PROPOSAL)
    exported = client.get("/api/export_config").json()
    assert exported["rules"][0]["origin"] == "mcp"
    r = client.post("/api/import_config", json=exported)
    assert r.json()["rules"] == 1
    (rule,) = rules()
    assert (rule["origin"], rule["mode"], rule["report_runs"]) == (
        "manual", "report", 0)
    assert "proposed_by" not in rule


def test_editing_a_proposal_makes_it_manual_and_keeps_its_history(mbox):
    secret = proposer(name="Claude Code")
    rid = ok(secret, "propose_rule", PROPOSAL)["rule_id"]
    # saving the form without changing anything is not an edit
    same = {k: rules()[0][k] for k in ("name", "query", "action", "dest",
                                       "schedule", "grouping")}
    client.post(f"/api/rules/{rid}", json=same)
    assert rules()[0]["origin"] == "mcp"
    r = client.post(f"/api/rules/{rid}", json={"query": "shop.example age:>1y"})
    assert r.status_code == 200
    rule = rules()[0]
    assert rule["origin"] == "manual" and rule["mode"] == "report"
    assert rule["proposed_by"]["name"] == "Claude Code"
    assert rule["report_runs"] == 0 and not rulesmod.purge_armed(rule)


def test_approving_is_the_unchanged_report_to_active_switch(mbox):
    secret = proposer()
    rid = ok(secret, "propose_rule", PROPOSAL)["rule_id"]
    r = client.post(f"/api/rules/{rid}", json={"mode": "execute"})
    assert r.status_code == 200 and r.json()["mode"] == "execute"
    assert r.json()["origin"] == "mcp"           # approved, still labelled
    listed = ok(secret, "list_rules")["rules"][0]
    assert (listed["state"], listed["proposed_by"]) == ("active", "Laptop")
    # back to report: the user's rule again, not a waiting proposal
    client.post(f"/api/rules/{rid}", json={"mode": "report"})
    assert rules()[0]["origin"] == "manual"


def test_the_gate_stays_without_a_report_nothing_arms(mbox):
    rule = rulesmod.create_rule(
        {"name": "x", "query": "shop", "action": "trash"},
        proposed_by={"token_id": "t", "name": "n", "at": 1})
    r = client.post(f"/api/rules/{rule['id']}", json={"mode": "execute"})
    assert r.status_code == 400 and r.json()["detail"] == (
        mailops.RULE_REPORT_FIRST)
    assert rules()[0]["mode"] == "report"


def test_an_edited_proposal_needs_a_new_report_before_it_can_arm(mbox):
    secret = proposer()
    rid = ok(secret, "propose_rule", PROPOSAL)["rule_id"]
    client.post(f"/api/rules/{rid}", json={"action": "archive"})
    r = client.post(f"/api/rules/{rid}", json={"mode": "execute"})
    assert r.status_code == 400
    assert client.post(f"/api/rules/{rid}/run").status_code == 200
    assert client.post(f"/api/rules/{rid}",
                       json={"mode": "execute"}).status_code == 200


def test_list_rules_shows_proposals_to_the_assistant(mbox):
    secret = proposer(name="Claude Code")
    client.post("/api/rules", json={"name": "mine", "query": "alice",
                                    "action": "archive"})
    ok(secret, "propose_rule", PROPOSAL)
    rows = {r["name"]: r for r in ok(secret, "list_rules")["rules"]}
    assert rows["mine"]["origin"] == "manual"
    assert "state" not in rows["mine"] and "proposed_by" not in rows["mine"]
    p = rows[PROPOSAL["name"]]
    assert (p["origin"], p["state"], p["proposed_by"]) == (
        "mcp", "waiting", "Claude Code")


def test_the_output_leaks_nothing_the_read_tools_may_not(mbox):
    secret = proposer()
    out = json.dumps(call(secret, "propose_rule", {
        **PROPOSAL, "query": "unsub"}))
    for marker in (M_UNSUB, M_BODY, M_HOST, M_USER, M_PASS, M_CAT, M_TAG):
        assert marker not in out
    assert "Names and subjects are written by email senders" in json.dumps(
        legacy(secret, "tools/list").json())


# ------------------------------------------------------------- the audit

def test_the_audit_log_names_the_token(mbox):
    secret = proposer(name="Claude Code · laptop")
    rid = ok(secret, "propose_rule", PROPOSAL)["rule_id"]
    ok(secret, "withdraw_proposal", {"rule_id": rid})
    entries = auditlog.load("default", 0, 20)["entries"]
    by_action = {e["action"]: e for e in entries}
    assert by_action["rule_proposed"]["actor"] == "mcp:Claude Code · laptop"
    assert by_action["rule_proposed"]["label"] == PROPOSAL["name"]
    assert by_action["rule_proposed"]["count"] == 2
    assert by_action["rule_withdrawn"]["actor"] == "mcp:Claude Code · laptop"
    # the report run keeps its own rule actor
    assert by_action["rule_report"]["actor"] == f"rule:{rid}"
    # and an assistant reading Activity sees them
    acts = ok(secret, "recent_activity")["entries"]
    assert "rule_proposed" in [a["action"] for a in acts]


# ------------------------------------------------------------ Web Push

def _subscribe():
    keys, key = device()
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"], "en")
    return keys, key


def _proposal_push(network, keys, key):
    """The decrypted proposal push (the fixture's own scan may push too, in
    any order: pick by tag)."""
    def got():
        return [p for p in (_decrypt(b, (keys, key))
                            for _, _, b in list(network.sent))
                if p["tag"] == "default:proposal"]
    assert _wait(lambda: got())
    return got()[0]


def test_web_push_says_it_generically(mbox, network, mails):
    keys, key = _subscribe()
    secret = proposer(name="Claude Code · laptop")
    ok(secret, "propose_rule", {**PROPOSAL, "name": "Secret plan <b>x</b>"})
    payload = _proposal_push(network, keys, key)
    assert payload == {"title": "An AI assistant proposes a rule",
                       "body": "Review it in Inboxrake. Nothing has moved "
                               "yet.", "tag": "default:proposal",
                       "url": "/#/rules"}
    blob = json.dumps(payload)
    for word in ("Secret", "Claude", "shop", "news@"):
        assert word not in blob


def test_web_push_is_german_for_a_german_device(mbox, network, mails):
    keys, key = device()
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"], "de")
    ok(proposer(), "propose_rule", PROPOSAL)
    assert _proposal_push(network, keys, key)["title"] == (
        "Ein KI-Assistent schlägt eine Regel vor")


def test_web_push_is_not_sent_while_the_user_is_looking(mbox, network, mails):
    _subscribe()
    webpush.set_presence(ENDPOINT, True)
    ok(proposer(), "propose_rule", PROPOSAL)
    time.sleep(0.2)
    assert network.sent == []


def test_no_push_without_a_subscription_and_a_failing_push_changes_nothing(
        mbox, monkeypatch, mails):
    secret = proposer()
    ok(secret, "propose_rule", PROPOSAL)                 # nobody subscribed
    _subscribe()
    monkeypatch.setattr(webpush, "_post", lambda *a: (_ for _ in ()
                        ).throw(OSError("down")))
    out = ok(secret, "propose_rule", {**PROPOSAL, "name": "second"})
    assert out["state"] == "waiting" and len(rules()) == 2


# --------------------------------------------------------------- email

def _mailbox_can_send(url="https://mail.example"):
    cfgmod.update_config({"imap": {
        "host": M_HOST, "user": "me@home.example", "password": "pw-x",
        "digest": {"url": url, "lang": "en"}}})


def test_the_email_switch_is_on_by_default(mbox):
    assert cfgmod.load_config()["assistants_notify"] == {"email": True}
    seen = client.get("/api/config").json()["assistants"]["notify"]
    assert seen["email"] is True
    assert seen["accounts"]["default"] == {"to": M_USER, "can_send": True}
    r = client.post("/api/config", json={"assistants_notify": {
        "email": False}})
    assert r.status_code == 200
    assert client.get("/api/config").json()["assistants"]["notify"][
        "email"] is False
    assert cfgmod.load_config()["assistants_notify"]["email"] is False


def test_a_proposal_sends_one_plain_mail_with_inboxrakes_own_link(
        mbox, mails, clock):
    _mailbox_can_send()
    secret = proposer(name="Claude Code · laptop")
    ok(secret, "propose_rule", {
        **PROPOSAL,
        "name": "Visit http://evil.example/x <script>alert(1)</script>"})
    (to, subject, text, html), = mails
    assert to == "me@home.example"           # the account's own address
    assert subject == "Inboxrake: Claude Code · laptop proposes a rule"
    assert "Nothing has moved yet" in text
    assert "2 mails from 1 senders" in text
    assert "https://mail.example/#/rules" in text
    # the assistant's words are text: escaped, and never a link
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert html.count("href=") == 1
    assert 'href="https://mail.example/#/rules"' in html
    entry = auditlog.load("default", 0, 20)["entries"][0]
    assert entry["action"] == "proposal_mail_sent" and entry["count"] == 1


def test_urls_in_the_assistants_words_are_defanged_in_text_and_html(
        mbox, mails, clock):
    _mailbox_can_send()
    ok(proposer(name="Claude.Code http://tok.example"), "propose_rule", {
        **PROPOSAL, "name": "Go to https://evil.example/x now",
        "query": "shop.example news@shop.example"})
    (to, subject, text, html), = mails
    for part in (subject, text, html):
        assert "evil.example" not in part and "shop.example" not in part
        assert "tok.example" not in part and "://evil" not in part
    assert "https[://]evil[.]example/x" in text
    assert "shop[.]example news@shop[.]example" in text
    assert "shop[.]example" in html and "Claude[.]Code" in subject
    assert "Addresses are shown with [.]" in text
    assert "Addresses are shown with [.]" in html
    # Inboxrake's own link stays a real link
    assert 'href="https://mail.example/#/rules"' in html
    assert "https://mail.example/#/rules" in text and html.count("href=") == 1


def test_the_mail_goes_to_the_digest_recipient_when_there_is_one(
        mbox, mails, clock):
    cfgmod.update_config({"imap": {
        "host": M_HOST, "user": "me@home.example", "password": "pw-x",
        "digest": {"recipient": "other@home.example"}}})
    ok(proposer(), "propose_rule", PROPOSAL)
    assert mails[0][0] == "other@home.example"
    assert "#/rules" not in mails[0][2]       # no link address set: no link
    assert "href=" not in mails[0][3]


def test_the_mail_is_german_with_a_german_digest(mbox, mails, clock):
    _mailbox_can_send()
    cfgmod.update_config({"imap": {"digest": {"lang": "de"}}})
    ok(proposer(), "propose_rule", PROPOSAL)
    assert mails[0][1].endswith("schlägt eine Regel vor")
    assert "In Inboxrake ansehen" in mails[0][3]


def test_proposals_inside_ten_minutes_are_batched(mbox, mails, clock):
    _mailbox_can_send()
    secret = proposer()
    ok(secret, "propose_rule", {**PROPOSAL, "name": "one"})
    assert len(mails) == 1
    clock.now += 60
    ok(secret, "propose_rule", {**PROPOSAL, "name": "two"})
    clock.now += 60
    ok(secret, "propose_rule", {**PROPOSAL, "name": "three"})
    assert len(mails) == 1                   # held back
    assert len(clock.timers) == 1            # one timer, not one per proposal
    assert clock.timers[0][0] == pytest.approx(
        proposalmail.EMAIL_WINDOW - 60)      # from the first proposal's mail
    clock.now += proposalmail.EMAIL_WINDOW
    clock.fire()
    assert len(mails) == 2
    _, subject, text, html = mails[1]
    assert subject == "Inboxrake: 2 new rule proposals"
    assert "two" in text and "three" in text and "one" not in text.replace(
        "none", "")
    # the window starts again after the batch
    ok(secret, "propose_rule", {**PROPOSAL, "name": "four"})
    assert len(mails) == 2
    clock.now += proposalmail.EMAIL_WINDOW
    ok(secret, "propose_rule", {**PROPOSAL, "name": "five"})
    assert len(mails) == 3 and "five" in mails[2][2]


def test_after_ten_quiet_minutes_the_next_proposal_goes_out_at_once(
        mbox, mails, clock):
    _mailbox_can_send()
    secret = proposer()
    ok(secret, "propose_rule", {**PROPOSAL, "name": "one"})
    clock.now += proposalmail.EMAIL_WINDOW + 1
    ok(secret, "propose_rule", {**PROPOSAL, "name": "two"})
    assert len(mails) == 2 and clock.timers == []


def test_the_switch_off_sends_nothing_even_for_a_held_batch(
        mbox, mails, clock):
    _mailbox_can_send()
    secret = proposer()
    ok(secret, "propose_rule", {**PROPOSAL, "name": "one"})
    ok(secret, "propose_rule", {**PROPOSAL, "name": "two"})
    cfgmod.update_config({"assistants_notify": {"email": False}})
    clock.now += proposalmail.EMAIL_WINDOW
    clock.fire()
    assert len(mails) == 1
    ok(secret, "propose_rule", {**PROPOSAL, "name": "three"})
    clock.now += proposalmail.EMAIL_WINDOW
    ok(secret, "propose_rule", {**PROPOSAL, "name": "four"})
    assert len(mails) == 1


def test_an_account_that_cannot_send_is_skipped_silently(
        mbox, mails, clock):
    cfg = cfgmod.load_config()
    cfg["accounts"]["default"]["password"] = ""
    cfgmod._write_tenant_config(cfg)
    out = ok(proposer(), "propose_rule", PROPOSAL)
    assert out["state"] == "waiting" and mails == []
    seen = client.get("/api/config").json()["assistants"]["notify"]
    assert seen["accounts"]["default"]["can_send"] is False
    assert not [e for e in auditlog.load("default", 0, 20)["entries"]
                if e["action"] == "proposal_mail_sent"]


def test_a_failing_smtp_never_fails_the_proposal(mbox, monkeypatch, clock):
    _mailbox_can_send()

    def boom(*a, **k):
        raise OSError("smtp down")
    monkeypatch.setattr(smtpout, "send", boom)
    out = ok(proposer(), "propose_rule", PROPOSAL)
    assert out["state"] == "waiting" and len(rules()) == 1


def test_the_demo_alerts_nobody(mbox, mails, clock, monkeypatch):
    from backend import demo
    _mailbox_can_send()
    monkeypatch.setattr(demo, "enabled", lambda: True)
    rule = {"name": "x", "query": "shop", "action": "trash"}
    proposalmail.notify(accountsmod.get("default"), rule, "T", {})
    assert mails == []


def test_mail_text_helper_strips_controls_and_caps():
    assert proposalmail.plain("a\x07b‮c\nd", 80) == "abc d"
    assert len(proposalmail.plain("x" * 500, 80)) == 80
