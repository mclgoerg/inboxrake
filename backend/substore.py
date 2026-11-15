"""What the user decided about subscriptions (backend/subscriptions.py).

Per tenant, per account: the subscriptions they marked "not a subscription",
the reminders they asked for (and which expected date was already announced),
the reminders that fired lately (the open page shows them once), the amounts
read from a receipt's text (opt-in) and that opt-in switch itself. Mirrors
pinstore.py's persistence (per-tenant file, atomic write, tolerant read), and
like it stays STRICTLY per account.

A subscription is named by its KEY: the sender's registrable company domain
(or the full address on a shared platform), never a subject.

What is stored from a receipt's text is ONLY the amount and its currency,
plus the timestamp of the receipt it came from (so the same receipt is not
read twice) - no text, no subject, no address.

File shape: {"accounts": {name: {"hidden": [key], "kept": {key: [message-id]}, "reminders": {key:
{"sent": "YYYY-MM-DD"}}, "fired": [{...}], "amounts": {key: {"amount":
float|null, "currency": str, "ts": int}}, "body_amounts": bool}}}. A damaged
file only forgets what it cannot understand.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

from . import accounts
from . import tenants

SUBS_PATH = Path(os.environ.get("SUBS_PATH", "/data/subscriptions.json"))

MAX_KEYS = 500          # per list and account
MAX_FIRED = 20          # fired reminders kept for the page to show
MAX_KEPT_IDS = 2000     # pins remembered per subscription
KEY_MAX = 200
CURRENCY_RE = re.compile(r"[A-Z]{3}")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

_LOCK = threading.Lock()

# Per-tenant cache (keyed by tenant id), like pinstore: never reads the file
# per request and never mixes tenants.
_cache: dict[str, dict[str, dict]] = {}


def valid_key(key) -> bool:
    return (isinstance(key, str) and 0 < len(key) <= KEY_MAX
            and not any(ord(c) < 32 for c in key))


def _path() -> Path:
    return tenants.current().file("subscriptions.json", SUBS_PATH)


def _clean(raw) -> dict:
    """One account's block from whatever the file holds."""
    raw = raw if isinstance(raw, dict) else {}
    hidden = [k for k in raw.get("hidden") or [] if valid_key(k)] \
        if isinstance(raw.get("hidden"), list) else []
    reminders = {}
    if isinstance(raw.get("reminders"), dict):
        for k, v in raw["reminders"].items():
            if valid_key(k):
                sent = v.get("sent") if isinstance(v, dict) else ""
                reminders[k] = {"sent": sent if isinstance(sent, str)
                                and DATE_RE.fullmatch(sent) else ""}
    fired = []
    if isinstance(raw.get("fired"), list):
        for f in raw["fired"]:
            if isinstance(f, dict) and valid_key(f.get("key")) \
                    and isinstance(f.get("ts"), int):
                fired.append({"key": f["key"], "ts": f["ts"]})
    amounts = {}
    if isinstance(raw.get("amounts"), dict):
        for k, v in raw["amounts"].items():
            if not (valid_key(k) and isinstance(v, dict)):
                continue
            amount, ts = v.get("amount"), v.get("ts")
            cur = v.get("currency")
            if isinstance(ts, int) and not isinstance(ts, bool) \
                    and (amount is None or (
                        isinstance(amount, (int, float))
                        and not isinstance(amount, bool)
                        and 0 < amount < 1_000_000
                        and isinstance(cur, str)
                        and CURRENCY_RE.fullmatch(cur))):
                amounts[k] = {"amount": amount,
                              "currency": cur if amount is not None else "",
                              "ts": ts}
    kept = {}
    if isinstance(raw.get("kept"), dict):
        for k, v in raw["kept"].items():
            if valid_key(k) and isinstance(v, list):
                ids = [i for i in v if isinstance(i, str) and i]
                if ids:
                    kept[k] = ids[:MAX_KEPT_IDS]
    return {"hidden": hidden[:MAX_KEYS], "kept": kept,
            "reminders": reminders,
            "fired": fired[-MAX_FIRED:], "amounts": amounts,
            "body_amounts": raw.get("body_amounts") is True}


def _read() -> dict[str, dict]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    return {name: _clean(block) for name, block in accs.items()
            if isinstance(name, str)}


