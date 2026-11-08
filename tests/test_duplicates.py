"""Duplicate finder: Message-ID sets, (addr, subject, size) sets for mails
without a Message-ID, ordering."""

from fastapi.testclient import TestClient

from backend import mailops
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)


def _scan(monkeypatch, mailbox):
    fake = FakeIMAP(mailbox)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return fake


def _idless(uid, **kw):
    """A mail whose Message-ID header is empty (no usable id)."""
    return {**make_msg(uid, **kw), "msgid": ""}


def test_duplicate_sets(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [
            # same Message-ID as the Archive copy below
            make_msg(1, frm="a@x.example", subject="Invoice 1",
                     msgid="<dup@x>", size=500,
                     date="10-Jan-2026 10:00:00 +0000"),
            # tuple duplicate pair (neither copy has a Message-ID)
            _idless(2, frm="b@y.example", subject="Hello", size=300,
                    date="05-Jan-2026 10:00:00 +0000"),
            _idless(3, frm="b@y.example", subject="Hello", size=300,
                    date="06-Jan-2026 10:00:00 +0000"),
            # not a duplicate of anything
            make_msg(4, frm="c@z.example", subject="Unique", size=999),
        ],
        "Archive": [
            make_msg(10, frm="a@x.example", subject="Invoice 1",
                     msgid="<dup@x>", size=500,
                     date="01-Jan-2026 10:00:00 +0000"),
        ],
        "Trash": [], "Spam": [],
    })

    sets = client.get("/api/duplicates").json()
    assert len(sets) == 1 and sets[0]["wasted"] == 500
    # newest first inside a set
    assert [m["folder"] for m in sets[0]["mails"]] == ["INBOX", "Archive"]
    # the id-less pair is a versions set: nothing reclaimable
    (v,) = client.get("/api/duplicates/versions").json()
    assert v["wasted"] == 0 and [m["uid"] for m in v["mails"]] == [3, 2]

    # "all but newest" then trash via the normal per-mail action
    items = [[m["folder"], m["uid"]] for s in sets for m in s["mails"][1:]]
    r = client.post("/api/delete_messages", json={"items": items})
    assert r.json()["queued"] == 1
    wait_delete_done()
    assert client.get("/api/duplicates").json() == []


def test_no_false_positives(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [
            # same subject but different sizes -> not a duplicate
            make_msg(1, frm="a@x.example", subject="Report", size=100,
                     msgid="<r1@x>"),
            make_msg(2, frm="a@x.example", subject="Report", size=200,
                     msgid="<r2@x>"),
            # empty subject never forms tuple sets
            make_msg(3, frm="a@x.example", subject="", size=100,
                     msgid="<e1@x>"),
            make_msg(4, frm="a@x.example", subject="", size=100,
                     msgid="<e2@x>"),
        ],
        "Trash": [], "Spam": [],
    })
    assert client.get("/api/duplicates").json() == []
    assert client.get("/api/duplicates/versions").json() == []


def test_distinct_message_ids_are_never_paired(monkeypatch):
    """Two monthly statements: same sender, subject and size, but each has
    its own Message-ID - two mails, not a duplicate (and so never offered
    to "Select all but newest")."""
    _scan(monkeypatch, {
        "INBOX": [
            make_msg(1, frm="bank@bank.example", subject="Your statement",
                     size=4321, msgid="<stmt-09@bank.example>",
                     date="01-Sep-2026 08:00:00 +0000"),
            make_msg(2, frm="bank@bank.example", subject="Your statement",
                     size=4321, msgid="<stmt-10@bank.example>",
                     date="01-Oct-2026 08:00:00 +0000")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    assert mailops.versions_list() == []


def test_same_message_id_in_two_folders_is_paired(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, subject="Once", msgid="<one@x.example>",
                           date="02-Oct-2026 08:00:00 +0000")],
        "Archive": [make_msg(7, subject="Once", msgid="<one@x.example>",
                             date="01-Oct-2026 08:00:00 +0000")],
        "Trash": [], "Spam": []})
    (s,) = mailops.duplicates_list()
    assert [(m["folder"], m["uid"]) for m in s["mails"]] \
        == [("INBOX", 1), ("Archive", 7)]


