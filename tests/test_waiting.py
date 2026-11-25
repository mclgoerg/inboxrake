"""Waiting for a reply (backend/waiting.py, backend/waitstore.py): the sent
index read from the Sent folder (headers only, 90 days, incremental), the
matcher (who is a person, the latest mail of a conversation, what counts as
an answer), the usual answer time, the user's decisions, the reminders and
the API around them. Invented `.example` data and generic words only."""

import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import mailops, tenants, waiting, waitstore, webpush
from backend.main import app
from conftest import make_msg

NOW = 1_800_000_000
DAY = 86400
ME = "me@self.example"
client = TestClient(app)


def _ts(days_ago):
    return int(NOW - days_ago * DAY)


def _sent(days_ago, to, subject="Question", msgid=None, irt=None, refs=None,
          frm=ME, uid=None, _n=[100]):
    _n[0] += 1
    people = [to] if isinstance(to, str) else to
    return {"uid": uid or _n[0], "id": msgid or f"<s{_n[0]}@self.example>",
            "ts": _ts(days_ago), "subj": subject, "from": frm,
            "to": [[a, a.partition("@")[0].title()] for a in people],
            "irt": [irt] if irt else [], "refs": refs or []}


def _in(days_ago, addr, subject="Re: Question", msgid=None, irt=None,
        refs=None, bulk=False, name="", folder="INBOX", _n=[500]):
    _n[0] += 1
    return {"ts": _ts(days_ago), "subject": subject, "addr": addr,
            "name": name, "folder": folder, "uid": _n[0],
            "msgid": msgid or f"<i{_n[0]}@their.example>",
            "irt": [irt] if irt else [], "refs": refs or [],
            "size": 10, "bulk": bulk, "seen": True}


def _acc(incoming=(), sent=(), name="acct", sent_folder="Sent"):
    acc = SimpleNamespace(
        name=name, lock=threading.RLock(), tenant=tenants.DEFAULT,
        index={(m["folder"], m["uid"]): m for m in incoming},
        role_index={},
        state={"groups_rev": 1, "status": "done", "scanned_ts": NOW},
        folder_roles={"sent": sent_folder} if sent_folder else {})
    waitstore.save_index(sent_folder or "Sent", 1, list(sent), name)
    return acc


def _items(acc, state=None):
    out = waiting.listing(acc, NOW)["items"]
    return [i for i in out if state is None or i["state"] == state]


def _states(acc):
    return {i["subject"]: i["state"] for i in _items(acc)}


# ------------------------------------------------------------ the matcher

def test_a_sent_mail_nobody_answered_is_open():
    acc = _acc(sent=[_sent(5, "pat@their.example", "Quote for May")])
    [it] = _items(acc)
    assert (it["state"], it["subject"], it["days"]) == ("open", "Quote for May", 5)
    assert it["person"] == {"addr": "pat@their.example", "name": "Pat"}
    assert it["overdue"] and it["recipients"] == 1


def test_an_answer_in_the_conversation_from_the_recipient_closes_it():
    s = _sent(5, "pat@their.example", msgid="<q1@self.example>")
    reply = _in(3, "pat@their.example", irt="<q1@self.example>")
    acc = _acc([reply], [s])
    [it] = _items(acc)
    assert it["state"] == "answered" and it["answered_days"] == 2


def test_the_answer_may_name_the_conversation_by_references_only():
    s = _sent(5, "pat@their.example", msgid="<q1@self.example>")
    reply = _in(3, "pat@their.example", refs=["<q1@self.example>"])
    assert _items(_acc([reply], [s]))[0]["state"] == "answered"


def test_a_mail_from_them_that_is_older_than_yours_is_no_answer():
    s = _sent(2, "pat@their.example", msgid="<q2@self.example>",
              irt="<q0@their.example>")
    earlier = _in(4, "pat@their.example", msgid="<q0@their.example>")
    assert _items(_acc([earlier], [s]))[0]["state"] == "open"


def test_a_mail_from_somebody_else_in_the_conversation_is_no_answer():
    s = _sent(5, "pat@their.example", msgid="<q1@self.example>")
    other = _in(3, "lee@their.example", irt="<q1@self.example>")
    assert _items(_acc([other], [s]))[0]["state"] == "open"


def test_any_of_several_recipients_can_answer():
    s = _sent(5, ["pat@their.example", "lee@their.example"],
              msgid="<q1@self.example>")
    other = _in(3, "lee@their.example", irt="<q1@self.example>")
    [it] = _items(_acc([other], [s]))
    assert it["state"] == "answered" and it["recipients"] == 2


def test_a_newsletter_from_the_same_sender_is_never_an_answer():
    """Their bulk mail may share the conversation (a quoted subject, a
    reference): it must not close the mail."""
    s = _sent(5, "pat@their.example", msgid="<q1@self.example>")
    news = _in(3, "pat@their.example", irt="<q1@self.example>", bulk=True)
    acc = _acc([news], [s])
    # the address also writes ordinary mail, so it is a person, not a list
    plain = _in(40, "pat@their.example")
    acc.index[(plain["folder"], plain["uid"])] = plain
    assert _items(acc)[0]["state"] == "open"


