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