def _load() -> dict[str, dict]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, dict]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"accounts": data}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> dict:
    """One account's block (a deep-enough copy - safe to keep)."""
    account = account or accounts.default_name()
    with _LOCK:
        block = _load().get(account) or _clean({})
        return json.loads(json.dumps(block))


def _update(account: str | None, change) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        block = json.loads(json.dumps(data.get(account) or _clean({})))
        before = json.dumps(block, sort_keys=True)
        change(block)
        if json.dumps(block, sort_keys=True) != before:
            _persist({**data, account: _clean(block)})


def set_hidden(key: str, hidden: bool, account: str | None = None) -> None:
    if not valid_key(key):
        raise ValueError("bad key")

    def change(b):
        if hidden and key not in b["hidden"]:
            b["hidden"].append(key)
            b["hidden"] = b["hidden"][-MAX_KEYS:]
        elif not hidden and key in b["hidden"]:
            b["hidden"].remove(key)
        if hidden:                  # no subscription, no reminder
            b["reminders"].pop(key, None)
    _update(account, change)


def add_kept(key: str, msgids: list[str], account: str | None = None) -> None:
    """Remember the Message-IDs "Keep the receipts" pinned for `key`."""
    if not valid_key(key):
        raise ValueError("bad key")

    def change(b):
        have = b["kept"].get(key, [])
        merged = have + [i for i in msgids if i not in set(have)]
        if merged and (key in b["kept"] or len(b["kept"]) < MAX_KEYS):
            b["kept"][key] = merged[:MAX_KEPT_IDS]
    _update(account, change)


def pop_kept(key: str, account: str | None = None) -> list[str]:
    """Forget (and return) what "Keep the receipts" pinned for `key`."""
    out: list[str] = []

    def change(b):
        out.extend(b["kept"].pop(key, []))
    _update(account, change)
    return out


def set_reminder(key: str, on: bool, account: str | None = None) -> None:
    """Turn the reminder of one subscription on or off. Turning it on again
    forgets which date was announced (a fresh ask is a fresh reminder)."""
    if not valid_key(key):
        raise ValueError("bad key")

    def change(b):
        if on:
            if key not in b["reminders"] and len(b["reminders"]) < MAX_KEYS:
                b["reminders"][key] = {"sent": ""}
        else:
            b["reminders"].pop(key, None)
    _update(account, change)


def mark_sent(key: str, date: str, account: str | None = None) -> bool:
    """Remember that the reminder for the expected `date` went out. False when
    the reminder is off or that date was announced already (delivered once)."""
    done = []

    def change(b):
        r = b["reminders"].get(key)
        if r is None or r["sent"] == date:
            return
        r["sent"] = date
        done.append(True)
    _update(account, change)
    return bool(done)


def add_fired(key: str, ts: int, account: str | None = None) -> None:
    def change(b):
        b["fired"] = (b["fired"] + [{"key": key, "ts": int(ts)}])[-MAX_FIRED:]
    _update(account, change)


def set_amount(key: str, amount: float | None, currency: str, ts: int,
               account: str | None = None) -> None:
    """The amount read from the latest receipt (None = looked, nothing
    found). Nothing else of the text is kept."""
    if not valid_key(key):
        raise ValueError("bad key")

    def change(b):
        if key not in b["amounts"] and len(b["amounts"]) >= MAX_KEYS:
            return
        b["amounts"][key] = {"amount": amount, "currency": currency,
                             "ts": int(ts)}
    _update(account, change)


def clear_amounts(account: str | None = None) -> None:
    _update(account, lambda b: b["amounts"].clear())


def set_body_amounts(on: bool, account: str | None = None) -> None:
    """The opt-in: read the latest receipt of each subscription for its
    amount. Turning it off forgets every amount read so far."""
    def change(b):
        b["body_amounts"] = bool(on)
        if not on:
            b["amounts"].clear()
    _update(account, change)


def rename_account(old: str, new: str) -> None:
    with _LOCK:
        data = _load()
        if old in data:
            moved = {k: v for k, v in data.items() if k != old}
            moved[new] = data[old]
            _persist(moved)


def drop_account(name: str) -> None:
    with _LOCK:
        data = _load()
        if name in data:
            _persist({k: v for k, v in data.items() if k != name})
