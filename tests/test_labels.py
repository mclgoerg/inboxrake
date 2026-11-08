"""Sender labels: the verdict / tags the USER set per sender (backend).

This is a safety feature - it changes what counts as "safe to delete" - so the
tests pin the rules, one per reader of a verdict:
  * the user's verdict wins over the AI, survives rescans and snapshot
    restores, and "Reset to automatic" gives the AI verdict back;
  * the AI review never overwrites it (and never re-bills it);
  * a protected sender is never "safe", whatever the user chose - also when it
    is protected AFTER the choice;
  * rows that contain a sender the user put on hold cannot be "safe" either
    (pooled Smart rows, domain rows) - what filters, selections and the rules
    engine read is the effective verdict;
  * per-mail ratings follow the sender's override;
  * the user's tags replace the automatic ones (Sender, Smart) and reset
    restores them; `tag:` filters see them.
Synthetic `.example` data only."""

from __future__ import annotations

import json
import logging
import types

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aihelper
from backend import config as cfgmod
from backend import labels
from backend import labelstore as ls
from backend import mailops
from backend import rules as rulesmod
from backend import verdictstore
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

BIG = "big@solo.example"          # 12 mails: an own Smart row (`s:` key)
OTHER = "other@items.example"     # one small sender
DUO1, DUO2 = "a@duo.example", "b@duo.example"   # one domain row, pooled in Smart
VIP = "prot@vip.example"


class FakeAi:
    """Stands in for the AI client: rates every group with `verdict`."""

    def __init__(self, verdict="delete_safe"):
        self.verdict = verdict
        self.on_call = None                 # runs while the "model" answers
        self.calls: list[dict] = []
        self.messages = types.SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.calls.append(kw)
        if self.on_call:
            self.on_call()
        sent = json.loads(kw["messages"][0]["content"])
        if "mails" in sent:
            payload = {"items": [
                {"uid": m["uid"], "folder_i": m["folder_i"],
                 "verdict": self.verdict} for m in sent["mails"]],
                "note": "n"}
        else:
            payload = {"verdicts": [
                {"key": g["key"], "verdict": self.verdict, "reason": "ai"}
                for g in sent["groups"]]}
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text",
                                           text=json.dumps(payload))],
            usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))

    def sent_keys(self) -> set[str]:
        return {g["key"] for c in self.calls
                for g in json.loads(c["messages"][0]["content"])["groups"]}


