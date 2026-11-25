"""Rule checkup: looks at all of one account's rules together and reports what
a single rule card cannot show. Local only (the scan in memory, the rules and
the audit log) - no IMAP traffic, no AI, and it never changes a rule or a mail:
every fix is a button the user presses.

What it finds
  conflict        two rules would act on the same mails and send them to
                  different places (archive vs Trash, two folders ...)
  overlap         one rule leaves mails alone on purpose ("except the newest
                  N" / "if older than N days") and another rule takes exactly
                  those mails - its intent never holds
  dest_missing    a "move to folder" rule whose folder is not on the server
                  any more (the run would fail)
  only_protected  the filter matches, but only protected senders / pinned
                  mails, which no rule ever touches
  never_matches   nothing in the last runs (from the audit log's
                  `rule:<id>` entries; the log is capped - what is there is
                  used) and nothing now
  stale_report    a report-only rule whose last report is 30+ days old

The overlap / conflict pass is its own pass over the scan: the live preview
of the rule editor ignores "except the newest N", "older than", the per-run
cap and Keep-safe, so it cannot say what a run would really touch. Here each
rule's act set follows `rules.run_rule` step by step (protected groups out,
retention window, pinned mails, Keep-safe, then the cap that takes groups
largest first), and two rules are compared on the MAILS they would act on.
Block rules take part like any trash rule (they are never flagged as idle -
that is what they are for). Purge rules (Junk / Trash) are compared with each
other only, and only by definition: their folder is read live by a run.

Rules run in the order they were created (`rules.load_rules()`); a conflict
names the one that acts first.

Per-finding state the user keeps (Ignore) lives in rulecheckstore.py, keyed by
a fingerprint of the finding. The mails behind a finding are remembered in
memory for the "Show the N mails" view (`finding_mails`)."""

from __future__ import annotations

import hashlib
import json
import threading
import time

from . import accounts
from . import auditlog
from . import keepsafe
from . import mailops
from . import pinstore
from . import rulecheckstore
from . import rules as rulesmod
from . import tenants

KINDS = ("conflict", "overlap", "dest_missing", "only_protected",
         "never_matches", "stale_report")

NEVER_MIN_RUNS = 3          # runs that found nothing before it is a finding
NEVER_MIN_DAYS = 2          # ... spread over at least this many days
STALE_DAYS = 30             # a report older than this is stale
MAX_SENDERS = 100           # sender rows listed per finding (counts are exact)

_LOCK = threading.Lock()
# {(tenant id, account): {fingerprint: frozenset({(folder, uid)})}} - the mails
# of the findings of the last checkup, for `list_mails(finding=...)`.
_MAILS: dict[tuple[str, str], dict[str, frozenset]] = {}


def _fp(*parts) -> str:
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:16]


def _dest(rule: dict) -> tuple[str, str]:
    """Where a rule sends its mails: two rules clash when this differs."""
    return (rule["action"], rule.get("dest", "") if rule["action"] == "move"
            else "")


# --------------------------------------------------------------- act sets

