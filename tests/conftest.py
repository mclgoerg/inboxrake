"""Shared fixtures: isolated config/stats paths, clean global state, and a
fake in-memory IMAP server that speaks imaplib's response format."""

from __future__ import annotations

import datetime
import email.utils
import imaplib
import re
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import accountcopy              # noqa: E402
from backend import accounts as accountsmod   # noqa: E402
from backend import addresses                 # noqa: E402
from backend import addressstore              # noqa: E402
from backend import aliasservice              # noqa: E402
from backend import auditlog as auditlogmod   # noqa: E402
from backend import assistanttokens          # noqa: E402
from backend import auth as authmod            # noqa: E402
from backend import autoscan as autoscanmod   # noqa: E402
from backend import config as cfgmod          # noqa: E402
from backend import digest as digestmod       # noqa: E402
from backend import knowledgestore            # noqa: E402
from backend import knownsenders              # noqa: E402
from backend import dupstore                  # noqa: E402
from backend import habitstore                # noqa: E402
from backend import labelstore                # noqa: E402
from backend import mailops                   # noqa: E402
from backend import copystore                  # noqa: E402
from backend import pinstore                  # noqa: E402
from backend import presets as presetsmod     # noqa: E402
from backend import rulecheckstore           # noqa: E402
from backend import senderchanges            # noqa: E402
from backend import rules as rulesmod         # noqa: E402
from backend import stats as statsmod         # noqa: E402
from backend import substore                 # noqa: E402
from backend import tenants as tenantsmod     # noqa: E402
from backend import unsubstore                # noqa: E402
from backend import waitstore                 # noqa: E402
from backend import verdictstore              # noqa: E402
from backend import webpush                   # noqa: E402
from backend import aisortstore               # noqa: E402


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    """Every test gets fresh config paths and empty per-account state
    (the accounts registry is cleared, so mailops' default-account aliases
    resolve to a brand-new AccountState)."""
    # TestClient sends Host: testserver - not a name the no-login host
    # check accepts by default.
    monkeypatch.setenv("INBOXRAKE_ALLOWED_HOSTS", "testserver")
    monkeypatch.setattr(cfgmod, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(cfgmod, "STATS_PATH", tmp_path / "stats.json")
    monkeypatch.setattr(cfgmod, "SERVER_PATH", tmp_path / "server.json")
    monkeypatch.setattr(tenantsmod, "TENANTS_DIR", tmp_path / "tenants")
    monkeypatch.setattr(assistanttokens, "TOKENS_PATH",
                        tmp_path / "assistant_tokens.json")
    monkeypatch.setattr(verdictstore, "VERDICTS_PATH",
                        tmp_path / "verdicts.json")
    monkeypatch.setattr(aisortstore, "AI_SORT_PATH", tmp_path / "ai_sort.json")
    monkeypatch.setattr(knowledgestore, "KNOWLEDGE_PATH",
                        tmp_path / "sender_knowledge.json")
    monkeypatch.setattr(unsubstore, "UNSUB_STATE_PATH",
                        tmp_path / "unsub_state.json")
    monkeypatch.setattr(mailops, "REPLIED_PATH", tmp_path / "replied.json")
    monkeypatch.setattr(mailops, "SNAPSHOT_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(authmod, "SESSION_SECRET_PATH",
                        tmp_path / "session_secret")
    monkeypatch.setattr(authmod, "_secret_cache", None)
    monkeypatch.setattr(authmod, "login_throttle", authmod.LoginThrottle())
    monkeypatch.setattr(rulesmod, "RULES_PATH", tmp_path / "rules.json")
    monkeypatch.setattr(presetsmod, "PRESETS_PATH", tmp_path / "presets.json")
    monkeypatch.setattr(statsmod, "HISTORY_PATH",
                        tmp_path / "stats_history.json")
    monkeypatch.setattr(auditlogmod, "AUDIT_PATH",
                        tmp_path / "audit_log.jsonl")
    monkeypatch.setattr(digestmod, "DIGEST_PATH", tmp_path / "digest.json")
    monkeypatch.setattr(autoscanmod, "AUTOSCAN_PATH",
                        tmp_path / "autoscan.json")
    monkeypatch.setattr(knownsenders, "KNOWN_SENDERS_PATH",
                        tmp_path / "known_senders.json")
    monkeypatch.setattr(pinstore, "PINS_PATH", tmp_path / "pinned_mails.json")
    monkeypatch.setattr(copystore, "COPIED_PATH",
                        tmp_path / "copied_mails.json")
    monkeypatch.setattr(labelstore, "LABELS_PATH",
                        tmp_path / "sender_labels.json")
    monkeypatch.setattr(dupstore, "DUPS_PATH",
                        tmp_path / "duplicates_kept.json")
    monkeypatch.setattr(substore, "SUBS_PATH", tmp_path / "subscriptions.json")
    monkeypatch.setattr(habitstore, "HIDDEN_PATH", tmp_path / "habit_hidden.json")
    monkeypatch.setattr(rulecheckstore, "RULE_CHECKUP_PATH",
                        tmp_path / "rule_checkup.json")
    rulecheckstore._cache.clear()
    monkeypatch.setattr(senderchanges, "SENDER_CHANGES_PATH",
                        tmp_path / "sender_changes.json")
    senderchanges.reset_cache()
    monkeypatch.setattr(waitstore, "WAITING_PATH", tmp_path / "waiting.json")
    monkeypatch.setattr(waitstore, "SENT_INDEX_PATH",
                        tmp_path / "sent_index.json")
    monkeypatch.setattr(accountcopy, "ACCOUNT_COPY_PATH",
                        tmp_path / "account_copy.json")
    monkeypatch.setattr(accountcopy, "LEDGER_PATH",
                        tmp_path / "account_copy_ledger.jsonl")
    monkeypatch.setattr(accountcopy, "THROTTLE_RATIO", 0)
    accountcopy._THREADS.clear()
    accountcopy._STOP.clear()
    monkeypatch.setattr(addressstore, "ADDRESSES_PATH",
                        tmp_path / "addresses.json")
    monkeypatch.setattr(aliasservice, "ALIAS_PATH",
                        tmp_path / "alias_service.json")
    addressstore._cache.clear()
    addresses._cache.clear()
    monkeypatch.setattr(webpush, "PUSH_KEY_PATH", tmp_path / "push_key.pem")
    monkeypatch.setattr(webpush, "PUSH_SUBS_PATH",
                        tmp_path / "push_subscriptions.json")
    monkeypatch.setattr(webpush, "_key_cache", None)
    webpush._presence.clear()
    verdictstore._mails_cache.clear()
    unsubstore._cache.clear()
    pinstore._cache.clear()
    copystore._cache.clear()
    labelstore._cache.clear()
    dupstore._cache.clear()
    substore._cache.clear()
    habitstore._cache.clear()
    waitstore._cache.clear()
    waitstore._index_cache.clear()
    mailops._SENT_CACHE.clear()
    accountsmod.reset()
    yield
    # Undo/restore kick off a background scan; let it land before the
    # monkeypatched paths (snapshot dir, ...) are restored under it. A bulk
    # unsubscribe a test started and did not wait for must land too: its
    # worker saves into the unsub store, and one that outlives the test would
    # write the old test's records into the next test's fresh store.
    import time
    end = time.time() + 5
    while time.time() < end and (any(
            t.is_alive() for t in list(accountcopy._THREADS.values())) or any(
            a.state["status"] == "scanning"
            or a.state["index"]["status"] == "running"
            or a.state["unsub"]["status"] == "running"
            for a in accountsmod.all_instantiated())):
        time.sleep(0.01)
    verdictstore._mails_cache.clear()
    unsubstore._cache.clear()
    pinstore._cache.clear()
    copystore._cache.clear()
    labelstore._cache.clear()
    dupstore._cache.clear()
    substore._cache.clear()
    rulecheckstore._cache.clear()
    senderchanges.reset_cache()
    accountsmod.reset()


def code_re(code: str, **params) -> str:
    """A `pytest.raises(match=...)` pattern for the coded refusal
    `mailops.coded(code, **params)` (the text of the folder features' errors
    is the code the UI translates, see mailops.coded)."""
    from backend import mailops
    return re.escape(mailops.coded(code, **params))


# The default mail date is "a few days old" relative to the run, computed
# once so every default mail shares one timestamp. A hardcoded date ages
# out of the product's windows (30-day retention cutoffs, the engagement
# recency fade) and turns the suite red on its own. Tests that need the
# month/year of these mails derive them from DEFAULT_MAIL_TS.
DEFAULT_MAIL_TS = int(time.time()) - 3 * 86400
DEFAULT_MAIL_DATE = time.strftime(
    "%d-%b-%Y %H:%M:%S +0000", time.gmtime(DEFAULT_MAIL_TS))


def make_msg(uid, frm='"Shop News" <news@shop.example>',
             subject="Big Sale 42", unsub=None, unsub_post=False,
             msgid=None, size=1000, seen=False,
             date=DEFAULT_MAIL_DATE, to=None, cc=None,
             atts=None, body=None, irt=None, refs=None, html=None,
             delivered_to=None, original_to=None):
    return {"uid": uid, "body": body, "html": html, "irt": irt, "refs": refs, "from": frm, "subject": subject, "unsub": unsub,
            "unsub_post": unsub_post,
            "msgid": msgid or f"<m{uid}@shop.example>",
            "size": size, "seen": seen, "date": date, "to": to, "cc": cc,
            "delivered_to": delivered_to, "original_to": original_to,
            "atts": atts or []}     # [(filename, size)] for BODYSTRUCTURE


def _imap_tokens(line: str) -> list[str]:
    """Split an IMAP command tail into atoms and unescaped quoted strings;
    an unterminated quote is a BAD, as on a real server."""
    out: list[str] = []
    i = 0
    while i < len(line):
        if line[i] == " ":
            i += 1
        elif line[i] == '"':
            i += 1
            buf = []
            while True:
                if i >= len(line):
                    raise imaplib.IMAP4.error("SEARCH BAD unterminated quote")
                if line[i] == "\\" and i + 1 < len(line):
                    buf.append(line[i + 1])
                    i += 2
                elif line[i] == '"':
                    i += 1
                    break
                else:
                    buf.append(line[i])
                    i += 1
            out.append("".join(buf))
        else:
            j = line.find(" ", i)
            j = len(line) if j < 0 else j
            out.append(line[i:j])
            i = j
    return out


class FakeIMAP:
    """In-memory IMAP double producing imaplib-shaped responses.

    `flags` adds SPECIAL-USE flags per folder (e.g. {"Bin": "\\Trash"});
    `move=False` simulates a server without the MOVE capability (deletes
    must then go through COPY + \\Deleted + UID EXPUNGE); `uidplus=False`
    one without UIDPLUS (UID EXPUNGE is then a BAD command).
    `delimiter` is the hierarchy delimiter LIST announces (None = NIL);
    `list_order` names folders LIST returns first, in that order (the rest
    follow in mailbox order) - role detection must not depend on it.

    `renumber=True`: MOVE / COPY give the copies fresh UIDs above everything
    the destination ever held (a real server does; the default keeps the
    source UID). `copyuid=True` additionally answers them with the UIDPLUS
    COPYUID response code (read through `response("COPYUID")`).

    STORE applies the flags to exactly the given set and EXPUNGE removes
    only \\Deleted mail, like a real server.

    `quota=(used_kb, limit_kb)` advertises QUOTA and answers GETQUOTAROOT
    with one STORAGE resource (none: the server has no QUOTA). APPEND adds
    a mail to an existing folder (NO [TRYCREATE] otherwise); `append_hook(mailbox, flags, date_time, message)` may answer
    ("NO", [text]) or raise to simulate a refusing / failing server.
    `namespace="INBOX."` makes the server announce that personal namespace
    (NAMESPACE) and refuse to CREATE a folder anywhere else, like Courier /
    Cyrus setups do.
    `commands` records every call that selects, searches, fetches or
    changes anything, as (name, args...) - tests assert what was NOT sent.

    `gmail=True` gives Gmail label semantics: the server advertises
    X-GM-EXT-1 and answers X-GM-MSGID. A message under several labels is
    one dict per folder (own UID each) sharing the same `gmid` key (see
    `gmail_copy`); a MOVE into `trash` removes it from EVERY folder."""

    def __init__(self, mailbox: dict[str, list[dict]],
                 flags: dict[str, str] | None = None, move: bool = True,
                 uidplus: bool = True, gmail: bool = False,
                 trash: str = "[Gmail]/Trash", delimiter: str | None = "/",
                 list_order: list[str] | None = None,
                 renumber: bool = False, copyuid: bool = False,
                 noselect: dict[str, str] | None = None,
                 date_header: bool = False,
                 quota: tuple[int, int] | None = None,
                 namespace: str | None = None, real_atts: bool = False):
        # `date_header`: also serve each mail's date as an RFC 2822 `Date:`
        # header (the demo's viewer shows it); off, mails carry none, as
        # the suite has always had them.
        self.date_header = date_header
        # `real_atts`: a mail with `atts` [(name, size)] is served as a real
        # multipart/mixed whose files are `size` octets of base64 (what its
        # BODYSTRUCTURE says), so the files can be read, downloaded and taken
        # out of the mail - the demo uses it; the suite's mails stay bodiless
        self.real_atts = real_atts
        # parent-only folders: name -> the LIST flag (`\\Noselect` or
        # `\\NonExistent`); SELECT answers NO. The gmail fake does this for
        # a "[Gmail]" folder, like the real server.
        self.noselect = dict(noselect or {})
        if gmail and "[Gmail]" in mailbox:
            self.noselect.setdefault("[Gmail]", "\\Noselect")
        self.renumber = renumber
        self.copyuid = copyuid
        self._answers: dict[str, list[bytes]] = {}   # imaplib's response()
        self.delimiter = delimiter
        self.list_order = list_order or []
        self.mailbox = mailbox            # folder -> list of make_msg dicts
        self.flags = flags or {}
        self.move = move
        self.uidplus = uidplus
        self.gmail = gmail
        self.trash = trash
        self.capabilities = ("IMAP4REV1",) \
            + (("UIDPLUS",) if uidplus else ()) \
            + (("MOVE",) if move else ()) \
            + (("X-GM-EXT-1",) if gmail else ()) \
            + (("QUOTA",) if quota else ()) \
            + (("NAMESPACE",) if namespace else ())
        self.quota = quota
        self.namespace_prefix = namespace
        self.commands: list[tuple] = []
        self.append_hook = None
        self.gm_fetches: list[str] = []      # FETCH specs asking X-GM-MSGID
        self.uv = {f: 1 for f in mailbox}
        self._high: dict[str, int] = {}      # highest UID a folder ever held
        self.selected: str | None = None
        self.logged_out = False
        # imaplib's single-literal slot: UID SEARCH BODY sends its term here
        self.literal: bytes | None = None
        self.body_searches: list[tuple[tuple, str]] = []   # (args, term)
        self.body_fetches: list[tuple[str, list[int]]] = []   # (folder, uids)
        self.message_id_searches: list[tuple] = []
        self.reject_or = False               # server without nested OR
        self.reject_charset = False          # BAD on CHARSET, like old servers
        self.body_search_error: Exception | None = None   # e.g. TimeoutError

    # -- connection lifecycle -------------------------------------------
    def login(self, user, password):
        return "OK", [b"LOGIN done"]

    def authenticate(self, mechanism, authobject):
        self.authenticated_as = authobject(b"")
        return "OK", [b"AUTHENTICATE done"]

    def logout(self):
        self.logged_out = True
        return "BYE", [b""]

    def shutdown(self):
        pass

    # -- mailbox metadata -----------------------------------------------
    def list(self):
        out = []
        first = [f for f in self.list_order if f in self.mailbox]
        delim = f'"{self.delimiter}"' if self.delimiter else "NIL"
        for f in first + [f for f in self.mailbox if f not in first]:
            fl = "\\HasNoChildren"
            if f in self.noselect:
                fl = f"\\HasChildren {self.noselect[f]}"
            if f in self.flags:
                fl += f" {self.flags[f]}"
            out.append(f'({fl}) {delim} "{f}"'.encode())
        return "OK", out

    # Instances pickled into an older demo seed lack these attributes.
    real_atts = False
    quota = None
    append_hook = None
    namespace_prefix = None

    def _log(self, *entry) -> None:
        self.__dict__.setdefault("commands", []).append(entry)

    def select(self, qname, readonly=False):
        name = qname.strip('"')
        self._log("SELECT", name, readonly)
        if name not in self.mailbox:
            return "NO", [b"no such folder"]
        if name in self.noselect:
            return "NO", [b"[NONEXISTENT] Unknown Mailbox"]
        self.selected = name
        return "OK", [str(len(self.mailbox[name])).encode()]

    def response(self, key):
        if key == "UIDVALIDITY" and self.selected:
            return key, [str(self.uv.get(self.selected, 1)).encode()]
        if key in self._answers:
            return key, self._answers.pop(key)
        return key, [None]

    def _land(self, moving: list[dict], dest: str) -> None:
        """Put `moving` into `dest` (fresh UIDs when `renumber`) and note the
        COPYUID answer."""
        moving = sorted(moving, key=lambda m: m["uid"])
        copies = [dict(m) for m in moving]
        if self.renumber:
            held = self.mailbox.setdefault(dest, [])
            top = max([self._high.get(dest, 0)] + [m["uid"] for m in held])
            for i, c in enumerate(copies, 1):
                c["uid"] = top + i
            self._high[dest] = top + len(copies)
        else:
            self.mailbox.setdefault(dest, [])
        self.mailbox[dest].extend(copies)
        if self.copyuid and moving:
            src = ",".join(str(m["uid"]) for m in moving)
            dst = ",".join(str(c["uid"]) for c in copies)
            self._answers["COPYUID"] = [
                f"{self.uv.get(dest, 1)} {src} {dst}".encode()]

    def status(self, qname, what):
        name = qname.strip('"')
        if name not in self.mailbox:
            return "NO", [b""]
        held = self.mailbox[name]
        nxt = max([self._high.get(name, 0)] + [m["uid"] for m in held]) + 1
        return "OK", [f'"{name}" (MESSAGES {len(held)} UIDNEXT {nxt} '
                      f'UIDVALIDITY {self.uv.get(name, 1)})'.encode()]

    # -- data ------------------------------------------------------------
    def _header_blob(self, m) -> bytes:
        lines = [f"From: {m['from']}", f"Subject: {m['subject']}",
                 f"Message-ID: {m['msgid']}"]
        if self.date_header:
            lines.append("Date: " + email.utils.format_datetime(
                datetime.datetime.strptime(m["date"], "%d-%b-%Y %H:%M:%S %z")))
        if m.get("irt"):
            lines.append(f"In-Reply-To: {m['irt']}")
        if m.get("refs"):
            refs = m["refs"]
            lines.append("References: "
                         + (refs if isinstance(refs, str) else " ".join(refs)))
        if m.get("to"):
            lines.append(f"To: {m['to']}")
        if m.get("cc"):
            lines.append(f"Cc: {m['cc']}")
        if m.get("delivered_to"):
            lines.append(f"Delivered-To: {m['delivered_to']}")
        if m.get("original_to"):
            lines.append(f"X-Original-To: {m['original_to']}")
        if m["unsub"]:
            lines.append(f"List-Unsubscribe: {m['unsub']}")
        if m["unsub_post"]:
            lines.append("List-Unsubscribe-Post: List-Unsubscribe=One-Click")
        if m.get("auto_submitted"):
            # automatic mail: `Auto-Submitted: auto-replied`
            lines.append(f"Auto-Submitted: {m['auto_submitted']}")
        if m.get("report"):
            # a delivery status / read receipt report: `report` is the type
            lines.append('Content-Type: multipart/report; '
                         f'report-type={m["report"]}; boundary="mbreport"')
        if m.get("raw"):
            # an appended mail keeps the header Inboxrake marks its lighter
            # copies with (one line per file taken out)
            for value in email.message_from_bytes(m["raw"]).get_all(
                    "X-Inboxrake-Removed") or []:
                lines.append("X-Inboxrake-Removed: "
                             + " ".join(str(value).split()))
        if m.get("html") is not None:
            # `html` serves an HTML part: alone as text/html, or beside a
            # `body` text as multipart/alternative.
            if m.get("body"):
                lines.append('Content-Type: multipart/alternative; '
                             'boundary="mbbound"')
            else:
                lines.append('Content-Type: text/html; charset=utf-8')
        return ("\r\n".join(lines) + "\r\n\r\n").encode()

    def _attached(self, m) -> bytes:
        """The whole mail of `m` with its `atts` as real parts (`real_atts`)."""
        import base64
        import hashlib
        head = self._header_blob(m)[:-4].decode("latin-1")
        text = (m.get("body") or "Hello mail body")
        out = [head, "MIME-Version: 1.0",
               'Content-Type: multipart/mixed; boundary="mbatt"', "",
               "--mbatt", 'Content-Type: text/plain; charset="utf-8"', "",
               text, ""]
        data = "\r\n".join(out).encode("utf-8")
        for name, size in m["atts"]:
            # 57 bytes = exactly 76 base64 characters per line, no padding:
            # the file decodes (Your documents downloads it, the demo's too)
            line = base64.b64encode(
                (hashlib.sha256(name.encode()).digest() * 2)[:57]
            ).replace(b"\n", b"") + b"\r\n"
            body = line * (size // len(line))
            body += b" " * (size - len(body))       # exactly `size` octets
            data += (b"--mbatt\r\nContent-Type: application/octet-stream; "
                     b'name="' + name.encode() + b'"\r\n'
                     b"Content-Transfer-Encoding: base64\r\n"
                     b'Content-Disposition: attachment; filename="'
                     + name.encode() + b'"\r\n\r\n' + body + b"\r\n")
        return data + b"--mbatt--\r\n"

    def _payload(self, m) -> bytes:
        """The message body after the header blob."""
        text = m.get("body")
        if m.get("html") is None:
            return ((text or "Hello mail body") + "\r\n").encode()
        if not text:
            return (m["html"] + "\r\n").encode()
        return (f'--mbbound\r\nContent-Type: text/plain; charset=utf-8\r\n'
                f'\r\n{text}\r\n--mbbound\r\n'
                f'Content-Type: text/html; charset=utf-8\r\n\r\n'
                f'{m["html"]}\r\n--mbbound--\r\n').encode()

    @staticmethod
    def _bs_of_raw(raw: bytes) -> str:
        """BODYSTRUCTURE of a real message, from its own MIME tree."""
        from backend import mimecut
        root = mimecut.parse(raw)

        def node(part) -> str:
            if part.multipart and part.children:
                sub = part.ctype.split("/", 1)[1]
                return ("(" + "".join(node(c) for c in part.children)
                        + f' "{sub}" ("boundary" "b") NIL NIL)')
            main, _, sub = part.ctype.partition("/")
            enc = str(part.msg.get("Content-Transfer-Encoding", "7bit")
                      ).strip().lower() or "7bit"
            name = mimecut._param(part.msg, "name", "Content-Type")
            fname = mimecut._param(part.msg, "filename",
                                   "Content-Disposition")
            dispo = (part.msg.get_content_disposition() or "")
            params = f'("name" "{name}")' if name else "NIL"
            ext = ""
            if dispo:
                fp = f'("filename" "{fname}")' if fname else "NIL"
                ext = f' ("{dispo}" {fp}) NIL'
            elif main == "text":
                params = '("charset" "utf-8")'
            lines = " 5" if main == "text" else ""
            return (f'("{main}" "{sub}" {params} NIL NIL "{enc}" '
                    f"{part.size}{lines}{' NIL' if ext and not lines else ''}"
                    f"{ext})")
        return node(root)

    def _bodystructure(self, m) -> str:
        if m.get("bs"):
            return m["bs"]              # a test's own (signed, encrypted, ...)
        if m.get("raw"):
            return self._bs_of_raw(m["raw"])
        text = '("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 100 5)'
        if not m.get("atts"):
            return text
        parts = [text]
        for name, size in m["atts"]:
            parts.append(
                f'("application" "octet-stream" ("name" "{name}") NIL NIL '
                f'"base64" {size} NIL '
                f'("attachment" ("filename" "{name}")) NIL)')
        return "(" + "".join(parts) + ' "mixed" ("boundary" "b1") NIL NIL)'

    def _labels_text(self, m) -> str:
        """` X-GM-LABELS (...)` of a Gmail fake's message (`labels` key)."""
        if not self.gmail or m.get("labels") is None:
            return ""
        return " X-GM-LABELS (" + " ".join(
            x if x.startswith("\\") else '"' + x + '"'
            for x in m["labels"]) + ")"

    def _gm(self, m) -> str:
        """` X-GM-MSGID <n>` for a Gmail fake's message (empty otherwise)."""
        if not self.gmail or not m.get("gmid"):
            return ""
        return f" X-GM-MSGID {m['gmid']}"

    @staticmethod
    def _flags_text(m) -> str:
        return " ".join([f for f, key in (("\\Seen", "seen"),
                                          ("\\Flagged", "flagged"),
                                          ("\\Answered", "answered"),
                                          ("\\Draft", "draft"),
                                          ("\\Deleted", "deleted"))
                         if m.get(key)] + list(m.get("keywords") or ()))

    def uid(self, cmd, *args):
        self._log("UID", cmd, *args)
        msgs = self.mailbox[self.selected]
        if cmd == "SEARCH" and args[-1] == "BODY":
            term = (self.literal or b"").decode("utf-8", "replace")
            self.body_searches.append((args, term))
            if self.body_search_error:
                raise self.body_search_error
            has_charset = "CHARSET" in args
            if has_charset and self.reject_charset:
                raise imaplib.IMAP4.error("SEARCH BAD [BADCHARSET]")
            if not has_charset and not term.isascii():
                raise imaplib.IMAP4.error("SEARCH BAD 8-bit without CHARSET")
            hits = [m for m in msgs if term.casefold()
                    in (m.get("body") or "Hello mail body").casefold()]
            return "OK", [b" ".join(str(m["uid"]).encode() for m in hits)]

        if cmd == "SEARCH":
            if args[-1] == "ALL":
                hits = msgs
            elif args[-1] == "DELETED":
                hits = [m for m in msgs if m.get("deleted")]
            elif "SINCE" in args and "HEADER" not in args:
                # `SINCE d-Mon-yyyy`: mails whose INTERNALDATE falls on or
                # after that (UTC) day, like a server's date-only search
                day = datetime.datetime.strptime(
                    args[args.index("SINCE") + 1], "%d-%b-%Y").replace(
                    tzinfo=datetime.timezone.utc)
                hits = [m for m in msgs if datetime.datetime.strptime(
                    m["date"], "%d-%b-%Y %H:%M:%S %z") >= day]
            elif "UID" in args and "HEADER" not in args:
                # `UID n:*` answers the newest mail even below n, as a real
                # server does (a range "to *" always holds the last one)
                top = max((m["uid"] for m in msgs), default=0)
                want = self._span(args[-1], top) if msgs else set()
                hits = [m for m in msgs if m["uid"] in want]
            elif "HEADER" in args:
                # `HEADER Message-ID <id>` (id as literal or quoted string),
                # also OR-chained: OR HEADER Message-ID a OR HEADER ... z
                # The command line is tokenised like a server would: an
                # id that breaks out of its quotes is BAD or changes the
                # query, and an empty HEADER value matches every mail.
                self.message_id_searches.append(args)
                if self.literal:
                    targets = [self.literal.decode("utf-8")]
                else:
                    toks = _imap_tokens(" ".join(a for a in args if a))
                    targets = [toks[i + 2] for i in range(len(toks) - 2)
                               if toks[i] == "HEADER"
                               and toks[i + 1] == "Message-ID"]
                if self.reject_or and "OR" in args:
                    raise imaplib.IMAP4.error("SEARCH BAD OR not supported")
                # Real servers match HEADER case-insensitively as a
                # SUBSTRING (RFC 3501 6.4.4); "" matches every mail.
                def has(m, t):
                    return t.casefold() in m["msgid"].casefold()
                if "OR" in args:
                    hits = [m for m in msgs
                            if any(has(m, t) for t in targets)]
                else:
                    hits = [m for m in msgs
                            if all(has(m, t) for t in targets)]
            else:
                raise AssertionError(f"unexpected SEARCH {args!r}")
            return "OK", [b" ".join(str(m["uid"]).encode() for m in hits)]

        if cmd == "FETCH":
            wanted = {int(u) for u in args[0].split(",")}
            if "BODYSTRUCTURE" in args[1]:
                data = []
                for i, m in enumerate(msgs):
                    if m["uid"] in wanted:
                        extra = ""
                        if "FLAGS" in args[1]:
                            extra += f" FLAGS ({self._flags_text(m)})"
                        if "X-GM-LABELS" in args[1]:
                            extra += self._labels_text(m)
                        data.append(f"{i+1} (UID {m['uid']}{extra} "
                                    f"BODYSTRUCTURE "
                                    f"{self._bodystructure(m)})".encode())
                return "OK", data
            if "BODY.PEEK[]" in args[1]:
                # Also the index builder's partial form BODY.PEEK[]<0.N>
                # for several UIDs at once.
                self.body_fetches.append((self.selected, sorted(wanted)))
                data = []
                for i, m in enumerate(msgs):
                    if m["uid"] in wanted:
                        body = m.get("raw") or (
                            self._attached(m) if self.real_atts
                            and m.get("atts") and m.get("html") is None
                            and "<" not in args[1] else
                            self._header_blob(m) + self._payload(m))
                        # FLAGS / INTERNALDATE only when asked for, as a
                        # real server answers them
                        extra = ""
                        if "FLAGS" in args[1]:
                            extra += f" FLAGS ({self._flags_text(m)})"
                        if "INTERNALDATE" in args[1]:
                            extra += f' INTERNALDATE "{m["date"]}"'
                        if "X-GM-LABELS" in args[1]:
                            extra += self._labels_text(m)
                        data += [(f"{i+1} (UID {m['uid']}{extra} BODY[] "
                                  f"{{{len(body)}}}".encode(), body), b")"]
                return "OK", data or [None]
            if "X-GM-MSGID" in args[1]:
                self.gm_fetches.append(args[1])
            if args[1] in ("(UID FLAGS)", "(UID FLAGS X-GM-MSGID)"):
                # No literal attached (flags-only) - imaplib hands back a
                # plain bytes line per message, not a (meta, literal) tuple.
                data = []
                for i, m in enumerate(msgs):
                    if m["uid"] not in wanted:
                        continue
                    flags = self._flags_text(m)
                    data.append(f"{i+1} (UID {m['uid']}"
                                f"{self._gm(m) if 'GM' in args[1] else ''} "
                                f"FLAGS ({flags}))".encode())
                return "OK", data
            data = []
            for i, m in enumerate(msgs):
                if m["uid"] not in wanted:
                    continue
                hdr = self._header_blob(m)
                flags = self._flags_text(m)
                gm = self._gm(m) if "X-GM-MSGID" in args[1] else ""
                meta = (f"{i+1} (UID {m['uid']}{gm} FLAGS ({flags}) "
                        f"RFC822.SIZE {m['size']} "
                        f"INTERNALDATE \"{m['date']}\" "
                        f"BODY[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID "
                        f"LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)] "
                        f"{{{len(hdr)}}}").encode()
                data.append((meta, hdr))
                data.append(b")")
            return "OK", data

        if cmd == "STORE":
            self._store(msgs, self._uid_set(msgs, args[0]), args[1], args[2])
            return "OK", [b""]

        if cmd == "MOVE":
            assert self.move, "server does not advertise MOVE"
            wanted = {int(u) for u in args[0].split(",")}
            dest = args[1].strip('"')
            moving = [m for m in msgs if m["uid"] in wanted]
            self.mailbox[self.selected] = [m for m in msgs
                                           if m["uid"] not in wanted]
            self._land(moving, dest)
            if self.gmail and dest == self.trash:
                # trashing a Gmail message drops it from every label
                gone = {m["gmid"] for m in moving if m.get("gmid")}
                for f in self.mailbox:
                    if f != dest:
                        self.mailbox[f] = [m for m in self.mailbox[f]
                                           if m.get("gmid") not in gone]
            return "OK", [b""]

        if cmd == "COPY":
            wanted = {int(u) for u in args[0].split(",")}
            dest = args[1].strip('"')
            self._land([m for m in msgs if m["uid"] in wanted], dest)
            return "OK", [b""]

        if cmd == "EXPUNGE":     # UIDPLUS: expunge only the given UIDs
            if not self.uidplus:
                raise imaplib.IMAP4.error("UID EXPUNGE BAD (no UIDPLUS)")
            wanted = self._uid_set(msgs, args[0])
            self.mailbox[self.selected] = [
                m for m in msgs
                if not (m["uid"] in wanted and m.get("deleted"))]
            return "OK", [b""]

        raise AssertionError(f"unexpected UID {cmd}")

    @staticmethod
    def _span(text: str, top: int) -> set[int]:
        """Resolve an IMAP set ("1,3:5", "1:*"); `top` is what `*` means."""
        out: set[int] = set()
        for part in str(text).split(","):
            lo, _, hi = part.partition(":")
            lo_n = top if lo == "*" else int(lo)
            hi_n = (top if hi == "*" else int(hi)) if hi else lo_n
            lo_n, hi_n = min(lo_n, hi_n), max(lo_n, hi_n)
            out |= set(range(lo_n, hi_n + 1))
        return out

    def _uid_set(self, msgs, text) -> set[int]:
        return self._span(text, max((m["uid"] for m in msgs),
                                          default=0))

    @staticmethod
    def _store(msgs, wanted: set[int], op: str, flags: str) -> None:
        names = {f.lstrip("\\").lower()
                 for f in flags.strip("()").split() if f}
        for m in msgs:
            if m["uid"] not in wanted:
                continue
            for key in ("seen", "deleted"):
                if key in names:
                    m[key] = not op.startswith("-")
            if op.upper() == "FLAGS":        # replace: unnamed flags clear
                for key in ("seen", "deleted"):
                    m[key] = key in names

    def store(self, span, op, flags):
        """Sequence-number STORE (`1:*` = every message in the folder)."""
        self._log("STORE", span, op, flags)
        msgs = self.mailbox[self.selected]
        seqs = self._span(span, len(msgs))
        self._store(msgs, {m["uid"] for i, m in enumerate(msgs, 1)
                           if i in seqs}, op, flags)
        return "OK", [b""]

    def expunge(self):
        self._log("EXPUNGE")
        self.mailbox[self.selected] = [
            m for m in self.mailbox[self.selected] if not m.get("deleted")]
        return "OK", [b""]

    # -- writing into a mailbox (the copy to another account) -----------
    def create(self, qname):
        name = qname.strip('"')
        self._log("CREATE", name)
        if self.namespace_prefix and not name.startswith(
                self.namespace_prefix):
            return "NO", [b"[CANNOT] Invalid mailbox name: must be under "
                          + self.namespace_prefix.encode()]
        if name in self.mailbox:
            return "NO", [b"[ALREADYEXISTS] Mailbox exists"]
        self.mailbox[name] = []
        self.uv[name] = 1
        return "OK", [b"Create completed"]

    def rename(self, old, new):
        """RENAME: the folder and every folder below it (`old` + delimiter)
        move to the new name with their mail, UIDVALIDITY and flags; INBOX
        cannot be renamed and the new name must be free."""
        old, new = old.strip('"'), new.strip('"')
        self._log("RENAME", old, new)
        if old not in self.mailbox or old.upper() == "INBOX":
            return "NO", [b"[NONEXISTENT] no such folder"]
        if new in self.mailbox:
            return "NO", [b"[ALREADYEXISTS] Mailbox exists"]
        if self.namespace_prefix and not new.startswith(self.namespace_prefix):
            return "NO", [b"[CANNOT] Invalid mailbox name"]
        below = old + (self.delimiter or "\0")
        for name in [n for n in list(self.mailbox)
                     if n == old or n.startswith(below)]:
            to = new + name[len(old):]
            self.mailbox[to] = self.mailbox.pop(name)
            self.uv[to] = self.uv.pop(name, 1)
            if name in self._high:
                self._high[to] = self._high.pop(name)
            if name in self.flags:
                self.flags[to] = self.flags.pop(name)
            if name in self.noselect:
                self.noselect[to] = self.noselect.pop(name)
            if self.selected == name:
                self.selected = to
        return "OK", [b"Rename completed"]

    def delete(self, name):
        """DELETE: the folder goes with whatever mail it holds (like a real
        server - the caller must have checked); INBOX cannot be deleted."""
        name = name.strip('"')
        self._log("DELETE", name)
        if name not in self.mailbox or name.upper() == "INBOX":
            return "NO", [b"[NONEXISTENT] no such folder"]
        del self.mailbox[name]
        self.uv.pop(name, None)
        self.flags.pop(name, None)
        self.noselect.pop(name, None)
        if self.selected == name:
            self.selected = None
        return "OK", [b"Delete completed"]

    def unsubscribe(self, qname):
        self._log("UNSUBSCRIBE", qname.strip('"'))
        return "OK", [b"Unsubscribe completed"]

    def close(self):
        self._log("CLOSE")
        self.selected = None
        return "OK", [b"Close completed"]

    def namespace(self):
        self._log("NAMESPACE")
        if not self.namespace_prefix:
            raise imaplib.IMAP4.error("NAMESPACE command error")
        d = self.delimiter or "NIL"
        return "OK", [f'(("{self.namespace_prefix}" "{d}")) NIL NIL'.encode()]

    def subscribe(self, qname):
        self._log("SUBSCRIBE", qname.strip('"'))
        return "OK", [b"Subscribe completed"]

    def append(self, qname, flags, date_time, message):
        """APPEND: the mail lands in the folder with a fresh UID, its
        INTERNALDATE (`date_time` as sent, quoted) and the flags it came
        with. The folder must exist (NO [TRYCREATE] otherwise)."""
        name = qname.strip('"')
        self._log("APPEND", name, flags, date_time, len(message))
        if self.append_hook is not None:
            answer = self.append_hook(name, flags, date_time, message)
            if answer is not None:
                return answer
        if name not in self.mailbox:
            return "NO", [b"[TRYCREATE] no such folder"]
        held = self.mailbox[name]
        top = max([self._high.get(name, 0)] + [m["uid"] for m in held])
        self._high[name] = top + 1
        parsed = email.message_from_bytes(message)
        names = {f.lstrip("\\").lower()
                 for f in (flags or "").strip("()").split() if f}
        keywords = [f for f in (flags or "").strip("()").split()
                    if f and not f.startswith("\\")]
        held.append({
            "uid": top + 1, "from": parsed.get("From", ""),
            "subject": parsed.get("Subject", ""),
            "msgid": (parsed.get("Message-ID") or "").strip(),
            "to": parsed.get("To"), "cc": parsed.get("Cc"),
            "unsub": parsed.get("List-Unsubscribe"), "unsub_post": False,
            "body": None, "html": None, "irt": None, "refs": None,
            "size": len(message), "atts": [], "raw": bytes(message),
            "seen": "seen" in names, "flagged": "flagged" in names,
            "answered": "answered" in names, "deleted": "deleted" in names,
            "draft": "draft" in names, "keywords": keywords,
            **({"labels": ["\\Inbox"] if name == "INBOX" else [name]}
               if self.gmail else {}),
            "date": (date_time or "").strip('"')
            or time.strftime("%d-%b-%Y %H:%M:%S +0000", time.gmtime())})
        if not self.uidplus:
            return "OK", [b"Append completed"]
        return "OK", [b"[APPENDUID %d %d] Append completed"
                      % (self.uv.get(name, 1), top + 1)]

    def getquotaroot(self, qname):
        self._log("GETQUOTAROOT", qname.strip('"'))
        if not self.quota:
            raise imaplib.IMAP4.error("GETQUOTAROOT command error")
        used, limit = self.quota
        return "OK", [[b'INBOX ""'],
                      [f'"" (STORAGE {used} {limit})'.encode()]]


def gmail_copy(m: dict, uid: int, gmid: str = "1001") -> dict:
    """The same Gmail message seen in another label folder: own UID, same
    X-GM-MSGID. (Use gmail_copy on every copy, the first one included.)"""
    return {**m, "uid": uid, "gmid": gmid}


@pytest.fixture
def bridge(monkeypatch):
    """A fake mailbox wired into mailops.connect; returns the FakeIMAP."""
    fake = FakeIMAP({
        "INBOX": [
            make_msg(1, frm='"DHL Paket" <noreply@dhl.example>',
                     subject="Ihre Sendung 123 kommt heute",
                     unsub="<https://dhl.example/unsub?u=1>", size=5000),
            make_msg(2, frm='"DHL Paket" <noreply@dhl.example>',
                     subject="Ihre Sendung 456 kommt heute", size=4000,
                     seen=True),
            make_msg(3, frm="Alice <alice@friends.example>",
                     subject="Re: Dinner on Friday?", size=2000, seen=True),
            make_msg(4, frm='"Newsletter" <news@shop.example>',
                     subject="SALE! 50% off everything",
                     unsub="<mailto:unsub@shop.example?subject=stop>, "
                           "<https://shop.example/u/1>",
                     unsub_post=True, size=30000,
                     atts=[("catalog.pdf", 25000), ("promo.jpg", 3000)]),
        ],
        "Archive": [
            make_msg(10, frm='"DHL Paket" <noreply@dhl.example>',
                     subject="Ihre Sendung 789 wurde zugestellt",
                     size=6000, seen=True,
                     date="01-Jan-2025 09:00:00 +0000"),
        ],
        # Sent is excluded from cleanup views but feeds the "never replied"
        # signal (To/Cc addresses -> REPLIED_TO).
        "Sent": [
            make_msg(20, frm="Me <me@self.example>",
                     subject="Re: Dinner on Friday?",
                     to="Alice <alice@friends.example>",
                     cc="bob@corp.example", seen=True),
        ],
        "Trash": [],
        "Spam": [],
    })
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def join_scan_threads(timeout=10.0):
    """Wait for every scan worker thread to END, not just for the status to
    leave "scanning": run_scan reports "done" first and only then writes the
    config (mark_verified), saves the snapshot and pushes - a test that writes
    the config meanwhile races it (config.tmp FileNotFoundError). The thread
    is start_scan's `Thread(target=tenants.call_in, args=(tenant, run_scan,
    ...))`."""
    import threading
    import time
    end = time.time() + timeout
    for th in threading.enumerate():
        args = getattr(th, "_args", ()) or ()
        if th is not threading.current_thread() and len(args) > 1 \
                and args[1] is mailops.run_scan:
            th.join(max(0.0, end - time.time()))


def wait_scan_done(timeout=5.0):
    """A `start_scan()`-dispatched scan runs in a worker thread; wait for
    it to leave "scanning"."""
    import time
    end = time.time() + timeout
    while time.time() < end:
        with mailops.STATE_LOCK:
            if mailops.STATE["status"] != "scanning":
                return mailops.STATE
        time.sleep(0.01)
    return mailops.STATE


def wait_delete_done(timeout=5.0):
    """Delete jobs run in a worker thread; wait for the queue to drain."""
    return _wait_job("delete", timeout)


def wait_unsub_done(timeout=5.0):
    """Bulk unsubscribe runs in a worker thread; wait for it to finish."""
    return _wait_job("unsub", timeout)


def _wait_job(key: str, timeout: float):
    import time
    end = time.time() + timeout
    while time.time() < end:
        with mailops.STATE_LOCK:
            if mailops.STATE[key]["status"] != "running":
                return mailops.STATE[key]
        time.sleep(0.02)
    raise TimeoutError(f"{key} worker did not finish")
