"""Access tokens of AI assistants (the MCP endpoint, backend/mcpserver.py).

One SERVER-level file (`assistant_tokens.json`, 0600, atomic write) holds the
tokens of every tenant: the endpoint authenticates by token before any tenant
is known, so the lookup cannot live in a tenant's own directory. Each record
names its tenant, and listing / revoking only ever touch the caller's own.

A token is `irk_` + 32 random bytes in base64url. Only its SHA-256 is stored;
the secret is shown once, when it is created. The file is not part of the
settings backup or export, and a restored backup never brings a token back.

A record with `kind: "oauth"` is the GRANT a hosted AI app got through the
OAuth flow (backend/oauthserver.py): the same record shape (owner, accounts,
level, daily cap, counters), so every limit and the token detail work
unchanged, but with a short-lived access token (`irk_at_`) and a rotating
refresh token (`irk_rt_`) in place of the one static secret. Records without
a `kind` are static tokens.

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
# The levels whose tools exist (a level is accepted by `create` once listed
# here): read (MCP1), propose (MCP4), act (MCP5).
AVAILABLE_LEVELS = ("read", "propose", "act")
EXPIRY_DAYS = (30, 90, None)
DAILY_CAP_DEFAULT = 2000
DAILY_CAP_MIN, DAILY_CAP_MAX = 100, 10_000
MAX_PER_TENANT = 20
MAX_GRANTS_PER_TENANT = 20          # OAuth grants count apart from tokens
NAME_MAX = 60

KIND_TOKEN, KIND_OAUTH = "token", "oauth"
ACCESS_PREFIX, REFRESH_PREFIX = "irk_at_", "irk_rt_"
ACCESS_TTL = 3600                   # an access token lives 1 hour
REFRESH_IDLE = 30 * 86400           # a refresh token 30 days without use
REFRESH_GRACE = 60                  # seconds: retry of a lost refresh answer
RETIRED_KEEP = 5                    # old refresh hashes remembered per grant
PURGE_AFTER = 7 * 86400             # an expired grant is dropped after this
# the OAuth scopes, cumulative: a grant's scope lists every one up to its level
SCOPES = {"mcp:read": "read", "mcp:propose": "propose", "mcp:act": "act"}

# coded refusals (the API answers 400 with these as `detail`)
BAD_NAME = "assistant_token_name"
NAME_TAKEN = "name_taken"           # another token or grant has this name
BAD_ACCOUNTS = "assistant_token_accounts"
BAD_EXPIRY = "assistant_token_expiry"
BAD_CAP = "assistant_token_cap"
BAD_LEVEL = "assistant_token_level"
LEVEL_NOT_AVAILABLE = "level_not_available"
TOO_MANY = "assistant_token_limit"
TOO_MANY_GRANTS = "assistant_grant_limit"
UNKNOWN = "assistant_token_unknown"
# `reserve` refused: the token's mails for today are used up (the text after
# the colon is how many are left)
CAP_REACHED = "daily_cap_reached"

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
    # codeql[py/clear-text-storage-sensitive-data]  (hashes only, see above)
    tmp.write_text(json.dumps({"tokens": tokens}, indent=1))
    tmp.chmod(0o600)
    tmp.replace(TOKENS_PATH)


# never leave the module: secrets' hashes and the owner's subject
_PRIVATE = frozenset({"hash", "owner", "access_hash", "refresh_hash",
                      "refresh_retired", "rotated_at", "successor_used"})


def _now() -> float:
    return time.time()


def scope_of(level: str) -> str:
    """The cumulative scope string of a level ("mcp:read mcp:propose")."""
    return " ".join(sc for sc, lv in SCOPES.items()
                    if LEVELS.index(lv) <= LEVELS.index(level))


def level_of(scope) -> str | None:
    """The highest level a scope string names (unknown scopes are ignored),
    or None when it names none."""
    found = [SCOPES[s] for s in str(scope or "").split() if s in SCOPES]
    return max(found, key=LEVELS.index) if found else None


def public(rec: dict) -> dict:
    """A record as the API lists it: everything but the hash."""
    out = {k: v for k, v in rec.items() if k not in _PRIVATE}
    out.setdefault("kind", KIND_TOKEN)
    if out.get("usage_day") != _today():
        out["calls_today"] = 0
        out["mails_today"] = 0
    out.pop("usage_day", None)
    return out


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def _roll(t: dict) -> None:
    """Restart a record's counters when the UTC day changed."""
    today = _today()
    if t.get("usage_day") != today:
        t["usage_day"], t["calls_today"], t["mails_today"] = today, 0, 0