def test_only_your_latest_mail_of_a_conversation_is_considered():
    first = _sent(9, "pat@their.example", "First", msgid="<a@self.example>")
    second = _sent(6, "pat@their.example", "Second", msgid="<b@self.example>",
                   irt="<a@self.example>", refs=["<a@self.example>"])
    acc = _acc(sent=[first, second])
    assert _states(acc) == {"Second": "open"}


def test_a_newer_mail_of_yours_to_nobody_hides_the_older_one():
    first = _sent(9, "pat@their.example", "First", msgid="<a@self.example>")
    second = _sent(6, ME, "Note to self", msgid="<b@self.example>",
                   irt="<a@self.example>")
    assert _items(_acc(sent=[first, second])) == []


def test_two_conversations_are_two_rows():
    acc = _acc(sent=[_sent(5, "pat@their.example", "One"),
                     _sent(4, "pat@their.example", "Two")])
    assert _states(acc) == {"One": "open", "Two": "open"}


def test_your_own_addresses_are_not_people():
    acc = _acc(sent=[_sent(5, [ME, "alias@self.example"], "Reminder",
                           frm=ME)])
    acc2 = _acc(sent=[_sent(5, "me@self.example", "To me", frm=ME)],
                name="other")
    assert _items(acc2) == []
    # an address you also wrote From is yours; an unknown one is a person
    assert [i["person"]["addr"] for i in _items(acc)] == ["alias@self.example"]


def test_no_reply_addresses_are_not_people():
    acc = _acc(sent=[_sent(5, "noreply@shop.example", "Cancel"),
                     _sent(5, "no-reply@shop.example", "Cancel 2"),
                     _sent(5, "notifications@shop.example", "Cancel 3")])
    assert _items(acc) == []


def test_a_list_sender_is_not_a_person():
    acc = _acc([_in(30, "news@list.example", bulk=True)],
               [_sent(5, "news@list.example", "Unsubscribe me")])
    assert _items(acc) == []


def test_one_person_among_the_recipients_is_enough():
    acc = _acc(sent=[_sent(5, ["noreply@shop.example", "pat@their.example"],
                           "Both")])
    [it] = _items(acc)
    assert it["person"]["addr"] == "pat@their.example" and it["recipients"] == 1


def test_a_sent_mail_without_recipients_is_skipped():
    acc = _acc(sent=[_sent(5, [], "Draft-like")])
    assert _items(acc) == []


def test_the_person_is_named_from_the_header_then_from_their_mail():
    s = _sent(5, "kai@their.example")
    s["to"] = [["kai@their.example", ""]]
    acc = _acc([_in(40, "kai@their.example", name="Kai Doe")], [s])
    assert _items(acc)[0]["person"]["name"] == "Kai Doe"
    s["to"] = [["kai@their.example", "Kai D."]]
    assert _items(_acc([_in(40, "kai@their.example", name="Kai Doe")],
                       [s]))[0]["person"]["name"] == "Kai D."


# ------------------------------------------------- overdue and usual time

def _history(addr, gaps_days, start=60):
    """Earlier conversations with `addr` that they answered after each gap."""
    sent, incoming = [], []
    for n, gap in enumerate(gaps_days):
        mid = f"<h{addr}{n}@self.example>"
        t0 = start - n * 10
        sent.append(_sent(t0, addr, f"Old {n}", msgid=mid))
        incoming.append(_in(t0 - gap, addr, irt=mid))
    return sent, incoming


def test_the_threshold_decides_when_a_mail_turns_overdue():
    for days, overdue in ((2, True), (3, True), (7, False)):
        acc = _acc(sent=[_sent(4, "pat@their.example")], name=f"t{days}")
        waiting.set_settings(acc, None, days)
        assert _items(acc)[0]["overdue"] is overdue, days
    acc = _acc(sent=[_sent(2.5, "pat@their.example")], name="young")
    waiting.set_settings(acc, None, 3)
    assert _items(acc)[0]["overdue"] is False


def test_the_threshold_is_three_days_by_default():
    assert waitstore.load_account("acct")["days"] == 3
    young = _acc(sent=[_sent(2, "pat@their.example")])
    old = _acc(sent=[_sent(4, "pat@their.example")], name="b")
    assert _items(young)[0]["overdue"] is False
    assert _items(old)[0]["overdue"] is True


def test_the_usual_answer_time_is_the_median_of_earlier_conversations():
    sent, incoming = _history("pat@their.example", [1, 2, 9])
    acc = _acc(incoming, sent + [_sent(5, "pat@their.example", "Now")])
    it = _items(acc, "open")[0]
    assert (it["usual_days"], it["usual_n"]) == (2, 3)