def test_two_idless_copies_are_versions(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [_idless(1, subject="Notice", size=640,
                          date="02-Oct-2026 08:00:00 +0000"),
                  _idless(2, subject="Notice", size=640,
                          date="01-Oct-2026 08:00:00 +0000")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    (s,) = mailops.versions_list()
    assert [m["uid"] for m in s["mails"]] == [1, 2]


def test_an_idless_mail_is_not_paired_with_one_that_has_an_id(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [_idless(1, subject="Notice", size=640),
                  make_msg(2, subject="Notice", size=640,
                           msgid="<n2@shop.example>")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    assert mailops.versions_list() == []


def test_junk_message_ids_never_pair_unrelated_mails(monkeypatch):
    """`<>`, `@`, `<@localhost>`, `-` ... are emitted by odd mailers and
    shared by unrelated mails; they count as "no Message-ID", so only the
    (sender, subject, size) rule can pair them - and it doesn't here."""
    junk = ["<>", "@", "<@>", "<@localhost>", "<a@>", "-", " < @ > ",
            "<no-at-sign>", "a@b.example"]      # the last lacks the brackets
    inbox = []
    for uid, mid in enumerate(junk, start=1):
        inbox.append(make_msg(uid, frm=f"s{uid}@x.example",
                              subject=f"Subject {uid}", size=100 + uid,
                              msgid=mid))
        inbox.append(make_msg(uid + 100, frm=f"t{uid}@y.example",
                              subject=f"Other {uid}", size=500 + uid,
                              msgid=mid))
    _scan(monkeypatch, {"INBOX": inbox, "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    assert mailops.versions_list() == []


def test_truncated_long_message_ids_never_pair(monkeypatch):
    """Two different ids that share their first 300 characters are stored
    identically (cut at 300): that is not an identity."""
    head = "<" + "x" * 320
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, frm="a@x.example", subject="One", size=100,
                           msgid=head + "-1@x.example>"),
                  make_msg(2, frm="b@y.example", subject="Two", size=200,
                           msgid=head + "-2@x.example>")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    assert mailops.versions_list() == []


def test_ordinary_message_ids_still_pair(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, subject="Same", msgid="<a@b.example>")],
        "Archive": [make_msg(5, subject="Same", msgid="<a@b.example>")],
        "Trash": [], "Spam": []})
    (s,) = mailops.duplicates_list()
    assert len(s["mails"]) == 2


def _pair(monkeypatch, id1, id2):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, frm="bank@bank.example", subject="Statement",
                           size=4321, msgid=id1),
                  make_msg(2, frm="bank@bank.example", subject="Statement",
                           size=4321, msgid=id2)],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    return mailops.versions_list()


def test_distinct_malformed_ids_are_not_paired(monkeypatch):
    assert _pair(monkeypatch, "stmt-09@bank.example",
                 "stmt-10@bank.example") == []
    assert _pair(monkeypatch, "<s09@bank.example> (x)",
                 "<s10@bank.example> (x)") == []


def test_identical_junk_id_pairs_only_with_same_sender_subject_size(
        monkeypatch):
    assert len(_pair(monkeypatch, "-", "-")) == 1


def test_identical_junk_id_alone_does_not_pair_unrelated_mails(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, frm="a@x.example", subject="One", size=1,
                           msgid="-"),
                  make_msg(2, frm="b@y.example", subject="Two", size=2,
                           msgid="-")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    assert mailops.versions_list() == []


def test_junk_id_is_not_paired_with_no_id(monkeypatch):
    assert _pair(monkeypatch, "-", "") == []


def _stamp(h, m):
    return f"05-Oct-2026 {h:02d}:{m:02d}:00 +0000"


def _possible(monkeypatch, inbox):
    _scan(monkeypatch, {"INBOX": inbox, "Trash": [], "Spam": []})
    return mailops.possible_duplicates_list()


def test_double_send_within_ten_minutes_is_a_possible_duplicate(monkeypatch):
    (s,) = _possible(monkeypatch, [
        make_msg(1, frm="a@x.example", subject="Offer  ENDS today",
                 date=_stamp(9, 0)),
        make_msg(2, frm="a@x.example", subject="offer ends today",
                 date=_stamp(9, 4))])
    assert [m["uid"] for m in s["mails"]] == [2, 1]
    assert mailops.duplicates_list() == []          # different Message-IDs
    assert mailops.versions_list() == []


def test_possible_duplicates_window_and_chaining(monkeypatch):
    # 11 minutes apart: no; chained through a third mail: yes
    assert _possible(monkeypatch, [
        make_msg(1, frm="a@x.example", subject="S", date=_stamp(9, 0)),
        make_msg(2, frm="a@x.example", subject="S", date=_stamp(9, 11))]) == []


