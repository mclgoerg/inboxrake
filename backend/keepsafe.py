"""Keep-safe: mail you may need later stays out of a big cleanup.

Before a large move to Trash the confirm asks `check` which of the mails
look worth keeping - invoices & receipts, bookings & tickets, contracts &
policy notices, job applications and (off by default) account & security
mail - and shows them as groups the user can untick. The ticked groups are
PINNED (`pinstore`, the existing protected-mail mechanism that every bulk
action and rule already skips) before the move, so nothing new is needed on
the moving side. Rule runs consult the same classes (`rule_kept`) and skip
those mails WITHOUT pinning them.

The classes are the subject rules of `smartkinds.PURPOSE_RULES` at rule-id
level (plus its bill pattern for invoices) - no new patterns, no AI. Only
metadata (subject, sender, date) is read, from the in-memory index. Which
classes are on is a per-tenant setting (`keep_safe` in the tenant's config).
"""

from __future__ import annotations

from . import accounts
from . import config as cfgmod
from . import mailops
from . import pinstore
from . import smartkinds

# class id -> (purpose, rule id) pairs of smartkinds.PURPOSE_RULES. Order =
# priority: a subject that fits two classes is shown in the first one.
CLASS_RULES: dict[str, tuple[tuple[str, str], ...]] = {
    "invoices": (("orders", "invoice"),),
    "bookings": (("appointments", "booking"),),
    "contracts": (("accounts", "policy_notice"),),
    "jobs": (("jobs", "application"),),
    "accounts": (("accounts", "account"),),
}
CLASSES = tuple(CLASS_RULES)
DEFAULT_ON = {"invoices": True, "bookings": True, "contracts": True,
              "jobs": True, "accounts": False}

# Mails of a selection a check looks at (the bulk cap of one request).
MAX_ITEMS = 20_000
SUBJECTS_SHOWN = 5          # newest subjects per class sent to the confirm
SENDERS_SHOWN = 3           # top senders per class sent to the confirm


def _rule(purpose: str, rid: str):
    return next(rx for p, r, rx in smartkinds.PURPOSE_RULES
                if (p, r) == (purpose, rid))


_PATTERNS = {cls: tuple(_rule(p, r) for p, r in pairs)
             for cls, pairs in CLASS_RULES.items()}


def settings(cfg: dict | None = None) -> dict:
    """The tenant's keep-safe switches: a bool per class + `rules`."""
    return cfgmod.keep_safe_of(cfg or cfgmod.load_config())


def enabled_classes(cfg: dict | None = None) -> list[str]:
    st = settings(cfg)
    return [c for c in CLASSES if st.get(c)]


def classes_of(subject: str, hint: str = "") -> list[str]:
    """Every class this subject belongs to, in priority order. A request to
    rate or review something is no keep-safe mail, and weak account words in
    promotional mail are no account mail (as in smartkinds)."""
    s = subject or ""
    if not s or smartkinds.SURVEY_RE.search(s):
        return []
    soft = "p" in hint or bool(smartkinds.PROMO_RE.search(s))
    out = []
    for cls, patterns in _PATTERNS.items():
        if cls == "accounts" and soft:
            patterns = (smartkinds.STRONG_ACCOUNT_RE,)
        hit = any(rx.search(s) for rx in patterns)
        if cls == "invoices":
            # regular bills (utility, telco, insurer, bank) are not "orders"
            # for smartkinds, but they are exactly what to keep
            hit = hit or bool(smartkinds.BILL_SUBJECT_RE.search(s))
        if hit:
            out.append(cls)
    return out


def mail_class(m: dict, enabled) -> str | None:
    """The class of one index entry among the `enabled` ones, or None. A mail
    without a Message-ID cannot be pinned, so it is never offered."""
    if not m.get("msgid"):
        return None
    hint = smartkinds.sender_hint(m["addr"], bool(m.get("unsub")))
    for cls in classes_of(m["subject"] or "", hint):
        if cls in enabled:
            return cls
    return None


