"""When mail arrives (backend/rhythm.py, GET /api/rhythm, the slot filter of
GET /api/mails): weekday x hour counts in the caller's time zone, periods,
Smart-kind split, top senders per slot, daily senders - one account."""

import datetime as dt
import threading
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops
from backend import rhythm
from backend.main import app

UTC = dt.timezone.utc
# Wed 2026-11-18 12:00 UTC
NOW = dt.datetime(2026, 11, 18, 12, 0, tzinfo=UTC).timestamp()
DAY = 86400


def _ts(y, mo, d, h, mi=0):
    return int(dt.datetime(y, mo, d, h, mi, tzinfo=UTC).timestamp())


_n = [0]


def _mail(ts, addr="a@x.example", subject="Hello", bulk=False, seen=True,
          unsub=""):
    _n[0] += 1
    return {"ts": int(ts), "addr": addr, "subject": subject, "bulk": bulk,
            "seen": seen, "unsub": unsub, "size": 10, "folder": "INBOX",
            "uid": _n[0], "date": "", "name": "", "msgid": f"<{_n[0]}@x.example>"}


def _acc(mails, recs=None, name="acct"):
    groups = {a: {"key": a, "label": a.split("@")[0], "unsub": "", **r}
              for a, r in (recs or {}).items()}
    for m in mails:
        groups.setdefault(m["addr"], {"key": m["addr"],
                                      "label": m["addr"].split("@")[0],
                                      "unsub": ""})
    return SimpleNamespace(
        name=name, lock=threading.RLock(),
        index={i: m for i, m in enumerate(mails)},
        state={"groups": {"sender": groups}})


def _grid(acc, kind="all", period="all", tz="", offset=0):
    return rhythm.build(acc, period, tz, offset, now=NOW)["kinds"][kind]["grid"]


# ------------------------------------------------------------ time zones

def test_a_late_evening_mail_lands_on_the_next_day_in_utc_plus_one():
    mail = _mail(_ts(2026, 11, 16, 23, 30))          # Monday 23:30 UTC
    acc = _acc([mail])
    g = _grid(acc)
    assert g[0][23] == 1 and sum(map(sum, g)) == 1    # Mon 23 in UTC
    g = _grid(acc, offset=60)
    assert g[1][0] == 1 and g[0][23] == 0             # Tue 00 at +01:00
    g = _grid(acc, tz="Europe/Berlin")                # November: +01:00
    assert g[1][0] == 1


def test_a_named_zone_follows_daylight_saving_a_fixed_offset_does_not():
    summer = _mail(_ts(2026, 7, 6, 23, 30))          # Monday 23:30 UTC
    acc = _acc([summer])
    assert _grid(acc, tz="Europe/Berlin")[1][1] == 1  # +02:00 in July
    assert _grid(acc, offset=60)[1][0] == 1           # the fallback is fixed


def test_unknown_zone_names_fall_back_to_the_offset():
    acc = _acc([_mail(_ts(2026, 11, 16, 23, 30))])
    assert _grid(acc, tz="Nowhere/Land", offset=60)[1][0] == 1
    assert _grid(acc, tz="../etc/passwd", offset=60)[1][0] == 1


def test_half_hour_zones_bucket_by_local_hour():
    acc = _acc([_mail(_ts(2026, 11, 16, 18, 45))])    # 00:15 Tue at +05:30
    assert _grid(acc, offset=330)[1][0] == 1


# --------------------------------------------------------------- periods

def test_periods_cut_at_local_days_and_calendar_months():
    mails = [_mail(NOW - 29 * DAY - 6 * 3600),        # 2026-10-20 06:00
             _mail(NOW - 30 * DAY),                   # 2026-10-19 12:00: out
             _mail(_ts(2025, 11, 30, 23)),            # before the 12 months
             _mail(_ts(2025, 12, 1, 0, 5)),           # first of them
             _mail(0), ]                              # undated
    acc = _acc(mails)
    total = lambda p: rhythm.build(acc, p, now=NOW)["kinds"]["all"]["total"]
    assert total("30d") == 1
    assert total("12m") == 3          # Dec 2025 .. Nov 2026, this month included
    assert total("all") == 4


