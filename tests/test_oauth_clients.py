"""The CIMD side of the OAuth server (backend/oauthclients.py): which client_id
URLs are accepted, how the metadata document is fetched through the SSRF guard
(netguard), which documents are valid, and how results are cached.

Invented `.example` data only; nothing touches the network (the connection
class and the DNS answer are replaced)."""

import json
import socket

import pytest

from backend import netguard, oauthclients
from backend.oauthclients import ClientError

URL = "https://client.example/meta.json"
PUBLIC = "93.184.216.34"


def doc(**over):
    d = {"client_id": URL, "client_name": "Example Assistant",
         "redirect_uris": ["https://client.example/cb"],
         "token_endpoint_auth_method": "none"}
    d.update(over)
    return d


@pytest.fixture(autouse=True)
def clean():
    oauthclients.reset()
    yield
    oauthclients.reset()


class Clock:
    now = 1_000_000.0


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    c.now = 1_000_000.0
    monkeypatch.setattr(oauthclients, "_now", lambda: c.now)
    return c


class Net:
    """A fake network: what each fetch answers, and what was asked."""

    def __init__(self):
        self.answers = []          # (status, headers, body) or an Exception
        self.calls = []

    def reply(self, d=None, status=200, ctype="application/json", **hdr):
        body = d if isinstance(d, (bytes, bytearray)) else json.dumps(
            d if d is not None else doc()).encode()
        self.answers.append((status, {"content-type": ctype, **hdr}, body))

    def fail(self, exc):
        self.answers.append(exc)


@pytest.fixture
def net(monkeypatch):
    n = Net()

    def fetch(client_id):
        n.calls.append(client_id)
        a = n.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a
    monkeypatch.setattr(oauthclients, "_fetch", fetch)
    return n


# ---------------------------------------------------------- client_id rules

@pytest.mark.parametrize("url", [
    "https://client.example/meta.json",
    "https://client.example:443/meta.json",
    "https://sub.client.example/a/b/c",
    "https://xn--bcher-kva.example/m",           # punycode
])
def test_good_client_id_urls(url):
    oauthclients.parse_client_id(url)


@pytest.mark.parametrize("url", [
    "", None, 5,
    "http://client.example/meta.json",            # https only
    "https://client.example:8443/meta.json",       # port 443 only
    "https://client.example/",                    # path must not be "/"
    "https://client.example",
    "https://client.example/meta.json?x=1",        # no query (our policy)
    "https://client.example/meta.json?",
    "https://client.example/meta.json#frag",       # no fragment
    "https://user@client.example/meta.json",       # no userinfo
    "https://user:pw@client.example/meta.json",
    "https://client.example/a/../meta.json",       # no dot segments
    "https://client.example/a/./meta.json",
    "https://client.example/%2e%2e/meta.json",
    "https://client.example/a/%2E/m",
    "https://127.0.0.1/meta.json",                 # no IP literals
    "https://[::1]/meta.json",
    "https://localhost/meta.json",                 # needs a dot
    "https://bücher.example/meta.json",            # ASCII hosts only
    "https://client.example/meta json",
    "https://client.example/" + "a" * 520,         # at most 512 chars
    "ftp://client.example/m",
    "https://",
    "https://client.example:abc/m",
])
def test_bad_client_id_urls(url):
    with pytest.raises(ClientError, match=oauthclients.BAD_CLIENT_URL):
        oauthclients.parse_client_id(url)


def test_a_bad_url_never_reaches_the_network(net):
    with pytest.raises(ClientError):
        oauthclients.get("http://client.example/m")
    assert net.calls == []


# ------------------------------------------------------- the fetch (netguard)

class FakeResp:
    def __init__(self, status, headers, body):
        self.status, self._h, self._b = status, headers, body

    def getheaders(self):
        return list(self._h.items())

    def read(self, n=-1):
        out, self._b = self._b[:n], self._b[n:]
        return out


class WireNet:
    """Replaces the pinned connection: records what would be sent where."""

    def __init__(self):
        self.conns = []
        self.status, self.headers = 200, {"Content-Type": "application/json"}
        self.body = json.dumps(doc()).encode()
        self.error = None


