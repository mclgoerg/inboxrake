"""Automatic mail in "Mail past its date" (backend/pastdate.py): out-of-office
replies, delivery failures, read receipts and calendar answers as the last
three reasons of the sheet. What the scan reads (Auto-Submitted, the report
type, a calendar REPLY part) and back-fills for older mail, what each subject
and header says, the evidence a read receipt or a calendar answer needs, what
is never listed (Keep-safe classes, pinned mail, protected senders, anything
under a week), the default ticks, `is:auto`, and the trash step the listed
mails end up in."""

import email
import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops, mcptools, pastdate, pinstore, smartkinds, tenants
from backend.main import app

from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)

NOW = 1_795_000_000.0
DAY = 86400
_uids = iter(range(1, 10**6))


def mail(subject, days_ago=10, addr="someone@team.example", size=1000,
         msgid=None, folder="INBOX", ts=None, **evidence):
    """An index entry; `evidence` are the notes the scan keeps: `auto`,
    `rpt`, and the Attachments analysis' `cal`."""
    n = next(_uids)
    return {"folder": folder, "uid": n, "msgid": msgid or f"<{n}@x.example>",
            "addr": addr, "subject": subject, "size": size,
            "ts": int(ts if ts is not None else NOW - days_ago * DAY),
            **evidence}


def find(mails, pins=(), protected=(), now=NOW):
    return pastdate.find(mails, set(pins), list(protected), now)


def listed(mails, **kw):
    """{subject: reason} of what `find` lists."""
    res = find(mails, **kw)
    return {m["subject"]: res["flagged"][(m["folder"], m["uid"])][0]
            for m in mails if (m["folder"], m["uid"]) in res["flagged"]}


def hdr(raw: str):
    return email.message_from_bytes((raw + "\r\n\r\n").encode())


# ----------------------------------------------------------- the headers

@pytest.mark.parametrize("value,auto", [
    ("auto-replied", "auto-replied"), ("Auto-Replied", "auto-replied"),
    ("auto-replied (vacation)", "auto-replied"),
    ("auto-replied; owner=x", "auto-replied"),
    ("auto-generated", "auto-generated"), ("auto-notified", "auto-notified"),
    ("no", ""), ("No", ""), ("  ", "")])
def test_the_auto_submitted_keyword(value, auto):
    assert pastdate.header_evidence(
        hdr(f"Auto-Submitted: {value}")) == {"auto": auto}


def test_no_headers_say_nothing_but_the_fact_that_they_were_read():
    """`auto` is always there: a record without it was never read."""
    assert pastdate.header_evidence(hdr("Subject: hi")) == {"auto": ""}


@pytest.mark.parametrize("ctype,rpt", [
    ("multipart/report; report-type=delivery-status; boundary=b",
     "delivery-status"),
    ('multipart/report; report-type="disposition-notification"; boundary=b',
     "disposition-notification"),
    ("Multipart/Report; Report-Type=Delivery-Status; boundary=b",
     "delivery-status"),
    # a report of another type is no bounce and no receipt
    ("multipart/report; report-type=feedback-report; boundary=b", None),
    # the parameter alone means nothing outside a multipart/report
    ("text/plain; report-type=delivery-status", None),
    ("multipart/mixed; report-type=disposition-notification; boundary=b",
     None),
    ("multipart/report; boundary=b", None)])
def test_the_report_type(ctype, rpt):
    got = pastdate.header_evidence(hdr(f"Content-Type: {ctype}"))
    assert got.get("rpt") == rpt
    assert ("rpt" in got) == (rpt is not None)


def test_a_header_reader_never_raises():
    assert pastdate.header_evidence(None) == {"auto": ""}
    assert pastdate.header_evidence(object()) == {"auto": ""}


# ---------------------------------------------------------- the subjects

# The mail programs' own wording, alone and unprefixed: enough on its own
OOO_SUBJECTS = [
    "Automatic reply: Lunch on Friday", "Auto-Reply: Q3 plan",
    "Autoreply: hello", "Automatic response: x",
    "Out of Office AutoReply: hello", "Abwesenheitsnotiz: Treffen",
    "Automatische Antwort: Treffen", "Abwesenheitsnachricht: Treffen"]
# What a person writes too, or writes about such mail: no out-of-office reply
# without the Auto-Submitted header
NOT_OOO_SUBJECTS = [
    "Re: Automatic reply: x", "AW: Automatische Antwort: Treffen",
    "Fwd: Automatic reply: x", "WG: Abwesenheitsnotiz: Treffen",
    "Out of office: 23-27 Dec", "Out of office - please contact Anna",
    "Out of the office - back Monday", "Out-of-office",
    "Out of Office: Re: hello", "Vacation auto-reply: x",
    "Abwesenheitsnachricht", "Out of office on Friday",
    "Automatic reply to your inbox rules", "Your automatic reply settings",
    "Weekly digest", "Auto insurance renewal", "Autoreply settings",
    "Re: Dinner", "Vacation plans", "Out of office hours at the clinic",
    "Abwesenheit im August geplant"]
# A server's exact wording, alone: enough on its own
BOUNCE_SUBJECTS = [
    "Undelivered Mail Returned to Sender",
    "Delivery Status Notification (Failure)",
    "Delivery Status Notification (Delay)", "Undeliverable: Lunch on Friday",
    "Unzustellbar: Treffen"]
# Looser phrases: a bounce only with machine evidence
LOOSE_BOUNCE_SUBJECTS = [
    "Mail delivery failed: returning message to sender",
    "Mail Delivery Failure", "Undeliverable message",
    "Returned mail: see transcript for details", "Failure notice",
    "Nicht zustellbar: Treffen", "Zustellung fehlgeschlagen",
    "E-Mail-Zustellung fehlgeschlagen", "Mail-Zustellung nicht möglich"]
