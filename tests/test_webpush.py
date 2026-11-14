"""Web Push (backend/webpush.py): RFC 8291 encryption against the RFC's own
test vector, the VAPID token, which push services the server will dial,
the subscribe / test / presence API incl. tenant isolation, and which jobs
push (only the ones a person started)."""

import base64
import json
import os
import re
import threading
import time
import types

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    encode_dss_signature)
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aihelper
from backend import auth as authmod
from backend import autoscan as autoscanmod
from backend import config as cfgmod
from backend import demo
from backend import mailops
from backend import tenants
from backend import unsub
from backend import webpush
from backend.main import app

from conftest import wait_scan_done

ENDPOINT = "https://web.push.apple.com/QXhfcGFzc3dvcmQ"
ORIGIN = {"Origin": "https://testserver"}

client = TestClient(app)


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@pytest.fixture(autouse=True)
def push_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(webpush, "PUSH_KEY_PATH", tmp_path / "vapid.pem")
    monkeypatch.setattr(webpush, "PUSH_SUBS_PATH", tmp_path / "subs.json")
    monkeypatch.setattr(webpush, "_key_cache", None)
    monkeypatch.setattr(webpush, "_presence", {})
    monkeypatch.delenv("INBOXRAKE_PUSH_HOSTS", raising=False)
    monkeypatch.delenv("INBOXRAKE_PUSH_CONTACT", raising=False)


@pytest.fixture
def network(monkeypatch):
    """The send function's network seam: records every POST, answers with
    `net.status` (no real sockets)."""
    class Net:
        status = 201
        sent: list = []

    net = Net()
    net.sent = []

    def fake_post(endpoint, headers, body):
        net.sent.append((endpoint, headers, body))
        return net.status

    monkeypatch.setattr(webpush, "_post", fake_post)
    return net


def device():
    """A browser's side of a subscription: (keys, private key)."""
    key = ec.generate_private_key(ec.SECP256R1())
    pub = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint)
    return {"p256dh": b64u(pub), "auth": b64u(os.urandom(16))}, key


def sub_body(endpoint=ENDPOINT, lang="en", keys=None):
    return {"endpoint": endpoint, "keys": keys or device()[0], "lang": lang}


# --------------------------------------------------------- RFC 8291 vector

def test_encryption_matches_the_rfc_8291_appendix_a_vector():
    as_private = ec.derive_private_key(int.from_bytes(unb64u(
        "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")), ec.SECP256R1())
    body = webpush.encrypt(
        unb64u("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8"
        "pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg",
        sender_key=as_private, salt=unb64u("DGv6ra1nlYgDCS1FRnbzlw"))
    header = ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
              "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
    cipher = ("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs"
              "bI_0LpXMuGvnzQ")
    assert len(unb64u(header)) == 86
    assert body == unb64u(header) + unb64u(cipher)


def test_a_random_sender_key_and_salt_round_trip():
    keys, ua_key = device()
    body = webpush.encrypt(b'{"x": 1}', keys["p256dh"], keys["auth"])
    salt, rs, idlen = body[:16], body[16:20], body[20]
    as_public, cipher = body[21:21 + idlen], body[21 + idlen:]
    assert int.from_bytes(rs, "big") == 4096 and idlen == 65
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    ua_pub = unb64u(keys["p256dh"])
    secret = ua_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey
                             .from_encoded_point(ec.SECP256R1(), as_public))
    ikm = HKDF(hashes.SHA256(), 32, unb64u(keys["auth"]),
               b"WebPush: info\0" + ua_pub + as_public).derive(secret)
    cek = HKDF(hashes.SHA256(), 16, salt,
               b"Content-Encoding: aes128gcm\0").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt,
                 b"Content-Encoding: nonce\0").derive(ikm)
    assert AESGCM(cek).decrypt(nonce, cipher, None) == b'{"x": 1}\x02'


# ------------------------------------------------------------------- VAPID

def test_the_vapid_key_is_created_once_and_kept_private(tmp_path):
    key = webpush.public_key()
    pem = tmp_path / "vapid.pem"
    assert pem.stat().st_mode & 0o777 == 0o600
    assert len(unb64u(key)) == 65 and unb64u(key)[0] == 4
    webpush._key_cache = None                      # a restart
    assert webpush.public_key() == key
    pem.write_text("garbage")                      # damaged: a new one
    webpush._key_cache = None
    assert len(unb64u(webpush.public_key())) == 65


