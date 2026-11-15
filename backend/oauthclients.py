"""OAuth client metadata documents (CIMD) for the authorization server
(backend/oauthserver.py).

A hosted AI app has no account with us: its `client_id` is the HTTPS URL of a
JSON document it publishes (draft-ietf-oauth-client-id-metadata-document), and
we fetch that document to learn its name and its redirect URIs. Only this
registration is built (no dynamic client registration). Our own policy, on top
of the draft: https on port 443 only, no query in the URL, every redirect URI
on the SAME host as the client_id, and public clients only (auth method
`none`).

The fetch goes to an address someone else chose, so it runs through the SSRF
guard (backend/netguard.py): one DNS lookup, every answer public, the
connection pinned to it, TLS against the host name, no redirects, a 5 KiB cap
and short timeouts. It only ever happens for a signed-in user's consent request
(never for an anonymous visitor), and is rate limited per URL and globally.

Everything is held in memory (a restart refetches). Pure Python, stdlib only
(the browser demo bundles every backend module)."""

from __future__ import annotations

import http.client
import ipaddress
import json
import re
import socket
import threading
import time
import urllib.parse

from . import mailops
from . import netguard

URL_MAX = 512
DOC_MAX = 5 * 1024
CONNECT_TIMEOUT, TOTAL_TIMEOUT = 3.0, 5.0
TTL_MIN, TTL_MAX, TTL_DEFAULT = 300, 86400, 3600
STALE_MAX = 7 * 86400              # a stale document stands in for a failure
CACHE_MAX = 200
PER_URL_WAIT = 60.0                # seconds between two fetches of one URL
GLOBAL_PER_MINUTE = 30
NAME_MAX = 60
GRANT_TYPES = ("authorization_code", "refresh_token")

# coded refusals (the consent page words them)
BAD_CLIENT_URL = "client_invalid_url"
UNREACHABLE = "client_unreachable"
BLOCKED = "client_blocked"          # the host resolves to a non-public address
BAD_RESPONSE = "client_bad_response"
BAD_DOCUMENT = "client_invalid_document"
RATE_LIMITED = "client_rate_limited"

_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?")
_MAX_AGE = re.compile(r"(?:^|[\s,])max-age\s*=\s*\"?(\d{1,9})\"?", re.I)

_LOCK = threading.Lock()
# client_id -> {"client": dict, "fresh_until": t, "stale_until": t, "at": t}
_cache: dict[str, dict] = {}
_last_try: dict[str, float] = {}
_recent: list[float] = []


class ClientError(ValueError):
    """A refused client; the text is the stable code."""


def _now() -> float:
    return time.time()


def clean_name(text, host: str) -> str:
    """A client's self-asserted name as one short line of plain text (control
    characters removed, cut); the host when it has none."""
    out = " ".join("".join(
        c if c.isprintable() else " " for c in str(text or "")).split())
    return out[:NAME_MAX] if out else host


def parse_client_id(url) -> urllib.parse.SplitResult:
    """The parts of a valid client_id URL, or ClientError(BAD_CLIENT_URL)."""
    if not isinstance(url, str) or not url or len(url) > URL_MAX \
            or not url.isascii() or not url.isprintable() or " " in url:
        raise ClientError(BAD_CLIENT_URL)
    try:
        parts = urllib.parse.urlsplit(url)
        port = parts.port
    except ValueError:
        raise ClientError(BAD_CLIENT_URL) from None
    host = parts.hostname or ""
    bad = (parts.scheme != "https" or port not in (None, 443)
           or "@" in parts.netloc or parts.query or parts.fragment
           or "?" in url or "#" in url
           or parts.path in ("", "/")
           or any(seg in (".", "..") for seg in parts.path.split("/"))
           or not _HOST.fullmatch(host) or "." not in host or _is_ip(host)
           or _dot_escape(parts.path))
    if bad:
        raise ClientError(BAD_CLIENT_URL)
    return parts


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _dot_escape(path: str) -> bool:
    """A path with a dot segment, written plainly or percent-encoded."""
    return any(urllib.parse.unquote(seg) in (".", "..")
               for seg in path.split("/"))


