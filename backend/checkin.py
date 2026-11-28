"""The Weekly check-in: one guided pass through the places that need you.

The app's stepper (frontend `WeeklyCheckin`) walks through up to six places,
skipping the empty ones - new senders, still mailing after you unsubscribed,
mail past its date, replies overdue, the rule checkup, Junk - and each step
hosts that place's own list and actions. The lists and every action already
exist; what this module adds is the COUNT per place, so that the Overview
line, the "Start your weekly check-in" button of the activity digest mail
and the Monday push all say the same thing:

  things = the number of places that have something (6 -> "6 things")

No second baseline: the window is the one of Overview's "Last week" card -
the last 7 days, or (`since`, epoch s) the time since the last visit - and
the two counts that depend on it (new senders, still mailing) are read from
`overview.build` itself, so the card, the check-in and the push cannot
disagree. The other four places are not windowed: the mail past its date and
the Junk folder as they are now, the replies overdue (when the account
watches its sent mail) and the open Rule checkup findings.

Local data only: nothing is asked of the mail server and nothing leaves it.

The Monday push (`tick`, on the same 5-minute loop style as the reply
reminders): on Monday from 09:00 on, in the server's local time like the
activity digest, every account of a user that has a notification device and
has not switched the push off (`checkinstore.push_enabled`, ON by default)
gets ONE push if it has something - "Your weekly check-in: 6 things" and a
time estimate, never a sender name, a subject or an address - and none when
there is nothing. Devices that are looking at the app are left alone, like
every push (`webpush._deliver`). Each account is handled once per week.
"""

from __future__ import annotations

import datetime
import logging
import threading
import time

from . import accounts
from . import checkinstore
from . import overview as overviewmod
from . import pastdate
from . import rulecheck
from . import tenants
from . import waiting
from . import webpush

log = logging.getLogger("inboxrake.checkin")

# The places, in the order the stepper walks through them.
PLACES = ("new", "still", "past", "waiting", "rules", "junk")

PUSH_WEEKDAY = 0                # Monday
PUSH_HOUR = 9
TICK_SECONDS = 300
# a stepper step takes about 20 seconds: 3 steps are a minute (6 -> "2 min")
STEPS_PER_MINUTE = 3


def minutes_for(steps: int) -> int:
    """"about N minutes" for a check-in of `steps` places (at least 1)."""
    return max(1, -(-int(steps) // STEPS_PER_MINUTE))


def _safe(label: str, fn, default=0) -> int:
    """One place's count; a place that cannot be worked out counts as empty
    (a broken piece must not hide the others, or fail the push)."""
    try:
        return int(fn() or 0)
    except Exception:
        log.exception("check-in: %s unavailable", label)
        return default


def places(acc, since: int | None = None, now: float | None = None,
           ov: dict | None = None) -> list[dict]:
    """[{"id", "n"}] of the places that have something, in walking order.
    `since` (epoch s) = the window of "since your last visit" instead of the
    last 7 days; `ov` = an `overview.build` payload made for the same `since`
    (the digest has one already)."""
    now = now if now is not None else time.time()
    if ov is None:
        ov = overviewmod.build(acc, since, now)
    window = ov.get("since") if since is not None and ov.get("since") \
        else ov["week"]
    counts = {
        "new": window.get("new_senders", 0),
        "still": window.get("still_mailing", 0),
        "past": _safe("past its date",
                      lambda: pastdate.summary(acc, now)["mails"]),
        "waiting": _safe("overdue replies",
                         lambda: waiting.summary(acc, now)["overdue"]),
        "rules": _safe("rule checkup", lambda: sum(
            1 for f in rulecheck.checkup(acc)["findings"]
            if not f.get("ignored"))),
        "junk": _safe("Junk", lambda: acc.state.get("junk_count")),
    }
    return [{"id": p, "n": int(counts[p])} for p in PLACES if counts[p] > 0]


def summary(acc, since: int | None = None, now: float | None = None,
            ov: dict | None = None) -> dict:
    """What the Overview line, the digest button and the push say:
    {"window": "week" | "since", "from": epoch s, "steps": [{"id", "n"}],
    "things": N, "minutes": M}."""
    now = now if now is not None else time.time()
    if ov is None:
        ov = overviewmod.build(acc, since, now)
    use_since = since is not None and ov.get("since") is not None
    steps = places(acc, since, now, ov)
    return {"window": "since" if use_since else "week",
            "from": (ov["since"] if use_since else ov["week"])["from"],
            "steps": steps, "things": len(steps),
            "minutes": minutes_for(len(steps)) if steps else 0}


# ---------------------------------------------------------------- settings

def settings_view() -> dict:
    """What Settings > Notifications shows (per user)."""
    return {"push": checkinstore.push_enabled()}


def set_settings(push: bool | None = None) -> dict:
    if push is not None:
        checkinstore.set_push(push)
    return settings_view()


# --------------------------------------------------------------- Monday push

def week_of(now: float) -> str:
    """The Monday (local date) of the week `now` is in."""
    day = datetime.datetime.fromtimestamp(now)
    return (day.date() - datetime.timedelta(days=day.weekday())).isoformat()


def push_due(now: float) -> bool:
    """Monday, 09:00 or later (local time, like the activity digest)."""
    day = datetime.datetime.fromtimestamp(now)
    return day.weekday() == PUSH_WEEKDAY and day.hour >= PUSH_HOUR


def _ready(acc) -> bool:
    """A scanned account that is not in the middle of a scan."""
    with acc.lock:
        return acc.state["status"] == "done" \
            and acc.state.get("scanned_ts") is not None


def tick_tenant(now: float | None = None) -> int:
    """The pushes of the current tenant's accounts that are due now. Returns
    how many went out. An account that is not ready (scanning, never scanned)
    is tried again on the next tick; one with nothing is simply done for the
    week."""
    now = time.time() if now is None else now
    if not push_due(now) or not checkinstore.push_enabled():
        return 0
    # nobody to tell: not a pass over every account (and nothing is marked, so
    # a device added later on Monday still hears about this week)
    if not webpush.subscriptions():
        return 0
    week = week_of(now)
    done = checkinstore.handled(week)
    sent = 0
    for name in accounts.names():
        if name in done:
            continue
        try:
            acc = accounts.get(name)
        except KeyError:
            continue                              # account was deleted
        if not _ready(acc):
            continue
        s = summary(acc, None, now)
        checkinstore.mark_handled(week, name)
        if s["things"] > 0:
            webpush.checkin(acc, n=s["things"], minutes=s["minutes"])
            sent += 1
    return sent


def tick(now: float | None = None) -> None:
    for tenant in tenants.known():
        with tenants.use(tenant):
            try:
                tick_tenant(now)
            except Exception:
                log.exception("weekly check-in push failed")


_scheduler_started = False


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        while True:
            time.sleep(TICK_SECONDS)
            try:
                tick()
            except Exception:
                log.exception("weekly check-in tick failed")

    threading.Thread(target=loop, daemon=True).start()