# People writing about delivery problems, replies and forwards of reports:
# never a bounce without machine evidence
HUMAN_BOUNCE_SUBJECTS = [
    "Re: Undelivered Mail Returned to Sender",
    "Fwd: Undelivered Mail Returned to Sender",
    "AW: Undeliverable: Angebot", "WG: Unzustellbar: Angebot",
    "Re: Delivery Status Notification (Failure)",
    "Mail delivery failed again - can you check the server?",
    "Mail delivery failure on our side, sorry",
    "Undeliverable - wrong address for Tom?",
    "Returned mail: wrong address for the invoice",
    "Nicht zustellbar - bitte neue Adresse",
    "Zustellung nicht möglich: 00340434"]
NOT_BOUNCE_SUBJECTS = [
    # a parcel is not a mail
    "Delivery failed: order #12345", "Your parcel could not be delivered",
    "Undeliverable: your parcel", "Undeliverable: Bestellung 123",
    "Zustellung fehlgeschlagen: Paket 123", "Undelivered: your parcel",
    "Mail delivery tips for newsletters", "Returned mail policy",
    "Failure notice board", "Zustellung am Montag", "Weekly digest"]
DAEMON = "mailer-daemon@mx.team.example"


@pytest.mark.parametrize("subject", OOO_SUBJECTS)
def test_out_of_office_subjects(subject):
    assert pastdate.auto_reason(mail(subject), subject) == pastdate.OOO


@pytest.mark.parametrize("subject", NOT_OOO_SUBJECTS)
def test_other_subjects_are_no_out_of_office_reply(subject):
    assert pastdate.auto_reason(mail(subject), subject) is None


@pytest.mark.parametrize("subject", BOUNCE_SUBJECTS)
def test_bounce_subjects(subject):
    assert pastdate.auto_reason(mail(subject), subject) == pastdate.BOUNCES


@pytest.mark.parametrize("subject", LOOSE_BOUNCE_SUBJECTS)
def test_a_looser_bounce_phrase_needs_machine_evidence(subject):
    assert pastdate.auto_reason(mail(subject), subject) is None
    for evidence in (dict(auto="auto-replied"), dict(auto="auto-generated"),
                     dict(addr=DAEMON), dict(addr="Mailer-Daemon@mx.team.example"),
                     dict(rpt="delivery-status")):
        assert pastdate.auto_reason(mail(subject, **evidence), subject) \
            == pastdate.BOUNCES, evidence
    # a daemon never writes behind a Re: / Fwd:, a machine header may
    prefixed = "Re: " + subject
    assert pastdate.auto_reason(mail(prefixed, addr=DAEMON), prefixed) is None
    assert pastdate.auto_reason(mail(prefixed, auto="auto-generated"),
                                prefixed) == pastdate.BOUNCES


@pytest.mark.parametrize("subject", HUMAN_BOUNCE_SUBJECTS)
def test_people_writing_about_delivery_problems_are_no_bounce(subject):
    assert pastdate.auto_reason(mail(subject), subject) is None
    # not even from a sender that looks like a server: behind a prefix it is
    # somebody replying
    if subject.split(":")[0].lower() in ("re", "fwd", "aw", "wg"):
        assert pastdate.auto_reason(mail(subject, addr=DAEMON), subject) is None


@pytest.mark.parametrize("subject", [
    "Mail delivery failed again - can you check the server?",
    "Mail delivery failure on our side, sorry"])
def test_a_phrase_without_its_separator_is_no_bounce_even_from_a_server(
        subject):
    """"Mail delivery failed" is a server's phrase only when it ends there or
    goes on after a colon / dash - a sentence that merely starts with it is
    somebody's."""
    for evidence in (dict(addr=DAEMON), dict(auto="auto-replied"), {}):
        assert pastdate.auto_reason(mail(subject, **evidence), subject) \
            != pastdate.BOUNCES, evidence


@pytest.mark.parametrize("subject", NOT_BOUNCE_SUBJECTS)
def test_other_subjects_are_no_bounce(subject):
    assert pastdate.auto_reason(mail(subject), subject) \
        != pastdate.BOUNCES
    assert pastdate.auto_reason(mail(subject, addr=DAEMON), subject) \
        != pastdate.BOUNCES


def test_a_reply_or_forward_counts_only_with_the_headers_of_a_machine():
    """"Re: Undelivered Mail Returned to Sender" is a person; the same subject
    with a report type or an Auto-Submitted keyword is the machine."""
    for prefix in ("Re: ", "AW: ", "Fwd: ", "WG: ", "Re: Re: ", "SV: "):
        bounce = prefix + "Undelivered Mail Returned to Sender"
        ooo = prefix + "Automatic reply: Lunch"
        assert pastdate.auto_reason(mail(bounce), bounce) is None
        assert pastdate.auto_reason(mail(ooo), ooo) is None
        assert pastdate.auto_reason(mail(bounce, addr=DAEMON), bounce) is None
        assert pastdate.auto_reason(mail(bounce, rpt="delivery-status"),
                                    bounce) == pastdate.BOUNCES
        assert pastdate.auto_reason(mail(bounce, auto="auto-generated"),
                                    bounce) == pastdate.BOUNCES
        assert pastdate.auto_reason(mail(ooo, auto="auto-replied"), ooo) \
            == pastdate.OOO
        # a different keyword is no out-of-office reply
        assert pastdate.auto_reason(mail(ooo, auto="auto-generated"),
                                    ooo) is None


def test_the_people_of_these_subjects_are_never_listed_through_find():
    subjects = (NOT_OOO_SUBJECTS + HUMAN_BOUNCE_SUBJECTS
                + [s for s in LOOSE_BOUNCE_SUBJECTS])
    assert listed([mail(s) for s in subjects]) == {}


# ------------------------------------------------------------ the reasons

