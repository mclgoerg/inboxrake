"""Per-account daily/weekly activity digest email.

"Your week" for one account, laid out like the app's Overview: a balance
block (arrived / cleaned up / mailbox size with the change since the last
digest, 8 weeks of bars), "Needs you" (still mailing after unsubscribe, Junk,
AI safe-to-delete - each with a button into the app when the account has a
"Link to Inboxrake" address) and "What happened" as sentences, from the audit
log (trash / deleted for good + freed, rules by name, unsubscribes). Sent as
multipart/alternative (plain text + HTML built from tables and inline styles
only, no external assets - see smtpout.send). The mail is English or German
(the account's digest `lang`); every literal string lives in STRINGS below.
Schedule + recipient + link + language live in the account's own config
block (see config.DIGEST_SCHEDULES); `last_sent` is a small per-tenant file,
following the same pattern as mailops.py's replied.json (per-account,
atomic write).

No empty digests: a send is skipped entirely when nothing happened in
the period - callers (the scheduler and the /test endpoint) both see
that via send_digest()'s return value instead of a mail going out.
"""

from __future__ import annotations

import datetime
import json
import logging
import html as htmlmod
import os
import re
import threading
import time
from pathlib import Path

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import labelstore
from . import mailops
from . import overview as overviewmod
from . import rules as rulesmod
from . import smtpout
from . import stats as statsmod
from . import tenants
from . import unsubstore
from . import verdictstore

log = logging.getLogger("inboxrake.digest")


def _masked(addr: str) -> str:
    """'jane@example.com' -> 'j***@example.com' for log lines: enough to
    tell which recipient was used, without writing the full address to the
    server log (the audit log keeps it for the account owner)."""
    local, at, domain = addr.partition("@")
    return f"{local[:1]}***{at}{domain}" if at else "***"

DIGEST_PATH = Path(os.environ.get("DIGEST_PATH", "/data/digest.json"))
CHECK_INTERVAL = int(os.environ.get("DIGEST_INTERVAL", "1800"))  # seconds

_PERIOD_DAYS = {"daily": 1, "weekly": 7}

_LOCK = threading.Lock()

_EN = {
    "subject": "Your week: {arrived} in, {cleaned} cleaned up",
    "subject_7d": "Last 7 days: {arrived} in, {cleaned} cleaned up",
    "preview_prefix": "Preview - ",
    "title": "Your week in your inbox",
    "title_7d": "Your inbox, last 7 days",
    "window": "Last 7 days",
    "happened_since": "What happened since {since}",
    "junk_replied_one": "{k} from someone you replied to",
    "junk_replied_other": "{k} from people you replied to",
    "arrived": "arrived",
    "cleaned": "cleaned up",
    "mailbox": "mailbox",
    "size_less": "{size} less",
    "size_more": "{size} more",
    "weeks_ago": "8 weeks ago",
    "this_week": "this week",
    "bars_alt": "Mails per week, oldest first - arrived: {arrived}; "
                "cleaned up: {cleaned}",
    "needs_you": "Needs you",
    "still_one": "{n} still mailing after you unsubscribed",
    "still_other": "{n} still mailing after you unsubscribed",
    "still_sub_one": "{m} mail since you unsubscribed",
    "still_sub_other": "{m} mails since you unsubscribed",
    "junk_one": "{n} mail in Junk",
    "junk_other": "{n} mails in Junk",
    "ai_one": "The AI says {n} mail can go",
    "ai_other": "The AI says {n} mails can go",
    "btn_block": "Block",
    "btn_look": "Look",
    "btn_review": "Review",
    "btn_rules": "Rules",
    "happened": "What happened",
    "trash": "{n} moved to Trash",
    "purge": "{n} deleted for good",
    "freed": "{size} freed",
    "tidied_archive": "{n} archived",
    "tidied_move": "{n} moved to a folder",
    "tidied_read": "{n} marked as read",
    "rule_one": "Rule \"{name}\" ran {runs} time",
    "rule_other": "Rule \"{name}\" ran {runs} times",
    "rules_many": "{rules} rules ran {runs} times",
    "rule_sub_one": "{mails} mail handled",
    "rule_sub_other": "{mails} mails handled",
    "rules_top": "most: \"{name}\"",
    "preview_one": "{n} mail waiting in a rule preview",
    "preview_other": "{n} mails waiting in rule previews",
    "preview_sub": "A report-mode rule matched them - nothing was moved. "
                   "Switch it to Execute if it looks right.",
    "unsub_done": "{n} unsubscribed",
    "unsub_attempts": "{n} unsubscribe attempts",
    "unsub_link": "{n} waiting for your confirmation",
    "unsub_failed": "{n} failed",
    "footer": "Sent by Inboxrake.",
    "open_app": "Open Inboxrake",
    "demo_banner":
        "PREVIEW with made-up example data - nothing below has actually "
        "happened yet. Do some cleanup, then send another test to see "
        "your real activity.",
    "months": ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
               "Sep", "Oct", "Nov", "Dec"),
    "day": "{d} {m}",
    "demo_name": "Old newsletters",
}