@pytest.fixture
def mailbox(monkeypatch):
    inbox, uid = [], iter(range(1, 5000))

    def add(addr, n, subject="Hello there", **kw):
        for _ in range(n):
            u = next(uid)
            inbox.append(make_msg(u, frm=addr, subject=subject,
                                  msgid=f"<l{u}@t>", **kw))
    add(BIG, 12, "Sale")
    add(OTHER, 1, "Invoice 7")
    add(DUO1, 1, "Quick question")
    add(DUO2, 1, "Catch up soon")
    add(VIP, 3, "Hello there")
    fake = FakeIMAP({"INBOX": inbox, "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"ai": {"api_key": "k", "model": "claude-sonnet-5"}})
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


@pytest.fixture
def ai(mailbox, monkeypatch):
    fake = FakeAi()
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: fake)
    return fake


def acc():
    return accountsmod.get()


def put(**body):
    return client.put("/api/labels", json=body)


def shown(grouping="sender") -> dict:
    """The groups as the API / UI / filters / rules read them."""
    return mailops.public_state()["groups"][grouping]


def verdict(key, grouping="sender"):
    ai = shown(grouping)[key]["ai"]
    return ai["verdict"] if ai else None


def review_all(rerate=False, keys=None):
    aihelper._run_ai("sender", keys=keys, rerate=rerate)
    assert mailops.STATE["ai"]["status"] == "done", mailops.STATE["ai"]["error"]


# ------------------------------------------------------------------ store

def test_store_validates_and_clears_one_part_at_a_time():
    name = accountsmod.default_name()
    assert ls.set_labels(name, "A@Shop.Example", verdict="keep",
                         tags=[" Sale ", "sale", "x  y"]) == {
        "verdict": "keep", "tags": ["sale", "x y"],
        "ts": ls.load_account(name)["a@shop.example"]["ts"]}
    # left out = unchanged, None = back to automatic
    ls.set_labels(name, "a@shop.example", verdict=None)
    assert "verdict" not in ls.load_account(name)["a@shop.example"]
    assert ls.load_account(name)["a@shop.example"]["tags"] == ["sale", "x y"]
    # a stored empty list is the user's choice (no tags), not "automatic"
    ls.set_labels(name, "a@shop.example", tags=[])
    assert ls.tag_overrides(name) == {"a@shop.example": []}
    # nothing left -> the entry is gone
    assert ls.set_labels(name, "a@shop.example", tags=None) is None
    assert ls.load_account(name) == {}


@pytest.mark.parametrize("kw,code", [
    ({"verdict": "bogus"}, ls.BAD_VERDICT),
    ({"verdict": 3}, ls.BAD_VERDICT),
    ({"tags": "newsletter"}, ls.BAD_TAGS),
    ({"tags": [""]}, ls.BAD_TAGS),
    ({"tags": [1]}, ls.BAD_TAGS),
    ({"tags": ["x" * (ls.TAG_MAX + 1)]}, ls.BAD_TAGS),
    ({"tags": [f"t{i}" for i in range(ls.MAX_TAGS + 1)]}, ls.BAD_TAGS),
])
def test_store_refuses_bad_values_and_writes_nothing(kw, code):
    with pytest.raises(ls.LabelError) as exc:
        ls.set_labels("proton", "a@shop.example", **kw)
    assert exc.value.code == code
    assert ls.load_account("proton") == {}


@pytest.mark.parametrize("key", ["", "nobody", "a b@x.example", None, 5,
                                 "x@" + "y" * 260])
def test_store_refuses_a_bad_key(key):
    with pytest.raises(ls.LabelError) as exc:
        ls.set_labels("proton", key, verdict="keep")
    assert exc.value.code == ls.BAD_KEY


def test_labels_are_per_account_and_follow_a_rename_and_a_delete():
    ls.set_labels("proton", "a@shop.example", verdict="keep")
    ls.set_labels("work", "a@shop.example", verdict="delete_safe")
    assert ls.verdicts("proton") == {"a@shop.example": "keep"}
    assert ls.verdicts("work") == {"a@shop.example": "delete_safe"}
    ls.rename_account("proton", "mail")
    assert ls.verdicts("mail") == {"a@shop.example": "keep"}
    assert ls.verdicts("proton") == {}
    ls.drop_account("work")
    assert ls.verdicts("work") == {}


def test_a_damaged_file_is_forgotten_not_fatal(tmp_path):
    ls._path().write_text("{not json")
    ls._cache.clear()
    assert ls.load_account("proton") == {}
    ls._path().write_text(json.dumps({"accounts": {"proton": {
        "a@x.example": {"verdict": "nope"}, "b@x.example": 5,
        "c@x.example": {"verdict": "keep", "ts": "later"}}}}))
    ls._cache.clear()
    assert ls.load_account("proton") == {
        "c@x.example": {"verdict": "keep", "ts": 0}}


def test_the_file_is_private():
    ls.set_labels("proton", "a@shop.example", verdict="keep")
    assert ls._path().stat().st_mode & 0o777 == 0o600


# ------------------------------------------------------- API + the basics

def test_api_sets_the_verdict_and_reset_removes_it(ai):
    review_all()
    assert verdict(BIG) == "delete_safe"
    r = put(key=BIG, verdict="keep")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "keep"
    assert body["ai"] == {"verdict": "delete_safe", "reason": "ai"}
    assert body["tags"] is None
    assert verdict(BIG) == "keep"
    assert shown()[BIG]["ai"]["src"] == "user"
    # the Smart row of this one sender shows it too
    assert verdict(f"s:{BIG}", "smart") == "keep"
    # reset: the AI verdict is back - on both rows
    r = put(key=BIG, reset=True)
    assert r.json()["verdict"] is None
    assert verdict(BIG) == "delete_safe"
    assert verdict(f"s:{BIG}", "smart") == "delete_safe"
    assert shown()[BIG]["ai"].get("src") is None
    assert ls.load_account(accountsmod.default_name()) == {}


def test_a_verdict_works_on_a_sender_the_ai_never_rated(mailbox):
    assert verdict(BIG) is None
    put(key=BIG, verdict="review")
    assert verdict(BIG) == "review"
    put(key=BIG, verdict=None)
    assert verdict(BIG) is None
    assert verdict(f"s:{BIG}", "smart") is None


def test_api_refusals_are_stable_codes(mailbox):
    assert put(key=BIG, verdict="maybe").json()["detail"] == ls.BAD_VERDICT
    assert put(key=BIG, tags="x").json()["detail"] == ls.BAD_TAGS
    assert put(key="nobody").json()["detail"] == ls.BAD_KEY
    assert put(key="nobody@nowhere.example",
               verdict="keep").json()["detail"] == ls.UNKNOWN
    assert put(key=BIG).json()["detail"] == ls.BAD_REQUEST     # nothing to do
    assert client.put("/api/labels", json=[1]).status_code == 422 \
        or client.put("/api/labels", json=[1]).status_code == 400
    assert client.get("/api/labels", params={"key": "x@nowhere.example"}
                      ).json()["detail"] == ls.UNKNOWN
    assert ls.load_account(accountsmod.default_name()) == {}


def test_api_refuses_before_the_first_scan(monkeypatch):
    r = put(key=BIG, verdict="keep")
    assert r.status_code == 409 and r.json()["detail"] == ls.UNSCANNED


def test_detail_reports_automatic_tags_ai_and_suggestions(ai):
    review_all()
    body = client.get("/api/labels", params={"key": OTHER}).json()
    assert body["key"] == OTHER
    assert "finance" in body["auto_tags"]               # "Invoice 7"
    assert body["tags_now"] == body["auto_tags"]
    assert body["ai"]["verdict"] == "delete_safe"
    assert body["protected"] is False
    assert "finance" not in body["suggestions"]
    assert "shopping" in body["suggestions"]
    assert len(body["suggestions"]) <= 8


# ---------------------------------------------------- AI never overwrites

def test_the_ai_review_never_overwrites_a_user_verdict(ai):
    put(key=BIG, verdict="keep")
    review_all()                                   # the AI says safe for all
    assert verdict(BIG) == "keep"
    assert verdict(f"s:{BIG}", "smart") == "keep"
    assert verdict(OTHER) == "delete_safe"
    # ...it was not even asked (no billing for a decided sender)
    assert BIG not in ai.sent_keys()
    # ...not even by an explicit re-rate of exactly that sender
    n = len(ai.calls)
    aihelper._run_ai("sender", keys={BIG}, rerate=True)
    assert len(ai.calls) == n and verdict(BIG) == "keep"


def test_an_ai_answer_that_lands_after_the_choice_is_cached_not_shown(ai):
    """The review was already running when the user decided: its answer is
    kept in the cache (Reset shows it) but the row keeps the user's verdict."""
    ai.on_call = lambda: put(key=BIG, verdict="keep")   # mid-review
    review_all()
    assert verdict(BIG) == "keep"
    assert verdict(f"s:{BIG}", "smart") == "keep"
    assert verdict(OTHER) == "delete_safe"
    assert verdictstore.load_account()["sender"][BIG]["verdict"] \
        == "delete_safe"
    put(key=BIG, reset=True)
    assert verdict(BIG) == "delete_safe"                # the cached answer


def test_user_verdicts_are_not_ai_verdicts_for_clearing(ai):
    review_all()
    put(key=BIG, verdict="keep")
    r = client.post("/api/config", json={"clear_ai_verdicts": True})
    assert r.status_code == 200
    assert verdict(OTHER) is None                  # the AI cache is gone
    assert verdict(BIG) == "keep"                  # the user's choice is not
    put(key=BIG, reset=True)
    assert verdict(BIG) is None


def test_a_user_verdict_survives_a_rescan(ai):
    review_all()
    put(key=BIG, verdict="keep")
    mailops.run_scan()
    assert verdict(BIG) == "keep"
    assert verdict(f"s:{BIG}", "smart") == "keep"
    assert verdict(OTHER) == "delete_safe"
    put(key=BIG, reset=True)
    mailops.run_scan()
    assert verdict(BIG) == "delete_safe"


def test_a_user_verdict_survives_a_restart_and_a_reset_is_not_stale(ai):
    """The snapshot keeps the marks of the moment it was written; restoring
    it must re-derive them from the CURRENT labels, both ways."""
    review_all()
    put(key=BIG, verdict="keep")
    mailops.save_snapshot(acc())
    # reset while the app is "down": the snapshot still carries the user mark
    ls.set_labels(acc().name, BIG, verdict=None)
    accountsmod.reset()
    assert mailops.load_snapshot(accountsmod.get())
    assert verdict(BIG) == "delete_safe"
    assert shown()[BIG]["ai"].get("src") is None
    # ...and the other way round: set while down, snapshot written before
    ls.set_labels(acc().name, BIG, verdict="review")
    accountsmod.reset()
    assert mailops.load_snapshot(accountsmod.get())
    assert verdict(BIG) == "review"
    assert verdict(f"s:{BIG}", "smart") == "review"


# --------------------------------------------------------- protected wins

def test_a_protected_sender_is_never_safe_whatever_the_user_chose(mailbox):
    cfgmod.set_protected(VIP, True)
    mailops.rebuild_smart_all()
    assert put(key=VIP, verdict="delete_safe").status_code == 200
    assert verdict(VIP) == "review"                # downgraded like the AI's
    assert shown()[VIP]["protected"] is True
    assert client.get("/api/labels", params={"key": VIP}
                      ).json()["verdict"] == "delete_safe"   # as chosen
    mailops.run_scan()                             # also after a rescan
    assert verdict(VIP) == "review"


def test_protecting_after_the_choice_still_wins(mailbox):
    put(key=BIG, verdict="delete_safe")
    assert verdict(BIG) == "delete_safe"
    cfgmod.set_protected(BIG, True)                # no rescan, no refresh
    assert shown()[BIG]["protected"] is True
    assert verdict(BIG) == "review"
    assert verdict(f"s:{BIG}", "smart") == "review"
    cfgmod.set_protected(BIG, False)
    assert verdict(BIG) == "delete_safe"


def test_protected_wins_for_the_ai_safe_filter_and_rules(mailbox):
    put(key=BIG, verdict="delete_safe")
    cfgmod.set_protected(BIG, True)
    f = rulesmod.parse_filter("ai:safe")
    matched = {k for k, g in shown().items() if rulesmod.match_group(g, f)}
    assert matched == set()


def test_per_mail_verdicts_of_a_protected_sender_are_not_safe(mailbox):
    put(key=BIG, verdict="delete_safe")
    cfgmod.set_protected(BIG, True)
    mails = mailops.group_mails("sender", BIG)
    assert {m["ai"] for m in mails} == {"review"}


# ------------------------------- every reader of a verdict sees the override

def test_rules_filters_and_selection_read_the_effective_verdict(ai):
    review_all()
    f = rulesmod.parse_filter("ai:safe")
    base = {k for k, g in shown().items() if rulesmod.match_group(g, f)}
    assert BIG in base
    put(key=BIG, verdict="keep")
    now = {k for k, g in shown().items() if rulesmod.match_group(g, f)}
    assert now == base - {BIG}
    # a user "safe" on a sender the AI never rated joins the filter
    put(key=BIG, verdict=None)
    mailops.clear_ai_marks()
    put(key=OTHER, verdict="delete_safe")
    only = {k for k, g in shown().items() if rulesmod.match_group(g, f)}
    assert only == {OTHER}


def test_the_rules_engine_does_not_act_on_what_the_user_put_on_hold(ai):
    review_all()
    rule = rulesmod.create_rule({"name": "safe ones", "query": "ai:safe",
                                 "grouping": "sender", "action": "trash"})
    before = rulesmod.run_rule(rule["id"], rescan=False)
    assert before["groups"] == 5                  # every sender
    put(key=BIG, verdict="review")
    after = rulesmod.run_rule(rule["id"], rescan=False)
    assert after["groups"] == 4
    assert BIG not in {p["key"] for p in after["preview"]}


def test_pooled_and_domain_rows_cannot_be_safe_with_a_held_member(ai):
    review_all()
    aihelper._run_ai("smart")
    aihelper._run_ai("domain")
    pool = mailops.STATE["groups"]["sender"][DUO1]["smart_key"]
    assert pool == mailops.STATE["groups"]["sender"][VIP]["smart_key"]
    assert verdict(pool, "smart") == "delete_safe"
    assert verdict("duo.example", "domain") == "delete_safe"

    put(key=DUO1, verdict="keep")
    put(key=VIP, verdict="review")
    capped = shown("smart")[pool]["ai"]
    assert capped["verdict"] == "review" and capped["capped"] == "user"
    assert verdict("duo.example", "domain") == "review"      # DUO1 is on hold
    # the AI's own answer is untouched underneath (capping is a view)
    assert mailops.STATE["groups"]["smart"][pool]["ai"]["verdict"] \
        == "delete_safe"
    # a member the user marked SAFE holds nothing back
    put(key=DUO1, verdict="delete_safe")
    put(key=VIP, verdict="delete_safe")
    assert verdict(pool, "smart") == "delete_safe"
    assert verdict("duo.example", "domain") == "delete_safe"
    # ...but never raises a row the AI did not rate safe
    put(key=DUO2, verdict="review")
    ai.verdict = "review"
    mailops.clear_ai_marks()
    verdictstore.clear()
    aihelper._run_ai("smart")
    assert verdict(pool, "smart") == "review"
    # reset: nothing is held any more
    for addr in (DUO1, DUO2, VIP):
        put(key=addr, reset=True)
    assert verdict(pool, "smart") == "review"      # the AI's own answer


def test_a_row_the_user_did_not_touch_is_not_capped(ai):
    review_all()
    put(key=OTHER, verdict="keep")
    assert verdict(DUO1) == "delete_safe"
    assert verdict(VIP) == "delete_safe"


def test_per_mail_ratings_follow_the_sender_override(ai):
    r = client.post("/api/ai_group", json={"grouping": "sender", "key": BIG})
    assert r.status_code == 200, r.text
    assert {m["ai"] for m in mailops.group_mails("sender", BIG)} \
        == {"delete_safe"}
    assert shown()[BIG]["ratings"] == {"delete_safe": 12, "review": 0,
                                       "keep": 0}
    put(key=BIG, verdict="keep")
    assert {m["ai"] for m in mailops.group_mails("sender", BIG)} == {"keep"}
    assert shown()[BIG]["ratings"] == {"delete_safe": 0, "review": 0,
                                       "keep": 12}
    rows = mailops.list_mails(0, 50, "sender", None, f"from:{BIG}")["mails"]
    assert {m["ai"] for m in rows} == {"keep"}
    # another grouping's mails of that sender follow too (domain row)
    dom = mailops.group_mails("domain", "solo.example")
    assert {m["ai"] for m in dom if m["addr"] == BIG} == {"keep"}
    assert mailops.index_stats()["rated_mails"]["keep"] == 12
    # reset: the stored per-mail ratings were never touched
    put(key=BIG, reset=True)
    assert {m["ai"] for m in mailops.group_mails("sender", BIG)} \
        == {"delete_safe"}


def test_the_per_mail_review_skips_mails_the_user_decided(ai):
    put(key=BIG, verdict="keep")
    r = client.post("/api/ai_group", json={"grouping": "sender", "key": BIG})
    assert r.status_code == 200
    assert ai.calls == []                       # every mail already decided
    stored = verdictstore.load_mails()
    assert not any(stored.get(m["msgid"])
                   for m in mailops.group_mails("sender", BIG,
                                                with_msgid=True))


def test_the_csv_export_and_the_stats_show_the_override(ai):
    review_all()
    put(key=BIG, verdict="keep")
    csv_text = client.get("/api/export", params={"grouping": "sender"}).text
    line = next(ln for ln in csv_text.splitlines() if ln.startswith(BIG))
    assert ",keep," in line
    assert mailops.index_stats()["ai_groups"]["keep"] == 1


# ----------------------------------------------------------------- tags

def test_user_tags_replace_the_automatic_ones_and_reset_restores_them(mailbox):
    auto = list(shown()[OTHER]["tags"])
    assert "finance" in auto
    r = put(key=OTHER, tags=["loyalty", "Fashion"])
    assert r.status_code == 200 and r.json()["tags"] == ["loyalty", "fashion"]
    assert r.json()["auto_tags"] == auto
    assert shown()[OTHER]["tags"] == ["loyalty", "fashion"]
    # `tag:` filters see the user's tags, not the automatic ones
    f = rulesmod.parse_filter("tag:loyal")
    assert {k for k, g in shown().items() if rulesmod.match_group(g, f)} \
        == {OTHER}
    assert not rulesmod.match_group(shown()[OTHER],
                                    rulesmod.parse_filter("tag:finance"))
    # an own choice of NO tags is different from automatic
    put(key=OTHER, tags=[])
    assert shown()[OTHER]["tags"] == []
    put(key=OTHER, tags=None)
    assert shown()[OTHER]["tags"] == auto
    put(key=OTHER, tags=["loyalty"])
    put(key=OTHER, reset=True)
    assert shown()[OTHER]["tags"] == auto


def test_tags_reach_smart_rows_and_survive_rescans_and_restores(mailbox):
    put(key=BIG, tags=["vip-shop"])
    assert shown("smart")[f"s:{BIG}"]["tags"] == ["vip-shop"]
    mailops.run_scan()
    assert shown()[BIG]["tags"] == ["vip-shop"]
    assert shown("smart")[f"s:{BIG}"]["tags"] == ["vip-shop"]
    # the domain row of the sender GAINS the tag when groups are built
    assert "vip-shop" in shown("domain")["solo.example"]["tags"]
    # restore from the snapshot after the tags changed while "down"
    mailops.save_snapshot(acc())
    ls.set_labels(acc().name, BIG, tags=["other-tag"])
    accountsmod.reset()
    assert mailops.load_snapshot(accountsmod.get())
    assert shown()[BIG]["tags"] == ["other-tag"]
    assert shown("smart")[f"s:{BIG}"]["tags"] == ["other-tag"]


def test_a_user_category_tag_places_the_sender_in_that_category_row(mailbox):
    cfgmod.update_config({"categories": {"hobby": ["hobby.example"]}})
    put(key=DUO1, tags=["hobby"])
    assert mailops.STATE["groups"]["sender"][DUO1]["smart_key"] \
        == "k:cat:hobby"
    put(key=DUO1, tags=None)
    assert mailops.STATE["groups"]["sender"][DUO1]["smart_key"] \
        != "k:cat:hobby"


def test_tag_changes_do_not_touch_the_verdict_and_vice_versa(ai):
    review_all()
    put(key=BIG, verdict="keep")
    put(key=BIG, tags=["x"])
    assert verdict(BIG) == "keep"
    put(key=BIG, verdict=None)
    assert verdict(BIG) == "delete_safe" and shown()[BIG]["tags"] == ["x"]


# ----------------------------------------------- backup, privacy, accounts

def test_labels_are_part_of_the_backup_and_merge_back(mailbox):
    put(key=BIG, verdict="keep", tags=["a"])
    exported = client.get("/api/export_config").json()
    assert exported["labels"][acc().name][BIG]["verdict"] == "keep"
    ls.set_labels(acc().name, BIG, verdict=None, tags=None)
    ls.set_labels(acc().name, OTHER, verdict="review")
    r = client.post("/api/import_config", json=exported)
    assert r.status_code == 200, r.text
    assert verdict(BIG) == "keep"                 # live state follows
    assert shown()[BIG]["tags"] == ["a"]
    # merge: an entry of this install is never overwritten by the backup
    assert verdict(OTHER) == "review"
    # unknown accounts and damaged entries are dropped, no crash
    r = client.post("/api/import_config", json={"labels": {
        "ghost": {"x@y.example": {"verdict": "keep"}},
        acc().name: {"bad": {"verdict": "keep"},
                     "c@y.example": {"verdict": "bogus"}}}})
    assert r.status_code == 200
    assert "ghost" not in ls.export_section()
    assert "c@y.example" not in ls.load_account(acc().name)


def test_nothing_private_is_logged(mailbox, caplog):
    caplog.set_level(logging.DEBUG)
    put(key=BIG, verdict="keep", tags=["secret-tag"])
    put(key=BIG, reset=True)
    client.get("/api/labels", params={"key": BIG})
    put(key="nobody@nowhere.example", verdict="keep")
    text = "\n".join(r.getMessage() for r in caplog.records
                     if r.name.startswith("inboxrake"))
    assert "sender labels" in text
    for secret in (BIG, "solo.example", "secret-tag", "keep"):
        assert secret not in text, secret


def test_account_rename_and_delete_carry_the_labels(mailbox):
    name = acc().name
    put(key=BIG, verdict="keep")
    ls.rename_account(name, "renamed")
    assert ls.verdicts("renamed") == {BIG: "keep"} and ls.verdicts(name) == {}


def test_the_ai_payload_still_carries_no_verdict_of_the_user(ai):
    """Only metadata goes to the provider: the user's verdict / flags are not
    added to the payload (tags are, as before)."""
    put(key=BIG, verdict="keep")
    review_all()
    blob = " ".join(c["messages"][0]["content"] for c in ai.calls)
    assert "src" not in blob and '"user"' not in blob


def test_labels_module_exposes_the_documented_ops():
    assert callable(labels.put) and callable(labels.detail)
    assert labels.LabelError is ls.LabelError
