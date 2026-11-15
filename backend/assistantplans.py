"""Action plans of AI assistants (the Act level of the MCP endpoint).

`preview_action` freezes a selection of exact mails into a plan; `apply_action`
runs it once. The plan is what the assistant (and the user watching it) saw:
the exact `[folder, uid]` pairs and each folder's UIDVALIDITY, bound to one
token, one tenant, one account and one action. In memory only - a restart drops
every open plan, which is the safe direction.

A plan is single use (taking it removes it, even if the apply is then refused),
expires after PLAN_TTL seconds, and each token may hold only a few open plans.
The id is 128 random bits. A plan asked for by another token, tenant or account
looks exactly like an unknown one.

Pure Python, stdlib only (the browser demo bundles every backend module)."""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field

PLAN_TTL = 600                  # seconds
MAX_PLANS_PER_TOKEN = 10        # open (unused, unexpired) plans of one token

UNKNOWN = ("Unknown plan: it never existed, was already applied, belongs to "
           "another token or account, or was dropped. Call preview_action "
           "again.")
EXPIRED = ("This plan expired (plans live 10 minutes). Call preview_action "
           "again.")


class PlanError(Exception):
    """A plan that cannot be used; the text says why."""


@dataclass
class Plan:
    id: str
    token: str                  # token id
    tenant: str
    account: str
    action: str
    dest: str                   # raw folder name ("" unless action == move)
    items: list[tuple[str, int]]    # exact (raw folder, uid) pairs
    uv: dict[str, int]          # raw folder -> UIDVALIDITY at preview
    created: float = field(default_factory=time.monotonic)


_plans: dict[str, Plan] = {}
_lock = threading.Lock()


def _expired(p: Plan, now: float) -> bool:
    return now - p.created >= PLAN_TTL


def create(token: str, tenant: str, account: str, action: str, dest: str,
           items: list[tuple[str, int]], uv: dict[str, int]) -> Plan:
    """Store a new plan; a token's oldest open plan makes room for the newest."""
    plan = Plan(secrets.token_hex(16), token, tenant, account, action, dest,
                list(items), dict(uv))
    now = time.monotonic()
    with _lock:
        for pid in [k for k, p in _plans.items() if _expired(p, now)]:
            del _plans[pid]
        mine = sorted((p for p in _plans.values() if p.token == token),
                      key=lambda p: p.created)
        for old in mine[:max(0, len(mine) - MAX_PLANS_PER_TOKEN + 1)]:
            del _plans[old.id]
        _plans[plan.id] = plan
    return plan


def take(plan_id: str, token: str, tenant: str, account: str | None = None
         ) -> Plan:
    """The plan, removed from the store: it can be applied only once. Anything
    that does not match - the id, the token, the tenant, the account - is
    refused as unknown AND leaves the plan where it is (another token cannot
    burn it). Raises PlanError."""
    now = time.monotonic()
    with _lock:
        p = _plans.get(plan_id) if isinstance(plan_id, str) else None
        if p is None or p.token != token or p.tenant != tenant \
                or (account is not None and p.account != account):
            raise PlanError(UNKNOWN)
        del _plans[p.id]
        if _expired(p, now):
            raise PlanError(EXPIRED)
        return p


def drop_token(token: str) -> None:
    """Forget a revoked token's plans."""
    with _lock:
        for pid in [k for k, p in _plans.items() if p.token == token]:
            del _plans[pid]


def clear() -> None:
    """Forget every plan (tests)."""
    with _lock:
        _plans.clear()