def test_two_earlier_conversations_are_the_least_that_make_a_usual_time():
    one_s, one_i = _history("pat@their.example", [6])
    acc = _acc(one_i, one_s + [_sent(5, "pat@their.example", "Now")])
    it = _items(acc, "open")[0]
    assert it["usual_days"] is None and it["usual_n"] == 0
    two_s, two_i = _history("pat@their.example", [6, 6])
    acc = _acc(two_i, two_s + [_sent(5, "pat@their.example", "Now")],
               name="two")
    it = _items(acc, "open")[0]
    assert it["usual_days"] == 6 and it["usual_n"] == 2


def test_a_slow_person_delays_the_overdue_mark():
    sent, incoming = _history("slow@their.example", [10, 10])
    acc = _acc(incoming, sent + [_sent(6, "slow@their.example", "Now")])
    assert _items(acc, "open")[0]["overdue"] is False          # 6 < 10
    acc = _acc(incoming, sent + [_sent(11, "slow@their.example", "Now")],
               name="late")
    assert _items(acc, "open")[0]["overdue"] is True


def test_a_quick_person_never_lowers_the_threshold():
    sent, incoming = _history("quick@their.example", [1, 1])
    acc = _acc(incoming, sent + [_sent(2, "quick@their.example", "Now")])
    it = _items(acc, "open")[0]
    assert it["usual_days"] == 1 and it["overdue"] is False    # 2 < 3 days


def test_the_conversation_itself_is_not_one_of_the_earlier_ones():
    """A conversation that was answered once and then continued by you is
    one conversation, not a sample for its own waiting mail."""
    sent, incoming = _history("pat@their.example", [2])
    first = _sent(30, "pat@their.example", "Thread", msgid="<t1@self.example>")
    answer = _in(28, "pat@their.example", irt="<t1@self.example>")
    again = _sent(6, "pat@their.example", "Re: Thread",
                  msgid="<t2@self.example>", irt="<t1@self.example>")
    acc = _acc(incoming + [answer], sent + [first, again])
    it = next(i for i in _items(acc, "open") if i["subject"] == "Re: Thread")
    assert it["usual_n"] == 0          # one earlier conversation: not enough


def test_the_rows_are_sorted_by_how_overdue_they_are():
    acc = _acc(sent=[_sent(1, "a@their.example", "One day"),
                     _sent(12, "b@their.example", "Twelve"),
                     _sent(4, "c@their.example", "Four"),
                     _sent(6, "d@their.example", "Six")])
    assert [i["subject"] for i in _items(acc, "open")] == [
        "Twelve", "Six", "Four", "One day"]


# --------------------------------------------------- the three figures

def test_the_figures():
    acc = _acc(
        incoming=[_in(8, "ans@their.example", irt="<a1@self.example>")],
        sent=[_sent(10, "ans@their.example", "Answered", msgid="<a1@self.example>"),
              _sent(1, "new@their.example", "Fresh"),
              _sent(5, "old@their.example", "Late"),
              _sent(40, "far@their.example", "Far back")])
    out = waiting.listing(acc, NOW)
    assert out["kpis"]["overdue"] == 2             # Late and Far back
    assert out["kpis"]["recent"] == 1              # Fresh
    # the last 30 days: Answered, Fresh, Late (Far back is older)
    assert out["kpis"] == {"overdue": 2, "recent": 1, "share": 33,
                           "share_of": 3}
    assert out["counts"] == {"open": 3, "answered": 1, "needed": 0}
    assert out["summary"]["overdue"] == 2 and out["summary"]["people_n"] == 2
    assert out["summary"]["people"] == ["Far", "Old"]
    assert out["summary"]["oldest_days"] == 40


def test_the_share_is_empty_without_mails():
    out = waiting.listing(_acc(), NOW)
    assert out["kpis"]["share"] is None and out["items"] == []


def test_answered_rows_are_capped_but_counted():
    sent, incoming = [], []
    for n in range(waiting.ANSWERED_MAX + 5):
        mid = f"<c{n}@self.example>"
        sent.append(_sent(20, f"p{n}@their.example", f"S{n}", msgid=mid))
        incoming.append(_in(19, f"p{n}@their.example", irt=mid))
    out = waiting.listing(_acc(incoming, sent), NOW)
    assert out["counts"]["answered"] == waiting.ANSWERED_MAX + 5
    assert len(out["items"]) == waiting.ANSWERED_MAX


# ------------------------------------------------------- no answer needed

def test_no_answer_needed_moves_the_mail_and_it_can_come_back():
    s = _sent(5, "pat@their.example", msgid="<q1@self.example>")
    acc = _acc(sent=[s])
    waiting.set_needed(acc, "<q1@self.example>", True)
    assert _items(acc)[0]["state"] == "needed"
    assert waiting.listing(acc, NOW)["counts"]["needed"] == 1
    waiting.set_needed(acc, "<q1@self.example>", False)
    assert _items(acc)[0]["state"] == "open"


def test_an_answer_wins_over_no_answer_needed():
    s = _sent(5, "pat@their.example", msgid="<q1@self.example>")
    acc = _acc([_in(3, "pat@their.example", irt="<q1@self.example>")], [s])
    waiting.set_needed(acc, "<q1@self.example>", True)
    assert _items(acc)[0]["state"] == "answered"


