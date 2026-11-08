/* Overview helpers: totals, the storage bar and the biggest senders. Pure
 * functions over the Sender groups, so the page and its tests share one
 * definition. */

import type { Group } from "./types";

export interface Totals {
  size: number;
  mails: number;
  senders: number;
}

export const totalsOf = (groups: Group[]): Totals => ({
  size: groups.reduce((n, g) => n + g.size, 0),
  mails: groups.reduce((n, g) => n + g.count, 0),
  senders: groups.length,
});

/** Largest first; ties by mail count, then key, so the order is stable. */
export const biggestSenders = (groups: Group[], n: number): Group[] =>
  [...groups].sort((a, b) => b.size - a.size || b.count - a.count
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, n);

/** One piece of the storage bar. `group` is null for "Everyone else". */
export interface Segment {
  key: string;
  label: string;
  size: number;
  group: Group | null;
  /** Identity hue index; null for "Everyone else". */
  hue: number | null;
}

/** The `n` largest senders plus "Everyone else", summing EXACTLY to the
 *  total (the rest is the difference, never a rounded share). Empty when
 *  nothing has a size; the rest is left out when it is zero. `hueOf` maps a
 *  label to its identity hue (of `hueCount`). */
export function storageSegments(groups: Group[], rest: string, n = 4,
    hueOf: (label: string) => number = () => 0, hueCount = 1): Segment[] {
  const total = totalsOf(groups).size;
  if (total <= 0) return [];
  const top = biggestSenders(groups, n).filter((g) => g.size > 0);
  // A segment whose hue equals its left neighbour's takes the next hue, so
  // neighbours never blend (the legend dot uses the same hue).
  let prev = -1;
  const segs: Segment[] = top.map((g) => {
    let hue = hueOf(g.label);
    if (hueCount > 1 && hue === prev) hue = (hue + 1) % hueCount;
    prev = hue;
    return { key: g.key, label: g.label, size: g.size, group: g, hue };
  });
  const left = total - top.reduce((s, g) => s + g.size, 0);
  if (left > 0)
    segs.push({ key: "", label: rest, size: left, group: null, hue: null });
  return segs;
}

/* ---- the balance card, last-week card and kinds card ---- */

const DAY_MS = 86400000;

/** What the trend pill says: the size now against the scan nearest to a
 *  month back. `month` = the reference is about a month old (21-45 days);
 *  otherwise the UI names the real age in days, so it never claims a month
 *  it does not have. */
export interface Trend {
  dir: "less" | "more" | "same";
  bytes: number;
  days: number;
  month: boolean;
}

/** Below this change the size counts as unchanged. */
const TREND_SAME_BYTES = 100 * 1024;

export function trendOf(ref: { ts: number; size: number } | null,
    sizeNow: number, nowMs: number): Trend | null {
  if (!ref) return null;
  const days = Math.max(1, Math.round((nowMs - ref.ts * 1000) / DAY_MS));
  const delta = sizeNow - ref.size;
  const dir = Math.abs(delta) < TREND_SAME_BYTES ? "same"
    : delta < 0 ? "less" : "more";
  return { dir, bytes: Math.abs(delta), days, month: days >= 21 && days <= 45 };
}

/** Whole percents of `counts` that add up to exactly 100 (largest
 *  remainder); all zeros when there is nothing. */
export function percents(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => 100 * c / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left-- <= 0) break; out[i]++; }
  return out;
}

export interface KindShare {
  /** "newsletter" | "automated" | "other" | a category name */
  kind: string;
  /** True for the folded remainder ("Other" plus the small kinds). */
  rest: boolean;
  count: number;
  pct: number;
}

/** The biggest `head` kinds, the small ones and "other" folded into one
 *  trailing "other" share; percents add up to 100. */
export function kindShares(items: { kind: string; count: number }[],
    head = 5): KindShare[] {
  const named = items.filter((i) => i.kind !== "other" && i.count > 0);
  const top = named.slice(0, head);
  const restCount = items.reduce((n, i) => n + i.count, 0)
    - top.reduce((n, i) => n + i.count, 0);
  const shares = [...top.map((i) => ({ ...i, rest: false })),
    ...(restCount > 0 ? [{ kind: "other", count: restCount, rest: true }]
      : [])];
  const pct = percents(shares.map((s) => s.count));
  return shares.map((s, i) => ({ ...s, pct: pct[i] }));
}

/* ---- the previous visit (per account, this browser) ---- */

/** Leaving and coming back within this is still the same visit. */
export const VISIT_GAP_MS = 30 * 60 * 1000;

export interface VisitRec {
  /** Start of the window "since last visit" shows (ms); null = no earlier
   *  visit was ever recorded. */
  since: number | null;
  /** When the Overview was left last (ms). */
  left: number;
}

export const visitKey = (account: string): string =>
  `pmc_ov_visit:${account}`;

export function loadVisit(account: string): VisitRec | null {
  try {
    const v = JSON.parse(localStorage.getItem(visitKey(account)) ?? "null");
    return v && typeof v.left === "number"
      ? { since: typeof v.since === "number" ? v.since : null, left: v.left }
      : null;
  } catch {
    return null;
  }
}

export function saveVisit(account: string, rec: VisitRec): void {
  try { localStorage.setItem(visitKey(account), JSON.stringify(rec)); }
  catch { /* private mode: no "since last visit" next time */ }
}

/** Where "since last visit" starts when the Overview opens at `now`: the
 *  moment of the previous leave, unless that was under VISIT_GAP_MS ago (a
 *  hop to Senders and back) - then the visit before it still counts. */
export function visitSince(rec: VisitRec | null, now: number): number | null {
  if (!rec) return null;
  return now - rec.left < VISIT_GAP_MS ? rec.since : rec.left;
}

/** The `in:` window (filter term value) of one of the Last-week views, so
 *  the list a row opens covers the window its count did. "Last week" is the
 *  last 7 days; "since last visit" runs from `sinceMs` to `nowMs`, in whole
 *  minutes rounded up (a count never has more than the list it opens). */
export function windowTerm(range: "week" | "since", sinceMs: number | null,
    nowMs: number): string {
  if (range === "week" || sinceMs === null) return "7d";
  const mins = Math.max(1, Math.ceil((nowMs - sinceMs) / 60000));
  return mins % 1440 === 0 ? `${mins / 1440}d`
    : mins % 60 === 0 ? `${mins / 60}h` : `${mins}min`;
}
