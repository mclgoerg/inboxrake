"""Sender changes (backend/senderchanges.py): the per-sender weekly arrival
counts each scan keeps, the "got louder" and "came back" checks, the group
flags / filter words (`is:louder`, `is:back`) in public_state and rules, the
Overview rows, the Statistics endpoint, and the store's per-tenant /
per-account rules."""

import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops, overview
from backend import rules as rulesmod
from backend import senderchanges as sc
from backend import tenants
from backend.main import app

from conftest import make_msg, wait_delete_done

client = TestClient(app)

NOW = 1_800_000_000
DAY = 86400
WEEK = 7 * DAY
_ids = iter(range(1, 10**6))


def mail(days_ago, addr, seen=False, folder="INBOX"):
    n = next(_ids)
    return {"ts": int(NOW - days_ago * DAY), "addr": addr, "seen": seen,
            "folder": folder, "uid": n, "msgid": f"<{n}@x.example>",
            "size": 10, "bulk": False}


def weekly(addr, weeks, every=7, first=10, per=1):
    """`per` mails per `every` days, `weeks` weeks back from `first` days ago."""
    out = []
    for k in range(round(weeks * 7 / every)):
        out += [mail(first + k * every + j * 0.01, addr) for j in range(per)]
    return out


def acc_of(mails, name="acct", labels=None, rev=1):
    groups = {}
    for m in mails:
        groups.setdefault(m["addr"], {"key": m["addr"], "tags": [],
                                      "label": (labels or {}).get(
                                          m["addr"], m["addr"])})
    return SimpleNamespace(
        name=name, lock=threading.RLock(),
        index={i: m for i, m in enumerate(mails)},
        state={"groups": {"sender": groups}, "groups_rev": rev})


def seeded(mails, name="acct", at=NOW, **kw):
    sc.record_scan(name, [], None, mails, now=at)
    return acc_of(mails, name, **kw)


L = "loud@x.example"
B = "back@x.example"


# ---------------------------------------------------------------- the checks

def test_louder_means_more_than_twice_the_usual_week_and_four_mails():
    assert sc.is_louder(4, 1) and sc.is_louder(5, 2)
    assert not sc.is_louder(4, 2)           # exactly twice is not MORE
    assert not sc.is_louder(3, 0)           # three mails are never enough
    assert sc.is_louder(4, 0)               # usual week 0: four is plenty
    assert not sc.is_louder(10, 5)


def test_usual_week_is_the_median_of_the_counted_weeks():
    weeks = {str(sc._week(NOW - 10 * DAY) - k): n
             for k, n in enumerate([1, 1, 5, 1, 1, 1])}
    assert sc.usual_week(weeks, NOW - 7 * DAY) == 1.0
    # a week without mail counts as zero, from the first counted week on
    sparse = {str(sc._week(NOW - 10 * DAY)): 1,
              str(sc._week(NOW - 10 * DAY) - 5): 1}
    assert sc.usual_week(sparse, NOW - 7 * DAY) == 0.0
    # ... and the median is the middle of an even count
    even = {str(sc._week(NOW - 10 * DAY) - k): n
            for k, n in enumerate([3, 1, 2, 2])}
    assert sc.usual_week(even, NOW - 7 * DAY) == 2.0


def test_usual_week_needs_a_few_weeks_of_history():
    last = sc._week(NOW - 7 * DAY) - 1
    assert sc.usual_week({str(last): 2, str(last - 1): 2}, NOW - 7 * DAY) \
        is None
    assert sc.usual_week({str(last - 2): 2}, NOW - 7 * DAY) == 0.0
    assert sc.usual_week({}, NOW - 7 * DAY) is None
    # weeks of the window itself are not history
    now_week = sc._week(NOW)
    assert sc.usual_week({str(now_week): 9}, NOW - 7 * DAY) is None


