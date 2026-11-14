"""Access tokens of AI assistants (the MCP endpoint, backend/mcpserver.py).

One SERVER-level file (`assistant_tokens.json`, 0600, atomic write) holds the
tokens of every tenant: the endpoint authenticates by token before any tenant
is known, so the lookup cannot live in a tenant's own directory. Each record
names its tenant, and listing / revoking only ever touch the caller's own.

A token is `irk_` + 32 random bytes in base64url. Only its SHA-256 is stored;
the secret is shown once, when it is created. The file is not part of the
settings backup or export, and a restored backup never brings a token back.

Pure Python and stdlib only (the browser demo bundles every backend module)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from pathlib import Path

from . import tenants

TOKENS_PATH = Path(os.environ.get("ASSISTANT_TOKENS_PATH",
                                  "/data/assistant_tokens.json"))

PREFIX = "irk_"
LEVELS = ("read", "propose", "act")
# MCP1 hands out read tokens only; the other levels arrive with their tools
# (they are accepted by `create` once listed here).
AVAILABLE_LEVELS = ("read",)
EXPIRY_DAYS = (30, 90, None)
DAILY_CAP_DEFAULT = 2000
DAILY_CAP_MIN, DAILY_CAP_MAX = 100, 10_000
MAX_PER_TENANT = 20
NAME_MAX = 60

# coded refusals (the API answers 400 with these as `detail`)
BAD_NAME = "assistant_token_name"
BAD_ACCOUNTS = "assistant_token_accounts"
BAD_EXPIRY = "assistant_token_expiry"
BAD_CAP = "assistant_token_cap"
BAD_LEVEL = "assistant_token_level"
LEVEL_NOT_AVAILABLE = "level_not_available"
TOO_MANY = "assistant_token_limit"
UNKNOWN = "assistant_token_unknown"

_LOCK = threading.Lock()


class TokenError(ValueError):
    """A refused request; the text is the stable code."""


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _read() -> list[dict]:
    try:
        data = json.loads(TOKENS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    tokens = data.get("tokens") if isinstance(data, dict) else None
    return [t for t in tokens if isinstance(t, dict)] \
        if isinstance(tokens, list) else []


def _write(tokens: list[dict]) -> None:
    TOKENS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = TOKENS_PATH.with_suffix(".tmp")
    # Only the SHA-256 of a 256-bit random secret (a password hash would add
    # nothing: there is no guessable input) and a display prefix are stored,
    # never the secret itself.
    tmp.write_text(json.dumps({"tokens": tokens}, indent=1))
    tmp.chmod(0o600)
    tmp.replace(TOKENS_PATH)


def public(rec: dict) -> dict:
    """A record as the API lists it: everything but the hash."""
    out = {k: v for k, v in rec.items() if k not in ("hash", "owner")}
    if out.get("usage_day") != _today():
        out["calls_today"] = 0
        out["mails_today"] = 0
    out.pop("usage_day", None)
    return out


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def create(tenant_id: str, name: str, accounts: list[str], level: str = "read",
           subjects: bool = False, expires_days: int | None = None,
           daily_cap: int = DAILY_CAP_DEFAULT,
           owner: str = "") -> tuple[dict, str]:
    """A new token of one tenant: (public record, secret). The caller has
    checked that `accounts` exist in the tenant. `owner` is the creating
    session's subject: the endpoint re-checks that this person could still
    sign in and reach the tenant. Raises TokenError."""
    name = " ".join("".join(
        c if c.isprintable() else " " for c in str(name or "")).split())
    if not name or len(name) > NAME_MAX:
        raise TokenError(BAD_NAME)
    if not isinstance(accounts, list) or not accounts \
            or not all(isinstance(a, str) and a for a in accounts):
        raise TokenError(BAD_ACCOUNTS)
    accounts = list(dict.fromkeys(accounts))
    if level not in LEVELS:
        raise TokenError(BAD_LEVEL)
    if level not in AVAILABLE_LEVELS:
        raise TokenError(LEVEL_NOT_AVAILABLE)
    if expires_days not in EXPIRY_DAYS:
        raise TokenError(BAD_EXPIRY)
    if isinstance(daily_cap, bool) or not isinstance(daily_cap, int) \
            or not DAILY_CAP_MIN <= daily_cap <= DAILY_CAP_MAX:
        raise TokenError(BAD_CAP)
    # The secret is `irk_` + 4 random characters (the display prefix, drawn
    # first and kept as such) + 32 random bytes in base64url: 256 bits stay
    # unknown after the prefix.
    shown = secrets.token_urlsafe(3)
    secret = PREFIX + shown + base64.urlsafe_b64encode(
        secrets.token_bytes(32)).decode().rstrip("=")
    now = int(time.time())
    rec = {"id": secrets.token_hex(6), "tenant": tenant_id, "owner": owner,
           "name": name,
           "prefix": PREFIX + shown, "hash": _hash(secret),
           "accounts": accounts, "level": level, "subjects": bool(subjects),
           "daily_cap": daily_cap, "created": now,
           "expires": now + expires_days * 86400 if expires_days else None,
           "last_used": None, "usage_day": _today(), "calls_today": 0,
           "mails_today": 0}
    with _LOCK:
        tokens = _read()
        if sum(1 for t in tokens if t.get("tenant") == tenant_id) \
                >= MAX_PER_TENANT:
            raise TokenError(TOO_MANY)
        tokens.append(rec)
        _write(tokens)
    return public(rec), secret


def list_for(tenant_id: str) -> list[dict]:
    """The tenant's tokens, oldest first, without secrets or hashes."""
    return [public(t) for t in _read() if t.get("tenant") == tenant_id]