def check_cap(value) -> int:
    """A daily cap as the API accepts it (an int in range), or BAD_CAP."""
    if isinstance(value, bool) or not isinstance(value, int) \
            or not DAILY_CAP_MIN <= value <= DAILY_CAP_MAX:
        raise TokenError(BAD_CAP)
    return value


def clean_name(name) -> str:
    """A name as one line of printable text."""
    return " ".join("".join(
        c if c.isprintable() else " " for c in str(name or "")).split())


def _taken(tokens: list[dict], tenant_id: str, name: str) -> bool:
    """Whether a name is in use in the tenant, whatever the case. Names are
    unique per tenant because the Activity filter finds a token's steps by its
    name (the audit actor `mcp:<name>`)."""
    low = name.casefold()
    return any(t.get("tenant") == tenant_id
               and str(t.get("name", "")).casefold() == low for t in tokens)


def _unique(tokens: list[dict], tenant_id: str, name: str) -> str:
    """`name`, or with " 2", " 3" ... appended until no token or grant of
    the tenant has it (the base is cut to keep the result within NAME_MAX)."""
    if not _taken(tokens, tenant_id, name):
        return name
    n = 2
    while True:
        tail = f" {n}"
        candidate = name[:NAME_MAX - len(tail)].rstrip() + tail
        if not _taken(tokens, tenant_id, candidate):
            return candidate
        n += 1


def name_free(tenant_id: str, name: str) -> bool:
    """Whether a (cleaned) name is still free in the tenant."""
    return not _taken(_read(), tenant_id, name)


def unique_name(tenant_id: str, name: str) -> str:
    """A free name for the tenant, starting from `name`."""
    return _unique(_read(), tenant_id, clean_name(name)[:NAME_MAX])


def check_choices(name, accounts, level, expires_days, daily_cap) -> tuple:
    """The choices of a new token or grant as the API accepts them: the
    cleaned name and the de-duplicated account list. Raises TokenError."""
    name = clean_name(name)
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
    check_cap(daily_cap)
    return name, accounts


def create(tenant_id: str, name: str, accounts: list[str], level: str = "read",
           subjects: bool = False, expires_days: int | None = None,
           daily_cap: int = DAILY_CAP_DEFAULT,
           owner: str = "") -> tuple[dict, str]:
    """A new token of one tenant: (public record, secret). The caller has
    checked that `accounts` exist in the tenant. `owner` is the creating
    session's subject: the endpoint re-checks that this person could still
    sign in and reach the tenant. Raises TokenError."""
    name, accounts = check_choices(name, accounts, level, expires_days, daily_cap)
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
        if sum(1 for t in tokens if t.get("tenant") == tenant_id
               and t.get("kind") != KIND_OAUTH) >= MAX_PER_TENANT:
            raise TokenError(TOO_MANY)
        if _taken(tokens, tenant_id, name):
            raise TokenError(NAME_TAKEN)
        tokens.append(rec)
        _write(tokens)
    return public(rec), secret


def list_for(tenant_id: str) -> list[dict]:
    """The tenant's tokens, oldest first, without secrets or hashes."""
    return [public(t) for t in _read() if t.get("tenant") == tenant_id]


def _new_pair() -> tuple[str, str]:
    """A fresh (access secret, refresh secret)."""
    def secret(prefix: str) -> str:
        return prefix + base64.urlsafe_b64encode(
            secrets.token_bytes(32)).decode().rstrip("=")
    return secret(ACCESS_PREFIX), secret(REFRESH_PREFIX)


def _purge(tokens: list[dict]) -> list[dict]:
    """The records without the grants that ended more than PURGE_AFTER ago
    (their absolute end, or the end of their refresh token)."""
    cutoff = _now() - PURGE_AFTER
    return [t for t in tokens if not (
        t.get("kind") == KIND_OAUTH
        and ((t.get("expires") or cutoff + 1) < cutoff
             or (t.get("refresh_exp") or cutoff + 1) < cutoff))]