def test_usual_week_looks_back_at_most_26_weeks():
    last = sc._week(NOW - 7 * DAY) - 1
    # 26 counted weeks of 1, then a burst 40 weeks back that is out of range
    weeks = {str(last - k): 1 for k in range(26)}
    weeks.update({str(last - 40 + k): 9 for k in range(10)})
    assert sc.usual_week(weeks, NOW - 7 * DAY) == 1.0


def test_a_louder_sender_is_found_with_its_numbers():
    mails = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    out = sc.changes(seeded(mails), NOW)
    row = out["louder"][L]
    assert (row["n"], row["usual"], row["factor"]) == (5, 1.0, 5.0)
    assert len(row["ts"]) == 5 and row["end"] == NOW
    assert row["label"] == L


def test_three_mails_or_exactly_double_are_not_louder():
    three = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5)]
    assert L not in sc.changes(seeded(three), NOW)["louder"]
    double = weekly(L, 12, every=3.5) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5)]
    assert L not in sc.changes(seeded(double, "two"), NOW)["louder"]


def test_a_new_sender_with_no_history_is_not_louder():
    mails = [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)] + [mail(14, L)]
    assert sc.changes(seeded(mails), NOW)["louder"] == {}
    # two weeks of history are still too few
    mails = [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5, 9, 16)]
    assert sc.changes(seeded(mails, "b"), NOW)["louder"] == {}


def test_the_last_four_weeks_are_looked_at_in_weekly_steps():
    # louder two weeks ago, calm since
    mails = weekly(L, 12, first=24) + [mail(d, L) for d in (8, 9, 10, 11, 12)]
    row = sc.changes(seeded(mails), NOW)["louder"][L]
    assert row["n"] == 5 and row["end"] < NOW - 6 * DAY
    assert "ts" not in row                  # only the step ending now has it


def test_cleaned_senders_are_left_out_while_the_counts_are_young():
    mails = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    acc = seeded(mails)
    assert L in sc.changes(acc, NOW)["louder"]
    sc.note_cleaned("acct", {L}, now=NOW)
    sc.reset_cache()
    assert L not in sc.changes(acc_of(mails), NOW)["louder"]


