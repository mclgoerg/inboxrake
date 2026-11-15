"""Inboxrake as an OAuth 2.1 authorization server for hosted AI apps (claude.ai,
Claude Desktop custom connectors, OpenAI's apps), so they can use `POST /mcp`
without a static header.

The pieces, all off unless the admin switched `assistants.oauth` on and its
preconditions hold (backend/config.py `oauth_active`; every route below answers
a plain 404 otherwise):

  * discovery: RFC 9728 protected-resource metadata and RFC 8414 server
    metadata, built from the admin's INBOXRAKE_PUBLIC_URL (never from request
    headers);
  * `GET /oauth/authorize`: stores the raw request behind an HttpOnly cookie
    and sends the browser to the SPA's consent page. It validates nothing and
    fetches nothing, so an anonymous visitor can trigger no outbound request;
  * the consent API (`GET`/`POST /api/assistants/connect`, a signed-in
    session): validates the request in RFC 6749 §4.1.2.1 order, shows the
    choices, and on approval mints a 60-second single-use authorization code;
  * `POST /oauth/token` (`authorization_code` with PKCE S256, `refresh_token`
    with rotation and reuse detection) and `POST /oauth/revoke` (RFC 7009).

Clients are public and identified by a metadata document URL (CIMD, see
backend/oauthclients.py). A grant is a record of the assistant-token store
(backend/assistanttokens.py, `kind: "oauth"`), so levels, caps, limits and the
token detail work as for a static token. Pending requests, codes and the rate
limiters live in memory (a restart makes the client reconnect).

The functions here are pure (inputs in, a `Reply` out) so the routes in
main.py stay thin shims and the browser demo can import the module."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
import urllib.parse
from dataclasses import dataclass, field

from . import accounts as accountsmod
from . import assistantplans
from . import assistanttokens
from . import auditlog
from . import auth as authmod
from . import config as cfgmod
from . import demo as demomod
from . import mcpserver
from . import oauthclients
from . import proposalmail
from . import tenants

COOKIE = "pmc_oauth_req"
PENDING_TTL = 600                   # the user has 10 minutes to decide
PENDING_MAX = 200
PARAM_MAX = 512
CODE_TTL = 60
USED_TTL = 600                      # how long a redeemed code is remembered
CONSENT_ROUTE = "/#/connect"
DOCS_URL = "https://inboxrake.com/docs/assistants/"
FORM = "application/x-www-form-urlencoded"
PARAMS = ("client_id", "redirect_uri", "response_type", "state",
          "code_challenge", "code_challenge_method", "scope", "resource")
CODE_PREFIX = "irc_"

# coded refusals of the consent API (the page words them)
GONE = "connect_request_gone"                # no such (or an expired) request
MISMATCH = "connect_request_mismatch"
BAD_REQUEST = "connect_request_invalid"
BAD_REDIRECT = "connect_redirect_uri"
NO_ACCOUNTS = "connect_no_accounts"
ABOVE_CEILING = "connect_level_above_ceiling"

_CHALLENGE = re.compile(r"[A-Za-z0-9_-]{43}")
_VERIFIER = re.compile(r"[A-Za-z0-9._~-]{43,128}")

_LOCK = threading.Lock()
_pending: dict[str, dict] = {}
_codes: dict[str, dict] = {}        # SHA-256 of an authorization code -> grant
_used: dict[str, dict] = {}         # SHA-256 of a redeemed code -> its tombstone
_authorize_throttle = authmod.LoginThrottle(limit=20, window=600)
_token_throttle = authmod.LoginThrottle(limit=60, window=60)


@dataclass
class Reply:
    status: int
    body: dict | None = None
    headers: dict[str, str] = field(default_factory=dict)
    cookie: str | None = None       # None: leave it; "": delete; else: set


def _now() -> float:
    return time.time()


def _err(status: int, code: str, **more) -> Reply:
    return Reply(status, {"detail": code, **more})


_NOT_FOUND = Reply(404, {"detail": "not found"})
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def active() -> bool:
    return not demomod.enabled() and cfgmod.oauth_active()


def reset() -> None:
    """Forget every pending request, code and rate limit (tests)."""
    with _LOCK:
        _pending.clear()
        _codes.clear()
        _used.clear()
    _authorize_throttle._fails.clear()
    _token_throttle._fails.clear()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _s256(text: str) -> str:
    """The PKCE S256 challenge of a verifier (SHA-256 by definition, RFC 7636)."""
    return _b64(hashlib.sha256(text.encode()).digest())


def _hash(text: str) -> str:
    # a 256-bit random code: nothing to brute force, so no slow hash is needed
    return hashlib.sha256(text.encode()).hexdigest()


# ---------------------------------------------------------------- discovery

def _metadata(doc: dict) -> Reply:
    return Reply(200, doc, {"Cache-Control": "max-age=300"})


def protected_resource() -> Reply:
    """RFC 9728 document (served at the path-inserted and the root path)."""
    if not active():
        return _NOT_FOUND
    return _metadata({
        "resource": cfgmod.mcp_url(),
        "authorization_servers": [cfgmod.public_url()],
        "scopes_supported": list(assistanttokens.SCOPES),
        "bearer_methods_supported": ["header"], "resource_name": "Inboxrake",
        "resource_documentation": DOCS_URL})


def authorization_server() -> Reply:
    """RFC 8414 document."""
    if not active():
        return _NOT_FOUND
    base = cfgmod.public_url()
    return _metadata({
        "issuer": base,
        "authorization_endpoint": base + "/oauth/authorize",
        "token_endpoint": base + "/oauth/token",
        "revocation_endpoint": base + "/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": list(assistanttokens.SCOPES),
        "authorization_response_iss_parameter_supported": True,
        "client_id_metadata_document_supported": True,
        "service_documentation": DOCS_URL})


# ---------------------------------------------------------------- authorize

def authorize(query: list[tuple[str, str]], peer: str) -> Reply:
    """`GET /oauth/authorize`: keep the raw request and hand the browser to
    the consent page. Nothing is validated here and nothing is fetched: the
    caller is anonymous. There is no `next` parameter anywhere - the target is
    the fixed consent route."""
    if not active():
        return _NOT_FOUND
    wait = _authorize_throttle.attempt(peer)
    if wait:
        return Reply(429, {"detail": "rate_limited"},
                     {"Retry-After": str(wait)})
    params: dict[str, str] = {}
    dup = False
    for name, value in query:
        if name in PARAMS:
            dup = dup or name in params
            params[name] = value[:PARAM_MAX]
    rid = secrets.token_urlsafe(32)
    now = _now()
    with _LOCK:
        for k in [k for k, p in _pending.items() if p["exp"] <= now]:
            del _pending[k]
        _pending[rid] = {"params": params, "dup": dup, "exp": now + PENDING_TTL,
                         "subject": None, "tenant": None, "validated": None}
        while len(_pending) > PENDING_MAX:      # the oldest goes
            del _pending[next(iter(_pending))]
    return Reply(302, None, {"Location": CONSENT_ROUTE}, cookie=rid)


# ------------------------------------------------------------------ consent

def _find(rid: str | None, subject: str, tenant_id: str) -> dict | None:
    """The pending request of this browser, bound to the first signed-in
    subject that asks for it (anyone else gets nothing)."""
    if not rid:
        return None
    now = _now()
    with _LOCK:
        rec = _pending.get(rid)
        if rec is None:
            return None
        if rec["exp"] <= now:
            del _pending[rid]
            return None
        if rec["subject"] is None:
            rec["subject"], rec["tenant"] = subject, tenant_id
        elif rec["subject"] != subject or rec["tenant"] != tenant_id:
            return None
        return rec


def _take(rid: str) -> bool:
    """Remove a pending request (a decision is final); False if it was
    already gone - two decisions at once cannot both win."""
    with _LOCK:
        return _pending.pop(rid, None) is not None


def _cap_level() -> str:
    return mcpserver.CAP_LEVEL.get(cfgmod.assistant_access(), "read")


def _resource_ok(value: str | None) -> bool:
    """RFC 8707: the `resource` must be this server's MCP URL (scheme and
    host without regard to case, the path exactly)."""
    try:
        want = urllib.parse.urlsplit(cfgmod.mcp_url())
        got = urllib.parse.urlsplit(value or "")
        return (got.scheme.lower() == want.scheme
                and (got.hostname or "").lower() == want.hostname
                and got.port == want.port and got.path == want.path
                and not got.query and not got.fragment
                and "@" not in got.netloc)
    except ValueError:
        return False


def _redirect(base: str, **params) -> str:
    """`base` with the (non-empty) params added, plus the issuer (RFC 9207)."""
    params["iss"] = cfgmod.public_url()
    query = urllib.parse.urlencode([(k, v) for k, v in params.items() if v])
    return base + ("&" if "?" in base else "?") + query


def _decision(rid: str, rec: dict, **params) -> Reply:
    """End a request with an answer to the client's redirect URI."""
    _take(rid)
    url = _redirect(rec["validated"]["redirect_uri"],
                    state=rec["params"].get("state", ""), **params)
    return Reply(200, {"redirect_url": url}, _NO_STORE, cookie="")