def test_the_jwt_verifies_and_carries_aud_exp_and_sub():
    pub = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), unb64u(webpush.public_key()))
    now = time.time()
    token = webpush.vapid_jwt(ENDPOINT, "mailto:me@x.example", now)
    head, claims, sig = token.split(".")
    assert json.loads(unb64u(head)) == {"typ": "JWT", "alg": "ES256"}
    body = json.loads(unb64u(claims))
    assert body == {"aud": "https://web.push.apple.com",
                    "exp": int(now + 12 * 3600), "sub": "mailto:me@x.example"}
    raw = unb64u(sig)
    assert len(raw) == 64
    pub.verify(encode_dss_signature(int.from_bytes(raw[:32]),
                                    int.from_bytes(raw[32:])),
               f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))


def test_the_vapid_subject_prefers_the_contact_then_the_origin(monkeypatch):
    sub = {"origin": "https://mail.example"}
    assert webpush._subject(sub) == "https://mail.example"
    assert webpush._subject({}) == "mailto:inboxrake@localhost"
    monkeypatch.setenv("INBOXRAKE_PUSH_CONTACT", "mailto:ops@x.example")
    assert webpush._subject(sub) == "mailto:ops@x.example"
    monkeypatch.setenv("INBOXRAKE_PUSH_CONTACT", "ftp://nope")
    assert webpush._subject(sub) == "https://mail.example"


def test_the_request_headers(network):
    keys, _ = device()
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"], "en",
                      "https://mail.example")
    webpush.send(webpush.subscriptions()[0], {"title": "t"})
    endpoint, headers, body = network.sent[0]
    assert endpoint == ENDPOINT
    assert headers["Authorization"].startswith("vapid t=")
    assert headers["Authorization"].endswith(", k=" + webpush.public_key())
    assert headers["TTL"] == "43200" and headers["Urgency"] == "normal"
    assert headers["Content-Encoding"] == "aes128gcm"
    assert headers["Content-Type"] == "application/octet-stream"
    assert len(body) > 86


# -------------------------------------------------------------- validation

@pytest.mark.parametrize("endpoint", [
    "https://web.push.apple.com/x",
    "https://push.apple.com/x",
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://web.push.apple.com:443/x",
])
def test_endpoints_of_the_push_services_are_valid(endpoint):
    assert webpush.valid_endpoint(endpoint)


@pytest.mark.parametrize("endpoint", [
    "https://evilpush.apple.com.attacker.example/x",
    "https://xpush.apple.com/x",
    "https://push.apple.com.evil.example/x",
    "http://web.push.apple.com/x",
    "https://web.push.apple.com:8443/x",
    "https://user:pw@web.push.apple.com/x",
    "https://web.push.apple.com@evil.example/x",
    "https://127.0.0.1/x", "https://[::1]/x", "https://10.0.0.5/x",
    "https://localhost/x", "https://web.push.apple.com./x",
    "ftp://web.push.apple.com/x", "", "web.push.apple.com/x",
    "https://web.push.apple.com/ x", "https://web.push.apple.com/\n",
    "https://web.push.apple.com/" + "a" * 1100,
])
def test_look_alikes_and_other_addresses_are_refused(endpoint):
    assert not webpush.valid_endpoint(endpoint)


def test_valid_endpoint_rejects_non_strings():
    assert not webpush.valid_endpoint(None)
    assert not webpush.valid_endpoint(42)


def test_extra_push_hosts_come_from_the_environment(monkeypatch):
    assert not webpush.valid_endpoint("https://push.vendor.example/x")
    monkeypatch.setenv("INBOXRAKE_PUSH_HOSTS", "push.vendor.example, bad/host")
    assert webpush.valid_endpoint("https://eu.push.vendor.example/x")
    assert not webpush.valid_endpoint("https://xpush.vendor.example/x")


