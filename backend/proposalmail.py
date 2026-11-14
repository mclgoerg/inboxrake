"""Alerts for a rule an AI assistant has proposed (`propose_rule`).

Three channels besides the in-app toast and badges (which the UI makes from
the rules it is sent): a Web Push (backend/webpush.py, short generic text),
and an email through the proposal's account (smtpout, like the activity
digest) to the digest recipient or else the account's own address. The email
is on by default (`assistants_notify.email` in the tenant's settings) and
BATCHED: at most one mail per tenant every EMAIL_WINDOW seconds; proposals
that arrive inside the window wait and go out together ("2 new proposals")
when it ends. An account that cannot send (no recipient, no credentials) is
skipped without an error; Settings shows a hint.

The proposal's name and filter are written by the assistant: they appear as
plain text (control characters removed, cut), never as links - the only link
is Inboxrake's own address from the digest's link setting. The pending batch
lives in memory: a restart forgets it (the proposals themselves stay).

Pure Python (the browser demo bundles every backend module); the demo has no
MCP endpoint, so nothing here runs there."""

from __future__ import annotations

import html as htmlmod
import logging
import re
import threading
import time
import unicodedata

from . import auditlog
from . import config as cfgmod
from . import demo
from . import smtpout
from . import tenants
from . import webpush

log = logging.getLogger("inboxrake.proposalmail")

EMAIL_WINDOW = 600              # seconds: one mail per tenant at most
NAME_MAX = 80
QUERY_MAX = 200
SOURCE_MAX = 60
ROUTE = "/#/rules"             # where "Review in Inboxrake" lands

_LOCK = threading.Lock()
# tenant id -> {"last": time of the last mail, "pending": [entry], "timer": t}
_state: dict[str, dict] = {}


def _now() -> float:
    return time.time()


def _start_timer(delay: float, fn, *args) -> object:
    """Run `fn` after `delay` seconds on a daemon timer (tests replace it)."""
    timer = threading.Timer(delay, fn, args)
    timer.daemon = True
    timer.start()
    return timer


def _async(fn, *args) -> None:
    """Run `fn` off the request thread: an SMTP server can take its time and
    the assistant's call must not wait for it (tests run it inline)."""
    threading.Thread(target=fn, args=args, daemon=True).start()


def plain(text, limit: int) -> str:
    """Assistant-written text as one line of plain text: control and format
    characters dropped, whitespace collapsed, cut to `limit`."""
    out = []
    for c in str(text if text is not None else ""):
        cat = unicodedata.category(c)
        if c.isspace() or cat in ("Zl", "Zp"):
            out.append(" ")
        elif cat not in ("Cc", "Cf", "Cs", "Co", "Cn"):
            out.append(c)
    s = " ".join("".join(out).split())
    return s if len(s) <= limit else s[:limit - 1] + "…"


_DOT = re.compile(r"(?<=\w)\.(?=\w)")


def defang(text: str) -> str:
    """Assistant-written text with its addresses broken up so a mail app
    does not turn them into links: `.` between word characters becomes
    `[.]`, and `://` becomes `[://]`."""
    return _DOT.sub("[.]", text.replace("://", "[://]"))


def notify(acc, rule: dict, token_name: str, report: dict) -> None:
    """A proposal was made: push and (batched) email. Returns at once and
    never raises - the proposal stands whatever happens here."""
    try:
        if demo.enabled():
            return
        webpush.job_finished(acc, "proposal", True)
        with tenants.use(acc.tenant):
            if not cfgmod.load_config()["assistants_notify"]["email"]:
                return
            tenant = tenants.current()
        _queue_email(tenant, {
            "account": acc.name, "source": plain(token_name, SOURCE_MAX),
            "name": plain(rule.get("name"), NAME_MAX),
            "query": plain(rule.get("query"), QUERY_MAX),
            "grouping": rule.get("grouping") or "sender",
            "action": rule.get("action") or "",
            "dest": plain(rule.get("dest"), SOURCE_MAX),
            "schedule": rule.get("schedule") or "manual",
            "mails": int(report.get("mails") or 0),
            "groups": int(report.get("groups") or 0),
            "skipped": int(report.get("skipped_protected") or 0)})
    except Exception:
        log.exception("could not alert about a proposal")


def _queue_email(tenant, entry: dict) -> None:
    """Send now when the window is free, else hold the entry for the mail
    that ends the window."""
    with _LOCK:
        st = _state.setdefault(tenant.id, {"last": 0.0, "pending": [],
                                           "timer": None})
        st["pending"].append(entry)
        wait = st["last"] + EMAIL_WINDOW - _now()
        if wait > 0:
            if st["timer"] is None:
                st["timer"] = _start_timer(wait, _flush, tenant)
            return
        batch, st["pending"], st["last"] = st["pending"], [], _now()
    _async(_send_safely, tenant, batch)


def _send_safely(tenant, batch: list[dict]) -> None:
    try:
        _send(tenant, batch)
    except Exception:
        log.exception("could not send the proposal mail")


def _flush(tenant) -> None:
    with _LOCK:
        st = _state.get(tenant.id)
        if st is None:
            return
        st["timer"] = None
        batch, st["pending"], st["last"] = st["pending"], [], _now()
    if batch:
        _send_safely(tenant, batch)


