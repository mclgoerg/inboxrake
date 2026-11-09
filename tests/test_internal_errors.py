"""An exception no handler expected answers with the coded, generic
`internal_error` - never `TypeName: message`, which can hold the shared AI
endpoint, a provider's error text or a data path (visible to every tenant
in OIDC mode). The full exception goes to the server log with the request
line. Expected, specific errors keep their codes."""

import logging

import pytest
from fastapi.testclient import TestClient

from backend import aifilter, aihelper, errortext, mailops, unsub
from backend import rules as rulesmod
from backend.main import app

client = TestClient(app)

# what a failing call might say: a data path, an AI endpoint, a provider text
SECRET = ("OSError: [Errno 28] /data/tenants/abc123/config.json "
          "https://ai.internal.example/v1 quota text")


def _boom(*_a, **_k):
    raise OSError(SECRET)


# (what to break, method, path, request) - one per changed handler
CASES = [
    (mailops, "fetch_message", "GET", "/api/message?folder=INBOX&uid=1", None),
    (mailops, "fetch_messages", "POST", "/api/messages",
     {"items": [["INBOX", 1]]}),
    (mailops, "thread_conversation", "GET", "/api/thread?folder=INBOX&uid=1",
     None),
    (mailops, "delete_groups", "POST", "/api/delete",
     {"grouping": "sender", "keys": ["a@x.example"]}),
    (mailops, "delete_messages", "POST", "/api/delete_messages",
     {"items": [["INBOX", 1]]}),
    (mailops, "set_pin", "POST", "/api/pin", {"folder": "INBOX", "uid": 1}),
    (mailops, "set_group_pin", "POST", "/api/pin_group",
     {"grouping": "sender", "key": "a@x.example"}),
    (aifilter, "suggest", "POST", "/api/ai/filter", {"text": "old mail"}),
    (aihelper, "ai_group", "POST", "/api/ai_group",
     {"grouping": "sender", "key": "a@x.example"}),
    (unsub, "start_bulk", "POST", "/api/unsubscribe_bulk",
     {"grouping": "sender", "keys": ["a@x.example"]}),
    (rulesmod, "run_rule", "POST", "/api/block",
     {"grouping": "sender", "key": "a@x.example"}),
    (mailops, "undo_last", "POST", "/api/undo", {}),
    (mailops, "trash_list", "GET", "/api/trash", None),
    (mailops, "trash_restore", "POST", "/api/trash/restore",
     {"uids": [1], "dest": "INBOX"}),
    (mailops, "role_list", "GET", "/api/folders_panel?role=junk", None),
    (mailops, "role_move", "POST", "/api/folders_panel/move",
     {"role": "junk", "action": "trash", "uids": [1]}),
    (mailops, "purge_preview", "POST", "/api/folders_panel/purge_preview",
     {"role": "junk", "everything": True}),
    (mailops, "purge_mails", "POST", "/api/folders_panel/purge",
     {"role": "junk", "uids": [1]}),
    (mailops, "empty_trash", "POST", "/api/empty_trash", {}),
    (mailops, "set_role_override", "POST", "/api/folders/role",
     {"role": "junk", "folder": "Spam"}),
    (mailops, "lookalike_count", "GET", "/api/folders/lookalike?folder=Bin",
     None),
    (mailops, "move_lookalike", "POST", "/api/folders/move_contents",
     {"folder": "Bin"}),
    (mailops, "search_body", "GET", "/api/search?q=x&scope=body", None),
]


@pytest.mark.parametrize("mod,name,method,path,body", CASES,
                         ids=[c[1] for c in CASES])
def test_an_unexpected_error_hides_its_text_and_is_logged(
        monkeypatch, caplog, mod, name, method, path, body):
    monkeypatch.setattr(mod, name, _boom)
    with caplog.at_level(logging.ERROR, logger="inboxrake.api"):
        r = client.request(method, path, json=body)
    assert r.status_code == 500
    assert r.json()["detail"] == mailops.INTERNAL_ERROR
    assert "OSError" not in r.text and "/data" not in r.text
    assert "ai.internal.example" not in r.text
    # the log has the whole story and says which request it was
    assert "ai.internal.example" in caplog.text
    assert f"{method} {path.partition('?')[0]} failed" in caplog.text


def test_the_local_body_search_is_covered_too(monkeypatch):
    from backend import config as cfgmod
    real = cfgmod.account_imap
    monkeypatch.setattr(cfgmod, "account_imap",
                        lambda name: {**real(name), "body_search": "local"})
    monkeypatch.setattr(mailops, "search_local", _boom)
    r = client.get("/api/search", params={"q": "x", "scope": "body"})
    assert r.status_code == 500 and r.json()["detail"] == "internal_error"


def test_a_coded_refusal_keeps_its_code(monkeypatch):
    def refuse(*_a, **_k):
        raise OSError(mailops.coded(mailops.BUSY_ACTION))
    monkeypatch.setattr(mailops, "fetch_message", refuse)
    r = client.get("/api/message", params={"folder": "INBOX", "uid": 1})
    assert r.status_code == 500 and r.json()["detail"] == "busy_action"


def test_a_mail_server_failure_keeps_its_own_code(monkeypatch):
    def down(*_a, **_k):
        raise ConnectionRefusedError("refused by 10.0.0.9")
    monkeypatch.setattr(mailops, "fetch_message", down)
    r = client.get("/api/message", params={"folder": "INBOX", "uid": 1})
    assert r.status_code == 500
    assert r.json()["detail"].startswith("conn_refused:")
    assert "10.0.0.9" not in r.text