def test_the_subscribe_api_validates_keys_and_lang():
    assert client.post("/api/push/subscribe",
                       json=sub_body(lang="fr"), headers=ORIGIN
                       ).status_code == 200
    assert webpush.subscriptions()[0]["lang"] == "en"
    good = device()[0]
    for keys in (
            {**good, "p256dh": b64u(os.urandom(64))},         # 64 bytes
            {**good, "p256dh": b64u(b"\x04" + os.urandom(64))},  # off the curve
            {**good, "auth": b64u(os.urandom(15))},
            {**good, "auth": b64u(os.urandom(17))},
            {**good, "auth": "not base64 !"},
            {**good, "p256dh": ""}):
        r = client.post("/api/push/subscribe", json=sub_body(keys=keys))
        assert r.status_code == 400 and r.json()["detail"] == "push_invalid"
    r = client.post("/api/push/subscribe",
                    json=sub_body(endpoint="https://evil.example/x"))
    assert r.status_code == 400 and r.json()["detail"] == "push_invalid"


def test_subscribe_stores_the_origin_only_when_it_is_one():
    client.post("/api/push/subscribe", json=sub_body(),
                headers={"Origin": "https://testserver"})
    assert webpush.subscriptions()[0]["origin"] == "https://testserver"
    client.post("/api/push/subscribe", json=sub_body())     # no Origin header
    assert webpush.subscriptions()[0]["origin"] == ""
    webpush.subscribe(ENDPOINT, **{k: v for k, v in device()[0].items()},
                      origin="http://insecure.example")
    assert webpush.subscriptions()[0]["origin"] == ""


# ----------------------------------------------------------------- storage

def test_subscribing_again_updates_instead_of_duplicating():
    client.post("/api/push/subscribe", json=sub_body(lang="en"))
    first = webpush.subscriptions()[0]["created"]
    client.post("/api/push/subscribe", json=sub_body(lang="de"))
    subs = webpush.subscriptions()
    assert len(subs) == 1 and subs[0]["lang"] == "de"
    assert subs[0]["created"] == first


def test_at_most_twenty_subscriptions_the_oldest_drops(monkeypatch):
    clock = iter(range(1000, 2000))
    monkeypatch.setattr(webpush.time, "time", lambda: next(clock))
    for i in range(22):
        keys = device()[0]
        webpush.subscribe(f"https://web.push.apple.com/{i}", keys["p256dh"],
                          keys["auth"])
    ends = [s["endpoint"] for s in webpush.subscriptions()]
    assert len(ends) == 20
    assert "https://web.push.apple.com/0" not in ends
    assert "https://web.push.apple.com/21" in ends


def test_a_damaged_file_is_no_subscriptions_not_a_crash(tmp_path):
    path = tmp_path / "subs.json"
    for text in ("{broken", "[]", '{"subscriptions": 5}',
                 '{"subscriptions": [1, {"endpoint": 3}]}'):
        path.write_text(text)
        assert webpush.subscriptions() == []
    keys = device()[0]
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"])
    assert path.stat().st_mode & 0o777 == 0o600
    assert len(webpush.subscriptions()) == 1


def test_unsubscribe_forgets_the_device():
    client.post("/api/push/subscribe", json=sub_body())
    assert client.post("/api/push/unsubscribe",
                       json={"endpoint": ENDPOINT}).status_code == 200
    assert webpush.subscriptions() == []
    assert client.post("/api/push/unsubscribe",
                       json={"endpoint": ENDPOINT}).status_code == 200


def test_the_key_endpoint():
    r = client.get("/api/push/key")
    assert r.status_code == 200 and r.json()["key"] == webpush.public_key()


def test_subscriptions_are_not_part_of_the_settings_export(tmp_path):
    client.post("/api/push/subscribe", json=sub_body())
    dump = json.dumps(client.get("/api/config").json())
    assert "web.push.apple.com" not in dump


# ------------------------------------------------------------ test + errors

def test_the_test_push_reaches_the_device_and_ignores_presence(network):
    client.post("/api/push/subscribe", json=sub_body(lang="de"))
    client.post("/api/push/presence", json={"endpoint": ENDPOINT,
                                            "visible": True})
    r = client.post("/api/push/test", json={"endpoint": ENDPOINT})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert len(network.sent) == 1


