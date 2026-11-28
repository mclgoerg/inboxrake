"""The Time machine: go back to a point in the last 30 days.

Everything Inboxrake did to one account (the audit log) is a list of STEPS.
Most moves have an undo step (mailops' undo log, kept for 30 days and
written to disk, see undostore.py); unsubscribes, marking as read and
permanent deletions are steps that stay as they are. Steps less than 30
minutes apart form a SESSION (computed, never stored).

Restoring to a point undoes every undoable step AFTER it, newest first, as
ONE job with one Activity entry, itself an undo step (`action: "restore"`,
whose `parts` remember what went back where, so it can be undone - and
brings the undone steps back). The preview and the restore share
`_assess`: what the preview counts is what the job moves, except for what
changes on the server in between (the job reports what it really did).

Nothing is ever deleted: a restore only moves mail back through the same
exact-copy undo path as the Undo button. Pinned mails and protected senders
stay where they are, and a step whose mails cannot be found (emptied,
rebuilt folder) is skipped and reported.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import mailops
from . import mimecut
from . import rules as rulesmod
from . import tenants

log = logging.getLogger("inboxrake.timemachine")

SESSION_GAP_S = 30 * 60
STEP_CAP = 1000            # steps listed (newest first): the log is paged
SENDERS_LISTED = 12        # senders named on a step's second line: the UI cuts
# a bulk unsubscribe logs one entry per sender: entries this close together
# (by the same actor) are ONE step, "Unsubscribed from N senders"
UNSUB_GROUP_S = 5 * 60

_MOVES = ("trash", "archive", "move", "move_contents", "restore",
          mimecut.ACTION)
_STAYS = ("mark_read", "unsubscribe", "undo", "protect",
          "assistant_protect", "assistant_pin")
_GONE = ("empty_trash", "purge")
# what counts as "mails touched" in a session
_TOUCHED = (*_MOVES, "mark_read")


# ------------------------------------------------------------------ steps

def _undone(audit: list[dict]) -> dict[str, int]:
    """Mails an undo / restore put back, by the audit id of the step."""
    out: dict[str, int] = {}
    for a in audit:
        for u in [a.get("undoes"), *(a.get("undoes_many") or [])]:
            if isinstance(u, dict) and u.get("id"):
                out[u["id"]] = out.get(u["id"], 0) + int(u.get("count") or 0)
    return out


def _live_mails(entry: dict) -> list[tuple[str, str, int]]:
    """`(addr, destination folder, size)` of every mail a step can still
    bring back, as far as the step itself knows (no server look)."""
    if entry.get("parts") is not None:
        return [(m[2], p["head"]["in"], m[3]) for p in entry["parts"]
                for m in p["mails"]]
    return [(m["addr"], m["folder"], m["size"])
            for m in mailops.undo_mails(entry)
            if not (m["copy"] or {}).get("restored")]


def _step(entry: dict | None, a: dict | None, sid: str,
          assistant: bool) -> dict:
    """One step: the audit entry (when there is one) and its undo entry (when
    it still has one) in the shape the UI lists."""
    src = a or {"ts": entry["ts"], "actor": entry.get("actor", "user"),
                "action": entry.get("action", "trash"),
                "count": entry["count"] + entry.get("lost", 0),
                "bytes": entry.get("bytes", 0), "label": entry["label"],
                "outcome": "ok", "error": ""}
    step = {"id": sid, "ts": src["ts"], "action": src["action"],
            "actor": src["actor"], "count": src["count"],
            "bytes": src.get("bytes", 0), "label": src.get("label", ""),
            "outcome": src.get("outcome", "ok"), "status": "stays",
            **({"error": src["error"]} if src.get("error") else {}),
            **({"from_role": src["from_role"]} if src.get("from_role") else {})}
    if entry is not None:
        mails = _live_mails(entry)
        by_sender = Counter(m[0] for m in mails)
        step.update(
            status="back", mails=len(mails), lost=entry.get("lost", 0),
            bytes=step["bytes"] or sum(m[2] for m in mails),
            senders=[{"addr": s, "n": n} for s, n
                     in by_sender.most_common(SENDERS_LISTED)],
            senders_total=len(by_sender),
            **({"token": entry["token"]} if entry.get("token") else {}))
    return step


def steps(acc) -> tuple[list[dict], dict[str, tuple[dict, bool]]]:
    """`(steps oldest first, {step id: (undo entry, from the assistant list)})`
    of the last UNDO_KEEP_DAYS days. A step's `status`: `back` (its undo step
    is there), `cant` (it moved mail that can't be found any more, `reason`
    says why), `undone` (an undo put it back) or `stays` (nothing to undo).
    No server access: what the account remembers."""
    mailops.expire_undo(acc)         # an idle account keeps nothing too old
    now = time.time()
    audit = auditlog.since(acc.name, now - mailops.UNDO_KEEP_DAYS * 86400)
    with acc.lock:
        mine = list(acc.undo_log)
        theirs = list(acc.assistant_undo)
    by_audit = {e["audit_id"]: (e, False) for e in mine if e.get("audit_id")}
    by_audit.update({e["audit_id"]: (e, True) for e in theirs
                     if e.get("audit_id")})
    undone = _undone(audit)
    gone_at = [a["ts"] for a in audit
               if a["action"] in _GONE and a["count"] > 0]
    out: list[dict] = []
    entries: dict[str, tuple[dict, bool]] = {}
    matched: set[str] = set()
    seen_ts: Counter = Counter()
    for a in audit:
        if a["action"] not in (*_MOVES, *_STAYS, *_GONE):
            continue
        if a["outcome"] in ("error", "failed", "cancelled") and a["count"] <= 0:
            continue
        if a["action"] == "unsubscribe" and a["outcome"] not in ("ok", "done"):
            continue                 # nothing was unsubscribed
        if a["action"] == "undo" and a["count"] <= 0:
            continue
        aid = a.get("id") or ""
        if aid:
            sid = aid
        else:
            sid = f"{a['ts']:x}-{seen_ts[a['ts']]}"
            seen_ts[a["ts"]] += 1
        found = by_audit.get(aid) if aid else None
        step = _step(found[0] if found else None, a, sid,
                     bool(found and found[1]))
        prev = out[-1] if out else None
        if a["action"] == "unsubscribe" and prev \
                and prev["action"] == "unsubscribe" \
                and prev["actor"] == step["actor"] \
                and step["ts"] - prev["ts"] <= UNSUB_GROUP_S:
            prev["count"] += step["count"]
            continue
        if found:
            matched.add(aid)
            entries[sid] = found
        elif a["action"] in _MOVES:
            if undone.get(aid, 0) > 0:
                step["status"] = "undone"
            elif a["count"] > 0:
                step["status"] = "cant"
                emptied = [t for t in gone_at if t >= a["ts"]]
                # only a move into Trash can be emptied away
                if emptied and a["action"] in ("trash", "move"):
                    step.update(reason="emptied", at=min(emptied))
                else:
                    step["reason"] = "untracked"
            else:
                continue
        elif a["action"] in _GONE:
            step.update(status="cant", reason="deleted")
        out.append(step)
    # a step whose audit entry is gone (trimmed log, or never written)
    for aid, (e, assistant) in list(by_audit.items()):
        if aid in matched:
            continue
        out.append(step := _step(e, None, e["id"], assistant))
        entries[step["id"]] = (e, assistant)
    for e in mine + theirs:
        if not e.get("audit_id"):
            sid = e["id"]
            out.append(_step(e, None, sid, bool(e.get("token"))))
            entries[sid] = (e, bool(e.get("token")))
    out.sort(key=lambda s: (s["ts"], s["id"]))
    if len(out) > STEP_CAP:
        out = out[-STEP_CAP:]
    return out, entries


def sessions(listed: list[dict]) -> list[dict]:
    """The sessions of a step list (oldest first), newest session first:
    steps less than SESSION_GAP_S apart belong together."""
    out: list[dict] = []
    for s in listed:
        last = out[-1] if out else None
        if last is None or s["ts"] - last["end"] >= SESSION_GAP_S:
            last = {"start": s["ts"], "end": s["ts"], "steps": 0, "mails": 0,
                    "first": s["id"], "last": s["id"]}
            out.append(last)
        last["end"] = s["ts"]
        last["last"] = s["id"]
        last["steps"] += 1
        if s["action"] in _TOUCHED:
            last["mails"] += s["count"]
    return out[::-1]


def listing(acc) -> dict:
    """The Time machine page's data: steps newest first, sessions newest
    first, and the limits."""
    listed, _ = steps(acc)
    return {"steps": listed[::-1], "sessions": sessions(listed),
            "now": int(time.time()), "keep_days": mailops.UNDO_KEEP_DAYS,
            "step_cap": mailops.UNDO_MAX}


# ------------------------------------------------------------- the plan

def _newer(listed: list[dict], point: str,
           top: str | None) -> tuple[list[dict], int]:
    """The steps after `point` (a step id; "" = before every step) up to and
    including `top` (the newest step the preview counted: a restore never
    reaches steps that came after it), and the moment the point stands for:
    the middle between the step it follows and the one after it. Raises
    UNKNOWN_POINT."""
    if point == "":
        idx = -1
    else:
        idx = next((i for i, s in enumerate(listed) if s["id"] == point), None)
        if idx is None:
            raise RuntimeError(mailops.UNKNOWN_POINT)
    end = len(listed)
    if top:
        last = next((i for i, s in enumerate(listed) if s["id"] == top), None)
        if last is None:
            raise RuntimeError(mailops.UNKNOWN_POINT)
        end = last + 1
    after = listed[idx + 1:end]
    now = int(time.time())
    before_ts = listed[idx]["ts"] if idx >= 0 else None
    if after:
        ts = (before_ts + after[0]["ts"]) // 2 if before_ts is not None \
            else after[0]["ts"] - 60
    else:
        ts = now
    return after, ts


def _targets(entry: dict) -> set[str]:
    """The folders a restore of this step puts mail into."""
    if entry.get("parts") is not None:
        return {p["head"]["in"] for p in entry["parts"]}
    return {m["folder"] for m in mailops.undo_mails(entry)}


def _live(acc, entries: list[dict]) -> dict:
    """What the server holds right now: `folders` = `{folder: (uidvalidity,
    {uids})}` (None = cannot be opened) of the folders steps with exact copies
    moved mail into, `trash_ids` (Message-IDs in Trash) for older steps
    without them, and `missing` = the folders a restore would put mail into
    that do not exist any more. Read-only."""
    folders = {e.get("in") for e in entries
               if e.get("copies") is not None and e.get("in")}
    legacy = any(e.get("copies") is None and e.get("parts") is None
                 for e in entries)
    targets = set().union(*(_targets(e) for e in entries)) if entries \
        else set()
    out: dict = {"folders": {}, "trash_ids": None, "missing": set()}
    if not targets:
        return out
    conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
    try:
        existing = set(mailops.selectable_folders(conn))
        # a merge that deleted its emptied source folder brings it back when
        # it is undone (mailops._recreate_folders): not "gone"
        recreate = {f for e in entries for f in (e.get("recreate") or [])}
        out["missing"] = {f for f in targets
                          if f and f not in existing and f not in recreate}
        for f in folders:
            status, _ = conn.select(mailops.quote_folder(f), readonly=True)
            out["folders"][f] = ((mailops.uidvalidity(conn),
                                  set(mailops._list_uids(conn)))
                                 if status == "OK" else None)
        if legacy:
            trash = mailops.folder_roles(conn, acc).get("trash")
            if trash:
                _, mails = mailops.refresh_role_index(conn, "trash", trash,
                                                      acc)
                out["trash_ids"] = (trash,
                                    {m.get("msgid") for m in mails
                                     if m.get("msgid")})
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return out


def _lost_reason(entry: dict, trash: str | None) -> str:
    """Why a mail of a step is no longer where the step left it, when nothing
    known explains it (what Inboxrake itself emptied is counted in the step's
    `lost` already): said neutrally, the cause may be the provider, another
    program or you."""
    return "left_trash" if entry.get("in") == trash else "left_folder"


def _assess(acc, entry: dict, live: dict, skip,
            virtual: set[tuple[str, str]]) -> dict:
    """What a restore would do with one step: `come` (the mails that go back:
    `(addr, size, folder, msgid)`), `lost` ({reason: n}: mails that can't),
    `skipped` ({reason: n}: left alone on purpose) and `untracked` (the step
    cannot be restored as a whole: its copies are not trackable). `virtual`
    holds the `(folder, Message-ID)` of mails the newer steps of this restore
    put back: an older step that had moved them INTO that folder finds them
    there (after the newer step's undo), not where the server holds them now."""
    come: list[tuple] = []
    lost: Counter = Counter()
    skipped: Counter = Counter()
    skip.gone.update(live.get("missing", ()))
    if entry.get("lost"):
        lost["emptied"] += entry["lost"]
    trash = acc.folder_roles.get("trash")

    def left(why: str) -> None:
        """A mail this restore leaves alone: a gone folder is a "can't",
        the rest is on purpose."""
        if why == "gone":
            lost["folder_gone"] += 1
        else:
            skipped[why] += 1

    if mailops._netted_entry(skip, entry):
        return {"come": [], "lost": lost, "skipped": skipped,
                "untracked": False}
    if entry.get("parts") is not None:
        live = [p for p in entry["parts"] if not mailops._netted(skip, p)]
        if any(p["head"].get("action") == mimecut.ACTION for p in live):
            # undoing it would leave original and lighter copy in Trash
            # (mailops._undo_parts refuses): it is left as it is
            n = sum(len(p["mails"]) for p in live)
            lost["untracked"] += n
            return {"come": [], "lost": lost, "skipped": skipped,
                    "untracked": True}
        for p in live:
            for m in p["mails"]:
                why = skip.reason(m[2], m[1], p["head"]["in"])
                if why:
                    left(why)
                else:
                    come.append((m[2], m[3], p["head"]["in"], m[1]))
        return {"come": come, "lost": lost, "skipped": skipped,
                "untracked": False}
    mails = [m for m in mailops.undo_mails(entry)
             if not (m["copy"] or {}).get("restored")]
    if entry.get("copies") is not None:
        state = live["folders"].get(entry.get("in"))
        if state is None or any(
                not m["copy"].get("uid") or m["copy"]["uv"] != state[0]
                for m in mails):
            lost["untracked"] += len(mails)
            return {"come": [], "lost": lost, "skipped": skipped,
                    "untracked": True}
        for m in mails:
            why = skip.reason(m["addr"], m["msgid"], m["folder"])
            if why:
                left(why)
            elif m["copy"]["uid"] not in state[1] \
                    and (entry.get("in"), m["msgid"]) not in virtual:
                lost[_lost_reason(entry, trash)] += 1
            else:
                come.append((m["addr"], m["size"], m["folder"], m["msgid"]))
        return {"come": come, "lost": lost, "skipped": skipped,
                "untracked": False}
    ids = live.get("trash_ids")
    for m in mails:
        why = skip.reason(m["addr"], m["msgid"], m["folder"])
        if why:
            left(why)
        elif ids and (entry.get("in") or ids[0]) == ids[0] \
                and m["msgid"] not in ids[1] \
                and (entry.get("in") or ids[0], m["msgid"]) not in virtual:
            lost[_lost_reason(entry, trash)] += 1
        else:            # present, or not checkable: the restore reports
            come.append((m["addr"], m["size"], m["folder"], m["msgid"]))
    return {"come": come, "lost": lost, "skipped": skipped,
            "untracked": False}


def _rules_that_would_catch(acc, listed: list[dict],
                            come: list[tuple]) -> list[dict]:
    """Active scheduled rules of this account that would move mails of the
    restored steps again on their next run: the rule that did the step, or a
    sender-grouped rule whose filter matches a restored sender. `come` items
    are `(step id, addr, key)`. A sender that has no mail left in the index
    (all of it was in the steps) is judged like a Trash / Junk sender - by
    address, date and read state only - and only by rules whose filter asks
    for nothing else; an estimate, the rule's own next report is the truth."""
    me = acc.name
    active = [r for r in rulesmod.load_rules()
              if r.get("mode") == "execute" and r.get("scope", "mail") == "mail"
              and r.get("schedule") in ("daily", "weekly", rulesmod.AFTER_SCAN)
              and (r.get("account") or accounts.default_name()) == me]
    if not active or not come:
        return []
    by_actor = {s["id"]: s["actor"] for s in listed}
    when = {s["id"]: s["ts"] for s in listed}
    senders = {c[1] for c in come if c[1]}
    groups: dict = {}
    if any(r.get("grouping") == "sender" for r in active):
        groups = mailops.public_state(acc)["groups"].get("sender", {})
    out = []
    for r in active:
        keys = {c[2] for c in come if by_actor.get(c[0]) == f"rule:{r['id']}"}
        if r.get("grouping") == "sender":
            try:
                f = rulesmod.parse_filter(r["query"])
                plain = not rulesmod.purge_unsupported(r["query"])
                hit = set()
                for a in senders:
                    g = groups.get(a)
                    if g is None and plain:
                        g = mailops.role_sender_groups([{
                            "addr": a, "seen": False, "name": "",
                            "ts": max(when[c[0]] for c in come
                                      if c[1] == a)}])[0]
                    if g is not None and not g.get("protected") \
                            and rulesmod.match_group(g, f):
                        hit.add(a)
            except Exception:
                hit = set()
            keys |= {c[2] for c in come if c[1] in hit}
        if keys:
            out.append({"id": r["id"], "name": r["name"], "mails": len(keys)})
    return sorted(out, key=lambda r: (-r["mails"], r["name"]))


def _range(acc, point: str, top: str | None, picked: set[str] | None):
    """Everything a preview and a restore both need: the step list, the steps
    after the point (newest first) with their undo entries, and the live
    server view."""
    listed, entries = steps(acc)
    after, point_ts = _newer(listed, point, top)
    after = after[::-1]
    skip = mailops.undo_skipper(acc, picked)
    # a restore step inside the range re-arms steps that are in it too: those
    # cancel out (the state at the point has neither)
    skip.net.update(s["id"] for s in after)
    return listed, entries, after, point_ts, skip


def preview(acc, point: str, picked: list[str] | None = None,
            top: str | None = None) -> dict:
    """What `restore(point)` would do, counted the same way it runs."""
    pick = None if picked is None else set(picked)
    listed, entries, after, point_ts, skip = _range(acc, point, top, pick)
    todo = [(s, entries[s["id"]][0]) for s in after
            if s["status"] == "back" and s["id"] in entries]
    live = _live(acc, [e for _, e in todo])
    gone_at = [s["ts"] for s in listed if s["action"] in _GONE
               and s["status"] == "cant"]
    come_total: list[tuple] = []
    folders: Counter = Counter()
    senders: dict[str, list[int]] = {}
    cant: dict[str, dict] = {}
    skipped: Counter = Counter()
    active = 0
    keyed: list[tuple] = []

    def add_cant(reason: str, n: int, at: int | None = None) -> None:
        if n <= 0:
            return
        c = cant.setdefault(reason, {"reason": reason, "mails": 0, "at": None})
        c["mails"] += n
        if at and (c["at"] is None or at > c["at"]):
            c["at"] = at

    virtual: set[tuple[str, str]] = set()
    for s, entry in todo:
        res = _assess(acc, entry, live, skip, virtual)
        virtual |= {(folder, msgid) for _, _, folder, msgid in res["come"]}
        active += 1 if res["come"] else 0
        for k, n in res["lost"].items():
            at = min((t for t in gone_at if t >= s["ts"]), default=None) \
                if k == "emptied" else None
            add_cant(k, n, at)
        skipped.update(res["skipped"])
        for i, (addr, size, folder, msgid) in enumerate(res["come"]):
            come_total.append((addr, size, folder))
            keyed.append((s["id"], addr, (s["id"], i)))
            folders[folder] += 1
            row = senders.setdefault(addr, [0, 0])
            row[0] += 1
            row[1] += size
    stays: Counter = Counter()
    for s in after:
        if s["status"] == "cant":
            if s["reason"] == "deleted":
                continue            # the cause; its mails are counted below
            add_cant(s["reason"], s["count"], s.get("at"))
        elif s["status"] == "stays" and s["action"] != "undo":
            stays[s["action"]] += s["count"]
    return {
        "top": top if top is not None else (listed[-1]["id"] if listed else ""),
        "point": point, "point_ts": point_ts,
        "steps": active,
        "newer_sessions": _newer_sessions(listed, after, point),
        "mails": len(come_total),
        "bytes": sum(c[1] for c in come_total),
        "folders": [{"folder": f, "name": mailops.decode_mutf7(f), "mails": n}
                    for f, n in folders.most_common()],
        "senders": [{"addr": a, "mails": n, "bytes": b} for a, (n, b)
                    in sorted(senders.items(), key=lambda x: (-x[1][0], x[0]))],
        "cant": sorted(cant.values(), key=lambda c: -c["mails"]),
        "stays": [{"kind": k, "n": n} for k, n in stays.most_common()],
        "skipped": {"protected": skipped["protected"],
                    "pinned": skipped["pinned"]},
        "rules": _rules_that_would_catch(acc, listed, keyed),
    }


def _newer_sessions(listed: list[dict], after: list[dict],
                    point: str) -> int:
    """How many sessions the steps after the point reach into, besides the
    session the point itself is in (the UI says "includes N newer
    sessions")."""
    if not after:
        return 0
    spans = sessions(listed)

    def of(ts: int) -> int:
        return next(i for i, x in enumerate(spans)
                    if x["start"] <= ts <= x["end"])
    own = next((of(s["ts"]) for s in listed if s["id"] == point), None)
    return len({of(s["ts"]) for s in after} - {own})


# ----------------------------------------------------------------- restore

def _head(entry: dict) -> dict:
    """The identity of a step without its mails (kept to bring it back)."""
    return {k: v for k, v in entry.items()
            if k not in ("items", "copies", "who", "count", "bytes", "parts",
                         "lost")}


def start(acc, point: str, top: str | None, picked: list[str] | None,
          pause: list[str], actor: str = "user") -> dict:
    """Start the restore job (see the module docstring). Raises like Undo
    does: BUSY_ACTION / BUSY_SCAN while something else changes the mailbox,
    NOTHING_TO_UNDO when no step is left to undo, UNKNOWN_POINT."""
    pick = None if picked is None else set(picked)
    listed, entries, after, point_ts, _ = _range(acc, point, top, pick)
    todo = [s for s in after if s["status"] == "back" and s["id"] in entries]
    if not todo:
        raise RuntimeError(mailops.NOTHING_TO_UNDO)
    with acc.lock:
        if mailops._job_running(acc) or acc.undo_busy:
            raise RuntimeError(mailops.BUSY_ACTION)
        if acc.state["status"] == "scanning":
            raise RuntimeError(mailops.BUSY_SCAN)
        seq = acc.state["restore"].get("seq", 0) + 1
        acc.state["restore"] = {
            "status": "running", "progress": "…", "error": "", "seq": seq,
            "steps_done": 0, "steps_total": len(todo), "moved": 0,
            "point_ts": point_ts}
        acc.state["groups_rev"] += 1
    job = {"plan": [(s["id"], entries[s["id"]][0]["id"],
                     entries[s["id"]][1]) for s in todo],
           "listed": listed, "point_ts": point_ts, "picked": pick,
           "net": {s["id"] for s in after},
           "pause": list(pause), "actor": actor, "seq": seq}
    threading.Thread(target=tenants.call_in,
                     args=(acc.tenant, _worker, acc, job),
                     daemon=True).start()
    return {"started": True, "steps": len(todo), "point_ts": point_ts}


def _set(acc, **fields) -> None:
    with acc.lock:
        acc.state["restore"].update(fields)


def _worker(acc, job: dict) -> None:
    skip = mailops.undo_skipper(acc, job["picked"])
    skip.net.update(job["net"])
    with acc.lock:
        acc.undo_busy += 1     # no write of the lists until _finish
    parts: list[dict] = []
    keyed: list[tuple] = []
    undone: list[dict] = []
    restored = size = steps_done = 0
    skipped: Counter = Counter()
    cant: Counter = Counter()
    error = ""
    try:
        with acc.lock:
            current = {e["id"]: e for e in
                       [*acc.undo_log, *acc.assistant_undo]}
        entries = [current[eid] for _, eid, _ in job["plan"]
                   if eid in current]
        live = _live(acc, entries)
        virtual: set[tuple[str, str]] = set()
        for sid, eid, assistant in job["plan"]:
            with acc.lock:
                entry = next((e for e in (acc.assistant_undo if assistant
                                          else acc.undo_log)
                              if e["id"] == eid), None)
            if entry is None:
                continue             # undone meanwhile
            res = _assess(acc, entry, live, skip, virtual)
            skipped.update(res["skipped"])
            for k, n in res["lost"].items():
                cant[k] += n
            cancelling = mailops._netted_entry(skip, entry) or any(
                mailops._netted(skip, p) for p in entry.get("parts") or ())
            if res["untracked"] or not (res["come"] or cancelling):
                steps_done += 1
                _set(acc, steps_done=steps_done)
                continue
            keyed.extend((sid, addr, (sid, i)) for i, (addr, *_)
                         in enumerate(res["come"]))
            taken, pos = mailops.pop_undo(
                acc, ident={"id": eid}, assistant=assistant,
                busy_check=False)
            run = mailops.run_undo(acc, taken, pos, only=skip,
                                   expected=len(res["come"]))
            cant["left_folder"] += run["short"]
            cant["ambiguous"] += run.get("ambiguous", 0)
            mailops.apply_undo_counts(acc, run)
            virtual |= {(to, msgid) for to, msgid, *_ in run["items"]}
            steps_done += 1
            restored += run["restored"]
            moved: dict[str, list] = {}
            for to, msgid, addr, sz, frm in run["items"]:
                moved.setdefault(frm, []).append((to, msgid, addr, sz))
                size += sz
            for frm, mails in moved.items():
                parts.append({"head": {
                    **_head(taken), "in": frm,
                    # the steps this restore step undid (to cancel it out
                    # against them when it is re-armed)
                    **({"undid": [p["head"].get("audit_id") or p["head"]["id"]
                                  for p in taken["parts"]]}
                       if taken.get("parts") else {})},
                    "mails": mails})
            if taken.get("audit_id") and run["failed"] is None and (
                    run["restored"] or cancelling):
                # (a restore this one cancelled out counts as undone too)
                undone.append({"id": taken["audit_id"],
                               "count": run["restored"] or taken["count"]})
            _set(acc, steps_done=steps_done, moved=restored,
                 progress=f"{steps_done}/{len(job['plan'])}")
            if run["failed"] is not None:
                error = mailops.error_text(run["failed"])
                break
    except Exception as exc:
        log.exception("[%s] time machine restore failed", acc.name)
        error = mailops.error_text(exc, generic=mailops.INTERNAL_ERROR)
    _finish(acc, job, parts, undone, restored, size, steps_done, error,
            skipped, cant, keyed)


def _finish(acc, job: dict, parts: list[dict], undone: list[dict],
            restored: int, size: int, steps_done: int, error: str,
            skipped: Counter, cant: Counter, keyed: list[tuple]) -> None:
    """Book a finished (or failed) restore: the one restore step in the undo
    log and in Activity, the rules the user asked to pause, the state. The
    state always ends, whatever goes wrong while booking."""
    with acc.lock:
        acc.undo_busy -= 1            # the lists may be written again
    paused: list[str] = []
    try:
        audit_id = auditlog.new_id()
        if restored:
            entry = {"id": f"{time.time_ns():x}", "ts": int(time.time()),
                     "label": f"{restored} mails restored to an earlier point",
                     "label_key": "undo.restore",
                     "label_params": {"n": restored},
                     "action": "restore", "count": restored, "bytes": size,
                     "items": [], "in": "", "quiet": True, "parts": parts,
                     "audit_id": audit_id}
            with acc.lock:
                acc.undo_log.append(entry)
        with acc.lock:
            mailops._sync_undo(acc)
        mailops.flush_undo(acc)          # the one write of the whole job
        auditlog.record(
            "restore", actor=job["actor"], account=acc.name, count=restored,
            size=size, label=str(job["point_ts"]),
            outcome=("error" if error and not restored
                     else "partial" if error else "ok"),
            error=error, entry_id=audit_id,
            undoes_many=undone or None)
        # only what the preview offered: this account's rules that would
        # catch the restored mails again
        offered = {r["id"] for r in _rules_that_would_catch(
            acc, job["listed"], keyed)} if job["pause"] else set()
        paused = _pause(acc, [r for r in job["pause"] if r in offered],
                        job["actor"])
    except Exception as exc:
        log.exception("[%s] could not book the restore", acc.name)
        error = error or mailops.error_text(exc,
                                            generic=mailops.INTERNAL_ERROR)
    finally:
        with acc.lock:
            acc.state["restore"].update(
                status="error" if error and not restored else "done",
                progress="", error=error, steps_done=steps_done,
                moved=restored, skipped_protected=skipped["protected"],
                skipped_pinned=skipped["pinned"], cant=sum(cant.values()),
                ambiguous=cant["ambiguous"],
                paused=paused)
            acc.state["groups_rev"] += 1
    log.info("[%s] time machine: restored %d mails in %d steps%s", acc.name,
             restored, steps_done, f" ({error})" if error else "")
    if restored:
        mailops._rescan_after_restore(acc, restored, "restored", {
            "restored": restored, "of": restored,
            "label": "Time machine"})


def _pause(acc, rule_ids: list[str], actor: str) -> list[str]:
    """Switch the rules to Report only (what 'Pause' means in the confirm);
    each one is listed in Activity. Returns the names paused."""
    names = []
    for rid in rule_ids:
        try:
            rule = rulesmod.update_rule(rid, {"mode": "report"})
        except (KeyError, ValueError):
            continue
        names.append(rule["name"])
        auditlog.record("rule_paused", actor=actor, account=acc.name,
                        label=rule["name"])
    return names
