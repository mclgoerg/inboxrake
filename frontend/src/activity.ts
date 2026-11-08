/* Pure helpers of the Activity timeline: the month summary and the month
 * grouping, computed from the audit entries the page already loaded. */

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
}

const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();

/** A move OUT of Junk / Trash ("Not junk", restore): the audit label is the
 *  undo label "N mails from Junk|Trash". That is rescuing, not cleaning. */
const FROM_ROLE = /^\d+ mails? from (Junk|Trash)$/;

/** Rescue = a move out of Junk / Trash: `from_role` on newer entries, the
 *  label text only as the fallback for old ones. */
const isRescue = (e: AuditEntry): boolean =>
  !!e.from_role || FROM_ROLE.test(e.label);

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
interface Cleaned { ts: number; n: number; bytes: number }

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
    out.push({ ts: e.ts, n, bytes: Math.round(e.bytes * n / e.count) });
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
  for (const c of cleaning(entries, rules)) {
    if (monthKey(new Date(c.ts * 1000)) !== key) continue;
    const day = new Date(c.ts * 1000).getDate();
    weeks[Math.min(3, Math.floor((day - 1) / 7))] += c.n;
    mails += c.n;
    bytes += c.bytes;
  }
  return { mails, bytes, weeks };
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