def test_the_test_push_for_an_unknown_device():
    r = client.post("/api/push/test", json={"endpoint": ENDPOINT})
    assert r.status_code == 404 and r.json()["detail"] == "push_unknown"


def test_the_test_push_reports_the_push_service_status(network):
    client.post("/api/push/subscribe", json=sub_body())
    network.status = 503
    r = client.post("/api/push/test", json={"endpoint": ENDPOINT})
    assert r.status_code == 409 and r.json()["detail"] == "push_http:status=503"
    assert len(webpush.subscriptions()) == 1        # a hiccup keeps it


def test_the_test_push_reports_an_unreachable_service(monkeypatch):
    client.post("/api/push/subscribe", json=sub_body())

    def down(*a):
        raise webpush.PushError("push_unreachable")

    monkeypatch.setattr(webpush, "_post", down)
    r = client.post("/api/push/test", json={"endpoint": ENDPOINT})
    assert r.status_code == 409 and r.json()["detail"] == "push_unreachable"


@pytest.mark.parametrize("status", [404, 410])
def test_a_gone_subscription_is_dropped(network, status):
    client.post("/api/push/subscribe", json=sub_body())
    network.status = status
    r = client.post("/api/push/test", json={"endpoint": ENDPOINT})
    assert r.status_code == 404 and r.json()["detail"] == "push_unknown"
    assert webpush.subscriptions() == []


def test_a_failure_logs_host_and_status_but_never_the_path(network, caplog):
    client.post("/api/push/subscribe", json=sub_body())
    network.status = 500
    with caplog.at_level("WARNING", logger="inboxrake.webpush"):
        client.post("/api/push/test", json={"endpoint": ENDPOINT})
    assert re.search(r"web\.push\.apple\.com.*500", caplog.text)
    assert "QXhfcGFzc3dvcmQ" not in caplog.text


def test_the_real_post_goes_through_the_ssrf_guard(monkeypatch):
    """No sockets: the address check refuses before anything connects."""
    monkeypatch.setattr(unsub, "_resolve_public", lambda h, p: (_ for _ in ()
                        ).throw(RuntimeError("unsub_blocked")))
    monkeypatch.setattr(unsub, "_PinnedHTTPSConnection",
                        lambda *a, **k: pytest.fail("connected"))
    with pytest.raises(webpush.PushError, match="push_unreachable"):
        webpush._post(ENDPOINT, {}, b"x")


def test_the_real_post_pins_the_address_and_never_follows(monkeypatch):
    seen = {}

    class Conn:
        def __init__(self, host, port, ip, timeout):
            seen.update(host=host, port=port, ip=ip, timeout=timeout)

        def request(self, method, target, body=None, headers=None):
            seen.update(method=method, target=target)

        def getresponse(self):
            class R:
                status = 302
                def read(self, n): return b""
            return R()

        def close(self):
            seen["closed"] = True

    monkeypatch.setattr(unsub, "_resolve_public", lambda h, p: ["17.0.0.1"])
    monkeypatch.setattr(unsub, "_PinnedHTTPSConnection", Conn)
    assert webpush._post(ENDPOINT + "?a=b", {}, b"x") == 302
    assert seen == {"host": "web.push.apple.com", "port": 443,
                    "ip": "17.0.0.1", "timeout": 10, "method": "POST",
                    "target": "/QXhfcGFzc3dvcmQ?a=b", "closed": True}


# ---------------------------------------------------------------- presence

def test_presence_expires_and_is_withdrawn():
    client.post("/api/push/subscribe", json=sub_body())
    tenant = tenants.current()
    assert not webpush._present(ENDPOINT, tenant)
    client.post("/api/push/presence", json={"endpoint": ENDPOINT,
                                            "visible": True})
    assert webpush._present(ENDPOINT, tenant)
    key = webpush._presence_key(ENDPOINT, tenant)
    webpush._presence[key] = time.monotonic() - 1        # 60 s have passed
    assert not webpush._present(ENDPOINT, tenant)
    client.post("/api/push/presence", json={"endpoint": ENDPOINT,
                                            "visible": True})
    client.post("/api/push/presence", json={"endpoint": ENDPOINT,
                                            "visible": False})
    assert not webpush._present(ENDPOINT, tenant)