def test_each_reason_with_its_evidence():
    mails = [
        mail("Automatic reply: Lunch on Friday"),
        mail("Back on Monday", auto="auto-replied"),
        mail("Undelivered Mail Returned to Sender"),
        mail("Anything at all", rpt="delivery-status"),
        mail("Read: Project plan", rpt="disposition-notification"),
        mail("Accepted: Team dinner", cal="reply"),
    ]
    assert listed(mails) == {
        "Automatic reply: Lunch on Friday": "ooo",
        "Back on Monday": "ooo",
        "Undelivered Mail Returned to Sender": "bounces",
        "Anything at all": "bounces",
        "Read: Project plan": "answers",
        "Accepted: Team dinner": "answers"}


def test_a_subject_alone_never_lists_a_read_receipt_or_a_calendar_answer():
    """The header evidence is what makes one: without it the same subjects
    are somebody's mail."""
    mails = [mail("Read: Project plan"), mail("Accepted: Team dinner"),
             mail("Declined: Team dinner"), mail("Tentative: Team dinner"),
             mail("Accepted: your application"),
             mail("Return Receipt (displayed) - Project plan"),
             mail("Gelesen: Projektplan"), mail("Lesebestätigung: Plan"),
             # the notes exist, but say something else
             mail("Read: Project plan", rpt="delivery-status-ish"),
             mail("Accepted: Team dinner", cal=""),
             mail("Read: Project plan", auto="auto-generated")]
    assert listed(mails) == {}


def test_a_calendar_answer_needs_the_attachments_analysis_note():
    plain = mail("Accepted: Team dinner")
    assert listed([plain]) == {}
    read = dict(plain, cal="reply")
    assert listed([read]) == {"Accepted: Team dinner": "answers"}


def test_out_of_office_by_header_only_on_a_subject_that_says_nothing_else():
    mails = [
        mail("Back on Monday", auto="auto-replied"),
        mail("Re: Question about the offer", auto="auto-replied"),
        # not an out-of-office reply: the keyword is another one, or a
        # machine answering with something of its own
        mail("Back on Monday", auto="auto-generated"),
        mail("Back on Monday", auto="auto-notified"),
        mail("Back on Monday"),
        mail("We have received your request", auto="auto-replied"),
        mail("Your order #12345 has shipped", auto="auto-replied"),
        # a subject another reading of this module claims (no purpose in it,
        # but a shipping update all the same)
        mail("Dispatched", auto="auto-replied"),
        mail("", auto="auto-replied")]
    assert pastdate.classify("Dispatched") == pastdate.SHIPPING
    assert not smartkinds.message_purposes("Dispatched")
    assert listed(mails) == {"Back on Monday": "ooo",
                             "Re: Question about the offer": "ooo"}
    assert len(find(mails)["flagged"]) == 2


def test_a_bounce_is_a_bounce_even_when_it_says_auto_replied():
    """Most mail servers mark a delivery report `Auto-Submitted:
    auto-replied` too."""
    m = mail("Mail delivery failed", auto="auto-replied", rpt="delivery-status")
    assert listed([m]) == {"Mail delivery failed": "bounces"}
    n = mail("Automatic reply: x", rpt="delivery-status")
    assert listed([n]) == {"Automatic reply: x": "bounces"}


def test_a_read_receipt_is_not_an_out_of_office_reply():
    m = mail("Automatic reply: Read: plan", auto="auto-replied",
             rpt="disposition-notification")
    assert listed([m]) == {"Automatic reply: Read: plan": "answers"}


ANSWER_SUBJECTS = [
    "Read: Project plan", "Not read: Project plan", "Gelesen: Projektplan",
    "Nicht gelesen: Projektplan", "Accepted: Team dinner",
    "Declined: Team dinner", "Tentative: Team dinner",
    "Tentatively accepted: Team dinner", "Zugesagt: Teamessen",
    "Abgelehnt: Teamessen", "Angenommen: Teamessen",
    "Mit Vorbehalt: Teamessen", "Mit Vorbehalt zugesagt: Teamessen",
    "Return Receipt (displayed) - Project plan", "Read receipt: plan",
    "Lesebestätigung: Plan", "Empfangsbestätigung: Plan"]


@pytest.mark.parametrize("subject", ANSWER_SUBJECTS)
def test_a_read_receipt_or_calendar_subject_is_no_out_of_office_reply(subject):
    """`Auto-Submitted: auto-replied` on such a subject, without the report or
    the calendar part, must not list it as an out-of-office reply (ticked) and
    so get round "read receipts and calendar answers start unticked"."""
    m = mail(subject, auto="auto-replied")
    assert pastdate.auto_reason(m, subject) is None
    assert listed([m]) == {}
    # with the evidence it is what it is
    assert listed([mail(subject, rpt="disposition-notification")]) \
        == {subject: "answers"}
    assert listed([mail(subject, cal="reply")]) == {subject: "answers"}


def test_the_word_receipt_of_a_read_receipt_is_no_invoice():
    """A receipt's own subject ("Return Receipt (displayed) - ...") says
    "receipt": Keep-safe reads what the mail is about, not that word."""
    plain = mail("Return Receipt (displayed) - Project plan",
                 rpt="disposition-notification")
    assert listed([plain]) == {plain["subject"]: "answers"}
    bill = mail("Return Receipt (displayed) - Invoice 1234",
                rpt="disposition-notification")
    assert listed([bill]) == {}                 # what it is about: an invoice
    again = mail("Read: Invoice 1234", rpt="disposition-notification")
    assert listed([again]) == {}