@pytest.fixture
def wire(monkeypatch):
    w = WireNet()

    class Conn:
        sock = None

        def __init__(self, host, port, ip, timeout):
            self.host, self.port, self.ip, self.timeout = host, port, ip, timeout
            w.conns.append(self)

        def request(self, method, path, headers=None, body=None):
            self.sent = (method, path, headers, body)
            if w.error:
                raise w.error

        def getresponse(self):
            return FakeResp(w.status, w.headers, w.body)

        def close(self):
            pass
    monkeypatch.setattr(netguard, "PinnedHTTPSConnection", Conn)
    return w


def dns(monkeypatch, *ips):
    monkeypatch.setattr(netguard.socket, "getaddrinfo", lambda host, port=443, *a, **k: [
        (socket.AF_INET6 if ":" in ip else socket.AF_INET,
         socket.SOCK_STREAM, 6, "", (ip, port)) for ip in ips])


def test_fetch_is_pinned_to_the_validated_ip_and_sends_a_plain_get(
        monkeypatch, wire):
    dns(monkeypatch, PUBLIC)
    client = oauthclients.get(URL)
    assert client["host"] == "client.example"
    assert client["name"] == "Example Assistant"
    assert client["redirect_uris"] == ["https://client.example/cb"]
    (conn,) = wire.conns
    assert (conn.host, conn.port, conn.ip) == ("client.example", 443, PUBLIC)
    method, path, headers, body = conn.sent
    assert (method, path, body) == ("GET", "/meta.json", None)
    assert headers["Accept"] == "application/json"
    assert conn.timeout <= oauthclients.CONNECT_TIMEOUT


@pytest.mark.parametrize("ips", [
    ["127.0.0.1"], ["::1"], ["10.1.2.3"], ["192.168.0.9"], ["172.16.5.5"],
    ["169.254.169.254"], ["0.0.0.0"], ["::ffff:127.0.0.1"], ["::ffff:10.0.0.1"],
    ["fe80::1"], ["fc00::1"], ["224.0.0.1"], ["100.64.0.1"],
    [PUBLIC, "10.0.0.5"],                       # one private answer poisons all
    ["10.0.0.5", PUBLIC],
])
def test_non_public_dns_answers_are_blocked(monkeypatch, wire, ips):
    dns(monkeypatch, *ips)
    with pytest.raises(ClientError, match=oauthclients.BLOCKED):
        oauthclients.get(URL)
    assert wire.conns == []                    # not even a connection


def test_blocked_is_not_served_from_a_stale_copy(monkeypatch, wire, clock):
    dns(monkeypatch, PUBLIC)
    oauthclients.get(URL)
    clock.now += oauthclients.TTL_DEFAULT + 100 + oauthclients.PER_URL_WAIT
    dns(monkeypatch, "127.0.0.1")
    with pytest.raises(ClientError, match=oauthclients.BLOCKED):
        oauthclients.get(URL)


@pytest.mark.parametrize("status", [301, 302, 307, 308, 204, 404, 500])
def test_only_a_200_counts_and_redirects_are_not_followed(
        monkeypatch, wire, status):
    dns(monkeypatch, PUBLIC)
    wire.status = status
    wire.headers = {"Content-Type": "application/json",
                    "Location": "https://other.example/x"}
    with pytest.raises(ClientError, match=oauthclients.BAD_RESPONSE):
        oauthclients.get(URL)
    assert len(wire.conns) == 1                # no second request


@pytest.mark.parametrize("ctype", ["text/html", "text/plain", "", "application/xml"])
def test_the_answer_must_be_json(monkeypatch, wire, ctype):
    dns(monkeypatch, PUBLIC)
    wire.headers = {"Content-Type": ctype}
    with pytest.raises(ClientError, match=oauthclients.BAD_RESPONSE):
        oauthclients.get(URL)


def test_json_with_a_charset_parameter_is_fine(monkeypatch, wire):
    dns(monkeypatch, PUBLIC)
    wire.headers = {"Content-Type": "application/json; charset=utf-8"}
    assert oauthclients.get(URL)["name"] == "Example Assistant"