def test_presence_of_an_unknown_endpoint_is_a_no_op():
    r = client.post("/api/push/presence", json={"endpoint": ENDPOINT,
                                                "visible": True})
    assert r.status_code == 200 and webpush._presence == {}


# ------------------------------------------------------------------ tenants

def _enable_oidc():
    cfgmod.update_config({"auth": {
        "mode": "oidc", "admin": "admin@corp.example",
        "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                 "client_secret": "sst"}}})


def _client_as(sub):
    c = TestClient(app)
    c.cookies.set("pmc_session", authmod.make_session(sub))
    return c


def test_subscriptions_belong_to_their_tenant_and_endpoints_move(network):
    _enable_oidc()
    alice, bob = _client_as("alice@x.example"), _client_as("bob@y.example")
    admin = _client_as("admin@corp.example")
    a_t, b_t = (tenants.for_subject("alice@x.example"),
                tenants.for_subject("bob@y.example"))
    assert alice.post("/api/push/subscribe", json=sub_body(),
                      headers=ORIGIN).status_code == 200
    keys = device()[0]
    other = "https://fcm.googleapis.com/fcm/send/bobs"
    assert bob.post("/api/push/subscribe",
                    json=sub_body(other, keys=keys)).status_code == 200
    assert [s["endpoint"] for s in webpush.subscriptions(a_t)] == [ENDPOINT]
    assert [s["endpoint"] for s in webpush.subscriptions(b_t)] == [other]
    # nobody can test, unsubscribe or probe another tenant's device
    assert bob.post("/api/push/test", json={"endpoint": ENDPOINT}
                    ).status_code == 404
    bob.post("/api/push/unsubscribe", json={"endpoint": ENDPOINT})
    assert len(webpush.subscriptions(a_t)) == 1
    # the same browser signs in as Bob: the endpoint moves to him
    bob.post("/api/push/subscribe", json=sub_body(keys=keys))
    assert webpush.subscriptions(a_t) == []
    assert {s["endpoint"] for s in webpush.subscriptions(b_t)} \
        == {ENDPOINT, other}
    # ... and on to the admin (the default tenant)
    admin.post("/api/push/subscribe", json=sub_body(keys=keys))
    assert ENDPOINT not in {s["endpoint"] for s in webpush.subscriptions(b_t)}
    assert [s["endpoint"] for s in webpush.subscriptions(tenants.DEFAULT)] \
        == [ENDPOINT]


def test_presence_is_per_tenant(network):
    _enable_oidc()
    alice, bob = _client_as("alice@x.example"), _client_as("bob@y.example")
    alice.post("/api/push/subscribe", json=sub_body())
    alice.post("/api/push/presence", json={"endpoint": ENDPOINT,
                                           "visible": True})
    assert webpush._present(ENDPOINT, tenants.for_subject("alice@x.example"))
    assert not webpush._present(ENDPOINT, tenants.for_subject("bob@y.example"))
    bob.post("/api/push/presence", json={"endpoint": ENDPOINT,
                                         "visible": True})
    assert not webpush._present(ENDPOINT, tenants.for_subject("bob@y.example"))


def test_the_push_endpoints_need_a_session():
    cfgmod.update_config({"auth": {"mode": "password", "password": "pw"}})
    anon = TestClient(app)
    for path, body in (("/api/push/subscribe", sub_body()),
                       ("/api/push/unsubscribe", {"endpoint": ENDPOINT}),
                       ("/api/push/test", {"endpoint": ENDPOINT}),
                       ("/api/push/presence", {"endpoint": ENDPOINT,
                                               "visible": True})):
        assert anon.post(path, json=body).status_code == 401
    assert anon.get("/api/push/key").status_code == 401


# -------------------------------------------------------------------- texts

def test_texts_in_both_languages_and_the_account_prefix():
    en = webpush._payload("en", "scan", True, "work", False)
    assert en == {"title": "Inboxrake", "body": "Scan finished.",
                  "tag": "work:scan", "url": "/"}
    assert webpush._payload("de", "scan", True, "work", False)["body"] \
        == "Scan fertig."
    assert webpush._payload("en", "delete", True, "a", True, 1)["body"] \
        == "a: Done: 1 mail processed."
    assert webpush._payload("en", "delete", True, "a", False, 5)["body"] \
        == "Done: 5 mails processed."
    assert webpush._payload("de", "delete", True, "a", False, 1)["body"] \
        == "Fertig: 1 Mail verarbeitet."
    assert webpush._payload("de", "delete", True, "a", False, 5)["body"] \
        == "Fertig: 5 Mails verarbeitet."
    for kind, en_job, de_job in (
            ("scan", "Scan", "Scan"), ("delete", "Clean-up", "Aufräumen"),
            ("ai", "AI review", "KI-Prüfung"),
            ("atts", "Attachment analysis", "Anhang-Analyse"),
            ("unsub", "Bulk unsubscribe", "Massenabbestellen")):
        assert webpush._payload("en", kind, False, "a", False)["body"] \
            == f"{en_job} stopped with an error."
        assert webpush._payload("de", kind, False, "a", False)["body"] \
            == f"{de_job} mit Fehler abgebrochen."
    assert webpush._payload("en", "ai", True, "a", False)["body"] \
        == "AI review finished."
    assert webpush._payload("de", "unsub", True, "a", False)["body"] \
        == "Massenabbestellen abgeschlossen."


def _decrypt(body: bytes, key) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    ua_pub = key[1].public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint)
    salt, as_public, cipher = body[:16], body[21:86], body[86:]
    secret = key[1].exchange(ec.ECDH(), ec.EllipticCurvePublicKey
                             .from_encoded_point(ec.SECP256R1(), as_public))
    ikm = HKDF(hashes.SHA256(), 32, unb64u(key[0]["auth"]),
               b"WebPush: info\0" + ua_pub + as_public).derive(secret)
    cek = HKDF(hashes.SHA256(), 16, salt,
               b"Content-Encoding: aes128gcm\0").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt,
                 b"Content-Encoding: nonce\0").derive(ikm)
    return json.loads(AESGCM(cek).decrypt(nonce, cipher, None)[:-1])


def _wait(cond, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.01)
    return cond()


# -------------------------------------------------------------------- hooks

@pytest.fixture
def pushes(monkeypatch):
    """The job hook's calls (kind, ok, params) - what each runner reports."""
    calls = []
    monkeypatch.setattr(webpush, "job_finished",
                        lambda acc, kind, ok, **p: calls.append((kind, ok, p)))
    return calls


def test_scan_now_pushes_when_it_is_done(bridge, pushes):
    assert client.post("/api/scan").status_code == 200
    wait_scan_done()
    assert _wait(lambda: pushes)
    assert pushes == [("scan", True, {})]


def test_scan_now_pushes_an_error(bridge, pushes, monkeypatch):
    def boom(*a, **k):
        raise OSError("down")
    monkeypatch.setattr(mailops, "connect", boom)
    client.post("/api/scan")
    wait_scan_done()
    assert _wait(lambda: pushes)
    assert pushes == [("scan", False, {})]


def test_a_cancelled_scan_does_not_push(bridge, pushes, monkeypatch):
    def cancel(*a, **k):
        raise mailops.Cancelled()
    monkeypatch.setattr(mailops, "scan_folder", cancel)
    client.post("/api/scan")
    wait_scan_done()
    time.sleep(0.1)
    assert pushes == []


def test_autoscan_and_other_scans_do_not_push(bridge, pushes):
    mailops.start_scan(accountsmod.get("default"))   # autoscan, rules, restore
    wait_scan_done()
    mailops.run_scan()
    time.sleep(0.1)
    assert pushes == []


def _delete(acc, actor, action="trash"):
    with acc.lock:
        mailops._start_delete({"INBOX": {1, 2}}, "lbl", acc, action,
                              actor=actor)


def test_a_clean_up_you_started_pushes_the_count(bridge, pushes):
    mailops.run_scan()
    acc = accountsmod.get("default")
    _delete(acc, "user")
    assert _wait(lambda: pushes)
    assert pushes == [("delete", True, {"n": 2})]


def test_mark_read_pushes_too(bridge, pushes):
    mailops.run_scan()
    _delete(accountsmod.get("default"), "user", "mark_read")
    assert _wait(lambda: pushes)
    assert pushes[0][0] == "delete" and pushes[0][1] is True


def test_a_clean_up_by_a_rule_does_not_push(bridge, pushes):
    mailops.run_scan()
    acc = accountsmod.get("default")
    _delete(acc, "rule:abc123")
    assert _wait(lambda: acc.state["delete"]["status"] == "done")
    time.sleep(0.1)
    assert pushes == []


def test_a_cancelled_clean_up_does_not_push(bridge, pushes, monkeypatch):
    mailops.run_scan()
    acc = accountsmod.get("default")

    def cancel(*a, **k):
        raise mailops.Cancelled()
    monkeypatch.setattr(mailops, "_move_uids", cancel)
    _delete(acc, "user")
    assert _wait(lambda: acc.state["delete"]["status"] == "done")
    time.sleep(0.1)
    assert pushes == []


def test_a_failed_clean_up_pushes_an_error(bridge, pushes, monkeypatch):
    mailops.run_scan()
    acc = accountsmod.get("default")

    def boom(*a, **k):
        raise OSError("down")
    monkeypatch.setattr(mailops, "_move_uids", boom)
    _delete(acc, "user")
    assert _wait(lambda: pushes)
    assert pushes[0][:2] == ("delete", False)


def test_attachment_analysis_pushes(bridge, pushes, monkeypatch):
    mailops.run_scan()
    acc = accountsmod.get("default")
    mailops._run_atts(acc)
    assert pushes == [("atts", True, {})]
    pushes.clear()
    monkeypatch.setattr(mailops, "connect",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("x")))
    mailops._run_atts(acc)
    assert pushes == [("atts", False, {})]
    pushes.clear()
    monkeypatch.setattr(mailops, "connect", lambda *a, **k: bridge)
    acc.cancel["atts"] = True
    mailops._run_atts(acc)
    assert pushes == []


