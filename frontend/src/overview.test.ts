// @vitest-environment jsdom
import { expect, test } from "vitest";
import { afterEach } from "vitest";
import { biggestSenders, kindShares, loadVisit, percents, saveVisit,
  storageSegments, totalsOf, trendOf, VISIT_GAP_MS, visitSince,
  windowTerm } from "./overview";
import type { Group } from "./types";

const mk = (key: string, size: number, count = 5): Group => ({
  key, label: key, sub: key, count, size, unread: 0, first: "2020-01-01",
  last: "2024-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50,
});

const many = [mk("a", 700), mk("b", 500), mk("c", 300, 9), mk("d", 300, 2),
  mk("e", 100), mk("f", 7), mk("g", 3)];

test("totals add up sizes, mails and senders", () => {
  expect(totalsOf(many)).toEqual({ size: 1910, mails: 36, senders: 7 });
  expect(totalsOf([])).toEqual({ size: 0, mails: 0, senders: 0 });
});

test("biggest senders: by size, ties by mails then key, original untouched", () => {
  const copy = [...many];
  expect(biggestSenders(many, 4).map((g) => g.key)).toEqual(["a", "b", "c", "d"]);
  expect(biggestSenders(many, 99)).toHaveLength(7);
  expect(many).toEqual(copy);
});

test("storage segments: 4 largest + everyone else, summing exactly to the total", () => {
  const segs = storageSegments(many, "Everyone else");
  expect(segs.map((s) => s.key)).toEqual(["a", "b", "c", "d", ""]);
  expect(segs[4]).toMatchObject({ label: "Everyone else", size: 110,
    group: null });
  expect(segs.reduce((n, s) => n + s.size, 0)).toBe(totalsOf(many).size);
});

test("storage segments: no rest entry when four or fewer senders; none when empty", () => {
  const few = [mk("a", 10), mk("b", 5)];
  const segs = storageSegments(few, "Rest");
  expect(segs.map((s) => s.key)).toEqual(["a", "b"]);
  expect(segs.reduce((n, s) => n + s.size, 0)).toBe(15);
  expect(storageSegments([], "Rest")).toEqual([]);
  expect(storageSegments([mk("z", 0)], "Rest")).toEqual([]);
});

test("adjacent segments never share a hue: the second takes the next one", () => {
  const same = () => 3;                       // every label hashes alike
  const segs = storageSegments(many, "Rest", 4, same, 6);
  expect(segs.map((s) => s.hue)).toEqual([3, 4, 3, 4, null]);
  // different hues stay as they are; the wrap-around works
  const byKey = (l: string) => (l === "a" ? 5 : l === "b" ? 5 : 0);
  expect(storageSegments(many, "Rest", 4, byKey, 6).slice(0, 3)
    .map((s) => s.hue)).toEqual([5, 0, 0 + 1]);
});

const DAY = 86400000;
const MB = 1048576;

test("trend: size now against the reference scan, honest about its age", () => {
  const now = 100 * DAY;
  const ref = (days: number, size: number) => ({
    ts: (now - days * DAY) / 1000, size });
  expect(trendOf(null, 5, now)).toBeNull();
  expect(trendOf(ref(30, 100 * MB), 62 * MB, now))
    .toEqual({ dir: "less", bytes: 38 * MB, days: 30, month: true });
  expect(trendOf(ref(30, 100 * MB), 130 * MB, now)?.dir).toBe("more");
  expect(trendOf(ref(30, 100 * MB), 100 * MB + 1000, now)?.dir).toBe("same");
  // a younger history says how old the reference really is
  expect(trendOf(ref(9, 100 * MB), 90 * MB, now))
    .toMatchObject({ days: 9, month: false });
  expect(trendOf(ref(60, 100 * MB), 90 * MB, now)?.month).toBe(false);
  expect(trendOf(ref(0.1, 100 * MB), 90 * MB, now)?.days).toBe(1);
});

test("percents add up to exactly 100", () => {
  expect(percents([1, 1, 1])).toEqual([34, 33, 33]);
  expect(percents([45, 22, 18, 6, 9])).toEqual([45, 22, 18, 6, 9]);
  expect(percents([0, 0])).toEqual([0, 0]);
  expect(percents([1, 999]).reduce((a, b) => a + b, 0)).toBe(100);
});

test("kind shares: the biggest kinds, the rest folded into one Other", () => {
  const items = [
    { kind: "newsletter", count: 40 }, { kind: "shopping", count: 20 },
    { kind: "automated", count: 15 }, { kind: "finance", count: 10 },
    { kind: "travel", count: 5 }, { kind: "social", count: 4 },
    { kind: "other", count: 6 }];
  const s = kindShares(items, 5);
  expect(s.map((x) => x.kind)).toEqual(
    ["newsletter", "shopping", "automated", "finance", "travel", "other"]);
  expect(s.at(-1)).toMatchObject({ rest: true, count: 10, pct: 10 });
  expect(s.reduce((n, x) => n + x.pct, 0)).toBe(100);
  expect(kindShares([], 5)).toEqual([]);
  expect(kindShares([{ kind: "other", count: 3 }], 5))
    .toEqual([{ kind: "other", count: 3, rest: true, pct: 100 }]);
});

afterEach(() => localStorage.clear());

test("since last visit: the previous leave, or the visit before a short hop", () => {
  const t = 1_000_000_000_000;
  expect(visitSince(null, t)).toBeNull();
  // left an hour ago: the window starts there
  expect(visitSince({ since: 5, left: t - 3600_000 }, t)).toBe(t - 3600_000);
  // left a minute ago (Senders and back): the earlier visit still counts
  expect(visitSince({ since: 5, left: t - 60_000 }, t)).toBe(5);
  expect(visitSince({ since: null, left: t - 60_000 }, t)).toBeNull();
  expect(visitSince({ since: 5, left: t - VISIT_GAP_MS }, t)).toBe(t - VISIT_GAP_MS);
});

test("the visit record is per account and tolerates garbage", () => {
  saveVisit("a", { since: 1, left: 2 });
  expect(loadVisit("a")).toEqual({ since: 1, left: 2 });
  expect(loadVisit("b")).toBeNull();
  localStorage.setItem("pmc_ov_visit:c", "nope");
  expect(loadVisit("c")).toBeNull();
  localStorage.setItem("pmc_ov_visit:d", JSON.stringify({ left: 7 }));
  expect(loadVisit("d")).toEqual({ since: null, left: 7 });
});

test("the in: window a Last-week row opens", () => {
  const now = 1_000_000_000_000;
  expect(windowTerm("week", null, now)).toBe("7d");
  expect(windowTerm("week", now - 3600_000, now)).toBe("7d");
  expect(windowTerm("since", null, now)).toBe("7d");
  expect(windowTerm("since", now - 90 * 60_000, now)).toBe("90min");
  expect(windowTerm("since", now - 3 * 3600_000, now)).toBe("3h");
  expect(windowTerm("since", now - 2 * 86400_000, now)).toBe("2d");
  // rounded up: the list never covers less than the count did
  expect(windowTerm("since", now - 90_001, now)).toBe("2min");
  expect(windowTerm("since", now - 100, now)).toBe("1min");
});
