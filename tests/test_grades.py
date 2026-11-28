"""Sender grade (backend/grades.py): each check's thresholds and neutral
cases, points -> letter, the replied floor, the still-mailing weight, the
sentence patterns, the `grade:` filter (the same cases run in
frontend/src/lib.test.ts), and the grade on public_state's Sender rows."""

import re
import time
from pathlib import Path

import pytest

from backend import grades
from backend import mailops
from backend import rules as rulesmod
from backend import unsubstore

from conftest import make_msg

KB = 1024
# 28 days = exactly four weeks, so "mails a week" is count / 4
FIRST, LAST = "2025-01-01", "2025-01-29"


def rec(**over):
    """A Sender record: 20 mails over four weeks (5 a week), 25% read, 100 KB
    each, no unsubscribe, no trackers. Each test overrides what it
    examines."""
    base = {"key": "news@shop.example", "count": 20, "unread": 15,
            "first": FIRST, "last": LAST, "size": 20 * 100 * KB,
            "att_size": 0, "unsub": False, "replied": False,
            "unsubscribed": None, "still_mailing": None}
    base.update(over)
    return base


def check(r, cid, one_click=False):
    g = grades.grade_sender(r, one_click)
    return next(c for c in g["checks"] if c["id"] == cid)


def verdicts(r, one_click=False):
    return {c["id"]: c["v"]
            for c in grades.grade_sender(r, one_click)["checks"]}


# ---------------------------------------------------------- 1. you open it

@pytest.mark.parametrize("count,unread,want", [
    (100, 70, "ok"),            # 30% read: the boundary is ok
    (100, 71, "neutral"),       # 29%
    (100, 90, "neutral"),       # 10% read: not below 10
    (100, 91, "bad"),           # 9%
    (100, 100, "bad"),
    (10, 0, "ok"),
])
def test_open_thresholds(count, unread, want):
    assert check(rec(count=count, unread=unread), "open")["v"] == want


def test_open_reports_the_figures():
    c = check(rec(count=96, unread=94), "open")
    assert (c["read"], c["total"], c["pct"]) == (2, 96, 2)
    assert c["months"] == 1                     # FIRST..LAST = 4 weeks


def test_open_is_neutral_with_too_few_mails():
    assert grades.MIN_MAILS == 3
    for n in (1, 2):
        c = check(rec(count=n, unread=n), "open")
        assert c["v"] == "neutral" and "pct" not in c
    assert check(rec(count=3, unread=3), "open")["v"] == "bad"


# ------------------------------------------------------------ 2. how often

@pytest.mark.parametrize("count,want", [
    (8, "ok"),                  # 2.0 a week
    (9, "neutral"),             # 2.25
    (28, "neutral"),            # 7.0
    (29, "bad"),                # 7.25
])
def test_often_thresholds(count, want):
    assert check(rec(count=count, unread=0), "often")["v"] == want


def test_often_uses_at_least_one_week():
    # four mails on one day: 4 a week, not an infinite rate
    c = check(rec(count=4, unread=0, first=LAST, last=LAST), "often")
    assert c["per_week"] == 4.0 and c["v"] == "neutral"


def test_often_is_neutral_without_dates_or_mails():
    assert check(rec(first="", last=""), "often")["v"] == "neutral"
    assert check(rec(first="garbage"), "often")["v"] == "neutral"
    assert check(rec(count=2, unread=0), "often")["v"] == "neutral"


def test_often_rank_needs_enough_senders():
    recs = {f"s{i}@x.example": rec(count=4 + i, unread=0)
            for i in range(grades.RANK_MIN_SENDERS)}
    g = grades.grade_all(recs)
    ranks = [g[k]["checks"][1]["rank"] for k in recs]
    assert ranks == sorted(ranks) and ranks[0] == 0 and ranks[-1] == 90
    few = grades.grade_all(dict(list(recs.items())[:3]))
    assert all("rank" not in v["checks"][1] for v in few.values())


# -------------------------------------------------------------- 3. tracking