def test_the_order_of_the_reasons_and_their_default_ticks():
    assert pastdate.REASONS == ("codes", "parcels", "events", "offers",
                                "ooo", "bounces", "answers")
    assert pastdate.AUTO_REASONS == ("ooo", "bounces", "answers")
    # out-of-office replies and delivery failures ticked; read receipts and
    # calendar answers unticked, like offers
    assert pastdate.TICKED == {
        "codes": True, "parcels": True, "events": True, "offers": False,
        "ooo": True, "bounces": True, "answers": False}


# ------------------------------------------------------- never listed

def test_nothing_under_a_week_old_is_listed():
    mails = [mail("Automatic reply: x", days_ago=6.99),
             mail("Back on Monday", days_ago=6.99, auto="auto-replied"),
             mail("Undelivered Mail Returned to Sender", days_ago=6.99),
             mail("Delivery report", days_ago=6.99, rpt="delivery-status"),
             mail("Read: plan", days_ago=6.99, rpt="disposition-notification"),
             mail("Accepted: dinner", days_ago=6.99, cal="reply")]
    assert listed(mails) == {}


def test_a_week_old_is_old_enough():
    assert pastdate.AUTO_AFTER == 7 * DAY
    mails = [mail("Automatic reply: x", days_ago=7),
             mail("Back on Monday", days_ago=7, auto="auto-replied"),
             mail("Undelivered Mail Returned to Sender", days_ago=7),
             mail("Delivery report", days_ago=7, rpt="delivery-status"),
             mail("Read: plan", days_ago=7, rpt="disposition-notification"),
             mail("Accepted: dinner", days_ago=7, cal="reply")]
    assert len(listed(mails)) == 6


KEEP_SAFE_MAILS = [
    # one per Keep-safe class, each with header evidence or an automatic
    # subject: a job application ...
    dict(subject="Automatic reply: Your application for the developer role"),
    dict(subject="Read: Your application for the developer role",
         rpt="disposition-notification"),
    dict(subject="Accepted: your application", cal="reply"),
    dict(subject="Re: Your application", auto="auto-replied"),
    # ... a booking ...
    dict(subject="Automatic reply: Your booking"),
    dict(subject="Delivery Status Notification (Failure) - Your booking",
         rpt="delivery-status"),
    # ... an invoice or bill ...
    dict(subject="Undeliverable: Invoice 1234"),
    dict(subject="Read: Invoice 1234", rpt="disposition-notification"),
    # ... a contract or policy notice
    dict(subject="Automatic reply: Policy update"),
    dict(subject="Accepted: Policy update", cal="reply")]


@pytest.mark.parametrize("fields", KEEP_SAFE_MAILS,
                         ids=[f["subject"] for f in KEEP_SAFE_MAILS])
def test_mail_in_a_keep_safe_class_is_never_listed(fields):
    fields = dict(fields)
    m = mail(fields.pop("subject"), days_ago=30, **fields)
    assert listed([m]) == {}
    # the same evidence on a subject of no class IS listed: the class is
    # what keeps it out
    plain = dict(m, subject="Lunch on Friday")
    plain["uid"] = next(_uids)
    if not (m.get("rpt") or m.get("cal") or m.get("auto")):
        plain["subject"] = "Automatic reply: Lunch on Friday"
    assert len(listed([plain])) == 1


def test_a_keep_safe_class_that_is_switched_off_still_keeps_the_mail():
    """The classes are Keep-safe's, switched on or not: nothing here reads
    the tenant's switches, so a job application is kept whatever they say."""
    from backend import keepsafe
    m = mail("Automatic reply: Your application for the developer role")
    assert keepsafe.DEFAULT_ON["jobs"] and "jobs" in keepsafe.CLASSES
    assert listed([m]) == {}


def test_pinned_mail_and_protected_senders_are_never_listed():
    mails = [mail("Automatic reply: x", addr="a@team.example"),
             mail("Back on Monday", addr="b@team.example", auto="auto-replied"),
             mail("Undelivered Mail Returned to Sender", addr="c@team.example"),
             mail("Delivery report", addr="d@team.example",
                  rpt="delivery-status"),
             mail("Read: plan", addr="e@team.example",
                  rpt="disposition-notification"),
             mail("Accepted: dinner", addr="f@team.example", cal="reply")]
    assert len(listed(mails)) == 6
    for m in mails:
        got = listed(mails, pins={m["msgid"]})
        assert m["subject"] not in got and len(got) == 5
    assert listed(mails, pins={m["msgid"] for m in mails}) == {}
    assert listed(mails, protected=["@team.example"]) == {}
    assert len(listed(mails, protected=["a@team.example"])) == 5
    assert len(listed(mails, protected=["@other.example"])) == 6


def test_a_mail_the_four_old_reasons_list_stays_theirs():
    """Additive: an automatic-looking mail an old reason lists keeps its old
    reason (and the sheet's four rows count what they counted)."""
    offer = mail("Automatic reply: Deal ends at midnight", days_ago=10,
                 auto="auto-replied")
    assert pastdate.classify(offer["subject"]) == pastdate.OFFER
    assert pastdate.OOO_CLIENT_RE.match(offer["subject"])
    assert listed([offer]) == {offer["subject"]: "offers"}
    # a sign-in code is in Keep-safe's account class: the old reason lists
    # it, the automatic-mail pass leaves it alone, so it stays "codes"
    code = mail("Automatic reply: Your sign-in code", days_ago=10,
                auto="auto-replied")
    assert pastdate.classify(code["subject"]) == pastdate.CODE
    assert listed([code]) == {code["subject"]: "codes"}


def test_the_receipts_that_are_kept_are_never_also_listed():
    ship = mail("Your order #12345 has shipped", 10, addr="orders@shop.example")
    done = mail("Your order #12345 was delivered", 5, addr="orders@shop.example")
    conf = mail("Order confirmation #12345", 12, addr="orders@shop.example")
    assert find([ship, done, conf])["kept"] == {(conf["folder"], conf["uid"])}
    # the same confirmation that a read receipt answers: listed, not kept
    echo = dict(conf, rpt="disposition-notification")
    res = find([ship, done, echo])
    assert (echo["folder"], echo["uid"]) in res["flagged"]
    assert res["kept"] == set()


