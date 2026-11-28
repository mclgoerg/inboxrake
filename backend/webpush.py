"""Web Push: a notification when a job you started ends, with the app closed.

The page cannot do this itself - a backgrounded phone app is frozen within
seconds, its JavaScript and event stream with it - so the server sends a real
push (RFC 8030) through the browser vendor's push service: the payload is
encrypted for the one device (RFC 8291, aes128gcm per RFC 8188) and the
request is signed with the instance's own key (VAPID, RFC 8292). Everything
is built on `cryptography`, which the backend already needs; there is no push
library. `cryptography.hazmat` is imported only inside the functions that do
the cryptography: the in-browser demo ships a stand-in with no more than
Fernet, and there every push entry point refuses before reaching them.

Who gets what: a subscription (one browser on one device) belongs to the
tenant that created it and hears about that tenant's accounts only; one
endpoint belongs to exactly one tenant (subscribing again from another
identity moves it). Only jobs a person started push - never the auto-scan,
rules or restore rescans - plus deliberate exceptions: an AI assistant's
rule proposal (`proposal`, the maintainer's decision for the MCP endpoint), the
notice of a new AI connection (`connection`), a subscription reminder (`reminder`: the person switched that very reminder on,
so it is theirs; backend/subscriptions.py), "no answer yet" on a mail you
sent (`waiting`: a "Remind me" on one mail or "Tell me when a reply is
overdue", both the person's own switch; backend/waiting.py), the Monday
weekly check-in (`checkin`: on for everyone with a device until switched off in
Settings; backend/checkin.py) and a delivered batch (`batch`: the person set
that sender to deliver in batches; backend/snooze.py, it names the sender like
a reminder names its service) - and never to a device that
reported the app visible a moment ago (presence): the in-app toast covers
that. Whatever IS sent shows a notification (browsers revoke a subscription
that gets silent pushes), and carries short generic text - never a subject or
an address. The one thing a reminder adds is the service's name, the point of
a reminder the person asked for, plus the amount and date it was announced
with. A waiting push adds the person's name (or the company's, or just
"Someone") and the days it has waited - and the mail's subject only when the
person switched "Show the subject in the notification" on (default off). The
weekly check-in push names nobody at all: how many places want a look and how
long that takes.

Files (per tenant, atomic write, tolerant read): push_subscriptions.json,
`{"subscriptions": [{endpoint, p256dh, auth, lang, origin, created}]}`; the
VAPID private key is one instance-wide PEM (PUSH_KEY_PATH), created on first
use. The push service's URL is a capability token: it is never logged, and the
host must be one of the known push services (PUSH_HOSTS, extendable).
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import ipaddress
import json
import logging
import os
import re
import threading
import time
import urllib.parse
from pathlib import Path

from . import config as cfgmod
from . import demo
from . import tenants

log = logging.getLogger("inboxrake.webpush")

PUSH_KEY_PATH = Path(os.environ.get("PUSH_KEY_PATH",
                                    "/data/push_vapid_key.pem"))
PUSH_SUBS_PATH = Path(os.environ.get("PUSH_SUBS_PATH",
                                     "/data/push_subscriptions.json"))

# The push services of the big browser vendors; INBOXRAKE_PUSH_HOSTS adds
# more suffixes (comma-separated) for a browser with its own service.
PUSH_HOSTS = ("push.apple.com", "fcm.googleapis.com",
              "push.services.mozilla.com", "notify.windows.com")
MAX_PER_TENANT = 20
ENDPOINT_MAX = 1024
SEND_TIMEOUT = 10               # seconds, per request
TTL = 43200                     # how long the push service holds a message
PRESENCE_TTL = 60               # seconds a "visible" report suppresses pushes
DEFAULT_CONTACT = "mailto:inboxrake@localhost"

_LOCK = threading.Lock()        # subscription files + the key file
_key_cache: tuple[Path, object] | None = None
# (tenant id, endpoint hash) -> time.monotonic() until which the device counts
# as looking at the app
_presence: dict[tuple[str, str], float] = {}


class PushError(Exception):
    """A refusal the API words in the user's language: `str(exc)` is the
    coded detail (mailops.coded)."""

    def __init__(self, code: str, **params):
        from . import mailops
        super().__init__(mailops.coded(code, **params))


def _refuse_in_demo() -> None:
    if demo.enabled():
        raise demo.refusal()


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64u(text: str) -> bytes:
    if not isinstance(text, str) or not re.fullmatch(r"[A-Za-z0-9_-]*", text):
        raise ValueError("not base64url")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    os.chmod(tmp, 0o600)
    tmp.replace(path)


# ------------------------------------------------------------- VAPID key

def _vapid_key():
    """The instance's P-256 signing key; created on first need."""
    global _key_cache
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    with _LOCK:
        path = PUSH_KEY_PATH
        if _key_cache and _key_cache[0] == path:
            return _key_cache[1]
        key = None
        try:
            key = serialization.load_pem_private_key(path.read_bytes(), None)
            if not isinstance(key, ec.EllipticCurvePrivateKey):
                key = None
        except (OSError, ValueError):
            key = None
        if key is None:
            key = ec.generate_private_key(ec.SECP256R1())
            _write_private(path, key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()))
        _key_cache = (path, key)
        return key


