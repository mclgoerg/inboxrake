"""Waiting for a reply: the mails you sent that nobody has answered.

The Sent folder is read for headers only (Message-ID, date, subject, From, To /
Cc, In-Reply-To, References - never a body) into a small per-account index of
the last 90 days (waitstore.py). From that index and the scan's own index of
received mail, a sent mail is OPEN when

- it went to at least one person: your own addresses, no-reply style
  addresses and list / newsletter senders are not people;
- it is your LATEST mail of its conversation (the same Message-ID /
  In-Reply-To / References chain as the Conversation view: connected
  components of the id graph), and no mail from one of those people is newer
  in that conversation. Their newsletters (List-Unsubscribe) are never an
  answer;
- it is not marked "No answer needed".

It is OVERDUE once it has been open longer than the person usually takes to
answer (the median over their earlier answered conversations, at least
MIN_SAMPLES of them, and never less than a day) - or, without that history or
with "Fixed days" (Settings > Notifications), longer than 2 / 3 / 7 days.

Nothing is ever sent as you. The whole thing is off per account until the
user switches "Watch my sent mail for replies" on (Settings > Account): off
reads nothing extra and keeps no index. A reminder (Web Push, plus a line in
the digest) is something the person asked for - per mail ("Remind me") or for
every overdue reply (Settings > Notifications) - fires once and is dropped
when the answer arrives. Local only, no AI.
"""

from __future__ import annotations

import email
import imaplib
import logging
import math
import statistics
import threading
import time
from email.utils import getaddresses
from typing import NamedTuple

from . import accounts
from . import smartkinds
from . import tenants
from . import waitstore

log = logging.getLogger("inboxrake.waiting")

DAY = 86400
RECENT_DAYS = 3          # "sent in the last 3 days"
SHARE_DAYS = 30          # "got an answer · 30 days"
MIN_SAMPLES = 2          # earlier answered conversations for a "usual" time
SUBJECT_MAX = 150
NAME_MAX = 60
TO_MAX = 20              # recipients kept per sent mail
TIMELINE_MAX = 12
ANSWERED_MAX = 100       # answered rows listed (the count is the full one)
REMINDER_MAX_DAYS = 366  # how far ahead a reminder may be set
FIRED_SHOWN = 3 * DAY
ALERT_MAX_PER_TICK = 3   # "no answer yet" pushes per account and tick
TICK_SECONDS = 300
ROLE_FOLDERS = ("trash", "junk")   # cached role folders that count as answers

_HEADERS = ("FROM TO CC SUBJECT MESSAGE-ID IN-REPLY-TO REFERENCES")


# ----------------------------------------------------------- the sent index

def _addresses(*values) -> list[tuple[str, str]]:
    """[(address, display name)] of header values, lower-cased, de-duplicated,
    in order."""
    from . import mailops
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for name, addr in getaddresses([mailops.header_text(v) for v in values]):
        addr = addr.strip().lower()
        if addr and "@" in addr and addr not in seen:
            seen.add(addr)
            out.append((addr, mailops.decode_mime(name)[:NAME_MAX]
                        if name else ""))
    return out


def _record(meta: bytes, header: bytes) -> dict | None:
    """One index record from a FETCH answer, or None (no usable Message-ID,
    date or UID)."""
    from . import mailops
    m = mailops._UID_RE.search(meta)
    tt = imaplib.Internaldate2tuple(meta)
    if not m or not tt:
        return None
    msg = email.message_from_bytes(header)
    ids = mailops.header_ids(mailops.header_text(msg.get("Message-ID")))
    if not ids:
        return None
    sender = _addresses(msg.get("From"))
    return {
        "uid": int(m.group(1)), "id": ids[0][:waitstore.ID_MAX],
        "ts": int(time.mktime(tt)),
        "subj": mailops.decode_mime(msg.get("Subject", ""))[:SUBJECT_MAX],
        "from": sender[0][0] if sender else "",
        "to": [list(p) for p in _addresses(
            *msg.get_all("To", []), *msg.get_all("Cc", []))][:TO_MAX],
        "irt": mailops.header_ids(
            mailops.header_text(msg.get("In-Reply-To")))[:1],
        "refs": mailops.capped_refs(mailops.header_ids(
            mailops.header_text(msg.get("References")))),
    }