# ------------------------------------------------------------ the account

def acc_of(mails, name="acct", rev=1):
    return SimpleNamespace(
        name=name, lock=threading.RLock(),
        index={i: m for i, m in enumerate(mails)},
        state={"groups_rev": rev})


def _six():
    return [mail("Automatic reply: Lunch", size=100),
            mail("Back on Monday", size=100, auto="auto-replied"),
            mail("Undelivered Mail Returned to Sender", size=200),
            mail("Delivery report", size=300, rpt="delivery-status"),
            mail("Read: plan", size=400, rpt="disposition-notification"),
            mail("Accepted: dinner", size=500, cal="reply")]


def test_the_summary_counts_the_three_new_reasons_after_the_four():
    acc = acc_of(_six())
    s = pastdate.summary(acc, NOW)
    assert [r["id"] for r in s["reasons"]] == list(pastdate.REASONS)
    by = {r["id"]: r for r in s["reasons"]}
    assert [by[i]["mails"] for i in pastdate.REASONS] == [0, 0, 0, 0, 2, 2, 2]
    assert [by[i]["size"] for i in ("ooo", "bounces", "answers")] == [
        200, 500, 900]
    assert {i: by[i]["ticked"] for i in pastdate.REASONS} == pastdate.TICKED
    assert s["mails"] == 6 and s["size"] == 1600 and s["kept"] == 0


def test_the_four_old_reasons_count_what_they_counted():
    old = [mail("Your sign-in code", 3), mail("Deal ends at midnight", 8,
                                              addr="deals@shop.example")]
    only_old = pastdate.summary(acc_of(old), NOW)
    both = pastdate.summary(acc_of(old + _six()), NOW)
    assert [r["mails"] for r in both["reasons"][:4]] \
        == [r["mails"] for r in only_old["reasons"][:4]]
    assert both["mails"] == only_old["mails"] + 6


def test_items_by_the_new_reasons():
    mails = _six()
    acc = acc_of(mails)
    h = lambda m: [m["folder"], m["uid"]]
    assert pastdate.items(acc, ["answers"], NOW) == sorted(
        [h(mails[4]), h(mails[5])])
    assert len(pastdate.items(acc, ["ooo", "bounces"], NOW)) == 4
    assert len(pastdate.items(acc, None, NOW)) == 6


def test_is_auto_is_a_subset_of_is_expired():
    mails = _six() + [mail("Your sign-in code", 3)]
    acc = acc_of(mails)
    auto = pastdate.auto_handles(acc, NOW)
    every = pastdate.expired_handles(acc, NOW)
    assert len(auto) == 6 and len(every) == 7 and auto < every


def test_an_account_with_no_notes_lists_no_header_evidence():
    """A record the scan has not read the headers of (an older snapshot)
    lists no receipt, no calendar answer, no bounce by report - until it is
    back-filled."""
    bare = [{k: v for k, v in m.items() if k not in ("auto", "rpt", "cal")}
            for m in _six()]
    got = pastdate.summary(acc_of(bare), NOW)
    assert {r["id"]: r["mails"] for r in got["reasons"]
            if r["id"] in pastdate.AUTO_REASONS} == {
        "ooo": 1, "bounces": 1, "answers": 0}      # by subject only


# --------------------------------------------- the real scan and the API

def _stamp(days_ago):
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(time.time() - days_ago * DAY))


CAL_REPLY_BS = (
    '(("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 100 5)'
    '("text" "calendar" ("method" "REPLY" "charset" "utf-8") NIL NIL "7bit" '
    '300 10) "mixed" ("boundary" "b") NIL NIL)')
CAL_REQUEST_BS = CAL_REPLY_BS.replace('"REPLY"', '"REQUEST"')
CAL_NO_METHOD_BS = CAL_REPLY_BS.replace('("method" "REPLY" ', '(')

# uid -> what it is, for the box below
AUTO_BOX = {
    40: ("Automatic reply: Lunch on Friday", 10, {}),
    41: ("Back on Monday", 9, {"auto_submitted": "auto-replied"}),
    42: ("Delivery Status Notification (Failure)", 12,
         {"report": "delivery-status"}),
    43: ("Read: Project plan", 8, {"report": "disposition-notification"}),
    44: ("Accepted: Team dinner", 8, {"bs": CAL_REPLY_BS}),
    # not listed: the subject says it, the headers do not
    45: ("Read: Project plan", 8, {}),
    46: ("Accepted: Team dinner", 8, {}),
    47: ("Declined: Team dinner", 8, {"bs": CAL_REQUEST_BS}),
    48: ("Accepted: Team dinner", 8, {"bs": CAL_NO_METHOD_BS}),
    # not listed: too young, a job application, plain mail
    49: ("Automatic reply: Lunch on Monday", 3, {}),
    50: ("Automatic reply: Your application for the developer role", 10, {}),
    51: ("Dinner on Friday?", 10, {}),
}


@pytest.fixture
def autobox(bridge):
    """The bridge mailbox plus automatic mail of every kind, scanned."""
    for uid, (subject, days, extra) in AUTO_BOX.items():
        bridge.mailbox["INBOX"].append(make_msg(
            uid, frm="Team <someone@team.example>", subject=subject,
            date=_stamp(days), size=1000 + uid) | extra)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def _reasons():
    d = client.get("/api/expired").json()
    return {r["id"]: r["mails"] for r in d["reasons"]}


def _analyse():
    acc = accountsmod.get()
    mailops._run_atts(acc)
    assert acc.state["atts"]["status"] == "done"


def _rec(uid):
    acc = accountsmod.get()
    return next(m for m in acc.index.values() if m["uid"] == uid)


