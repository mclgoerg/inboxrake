"""Sender grade: A-F for one sender, with the reasons.

A pure function over what a Sender group record already carries (counts,
dates, size, the tracker summary, the unsubscribe state) - no AI, no fetch,
nothing stored: the grade is derived every time the state is built, so there
is nothing on disk for an older version to trip over.

Six checks, each "ok" (+1), "bad" (-1) or "neutral" (0, also "not checked"
when the data is not there). A sender that keeps mailing after a successful
unsubscribe counts -2. Fixed weights, on purpose: no per-user switches. The
same table is shown to the user on "How grades work"
(GradeHelp in frontend/src/components/GradeUi.tsx).

| check        | ok                      | bad                         |
|--------------|-------------------------|-----------------------------|
| you open it  | read share >= 30%       | read share < 10%            |
| how often    | <= 2 mails a week       | > 7 mails a week            |
| tracking     | no tracker found        | trackers in >= 50% of mails |
| unsubscribe  | one-click header        | none, on a bulk sender      |
| stops asked  | unsubscribed, stopped   | still mailing (-2)          |
| mail size    | average <= 200 KB       | average > 1 MB              |

Points -> letter: >= 3 A, 2 B, 0..1 C, -1..-2 D, <= -3 F. Somebody you wrote
to (`replied`) never grades below C.
"""

from __future__ import annotations

import bisect
import datetime
from collections.abc import Collection, Mapping

# --------------------------------------------------------------- thresholds

# Fewer mails than this say nothing about habits: "you open it" and "how
# often" stay neutral ("not enough mail yet").
MIN_MAILS = 3

# 1. You open their mail: read share of the sender's mails, in percent.
READ_OK_MIN_PCT = 30            # >= this is ok
READ_BAD_BELOW_PCT = 10         # <  this is bad

# 2. How often: mails per week over the sender's active period (first to last
# mail, at least one week long so a burst is not an infinite rate).
OFTEN_OK_MAX = 2.0              # <= this is ok
OFTEN_BAD_ABOVE = 7.0           # >  this is bad

# 3. Tracking: share of the body-index-checked mails with a tracker flag.
TRACK_BAD_MIN_PCT = 50          # >= this is bad; none at all is ok

# 4. Unsubscribe: a sender without any unsubscribe option is only "bad" when
# it is a bulk sender - this many mails and more than OFTEN_OK_MAX a week.
BULK_MIN_MAILS = 10

# 6. Mail size: average bytes per mail.
SIZE_OK_MAX = 200 * 1024        # <= this is ok
SIZE_BAD_ABOVE = 1024 * 1024    # >  this is bad

# "More than N of 10 senders" needs enough senders to compare with.
RANK_MIN_SENDERS = 10

POINTS = {"ok": 1, "bad": -1, "neutral": 0}
STILL_MAILING_POINTS = -2       # a broken unsubscribe promise weighs double

# (minimum points, letter), best first; everything below the last is "F".
GRADE_STEPS = ((3, "A"), (2, "B"), (0, "C"), (-2, "D"))
LETTERS = ("A", "B", "C", "D", "F")
REPLIED_FLOOR = "C"             # somebody you wrote to is never graded worse

CHECK_IDS = ("open", "often", "tracking", "unsub", "stops", "size")


def letter_of(points: int) -> str:
    for floor, letter in GRADE_STEPS:
        if points >= floor:
            return letter
    return "F"


def _span_days(rec: dict) -> int | None:
    """Days from the first to the last mail of the record, None when a date
    is missing or unreadable."""
    try:
        first = datetime.date.fromisoformat(rec.get("first") or "")
        last = datetime.date.fromisoformat(rec.get("last") or "")
    except ValueError:
        return None
    return max(0, (last - first).days)


def per_week(rec: dict) -> float | None:
    """Mails per week over the active period; None without dates or with
    fewer than MIN_MAILS mails."""
    count = rec.get("count", 0)
    days = _span_days(rec)
    if count < MIN_MAILS or days is None:
        return None
    return count / max(days / 7, 1.0)


def _check_open(rec: dict) -> dict:
    count = rec.get("count", 0)
    if count < MIN_MAILS:
        return {"id": "open", "v": "neutral", "total": count}
    read = count - min(max(rec.get("unread", 0), 0), count)
    out = {"id": "open", "v": "neutral", "read": read, "total": count,
           "pct": round(100 * read / count)}
    days = _span_days(rec)
    if days is not None:
        out["months"] = round(days / 30.44)
    if read * 100 >= READ_OK_MIN_PCT * count:
        out["v"] = "ok"
    elif read * 100 < READ_BAD_BELOW_PCT * count:
        out["v"] = "bad"
    return out


def _check_often(rec: dict) -> dict:
    rate = per_week(rec)
    if rate is None:
        return {"id": "often", "v": "neutral"}
    v = "ok" if rate <= OFTEN_OK_MAX else "bad" if rate > OFTEN_BAD_ABOVE \
        else "neutral"
    return {"id": "often", "v": v, "per_week": round(rate, 1)}