def _point(public_key) -> bytes:
    from cryptography.hazmat.primitives import serialization
    return public_key.public_bytes(serialization.Encoding.X962,
                                   serialization.PublicFormat.UncompressedPoint)


def public_key() -> str:
    """What a browser passes as applicationServerKey (base64url)."""
    _refuse_in_demo()
    return _b64u(_point(_vapid_key().public_key()))


# ------------------------------------------------------------ validation

def _allowed_hosts() -> tuple[str, ...]:
    extra = tuple(h.strip().lower().lstrip(".") for h in
                  os.environ.get("INBOXRAKE_PUSH_HOSTS", "").split(",")
                  if re.fullmatch(r"[A-Za-z0-9.-]+", h.strip().lstrip(".")))
    return PUSH_HOSTS + extra


def valid_endpoint(endpoint) -> bool:
    """Whether `endpoint` is an https URL on a known push service - the
    server will POST to it, so it is never an arbitrary address."""
    if not isinstance(endpoint, str) or not endpoint \
            or len(endpoint) > ENDPOINT_MAX \
            or any(c.isspace() or ord(c) < 32 or ord(c) > 126
                   for c in endpoint):
        return False
    try:
        parts = urllib.parse.urlsplit(endpoint)
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or "@" in parts.netloc \
            or port not in (None, 443):
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return any(host == s or host.endswith("." + s) for s in _allowed_hosts())


def _valid_keys(p256dh, auth) -> bool:
    from cryptography.hazmat.primitives.asymmetric import ec
    try:
        raw, secret = _unb64u(p256dh), _unb64u(auth)
        if len(raw) != 65 or len(secret) != 16:
            return False
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    except (ValueError, TypeError):
        return False
    return True


_ORIGIN_RE = re.compile(r"https://[A-Za-z0-9.-]+(:[0-9]{1,5})?")


# ------------------------------------------------------------- storage

def _path(tenant: tenants.Tenant) -> Path:
    return tenant.file("push_subscriptions.json", PUSH_SUBS_PATH)


def _read(tenant: tenants.Tenant) -> list[dict]:
    try:
        data = json.loads(_path(tenant).read_text())
    except (OSError, ValueError):
        return []
    rows = data.get("subscriptions") if isinstance(data, dict) else None
    out = []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and isinstance(row.get("endpoint"), str) \
                and isinstance(row.get("p256dh"), str) \
                and isinstance(row.get("auth"), str):
            out.append({
                "endpoint": row["endpoint"], "p256dh": row["p256dh"],
                "auth": row["auth"],
                "lang": row.get("lang") if row.get("lang") in ("en", "de")
                else "en",
                "origin": row.get("origin")
                if isinstance(row.get("origin"), str) else "",
                "created": row.get("created")
                if isinstance(row.get("created"), int) else 0})
    return out


def _write(tenant: tenants.Tenant, subs: list[dict]) -> None:
    _write_private(_path(tenant), json.dumps({"subscriptions": subs}).encode())


def subscriptions(tenant: tenants.Tenant | None = None) -> list[dict]:
    with _LOCK:
        return _read(tenant or tenants.current())