def _plan(rule: dict, acc, groups: dict, pinned_all: set[str], ks_enabled
          ) -> dict:
    """What one mail rule would act on right now, the way a run decides it
    (see `rules.run_rule`):

      acts      {(folder, uid)} the picked groups' mails a run would move
      kept      {(folder, uid)} mails the retention window leaves alone
                (only for a rule with "except the newest N" / "older than")
      wanted    mails the rule wants after retention, protected groups too
      keys      the non-protected groups the filter matched
      protected how many matched groups are protected (skipped)
      pinned    pinned mails the run would skip
    """
    f = rulesmod.parse_filter(rule["query"])
    grouping = rule["grouping"]
    keep_latest = rule.get("keep_latest")
    older = rule.get("older_than_days")
    mark_read = rule["action"] == "mark_read"
    pinned = set() if mark_read else pinned_all
    # Keep-safe: trash runs only, Block rules are never softened
    keep_on = (rule["action"] == "trash" and rule.get("origin") != "block"
               and bool(ks_enabled))
    matched = [g for g in groups.get(grouping, {}).values()
               if rulesmod.match_group(g, f)]
    plan = {"acts": set(), "kept": set(), "wanted": 0, "keys": [],
            "protected": 0, "pinned": 0, "ks": 0, "grouping": grouping}
    per_group: dict[str, list] = {}
    with acc.lock:
        recs = acc.state["groups"][grouping]
        for g in matched:
            rec = recs.get(g["key"])
            if rec is None:
                continue
            held = mailops.retained_mails(rec, acc, keep_latest, older, None)
            total = sum(len(u) for u in rec["folders"].values())
            plan["wanted"] += total - sum(len(s) for s in held.values())
            if g["protected"]:
                plan["protected"] += 1
                continue
            plan["keys"].append(g["key"])
            pin = mailops.pinned_uids(rec, acc, pinned)
            ids = []
            for folder, uids in rec["folders"].items():
                for uid in uids:
                    if uid in held.get(folder, ()):
                        plan["kept"].add((folder, uid))
                    elif uid in pin.get(folder, ()):
                        plan["pinned"] += 1
                    elif keep_on and (m := acc.index.get(
                            mailops.ikey(folder, uid))) \
                            and keepsafe.mail_class(m, ks_enabled):
                        plan["ks"] += 1
                    else:
                        ids.append((folder, uid))
            per_group[g["key"]] = ids
    # the per-run cap: groups largest first, while they fit
    total = 0
    for key in sorted(per_group, key=lambda k: -len(per_group[k])):
        n = len(per_group[key])
        if n and total + n <= rulesmod.RULE_CAP:
            plan["acts"].update(per_group[key])
            total += n
    # what is left once protected senders and pinned mails are out
    plan["after_pin"] = plan["ks"] + sum(len(v) for v in per_group.values())
    return plan


def _addr_set(acc, plan: dict) -> set[str]:
    """The sender addresses behind the rule's non-protected matched groups."""
    out: set[str] = set()
    with acc.lock:
        recs = acc.state["groups"][plan["grouping"]]
        for key in plan["keys"]:
            rec = recs.get(key)
            if rec is None:
                continue
            for folder, uids in rec["folders"].items():
                for uid in uids:
                    m = acc.index.get(mailops.ikey(folder, uid))
                    if m:
                        out.add(m["addr"])
    return out


def _senders_index(acc) -> dict[str, tuple[int, str]]:
    """{addr: (newest ts, display name)} over the scan, one pass."""
    out: dict[str, tuple[int, str]] = {}
    with acc.lock:
        for m in acc.index.values():
            ts, name = out.get(m["addr"], (0, ""))
            if m["ts"] and m["ts"] > ts or m["addr"] not in out:
                ts = m["ts"] or 0
                name = m.get("name") or name
            out[m["addr"]] = (ts, name)
    return out


def _addr_of(acc, folder: str, uid: int) -> str:
    m = acc.index.get(mailops.ikey(folder, uid))
    return m["addr"] if m else ""


def _rows(acc, sender_ix: dict, counts: dict[str, int],
          addrs: set[str]) -> list[dict]:
    """The sender rows of a Compare: newest sender first among those with
    the most mails at stake."""
    rows = []
    for a in addrs:
        ts, name = sender_ix.get(a, (0, ""))
        rows.append({"addr": a, "label": name or a, "n": counts.get(a, 0),
                     "last": ts or None})
    rows.sort(key=lambda r: (-r["n"], -(r["last"] or 0), r["addr"]))
    return rows[:MAX_SENDERS]


# ------------------------------------------------------------------ pairs