def test_a_mail_from_the_future_is_not_counted():
    acc = _acc([_mail(NOW + 5 * DAY), _mail(NOW - 60)])
    assert rhythm.build(acc, "all", now=NOW)["kinds"]["all"]["total"] == 1


# ---------------------------------------------------------------- kinds

def test_kinds_split_the_mails_and_other_only_counts_in_all():
    t = _ts(2026, 11, 16, 6)
    mails = [
        _mail(t, "friend@x.example", "Lunch?"),                    # people
        _mail(t, "shop@x.example", "Your order has shipped"),      # orders
        _mail(t, "news@x.example", "Weekly digest", bulk=True),    # newsletter
        _mail(t, "misc@x.example", "Hello there"),                 # other
    ]
    acc = _acc(mails, {"friend@x.example": {"replied": True}})
    out = rhythm.build(acc, "all", now=NOW)["kinds"]
    assert {k: out[k]["total"] for k in out} == {
        "all": 4, "people": 1, "orders": 1, "newsletters": 1}
    assert out["people"]["grid"][0][6] == 1


def test_a_person_who_sends_a_bulk_header_is_still_a_person():
    mails = [_mail(_ts(2026, 11, 16, 6), "friend@x.example", "Hi", bulk=True)]
    acc = _acc(mails, {"friend@x.example": {"replied": True}})
    out = rhythm.build(acc, "all", now=NOW)["kinds"]
    assert out["people"]["total"] == 1 and out["newsletters"]["total"] == 0


# ------------------------------------------------------------ top senders

def test_top_senders_are_two_named_and_the_rest_counted():
    t = _ts(2026, 11, 17, 6, 10)                      # Tuesday 06:xx
    mails = ([_mail(t, "a@x.example")] * 3 + [_mail(t, "b@x.example")] * 2
             + [_mail(t, "c@x.example")] + [_mail(t, "d@x.example")])
    out = rhythm.build(_acc(mails), "all", now=NOW)["kinds"]["all"]
    cell = out["top"]["1-6"]
    assert [(s["key"], s["count"]) for s in cell["senders"]] == [
        ("a@x.example", 3), ("b@x.example", 2)]
    assert cell["more"] == 2 and out["grid"][1][6] == 7
    assert set(out["top"]) == {"1-6"}                 # empty slots: no entry


# ---------------------------------------------------------- daily senders

def _daily_mails(addr, days=20, hour=6, **kw):
    midnight = NOW - NOW % DAY
    return [_mail(midnight - d * DAY + hour * 3600 + 600, addr, **kw)
            for d in range(1, days + 1)]


def test_a_sender_mailing_the_same_hour_nearly_every_day_is_found():
    mails = _daily_mails("d@x.example", unsub="<https://u.example/x>")
    mails += [_mail(NOW - DAY, "d@x.example")]        # a second one that day
    acc = _acc(mails, {"d@x.example": {"unsub": "<https://u.example/x>"}})
    daily = rhythm.build(acc, "30d", now=NOW)["daily"]
    assert [d["key"] for d in daily] == ["d@x.example"]
    assert daily[0]["hour"] == 6 and daily[0]["mails"] == 21
    assert daily[0]["per_day"] == 1.0         # 21 mails, 21 days since the first


def test_daily_needs_80_percent_of_the_days_and_14_days_of_history():
    rec = {"unsub": "<https://u.example/x>"}
    # 20 days of history, 15 of them with a mail (75%): no
    few = _daily_mails("f@x.example", 20)[:15]
    # 10 days only: too young
    young = _daily_mails("y@x.example", 10)
    # 20 days, 17 mails (85%): yes
    most = _daily_mails("m@x.example", 20)
    del most[3], most[5], most[7]
    first = _daily_mails("f@x.example", 20)[-1]       # anchor the first day
    acc = _acc(few + [first] + young + most,
               {a: rec for a in ("f@x.example", "y@x.example", "m@x.example")})
    keys = [d["key"] for d in rhythm.build(acc, "30d", now=NOW)["daily"]]
    assert keys == ["m@x.example"]


