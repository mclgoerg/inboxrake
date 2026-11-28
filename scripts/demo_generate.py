"""The demo's generated data: two fake mailboxes plus everything that
belongs to them (verdicts, unsubscribe records, rules, statistics, audit log,
sender knowledge), scanned once so the UI is instant.

Imported by `demo.py` (never run on its own) after it has pointed the
backend's paths at the demo data dir; `generate()` fills that dir and returns
the FakeIMAP servers by host. `NOW` is the instant the mail dates derive from
(`DEMO_NOW`, else the wall clock at import)."""

from __future__ import annotations

import calendar
import datetime
import hashlib
import json
import os
import random
import re
import time
import zlib
from pathlib import Path

from conftest import FakeIMAP, make_msg
from backend import (accounts, aliasservice, bodyindex, copystore, demo,
                     knownsenders, knowledgestore, mailops, pinstore, rules,
                     unsubstore, verdictstore, waitstore)
from backend import config as cfgmod

if "CONFIG_PATH" not in os.environ:
    raise RuntimeError("demo_generate is imported by demo.py, which isolates "
                       "the data dir first")

random.seed(7)
NOW = float(os.environ.get("DEMO_NOW") or time.time())


def _date(days_ago: float) -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(NOW - days_ago * 86400))


_UID = iter(range(1, 100000))


def newsletter_html(pixel: str | None = None, click: str | None = None):
    """HTML bodies for the tracker report: a normal banner and link plus,
    optionally, an open-tracking pixel and/or a click-tracking redirect link
    on the given (invented) hosts. No random draws, so the data of the
    other senders stays exactly as it was."""
    def build(i: int) -> str:
        tok = f"d{i:04d}x7k2m9q4w8e6r1t5y"
        parts = ["<p>Hi there - here are this week's highlights.</p>",
                 '<img src="https://cdn.demo.example/banner.jpg" '
                 'width="600" height="300" alt="">',
                 '<a href="https://shop.demo.example/offers">See offers</a>']
        if click:
            parts.append(f'<a href="https://{click}/click/{tok}">Read on</a>')
        if pixel:
            parts.append(f'<img src="https://{pixel}/open/{tok}.gif" '
                         'width="1" height="1" alt="">')
        return "\n".join(parts)
    return build


PIXEL_HOST = "px.beacons-demo.example"
CLICK_HOST = "r.linkhop-demo.example"


ME = "Demo <demo@example.com>"
FREEMAIL = ("@gmail.com", "@gmx.de", "@web.de", "@outlook.com")
_DE = re.compile(r"\b(Ihr|Ihre|Ihren|Ihrem|ist|wurde|am|für|der|die|das|und|"
                 r"Termin\w*|Foto\w*|Hallo|bald|Geschenk|Neu\w*|Angebot|"
                 r"Frage|Wanderung|Sendung|Zustellung|Paket|Rechnung|Befund|"
                 r"Kletterhalle|Wochenend\w*|Urlaub\w*|Sonntag|Geburtstag|"
                 r"Nebenkosten\w*|Mietvertrag|Steuer\w*|Programm|Vorpremiere)"
                 r"\b")


def _kind(m: dict) -> str:
    """What sort of sender a mail came from, to pick a body for it."""
    addr = m["from"].rsplit("<", 1)[-1].rstrip(">").lower()
    subj = m["subject"].lower()
    if addr.startswith("demo@"):
        return "me"
    if "praxis" in addr:
        return "practice"
    if (addr.endswith(FREEMAIL) or "anna.weber@" in addr
            or addr.split("@")[1].startswith(("familienpost", "kletterhalle",
                                              "mietverein"))):
        return "person"
    if any(w in subj for w in ("sendung", "paket", "shipped", "delivery",
                               "zustellung", "unterwegs", "bestellung")):
        return "parcel"
    if m["unsub"]:
        return "newsletter"
    return "club" if "club" in addr else "service"


_BODY = {
    "person": ("Hallo!\n\n{subj} - melde dich einfach, wenn es dir "
               "passt. Ich freue mich!\n\nLG {sig}",
               "Hi!\n\n{subj} - let me know what works for you.\n\n"
               "Cheers,\n{sig}"),
    "practice": ("Guten Tag,\n\n{subj}. Bitte bringen Sie Ihre "
                 "Versichertenkarte mit.\n\nFreundliche Grüße\n{sig}",
                 "Hello,\n\n{subj}. Please bring your insurance card.\n\n"
                 "Kind regards,\n{sig}"),
    "club": ("Hallo zusammen,\n\n{subj}. Wir treffen uns wie immer am "
             "Donnerstagabend - bringt eure Kameras mit!\n\nBis dann,\n{sig}",
             "Hi everyone,\n\n{subj}. We meet as usual on Thursday evening - "
             "bring your cameras!\n\nSee you there,\n{sig}"),
    "parcel": ("Hallo,\n\n{subj}. Den aktuellen Status sehen Sie jederzeit "
               "in der Sendungsverfolgung.\n\n{sig}",
               "Hello,\n\n{subj}. You can follow the delivery any time in "
               "your account.\n\n{sig}"),
    "service": ("Guten Tag,\n\n{subj}. Die Details finden Sie in Ihrem "
                "Konto.\n\nDies ist eine automatische Nachricht.\n{sig}",
                "Hello,\n\n{subj}. The details are in your account.\n\n"
                "This is an automated message.\n{sig}"),
    "newsletter": ("Hallo,\n\n{subj}\n\nDas gibt es diese Woche Neues. "
                   "Kein Interesse mehr? Abmelden geht ganz unten.\n\n{sig}",
                   "Hi,\n\n{subj}\n\nHere is what is new this week. Not "
                   "interested any more? Unsubscribe at the bottom.\n\n{sig}"),
}

# Conversation turns by position in the chain (opener / answer of the demo
# user / follow-up of the other side / the closing mail), per register
# (informal "du", formal "Sie") and language: a few variants each, picked per
# conversation. {first} is the other side's first name, {sig} its signature.
_TURN = {
    ("informal", True): {
        "open": ["Hallo!\n\n{subj} - hast du kurz Zeit? Ich freue mich auf "
                 "deine Antwort.\n\nLG {sig}",
                 "Hi!\n\nwegen {subj}: melde dich, wenn es dir passt.\n\n"
                 "Liebe Grüße\n{sig}",
                 "Hallo,\n\n{subj} wollte ich noch mit dir besprechen. "
                 "Wann hast du Zeit?\n\nBis bald, {sig}"],
        "answer": ["Hallo {first},\n\ndanke dir, das passt gut. Ich melde "
                   "mich gleich noch einmal.\n\nViele Grüße",
                   "Hi {first},\n\nklingt gut, ich bin dabei!\n\nBis später",
                   "Hallo {first},\n\nsuper, danke für die Nachricht. Gib "
                   "mir bis morgen Zeit.\n\nLG"],
        "follow": ["Prima, dann machen wir das so!\n\nLG {sig}",
                   "Alles klar, ich freue mich.\n\nBis dann, {sig}",
                   "Perfekt, danke dir. Bis bald!\n\n{sig}"],
        "close": ["Super, dann ist alles geklärt. Danke dir!\n\nLG {sig}",
                  "Wunderbar, bis bald!\n\n{sig}"],
        "close_me": ["Danke dir, bis bald!\n\nLG", "Super, dann sehen wir "
                     "uns. Danke!\n\nViele Grüße"]},
    ("informal", False): {
        "open": ["Hi!\n\n{subj} - do you have a minute? Looking forward to "
                 "hearing from you.\n\nCheers,\n{sig}",
                 "Hello,\n\nabout {subj}: let me know what works for "
                 "you.\n\nBest,\n{sig}"],
        "answer": ["Hi {first},\n\nthanks, that works for me. I'll get back "
                   "to you shortly.\n\nBest",
                   "Hi {first},\n\nsounds good, count me in!\n\nSpeak "
                   "soon",
                   "Hi {first},\n\nthanks - I'll have a look and get back "
                   "to you.\n\nBest"],
        "follow": ["Great, let's do it that way!\n\nCheers,\n{sig}",
                   "Perfect, thanks. Talk soon!\n\n{sig}",
                   "Sounds great, thanks!\n\n{sig}"],
        "close": ["Great, all settled. Thanks!\n\n{sig}"],
        "close_me": ["Thanks, see you soon!\n\nBest"]},
    ("formal", True): {
        "open": ["Guten Tag,\n\nzu {subj}: Bitte melden Sie sich bei "
                 "Rückfragen gern bei uns.\n\nFreundliche Grüße\n{sig}",
                 "Guten Tag,\n\nwir bestätigen {subj}. Bei Fragen erreichen "
                 "Sie uns telefonisch.\n\nMit freundlichen Grüßen\n{sig}"],
        "answer": ["Guten Tag,\n\nvielen Dank, das passt für mich.\n\n"
                   "Freundliche Grüße",
                   "Guten Tag,\n\nvielen Dank für die Information. Eine "
                   "Rückfrage: Wäre auch ein späterer Zeitpunkt möglich?\n\n"
                   "Mit freundlichen Grüßen",
                   "Guten Tag,\n\nbesten Dank, ich werde pünktlich da "
                   "sein.\n\nFreundliche Grüße"],
        "follow": ["Guten Tag,\n\ngerne, das ist möglich. Wir notieren "
                   "es.\n\nFreundliche Grüße\n{sig}",
                   "Guten Tag,\n\nvielen Dank für Ihre Rückmeldung.\n\n"
                   "Mit freundlichen Grüßen\n{sig}",
                   "Guten Tag,\n\nsehr gern. Wir freuen uns auf Sie.\n\n"
                   "Mit freundlichen Grüßen\n{sig}"],
        "close": ["Vielen Dank, damit ist alles geklärt.\n\nFreundliche "
                  "Grüße\n{sig}"],
        "close_me": ["Vielen Dank, dann ist alles klar.\n\nFreundliche "
                     "Grüße"]},
    ("formal", False): {
        "open": ["Hello,\n\nthank you for getting in touch about {subj}. "
                 "We will look into it.\n\nKind regards,\n{sig}",
                 "Hello,\n\nregarding {subj}: please let us know if you "
                 "have any questions.\n\nKind regards,\n{sig}"],
        "answer": ["Hello,\n\nthank you, that works for me.\n\nKind "
                   "regards",
                   "Hello,\n\nthank you for the update. One question: could "
                   "we do this a little later?\n\nKind regards",
                   "Hello,\n\nmany thanks, I will be there on time.\n\n"
                   "Kind regards"],
        "follow": ["Hello,\n\nof course, we have made a note of it.\n\n"
                   "Kind regards,\n{sig}",
                   "Hello,\n\nthank you for your reply.\n\nKind regards,"
                   "\n{sig}",
                   "Hello,\n\nwith pleasure. We look forward to seeing "
                   "you.\n\nKind regards,\n{sig}"],
        "close": ["Thank you, that settles it.\n\nKind regards,\n{sig}"],
        "close_me": ["Thank you, all clear.\n\nKind regards"]},
}

_NOT_A_NAME = {"Family", "Photo", "Dr.", "Prof.", "Praxis", "Team", "Support"}


def _who(addr: str) -> str:
    """The display name of an address header, else its local part."""
    name = addr.split("<")[0].strip(' "')
    return name or addr.strip("<>").split("@")[0].split(".")[0].title() or "Demo"


def _first(frm: str) -> str:
    """The first name of a sender: the display name's first word when that
    is a name, else the address local part (`lisa@...` -> Lisa)."""
    word = _who(frm).split()[0]
    if word in _NOT_A_NAME or "<" not in frm:
        local = frm.rsplit("<", 1)[-1].rstrip(">").split("@")[0]
        return local.split(".")[0].title()
    return word


def _sig(m: dict, kind: str) -> str:
    """How the sender signs: a person with their first name, a business or
    practice with its display name."""
    return _first(m["from"]) if kind == "person" else _who(m["from"])


def body_for(m: dict) -> str:
    """A short plain-text body fitting the sender: friendly for people, terse
    for services, a pitch for newsletters; German or English by subject."""
    kind = _kind(m)
    subj = re.sub(r"^(re|fwd): *", "", m["subject"], flags=re.I).rstrip("?!.")
    de = bool(_DE.search(m["subject"]))
    return _BODY[kind][0 if de else 1].format(subj=subj, sig=_sig(m, kind))


STUB = "-"


def _stub(box: list[dict]) -> None:
    """Before the Proton body index is built: personal and practice mails get
    their final body (a few, searchable), every other plain-text mail just
    a one-character stub. Nothing of the test double's stock text may get indexed."""
    for m in box:
        if m["body"] is None and m["html"] is None and _kind(m) != "me":
            m["body"] = body_for(m) if _kind(m) in ("person", "practice") \
                else STUB


def fill_bodies(box: list[dict]) -> list[dict]:
    """After the index is built: the stubs get their real body.
    The index keeps every body it sees (encrypted, so it does not compress)
    and is part of the seed's size budget; the viewer reads the mail from the
    server, not the index."""
    for m in box:
        if m["html"] is None and _kind(m) != "me" \
                and m["body"] in (None, STUB):
            m["body"] = body_for(m)
    return box


def _when(date: str) -> float:
    return datetime.datetime.strptime(date, "%d-%b-%Y %H:%M:%S %z").timestamp()