def _pair_findings(acc, plans: list[tuple[dict, dict]], out: list[dict],
                   mails: dict[str, frozenset]) -> None:
    """Conflicts and overlaps between the mail rules, in creation order."""
    acting = [(r, p) for r, p in plans if r["action"] != "mark_read"]
    sender_ix = None
    for i, (x, px) in enumerate(acting):
        for y, py in acting[i + 1:]:
            shared = px["acts"] & py["acts"]
            hit_x = px["kept"] & py["acts"]       # y takes what x leaves
            hit_y = py["kept"] & px["acts"]       # x takes what y leaves
            clash = bool(shared) and _dest(x) != _dest(y)
            if not clash and not hit_x and not hit_y:
                continue
            if sender_ix is None:
                sender_ix = _senders_index(acc)
            ids = [x["id"], y["id"]]
            sigs = [rulesmod.definition_sig(x), rulesmod.definition_sig(y)]
            if clash:
                per: dict[str, int] = {}
                with acc.lock:
                    for folder, uid in shared:
                        a = _addr_of(acc, folder, uid)
                        per[a] = per.get(a, 0) + 1
                fp = _fp("conflict", ids, sigs)
                mails[fp] = frozenset(shared)
                out.append({
                    "id": fp, "kind": "conflict", "rules": ids,
                    "first": x["id"], "n": len(shared),
                    "senders_total": len(per),
                    "senders": _rows(acc, sender_ix, per, set(per)),
                    "compare": {"unit": "mails",
                                "only_a": len(px["acts"]) - len(shared),
                                "both": len(shared),
                                "only_b": len(py["acts"]) - len(shared)}})
                continue
            # the rule whose intent is defeated: the one with more mails taken
            # (a tie: the earlier rule is the one defeated)
            if len(hit_x) >= len(hit_y):
                loser, winner, hits = x, y, hit_x
            else:
                loser, winner, hits = y, x, hit_y
            sx, sy = _addr_set(acc, px), _addr_set(acc, py)
            per = {}
            with acc.lock:
                for folder, uid in hits:
                    a = _addr_of(acc, folder, uid)
                    per[a] = per.get(a, 0) + 1
            both = sx & sy
            fp = _fp("overlap", ids, sigs)
            mails[fp] = frozenset(hits)
            out.append({
                "id": fp, "kind": "overlap", "rules": ids,
                "defeated": loser["id"], "by": winner["id"], "n": len(hits),
                "senders_total": len(both),
                "senders": _rows(acc, sender_ix, per, both),
                "keep_latest": loser.get("keep_latest"),
                "older_than_days": loser.get("older_than_days"),
                "compare": {"unit": "senders", "only_a": len(sx - sy),
                            "both": len(both), "only_b": len(sy - sx)}})


def _tokens(query: str) -> frozenset:
    return frozenset((query or "").lower().split())


def _purge_findings(purge_rules: list[dict], out: list[dict]) -> None:
    """Purge rules against each other, by definition: the same folder, and
    one rule's filter is the other's with fewer words (it matches at least
    those senders) while it deletes after fewer days - it takes mail the
    other waits for. Nothing about the folder is read."""
    for i, x in enumerate(purge_rules):
        for y in purge_rules[i + 1:]:
            if x["scope"] != y["scope"]:
                continue
            wx, wy = x.get("older_than_days"), y.get("older_than_days")
            if wx is None or wy is None:
                continue
            tx, ty = _tokens(x["query"]), _tokens(y["query"])
            # y defeats x: y deletes sooner and matches every sender x does
            if wy < wx and ty <= tx:
                loser, winner = x, y
            elif wx < wy and tx <= ty:
                loser, winner = y, x
            else:
                continue
            ids = [x["id"], y["id"]]
            out.append({
                "id": _fp("overlap", ids, [rulesmod.definition_sig(x),
                                           rulesmod.definition_sig(y)]),
                "kind": "overlap", "rules": ids, "defeated": loser["id"],
                "by": winner["id"], "n": 0, "senders_total": 0,
                "senders": [], "purge": True, "scope": x["scope"],
                "keep_latest": None,
                "older_than_days": loser["older_than_days"],
                "winner_days": winner["older_than_days"],
                "compare": None})


# ----------------------------------------------------------- single rules

def _run_streak(entries: list[dict], rule: dict, now: float):
    """(runs, since): how many of the rule's latest runs found nothing, and
    the time of the oldest of them. Runs of an older definition and runs that
    failed say nothing about the current filter and are skipped."""
    since_edit = max(rule.get("created", 0) or 0, rule.get("edited", 0) or 0)
    actor = f"rule:{rule['id']}"
    runs, since = 0, 0
    for e in entries:                              # newest first
        if e["actor"] != actor or e["action"] not in (
                "rule_report", "rule_execute") or e["ts"] < since_edit:
            continue
        if e["outcome"] != "ok":
            continue
        if e["count"] or e.get("kept_safe"):
            break
        runs += 1
        since = e["ts"]
    if runs >= NEVER_MIN_RUNS and now - since >= NEVER_MIN_DAYS * 86400:
        return runs, since
    return 0, 0