def tr(checked, pixel=0, click=0, any_=None):
    t = {"checked": checked, "pixel": pixel, "click": click, "hosts": []}
    if any_ is not None:
        t["any"] = any_
    return {"trackers": t}


@pytest.mark.parametrize("trackers,want", [
    (tr(10), "ok"),
    (tr(10, pixel=4, any_=4), "neutral"),
    (tr(10, pixel=5, any_=5), "bad"),               # 50%
    (tr(10, pixel=3, click=3, any_=6), "bad"),
    (tr(10, pixel=5, click=5, any_=5), "bad"),      # the same mails twice
    (tr(10, pixel=4, click=4, any_=4), "neutral"),
])
def test_tracking_thresholds(trackers, want):
    assert check(rec(**trackers), "tracking")["v"] == want


def test_tracking_is_neutral_without_a_body_index():
    assert check(rec(), "tracking") == {
        "id": "tracking", "v": "neutral", "kind": "unchecked"}
    assert check(rec(**tr(0)), "tracking")["kind"] == "unchecked"


def test_tracking_kinds_and_figures():
    c = check(rec(**tr(100, pixel=94, click=10, any_=94)), "tracking")
    assert (c["kind"], c["pct"], c["pixel_pct"], c["click_pct"]) == (
        "both", 94, 94, 10)
    assert check(rec(**tr(10, pixel=2, any_=2)), "tracking")["kind"] == "pixel"
    assert check(rec(**tr(10, click=2, any_=2)), "tracking")["kind"] == "links"
    assert check(rec(**tr(10)), "tracking")["kind"] == "none"


def test_tracking_without_the_any_figure_uses_the_larger_flag():
    # a summary from before `any` existed: at least max(pixel, click) mails
    assert check(rec(**tr(10, pixel=5, click=1)), "tracking")["v"] == "bad"


# ----------------------------------------------------------- 4. unsubscribe

def test_unsubscribe_check():
    assert check(rec(unsub=True), "unsub", one_click=True) == {
        "id": "unsub", "v": "ok", "kind": "post"}
    assert check(rec(unsub=True), "unsub")["v"] == "neutral"      # link only
    assert check(rec(unsub=True), "unsub")["kind"] == "link"
    # no way to unsubscribe: bad only on a bulk sender (10+ mails and more
    # than 2 a week), neutral otherwise
    bulk = rec(count=10, unread=9)                   # 2.5 a week
    assert check(bulk, "unsub") == {"id": "unsub", "v": "bad", "kind": "none"}
    assert check(rec(count=9, unread=9), "unsub")["v"] == "neutral"
    assert check(rec(count=8, unread=9), "unsub")["v"] == "neutral"
    slow = rec(count=10, first="2020-01-01")         # 10 mails in 5 years
    assert check(slow, "unsub")["v"] == "neutral"


# ------------------------------------------------------ 5. stops when asked

def test_stops_when_asked():
    done = {"status": "done", "n": 1, "of": 1}
    assert check(rec(unsubscribed=done), "stops")["v"] == "ok"
    assert check(rec(), "stops") == {
        "id": "stops", "v": "neutral", "kind": "never"}
    for status in ("link", "failed", "pending"):
        c = check(rec(unsubscribed={"status": status}), "stops")
        assert (c["v"], c["kind"]) == ("neutral", "open")
    c = check(rec(unsubscribed=done, still_mailing={"n": 4}), "stops")
    assert (c["v"], c["kind"], c["n"]) == ("bad", "still", 4)