def test_a_clock_change_does_not_hide_a_daily_sender_but_a_wide_spread_does():
    rec = {"unsub": "<https://u.example/x>"}
    # 06:10 UTC for 10 days, 07:10 UTC for the next 10 (summer / winter time)
    shifted = (_daily_mails("dst@x.example", 10, hour=6)
               + [m for m in _daily_mails("dst@x.example", 20, hour=7)
                  if m["ts"] < NOW - 10 * DAY])
    # the same 20 days spread over four hours
    spread = [_mail(m["ts"] + (i % 4) * 3600, "wide@x.example",
                    unsub="<https://u.example/x>")
              for i, m in enumerate(_daily_mails("wide@x.example", 20, hour=5))]
    acc = _acc(shifted + spread, {"dst@x.example": rec, "wide@x.example": rec})
    daily = rhythm.build(acc, "30d", now=NOW)["daily"]
    assert [d["key"] for d in daily] == ["dst@x.example"]


def test_daily_window_is_the_main_hour_and_one_neighbour_not_both():
    rec = {"unsub": "<https://u.example/x>"}
    midnight = NOW - NOW % DAY
    hours = [6] * 8 + [5] * 6 + [7] * 6         # 20 days: 06 leads, 05 / 07 trail
    mails = [_mail(midnight - (d + 1) * DAY + h * 3600 + 600, "w@x.example",
                   unsub="<https://u.example/x>") for d, h in enumerate(hours)]
    acc = _acc(mails, {"w@x.example": rec})
    # 06 + the better neighbour covers 14 of 21 days; 05 + 06 + 07 would be 20
    assert rhythm.build(acc, "30d", now=NOW)["daily"] == []


def test_daily_skips_protected_people_and_senders_without_unsubscribe():
    unsub = {"unsub": "<https://u.example/x>"}
    mails = (_daily_mails("prot@x.example") + _daily_mails("pal@x.example")
             + _daily_mails("plain@x.example"))
    acc = _acc(mails, {"prot@x.example": unsub,
                       "pal@x.example": {**unsub, "replied": True},
                       "plain@x.example": {}})
    cfgmod.update_config({"protected": ["prot@x.example"]})
    assert rhythm.build(acc, "30d", now=NOW)["daily"] == []


def test_daily_reports_how_much_you_open():
    mails = (_daily_mails("d@x.example", seen=False))
    acc = _acc(mails, {"d@x.example": {"unsub": "<https://u.example/x>"}})
    d = rhythm.build(acc, "30d", now=NOW)["daily"][0]
    assert d["open_pct"] == 0


# ------------------------------------------------------------ the filter

