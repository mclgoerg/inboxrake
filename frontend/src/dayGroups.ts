/* Date headings for long mail lists: months (sender detail, Trash and Junk
 * on phones). Dates are the leading YYYY-MM-DD of the mail's ISO date,
 * like `fmtDate`; a mail without a parsable date lands in a group of its own
 * without a heading. */
import { getLang } from "./i18n";

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export interface DateGroup<T> {
  /** "2026-09" / "2026-09-20", or "" when the mails carry no date. */
  key: string;
  /** All the group's mails: callers that page the list pass the whole list
   *  so a count covers what is not rendered yet. */
  items: T[];
}

/** Consecutive items with the same date key (lists are sorted by date, so
 *  "consecutive" is "all of them"; a list sorted otherwise just gets more
 *  groups). `len` = 7 groups by month, 10 by day. */
export function groupByDate<T>(items: T[], isoOf: (x: T) => string,
    len: 7 | 10): DateGroup<T>[] {
  const out: DateGroup<T>[] = [];
  for (const x of items) {
    const iso = isoOf(x) || "";
    const key = DATE.test(iso) ? iso.slice(0, len) : "";
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(x);
    else out.push({ key, items: [x] });
  }
  return out;
}

/** "September 2026" (month and year always: a list reaches back years). */
export function monthHeading(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return "";
  const d = new Date(0);
  d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, 1);
  return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-GB",
    { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}