def test_a_new_mail_in_the_conversation_is_open_again():
    first = _sent(9, "pat@their.example", msgid="<a@self.example>")
    acc = _acc(sent=[first])
    waiting.set_needed(acc, "<a@self.example>", True)
    waitstore.save_index("Sent", 1, [first, _sent(
        1, "pat@their.example", msgid="<b@self.example>",
        irt="<a@self.example>")], "acct")
    assert [i["state"] for i in _items(acc)] == ["open"]


def test_an_unknown_mail_is_refused():
    acc = _acc(sent=[_sent(5, "pat@their.example")])
    with pytest.raises(ValueError):
        waiting.set_needed(acc, "<nope@x>", True)


def test_decisions_are_per_account_and_per_tenant():
    waitstore.set_needed("<q1@self.example>", True, "one")
    waitstore.set_settings(days=7, account="one")
    assert waitstore.load_account("two")["needed"] == []
    assert waitstore.load_account("two")["days"] == 3
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert waitstore.load_account("one")["needed"] == []
        assert waitstore.load_account("one")["days"] == 3
        waitstore.set_needed("<q9@self.example>", True, "one")
        waitstore.save_index("Sent", 1, [_sent(1, "a@b.example")], "one")
    assert waitstore.load_account("one")["needed"] == ["<q1@self.example>"]
    assert waitstore.load_index("one")["mails"] == []
    assert (alice.root / "waiting.json").is_file()
    assert (alice.root / "sent_index.json").is_file()


def test_account_rename_and_drop_carry_everything():
    waitstore.set_needed("<q1@self.example>", True, "one")
    waitstore.set_reminder("<q1@self.example>", NOW + 5, "one")
    waitstore.save_index("Sent", 3, [_sent(1, "a@b.example")], "one")
    waitstore.set_needed("<q2@self.example>", True, "two")
    waitstore.rename_account("one", "uno")
    assert waitstore.load_account("one")["needed"] == []
    assert waitstore.load_account("uno")["needed"] == ["<q1@self.example>"]
    assert "<q1@self.example>" in waitstore.load_account("uno")["reminders"]
    assert len(waitstore.load_index("uno")["mails"]) == 1
    assert waitstore.load_index("one")["mails"] == []
    waitstore.rename_account("ghost", "x")              # unknown: a no-op
    waitstore.drop_account("two")
    assert waitstore.load_account("two")["needed"] == []
    waitstore._cache.clear()
    waitstore._index_cache.clear()                      # persisted, too
    assert waitstore.load_account("uno")["needed"] == ["<q1@self.example>"]
    assert len(waitstore.load_index("uno")["mails"]) == 1


@pytest.mark.parametrize("content", [
    "{not json", "", "[]", '"str"', "null", '{"accounts": []}',
    '{"accounts": {"a": "nope"}}', '{"accounts": {"a": {"needed": 5}}}',
    '{"accounts": {"a": {"days": 99, "track": 0, "reminders": []}}}',
    b"\xff\xfe\x00garbage",
])
def test_a_damaged_file_is_forgotten_not_fatal(tmp_path, content):
    for name in ("waiting.json", "sent_index.json"):
        path = tmp_path / name
        path.write_bytes(content if isinstance(content, bytes)
                         else content.encode())
    waitstore._cache.clear()
    waitstore._index_cache.clear()
    assert waitstore.load_account("a")["days"] == 3
    assert waitstore.load_index("a")["mails"] == []


def test_the_stores_ignore_what_does_not_fit():
    path = waitstore.WAITING_PATH
    path.write_text(json.dumps({"accounts": {"a": {
        "needed": ["<ok@x>", 5, "", "x" * 400],
        "reminders": {"<r@x>": {"at": 5}, "<bad@x>": {"at": "no"}},
        "days": 7}}}))
    waitstore._cache.clear()
    b = waitstore.load_account("a")
    assert b["needed"] == ["<ok@x>"] and b["days"] == 7
    assert b["reminders"] == {"<r@x>": {"at": 5, "fired": 0}}


# ----------------------------------------------------------- reminders

@pytest.fixture
def pushes(monkeypatch):
    got = []
    monkeypatch.setattr(webpush, "job_finished",
                        lambda acc, kind, ok, **p: got.append((kind, p)))
    return got


def _remind_case():
    s = _sent(14, "pat@their.example", "Change of plan",
              msgid="<q1@self.example>")
    acc = _acc(sent=[s])
    return acc, s["id"]


def test_a_reminder_fires_once_when_it_is_due(pushes):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 3600, NOW)
    assert waiting.tick_account(acc, NOW) == 0 and pushes == []
    assert waiting.tick_account(acc, NOW + 3601) == 1
    assert pushes == [("waiting", {"name": "Pat", "days": 14,
                                   "usual": None, "ref": mid})]
    assert waiting.tick_account(acc, NOW + 7200) == 0      # once
    assert len(pushes) == 1


