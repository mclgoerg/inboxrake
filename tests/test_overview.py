"""The Overview payload (backend/overview.py, GET /api/overview): arrivals
per week, the last-7-days / since-last-visit windows, the last 30 days by
kind and the size trend - one account, counts only."""

import threading
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend import (knownsenders, labelstore, mailops, overview, unsubstore,
                     verdictstore)
from backend import stats as statsmod
from backend.main import app

NOW = 1_800_000_000
DAY = 86400


def _mail(days_ago, addr="a@x.example", bulk=False, n=[0]):
    n[0] += 1
    return {"ts": int(NOW - days_ago * DAY), "size": 10, "seen": True,
            "bulk": bulk, "addr": addr, "msgid": f"<{n[0]}@x.example>"}


def _acc(mails, tags=None, name="acct"):
    groups = {a: {"key": a, "tags": t} for a, t in (tags or {}).items()}
    for m in mails:
        groups.setdefault(m["addr"], {"key": m["addr"], "tags": []})
    return SimpleNamespace(
        name=name, lock=threading.RLock(),
        index={i: m for i, m in enumerate(mails)},
        state={"groups": {"sender": groups}})


def test_weeks_are_rolling_buckets_ending_now():
    mails = [_mail(0), _mail(6.9), _mail(7.1), _mail(20), _mail(55.9),
             _mail(56.5)]                       # the last one is outside
    out = overview.build(_acc(mails), now=NOW)
    assert out["weeks"] == [1, 0, 0, 0, 0, 1, 1, 2]
    assert len(out["weeks"]) == overview.WEEKS


def test_undated_and_future_mails():
    future = _mail(0)
    future["ts"] = NOW + 600
    undated = _mail(1)
    undated["ts"] = 0
    out = overview.build(_acc([future, undated]), now=NOW)
    assert out["weeks"][-1] == 1 and sum(out["weeks"]) == 1
    assert out["week"]["mails"] == 1


def test_week_window_counts():
    mails = [_mail(1, "a@x.example", bulk=True), _mail(2, "a@x.example"),
             _mail(3, "b@x.example", bulk=True), _mail(9, "c@x.example")]
    w = overview.build(_acc(mails), now=NOW)["week"]
    assert (w["mails"], w["senders"], w["newsletters"]) == (3, 2, 2)
    assert w["from"] == NOW - 7 * DAY


def test_since_window_only_with_a_previous_visit():
    mails = [_mail(1), _mail(3), _mail(5)]
    assert overview.build(_acc(mails), now=NOW)["since"] is None
    out = overview.build(_acc(mails), since=NOW - 2 * DAY, now=NOW)
    assert out["since"]["mails"] == 1
    assert out["week"]["mails"] == 3
    # a visit "in the future" (clock skew) is clamped to now
    out = overview.build(_acc(mails), since=NOW + 99, now=NOW)
    assert out["since"]["mails"] == 0 and out["since"]["from"] == NOW


def test_new_senders_use_first_seen_and_skip_the_seed():
    knownsenders.update_scan("acct", {"old@x.example"}, now=NOW - 30 * DAY)
    knownsenders.update_scan("acct", {"old@x.example", "new@x.example",
                                      "gone@x.example"}, now=NOW - 2 * DAY)
    acc = _acc([_mail(5, "old@x.example"), _mail(2, "new@x.example")])
    out = overview.build(acc, since=NOW - 3 * DAY, now=NOW)
    # "gone" is no longer in the mailbox; "old" was seeded (first_seen 0)
    assert out["week"]["new_senders"] == 1
    assert out["since"]["new_senders"] == 1
    out = overview.build(acc, since=NOW - DAY, now=NOW)
    assert out["since"]["new_senders"] == 0


def test_still_mailing_counts_senders_that_wrote_in_the_window():
    unsubstore.save({
        "late@x.example": {"status": "done", "method": "", "detail": "",
                           "error": "", "ts": NOW - 30 * DAY},
        "quiet@x.example": {"status": "done", "method": "", "detail": "",
                            "error": "", "ts": NOW - 30 * DAY},
        "failed@x.example": {"status": "failed", "method": "", "detail": "",
                             "error": "", "ts": NOW - 30 * DAY}}, "acct")
    mails = [_mail(1, "late@x.example"), _mail(2, "late@x.example"),
             _mail(20, "quiet@x.example"), _mail(1, "failed@x.example"),
             _mail(32, "quiet@x.example")]        # before the unsubscribe
    out = overview.build(_acc(mails), since=NOW - 1.5 * DAY, now=NOW)
    assert out["week"]["still_mailing"] == 1
    assert out["since"]["still_mailing"] == 1
    # inside the 48 h grace the mail does not count
    unsubstore.save({"late@x.example": {
        "status": "done", "method": "", "detail": "", "error": "",
        "ts": NOW - 2.5 * DAY}}, "acct")
    out = overview.build(_acc([_mail(1, "late@x.example")]), now=NOW)
    assert out["week"]["still_mailing"] == 0