def test_the_scan_keeps_the_header_notes(autobox):
    assert _rec(40)["auto"] == "" and "rpt" not in _rec(40)
    assert _rec(41)["auto"] == "auto-replied"
    assert _rec(42)["rpt"] == "delivery-status"
    assert _rec(43)["rpt"] == "disposition-notification"
    assert all("auto" in m for m in accountsmod.get().index.values())


def test_the_summary_endpoint_lists_the_new_reasons(autobox):
    # the calendar answer waits for the Attachments analysis
    r = _reasons()
    assert (r["ooo"], r["bounces"], r["answers"]) == (2, 1, 1)
    _analyse()
    r = _reasons()
    assert (r["ooo"], r["bounces"], r["answers"]) == (2, 1, 2)
    d = client.get("/api/expired").json()
    assert [x["id"] for x in d["reasons"]][-3:] == ["ooo", "bounces", "answers"]
    assert {x["id"]: x["ticked"] for x in d["reasons"]} == pastdate.TICKED
    # counts only: no subject, no sender
    assert "Automatic reply" not in json.dumps(d)
    assert "team.example" not in json.dumps(d)


def test_a_subject_without_the_header_evidence_is_not_listed(autobox):
    _analyse()
    res = client.get("/api/mails", params={"q": "is:auto"}).json()
    assert res["total"] == 5 and res["ignored"] == []
    assert sorted(m["uid"] for m in res["mails"]) == [40, 41, 42, 43, 44]
    # 45 / 46 (subject only), 47 (an invitation, not an answer), 48 (a
    # calendar part that does not say REPLY), 49 (too young), 50 (a job
    # application), 51 (plain mail): none of them
    assert {45, 46, 47, 48, 49, 50, 51}.isdisjoint(
        m["uid"] for m in res["mails"])


def test_is_auto_narrows_with_the_other_words_and_is_inside_is_expired(autobox):
    _analyse()
    every = client.get("/api/mails", params={"q": "is:expired"}).json()
    auto = client.get("/api/mails", params={"q": "is:auto"}).json()
    assert {m["uid"] for m in auto["mails"]} <= {m["uid"]
                                                 for m in every["mails"]}
    one = client.get("/api/mails", params={"q": "is:auto read"}).json()
    assert [m["subject"] for m in one["mails"]] == ["Read: Project plan"]
    both = client.get("/api/mails", params={"q": "is:expired is:auto"}).json()
    assert both["total"] == auto["total"]
    # the word is on, so the list is narrower than All mail
    assert client.get("/api/mails").json()["total"] > auto["total"]


def test_the_mail_word_is_not_a_group_or_rule_word():
    f = mailops.parse_mail_query("is:auto is:unread bogus")
    assert f["auto"] is True and f["expired"] is False and f["read"] is False
    assert f["text"] == ["bogus"] and f["ignored"] == []
    assert mailops.parse_mail_query("")["auto"] is False
    from backend import rules as rulesmod
    assert rulesmod.parse_filter("is:auto")["text"] == ["is:auto"]
    r = client.post("/api/rules", json={
        "name": "x", "query": "is:auto", "action": "trash"})
    assert r.status_code == 400, r.text


def test_an_assistant_without_subject_access_cannot_ask_for_is_auto(autobox):
    acc = accountsmod.get()
    blind = mcptools.Ctx(accounts=[acc.name], subjects=False)
    with pytest.raises(mcptools.ToolError, match="subject"):
        mcptools._list_mails(blind, mcptools.ListMailsIn(query="is:auto"))
    seeing = mcptools.Ctx(accounts=[acc.name], subjects=True)
    got = mcptools._list_mails(seeing, mcptools.ListMailsIn(query="is:auto"))
    assert got["total"] == client.get(
        "/api/mails", params={"q": "is:auto"}).json()["total"]


def test_the_items_endpoint_and_the_trash_step_with_undo(autobox):
    _analyse()
    items = client.get("/api/expired/mails",
                       params={"reasons": "ooo,bounces"}).json()["items"]
    assert len(items) == 3
    r = client.post("/api/delete_messages",
                    json={"items": items, "action": "trash"})
    assert r.status_code == 200, r.text
    wait_delete_done()
    now = _reasons()
    assert (now["ooo"], now["bounces"], now["answers"]) == (0, 0, 2)
    assert accountsmod.get().undo_log
    assert client.post("/api/undo", json={}).status_code == 200
    wait_delete_done()
    now = _reasons()
    assert (now["ooo"], now["bounces"], now["answers"]) == (2, 1, 2)


def test_the_trash_step_refuses_what_the_list_left_out(autobox):
    _analyse()
    items = client.get("/api/expired/mails").json()["items"]
    folder, uid = items[0]
    client.post("/api/pin", json={"folder": folder, "uid": uid, "pinned": True})
    assert client.post("/api/delete_messages",
                       json={"items": items, "action": "trash"}
                       ).status_code == 400
    fresh = client.get("/api/expired/mails").json()["items"]
    assert [folder, uid] not in fresh
    assert client.post("/api/delete_messages",
                       json={"items": fresh, "action": "trash"}
                       ).status_code == 200
    wait_delete_done()


def test_pinned_mail_and_protected_senders_leave_the_account_list(autobox):
    _analyse()
    r = client.get("/api/mails", params={"q": "is:auto"}).json()
    one = next(m for m in r["mails"] if m["uid"] == 43)
    client.post("/api/pin", json={"folder": one["folder"], "uid": 43,
                                  "pinned": True})
    assert _reasons()["answers"] == 1
    client.post("/api/protect", json={"entries": ["someone@team.example"],
                                      "on": True})
    assert all(n == 0 for k, n in _reasons().items() if k in
               pastdate.AUTO_REASONS)