def test_a_reminder_clears_itself_when_the_answer_arrives(pushes):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 3600, NOW)
    reply = _in(0, "pat@their.example", irt=mid)
    acc.index[(reply["folder"], reply["uid"])] = reply
    assert waiting.tick_account(acc, NOW + 7200) == 0
    assert pushes == []
    assert waitstore.load_account("acct")["reminders"] == {}


def test_a_fired_reminder_is_dropped_by_the_answer_too(pushes):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 60, NOW)
    waiting.tick_account(acc, NOW + 120)
    assert waiting.reminded(acc, NOW + 120) == ["Pat"]
    assert [r["name"] for r in waiting.recent_reminders(acc, NOW + 130)] \
        == ["Pat"]
    reply = _in(0, "pat@their.example", irt=mid)
    acc.index[(reply["folder"], reply["uid"])] = reply
    waiting.after_scan(acc)
    assert waitstore.load_account("acct")["reminders"] == {}
    assert waiting.reminded(acc, NOW + 140) == []
    assert waiting.recent_reminders(acc, NOW + 140) == []


def test_no_answer_needed_cancels_the_reminder(pushes):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 3600, NOW)
    waiting.set_needed(acc, mid, True)
    assert waitstore.load_account("acct")["reminders"] == {}
    assert waiting.tick_account(acc, NOW + 9999) == 0


def test_a_reminder_can_be_replaced_and_fires_again_for_the_new_time(pushes):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 60, NOW)
    waiting.tick_account(acc, NOW + 120)
    waiting.set_reminder(acc, mid, NOW + 5000, NOW + 130)
    assert waiting.tick_account(acc, NOW + 5100) == 1
    assert len(pushes) == 2
    waiting.set_reminder(acc, mid, None, NOW)
    assert waitstore.load_account("acct")["reminders"] == {}


def test_a_reminder_time_must_be_sane():
    acc, mid = _remind_case()
    with pytest.raises(ValueError):
        waiting.set_reminder(acc, mid, NOW - 3600, NOW)
    with pytest.raises(ValueError):
        waiting.set_reminder(acc, mid, NOW + 400 * DAY, NOW)
    with pytest.raises(ValueError):
        waiting.set_reminder(acc, "<nope@x>", NOW + 60, NOW)


def test_a_reminder_is_for_an_open_mail_only():
    s = _sent(5, "pat@their.example", msgid="<q1@self.example>")
    acc = _acc([_in(3, "pat@their.example", irt="<q1@self.example>")], [s])
    with pytest.raises(ValueError):
        waiting.set_reminder(acc, "<q1@self.example>", NOW + 60, NOW)


def test_nothing_fires_before_the_first_scan(pushes):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 60, NOW)
    acc.state["scanned_ts"] = None
    assert waiting.tick_account(acc, NOW + 120) == 0 and pushes == []
    assert mid in waitstore.load_account("acct")["reminders"]


def test_the_tick_walks_every_tenant(pushes, monkeypatch):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 60, NOW)
    monkeypatch.setattr(accountsmod, "names", lambda: ["acct"])
    monkeypatch.setattr(accountsmod, "get", lambda name=None: acc)
    waiting.tick(NOW + 120)
    assert len(pushes) == 1


# ------------------------------------------------------ the timeline

def test_the_timeline_tells_the_conversation():
    first = _in(8, "pat@their.example", "Your booking is confirmed",
                msgid="<c1@their.example>", name="Pat Doe")
    mine = _sent(7, "pat@their.example", "Change of booking",
                 msgid="<m1@self.example>", irt="<c1@their.example>")
    ans = _in(6, "pat@their.example", "Re: Change of booking",
              irt="<m1@self.example>")
    again = _sent(4, "pat@their.example", "Re: Change of booking",
                  msgid="<m2@self.example>", irt="<m1@self.example>")
    news = [_in(2, "pat@their.example", "Offers", bulk=True),
            _in(1, "news@their.example", "More offers", bulk=True)]
    acc = _acc([first, ans, *news], [mine, again])
    d = waiting.detail(acc, "<m2@self.example>", NOW)
    kinds = [(e["kind"], e["who"]) for e in d["timeline"]]
    # the person is named as you wrote them (the To header), whoever the mail
    assert kinds == [("in", "Pat"), ("out", ""), ("in", "Pat"), ("out", "")]
    assert d["timeline"][1]["answered_ts"] == _ts(6)
    assert d["timeline"][3]["answered_ts"] is None
    assert d["newsletters"] == 2            # their bulk mail, same company
    assert d["thread"]["addr"] == "pat@their.example"
    assert d["sent"] == {"folder": "Sent", "uid": again["uid"]}


def test_a_mail_from_somebody_else_is_no_answer_in_the_timeline_either():
    mine = _sent(7, "pat@their.example", "Question", msgid="<m1@self.example>")
    other = _in(6, "lee@their.example", "Re: Question", name="Lee",
                irt="<m1@self.example>")
    again = _sent(4, "pat@their.example", "Re: Question",
                  msgid="<m2@self.example>", irt="<m1@self.example>")
    acc = _acc([other], [mine, again])
    d = waiting.detail(acc, "<m2@self.example>", NOW)
    assert [(e["kind"], e["who"]) for e in d["timeline"]] == [
        ("out", ""), ("in", "Lee"), ("out", "")]
    assert d["timeline"][0]["answered_ts"] is None
    assert all("_addr" not in e for e in d["timeline"])