def test_stopped_is_only_earned_after_the_watchdogs_grace():
    """"Stops when asked" must not turn green the moment an unsubscribe is
    recorded: the watchdog gives a sender 48 h, so until then nothing is
    known (neutral, "waiting"); after it, no late mail means "stopped"."""
    assert grades.STOP_GRACE_SECONDS == mailops.STILL_MAILING_GRACE
    t0, g = 1_750_000_000, grades.STOP_GRACE_SECONDS

    def stops(now, ts=t0, **over):
        r = rec(unsubscribed={"status": "done", "n": 1, "of": 1, "ts": ts},
                **over)
        return grades.grade_sender(r, now=now)["checks"][4]

    assert stops(t0 + 3600) == {"id": "stops", "v": "neutral",
                                "kind": "waiting"}
    assert stops(t0 + g - 1)["v"] == "neutral"
    assert stops(t0 + g) == {"id": "stops", "v": "ok", "kind": "stopped"}
    assert stops(t0 + 30 * 86400)["kind"] == "stopped"
    # a legacy record without a time is old enough
    assert stops(t0, ts=0)["kind"] == "stopped"
    # late mail beats the wait: still mailing is still -2
    late = stops(t0 + 3600, still_mailing={"n": 2})
    assert (late["v"], late["kind"]) == ("bad", "still")
    # the points follow: waiting adds nothing, stopped adds +1
    base = rec(unsubscribed={"status": "done", "ts": t0})
    waiting = grades.grade_sender(base, now=t0 + 60)["points"]
    stopped = grades.grade_sender(base, now=t0 + g)["points"]
    assert stopped == waiting + 1


def test_still_mailing_weighs_double():
    quiet = dict(count=2, unread=2, first="", last="", size=100)   # only size ok
    assert grades.grade_sender(rec(**quiet))["points"] == 1
    still = grades.grade_sender(rec(
        **quiet, unsubscribed={"status": "done"}, still_mailing={"n": 2}))
    assert still["points"] == 1 - 2          # -2, not -1
    assert grades.STILL_MAILING_POINTS == -2


# ---------------------------------------------------------------- 6. size

@pytest.mark.parametrize("avg,want", [
    (200 * KB, "ok"), (200 * KB + 1, "neutral"),
    (1024 * KB, "neutral"), (1024 * KB + 1, "bad"),
])
def test_size_thresholds(avg, want):
    assert check(rec(count=1, unread=0, size=avg), "size")["v"] == want


def test_size_reports_the_average_and_attachments():
    c = check(rec(count=4, size=4000, att_size=900), "size")
    assert (c["avg"], c["att"]) == (1000, 900)


# ------------------------------------------------------- points -> letter

@pytest.mark.parametrize("points,letter", [
    (6, "A"), (3, "A"), (2, "B"), (1, "C"), (0, "C"),
    (-1, "D"), (-2, "D"), (-3, "F"), (-7, "F"),
])
def test_points_to_letter(points, letter):
    assert grades.letter_of(points) == letter


def test_points_add_up_from_the_checks():
    # open ok, often ok, tracking ok, unsub ok, stops ok, size ok
    r = rec(count=8, unread=0, unsub=True, size=8 * KB,
            unsubscribed={"status": "done"}, **tr(8))
    g = grades.grade_sender(r, True)
    assert g["points"] == 6 and g["letter"] == "A"
    # everything bad but the unsubscribe (one-click)
    r = rec(count=40, unread=40, unsub=True, size=40 * 2048 * KB,
            still_mailing={"n": 5}, **tr(10, pixel=9, any_=9))
    g = grades.grade_sender(r, True)
    assert [c["v"] for c in g["checks"]] == [
        "bad", "bad", "bad", "ok", "bad", "bad"]
    assert g["points"] == -1 - 1 - 1 + 1 - 2 - 1 == -5 and g["letter"] == "F"


def test_the_board_example_is_what_the_function_computes():
    """The sender-grade board's report card: opened 40%, 0.9 a week, a pixel in
    61% of the checked mails, a one-click unsubscribe, never asked to stop,
    69 KB a mail = +1 +1 -1 +1 0 +1 = 3 = an A, and the sentence is "quiet"
    (open ok + often ok) although it tracks."""
    r = rec(count=96, unread=58, first="2024-11-28", last="2026-11-26",
            size=96 * 69 * KB, unsub=True, **tr(100, pixel=61, any_=61))
    g = grades.grade_sender(r, one_click=True)
    assert [c["v"] for c in g["checks"]] == [
        "ok", "ok", "bad", "ok", "neutral", "ok"]
    assert (g["points"], g["letter"], g["pattern"]) == (3, "A", "quiet")
    assert g["checks"][0]["pct"] == 40
    assert g["checks"][1]["per_week"] == 0.9
    assert g["checks"][2]["pixel_pct"] == 61