def test_more_than_5_kib_is_refused(monkeypatch, wire):
    dns(monkeypatch, PUBLIC)
    padded = doc(client_name="x" * (oauthclients.DOC_MAX))
    wire.body = json.dumps(padded).encode()
    assert len(wire.body) > oauthclients.DOC_MAX
    with pytest.raises(ClientError, match=oauthclients.BAD_RESPONSE):
        oauthclients.get(URL)
    # exactly at the limit passes
    wire.body = json.dumps(doc()).ljust(oauthclients.DOC_MAX).encode()
    oauthclients.reset()
    assert oauthclients.get(URL)["host"] == "client.example"


def test_not_json_is_refused(monkeypatch, wire):
    dns(monkeypatch, PUBLIC)
    wire.body = b"<html>"
    with pytest.raises(ClientError, match=oauthclients.BAD_RESPONSE):
        oauthclients.get(URL)


def test_a_network_error_is_unreachable(monkeypatch, wire):
    dns(monkeypatch, PUBLIC)
    wire.error = OSError("refused")
    with pytest.raises(ClientError, match=oauthclients.UNREACHABLE):
        oauthclients.get(URL)


def test_the_next_validated_address_is_tried(monkeypatch, wire):
    dns(monkeypatch, PUBLIC, "93.184.216.35")
    first = {"n": 0}
    orig = netguard.PinnedHTTPSConnection

    class Flaky(orig):
        def request(self, *a, **k):
            first["n"] += 1
            if first["n"] == 1:
                raise OSError("down")
            return super().request(*a, **k)
    monkeypatch.setattr(netguard, "PinnedHTTPSConnection", Flaky)
    assert oauthclients.get(URL)["host"] == "client.example"
    assert [c.ip for c in wire.conns] == [PUBLIC, "93.184.216.35"]


# ------------------------------------------------------------- the document

@pytest.mark.parametrize("bad", [
    {"client_id": "https://client.example/other.json"},        # != the URL
    {"client_id": URL + "/"},
    {"redirect_uris": []},
    {"redirect_uris": "https://client.example/cb"},
    {"redirect_uris": [5]},
    {"redirect_uris": ["http://client.example/cb"]},           # https only
    {"redirect_uris": ["https://evil.example/cb"]},            # same host only
    {"redirect_uris": ["https://client.example/cb",
                       "https://evil.example/cb"]},
    {"redirect_uris": ["https://sub.client.example/cb"]},
    {"redirect_uris": ["https://client.example:8443/cb"]},
    {"redirect_uris": ["https://client.example@evil.example/cb"]},
    {"redirect_uris": ["https://evil.example\\@client.example/cb"]},
    {"redirect_uris": ["https://client.example/cb#frag"]},
    {"redirect_uris": ["http://127.0.0.1:9/cb"]},              # no loopback
    {"redirect_uris": ["com.example.app:/cb"]},
    {"client_secret": "s3cret"},
    {"client_secret_expires_at": 0},
    {"jwks": {"keys": []}},
    {"jwks_uri": "https://client.example/jwks"},
    {"token_endpoint_auth_method": "client_secret_basic"},
    {"token_endpoint_auth_method": "private_key_jwt"},
    {"token_endpoint_auth_methods_supported": ["private_key_jwt"]},
    {"token_endpoint_auth_methods_supported": "none"},
    {"grant_types": ["client_credentials"]},
    {"grant_types": "authorization_code"},
    {"response_types": ["token"]},
])
def test_invalid_documents_are_refused(net, bad):
    net.reply(doc(**bad))
    with pytest.raises(ClientError, match=oauthclients.BAD_DOCUMENT):
        oauthclients.get(URL)


def test_a_document_that_is_not_an_object_is_refused(net):
    net.reply(b'["https://client.example/meta.json"]')
    with pytest.raises(ClientError, match=oauthclients.BAD_DOCUMENT):
        oauthclients.get(URL)


