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
}

/** The `n` largest senders plus "Everyone else", summing EXACTLY to the
 *  total (the rest is the difference, never a rounded share). Empty when
 *  nothing has a size; the rest is left out when it is zero. */
export function storageSegments(groups: Group[], rest: string, n = 4):
    Segment[] {
  const total = totalsOf(groups).size;
  if (total <= 0) return [];
  const top = biggestSenders(groups, n).filter((g) => g.size > 0);
  const segs: Segment[] = top.map((g) => ({ key: g.key, label: g.label,
    size: g.size, group: g }));
  const left = total - top.reduce((s, g) => s + g.size, 0);
  if (left > 0) segs.push({ key: "", label: rest, size: left, group: null });
  return segs;
}