# --------------------------------------------------------- the replied floor

def worst():
    return rec(count=40, unread=40, size=40 * 2048 * KB,
               still_mailing={"n": 5}, **tr(10, pixel=9, any_=9))


def test_replied_senders_never_grade_below_c():
    assert grades.grade_sender(worst())["letter"] == "F"
    g = grades.grade_sender({**worst(), "replied": True})
    assert (g["letter"], g["floor"]) == ("C", True)
    assert g["points"] < 0                       # the points stay honest
    # a D is lifted too; B and better are left alone and carry no flag
    d = rec(count=3, unread=3, size=3 * 2048 * KB, replied=True)
    assert grades.grade_sender({**d, "replied": False})["letter"] == "D"
    assert grades.grade_sender(d)["letter"] == "C"
    good = rec(count=8, unread=0, unsub=True, size=8 * KB,
               unsubscribed={"status": "done"}, replied=True, **tr(8))
    g = grades.grade_sender(good, True)
    assert g["letter"] == "A" and "floor" not in g
    assert grades.REPLIED_FLOOR == "C"


# --------------------------------------------------------------- sentences

def test_patterns():
    loud = rec(count=40, unread=40)                  # bad open + bad often
    assert grades.grade_sender(loud)["pattern"] == "loud"
    quiet = rec(count=8, unread=0)                   # ok open + ok often
    assert grades.grade_sender(quiet)["pattern"] == "quiet"
    tracks = rec(count=20, unread=0, **tr(10, pixel=9, any_=9))   # 5/wk
    assert grades.grade_sender(tracks)["pattern"] == "tracks"
    assert grades.grade_sender(rec())["pattern"] == "mixed"
    # open ok + often ok + tracking bad: the spec order puts "quiet" first
    both = rec(count=8, unread=0, **tr(10, pixel=9, any_=9))
    assert grades.grade_sender(both)["pattern"] == "quiet"


def test_check_ids_are_stable_and_in_order():
    g = grades.grade_sender(rec())
    assert tuple(c["id"] for c in g["checks"]) == grades.CHECK_IDS


# ------------------------------------------------------------ the filter

# The same table is in frontend/src/lib.test.ts ("grade:" parity).
GRADE_CASES = [
    ("grade:d", "D", True), ("grade:d", "C", False), ("grade:d", "F", False),
    ("grade:<=c", "C", True), ("grade:<=c", "D", True),
    ("grade:<=c", "F", True), ("grade:<=c", "B", False),
    ("grade:<=c", "A", False),
    ("grade:>=b", "B", True), ("grade:>=b", "A", True),
    ("grade:>=b", "C", False), ("grade:>=b", "F", False),
    ("GRADE:>=B", "B", True),               # the query is case-folded
    ("grade:a", "A", True), ("grade:f", "F", True), ("grade:<=a", "A", True),
    ("grade:<=a", "B", True), ("grade:>=f", "F", True),
    ("grade:>=f", "A", True),
]


def test_the_parity_table_is_the_one_in_lib_test_ts():
    """The same cases run against lib.ts (`grade:` filter, matchGroup): the
    two tables must not drift apart, or the list and a rule would disagree
    about which senders `grade:<=c` means."""
    src = (Path(__file__).parent.parent / "frontend/src/lib.test.ts"
           ).read_text()
    block = src[src.index("const CASES: [string, string, boolean][] = ["):]
    block = block[:block.index("];")]
    cases = [(q, letter, v == "true") for q, letter, v in re.findall(
        r'\["([^"]+)", "([A-F])", (true|false)\]', block)]
    assert cases == GRADE_CASES


@pytest.mark.parametrize("query,letter,want", GRADE_CASES)
def test_grade_filter_matches(query, letter, want):
    row = {"key": "a@b.example", "label": "A", "sub": "", "tags": [],
           "unread": 0, "count": 3, "last": "",
           "grade": {"letter": letter}}
    assert rulesmod.match_group(row, rulesmod.parse_filter(query)) is want