def test_possible_duplicates_chain_via_a_third_mail(monkeypatch):
    (s,) = _possible(monkeypatch, [
        make_msg(1, frm="a@x.example", subject="S", date=_stamp(9, 0)),
        make_msg(2, frm="a@x.example", subject="S", date=_stamp(9, 8)),
        make_msg(3, frm="a@x.example", subject="S", date=_stamp(9, 16))])
    assert len(s["mails"]) == 3


def test_possible_duplicates_need_same_sender_and_subject(monkeypatch):
    assert _possible(monkeypatch, [
        make_msg(1, frm="a@x.example", subject="S", date=_stamp(9, 0)),
        make_msg(2, frm="b@x.example", subject="S", date=_stamp(9, 1)),
        make_msg(3, frm="a@x.example", subject="Other", date=_stamp(9, 2)),
        make_msg(4, frm="c@x.example", subject="", date=_stamp(9, 0)),
        make_msg(5, frm="c@x.example", subject="", date=_stamp(9, 1))]) == []


def test_exact_duplicates_are_left_out_of_possible(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, frm="a@x.example", subject="S",
                           msgid="<same@x.example>", date=_stamp(9, 0)),
                  make_msg(2, frm="a@x.example", subject="S",
                           msgid="<own@x.example>", date=_stamp(9, 1))],
        "Archive": [make_msg(5, frm="a@x.example", subject="S",
                             msgid="<same@x.example>",
                             date=_stamp(9, 0))],
        "Trash": [], "Spam": []})
    assert len(mailops.duplicates_list()) == 1
    # uids 1 and 5 are an exact set; 2 alone is not a group
    assert mailops.possible_duplicates_list() == []
    r = client.get("/api/duplicates/possible")
    assert r.status_code == 200 and r.json() == []


def _ids(sets):
    return [sorted(m["uid"] for m in s["mails"]) for s in sets]


def test_same_id_and_size_is_identical_only(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, subject="S", msgid="<a@x.example>", size=700)],
        "Archive": [make_msg(2, subject="S", msgid="<a@x.example>",
                             size=700)],
        "Trash": [], "Spam": []})
    assert _ids(mailops.duplicates_list()) == [[1, 2]]
    assert mailops.versions_list() == []


def test_same_id_different_sizes_is_versions_only(monkeypatch):
    """Guard: a group whose copies differ in size never reaches the
    identical list, so "Select all but newest" can't touch it."""
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, subject="S", msgid="<a@x.example>", size=700,
                           date="02-Oct-2026 08:00:00 +0000")],
        "Archive": [make_msg(2, subject="S", msgid="<a@x.example>",
                             size=9000, date="01-Oct-2026 08:00:00 +0000")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    assert client.get("/api/duplicates").json() == []
    (v,) = client.get("/api/duplicates/versions").json()
    assert v["wasted"] == 0
    assert [(m["uid"], m["size"]) for m in v["mails"]] \
        == [(1, 700), (2, 9000)]


def test_mixed_group_goes_to_versions_whole(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, subject="S", msgid="<a@x.example>", size=700),
                  make_msg(2, subject="S", msgid="<a@x.example>", size=700)],
        "Archive": [make_msg(3, subject="S", msgid="<a@x.example>",
                             size=650)],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
    assert _ids(mailops.versions_list()) == [[1, 2, 3]]


def test_versions_account_param(monkeypatch):
    from backend import accounts
    from test_multiaccount import _two_accounts
    fakes = _two_accounts(monkeypatch)
    for host, mid, uids in (("host-one", "<one@x.example>", (101, 102)),
                            ("host-two", "<two@x.example>", (201, 202))):
        for uid, size in zip(uids, (700, 900)):
            fakes[host].mailbox["INBOX"].append(
                make_msg(uid, subject="S", msgid=mid, size=size))
    mailops.run_scan(accounts.get("one"))
    mailops.run_scan(accounts.get("two"))
    r1 = client.get("/api/duplicates/versions", params={"account": "one"})
    r2 = client.get("/api/duplicates/versions", params={"account": "two"})
    assert _ids(r1.json()) == [[101, 102]]
    assert _ids(r2.json()) == [[201, 202]]
    r = client.get("/api/duplicates/versions", params={"account": "nope"})
    assert r.status_code == 400


