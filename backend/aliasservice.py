"""The optional link to an e-mail alias service (SimpleLogin or addy.io): it
lets Inboxrake switch an alias off ("Retire this alias") and make a fresh one.
Everything else on the Your addresses page works without it - the scan finds
the leaked address from the mail itself.

Opt-in: nothing happens until the user adds an API key in Settings -> Alias
service. The key is stored like the other secrets (`secretbox`, per tenant),
never sent back to the browser, never logged. The only outbound hosts are the
two services' public API hosts below.

All network traffic goes through `request()`, the one seam: the in-browser
demo has no sockets (backend/demo.py: the denied socket raises, which
`_call` turns into the coded "not available in the demo"), and the demo
script / tests replace `request` with an in-memory service.

stdlib HTTP only, short timeouts, coded errors (`mailops.coded`): the UI
words them. No alias address, id or key ever appears in an error."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, NamedTuple

from . import demo
from . import mailops
from . import secretbox
from . import tenants

log = logging.getLogger("inboxrake.aliasservice")

# service id -> API base (the maintainer-approved hosts; tests/allowed_domains.txt)
SERVICES: dict[str, str] = {
    "simplelogin": "https://app.simplelogin.io/api",
    "addy": "https://app.addy.io/api/v1",
}
TIMEOUT = 10                 # seconds, per call
MAX_PAGES = 200              # alias pages read at most (20 - 100 aliases each)
MAX_BODY = 4_000_000         # bytes of one answer read at most

ALIAS_PATH = Path(os.environ.get("ALIAS_SERVICE_PATH",
                                 "/data/alias_service.json"))
_LOCK = threading.Lock()


class AliasError(RuntimeError):
    """A refusal with a stable code (`mailops.coded`) as its text."""


class Alias(NamedTuple):
    id: str
    email: str
    on: bool


# ------------------------------------------------------------- the seam

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """An API answering with a redirect is not one of ours: never follow it
    (urllib would resend the key header to the new host)."""

    def redirect_request(self, *args, **kwargs):
        return None


def request(method: str, url: str, headers: dict[str, str],
            body: bytes | None = None) -> tuple[int, Any]:
    """One HTTPS call: (status, parsed JSON or None). Network failures raise
    OSError / URLError; an error STATUS is returned, not raised. This is the
    function the demo script and the tests replace."""
    req = urllib.request.Request(url, data=body, method=method,
                                 headers=headers)
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=TIMEOUT) as res:
            status, raw = res.status, res.read(MAX_BODY)
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, b""
        try:
            raw = exc.read(MAX_BODY)
        except OSError:
            pass
    try:
        return status, (json.loads(raw) if raw else None)
    except ValueError:
        return status, None


# --------------------------------------------------------------- storage

def _path() -> Path:
    return tenants.current().file("alias_service.json", ALIAS_PATH)


def _read() -> dict:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def _config() -> tuple[str, str]:
    """(service, API key) - ("", "") unless both are set."""
    data = _read()
    service = data.get("service")
    key = secretbox.unseal(str(data.get("key") or ""))
    return (service, key) if service in SERVICES and key else ("", "")


def connected() -> bool:
    return bool(_config()[0])


def _cached() -> dict[str, dict]:
    aliases = _read().get("aliases")
    return aliases if isinstance(aliases, dict) else {}


def cached_aliases() -> frozenset[str]:
    """The alias addresses of the last successful sync (lower-case); what the
    scan matches mail against. Never calls the service."""
    return frozenset(a for a in _cached() if isinstance(a, str))


def status() -> dict:
    """What Settings shows - never the key."""
    data = _read()
    service = data.get("service") if data.get("service") in SERVICES else ""
    return {
        "service": service,
        "key_set": bool(secretbox.unseal(str(data.get("key") or ""))),
        "aliases": len(_cached()) if data.get("synced_ts") else None,
        "synced_ts": int(data.get("synced_ts") or 0),
        "error": str(data.get("error") or ""),
        "services": list(SERVICES),
    }


def configure(service: str, key: str | None = None) -> dict:
    """Choose the service and / or replace the API key (`None` or empty
    keeps the stored one). A different service forgets the key and the alias
    cache of the old one."""
    if service not in SERVICES:
        raise AliasError(mailops.coded(mailops.ALIAS_NO_SERVICE))
    with _LOCK:
        data = _read()
        if data.get("service") != service:
            data = {}
        data["service"] = service
        if key and key.strip():
            data["key"] = secretbox.seal(key.strip())
            data.pop("aliases", None)
            data.pop("synced_ts", None)
            data.pop("error", None)
        _write(data)
    return status()


def disconnect() -> dict:
    with _LOCK:
        _write({})
    return status()


# ----------------------------------------------------------- API client

def _headers(service: str, key: str) -> dict[str, str]:
    if service == "simplelogin":
        return {"Authentication": key, "Content-Type": "application/json",
                "Accept": "application/json"}
    return {"Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest"}


def _call(method: str, path: str, body: dict | None = None,
          ok: tuple[int, ...] = (200, 201, 204)) -> Any:
    """One API call with the stored key; the answer's JSON, or a coded
    AliasError."""
    service, key = _config()
    if not service:
        raise AliasError(mailops.coded(mailops.ALIAS_NO_SERVICE))
    try:
        status_code, payload = request(
            method, SERVICES[service] + path, _headers(service, key),
            json.dumps(body).encode() if body is not None else None)
    except Exception as exc:     # URLError, timeouts, the demo's denied socket
        if demo.denied(exc):
            raise AliasError(mailops.coded(mailops.NOT_IN_DEMO)) from None
        log.warning("alias service %s unreachable (%s)", service,
                    type(exc).__name__)
        raise AliasError(mailops.coded(mailops.ALIAS_UNREACHABLE)) from None
    if status_code in ok:
        return payload
    log.warning("alias service %s answered %s to %s", service, status_code,
                method)
    if status_code in (401, 403):
        raise AliasError(mailops.coded(mailops.ALIAS_KEY))
    if status_code == 404:
        raise AliasError(mailops.coded(mailops.ALIAS_NOT_FOUND))
    raise AliasError(mailops.coded(mailops.ALIAS_HTTP, status=status_code))


def _list_simplelogin() -> list[Alias]:
    out: list[Alias] = []
    for page in range(MAX_PAGES):
        data = _call("GET", f"/v2/aliases?page_id={page}")
        rows = (data or {}).get("aliases") if isinstance(data, dict) else None
        if not rows:
            break
        out += [Alias(str(r["id"]), str(r["email"]).lower(),
                      bool(r.get("enabled")))
                for r in rows if isinstance(r, dict) and r.get("email")]
    return out


def _list_addy() -> list[Alias]:
    out: list[Alias] = []
    for page in range(1, MAX_PAGES + 1):
        data = _call("GET", f"/aliases?page%5Bnumber%5D={page}"
                            "&page%5Bsize%5D=100")
        rows = (data or {}).get("data") if isinstance(data, dict) else None
        if not rows:
            break
        out += [Alias(str(r["id"]), str(r["email"]).lower(),
                      bool(r.get("active")))
                for r in rows if isinstance(r, dict) and r.get("email")]
        if len(rows) < 100:
            break
    return out


def list_aliases() -> list[Alias]:
    service, _ = _config()
    if not service:
        raise AliasError(mailops.coded(mailops.ALIAS_NO_SERVICE))
    return _list_simplelogin() if service == "simplelogin" else _list_addy()


def refresh() -> dict:
    """Read the alias list, keep it as the scan's cache and report the
    outcome (the Connection row): an error is stored as its code and the
    old cache stays."""
    try:
        aliases = list_aliases()
    except AliasError as exc:
        with _LOCK:
            data = _read()
            if data.get("service") in SERVICES:
                data["error"] = str(exc)
                _write(data)
        return status()
    with _LOCK:
        data = _read()
        data["aliases"] = {a.email: {"id": a.id, "on": a.on}
                           for a in aliases}
        data["synced_ts"] = int(time.time())
        data["error"] = ""
        _write(data)
    return status()


def find(address: str) -> Alias:
    """The service's alias for `address` (a fresh list: the id and on / off
    state are read from the service, not from the cache)."""
    address = address.strip().lower()
    for a in list_aliases():
        if a.email == address:
            return a
    raise AliasError(mailops.coded(mailops.ALIAS_NOT_FOUND))


def _remember(address: str, alias_id: str, on: bool) -> None:
    with _LOCK:
        data = _read()
        if isinstance(data.get("aliases"), dict):
            data["aliases"][address] = {"id": alias_id, "on": on}
            _write(data)


def set_enabled(address: str, enabled: bool) -> Alias:
    """Switch `address` on or off at the service (a no-op when it is
    already so). Returns the alias with its new state."""
    service, _ = _config()
    alias = find(address)
    qid = urllib.parse.quote(alias.id, safe="")
    if alias.on != enabled:
        if service == "simplelogin":
            # a toggle flips whatever the state is NOW: check where it ended
            # up, and flip once more if the alias changed under us
            for _try in range(2):
                answer = _call("POST", f"/aliases/{qid}/toggle")
                now = answer.get("enabled") if isinstance(answer, dict) \
                    else None
                if not isinstance(now, bool):
                    now = find(address).on     # no readable answer: ask
                if now == enabled:
                    break
            else:
                raise AliasError(mailops.coded(mailops.ALIAS_HTTP, status=409))
        elif enabled:
            _call("POST", "/active-aliases", {"id": alias.id})
        else:
            _call("DELETE", f"/active-aliases/{qid}")
    _remember(alias.email, alias.id, enabled)
    return Alias(alias.id, alias.email, enabled)


def create_alias(note: str, hostname: str = "") -> str:
    """A fresh random alias; `note` (up to 200 characters) names what it is
    for, `hostname` the site it is given to. Returns its address."""
    service, _ = _config()
    note = note.strip()[:200]
    if service == "simplelogin":
        query = "?mode=word" + (
            f"&hostname={urllib.parse.quote(hostname)}" if hostname else "")
        data = _call("POST", "/alias/random/new" + query, {"note": note})
        email = (data or {}).get("email") if isinstance(data, dict) else None
    else:
        options = _call("GET", "/domain-options")
        opts = options if isinstance(options, dict) else {}
        shared = opts.get("data") if isinstance(opts.get("data"), list) else []
        domain = str(opts.get("defaultAliasDomain") or (shared[0] if shared
                                                       else ""))
        data = _call("POST", "/aliases", {
            "domain": domain, "description": note,
            "format": "random_characters"})
        inner = (data or {}).get("data") if isinstance(data, dict) else None
        email = inner.get("email") if isinstance(inner, dict) else None
    if not isinstance(email, str) or "@" not in email:
        raise AliasError(mailops.coded(mailops.ALIAS_UNREACHABLE))
    return email.lower()
