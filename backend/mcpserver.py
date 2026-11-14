"""`POST /mcp`: a small MCP (Model Context Protocol) server for AI assistants.

Tools only, stateless, JSON responses only: no sessions (`Mcp-Session-Id` is
never issued and ignored when sent), no SSE, no batches. Two eras are served
side by side, picked per request by how the client opens it:

  * 2026-07-28 ("modern"): every request carries its protocol version and
    client capabilities in `_meta` and the `MCP-Protocol-Version` / `Mcp-Method`
    / `Mcp-Name` headers, which must agree with the body. `server/discover`
    announces versions and identity; there is no `initialize` and no `ping`.
  * 2025-06-18 and 2025-11-25 ("legacy"): `initialize`, `ping`, `tools/list`,
    `tools/call`. Nothing is remembered between requests, so a client's
    `initialize` is answered but not required before the other calls.

Access is by bearer token only (backend/assistanttokens.py); cookies play no
part, whatever the login mode. The admin cap (`assistants.access`, default
off) switches the whole endpoint off with a 404.

`handle` is a pure function of (method, headers, query string, body) so the
route in main.py stays a thin shim and the browser demo can import it."""

from __future__ import annotations

import base64
import collections
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qsl

from . import accounts as accountsmod
from . import assistanttokens
from . import auth as authmod
from . import config as cfgmod
from . import demo as demomod
from . import mailops
from . import mcptools
from . import tenants

log = logging.getLogger("inboxrake.mcp")

MODERN = "2026-07-28"
LEGACY = ("2025-11-25", "2025-06-18")
SUPPORTED = (MODERN, *LEGACY)
KEY_VERSION = "io.modelcontextprotocol/protocolVersion"
KEY_CAPS = "io.modelcontextprotocol/clientCapabilities"
KEY_SERVER = "io.modelcontextprotocol/serverInfo"

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
HEADER_MISMATCH = -32020           # 2026-07-28 spec range
UNSUPPORTED_VERSION = -32022

# how long a client may reuse tools/list and server/discover: short, because
# the admin cap and the token's level can change what they say
TTL_MS = 60_000

# Per token: this many requests in any window of RATE_WINDOW seconds (the
# spec asks servers to rate-limit tool invocations). In memory, so it restarts
# with the process; independent of the daily cap of later levels.
RATE_LIMIT = 120
RATE_WINDOW = 60.0
_rate: dict[str, collections.deque] = {}
_rate_lock = threading.Lock()

_RANK = {"read": 1, "propose": 2, "act": 3}
_CAP_LEVEL = {"read_propose": "propose", "act": "act"}
_QUERY_TOKEN_NAMES = frozenset({"access_token", "token", "api_key", "apikey",
                                "key", "bearer", "authorization"})

INSTRUCTIONS = (
    "Inboxrake is a mailbox cleaner. These tools read metadata of one "
    "mailbox (senders, counts, sizes, dates); message bodies are not "
    "available. " + mcptools.DATA_SENTENCE)


def _server_version() -> str:
    try:
        v = (Path(__file__).resolve().parent.parent
             / "version.txt").read_text().strip()
    except OSError:
        return "0.0.0-dev"
    return v or "0.0.0-dev"


def _server_info() -> dict:
    return {"name": "inboxrake", "title": "Inboxrake",
            "version": _server_version()}


@dataclass
class Reply:
    status: int
    body: dict | None = None            # None: an empty body (202)
    headers: dict[str, str] = field(default_factory=dict)


def _error(rid, code: int, message: str, status: int = 200,
           data: dict | None = None) -> Reply:
    err = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return Reply(status, {"jsonrpc": "2.0", "id": rid, "error": err})


def _plain(status: int, detail: str, headers: dict | None = None) -> Reply:
    return Reply(status, {"detail": detail}, headers or {})


def _unsupported(rid, requested) -> Reply:
    return _error(rid, UNSUPPORTED_VERSION, "Unsupported protocol version",
                  400, {"supported": list(SUPPORTED),
                        "requested": mcptools.clean(requested, 40)})


def effective_level(token_level: str) -> str | None:
    """The lower of the token's level and the admin cap; None when the cap
    is off."""
    cap = _CAP_LEVEL.get(cfgmod.assistant_access())
    if cap is None:
        return None
    return min((token_level, cap), key=lambda lv: _RANK.get(lv, 0))


def _bearer(headers) -> str:
    value = (headers.get("authorization") or "").strip()
    scheme, _, secret = value.partition(" ")
    return secret.strip() if scheme.lower() == "bearer" else ""


def _unauthorized(invalid: bool) -> Reply:
    challenge = 'Bearer error="invalid_token"' if invalid else "Bearer"
    return Reply(401, {"detail": "unauthorized"},
                 {"WWW-Authenticate": challenge})