def test_verdicts_need_a_timestamp_and_a_live_sender():
    verdictstore.save("sender", {
        "a@x.example": {"verdict": "delete_safe", "reason": "r",
                        "ts": NOW - DAY},
        "b@x.example": {"verdict": "review", "reason": "r", "ts": NOW - DAY},
        "c@x.example": {"verdict": "delete_safe", "reason": "r",
                        "ts": NOW - 20 * DAY},
        "d@x.example": {"verdict": "delete_safe", "reason": "r"},   # old
        "gone@x.example": {"verdict": "delete_safe", "reason": "r",
                           "ts": NOW - DAY}}, "acct")
    # other groupings and other accounts do not count
    verdictstore.save("smart", {"s:a@x.example": {
        "verdict": "delete_safe", "reason": "r", "ts": NOW - DAY}}, "acct")
    verdictstore.save("sender", {"a@x.example": {
        "verdict": "delete_safe", "reason": "r", "ts": NOW - DAY}}, "other")
    acc = _acc([_mail(1, a) for a in
                ("a@x.example", "b@x.example", "c@x.example", "d@x.example")])
    w = overview.build(acc, now=NOW)["week"]
    assert (w["verdicts"], w["verdicts_safe"]) == (2, 1)
    # the user's own verdict on a sender is not an AI verdict: not counted
    labelstore.set_labels("acct", "a@x.example", verdict="keep")
    w = overview.build(acc, now=NOW)["week"]
    assert (w["verdicts"], w["verdicts_safe"]) == (1, 0)


def test_kinds_are_a_partition_of_the_last_30_days():
    tags = {"n@x.example": ["shopping", "newsletter"],
            "s@x.example": ["shopping"], "t@x.example": ["automated"],
            "o@x.example": [], "f@x.example": ["automated", "finance"]}
    mails = [_mail(1, "n@x.example"), _mail(2, "n@x.example"),
             _mail(3, "s@x.example"), _mail(4, "t@x.example"),
             _mail(5, "o@x.example"), _mail(6, "f@x.example"),
             _mail(40, "s@x.example")]           # older than 30 days
    kinds = overview.build(_acc(mails, tags), now=NOW)["kinds"]
    assert kinds["days"] == 30 and kinds["total"] == 6
    assert kinds["items"] == [
        {"kind": "newsletter", "count": 2}, {"kind": "automated", "count": 1},
        {"kind": "finance", "count": 1}, {"kind": "other", "count": 1},
        {"kind": "shopping", "count": 1}]


def test_kind_of():
    assert overview.kind_of([]) == "other"
    assert overview.kind_of(["automated"]) == "automated"
    assert overview.kind_of(["automated", "travel"]) == "travel"
    assert overview.kind_of(["travel", "newsletter"]) == "newsletter"


def _scans(*pairs):
    for days_ago, size in pairs:
        statsmod.record_scan(5, size, 2, "acct")
    data = statsmod._load_all()
    for (days_ago, _), s in zip(pairs, data["accounts"]["acct"]["scans"]):
        s["ts"] = int(NOW - days_ago * DAY)
    statsmod._write(data)


def test_trend_picks_the_scan_nearest_to_a_month_back():
    _scans((60, 900), (31, 500), (20, 300), (3, 200), (0.5, 100))
    t = overview.build(_acc([]), now=NOW)["trend"]
    assert t == {"ts": NOW - 31 * DAY, "size": 500, "mails": 5}


def test_trend_falls_back_to_the_oldest_scan_and_hides_when_too_young():
    assert overview.build(_acc([]), now=NOW)["trend"] is None
    _scans((9, 700), (0.5, 100))
    t = overview.build(_acc([]), now=NOW)["trend"]
    assert t["ts"] == NOW - 9 * DAY and t["size"] == 700
    statsmod._write({"accounts": {}})
    _scans((1, 700), (0.2, 100))
    assert overview.build(_acc([]), now=NOW)["trend"] is None


def test_endpoint_is_per_account_and_additive():
    c = TestClient(app)
    r = c.get("/api/overview")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"now", "weeks", "weeks_estimated", "week", "since",
                         "kinds", "trend"}
    assert body["weeks"] == [0] * 8 and body["since"] is None
    r = c.get("/api/overview", params={"since": int(time.time()) - 60})
    assert r.json()["since"]["mails"] == 0
    assert c.get("/api/overview", params={"account": "nope"}).status_code == 400
    assert c.get("/api/overview", params={"since": -1}).status_code == 422


def _mailr(ts, msgid, folder="INBOX", uid=1):
    return {"ts": int(ts), "msgid": msgid, "folder": folder, "uid": uid}