def subscribe(endpoint, p256dh, auth, lang="en", origin: str = "") -> None:
    """Register (or refresh) this device for the current tenant; it leaves
    every other tenant's list."""
    _refuse_in_demo()
    if not valid_endpoint(endpoint) or not _valid_keys(p256dh, auth):
        raise PushError("push_invalid")
    row = {"endpoint": endpoint, "p256dh": p256dh, "auth": auth,
           "lang": lang if lang in ("en", "de") else "en",
           "origin": origin if _ORIGIN_RE.fullmatch(origin or "") else "",
           "created": int(time.time())}
    me = tenants.current()
    with _LOCK:
        for other in tenants.known():
            if other.id != me.id:
                theirs = _read(other)
                kept = [s for s in theirs if s["endpoint"] != endpoint]
                if len(kept) != len(theirs):
                    _write(other, kept)
        mine = _read(me)
        for old in mine:
            if old["endpoint"] == endpoint:
                row["created"] = old["created"] or row["created"]
        mine = [s for s in mine if s["endpoint"] != endpoint] + [row]
        mine = sorted(mine, key=lambda s: s["created"])[-MAX_PER_TENANT:]
        _write(me, mine)


def unsubscribe(endpoint, tenant: tenants.Tenant | None = None) -> None:
    tenant = tenant or tenants.current()
    with _LOCK:
        mine = _read(tenant)
        kept = [s for s in mine if s["endpoint"] != endpoint]
        if len(kept) != len(mine):
            _write(tenant, kept)
    _presence.pop(_presence_key(endpoint, tenant), None)


# ------------------------------------------------------------- presence

def _presence_key(endpoint: str, tenant: tenants.Tenant) -> tuple[str, str]:
    return (tenant.id, hashlib.sha256(endpoint.encode()).hexdigest()[:16])


def set_presence(endpoint, visible: bool) -> None:
    """A device reports whether it is looking at the app. Unknown endpoints
    are ignored (nothing to protect, nothing to leak)."""
    _refuse_in_demo()
    tenant = tenants.current()
    if not isinstance(endpoint, str) \
            or all(s["endpoint"] != endpoint for s in subscriptions(tenant)):
        return
    key = _presence_key(endpoint, tenant)
    if visible:
        _presence[key] = time.monotonic() + PRESENCE_TTL
    else:
        _presence.pop(key, None)


def _present(endpoint: str, tenant: tenants.Tenant) -> bool:
    until = _presence.get(_presence_key(endpoint, tenant))
    return until is not None and until > time.monotonic()


# ------------------------------------------------------------ encryption

def encrypt(plaintext: bytes, p256dh: str, auth: str, *,
            sender_key=None, salt: bytes | None = None) -> bytes:
    """The request body: RFC 8291 over RFC 8188 (aes128gcm, one record).
    `sender_key` / `salt` exist for the RFC's test vector."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    if len(plaintext) > 3992:           # one 4096-byte record
        raise ValueError("payload too large")
    ua_public = _unb64u(p256dh)
    sender_key = sender_key or ec.generate_private_key(ec.SECP256R1())
    salt = salt if salt is not None else os.urandom(16)
    as_public = _point(sender_key.public_key())
    secret = sender_key.exchange(
        ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), ua_public))

    def hkdf(salt_: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
        return HKDF(hashes.SHA256(), length, salt_, info).derive(ikm)

    ikm = hkdf(_unb64u(auth), secret,
               b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    cipher = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    return salt + (4096).to_bytes(4, "big") + bytes([len(as_public)]) \
        + as_public + cipher


def vapid_jwt(endpoint: str, subject: str, now: float | None = None) -> str:
    """The ES256 token proving the push comes from this instance (RFC 8292)."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import (
        decode_dss_signature)
    parts = urllib.parse.urlsplit(endpoint)
    claims = {"aud": f"https://{parts.hostname}",
              "exp": int((time.time() if now is None else now) + 12 * 3600),
              "sub": subject}
    signing = ".".join(_b64u(json.dumps(part, separators=(",", ":")).encode())
                       for part in ({"typ": "JWT", "alg": "ES256"}, claims))
    r, s = decode_dss_signature(
        _vapid_key().sign(signing.encode(), ec.ECDSA(hashes.SHA256())))
    return signing + "." + _b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def _subject(sub: dict) -> str:
    contact = os.environ.get("INBOXRAKE_PUSH_CONTACT", "").strip()
    if contact.startswith(("mailto:", "https:")):
        return contact
    return sub.get("origin") or DEFAULT_CONTACT


