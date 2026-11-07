import { expect, test } from "vitest";
import { biggestSenders, storageSegments, totalsOf } from "./overview";
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
