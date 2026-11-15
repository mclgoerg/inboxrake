"""OAuth 2.1 for hosted AI apps (backend/oauthserver.py, oauthclients.py, the
`oauth` grant kind of assistanttokens.py, the challenge and grant checks of
mcpserver.py): discovery, the switch and its preconditions, authorize -> consent
-> token -> refresh -> revoke, `/mcp` with a grant, and every row of the
design's threat table.

The CIMD fetcher is replaced by fixture documents for `https://client.example/`;
nothing touches the network. Invented `.example` data only."""

import base64
import hashlib
import json
import os
import re
import secrets
import urllib.parse

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import (assistantplans, assistanttokens, auditlog, auth as authmod,
                     bodylimit, config as cfgmod, mcpserver, oauthclients,
                     oauthserver, proposalmail, smtpout, webpush)
from backend.main import app
from test_mcp import M_HOST, call, legacy, mbox, ok  # noqa: F401

BASE = "https://mail.example.com"
MCP = BASE + "/mcp"
CID = "https://client.example/app.json"
CB = "https://client.example/cb"
PW = "pw-oauth-test"


# --------------------------------------------------------------- fixtures

def doc(**over):
    d = {"client_id": CID, "client_name": "Example Assistant",
         "redirect_uris": [CB], "token_endpoint_auth_method": "none"}
    d.update(over)
    return d


class Cimd:
    """The fixture documents the fetcher answers with, and what it was asked."""

    def __init__(self):
        self.docs = {CID: doc()}
        self.calls = []
        self.error = None


class Clock:
    now = 1_800_000_000.0

    def tick(self, seconds):
        self.now += seconds


@pytest.fixture
def cimd(monkeypatch):
    c = Cimd()

    def fetch(client_id):
        c.calls.append(client_id)
        if c.error:
            raise c.error
        d = c.docs.get(client_id)
        if d is None:
            return 404, {"content-type": "application/json"}, b"{}"
        return 200, {"content-type": "application/json"}, json.dumps(
            d).encode()
    oauthclients.reset()
    monkeypatch.setattr(oauthclients, "_fetch", fetch)
    yield c
    oauthclients.reset()


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    for mod in (oauthserver, assistanttokens, oauthclients):
        monkeypatch.setattr(mod, "_now", lambda: c.now)
    return c


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    oauthserver.reset()
    proposalmail._state.clear()
    assistantplans.clear()
    monkeypatch.setattr(proposalmail, "_async", lambda fn, *a: fn(*a))
    monkeypatch.setattr(webpush, "PUSH_KEY_PATH", tmp_path / "vapid.pem")
    monkeypatch.setattr(webpush, "PUSH_SUBS_PATH", tmp_path / "subs.json")
    monkeypatch.setattr(webpush, "_key_cache", None)
    monkeypatch.setattr(webpush, "_presence", {})
    mcpserver._rate.clear()
    yield
    oauthserver.reset()


@pytest.fixture(autouse=True)
def mails(monkeypatch):
    sent = []
    monkeypatch.setattr(smtpout, "send", lambda im, to, subject, text,
                        html=None, account_name=None:
                        sent.append((to, subject, text, html)))
    return sent


@pytest.fixture
def pushes(monkeypatch):
    got = []
    monkeypatch.setattr(webpush, "job_finished",
                        lambda acc, kind, ok_, **p: got.append(
                            (acc.name, kind, p)))
    return got


def configure(access="act", oauth=True, mode="password", **auth):
    """The admin's settings, as the API would save them."""
    body = {"assistants": {"access": access}}
    if mode == "password":
        body["auth"] = {"mode": "password", "password": PW}
    else:
        body["auth"] = {"mode": mode, **auth}
    cfgmod.update_config(body)
    if oauth:
        cfgmod.update_config({"assistants": {"oauth": True}})


def web(who=None):
    """A browser at the public address, signed in."""
    c = TestClient(app, base_url=BASE)
    if who is None:
        assert c.post("/api/login", json={"password": PW}).status_code == 200
    else:
        c.cookies.set("pmc_session", authmod.make_session(who))
    return c


def anon():
    return TestClient(app, base_url=BASE)


@pytest.fixture
def world(mbox, cimd, monkeypatch):    # noqa: F811
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    configure()
    return web()


def pkce():
    verifier = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def auth_params(challenge, **over):
    p = {"client_id": CID, "redirect_uri": CB, "response_type": "code",
         "state": "st-1", "code_challenge": challenge,
         "code_challenge_method": "S256", "scope": "mcp:read mcp:propose",
         "resource": MCP}
    p.update(over)
    return {k: v for k, v in p.items() if v is not None}


def start(c, challenge, **over):
    r = c.get("/oauth/authorize", params=auth_params(challenge, **over),
              follow_redirects=False)
    assert r.status_code == 302, r.text
    return r


def get_connect(c):
    return c.get("/api/assistants/connect")


_names = iter(range(1, 10_000))


def choices(**over):
    """The consent page's answer; every call a fresh connection name (names
    are unique per workspace)."""
    body = {"approve": True, "name": f"Connection {next(_names)}",
            "accounts": ["default"], "level": "read", "subjects": False,
            "expires_days": 90, "daily_cap": 2000}
    body.update(over)
    return body


def post_connect(c, rid, **over):
    return c.post("/api/assistants/connect",
                  json={"request_id": rid, **choices(**over)})


def query_of(url):
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))


def consent(c, challenge=None, **over):
    """authorize + GET: (verifier, the page's data)."""
    verifier, ch = pkce()
    start(c, challenge or ch, **over)
    r = get_connect(c)
    assert r.status_code == 200, r.text
    return verifier, r.json()


def connect_code(c, level="read", scope="mcp:read mcp:propose",
                 state="st-1", **over):
    """The whole browser leg: (code, verifier)."""
    verifier, page = consent(c, scope=scope, state=state)
    r = post_connect(c, page["request_id"], level=level, **over)
    assert r.status_code == 200, r.text
    q = query_of(r.json()["redirect_url"])
    assert q["state"] == state and q["iss"] == BASE
    return q["code"], verifier


def token_form(code, verifier, **over):
    f = {"grant_type": "authorization_code", "code": code,
         "code_verifier": verifier, "client_id": CID, "redirect_uri": CB,
         "resource": MCP}
    f.update(over)
    return {k: v for k, v in f.items() if v is not None}


def connect(c, level="read", scope="mcp:read mcp:propose", **over):
    """A complete connection: the token response (+ the verifier)."""
    code, verifier = connect_code(c, level, scope, **over)
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.status_code == 200, r.text
    return r.json()


def refresh(rt, **over):
    f = {"grant_type": "refresh_token", "refresh_token": rt,
         "client_id": CID}
    f.update(over)
    return anon().post("/oauth/token", data=f)


def grants():
    return [t for t in assistanttokens._read() if t.get("kind") == "oauth"]


def rec_of(access):
    return assistanttokens.lookup(access)


def mcp(access, method="ping", c=None, **kw):
    return legacy(access, method, c=c or anon(), **kw)


def audit_actions():
    return [(e["action"], e["actor"], e["outcome"], e.get("error", ""))
            for e in auditlog.load("default", 0, 200)["entries"]]


# ===================================================================== switch

def test_oauth_is_off_by_default_and_everything_is_a_plain_404(world):
    cfgmod.update_config({"assistants": {"oauth": False}})
    assert cfgmod.load_server()["assistants"]["oauth"] is False
    c = anon()
    for path in ("/.well-known/oauth-protected-resource/mcp",
                 "/.well-known/oauth-protected-resource",
                 "/.well-known/oauth-authorization-server",
                 "/oauth/authorize"):
        assert c.get(path).status_code == 404, path
    assert c.post("/oauth/token", data={}).status_code == 404
    assert c.post("/oauth/revoke", data={}).status_code == 404
    assert world.get("/api/assistants/connect").status_code == 404
    assert world.post("/api/assistants/connect", json={
        "request_id": "x", "approve": False}).status_code == 404
    # the 401 challenge stays as before
    r = c.post("/mcp", json={})
    assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("what", ["mode_none", "no_url", "http_url",
                                  "access_off"])
def test_every_precondition_hides_the_routes_again(world, monkeypatch, what):
    """Checked at runtime, not only when saved: when one stops holding, OAuth
    acts as off."""
    access = connect(world)["access_token"]
    assert mcp(access).status_code == 200
    if what == "mode_none":
        cfgmod.update_config({"auth": {"mode": "none"}})
    elif what == "no_url":
        monkeypatch.delenv("INBOXRAKE_PUBLIC_URL")
    elif what == "http_url":
        monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", "http://mail.example.com")
    else:
        cfgmod.update_config({"assistants": {"access": "off"}})
    # (in mode none the host guard would refuse the public name anyway)
    c = TestClient(app) if what == "mode_none" else anon()
    assert c.get("/.well-known/oauth-authorization-server").status_code == 404
    assert c.get("/.well-known/oauth-protected-resource").status_code == 404
    assert c.post("/oauth/token", data={}).status_code == 404
    assert c.get("/oauth/authorize").status_code == 404
    # the grant is kept, but gives no access while OAuth is off
    assert len(grants()) == 1
    r = mcp(access, c=c)
    assert r.status_code == (404 if what == "access_off" else 401)
    cfgmod.update_config({"auth": {"mode": "password", "password": PW},
                          "assistants": {"access": "act"}})
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    assert mcp(access).status_code == 200      # turning it back on restores


