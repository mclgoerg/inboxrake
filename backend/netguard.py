"""SSRF guard for outbound requests to addresses we do not control: the
unsubscribe link of a mail (backend/unsub.py), a push service endpoint
(backend/webpush.py) and a client's metadata document (backend/oauthclients.py).

The host is resolved ONCE, every address must be public, and the connection
goes to that validated IP (TLS - SNI and certificate check - still against the
original host name). Callers never follow redirects.

Moved out of unsub.py unchanged. Stdlib only (the browser demo bundles every
backend module)."""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl

from . import demo
from . import mailops


def public_ip(raw: str):
    """The address as ipaddress object if it is a public unicast address,
    else None. IPv4-mapped IPv6 is judged by the IPv4 address inside; the
    list is explicit because `is_global` alone lets multicast through."""
    ip = ipaddress.ip_address(raw.split("%", 1)[0])
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if (ip.is_loopback or ip.is_private or ip.is_link_local
            or (ip.version == 6 and ip.is_site_local)
            or ip.is_multicast or ip.is_reserved or ip.is_unspecified
            or not ip.is_global):
        return None
    return ip


def resolve_public(host: str, port: int) -> list[str]:
    """Resolve ONCE and return the addresses to connect to; every one of
    them must be public, so no answer of a mixed record can win."""
    if not host:
        raise RuntimeError(mailops.coded(mailops.UNSUB_BAD_URL))
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        if demo.denied(exc):
            raise demo.refusal() from exc
        raise RuntimeError(mailops.coded(mailops.UNSUB_UNREACHABLE))
    addrs: list[str] = []
    for info in infos:
        raw = info[4][0]
        if public_ip(raw) is None:
            raise RuntimeError(mailops.coded(mailops.UNSUB_BLOCKED))
        if raw not in addrs:
            addrs.append(raw)
    if not addrs:
        raise RuntimeError(mailops.coded(mailops.UNSUB_UNREACHABLE))
    return addrs


def ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()     # verifies chain + host name


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS to an address we already validated: no second DNS lookup, TLS
    (SNI + certificate check) still against the original host name."""

    def __init__(self, host: str, port: int, ip: str, timeout: float):
        super().__init__(host, port, timeout=timeout, context=ssl_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