def test_the_timeline_of_a_mail_you_started_opens_the_sent_mail():
    acc = _acc(sent=[_sent(5, "pat@their.example", msgid="<m1@self.example>")])
    d = waiting.detail(acc, "<m1@self.example>", NOW)
    assert d["thread"] is None and d["sent"]["folder"] == "Sent"
    assert [e["kind"] for e in d["timeline"]] == ["out"]


def test_the_timeline_is_capped():
    chain, incoming = [], []
    prev = None
    for n in range(20):
        mid = f"<x{n}@self.example>"
        chain.append(_sent(30 - n, "pat@their.example", f"S{n}", msgid=mid,
                           irt=prev))
        prev = mid
    acc = _acc(incoming, chain)
    d = waiting.detail(acc, chain[-1]["id"], NOW)
    assert len(d["timeline"]) == waiting.TIMELINE_MAX


def test_an_unknown_mail_has_no_detail():
    with pytest.raises(ValueError):
        waiting.detail(_acc(), "<nope@x>", NOW)


# ------------------------------------------- reading the Sent folder

def _stamp(days_ago):
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(time.time() - days_ago * DAY))


@pytest.fixture
def sentbox(bridge):
    """The bridge's mailbox with a richer Sent folder."""
    bridge.mailbox["Sent"] = [
        make_msg(20, frm="Me <me@self.example>", subject="Re: Dinner on Friday?",
                 to="Alice <alice@friends.example>", cc="bob@corp.example",
                 msgid="<s20@self.example>", irt="<d1@friends.example>",
                 refs=["<d0@friends.example>", "<d1@friends.example>"],
                 body="THE SECRET BODY TEXT", seen=True, date=_stamp(4)),
        make_msg(21, frm="Me <me@self.example>", subject="Old one",
                 to="old@their.example", msgid="<s21@self.example>",
                 seen=True, date=_stamp(120)),
        make_msg(22, frm="Me <me@self.example>", subject="Edge of the window",
                 to="edge@their.example", msgid="<s22@self.example>",
                 seen=True, date=_stamp(89)),
    ]
    return bridge


def _sent_fetches(fake):
    return [c for c in fake.commands if c[:2] == ("UID", "FETCH")
            and str(c[3]).startswith("(UID INTERNALDATE")]


def test_a_scan_indexes_the_last_90_days_of_sent_headers(sentbox):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    idx = waitstore.load_index("default")
    by = {m["id"]: m for m in idx["mails"]}
    assert set(by) == {"<s20@self.example>", "<s22@self.example>"}
    m = by["<s20@self.example>"]
    assert m["subj"] == "Re: Dinner on Friday?" and m["from"] == ME
    assert m["to"] == [["alice@friends.example", "Alice"],
                       ["bob@corp.example", ""]]
    assert m["irt"] == ["<d1@friends.example>"]
    assert m["refs"] == ["<d0@friends.example>", "<d1@friends.example>"]
    assert abs(m["ts"] - (time.time() - 4 * DAY)) < 5
    assert idx["folder"] == "Sent" and idx["uv"] == 1


def test_no_mail_text_is_ever_read_or_kept(sentbox, tmp_path):
    mailops.run_scan()
    assert sentbox.body_fetches == []
    assert not any("BODY.PEEK[]" in str(c) or "RFC822" in str(c)
                   for c in _sent_fetches(sentbox))
    raw = (tmp_path / "sent_index.json").read_text()
    assert "SECRET" not in raw
    assert "(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT " \
        "MESSAGE-ID IN-REPLY-TO REFERENCES)])" == _sent_fetches(sentbox)[0][3]


def test_the_next_scan_reads_only_new_sent_mail(sentbox):
    mailops.run_scan()
    first = _sent_fetches(sentbox)
    assert first
    sentbox.mailbox["Sent"].append(make_msg(
        23, frm="Me <me@self.example>", subject="New", to="new@their.example",
        msgid="<s23@self.example>", seen=True, date=_stamp(1)))
    sentbox.commands.clear()
    mailops.run_scan()
    again = _sent_fetches(sentbox)
    assert [c[2] for c in again] == ["23"]
    assert {m["id"] for m in waitstore.load_index("default")["mails"]} == {
        "<s20@self.example>", "<s22@self.example>", "<s23@self.example>"}


def test_a_scan_with_nothing_new_fetches_nothing(sentbox):
    mailops.run_scan()
    sentbox.commands.clear()
    mailops.run_scan()
    assert _sent_fetches(sentbox) == []
    assert len(waitstore.load_index("default")["mails"]) == 2


def test_a_deleted_sent_mail_leaves_the_index(sentbox):
    mailops.run_scan()
    sentbox.mailbox["Sent"] = [m for m in sentbox.mailbox["Sent"]
                               if m["uid"] != 20]
    mailops.run_scan()
    assert {m["id"] for m in waitstore.load_index("default")["mails"]} == {
        "<s22@self.example>"}