def level_counts() -> dict[str, int]:
    """How many unexpired tokens of every tenant have each level: only
    numbers, for the admin's "lower the cap?" question (the cap is
    server-wide, the token list is per tenant)."""
    now = time.time()
    out = {level: 0 for level in LEVELS}
    for t in _read():
        if t.get("expires") and t["expires"] <= now:
            continue
        if t.get("level") in out:
            out[t["level"]] += 1
    return out


def revoke(tenant_id: str, token_id: str) -> dict:
    """Delete one of the tenant's tokens (it stops working at once); returns
    its public record. Raises TokenError(UNKNOWN)."""
    with _LOCK:
        tokens = _read()
        hit = next((t for t in tokens if t.get("id") == token_id
                    and t.get("tenant") == tenant_id), None)
        if hit is None:
            raise TokenError(UNKNOWN)
        _write([t for t in tokens if t is not hit])
    return public(hit)


def lookup(secret: str) -> dict | None:
    """The record of a presented secret, or None (unknown, revoked or
    expired). Compares against every stored hash in constant time per
    comparison; the file is read per call, so a revoke is immediate."""
    if not secret.startswith(PREFIX) or len(secret) > 200:
        return None
    digest = _hash(secret)
    found = None
    for t in _read():
        if hmac.compare_digest(str(t.get("hash", "")), digest):
            found = t
    if found is None:
        return None
    if found.get("expires") and found["expires"] <= time.time():
        return None
    return found


def touch(token_id: str, call: bool = False) -> None:
    """Note a use: last used, and (for a tool call) calls today. Counters
    restart each UTC day."""
    with _LOCK:
        tokens = _read()
        for t in tokens:
            if t.get("id") != token_id:
                continue
            today = _today()
            if t.get("usage_day") != today:
                t["usage_day"], t["calls_today"], t["mails_today"] = \
                    today, 0, 0
            t["last_used"] = int(time.time())
            if call:
                t["calls_today"] = t.get("calls_today", 0) + 1
            _write(tokens)
            return


def rename_account(tenant_id: str, old: str, new: str) -> None:
    with _LOCK:
        tokens = _read()
        changed = False
        for t in tokens:
            if t.get("tenant") == tenant_id and old in t.get("accounts", []):
                t["accounts"] = list(dict.fromkeys(
                    new if a == old else a for a in t["accounts"]))
                changed = True
        if changed:
            _write(tokens)


def drop_account(tenant_id: str, name: str) -> None:
    """A deleted account leaves every token's list; a token left without an
    account is removed (it could reach nothing)."""
    with _LOCK:
        tokens = _read()
        out = []
        changed = False
        for t in tokens:
            if t.get("tenant") == tenant_id and name in t.get("accounts", []):
                t["accounts"] = [a for a in t["accounts"] if a != name]
                changed = True
                if not t["accounts"]:
                    continue
            out.append(t)
        if changed:
            _write(out)


def tenant_of(rec: dict) -> tenants.Tenant | None:
    return tenants.by_id(rec.get("tenant", ""))