_DE = {
    "subject": "Deine Woche: {arrived} rein, {cleaned} aufgeräumt",
    "subject_7d": "Letzte 7 Tage: {arrived} rein, {cleaned} aufgeräumt",
    "preview_prefix": "Vorschau - ",
    "title": "Deine Woche im Postfach",
    "title_7d": "Dein Postfach, letzte 7 Tage",
    "window": "Letzte 7 Tage",
    "happened_since": "Was passiert ist seit {since}",
    "junk_replied_one": "{k} von jemandem, dem du geantwortet hast",
    "junk_replied_other": "{k} von Leuten, denen du geantwortet hast",
    "arrived": "angekommen",
    "cleaned": "aufgeräumt",
    "mailbox": "Postfach",
    "size_less": "{size} weniger",
    "size_more": "{size} mehr",
    "weeks_ago": "vor 8 Wochen",
    "this_week": "diese Woche",
    "bars_alt": "Mails pro Woche, älteste zuerst - angekommen: {arrived}; "
                "aufgeräumt: {cleaned}",
    "needs_you": "Braucht dich",
    "still_one": "{n} schreibt trotz Abmeldung weiter",
    "still_other": "{n} schreiben trotz Abmeldung weiter",
    "still_sub_one": "{m} Mail seit der Abmeldung",
    "still_sub_other": "{m} Mails seit der Abmeldung",
    "junk_one": "{n} Mail im Junk-Ordner",
    "junk_other": "{n} Mails im Junk-Ordner",
    "ai_one": "Die KI sagt: {n} Mail kann weg",
    "ai_other": "Die KI sagt: {n} Mails können weg",
    "btn_block": "Blockieren",
    "btn_look": "Ansehen",
    "btn_review": "Prüfen",
    "btn_rules": "Regeln",
    "happened": "Was passiert ist",
    "trash": "{n} in den Papierkorb",
    "purge": "{n} endgültig gelöscht",
    "freed": "{size} frei",
    "tidied_archive": "{n} archiviert",
    "tidied_move": "{n} in Ordner verschoben",
    "tidied_read": "{n} als gelesen markiert",
    "rule_one": "Regel „{name}“ lief {runs}-mal",
    "rule_other": "Regel „{name}“ lief {runs}-mal",
    "rules_many": "{rules} Regeln liefen {runs}-mal",
    "rule_sub_one": "{mails} Mail bearbeitet",
    "rule_sub_other": "{mails} Mails bearbeitet",
    "rules_top": "meist: „{name}“",
    "preview_one": "{n} Mail wartet in einer Regel-Vorschau",
    "preview_other": "{n} Mails warten in Regel-Vorschauen",
    "preview_sub": "Eine Regel im Berichtsmodus hat sie gefunden - nichts "
                   "wurde verschoben. Stell sie auf Ausführen, wenn es "
                   "passt.",
    "unsub_done": "{n} abgemeldet",
    "unsub_attempts": "{n} Abmeldeversuche",
    "unsub_link": "{n} warten auf deine Bestätigung",
    "unsub_failed": "{n} fehlgeschlagen",
    "footer": "Gesendet von Inboxrake.",
    "open_app": "Inboxrake öffnen",
    "demo_banner":
        "VORSCHAU mit ausgedachten Beispieldaten - nichts davon ist "
        "wirklich passiert. Räum erst etwas auf und sende dann noch "
        "einen Test, um deine echte Aktivität zu sehen.",
    "months": ("Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli",
               "Aug.", "Sep.", "Okt.", "Nov.", "Dez."),
    "day": "{d}. {m}",
    "demo_name": "Alte Newsletter",
}

STRINGS_BY_LANG = {"en": _EN, "de": _DE}
STRINGS = _EN       # the English set (tests and callers without a language)


def _fmt_bytes(n: int, lang: str = "en") -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            out = (f"{size:.0f} {unit}" if unit == "B" or size >= 100
                   else f"{size:.1f} {unit}")
            return out.replace(".", ",") if lang == "de" else out
        size /= 1024
    return f"{size:.1f} GB"


def _plural(S: dict, key: str, n: int, **kw) -> str:
    """S[key_one] for exactly one, else S[key_other]."""
    return S[f"{key}_{'one' if n == 1 else 'other'}"].format(n=n, **kw)


def _path() -> Path:
    return tenants.current().file("digest.json", DIGEST_PATH)


def _load() -> dict:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    if isinstance(data, dict) and isinstance(data.get("accounts"), dict):
        return data
    return {"accounts": {}}