@pytest.mark.parametrize("value", [
    "", "http://mail.example.com", "https://mail.example.com/",
    "https://mail.example.com/mcp", "mail.example.com",
    "https://mail.example.com?x=1", "https://mail.example.com#f",
    "https://user@mail.example.com", "https://mail.example.com:0",
    "https://mail.example.com:99999", "https://", "ftp://mail.example.com",
    "https://mail example.com", "http://localhost:8765",
    "http://127.0.0.1:8765"])
def test_the_public_url_must_be_a_bare_https_origin(monkeypatch, value):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", value)
    assert cfgmod.public_url() == ""


@pytest.mark.parametrize("value", [
    "https://mail.example.com", "https://mail.example.com:8443",
    "https://sub.mail.example.com"])
def test_good_public_urls(monkeypatch, value):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", value)
    assert cfgmod.public_url() == value
    assert cfgmod.mcp_url() == value + "/mcp"


def test_the_loopback_flag_is_code_only(monkeypatch):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", "http://127.0.0.1:8765")
    assert cfgmod.public_url() == ""
    monkeypatch.setattr(cfgmod, "ALLOW_HTTP_LOOPBACK_ISSUER", True)
    assert cfgmod.public_url() == "http://127.0.0.1:8765"
    # no environment variable flips it
    assert not any("LOOPBACK" in k.upper() for k in os.environ
                   if k.startswith("INBOXRAKE"))
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", "https://x.example/p")
    assert cfgmod.public_url() == ""


def test_the_switch_is_refused_without_its_preconditions(mbox, monkeypatch):
    c = TestClient(app)          # mode none: this client is the admin
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    cfgmod.update_config({"assistants": {"access": "act"}})
    r = c.post("/api/config", json={"assistants": {"oauth": True}})
    assert (r.status_code, r.json()["detail"]) == (400, "oauth_needs_login")
    cfgmod.update_config({"auth": {"mode": "password", "password": PW}})
    admin = web()
    monkeypatch.delenv("INBOXRAKE_PUBLIC_URL")
    r = admin.post("/api/config", json={"assistants": {"oauth": True}})
    assert r.json()["detail"] == "oauth_needs_public_url"
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", "http://mail.example.com")
    r = admin.post("/api/config", json={"assistants": {"oauth": True}})
    assert r.json()["detail"] == "oauth_needs_public_url"
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    cfgmod.update_config({"assistants": {"access": "off"}})
    r = admin.post("/api/config", json={"assistants": {"oauth": True}})
    assert r.json()["detail"] == "oauth_needs_access"
    r = admin.post("/api/config", json={"assistants": {"oauth": "yes"}})
    assert r.status_code == 400
    assert cfgmod.load_server()["assistants"]["oauth"] is False
    # all hold: saved, and persisted in server.json
    r = admin.post("/api/config", json={"assistants": {
        "access": "read_propose", "oauth": True}})
    assert r.status_code == 200
    assert json.loads(cfgmod.SERVER_PATH.read_text())["assistants"] == {
        "access": "read_propose", "oauth": True}
    # off is always allowed
    assert admin.post("/api/config", json={"assistants": {
        "oauth": False}}).status_code == 200


def test_the_preconditions_are_judged_on_the_state_after_the_save(
        mbox, monkeypatch):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    c = TestClient(app)
    r = c.post("/api/config", json={
        "auth": {"mode": "password", "password": PW},
        "assistants": {"access": "act", "oauth": True}})
    assert r.status_code == 200, r.text
    assert cfgmod.oauth_active()