def test_a_changed_uidvalidity_reads_the_folder_again(sentbox):
    mailops.run_scan()
    sentbox.uv["Sent"] = 7
    sentbox.commands.clear()
    mailops.run_scan()
    assert sorted(_sent_fetches(sentbox)[0][2].split(",")) == ["20", "22"]
    assert waitstore.load_index("default")["uv"] == 7


def test_with_the_switch_off_nothing_extra_is_read_and_the_index_goes(sentbox):
    mailops.run_scan()
    assert waitstore.load_index("default")["mails"]
    acc = accountsmod.get()
    waiting.set_settings(acc, False, None)
    assert waitstore.load_index("default")["mails"] == []      # dropped now
    sentbox.commands.clear()
    mailops.run_scan()
    assert _sent_fetches(sentbox) == []
    assert waitstore.load_index("default")["mails"] == []
    assert waiting.listing(acc)["items"] == []
    assert waiting.listing(acc)["tracking"] is False
    # the "replied" pass still reads To / Cc, as before
    assert "alice@friends.example" in mailops.REPLIED_TO


def test_switching_it_on_again_reads_the_ninety_days(sentbox):
    acc = accountsmod.get()
    waiting.set_settings(acc, False, None)
    mailops.run_scan()
    waiting.set_settings(acc, True, None)
    mailops.run_scan()
    assert len(waitstore.load_index("default")["mails"]) == 2


def test_no_sent_folder_is_fine(bridge):
    del bridge.mailbox["Sent"]
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    assert waitstore.load_index("default")["mails"] == []


def test_a_failing_sent_read_keeps_the_old_index_and_the_scan(sentbox,
                                                              monkeypatch):
    mailops.run_scan()
    before = waitstore.load_index("default")["mails"]
    real = sentbox.uid

    def broken(cmd, *args):
        if cmd == "SEARCH" and "SINCE" in args:
            raise OSError("boom")
        return real(cmd, *args)
    monkeypatch.setattr(sentbox, "uid", broken)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    assert waitstore.load_index("default")["mails"] == before


def test_a_sent_mail_without_a_message_id_is_not_indexed(sentbox):
    sentbox.mailbox["Sent"][0]["msgid"] = ""
    mailops.run_scan()
    assert "<s20@self.example>" not in {
        m["id"] for m in waitstore.load_index("default")["mails"]}


def test_end_to_end_a_scan_then_the_page(sentbox):
    sentbox.mailbox["Sent"].append(make_msg(
        24, frm="Me <me@self.example>", subject="Question about the loan",
        to="Library <desk@library.example>", msgid="<s24@self.example>",
        seen=True, date=_stamp(5)))
    mailops.run_scan()
    r = client.get("/api/waiting")
    assert r.status_code == 200
    out = r.json()
    by = {i["subject"]: i for i in out["items"]}
    assert by["Question about the loan"]["state"] == "open"
    assert by["Question about the loan"]["person"] == {
        "addr": "desk@library.example", "name": "Library"}
    assert by["Question about the loan"]["overdue"] is True
    # Alice's mail is a reply of yours in a conversation she started
    assert "Re: Dinner on Friday?" in by
    assert out["counts"]["open"] >= 2 and out["tracking"] is True
    mid = by["Question about the loan"]["id"]
    d = client.get("/api/waiting/item", params={"id": mid}).json()
    assert d["sent"]["folder"] == "Sent" and d["thread"] is None


# ------------------------------------------------------------------ API

def test_the_api_walks_through_the_decisions(sentbox):
    mailops.run_scan()
    items = client.get("/api/waiting").json()["items"]
    mid = items[0]["id"]
    r = client.post("/api/waiting/needed", json={"id": mid, "needed": True})
    assert r.status_code == 200
    got = client.get("/api/waiting").json()
    assert next(i for i in got["items"] if i["id"] == mid)["state"] == "needed"
    assert got["counts"]["needed"] == 1
    client.post("/api/waiting/needed", json={"id": mid, "needed": False})
    at = int(time.time()) + 3600
    assert client.post("/api/waiting/remind",
                       json={"id": mid, "at": at}).json() == {
        "ok": True, "at": at}
    got = client.get("/api/waiting").json()
    assert next(i for i in got["items"]
                if i["id"] == mid)["reminder"] == {"at": at, "fired": 0}
    assert client.post("/api/waiting/remind",
                       json={"id": mid, "at": None}).status_code == 200
    assert client.post("/api/waiting/remind", json={
        "id": mid, "at": 5}).status_code == 400
    assert client.post("/api/waiting/needed", json={
        "id": "<nope@x>", "needed": True}).status_code == 400
    assert client.get("/api/waiting/item", params={
        "id": "<nope@x>"}).status_code == 400
    assert client.get("/api/waiting/reminders").json() == {"reminders": []}