def consent_get(rid: str | None, subject: str, tenant_id: str,
                account_names: list[str]) -> Reply:
    """`GET /api/assistants/connect`: validate the pending request and say
    what the page should show. Errors before the redirect URI is known to be
    the client's are answered as errors (shown in the page, never
    redirected); the rest end the request by redirecting back with `error`."""
    if not active():
        return _NOT_FOUND
    rec = _find(rid, subject, tenant_id)
    if rec is None:
        return _err(404, GONE)
    p = rec["params"]
    if rec["dup"]:
        return _err(400, BAD_REQUEST)
    try:
        client = oauthclients.get(p.get("client_id", ""))
    except oauthclients.ClientError as exc:
        return _err(400, str(exc))
    redirect_uri = p.get("redirect_uri", "")
    if redirect_uri not in client["redirect_uris"]:
        return _err(400, BAD_REDIRECT)
    rec["validated"] = {"client": client, "redirect_uri": redirect_uri}
    challenge = p.get("code_challenge", "")
    if p.get("response_type") != "code":
        return _decision(rid, rec, error="unsupported_response_type")
    if p.get("code_challenge_method") != "S256" \
            or not _CHALLENGE.fullmatch(challenge):
        return _decision(rid, rec, error="invalid_request")
    if not _resource_ok(p.get("resource")):
        return _decision(rid, rec, error="invalid_target")
    if not account_names:
        return _err(400, NO_ACCOUNTS)
    if not assistanttokens.grant_room(tenant_id):
        return _err(400, assistanttokens.TOO_MANY_GRANTS)
    ceiling = _ceiling(p.get("scope"))
    rec["validated"].update(challenge=challenge, ceiling=ceiling,
                            resource=cfgmod.mcp_url(), complete=True)
    name = client["name"] if client["name"] == client["host"] \
        else f"{client['name']} · {client['host']}"
    name = assistanttokens.unique_name(tenant_id, name)   # names are unique
    return Reply(200, {
        "request_id": rid,
        "client": {"client_id": client["client_id"], "host": client["host"],
                   "name": client["name"],
                   "redirect_host":
                       urllib.parse.urlsplit(redirect_uri).hostname},
        "ceiling": ceiling, "accounts": list(account_names),
        "defaults": {"level": "read", "subjects": False, "expires_days": 90,
                     "daily_cap": assistanttokens.DAILY_CAP_DEFAULT,
                     "name": name}}, _NO_STORE)