def test_grade_filter_never_matches_a_row_without_a_grade():
    f = rulesmod.parse_filter("grade:<=f")
    row = {"key": "x", "label": "X", "sub": "", "tags": [], "unread": 0,
           "count": 3, "last": ""}
    assert rulesmod.match_group(row, f) is False


@pytest.mark.parametrize("bad", ["grade:g", "grade:", "grade:=c", "grade:<c",
                                 "grade:cc", "grade:<=", "grade:>=z",
                                 "grade:e", "grade:<=e", "grade:>=e"])
def test_a_bad_grade_value_is_a_free_word(bad):
    f = rulesmod.parse_filter(bad)
    assert f["grade"] is None and f["text"] == [bad]
    assert rulesmod.validate_filter(bad) == [bad]


def test_grade_filter_parses_and_validates():
    assert rulesmod.parse_filter("grade:d")["grade"] == ("=", "D")
    assert rulesmod.parse_filter("grade:<=c")["grade"] == ("<=", "C")
    assert rulesmod.parse_filter("grade:>=b")["grade"] == (">=", "B")
    assert rulesmod.parse_filter("")["grade"] is None
    assert rulesmod.validate_filter("grade:d is:unsub grade:<=c") == [
        "grade:<=c"]                         # a single-value qualifier twice
    assert rulesmod.validate_filter("grade:<=c age:>1y") == []


def test_grade_is_in_the_filter_grammar():
    entry = next(g for g in rulesmod.FILTER_GRAMMAR
                 if g["qualifier"] == "grade")
    assert rulesmod.validate_filter(entry["example"]) == []


def test_purge_rules_refuse_grade():
    assert rulesmod.purge_unsupported("grade:<=c") == ["grade:"]


def test_all_mails_view_reports_grade_as_ignored():
    f = mailops.parse_mail_query("grade:<=c shop")
    assert f["ignored"] == ["grade:<=c"] and f["text"] == ["shop"]


# ------------------------------------------------------- public_state rows

def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def test_public_state_grades_sender_rows_only(bridge):
    scan(bridge)
    groups = mailops.public_state()["groups"]
    for row in groups["sender"].values():
        g = row["grade"]
        assert g["letter"] in grades.LETTERS
        assert [c["id"] for c in g["checks"]] == list(grades.CHECK_IDS)
    for name in ("domain", "subject", "thread", "smart"):
        assert all("grade" not in r for r in groups[name].values()), name


def test_the_state_api_carries_grades_on_sender_rows_only(bridge):
    from fastapi.testclient import TestClient
    from backend.main import app
    scan(bridge)
    groups = TestClient(app).get("/api/state").json()["groups"]
    assert all(r["grade"]["letter"] in grades.LETTERS
               for r in groups["sender"].values())
    for name in ("domain", "subject", "thread", "smart"):
        assert all("grade" not in r for r in groups[name].values()), name


def test_grades_follow_the_scan_nothing_is_stored(bridge, tmp_path):
    """The grade is worked out again on every state build: an unsubscribe
    that keeps being ignored moves the letter without any file written."""
    scan(bridge)
    before = mailops.public_state()["groups"]["sender"]["noreply@dhl.example"]
    assert "grade" in before
    # no grade, no check, no letter reached the stored state
    with mailops.accounts.get().lock:
        stored = mailops.accounts.get().state["groups"]["sender"][
            "noreply@dhl.example"]
    assert "grade" not in stored
    assert not list(tmp_path.glob("*grade*"))


def _grade_checks(addr):
    row = mailops.public_state()["groups"]["sender"][addr]
    return {c["id"]: c for c in row["grade"]["checks"]}