def test_clean_slot_rejects_what_does_not_exist():
    for bad in ({"kind": "x"}, {"period": "7d"}, {"days": [7]},
                {"days": []}, {"from": 5, "to": 5}, {"from": 3, "to": 25},
                {"from": -1, "to": 2}):
        try:
            rhythm.clean_slot(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")


def test_slot_matcher_is_the_same_cut_as_the_grid():
    mails = [_mail(_ts(2026, 11, 17, 6, 10), "a@x.example"),    # Tue 06
             _mail(_ts(2026, 11, 17, 7, 10), "a@x.example"),    # Tue 07
             _mail(_ts(2026, 11, 16, 6, 10), "a@x.example"),    # Mon 06
             _mail(_ts(2026, 11, 17, 23, 30), "a@x.example")]   # Wed 00 at +1
    acc = _acc(mails)
    slot = rhythm.clean_slot({"days": [1], "from": 6, "to": 7,
                              "period": "all"})
    match = rhythm.slot_matcher(slot, acc.state["groups"]["sender"], NOW)
    assert [match(m) for m in mails] == [True, False, False, False]
    block = rhythm.clean_slot({"days": [1, 2], "from": 0, "to": 24,
                               "period": "all", "offset": 60})
    match = rhythm.slot_matcher(block, acc.state["groups"]["sender"], NOW)
    assert [match(m) for m in mails] == [True, True, False, True]


# ------------------------------------------------------------ endpoints

client = TestClient(app)


def _seed_default():
    acc = accountsmod.get()
    mails = [_mail(_ts(2026, 11, 17, 6, 10), "n@x.example", "Digest",
                   bulk=True, seen=False),
             _mail(_ts(2026, 11, 17, 6, 40), "n@x.example", "Digest",
                   bulk=True),
             _mail(_ts(2026, 11, 17, 9, 0), "p@x.example", "Hi")]
    acc.index = {i: m for i, m in enumerate(mails)}
    acc.state["groups"]["sender"] = {
        a: {"key": a, "label": a, "unsub": "", "replied": a == "p@x.example"}
        for a in ("n@x.example", "p@x.example")}
    return acc


def test_rhythm_endpoint_shape_and_validation(monkeypatch):
    monkeypatch.setattr(rhythm.time, "time", lambda: NOW)
    _seed_default()
    r = client.get("/api/rhythm", params={"period": "all", "tz": "UTC"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"period", "tz", "from", "kinds", "daily"}
    assert set(body["kinds"]) == set(rhythm.KINDS)
    assert body["kinds"]["all"]["total"] == 3
    assert body["kinds"]["newsletters"]["grid"][1][6] == 2
    assert client.get("/api/rhythm", params={"period": "7d"}).status_code == 422
    assert client.get("/api/rhythm", params={"tzoff": 900}).status_code == 422
    assert client.get("/api/rhythm", params={"account": "nope"}
                      ).status_code == 400


def test_mails_slot_filter_is_a_view_parameter(monkeypatch):
    monkeypatch.setattr(mailops.time, "time", lambda: NOW)
    _seed_default()
    p = {"slot": "6-7", "slot_days": "1", "slot_period": "all", "tz": "UTC"}
    r = client.get("/api/mails", params=p).json()
    assert r["total"] == 2
    p["slot_kind"] = "people"
    assert client.get("/api/mails", params=p).json()["total"] == 0
    p.update(slot_kind="newsletters", slot="6-9")
    assert client.get("/api/mails", params=p).json()["total"] == 2
    # the DSL is untouched: a qualifier-looking text is just text
    r = client.get("/api/mails", params={"q": "slot:6-7"}).json()
    assert r["total"] == 0
    for bad in ({"slot": "x"}, {"slot": "7-7"}, {"slot": "6-7",
                                                   "slot_days": "9"},
                {"slot": "6-7", "slot_kind": "zzz"}):
        assert client.get("/api/mails", params=bad).status_code == 400


def test_accounts_never_mix(monkeypatch):
    monkeypatch.setattr(rhythm.time, "time", lambda: NOW)
    _seed_default()
    other = SimpleNamespace(
        name="other", lock=threading.RLock(), index={},
        state={"groups": {"sender": {}}})
    assert rhythm.build(other, "all", now=NOW)["kinds"]["all"]["total"] == 0
    assert client.get("/api/rhythm", params={"period": "all"}
                      ).json()["kinds"]["all"]["total"] == 3


def test_a_big_mailbox_is_counted_in_reasonable_time():
    import random
    import time
    rnd = random.Random(1)
    senders = [f"s{i}@x.example" for i in range(300)]
    mails = [_mail(NOW - rnd.uniform(0, 700 * DAY), rnd.choice(senders),
                   rnd.choice(["Hello", "Your order shipped", "Weekly digest"]),
                   bulk=rnd.random() < 0.4) for _ in range(200000)]
    acc = _acc(mails)
    t0 = time.perf_counter()
    out = rhythm.build(acc, "all", "Europe/Berlin", now=NOW)
    took = time.perf_counter() - t0
    assert out["kinds"]["all"]["total"] == 200000
    assert sum(out["kinds"][k]["total"] for k in ("newsletters", "orders")) > 0
    # about 2 s on a quiet machine (was 3.6-4 s with a Counter per mail and
    # the lock held throughout); the bound only catches a regression
    assert took < 20, took