# --------------------------------------------------------------- sending

def _post(endpoint: str, headers: dict, body: bytes) -> int:
    """POST to the push service and return the HTTP status. The same
    SSRF-safe path as the unsubscribe link (resolve once, every address must
    be public, connect to that address, never follow a redirect). The one
    place that touches the network - the tests replace it."""
    from . import netguard
    parts = urllib.parse.urlsplit(endpoint)
    host, port = parts.hostname or "", parts.port or 443
    try:
        addrs = netguard.resolve_public(host, port)
    except RuntimeError as exc:
        raise PushError("push_unreachable") from exc
    target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    for ip in addrs:
        conn = netguard.PinnedHTTPSConnection(host, port, ip, SEND_TIMEOUT)
        try:
            conn.request("POST", target, body=body, headers=headers)
            resp = conn.getresponse()
            resp.read(1024)
            return resp.status
        except (OSError, http.client.HTTPException):
            continue                    # try the next validated address
        finally:
            conn.close()
    raise PushError("push_unreachable")


def send(sub: dict, payload: dict, tenant: tenants.Tenant | None = None) -> int:
    """Encrypt and deliver one payload to one subscription. Returns the push
    service's status; a gone subscription (404/410) is dropped. Raises
    PushError when the service cannot be reached."""
    tenant = tenant or tenants.current()
    body = encrypt(json.dumps(payload, ensure_ascii=False).encode(),
                   sub["p256dh"], sub["auth"])
    headers = {
        "Authorization": "vapid t=%s, k=%s" % (
            vapid_jwt(sub["endpoint"], _subject(sub)),
            _b64u(_point(_vapid_key().public_key()))),
        "TTL": str(TTL), "Urgency": "normal",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream"}
    status = _post(sub["endpoint"], headers, body)
    if status in (404, 410):
        unsubscribe(sub["endpoint"], tenant)
    elif status not in (200, 201, 202):
        # host + status only: the rest of the URL is a capability token
        log.warning("push service %s answered %s",
                    urllib.parse.urlsplit(sub["endpoint"]).hostname, status)
    return status


# ----------------------------------------------------------------- texts

# The title says what happened, never just "Inboxrake": the platform already
# names the app (iOS adds its own "from Inboxrake" line, desktop browsers the
# site), so an app-name title only repeats it. The body holds the details.
STRINGS = {
    "en": {
        "scan": "Scan finished",
        "delete": "Clean-up finished",
        "delete_one": "{n} mail processed.",
        "delete_other": "{n} mails processed.",
        "ai": "AI review finished",
        "atts": "Attachment analysis finished",
        "unsub": "Bulk unsubscribe finished",
        "error": "{job} stopped with an error",
        "error_body": "Open Inboxrake for the details.",
        "job_scan": "Scan", "job_delete": "Clean-up", "job_ai": "AI review",
        "job_atts": "Attachment analysis", "job_unsub": "Bulk unsubscribe",
        "batch_one": "Your {name} batch is here: {n} mail",
        "batch_other": "Your {name} batch is here: {n} mails",
        "batch_anon_one": "Your batch is here: {n} mail",
        "batch_anon_other": "Your batch is here: {n} mails",
        "batch_body": "Back in your Inbox, unread - they'll keep coming in batches",
        "proposal": "An AI assistant proposes a rule",
        "proposal_body": "Review it in Inboxrake. Nothing has moved yet.",
        "connection": "New AI connection",
        "connection_body": "{label}. Not you? Disconnect it in Settings.",
        "reminder_n": "{name} bills again in {n} days",
        "reminder_1": "{name} bills again tomorrow",
        "reminder_0": "{name} bills again today",
        "reminder_amount": "{amount} around {date}",
        "reminder_date": "Expected around {date}",
        "reminder_signin": "last sign-in {date}",
        "someone": "Someone",
        "waiting_title": "No answer yet: {name}",
        "waiting_days_one": "1 day",
        "waiting_days_other": "{n} days",
        "waiting_usual_one": "{days} - they usually answer within 1 day.",
        "waiting_usual_other": "{days} - they usually answer within {n} days.",
        "checkin_one": "Your weekly check-in: {n} thing",
        "checkin_other": "Your weekly check-in: {n} things",
        "checkin_body": "About {m} min. Tap to start.",
        "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                   "Sep", "Oct", "Nov", "Dec"],
        "test": "Notifications work",
        "test_body": "You'll be told here when a scan or clean-up you started finishes.",
    },
    "de": {
        "scan": "Scan fertig",
        "delete": "Aufräumen fertig",
        "delete_one": "{n} Mail verarbeitet.",
        "delete_other": "{n} Mails verarbeitet.",
        "ai": "KI-Prüfung abgeschlossen",
        "atts": "Anhang-Analyse abgeschlossen",
        "unsub": "Massenabbestellen abgeschlossen",
        "error": "{job} mit Fehler abgebrochen",
        "error_body": "Die Details stehen in Inboxrake.",
        "job_scan": "Scan", "job_delete": "Aufräumen",
        "job_ai": "KI-Prüfung", "job_atts": "Anhang-Analyse",
        "job_unsub": "Massenabbestellen",
        "batch_one": "Deine Sammellieferung von {name} ist da: {n} Mail",
        "batch_other": "Deine Sammellieferung von {name} ist da: {n} Mails",
        "batch_anon_one": "Deine Sammellieferung ist da: {n} Mail",
        "batch_anon_other": "Deine Sammellieferung ist da: {n} Mails",
        "batch_body": "Wieder im Posteingang, ungelesen - weitere kommen "
                      "gesammelt",
        "proposal": "Ein KI-Assistent schlägt eine Regel vor",
        "proposal_body": "Sieh sie dir in Inboxrake an. Es wurde noch nichts "
                         "verschoben.",
        "connection": "Neue KI-Verbindung",
        "connection_body": "{label}. Nicht du? Trenne sie in den "
                           "Einstellungen.",
        "reminder_n": "{name} wird in {n} Tagen wieder abgerechnet",
        "reminder_1": "{name} wird morgen wieder abgerechnet",
        "reminder_0": "{name} wird heute wieder abgerechnet",
        "reminder_amount": "{amount} etwa am {date}",
        "reminder_date": "Erwartet etwa am {date}",
        "reminder_signin": "letzte Anmeldung am {date}",
        "someone": "Jemand",
        "waiting_title": "Noch keine Antwort: {name}",
        "waiting_days_one": "1 Tag",
        "waiting_days_other": "{n} Tage",
        "waiting_usual_one": "{days} - antwortet sonst innerhalb von 1 Tag.",
        "waiting_usual_other": "{days} - antwortet sonst innerhalb von {n} Tagen.",
        "checkin_one": "Dein Wochen-Check: {n} Ding",
        "checkin_other": "Dein Wochen-Check: {n} Dinge",
        "checkin_body": "Etwa {m} Min. Tippe zum Starten.",
        "months": ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli",
                   "Aug.", "Sept.", "Okt.", "Nov.", "Dez."],
        "test": "Benachrichtigungen funktionieren",
        "test_body": "Du bekommst hier Bescheid, wenn ein Scan oder Aufräumen fertig ist.",
    },
}