def same_host_uri(uri, host: str) -> bool:
    """Whether a redirect URI is acceptable for a client on `host`: https,
    the same host (and port 443), no credentials, no fragment."""
    if not isinstance(uri, str) or not uri or len(uri) > URL_MAX \
            or not uri.isascii() or not uri.isprintable() or "#" in uri:
        return False
    try:
        parts = urllib.parse.urlsplit(uri)
        port = parts.port
    except ValueError:
        return False
    return (parts.scheme == "https" and port in (None, 443)
            and "@" not in parts.netloc
            and (parts.hostname or "").lower() == host.lower())


def validate(client_id: str, doc) -> dict:
    """A fetched document as the client it describes, or
    ClientError(BAD_DOCUMENT). The checks of the draft (§4, §5) plus our own
    policy."""
    parts = parse_client_id(client_id)
    host = parts.hostname.lower()
    if not isinstance(doc, dict) or doc.get("client_id") != client_id:
        raise ClientError(BAD_DOCUMENT)
    uris = doc.get("redirect_uris")
    if not isinstance(uris, list) or not uris \
            or not all(same_host_uri(u, host) for u in uris):
        raise ClientError(BAD_DOCUMENT)
    if any(k in doc for k in ("client_secret", "client_secret_expires_at",
                              "jwks", "jwks_uri")):
        raise ClientError(BAD_DOCUMENT)
    methods = doc.get("token_endpoint_auth_methods_supported")
    if methods is not None:
        if not isinstance(methods, list) or "none" not in methods:
            raise ClientError(BAD_DOCUMENT)
    elif doc.get("token_endpoint_auth_method", "none") != "none":
        raise ClientError(BAD_DOCUMENT)
    grants = doc.get("grant_types", ["authorization_code"])
    if not isinstance(grants, list) or "authorization_code" not in grants:
        raise ClientError(BAD_DOCUMENT)
    responses = doc.get("response_types", ["code"])
    if not isinstance(responses, list) or "code" not in responses:
        raise ClientError(BAD_DOCUMENT)
    return {"client_id": client_id, "host": host,
            "name": clean_name(doc.get("client_name"), host),
            "redirect_uris": list(uris)}


def _deadline_left(end: float) -> float:
    left = end - time.monotonic()
    if left <= 0:
        raise TimeoutError("client metadata fetch timed out")
    return left


def _cut(conn, fired: threading.Event) -> None:
    """The deadline passed: shut the connection's socket down so a blocked
    receive returns at once (a per-receive timeout alone restarts on every
    byte a slow host drips)."""
    fired.set()
    sock = getattr(conn, "sock", None)
    if sock is not None:
        try:
            socket.socket.shutdown(sock, socket.SHUT_RDWR)
        except OSError:
            pass


def _fetch(client_id: str) -> tuple[int, dict, bytes]:
    """GET the document: (status, headers with lower-case names, body of at
    most DOC_MAX + 1 bytes), all within TOTAL_TIMEOUT wall-clock seconds.
    Raises RuntimeError / OSError / TimeoutError when no answer could be had.
    The one place that touches the network - the tests replace it."""
    parts = urllib.parse.urlsplit(client_id)
    host = parts.hostname or ""
    end = time.monotonic() + TOTAL_TIMEOUT
    last: Exception | None = None
    for ip in netguard.resolve_public(host, 443):
        conn = netguard.PinnedHTTPSConnection(
            host, 443, ip, min(CONNECT_TIMEOUT, _deadline_left(end)))
        fired = threading.Event()
        timer = threading.Timer(_deadline_left(end), _cut, (conn, fired))
        timer.daemon = True
        timer.start()
        try:
            conn.request("GET", parts.path, headers={
                "Accept": "application/json", "User-Agent": "inboxrake"})
            resp = conn.getresponse()
            body = b""
            while len(body) <= DOC_MAX:
                chunk = resp.read(DOC_MAX + 1 - len(body))
                if not chunk:
                    break
                body += chunk
            if fired.is_set():
                raise TimeoutError("client metadata fetch timed out")
            return (resp.status,
                    {k.lower(): v for k, v in resp.getheaders()}, body)
        except (OSError, http.client.HTTPException) as exc:
            if fired.is_set():          # the deadline is for all addresses
                raise TimeoutError("client metadata fetch timed out") from exc
            last = exc          # try the next validated address
        finally:
            timer.cancel()
            conn.close()
    raise last or RuntimeError(mailops.coded(mailops.UNSUB_UNREACHABLE))