def test_possible_leaves_out_versions_members(monkeypatch):
    """Guard: mails already listed as versions are not listed again as
    possible duplicates (uid 3 is a different-id double-send partner)."""
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, frm="a@x.example", subject="S",
                           msgid="<same@x.example>", size=700,
                           date=_stamp(9, 0)),
                  make_msg(2, frm="a@x.example", subject="S",
                           msgid="<same@x.example>", size=900,
                           date=_stamp(9, 1)),
                  make_msg(3, frm="a@x.example", subject="S",
                           msgid="<own@x.example>", size=500,
                           date=_stamp(9, 2))],
        "Trash": [], "Spam": []})
    assert _ids(mailops.versions_list()) == [[1, 2]]
    assert mailops.possible_duplicates_list() == []


# ------------------------------------------------------------------ summary

def test_summary_counts_every_kind_without_a_cap(monkeypatch):
    inbox = [
        # identical pair (500 reclaimable)
        make_msg(1, frm="a@x.example", subject="One", msgid="<i@x.example>",
                 size=500, date=_stamp(8, 0)),
        make_msg(2, frm="a@x.example", subject="One", msgid="<i@x.example>",
                 size=500, date=_stamp(8, 1)),
        # versions pair (same id, different size)
        make_msg(3, frm="b@x.example", subject="Two", msgid="<v@x.example>",
                 size=700, date=_stamp(8, 2)),
        make_msg(4, frm="b@x.example", subject="Two", msgid="<v@x.example>",
                 size=900, date=_stamp(8, 3)),
        # possible pair (different ids, same sender + subject, 4 min apart)
        make_msg(5, frm="c@x.example", subject="Three",
                 msgid="<p1@x.example>", date=_stamp(9, 0)),
        make_msg(6, frm="c@x.example", subject="three",
                 msgid="<p2@x.example>", date=_stamp(9, 4)),
    ]
    _scan(monkeypatch, {"INBOX": inbox, "Trash": [], "Spam": []})
    assert client.get("/api/duplicates/summary").json() == {
        "sets": 1, "wasted": 500, "versions": 1, "possible": 1,
        "dismissed": 0}
    # identical copies and versions are not counted as possible again
    assert len(mailops.possible_duplicates_list()) == 1


def test_summary_is_not_capped_at_the_list_limit(monkeypatch):
    inbox = []
    for i in range(210):
        for j in (0, 1):
            inbox.append(make_msg(i * 2 + j + 1, frm="a@x.example",
                                  subject=f"S{i}", size=100,
                                  msgid=f"<m{i}@x.example>",
                                  date=_stamp(8, 0)))
    _scan(monkeypatch, {"INBOX": inbox, "Trash": [], "Spam": []})
    assert len(mailops.duplicates_list()) == 200
    assert mailops.duplicates_summary() == {
        "sets": 210, "wasted": 210 * 100, "versions": 0, "possible": 0,
        "dismissed": 0}


def test_summary_of_an_empty_index(monkeypatch):
    _scan(monkeypatch, {"INBOX": [], "Trash": [], "Spam": []})
    assert client.get("/api/duplicates/summary").json() == {
        "sets": 0, "wasted": 0, "versions": 0, "possible": 0,
        "dismissed": 0}


def test_summary_account_param(monkeypatch):
    r = client.get("/api/duplicates/summary", params={"account": "nope"})
    assert r.status_code == 400


# ------------------------------------------- payload: keys, ids, locked sets

def _all_kinds(monkeypatch):
    """One set of every kind: identical, versions, possible (+ a lone mail)."""
    _scan(monkeypatch, {"INBOX": [
        make_msg(1, frm="a@x.example", subject="One", msgid="<i@x.example>",
                 size=500, date=_stamp(8, 0)),
        make_msg(2, frm="a@x.example", subject="One", msgid="<i@x.example>",
                 size=500, date=_stamp(8, 1)),
        make_msg(3, frm="b@x.example", subject="Two", msgid="<v@x.example>",
                 size=700, date=_stamp(8, 2)),
        make_msg(4, frm="b@x.example", subject="Two", msgid="<v@x.example>",
                 size=900, date=_stamp(8, 3)),
        make_msg(5, frm="c@x.example", subject="Three",
                 msgid="<p1@x.example>", date=_stamp(9, 0)),
        make_msg(6, frm="c@x.example", subject="Three",
                 msgid="<p2@x.example>", date=_stamp(9, 4)),
        make_msg(7, frm="d@x.example", subject="Alone"),
    ], "Trash": [], "Spam": []})