@pytest.mark.parametrize("good", [
    {},
    {"token_endpoint_auth_method": "none"},
    {"token_endpoint_auth_methods_supported": ["none", "private_key_jwt"]},
    {"grant_types": ["authorization_code", "refresh_token"]},
    {"response_types": ["code"]},
    {"redirect_uris": ["https://client.example/cb", "https://CLIENT.example/c2"]},
])
def test_valid_documents_pass(net, good):
    d = doc(**good)
    if "token_endpoint_auth_methods_supported" in good:
        del d["token_endpoint_auth_method"]
    net.reply(d)
    assert oauthclients.get(URL)["client_id"] == URL


def test_no_auth_method_at_all_means_none(net):
    d = doc()
    del d["token_endpoint_auth_method"]
    net.reply(d)
    assert oauthclients.get(URL)["host"] == "client.example"


def test_the_name_is_cleaned_cut_and_defaults_to_the_host(net):
    net.reply(doc(client_name="Evil\x07 ‮\nName  " + "z" * 100))
    name = oauthclients.get(URL)["name"]
    assert len(name) <= oauthclients.NAME_MAX
    assert all(c.isprintable() for c in name) and "\n" not in name
    oauthclients.reset()
    net.reply(doc(client_name="  "))
    assert oauthclients.get(URL)["name"] == "client.example"
    oauthclients.reset()
    net.reply(doc(client_name=None))
    assert oauthclients.get(URL)["name"] == "client.example"


# ------------------------------------------------------------------- cache

def test_a_valid_document_is_cached_for_its_max_age_clamped(net, clock):
    net.reply(doc(), **{"cache-control": "public, max-age=60"})   # clamps to 5 min
    oauthclients.get(URL)
    clock.now += oauthclients.TTL_MIN - 1
    oauthclients.get(URL)
    assert len(net.calls) == 1
    clock.now += 2 + oauthclients.PER_URL_WAIT
    net.reply(doc(), **{"cache-control": "max-age=999999999"})    # clamps to 24 h
    oauthclients.get(URL)
    assert len(net.calls) == 2
    clock.now += oauthclients.TTL_MAX - 1
    oauthclients.get(URL)
    assert len(net.calls) == 2


def test_the_default_ttl_is_an_hour(net, clock):
    net.reply(doc())
    oauthclients.get(URL)
    clock.now += 3599
    oauthclients.get(URL)
    assert len(net.calls) == 1
    clock.now += 2
    net.reply(doc())
    oauthclients.get(URL)
    assert len(net.calls) == 2


def test_errors_and_invalid_documents_are_never_cached(net, clock):
    net.reply(doc(redirect_uris=[]))
    with pytest.raises(ClientError):
        oauthclients.get(URL)
    clock.now += oauthclients.PER_URL_WAIT + 1
    net.reply(doc())
    assert oauthclients.get(URL)["host"] == "client.example"   # fetched afresh
    assert len(net.calls) == 2


def test_a_stale_copy_stands_in_for_a_network_failure_for_7_days(net, clock):
    net.reply(doc())
    first = oauthclients.get(URL)
    clock.now += oauthclients.TTL_DEFAULT + oauthclients.PER_URL_WAIT + 1
    net.fail(OSError("down"))
    assert oauthclients.get(URL) == first                      # stale, served
    clock.now += oauthclients.PER_URL_WAIT + 1
    net.fail(TimeoutError("slow"))
    assert oauthclients.get(URL) == first
    clock.now += oauthclients.STALE_MAX
    net.fail(OSError("down"))
    with pytest.raises(ClientError, match=oauthclients.UNREACHABLE):
        oauthclients.get(URL)                                  # too old now


def test_a_stale_copy_is_not_served_for_an_invalid_new_document(net, clock):
    net.reply(doc())
    oauthclients.get(URL)
    clock.now += oauthclients.TTL_DEFAULT + oauthclients.PER_URL_WAIT + 1
    net.reply(doc(redirect_uris=["https://evil.example/cb"]))
    with pytest.raises(ClientError, match=oauthclients.BAD_DOCUMENT):
        oauthclients.get(URL)