def _ttl(headers: dict) -> int:
    m = _MAX_AGE.search(headers.get("cache-control", ""))
    ttl = int(m.group(1)) if m else TTL_DEFAULT
    return max(TTL_MIN, min(TTL_MAX, ttl))


def _fetch_valid(client_id: str) -> tuple[dict, int]:
    """Fetch and validate: (client, ttl). Transient trouble raises OSError /
    RuntimeError / TimeoutError (the caller may serve a stale copy); a
    document that is wrong raises ClientError."""
    status, headers, body = _fetch(client_id)
    if status != 200 or len(body) > DOC_MAX:      # redirects are errors too
        raise ClientError(BAD_RESPONSE)
    ctype = headers.get("content-type", "").split(";")[0].strip().lower()
    if ctype != "application/json":
        raise ClientError(BAD_RESPONSE)
    try:
        doc = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise ClientError(BAD_RESPONSE) from None
    return validate(client_id, doc), _ttl(headers)


def _store(client_id: str, client: dict, ttl: int, now: float) -> None:
    with _LOCK:
        _cache[client_id] = {"client": client, "fresh_until": now + ttl,
                             "stale_until": now + ttl + STALE_MAX,
                             "at": now}
        while len(_cache) > CACHE_MAX:
            del _cache[min(_cache, key=lambda k: _cache[k]["at"])]


def get(client_id: str) -> dict:
    """The validated client of a client_id URL: {client_id, host, name,
    redirect_uris}. Cached; a failed or invalid fetch is never cached, and a
    stale valid copy stands in (for up to 7 days) when the fetch fails for
    network reasons. Raises ClientError."""
    parse_client_id(client_id)
    now = _now()
    with _LOCK:
        hit = _cache.get(client_id)
        if hit and now < hit["fresh_until"]:
            return hit["client"]
        stale = hit["client"] if hit and now < hit["stale_until"] else None
        recent = [t for t in _recent if now - t < 60]
        _recent[:] = recent
        if now - _last_try.get(client_id, -PER_URL_WAIT) < PER_URL_WAIT \
                or len(recent) >= GLOBAL_PER_MINUTE:
            if stale:
                return stale
            raise ClientError(RATE_LIMITED)
        _last_try[client_id] = now
        _recent.append(now)
        if len(_last_try) > 1000:                  # forget the old ones
            for k in [k for k, t in _last_try.items() if now - t >= 60]:
                del _last_try[k]
    try:
        client, ttl = _fetch_valid(client_id)
    except ClientError:
        raise
    except RuntimeError as exc:
        if str(exc) == mailops.coded(mailops.UNSUB_BLOCKED):
            raise ClientError(BLOCKED) from None   # no stale copy for this
        if stale:
            return stale
        raise ClientError(UNREACHABLE) from None
    except (OSError, TimeoutError, http.client.HTTPException):
        if stale:
            return stale
        raise ClientError(UNREACHABLE) from None
    _store(client_id, client, ttl, now)
    return client


def seed(client_id: str, doc: dict, ttl: int = TTL_MAX) -> None:
    """Put a document in the cache without fetching it (the dev demo server
    and the SDK interop run, which have no public client)."""
    _store(client_id, validate(client_id, doc), ttl, _now())


def reset() -> None:
    """Forget everything (tests)."""
    with _LOCK:
        _cache.clear()
        _last_try.clear()
        _recent.clear()