def test_payload_carries_the_message_id_the_key_and_no_lock(monkeypatch):
    _all_kinds(monkeypatch)
    (ident,) = client.get("/api/duplicates").json()
    assert ident["key"] == "<i@x.example>" and ident["locked"] is None
    assert [m["msgid"] for m in ident["mails"]] == ["<i@x.example>"] * 2
    assert [m["pinned"] for m in ident["mails"]] == [False, False]
    (ver,) = client.get("/api/duplicates/versions").json()
    assert ver["key"] == "<v@x.example>"
    (pos,) = client.get("/api/duplicates/possible").json()
    assert pos["key"].startswith("p:") and len(pos["key"]) == 26
    assert [m["msgid"] for m in pos["mails"]] == [
        "<p2@x.example>", "<p1@x.example>"]


def test_possible_key_follows_the_members_not_their_order(monkeypatch):
    _all_kinds(monkeypatch)
    (a,) = client.get("/api/duplicates/possible").json()
    mailops.run_scan()
    (b,) = client.get("/api/duplicates/possible").json()
    assert a["key"] == b["key"]


def test_idless_versions_get_a_digest_key(monkeypatch):
    _scan(monkeypatch, {"INBOX": [
        _idless(1, frm="b@y.example", subject="Hello", size=300),
        _idless(2, frm="b@y.example", subject="Hello", size=300)],
        "Trash": [], "Spam": []})
    (v,) = client.get("/api/duplicates/versions").json()
    assert v["key"].startswith("t:") and len(v["key"]) == 26


def test_a_pinned_or_protected_set_is_locked(monkeypatch):
    from backend import config as cfgmod
    _all_kinds(monkeypatch)
    assert client.post("/api/pin", json={"folder": "INBOX", "uid": 1}).json()[
        "pinned"] is True
    cfgmod.update_config({"protected": ["b@x.example"]})
    (ident,) = client.get("/api/duplicates").json()
    assert ident["locked"] == "pinned"
    # pins key off the Message-ID: the other copy is pinned too
    assert [m["pinned"] for m in ident["mails"]] == [True, True]
    (ver,) = client.get("/api/duplicates/versions").json()
    assert ver["locked"] == "protected"
    (pos,) = client.get("/api/duplicates/possible").json()
    assert pos["locked"] is None


# ------------------------------------------------- "Keep all": dismiss/restore

def _dismiss(kind, key, **kw):
    return client.post("/api/duplicates/dismiss",
                       json={"kind": kind, "key": key}, **kw)


def test_dismissed_sets_leave_the_lists_and_the_summary(monkeypatch):
    _all_kinds(monkeypatch)
    (ident,) = client.get("/api/duplicates").json()
    (pos,) = client.get("/api/duplicates/possible").json()
    assert _dismiss("identical", ident["key"]).json() == {"ok": True}
    assert client.get("/api/duplicates").json() == []
    assert len(client.get("/api/duplicates/versions").json()) == 1
    assert client.get("/api/duplicates/summary").json() == {
        "sets": 0, "wasted": 0, "versions": 1, "possible": 1, "dismissed": 1}
    assert _dismiss("possible", pos["key"]).status_code == 200
    assert client.get("/api/duplicates/possible").json() == []
    assert client.get("/api/duplicates/summary").json()["dismissed"] == 2
    # asking twice is fine
    assert _dismiss("possible", pos["key"]).status_code == 200
    assert client.get("/api/duplicates/summary").json()["dismissed"] == 2


def test_a_dismissal_is_per_kind(monkeypatch):
    _all_kinds(monkeypatch)
    # the identical set's id, dismissed as "versions": no effect on identical
    assert _dismiss("versions", "<i@x.example>").status_code == 200
    assert len(client.get("/api/duplicates").json()) == 1
    assert client.get("/api/duplicates/summary").json()["dismissed"] == 0