def test_only_the_admin_can_switch_it(mbox, monkeypatch):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    cfgmod.update_config({
        "auth": {"mode": "oidc", "admin": "admin@corp.example",
                 "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                          "client_secret": "sst"}},
        "assistants": {"access": "act"}})
    alice = web("alice@x.example")
    r = alice.post("/api/config", json={"assistants": {"oauth": True}})
    assert r.status_code == 403
    assert cfgmod.load_server()["assistants"]["oauth"] is False
    assert web("admin@corp.example").post("/api/config", json={
        "assistants": {"oauth": True}}).status_code == 200


def test_config_fields_for_admin_and_others(mbox, monkeypatch):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    cfgmod.update_config({
        "auth": {"mode": "oidc", "admin": "admin@corp.example",
                 "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                          "client_secret": "sst"}},
        "assistants": {"access": "act", "oauth": True}})
    admin = web("admin@corp.example").get("/api/config").json()["assistants"]
    alice = web("alice@x.example").get("/api/config").json()["assistants"]
    assert admin["oauth"] == {"enabled": True, "available": True,
                              "reason": "", "mcp_url": MCP,
                              "public_url": BASE}
    assert alice["oauth"] == {"enabled": True, "available": True,
                              "reason": "", "mcp_url": MCP}
    cfgmod.update_config({"assistants": {"access": "off"}})
    seen = web("alice@x.example").get("/api/config").json()["assistants"][
        "oauth"]
    assert (seen["enabled"], seen["available"], seen["reason"]) == (
        True, False, "oauth_needs_access")


# ================================================================= discovery

def test_protected_resource_metadata_at_both_paths(world):
    c = anon()
    docs = [c.get("/.well-known/oauth-protected-resource/mcp"),
            c.get("/.well-known/oauth-protected-resource")]
    for r in docs:
        assert r.status_code == 200
        assert r.headers["cache-control"] == "max-age=300"
    assert docs[0].json() == docs[1].json() == {
        "resource": MCP, "authorization_servers": [BASE],
        "scopes_supported": ["mcp:read", "mcp:propose", "mcp:act"],
        "bearer_methods_supported": ["header"], "resource_name": "Inboxrake",
        "resource_documentation": "https://inboxrake.com/docs/assistants/"}


def test_authorization_server_metadata_has_exactly_these_fields(world):
    r = anon().get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200 and r.headers["cache-control"] == "max-age=300"
    assert r.json() == {
        "issuer": BASE,
        "authorization_endpoint": BASE + "/oauth/authorize",
        "token_endpoint": BASE + "/oauth/token",
        "revocation_endpoint": BASE + "/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["mcp:read", "mcp:propose", "mcp:act"],
        "authorization_response_iss_parameter_supported": True,
        "client_id_metadata_document_supported": True,
        "service_documentation": "https://inboxrake.com/docs/assistants/"}
    assert "registration_endpoint" not in r.json()      # no DCR


def test_openid_configuration_stays_a_404(world):
    assert anon().get("/.well-known/openid-configuration").status_code == 404
    assert anon().get(
        "/.well-known/oauth-authorization-server/x").status_code == 404


def test_metadata_never_follows_request_headers(world):
    r = anon().get("/.well-known/oauth-authorization-server", headers={
        "Host": "evil.example", "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "http"})
    assert r.json()["issuer"] == BASE
    assert "evil" not in r.text
    r = anon().post("/mcp", json={}, headers={
        "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http"})
    assert "evil" not in r.headers["www-authenticate"]


def test_the_mcp_challenge_names_the_metadata_and_the_scopes_up_to_the_cap(
        world):
    for cap, scope in (("read_propose", "mcp:read mcp:propose"),
                       ("act", "mcp:read mcp:propose mcp:act")):
        cfgmod.update_config({"assistants": {"access": cap}})
        want = (f'resource_metadata="{BASE}/.well-known/'
                f'oauth-protected-resource/mcp", scope="{scope}"')
        r = anon().post("/mcp", json={"jsonrpc": "2.0", "id": 1,
                                      "method": "ping"})
        assert r.status_code == 401
        assert r.headers["www-authenticate"] == "Bearer " + want
        r = legacy("irk_nope", "ping", c=anon())
        assert r.status_code == 401
        assert r.headers["www-authenticate"] == (
            'Bearer error="invalid_token", ' + want)


def test_a_static_token_keeps_working_with_oauth_on_and_off(world):
    secret = world.post("/api/assistants/tokens", json={
        "name": "Laptop", "accounts": ["default"], "level": "read",
        "subjects": False, "expires_days": 90}).json()["secret"]
    assert mcp(secret).status_code == 200
    cfgmod.update_config({"assistants": {"oauth": False}})
    assert mcp(secret).status_code == 200


# ================================================================= authorize

def test_authorize_sets_the_cookie_and_redirects_to_the_consent_page(
        world, cimd):
    _, ch = pkce()
    r = start(anon(), ch)
    assert r.headers["location"] == "/#/connect"
    cookie = r.headers["set-cookie"].lower()
    assert "pmc_oauth_req=" in cookie
    for flag in ("httponly", "secure", "samesite=lax", "path=/",
                 "max-age=600"):
        assert flag in cookie, flag
    assert cimd.calls == []             # nothing fetched, nothing validated


def test_an_anonymous_visitor_can_never_make_us_fetch_anything(world, cimd):
    """Neither authorize nor an unauthenticated consent call fetches: only a
    signed-in session's GET does."""
    c = anon()
    for bad in ({}, {"client_id": "https://169.254.169.254/x"},
                {"client_id": "http://client.example/a"}):
        c.get("/oauth/authorize", params=auth_params(pkce()[1], **bad),
              follow_redirects=False)
    assert c.get("/api/assistants/connect").status_code == 401
    assert c.post("/api/assistants/connect", json={
        "request_id": "x", "approve": True}).status_code == 401
    assert cimd.calls == []
    signed = web()
    start(signed, pkce()[1])
    assert cimd.calls == []
    assert get_connect(signed).status_code == 200
    assert cimd.calls == [CID]          # now - after sign-in


def test_authorize_is_limited_per_ip(world):
    c = anon()
    _, ch = pkce()
    for _ in range(20):
        assert c.get("/oauth/authorize", params=auth_params(ch),
                     follow_redirects=False).status_code == 302
    r = c.get("/oauth/authorize", params=auth_params(ch),
              follow_redirects=False)
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    assert "pmc_oauth_req" not in r.headers.get("set-cookie", "")


def test_authorize_caps_every_value_and_the_pending_list(world):
    c = anon()
    start(c, "x" * 5000, state="s" * 5000, scope="mcp:read " * 500)
    (rec,) = oauthserver._pending.values()
    assert all(len(v) <= oauthserver.PARAM_MAX for v in rec["params"].values())
    oauthserver.reset()
    oauthserver._authorize_throttle.limit = 10_000
    first = None
    for i in range(oauthserver.PENDING_MAX + 7):
        start(c, pkce()[1])
        first = first or next(iter(oauthserver._pending))
    assert len(oauthserver._pending) == oauthserver.PENDING_MAX
    assert first not in oauthserver._pending       # the oldest was evicted


def test_unknown_parameters_are_not_kept(world):
    c = anon()
    start(c, pkce()[1], next="https://evil.example", login_hint="x")
    (rec,) = oauthserver._pending.values()
    assert set(rec["params"]) <= set(oauthserver.PARAMS)


def test_a_pending_request_lives_ten_minutes(world, clock):
    c = web()
    start(c, pkce()[1])
    clock.tick(oauthserver.PENDING_TTL - 1)
    assert get_connect(c).status_code == 200
    clock.tick(2)
    r = get_connect(c)
    assert (r.status_code, r.json()["detail"]) == (404, "connect_request_gone")


def test_there_is_no_open_redirect_target_anywhere(world):
    r = start(anon(), pkce()[1], next="https://evil.example/", redirect_to="x")
    assert r.headers["location"] == "/#/connect"


def test_a_repeated_parameter_is_an_error_page(world):
    c = web()
    r = c.get(f"/oauth/authorize?{urllib.parse.urlencode(auth_params(pkce()[1]))}"
              f"&redirect_uri=https://evil.example/cb", follow_redirects=False)
    assert r.status_code == 302
    r = get_connect(c)
    assert (r.status_code, r.json()["detail"]) == (400, "connect_request_invalid")


def test_the_oidc_callback_returns_to_the_consent_page_only_with_the_cookie(
        world, monkeypatch):
    cfgmod.update_config({"auth": {
        "mode": "oidc", "admin": "me@corp.example",
        "oidc": {"issuer": "https://idp.example", "client_id": "app",
                 "client_secret": "sst", "allowed": []}}})
    monkeypatch.setattr(authmod, "exchange_code", lambda *a, **k: {
        "sub": "u1", "email": "me@corp.example", "email_verified": True})

    def land(c):
        return c.get("/api/oidc/callback", params={
            "code": "c", "state": authmod.make_state()},
            follow_redirects=False)
    plain = anon()
    r = land(plain)
    assert r.status_code in (302, 307) and r.headers["location"] == "/"
    c = anon()
    start(c, pkce()[1])
    r = land(c)
    assert r.headers["location"] == "/#/connect"
    assert "pmc_session" in r.headers["set-cookie"]


# ============================================================= consent (GET)

def test_the_consent_data(world):
    verifier, page = consent(world)
    assert page["client"] == {"client_id": CID, "host": "client.example",
                              "name": "Example Assistant",
                              "redirect_host": "client.example"}
    assert page["ceiling"] == "propose"
    assert page["accounts"] == ["default"]
    assert page["defaults"] == {
        "level": "read", "subjects": False, "expires_days": 90,
        "daily_cap": 2000, "name": "Example Assistant · client.example"}
    assert re.fullmatch(r"[A-Za-z0-9_-]{40,}", page["request_id"])
    assert world.cookies.get("pmc_oauth_req") == page["request_id"]


def test_the_name_defaults_to_the_host_when_the_client_has_none(world, cimd):
    cimd.docs[CID] = doc(client_name=None)
    _, page = consent(world)
    assert page["client"]["name"] == "client.example"
    assert page["defaults"]["name"] == "client.example"


@pytest.mark.parametrize("scope, cap, ceiling", [
    ("mcp:read", "act", "read"),
    ("mcp:propose", "act", "propose"),
    ("mcp:act", "act", "act"),
    ("mcp:read mcp:act", "act", "act"),
    ("mcp:act", "read_propose", "propose"),       # cut to the admin cap
    ("mcp:propose", "read_propose", "propose"),
    ("openid offline_access", "act", "read"),     # unknown scopes ignored
    ("", "act", "read"),
    (None, "act", "read"),
    ("openid mcp:propose offline_access", "act", "propose"),
])
def test_the_level_ceiling(world, scope, cap, ceiling):
    cfgmod.update_config({"assistants": {"access": cap}})
    _, page = consent(world, scope=scope)
    assert page["ceiling"] == ceiling


def test_no_cookie_or_an_unknown_request_is_gone(world):
    r = get_connect(world)
    assert (r.status_code, r.json()["detail"]) == (404, "connect_request_gone")
    world.cookies.set("pmc_oauth_req", "forged", domain="mail.example.com")
    assert get_connect(world).status_code == 404


@pytest.mark.parametrize("over, code", [
    ({"client_id": "http://client.example/app.json"}, "client_invalid_url"),
    ({"client_id": "https://client.example/"}, "client_invalid_url"),
    ({"client_id": None}, "client_invalid_url"),
    ({"client_id": "https://other.example/app.json"}, "client_bad_response"),
    ({"redirect_uri": "https://client.example/other"}, "connect_redirect_uri"),
    ({"redirect_uri": "https://client.example/cb/"}, "connect_redirect_uri"),
    ({"redirect_uri": "https://evil.example/cb"}, "connect_redirect_uri"),
    ({"redirect_uri": "http://client.example/cb"}, "connect_redirect_uri"),
    ({"redirect_uri": None}, "connect_redirect_uri"),
    ({"redirect_uri": "http://127.0.0.1:9/cb"}, "connect_redirect_uri"),
])
def test_errors_about_the_client_are_shown_never_redirected(
        world, over, code):
    start(world, pkce()[1], **over)
    r = get_connect(world)
    assert r.status_code == 400
    assert r.json() == {"detail": code}      # no redirect_url anywhere


def test_a_failed_fetch_and_a_bad_document_are_shown_never_redirected(
        world, cimd):
    cimd.error = OSError("down")
    start(world, pkce()[1])
    assert get_connect(world).json() == {"detail": "client_unreachable"}
    cimd.error = None
    oauthclients.reset()
    cimd.docs[CID] = doc(redirect_uris=["https://evil.example/cb"])
    start(world, pkce()[1])
    assert get_connect(world).json() == {"detail": "client_invalid_document"}
    oauthclients.reset()
    cimd.docs[CID] = doc(client_secret="s")
    start(world, pkce()[1])
    assert get_connect(world).json() == {"detail": "client_invalid_document"}
    oauthclients.reset()
    cimd.docs[CID] = doc(token_endpoint_auth_method="private_key_jwt")
    start(world, pkce()[1])
    assert get_connect(world).json() == {"detail": "client_invalid_document"}


@pytest.mark.parametrize("over, error", [
    ({"response_type": "token"}, "unsupported_response_type"),
    ({"response_type": None}, "unsupported_response_type"),
    ({"code_challenge_method": "plain"}, "invalid_request"),
    ({"code_challenge_method": None}, "invalid_request"),
    ({"code_challenge_method": "s256"}, "invalid_request"),
    ({"code_challenge": "short"}, "invalid_request"),
    ({"code_challenge": "a" * 44}, "invalid_request"),
    ({"code_challenge": "a" * 42 + "+"}, "invalid_request"),
    ({"code_challenge": None}, "invalid_request"),
    ({"resource": None}, "invalid_target"),
    ({"resource": "https://evil.example/mcp"}, "invalid_target"),
    ({"resource": BASE}, "invalid_target"),
    ({"resource": BASE + "/mcp/"}, "invalid_target"),
    ({"resource": BASE + "/mcp?x=1"}, "invalid_target"),
    ({"resource": "http://mail.example.com/mcp"}, "invalid_target"),
    ({"resource": "https://mail.example.com:8443/mcp"}, "invalid_target"),
    ({"resource": "https://mail.example.com@evil.example/mcp"},
     "invalid_target"),
])
def test_other_errors_are_redirected_with_state_and_iss(world, over, error):
    start(world, pkce()[1], **over)
    r = get_connect(world)
    assert r.status_code == 200, r.text
    url = r.json()["redirect_url"]
    assert url.startswith(CB + "?")
    q = query_of(url)
    assert q["error"] == error and q["state"] == "st-1" and q["iss"] == BASE
    assert "code" not in q
    # the request ended: it cannot be replayed
    assert get_connect(world).status_code == 404


def test_state_is_optional_and_passed_through_unchanged(world):
    start(world, pkce()[1], state=None, response_type="token")
    q = query_of(get_connect(world).json()["redirect_url"])
    assert "state" not in q and q["error"] == "unsupported_response_type"
    odd = "a b&c=d/é?#"
    start(world, pkce()[1], state=odd, response_type="token")
    q = query_of(get_connect(world).json()["redirect_url"])
    assert q["state"] == odd


def test_the_resource_host_and_scheme_are_case_insensitive(world):
    _, page = consent(world, resource="HTTPS://MAIL.Example.COM/mcp")
    assert page["request_id"]


def test_a_redirect_uri_with_a_query_gets_the_answer_appended(world, cimd):
    cb = CB + "?app=1"
    cimd.docs[CID] = doc(redirect_uris=[cb])
    start(world, pkce()[1], redirect_uri=cb, response_type="token")
    url = get_connect(world).json()["redirect_url"]
    assert url.startswith(cb + "&") and query_of(url)["app"] == "1"
    assert query_of(url)["error"] == "unsupported_response_type"


def test_a_second_subject_gets_nothing_and_the_first_keeps_it(mbox, cimd,
                                                              monkeypatch):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    cfgmod.update_config({
        "auth": {"mode": "oidc", "admin": "admin@corp.example",
                 "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                          "client_secret": "sst"}},
        "assistants": {"access": "act", "oauth": True}})
    alice, bob = web("alice@x.example"), web("bob@y.example")
    start(alice, pkce()[1])
    page = get_connect(alice).json()
    # bob's browser somehow has alice's cookie
    bob.cookies.set("pmc_oauth_req", page["request_id"],
                    domain="mail.example.com")
    r = get_connect(bob)
    assert (r.status_code, r.json()["detail"]) == (404, "connect_request_gone")
    r = post_connect(bob, page["request_id"])
    assert r.status_code == 404
    assert get_connect(alice).status_code == 200      # alice is unaffected
    # first caller wins: bob asking first locks alice out
    start(alice, pkce()[1])
    bob.cookies.set("pmc_oauth_req", alice.cookies.get("pmc_oauth_req"),
                    domain="mail.example.com")
    assert get_connect(bob).status_code in (200, 400)  # bob bound it (no box)
    assert get_connect(alice).status_code == 404


def test_the_consent_data_asks_for_an_account_to_exist(world, monkeypatch):
    monkeypatch.setattr(accountsmod, "names", lambda: [])
    start(world, pkce()[1])
    assert get_connect(world).json() == {"detail": "connect_no_accounts"}


# ============================================================ consent (POST)

def test_approve_returns_a_redirect_with_code_state_and_iss(world):
    _, page = consent(world)
    r = post_connect(world, page["request_id"])
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    url = r.json()["redirect_url"]
    assert url.startswith(CB + "?")
    q = query_of(url)
    assert q["code"].startswith("irc_") and len(q["code"]) >= 40
    assert q["state"] == "st-1" and q["iss"] == BASE
    assert "pmc_oauth_req" in r.headers["set-cookie"]     # cleared
    assert grants() == []                  # no grant until the code is redeemed


def test_deny_redirects_with_access_denied(world):
    _, page = consent(world)
    r = post_connect(world, page["request_id"], approve=False)
    q = query_of(r.json()["redirect_url"])
    assert q["error"] == "access_denied" and q["state"] == "st-1"
    assert q["iss"] == BASE and "code" not in q
    assert grants() == [] and not oauthserver._codes


def test_a_decision_is_single_use(world):
    _, page = consent(world)
    assert post_connect(world, page["request_id"]).status_code == 200
    assert post_connect(world, page["request_id"]).status_code in (403, 404)
    assert get_connect(world).status_code == 404
    assert len(oauthserver._codes) == 1


def test_the_request_id_must_equal_the_cookie(world):
    _, page = consent(world)
    r = post_connect(world, "not-the-cookie")
    assert (r.status_code, r.json()["detail"]) == (403, "connect_request_mismatch")
    world.cookies.delete("pmc_oauth_req")
    assert post_connect(world, page["request_id"]).status_code == 403
    assert not oauthserver._codes


def test_a_post_without_a_validated_get_is_refused(world):
    start(world, pkce()[1])
    rid = world.cookies.get("pmc_oauth_req")
    r = post_connect(world, rid)
    assert (r.status_code, r.json()["detail"]) == (404, "connect_request_gone")
    r = post_connect(world, rid, approve=False)
    assert r.status_code == 404


def test_a_cross_site_post_is_refused(world):
    _, page = consent(world)
    for headers in ({"Sec-Fetch-Site": "cross-site"},
                    {"Sec-Fetch-Site": "same-site"},
                    {"Origin": "https://evil.example"}):
        r = world.post("/api/assistants/connect", headers=headers, json={
            "request_id": page["request_id"], **choices()})
        assert r.status_code == 403, headers
        assert r.json() == {"detail": "cross_site_request"}
    assert not oauthserver._codes
    r = world.post("/api/assistants/connect",
                   headers={"Sec-Fetch-Site": "same-origin"},
                   json={"request_id": page["request_id"], **choices()})
    assert r.status_code == 200


@pytest.mark.parametrize("over, status, detail", [
    ({"level": "act"}, 400, "connect_level_above_ceiling"),
    ({"level": "root"}, 400, "assistant_token_level"),
    ({"name": ""}, 400, "assistant_token_name"),
    ({"name": "x" * 61}, 400, "assistant_token_name"),
    ({"accounts": []}, 400, "assistant_token_accounts"),
    ({"accounts": ["nope"]}, 400, "assistant_token_accounts"),
    ({"accounts": ["default", "nope"]}, 400, "assistant_token_accounts"),
    ({"expires_days": 7}, 400, "assistant_token_expiry"),
    ({"daily_cap": 5}, 400, "assistant_token_cap"),
    ({"daily_cap": 10**6}, 400, "assistant_token_cap"),
])
def test_the_choices_are_validated_like_a_token(world, over, status, detail):
    _, page = consent(world)
    r = post_connect(world, page["request_id"], **over)
    assert (r.status_code, r.json()["detail"]) == (status, detail)
    # a refused choice does not burn the request: it can be corrected
    assert post_connect(world, page["request_id"]).status_code == 200


def test_the_ceiling_follows_a_lowered_admin_cap_between_get_and_post(world):
    _, page = consent(world, scope="mcp:act")
    assert page["ceiling"] == "act"
    cfgmod.update_config({"assistants": {"access": "read_propose"}})
    r = post_connect(world, page["request_id"], level="act")
    assert r.json()["detail"] == "connect_level_above_ceiling"
    assert post_connect(world, page["request_id"],
                        level="propose").status_code == 200


def test_the_choices_reach_the_grant(world):
    code, verifier = connect_code(
        world, level="propose", name="  My  assistant ", subjects=True,
        expires_days=30, daily_cap=500)
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.status_code == 200
    (g,) = grants()
    assert (g["name"], g["level"], g["subjects"], g["daily_cap"]) == (
        "My assistant", "propose", True, 500)
    assert g["accounts"] == ["default"] and g["tenant"] == "default"
    assert g["expires"] - g["created"] == 30 * 86400
    assert g["scope"] == "mcp:read mcp:propose"


def test_a_tenant_may_hold_20_grants(world):
    for _ in range(assistanttokens.MAX_GRANTS_PER_TENANT):
        connect(world)
    assert len(grants()) == 20
    start(world, pkce()[1])
    r = get_connect(world)
    assert r.json() == {"detail": "assistant_grant_limit"}
    # tokens are counted apart
    r = world.post("/api/assistants/tokens", json={
        "name": "Laptop", "accounts": ["default"], "level": "read",
        "subjects": False, "expires_days": 90})
    assert r.status_code == 200


def test_a_race_for_the_last_grant_slot_is_caught_at_the_token_endpoint(world):
    pairs = []
    for _ in range(2):
        pairs.append(connect_code(world))
    for _ in range(assistanttokens.MAX_GRANTS_PER_TENANT - 1):
        assistanttokens.create_grant(
            "default", "password", "x", ["default"], "read", False, 90, 2000,
            {"client_id": CID, "client_name": "x", "client_host": "h",
             "redirect_uri": CB}, MCP)
    code, verifier = pairs[0]
    assert anon().post("/oauth/token", data=token_form(
        code, verifier)).status_code == 200
    code, verifier = pairs[1]
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.status_code == 400 and r.json()["error"] == "invalid_request"


# ============================================================ token endpoint

def test_the_happy_path(world):
    tok = connect(world)
    assert tok["token_type"] == "Bearer"
    assert tok["expires_in"] == 3600
    assert tok["scope"] == "mcp:read"
    assert tok["access_token"].startswith("irk_at_")
    assert tok["refresh_token"].startswith("irk_rt_")
    assert len(tok["access_token"]) == len("irk_at_") + 43
    assert len(tok["refresh_token"]) == len("irk_rt_") + 43


def test_the_token_response_is_never_cached(world):
    code, verifier = connect_code(world)
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["pragma"] == "no-cache"
    r = anon().post("/oauth/token", data={"grant_type": "x"})
    assert r.headers["cache-control"] == "no-store"


def test_the_grant_record_holds_hashes_only_and_the_documented_fields(world):
    tok = connect(world, level="propose")
    raw = assistanttokens.TOKENS_PATH.read_text()
    assert tok["access_token"] not in raw and tok["refresh_token"] not in raw
    assert oct(assistanttokens.TOKENS_PATH.stat().st_mode & 0o777) == "0o600"
    (g,) = grants()
    assert g["kind"] == "oauth" and "hash" not in g and "prefix" not in g
    assert g["access_hash"] == hashlib.sha256(
        tok["access_token"].encode()).hexdigest()
    assert g["refresh_hash"] == hashlib.sha256(
        tok["refresh_token"].encode()).hexdigest()
    assert (g["client_id"], g["client_name"], g["client_host"],
            g["redirect_uri"], g["resource"]) == (
        CID, "Example Assistant", "client.example", CB, MCP)
    assert g["refresh_retired"] == [] and g["successor_used"] is False
    assert g["access_exp"] - g["created"] == 3600
    assert g["refresh_exp"] - g["created"] == 30 * 86400
    assert g["owner"] == "password"
    # and the listing shows grants without anything secret
    (listed,) = world.get("/api/assistants/tokens").json()["tokens"]
    assert listed["kind"] == "oauth" and listed["client_host"] == "client.example"
    assert listed["client_name"] == "Example Assistant"
    assert listed["scope"] == "mcp:read mcp:propose"
    for k in ("access_hash", "refresh_hash", "refresh_retired", "owner",
              "hash", "successor_used"):
        assert k not in listed


def test_a_static_token_is_listed_as_a_token(world):
    world.post("/api/assistants/tokens", json={
        "name": "Laptop", "accounts": ["default"], "level": "read",
        "subjects": False, "expires_days": 90})
    (t,) = world.get("/api/assistants/tokens").json()["tokens"]
    assert t["kind"] == "token"


@pytest.mark.parametrize("over", [
    {"code_verifier": "wrong" * 10},
    {"code_verifier": None},
    {"code_verifier": "short"},
    {"code_verifier": "a" * 129},
    {"code_verifier": "é" * 50},
    {"client_id": "https://other.example/app.json"},
    {"client_id": None},
    {"redirect_uri": "https://client.example/other"},
    {"redirect_uri": None},
    {"resource": "https://mail.example.com/other"},
    {"code": "irc_" + "A" * 43},
    {"code": ""},
])
def test_a_wrong_part_is_invalid_grant_and_burns_the_code(world, over):
    code, verifier = connect_code(world)
    over = dict(over)
    other_code = "code" in over              # a wrong code burns nobody's
    sent = over.pop("code", code)
    r = anon().post("/oauth/token", data=token_form(sent, verifier, **over))
    assert (r.status_code, r.json()["error"]) == (400, "invalid_grant")
    assert grants() == []
    # the code is spent even for the right caller now
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert (r.status_code == 200) == other_code
    assert other_code or r.json()["error"] == "invalid_grant"


def test_the_resource_is_optional_at_the_token_endpoint(world):
    code, verifier = connect_code(world)
    r = anon().post("/oauth/token", data=token_form(
        code, verifier, resource=None))
    assert r.status_code == 200


def test_a_code_lives_60_seconds(world, clock):
    code, verifier = connect_code(world)
    clock.tick(oauthserver.CODE_TTL + 1)
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.json()["error"] == "invalid_grant" and grants() == []
    code, verifier = connect_code(world)
    clock.tick(oauthserver.CODE_TTL - 1)
    assert anon().post("/oauth/token", data=token_form(
        code, verifier)).status_code == 200


def test_a_reused_code_revokes_the_grant_made_from_it(world):
    code, verifier = connect_code(world)
    first = anon().post("/oauth/token", data=token_form(code, verifier)).json()
    assert mcp(first["access_token"]).status_code == 200
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.json()["error"] == "invalid_grant"
    assert grants() == []
    assert mcp(first["access_token"]).status_code == 401
    assert refresh(first["refresh_token"]).json()["error"] == "invalid_grant"
    assert ("assistant_disconnected", "system", "error", "code_reuse") \
        in audit_actions()


def test_a_code_reused_while_its_grant_is_being_created_still_revokes(
        world, monkeypatch):
    code, verifier = connect_code(world)
    real = assistanttokens.create_grant
    seen = []

    def create(*a, **k):
        # the same code arrives again before the first redemption is done
        seen.append(anon().post("/oauth/token",
                                data=token_form(code, verifier)).json())
        return real(*a, **k)
    monkeypatch.setattr(assistanttokens, "create_grant", create)
    first = anon().post("/oauth/token", data=token_form(code, verifier))
    assert seen == [{"error": "invalid_grant"}]
    assert first.json() == {"error": "invalid_grant"}
    assert grants() == []
    assert ("assistant_disconnected", "system", "error", "code_reuse") \
        in audit_actions()


def test_a_code_is_refused_when_the_public_url_changed_since_consent(
        world, monkeypatch):
    code, verifier = connect_code(world)
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", "https://other.example")
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    assert grants() == []


def test_the_tombstone_of_a_used_code_is_forgotten_after_ten_minutes(
        world, clock):
    code, verifier = connect_code(world)
    anon().post("/oauth/token", data=token_form(code, verifier))
    clock.tick(oauthserver.USED_TTL + 1)
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.json()["error"] == "invalid_grant"
    assert len(grants()) == 1                  # too late to revoke anything


def test_unknown_codes_leave_no_state(world):
    for i in range(30):
        anon().post("/oauth/token", data=token_form(f"irc_{i}", "v" * 43))
    assert oauthserver._used == {}


def test_only_form_bodies_are_accepted(world):
    code, verifier = connect_code(world)
    c = anon()
    r = c.post("/oauth/token", json=token_form(code, verifier))
    assert (r.status_code, r.json()["error"]) == (400, "invalid_request")
    r = c.post("/oauth/token", content=json.dumps(token_form(code, verifier)),
               headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert r.status_code == 400          # JSON text is no form
    r = c.post("/oauth/token", data=token_form(code, verifier))
    assert r.status_code == 200          # and the code was untouched by that


def test_a_repeated_field_is_refused(world):
    code, verifier = connect_code(world)
    body = urllib.parse.urlencode(token_form(code, verifier)) + "&code=other"
    r = anon().post("/oauth/token", content=body, headers={
        "Content-Type": "application/x-www-form-urlencoded"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_request"


def test_client_authentication_is_none_only(world):
    code, verifier = connect_code(world)
    c = anon()
    r = c.post("/oauth/token", data=token_form(
        code, verifier, client_secret="s3cret"))
    assert (r.status_code, r.json()["error"]) == (400, "invalid_client")
    r = c.post("/oauth/token", data=token_form(code, verifier), headers={
        "Authorization": "Basic " + base64.b64encode(b"a:b").decode()})
    assert (r.status_code, r.json()["error"]) == (401, "invalid_client")
    assert r.headers["www-authenticate"] == "Basic"
    # a client_assertion is ignored, not refused
    r = c.post("/oauth/token", data=token_form(
        code, verifier, client_assertion="x.y.z",
        client_assertion_type="urn:ietf:params:oauth:client-assertion-type:"
                              "jwt-bearer"))
    assert r.status_code == 200
    # a Bearer header is not client authentication either
    code, verifier = connect_code(world)
    r = c.post("/oauth/token", data=token_form(code, verifier),
               headers={"Authorization": "Bearer abc"})
    assert r.status_code == 200


def test_unsupported_grant_types_and_methods(world):
    c = anon()
    for grant in ("password", "client_credentials", "implicit", ""):
        r = c.post("/oauth/token", data={"grant_type": grant})
        assert r.json()["error"] == "unsupported_grant_type"
    assert c.post("/oauth/token", data={"x": "y"}).json()["error"] == \
        "unsupported_grant_type"
    assert c.post("/oauth/token").json()["error"] == "invalid_request"
    assert c.get("/oauth/token").status_code == 404


def test_the_token_endpoint_is_limited_per_ip(world):
    c = anon()
    for _ in range(60):
        assert c.post("/oauth/token", data={"grant_type": "x"}
                      ).status_code == 400
    r = c.post("/oauth/token", data={"grant_type": "x"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert r.json() == {"error": "temporarily_unavailable"}
    # revocation shares the budget
    assert c.post("/oauth/revoke", data={"token": "x"}).status_code == 429


def test_the_owner_is_checked_when_the_code_is_redeemed(world):
    code, verifier = connect_code(world)
    cfgmod.update_config({
        "auth": {"mode": "oidc", "admin": "admin@corp.example",
                 "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                          "client_secret": "sst"}}})
    r = anon().post("/oauth/token", data=token_form(code, verifier))
    assert r.json()["error"] == "invalid_grant"      # a password owner, SSO now
    assert grants() == []


def test_an_account_deleted_before_redemption_leaves_nothing_to_grant(world):
    code, verifier = connect_code(world)
    accountsmod.reset()
    cfgmod.update_config({"imap": {"host": ""}})
    orig = accountsmod.names
    try:
        accountsmod.names = lambda: []
        r = anon().post("/oauth/token", data=token_form(code, verifier))
    finally:
        accountsmod.names = orig
    assert r.json()["error"] == "invalid_grant" and grants() == []


def test_a_connection_is_audited_once_per_account_by_the_user(world):
    connect(world, name="My assistant")
    entries = [e for e in auditlog.load("default", 0, 50)["entries"]
               if e["action"] == "assistant_connected"]
    assert [(e["actor"], e["label"], e["outcome"]) for e in entries] == [
        ("user", "My assistant", "ok")]


# ================================================================== refresh

def test_refresh_rotates_both_tokens(world):
    first = connect(world, level="propose")
    r = refresh(first["refresh_token"])
    assert r.status_code == 200, r.text
    second = r.json()
    assert second["token_type"] == "Bearer" and second["expires_in"] == 3600
    assert second["scope"] == "mcp:read mcp:propose"
    assert second["access_token"] != first["access_token"]
    assert second["refresh_token"] != first["refresh_token"]
    assert r.headers["cache-control"] == "no-store"
    assert mcp(second["access_token"]).status_code == 200
    assert mcp(first["access_token"]).status_code == 401   # replaced
    (g,) = grants()
    assert len(g["refresh_retired"]) == 1
    assert len(grants()) == 1                               # still one grant


def test_the_old_refresh_token_rotates_again_while_the_successor_is_unused(
        world, clock):
    """A client whose answer got lost retries with the old token (Claude
    refreshes with a 30 s timeout)."""
    first = connect(world)
    lost = refresh(first["refresh_token"]).json()           # never delivered
    clock.tick(20)
    retry = refresh(first["refresh_token"])
    assert retry.status_code == 200
    assert mcp(retry.json()["access_token"]).status_code == 200
    assert len(grants()) == 1
    # the pair that was lost is dead
    assert mcp(lost["access_token"]).status_code == 401


def test_parallel_refreshes_with_one_token_never_revoke_the_grant(world, clock):
    import threading
    first = connect(world)
    codes = []

    def go():
        codes.append(refresh(first["refresh_token"]).status_code)
    threads = [threading.Thread(target=go) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes == [200] * 4
    assert len(grants()) == 1
    assert ("assistant_disconnected", "system", "error", "refresh_reuse") \
        not in audit_actions()


def test_sequential_retries_within_the_grace_keep_rotating(world, clock):
    first = connect(world)
    for _ in range(4):
        clock.tick(5)
        assert refresh(first["refresh_token"]).status_code == 200
    assert len(grants()) == 1
    # the last successor is still the live one
    assert mcp(refresh(first["refresh_token"]).json()["access_token"]) \
        .status_code == 200


def test_a_retry_whose_successor_was_used_still_revokes_after_retries(
        world, clock):
    first = connect(world)
    refresh(first["refresh_token"])
    latest = refresh(first["refresh_token"]).json()   # a retry: still fine
    assert mcp(latest["access_token"]).status_code == 200    # used
    assert refresh(first["refresh_token"]).json()["error"] == "invalid_grant"
    assert grants() == []


def test_the_grace_ends_after_60_seconds(world, clock):
    first = connect(world)
    refresh(first["refresh_token"])
    clock.tick(oauthserver.assistanttokens.REFRESH_GRACE + 1)
    r = refresh(first["refresh_token"])
    assert r.json()["error"] == "invalid_grant"
    assert grants() == []                                    # the family is gone


def test_the_grace_ends_when_the_successor_was_used(world, clock):
    first = connect(world)
    second = refresh(first["refresh_token"]).json()
    assert mcp(second["access_token"]).status_code == 200    # used
    clock.tick(5)
    r = refresh(first["refresh_token"])
    assert r.json()["error"] == "invalid_grant"
    assert grants() == []
    assert mcp(second["access_token"]).status_code == 401
    assert refresh(second["refresh_token"]).json()["error"] == "invalid_grant"
    assert ("assistant_disconnected", "system", "error", "refresh_reuse") \
        in audit_actions()


def test_a_successor_used_by_refreshing_again_also_ends_the_grace(world, clock):
    first = connect(world)
    second = refresh(first["refresh_token"]).json()
    third = refresh(second["refresh_token"])
    assert third.status_code == 200
    # the very first token is now two steps back: a replay
    r = refresh(first["refresh_token"])
    assert r.json()["error"] == "invalid_grant" and grants() == []


def test_only_the_newest_retired_token_gets_the_grace(world, clock):
    a = connect(world)
    b = refresh(a["refresh_token"]).json()
    refresh(b["refresh_token"])
    clock.tick(1)
    assert refresh(a["refresh_token"]).json()["error"] == "invalid_grant"
    assert grants() == []


def test_at_most_five_retired_tokens_are_remembered(world, clock):
    tok = connect(world)
    for _ in range(8):
        tok = refresh(tok["refresh_token"]).json()
        mcp(tok["access_token"])                # use it: no grace anywhere
    (g,) = grants()
    assert len(g["refresh_retired"]) == assistanttokens.RETIRED_KEEP


def test_a_refresh_token_is_never_a_bearer_for_mcp(world):
    tok = connect(world)
    assert mcp(tok["refresh_token"]).status_code == 401
    # and an access token is no refresh token
    assert refresh(tok["access_token"]).json()["error"] == "invalid_grant"
    assert len(grants()) == 1


def test_scope_may_narrow_but_never_widen(world):
    tok = connect(world, level="propose")
    r = refresh(tok["refresh_token"], scope="mcp:act")
    assert (r.status_code, r.json()["error"]) == (400, "invalid_scope")
    assert len(grants()) == 1
    r = refresh(tok["refresh_token"], scope="mcp:read openid")
    assert r.status_code == 200 and r.json()["scope"] == "mcp:read"
    (g,) = grants()
    assert g["level"] == "read" and g["scope"] == "mcp:read"
    # narrowed for good: asking for the old scope again is a widening now
    r = refresh(r.json()["refresh_token"], scope="mcp:read mcp:propose")
    assert r.json()["error"] == "invalid_scope"
    # an unrelated scope changes nothing
    tok = connect(world, level="propose")
    r = refresh(tok["refresh_token"], scope="openid")
    assert r.status_code == 200 and r.json()["scope"] == "mcp:read mcp:propose"


def test_a_refresh_token_is_idle_for_30_days(world, clock):
    tok = connect(world, expires_days=None)
    clock.tick(29 * 86400)
    tok = refresh(tok["refresh_token"]).json()              # resets the idle time
    clock.tick(29 * 86400)
    tok = refresh(tok["refresh_token"])
    assert tok.status_code == 200
    clock.tick(31 * 86400)
    r = refresh(tok.json()["refresh_token"])
    assert r.json()["error"] == "invalid_grant"


def test_the_grants_expiry_is_the_absolute_limit(world, clock):
    tok = connect(world, expires_days=30)
    (g,) = grants()
    for _ in range(3):
        clock.tick(9 * 86400)
        tok = refresh(tok["refresh_token"]).json()
    assert grants()[0]["expires"] == g["expires"]
    assert grants()[0]["refresh_exp"] <= g["expires"]
    assert grants()[0]["access_exp"] <= g["expires"]
    clock.tick(4 * 86400)                                     # day 31
    assert mcp(tok["access_token"]).status_code == 401
    assert refresh(tok["refresh_token"]).json()["error"] == "invalid_grant"


def test_an_owner_who_may_no_longer_sign_in_cannot_refresh(mbox, cimd,
                                                           monkeypatch):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    cfgmod.update_config({
        "auth": {"mode": "oidc", "admin": "admin@corp.example",
                 "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                          "client_secret": "sst"}},
        "assistants": {"access": "act", "oauth": True}})
    alice = web("alice@x.example")
    alice.post("/api/config", json={
        "rename_account": {"from": "default", "to": "alice-box"}})
    tok = connect(alice, accounts=["alice-box"])
    assert mcp(tok["access_token"]).status_code == 200
    cfgmod.update_config({"auth": {"oidc": {"allowed": ["bob@y.example"]}}})
    assert refresh(tok["refresh_token"]).json()["error"] == "invalid_grant"
    assert mcp(tok["access_token"]).status_code == 401
    cfgmod.update_config({"auth": {"oidc": {"allowed": [
        "bob@y.example", "alice@x.example"]}}})
    assert mcp(tok["access_token"]).status_code == 200


def test_refresh_checks_the_client_the_resource_and_the_audience(world,
                                                                  monkeypatch):
    tok = connect(world)
    r = refresh(tok["refresh_token"], client_id="https://other.example/a.json")
    assert r.json()["error"] == "invalid_grant"
    assert len(grants()) == 1                  # a stranger revokes nothing
    r = refresh(tok["refresh_token"], client_id=None)
    assert r.json()["error"] == "invalid_grant"
    r = refresh(tok["refresh_token"], resource="https://mail.example.com/x")
    assert r.json()["error"] == "invalid_target"
    nxt = refresh(tok["refresh_token"], resource=MCP)
    assert nxt.status_code == 200
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", "https://moved.example.com")
    r = refresh(nxt.json()["refresh_token"])    # the audience moved: no refresh
    assert r.json()["error"] == "invalid_grant"


def test_refresh_needs_its_own_fields(world):
    assert refresh("").json()["error"] == "invalid_grant"
    assert refresh("irk_rt_" + "A" * 43).json()["error"] == "invalid_grant"
    assert refresh("x" * 500).json()["error"] == "invalid_grant"


# ===================================================================== /mcp

def test_a_grant_works_with_the_same_tools_as_a_token(world):
    tok = connect(world, level="read")
    assert ok(tok["access_token"], "list_accounts", c=anon())["accounts"]
    names = lambda access: [t["name"] for t in legacy(  # noqa: E731
        access, "tools/list", c=anon()).json()["result"]["tools"]]
    read = names(tok["access_token"])
    assert "list_groups" in read and "propose_rule" not in read
    assert "apply_action" not in read
    prop = names(connect(world, level="propose",
                         scope="mcp:propose")["access_token"])
    assert "propose_rule" in prop and "apply_action" not in prop
    act = names(connect(world, level="act", scope="mcp:act")[
        "access_token"])
    assert "apply_action" in act and "propose_rule" in act


def test_a_grant_that_asked_for_read_cannot_be_given_more_by_a_forged_scope(
        world):
    tok = connect(world, level="read", scope="mcp:read")
    assert tok["scope"] == "mcp:read"
    r = legacy(tok["access_token"], "tools/call", {
        "name": "propose_rule", "arguments": {
            "name": "x", "query": "shop.example", "action": "trash"}},
        c=anon())
    assert "error" in r.json() and "result" not in r.json()   # not a tool here


def test_off_audience_and_expiry_are_401_with_the_challenge(world, clock,
                                                            monkeypatch):
    tok = connect(world)
    r = mcp(tok["access_token"])
    assert r.status_code == 200
    # expired (1 h)
    clock.tick(3601)
    r = mcp(tok["access_token"])
    assert r.status_code == 401
    assert r.headers["www-authenticate"].startswith(
        'Bearer error="invalid_token", resource_metadata="' + BASE)
    # a refresh gives a fresh one
    fresh_tok = refresh(tok["refresh_token"]).json()
    assert mcp(fresh_tok["access_token"]).status_code == 200
    # the audience moved with PUBLIC_URL
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", "https://moved.example.com")
    r = mcp(fresh_tok["access_token"])
    assert r.status_code == 401
    assert 'resource_metadata="https://moved.example.com/' in \
        r.headers["www-authenticate"]


def test_a_grant_of_another_audience_is_refused_even_if_oauth_is_on(world):
    tok = connect(world)
    data = json.loads(assistanttokens.TOKENS_PATH.read_text())
    data["tokens"][0]["resource"] = "https://elsewhere.example/mcp"
    assistanttokens.TOKENS_PATH.write_text(json.dumps(data))
    assert mcp(tok["access_token"]).status_code == 401


def test_lowering_the_admin_cap_limits_grants_too(world):
    tok = connect(world, level="act", scope="mcp:act")
    access = tok["access_token"]
    tools = lambda: [t["name"] for t in legacy(    # noqa: E731
        access, "tools/list", c=anon()).json()["result"]["tools"]]
    assert "apply_action" in tools()
    cfgmod.update_config({"assistants": {"access": "read_propose"}})
    names = tools()
    assert "apply_action" not in names and "propose_rule" in names
    assert "mcp:act" not in anon().post("/mcp", json={}).headers[
        "www-authenticate"]


def test_grants_have_a_rate_limit_and_a_daily_cap_like_tokens(world,
                                                              monkeypatch):
    tok = connect(world)
    monkeypatch.setattr(mcpserver, "RATE_LIMIT", 3)
    codes = [mcp(tok["access_token"]).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    # the cap of a grant is adjustable in Settings, like a token's
    (g,) = world.get("/api/assistants/tokens").json()["tokens"]
    r = world.patch(f"/api/assistants/tokens/{g['id']}",
                    json={"daily_cap": 300})
    assert r.status_code == 200 and r.json()["token"]["daily_cap"] == 300
    assert assistanttokens.mails_left(g["id"]) == 300


def test_using_a_grant_is_noted_and_marks_the_successor_used(world):
    tok = connect(world)
    (g,) = grants()
    assert g["last_used"] is None and g["successor_used"] is False
    mcp(tok["access_token"])
    (g,) = grants()
    assert g["last_used"] and g["successor_used"] is True


def test_a_revoked_grant_stops_at_once(world):
    tok = connect(world)
    (g,) = world.get("/api/assistants/tokens").json()["tokens"]
    assert mcp(tok["access_token"]).status_code == 200
    assert world.delete(
        f"/api/assistants/tokens/{g['id']}").status_code == 200
    assert mcp(tok["access_token"]).status_code == 401
    assert refresh(tok["refresh_token"]).json()["error"] == "invalid_grant"
    assert ("assistant_disconnected", "user", "ok", "") in audit_actions()
    assert not any(a == "assistant_token_revoked"
                   for a, *_ in audit_actions())


def test_revoking_a_grant_drops_its_plans(world, monkeypatch):
    tok = connect(world)
    (g,) = grants()
    dropped = []
    monkeypatch.setattr(assistantplans, "drop_token", dropped.append)
    world.delete(f"/api/assistants/tokens/{g['id']}")
    assert dropped == [g["id"]]


def test_grants_of_one_tenant_never_reach_anothers_data(mbox, cimd,
                                                        monkeypatch):
    monkeypatch.setenv("INBOXRAKE_PUBLIC_URL", BASE)
    cfgmod.update_config({
        "auth": {"mode": "oidc", "admin": "admin@corp.example",
                 "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                          "client_secret": "sst"}},
        "assistants": {"access": "act", "oauth": True}})
    admin, alice = web("admin@corp.example"), web("alice@x.example")
    admin.post("/api/config", json={
        "rename_account": {"from": "default", "to": "admin-box"}})
    alice.post("/api/config", json={
        "rename_account": {"from": "default", "to": "alice-box"}})
    a = connect(alice, accounts=["alice-box"])
    b = connect(admin, accounts=["admin-box"])
    names = lambda t: [x["name"] for x in ok(   # noqa: E731
        t["access_token"], "list_accounts", c=anon())["accounts"]]
    assert names(a) == ["alice-box"] and names(b) == ["admin-box"]
    res = call(a["access_token"], "mailbox_overview",
               {"account": "admin-box"}, c=anon())
    assert res["isError"] is True
    # each lists and revokes only their own
    assert [g["client_host"] for g in alice.get(
        "/api/assistants/tokens").json()["tokens"]] == ["client.example"]
    (ga,) = [g for g in assistanttokens._read() if g["tenant"] != "default"]
    assert admin.delete(
        f"/api/assistants/tokens/{ga['id']}").status_code == 404
    assert mcp(a["access_token"]).status_code == 200
    # alice cannot consent for an account that is not hers
    start(alice, pkce()[1])
    page = get_connect(alice).json()
    assert page["accounts"] == ["alice-box"]
    r = post_connect(alice, page["request_id"], accounts=["admin-box"])
    assert r.json()["detail"] == "assistant_token_accounts"


# ===================================================================== revoke

def test_revoke_by_access_token_or_refresh_token(world):
    for kind in ("access_token", "refresh_token"):
        tok = connect(world, name=f"Revoked {kind}")
        r = anon().post("/oauth/revoke", data={
            "token": tok[kind], "client_id": CID})
        assert r.status_code == 200 and r.json() == {}
        assert r.headers["cache-control"] == "no-store"
        assert mcp(tok["access_token"]).status_code == 401
        assert refresh(tok["refresh_token"]).json()["error"] == "invalid_grant"
    assert grants() == []
    for kind in ("access_token", "refresh_token"):
        assert ("assistant_disconnected", f"mcp:Revoked {kind}", "ok", "") \
            in audit_actions()


def test_revoke_with_the_wrong_client_or_an_unknown_token_changes_nothing(
        world):
    tok = connect(world)
    c = anon()
    for data in ({"token": tok["access_token"],
                  "client_id": "https://other.example/a.json"},
                 {"token": tok["access_token"]},
                 {"token": "irk_at_" + "A" * 43, "client_id": CID},
                 {"token": "garbage", "client_id": CID},
                 {"token": "x" * 1000, "client_id": CID}):
        r = c.post("/oauth/revoke", data=data)
        assert r.status_code == 200 and r.json() == {}
    assert mcp(tok["access_token"]).status_code == 200 and len(grants()) == 1


def test_revoke_cannot_remove_a_static_token(world):
    secret = world.post("/api/assistants/tokens", json={
        "name": "Laptop", "accounts": ["default"], "level": "read",
        "subjects": False, "expires_days": 90}).json()["secret"]
    anon().post("/oauth/revoke", data={"token": secret, "client_id": CID})
    assert mcp(secret).status_code == 200


def test_revoke_wants_a_form_and_a_token_and_no_secret(world):
    c = anon()
    assert c.post("/oauth/revoke", json={"token": "x"}).status_code == 400
    assert c.post("/oauth/revoke", data={"client_id": CID}).status_code == 400
    r = c.post("/oauth/revoke", data={"token": "x", "client_secret": "s"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_client"
    assert c.get("/oauth/revoke").status_code == 404


# =================================================================== alerts

def _mailbox_can_send(url="https://mail.example.com"):
    cfgmod.update_config({"imap": {
        "host": M_HOST, "user": "me@home.example", "password": "pw-x",
        "digest": {"url": url, "lang": "en"}}})


def test_a_new_connection_pushes_and_mails_the_user(world, pushes, mails):
    _mailbox_can_send()
    connect(world, level="act", scope="mcp:act", name="Example")
    assert [(a, k, p["label"]) for a, k, p in pushes] == [
        ("default", "connection", "client.example (Act)")]
    (to, subject, text, html), = mails
    assert to == "me@home.example"
    assert subject == "Inboxrake: new AI connection: client[.]example (Act)"
    assert "client[.]example · Act access · default" in text
    assert "disconnect the app now" in text
    assert "https://mail.example.com/#/settings/assistants" in text
    assert "client.example" not in text and "client.example" not in html
    assert html.count("href=") == 1


def test_the_connection_mail_follows_the_email_switch_and_the_window(
        world, pushes, mails, monkeypatch):
    _mailbox_can_send()
    now = {"t": 1_000_000.0}
    timers = []
    monkeypatch.setattr(proposalmail, "_now", lambda: now["t"])
    monkeypatch.setattr(proposalmail, "_start_timer",
                        lambda delay, fn, *a: timers.append((fn, a)) or object())
    connect(world)
    connect(world)                         # inside the 10 minutes: waits
    assert len(mails) == 1 and len(pushes) == 2       # push is not batched
    now["t"] += proposalmail.EMAIL_WINDOW
    fn, args = timers.pop(0)
    fn(*args)
    assert len(mails) == 2 and "1 new" not in mails[1][1]
    # switched off: still pushed, no mail
    world.post("/api/config", json={"assistants_notify": {"email": False}})
    now["t"] += proposalmail.EMAIL_WINDOW + 1
    connect(world)
    assert len(mails) == 2 and len(pushes) == 3


def test_the_connection_mail_is_german_with_a_german_digest(world, mails):
    cfgmod.update_config({"imap": {
        "host": M_HOST, "user": "me@home.example", "password": "pw-x",
        "digest": {"lang": "de"}}})
    connect(world)
    (to, subject, text, html), = mails
    assert subject.startswith("Inboxrake: neue KI-Verbindung")
    assert "Zugriff Lesen" in text


def test_a_failing_alert_never_blocks_the_connection(world, monkeypatch):
    monkeypatch.setattr(webpush, "job_finished", lambda *a, **k: (_ for _ in ()
                        ).throw(RuntimeError("boom")))
    _mailbox_can_send()
    assert connect(world)["access_token"]


def test_a_denied_or_failed_request_alerts_nobody(world, pushes, mails):
    _mailbox_can_send()
    _, page = consent(world)
    post_connect(world, page["request_id"], approve=False)
    assert pushes == [] and mails == []


# ============================================================ edges and data

def test_oauth_bodies_are_capped_at_8_kib(world):
    c = anon()
    big = "x" * (9 * 1024)
    for path in ("/oauth/token", "/oauth/revoke"):
        r = c.post(path, content=big, headers={
            "Content-Type": "application/x-www-form-urlencoded"})
        assert r.status_code == 413, path
    assert bodylimit.limit_for("/oauth/token", set()) == bodylimit.LIMIT_PUBLIC
    assert bodylimit.limit_for("/oauth/revoke/", set()) == \
        bodylimit.LIMIT_PUBLIC
    assert bodylimit.limit_for("/.well-known/oauth-authorization-server",
                               set()) == bodylimit.LIMIT_PUBLIC
    assert bodylimit.limit_for("/oauth/x/y", set()) == bodylimit.LIMIT_PUBLIC
    assert bodylimit.limit_for("/api/assistants/connect", set()) == \
        bodylimit.LIMIT_DEFAULT
    assert bodylimit.limit_for("/mcp", set()) == bodylimit.LIMIT_MCP


def test_an_oauth_typo_never_serves_the_app_shell(world):
    for path in ("/oauth", "/oauth/", "/oauth/authorise", "/oauth/x/y",
                 "/.well-known/oauth-nothing"):
        r = anon().get(path)
        assert r.status_code == 404, path
        assert "text/html" not in r.headers.get("content-type", ""), path


def test_every_oauth_route_is_registered_before_the_spa_catch_all():
    paths = [getattr(r, "path", "") for r in app.routes]
    spa = paths.index("/{path:path}") if "/{path:path}" in paths else len(paths)
    for want in ("/oauth/authorize", "/oauth/token", "/oauth/revoke",
                 "/.well-known/oauth-authorization-server",
                 "/.well-known/oauth-protected-resource",
                 "/.well-known/oauth-protected-resource/mcp"):
        assert paths.index(want) < spa, want


def test_the_consent_routes_are_locked_without_a_session(world):
    c = anon()
    assert c.get("/api/assistants/connect").json() == {
        "detail": "login required"}
    r = c.post("/api/assistants/connect", json={
        "request_id": "x", "approve": True})
    assert (r.status_code, r.json()) == (401, {"detail": "login required"})


def test_grants_are_not_in_the_export_or_the_backup(world):
    tok = connect(world)
    text = world.get("/api/export_config").text
    for needle in (tok["access_token"], tok["refresh_token"], "access_hash",
                   "refresh_hash", "client.example", "irk_at_", "irk_rt_"):
        assert needle not in text


def test_a_dropped_account_deletes_a_grant_left_with_none(world):
    connect(world)
    assert len(grants()) == 1
    assistanttokens.drop_account("default", "default")
    assert grants() == []
    connect(world)
    assistanttokens.create_grant(
        "default", "password", "two", ["default", "other"], "read", False, 90,
        2000, {"client_id": CID, "client_name": "x", "client_host": "h",
               "redirect_uri": CB}, MCP)
    assistanttokens.drop_account("default", "other")
    assert [g["accounts"] for g in grants()] == [["default"], ["default"]]


def test_a_renamed_account_follows_into_the_grant(world):
    connect(world)
    assistanttokens.rename_account("default", "default", "box")
    assert grants()[0]["accounts"] == ["box"]


def test_expired_grants_are_purged_after_seven_days(world, clock):
    connect(world, expires_days=30)
    assert len(grants()) == 1
    clock.tick(30 * 86400 + 6 * 86400)
    connect(world)                              # a new grant triggers the sweep
    assert len(grants()) == 2
    clock.tick(2 * 86400)
    connect(world)
    assert len(grants()) == 2                   # the first one is gone now


def test_no_token_is_ever_logged(world, caplog):
    with caplog.at_level("DEBUG"):
        tok = connect(world)
        mcp(tok["access_token"])
        refresh(tok["refresh_token"])
    text = caplog.text
    for secret in tok.values():
        assert str(secret) not in text


def test_the_oauth_modules_import_without_fastapi():
    """The browser demo bundles every backend module (and has no fastapi in
    these): the OAuth modules are pure Python."""
    import ast
    import pathlib
    root = pathlib.Path(__file__).resolve().parent.parent / "backend"
    for name in ("oauthserver", "oauthclients", "netguard", "assistanttokens"):
        tree = ast.parse((root / f"{name}.py").read_text())
        for node in ast.walk(tree):
            mods = ([a.name for a in node.names]
                    if isinstance(node, ast.Import) else
                    [node.module or ""] if isinstance(node, ast.ImportFrom)
                    and node.level == 0 else [])
            assert not any(m.split(".")[0] in ("fastapi", "starlette",
                                               "pydantic", "uvicorn")
                           for m in mods), (name, mods)


def test_the_demo_has_no_oauth(world, monkeypatch):
    from backend import demo as demomod
    monkeypatch.setattr(demomod, "enabled", lambda: True)
    assert anon().get("/.well-known/oauth-authorization-server"
                      ).status_code == 404
    assert anon().get("/oauth/authorize").status_code == 404
    assert anon().post("/oauth/token", data={}).status_code == 404


def test_two_decisions_at_once_cannot_both_win(world, monkeypatch):
    """Both POSTs got past the lookup before either took the request: only
    one code is minted."""
    _, page = consent(world)
    rid = page["request_id"]
    (rec,) = oauthserver._pending.values()
    monkeypatch.setattr(oauthserver, "_find", lambda *a: rec)
    first = oauthserver.consent_post(
        {"request_id": rid, **choices()}, rid, "password", "default",
        ["default"])
    second = oauthserver.consent_post(
        {"request_id": rid, **choices()}, rid, "password", "default",
        ["default"])
    assert first.status == 200 and second.status == 404
    assert len(oauthserver._codes) == 1


# ------------------------------------------------------- unique names

def test_connection_names_count_up_when_taken(world):
    base = "Example Assistant · client.example"
    seen = []
    for _ in range(3):
        verifier, page = consent(world)
        seen.append(page["defaults"]["name"])
        r = post_connect(world, page["request_id"], name=seen[-1])
        q = query_of(r.json()["redirect_url"])
        assert anon().post("/oauth/token", data=token_form(
            q["code"], verifier)).status_code == 200
    assert seen == [base, base + " 2", base + " 3"]
    assert sorted(g["name"] for g in grants()) == sorted(seen)


def test_the_unique_default_stays_within_60_characters(world, cimd):
    cimd.docs[CID] = doc(client_name="N" * 60)
    first = None
    for _ in range(3):
        verifier, page = consent(world)
        name = page["defaults"]["name"]
        assert len(name) <= assistanttokens.NAME_MAX
        first = first or name
        r = post_connect(world, page["request_id"], name=name)
        anon().post("/oauth/token", data=token_form(
            query_of(r.json()["redirect_url"])["code"], verifier))
    assert len({g["name"] for g in grants()}) == 3
    assert any(g["name"].endswith(" 2") for g in grants())
    assert all(len(g["name"]) <= 60 for g in grants())


def test_a_chosen_name_that_is_taken_is_refused_and_can_be_changed(world):
    world.post("/api/assistants/tokens", json={
        "name": "Desk Laptop", "accounts": ["default"]})
    _, page = consent(world)
    for taken in ("Desk Laptop", "desk laptop", " DESK   laptop "):
        r = post_connect(world, page["request_id"], name=taken)
        assert (r.status_code, r.json()["detail"]) == (400, "name_taken")
    assert post_connect(world, page["request_id"],
                        name="Desk Laptop 2").status_code == 200


def test_grants_and_tokens_share_one_namespace(world):
    connect(world, name="Shared name")
    r = world.post("/api/assistants/tokens", json={
        "name": "shared NAME", "accounts": ["default"]})
    assert (r.status_code, r.json()["detail"]) == (400, "name_taken")


def test_a_name_taken_between_consent_and_redemption_gets_a_number(world):
    code, verifier = connect_code(world, name="Race name")
    world.post("/api/assistants/tokens", json={
        "name": "race NAME", "accounts": ["default"]})
    assert anon().post("/oauth/token", data=token_form(
        code, verifier)).status_code == 200      # the connection still works
    assert sorted(t["name"] for t in assistanttokens._read()) == [
        "Race name 2", "race NAME"]


def test_a_disconnected_grants_name_is_free_again(world):
    connect(world, name="Again")
    (g,) = grants()
    world.delete(f"/api/assistants/tokens/{g['id']}")
    _, page = consent(world)
    assert post_connect(world, page["request_id"],
                        name="Again").status_code == 200


# --------------------------------------------- more of the threat table

def test_there_is_no_client_registration_endpoint(world):
    for path in ("/oauth/register", "/register", "/oauth/clients"):
        assert anon().post(path, json={"redirect_uris": [CB]}).status_code in (
            404, 405)
    assert "registration_endpoint" not in anon().get(
        "/.well-known/oauth-authorization-server").json()


def test_an_access_token_in_a_url_is_refused_like_a_static_token(world):
    tok = connect(world)
    msg = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    for q in (f"access_token={tok['access_token']}",
              f"x={tok['access_token']}"):
        r = anon().post(f"/mcp?{q}", json=msg, headers={
            "Authorization": f"Bearer {tok['access_token']}"})
        assert (r.status_code, r.json()["detail"]) == (400, "token_in_query")


def test_the_consent_api_is_never_framed_or_cached(world):
    _, page = consent(world)
    r = get_connect(world)
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["content-security-policy"] == "frame-ancestors 'none'"
    assert r.headers["cache-control"] == "no-store"
    r = anon().get("/oauth/authorize", params=auth_params(pkce()[1]),
                   follow_redirects=False)
    assert r.headers["x-frame-options"] == "DENY"
