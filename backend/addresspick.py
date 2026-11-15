"""Which of the user's addresses a mail was sent to (the scan side of "Your
addresses", backend/addresses.py).

The scan reads four header fields besides the sender's: `Delivered-To`,
`X-Original-To`, `To` and `Cc`. `receiving_address` boils them down to the
ONE address the mail arrived on; `address_kind` says what sort of address it
is. Both are pure - no I/O, no mailbox data - so the scan can call them for
every new mail without slowing down.

Only the picked address is kept (per mail, in the scan index), never the
other recipients.
"""

from __future__ import annotations

import re
import sys
from email.utils import getaddresses
from typing import NamedTuple

from . import smartkinds

# The header fields the scan fetches on top of the sender's (see
# mailops._fetch_full_chunk / _backfill_chunk).
HEADER_FIELDS = "TO CC DELIVERED-TO X-ORIGINAL-TO"

# Public alias-service domains: aliases on these domains belong to the
# service, so an address on one is an alias without asking the service.
# Generic infrastructure of the two services Inboxrake integrates with
# (backend/aliasservice.py); an alias on a custom domain is recognised from
# the service's own alias list instead.
ALIAS_DOMAINS = frozenset({
    # SimpleLogin's shared alias domains
    "simplelogin.com", "simplelogin.co", "simplelogin.fr", "aleeas.com",
    "slmail.me", "8alias.com", "dralias.com",
    # addy.io's shared alias domains
    "anonaddy.com", "anonaddy.me", "addy.io", "mailer.me",
})
# Firefox Relay's alias domain (detection only: no API is used)
RELAY_DOMAINS = frozenset({"mozmail.com"})
ALIAS_DOMAINS = ALIAS_DOMAINS | RELAY_DOMAINS
# On an iCloud account every other iCloud address is a "Hide My Email" alias.
ICLOUD_DOMAINS = frozenset({"icloud.com", "me.com", "mac.com"})

MAIN, TAG, ALIAS, CATCHALL, OTHER = "main", "tag", "alias", "catchall", "other"
KINDS = (MAIN, TAG, ALIAS, CATCHALL, OTHER)


class Context(NamedTuple):
    """What the picker needs to know about one account, fixed for a scan."""
    main: str                         # the account's login / address
    aliases: frozenset[str]           # the connected service's alias list


def no_context() -> Context:
    return Context("", frozenset())


def _split(addr: str) -> tuple[str, str]:
    local, _, domain = addr.rpartition("@")
    return local, domain


_ANGLE = re.compile(r"<\s*([^<>\s,;]+@[^<>\s,;]+)\s*>")
_BARE = re.compile(r"[^\s<>,;\"()]+@[^\s<>,;\"()]+")


def _addresses(values: list) -> list[str]:
    """The addresses in header values, lower-cased, in order, without
    duplicates; anything without an `@` is dropped. The plain shapes
    (`name <a@b>`, `a@b`, lists of them) are read with two regular
    expressions - this runs for every new mail of a scan; quoted names and
    comments go through the full RFC 5322 parser."""
    out: list[str] = []
    for value in values:
        value = str(value)
        found = None
        if '"' not in value and "(" not in value:
            found = _ANGLE.findall(value) or _BARE.findall(value)
            if len(found) != value.count("@"):
                found = None          # a mix of shapes: let the parser decide
        if found is None:
            found = [a for _, a in getaddresses([value])]
        for addr in found:
            addr = addr.strip().lower()
            if "@" in addr and addr not in out:
                out.append(addr)
    return out


def address_kind(addr: str, ctx: Context) -> str:
    """What sort of address `addr` is for the account `ctx` describes."""
    if not addr or addr == ctx.main:
        return MAIN if addr else OTHER
    local, domain = _split(addr)
    mlocal, mdomain = _split(ctx.main)
    if mdomain and domain == mdomain and mlocal \
            and local.startswith(mlocal + "+"):
        return TAG
    if addr in ctx.aliases:
        return ALIAS
    if domain in ALIAS_DOMAINS or any(
            domain.endswith("." + d) for d in ALIAS_DOMAINS):
        return ALIAS
    if mdomain in ICLOUD_DOMAINS and domain in ICLOUD_DOMAINS:
        return ALIAS                 # another @icloud.com address: Hide My Email
    if mdomain and not smartkinds.is_freemail(mdomain) \
            and smartkinds.registrable_domain(domain) \
            == smartkinds.registrable_domain(mdomain):
        return CATCHALL
    return OTHER


def alias_origin(addr: str, ctx: Context) -> str:
    """Where an alias is managed: "relay" (Firefox Relay), "icloud" (Hide My
    Email) or "service" (an alias service Inboxrake can talk to)."""
    domain = _split(addr)[1]
    if domain in RELAY_DOMAINS or domain.endswith(
            tuple("." + d for d in RELAY_DOMAINS)):
        return "relay"
    if _split(ctx.main)[1] in ICLOUD_DOMAINS and domain in ICLOUD_DOMAINS:
        return "icloud"
    return "service"


def tag_of(addr: str, ctx: Context) -> str:
    """The `+tag` of a plus address ("" for any other)."""
    if address_kind(addr, ctx) != TAG:
        return ""
    return _split(addr)[0][len(_split(ctx.main)[0]) + 1:]


def receiving_address(msg, ctx: Context) -> str:
    """The address `msg` arrived on ("" when it names none or cannot be read:
    a header this odd must never cost a mail its place in the scan); the rules
    are in `_pick`."""
    try:
        return _pick(msg, ctx)
    except Exception:
        return ""


def _pick(msg, ctx: Context) -> str:
    """The address of the user that `msg` (an email.message.Message holding
    at least the four header fields) arrived on, interned; "" when it names
    none.

    1. The delivery headers (`X-Original-To`, then `Delivered-To`) name the
       address the receiving server delivered to: the first one that is not
       the account's main address wins - that is a `+tag`, a catch-all
       address, a forwarding address (one that is also in `To` / `Cc` or looks
       like yours is preferred over a relay's own address).
    2. They only name the main address (an alias service delivers to the real
       mailbox, a catch-all domain to its owner), so the original recipient
       is in `To` / `Cc`: the first address there that is a `+tag` or an
       alias, or the only recipient when it is a catch-all address; else the
       main address when it is there.
    3. No delivery header at all: a `To` / `Cc` address that matches the
       account, else the first `To` address."""
    raw = msg.get_all("X-Original-To", []) + msg.get_all("Delivered-To", [])
    # qmail / ezmlm write "Delivered-To: mailing list x@y": a list, not you
    delivered = _addresses([v for v in raw if not str(v).lstrip().lower()
                            .startswith("mailing list")])
    recipients = _addresses(msg.get_all("To", []) + msg.get_all("Cc", []))
    others = [c for c in delivered if c != ctx.main]
    # prefer a delivery address that is also a recipient or that looks like
    # one of yours (a tag, an alias, your domain) over a relay's own address
    for cand in others:
        if cand in recipients or address_kind(cand, ctx) != OTHER:
            return sys.intern(cand)
    if others:
        return sys.intern(others[0])
    for cand in recipients:
        if address_kind(cand, ctx) in (TAG, ALIAS):
            return sys.intern(cand)
    if len(recipients) == 1 and address_kind(recipients[0], ctx) == CATCHALL:
        return sys.intern(recipients[0])
    if raw or ctx.main in recipients:         # a delivery header => main is set
        return sys.intern(ctx.main)
    return sys.intern(recipients[0]) if recipients else ""