def test_bulk_unsubscribe_pushes_unless_cancelled(bridge, pushes, monkeypatch):
    mailops.run_scan()
    acc = accountsmod.get("default")
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    items = [("news@shop.example", "<https://shop.example/u/1>", True)]
    with acc.lock:
        acc.state["unsub"]["status"] = "running"
    unsub._run_bulk(acc, items)
    assert pushes == [("unsub", True, {})]
    pushes.clear()
    acc.cancel["unsub"] = True
    unsub._run_bulk(acc, items)
    assert pushes == []


def test_ai_review_pushes_unless_cancelled(bridge, pushes, monkeypatch):
    mailops.run_scan()
    acc = accountsmod.get("default")
    monkeypatch.setattr(aihelper, "_ai_call",
                        lambda *a, **k: ({"verdicts": []}, 0, 0))
    aihelper._run_ai("sender", acc)
    assert pushes == [("ai", True, {})]
    pushes.clear()
    monkeypatch.setattr(aihelper, "_ai_call",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("x")))
    aihelper._run_ai("sender", acc)
    assert pushes == [("ai", False, {})]
    pushes.clear()
    acc.cancel["ai"] = True
    aihelper._run_ai("sender", acc)
    assert pushes == []


# ---------------------------------------------------------------- delivery

def test_a_finished_job_is_delivered_encrypted_to_each_device(bridge, network):
    k1, k2 = device(), device()
    webpush.subscribe(ENDPOINT, k1[0]["p256dh"], k1[0]["auth"], "de")
    webpush.subscribe("https://fcm.googleapis.com/fcm/send/2",
                      k2[0]["p256dh"], k2[0]["auth"], "en")
    client.post("/api/scan")
    wait_scan_done()
    assert _wait(lambda: len(network.sent) == 2)
    by_end = {e: b for e, _, b in network.sent}
    assert _decrypt(by_end[ENDPOINT], k1) == {
        "title": "Inboxrake", "body": "Scan fertig.", "tag": "default:scan",
        "url": "/"}
    assert _decrypt(by_end["https://fcm.googleapis.com/fcm/send/2"], k2)[
        "body"] == "Scan finished."