def test_cleaned_senders_are_compared_after_eight_weeks():
    hist = weekly(L, 14)
    busy = [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    # counting began 9 weeks ago; the busy week arrived at a later scan
    sc.record_scan("acct", [], None, hist, now=NOW - 63 * DAY)
    sc.note_cleaned("acct", {L}, now=NOW - 60 * DAY)
    sc.record_scan("acct", hist, NOW - 63 * DAY, hist + busy, now=NOW)
    out = sc.changes(acc_of(hist + busy), NOW)
    assert out["louder"][L]["n"] == 5
    # the same store, counting only 7 weeks old: the cleaned sender is out
    sc.reset_cache()
    path = sc._path()
    data = json.loads(path.read_text())
    data["accounts"]["acct"]["since"] = NOW - 49 * DAY
    path.write_text(json.dumps(data))
    sc.reset_cache()
    assert L not in sc.changes(acc_of(hist + busy), NOW + 1)["louder"]


def test_the_audit_log_marks_senders_cleaned_before_the_counting_began():
    mails = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    auditlog.record("trash", account="acct", count=4,
                    label="Old Shop, loud@x.example")
    acc = seeded(mails)
    assert L not in sc.changes(acc, NOW)["louder"]
    # a purge out of Junk / Trash, a failed move and an undo are not cleaning
    other = weekly("o@x.example", 12) + [mail(d, "o@x.example")
                                         for d in (0.5, 1.5, 2.5, 3.5, 5)]
    auditlog.record("trash", account="two", count=4, label="o@x.example",
                    from_role="junk")
    auditlog.record("move", account="two", count=0, label="o@x.example")
    auditlog.record("trash", account="two", count=2, label="o@x.example",
                    outcome="error")
    auditlog.record("undo", account="two", count=4, label="o@x.example")
    assert "o@x.example" in sc.changes(seeded(other, "two"), NOW)["louder"]
    # the log is per account: what was cleaned in "acct" says nothing here
    auditlog.record("trash", account="acct", count=4, label="o@x.example")
    sc.reset_cache()
    assert "o@x.example" in sc.changes(seeded(other, "three"), NOW)["louder"]


def test_a_sender_is_matched_by_its_label_in_the_audit_log():
    mails = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    auditlog.record("archive", account="acct", count=2, label="Loud Shop")
    acc = seeded(mails, labels={L: "Loud Shop"})
    assert L not in sc.changes(acc, NOW)["louder"]


# ------------------------------------------------------------- came back

def test_came_back_needs_six_months_of_silence():
    long_gap = [mail(d, B) for d in (190, 3, 1)]
    out = sc.changes(seeded(long_gap), NOW)["back"][B]
    assert out["gap_days"] == 187 and out["n"] == 2 and out["ts"] == NOW - 3 * DAY
    short_gap = [mail(d, "s@x.example") for d in (180, 3, 1)]
    assert "s@x.example" not in sc.changes(seeded(short_gap, "s"), NOW)["back"]
    # 182 days is still short of 6 months, 183 is enough
    edge = [mail(d, "e@x.example") for d in (184, 2)]          # 182 days
    assert sc.changes(seeded(edge, "e"), NOW)["back"] == {}
    edge = [mail(d, "e@x.example") for d in (185, 2)]          # 183 days
    assert "e@x.example" in sc.changes(seeded(edge, "f"), NOW)["back"]


def test_the_oldest_mails_of_a_sender_are_not_a_comeback():
    mails = [mail(d, "c@x.example") for d in (400, 399, 398)]
    assert sc.changes(seeded(mails), NOW)["back"] == {}
    only_new = [mail(d, "n@x.example") for d in (3, 2)]
    assert sc.changes(seeded(only_new, "n"), NOW)["back"] == {}


def test_a_later_scan_finds_a_comeback_from_the_last_mail_it_saw():
    old = [mail(d, B) for d in (300, 299)]
    sc.record_scan("acct", [], None, old, now=NOW - 20 * DAY)
    new = [mail(2, B)]
    sc.record_scan("acct", old, NOW - 20 * DAY, old + new, now=NOW)
    out = sc.changes(acc_of(old + new), NOW)["back"][B]
    assert out["gap_days"] == 297 and out["n"] == 1
    entry = sc.load_account("acct")
    assert entry["back"][B]["t"] == 0        # the silence began before counting


def test_a_comeback_after_counting_began_is_trusted_even_if_cleaned():
    first = [mail(300, B)]
    sc.record_scan("acct", [], None, first, now=NOW - 299 * DAY)
    both = first + [mail(250, B)]                 # counting saw this one
    sc.record_scan("acct", first, NOW - 299 * DAY, both, now=NOW - 100 * DAY)
    sc.note_cleaned("acct", {B}, now=NOW - 90 * DAY)
    everything = both + [mail(1, B)]
    sc.record_scan("acct", both, NOW - 100 * DAY, everything, now=NOW)
    assert sc.load_account("acct")["back"][B]["t"] == 1
    out = sc.changes(acc_of(everything), NOW)
    assert B in out["back"] and out["back"][B]["gap_days"] == 249


def test_a_comeback_resting_on_mail_from_before_counting_needs_an_uncleaned_sender():
    mails = [mail(d, B) for d in (462, 6, 4)]
    acc = seeded(mails)
    assert B in sc.changes(acc, NOW)["back"]
    sc.note_cleaned("acct", {B}, now=NOW)
    sc.reset_cache()
    assert B not in sc.changes(acc_of(mails), NOW)["back"]


def test_a_comeback_whose_mail_has_left_shows_nothing():
    old = [mail(d, B) for d in (462, 6)]
    seeded(old)
    assert B not in sc.changes(acc_of([mail(462, B)]), NOW)["back"]


def test_never_opened_looks_at_the_older_mail_still_here():
    unread = [mail(d, B, seen=False) for d in (462, 6)]
    assert sc.changes(seeded(unread), NOW)["back"][B]["never_opened"] is True
    opened = [mail(462, "o@x.example", seen=True), mail(6, "o@x.example")]
    assert sc.changes(seeded(opened, "o"), NOW)["back"]["o@x.example"][
        "never_opened"] is False


# ------------------------------------------------------------------ the store

def test_a_scan_counts_what_arrived_per_sender_and_week():
    old = weekly(L, 6)
    sc.record_scan("acct", [], None, old, now=NOW - 2 * DAY)
    new = [mail(1, L), mail(1.1, L), mail(0.5, "z@x.example")]
    sc.record_scan("acct", old, NOW - 2 * DAY, old + new, now=NOW)
    e = sc.load_account("acct")
    this_week = str(sc._week(NOW - 1 * DAY))
    assert e["weeks"][L][this_week] >= 2
    assert e["weeks"]["z@x.example"] == {str(sc._week(NOW - 0.5 * DAY)): 1}
    assert e["last"]["z@x.example"] == NOW - DAY // 2


def test_restored_old_mail_and_mails_already_seen_are_no_arrivals():
    old = [mail(30, L), mail(31, L)]
    prev = old + [mail(1, L)]
    restored = [mail(20, L)]            # dated before the previous scan
    got = sc.arrivals_by_sender(prev, NOW - 2 * DAY, prev + restored, NOW)
    assert got == {}
    assert sc.arrivals_by_sender([], NOW - DAY, prev, NOW) is None
    assert sc.arrivals_by_sender(prev, None, prev, NOW) is None
    fresh = mail(0.2, L)
    assert sc.arrivals_by_sender(prev, NOW - 2 * DAY, prev + [fresh], NOW) \
        == {L: [fresh["ts"]]}


def test_counts_older_than_26_weeks_are_dropped():
    old = [mail(300, L), mail(10, L)]
    sc.record_scan("acct", [], None, old, now=NOW)
    e = sc.load_account("acct")
    assert list(e["weeks"][L]) == [str(sc._week(NOW - 10 * DAY))]
    assert e["last"][L] == NOW - 10 * DAY        # the last mail is kept


def test_the_first_scan_seeds_from_the_mailbox_and_keeps_numbers_only():
    mails = [mail(3, L), mail(4, L)]
    sc.record_scan("acct", [], None, mails, now=NOW)
    e = sc.load_account("acct")
    assert e["since"] == NOW
    assert sum(e["weeks"][L].values()) == 2
    raw = sc._path().read_text()
    assert "subject" not in raw and "@x.example" in raw   # addresses, no more
    # a second scan does not seed again
    sc.record_scan("acct", mails, NOW - DAY, mails, now=NOW + DAY)
    assert sc.load_account("acct")["since"] == NOW


def test_a_missing_address_in_a_moved_mail_cannot_lose_the_undo_step(bridge):
    mailops.run_scan()
    acc = accountsmod.get()
    with acc.lock:
        for m in acc.index.values():
            if m["addr"] == "noreply@dhl.example":
                m.pop("addr")             # a mail record without its sender
                break
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    d = wait_delete_done()
    assert d["moved"] >= 1
    assert acc.undo_log                   # the step was recorded


def test_a_scan_that_breaks_the_store_does_not_raise(monkeypatch):
    monkeypatch.setattr(sc, "_persist", lambda d: 1 / 0)
    sc.record_scan("acct", [], None, [mail(1, L)], now=NOW)
    sc.note_cleaned("acct", {L})


def test_cleaned_senders_are_capped(monkeypatch):
    monkeypatch.setattr(sc, "MAX_CLEANED", 3)
    for i in range(6):
        sc.note_cleaned("acct", {f"a{i}@x.example"}, now=NOW + i)
    kept = sc.load_account("acct")["cleaned"]
    assert set(kept) == {"a5@x.example", "a4@x.example", "a3@x.example"}


@pytest.mark.parametrize("content", [
    "{not json", "", "[]", "null", '{"accounts": []}',
    '{"accounts": {"a": "nope"}}', b"\xff\xfegarbage"])
def test_a_damaged_file_only_forgets(content):
    sc._path().write_bytes(content if isinstance(content, bytes)
                           else content.encode())
    sc.reset_cache()
    assert sc.load_account("a") == {}
    sc.record_scan("a", [], None, [mail(1, L)], now=NOW)     # recovers
    sc.reset_cache()
    assert "since" in sc.load_account("a")


def test_the_store_follows_an_account_rename_and_drop():
    sc.record_scan("one", [], None, [mail(1, L)], now=NOW)
    sc.rename_account("one", "uno")
    assert sc.load_account("one") == {} and "since" in sc.load_account("uno")
    sc.reset_cache()
    assert "since" in sc.load_account("uno")
    sc.drop_account("uno")
    sc.reset_cache()
    assert sc.load_account("uno") == {}


def test_the_config_endpoint_renames_and_drops_the_counts():
    sc.record_scan("default", [], None, [mail(1, L)], now=NOW)
    r = client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "main"}})
    assert r.status_code == 200, r.text
    assert "since" in sc.load_account("main")
    assert sc.load_account("default") == {}
    cfgmod.update_config({"add_account": "two"})
    sc.record_scan("two", [], None, [mail(1, L)], now=NOW)
    client.post("/api/config", json={"delete_account": "two"})
    assert sc.load_account("two") == {}
    assert "since" in sc.load_account("main")