def _ceiling(scope) -> str:
    """The highest level the consent page may offer: what the app asked for
    (Read when it named no scope of ours), cut to the admin cap."""
    asked = assistanttokens.level_of(scope) or "read"
    return min(asked, _cap_level(), key=mcpserver.RANK.get)


def consent_post(body: dict, rid: str | None, subject: str, tenant_id: str,
                 account_names: list[str]) -> Reply:
    """`POST /api/assistants/connect`: the user's decision. Needs the same
    subject as the GET and `request_id` equal to the HttpOnly cookie; single
    use."""
    if not active():
        return _NOT_FOUND
    sent = body.get("request_id")
    if not rid or not isinstance(sent, str) \
            or not hmac.compare_digest(sent.encode(), rid.encode()):
        return _err(403, MISMATCH)
    rec = _find(rid, subject, tenant_id)
    valid = rec["validated"] if rec else None
    if valid is None or not valid.get("complete"):
        return _err(404, GONE)
    if not body.get("approve"):
        return _decision(rid, rec, error="access_denied")
    ceiling = min(valid["ceiling"], _cap_level(), key=mcpserver.RANK.get)
    try:
        name, accounts = assistanttokens.check_choices(
            body.get("name"), body.get("accounts"), body.get("level"),
            body.get("expires_days"), body.get("daily_cap"))
        if any(a not in account_names for a in accounts):
            raise assistanttokens.TokenError(assistanttokens.BAD_ACCOUNTS)
        if mcpserver.RANK[body["level"]] > mcpserver.RANK[ceiling]:
            return _err(400, ABOVE_CEILING)
        if not assistanttokens.name_free(tenant_id, name):
            raise assistanttokens.TokenError(assistanttokens.NAME_TAKEN)
        if not assistanttokens.grant_room(tenant_id):
            raise assistanttokens.TokenError(assistanttokens.TOO_MANY_GRANTS)
    except assistanttokens.TokenError as exc:
        return _err(400, str(exc))
    if not _take(rid):
        return _err(404, GONE)
    code = CODE_PREFIX + _b64(secrets.token_bytes(32))
    now = _now()
    client = valid["client"]
    with _LOCK:
        for k in [k for k, c in _codes.items() if c["exp"] <= now]:
            del _codes[k]
        _codes[_hash(code)] = {
            "exp": now + CODE_TTL, "client_id": client["client_id"],
            "client_name": client["name"], "client_host": client["host"],
            "redirect_uri": valid["redirect_uri"],
            "challenge": valid["challenge"], "resource": valid["resource"],
            "tenant": tenant_id, "owner": subject, "name": name,
            "accounts": accounts, "level": body["level"],
            "subjects": bool(body.get("subjects")),
            "expires_days": body.get("expires_days"),
            "daily_cap": body.get("daily_cap")}
    url = _redirect(valid["redirect_uri"], code=code,
                    state=rec["params"].get("state", ""))
    return Reply(200, {"redirect_url": url}, _NO_STORE, cookie="")