def _write(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def last_sent(account: str) -> int:
    return _load()["accounts"].get(account, {}).get("last_sent", 0)


def _record_sent(account: str, ts: int) -> None:
    with _LOCK:
        data = _load()
        data["accounts"][account] = {"last_sent": ts}
        _write(data)


def rename_account(old: str, new: str) -> None:
    """Point a renamed account's last-sent marker at its new name."""
    with _LOCK:
        data = _load()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _write(data)


def drop_account(name: str) -> None:
    """Forget a deleted account's last-sent marker."""
    with _LOCK:
        data = _load()
        if data["accounts"].pop(name, None) is not None:
            _write(data)


def _next_occurrence(after: datetime.datetime, hour: int,
                     minute: int) -> datetime.datetime:
    """The next local hour:minute at/after `after` (today if not yet
    past, else tomorrow)."""
    candidate = after.replace(hour=hour, minute=minute, second=0,
                              microsecond=0)
    if candidate < after:
        candidate += datetime.timedelta(days=1)
    return candidate


def due(account: str, schedule: str, hour: int = 8, minute: int = 0,
       now: float | None = None) -> bool:
    """Whether this account's digest should fire now: never sent -> due
    right away (same as rules.py's own due() for a never-run rule);
    otherwise due at the next hour:minute strictly after the last send
    (and, for weekly, not before 7 days have passed - so a daily tick
    granularity can't fire it a day early)."""
    if schedule not in _PERIOD_DAYS:
        return False
    last = last_sent(account)
    if not last:
        return True
    now_dt = datetime.datetime.fromtimestamp(now or time.time())
    last_dt = datetime.datetime.fromtimestamp(last)
    next_dt = _next_occurrence(
        last_dt + datetime.timedelta(seconds=1), hour, minute)
    earliest = last_dt + datetime.timedelta(days=_PERIOD_DAYS[schedule])
    while next_dt < earliest:
        next_dt += datetime.timedelta(days=1)
    return now_dt >= next_dt


# audit-log actions whose mail counts the digest sums up
_COUNTED = ("trash", "purge", "archive", "move", "mark_read", "rule_report",
            "rule_execute")


def _aggregate(entries: list[dict],
              known_rule_ids: set[str]) -> tuple[dict[str, int], int, int,
                                                 dict[str, int]]:
    """-> (mail_counts by action, bytes freed, unsubscribe attempts,
    unsubscribe outcomes by status).

    rule_report/rule_execute entries whose rule has since been deleted
    are skipped: the audit log is append-only (a past run is a fact that
    stays on record even if the rule is gone), but the digest's own
    "open Rules and review it" call-to-action would be a dead end for
    one, so it must not show up here."""
    mail_counts: dict[str, int] = {}
    freed = 0
    unsub_outcomes = {"done": 0, "link": 0, "failed": 0}
    unsub_attempts = 0
    for e in entries:
        a = e["action"]
        if a in ("rule_report", "rule_execute"):
            actor = e.get("actor", "")
            rule_id = actor.split(":", 1)[1] if actor.startswith("rule:") \
                else None
            if rule_id not in known_rule_ids:
                continue
        if a == "empty_trash":      # Empty Trash is a permanent delete too
            a = "purge"
        if a in _COUNTED:
            mail_counts[a] = mail_counts.get(a, 0) + e.get("count", 0)
        if a == "purge":            # "freed" = permanently deleted only
            freed += e.get("bytes", 0)
        if a == "unsubscribe":
            unsub_attempts += 1
            if e.get("outcome") in unsub_outcomes:
                unsub_outcomes[e["outcome"]] += 1
    return mail_counts, freed, unsub_attempts, unsub_outcomes


def _rows_data(S: dict, d: dict) -> tuple[list[dict], list[dict]]:
    """-> (needs, happened): the rows of the two sections, each
    {icon, tone, title, sub, btn: (label, route) | None}."""
    needs, happened = [], []
    lang_size = d["lang"]
    if d["still"]:
        needs.append({
            "icon": "!", "tone": "warn",
            "title": _plural(S, "still", d["still"]),
            "sub": _plural(S, "still_sub", d["still_mails"],
                           m=d["still_mails"]),
            "btn": (S["btn_block"], "senders")})
    if d["junk"]:
        needs.append({"icon": "✉", "tone": "warn",
                      "title": _plural(S, "junk", d["junk"]),
                      "sub": _plural(S, "junk_replied", d["junk_replied"],
                                     k=d["junk_replied"])
                      if d["junk_replied"] else "",
                      "btn": (S["btn_look"], "junk")})
    if d["ai_mails"]:
        needs.append({
            "icon": "✦", "tone": "safe",
            "title": _plural(S, "ai", d["ai_mails"]),
            "sub": _fmt_bytes(d["ai_bytes"], lang_size),
            "btn": (S["btn_review"], "senders")})

    counts = d["counts"]
    parts = [S[k].format(n=counts[k]) for k in ("trash", "purge")
             if counts.get(k)]
    if parts:
        happened.append({
            "icon": "✕", "tone": "bad", "title": ", ".join(parts),
            "sub": S["freed"].format(size=_fmt_bytes(d["freed"], lang_size))
            if d["freed"] else "", "btn": None})
    tidy = [S[f"tidied_{k}"].format(n=counts[a]) for a, k in
            (("archive", "archive"), ("move", "move"),
             ("mark_read", "read")) if counts.get(a)]
    if tidy:
        happened.append({"icon": "✓", "tone": "calm",
                         "title": ", ".join(tidy), "sub": "", "btn": None})
    rules = d["rules"]                    # [(name, runs, mails)], top first
    if rules:
        runs = sum(r[1] for r in rules)
        mails = sum(r[2] for r in rules)
        if len(rules) == 1:
            title = _plural(S, "rule", runs, name=rules[0][0], runs=runs)
            sub = _plural(S, "rule_sub", mails, mails=mails)
        else:
            title = S["rules_many"].format(rules=len(rules), runs=runs)
            sub = (_plural(S, "rule_sub", mails, mails=mails) + " · "
                   + S["rules_top"].format(name=rules[0][0]))
        happened.append({"icon": "✓", "tone": "calm", "title": title,
                         "sub": sub, "btn": None})
    if counts.get("rule_report"):
        happened.append({
            "icon": "⚑", "tone": "warn",
            "title": _plural(S, "preview", counts["rule_report"]),
            "sub": S["preview_sub"], "btn": (S["btn_rules"], "rules")})
    if d["unsub_attempts"]:
        o = d["unsub_outcomes"]
        sub = " · ".join(S[f"unsub_{k}"].format(n=o[k])
                              for k in ("link", "failed") if o[k])
        happened.append({
            "icon": "↩", "tone": "calm",
            "title": S["unsub_done"].format(n=o["done"]) if o["done"]
            else S["unsub_attempts"].format(n=d["unsub_attempts"]),
            "sub": sub, "btn": None})
    return needs, happened


def _link(url: str, route: str) -> str:
    return f"{url}/#/{route}"


def _range(S: dict, since_ts: float, now: float) -> str:
    def one(ts: float) -> str:
        t = time.localtime(ts)
        return S["day"].format(d=t.tm_mday, m=S["months"][t.tm_mon - 1])
    return f"{S['window']} · {one(now - 7 * 86400)} – {one(now)}"


def _happened_title(S: dict, since_ts: float) -> str:
    return (S["happened_since"].format(since=_since(S, since_ts))
            if since_ts else S["happened"])


def _since(S: dict, ts: float) -> str:
    t = time.localtime(ts)
    return S["day"].format(d=t.tm_mday, m=S["months"][t.tm_mon - 1])


def _compose_text(S: dict, d: dict, account: str, url: str,
                  banner: str | None) -> str:
    needs, happened = _rows_data(S, d)
    lines = []
    if banner:
        lines += [banner, ""]
    lines += [f"{d['title']} ({d['range']})", ""]
    lines.append(f"{S['arrived']}: {d['arrived']}   {S['cleaned']}: "
                 f"{d['cleaned']}"
                 + (f"   {S['mailbox']}: {_fmt_bytes(d['size'], d['lang'])}"
                    if d["size"] is not None else ""))
    if d["delta"]:
        key = "size_less" if d["delta"] < 0 else "size_more"
        lines.append(S[key].format(
            size=_fmt_bytes(abs(d["delta"]), d["lang"])))
    for title, rows in ((S["needs_you"], needs), (d["happened_title"], happened)):
        if not rows:
            continue
        lines += ["", title.upper()]
        for r in rows:
            lines.append(f"- {r['title']}" + (f" ({r['sub']})" if r["sub"]
                                              else ""))
            if r["btn"] and url:
                lines.append(f"  {r['btn'][0]}: {_link(url, r['btn'][1])}")
    lines += ["", f"-- \n{S['footer']}"]
    if url:
        lines.append(f"{S['open_app']}: {url}/")
    return "\n".join(lines) + "\n"


# Palette (frontend/src/index.css @theme) as inline styles with a dark
# variant via prefers-color-scheme: clients that honour it (Apple Mail,
# iOS, Outlook.com, Gmail apps) switch, the rest keep the light colours,
# which stay readable everywhere. Both classes and inline styles carry the
# colour: the inline light value is the fallback, the `!important` dark
# rule in <style> wins where supported. No external assets.
_LIGHT = {"surface": "#eee5d0", "panel": "#faf5e9", "panel2": "#f2ead7",
          "line": "#dccfb2", "accent": "#96570a", "muted": "#6e5e45",
          "body": "#2c2115", "chip": "#e5d9bd", "good": "#3d8a5a",
          "goodbg": "#d6ebdc", "sand": "#e9c98f", "warnbg": "#f6e2c2",
          "badbg": "#f4d6d0", "bad": "#b4412f"}
_DARK = {"surface": "#17120b", "panel": "#241d12", "panel2": "#2e2618",
         "line": "#4a3d27", "accent": "#e0a050", "muted": "#b8a888",
         "body": "#f4ecda", "chip": "#3a2f1c", "good": "#6cc28a",
         "goodbg": "#1f3a29", "sand": "#8a6a36", "warnbg": "#3d2e14",
         "badbg": "#41231d", "bad": "#e8806f"}
# class -> (css property, palette key)
_CLASSES = {"bg": ("background-color", "surface"),
            "card": ("background-color", "panel"),
            "foot": ("background-color", "panel2"),
            "chip": ("background-color", "chip"),
            "ln": ("border-color", "line"),
            "tx": ("color", "body"), "mu": ("color", "muted"),
            "ac": ("color", "accent"),
            "bin": ("background-color", "sand"),
            "bout": ("background-color", "good"),
            "good": ("color", "good"),
            "t-warn": ("background-color", "warnbg"),
            "t-safe": ("background-color", "goodbg"),
            "t-bad": ("background-color", "badbg"),
            "t-calm": ("background-color", "chip"),
            "btn": ("background-color", "chip")}
_TONE_BG = {"warn": "warnbg", "safe": "goodbg", "bad": "badbg",
            "calm": "chip"}
_TONE_FG = {"warn": "accent", "safe": "good", "bad": "bad", "calm": "good"}
_FONT = ("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,"
         "Arial,sans-serif")


def _style_block() -> str:
    dark = "".join(f".{c}{{{prop}:{_DARK[key]} !important;}}"
                   for c, (prop, key) in _CLASSES.items())
    return ("<style>:root{color-scheme:light dark;supported-color-schemes:"
            "light dark;}@media (prefers-color-scheme: dark){" + dark
            + "}</style>")


def _bars_html(S: dict, d: dict) -> str:
    """Eight weeks as table cells: arrivals grow up from the middle line,
    cleaned-up mails down (colour is not the only signal: the labels and
    the alt text name both)."""
    esc = htmlmod.escape
    top = max(max(d["weeks_in"] + d["weeks_out"]), 1)
    full = 46

    def bar(n: int, cls: str, color: str) -> str:
        if n <= 0:
            return ""
        h = max(2, round(full * n / top))
        return (f'<table role="presentation" width="100%" cellpadding="0" '
                f'cellspacing="0" height="{h}"><tr><td height="{h}" '
                f'class="{cls}" style="height:{h}px;background-color:'
                f'{color};font-size:0;line-height:0;border-radius:2px;">'
                f'&nbsp;</td></tr></table>')

    ups = "".join(
        f'<td valign="bottom" height="{full}" style="padding:0 2px;'
        f'height:{full}px;">{bar(n, "bin", _LIGHT["sand"])}</td>'
        for n in d["weeks_in"])
    downs = "".join(
        f'<td valign="top" height="{full}" style="padding:0 2px;'
        f'height:{full}px;">{bar(n, "bout", _LIGHT["good"])}</td>'
        for n in d["weeks_out"])
    alt = S["bars_alt"].format(arrived=" ".join(map(str, d["weeks_in"])),
                               cleaned=" ".join(map(str, d["weeks_out"])))
    return (f'<table role="presentation" width="100%" cellpadding="0" '
            f'cellspacing="0" aria-label="{esc(alt, quote=True)}" '
            f'title="{esc(alt, quote=True)}"><tr>{ups}</tr>'
            f'<tr>{downs}</tr></table>')


def _row_html(r: dict, url: str) -> str:
    esc = htmlmod.escape
    bg, fg = _LIGHT[_TONE_BG[r["tone"]]], _LIGHT[_TONE_FG[r["tone"]]]
    sub = (f'<div class="mu" style="font-size:13px;color:{_LIGHT["muted"]};'
           f'margin-top:2px;">{esc(r["sub"])}</div>') if r["sub"] else ""
    btn = ""
    if r["btn"] and url:
        href = esc(_link(url, r["btn"][1]), quote=True)
        btn = (f'<td align="right" valign="middle" style="padding:10px 0 '
               f'10px 8px;" width="1"><a href="{href}" class="btn tx" '
               f'style="display:inline-block;padding:8px 14px;border-radius:'
               f'10px;background-color:{_LIGHT["chip"]};color:'
               f'{_LIGHT["accent"]};font-size:14px;font-weight:600;'
               f'text-decoration:none;white-space:nowrap;">'
               f'{esc(r["btn"][0])}</a></td>')
    return (
        f'<tr><td class="ln" style="border-top:1px solid {_LIGHT["line"]};">'
        f'<table role="presentation" width="100%" cellpadding="0" '
        f'cellspacing="0"><tr>'
        f'<td width="32" valign="top" style="padding:12px 12px 12px 0;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td align="center" width="32" height="32" class="t-{r["tone"]}" '
        f'style="width:32px;height:32px;border-radius:16px;'
        f'background-color:{bg};color:{fg};font-size:15px;'
        f'line-height:32px;">{r["icon"]}</td></tr></table></td>'
        f'<td valign="middle" style="padding:11px 0;">'
        f'<div class="tx" style="font-size:15px;font-weight:600;'
        f'color:{_LIGHT["body"]};">{esc(r["title"])}</div>{sub}</td>'
        f'{btn}</tr></table></td></tr>')


def _section_html(title: str, rows: list[dict], url: str) -> str:
    if not rows:
        return ""
    esc = htmlmod.escape
    return (
        f'<tr><td style="padding:18px 24px 0;"><div class="mu" '
        f'style="font-size:12px;letter-spacing:.06em;text-transform:'
        f'uppercase;font-weight:600;color:{_LIGHT["muted"]};'
        f'padding-bottom:6px;">{esc(title)}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" '
        f'cellspacing="0">{"".join(_row_html(r, url) for r in rows)}'
        f'</table></td></tr>')


def _compose_html(S: dict, d: dict, account: str, url: str,
                  banner: str | None) -> str:
    esc = htmlmod.escape
    L = _LIGHT
    needs, happened = _rows_data(S, d)
    banner_html = (
        f'<tr><td class="chip ac" style="padding:10px 24px;'
        f'background-color:{L["chip"]};font-size:12px;color:{L["accent"]};'
        f'font-weight:600;">{esc(banner)}</td></tr>') if banner else ""
    delta = ""
    if d["delta"]:
        key = "size_less" if d["delta"] < 0 else "size_more"
        arrow = "▼" if d["delta"] < 0 else "▲"
        delta = (f'<div style="font-size:13px;font-weight:600;color:'
                 f'{L["good"] if d["delta"] < 0 else L["accent"]};'
                 f'margin-top:2px;" class="{"good" if d["delta"] < 0 else "ac"}">'
                 f'{arrow} '
                 f'{esc(S[key].format(size=_fmt_bytes(abs(d["delta"]), d["lang"])))}'
                 f'</div>')
    size = (f'<div class="mu" style="font-size:13px;color:{L["muted"]};">'
            f'{esc(S["mailbox"])}</div><div class="tx" style="font-size:26px;'
            f'font-weight:700;color:{L["body"]};">'
            f'{esc(_fmt_bytes(d["size"], d["lang"]))}</div>{delta}'
            if d["size"] is not None else "")
    num = lambda label, n, color, cls: (   # noqa: E731
        f'<div class="mu" style="font-size:13px;color:{L["muted"]};">'
        f'{esc(label)}</div><div style="font-size:30px;font-weight:700;'
        f'color:{color};" class="{cls}">{n}</div>')
    open_app = (f' &middot; <a href="{esc(url + "/", quote=True)}" '
                f'class="ac" style="color:{L["accent"]};">'
                f'{esc(S["open_app"])}</a>') if url else ""
    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
{_style_block()}
</head>
<body class="bg" style="margin:0;padding:0;background-color:{L["surface"]};
  font-family:{_FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    class="bg" style="background-color:{L["surface"]};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
        class="card ln" style="width:480px;max-width:100%;
        background-color:{L["panel"]};border:1px solid {L["line"]};
        border-radius:16px;overflow:hidden;">
        {banner_html}
        <tr><td style="padding:20px 24px 0;">
          <div class="mu" style="font-size:12px;letter-spacing:.06em;
            text-transform:uppercase;font-weight:600;color:{L["muted"]};">
            Inboxrake &middot; {esc(account)}</div>
          <div class="tx" style="font-size:24px;font-weight:700;
            color:{L["body"]};margin-top:2px;">{esc(d["title"])}</div>
          <div class="mu" style="font-size:13px;color:{L["muted"]};
            margin-top:2px;">{esc(d["range"])}</div>
        </td></tr>
        <tr><td style="padding:16px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0"
            cellspacing="0" class="foot ln" style="background-color:
            {L["panel2"]};border:1px solid {L["line"]};border-radius:14px;">
            <tr><td style="padding:14px 16px 4px;">
              <table role="presentation" width="100%" cellpadding="0"
                cellspacing="0"><tr>
                <td valign="top" width="26%">{num(S["arrived"], d["arrived"], L["accent"], "ac")}</td>
                <td valign="top" width="26%">{num(S["cleaned"], d["cleaned"], L["good"], "good")}</td>
                <td valign="top" align="right">{size}</td>
              </tr></table>
            </td></tr>
            <tr><td style="padding:8px 14px 0;">{_bars_html(S, d)}</td></tr>
            <tr><td style="padding:4px 16px 12px;">
              <table role="presentation" width="100%" cellpadding="0"
                cellspacing="0"><tr>
                <td class="mu" style="font-size:12px;color:{L["muted"]};">
                  {esc(S["weeks_ago"])}</td>
                <td class="mu" align="right" style="font-size:12px;
                  color:{L["muted"]};">{esc(S["this_week"])}</td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>
        {_section_html(S["needs_you"], needs, url)}
        {_section_html(d["happened_title"], happened, url)}
        <tr><td style="padding:18px 24px 0;"></td></tr>
        <tr><td class="foot mu" style="padding:14px 24px;
          background-color:{L["panel2"]};font-size:12px;color:{L["muted"]};">
          {esc(S["footer"])}{open_app}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


# --------------------------------------------------------------- the data

_FROM_ROLE = re.compile(r"^\d+ mails? from (Junk|Trash)$")


def _cleaned_weeks(entries: list[dict], rules: list[dict],
                   now: float) -> list[int]:
    """Mails cleaned per rolling 7-day bucket (oldest first), the same
    rules as the app's Overview (frontend activity.ts cleaning()): moves to
    Trash / archive / a folder and rule runs without a move entry of their
    own, rescues out of Junk / Trash excluded, restored mails subtracted."""
    movers = ("trash", "archive", "move")

    def rescue(e):
        return bool(e.get("from_role")) or bool(
            _FROM_ROLE.match(e.get("label") or ""))

    undone: dict[str, int] = {}
    for e in entries:
        u = e.get("undoes")
        if e["action"] == "undo" and isinstance(u, dict) and u.get("id"):
            undone[u["id"]] = undone.get(u["id"], 0) + int(u.get("count", 0))
    moved = [e for e in entries if e["action"] in movers and not rescue(e)]
    actions = {f"rule:{r['id']}": r.get("action") for r in rules}
    out = [0] * overviewmod.WEEKS
    for e in entries:
        count = e.get("count", 0)
        if count <= 0:
            continue
        if e["action"] in movers:
            counts = not rescue(e)
        else:
            counts = (e["action"] == "rule_execute"
                      and e.get("actor") in actions     # a deleted rule: no
                      and actions[e["actor"]] != "mark_read"
                      and not any(m.get("actor") == e.get("actor")
                                  and abs(m["ts"] - e["ts"]) <= 600
                                  for m in moved))
        if not counts:
            continue
        n = count - min(count, undone.get(e.get("id") or "", 0))
        i = overviewmod.WEEKS - 1 - int(max(0.0, now - e["ts"])
                                        // overviewmod.WEEK_S)
        if i >= 0:
            out[i] += n
    return out


def _one_line(text: str) -> str:
    """User text for the plain-text part: control characters (line breaks
    included) become spaces."""
    return re.sub(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+", " ", str(text)).strip()


def _rule_runs(entries: list[dict], rules: list[dict]) -> list[tuple]:
    """[(name, runs, mails)] of the rules that were executed in `entries`,
    most mails first (a deleted rule has no name to show: skipped)."""
    names = {r["id"]: _one_line(r["name"]) for r in rules}
    acc: dict[str, list[int]] = {}
    for e in entries:
        actor = e.get("actor", "")
        if e["action"] != "rule_execute" or not actor.startswith("rule:"):
            continue
        rid = actor.split(":", 1)[1]
        if rid in names:
            runs = acc.setdefault(rid, [0, 0])
            runs[0] += 1
            runs[1] += e.get("count", 0)
    return sorted(((names[rid], v[0], v[1]) for rid, v in acc.items()),
                  key=lambda r: (-r[2], r[0]))


def _snapshot(account: str, since_ts: int, now: float) -> dict:
    """The Overview's own numbers for the mail: the last 7 days' arrivals,
    cleaned-up mails, mailbox size (+ change since the last digest), the 8
    weekly bars, and what needs the user (still mailing, Junk, AI safe)."""
    acc = accounts.get(account)
    ov = overviewmod.build(acc, None, now)
    weeks_in = ov["weeks"]
    rules = rulesmod.load_rules()
    all_entries = auditlog._load_all(account)
    weeks_out = _cleaned_weeks(all_entries, rules, now)

    cut = mailops._still_mailing_cutoffs(unsubstore.load_account(account))
    sender_verdicts = verdictstore.load_account(account).get("sender") or {}
    by_user = labelstore.verdicts(account)
    still_senders: set[str] = set()
    still_mails = 0
    size = 0
    with acc.lock:
        indexed = bool(acc.index)
        for m in acc.index.values():
            size += m["size"]
            if m["addr"] in cut and m["ts"] and m["ts"] > cut[m["addr"]]:
                still_senders.add(m["addr"])
                still_mails += 1
        ai_mails = ai_bytes = 0
        for key, rec in (acc.state["groups"].get("sender") or {}).items():
            if (sender_verdicts.get(key) or {}).get("verdict") \
                    == "delete_safe" and key not in by_user:
                ai_mails += rec["count"]
                ai_bytes += rec["size"]
        junk = acc.state.get("junk_count") or 0
    replied = mailops.load_replied(acc)
    junk_replied = sum(1 for m in mailops.role_mails("junk", acc)
                       if m.get("addr") in replied)

    delta = None
    if indexed:
        ref = since_ts or now - overviewmod.WEEK_S
        older = [s for s in statsmod.load(account)["scans"]
                 if s.get("ts") and s["ts"] <= ref]
        if older:
            delta = size - int(older[-1].get("size", 0))
    return {"arrived": weeks_in[-1], "cleaned": weeks_out[-1],
            "weeks_in": weeks_in, "weeks_out": weeks_out,
            "size": size if indexed else None, "delta": delta,
            "still": len(still_senders), "still_mails": still_mails,
            "junk": junk, "junk_replied": junk_replied, "ai_mails": ai_mails, "ai_bytes": ai_bytes}


def _digest_cfg(account: str) -> tuple[str, str, bool]:
    """-> (language, app address, weekly schedule?) of the account."""
    block = cfgmod.load_config()["accounts"].get(account) or {}
    d = block.get("digest") or {}
    lang = d.get("lang") if d.get("lang") in STRINGS_BY_LANG else "en"
    return lang, d.get("url") or "", d.get("schedule") == "weekly"


def _build(account: str, d: dict, lang: str, url: str,
           banner: str | None, demo: bool) -> tuple[str, str, str]:
    S = STRINGS_BY_LANG[lang]
    d = {**d, "lang": lang,
         "title": S["title" if d["weekly"] else "title_7d"]}
    subject = S["subject" if d["weekly"] else "subject_7d"].format(
        arrived=d["arrived"], cleaned=d["cleaned"])
    if demo:
        subject = S["preview_prefix"] + (subject[0].lower() + subject[1:]
                                         if lang == "en" else subject)
    return (subject, _compose_text(S, d, account, url, banner),
            _compose_html(S, d, account, url, banner))


def compose(account: str, since_ts: int, now: float | None = None,
            lang: str | None = None,
            url: str | None = None) -> tuple[str, str, str] | None:
    """-> (subject, text_body, html_body), or None if nothing happened
    since `since_ts` (callers must not send a mail in that case). `lang` /
    `url` default to the account's digest settings."""
    now = now if now is not None else time.time()
    # auditlog's own digest-send records never count as "activity" - a
    # digest send recording itself as activity would never run dry.
    entries = [e for e in auditlog._load_all(account)
               if e["ts"] > since_ts and e["action"] != "digest_sent"]
    if not entries:
        return None

    rules = rulesmod.load_rules()
    known_rule_ids = {r["id"] for r in rules}
    mail_counts, freed, unsub_attempts, unsub_outcomes = _aggregate(
        entries, known_rule_ids)
    if not any(mail_counts.values()) and not freed and not unsub_attempts:
        # every entry in the period turned out to be a phantom rule
        # reference (its rule was deleted meanwhile) - same as no
        # activity at all.
        return None
    cfg_lang, cfg_url, weekly = _digest_cfg(account)
    lang = lang or cfg_lang
    url = cfg_url if url is None else url
    d = _snapshot(account, since_ts, now)
    d.update(counts=mail_counts, freed=freed, unsub_attempts=unsub_attempts,
             unsub_outcomes=unsub_outcomes,
             rules=_rule_runs(entries, rules),
             weekly=weekly, range=_range(STRINGS_BY_LANG[lang], since_ts, now),
             happened_title=_happened_title(STRINGS_BY_LANG[lang], since_ts))
    return _build(account, d, lang, url, None, False)


def compose_demo(account: str, lang: str | None = None,
                 url: str | None = None) -> tuple[str, str, str]:
    """A fabricated, clearly-labeled example digest - used only by
    POST /api/digest/test when there's genuinely nothing real to show
    yet, so a first-time user can see what the mail looks like without
    having to go clean up mail first. Never counted as a real send."""
    cfg_lang, cfg_url, weekly = _digest_cfg(account)
    lang = lang or cfg_lang
    url = cfg_url if url is None else url
    S = STRINGS_BY_LANG[lang]
    d = {"arrived": 81, "cleaned": 96,
         "weeks_in": [62, 70, 85, 58, 74, 66, 79, 81],
         "weeks_out": [30, 12, 118, 45, 38, 33, 28, 96],
         "size": 238_000_000, "delta": -7_650_000,
         "still": 3, "still_mails": 14, "junk": 11,
         "ai_mails": 663, "ai_bytes": 22_500_000,
         "counts": {"trash": 42, "purge": 12, "archive": 6, "move": 2,
                    "mark_read": 15, "rule_report": 7, "rule_execute": 3},
         "freed": 7_650_000, "unsub_attempts": 4,
         "unsub_outcomes": {"done": 2, "link": 1, "failed": 1},
         "rules": [(S["demo_name"], 3, 38)],
         "weekly": weekly, "junk_replied": 1,
         "range": _range(S, 0, time.time()),
         "happened_title": S["happened"]}
    return _build(account, d, lang, url, S["demo_banner"], True)


def send_digest(account: str, test: bool = False) -> dict:
    """Compose + send one account's digest NOW - used by both the
    scheduler and POST /api/digest/test. A /test send never advances
    `last_sent` (so it doesn't shrink the window the next REAL digest
    covers); if there's genuinely nothing real to report, a /test send
    falls back to a clearly-labeled DEMO digest with example data
    instead of a dead-end "nothing to send" - the scheduler never takes
    this path (demo=False there, so it still skips a real empty send).
    Raises ValueError for an unknown account or a genuinely unsendable
    one (no recipient and no account address)."""
    cfg = cfgmod.load_config()
    if account not in cfg["accounts"]:
        raise ValueError(f"unknown account {account!r}")
    block = cfg["accounts"][account]
    recipient = (block.get("digest") or {}).get("recipient") or ""
    recipient = recipient.strip() or block["user"]
    if not recipient:
        raise ValueError(
            "no digest recipient configured and the account has no "
            "address of its own")
    composed = compose(account, last_sent(account))
    demo = False
    if composed is None:
        if not test:
            return {"sent": False, "demo": False}
        composed = compose_demo(account)
        demo = True
    subject, text, html = composed
    smtpout.send(block, recipient, subject, text, html,
                account_name=account)
    now = int(time.time())
    if not test:
        _record_sent(account, now)
    auditlog.record("digest_sent", account=account, label=recipient,
                    outcome="ok")
    log.info("[%s] activity digest sent to %s%s%s", account,
             _masked(recipient),
             " (test)" if test else "", " (demo data)" if demo else "")
    return {"sent": True, "demo": demo}


# ------------------------------------------------------------------ engine

def _tick() -> None:
    for tenant in tenants.known():
        with tenants.use(tenant):
            cfg = cfgmod.load_config()
            for name, block in cfg["accounts"].items():
                d = block.get("digest") or {}
                schedule = d.get("schedule", "off")
                if not due(name, schedule, d.get("hour", 8),
                          d.get("minute", 0)):
                    continue
                try:
                    acc = accounts.get(name)
                except KeyError:
                    continue                 # account was deleted
                with acc.lock:
                    busy = (acc.state["status"] == "scanning"
                            or acc.state["ai"]["status"] == "running"
                            or acc.state["delete"]["status"] == "running"
                            or acc.state["atts"]["status"] == "running"
                            or acc.state["unsub"]["status"] == "running")
                if busy:
                    continue                 # try again next tick
                try:
                    send_digest(name)
                except Exception:
                    log.exception("[%s] digest send failed", name)


_scheduler_started = False


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        while True:
            time.sleep(CHECK_INTERVAL)
            try:
                _tick()
            except Exception:
                log.exception("digest scheduler tick failed")

    threading.Thread(target=loop, daemon=True).start()
    log.info("digest scheduler started (checking every %ds)", CHECK_INTERVAL)