def test_one_click_needs_an_https_link_not_just_the_post_header(bridge):
    """The app's own rule (unsub.method_of): the header alone is no one-click
    unsubscribe - a mailto-only or plain http sender would be unsubscribed by
    mail / a page you confirm, not by one POST."""
    inbox = bridge.mailbox["INBOX"]
    for uid, name, header in (
            (30, "mailonly", "<mailto:stop@mailonly.example?subject=stop>"),
            (31, "plainhttp", "<http://plainhttp.example/u/1>"),
            (32, "secure", "<https://secure.example/u/1>"),
            (33, "both", "<mailto:stop@both.example>, "
                         "<https://both.example/u/1>")):
        inbox.append(make_msg(
            uid, frm=f'"{name}" <news@{name}.example>', unsub=header,
            unsub_post=True, msgid=f"<g{uid}@{name}.example>"))
    scan(bridge)
    for name, kind, v in (("mailonly", "link", "neutral"),
                          ("plainhttp", "link", "neutral"),
                          ("secure", "post", "ok"),
                          ("both", "post", "ok")):
        c = _grade_checks(f"news@{name}.example")["unsub"]
        assert (c["kind"], c["v"]) == (kind, v), name


def test_the_state_carries_the_unsubscribe_time_for_the_grace(bridge):
    scan(bridge)
    assert "unsubscribed" in mailops.public_state()["groups"]["sender"][
        "news@shop.example"]
    now = int(time.time())
    for age, want in ((3600, "waiting"), (3 * 86400, "stopped")):
        unsubstore.save({"news@shop.example": {
            "status": "done", "method": "", "detail": "", "error": "",
            "ts": now - age}})
        row = mailops.public_state()["groups"]["sender"]["news@shop.example"]
        assert abs(row["unsubscribed"]["ts"] - (now - age)) <= 1
        assert row["grade"]["checks"][4]["kind"] == want


def test_public_state_sees_one_click_unsubscribe(bridge):
    scan(bridge)
    s = mailops.public_state()["groups"]["sender"]
    unsub = lambda k: next(c for c in s[k]["grade"]["checks"]
                           if c["id"] == "unsub")
    assert unsub("news@shop.example")["kind"] == "post"      # List-Unsubscribe-Post
    assert unsub("news@shop.example")["v"] == "ok"
    assert unsub("noreply@dhl.example")["kind"] == "link"    # a link only
    assert unsub("alice@friends.example")["kind"] == "none"


def test_a_person_you_wrote_to_is_never_below_c(bridge):
    scan(bridge)
    alice = mailops.public_state()["groups"]["sender"][
        "alice@friends.example"]
    assert alice["replied"] and alice["grade"]["letter"] in ("A", "B", "C")


def test_a_rule_on_grade_skips_protected_senders(bridge):
    from backend import config as cfgmod
    cfgmod.update_config({"protected": ["alice@friends.example"]})
    rule = rulesmod.create_rule({
        "name": "grades", "grouping": "sender", "query": "grade:<=c"})
    res = rulesmod.run_rule(rule["id"])
    # alice is graded C (replied floor), so the rule matches her - and skips
    # her as protected, like any other rule
    assert res["skipped_protected"] == 1
    assert "alice@friends.example" not in [p["key"] for p in res["preview"]]


def test_the_ui_prints_the_thresholds_the_backend_applies():
    """"How grades work" fills its numbers from frontend/src/grades.ts."""
    src = (Path(__file__).parent.parent / "frontend/src/grades.ts").read_text()
    block = src[src.index("export const GRADE_RULES"):]
    block = block[:block.index("};")]
    ui = {k: int(v) for k, v in re.findall(r"(\w+): (\d+)", block)}
    assert ui == {
        "minMails": grades.MIN_MAILS,
        "readOkPct": grades.READ_OK_MIN_PCT,
        "readBadBelowPct": grades.READ_BAD_BELOW_PCT,
        "oftenOkPerWeek": grades.OFTEN_OK_MAX,
        "oftenBadPerWeek": grades.OFTEN_BAD_ABOVE,
        "trackBadPct": grades.TRACK_BAD_MIN_PCT,
        "bulkMails": grades.BULK_MIN_MAILS,
        "sizeOkKb": grades.SIZE_OK_MAX // 1024,
        "sizeBadMb": grades.SIZE_BAD_ABOVE // (1024 * 1024)}