def checkup(acc) -> dict:
    """The Rule checkup of one account. Findings come with `ignored`; the
    caller decides what to show (nothing here changes anything)."""
    now = time.time()
    default = accounts.default_name()
    rules = [r for r in rulesmod.load_rules()
             if (r.get("account") or default) == acc.name]
    ignored = rulecheckstore.ignored(acc.name)
    findings: list[dict] = []
    mails: dict[str, frozenset] = {}
    mail_rules = [r for r in rules if r.get("scope", "mail") == "mail"
                  and not r.get("filter_invalid")]
    purge_rules = [r for r in rules if r.get("scope", "mail")
                   in rulesmod.PURGE_SCOPES]
    with acc.lock:
        scanned = acc.state["status"] == "done"
        scanned_ts = acc.state.get("scanned_ts")
        folders = set(acc.state.get("folders_raw") or [])
    # newest first, whatever order the file holds them in
    entries = sorted(auditlog.load(acc.name, 0, auditlog.MAX_ENTRIES,
                                   by="rules")["entries"],
                     key=lambda e: -e["ts"]) if rules else []

    plans: list[tuple[dict, dict]] = []
    if scanned and mail_rules:
        snapshot = mailops.public_state(acc)["groups"]
        pinned = pinstore.load_account(acc.name)
        ks = keepsafe.enabled_classes() \
            if keepsafe.settings().get("rules") else []
        plans = [(r, _plan(r, acc, snapshot, pinned, ks))
                 for r in mail_rules]
        _pair_findings(acc, plans, findings, mails)
    _purge_findings(purge_rules, findings)

    for r in mail_rules:
        if scanned and folders and r["action"] == "move" and r["dest"] \
                and r["dest"] not in folders:
            findings.append({
                "id": _fp("dest_missing", r["id"], r["dest"]),
                "kind": "dest_missing", "rules": [r["id"]],
                "folder": mailops.decode_mutf7(r["dest"]),
                "due": rulesmod.due(r, now)})
    for r, p in plans:
        if p["wanted"] > 0 and p["after_pin"] == 0 \
                and (p["protected"] or p["pinned"]):
            findings.append({
                "id": _fp("only_protected", r["id"],
                          rulesmod.definition_sig(r)),
                "kind": "only_protected", "rules": [r["id"]],
                "protected": p["protected"], "pinned": p["pinned"]})
    # Block rules and the Trash switch sit idle by design; a purge rule with
    # no filter only says the folder is clean.
    def idle_ok(r: dict) -> bool:
        return r.get("origin") in ("block", rulesmod.AUTO_EMPTY) or (
            r.get("scope", "mail") != "mail" and not r["query"].strip())

    live = {r["id"]: p for r, p in plans}
    for r in rules:
        if idle_ok(r):
            continue
        if r.get("scope", "mail") == "mail":
            p = live.get(r["id"])
            if p is None or p["wanted"] > 0:      # no scan, or it matches now
                continue
        runs, since = _run_streak(entries, r, now)
        if runs:
            findings.append({
                "id": _fp("never_matches", r["id"],
                          rulesmod.definition_sig(r)),
                "kind": "never_matches", "rules": [r["id"]],
                "runs": runs, "since": since})
    for r in rules:
        last = r.get("last_run") or {}
        if r.get("mode") == "report" and last.get("ts") \
                and now - last["ts"] > STALE_DAYS * 86400:
            findings.append({
                "id": _fp("stale_report", r["id"], last["ts"]),
                "kind": "stale_report", "rules": [r["id"]],
                "days": int((now - last["ts"]) // 86400),
                "last": last["ts"]})

    order = {k: i for i, k in enumerate(KINDS)}
    findings.sort(key=lambda f: order[f["kind"]])
    for f in findings:
        f["ignored"] = f["id"] in ignored
    with _LOCK:
        _MAILS[(tenants.current().id, acc.name)] = mails
    return {"account": acc.name, "scanned_ts": scanned_ts,
            "analysed": scanned, "checked": int(now),
            "needs_scan": bool(mail_rules) and not scanned,
            "rules": len(rules), "findings": findings}


def finding_mails(acc, fp: str) -> frozenset:
    """The mails behind one finding of the last checkup ((folder, uid) pairs):
    what "Show the N mails" lists. A finding the last checkup did not know
    (a restart, an old link) is looked for with a fresh one."""
    key = (tenants.current().id, acc.name)
    with _LOCK:
        have = _MAILS.get(key, {}).get(fp)
    if have is None:
        checkup(acc)
        with _LOCK:
            have = _MAILS.get(key, {}).get(fp)
    return have if have is not None else frozenset()


def set_ignored(acc, fp: str, on: bool) -> None:
    rulecheckstore.set_ignored(fp, on, acc.name)
