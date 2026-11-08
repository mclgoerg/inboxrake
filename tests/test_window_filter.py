"""The `in:<N>(min|h|d)` filter term: a window for is:new, is:still-mailing
and ai:... (and for mails in the flat list), the group fields it reads
(`new_ts`, `still_mailing.last_ts`, `ai.ts`), kept equal to lib.ts."""

import calendar
import time

from backend import knownsenders, mailops
from backend import rules as rulesmod

from conftest import FakeIMAP, make_msg
from test_rules import g

NOW = 1_800_000_000
H = 3600
D = 86400


def test_parse_in_window_units():
    assert rulesmod.parse_filter("in:7d")["in_seconds"] == 7 * D
    assert rulesmod.parse_filter("in:12h")["in_seconds"] == 12 * H
    assert rulesmod.parse_filter("in:90min")["in_seconds"] == 90 * 60
    assert rulesmod.parse_filter("dhl")["in_seconds"] is None
    f = rulesmod.parse_filter("in:7")                  # no unit: plain text
    assert f["in_seconds"] is None and f["text"] == ["in:7"]
    assert rulesmod.parse_filter("in:3w")["in_seconds"] is None


def test_validate_and_purge_treat_in_like_any_qualifier():
    assert rulesmod.validate_filter("is:new in:7d") == []
    assert rulesmod.validate_filter("in:7") == ["in:7"]
    assert rulesmod.validate_filter("is:new in:7d in:1d") == ["in:1d"]  # repeat
    for ok in ("is:new in:7d", "is:still-mailing in:2h", "ai:safe in:90min",
               "tag:x ai:keep in:1d"):
        assert rulesmod.validate_filter(ok) == [], ok
    assert "in:" in rulesmod.purge_unsupported("in:7d")
    assert rulesmod.purge_unsupported("age:>1y") == []


def test_is_new_in_a_window_uses_the_first_seen_time():
    f = rulesmod.parse_filter("is:new in:7d")
    assert rulesmod.match_group(g(new=True, new_ts=NOW - 2 * D), f, NOW)
    assert not rulesmod.match_group(g(new=True, new_ts=NOW - 9 * D), f, NOW)
    # seeded / unknown first-seen never matches a window
    assert not rulesmod.match_group(g(new=True, new_ts=0), f, NOW)
    assert not rulesmod.match_group(g(new=True), f, NOW)
    # without the window it is the flag, as before
    plain = rulesmod.parse_filter("is:new")
    assert rulesmod.match_group(g(new=True, new_ts=NOW - 9 * D), plain, NOW)
    # a window wider than the configured one still finds the sender
    assert rulesmod.match_group(
        g(new=False, new_ts=NOW - 20 * D),
        rulesmod.parse_filter("is:new in:30d"), NOW)


def sm(last_ts):
    return {"n": 2, "senders": 1, "since_ts": 1, "addrs": [], "last_ts": last_ts}


def test_still_mailing_in_a_window_uses_the_newest_late_mail():
    f = rulesmod.parse_filter("is:still-mailing in:7d")
    assert rulesmod.match_group(g(still_mailing=sm(NOW - D)), f, NOW)
    assert not rulesmod.match_group(g(still_mailing=sm(NOW - 8 * D)), f, NOW)
    assert not rulesmod.match_group(g(still_mailing=None), f, NOW)
    old_shape = {"n": 2, "senders": 1, "since_ts": 1, "addrs": []}
    assert not rulesmod.match_group(g(still_mailing=old_shape), f, NOW)
    plain = rulesmod.parse_filter("is:still-mailing")
    assert rulesmod.match_group(g(still_mailing=sm(NOW - 80 * D)), plain, NOW)


def test_ai_in_a_window_uses_the_verdict_date():
    f = rulesmod.parse_filter("ai:safe in:2d")
    fresh = {"verdict": "delete_safe", "reason": "x", "ts": NOW - H}
    assert rulesmod.match_group(g(ai=fresh), f, NOW)
    assert not rulesmod.match_group(g(ai={**fresh, "ts": NOW - 3 * D}), f, NOW)
    assert not rulesmod.match_group(
        g(ai={"verdict": "delete_safe", "reason": "x"}), f, NOW)   # undated
    assert not rulesmod.match_group(g(ai={**fresh, "verdict": "keep"}), f, NOW)
    assert rulesmod.match_group(g(), rulesmod.parse_filter("ai:safe"), NOW)