def test_the_answers_are_per_tenant(autobox):
    _analyse()
    assert _reasons()["ooo"] == 2
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        s = pastdate.summary(accountsmod.get())
        assert s["mails"] == 0
        assert pastdate.auto_handles(accountsmod.get()) == frozenset()
    assert _reasons()["ooo"] == 2


# -------------------------------------------- what the scan reads, and when

def _spy(fake):
    specs: list[str] = []
    real = fake.uid
    fake.uid = lambda cmd, *a: (specs.append(a[-1]) if cmd == "FETCH"
                                else None, real(cmd, *a))[1]
    return specs


def _header_fetches(specs):
    """The back-fill requests: flags plus header fields, no full fetch (the
    Sent folder's own `TO CC` pass is a different request)."""
    return [s for s in specs if s.startswith("(UID FLAGS")
            and "HEADER.FIELDS" in s and "RFC822.SIZE" not in s]


def _flag_requests(specs):
    return [s for s in specs if s.startswith("(UID FLAGS")]


def _forget(*keys):
    for m in accountsmod.get().index.values():
        for k in keys:
            m.pop(k, None)


def test_older_mail_gets_the_headers_on_the_next_scan(autobox):
    """A record from before the scan read these headers is back-filled in
    the flags request of the next scan - once."""
    _forget("auto", "rpt")
    specs = _spy(autobox)
    mailops.run_scan()
    fetches = _header_fetches(specs)
    assert fetches and all("HEADER.FIELDS (AUTO-SUBMITTED CONTENT-TYPE)" in f
                           for f in fetches)
    assert all("TO CC" not in f for f in fetches)   # `to` was not missing
    assert _rec(41)["auto"] == "auto-replied"
    assert _rec(42)["rpt"] == "delivery-status"
    assert _rec(43)["rpt"] == "disposition-notification"
    assert _rec(40)["auto"] == "" and "rpt" not in _rec(40)
    # ... and the list is whole again
    assert _reasons()["bounces"] == 1 and _reasons()["answers"] == 1
    # every record has the note now: only flags are asked for
    specs.clear()
    mailops.run_scan()
    assert set(_flag_requests(specs)) == {"(UID FLAGS)"}


def test_a_backfill_keeps_the_address_and_the_flags(autobox):
    before = {m["uid"]: (m["to"], m["seen"])
              for m in accountsmod.get().index.values()}
    _forget("auto", "rpt")
    autobox.mailbox["INBOX"][0]["seen"] = True
    mailops.run_scan()
    after = {m["uid"]: (m["to"], m["seen"])
             for m in accountsmod.get().index.values()}
    assert after.pop(1) == (before[1][0], True)
    before.pop(1)
    assert after == before


def test_a_record_that_misses_both_asks_for_both(autobox):
    _forget("auto", "rpt", "to")
    specs = _spy(autobox)
    mailops.run_scan()
    fetches = _header_fetches(specs)       # one per folder that has mail
    assert len(fetches) == 2 and all(
        "HEADER.FIELDS (TO CC DELIVERED-TO X-ORIGINAL-TO AUTO-SUBMITTED "
        "CONTENT-TYPE)" in f for f in fetches)
    assert all("to" in m and "auto" in m
               for m in accountsmod.get().index.values())


def test_a_record_that_misses_the_address_keeps_its_automatic_notes(autobox):
    _forget("to")
    specs = _spy(autobox)
    mailops.run_scan()
    fetches = _header_fetches(specs)
    assert len(fetches) == 2 and all(
        "HEADER.FIELDS (TO CC DELIVERED-TO X-ORIGINAL-TO)" in f
        for f in fetches)
    assert _rec(41)["auto"] == "auto-replied"
    assert _rec(42)["rpt"] == "delivery-status"
    assert all("to" in m for m in accountsmod.get().index.values())


def test_a_mail_the_server_does_not_answer_for_is_not_asked_again(autobox):
    _forget("auto", "rpt")
    real = autobox.uid

    def deaf(cmd, *a):
        if cmd == "FETCH" and "HEADER.FIELDS" in a[-1]:
            return "OK", []
        return real(cmd, *a)
    autobox.uid = deaf
    mailops.run_scan()
    assert all(m["auto"] == "" for m in accountsmod.get().index.values())
    autobox.uid = real
    specs = _spy(autobox)
    mailops.run_scan()
    assert set(_flag_requests(specs)) == {"(UID FLAGS)"}


def test_a_failed_header_request_is_tried_again_next_scan(autobox):
    _forget("auto", "rpt")
    real = autobox.uid

    def refuse(cmd, *a):
        if cmd == "FETCH" and "HEADER.FIELDS" in a[-1]:
            return "NO", [b"try later"]
        return real(cmd, *a)
    autobox.uid = refuse
    mailops.run_scan()
    assert not any("auto" in m for m in accountsmod.get().index.values())
    autobox.uid = real
    mailops.run_scan()
    assert _rec(41)["auto"] == "auto-replied"


def test_role_scans_do_not_back_fill(autobox):
    """Junk and Trash views are not read for automatic mail."""
    acc = accountsmod.get()
    conn = mailops.connect({})
    cached = {mailops.ikey("INBOX", 41): {
        k: v for k, v in _rec(41).items() if k != "auto"}}
    specs = _spy(autobox)
    out: list = []
    mailops.scan_folder(conn, "INBOX", out, lambda *a: None, acc,
                        index=cached, uv=dict(acc.folder_uv))
    assert not _header_fetches(specs)
    assert all("auto" not in m for m in out if m["uid"] == 41)