def _scope_mails(acc, scope: dict) -> list[dict]:
    """The mails a Trash move of `scope` would act on: {"items": [[folder,
    uid], ...], "role"?: "junk" | "trash"} (a selection of mails, optionally
    in a special folder) or {"grouping", "keys",
    "keep_latest"?, "older_than_days"?, "only_addrs"?} (groups)."""
    if scope.get("items") is not None:
        return mailops.item_mails(list(scope["items"])[:MAX_ITEMS], acc,
                                  scope.get("role"))
    return mailops.group_move_mails(
        scope.get("grouping") or "sender", list(scope.get("keys") or []),
        scope.get("keep_latest"), scope.get("older_than_days"),
        scope.get("only_addrs"), acc)


def _sender_name(m: dict) -> str:
    return m.get("name") or m["addr"]


def check(scope: dict, acc=None) -> dict:
    """Which of the mails a Trash move of `scope` would act on look worth
    keeping: {"account" (the one it was asked of), "total", "kept", "classes": [{"id", "count", "senders":
    [{"name", "count"}], "subjects": [{"subject", "sender", "ts"}]}]}.
    Classes the tenant switched off are not looked for."""
    acc = acc or accounts.get()
    enabled = enabled_classes()
    mails = _scope_mails(acc, scope)
    by_class: dict[str, list[dict]] = {}
    with acc.lock:
        for m in mails:
            cls = mail_class(m, enabled)
            if cls:
                by_class.setdefault(cls, []).append(m)
    classes = []
    for cls in CLASSES:
        found = by_class.get(cls)
        if not found:
            continue
        senders: dict[str, int] = {}
        for m in found:
            name = _sender_name(m)
            senders[name] = senders.get(name, 0) + 1
        top = sorted(senders.items(), key=lambda kv: (-kv[1], kv[0]))
        newest = sorted(found, key=lambda m: -m["ts"])[:SUBJECTS_SHOWN]
        classes.append({
            "id": cls, "count": len(found),
            "senders": [{"name": n, "count": c}
                        for n, c in top[:SENDERS_SHOWN]],
            "subjects": [{"subject": m["subject"], "sender": _sender_name(m),
                          "ts": m["ts"]} for m in newest]})
    return {"account": acc.name, "total": len(mails),
            "kept": sum(c["count"] for c in classes), "classes": classes}


def pin(scope: dict, classes: list[str], acc=None) -> dict:
    """Pin every mail of `scope` that belongs to one of `classes` (the groups
    the user left ticked), so the move skips them. A mail's class is decided
    here again from the index, not taken from the client, and only the
    classes the tenant has switched on exist. Returns {"pinned": n,
    "items": [[folder, uid], ...]} - a selection-based move drops those."""
    acc = acc or accounts.get()
    enabled = enabled_classes()
    wanted = set(classes)
    mails = _scope_mails(acc, scope)
    msgids: set[str] = set()
    items: list[list] = []
    with acc.lock:
        for m in mails:
            if mail_class(m, enabled) in wanted:
                msgids.add(m["msgid"])
                items.append([m["folder"], m["uid"]])
    changed = pinstore.set_many(msgids, True, acc.name) if msgids else 0
    if changed:
        with acc.lock:
            acc.state["groups_rev"] += 1     # group "pinned" counts changed
    return {"pinned": len(items), "items": items}


def rule_kept(rec: dict, acc, keep_latest: int | None,
              older_than_days: int | None, pinned: set[str],
              enabled) -> tuple[dict[str, int], set[str]]:
    """What keep-safe leaves alone of one group record a rule run would move
    (lock held): ({class: mails}, {Message-ID, ...}) - not pinned, not in
    the retention keep-window. A rule run skips these mails WITHOUT pinning
    them (the caller hands the Message-IDs to `delete_groups(exempt=)`)."""
    held = mailops.retained_mails(rec, acc, keep_latest, older_than_days,
                                  pinned)
    counts: dict[str, int] = {}
    msgids: set[str] = set()
    for folder, uids in rec["folders"].items():
        for uid in uids:
            if uid in held.get(folder, ()):
                continue
            m = acc.index.get(mailops.ikey(folder, uid))
            cls = mail_class(m, enabled) if m else None
            if cls:
                counts[cls] = counts.get(cls, 0) + 1
                msgids.add(m["msgid"])
    return counts, msgids