def test_counts_are_per_account_and_per_tenant():
    sc.record_scan("one", [], None, [mail(1, L)], now=NOW)
    assert sc.load_account("two") == {}
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert sc.load_account("one") == {}
        sc.record_scan("one", [], None, [mail(2, B)], now=NOW)
        assert set(sc.load_account("one")["last"]) == {B}
    assert set(sc.load_account("one")["last"]) == {L}
    assert (alice.root / "sender_changes.json").is_file()
    # the evaluation is per tenant, too: the same mailbox against another
    # tenant's counts (which know of no comeback) must not see this one's
    mails = [mail(d, B) for d in (462, 6)]
    sc.record_scan("cmp", [], None, mails, now=NOW)
    acc = acc_of(mails, name="cmp")
    assert B in sc.changes(acc, NOW)["back"]
    with tenants.use(alice):
        sc.record_scan("cmp", [], None, [], now=NOW)
        assert sc.changes(acc, NOW)["back"] == {}
    assert B in sc.changes(acc, NOW)["back"]


# -------------------------------------------------- through the real scan

def _scan_dates(bridge, days_list, frm, uid0=100):
    for i, d in enumerate(days_list):
        bridge.mailbox["INBOX"].append(make_msg(
            uid0 + i, frm=frm, subject=f"Offer {uid0 + i}",
            date=time.strftime("%d-%b-%Y %H:%M:%S +0000",
                               time.gmtime(time.time() - d * DAY))))


