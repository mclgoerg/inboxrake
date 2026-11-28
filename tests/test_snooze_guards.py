"""Not now (IZ131): what the redesign added to the reused backend of snooze.py -
the Snoozed folder is locked where it could be broken (Your folders), left
alone by the features that read or move mail across folders and accounts
(Move to another account, the copies across accounts, Remove the file), the
store follows a renamed or merged origin folder, a sender's snoozed mail can
be brought back by address, and the page's rows carry the kind and the
folder. Everything runs against the in-memory FakeIMAP double."""

import time

import pytest
from fastapi.testclient import TestClient

from backend import accountcopy
from backend import allaccounts
from backend import mailops
from backend import removefiles
from backend import rules as rulesmod
from backend import snooze
from backend import snoozestore
from backend import yourfolders as yf
from backend.main import app

from conftest import FakeIMAP, wait_delete_done
from test_snooze import (DEALS, NEWS, PAT, acc, box, mail, scan, snooze_deals,
                         subjects, the_store)

client = TestClient(app)
HOUR = 3600


def later(hours=1):
    return int(time.time()) + hours * HOUR


# ------------------------------------------------- locked in Your folders

def test_the_snoozed_folder_is_locked_in_your_folders(box):
    scan()
    snooze_deals()
    out = yf.overview(acc())
    # a special folder like Trash: no row, nothing offered on it
    assert "Snoozed" not in {r["name"] for r in out["rows"]}
    special = {s["name"]: s for s in out["special"]}
    assert special["Snoozed"]["role"] == "snoozed"
    assert special["Snoozed"]["why"] == "role"
    for call in (
            lambda: yf.check(acc(), "rename", "Snoozed", name="Later"),
            lambda: yf.check(acc(), "delete", "Snoozed"),
            lambda: yf.check(acc(), "merge", "Snoozed", "Archive"),
            lambda: yf.rename(acc(), "Snoozed", "Later"),
            lambda: yf.delete(acc(), "Snoozed", 1),
            lambda: yf.merge(acc(), "Snoozed", "Archive", 1, 99)):
        with pytest.raises(RuntimeError, match="folder_locked"):
            call()
    # still there, and still holding the mail
    assert subjects(box, "Snoozed") == ["Subject 1", "Subject 10", "Subject 2",
                                        "Subject 3"]


def test_nothing_is_merged_into_the_snoozed_folder_nor_created_under_its_name(box):
    _add_folder(box, "Offers", [mail(30, PAT)])
    scan()
    # before Not now made it: the name is the server's, not a folder to make
    with pytest.raises(RuntimeError, match="folder_reserved"):
        yf.create(acc(), "Snoozed")
    snooze_deals()
    with pytest.raises(RuntimeError, match="folder_target_bad"):
        yf.check(acc(), "merge", "Offers", "Snoozed")
    with pytest.raises(RuntimeError, match="folder_(exists|reserved)"):
        yf.create(acc(), "snoozed")