def create_grant(tenant_id: str, owner: str, name: str, accounts: list[str],
                 level: str, subjects: bool, expires_days: int | None,
                 daily_cap: int, client: dict,
                 resource: str) -> tuple[dict, str, str]:
    """A new OAuth grant of one tenant, made when the app redeems its
    authorization code: (public record, access secret, refresh secret).
    `client` carries client_id, client_name, client_host and redirect_uri.
    Raises TokenError."""
    name, accounts = check_choices(name, accounts, level, expires_days, daily_cap)
    access, refresh = _new_pair()
    now = int(_now())
    expires = now + expires_days * 86400 if expires_days else None
    rec = {"id": secrets.token_hex(6), "kind": KIND_OAUTH,
           "tenant": tenant_id, "owner": owner, "name": name,
           "accounts": accounts, "level": level, "subjects": bool(subjects),
           "daily_cap": daily_cap, "created": now, "expires": expires,
           "client_id": client["client_id"],
           "client_name": client["client_name"],
           "client_host": client["client_host"],
           "redirect_uri": client["redirect_uri"], "resource": resource,
           "scope": scope_of(level),
           "access_hash": _hash(access),
           "access_exp": _cut(now + ACCESS_TTL, expires),
           "refresh_hash": _hash(refresh),
           "refresh_exp": _cut(now + REFRESH_IDLE, expires),
           "refresh_retired": [], "rotated_at": now, "successor_used": False,
           "last_used": None, "usage_day": _today(), "calls_today": 0,
           "mails_today": 0}
    with _LOCK:
        tokens = _purge(_read())
        if sum(1 for t in tokens if t.get("tenant") == tenant_id
               and t.get("kind") == KIND_OAUTH) >= MAX_GRANTS_PER_TENANT:
            raise TokenError(TOO_MANY_GRANTS)
        # the name was free when the user chose it; if it was taken since,
        # the connection still succeeds, under the next free one
        rec["name"] = _unique(tokens, tenant_id, name)
        tokens.append(rec)
        _write(tokens)
    return public(rec), access, refresh


def grant_room(tenant_id: str) -> bool:
    """Whether the tenant may still have one more OAuth grant."""
    return sum(1 for t in _read() if t.get("tenant") == tenant_id
               and t.get("kind") == KIND_OAUTH) < MAX_GRANTS_PER_TENANT


def _cut(moment: int, limit: int | None) -> int:
    return min(moment, limit) if limit else moment


def find_refresh(secret: str) -> dict | None:
    """The grant a refresh secret belongs to (the current one or a retired
    one), or None."""
    if not secret.startswith(REFRESH_PREFIX) or len(secret) > 200:
        return None
    digest = _hash(secret)
    found = None
    for t in _read():
        if t.get("kind") != KIND_OAUTH:
            continue
        if hmac.compare_digest(str(t.get("refresh_hash", "")), digest) or any(
                hmac.compare_digest(str(h), digest)
                for h in t.get("refresh_retired") or []):
            found = t
    return found


def rotate(token_id: str, secret: str,
           narrow_to: str | None = None) -> tuple[str, dict | None, str, str]:
    """Redeem a refresh secret, in one locked step: (status, record, new
    access secret, new refresh secret). Status:
      "ok"       the pair was replaced (`narrow_to` lowers the level for good)
      "invalid"  unknown, expired or no longer this grant's
      "reuse"    a retired secret came back: the grant was deleted
    The newest retired secret is accepted once more for REFRESH_GRACE seconds
    while the pair it was swapped for has not been used (the answer got lost
    on the way); any other retired secret is a replay."""
    digest = _hash(secret)
    now = int(_now())
    with _LOCK:
        tokens = _read()
        rec = next((t for t in tokens if t.get("id") == token_id
                    and t.get("kind") == KIND_OAUTH), None)
        if rec is None:
            return "invalid", None, "", ""
        retired = [str(h) for h in rec.get("refresh_retired") or []]
        if hmac.compare_digest(str(rec.get("refresh_hash", "")), digest):
            pass
        elif retired and hmac.compare_digest(retired[-1], digest) \
                and not rec.get("successor_used") \
                and now - int(rec.get("rotated_at") or 0) <= REFRESH_GRACE:
            retired.append(str(rec["refresh_hash"]))   # the unused successor
        elif any(hmac.compare_digest(h, digest) for h in retired):
            _write([t for t in tokens if t is not rec])
            return "reuse", public(rec), "", ""
        else:
            return "invalid", None, "", ""
        if (rec.get("expires") and rec["expires"] <= now) \
                or (rec.get("refresh_exp") or 0) <= now:
            return "invalid", None, "", ""
        if hmac.compare_digest(str(rec.get("refresh_hash", "")), digest):
            retired.append(digest)
        access, refresh = _new_pair()
        rec["refresh_retired"] = retired[-RETIRED_KEEP:]
        rec["access_hash"], rec["refresh_hash"] = _hash(access), _hash(refresh)
        rec["access_exp"] = _cut(now + ACCESS_TTL, rec.get("expires"))
        rec["refresh_exp"] = _cut(now + REFRESH_IDLE, rec.get("expires"))
        rec["rotated_at"], rec["successor_used"] = now, False
        if narrow_to and LEVELS.index(narrow_to) < LEVELS.index(rec["level"]):
            rec["level"], rec["scope"] = narrow_to, scope_of(narrow_to)
        _write(tokens)
        return "ok", public(rec), access, refresh


