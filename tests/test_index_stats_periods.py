"""index_stats: the additive per-day / full-month series behind the
Statistics period switch (existing fields stay as they were)."""

import threading
import time
from types import SimpleNamespace

from backend import mailops, verdictstore


def _mail(days_ago, size, seen=True, n=[0]):
    n[0] += 1
    lt = time.localtime(time.time() - days_ago * 86400)
    ts = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 12, 0, 0, 0, 0,
                          -1)))
    return {"ts": ts, "size": size, "seen": seen, "bulk": False,
            "addr": "a@x.example", "msgid": f"<{n[0]}@x.example>"}


def _acc(*mails):
    return SimpleNamespace(
        lock=threading.RLock(), index={i: m for i, m in enumerate(mails)},
        state={"groups": {"sender": {}}})


def test_days_and_full_months(monkeypatch):
    monkeypatch.setattr(verdictstore, "load_mails", lambda: {})
    old = [_mail(400 + 40 * i, 10) for i in range(14)]      # > 12 months back
    recent = [_mail(0, 100), _mail(0, 50, seen=False), _mail(5, 7),
              _mail(40, 1)]                                  # outside 31 days
    st = mailops.index_stats(_acc(*old, *recent))
    today = time.strftime("%Y-%m-%d")
    by_day = {d["day"]: d for d in st["days"]}
    assert by_day[today] == {"day": today, "count": 2, "size": 150,
                             "unread": 1}
    assert len(st["days"]) == 2          # +5 days ago; the 40-day-old one is out
    assert all(d["day"] >= min(by_day) for d in st["days"])
    # the existing series is unchanged: 12 months, no extra keys
    assert len(st["months"]) <= 12
    assert set(st["months"][0]) == {"month", "count", "size"}
    # the full history carries everything, oldest first, with unread
    assert sum(m["count"] for m in st["months_all"]) == len(old) + len(recent)
    assert len(st["months_all"]) > len(st["months"])
    assert [m["month"] for m in st["months_all"]] == sorted(
        m["month"] for m in st["months_all"])
    assert sum(m["unread"] for m in st["months_all"]) == 1
    assert st["mails"] == len(old) + len(recent)