_SYMBOLS = {"EUR": "€", "USD": "$", "GBP": "£"}


def _money(amount, currency: str, lang: str) -> str:
    """"€7.99" / "7,99 €" (CHF: "CHF 39.00" / "39,00 CHF")."""
    num = f"{float(amount):.2f}"
    sym = _SYMBOLS.get(currency, currency)
    if lang == "de":
        return f"{num.replace('.', ',')} {sym}"
    return f"{sym}{num}" if currency in _SYMBOLS else f"{sym} {num}"


def _day(ts, lang: str) -> str:
    """"5 Dec" / "5. Dez." from an epoch second (UTC, like the expected dates)."""
    d = time.gmtime(int(ts))
    month = (STRINGS.get(lang) or STRINGS["en"])["months"][d.tm_mon - 1]
    return f"{d.tm_mday}. {month}" if lang == "de" else f"{d.tm_mday} {month}"


def _reminder_payload(lang: str, account: str, prefix: bool,
                      params: dict) -> dict:
    """The reminder the person asked for: who bills again, when, and what
    they last did there - the board's wording, no subject, no address."""
    t = STRINGS.get(lang) or STRINGS["en"]
    days = max(0, int(params.get("days") or 0))
    name = str(params.get("name") or "")[:80]
    title = (t["reminder_n"] if days > 1 else t[f"reminder_{days}"]).format(
        name=name, n=days)
    when = _day(params.get("expected") or 0, lang)
    amount = params.get("amount")
    detail = [(t["reminder_amount"].format(
        amount=_money(amount, str(params.get("currency") or ""), lang),
        date=when) if amount is not None
        else t["reminder_date"].format(date=when))]
    if params.get("signin"):
        detail.append(t["reminder_signin"].format(
            date=_day(params["signin"], lang)))
    body = " · ".join(p for p in ([account] if prefix else []) + detail if p)
    digest = hashlib.sha1(name.encode()).hexdigest()[:8]
    return {"title": title, "body": body,
            "tag": f"{account}:reminder:{digest}", "url": "/#/subscriptions"}