def update_sent_index(conn, roles: dict, acc, progress_cb=None) -> int | None:
    """Bring the account's sent index up to date over the scan's own
    connection: the last INDEX_DAYS days of the Sent folder, headers only,
    and only the UIDs the index does not hold yet (a UIDVALIDITY change reads
    it all again). Returns the number of mails now indexed, or None when
    nothing was done (watching is off, no Sent folder, a failure - the old
    index stays). With watching off (the default) the index is dropped and
    nothing extra is read."""
    from . import mailops
    if not waitstore.load_account(acc.name)["watch"]:
        waitstore.drop_index(acc.name)
        return None
    target = roles.get("sent")
    if not target:
        return None
    try:
        status, _ = conn.select(mailops.quote_folder(target), readonly=True)
        if status != "OK":
            return None
        uv = mailops.uidvalidity(conn)
        cutoff = time.time() - waitstore.INDEX_DAYS * DAY
        status, data = conn.uid("SEARCH", None, "SINCE",
                                mailops._imap_date(cutoff))
        if status != "OK":
            return None
        uids = data[0].split() if data and data[0] else []
        old = waitstore.load_index(acc.name)
        reuse = old["folder"] == target and old["uv"] == uv
        have = {m["uid"]: m for m in old["mails"]} if reuse else {}
        want = {int(u) for u in uids}
        kept = [m for u, m in have.items() if u in want and m["ts"] >= cutoff]
        new = [u for u in uids if int(u) not in have]
        fresh: list[dict] = []
        for start in range(0, len(new), mailops.FETCH_CHUNK):
            if mailops.cancel_requested("scan", acc):
                raise mailops.Cancelled()
            chunk = new[start:start + mailops.FETCH_CHUNK]
            if progress_cb:
                progress_cb(target, min(start + len(chunk), len(new)),
                            len(new))
            status, rows = conn.uid(
                "FETCH", b",".join(chunk).decode(),
                f"(UID INTERNALDATE BODY.PEEK[HEADER.FIELDS ({_HEADERS})])")
            if status != "OK":
                continue
            for item in rows or []:
                if not isinstance(item, tuple) or len(item) < 2:
                    continue
                try:
                    rec = _record(item[0], item[1])
                except Exception:
                    log.warning("skipping unparseable Sent message",
                                exc_info=True)
                    continue
                if rec and rec["ts"] >= cutoff:
                    fresh.append(rec)
        mails = sorted(kept + fresh, key=lambda r: (r["ts"], r["uid"]))
        waitstore.save_index(target, uv, mails, acc.name)
        return len(mails)
    except mailops.Cancelled:
        raise
    except Exception as exc:
        log.warning("[%s] sent index not updated: %s", acc.name,
                    type(exc).__name__)
        return None


# --------------------------------------------------------------- the matcher

class _In(NamedTuple):
    """What the matcher needs of one received mail."""
    ids: tuple[str, ...]
    ts: int
    addr: str
    name: str
    bulk: bool
    subject: str
    folder: str
    uid: int


class _Union:
    """Union-find over message ids (the conversation graph)."""

    def __init__(self):
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def link(self, ids: list[str]) -> None:
        for other in ids[1:]:
            a, b = self.find(ids[0]), self.find(other)
            if a != b:
                self.parent[max(a, b)] = min(a, b)


def _incoming(acc) -> list[_In]:
    from . import mailops
    out = []
    with acc.lock:
        # the scanned folders, plus the cached Trash and Junk: an answer you
        # binned or that landed in Junk is still an answer
        mails = [*acc.index.values(),
                 *(m for role in ROLE_FOLDERS
                   for m in acc.role_index.get(role, {}).values())]
    for m in mails:
        ids = tuple(i for i in [mailops._own_id(m), *(m.get("irt") or []),
                                *(m.get("refs") or [])] if i)
        out.append(_In(ids, m["ts"] or 0, m["addr"], m["name"],
                       bool(m["bulk"]), m["subject"], m["folder"],
                       m["uid"]))
    return out


def _own_addresses(acc, sent: list[dict]) -> set[str]:
    """Every address the user writes from: the From of the sent mails, the
    account's own address and its aliases."""
    from . import addresses, aliasservice
    own = {r["from"] for r in sent if r["from"]}
    try:
        own.add(addresses.main_address(acc))
        own.update(a.lower() for a in aliasservice.cached_aliases())
    except Exception:
        log.warning("[%s] own addresses unavailable", acc.name, exc_info=True)
    own.discard("")
    return own