def test_scans_keep_the_counts_and_a_trash_marks_the_sender_cleaned(bridge):
    mailops.run_scan()
    entry = sc.load_account("default")
    assert "noreply@dhl.example" in entry["last"] and entry["since"]
    _scan_dates(bridge, [0.2, 0.5], '"Deals" <deals@gadget.example>')
    mailops.run_scan()
    e = sc.load_account("default")
    assert sum(e["weeks"]["deals@gadget.example"].values()) == 2
    mailops.delete_groups("sender", ["deals@gadget.example"])
    assert not wait_delete_done()["error"]
    assert "deals@gadget.example" in sc.load_account("default")["cleaned"]
    # a mark-as-read is no cleaning
    mailops.delete_groups("sender", ["noreply@dhl.example"],
                          action="mark_read")
    wait_delete_done()
    assert "noreply@dhl.example" not in sc.load_account("default")["cleaned"]


def test_the_group_flags_follow_the_scan(bridge):
    now = time.time()
    # steady history on the first scan, a busy week on the second
    hist = [w * 7 + 10 for w in range(10)]
    _scan_dates(bridge, hist, '"Loud Shop" <loud@gadget.example>')
    _scan_dates(bridge, [300, 3, 2], '"Back Shop" <back@gadget.example>',
                uid0=300)
    mailops.run_scan()
    _scan_dates(bridge, [0.5, 1.5, 2.5, 3.5, 5],
                '"Loud Shop" <loud@gadget.example>', uid0=500)
    mailops.run_scan()
    st = mailops.public_state()
    g = st["groups"]["sender"]["loud@gadget.example"]
    assert g["louder"]["n"] == 5 and g["louder"]["usual"] == 1.0
    assert g["louder"]["addr"] == "loud@gadget.example" and len(g["louder"]["ts"]) == 5
    assert "back" not in g
    b = st["groups"]["sender"]["back@gadget.example"]
    assert b["back"]["gap_days"] > 290 and b["back"]["n"] == 2
    # keys only when there is something; the domain row carries them too
    assert "louder" not in st["groups"]["sender"]["noreply@dhl.example"]
    dom = st["groups"]["domain"]["gadget.example"]
    assert dom["louder"]["addr"] == "loud@gadget.example"
    assert dom["back"]["addr"] == "back@gadget.example"
    assert now