def test_the_account_name_prefixes_when_there_are_several(bridge, network):
    keys, key = device()
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"])
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "h1", "user": "u1", "password": "pw"},
        "two": {"host": "h2", "user": "u2", "password": "pw"}}}))
    webpush.job_finished(accountsmod.get("one"), "ai", True)
    assert _wait(lambda: network.sent)
    assert _decrypt(network.sent[0][2], (keys, key))["body"] \
        == "one: AI review finished."


def test_a_visible_device_is_skipped(bridge, network):
    keys = device()[0]
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"])
    webpush.set_presence(ENDPOINT, True)
    webpush.job_finished(accountsmod.get("default"), "scan", True)
    time.sleep(0.2)
    assert network.sent == []
    webpush.set_presence(ENDPOINT, False)
    webpush.job_finished(accountsmod.get("default"), "scan", True)
    assert _wait(lambda: network.sent)


def test_only_the_jobs_own_tenant_hears_about_it(bridge, network):
    _enable_oidc()
    alice = tenants.for_subject("alice@x.example")
    keys = device()[0]
    with tenants.use(alice):
        webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"])
    webpush.job_finished(accountsmod.get("default"), "scan", True)  # admin
    time.sleep(0.2)
    assert network.sent == []


def test_no_subscriptions_means_no_thread_and_a_network_error_is_swallowed(
        bridge, monkeypatch):
    monkeypatch.setattr(webpush, "threading", types.SimpleNamespace(
        Thread=lambda **k: pytest.fail("a thread for nobody")))
    webpush.job_finished(accountsmod.get("default"), "scan", True)
    monkeypatch.setattr(webpush, "threading", threading)
    keys = device()[0]
    webpush.subscribe(ENDPOINT, keys["p256dh"], keys["auth"])
    monkeypatch.setattr(webpush, "_post", lambda *a: (_ for _ in ()
                        ).throw(OSError("boom")))
    webpush._deliver(accountsmod.get("default"), "scan", True, {})  # no raise
    webpush.job_finished(object(), "scan", True)        # garbage: no raise