def test_a_new_mail_carries_the_notes_from_its_full_fetch(autobox):
    autobox.mailbox["INBOX"].append(make_msg(
        60, frm="Team <someone@team.example>", subject="Back soon",
        date=_stamp(1)) | {"auto_submitted": "auto-replied"})
    specs = _spy(autobox)
    mailops.run_scan()
    full = [s for s in specs if s.startswith("(UID FLAGS RFC822.SIZE")]
    assert len(full) == 1 and "AUTO-SUBMITTED CONTENT-TYPE" in full[0]
    assert _rec(60)["auto"] == "auto-replied"


# ---------------------------------------- the Attachments analysis' note

def test_the_analysis_marks_a_calendar_answer_and_nothing_else(autobox):
    assert "cal" not in _rec(44)
    _analyse()
    assert _rec(44)["cal"] == "reply"
    assert not any("cal" in m for m in accountsmod.get().index.values()
                   if m["uid"] != 44)
    # a calendar answer carries no file: it does not join the attachment page
    assert "att_size" not in _rec(44)
    assert all(a["uid"] != 44 for a in client.get("/api/attachments").json())
    # a rescan keeps the note
    mailops.run_scan()
    assert _rec(44)["cal"] == "reply"


def test_the_analysis_marks_a_mail_with_a_file_and_a_calendar_answer(bridge):
    bridge.mailbox["INBOX"].append(make_msg(
        70, frm="Team <someone@team.example>", subject="Accepted: Offsite",
        date=_stamp(9)) | {"bs": (
            '(("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 100 5)'
            '("text" "calendar" ("method" "reply") NIL NIL "7bit" 300 10)'
            '("application" "pdf" ("name" "map.pdf") NIL NIL "base64" 5000 '
            'NIL ("attachment" ("filename" "map.pdf")) NIL) "mixed" '
            '("boundary" "b") NIL NIL)')})
    mailops.run_scan()
    _analyse()
    rec = _rec(70)
    assert rec["cal"] == "reply" and rec["atts"] == [
        {"name": "map.pdf", "size": 5000}]


@pytest.mark.parametrize("bs,expected", [
    (CAL_REPLY_BS, True),
    (CAL_REQUEST_BS, False),
    (CAL_NO_METHOD_BS, False),
    # the method is a parameter of the part, any case
    ('(("text" "calendar" ("method" "reply") NIL NIL "7bit" 9 1))', True),
    ('(("application" "ics" ("name" "a.ics" "method" "REPLY") NIL NIL '
     '"base64" 9))', True),
    # nested multiparts
    ('((("text" "plain" NIL NIL NIL "7bit" 1 1)("text" "calendar" '
     '("method" "REPLY") NIL NIL "7bit" 9 1) "alternative" NIL NIL)'
     '("application" "pdf" ("name" "x.pdf") NIL NIL "base64" 9) "mixed" '
     'NIL NIL)', True),
    # a forwarded message is not walked into
    ('(("text" "plain" NIL NIL NIL "7bit" 1 1)("message" "rfc822" NIL NIL '
     'NIL "7bit" 900 ("Mon" "s" NIL NIL NIL NIL NIL NIL NIL NIL) '
     '(("text" "calendar" ("method" "REPLY") NIL NIL "7bit" 9 1) "mixed" '
     'NIL NIL) 20) "mixed" NIL NIL)', False),
    # another kind of text part says nothing
    ('(("text" "plain" ("method" "REPLY") NIL NIL "7bit" 9 1))', False),
    ('(("text" "plain" NIL NIL NIL "7bit" 100 5))', False)])
def test_calendar_reply_parts_in_a_bodystructure(bs, expected):
    parsed = mailops._bs_parse(mailops._bs_tokenize(bs.encode()))
    assert mailops._bs_calendar_reply(parsed[0]) is expected


def test_garbage_is_no_calendar_answer():
    for node in (None, [], "x", [None], [["x"]], ["text"], ["text", "calendar"]):
        assert mailops._bs_calendar_reply(node) is False


# ------------------------------------- the snapshot, and an older image

def test_the_notes_survive_a_snapshot_and_an_old_snapshot_loads(autobox):
    _analyse()
    acc = accountsmod.get()
    mailops.save_snapshot(acc)
    path = mailops._snap_path(acc.name, acc.tenant)
    data = json.loads(path.read_text())
    assert data["version"] == 3             # the format did not change
    by_uid = {m["uid"]: m for m in data["index"]}
    assert by_uid[42]["rpt"] == "delivery-status"
    assert by_uid[41]["auto"] == "auto-replied" and by_uid[44]["cal"] == "reply"
    # what an older image wrote (and keeps writing): none of the three
    for m in data["index"]:
        for k in ("auto", "rpt", "cal"):
            m.pop(k, None)
    path.write_text(json.dumps(data))
    accountsmod.reset()
    fresh = accountsmod.get()
    assert mailops.load_snapshot(fresh)
    s = pastdate.summary(fresh)
    # by subject: still found; by header: not until the scan back-fills
    assert {r["id"]: r["mails"] for r in s["reasons"]
            if r["id"] in pastdate.AUTO_REASONS} == {
        "ooo": 1, "bounces": 1, "answers": 0}
    mailops.run_scan()
    now = {r["id"]: r["mails"] for r in
           pastdate.summary(accountsmod.get())["reasons"]}
    assert (now["ooo"], now["bounces"], now["answers"]) == (2, 1, 1)


def test_an_older_image_reads_a_newer_snapshot_as_it_did(autobox):
    """The new keys are plain extras on index records: the older code only
    ever reads the keys it knows (`kind`, `to`, `removed` ... are the same
    kind of extra), so nothing of it breaks and nothing is lost."""
    _analyse()
    for m in accountsmod.get().index.values():
        assert set(m) >= {"uid", "folder", "addr", "subject", "size", "ts",
                          "seen", "msgid", "date"}
        assert isinstance(m["auto"], str)
        assert m.get("rpt", "delivery-status") in ("delivery-status",
                                                   "disposition-notification")
        assert m.get("cal", "reply") == "reply"
