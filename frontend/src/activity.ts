/* Pure helpers of the Activity timeline: the month summary and the month
 * grouping, computed from the audit entries the page already loaded. */

import { t } from "./i18n";
import type { AuditEntry, AuditResp, Rule } from "./types";

/** Entry actions that move mails out of the inbox. A rule run is logged as
 *  `rule_execute` AND (by the move it performs) as one of these; the run is
 *  then not counted a second time. */
const MOVERS = new Set(["trash", "archive", "move"]);
/** Window (s) in which a rule's own move entry belongs to its run entry. */
const RULE_WINDOW = 600;

export interface MonthSummary {
  /** mails cleaned this month (moved to Trash / archived / moved, rules
   *  included) */
  mails: number;
  /** their size; 0 when the log has no sizes for them */
  bytes: number;
  /** mails per week of the month (days 1-7, 8-14, 15-21, 22-end) */
  weeks: number[];
  /** the split of `mails`: by rules / by you (the rest) */
  byRules: number;
  byYou: number;
  /** senders unsubscribed from this month (the entries that went through) */
  unsubscribed: number;
}

const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();

/** A move OUT of Junk / Trash ("Not junk", restore): the audit label is the
 *  undo label "N mails from Junk|Trash". That is rescuing, not cleaning. */
const FROM_ROLE = /^\d+ mails? from (Junk|Trash)$/;

/** The folder a rescue moved mails out of (`from_role`, or the label text on
 *  old entries). */
const rescueRole = (e: AuditEntry): "junk" | "trash" | "" =>
  e.from_role ?? (FROM_ROLE.exec(e.label)?.[1].toLowerCase() as
    "junk" | "trash" | undefined) ?? "";

/** Rescue = a move out of Junk / Trash: `from_role` on newer entries, the
 *  label text only as the fallback for old ones. */
const isRescue = (e: AuditEntry): boolean =>
  !!e.from_role || FROM_ROLE.test(e.label);

export const isRuleActor = (actor: string): boolean => actor.startsWith("rule:");

/** How many mails of each entry (by id) later undos restored. The same
 *  undo entry listed twice (overlapping lists) counts once. */
export function undoneCounts(entries: AuditEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.action === "undo" && e.undoes?.id) {
      if (e.id) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
      }
      out.set(e.undoes.id, (out.get(e.undoes.id) ?? 0) + e.undoes.count);
    }
  }
  return out;
}

/** One entry's share of the cleaning: when, how many mails (what an undo
 *  did not restore) and their size (pro rata). */
interface Cleaned { ts: number; n: number; bytes: number; rule: boolean }

/** What counts as cleaning: moves to Trash / archive / elsewhere and rule
 *  runs without a move entry of their own. `count` of an entry is what was
 *  really affected, so partial / cancelled runs count by it. Rescues from
 *  Junk / Trash and mark-as-read rules are not cleaning; mails restored by
 *  an undo are subtracted again. */
function cleaning(entries: AuditEntry[], rules: Rule[]): Cleaned[] {
  const undone = undoneCounts(entries);
  const moved = entries.filter((e) => MOVERS.has(e.action)
    && !isRescue(e));
  const out: Cleaned[] = [];
  for (const e of entries) {
    if (e.count <= 0) continue;
    const counts = MOVERS.has(e.action) ? !isRescue(e)
      : e.action === "rule_execute"
        && rules.find((r) => `rule:${r.id}` === e.actor)?.action !== "mark_read"
        && !moved.some((m) => m.actor === e.actor
          && Math.abs(m.ts - e.ts) <= RULE_WINDOW);
    if (!counts) continue;
    const back = Math.min(e.count, e.id ? undone.get(e.id) ?? 0 : 0);
    const n = e.count - back;
    out.push({ ts: e.ts, n, bytes: Math.round(e.bytes * n / e.count),
      rule: isRuleActor(e.actor) });
  }
  return out;
}