def test_a_window_alone_changes_nothing():
    assert rulesmod.match_group(g(), rulesmod.parse_filter("in:1min"), NOW)


def test_groups_carry_new_ts_from_the_first_seen_record(monkeypatch):
    t = int(time.time())
    imap_date = lambda ts: time.strftime("%d-%b-%Y %H:%M:%S +0000",
                                         time.gmtime(ts))
    box = {"INBOX": [make_msg(1, frm='"Old" <old@shop.example>',
                              date=imap_date(t - 5 * D))],
           "Sent": [], "Trash": []}
    monkeypatch.setattr(mailops, "connect", lambda im, n=None: FakeIMAP(box))
    mailops.run_scan()                                   # seeds: first_seen 0
    box["INBOX"].append(make_msg(2, frm='"Fresh" <fresh@shop.example>',
                                 date=imap_date(t - 60)))
    mailops.run_scan()
    groups = mailops.public_state()["groups"]["sender"]
    assert groups["old@shop.example"]["new"] is False
    assert groups["old@shop.example"]["new_ts"] == 0
    fresh = groups["fresh@shop.example"]
    assert fresh["new"] is True and abs(fresh["new_ts"] - t) < 60
    # the domain row follows its newest sender
    dom = mailops.public_state()["groups"]["domain"]["shop.example"]
    assert dom["new"] is True and dom["new_ts"] == fresh["new_ts"]


def test_mail_list_in_window(monkeypatch):
    t = int(time.time())
    imap_date = lambda ts: time.strftime("%d-%b-%Y %H:%M:%S +0000",
                                         time.gmtime(ts))
    box = {"INBOX": [make_msg(1, date=imap_date(t - 2 * H)),
                     make_msg(2, date=imap_date(t - 3 * D)),
                     make_msg(3, date=imap_date(t - 20 * D))],
           "Sent": [], "Trash": []}
    monkeypatch.setattr(mailops, "connect", lambda im, n=None: FakeIMAP(box))
    mailops.run_scan()
    uids = lambda q: sorted(m["uid"] for m in mailops.list_mails(q=q)["mails"])
    assert uids("in:1d") == [1]
    assert uids("in:7d") == [1, 2]
    assert uids("in:90min") == []
    assert uids("") == [1, 2, 3]
    assert uids("in:7d age:>1d") == [2]          # combines with age:
    assert mailops.list_mails(q="in:7")["ignored"] == []   # plain text


def test_a_window_alone_is_refused_in_rules():
    """Alone `in:` would act on every match (`in:7d tag:newsletter` = all
    newsletters) - refuse it, with its own message, on save and on run."""
    assert rulesmod.validate_filter("in:7d") == ["in:7d"]
    assert rulesmod.validate_filter("in:7d tag:newsletter") == ["in:7d"]
    assert rulesmod.validate_filter("in:bogus") == ["in:bogus"]
    err = rulesmod._filter_error(["in:7d"])
    assert err.startswith("rule_filter_window:")
    assert rulesmod._filter_error(["in:7d"], run=True).startswith(
        "rule_filter_window_run:")
    # another bad part: the generic text
    assert rulesmod._filter_error(["in:7d", "age:x"]).startswith(
        "rule_filter_invalid:")
    assert rulesmod._filter_error(["in:bogus"]).startswith(
        "rule_filter_invalid:")
    import pytest
    with pytest.raises(ValueError, match="^rule_filter_window:"):
        rulesmod.create_rule({"name": "w", "grouping": "sender",
                              "query": "in:7d tag:newsletter",
                              "action": "trash"})
    rule = rulesmod.create_rule({"name": "w", "grouping": "sender",
                                 "query": "is:new in:7d", "action": "trash"})
    assert rule["query"] == "is:new in:7d"