# ----------------------------------------------------------- filter words

LOUDER_REC = {"addr": L, "label": "Loud", "n": 5, "usual": 1.0, "factor": 5.0,
              "ts": [NOW - 3600, NOW - 2 * DAY, NOW - 3 * DAY, NOW - 4 * DAY,
                     NOW - 5 * DAY]}
BACK_REC = {"addr": B, "label": "Back", "ts": NOW - 5 * DAY, "gap_days": 300,
            "n": 2, "never_opened": False}


def grp(**kw):
    return {"key": "k@x.example", "label": "K", "sub": "", "tags": [], **kw}


def test_the_filter_words_parse():
    f = rulesmod.parse_filter("is:louder is:back")
    assert f["louder"] and f["back"]
    f = rulesmod.parse_filter("is:louder")
    assert f["louder"] and not f["back"] and f["text"] == []


def test_louder_matches_the_last_seven_days_and_in_narrows_it():
    f = rulesmod.parse_filter("is:louder")
    assert rulesmod.match_group(grp(louder=LOUDER_REC), f, NOW)
    assert not rulesmod.match_group(grp(), f, NOW)
    # a shorter window counts fewer mails: 1 mail in the last 2 hours is not enough
    short = rulesmod.parse_filter("is:louder in:2h")
    assert not rulesmod.match_group(grp(louder=LOUDER_REC), short, NOW)
    four_days = rulesmod.parse_filter("is:louder in:6d")
    assert rulesmod.match_group(grp(louder=LOUDER_REC), four_days, NOW)
    three = rulesmod.parse_filter("is:louder in:3d")           # 2 mails left
    assert not rulesmod.match_group(grp(louder=LOUDER_REC), three, NOW)
    # a window wider than a week counts the same seven days
    wide = rulesmod.parse_filter("is:louder in:30d")
    assert rulesmod.match_group(grp(louder=LOUDER_REC), wide, NOW)
    # twice the usual week is not louder when the window cuts it
    busy_usual = {**LOUDER_REC, "usual": 2.0}
    assert not rulesmod.match_group(grp(louder=busy_usual), rulesmod.parse_filter(
        "is:louder in:4d"), NOW)