/** The cleaning done in `now`'s calendar month (local time). */
export function monthSummary(entries: AuditEntry[], now: Date,
    rules: Rule[] = []): MonthSummary {
  const key = monthKey(now);
  const weeks = [0, 0, 0, 0];
  let mails = 0;
  let bytes = 0;
  let byRules = 0;
  for (const c of cleaning(entries, rules)) {
    if (monthKey(new Date(c.ts * 1000)) !== key) continue;
    const day = new Date(c.ts * 1000).getDate();
    weeks[Math.min(3, Math.floor((day - 1) / 7))] += c.n;
    mails += c.n;
    bytes += c.bytes;
    if (c.rule) byRules += c.n;
  }
  // An unsubscribe that only found a link (or failed) did not unsubscribe.
  const unsubscribed = entries.filter((e) => e.action === "unsubscribe"
    && (e.outcome === "ok" || e.outcome === "done")
    && monthKey(new Date(e.ts * 1000)) === key).length;
  return { mails, bytes, weeks, byRules, byYou: mails - byRules, unsubscribed };
}

/** The day ranges of the four weekly bars of `now`'s month: [1, 7], [8, 14],
 *  [15, 21], [22, last day]. */
export function weekRanges(now: Date): [number, number][] {
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return [[1, 7], [8, 14], [15, 21], [22, last]];
}

export const WEEK_S = 7 * 86400;

/** Which rolling 7-day bucket (0 = oldest of `weeks`, the last = the 7 days
 *  up to now) a moment `age` seconds ago falls in; -1 when it is older than
 *  all of them. The same buckets as backend overview.py. */
export const weekBucket = (age: number, weeks = 8): number =>
  weeks - 1 - Math.floor(Math.max(0, age) / WEEK_S);

/** Mails cleaned per rolling 7-day bucket (oldest first), by the same rules
 *  as the month summary. `nowSec` = now in epoch seconds. */
export function cleanedWeeks(entries: AuditEntry[], nowSec: number,
    rules: Rule[] = [], weeks = 8): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const c of cleaning(entries, rules)) {
    const i = weekBucket(nowSec - c.ts, weeks);
    if (i >= 0) out[i] += c.n;
  }
  return out;
}

/** The newest audit entries back to `from` (epoch s), paged through
 *  `page`; `complete` is false when the page cap cut the history short. */
export async function entriesSince(
    page: (offset: number, limit: number) => Promise<AuditResp>,
    from: number, pages = 6, limit = 500):
    Promise<{ entries: AuditEntry[]; complete: boolean }> {
  const all: AuditEntry[] = [];
  let complete = false;
  for (let i = 0; i < pages && !complete; i++) {
    const r = await page(all.length, limit);
    all.push(...r.entries);
    complete = all.length >= r.total || r.entries.length === 0
      || all[all.length - 1].ts < from;
  }
  return { entries: all, complete };
}

/** Consecutive entries (the log is newest first) grouped by local month. */
export function groupByMonth(entries: AuditEntry[]):
    { key: number; ts: number; entries: AuditEntry[] }[] {
  const out: { key: number; ts: number; entries: AuditEntry[] }[] = [];
  for (const e of entries) {
    const key = monthKey(new Date(e.ts * 1000));
    const last = out[out.length - 1];
    if (last && last.key === key) last.entries.push(e);
    else out.push({ key, ts: e.ts, entries: [e] });
  }
  return out;
}