def test_an_ai_handler_never_blames_the_mail_server(monkeypatch):
    def down(*_a, **_k):
        raise ConnectionRefusedError("refused by ai.internal.example")
    monkeypatch.setattr(aifilter, "suggest", down)
    r = client.post("/api/ai/filter", json={"text": "old mail"})
    assert r.json()["detail"] == "internal_error"


def test_a_runtime_errors_own_text_stays_without_the_type_name(monkeypatch):
    def unknown(*_a, **_k):
        raise RuntimeError("unknown message")
    monkeypatch.setattr(mailops, "fetch_message", unknown)
    r = client.get("/api/message", params={"folder": "INBOX", "uid": 1})
    assert r.status_code == 500 and r.json()["detail"] == "unknown message"


def test_specific_errors_are_unchanged(monkeypatch):
    def refuse(exc):
        def f(*_a, **_k):
            raise exc
        return f
    monkeypatch.setattr(mailops, "trash_list",
                        refuse(RuntimeError("busy_scan")))
    r = client.get("/api/trash")
    assert r.status_code == 409 and r.json()["detail"] == "busy_scan"
    monkeypatch.setattr(mailops, "set_pin", refuse(ValueError("no_message_id")))
    r = client.post("/api/pin", json={"folder": "INBOX", "uid": 1})
    assert r.status_code == 400 and r.json()["detail"] == "no_message_id"


def test_the_english_text_exists_for_the_csv_export():
    assert "internal_error" in errortext.TEXT


# ---------------------------------------- provider text stays in the log

PROVIDER_TEXT = "oauth token error: invalid_grant Token revoked for tenant-7f3a"


def test_a_refused_oauth_refresh_asks_to_reconnect_and_logs_the_text(
        monkeypatch, caplog):
    import time
    from backend import oauthflow

    class Conn:
        def __init__(self, *a, **k):
            pass

        def shutdown(self):
            pass

    def refused(*_a, **_k):
        raise RuntimeError(PROVIDER_TEXT)

    monkeypatch.setattr(mailops.imaplib, "IMAP4_SSL", Conn)
    monkeypatch.setattr(oauthflow, "refresh", refused)
    im = {"host": "imap.example", "port": 993, "security": "ssl",
          "user": "me@mail.example", "password": "", "cafile": "",
          "oauth": {"provider": "google", "client_id": "cid",
                    "client_secret": "sec", "refresh_token": "rt",
                    "access_token": "old", "expires_at": time.time() - 10}}
    with caplog.at_level(logging.WARNING, logger="inboxrake.mail"):
        with pytest.raises(RuntimeError) as err:
            mailops.connect(im, "gmail")
    assert str(err.value) == "oauth_reconnect"
    assert "tenant-7f3a" in caplog.text


def test_the_reader_shows_the_reconnect_code_not_the_provider_text(
        monkeypatch):
    def refused(*_a, **_k):
        raise RuntimeError(mailops.coded(mailops.OAUTH_RECONNECT))
    monkeypatch.setattr(mailops, "fetch_message", refused)
    r = client.get("/api/message", params={"folder": "INBOX", "uid": 1})
    assert r.json()["detail"] == "oauth_reconnect"


def test_a_plain_runtime_error_keeps_its_traceback_in_the_log(
        monkeypatch, caplog):
    def bug(*_a, **_k):
        raise RuntimeError("unknown message")
    monkeypatch.setattr(mailops, "fetch_message", bug)
    with caplog.at_level(logging.WARNING, logger="inboxrake.api"):
        client.get("/api/message", params={"folder": "INBOX", "uid": 1})
    rec = [r for r in caplog.records if r.name == "inboxrake.api"][0]
    assert rec.exc_info and "Traceback" in caplog.text


def _oidc():
    from backend import auth as authmod
    r = client.post("/api/config", json={"auth": {
        "mode": "oidc",
        "oidc": {"issuer": "https://idp.example", "client_id": "inboxrake",
                 "client_secret": "sst", "allowed": ["me@corp.example"]}}})
    assert r.status_code == 200
    return authmod


def test_an_unreachable_idp_is_a_coded_502_and_logged(monkeypatch, caplog):
    authmod = _oidc()
    secret = "https://idp.internal.example/.well-known: connection reset"

    def down(*_a, **_k):
        raise OSError(secret)

    monkeypatch.setattr(authmod, "auth_url", down)
    with caplog.at_level(logging.ERROR, logger="inboxrake.auth"):
        r = TestClient(app).get("/api/oidc/login", follow_redirects=False)
    assert r.status_code == 502 and r.json()["detail"] == "idp_unavailable"
    assert "idp.internal.example" not in r.text
    assert "idp.internal.example" in caplog.text


def test_a_failed_token_exchange_is_a_coded_502_and_logged(
        monkeypatch, caplog):
    authmod = _oidc()
    monkeypatch.setattr(authmod, "discovery", lambda issuer: {
        "authorization_endpoint": "https://idp.example/authorize",
        "token_endpoint": "https://idp.example/token"})
    anon = TestClient(app)
    login = anon.get("/api/oidc/login", follow_redirects=False)
    state = login.headers["location"].split("state=")[1].split("&")[0]

    def refused(*_a, **_k):
        raise RuntimeError("token endpoint said: invalid_client secret-body")

    monkeypatch.setattr(authmod, "exchange_code", refused)
    with caplog.at_level(logging.ERROR, logger="inboxrake.auth"):
        r = anon.get("/api/oidc/callback", params={
            "code": "abc", "state": state}, follow_redirects=False)
    assert r.status_code == 502 and r.json()["detail"] == "idp_unavailable"
    assert "secret-body" not in r.text and "secret-body" in caplog.text