def _company(addr: str) -> str:
    """The company a work address belongs to ("Shop" for jane@mail.shop.example),
    "" on a freemail domain or a shared platform host: a push may carry a
    name, never part of an address."""
    company = smartkinds.company_id(addr.rpartition("@")[2])
    return company.partition(".")[0].capitalize() if company else ""


def _is_automated(addr: str) -> bool:
    return bool(smartkinds.AUTOMATED_RE.match(addr.partition("@")[0]))


class Analysis(NamedTuple):
    block: dict
    settings: dict
    typical: float | None
    items: list[dict]
    sent_by_comp: dict[str, list[dict]]
    in_by_comp: dict[str, list[_In]]
    incoming: list[_In]
    qualifying: list[dict]
    scanned: bool
    now: float


def _ceil_days(seconds: float) -> int:
    return max(1, math.ceil(seconds / DAY))


def _limit(settings: dict, usual: float | None) -> float:
    """Seconds after which an open mail counts as overdue: what this person
    usually takes (never under a day), or - without that history, or with
    "Fixed days" - the days of the setting."""
    if settings["mode"] == "usual" and usual is not None:
        return max(usual, DAY)
    return settings["days"] * DAY


def analyse(acc, now: float | None = None) -> Analysis:
    """Everything the page, the badge, the Overview line, the reminders and
    the digest derive from: one pass over the sent index and the scan index.
    Nothing here touches the mail server."""
    now = time.time() if now is None else now
    block = waitstore.load_account(acc.name)
    settings = waitstore.load_settings()
    sent = waitstore.load_index(acc.name)["mails"] if block["watch"] else []
    incoming = _incoming(acc) if sent else []
    with acc.lock:
        scanned = acc.state.get("scanned_ts") is not None
    own = _own_addresses(acc, sent)
    # list senders: an address that only ever sent bulk mail
    bulk_only = {i.addr for i in incoming if i.bulk} \
        - {i.addr for i in incoming if not i.bulk}
    names: dict[str, str] = {}
    for i in sorted(incoming, key=lambda i: i.ts):
        if i.name and not i.bulk:
            names[i.addr] = i.name

    people_cache: dict[str, list[tuple[str, str]]] = {}

    def people(rec: dict) -> list[tuple[str, str]]:
        got = people_cache.get(rec["id"])
        if got is None:
            got = people_cache[rec["id"]] = [
                (a, n) for a, n in rec["to"]
                if a not in own and not _is_automated(a)
                and a not in bulk_only]
        return got

    graph = _Union()
    for rec in sent:
        graph.link([rec["id"], *rec["irt"], *rec["refs"]])
    for i in incoming:
        if i.ids:
            graph.link(list(i.ids))
    sent_by_comp: dict[str, list[dict]] = {}
    for rec in sent:
        sent_by_comp.setdefault(graph.find(rec["id"]), []).append(rec)
    in_by_comp: dict[str, list[_In]] = {}
    if sent_by_comp:
        for i in incoming:
            if i.ids and not i.bulk and i.ts:
                root = graph.find(i.ids[0])
                if root in sent_by_comp:
                    in_by_comp.setdefault(root, []).append(i)

    # how long each person usually takes: per conversation, the first answer
    # from them after the first mail you sent them
    samples: dict[str, dict[str, float]] = {}
    for root, recs in sent_by_comp.items():
        first: dict[str, int] = {}
        for rec in recs:
            for a, _n in people(rec):
                first[a] = min(first.get(a, rec["ts"]), rec["ts"])
        for a, t0 in first.items():
            got = [i.ts for i in in_by_comp.get(root, ()) if i.addr == a
                   and i.ts > t0]
            if got:
                samples.setdefault(a, {})[root] = min(got) - t0

    # how fast your contacts answer you, all in all (the page's third figure)
    gaps = [g for per in samples.values() for g in per.values()]
    typical = statistics.median(gaps) if len(gaps) >= MIN_SAMPLES else None

    needed = set(block["needed"])
    items: list[dict] = []
    for root, recs in sent_by_comp.items():
        last = max(recs, key=lambda r: (r["ts"], r["uid"]))
        who = people(last)
        if not who:
            continue
        addrs = {a for a, _n in who}
        later = [i.ts for i in in_by_comp.get(root, ()) if i.addr in addrs
                 and i.ts > last["ts"]]
        answered = min(later) if later else None
        state = "answered" if answered else (
            "needed" if last["id"] in needed else "open")
        addr, name = who[0]
        known = name or names.get(addr)
        earlier = [d for r, d in samples.get(addr, {}).items() if r != root]
        usual = statistics.median(earlier) \
            if len(earlier) >= MIN_SAMPLES else None
        age = max(0, int(now - last["ts"]))
        limit = _limit(settings, usual)
        rem = block["reminders"].get(last["id"])
        items.append({
            "id": last["id"], "uid": last["uid"], "state": state,
            "person": {"addr": addr, "name": known or addr},
            "_push_name": (known if known and "@" not in known else "")
            or _company(addr),
            "subject": last["subj"], "ts": last["ts"], "age": age,
            "days": age // DAY,
            "overdue": state == "open" and age > limit,
            "late": age - limit,
            "limit_days": _ceil_days(limit),
            "usual_days": _ceil_days(usual) if usual is not None else None,
            "usual_n": len(earlier) if usual is not None else 0,
            "answered_ts": answered,
            "answered_days": max(0, (answered - last["ts"]) // DAY)
            if answered else None,
            "recipients": len(who),
            "reminder": {"at": rem["at"], "fired": rem["fired"]}
            if rem and state == "open" else None,
            "_root": root, "_addrs": addrs, "_limit": limit,
        })
    items.sort(key=lambda it: (-it["late"], -it["ts"], it["id"])
               if it["state"] == "open" else (0, -it["ts"], it["id"]))
    qualifying = [r for r in sent if people(r)]
    return Analysis(block, settings, typical, items, sent_by_comp, in_by_comp,
                    incoming, qualifying, scanned, now)


def _public(it: dict) -> dict:
    return {k: v for k, v in it.items() if not k.startswith("_")
            and k != "late"}


def listing(acc, now: float | None = None) -> dict:
    """The page's data: counts, the three figures, the open / answered /
    not-needed rows (answered are capped; the count is the full one) and the
    summary behind the Last week row and the phone card."""
    a = analyse(acc, now)
    items = a.items
    opened = [i for i in items if i["state"] == "open"]
    answered = [i for i in items if i["state"] == "answered"]
    skipped = [i for i in items if i["state"] == "needed"]
    overdue = [i for i in opened if i["overdue"]]
    people: list[str] = []
    seen: set[str] = set()
    for i in overdue:
        if i["person"]["addr"] not in seen:
            seen.add(i["person"]["addr"])
            people.append(i["person"]["name"])
    oldest = max(overdue, key=lambda i: i["age"], default=None)
    return {
        "watching": a.block["watch"], "scanned": a.scanned,
        "mode": a.settings["mode"], "days": a.settings["days"],
        "counts": {"open": len(opened), "answered": len(answered),
                   "needed": len(skipped)},
        "kpis": {"overdue": len(overdue), "open": len(opened),
                 "typical_days": round(a.typical / DAY, 1)
                 if a.typical is not None else None},
        "summary": {"watching": a.block["watch"], "overdue": len(overdue),
                    "open": len(opened), "people_n": len(people),
                    "people": people[:3],
                    "more": max(0, len(people) - 3),
                    "oldest_days": oldest["days"] if oldest else 0,
                    "oldest_usual": oldest["usual_days"] if oldest else None},
        "items": [_public(i) for i in
                  [*opened, *answered[:ANSWERED_MAX], *skipped]],
    }


def summary(acc, now: float | None = None) -> dict:
    """The Last week row / phone card figures only (see `listing`)."""
    return listing(acc, now)["summary"]


def for_sender(acc, addr: str, now: float | None = None) -> dict | None:
    """The mail you are waiting on from this address (the sender pane's one
    line): the oldest open one, or None."""
    addr = addr.strip().lower()
    if not addr or not waitstore.load_account(acc.name)["watch"]:
        return None
    a = analyse(acc, now)
    mine = [i for i in a.items if i["state"] == "open"
            and addr in i["_addrs"]]
    if not mine:
        return None
    it = min(mine, key=lambda i: i["ts"])
    return {"id": it["id"], "ts": it["ts"], "days": it["days"],
            "overdue": it["overdue"], "usual_days": it["usual_days"],
            "subject": it["subject"]}


def detail(acc, msgid: str, now: float | None = None) -> dict:
    """One row's conversation as a timeline, the sent mail "Read conversation"
    opens, and the newsletters of that sender since. ValueError when the
    mail is not (or no longer) in the list."""
    from . import addresses
    a = analyse(acc, now)
    it = next((i for i in a.items if i["id"] == msgid), None)
    if it is None:
        raise ValueError("unknown mail")
    root, addrs = it["_root"], it["_addrs"]
    ins = a.in_by_comp.get(root, [])
    events = [{"ts": r["ts"], "kind": "out", "who": "", "subject": r["subj"],
               "_addr": ""} for r in a.sent_by_comp[root]]
    for i in ins:
        events.append({"ts": i.ts, "kind": "in", "_addr": i.addr,
                       # "" = the person you wrote to ("They" in the pane)
                       "who": "" if i.addr == it["person"]["addr"]
                       else (i.name or i.addr.partition("@")[0]),
                       "subject": i.subject[:SUBJECT_MAX]})
    events.sort(key=lambda e: (e["ts"], e["kind"] == "in"))
    for n, e in enumerate(events):
        if e["kind"] != "out":
            continue
        after = events[n + 1:]
        # answered: one of the people you wrote to answers before your next mail
        nxt = next((x for x in after if x["kind"] == "in"
                    and x["_addr"] in addrs), None)
        out_between = next((x for x in after if x["kind"] == "out"), None)
        e["answered_ts"] = nxt["ts"] if nxt and (
            out_between is None or nxt["ts"] <= out_between["ts"]) else None
    events = [{k: v for k, v in e.items() if k != "_addr"}
              for e in events[-TIMELINE_MAX:]]
    party = addresses.party_of(it["person"]["addr"])
    news = sum(1 for i in a.incoming if i.bulk and i.ts > it["ts"]
               and (i.addr in addrs or addresses.party_of(i.addr) == party))
    with acc.lock:
        folder = acc.folder_roles.get("sent") or ""
    # "Read conversation" opens the reading view from your sent mail: it finds
    # the whole conversation from there (mailops.thread_conversation)
    return {"id": msgid, "timeline": events, "newsletters": news,
            "sent": {"folder": folder, "uid": it["uid"]}}


# ------------------------------------------------- the conversation view

def _sent_rows(recs: list[dict], folder: str) -> list[dict]:
    """Sent-index records as the reading view's rows (headers only)."""
    return [{"uid": r["uid"], "folder": folder,
             "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(r["ts"])),
             "ts": r["ts"], "subject": r["subj"], "addr": r["from"],
             "size": 0, "seen": True, "ai": None, "pinned": False,
             "sent": True} for r in recs]


def _own_ids(m: dict) -> list[str]:
    """A scanned mail's own Message-ID and the ids it points at."""
    from . import mailops
    return [i for i in [mailops._own_id(m), *(m.get("irt") or []),
                        *(m.get("refs") or [])] if i]


def conversation_sent(acc, ids: set[str]) -> list[dict]:
    """Rows for the mails you sent in the conversation that holds any of
    `ids` (the ids of its scanned mails), read from the sent index: the
    reading view shows your open mail - nobody answered it, so no scanned
    mail points at it - and the ones nobody replied to. Empty while the
    account does not watch its sent mail."""
    if not ids or not waitstore.load_account(acc.name)["watch"]:
        return []
    idx = waitstore.load_index(acc.name)
    if not idx["mails"] or not idx["folder"]:
        return []
    graph = _Union()
    for rec in idx["mails"]:
        graph.link([rec["id"], *rec["irt"], *rec["refs"]])
    graph.link(sorted(ids))
    roots = {graph.find(i) for i in ids}
    return _sent_rows([r for r in idx["mails"]
                       if graph.find(r["id"]) in roots], idx["folder"])


def sent_anchor(acc, folder: str, uid: int) -> dict | None:
    """The conversation of a mail you sent, when (folder, uid) is one of the
    indexed ones: {"label", "members": [(folder, uid)] of the scanned mails,
    "sent": rows of your mails}. None otherwise (an unwatched account, any
    other folder)."""
    if not waitstore.load_account(acc.name)["watch"]:
        return None
    idx = waitstore.load_index(acc.name)
    rec = next((r for r in idx["mails"] if r["uid"] == uid), None)
    if rec is None or idx["folder"] != folder:
        return None
    graph = _Union()
    for r in idx["mails"]:
        graph.link([r["id"], *r["irt"], *r["refs"]])
    with acc.lock:
        scanned = [(m["folder"], m["uid"], _own_ids(m))
                   for m in acc.index.values()]
    for _f, _u, ids in scanned:
        if ids:
            graph.link(ids)
    root = graph.find(rec["id"])
    return {"label": rec["subj"],
            "members": [(f, u) for f, u, ids in scanned
                        if ids and graph.find(ids[0]) == root],
            "sent": _sent_rows([r for r in idx["mails"]
                                if graph.find(r["id"]) == root],
                               idx["folder"])}


# ---------------------------------------------------------- user decisions

def _open_item(acc, msgid: str, now: float | None = None) -> dict:
    a = analyse(acc, now)
    it = next((i for i in a.items if i["id"] == msgid), None)
    if it is None:
        raise ValueError("unknown mail")
    return it


def set_needed(acc, msgid: str, needed: bool) -> dict:
    """"No answer needed" (or bring the mail back). Its reminder goes with it."""
    _open_item(acc, msgid)
    waitstore.set_needed(msgid, needed, acc.name)
    if needed:
        waitstore.drop_reminders([msgid], acc.name)
    return {"ok": True, "needed": needed}


def set_reminder(acc, msgid: str, at: int | None,
                 now: float | None = None) -> dict:
    """Remind about an open mail at `at` (epoch seconds, not in the past, not
    beyond a year); None cancels."""
    now = time.time() if now is None else now
    it = _open_item(acc, msgid, now)
    if at is not None:
        if it["state"] != "open":
            raise ValueError("this mail is not waiting")
        if not now - 60 <= at <= now + REMINDER_MAX_DAYS * DAY:
            raise ValueError("the reminder time is out of range")
    waitstore.set_reminder(msgid, at, acc.name)
    return {"ok": True, "at": at}


def settings_view(acc) -> dict:
    """What Settings shows: this account's switch and the per-user
    notification settings."""
    block = waitstore.load_account(acc.name)
    return {"watch": block["watch"], **{
        k: v for k, v in waitstore.load_settings().items()
        if k != "notify_since"}}


def set_watch(acc, watch: bool) -> dict:
    """"Watch my sent mail for replies" for this account. Off drops the index
    and its reminders, and reads nothing extra from then on."""
    waitstore.set_watch(watch, acc.name)
    if not watch:
        waitstore.drop_index(acc.name)
    return settings_view(acc)


def set_settings(acc, watch: bool | None = None, notify: bool | None = None,
                 mode: str | None = None, days: int | None = None,
                 subject: bool | None = None) -> dict:
    """Settings, Account: this account's `watch` switch. Settings,
    Notifications: `notify`, `mode`, `days`, `subject` (per user). Everything
    is checked before anything is written."""
    if days is not None and days not in waitstore.DAY_CHOICES:
        raise ValueError("days must be 2, 3 or 7")
    if mode is not None and mode not in waitstore.MODES:
        raise ValueError("mode must be usual or fixed")
    if watch is not None:
        set_watch(acc, watch)
    waitstore.set_settings(notify, mode, days, subject)
    return settings_view(acc)


# ---------------------------------------------------------------- reminders

def clear_answered(acc, a: Analysis | None = None) -> int:
    """Drop the reminders and announcements whose mail is no longer waiting
    (answered, marked not needed, or replaced by a newer mail of yours): they
    clear by themselves."""
    block = waitstore.load_account(acc.name)
    if not block["watch"] or not (block["reminders"] or block["alerted"]):
        return 0
    a = a or analyse(acc)
    if not a.scanned:
        return 0
    open_ids = {i["id"] for i in a.items if i["state"] == "open"}
    gone = [i for i in (*a.block["reminders"], *a.block["alerted"])
            if i not in open_ids]
    return waitstore.drop_reminders(gone, acc.name) if gone else 0


def _push(acc, it: dict, subject: bool) -> None:
    """The push for one waiting mail: who, how long, how long they usually
    take. The subject only when the person switched that on."""
    from . import webpush
    extra = {"subject": it["subject"]} if subject and it["subject"] else {}
    webpush.waiting(acc, name=it["_push_name"], days=it["days"],
                    usual=it["usual_days"], ref=it["id"], **extra)


def tick_account(acc, now: float | None = None) -> int:
    """Announce what is due in one account: the reminders set on single mails
    and - with "Tell me when a reply is overdue" - the mails that became
    overdue since that was switched on. Each goes out once. Returns how many
    went out."""
    now = time.time() if now is None else now
    block = waitstore.load_account(acc.name)
    if not block["watch"]:
        return 0
    settings = waitstore.load_settings()
    due = any(not r["fired"] and r["at"] <= now
              for r in block["reminders"].values())
    # nothing due and nobody asked about overdue mail: no pass at all
    if not due and not settings["notify"]:
        return 0
    a = analyse(acc, now)
    if not a.scanned:
        return 0
    clear_answered(acc, a)
    sent = 0
    by_id = {i["id"]: i for i in a.items if i["state"] == "open"}
    for msgid, r in block["reminders"].items():
        it = by_id.get(msgid)
        if it is None or r["fired"] or r["at"] > now:
            continue
        if not waitstore.mark_fired(msgid, int(now), acc.name):
            continue
        _push(acc, it, settings["subject"])
        sent += 1
    if settings["notify"]:
        left = ALERT_MAX_PER_TICK
        for it in sorted(by_id.values(), key=lambda i: i["ts"]):
            if left <= 0:
                break
            # a mail with a reminder of its own is the person's choice of
            # time; a mail that was overdue before the switch went on is no
            # news (the page lists it)
            if not it["overdue"] or it["id"] in block["reminders"] \
                    or it["id"] in block["alerted"] \
                    or it["ts"] + it["_limit"] < settings["notify_since"]:
                continue
            if waitstore.mark_alerted(it["id"], int(now), acc.name):
                _push(acc, it, settings["subject"])
                sent += 1
                left -= 1
    return sent


def _announced(block: dict, now: float, within: float = float("inf")
               ) -> dict[str, int]:
    """{message-id: when} of the reminders that fired and the overdue mails
    that were announced (within `within` seconds)."""
    out = {i: r["fired"] for i, r in block["reminders"].items()
           if r["fired"] and now - r["fired"] < within}
    out.update({i: ts for i, ts in block["alerted"].items()
                if now - ts < within})
    return out


def recent_reminders(acc, now: float | None = None) -> list[dict]:
    """The reminders and announcements of the last days whose mail still
    waits, for an open page to show once."""
    now = time.time() if now is None else now
    block = waitstore.load_account(acc.name)
    # the page asks every minute: skip the graph when nothing can show
    got = _announced(block, now, FIRED_SHOWN) if block["watch"] else {}
    if not got:
        return []
    a = analyse(acc, now)
    return [{"id": it["id"], "ts": got[it["id"]],
             "name": it["person"]["name"], "days": it["days"]}
            for it in a.items if it["state"] == "open" and it["id"] in got]


def reminded(acc, now: float | None = None) -> list[str]:
    """Names of the people behind reminders / announcements that went out and
    still wait: the digest's line."""
    now = time.time() if now is None else now
    block = waitstore.load_account(acc.name)
    got = _announced(block, now) if block["watch"] else {}
    if not got:
        return []
    a = analyse(acc, now)
    names: list[str] = []
    for it in a.items:
        if it["state"] == "open" and it["id"] in got \
                and it["person"]["name"] not in names:
            names.append(it["person"]["name"])
    return names


def tick(now: float | None = None) -> None:
    for tenant in tenants.known():
        with tenants.use(tenant):
            for name in accounts.names():
                try:
                    tick_account(accounts.get(name), now)
                except KeyError:
                    continue                 # account was deleted
                except Exception:
                    log.exception("[%s] waiting reminders failed", name)


def after_scan(acc) -> None:
    """A scan ended: answers that arrived clear their reminders. Never raises."""
    try:
        clear_answered(acc)
    except Exception:
        log.exception("[%s] could not clear answered reminders", acc.name)


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
                log.exception("waiting reminder tick failed")

    threading.Thread(target=loop, daemon=True).start()
