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
rules or restore rescans - and never to a device that reported the app
visible a moment ago (presence): the in-app toast covers that. Whatever IS
sent shows a notification (browsers revoke a subscription that gets silent
pushes), and carries short generic text - never a subject or an address.

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
    claims = {"aud": f"{parts.scheme}://{parts.netloc}",
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
    from . import unsub
    parts = urllib.parse.urlsplit(endpoint)
    host, port = parts.hostname or "", parts.port or 443
    try:
        addrs = unsub._resolve_public(host, port)
    except RuntimeError as exc:
        raise PushError("push_unreachable") from exc
    target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    for ip in addrs:
        conn = unsub._PinnedHTTPSConnection(host, port, ip, SEND_TIMEOUT)
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

STRINGS = {
    "en": {
        "title": "Inboxrake",
        "scan": "Scan finished.",
        "delete_one": "Done: {n} mail processed.",
        "delete_other": "Done: {n} mails processed.",
        "ai": "AI review finished.",
        "atts": "Attachment analysis finished.",
        "unsub": "Bulk unsubscribe finished.",
        "error": "{job} stopped with an error.",
        "job_scan": "Scan", "job_delete": "Clean-up", "job_ai": "AI review",
        "job_atts": "Attachment analysis", "job_unsub": "Bulk unsubscribe",
        "test": "Notifications work on this device.",
    },
    "de": {
        "title": "Inboxrake",
        "scan": "Scan fertig.",
        "delete_one": "Fertig: {n} Mail verarbeitet.",
        "delete_other": "Fertig: {n} Mails verarbeitet.",
        "ai": "KI-Prüfung abgeschlossen.",
        "atts": "Anhang-Analyse abgeschlossen.",
        "unsub": "Massenabbestellen abgeschlossen.",
        "error": "{job} mit Fehler abgebrochen.",
        "job_scan": "Scan", "job_delete": "Aufräumen",
        "job_ai": "KI-Prüfung", "job_atts": "Anhang-Analyse",
        "job_unsub": "Massenabbestellen",
        "test": "Benachrichtigungen funktionieren auf diesem Gerät.",
    },
}


def _payload(lang: str, kind: str, ok: bool, account: str, prefix: bool,
             n: int = 0) -> dict:
    t = STRINGS.get(lang) or STRINGS["en"]
    if not ok:
        body = t["error"].format(job=t["job_" + kind])
    elif kind == "delete":
        body = t["delete_one" if n == 1 else "delete_other"].format(n=n)
    else:
        body = t[kind]
    return {"title": t["title"],
            "body": f"{account}: {body}" if prefix else body,
            "tag": f"{account}:{kind}", "url": "/"}


def send_test(endpoint) -> None:
    """Push the test notification to one device of the current tenant, now
    (presence is ignored). Raises PushError."""
    _refuse_in_demo()
    sub = next((s for s in subscriptions() if s["endpoint"] == endpoint), None)
    if sub is None:
        raise PushError("push_unknown")
    t = STRINGS.get(sub["lang"]) or STRINGS["en"]
    status = send(sub, {"title": t["title"], "body": t["test"],
                        "tag": "test", "url": "/"})
    if status in (404, 410):
        raise PushError("push_unknown")
    if status not in (200, 201, 202):
        raise PushError("push_http", status=status)


def job_finished(acc, kind: str, ok: bool, **params) -> None:
    """A job somebody started has ended (kind: scan | delete | ai | atts |
    unsub). Returns at once and never raises: the delivery runs on its own
    thread, and a device that is looking at the app is left alone."""
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


def _deliver(acc, kind: str, ok: bool, params: dict) -> None:
    try:
        with tenants.use(acc.tenant):
            tenant = tenants.current()
            prefix = len(cfgmod.load_config().get("accounts") or {}) > 1
            for sub in subscriptions(tenant):
                if _present(sub["endpoint"], tenant):
                    continue
                payload = _payload(sub["lang"], kind, ok, acc.name, prefix,
                                   int(params.get("n") or 0))
                try:
                    send(sub, payload, tenant)
                except Exception as exc:
                    log.warning("push to %s failed: %s",
                                urllib.parse.urlsplit(sub["endpoint"]).hostname,
                                type(exc).__name__)
    except Exception:
        log.exception("push delivery failed")