def test_at_most_one_fetch_per_url_per_minute(net, clock):
    net.fail(OSError("down"))
    with pytest.raises(ClientError, match=oauthclients.UNREACHABLE):
        oauthclients.get(URL)
    clock.now += 30
    with pytest.raises(ClientError, match=oauthclients.RATE_LIMITED):
        oauthclients.get(URL)
    assert len(net.calls) == 1
    clock.now += 31
    net.reply(doc())
    assert oauthclients.get(URL)["host"] == "client.example"


def test_at_most_30_fetches_a_minute_overall(net, clock):
    for i in range(oauthclients.GLOBAL_PER_MINUTE):
        u = f"https://c{i}.example/m"
        net.reply(doc(client_id=u, redirect_uris=[f"https://c{i}.example/cb"]))
        oauthclients.get(u)
    with pytest.raises(ClientError, match=oauthclients.RATE_LIMITED):
        oauthclients.get("https://one-too-many.example/m")
    assert len(net.calls) == oauthclients.GLOBAL_PER_MINUTE
    clock.now += 61
    net.reply(doc(client_id="https://one-too-many.example/m",
                  redirect_uris=["https://one-too-many.example/cb"]))
    oauthclients.get("https://one-too-many.example/m")


def test_the_cache_holds_at_most_200_urls(net, clock):
    for i in range(oauthclients.CACHE_MAX + 5):
        clock.now += 3                       # keeps the global rate limit away
        u = f"https://c{i}.example/m"
        net.reply(doc(client_id=u, redirect_uris=[f"https://c{i}.example/cb"]))
        oauthclients.get(u)
    assert len(oauthclients._cache) == oauthclients.CACHE_MAX
    assert "https://c0.example/m" not in oauthclients._cache   # the oldest went


def test_seed_validates_like_a_fetch():
    oauthclients.seed(URL, doc())
    assert oauthclients.get(URL)["host"] == "client.example"   # no fetch needed
    with pytest.raises(ClientError):
        oauthclients.seed(URL, doc(redirect_uris=["https://evil.example/cb"]))


def test_logo_uri_and_other_fields_are_never_fetched_or_kept(net):
    net.reply(doc(logo_uri="https://client.example/logo.png",
                  client_uri="https://client.example/",
                  policy_uri="https://client.example/p"))
    client = oauthclients.get(URL)
    assert set(client) == {"client_id", "host", "name", "redirect_uris"}
    assert net.calls == [URL]                  # nothing else was requested


# ----------------------------------------- the wall-clock limit of a fetch

class _Drip:
    """A local server (127.0.0.1) that answers one request at 1 byte a second
    and stops when the client hangs up."""

    def __init__(self, where):
        import threading
        self.where = where
        self.srv = socket.socket()
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(4)
        self.port = self.srv.getsockname()[1]
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        import time
        c, _ = self.srv.accept()
        c.recv(4096)
        head = (b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                b"Content-Length: 4000\r\n\r\n")
        data = head + b"x" * 4000
        try:
            if self.where == "body":
                c.sendall(head)
                data = data[len(head):]
            for i in range(len(data)):
                time.sleep(1)
                c.send(data[i:i + 1])
        except OSError:
            pass
        finally:
            c.close()


@pytest.mark.parametrize("where", ["headers", "body"])
def test_a_slow_drip_host_is_cut_at_the_total_deadline(monkeypatch, where):
    import http.client
    import threading
    import time
    drip = _Drip(where)
    monkeypatch.setattr(netguard, "resolve_public", lambda h, p: ["127.0.0.1"])

    class Plain(http.client.HTTPConnection):
        def __init__(self, host, port, ip, timeout):
            super().__init__(ip, drip.port, timeout=timeout)
    monkeypatch.setattr(netguard, "PinnedHTTPSConnection", Plain)
    before = threading.active_count()
    t0 = time.monotonic()
    with pytest.raises(TimeoutError):
        oauthclients._fetch(URL)
    took = time.monotonic() - t0
    assert took < oauthclients.TOTAL_TIMEOUT + 0.5
    time.sleep(0.2)
    assert threading.active_count() <= before      # the timer is gone too