def _token_in_query(query: str) -> bool:
    for name, value in parse_qsl(query or "", keep_blank_values=True):
        if name.lower() in _QUERY_TOKEN_NAMES \
                or value.startswith(assistanttokens.PREFIX):
            return True
    return False


def _header_value(raw: str | None) -> str | None:
    """A header value, with the `=?base64?...?=` sentinel decoded (None: the
    header is absent; ValueError: it is malformed)."""
    if raw is None:
        return None
    if raw.startswith("=?base64?") and raw.endswith("?="):
        try:
            return base64.b64decode(raw[9:-2], validate=True).decode()
        except (ValueError, UnicodeDecodeError):
            raise ValueError("bad base64") from None
    return raw


def _rate_wait(token_id: str) -> int:
    """0 and the request is counted, or the seconds until the token may call
    again."""
    now = time.monotonic()
    with _rate_lock:
        hits = _rate.setdefault(token_id, collections.deque())
        while hits and now - hits[0] >= RATE_WINDOW:
            hits.popleft()
        if len(hits) >= RATE_LIMIT:
            return max(1, int(RATE_WINDOW - (now - hits[0])) + 1)
        hits.append(now)
        if len(_rate) > 1000:           # forget tokens that went quiet
            for k in [k for k, h in _rate.items()
                      if not h or now - h[-1] >= RATE_WINDOW]:
                del _rate[k]
    return 0


def owner_valid(rec: dict, resolve_tenant) -> bool:
    """Whether the token's owner could sign in right now and would land in
    the token's tenant: the login mode, the SSO allow-list and the tenant
    mapping are re-checked on every request, so removing someone (or
    changing the mode) ends their tokens at once. Without a login (none /
    password) everyone reaches the DEFAULT tenant only."""
    auth = cfgmod.load_server()["auth"]
    mode = auth["mode"]
    if mode != "oidc":
        return rec.get("tenant") == tenants.DEFAULT_ID
    owner = rec.get("owner") or ""
    if not owner or owner == "password":
        return False
    allowed = auth["oidc"].get("allowed") or []
    if allowed:
        # the login's own admission check, on what the login recorded
        claims = {"email": auth.get("identity_labels", {}).get(owner, owner),
                  "sub": auth.get("identity_subs", {}).get(owner, ""),
                  "email_verified": True}
        if not authmod.allowed_subject(claims, allowed):
            return False
    try:
        return resolve_tenant(mode, auth, owner).id == rec.get("tenant")
    except Exception:
        return False


def handle(method: str, headers, query: str, body: bytes,
           resolve_tenant) -> Reply:
    """One HTTP request to /mcp. The caller has already applied the Origin
    and Host guards and the body limit; `resolve_tenant(mode, auth_cfg, sub)`
    is the login's own subject -> workspace mapping."""
    if demomod.enabled():
        return _plain(404, mailops.NOT_IN_DEMO)
    if cfgmod.assistant_access() == "off":
        return _plain(404, "not found")
    if method != "POST":
        return _plain(405, "method not allowed", {"Allow": "POST"})
    if _token_in_query(query):
        return _plain(400, "token_in_query")
    secret = _bearer(headers)
    if not secret:
        return _unauthorized(False)
    rec = assistanttokens.lookup(secret)
    tenant = assistanttokens.tenant_of(rec) if rec else None
    if rec is None or tenant is None or not owner_valid(rec, resolve_tenant):
        return _unauthorized(True)
    wait = _rate_wait(rec["id"])
    if wait:
        return _plain(429, "rate_limited", {"Retry-After": str(wait)})
    tenants.activate(tenant, "")
    level = effective_level(rec["level"])
    names = [a for a in rec["accounts"] if a in accountsmod.names()]
    if level is None or not names:
        return _plain(404 if level is None else 403, "no_access")

    try:
        msg = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return _error(None, PARSE_ERROR, "Parse error", 400)
    if isinstance(msg, list):
        return _error(None, INVALID_REQUEST,
                      "Batch requests are not supported", 400)
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return _error(None, INVALID_REQUEST, "Invalid request", 400)
    if "method" not in msg:
        if "result" in msg or "error" in msg:   # a client's reply: nothing
            return Reply(202)                    # of ours ever asks for one
        return _error(None, INVALID_REQUEST, "Invalid request", 400)
    if not isinstance(msg["method"], str):
        return _error(None, INVALID_REQUEST, "Invalid request", 400)
    if "id" not in msg:
        return Reply(202)                        # a notification
    rid = msg["id"]
    if isinstance(rid, bool) or not isinstance(rid, (str, int)):
        return _error(None, INVALID_REQUEST, "Invalid request id", 400)
    assistanttokens.touch(rec["id"], call=msg["method"] == "tools/call")
    params = msg.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return _error(rid, INVALID_PARAMS, "params must be an object", 400)

    ctx = mcptools.Ctx(accounts=names, subjects=bool(rec.get("subjects")))
    meta = params.get("_meta")
    meta = meta if isinstance(meta, dict) else {}
    header_version = headers.get("mcp-protocol-version")
    if header_version == MODERN or KEY_VERSION in meta:
        return _modern(rid, msg["method"], params, meta, headers,
                       header_version, level, ctx, rec)
    if header_version is not None and header_version not in LEGACY:
        return _unsupported(rid, header_version)
    return _legacy(rid, msg["method"], params, level, ctx, rec)