def _waiting_payload(lang: str, account: str, prefix: bool,
                     params: dict) -> dict:
    """"No answer yet" on a mail you sent: who has not answered, for how long
    and how fast that person usually answers (when known). Never an address;
    the subject only when `subject` is in the params - the caller adds it
    only when the person switched that on. Like the subscription reminder,
    which names only the service, the page and the digest may show more."""
    t = STRINGS.get(lang) or STRINGS["en"]
    days = max(0, int(params.get("days") or 0))
    name = str(params.get("name") or "").strip()[:80] or t["someone"]
    how_long = (t["waiting_days_one"] if days == 1
                else t["waiting_days_other"]).format(n=days)
    usual = int(params.get("usual") or 0)
    if usual > 0:
        detail = (t["waiting_usual_one"] if usual == 1
                  else t["waiting_usual_other"]).format(days=how_long, n=usual)
    else:
        detail = how_long
    subject = str(params.get("subject") or "").strip()[:80]
    body = " · ".join(p for p in ([account] if prefix else [])
                      + ([f"\u201c{subject}\u201d"] if subject else [])
                      + [detail] if p)
    digest = hashlib.sha1(
        f"{name}\0{params.get('ref') or ''}".encode()).hexdigest()[:8]
    return {"title": t["waiting_title"].format(name=name), "body": body,
            "tag": f"{account}:waiting:{digest}", "url": "/#/waiting"}


def _checkin_payload(lang: str, account: str, prefix: bool,
                     params: dict) -> dict:
    """Monday's weekly check-in: how many places want a look and how long it
    takes - nothing else. No name, no subject, no address (a lock screen shows
    this); the account only when there are several."""
    t = STRINGS.get(lang) or STRINGS["en"]
    n = max(0, int(params.get("n") or 0))
    m = max(1, int(params.get("minutes") or 1))
    body = " · ".join(p for p in ([account] if prefix else []) + [
        t["checkin_body"].format(m=m)] if p)
    return {"title": t["checkin_one" if n == 1 else "checkin_other"].format(
        n=n), "body": body, "tag": f"{account}:checkin",
        # the account is named in the link, so the app opens that account's
        # check-in whichever one it has selected (it is not shown anywhere)
        "url": "/#/overview/check-in?account="
        + urllib.parse.quote(account, safe="")}


def _payload(lang: str, kind: str, ok: bool, account: str, prefix: bool,
             n: int = 0, label: str = "", params: dict | None = None) -> dict:
    t = STRINGS.get(lang) or STRINGS["en"]
    if kind == "checkin":
        return _checkin_payload(lang, account, prefix, params or {})
    if kind == "reminder":
        return _reminder_payload(lang, account, prefix, params or {})
    if kind == "waiting":
        return _waiting_payload(lang, account, prefix, params or {})
    if kind == "batch":
        # the sender's display name is the point of a batch the person asked
        # for (like a reminder's service name); never an address or subject
        name = "" if "@" in label else label[:80]     # no address in a push
        title = t[("batch" if name else "batch_anon")
                  + ("_one" if n == 1 else "_other")].format(name=name, n=n)
        body = " · ".join(p for p in (account if prefix else "",
                                      t["batch_body"]) if p)
        digest = hashlib.sha1(label.encode()).hexdigest()[:8]
        return {"title": title, "body": body,
                "tag": f"{account}:batch:{digest}", "url": "/#/snoozed"}
    if kind == "connection":
        # a hosted AI app was connected over OAuth: its host and level
        return {"title": t["connection"],
                "body": t["connection_body"].format(label=label),
                "tag": f"{account}:connection",
                "url": "/#/settings/assistants"}
    if kind == "proposal":
        # generic: no name, no filter, no token - only that one is waiting
        return {"title": t["proposal"], "body": t["proposal_body"],
                "tag": f"{account}:proposal", "url": "/#/rules"}
    if not ok:
        title, detail = t["error"].format(job=t["job_" + kind]), \
            t["error_body"]
    elif kind == "delete":
        title = t["delete"]
        detail = t["delete_one" if n == 1 else "delete_other"].format(n=n)
    else:
        title, detail = t[kind], ""
    body = " · ".join(p for p in (account if prefix else "", detail) if p)
    return {"title": title, "body": body,
            "tag": f"{account}:{kind}", "url": "/"}