def test_back_matches_thirty_days_and_in_replaces_them():
    f = rulesmod.parse_filter("is:back")
    assert rulesmod.match_group(grp(back=BACK_REC), f, NOW)
    old = {**BACK_REC, "ts": NOW - 40 * DAY}
    assert not rulesmod.match_group(grp(back=old), f, NOW)
    assert rulesmod.match_group(grp(back=old), rulesmod.parse_filter(
        "is:back in:60d"), NOW)
    assert not rulesmod.match_group(grp(back=BACK_REC), rulesmod.parse_filter(
        "is:back in:2d"), NOW)
    assert not rulesmod.match_group(grp(), f, NOW)


def test_a_window_is_valid_next_to_the_new_words():
    assert rulesmod.validate_filter("is:louder in:3d") == []
    assert rulesmod.validate_filter("is:back in:3d") == []
    assert rulesmod.validate_filter("is:back is:louder") == []
    assert rulesmod.validate_filter("in:3d") == ["in:3d"]
    assert rulesmod.validate_filter("is:loud") == ["is:loud"]
    assert rulesmod.validate_filter("tag:newsletter in:3d") == ["in:3d"]


def test_purge_rules_refuse_the_new_words():
    assert "is:louder" in rulesmod.purge_unsupported("is:louder")
    assert "is:back" in rulesmod.purge_unsupported("is:back")


def test_the_grammar_names_both_words():
    is_q = next(g for g in rulesmod.FILTER_GRAMMAR if g["qualifier"] == "is")
    assert {"louder", "back"} <= set(is_q["values"])
    assert is_q["syntax"].endswith("|louder|back")
    assert "louder" in is_q["meaning"] and "back" in is_q["meaning"]


def test_a_rule_can_use_the_words(bridge):
    for q in ("is:louder", "is:back", "is:louder in:3d", "is:back in:60d"):
        r = client.post("/api/rules", json={
            "name": "Changes", "query": q, "action": "archive"})
        assert r.status_code == 200, (q, r.text)
    r = client.post("/api/rules", json={
        "name": "x", "query": "tag:newsletter in:3d", "action": "archive"})
    assert r.status_code == 400 and "rule_filter_window" in r.json()["detail"]


def test_the_error_text_names_the_new_words_next_to_a_window():
    from backend import errortext
    for code in ("rule_filter_window", "rule_filter_window_run"):
        assert "is:louder, is:back" in errortext.TEXT[code]


# --------------------------------------------------------------- the Overview

def _ov(mails, since=None, labels=None):
    return overview.build(seeded(mails, labels=labels), since=since, now=NOW)


def test_overview_counts_the_senders_that_got_louder_and_came_back():
    mails = (weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
             + [mail(d, B) for d in (462, 6, 4)])
    w = _ov(mails, labels={L: "Loud Shop", B: "Back Shop"})["week"]
    assert w["louder"] == 1
    assert w["louder_top"] == {"label": "Loud Shop", "n": 5, "usual": 1.0}
    assert w["back"] == 1
    assert w["back_top"] == {"label": "Back Shop", "months": 14,
                             "never_opened": True}


def test_overview_rows_have_nothing_to_show_at_zero():
    w = _ov(weekly(L, 12))["week"]
    assert (w["louder"], w["louder_top"], w["back"], w["back_top"]) == \
        (0, None, 0, None)


def test_the_since_window_counts_a_short_window_as_it_is():
    mails = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    # since two days ago: only 2 of the 5 mails are in the window
    out = _ov(mails, since=NOW - 2 * DAY)
    assert out["since"]["louder"] == 0 and out["week"]["louder"] == 1
    # since four days ago: 4 mails, still louder
    assert _ov(mails, since=NOW - 4 * DAY)["since"]["louder"] == 1


def test_the_since_window_counts_a_long_window_as_the_last_seven_days():
    mails = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    out = _ov(mails, since=NOW - 30 * DAY)
    assert out["since"]["louder"] == 1
    assert out["since"]["louder_top"]["n"] == 5