# ------------------------------------------------------------------- modern

def _modern(rid, rpc_method: str, params: dict, meta: dict, headers,
            header_version, level: str, ctx, rec: dict) -> Reply:
    version = meta.get(KEY_VERSION)
    if header_version is None:
        return _error(rid, HEADER_MISMATCH,
                      "Header mismatch: MCP-Protocol-Version is missing", 400)
    if version != header_version:
        return _error(rid, HEADER_MISMATCH,
                      "Header mismatch: MCP-Protocol-Version does not match "
                      "the protocol version in _meta", 400)
    if version != MODERN:
        return _unsupported(rid, version)
    if not isinstance(meta.get(KEY_CAPS), dict):
        return _error(rid, INVALID_PARAMS, "_meta is missing "
                      "io.modelcontextprotocol/clientCapabilities", 400)
    try:
        mcp_method = headers.get("mcp-method")
        if mcp_method != rpc_method:
            return _error(rid, HEADER_MISMATCH, "Header mismatch: Mcp-Method "
                          "is missing or does not match the method", 400)
        if rpc_method == "tools/call":
            name = _header_value(headers.get("mcp-name"))
            if name is None or name != params.get("name"):
                return _error(rid, HEADER_MISMATCH, "Header mismatch: "
                              "Mcp-Name is missing or does not match the "
                              "tool name", 400)
    except ValueError:
        return _error(rid, HEADER_MISMATCH,
                      "Header mismatch: malformed header value", 400)

    stamp = {"resultType": "complete", "_meta": {KEY_SERVER: _server_info()}}
    if rpc_method == "server/discover":
        return _result(rid, {
            **stamp, "supportedVersions": list(SUPPORTED),
            "capabilities": {"tools": {"listChanged": False}},
            "instructions": INSTRUCTIONS, "ttlMs": TTL_MS,
            "cacheScope": "private"})
    if rpc_method == "tools/list":
        return _result(rid, {
            **stamp, "tools": _tools(level), "ttlMs": TTL_MS,
            "cacheScope": "private"})
    if rpc_method == "tools/call":
        return _call(rid, params, level, ctx, rec, stamp, error_status=400)
    text = "Method not found"
    if rpc_method == "initialize":
        text += (": there is no initialize in protocol version " + MODERN
                 + "; supported versions: " + ", ".join(SUPPORTED))
    return _error(rid, METHOD_NOT_FOUND, text, 404)


# ------------------------------------------------------------------- legacy

def _legacy(rid, rpc_method: str, params: dict, level: str, ctx,
            rec: dict) -> Reply:
    if rpc_method == "initialize":
        wanted = params.get("protocolVersion")
        if not isinstance(wanted, str):
            return _error(rid, INVALID_PARAMS,
                          "initialize needs a protocolVersion")
        return _result(rid, {
            # a version we do not know gets our newest legacy one; the
            # client decides whether it can speak it
            "protocolVersion": wanted if wanted in LEGACY else LEGACY[0],
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": _server_info(), "instructions": INSTRUCTIONS})
    if rpc_method == "ping":
        return _result(rid, {})
    if rpc_method == "tools/list":
        return _result(rid, {"tools": _tools(level)})
    if rpc_method == "tools/call":
        return _call(rid, params, level, ctx, rec, {}, error_status=200)
    return _error(rid, METHOD_NOT_FOUND, "Method not found")


# ------------------------------------------------------------------- shared

def _result(rid, result: dict) -> Reply:
    return Reply(200, {"jsonrpc": "2.0", "id": rid, "result": result})


def _tools(level: str) -> list[dict]:
    return [mcptools.describe(t) for t in mcptools.available(level)]


def _call(rid, params: dict, level: str, ctx, rec: dict, stamp: dict,
          error_status: int) -> Reply:
    name = params.get("name")
    arguments = params.get("arguments")
    if not isinstance(name, str) or not (
            arguments is None or isinstance(arguments, dict)):
        return _error(rid, INVALID_PARAMS, "tools/call needs a name and "
                      "object arguments", error_status)
    out = mcptools.call(level, ctx, name, arguments)
    if out is None:
        return _error(rid, INVALID_PARAMS,
                      "Unknown tool: " + mcptools.clean(name, 80),
                      error_status)
    return _result(rid, {**stamp, **out})