def send_test(endpoint) -> None:
    """Push the test notification to one device of the current tenant, now
    (presence is ignored). Raises PushError."""
    _refuse_in_demo()
    sub = next((s for s in subscriptions() if s["endpoint"] == endpoint), None)
    if sub is None:
        raise PushError("push_unknown")
    t = STRINGS.get(sub["lang"]) or STRINGS["en"]
    status = send(sub, {"title": t["test"], "body": t["test_body"],
                        "tag": "test", "url": "/"})
    if status in (404, 410):
        raise PushError("push_unknown")
    if status not in (200, 201, 202):
        raise PushError("push_http", status=status)


def job_finished(acc, kind: str, ok: bool, **params) -> None:
    """A job somebody started has ended (kind: scan | delete | ai | atts |
    unsub, `proposal`: an AI assistant proposed a rule, or `connection`: a
    hosted AI app was connected, `label` says which). Returns at once
    and never raises: the delivery runs on its own thread, and a device
    that is looking at the app is left alone."""
    try:
        if demo.enabled():
            return
        with tenants.use(acc.tenant):
            if not subscriptions():
                return
        threading.Thread(target=_deliver, args=(acc, kind, ok, params),
                         daemon=True).start()
    except Exception:
        log.exception("could not hand over the push for a finished job")


def reminder(acc, **params) -> None:
    """A subscription reminder is due (backend/subscriptions.py): `name`,
    `days` left, `amount` / `currency`, `expected` (epoch s) and `signin` (the
    last sign-in alert, 0 = none). Delivered like `job_finished`: at once,
    never raises, devices that are looking at the app are left alone (the
    page shows it itself)."""
    job_finished(acc, "reminder", True, **params)


def waiting(acc, **params) -> None:
    """"No answer yet" on a mail you sent - a "Remind me" that is due or "Tell
    me when a reply is overdue" (backend/waiting.py): `name` of the person
    (empty = "Someone"), `days` open, `ref` (an opaque id, only to keep two
    notifications apart) and how many days they `usual`ly take (0 / None =
    unknown). Never an address; a `subject` only when the person switched
    "Show the subject in the notification" on - the caller leaves it out
    otherwise. Delivered like `reminder`."""
    job_finished(acc, "waiting", True, **params)


def checkin(acc, n: int, minutes: int) -> None:
    """The Monday weekly check-in (backend/checkin.py): `n` places have
    something, about `minutes` minutes. Nothing else goes into it - the text
    names nobody and no mail. Delivered like `reminder`."""
    job_finished(acc, "checkin", True, n=n, minutes=minutes)


def _deliver(acc, kind: str, ok: bool, params: dict) -> None:
    try:
        with tenants.use(acc.tenant):
            tenant = tenants.current()
            prefix = len(cfgmod.load_config().get("accounts") or {}) > 1
            for sub in subscriptions(tenant):
                if _present(sub["endpoint"], tenant):
                    continue
                payload = _payload(sub["lang"], kind, ok, acc.name, prefix,
                                   int(params.get("n") or 0),
                                   str(params.get("label") or ""), params)
                try:
                    send(sub, payload, tenant)
                except Exception as exc:
                    log.warning("push to %s failed: %s",
                                urllib.parse.urlsplit(sub["endpoint"]).hostname,
                                type(exc).__name__)
    except Exception:
        log.exception("push delivery failed")