def test_restore_one_or_all(monkeypatch):
    _all_kinds(monkeypatch)
    keys = {"identical": "<i@x.example>", "versions": "<v@x.example>"}
    for kind, key in keys.items():
        _dismiss(kind, key)
    assert client.get("/api/duplicates/summary").json()["dismissed"] == 2
    r = client.post("/api/duplicates/restore",
                    json={"kind": "identical", "key": keys["identical"]})
    assert r.json() == {"ok": True}
    assert len(client.get("/api/duplicates").json()) == 1
    assert client.get("/api/duplicates/versions").json() == []
    assert client.post("/api/duplicates/restore", json={"all": True}).json() \
        == {"ok": True}
    assert len(client.get("/api/duplicates/versions").json()) == 1
    assert client.get("/api/duplicates/summary").json()["dismissed"] == 0


def test_dismiss_and_restore_refuse_bad_input(monkeypatch):
    _all_kinds(monkeypatch)
    for body in ({"kind": "nope", "key": "<i@x.example>"},
                 {"kind": "identical", "key": ""},
                 {"kind": "identical", "key": "x" * 401},
                 {"kind": "identical", "key": "a\nb"}):
        r = client.post("/api/duplicates/dismiss", json=body)
        assert r.status_code == 400 and r.json()["detail"] == \
            "bad_duplicate_set"
    assert client.post("/api/duplicates/restore", json={}).status_code == 400
    assert client.post("/api/duplicates/restore",
                       json={"kind": "identical"}).status_code == 400
    assert client.post("/api/duplicates/dismiss",
                       json={"kind": "identical", "key": "k"},
                       params={"account": "nope"}).status_code == 400


def test_a_dismissed_possible_set_returns_when_it_gains_a_mail(monkeypatch):
    _all_kinds(monkeypatch)
    (pos,) = client.get("/api/duplicates/possible").json()
    _dismiss("possible", pos["key"])
    assert client.get("/api/duplicates/possible").json() == []
    fake = _scan(monkeypatch, {"INBOX": [
        make_msg(5, frm="c@x.example", subject="Three",
                 msgid="<p1@x.example>", date=_stamp(9, 0)),
        make_msg(6, frm="c@x.example", subject="Three",
                 msgid="<p2@x.example>", date=_stamp(9, 4)),
        make_msg(8, frm="c@x.example", subject="Three",
                 msgid="<p3@x.example>", date=_stamp(9, 5))],
        "Trash": [], "Spam": []})
    assert fake is not None
    (again,) = client.get("/api/duplicates/possible").json()
    assert len(again["mails"]) == 3 and again["key"] != pos["key"]


def test_dismissed_sets_stay_per_account(monkeypatch):
    from backend import accounts
    from test_multiaccount import _two_accounts
    fakes = _two_accounts(monkeypatch)
    for host, uids in (("host-one", (101, 102)), ("host-two", (201, 202))):
        for uid in uids:
            fakes[host].mailbox["INBOX"].append(
                make_msg(uid, subject="S", msgid="<same@x.example>", size=700))
    mailops.run_scan(accounts.get("one"))
    mailops.run_scan(accounts.get("two"))
    r = _dismiss("identical", "<same@x.example>", params={"account": "one"})
    assert r.status_code == 200
    assert client.get("/api/duplicates", params={"account": "one"}).json() == []
    assert len(client.get("/api/duplicates",
                          params={"account": "two"}).json()) == 1


def test_the_one_tap_selection_goes_through_the_normal_trash_path(monkeypatch):
    """"Remove N copies" is all-but-newest of every listed identical set sent
    to /api/delete_messages: undoable, audited, and refused (whole) when a
    copy is pinned or from a protected sender."""
    from backend import config as cfgmod
    _all_kinds(monkeypatch)
    (ident,) = client.get("/api/duplicates").json()
    items = [[m["folder"], m["uid"]] for m in ident["mails"][1:]]
    cfgmod.update_config({"protected": ["a@x.example"]})
    r = client.post("/api/delete_messages", json={"items": items})
    assert r.status_code == 400 \
        and r.json()["detail"] == "protected_sender_selected"
    cfgmod.update_config({"protected": []})
    client.post("/api/pin", json={"folder": "INBOX", "uid": 1})
    r = client.post("/api/delete_messages", json={"items": items})
    assert r.status_code == 400 and r.json()["detail"] == "pinned_mails"
    client.post("/api/pin", json={"folder": "INBOX", "uid": 1,
                                  "pinned": False})
    assert client.post("/api/delete_messages",
                       json={"items": items}).json()["queued"] == 1
    wait_delete_done()
    assert client.get("/api/duplicates").json() == []
    assert client.get("/api/state").json()["undo"], "the move is undoable"