def revoke_by_secret(secret: str, client_id: str) -> dict | None:
    """RFC 7009: delete the grant an access or refresh secret of the given
    client belongs to; its public record, or None when nothing matched."""
    if not secret.startswith((ACCESS_PREFIX, REFRESH_PREFIX)) \
            or len(secret) > 200:
        return None
    digest = _hash(secret)
    with _LOCK:
        tokens = _read()
        hit = next((t for t in tokens if t.get("kind") == KIND_OAUTH
                    and t.get("client_id") == client_id
                    and (hmac.compare_digest(str(t.get("access_hash", "")),
                                             digest)
                         or hmac.compare_digest(
                             str(t.get("refresh_hash", "")), digest))), None)
        if hit is None:
            return None
        _write([t for t in tokens if t is not hit])
    return public(hit)


def delete(token_id: str) -> dict | None:
    """Delete a record whatever tenant it is in (the server itself ending a
    grant); its public record, or None."""
    with _LOCK:
        tokens = _read()
        hit = next((t for t in tokens if t.get("id") == token_id), None)
        if hit is None:
            return None
        _write([t for t in tokens if t is not hit])
    return public(hit)


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
    comparison; the file is read per call, so a revoke is immediate. A
    static token matches its `hash`, an OAuth access token its `access_hash`
    while `access_exp` lies ahead; a refresh token never matches here."""
    if not secret.startswith(PREFIX) or len(secret) > 200:
        return None
    digest = _hash(secret)
    now = _now()
    found = None
    for t in _read():
        if t.get("kind") == KIND_OAUTH:
            if hmac.compare_digest(str(t.get("access_hash", "")), digest) \
                    and (t.get("access_exp") or 0) > now:
                found = t
        elif hmac.compare_digest(str(t.get("hash", "")), digest):
            found = t
    if found is None:
        return None
    if found.get("expires") and found["expires"] <= now:
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
            _roll(t)
            t["last_used"] = int(time.time())
            if t.get("kind") == KIND_OAUTH:
                t["successor_used"] = True   # the client has its new pair
            if call:
                t["calls_today"] = t.get("calls_today", 0) + 1
            _write(tokens)
            return


def set_cap(tenant_id: str, token_id: str, daily_cap) -> dict:
    """Change one of the tenant's tokens' daily cap (it applies from the next
    plan on); returns its public record. Raises TokenError."""
    check_cap(daily_cap)
    with _LOCK:
        tokens = _read()
        hit = next((t for t in tokens if t.get("id") == token_id
                    and t.get("tenant") == tenant_id), None)
        if hit is None:
            raise TokenError(UNKNOWN)
        hit["daily_cap"] = daily_cap
        _write(tokens)
    return public(hit)


def mails_left(token_id: str) -> int:
    """How many mails the token may still move today (0 for a vanished
    token)."""
    for t in _read():
        if t.get("id") == token_id:
            _roll(t)
            return max(0, int(t.get("daily_cap", DAILY_CAP_DEFAULT))
                       - int(t.get("mails_today", 0)))
    return 0


def reserve(token_id: str, n: int) -> str:
    """Count `n` mails against today's cap BEFORE they are moved, in one
    locked step (two plans applied at once cannot both slip under it).
    Returns the UTC day they were counted on (`refund` needs it). Raises
    TokenError("daily_cap_reached:<left>") when it would not fit."""
    with _LOCK:
        tokens = _read()
        for t in tokens:
            if t.get("id") != token_id:
                continue
            _roll(t)
            cap = int(t.get("daily_cap", DAILY_CAP_DEFAULT))
            used = int(t.get("mails_today", 0))
            if used + n > cap:
                raise TokenError(f"{CAP_REACHED}:{max(0, cap - used)}")
            t["mails_today"] = used + n
            _write(tokens)
            return t["usage_day"]
        raise TokenError(UNKNOWN)


def refund(token_id: str, n: int, day: str) -> None:
    """Give back mails that were reserved but not moved, to the UTC day
    `reserve` counted them on: when midnight has passed since, that day's
    counter is gone and today's is not touched."""
    if n <= 0:
        return
    with _LOCK:
        tokens = _read()
        for t in tokens:
            if t.get("id") == token_id:
                _roll(t)
                if t["usage_day"] != day:
                    return
                t["mails_today"] = max(0, int(t.get("mails_today", 0)) - n)
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