# -------------------------------------------------------------------- token

def _oauth_error(code: str, status: int = 400, description: str = "",
                 headers: dict | None = None) -> Reply:
    body = {"error": code}
    if description:
        body["error_description"] = description
    return Reply(status, body, {**_NO_STORE, **(headers or {})})


def _form(body: bytes, content_type: str) -> dict | Reply:
    """The form fields of a request body (each at most once), or the error
    reply. Only `application/x-www-form-urlencoded` is accepted."""
    if content_type.split(";")[0].strip().lower() != FORM:
        return _oauth_error("invalid_request", description="form body needed")
    try:
        pairs = urllib.parse.parse_qsl(
            body.decode("ascii"), keep_blank_values=True, max_num_fields=30)
    except (ValueError, UnicodeDecodeError):
        return _oauth_error("invalid_request")
    form = dict(pairs)
    if len(form) != len(pairs):
        return _oauth_error("invalid_request", description="repeated field")
    if any(name == "client_secret" for name, _ in pairs):
        return _oauth_error("invalid_client")     # only `none` exists
    return form


def _gate(body: bytes, content_type: str, authorization: str,
          peer: str) -> dict | Reply:
    """What the token and revocation endpoints share: switch, per-IP limit,
    form parsing and client authentication (only `none` exists)."""
    if not active():
        return _NOT_FOUND
    wait = _token_throttle.attempt(peer)
    if wait:
        return Reply(429, {"error": "temporarily_unavailable"},
                     {**_NO_STORE, "Retry-After": str(wait)})
    if authorization.lower().startswith("basic "):
        return _oauth_error("invalid_client", 401,
                            headers={"WWW-Authenticate": "Basic"})
    return _form(body, content_type)        # a client_assertion is ignored: we advertise `none`


def token(body: bytes, content_type: str, authorization: str, peer: str,
          resolve_tenant) -> Reply:
    """`POST /oauth/token`."""
    form = _gate(body, content_type, authorization, peer)
    if isinstance(form, Reply):
        return form
    grant = form.get("grant_type")
    if grant == "authorization_code":
        return _redeem_code(form, resolve_tenant)
    if grant == "refresh_token":
        return _refresh(form, resolve_tenant)
    return _oauth_error("unsupported_grant_type")


def _tokens_reply(rec: dict, access: str, refresh: str) -> Reply:
    return Reply(200, {
        "access_token": access, "token_type": "Bearer",
        "expires_in": max(1, int(rec["access_exp"]) - int(_now())),
        "refresh_token": refresh, "scope": rec["scope"]}, _NO_STORE)