/** Local `YYYY-MM-DDTHH:MM` of an epoch-second timestamp, for `ShortDate`. */
export function localIso(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One entry as the timeline words it. `title` is the headline, `who` the
 *  "by you" / `Rule "name"` part, `detail` what the headline leaves out (the
 *  stored label, the mail count of an unsubscribe). */
export interface EntryText { title: string; who: string; detail: string }

/** The rule an entry belongs to: its current name, else the name stored with
 *  a run, else the id. */
const ruleName = (e: AuditEntry, rules: Rule[]): string => {
  const id = e.actor.slice(5);
  return rules.find((r) => r.id === id)?.name || (e.action.startsWith("rule_")
    ? e.label : "");
};

/** Who did it: the rule, or "by you". */
export const whoLine = (e: AuditEntry, rules: Rule[]): string =>
  isRuleActor(e.actor)
    // a move entry does not carry the rule's name: without the rule it
    // cannot be named
    ? ruleName(e, rules) ? t("audit.rule", { name: ruleName(e, rules) })
      : t("audit.rule_gone")
    : e.actor === "user" ? t("audit.by_you")
    : t("audit.by", { actor: t(e.actor) });

/** `t()` with a tiered fallback: a `prefix.<key>` translation, or the raw key
 *  itself when there is no (yet) translated entry for it. */
export const tOr = (prefix: string, key: string): string => {
  const full = `${prefix}.${key}`;
  const s = t(full);
  return s === full ? key : s;
};

/** The rule actions that have an `audit.act.*` word. */
const RULE_ACTION_TITLE: Record<string, string> = {
  trash: "trash", archive: "archive", move: "move", mark_read: "mark_read",
  purge: "purge",
};

/** The headline of an entry for every action the audit log records
 *  (`backend/auditlog.record` callers): a sentence from action + count +
 *  label, in the interface language. Entries of an unknown action (a newer
 *  release) fall back to the raw action name. */
export function entryText(e: AuditEntry, rules: Rule[]): EntryText {
  const n = e.count;
  const who = whoLine(e, rules);
  const failed = e.outcome === "error" || e.outcome === "failed";
  let label = e.label;
  // A move out of Junk / Trash stores an English label: word it ourselves.
  const role = e.action === "trash" || e.action === "move" ? rescueRole(e) : "";
  if (role) label = t(`undo.from_${role}`, { n });
  const counted = (key: string) =>
    n > 0 ? t(`audit.h.${key}`, { n }) : tOr("audit.act", e.action);
  let title: string;
  let detail = label;
  switch (e.action) {
    case "trash":
      if (role === "junk" && n > 0) {
        title = t("audit.h.trash_junk", { n });
        detail = "";   // the headline names the source
      } else title = counted("trash");
      break;
    case "archive": case "mark_read": case "purge":
      title = counted(e.action);
      break;
    case "move":
      if (role === "junk" && n > 0) {
        title = t("audit.h.move_junk", { n });
        detail = "";
      } else title = counted("move");
      break;
    case "move_contents": {
      const [from, to] = label.split(" \u2192 ");
      if (n > 0 && from && to) {
        title = t("audit.h.move_contents", { n, from, to });
        detail = "";
      } else title = counted("move_contents");
      break;
    }
    case "empty_trash":
      title = counted("empty_trash");
      break;
    case "rule_execute": {
      // the entry is about the rule; the move it caused is its own entry
      const rule = rules.find((r) => `rule:${r.id}` === e.actor);
      const name = ruleName(e, rules) || e.actor.slice(5);
      title = n > 0 ? t("audit.h.rule_execute", { name, n })
        : t("audit.h.rule_execute_none", { name });
      // what the rule does, when it still exists; the name is in the title
      detail = rule && RULE_ACTION_TITLE[rule.action]
        ? tOr("audit.act", rule.action) : "";
      return { title, who: "", detail };
    }
    case "rule_report":
      title = n > 0 ? t("audit.h.rule_report", { n })
        : t("audit.h.rule_report_none");
      detail = "";
      break;
    case "unsubscribe": {
      const key = failed ? "unsubscribe_failed"
        : e.outcome === "link" ? "unsubscribe_link" : "unsubscribe";
      title = label ? t(`audit.h.${key}`, { sender: label })
        : tOr("audit.act", e.action);
      // the address is in the headline: the line says how many mails
      detail = n > 0 ? t("n.mails", { n }) : "";
      break;
    }
    case "undo":
      title = counted("undo");
      break;
    case "digest_sent":
      title = label ? t("audit.h.digest_sent", { to: label })
        : tOr("audit.act", e.action);
      detail = "";
      break;
    default:
      title = `${tOr("audit.act", e.action)}${n > 0
        ? ` · ${t("n.mails", { n })}` : ""}`;
  }
  return { title, who, detail };
}
