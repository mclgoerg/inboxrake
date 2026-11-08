/* Pure helpers of the Activity timeline: the month summary and the month
 * grouping, computed from the audit entries the page already loaded. */

import type { AuditEntry, Rule } from "./types";

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

/** The cleaning done in `now`'s calendar month (local time). `count` of an
 *  entry is what was really affected, so partial / cancelled runs count by
 *  it. Rescues from Junk / Trash and mark-as-read rules are not cleaning. */
export function monthSummary(entries: AuditEntry[], now: Date,
    rules: Rule[] = []): MonthSummary {
  const key = monthKey(now);
  const moved = entries.filter((e) => MOVERS.has(e.action)
    && !FROM_ROLE.test(e.label));
  const counted = entries.filter((e) => {
    if (e.count <= 0 || monthKey(new Date(e.ts * 1000)) !== key) return false;
    if (MOVERS.has(e.action)) return !FROM_ROLE.test(e.label);
    if (e.action !== "rule_execute") return false;
    if (rules.find((r) => `rule:${r.id}` === e.actor)?.action === "mark_read")
      return false;
    return !moved.some((m) => m.actor === e.actor
      && Math.abs(m.ts - e.ts) <= RULE_WINDOW);
  });
  const weeks = [0, 0, 0, 0];
  let mails = 0;
  let bytes = 0;
  for (const e of counted) {
    const day = new Date(e.ts * 1000).getDate();
    weeks[Math.min(3, Math.floor((day - 1) / 7))] += e.count;
    mails += e.count;
    bytes += e.bytes;
  }
  return { mails, bytes, weeks };
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