def test_a_snoozed_folder_under_a_namespace_prefix_is_locked_too(monkeypatch):
    """The folder Inboxrake makes under the server's personal namespace is
    the role folder (by its record), locked like Trash and Junk."""
    fake = FakeIMAP({"INBOX": [mail(1, DEALS)], "INBOX.Sent": [],
                     "INBOX.Trash": []}, delimiter=".", namespace="INBOX.",
                    renumber=True, copyuid=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    scan()
    snooze_deals()
    out = yf.overview(acc())
    assert "INBOX.Snoozed" not in {r["name"] for r in out["rows"]}
    assert any(s["role"] == "snoozed" for s in out["special"])
    with pytest.raises(RuntimeError, match="folder_locked"):
        yf.check(acc(), "delete", "INBOX.Snoozed")


# --------------------------------------- out of every other feature's reach

def test_snoozed_mail_is_in_no_scan_group_count_or_index(box):
    scan()
    snooze_deals()
    scan()
    # (a scan after it all: nothing of theirs comes back into the lists)
    assert not any(m["addr"] == DEALS and m["folder"] == "Snoozed"
                   for m in acc().index.values())
    assert DEALS in acc().state["groups"]["sender"]       # the read mail stays
    assert acc().state["groups"]["sender"][DEALS]["count"] == 1
    assert "Snoozed" not in acc().state["folders_raw"]


def test_move_to_another_account_leaves_the_snoozed_mail_alone(box):
    scan()
    snooze_deals()
    classified = accountcopy.classify(acc())
    assert {m["folder"] for m in classified} == {"INBOX"}
    # of the deals sender only the mail that was read (and stayed) is there
    assert [m["subject"] for m in classified if m["addr"] == DEALS] \
        == ["Subject 4"]


def test_the_copies_across_accounts_never_list_snoozed_mail(box):
    scan()
    snooze_deals()
    by_key, repeated = allaccounts._snapshot(acc().name)
    ids = {mid for mid, _size in by_key} | repeated
    assert "<m1@shop.example>" not in ids          # snoozed
    assert "<m4@shop.example>" in ids              # the read one stayed


def test_remove_the_file_never_reaches_snoozed_mail(box):
    scan()
    snooze_deals()
    uids = [m["uid"] for m in box.mailbox["Snoozed"]]
    assert uids
    rows = removefiles._rows(acc(), [["Snoozed", u] for u in uids],
                             [("invoice.pdf", 1000)])
    assert rows == []
    out = removefiles.check(acc(), [["Snoozed", u] for u in uids],
                            [("invoice.pdf", 1000)])
    assert out["mails"] == [] and out["blocked"] == []


def test_rules_and_assistants_can_never_snooze(box):
    """Snoozing is a person's choice: the job queue runs it, but the actions
    a rule or an AI assistant may take do not include it."""
    assert "snooze" not in mailops.ACTIONS
    assert "snooze" in mailops.JOB_ACTIONS
    with pytest.raises(ValueError):
        rulesmod.create_rule({"name": "Snooze them", "grouping": "sender",
                              "query": f"from:{DEALS}", "action": "snooze"})
    with pytest.raises(ValueError):
        mailops._start_delete({"INBOX": {1}}, "x", acc(), action="bogus")


# ----------------------------------------------- the store follows folders

def _add_folder(box, name, msgs):
    box.mailbox[name] = list(msgs)
    box.uv[name] = 1


def test_a_renamed_origin_folder_is_followed_and_the_mail_returns_there(box):
    _add_folder(box, "Offers", [mail(30, DEALS), mail(31, DEALS)])
    scan()
    snooze_deals()
    origins = {r["origin"] for r in the_store()["mails"].values()}
    assert "Offers" in origins
    yf.rename(acc(), "Offers", "Deals page")
    after = {r["origin"] for r in the_store()["mails"].values()}
    assert "Offers" not in after and "Deals page" in after
    # the mail that came from there goes back under its new name, unread
    snooze.release(acc(), None, due=time.time() + 10 * HOUR)
    assert {"Subject 30", "Subject 31"} <= set(subjects(box, "Deals page"))
    assert subjects(box, "Snoozed") == []


def test_a_merged_origin_folder_is_followed_too(box):
    # (a read mail stays in Offers, so there is something to merge)
    _add_folder(box, "Offers", [mail(30, DEALS), mail(31, DEALS, seen=True)])
    _add_folder(box, "Bargains", [mail(40, PAT)])
    scan()
    snooze_deals()
    assert "Offers" in {r["origin"] for r in the_store()["mails"].values()}
    chk = yf.check(acc(), "merge", "Offers", "Bargains")
    yf.merge(acc(), "Offers", "Bargains", chk["uv"], chk["max_uid"])
    after = {r["origin"] for r in the_store()["mails"].values()}
    assert "Offers" not in after and "Bargains" in after


def test_a_folder_that_is_gone_sends_the_mail_to_the_inbox(box):
    """Nothing is ever stuck: an origin that no longer exists means the
    inbox."""
    _add_folder(box, "Offers", [mail(30, DEALS)])
    scan()
    snooze_deals()
    del box.mailbox["Offers"]
    snooze.release(acc(), None, due=time.time() + 10 * HOUR)
    assert "Subject 30" in subjects(box, "INBOX")
    assert subjects(box, "Snoozed") == []


def test_remap_origins_is_per_account_and_changes_only_what_moved():
    snoozestore.add_mails({"<a@x>": {"origin": "Old", "until": 5,
                                     "addr": "a@x.example"},
                           "<b@x>": {"origin": "Other", "until": 5,
                                     "addr": "a@x.example"}}, "one")
    snoozestore.add_mails({"<c@x>": {"origin": "Old", "until": 5,
                                     "addr": "a@x.example"}}, "two")
    assert snoozestore.remap_origins(
        lambda f: "New" if f == "Old" else f, "one") == 1
    assert snoozestore.load_account("one")["mails"]["<a@x>"]["origin"] == "New"
    assert snoozestore.load_account("one")["mails"]["<b@x>"]["origin"] == "Other"
    assert snoozestore.load_account("two")["mails"]["<c@x>"]["origin"] == "Old"
    assert snoozestore.remap_origins(lambda f: f, "one") == 0


# ------------------------------------------ the pane line and Back now

def test_the_summary_counts_what_each_sender_has_snoozed(box):
    scan()
    snooze_deals()
    s = snoozestore.summary(acc().name)
    assert s["mails"] == {DEALS: 4}
    assert s["count"] == 4 and set(s["until"]) == {DEALS}
    assert mailops.public_state()["snoozed"]["mails"] == {DEALS: 4}


def test_back_now_by_sender_returns_all_of_that_senders_mail_unread(box):
    scan()
    snooze_deals()
    r = client.post("/api/snoozed/back", json={"addr": DEALS})
    assert r.status_code == 200 and r.json()["returned"] == 4
    wait_delete_done()
    assert subjects(box, "Snoozed") == []
    assert subjects(box, "INBOX") == ["Subject 1", "Subject 2", "Subject 3",
                                      "Subject 4", "Subject 5", "Subject 6"]
    assert all(not m["seen"] for m in box.mailbox["INBOX"]
               if m["subject"] in ("Subject 1", "Subject 2", "Subject 3"))
    assert snoozestore.summary(acc().name)["mails"] == {}


def test_back_now_by_sender_leaves_other_senders_and_unknown_ones_alone(box):
    scan()
    snooze.snooze_groups(acc(), "sender", [DEALS, NEWS], later())
    wait_delete_done()
    r = client.post("/api/snoozed/back", json={"addr": NEWS})
    assert r.status_code == 200 and r.json()["returned"] == 1
    assert snoozestore.summary(acc().name)["mails"] == {DEALS: 4}
    assert client.post("/api/snoozed/back",
                       json={"addr": "nobody@nowhere.example"}
                       ).status_code == 400


def test_back_now_by_sender_keeps_a_batch_it_belongs_to(box):
    scan()
    snooze.set_batch(acc(), DEALS, "weekly", "UTC", "Deals")
    box.mailbox["INBOX"].append(mail(21, DEALS))
    scan()
    wait_delete_done()
    assert snoozestore.summary(acc().name)["mails"] == {DEALS: 1}
    r = client.post("/api/snoozed/back", json={"addr": DEALS})
    assert r.json()["returned"] == 1
    # the mail is back, the batch goes on (and does not catch it again)
    assert DEALS in the_store()["batches"]
    scan()
    wait_delete_done()
    assert snoozestore.summary(acc().name)["mails"] == {}


def test_each_account_has_its_own_line(box):
    scan()
    snooze_deals()
    assert snoozestore.summary("another")["mails"] == {}
    assert snoozestore.summary(acc().name)["mails"] == {DEALS: 4}


# -------------------------------------------------- the page's rows

def test_the_listing_names_the_folder_and_the_kind_of_a_senders_mail(box):
    scan()
    snooze_deals()
    page = snooze.listing(acc())
    assert page["folder"] == "Snoozed"
    row = page["rows"][0]
    assert row["addr"] == DEALS and row["count"] == 4
    assert row["what"] == ""        # (plain subjects have no kind)
    for rec in the_store()["mails"].values():
        assert rec["kind"] == ""


def test_the_kind_is_kept_and_the_commonest_one_shown(box):
    scan()
    # an order mail and an ad: invented subjects the kind rules know
    box.mailbox["INBOX"][0] = mail(1, DEALS)
    snooze_deals()
    store = the_store()["mails"]
    for mid in list(store):
        snoozestore.add_mails({mid: {**store[mid], "kind": "ads"}}, acc().name)
    page = snooze.listing(acc())
    assert page["rows"][0]["what"] == "ads"


def test_a_damaged_kind_is_dropped_not_trusted(box):
    snoozestore.add_mails({"<k@x>": {"origin": "INBOX", "until": 5,
                                     "addr": "a@x.example",
                                     "kind": "Not A Kind!"}}, acc().name)
    assert the_store()["mails"]["<k@x>"]["kind"] == ""


def test_the_listing_of_a_folder_under_a_prefix_says_so(monkeypatch):
    fake = FakeIMAP({"INBOX": [mail(1, DEALS)], "INBOX.Sent": []},
                    delimiter=".", namespace="INBOX.", renumber=True,
                    copyuid=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    scan()
    snooze_deals()
    assert snooze.listing(acc())["folder"] == "INBOX.Snoozed"