def _send(tenant, batch: list[dict]) -> None:
    with tenants.use(tenant):
        cfg = cfgmod.load_config()
        if not cfg["assistants_notify"]["email"]:
            return                           # switched off while it waited
        for entry in batch:                  # the first account that can send
            block = cfg["accounts"].get(entry["account"])
            if block and cfgmod.can_send_mail(block):
                break
        else:
            return                           # skipped silently
        to = cfgmod.mail_recipient(block)
        d = block.get("digest") or {}
        lang = d.get("lang") if d.get("lang") in STRINGS else "en"
        subject, text, html = compose(lang, batch, d.get("url") or "")
        smtpout.send(block, to, subject, text, html,
                     account_name=entry["account"])
        auditlog.record("proposal_mail_sent",
                        account=entry["account"], count=len(batch), label=to,
                        outcome="ok")
        log.info("proposal alert mailed (%d proposal(s))", len(batch))


# ------------------------------------------------------------------ texts

STRINGS = {
    "en": {
        "subject_one": "Inboxrake: {source} proposes a rule",
        "subject_other": "Inboxrake: {n} new rule proposals",
        "intro_one": "Your AI assistant {source} proposes a rule for "
                     "{account}. Nothing has moved yet.",
        "intro_other": "Your AI assistants propose {n} new rules. Nothing "
                       "has moved yet.",
        "rule_line": "{grouping} groups matching {query} → {action}{dest} "
                     "· {schedule}",
        "counts": "{mails} mails from {groups} senders · {skipped} "
                  "protected senders skipped",
        "grouping_sender": "Sender", "grouping_domain": "Domain",
        "action_trash": "move to Trash", "action_archive": "archive",
        "action_move": "move to", "action_mark_read": "mark as read",
        "schedule_manual": "manual", "schedule_daily": "daily",
        "schedule_weekly": "weekly",
        "button": "Review in Inboxrake",
        "why": "You get this because email alerts are on in Settings › "
               "AI assistants.",
        "defang": "Addresses are shown with [.] so mail apps don't turn "
                  "them into links.",
    },
    "de": {
        "subject_one": "Inboxrake: {source} schlägt eine Regel vor",
        "subject_other": "Inboxrake: {n} neue Regelvorschläge",
        "intro_one": "Dein KI-Assistent {source} schlägt eine Regel für "
                     "{account} vor. Es wurde noch nichts verschoben.",
        "intro_other": "Deine KI-Assistenten schlagen {n} neue Regeln vor. "
                       "Es wurde noch nichts verschoben.",
        "rule_line": "{grouping}-Gruppen, die {query} entsprechen → "
                     "{action}{dest} · {schedule}",
        "counts": "{mails} Mails von {groups} Absendern · {skipped} "
                  "geschützte Absender übersprungen",
        "grouping_sender": "Absender", "grouping_domain": "Domain",
        "action_trash": "in den Papierkorb", "action_archive": "archivieren",
        "action_move": "verschieben nach",
        "action_mark_read": "als gelesen markieren",
        "schedule_manual": "manuell", "schedule_daily": "täglich",
        "schedule_weekly": "wöchentlich",
        "button": "In Inboxrake ansehen",
        "why": "Du bekommst das, weil E-Mail-Hinweise in Einstellungen › "
               "KI-Assistenten an sind.",
        "defang": "Adressen stehen mit [.], damit Mail-Apps keine Links "
                  "daraus machen.",
    },
}


def _rule_line(S: dict, e: dict) -> str:
    return S["rule_line"].format(
        grouping=S.get("grouping_" + e["grouping"], e["grouping"]),
        query=e["query"], action=S.get("action_" + e["action"], e["action"]),
        dest=" " + e["dest"] if e["dest"] else "",
        schedule=S.get("schedule_" + e["schedule"], e["schedule"]))


def compose(lang: str, batch: list[dict], url: str) -> tuple[str, str, str]:
    """-> (subject, plain text, HTML) for a batch of proposals. `url` is the
    app address from the digest settings ("" leaves the link out)."""
    S = STRINGS[lang]
    n = len(batch)
    first = batch[0]
    source = defang(first["source"])
    subject = S["subject_one" if n == 1 else "subject_other"].format(
        source=source, n=n)
    intro = S["intro_one" if n == 1 else "intro_other"].format(
        source=source, account=first["account"], n=n)
    link = url.rstrip("/") + ROUTE if url else ""
    blocks = [(defang(e["name"]), defang(_rule_line(S, e)),
               S["counts"].format(
        mails=e["mails"], groups=e["groups"], skipped=e["skipped"]))
        for e in batch]
    text = "\n\n".join([intro] + ["\n".join(b) for b in blocks]
                       + ([f"{S['button']}: {link}"] if link else [])
                       + [S["defang"], S["why"]])
    esc = htmlmod.escape
    box = "".join(
        '<div style="background:#f4f1ec;border-radius:8px;padding:12px;'
        'margin:0 0 10px"><div style="font-weight:600">%s</div>'
        '<div style="color:#6b6760;font-size:13px">%s</div>'
        '<div style="margin-top:6px">%s</div></div>'
        % (esc(a), esc(b), esc(c)) for a, b, c in blocks)
    button = ('<p><a href="%s" style="background:#9a5b0a;color:#ffffff;'
              'padding:9px 16px;border-radius:8px;text-decoration:none;'
              'font-weight:600">%s</a></p>'
              % (esc(link, quote=True), esc(S["button"]))) if link else ""
    html = ('<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,'
            'sans-serif;font-size:15px;color:#1c1b19;max-width:520px">'
            '<p>%s</p>%s%s<p style="color:#6b6760;font-size:12px">%s<br>%s</p>'
            '</div>' % (esc(intro), box, button, esc(S["defang"]),
                        esc(S["why"])))
    return subject, text, html