def _check_tracking(rec: dict) -> dict:
    t = rec.get("trackers")
    checked = (t or {}).get("checked", 0)
    if not checked:
        return {"id": "tracking", "v": "neutral", "kind": "unchecked"}
    pixel, click = t.get("pixel", 0), t.get("click", 0)
    # mails with any flag (older summaries lack `any`: the larger of the two
    # is the least it can be)
    flagged = min(checked, t.get("any", max(pixel, click)))
    kind = ("both" if pixel and click else "pixel" if pixel
            else "links" if click else "none")
    out = {"id": "tracking", "v": "neutral", "kind": kind, "checked": checked,
           "pct": round(100 * flagged / checked),
           "pixel_pct": round(100 * pixel / checked),
           "click_pct": round(100 * click / checked)}
    if not flagged:
        out["v"] = "ok"
    elif flagged * 100 >= TRACK_BAD_MIN_PCT * checked:
        out["v"] = "bad"
    return out


def is_bulk(rec: dict) -> bool:
    rate = per_week(rec)
    return (rec.get("count", 0) >= BULK_MIN_MAILS and rate is not None
            and rate > OFTEN_OK_MAX)


def _check_unsub(rec: dict, one_click: bool) -> dict:
    if not rec.get("unsub"):
        return {"id": "unsub", "v": "bad" if is_bulk(rec) else "neutral",
                "kind": "none"}
    if one_click:
        return {"id": "unsub", "v": "ok", "kind": "post"}
    return {"id": "unsub", "v": "neutral", "kind": "link"}


def _check_stops(rec: dict) -> dict:
    still = rec.get("still_mailing")
    if still:
        return {"id": "stops", "v": "bad", "kind": "still",
                "n": still.get("n", 0)}
    u = rec.get("unsubscribed")
    if u and u.get("status") == "done":
        return {"id": "stops", "v": "ok", "kind": "stopped"}
    return {"id": "stops", "v": "neutral",
            "kind": "open" if u else "never"}


def _check_size(rec: dict) -> dict:
    count = rec.get("count", 0)
    if count <= 0:
        return {"id": "size", "v": "neutral"}
    avg = rec.get("size", 0) / count
    v = "ok" if avg <= SIZE_OK_MAX else "bad" if avg > SIZE_BAD_ABOVE \
        else "neutral"
    return {"id": "size", "v": v, "avg": int(avg),
            "att": rec.get("att_size", 0)}


def pattern_of(checks: list[dict]) -> str:
    """The one sentence the grade gets: loud (you ignore a frequent sender),
    quiet (you read a rare one), tracks (it tracks you, but you read it) or
    mixed."""
    v = {c["id"]: c["v"] for c in checks}
    if v["open"] == "bad" and v["often"] == "bad":
        return "loud"
    if v["open"] == "ok" and v["often"] == "ok":
        return "quiet"
    if v["tracking"] == "bad" and v["open"] == "ok":
        return "tracks"
    return "mixed"


def grade_sender(rec: dict, one_click: bool = False) -> dict:
    """The grade of one Sender record (public_state shape): `letter`,
    `points`, `pattern`, `checks` (one entry per CHECK_IDS, each with `v` =
    ok / bad / neutral plus the figures the UI words) and `floor` = True when
    the "you wrote to them" floor lifted the letter."""
    checks = [_check_open(rec), _check_often(rec), _check_tracking(rec),
              _check_unsub(rec, one_click), _check_stops(rec),
              _check_size(rec)]
    points = sum(STILL_MAILING_POINTS
                 if c["id"] == "stops" and c["v"] == "bad" else POINTS[c["v"]]
                 for c in checks)
    letter = letter_of(points)
    out = {"letter": letter, "points": points, "pattern": pattern_of(checks),
           "checks": checks}
    if rec.get("replied") and LETTERS.index(letter) > \
            LETTERS.index(REPLIED_FLOOR):
        out["letter"], out["floor"] = REPLIED_FLOOR, True
    return out


def grade_all(recs: Mapping[str, dict],
              one_click: Collection[str] = ()) -> dict[str, dict]:
    """{key: grade} for every Sender record. `one_click` = keys whose newest
    mail carries a List-Unsubscribe-Post header. Adds `rank` to each "how
    often" check: the share of the other senders (in percent) that mail less
    often - None when there are too few senders to compare with."""
    out = {k: grade_sender(rec, k in one_click) for k, rec in recs.items()}
    rates = sorted(r for rec in recs.values()
                   if (r := per_week(rec)) is not None)
    if len(rates) >= RANK_MIN_SENDERS:
        for k, g in out.items():
            rate = per_week(recs[k])
            if rate is not None:
                below = bisect.bisect_left(rates, rate)
                g["checks"][1]["rank"] = round(100 * below / len(rates))
    return out