def test_came_back_counts_in_the_window_it_arrived_in():
    mails = [mail(d, B) for d in (462, 6, 4)]
    assert _ov(mails)["week"]["back"] == 1
    assert _ov(mails, since=NOW - 5 * DAY)["since"]["back"] == 0
    assert _ov(mails, since=NOW - 7 * DAY)["since"]["back"] == 1


def test_overview_many_came_back_name_the_shortest_silence():
    mails = [mail(d, B) for d in (462, 6)] + [mail(d, "b2@x.example")
                                              for d in (200, 3)]
    w = _ov(mails)["week"]
    assert w["back"] == 2 and w["back_top"]["months"] == 6


# ----------------------------------------------------------------- the card

def test_the_card_lists_the_changes_with_what_the_actions_need():
    mails = (weekly(L, 12) + [mail(d, L, ) for d in (0.5, 1.5, 2.5, 3.5, 5)]
             + [mail(d, B) for d in (462, 6, 4)])
    acc = seeded(mails, labels={L: "Loud", B: "Back"})
    acc.state["groups"]["sender"][L]["unsub"] = True
    out = overview.changes_card(acc, NOW)
    assert out["days"] == 30 and out["since"] == NOW
    row = out["louder"][0]
    assert (row["key"], row["label"], row["n"], row["usual"], row["factor"],
            row["unsub"], row["protected"]) == (L, "Loud", 5, 1.0, 5.0,
                                               True, False)
    assert out["back"][0]["key"] == B and out["back"][0]["gap_days"] > 450


def test_the_card_marks_protected_and_already_unsubscribed_senders(monkeypatch):
    from backend import unsubstore
    mails = weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)]
    acc = seeded(mails)
    acc.state["groups"]["sender"][L]["unsub"] = True
    assert overview.changes_card(acc, NOW)["louder"][0]["unsub"] is True
    unsubstore.record(L, "done", "list-unsubscribe", account=acc.name)
    row = overview.changes_card(acc, NOW)["louder"][0]
    assert row["unsub"] is False                 # nothing left to unsubscribe
    assert row["replied"] is False
    acc.state["groups"]["sender"][L]["replied"] = True
    assert overview.changes_card(acc, NOW)["louder"][0]["replied"] is True
    cfgmod.update_config({"protected": [L]})
    assert overview.changes_card(acc, NOW)["louder"][0]["protected"] is True


def test_the_card_has_nothing_without_changes():
    out = overview.changes_card(seeded(weekly(L, 12)), NOW)
    assert out["louder"] == [] and out["back"] == []


def test_the_card_leaves_out_a_comeback_older_than_30_days():
    mails = [mail(d, B) for d in (462, 40, 39)]
    acc = seeded(mails)
    assert sc.changes(acc, NOW)["back"][B]
    assert overview.changes_card(acc, NOW)["back"] == []


def test_the_endpoint_answers_for_one_account(bridge):
    mailops.run_scan()
    r = client.get("/api/sender-changes")
    assert r.status_code == 200, r.text
    assert r.json()["louder"] == [] and r.json()["days"] == 30
    # the fixture's DHL sender has a mail from long ago and new ones: back
    back = r.json()["back"]
    assert [b["key"] for b in back] == ["noreply@dhl.example"]
    assert back[0]["n"] == 2 and back[0]["gap_days"] > 300
    assert client.get("/api/overview").json()["week"]["louder"] == 0


def test_the_overview_is_cached_per_minute_and_scan():
    acc = seeded(weekly(L, 12) + [mail(d, L) for d in (0.5, 1.5, 2.5, 3.5, 5)])
    a = sc.changes(acc, NOW)
    assert sc.changes(acc, NOW + 5) is a            # same minute, same scan
    acc.state["groups_rev"] += 1
    assert sc.changes(acc, NOW + 5) is not a        # the index changed
    b = sc.changes(acc, NOW + 5)
    assert sc.changes(acc, NOW + 120) is not b      # a minute later