def _redeem_code(form: dict, resolve_tenant) -> Reply:
    digest = _hash(form.get("code", ""))
    now = _now()
    with _LOCK:
        for k in [k for k, u in _used.items() if u["exp"] <= now]:
            del _used[k]
        entry = _codes.pop(digest, None)
        tomb = _used.get(digest)
        if entry is not None:
            # consumed on first sight: a wrong guess cannot be retried, and
            # the tombstone makes a second redemption recognisable
            _used[digest] = {"exp": now + USED_TTL, "grant": None}
    if entry is None:
        if tomb and tomb["grant"]:
            _end_grant(tomb["grant"], "system", "code_reuse")
        return _oauth_error("invalid_grant")
    verifier = form.get("code_verifier", "")
    if entry["exp"] <= now \
            or form.get("client_id") != entry["client_id"] \
            or form.get("redirect_uri") != entry["redirect_uri"] \
            or ("resource" in form and form["resource"] != entry["resource"]) \
            or not _VERIFIER.fullmatch(verifier) \
            or not hmac.compare_digest(_s256(verifier), entry["challenge"]) \
            or entry["resource"] != cfgmod.mcp_url():
        return _oauth_error("invalid_grant")
    tenant = tenants.by_id(entry["tenant"])
    if tenant is None or not mcpserver.owner_valid(
            {"tenant": entry["tenant"], "owner": entry["owner"]},
            resolve_tenant):
        return _oauth_error("invalid_grant")
    with tenants.use(tenant, entry["owner"]):
        accounts = [a for a in entry["accounts"] if a in accountsmod.names()]
    if not accounts:
        return _oauth_error("invalid_grant")
    try:
        rec, access, refresh = assistanttokens.create_grant(
            entry["tenant"], entry["owner"], entry["name"], accounts,
            entry["level"], entry["subjects"], entry["expires_days"],
            entry["daily_cap"],
            {k: entry[k] for k in ("client_id", "client_name", "client_host",
                                   "redirect_uri")}, entry["resource"])
    except assistanttokens.TokenError as exc:
        return _oauth_error("invalid_request", description=str(exc))
    with _LOCK:
        _used[digest]["grant"] = rec["id"]
    with tenants.use(tenant, entry["owner"]):
        for account in rec["accounts"]:
            auditlog.record("assistant_connected", account=account,
                            label=rec["name"])
        proposalmail.notify_connection(
            tenant, rec["accounts"][0], rec["client_host"], rec["level"])
    return _tokens_reply(rec, access, refresh)


def _refresh(form: dict, resolve_tenant) -> Reply:
    secret = form.get("refresh_token", "")
    rec = assistanttokens.find_refresh(secret)
    if rec is None or form.get("client_id") != rec.get("client_id"):
        return _oauth_error("invalid_grant")
    if "resource" in form and form["resource"] != rec.get("resource"):
        return _oauth_error("invalid_target")
    if rec.get("resource") != cfgmod.mcp_url() \
            or not mcpserver.owner_valid(rec, resolve_tenant):
        return _oauth_error("invalid_grant")
    narrow = None
    if form.get("scope", "").strip():
        narrow = assistanttokens.level_of(form["scope"])
        if narrow and mcpserver.RANK[narrow] > mcpserver.RANK[rec["level"]]:
            return _oauth_error("invalid_scope")
    status, new, access, refresh = assistanttokens.rotate(
        rec["id"], secret, narrow)
    if status == "reuse":
        assistantplans.drop_token(rec["id"])
        _audit_disconnected(new, "system", "refresh_reuse")
        return _oauth_error("invalid_grant")
    if status != "ok":
        return _oauth_error("invalid_grant")
    return _tokens_reply(new, access, refresh)


# ------------------------------------------------------------------- revoke

def revoke(body: bytes, content_type: str, authorization: str,
           peer: str) -> Reply:
    """`POST /oauth/revoke` (RFC 7009): any valid access or refresh token of
    the client ends its grant. A token that matches nothing is not an error."""
    form = _gate(body, content_type, authorization, peer)
    if isinstance(form, Reply):
        return form
    if not form.get("token"):
        return _oauth_error("invalid_request")
    rec = assistanttokens.revoke_by_secret(
        form["token"], form.get("client_id", ""))
    if rec is not None:
        assistantplans.drop_token(rec["id"])
        _audit_disconnected(rec, f"mcp:{rec['name']}")
    return Reply(200, {}, _NO_STORE)


# -------------------------------------------------------------------- audit

def _audit_disconnected(rec: dict, actor: str, reason: str = "") -> None:
    tenant = tenants.by_id(rec.get("tenant", ""))
    if tenant is None:
        return
    with tenants.use(tenant):
        for account in rec.get("accounts", []):
            auditlog.record("assistant_disconnected", actor=actor,
                            account=account, label=rec.get("name", ""),
                            outcome="error" if reason else "ok", error=reason)


def disconnected(rec: dict, actor: str) -> None:
    """A grant was ended by the user in Settings (main.py)."""
    _audit_disconnected(rec, actor)


def _end_grant(grant_id: str, actor: str, reason: str) -> None:
    rec = assistanttokens.delete(grant_id)
    if rec is not None:
        assistantplans.drop_token(grant_id)
        _audit_disconnected(rec, actor, reason)