def test_the_settings_api(sentbox):
    assert client.get("/api/waiting/settings").json() == {
        "track": True, "days": 3}
    mailops.run_scan()
    r = client.post("/api/waiting/settings", json={"track": False, "days": 7})
    assert r.json() == {"track": False, "days": 7}
    assert waitstore.load_index("default")["mails"] == []
    assert client.post("/api/waiting/settings",
                       json={"days": 5}).status_code == 400
    assert client.post("/api/waiting/settings",
                       json={"days": 2}).json() == {"track": False, "days": 2}


def test_an_unknown_account_is_refused():
    assert client.get("/api/waiting", params={
        "account": "ghost"}).status_code == 400


def test_renaming_and_deleting_an_account_carry_the_decisions(monkeypatch):
    from backend import config as cfgmod
    cfgmod.update_config({"accounts": {
        "one": {"host": "h", "user": "u", "password": "p"},
        "two": {"host": "h", "user": "u", "password": "p"}}})
    waitstore.set_needed("<q1@self.example>", True, "one")
    waitstore.save_index("Sent", 1, [_sent(1, "a@b.example")], "one")
    waitstore.set_needed("<q2@self.example>", True, "two")
    r = client.post("/api/config", json={
        "rename_account": {"from": "one", "to": "uno"}})
    assert r.status_code == 200
    assert waitstore.load_account("uno")["needed"] == ["<q1@self.example>"]
    assert len(waitstore.load_index("uno")["mails"]) == 1
    assert waitstore.load_account("one")["needed"] == []
    r = client.post("/api/config", json={"delete_account": "two"})
    assert r.status_code == 200
    assert waitstore.load_account("two")["needed"] == []


# ------------------------------------ push name, Trash / Junk, the poll (fixes)

def _unnamed_remind(addr):
    s = _sent(14, addr, "Change of plan", msgid="<q9@self.example>")
    s["to"] = [[addr, ""]]
    acc = _acc(sent=[s])
    waiting.set_reminder(acc, s["id"], NOW + 60, NOW)
    return acc


def test_a_push_without_a_known_name_names_the_company_not_the_address(pushes):
    acc = _unnamed_remind("jane.doe@mail.travelly.example")
    assert waiting.tick_account(acc, NOW + 120) == 1
    kind, params = pushes[0]
    assert params["name"] == "Travelly"
    assert "jane" not in json.dumps(params)         # no part of the address
    assert "subject" not in params and "plan" not in json.dumps(params)


def test_a_push_without_a_name_on_a_freemail_address_says_someone(pushes):
    acc = _unnamed_remind("jane.doe@gmail.com")
    assert waiting.tick_account(acc, NOW + 120) == 1
    assert pushes[0][1]["name"] == ""        # webpush words it "Someone"
    assert "jane" not in json.dumps(pushes[0][1])


def test_a_known_name_still_wins_in_the_push(pushes):
    acc, mid = _remind_case()
    waiting.set_reminder(acc, mid, NOW + 60, NOW)
    waiting.tick_account(acc, NOW + 120)
    assert pushes[0][1]["name"] == "Pat"


@pytest.mark.parametrize("role", ["trash", "junk"])
def test_an_answer_in_trash_or_junk_still_counts(role):
    s = _sent(8, "pat@their.example", msgid="<t1@self.example>")
    acc = _acc(sent=[s])
    assert _states(acc) == {"Question": "open"}
    reply = _in(2, "pat@their.example", irt=s["id"], folder=role.title())
    acc.role_index[role] = {(reply["folder"], reply["uid"]): reply}
    assert _states(acc) == {"Question": "answered"}


def test_a_newsletter_in_junk_is_no_answer():
    s = _sent(8, "pat@their.example", msgid="<t2@self.example>")
    acc = _acc([_in(40, "pat@their.example", "Hello")], [s])
    ad = _in(2, "pat@their.example", irt=s["id"], bulk=True, folder="Junk")
    acc.role_index["junk"] = {(ad["folder"], ad["uid"]): ad}
    assert _states(acc) == {"Question": "open"}


def test_the_reminder_poll_builds_no_graph_without_a_fired_reminder(
        monkeypatch, pushes):
    acc, mid = _remind_case()
    built = []
    real = waiting.analyse
    monkeypatch.setattr(waiting, "analyse",
                        lambda *a, **k: built.append(1) or real(*a, **k))
    assert waiting.recent_reminders(acc, NOW) == [] and built == []   # none
    waiting.set_reminder(acc, mid, NOW + 3600, NOW)
    built.clear()
    assert waiting.recent_reminders(acc, NOW + 10) == [] and built == []  # later
    assert waiting.reminded(acc, NOW + 10) == [] and built == []
    built.clear()
    waiting.tick_account(acc, NOW + 3601)
    assert len(built) >= 1
    built.clear()
    assert [r["name"] for r in waiting.recent_reminders(acc, NOW + 3700)] \
        == ["Pat"] and built
    built.clear()                           # fired long ago: shown no more
    assert waiting.recent_reminders(acc, NOW + 3600 + 4 * DAY) == []
    assert built == []