# --------------------------------------------------------------------- demo

@pytest.fixture
def demo_mode(monkeypatch):
    monkeypatch.setenv(demo.ENV_VAR, "1")


def test_the_demo_refuses_every_push_endpoint_and_makes_nothing(
        tmp_path, demo_mode, monkeypatch):
    monkeypatch.setattr(webpush, "_post",
                        lambda *a: pytest.fail("dialled out"))
    for method, path, body in (
            ("get", "/api/push/key", None),
            ("post", "/api/push/subscribe", sub_body()),
            ("post", "/api/push/unsubscribe", {"endpoint": ENDPOINT}),
            ("post", "/api/push/test", {"endpoint": ENDPOINT}),
            ("post", "/api/push/presence", {"endpoint": ENDPOINT,
                                            "visible": True})):
        r = getattr(client, method)(path, **({"json": body} if body else {}))
        assert r.status_code == 500 and r.json()["detail"] == "not_in_demo"
    assert not (tmp_path / "vapid.pem").exists()
    assert not (tmp_path / "subs.json").exists()


def test_the_demo_hook_returns_before_anything_happens(demo_mode, monkeypatch):
    monkeypatch.setattr(webpush, "subscriptions",
                        lambda *a: pytest.fail("read"))
    webpush.job_finished(object(), "scan", True)


def test_the_module_imports_no_cryptography_hazmat_at_the_top():
    """The demo's stand-in has only fernet: hazmat stays inside functions."""
    import ast
    from pathlib import Path
    tree = ast.parse(Path(webpush.__file__).read_text())
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            assert not (node.module or "").startswith("cryptography")
        elif isinstance(node, ast.Import):
            assert not any(a.name.startswith("cryptography")
                           for a in node.names)


# ------------------------------------------------------------------ sw.js

def test_the_service_worker_is_never_cached(tmp_path, monkeypatch):
    from backend import main
    (tmp_path / "sw.js").write_text("// sw")
    (tmp_path / "index.html").write_text("<html></html>")
    (tmp_path / "other.txt").write_text("x")
    monkeypatch.setattr(main, "_STATIC_ROOT", tmp_path.resolve())
    spa = [r for r in main.app.routes
           if getattr(r, "path", "") == "/{path:path}"]
    if not spa:
        pytest.skip("no static bundle mounted in this environment")
    r = client.get("/sw.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"
    assert "cache-control" not in client.get("/other.txt").headers