def thread_chains(msgs: list[dict], sent: list[dict], me: str = ME) -> list[dict]:
    """Turn runs of 3-7 neighbouring mails (newest first, as `mails` makes
    them) into conversations: the sender writes, the demo user answers (the
    answer moves to `sent`), the sender replies again, ... Each reply follows
    the mail before it by a few hours to a day or two, with In-Reply-To /
    References, a `Re:` subject and a text that depends on its place in the
    conversation. Own random stream per sender (reproducible, but not the
    same times everywhere): nothing else in the demo shifts. Returns the mails
    that stay in the folder."""
    if not msgs:
        return msgs
    rng = random.Random(23 + zlib.crc32(msgs[0]["from"].encode()))
    keep: list[dict] = []
    i = 0
    while i < len(msgs):
        run = msgs[i:i + rng.randint(3, 7)]
        i += len(run)
        run.reverse()                       # oldest first, the sender starts
        root, person = run[0], run[0]["from"]
        kind = _kind(root)
        turns = _TURN["informal" if kind == "person" else "formal",
                      bool(_DE.search(root["subject"]))]
        subj = root["subject"].rstrip("?!.")
        sig, first = _sig(root, kind), _first(person)
        pick = rng.randrange(6)
        t = _when(run[-1]["date"])
        stamps = [t]
        for _ in run[:-1]:                  # walk back from the newest
            t -= rng.uniform(3, 40) * 3600
            stamps.append(t)
        stamps.reverse()
        # a conversation happens during the working day (the hours the
        # "When mail arrives" card shows); the order of the turns is kept
        for k, ts in enumerate(stamps):
            snapped = _arrival((NOW - ts) / 86400, "work")
            stamps[k] = max(snapped, stamps[k - 1] + 1800) if k else snapped
        refs: list[str] = []
        for k, m in enumerate(run):
            m["date"] = time.strftime("%d-%b-%Y %H:%M:%S +0000",
                                      time.gmtime(stamps[k]))
            if refs:
                m["irt"], m["refs"] = refs[-1], " ".join(refs)
                m["subject"] = "Re: " + root["subject"].removeprefix("Re: ")
            refs.append(m["msgid"])
            mine = bool(k % 2)              # the user's turn
            last = k == len(run) - 1 and k > 0
            part = ("close_me" if last and mine else "close" if last
                    else "open" if k == 0 else "answer" if mine else "follow")
            options = turns[part]
            m["body"] = options[(pick + k // 2) % len(options)].format(
                subj=subj, first=first, sig=sig)
            if mine:
                m.update(to=person, atts=[], unsub=None, seen=True, size=2500)
                m["from"] = me
                sent.append(m)
            else:
                keep.append(m)
    return keep


def _atts_for(i: int, atts, att_n: int):
    """The attachments of mail `i`: only the `att_n` newest carry them; a
    list of lists is cycled through (a mix of file types)."""
    if not atts or i >= att_n:
        return None
    return atts[i % len(atts)] if isinstance(atts[0], list) else atts


# When mail arrives (Statistics): each kind of sender has its own rhythm, so
# the weekday x hour card shows a believable week. A separate random stream,
# so the shared one - and with it every other demo number - is untouched.
_RHYTHM = random.Random(105)
# profile -> (hour weights {hour: weight}, weekdays allowed (Mon = 0) or None)
_PROFILES: dict[str, tuple[dict[int, int], tuple[int, ...] | None]] = {
    "mixed": ({8: 2, 9: 4, 10: 4, 11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 3,
               17: 3, 18: 3, 19: 3, 20: 2, 21: 2, 22: 1, 2: 1}, None),
    "newsletter": ({4: 2, 5: 8, 6: 5, 7: 3, 8: 2, 11: 2, 17: 2, 19: 2}, None),
    "work": ({9: 3, 10: 4, 11: 4, 12: 2, 13: 2, 14: 4, 15: 4, 16: 3},
             (0, 1, 2, 3)),
    "shop": ({18: 4, 19: 5, 20: 4, 21: 2}, (3, 4)),      # Thursday / Friday
    "daily": ({5: 1}, None),
}


def _arrival(days_ago: float, profile: str) -> float:
    """`days_ago` as an epoch time on that day (or the nearest earlier one the
    profile allows) at an hour the profile likes."""
    if profile == "shop" and _RHYTHM.random() < 0.65:
        profile = "mixed"              # the rest of the shop mail is spread out
    hours, weekdays = _PROFILES[profile]
    day0 = int((NOW - days_ago * 86400) // 86400)
    while weekdays is not None and (day0 + 3) % 7 not in weekdays:
        day0 -= 1                      # 1970-01-01 was a Thursday
    hour = _RHYTHM.choices(list(hours), list(hours.values()))[0]
    ts = day0 * 86400 + hour * 3600 + _RHYTHM.randrange(0, 3600)
    return ts if ts < NOW - 60 else ts - 86400


def mails(frm: str, subjects: list[str], n: int, *, newest_days=1.0,
          span_days=700.0, unread=0.7, size=(9000, 60000), unsub=False,
          atts=None, att_n=3, html=None, chain: list | None = None,
          me: str = ME, at: str | None = None,
          one_click: bool = False) -> list[dict]:
    out = []
    profile = at or ("work" if chain is not None
                     else "newsletter" if unsub else "mixed")
    for i in range(n):
        days = newest_days + (span_days - newest_days) * (i / max(1, n - 1)) \
            * random.uniform(0.6, 1.15)
        if profile == "daily":         # one a day, every day
            days = newest_days + i
        subj = subjects[i % len(subjects)]
        if "{n}" in subj:
            subj = subj.replace("{n}", str(random.randint(10000, 99999)))
        out.append(make_msg(
            next(_UID), frm=frm, subject=subj,
            unsub="<https://unsub.example/u>" if unsub else None,
            unsub_post=unsub and one_click,       # List-Unsubscribe-Post
            msgid=f"<demo-{next(_UID)}@demo.example>",
            size=random.randint(*size),
            seen=random.random() > unread,
            date=time.strftime("%d-%b-%Y %H:%M:%S +0000",
                               time.gmtime(_arrival(days, profile))),
            atts=_atts_for(i, atts, att_n),
            html=html(i) if html else None,
            body=None))
    return out if chain is None else thread_chains(out, chain, me)


def double_send(m: dict, minutes: float) -> dict:
    """The same mail sent twice: same sender and subject, its own
    Message-ID, arriving `minutes` later (a shop's confirmation, a club mail
    that went out again)."""
    return {**m, "uid": next(_UID), "msgid": f"<demo-{next(_UID)}@demo.example>",
            "date": time.strftime("%d-%b-%Y %H:%M:%S +0000", time.gmtime(
                _when(m["date"]) + minutes * 60))}


def copies(msgs: list[dict], *, seen=None) -> list[dict]:
    """Copies of `msgs` under fresh UIDs but the same Message-ID, date and
    size: the same mail filed twice (another folder, or the mailbox
    delivered it twice)."""
    return [{**m, "uid": next(_UID),
             "seen": m["seen"] if seen is None else seen} for m in msgs]


# One real conversation (Anna writes, the user replies from Sent, Anna answers
# with a quoted history) so the "Read conversation" view has something to show.
WANDER_1 = "<wander-1@demo.example>"
WANDER_R1 = "<wander-r1@demo.example>"
WANDER = [
    make_msg(next(_UID), frm='"Anna Weber" <anna.weber@mailfox.example>',
             subject="Wanderung am Samstag?", msgid=WANDER_1, size=2400,
             seen=True, date=_date(5),
             body="Hi!\n\nHast du am Samstag Zeit für eine Wanderung? Ich "
                  "dachte an die Runde um den See, ca. 5 Stunden.\n\nLG Anna"),
    make_msg(next(_UID), frm='"Anna Weber" <anna.weber@mailfox.example>',
             subject="Re: Wanderung am Samstag?", msgid="<wander-2@demo.example>",
             irt=WANDER_R1, refs=f"{WANDER_1} {WANDER_R1}", size=3100,
             seen=False, date=_date(2),
             body="Super, dann treffen wir uns um 9 Uhr am Parkplatz!\n\n"
                  "Am Mittwoch, 1. Oktober 2026 um 18:30 schrieb Demo "
                  "<demo@example.com>:\n> Klingt gut, ich bringe Brote mit.\n"
                  "> Wann geht es los?\n>\n> Am Montag, 29. September 2026 "
                  "um 09:12 schrieb Anna Weber <anna.weber@mailfox.example>:\n"
                  ">> Hi! Hast du am Samstag Zeit für eine Wanderung?\n"),
]

# A busy group thread the demo user muted ("Mute this conversation"): three
# mails from before the mute are still in the inbox, two that came later were
# archived and marked read by the mute's rule (created further down). The
# thread's key is the hash of its first Message-ID, as the scan derives it.
TEAM_1, TEAM_2, TEAM_3 = ("<team-1@demo.example>", "<team-2@demo.example>",
                          "<team-3@demo.example>")
TEAM_KEY = hashlib.sha256(TEAM_1.encode()).hexdigest()[:16]
_KIM = '"Kim Example" <kim@team.example>'
_LEE = '"Lee Example" <lee@team.example>'
_NOA = '"Noa Example" <noa@team.example>'
TEAM_SUBJECT = "Team dinner on Friday"
TEAM_INBOX = [
    make_msg(next(_UID), frm=_KIM, subject=TEAM_SUBJECT, msgid=TEAM_1,
             size=2200, seen=True, date=_date(6),
             body="Hi all - shall we do the team dinner on Friday? "
                  "Reply with what you can bring.\n\nKim"),
    make_msg(next(_UID), frm=_LEE, subject=f"Re: {TEAM_SUBJECT}",
             msgid=TEAM_2, irt=TEAM_1, refs=TEAM_1, size=2300, seen=True,
             date=_date(5), body="Count me in! I can bring the salad.\n\nLee"),
    make_msg(next(_UID), frm=_NOA, subject=f"Re: {TEAM_SUBJECT}",
             msgid=TEAM_3, irt=TEAM_2, refs=f"{TEAM_1} {TEAM_2}", size=2300,
             seen=False, date=_date(4),
             body="Friday works. Can someone bring the cake?\n\nNoa"),
]
TEAM_ARCHIVED = [
    make_msg(next(_UID), frm=_KIM, subject=f"Re: {TEAM_SUBJECT}",
             msgid="<team-4@demo.example>", irt=TEAM_3,
             refs=f"{TEAM_1} {TEAM_2} {TEAM_3}", size=2400, seen=True,
             date=_date(1.5), body="I will bring the cake.\n\nKim"),
    make_msg(next(_UID), frm=_LEE, subject=f"Re: {TEAM_SUBJECT}",
             msgid="<team-5@demo.example>", irt="<team-4@demo.example>",
             refs=f"{TEAM_1} {TEAM_2} {TEAM_3} <team-4@demo.example>",
             size=2400, seen=True, date=_date(0.7),
             body="Perfect, see you all at seven.\n\nLee"),
]

PROTON_SENT: list[dict] = []       # the user's side of the Proton conversations

PROTON_INBOX = WANDER + TEAM_INBOX + (
    mails('"ACME Store" <news@acme-store.example>',
          ["Weekend SALE - up to 70% off ✨", "Your points expire soon",
           "New arrivals for autumn", "Last chance: free shipping"],
          214, unsub=True,
          html=newsletter_html(PIXEL_HOST, CLICK_HOST))
    + mails('"PaketFix" <noreply@paketfix.example>',
            ["Ihre Sendung {n} ist unterwegs", "Zustellung heute: Paket {n}",
             "Ihr Paket {n} wurde zugestellt"], 96, unread=0.85, at="shop")
    + mails('"Chirper" <notify@chirper.example>',
            ["You have 3 new followers", "Trending now on Chirper",
             "@rob mentioned you"], 168, unsub=True, unread=0.9,
          html=newsletter_html(PIXEL_HOST))
    + mails('"TechDigest" <digest@techdigest.example>',
            ["Issue #{n}: Rust vs. the world", "Weekly: self-hosting corner",
             "Issue #{n}: the terminal renaissance"], 88, unsub=True,
          one_click=True, html=newsletter_html(click=CLICK_HOST))
    + mails('"Streamly" <info@streamly.example>',
            ["New this week on Streamly", "Your watchlist just got better"],
            64, unsub=True, unread=0.8, one_click=True,
            html=newsletter_html("track.streamly-demo.example"))
    + mails('"Bergsport Huber" <newsletter@bergsport-huber.example>',
            ["Neu eingetroffen: Tourenski 2026", "Wochenend-Angebote",
             "Gutschein: 10 € für deine nächste Tour"], 51, unsub=True,
          html=newsletter_html())
    + mails('"PayBank" <service@paybank.example>',
            ["Your statement is available", "Security notice about your "
             "account", "Payment of ${n}.00 completed",
             "Offer: 3% cashback on your next card purchase"],
            42, unread=0.3, size=(14000, 40000))
    + mails('"CloudBox" <billing@cloudbox.example>',
            ["Invoice CB-{n}", "Payment receipt CB-{n}"],
            24, unread=0.2, size=(220000, 480000),
            atts=[("invoice.pdf", 310000)])
    + mails('"JobPortal" <jobs@jobportal.example>',
            ["12 new jobs matching your profile", "Someone viewed your "
             "profile"], 33, unsub=True)
    + mails('"GreenEnergy AG" <kundenservice@greenenergy.example>',
            ["Ihre Rechnung {n}", "Abschlagsänderung ab August"],
            18, unread=0.25, size=(90000, 200000),
            atts=[[("rechnung.pdf", 150000)],
                  [("Vertragsbedingungen.docx", 85000)]])
    + mails('"Anna Weber" <anna.weber@mailfox.example>',
            ["Kletterhalle am Freitag", "Fotos vom Wochenende",
             "Geschenk für Papa"], 12, unread=0.05,
            size=(4000, 30000), chain=PROTON_SENT)
    + mails('"Photo Club" <hello@photoclub.example>',
            ["March meetup - RAW files inside", "Contest results 🎉"],
            9, unread=0.1, size=(2000000, 6000000),
            atts=[("IMG_2041.jpg", 4200000), ("IMG_2044.jpg", 3800000)])
    # one domain with several senders (and one protected address on another
    # shared domain), so the Space map has something to drill into
    + mails('"Northwind Shop" <shop@northwind.example>',
            ["Your order {n} is confirmed", "Autumn collection is here"],
            60, unread=0.6, size=(40000, 120000), at="shop")
    + mails('"Northwind News" <news@northwind.example>',
            ["Northwind weekly", "Members only: early access"],
            80, unsub=True, unread=0.9, size=(30000, 90000))
    + mails('"Northwind Invoices" <invoices@northwind.example>',
            ["Invoice NW-{n}", "Your receipt NW-{n}"],
            20, unread=0.3, size=(300000, 700000),
            atts=[("invoice.pdf", 420000)])
    + mails('"Mailfox Photos" <photos@mailfox.example>',
            ["Your album is ready", "New photos from the trip"],
            14, unread=0.2, size=(800000, 2500000),
            atts=[[("album.zip", 1900000)], [("beach.png", 1400000)]])
    + mails('"Dr. Meier Praxis" <praxis@dr-meier.example>',
            ["Terminbestätigung", "Ihr Laborbefund ist da"], 5, unread=0.1,
          chain=PROTON_SENT)
    # Quick wins (F5): senders that have gone quiet, so the strip has cards
    # - old unread newsletters, a low-engagement sender, an unsubscribed one
    # still holding mail, and old big attachments.
    + mails('"Gadget Weekly" <news@gadgetweekly.example>',
            ["Gadget of the week", "Ten tips for your desk"], 120,
            newest_days=260, span_days=800, unread=0.99, unsub=True)
    + mails('"Deal Hunter" <hello@dealhunter.example>',
            ["Deals you missed", "Flash sale ends tonight"], 80,
            newest_days=300, span_days=750, unread=0.99, unsub=True)
    + mails('"Old Forum" <digest@oldforum.example>',
            ["Your daily digest", "New replies in threads you follow"], 60,
            newest_days=500, span_days=900, unread=0.97)
    + mails('"Coupon Club" <offers@couponclub.example>',
            ["Your coupon is waiting", "Members-only offer"], 40,
            newest_days=40, span_days=400, unread=0.9, unsub=True)
    + mails('"Photo Archive" <hello@photoarchive.example>',
            ["Scans from the family archive", "Your scanned documents"], 12,
            newest_days=800, span_days=1000, unread=0.5,
            size=(7000000, 8000000),
            atts=[("scan-1.pdf", 6000000), ("scan-2.pdf", 6000000)])
)

# A daily sender for "When mail arrives": one mail every morning for 75 days
# (some days two), mostly unread. The shared random stream is restored so the
# data after it stays unchanged.
_rs = random.getstate()
# (Sender grade: it is the loud, tracking sender with a one-click unsubscribe.)
PROTON_INBOX += (
    mails('"Deals Daily" <deals@dealsdaily.example>',
          ["Today's top deals", "Only today: flash prices",
           "Your daily picks"], 75, newest_days=0.2, unread=0.98, unsub=True,
          at="daily", one_click=True,
          html=newsletter_html(PIXEL_HOST, CLICK_HOST))
    + mails('"Deals Daily" <deals@dealsdaily.example>',
            ["Deal ends at midnight"], 18, newest_days=0.4, span_days=75,
            unread=0.98, unsub=True, at="daily", one_click=True,
            html=newsletter_html(PIXEL_HOST, CLICK_HOST)))
random.setstate(_rs)

# A sender that earns an F in the grades: a mail a day for two weeks, never
# opened, heavy, tracking, and no way to unsubscribe. Own random stream.
_rs = random.getstate()
random.seed(115)
PROTON_INBOX += mails('"Bonus Blast" <hi@bonusblast.example>',
                      ["You may have won!", "Claim your bonus now",
                       "Last reminder: an unclaimed reward"], 17,
                      newest_days=0.6, unread=1.0, at="daily",
                      size=(1200000, 1800000),
                      html=newsletter_html(PIXEL_HOST, CLICK_HOST))
random.setstate(_rs)

# A "ghost" sender for Your year in mail: plenty of mail, never opened. The
# shared random stream is restored so the data after it stays unchanged.
_rs = random.getstate()
PROTON_INBOX += mails('"Quiet Deals" <promo@quietdeals.example>',
                      ["Deal of the day", "Members only: 20% off",
                       "Your cart misses you"], 36, span_days=500,
                      unread=1.0, unsub=True)
random.setstate(_rs)


# Newsletters nobody has opened for ages (the "Describe a filter" demo
# sentence selects them). Own random stream: the senders above, the long tail
# and everything seeded later keep their exact data.
_state = random.getstate()
random.seed(11)
PROTON_INBOX += (
    mails('"Old Gazette" <weekly@old-gazette.example>',
          ["The week in brief", "Reader offers", "Editor's picks"], 26,
          newest_days=410, span_days=900, unread=1.0, unsub=True)
    + mails('"Retro Deals" <digest@retro-deals.example>',
            ["Deals you missed", "Back in stock", "Final reminder"], 12,
            newest_days=560, span_days=1000, unread=0.97, unsub=True)
)
random.setstate(_state)


# Subscriptions (Insights > Subscriptions): receipts on a schedule, a sign-in
# alert or an opened mail for the ones in use, plenty of unopened mail for the
# ones that look unused. Fixed dates and no random draws (own UID range), so
# nothing else in the demo shifts. One receipt names no price in its subject
# (the text has it), to show the opt-in that reads it.
_SUB_UID = iter(range(500000, 600000))
_SUB_JITTER = (0, 1, 0, -1, 1, 0, -1, 0)       # days; keeps the cadence regular


def _sub_mail(frm, subject, days_ago, *, seen=True, body=None, unsub=False):
    uid = next(_SUB_UID)
    return make_msg(uid, frm=frm, subject=subject,
                    msgid=f"<demo-sub-{uid}@demo.example>", size=9000,
                    seen=seen, date=_date(days_ago), body=body,
                    unsub="<https://unsub.example/u>" if unsub else None)


def _sub_series(frm, subject, n, every, newest, body):
    """`n` receipts `every` days apart, the newest `newest` days ago."""
    return [_sub_mail(frm, subject, newest + i * every
                      + _SUB_JITTER[i % len(_SUB_JITTER)], body=body)
            for i in range(n)]


_SIGN_IN = "New sign-in to your account"
PROTON_INBOX += (
    _sub_series('"StreamBox" <billing@streambox.example>',
                "Your StreamBox receipt - €12.99", 22, 30, 21,
                "Thank you for your payment. Total: €12.99")
    + [_sub_mail('"StreamBox" <security@streambox.example>', _SIGN_IN, 12,
                 body="A new sign-in to your account was detected.")]
    + _sub_series('"CloudDrive Pro" <billing@clouddrive-pro.example>',
                  "Your CloudDrive Pro invoice - €59.88", 4, 365, 305,
                  "Annual plan renewed. Total: €59.88")
    + [_sub_mail('"CloudDrive Pro" <news@clouddrive-pro.example>',
                 "Storage tips for your drive", 40, unsub=True)]
    + _sub_series('"FitTrack Premium" <billing@fittrack.example>',
                  "Your FitTrack receipt - €7.99", 21, 30, 24,
                  "Thank you for your payment. Total: €7.99")
    + [_sub_mail('"FitTrack Premium" <security@fittrack.example>', _SIGN_IN,
                 250, body="A new sign-in to your account was detected.")]
    + [_sub_mail('"FitTrack Premium" <coach@fittrack.example>',
                 "Your weekly training summary", 235 - 18 * k, seen=False,
                 unsub=True) for k in range(12)]
    + _sub_series('"NewsDaily+" <billing@newsdaily.example>',
                  "Your NewsDaily+ receipt", 9, 30, 26,
                  "Thank you for subscribing.\n\nTotal: €4.99")
    + [_sub_mail('"NewsDaily+" <headlines@newsdaily.example>',
                 "Today's headlines", 2 + 5 * k, seen=False, unsub=True)
       for k in range(15)]
    + _sub_series('"PhotoVault" <billing@photovault.example>',
                  "Your PhotoVault receipt - €2.99", 30, 30, 3,
                  "Thank you for your payment. Total: €2.99")
    + [_sub_mail('"PhotoVault" <security@photovault.example>', _SIGN_IN, 18,
                 body="A new sign-in to your account was detected.")]
    + _sub_series('"VPNly" <billing@vpnly.example>',
                  "Your VPNly invoice - €39.00", 3, 365, 200,
                  "Annual plan renewed. Total: €39.00")
    + [_sub_mail('"VPNly" <security@vpnly.example>', _SIGN_IN, 25,
                 body="A new sign-in to your account was detected.")]
)


# Sender changes (Overview "Last week", Statistics, is:louder / is:back): two
# senders that got louder (a steady weekly rhythm, then a busy week) and one
# that came back after more than a year. Fixed dates and no random draws (own
# UID range), so nothing else in the demo shifts.
_CH_UID = iter(range(600000, 650000))


def _ch_mail(frm, subject, days_ago, *, seen=False):
    uid = next(_CH_UID)
    return make_msg(uid, frm=frm, subject=subject,
                    msgid=f"<demo-ch-{uid}@demo.example>", size=14000,
                    seen=seen, date=_date(days_ago),
                    unsub="<https://unsub.example/u>")


def _steady(frm, subject, every, weeks, first, busy):
    """Mail every `every` days from `first` days ago back over `weeks` weeks,
    then `busy` mails in the last six days."""
    out = [_ch_mail(frm, subject, first + k * every)
           for k in range(round(weeks * 7 / every))]
    return out + [_ch_mail(frm, subject, d) for d in busy]


PROTON_INBOX += (
    _steady('"Parkside Market" <deals@parkside-market.example>',
            "Fresh picks this week", 7, 18, 10, (0.6, 1.4, 2.5, 3.6, 5.2))
    + _steady('"Trailhead Club" <news@trailhead-club.example>',
              "Trail report and gear offers", 3.5, 14, 8.5,
              (0.8, 1.9, 3.2, 4.4, 5.6))
    + [_ch_mail('"Harbor Books" <hello@harborbooks.example>',
                "New in the shop: spring reads", d)
       for d in (462, 468, 475, 6, 4, 2)]
)


# Mail past its date (Overview Next steps, is:expired): sign-in codes, parcel
# updates whose parcel has arrived, reminders of things that are over and
# offers that have ended, next to the receipts and bookings that stay. Fixed
# dates and no random draws (own UID range), so nothing else in the demo
# shifts. Dates inside subjects are worked out from the mail's own date.
_PD_UID = iter(range(650000, 700000))


def _pd_mail(frm, subject, days_ago, *, size=18000, seen=True):
    uid = next(_PD_UID)
    return make_msg(uid, frm=frm, subject=subject,
                    msgid=f"<demo-pd-{uid}@demo.example>", size=size,
                    seen=seen, date=_date(days_ago))


def _pd_day(days_ago, ahead):
    """"12 Nov": the day `ahead` days after a mail sent `days_ago` days ago."""
    d = datetime.datetime.fromtimestamp(NOW - (days_ago - ahead) * 86400,
                                        datetime.timezone.utc)
    return f"{d.day} {d.strftime('%b')}"


_FJORD = '"Fjord Login" <no-reply@fjord-login.example>'
_PEBBLE = '"Pebble Account" <security@pebble-account.example>'
_MEADOW = '"Meadow Shop" <orders@meadow-shop.example>'
_LINDEN = '"Linden Clinic" <termine@linden-clinic.example>'
_HARVEST = '"Harvest Deals" <deals@harvest-deals.example>'
_PD: list[dict] = []
for _d in (2, 4, 7, 11, 16, 23, 31, 44):
    _PD.append(_pd_mail(_FJORD, "Your sign-in code", _d, size=9000))
for _d in (5, 30, 90, 200):
    _PD.append(_pd_mail(_PEBBLE, "Confirm your email address", _d, size=11000))
_PD += [_pd_mail(_FJORD, "Your sign-in code", 0.3, seen=False, size=9000),
        _pd_mail(_PEBBLE, "Your verification code is 482913", 0.6,
                 seen=False, size=9000)]
for _no, _ago in ((48211, 21), (48377, 15), (49002, 9)):
    _PD += [
        _pd_mail(_MEADOW, f"Order confirmation #{_no}", _ago + 2, size=42000),
        _pd_mail(_MEADOW, f"Invoice for order #{_no}", _ago + 2, size=61000),
        _pd_mail(_MEADOW, f"Your order #{_no} has shipped", _ago, size=36000),
        _pd_mail(_MEADOW, f"Your parcel is on its way - order #{_no}",
                 _ago - 1, size=36000),
        _pd_mail(_MEADOW, f"Out for delivery: order #{_no}", _ago - 2,
                 size=36000),
        _pd_mail(_MEADOW, f"Your order #{_no} was delivered", _ago - 3,
                 size=30000),
    ]
# an order that is still on its way: nothing of it is listed
_PD += [_pd_mail(_MEADOW, "Order confirmation #50110", 3, size=42000),
        _pd_mail(_MEADOW, "Your order #50110 has shipped", 2, size=36000)]
for _ago in (40, 33, 26):
    _PD.append(_pd_mail(_LINDEN, "Reminder: your appointment on "
                        + _pd_day(_ago, 3), _ago, size=24000))
_PD += [_pd_mail(_LINDEN, "Booking confirmed: " + _pd_day(40, 3), 48,
                 size=26000),
        _pd_mail(_LINDEN, "Reminder: your appointment", 52, size=24000),
        _pd_mail(_LINDEN, "Terminbestätigung " + _pd_day(26, 3), 34,
                 size=26000),
        _pd_mail(_LINDEN, "Reminder: your appointment on " + _pd_day(0.5, 6),
                 0.5, size=24000)]
for _ago in (9, 16, 30):
    _PD.append(_pd_mail(_HARVEST, "Deal ends at midnight", _ago, size=52000))
for _ago in (6, 13, 21):
    _PD.append(_pd_mail(_HARVEST, "Only today: flash prices", _ago,
                        size=48000))
for _ago in (24, 38):
    _PD.append(_pd_mail(_HARVEST, "Sale ends Sunday: 20% off", _ago,
                        size=55000))
_PD.append(_pd_mail(_HARVEST, "Deal ends tomorrow", 0.2, size=52000,
                    seen=False))
PROTON_INBOX += _PD


# Automatic mail (Mail past its date, is:auto): out-of-office replies, delivery
# failures, read receipts and calendar answers - what the mails' own headers
# say (Auto-Submitted, a delivery-status / disposition-notification report, a
# text/calendar part with METHOD:REPLY; the calendar ones are read by the
# Attachments analysis the demo runs), next to look-alikes a subject alone
# must never list. Fixed dates, no random draws and an own UID range, so
# nothing else in the demo shifts.
_AM_UID = iter(range(960000, 970000))
_CAL_REPLY_BS = (
    '(("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 100 5)'
    '("text" "calendar" ("method" "REPLY" "charset" "utf-8") NIL NIL "7bit" '
    '420 12) "mixed" ("boundary" "b") NIL NIL)')


def _am_mail(frm, subject, days_ago, *, size=6000, seen=True, **headers):
    """`headers`: `auto_submitted`, `report` (the report type) or `bs` (a
    BODYSTRUCTURE with a calendar part) - what the fake server serves."""
    uid = next(_AM_UID)
    return make_msg(uid, frm=frm, subject=subject,
                    msgid=f"<demo-am-{uid}@demo.example>", size=size,
                    seen=seen, date=_date(days_ago)) | headers


_MARTA = '"Marta Lindqvist" <marta.lindqvist@northfield-studio.example>'
_JONAS = '"Jonas Brandt" <jonas.brandt@harborlight.example>'
_TOMAS = '"Tomas Weber" <tomas.weber@brightpath.example>'
_DAEMON = '"Mailer Robot" <mailer-daemon@mx.demo-mail.example>'
_AM: list[dict] = []
# out-of-office replies: by their subject, and by the Auto-Submitted header
for _ago, _what in ((9, "Meeting notes"), (16, "Budget review"),
                    (27, "Launch checklist"), (44, "Quarterly plan")):
    _AM.append(_am_mail(_MARTA, f"Automatic reply: {_what}", _ago))
_AM.append(_am_mail(_MARTA, "Abwesenheitsnotiz: Projektplan", 33))
for _ago, _what in ((12, "Back in January"), (21, "Away until the 5th"),
                    (38, "Away from my desk")):
    _AM.append(_am_mail(_JONAS, _what, _ago, auto_submitted="auto-replied"))
# delivery failures: a delivery status report, and a subject alone
for _ago in (11, 19, 30):
    _AM.append(_am_mail(_DAEMON, "Undelivered Mail Returned to Sender", _ago,
                        report="delivery-status", size=9000))
for _ago in (14, 25):
    _AM.append(_am_mail(_DAEMON, "Delivery Status Notification (Failure)",
                        _ago, report="delivery-status", size=8000))
_AM.append(_am_mail(_DAEMON, "Unzustellbar: Einladung zum Sommerfest", 40,
                    size=7000))
# read receipts (a disposition-notification report) and calendar answers (a
# text/calendar part with METHOD:REPLY): unticked on the sheet
for _ago, _what in ((10, "Meeting notes"), (18, "Budget review"),
                    (29, "Launch checklist")):
    _AM.append(_am_mail(_MARTA, f"Read: {_what}", _ago,
                        report="disposition-notification", size=4000))
_AM.append(_am_mail(_MARTA, "Gelesen: Projektplan", 36,
                    report="disposition-notification", size=4000))
for _ago, _what in ((13, "Accepted: Team dinner"), (22, "Accepted: Offsite"),
                    (35, "Declined: Planning call")):
    _AM.append(_am_mail(_TOMAS, _what, _ago, bs=_CAL_REPLY_BS, size=5000))
# never listed: the same subjects without the header evidence, a mail that is
# under a week old, and a job application (Keep-safe's class) whatever the
# headers say
_AM += [
    _am_mail(_MARTA, "Read: Quarterly plan", 20, size=3500),
    _am_mail(_TOMAS, "Accepted: Team lunch", 17, size=3500),
    _am_mail(_MARTA, "Automatic reply: Release notes", 2, size=6000,
             seen=False),
    _am_mail(_JONAS, "Automatic reply: Your application for Product Designer",
             24, size=6000),
    _am_mail(_TOMAS, "Accepted: your application", 26, bs=_CAL_REPLY_BS,
             size=5000),
]
PROTON_INBOX += _AM


# What they send (the sender pane's box): the Northwind shop also sends ads
# (with a List-Unsubscribe header, like a mailing list) and shipping updates
# next to its order confirmations - three kinds from one address. Fixed dates,
# no random draws and an own UID range, so nothing else in the demo shifts.
_WS_UID = iter(range(800000, 850000))
_WS_SHOP = '"Northwind Shop" <shop@northwind.example>'


def _ws_mail(subject, days_ago, *, ad=False, seen=True, size=52000):
    uid = next(_WS_UID)
    return make_msg(uid, frm=_WS_SHOP, subject=subject,
                    msgid=f"<demo-ws-{uid}@demo.example>", size=size,
                    seen=seen, date=_date(days_ago),
                    unsub="<https://unsub.example/u>" if ad else None)


_WS_ADS = ("Weekend offer: 20% off outerwear", "New arrivals just landed",
           "Last chance: the winter sale ends soon", "Two days only: 15% off boots and scarves",
           "Our best picks for the cold season", "Members get early access")
_WS = [_ws_mail(_WS_ADS[i % len(_WS_ADS)], 2.5 + i * 4.2, ad=True,
                seen=i % 7 == 6, size=68000 + i * 900)
       for i in range(16)]
_WS += [_ws_mail(s, d, size=31000) for s, d in (
    ("Your order has shipped", 6),
    ("Shipping update: tracking number inside", 9),
    ("Your order has shipped", 21), ("Out for delivery", 33),
    ("Shipping update: tracking number inside", 47),
    ("Your order has shipped", 58), ("Out for delivery", 70),
    ("Your order has shipped", 96))]
PROTON_INBOX += _WS


# --- long tail ------------------------------------------------------------
# Real mailboxes are 80% senders with < 10 mails. Generated from a separate
# seeded stream, so the hand-written senders above keep their exact data.
_WORDS = ["acorn", "birch", "cobalt", "dune", "ember", "fjord", "glacier",
          "harbor", "iris", "juniper", "kelp", "lagoon", "maple", "nectar",
          "onyx", "pebble", "quartz", "reed", "sable", "tundra", "umber",
          "velvet", "willow", "yarrow", "zephyr", "amber", "basil", "cedar",
          "delta", "elm", "fern", "grove", "hazel", "indigo", "jade", "kiwi",
          "lotus", "mint", "nova", "olive"]


def _tail(local: str, domain: str, brands: list[str], subjects: list[str],
          counts=(1, 3), **kw) -> list[dict]:
    out: list[dict] = []
    for b in brands:
        out += mails(
            f'"{b.title()}" <{local}@{domain.format(b=b)}>',
            [s.replace("{b}", b.title()) for s in subjects],
            random.randint(*counts), newest_days=random.uniform(1, 200),
            span_days=random.uniform(30, 600), **kw)
    return out


def long_tail(scale: float = 1.0, me: str = ME) -> tuple[list[dict], list[dict]]:
    """(inbox mails, sent mails): ~100 small senders spread over every kind
    Smart pools - companies, sign-ups, newsletters, orders, appointments,
    applications, support, private addresses, people you write to, the
    rest."""
    state = random.getstate()
    random.seed(11)
    sent: list[dict] = []                # the user's side of the conversations
    w = _WORDS
    k = lambda n: max(1, round(n * scale))          # noqa: E731
    inbox: list[dict] = []
    inbox += _tail("service", "{b}.example", ["paymate"],
                   ["Your invoice {n}", "Rewards update"], (5, 5))
    inbox += _tail("alerts", "{b}.example", ["paymate"],
                   ["New sign-in alert", "Spending summary"], (3, 3))
    inbox += _tail("support", "mail.{b}.example", ["paymate"],
                   ["Ticket-ID {n} updated"], (3, 3))     # a subdomain: mixed
    for brand in ("rentwheels", "tripnest"):                # one exact domain
        for local in ("deals", "booking", "club"):
            inbox += _tail(local, "{b}.example", [brand],
                           ["Your deal of the week", "Booking {n}"], (4, 4))
    inbox += _tail("no-reply", "{b}.example", w[:k(14)],
                   ["Welcome to {b}", "Please verify your email address",
                    "Your {b} login code"], unread=0.8)
    inbox += _tail("news", "{b}.example", w[14:14 + k(28)],
                   ["This week at {b}", "Our autumn picks", "{b} news"],
                   unsub=True, html=newsletter_html(PIXEL_HOST))
    # what the mails are about decides the row (not the address): orders,
    # appointments, applications, support - and some that say nothing (Other)
    inbox += _tail("noreply", "{b}-app.example", w[2:2 + k(12)],
                   ["Your weekly summary", "Reminder: an update is ready"])
    inbox += _tail("parcel", "{b}-post.example", w[5:5 + k(6)],
                   ["Your order {n} has shipped", "Delivery: parcel {n} is on its way"])
    inbox += _tail("billing", "{b}-pay.example", w[9:9 + k(6)],
                   ["Invoice {n}", "Payment received"])
    inbox += _tail("termin", "{b}-praxis.example", w[12:12 + k(7)],
                   ["Terminbestätigung", "Erinnerung an Ihren Termin"])
    inbox += _tail("hr", "{b}-karriere.example", w[18:18 + k(4)],
                   ["Your application at {b}", "Interview invitation"])
    inbox += _tail("help", "{b}-desk.example", w[24:24 + k(6)],
                   ["Your inquiry", "Ticket-ID {n} updated"], chain=sent,
                   me=me)
    people = [f"demo.person{i:02d}@{d}" for i, d in enumerate(
        ["gmail.com", "gmx.de", "web.de", "gmail.com", "outlook.com",
         "gmx.de", "gmail.com", "web.de", "gmail.com", "gmx.de"][:k(10)])]
    names = ["Mia Becker", "Jonas Keller", "Sofia Lang", "Ben Hartmann",
             "Clara Neumann", "Lukas Vogel", "Emma Roth", "Paul Fischer",
             "Hannah Wolf", "Felix Brandt"]
    for addr, name in zip(people, names):
        inbox += mails(f'"{name}" <{addr}>', ["Hallo!", "Foto vom Sonntag", "Bis bald"],
                       random.randint(1, 3), newest_days=random.uniform(1, 90),
                       chain=sent, me=me)
    inbox += _tail("m.schulz", "{b}-gmbh.example", w[20:20 + k(16)],
                   ["Ihr Angebot", "Quarterly update", "Terminerinnerung"],
                   (1, 2), unread=0.4, chain=sent, me=me)
    # People you write to: small senders that also got a mail from the user.
    wrote = [f"{n}@{d}.example" for n, d in (
        ("tobi", "kletterhalle"), ("nina.k", "mietverein"),
        ("vermieter", "hausverwaltung-nord"), ("opa", "familienpost"),
        ("steuerberater", "kanzlei-brandt"))]
    for addr in wrote:
        inbox += mails(f"<{addr}>", ["Termin am Donnerstag", "Kurze Frage"],
                       random.randint(2, 4), newest_days=random.uniform(3, 60),
                       unread=0.2, chain=sent, me=me)
    random.setstate(state)
    return inbox, sent


PROTON_TAIL, PROTON_TAIL_SENT = long_tail()
ICLOUD_ME = "Demo <demo@icloud.example>"
ICLOUD_TAIL, ICLOUD_TAIL_SENT = long_tail(0.4, ICLOUD_ME)
ICLOUD_SENT = ICLOUD_TAIL_SENT


# Duplicates and the Archive folder, from their own random stream. The same
# mail filed twice has the same Message-ID (Inbox + Archive); a mail the
# server delivered twice is an exact copy in the same folder. Mails that
# merely look alike (two monthly statements) keep their own ids.
_state = random.getstate()
random.seed(31)
_by = lambda inbox, key: [m for m in inbox if key in m["from"]]   # noqa: E731
_shop = [m for m in _by(PROTON_INBOX, "northwind.example")
         if m["subject"].startswith("Your order")]
PROTON_COPIES = (copies(_by(PROTON_INBOX, "paybank")[:3])
                 + [double_send(_shop[3], 2), double_send(
                     _by(PROTON_INBOX, "photoclub")[1], 4)])
PROTON_ARCHIVE = (
    TEAM_ARCHIVED
    + copies(_by(PROTON_INBOX, "cloudbox")[:6])
    + copies(_by(PROTON_INBOX, "greenenergy")[:4])
    + mails('"Finanzamt Musterstadt" <bescheid@finanzamt-musterstadt.example>',
            ["Steuerbescheid {n}", "Ihre Steuererklärung ist eingegangen"],
            5, newest_days=400, span_days=1100, unread=0.0,
            size=(300000, 900000), atts=[("Steuerbescheid.pdf", 420000)],
            att_n=5)
    + mails('"Dr. Meier Praxis" <praxis@dr-meier.example>',
            ["Ihr Laborbefund ist da"], 3, newest_days=200, span_days=600,
            unread=0.0))

# iCloud: a busy inbox with a few big senders, old photo and document
# attachments, a full Trash, a Junk folder with one false alarm, an Archive.
ICLOUD_INBOX = (
    mails('"Fruit Store" <receipts@fruitstore.example>',
          ["Your receipt #{n}", "Pre-order now", "Your order #{n} has shipped"],
          120, unread=0.5, size=(30000, 90000),
          atts=[("receipt.pdf", 60000)], att_n=30)
    + mails('"Quick Bite" <deals@quickbite.example>',
            ["Your voucher expires tonight", "Free delivery this weekend",
             "New in your area"], 140, unsub=True, unread=0.85)
    + mails('"Cloud Photos" <no-reply@cloudphotos.example>',
            ["Your storage is 80% full", "Memories from last year"],
            90, unsub=True)
    + mails('"Reisefieber" <news@reisefieber.example>',
            ["Last-Minute: Städtetrips ab 49 €", "Ihr Urlaubsmagazin",
             "Sommer-Highlights"], 55, unsub=True, unread=0.8)
    + mails('"Fit Club" <hello@fitclub.example>',
            ["Your trial week is over", "Come back for 50% off"], 48,
            newest_days=200, span_days=600, unread=0.97, unsub=True)
    + mails('"Kino Zentral" <programm@kino-zentral.example>',
            ["Das Programm der Woche", "Vorpremiere: Karten sichern"], 40,
            unsub=True, unread=0.9)
    + mails('"Family Chat" <lisa@familienpost.example>',
            ["Sonntag bei Oma?", "Urlaubsfotos!", "Geburtstag am Samstag"],
            14, unread=0.1, size=(3000000, 5500000), chain=ICLOUD_SENT,
            me=ICLOUD_ME,
            atts=[[("IMG_3310.jpg", 3400000)],
                  [("Oma-Geburtstag.png", 2100000)],
                  [("Urlaub.zip", 5200000)]], att_n=9)
    + mails('"Verwaltung Nord" <post@hausverwaltung-nord.example>',
            ["Nebenkostenabrechnung {n}", "Mietvertrag: Nachtrag"], 9,
            newest_days=800, span_days=1150, unread=0.3,
            size=(6000000, 9000000),
            atts=[[("Nebenkostenabrechnung.pdf", 7000000)],
                  [("Mietvertrag.docx", 900000), ("Anlage.zip", 6000000)]],
            att_n=9)
    + ICLOUD_TAIL)
# All accounts: the same senders write to this mailbox as well - the very same
# address as in the Proton one (Deals Daily, Gadget Weekly, ACME Store) or
# another address of the same company (Chirper) - so "Same sender, several
# accounts" has rows. Own random stream: the data after it stays unchanged.
_rs = random.getstate()
random.seed(127)
ICLOUD_INBOX += (
    mails('"Deals Daily" <deals@dealsdaily.example>',
          ["Today's top deals", "Only today: flash prices",
           "Your daily picks"], 58, newest_days=0.3, span_days=90,
          unread=0.97, unsub=True, at="daily")
    + mails('"Chirper" <digest@chirper.example>',
            ["Your weekly Chirper digest", "People you may know"], 26,
            span_days=400, unread=0.92, unsub=True)
    + mails('"Gadget Weekly" <news@gadgetweekly.example>',
            ["This week in gadgets", "Test: the new earbuds"], 31,
            span_days=300, unread=0.85, unsub=True)
    + mails('"ACME Store" <news@acme-store.example>',
            ["Weekend SALE - up to 70% off", "Your points expire soon"], 12,
            span_days=120, unread=0.9, unsub=True))
random.setstate(_rs)
# "Same mails in several accounts": this address forwards some of its mail to
# the Proton one, so the very same message (Message-ID and size) sits in both
# mailboxes - shipping updates and a newsletter - and a dozen shipping mails
# were brought over with "Move to another account" (recorded for good: they are
# never offered for removal). Two mails of a protected sender are copies too.
ICLOUD_FWD = copies(_by(PROTON_INBOX, "paketfix")[:30]
                    + _by(PROTON_INBOX, "techdigest")[:18]
                    + _by(PROTON_INBOX, "mailfox")[:2])
ICLOUD_MOVED = copies(_by(PROTON_INBOX, "paketfix")[30:42])
ICLOUD_INBOX += ICLOUD_FWD + ICLOUD_MOVED
_fruit = [m for m in _by(ICLOUD_INBOX, "fruitstore")
          if "has shipped" in m["subject"]]
ICLOUD_COPIES = (copies(_by(ICLOUD_INBOX, "cloudphotos")[:3])
                 + [double_send(_fruit[2], 3),
                    double_send(_by(ICLOUD_INBOX, "kino-zentral")[5], 1)])
ICLOUD_ARCHIVE = (copies(_by(ICLOUD_INBOX, "fruitstore")[:3])
                  + copies(_by(ICLOUD_INBOX, "hausverwaltung-nord")[:2]))
random.setstate(_state)


def _server(mailbox: dict, **kw) -> FakeIMAP:
    # real_atts: the mails with attachments hold real files (Keep the mail,
    # remove the file works on them)
    return FakeIMAP(mailbox, date_header=True, real_atts=True, **kw)



# --- Your addresses ----------------------------------------------------------
# Mail that arrived on addresses other than the main one, with the receiving
# headers the scan reads (Delivered-To / X-Original-To / To). Deterministic (no
# random draws, UIDs from a range of their own (700,000 up; Subscriptions uses 500,000 up)), so the rest of the demo stays
# exactly as it was. The aliases live on the invented alias.example, the
# demo's alias service (scripts/demo.py DemoAliasService) knows them.
MAIN_ADDR = "demo@example.com"
_AUID = iter(range(700_000, 800_000))
ADDRESS_MAILS: list[dict] = []


def _on(rcpt: str, frm: str, subjects: list[str], n: int, first: float,
        last: float, original: str | None = None) -> None:
    """`n` mails from `frm` to `rcpt`, evenly from `first` to `last` days ago."""
    for i in range(n):
        days = first + (last - first) * (i / max(1, n - 1))
        uid = next(_AUID)
        ADDRESS_MAILS.append(make_msg(
            uid, frm=frm, subject=subjects[i % len(subjects)],
            msgid=f"<demo-addr-{uid}@demo.example>", size=9000 + 311 * i,
            seen=i % 4 != 0, date=_date(days), to=rcpt,
            delivered_to=MAIN_ADDR, original_to=original))


ACME_ALIAS = "acme.x7k2@alias.example"
# ACME wrote alone for a year and a half; four others found the address
# 2 months ago (the leak the page shows)
_on(ACME_ALIAS, '"ACME Store" <shop@acme-shop.example>',
    ["Welcome to ACME - confirm your address", "Your order has shipped",
     "New arrivals this week", "Your ACME receipt"], 50, 540, 70)
_on(ACME_ALIAS, '"Prize Center" <prizes@win-big.example>',
    ["You may have won", "Claim your prize today"], 17, 62, 1)
_on(ACME_ALIAS, '"Loan Quick" <offer@loanquick.example>',
    ["Fast cash, no questions", "Your loan offer"], 9, 55, 2)
_on(ACME_ALIAS, '"Crypto Daily" <hi@cryptodaily.example>',
    ["Double your coins", "Market alert"], 7, 40, 1)
_on(ACME_ALIAS, '"Pharma Shop" <sale@pills.example>',
    ["Limited offer"], 4, 30, 3)
# aliases that stayed clean
_on("travelly.q9@alias.example", '"Travelly" <hello@travelly.example>',
    ["Your trip is coming up", "Check in online", "Travel deals"], 21, 400, 2)
_on("chirper.k1@alias.example", '"Chirper" <notify@chirper-social.example>',
    ["You have new followers", "Weekly digest"], 58, 600, 1)
# a +tag for newsletters: nine senders
for _i, _dom in enumerate(["pixelpost", "greenfork", "bookbarn", "cityrun",
                           "tinytools", "gardenbox", "soundwave", "dailybake",
                           "nightowl"]):
    _on("demo+news@example.com", f'"{_dom.title()}" <news@{_dom}.example>',
        ["This week's issue", "Don't miss this"], 3 + _i % 3, 200 + _i * 17,
        4 + _i)
# a catch-all on the user's own domain, used by one sender
_on("library@example.com", '"City Library" <desk@city-library.example>',
    ["Your books are due", "New in the library"], 33, 800, 3)
# what a forwarding address of an old mailbox still delivers
for _i, _dom in enumerate(["ticketline", "oldclub", "parcelhub", "bankalert",
                           "newsroom", "travelnest", "photostore",
                           "homeshop", "quizzer", "recipebox"]):
    _on("old.demo@oldmail.example", f'"{_dom.title()}" <mail@{_dom}.example>',
        ["An update for you", "Still interested?"], 3, 900 - _i * 40,
        3 + _i * 30, original="old.demo@oldmail.example")

# --- Waiting for a reply -----------------------------------------------------
# Mail the demo user sent that nobody answered (Insights), and the small
# history behind it: people with earlier conversations that they answered
# after a day or three (so each has a "usual" time), one conversation that
# went on, newsletters of a sender that are no answer, a few answered mails
# and one marked "No answer needed". Deterministic (no random draws, UIDs from
# a range of their own), so the rest of the demo stays exactly as it was.
# Everything is dated relative to NOW. The proton demo account watches its
# sent mail (the switch is off by default; see demo_generate's scan below).
_WUID = iter(range(800_000, 900_000))
WAIT_IN: list[dict] = []
WAIT_SENT: list[dict] = []


def _w_in(frm: str, subject: str, days_ago: float, msgid: str, *, irt=None,
          refs=None, unsub=False, body=None) -> str:
    WAIT_IN.append(make_msg(
        next(_WUID), frm=frm, subject=subject, msgid=msgid, irt=irt,
        refs=refs, seen=True, size=3000, date=_date(days_ago),
        unsub="<https://unsub.example/u>" if unsub else None,
        body=body or "Noted - I will write back soon."))
    return msgid


def _w_out(to: str, subject: str, days_ago: float, msgid: str, *, irt=None,
           refs=None, body=None) -> str:
    WAIT_SENT.append(make_msg(
        next(_WUID), frm=ME, subject=subject, msgid=msgid, irt=irt, refs=refs,
        to=to, seen=True, size=2500, date=_date(days_ago),
        body=body or "Hello,\n\ncould you let me know? Thank you."))
    return msgid


def _w_history(who: str, tag: str, gaps: list[int], first: int = 80) -> None:
    """Earlier conversations with `who`, each answered after the given days."""
    for k, gap in enumerate(gaps):
        ago = first - 14 * k
        mid = _w_out(who, f"Earlier question {k + 1}", ago,
                     f"<wait-{tag}{k}@demo.example>")
        _w_in(who, f"Re: Earlier question {k + 1}", ago - gap,
              f"<wait-{tag}{k}-a@demo.example>", irt=mid, refs=[mid])


_TAX = '"Tax advisor" <steuerberater@kanzlei-brandt.example>'
_CLARA = '"Clara Neumann" <clara.neumann@mailfox.example>'
_LANDLORD = "vermieter@hausverwaltung-nord.example"
_TOBI = '"Tobi" <tobi@kletterhalle.example>'
_OPA = '"Opa" <opa@familienpost.example>'
# the tax advisor answered two earlier conversations after 2 and 4 days
_w_history(_TAX, "tax", [2, 4])
# the conversation behind the open mail: your question, their answer after 3
# days, your follow-up - which nobody answered
_w_out(_TAX, "Questions about 2024", 56, "<wait-x1@demo.example>")
_w_in(_TAX, "Re: Questions about 2024", 53, "<wait-x2@demo.example>",
      irt="<wait-x1@demo.example>", refs=["<wait-x1@demo.example>"])
_w_out(_TAX, "Documents for the 2025 tax return", 9, "<wait-x3@demo.example>",
       irt="<wait-x2@demo.example>",
       refs=["<wait-x1@demo.example>", "<wait-x2@demo.example>"])
# their newsletters since are no answer
for _i, _ago in enumerate([6, 2]):
    _w_in('"Kanzlei News" <news@kanzlei-brandt.example>',
          ["Tax calendar 2026", "New rules for home offices"][_i], _ago,
          f"<wait-n{_i}@demo.example>", unsub=True)
# the other open mails of the board, each with a history of its own
_w_history(_CLARA, "cl", [1, 1], 70)
_w_out(_CLARA, "Coffee next week?", 6, "<wait-o1@demo.example>")
_w_history(_LANDLORD, "ll", [2, 2], 75)
_w_out(_LANDLORD, "Question about the service charges", 5,
       "<wait-o2@demo.example>")
_w_history(_TOBI, "tb", [3, 3], 72)
_w_out(_TOBI, "Climbing on Saturday?", 2, "<wait-o3@demo.example>")
_w_history(_OPA, "op", [4, 4], 78)
_w_out(_OPA, "Photos from the weekend", 1, "<wait-o4@demo.example>")
# a sender that wrote first and got your answer, then went quiet again: open
# without a history (the days you set decide)
_w_in('"Bank of Example" <service@bank.example>', "Card replacement", 3,
      "<wait-o5a@demo.example>")
_w_out('"Bank of Example" <service@bank.example>', "Re: Card replacement", 1,
       "<wait-o5@demo.example>", irt="<wait-o5a@demo.example>",
       refs=["<wait-o5a@demo.example>"])
# mails that were answered
_m = _w_out('"Sam Lee" <sam@work.example>', "Meeting notes", 20,
            "<wait-a1@demo.example>")
_w_in('"Sam Lee" <sam@work.example>', "Re: Meeting notes", 19,
      "<wait-a1-a@demo.example>", irt=_m, refs=[_m])
_m = _w_out('"Pat Roe" <pat@club.example>', "Invoice question", 9,
            "<wait-a2@demo.example>")
_w_in('"Pat Roe" <pat@club.example>', "Re: Invoice question", 7,
      "<wait-a2-a@demo.example>", irt=_m, refs=[_m])
# a mail you decided needs no answer
_w_out('"City Library" <loans@library.example>',
       "Thank you for the quick reply", 12, "<wait-nn@demo.example>")


PROTON = _server({
    "INBOX": (PROTON_INBOX + PROTON_COPIES + PROTON_TAIL + ADDRESS_MAILS
              + WAIT_IN),
    "Sent": PROTON_TAIL_SENT + PROTON_SENT + WAIT_SENT + [make_msg(
        next(_UID), frm="Demo <demo@example.com>",
        subject="Re: Wanderung am Samstag?", msgid=WANDER_R1,
        irt=WANDER_1, refs=WANDER_1, to="anna.weber@mailfox.example",
        cc="praxis@dr-meier.example", seen=True, date=_date(4),
        body="Klingt gut, ich bringe Brote mit. Wann geht es los?\n\n"
             "Am Montag, 29. September 2026 um 09:12 schrieb Anna Weber "
             "<anna.weber@mailfox.example>:\n> Hi! Hast du am Samstag Zeit "
             "für eine Wanderung?")],
    "Trash": mails('"Old Newsletter" <bye@gone.example>',
                   ["We miss you!"], 34, unread=0.9)
    + mails('"Bergsport Huber" <newsletter@bergsport-huber.example>',
            ["Alte Aktion {n}"], 22, unread=0.2)
    + mails('"Ticket Shop" <orders@ticketshop.example>',
            ["Your order {n}", "Cancelled: {n}"], 14, unread=0.1),
    # Junk: a few invented senders, one of them a false alarm to rescue
    "Spam": mails('"Prize Desk" <win@prize-desk.example>',
                  ["You have won {n}", "Claim now"], 6, newest_days=0.5,
                  span_days=20, unread=0.9)
    + mails('"Cheap Meds" <offers@pharma-deals.example>',
            ["Limited offer {n}"], 4, newest_days=1.5, span_days=25,
            unread=0.9)
    + mails('"Anna Weber" <anna.weber@mailfox.example>',
            ["Fwd: Wanderkarte"], 1, newest_days=2, unread=1.0),
    # an ordinary folder that merely looks like Junk: Spam carries \Junk, so
    # the role is unambiguous (the demo's Junk / Trash actions all work)
    "Junk Email": mails('"Old Newsletter" <bye@gone.example>',
                        ["Special offer"], 3, unread=0.9),
    "Archive": PROTON_ARCHIVE,
    "Drafts": [],
}, flags={"Spam": "\\Junk", "Trash": "\\Trash"})

ICLOUD = _server({
    "INBOX": ICLOUD_INBOX + ICLOUD_COPIES,
    "Sent Messages": ICLOUD_SENT,
    "Deleted Messages": (
        mails('"Quick Bite" <deals@quickbite.example>',
              ["Your voucher expired", "Order #{n} delivered"], 26,
              unread=0.9)
        + mails('"Fit Club" <hello@fitclub.example>',
                ["Membership offer"], 12, unread=0.9)
        + mails('"Fruit Store" <receipts@fruitstore.example>',
                ["Your receipt #{n}"], 9, unread=0.2)),
    "Junk": mails('"Lotto Winner" <claim@lotto-prize.example>',
                  ["You are our lucky winner {n}", "Claim your prize"], 5,
                  newest_days=0.5, span_days=15, unread=0.9)
    + mails('"Crypto Gains" <invest@coin-boost.example>',
            ["Double your savings {n}"], 4, newest_days=1, span_days=20,
            unread=0.9)
    + mails('"Family Chat" <lisa@familienpost.example>',
            ["Fwd: Fotos von Oma"], 1, newest_days=2, unread=1.0),
    "Archive": ICLOUD_ARCHIVE,
    # a client-made look-alike of the server's Trash (Settings can move it)
    "Gelöschte Elemente": mails('"Cloud Photos" <no-reply@cloudphotos.example>',
                                ["Storage reminder"], 5, unread=0.5),
# a QUOTA the copy page reads its "has N free" line from (used / limit in KB)
}, flags={"Deleted Messages": "\\Trash", "Junk": "\\Junk"},
    quota=(1_900_000, 15_000_000))

# Every other mail was delivered to its account's main address.
for _box, _main in ((PROTON, MAIN_ADDR), (ICLOUD, "demo@icloud.example")):
    for _m in _box.mailbox["INBOX"]:
        if not _m.get("to") and not _m.get("delivered_to"):
            _m["delivered_to"] = _main

FAKES = {"demo-proton": PROTON, "demo-icloud": ICLOUD}

# Keep-safe (F103): a bank's terms notices, a booking, a job application and a
# mailer that mixes receipts with promotions (Unsubscribe + "Also move to
# Trash"), so a big cleanup of the demo mailbox shows the keep-safe box
# (invoices are in the data above). Added last and from its own random
# stream, so every other mail keeps its exact data and uid.
_state = random.getstate()
random.seed(103)
PROTON.mailbox["INBOX"] += mails(
    '"Bank of Example" <notices@bank-example.example>',
    ["Changes to our Terms of Service", "Privacy policy update",
     "Update zu unseren Allgemeinen Geschäftsbedingungen"], 4,
    newest_days=12, span_days=400, unread=0.2)
PROTON.mailbox["INBOX"] += (
    mails('"Travelly" <trips@travelly.example>',
          ["Your booking for 3 Dec", "Your e-ticket is ready"], 3,
          newest_days=20, span_days=200, unread=0.1)
    + mails('"Careers Example" <jobs@careers-example.example>',
            ["Your application was received", "Interview invitation"], 2,
            newest_days=30, span_days=120, unread=0.2))
PROTON.mailbox["INBOX"] += mails(
    '"Mixed Mailer" <hello@mixedmailer.example>',
    ["Your receipt {n}", "New deals this week", "Your invoice {n}"], 26,
    newest_days=3, span_days=300, unread=0.5, unsub=True)
random.setstate(_state)

# Your folders (IY123): folders of the Proton demo account's own - look-alike
# names, an empty one, one gone quiet, one its scan switch leaves out (see
# `generate`) and a label an exclude pattern keeps out. Invented senders. Added
# last and from its own random stream, so every other mail keeps its data.
_state = random.getstate()
random.seed(123)
_YOUR_FOLDERS = {
    "Bills": mails('"Utility Co" <bills@utility-co.example>',
                   ["Your bill for {n}", "Payment received {n}"], 38,
                   newest_days=3, span_days=500, unread=0.1),
    "Bills 2019": mails('"Utility Co" <bills@utility-co.example>',
                        ["Your bill for {n}", "Payment received {n}"], 12,
                        newest_days=2300, span_days=2420, unread=0.4),
    "bills-old": [],
    "Trips": mails('"Trips Example" <booking@trips-example.example>',
                   ["Your booking {n}", "Trip details"], 21,
                   newest_days=40, span_days=800, unread=0.2),
    "Newsletters 2019": mails('"Old Digest" <hello@old-digest.example>',
                              ["The weekly digest {n}"], 30,
                              newest_days=1900, span_days=2100, unread=0.97,
                              unsub=True),
    "Taxes": mails('"Tax Office" <service@tax-office.example>',
                   ["Your notice {n}"], 6, newest_days=170, span_days=500,
                   unread=0.0),
    "Old phone backup": mails('"Phone Sync" <sync@phone-sync.example>',
                              ["Backup {n}"], 15, newest_days=400,
                              span_days=900, unread=0.5),
    "Labels/Family": mails('"Family Chat" <circle@family-chat.example>',
                           ["Photos from the weekend"], 5, newest_days=9,
                           span_days=60, unread=0.4),
}
for _name, _msgs in _YOUR_FOLDERS.items():
    PROTON.mailbox[_name] = _msgs
    PROTON.uv[_name] = 1
# the "Labels" parent of Proton's label folders: it holds no mail
PROTON.mailbox["Labels"] = []
PROTON.uv["Labels"] = 1
PROTON.noselect["Labels"] = "\\Noselect"
random.setstate(_state)

# Your documents (IZ134): the papers of a few invented senders - an insurer's
# policy files, tickets, tax-office notices, a utility's yearly bill - added to
# the invoices, receipts and contracts the demo already has, so every kind of
# the page shows real files over three years. Added last and from its own
# random stream, so every other mail keeps its exact data and uid.
_state = random.getstate()
random.seed(134)
PROTON.mailbox["INBOX"] += (
    mails('"Insure Example" <service@insure.example>',
          ["Your policy documents", "Ihre Versicherungspolice {n}"], 3,
          newest_days=45, span_days=800, unread=0.1, size=(2200000, 2600000),
          atts=[("policy.pdf", 1250000), ("terms.pdf", 380000)], att_n=3)
    + mails('"Ticketline" <orders@ticketline.example>',
            ["Your tickets for 14 Dec", "Your e-ticket is ready",
             "Your tickets for the concert"], 5, newest_days=14,
            span_days=500, unread=0.1, size=(250000, 400000),
            atts=[("tickets.pdf", 220000)], att_n=5)
    + mails('"Finanzamt Musterstadt" <post@finanzamt-musterstadt.example>',
            ["Bescheid für 2025", "Bescheid für 2024", "Bescheid für 2023",
             "Ihre Steuererklärung ist eingegangen"], 4, newest_days=27,
            span_days=900, unread=0.0, size=(450000, 650000),
            atts=[("bescheid.pdf", 410000)], att_n=4)
    + mails('"Stadtwerke Example" <post@stadtwerke.example>',
            ["Ihre Jahresabrechnung {n}"], 3, newest_days=60, span_days=1000,
            unread=0.2, size=(450000, 650000),
            atts=[("jahresabrechnung.pdf", 412000)], att_n=3))
random.setstate(_state)


def _time_machine(now: float, box: FakeIMAP, sweep_id: str) -> tuple:
    """The Time machine's demo history of the Proton account: real undo steps
    over mails that really sit in its Trash / Archive (so a restore moves
    them), at fixed ages: a session of five steps ending ~65 minutes ago and
    older ones from yesterday, 4, 9 days ago (one by an assistant). Returns
    `(audit rows, user steps, assistant steps)`; the rows are tuples like the
    audit rows of `generate()` plus an extra-fields dict."""
    def mins(m: float) -> int:
        return int(now - m * 60)

    pool = {"Trash": {}, "Archive": {}}
    for folder in pool:
        for m in sorted(box.mailbox[folder], key=lambda x: x["uid"]):
            pool[folder].setdefault(
                m["from"].rsplit("<", 1)[-1].rstrip(">"), []).append(m)
    rows: list[tuple] = []
    users: list[dict] = []
    bots: list[dict] = []
    n = [0]

    def step(folder, addr, count, ts, action, label, actor="user", lost=0,
             bot=None):
        """Move `count` of the next mails of `addr` (from the folder's pool)
        into a step of `action` at `ts`."""
        n[0] += 1
        mine = pool[folder][addr][:count]
        del pool[folder][addr][:count]
        copies = [{"folder": "INBOX", "source_uid": 90000 + n[0] * 100 + i,
                   "msgid": m["msgid"], "uid": m["uid"],
                   "uv": box.uv[folder], "in": folder, "addr": addr,
                   "size": m["size"]} for i, m in enumerate(mine)]
        size = sum(m["size"] for m in mine)
        entry = {"id": f"tm{n[0]:02d}", "ts": ts, "label": label,
                 "action": action, "count": len(mine), "bytes": size,
                 "items": [("INBOX", c["msgid"]) for c in copies],
                 "in": folder, "quiet": False, "copies": copies,
                 "audit_id": f"tma{n[0]:02d}",
                 **({"lost": lost} if lost else {}),
                 **({"token": bot[0], "actor": bot[1]} if bot else {})}
        (bots if bot else users).append(entry)
        rows.append(("proton", action, ts, len(mine) + lost, "ok",
                     bot[1] if bot else actor, label,
                     {"id": entry["audit_id"], "bytes": size}))

    # today: marked read, a rule's sweep, six unsubscribes, an archive, a
    # trashing the Trash lost 12 mails of to Empty Trash, and that emptying
    rows.append(("proton", "protect", mins(101), 3, "ok", "user",
                 "anna.weber@mailfox.example, praxis@dr-meier.example, "
                 "@paybank.example", {}))
    rows.append(("proton", "mark_read", mins(98), 220, "ok", "user", "", {}))
    step("Trash", "newsletter@bergsport-huber.example", 22, mins(92), "trash",
         "Bergsport Huber", actor=f"rule:{sweep_id}")
    for i, addr in enumerate(("news@oldgazette.example",
                              "hello@retrodeals.example",
                              "weekly@citybulletin.example",
                              "offers@shopnow.example",
                              "digest@oldforum.example",
                              "hello@dealhunter.example")):
        rows.append(("proton", "unsubscribe", mins(88) + 7 * i, 1, "ok",
                     "user", addr, {}))
    step("Archive", "billing@cloudbox.example", 6, mins(84), "archive",
         "CloudBox, Finanzamt Musterstadt")
    step("Archive", "bescheid@finanzamt-musterstadt.example", 5, mins(83),
         "archive", "CloudBox, Finanzamt Musterstadt")
    step("Trash", "orders@ticketshop.example", 14, mins(77), "trash",
         "Ticket Shop", lost=12)
    rows.append(("proton", "empty_trash", mins(70), 12, "ok", "user", "", {}))
    # older sessions
    step("Trash", "bye@gone.example", 12, mins(26 * 60), "trash",
         "Old Newsletter")
    step("Archive", "kundenservice@greenenergy.example", 4,
         mins(26 * 60 - 4), "archive", "GreenEnergy AG")
    step("Trash", "bye@gone.example", 10, mins(4 * 24 * 60 + 300), "trash",
         "Old Newsletter", bot=("tok-demo", "mcp:Laptop"))
    step("Trash", "bye@gone.example", 12, mins(9 * 24 * 60 + 180), "trash",
         "Old Newsletter")
    step("Archive", "praxis@dr-meier.example", 3, mins(9 * 24 * 60 + 170),
         "archive", "Dr. Meier Praxis")
    return rows, users, bots


def generate() -> dict:
    """Fill the data dir, scan both accounts and return `{host: FakeIMAP}`."""
    def _connect(im, name=None):
        if im.get("host") not in FAKES:
            raise demo.refusal()          # "Add account" with a real server
        return FAKES[im["host"]]


    mailops.connect = _connect

    # Two configured, fully scanned accounts (hosts route to the fakes above).
    Path(os.environ["CONFIG_PATH"]).write_text(json.dumps({
        "accounts": {
            "proton": {"host": "demo-proton", "user": "demo@example.com",
                       "password": "demo", "preset": "proton", "cafile": "",
                       "body_search": "local",
                       # Your folders: one folder the scan switch leaves out
                       "excluded_folders": [*cfgmod.DEFAULT_EXCLUDED,
                                            "Old phone backup"]},
            "icloud": {"host": "demo-icloud", "user": "demo@icloud.example",
                       "password": "demo", "preset": "icloud", "cafile": ""},
        },
        "protected": ["anna.weber@mailfox.example", "@dr-meier.example"],
        "ai": {"provider": "anthropic", "api_key": "demo-key",
               "model": "claude-sonnet-5"},
    }))

    # The alias service the demo is connected to (the in-memory
    # DemoAliasService of demo.py): its alias list is read before the scan, so
    # the scan recognises the aliases. The key is stored as plain text on
    # purpose - the browser demo has no real encryption to open a sealed one.
    Path(os.environ["ALIAS_SERVICE_PATH"]).write_text(json.dumps(
        {"service": "simplelogin", "key": "demo-api-key"}))
    aliasservice.refresh()

    # Cached AI verdicts -> colored tags on the group rows.
    for key, verdict, reason in [
        ("news@acme-store.example", "delete_safe", "Promotional newsletter, never replied"),
        ("noreply@paketfix.example", "delete_safe", "Automated shipping notifications"),
        ("notify@chirper.example", "delete_safe", "Social media notifications"),
        ("digest@techdigest.example", "delete_safe", "Subscribed newsletter, low engagement"),
        ("info@streamly.example", "delete_safe", "Streaming service promotions"),
        ("newsletter@bergsport-huber.example", "review", "Shop newsletter with vouchers"),
        ("service@paybank.example", "review", "Bank statements and security notices"),
        ("billing@cloudbox.example", "review", "Invoices worth keeping"),
        ("jobs@jobportal.example", "delete_safe", "Job alerts, outdated quickly"),
        ("kundenservice@greenenergy.example", "keep", "Utility invoices and contract mail"),
        ("anna.weber@mailfox.example", "keep", "Personal correspondence, protected"),
        ("praxis@dr-meier.example", "keep", "Medical practice, protected sender"),
    ]:
        verdictstore.save("sender", {key: {"verdict": verdict, "reason": reason}},
                          "proton")

    for key, verdict, reason in [
        ("deals@quickbite.example", "delete_safe", "Food delivery promotions"),
        ("news@reisefieber.example", "delete_safe", "Travel newsletter, never opened"),
        ("hello@fitclub.example", "delete_safe", "Gym marketing after the trial"),
        ("programm@kino-zentral.example", "delete_safe", "Weekly cinema programme"),
        ("no-reply@cloudphotos.example", "review", "Storage notices and memories"),
        ("receipts@fruitstore.example", "review", "Receipts you may need for returns"),
        ("post@hausverwaltung-nord.example", "keep", "Rental contract and utility statements"),
        ("lisa@familienpost.example", "keep", "Family, photos from relatives"),
    ]:
        verdictstore.save("sender", {key: {"verdict": verdict, "reason": reason}},
                          "icloud")

    # Unsubscribe records for the watchdog: three "done" senders whose mail kept
    # arriving (flagged "Still mailing"), one that went quiet (just a tick), and
    # a confirmation-page ("link") and a failed attempt that must NOT be flagged.
    _UN_NOW = int(NOW)
    unsubstore.save({
        "news@acme-store.example": {"status": "done", "method": "one-click",
            "detail": "", "error": "", "ts": _UN_NOW - 40 * 86400},
        "notify@chirper.example": {"status": "done", "method": "mailto",
            "detail": "", "error": "", "ts": _UN_NOW - 120 * 86400},
        "jobs@jobportal.example": {"status": "done",
            "method": "confirmed by hand", "detail": "", "error": "",
            "ts": _UN_NOW - 300 * 86400},
        "digest@techdigest.example": {"status": "done", "method": "one-click",
            "detail": "", "error": "", "ts": _UN_NOW - 86400},
        "info@streamly.example": {"status": "link", "method": "",
            "detail": "https://streamly.example/stop", "error": "",
            "ts": _UN_NOW - 200 * 86400},
        "newsletter@bergsport-huber.example": {"status": "failed", "method": "",
            "detail": "", "error": "HTTP 500", "ts": _UN_NOW - 200 * 86400},
    }, "proton")

    # The unsubscribe the Coupon Club sender already went through (card 3).
    unsubstore.record("offers@couponclub.example", "done", "one-click",
                      account="proton")

    # iCloud: one done (and quiet since), one that kept mailing, one that
    # needs a confirmation page.
    unsubstore.save({
        "deals@quickbite.example": {"status": "done", "method": "one-click",
            "detail": "", "error": "", "ts": _UN_NOW - 4 * 86400},
        "hello@fitclub.example": {"status": "done", "method": "mailto",
            "detail": "", "error": "", "ts": _UN_NOW - 400 * 86400},
        "programm@kino-zentral.example": {"status": "link", "method": "",
            "detail": "https://kino-zentral.example/abmelden", "error": "",
            "ts": _UN_NOW - 30 * 86400},
    }, "icloud")

    # Per-mail ratings on the PayBank group -> rating chips. Plausible ones:
    # statements and payments are worth a look, security notices are kept,
    # only the promotional mails are safe to delete.
    def _paybank_rating(subject: str) -> str:
        if subject.startswith("Offer"):
            return "delete_safe"
        return "keep" if subject.startswith("Security") else "review"


    paybank = [m for m in PROTON_INBOX if "paybank" in m["from"]]
    verdictstore.save_mails(
        {m["msgid"]: _paybank_rating(m["subject"]) for m in paybank})

    # A saved rule + cleanup history for the stats panel.
    sweep = rules.create_rule({"name": "Sweep old newsletters",
                               "query": "is:unsub age:>1y", "action": "trash",
                               "schedule": "manual", "account": "proton"})
    parcels = rules.create_rule({"name": "Archive old parcel mails",
                                 "query": "tag:shipping age:>1y",
                                 "action": "archive", "schedule": "manual",
                                 "account": "proton"})
    lapsed = rules.create_rule({"name": "Sweep lapsed promotions",
                                "query": "is:unsub age:>1y unread:>90",
                                "action": "trash", "schedule": "manual",
                                "account": "icloud"})
    # Three more for the Rule checkup: two that clash (the sweep above trashes
    # what "keep the latest 5" leaves), one whose target folder is not on the
    # server, one that has found nothing for weeks.
    keep5 = rules.create_rule({
        "name": "Keep the latest 5 of every newsletter",
        "query": "tag:newsletter", "action": "trash", "keep_latest": 5,
        "schedule": "daily", "account": "proton"})
    receipts = rules.create_rule({
        "name": "Receipts into their own folder", "query": "tag:finance age:>3m",
        "action": "move", "dest": "Receipts", "schedule": "weekly",
        "account": "proton"})
    tickets = rules.create_rule({
        "name": "Archive old event tickets", "query": "tag:travel age:>6m",
        "action": "archive", "schedule": "weekly", "account": "proton"})
    _ic = ICLOUD.mailbox["INBOX"]
    _icn, _icb = len(_ic), sum(m["size"] for m in _ic)
    history = {"accounts": {"proton": {
        "scans": [{"ts": int(NOW - d * 86400), "mails": m, "size": s,
                   "senders": g}
                  for d, m, s, g in [(21, 1108, 301_000_000, 15),
                                     (14, 1041, 274_000_000, 14),
                                     (7, 933, 247_000_000, 14),
                                     (1, 824, 205_000_000, 13)]],
        "actions": {
            "2025-11": {"trash": 90, "archive": 8, "move": 0, "mark_read": 0,
                        "freed": 0},
            "2026-03": {"trash": 142, "archive": 33, "move": 0, "mark_read": 12,
                        "freed": 0, "purge": 60, "purged_bytes": 41_000_000},
            time.strftime("%Y-%m", time.gmtime(NOW - 62 * 86400)):
                {"trash": 214, "archive": 40, "move": 0, "mark_read": 120,
                 "freed": 61_000_000},
            time.strftime("%Y-%m", time.gmtime(NOW - 31 * 86400)):
                {"trash": 187, "archive": 12, "move": 30, "mark_read": 0,
                 "freed": 48_000_000},
            time.strftime("%Y-%m", time.gmtime(NOW)):
                {"trash": 284, "archive": 25, "move": 0, "mark_read": 66,
                 "freed": 96_000_000},
        }}}}
    history["accounts"]["icloud"] = {
        "scans": [{"ts": int(NOW - d * 86400), "mails": int(_icn * f),
                   "size": int(_icb * f), "senders": g}
                  for d, f, g in [(21, 0.86, 70), (14, 0.9, 74), (7, 0.95, 77),
                                  (1, 1.0, 80)]],
        "actions": {
            time.strftime("%Y-%m", time.gmtime(NOW - 31 * 86400)):
                {"trash": 96, "archive": 20, "move": 0, "mark_read": 40,
                 "freed": 22_000_000},
            time.strftime("%Y-%m", time.gmtime(NOW)):
                {"trash": 61, "archive": 5, "move": 0, "mark_read": 12,
                 "freed": 15_000_000},
        }}
    # Audit entries (the cleanup card of Your year in mail): unsubscribes and
    # rule runs in 2026 + 2025, at varied times of day, in date order. The
    # rules that ran carry the same run as their last run (Rules panel).
    _hours = random.Random(5)

    def _t(days_ago: float) -> int:
        return int(NOW - days_ago * 86400 - _hours.uniform(0, 23) * 3600)

    # (the stored label of an unsubscribe is the sender's address)
    _au = [("proton", "unsubscribe", _t(40), 1, "ok", "user",
            "news@oldgazette.example"),
           ("proton", "unsubscribe", _t(120), 1, "ok", "user",
            "hello@retrodeals.example"),
           ("proton", "unsubscribe", _t(300), 1, "ok", "user",
            "weekly@citybulletin.example"),
           ("proton", "unsubscribe", _t(30), 1, "failed", "user",
            "hello@dealhunter.example"),
           ("proton", "unsubscribe", _t(420), 1, "ok", "user",
            "digest@oldgazette.example"),
           ("icloud", "unsubscribe", _t(4), 1, "ok", "user",
            "offers@shopnow.example"),
           ("icloud", "unsubscribe", _t(400), 1, "ok", "user",
            "news@citybulletin.example")]
    # the Time machine's history (see _time_machine): its steps are real
    # cleaning, so they are in the log and in this month's statistics too
    _tm_rows, _tm_user, _tm_bots = _time_machine(NOW, PROTON, sweep["id"])
    _au.extend(_tm_rows)
    # "You keep doing this": cleanups the visitor did by hand again and again
    # (the habit miner reads what a manual step records: the sender key, how
    # many mails were unread and how old the youngest was). Fixed days and
    # hours, no random draws, so nothing else in the log changes.
    for _key, _act, _lbl, _steps in (
            ("prizes@win-big.example", "trash", "Prize Center",
             # (days ago, mails, unread, youngest mail in days)
             [(18, 9, 9, 6), (15, 8, 8, 5), (11, 7, 7, 4), (7, 8, 8, 5),
              (2, 9, 9, 3)]),
            ("photos@mailfox.example", "archive", "Mailfox Photos",
             [(24, 5, 2, 9), (17, 6, 3, 8), (10, 5, 1, 10), (3, 6, 2, 7)]),
            # two days so far: trashing this sender once more, by hand, on a
            # third day makes the suggestion appear (the toast's Automate…)
            ("hi@cryptodaily.example", "trash", "Crypto Daily",
             [(12, 3, 3, 6), (6, 2, 2, 5)])):
        for _d, _n, _unread, _young in _steps:
            _au.append(("proton", _act, int(NOW - _d * 86400 - 9 * 3600), _n,
                        "ok", "user", _lbl,
                        {"keys": [_key], "unread": _unread,
                         "youngest_days": _young}))
    # the three Rule checkup rules draw their times from a generator of their
    # own, so the stamps of everything above and below stay what they were
    _hours2 = random.Random(11)

    def _t2(days_ago: float) -> int:
        return int(NOW - days_ago * 86400 - _hours2.uniform(0, 23) * 3600)

    def _ran(rule, ts, count, groups, created):
        """The rule is Active and its last run was `ts` (an audit entry is
        written by the caller)."""
        with rules._LOCK:
            stored = rules.load_rules()
            r = next(x for x in stored if x["id"] == rule["id"])
            r.update(mode="execute", created=created, edited=created,
                     report_runs=1, report_sig=rules.definition_sig(r),
                     report_box=rules.box_sig(r), report_at=ts - 86400,
                     last_run={"ts": ts, "mode": "execute", "groups": groups,
                               "mails": count, "acted": count, "capped": 0,
                               "skipped_protected": 0, "skipped_pinned": 0,
                               "preview": [], "error": ""})
            rules._save(stored)

    for rule, d, count in ((sweep, 21, 150), (parcels, 14, 60),
                           (lapsed, 9, 48)):
        ts = _t(d)
        _au.append((rule["account"], "rule_execute", ts, count, "ok",
                    f"rule:{rule['id']}", rule["name"]))
        _ran(rule, ts, count, 4, ts - 30 * 86400)
    # Your folders: an Active rule that files the old bills (its folder is a
    # look-alike of "Bills"); it ran once, three days ago, with nothing to do
    bills = rules.create_rule({
        "name": "Old bills to their folder", "query": "from:bills@utility-co.example",
        "action": "move", "dest": "Bills 2019", "schedule": "weekly",
        "account": "proton"})
    _bills_ts = int(NOW - 3 * 86400)
    _au.append(("proton", "rule_execute", _bills_ts, 0, "ok",
                f"rule:{bills['id']}", bills["name"]))
    _ran(bills, _bills_ts, 0, 0, int(NOW - 40 * 86400))
    # Mute this conversation: the Team dinner thread was muted two days ago;
    # its rule archived and marked read the two mails that came after (they
    # are in Archive), and stays armed. It runs after each scan, which the
    # demo never does, so this is what a day of using it looks like.
    _muted_at = int(NOW - 2 * 86400)
    muted = rules.create_rule({
        "name": f"Mute: {TEAM_SUBJECT}", "grouping": "thread",
        "query": f"thread:{TEAM_KEY}", "action": rules.ARCHIVE_READ,
        "schedule": rules.AFTER_SCAN, "account": "proton",
        "origin": rules.ORIGIN_MUTE,
        "mute": {"key": TEAM_KEY, "since": _muted_at,
                 "senders": ["kim@team.example", "lee@team.example",
                             "noa@team.example"],
                 "ids": [TEAM_1, TEAM_2, TEAM_3],
                 "done": ["<team-4@demo.example>", "<team-5@demo.example>"]}})
    _ran(muted, int(NOW - 0.7 * 86400), 2, 1, _muted_at)
    # keep-latest runs every day; the receipts rule ran a month ago (before
    # its folder went away); the ticket rule has run weekly and found nothing
    for rule, d, count, groups, created in (
            (keep5, 1, 52, 9, _t2(60)), (receipts, 33, 6, 2, _t2(70))):
        ts = _t2(d)
        _au.append((rule["account"], "rule_execute", ts, count, "ok",
                    f"rule:{rule['id']}", rule["name"]))
        _ran(rule, ts, count, groups, created)
    _created = _t2(62)
    for d in (55, 48, 41, 34, 27, 20, 13, 6):
        ts = _t2(d)
        _au.append(("proton", "rule_execute", ts, 0, "ok",
                    f"rule:{tickets['id']}", tickets["name"]))
    _ran(tickets, ts, 0, 0, _created)
    # "This month" must read the same on Activity (audit log), Statistics
    # (history) and Sign-in & users (history, all accounts). The history above
    # is the figure; the log gets the user's own moves to make up what the
    # month's rule runs do not already cover (and the history grows to match
    # if a rule run alone exceeds it - the rule runs fall in this calendar
    # month on some days of the month only).
    _ym = time.strftime("%Y-%m", time.gmtime(NOW))
    _month_start = calendar.timegm(
        time.strptime(_ym + "-01", "%Y-%m-%d"))
    _rule_action = {sweep["name"]: "trash", parcels["name"]: "archive",
                    lapsed["name"]: "trash", keep5["name"]: "trash",
                    receipts["name"]: "archive", tickets["name"]: "archive",
                    bills["name"]: "move"}
    _labels = {"trash": ["Old newsletters", "Expired promotions",
                         "Past order updates"],
               "archive": ["Receipts to keep", "Travel confirmations"]}
    for _acct in ("proton", "icloud"):
        _month = history["accounts"][_acct]["actions"][_ym]
        for _action in ("trash", "archive"):
            _have = sum(e[3] for e in _au
                        if e[0] == _acct and e[4] == "ok"
                        and time.strftime("%Y-%m", time.gmtime(e[2])) == _ym
                        and (e[1] == _action
                             or (e[1] == "rule_execute"
                                 and _rule_action[e[6]] == _action)))
            _rest = _month[_action] - _have
            if _rest < 0:
                _month[_action] = _have
                continue
            _parts = [_rest // 3, _rest // 3, _rest - 2 * (_rest // 3)]
            for _i, (_n, _frac) in enumerate(zip(_parts, (0.2, 0.55, 0.85))):
                if _n > 0:
                    _au.append((_acct, _action,
                                int(_month_start + (NOW - _month_start) * _frac),
                                _n, "ok", "user",
                                _labels[_action][_i % len(_labels[_action])]))
    Path(os.environ["STATS_HISTORY_PATH"]).write_text(json.dumps(history))
    _au.sort(key=lambda e: e[2])
    Path(os.environ["AUDIT_LOG_PATH"]).write_text("".join(
        json.dumps({"ts": ts, "account": acct, "actor": actor,
                    "action": action, "count": count, "bytes": 0,
                    "label": label, "outcome": outcome,
                    "error": "unsub_no_method" if outcome == "failed" else "",
                    **(extra[0] if extra else {})})
        + "\n"
        for acct, action, ts, count, outcome, actor, label, *extra in _au))
    Path(os.environ["STATS_PATH"]).write_text(json.dumps(
        {"input_tokens": 412_331, "output_tokens": 60_112, "cost": 1.43,
         "runs": 9, "months": {time.strftime("%Y-%m"): 0.38}}))

    # Sender knowledge (what the user filed in Smart): a regular bill filed under
    # Other, a sign-up sender under Accounts, a company entry that has no effect
    # (the company has a row of its own), a kept AI answer and an entry nobody
    # matches - every status the Settings table can show.
    _NOW = int(NOW)
    knowledgestore.modify(lambda entries: entries.update({
        "a:billing@juniper-pay.example": {
            "kind": "other", "src": "user", "ts": _NOW - 86400 * 5,
            "note": ""},
        "a:noreply@cobalt-app.example": {
            "kind": "accounts", "src": "user", "ts": _NOW - 86400 * 3, "note": ""},
        "co:paymate.example": {
            "kind": "support", "src": "user", "ts": _NOW - 86400 * 2,
            "note": ""},
        "a:noreply@dune-app.example": {
            "kind": "support", "src": "ai", "ts": _NOW - 86400, "note": ""},
        "a:ghost@nowhere.example": {
            "kind": "jobs", "src": "user", "ts": _NOW - 86400 * 30,
            "note": ""},
    }))

    for fake in FAKES.values():
        for box in fake.mailbox.values():
            _stub(box)

    # Pre-scan both accounts (incl. attachments) so screenshots are instant. The
    # Proton demo also builds its local body index, which is where the tracker
    # report (Tools -> Trackers) comes from; iCloud stays without one (empty state).
    # The proton demo watches its sent mail for replies (off by default).
    waitstore.set_watch(True, "proton")
    for name in ("proton", "icloud"):
        acc = accounts.get(name)
        mailops.run_scan(acc)
        mailops._run_atts(acc)
        if name == "proton":
            bodyindex.sync(acc)
        st = mailops.public_state(acc)
        print(f"[demo] {name}: {len(st['groups']['sender'])} senders, "
              f"{sum(g['count'] for g in st['groups']['sender'].values())} mails")
    # New senders (Overview's Last week row and the Weekly check-in's first
    # step): a dozen of the small senders turned up this week. The scans above
    # are the baseline (every sender known since forever), so their first-seen
    # times are set by hand, spread over the last five days; the ones you can
    # unsubscribe from come first, so the step shows all three of its buttons.
    _groups = mailops.public_state(accounts.get("proton"))["groups"]["sender"]
    _small = sorted(((not g["unsub"], g["count"], key)
                     for key, g in _groups.items()
                     if not g["protected"] and not g["unsubscribed"]
                     and not g.get("still_mailing")))
    _known = knownsenders._read()
    for _i, (_no_unsub, _n, _key) in enumerate(_small[:12]):
        _known["accounts"]["proton"]["addrs"][_key] = int(
            NOW - (0.5 + _i % 5) * 86400)
    knownsenders._write(_known)
    # Waiting for a reply: "No answer needed" on one mail and a reminder on the
    # tax advisor's, as the board shows.
    waitstore.set_needed("<wait-nn@demo.example>", True, "proton")
    waitstore.set_reminder("<wait-x3@demo.example>",
                           int(NOW // 86400 + 1) * 86400 + 9 * 3600, "proton")
    # A few pinned mails (by Message-ID) of a protected sender, so the
    # "Pinned mails" row of Move to another account has something to count
    # (and a mail that is both counts once). A protected sender: the demo
    # e2e's delete / rule steps only pick unprotected ones.
    for m in sorted((m for m in accounts.get("proton").index.values()
                     if m["addr"] == "anna.weber@mailfox.example"),
                    key=lambda m: m["uid"])[:3]:
        pinstore.set_pinned(m["msgid"], True, "proton")
    # Your documents: the newest tax notice is kept safe, as the board shows
    for m in [m for m in accounts.get("proton").index.values()
              if m["subject"] == "Bescheid für 2025"][:1]:
        pinstore.set_pinned(m["msgid"], True, "proton")
    # "Same mails in several accounts": three of the forwarded copies are pinned
    # in iCloud (they stay when its copies go), the dozen that "Move to another
    # account" brought over are on record.
    pinstore.set_many({m["msgid"] for m in ICLOUD_FWD[:3]}, True, "icloud")
    copystore.record("proton", "icloud", [m["msgid"] for m in ICLOUD_MOVED])
    # Bodies come last: the Proton body index above must not hold them (see
    # fill_bodies).
    for fake in FAKES.values():
        for box in fake.mailbox.values():
            fill_bodies(box)
    # the Time machine's steps (their audit rows are in the log above); put
    # on the account last: the scans above never touch the undo lists
    proton = accounts.get("proton")
    with proton.lock:
        proton.undo_log[:] = sorted(_tm_user, key=lambda e: e["ts"])
        proton.assistant_undo[:] = sorted(_tm_bots, key=lambda e: e["ts"])
        mailops._sync_undo(proton)
    mailops.flush_undo(proton)
    return FAKES