def test_arrivals_are_the_index_diff_by_message_id():
    prev_ts = NOW - 2 * DAY
    prev = [_mailr(NOW - 5 * DAY, "<a@x.example>"),
            _mailr(NOW - 3 * DAY, "<b@x.example>")]
    now_mails = [
        _mailr(NOW - 5 * DAY, "<a@x.example>"),            # still here
        _mailr(NOW - 3 * DAY, "<b@x.example>", "Archive", 9),   # moved
        _mailr(NOW - 1 * DAY, "<c@x.example>"),            # arrived
        _mailr(NOW - 1 * DAY, "<d@x.example>"),            # arrived
        _mailr(NOW - 30 * DAY, "<old@x.example>"),         # restored: old
        _mailr(prev_ts - 3600, "<lag@x.example>"),         # delivery lag
        _mailr(NOW - 1 * DAY, "", "INBOX", 77)]            # no Message-ID
    out = statsmod.arrivals(prev, prev_ts, now_mails, now=NOW)
    assert out["since"] == prev_ts and out["new"] == 4
    day = str((NOW - DAY) // 86400)
    assert out["days"][day] == 3
    assert sum(out["days"].values()) == 4


def test_the_first_scan_is_a_baseline_not_an_arrival():
    assert statsmod.arrivals([], NOW, [_mailr(NOW, "<a@x.example>")]) is None
    assert statsmod.arrivals([_mailr(NOW, "<a@x.example>")], None, []) is None


def test_record_scan_adds_the_arrivals_and_old_records_stay_as_they_were():
    statsmod.record_scan(5, 50, 2, "acct")
    statsmod.record_scan(6, 60, 2, "acct", {"since": 7, "new": 2,
                                            "days": {"20000": 2}})
    a, b = statsmod.load("acct")["scans"]
    assert set(a) == {"ts", "mails", "size", "senders"}
    assert (b["new"], b["new_since"], b["new_days"]) == (2, 7, {"20000": 2})


def _rec(days_ago, per_day, since_days_ago):
    day = int((NOW - days_ago * DAY) // 86400)
    return {"ts": NOW, "new_since": int(NOW - since_days_ago * DAY),
            "new_days": {str(day): per_day}}


def test_weeks_use_the_records_where_tracked_and_flag_the_rest_estimated():
    est = [10, 20, 30, 40, 50, 60, 70, 80]          # the index estimate
    scans = [_rec(1, 5, 10), _rec(8, 7, 10), _rec(9, 1, 10)]
    weeks, flags = overview.weekly_arrivals(scans, est, NOW)
    # tracking began 10 days ago: only the last bucket (7 days) lies fully
    # inside it; the one before it starts 14 days back -> estimated
    assert flags == [True] * 7 + [False]
    assert weeks[:7] == est[:7] and weeks[7] == 5
    # tracked since long ago: every bucket exact, mails cleaned later still
    # counted (the index would know nothing of them)
    weeks, flags = overview.weekly_arrivals(
        [_rec(1, 5, 70), _rec(8, 7, 70), _rec(20, 4, 70)], est, NOW)
    assert flags == [False] * 8
    assert weeks == [0, 0, 0, 0, 0, 4, 7, 5]
    # nothing tracked yet: all estimates
    assert overview.weekly_arrivals([], est, NOW) == (est, [True] * 8)
    assert overview.weekly_arrivals([{"ts": 1}], est, NOW) == (est, [True] * 8)


def test_build_reports_tracked_weeks(monkeypatch):
    statsmod.record_scan(5, 50, 2, "acct", {
        "since": int(NOW - 70 * DAY), "new": 3,
        "days": {str(int((NOW - DAY) // 86400)): 3}})
    data = statsmod._load_all()
    data["accounts"]["acct"]["scans"][0]["ts"] = int(NOW)
    statsmod._write(data)
    out = overview.build(_acc([_mail(1)]), now=NOW)
    assert out["weeks_estimated"] == [False] * 8
    assert out["weeks"][-1] == 3            # recorded, not the index's 1


def test_a_real_scan_records_what_arrived_since_the_last_one(monkeypatch):
    from conftest import FakeIMAP, make_msg
    t = int(time.time())
    imap_date = lambda ts: time.strftime("%d-%b-%Y %H:%M:%S +0000",
                                         time.gmtime(ts))
    box = {"INBOX": [make_msg(1, date=imap_date(t - 3600))],
           "Sent": [], "Trash": []}
    fake = FakeIMAP(box)
    monkeypatch.setattr(mailops, "connect", lambda im, n=None: fake)
    mailops.run_scan()
    first = statsmod.load("default")["scans"][-1]
    assert "new" not in first                       # the baseline
    box["INBOX"].append(make_msg(2, frm='"B" <b@shop.example>',
                                 date=imap_date(t - 60)))
    mailops.run_scan()
    second = statsmod.load("default")["scans"][-1]
    assert second["new"] == 1
    assert second["new_since"] == first["ts"]
    mailops.run_scan()                               # nothing new
    assert statsmod.load("default")["scans"][-1]["new"] == 0
