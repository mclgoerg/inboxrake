import { expect, test } from "vitest";
import { cleanedWeeks, entriesSince, groupByMonth, localIso, monthSummary,
  undoneCounts, weekBucket, weekRanges } from "./activity";
import type { AuditEntry } from "./types";

const at = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12).getTime() / 1000;
const e = (ts: number, over: Partial<AuditEntry> = {}): AuditEntry => ({
  ts, account: "a", actor: "user", action: "trash", count: 10, bytes: 1000,
  label: "", outcome: "ok", error: "", ...over });
const now = new Date(2026, 9, 20, 12);

test("sums this month's cleaning per week, ignoring empty runs and other months", () => {
  const s = monthSummary([
    e(at(2026, 10, 2)), e(at(2026, 10, 9), { action: "archive", count: 5 }),
    e(at(2026, 10, 30), { count: 1 }),
    e(at(2026, 10, 3), { outcome: "error", count: 0 }),
    e(at(2026, 10, 3), { action: "unsubscribe", count: 1 }),
    e(at(2026, 9, 28)),
  ], now);
  expect(s.weeks).toEqual([10, 5, 0, 1]);
  expect(s.mails).toBe(16);
  expect(s.bytes).toBe(3000);
});

test("a rule run is not counted twice with its own move entry", () => {
  const t0 = at(2026, 10, 5);
  const s = monthSummary([
    e(t0, { action: "rule_execute", actor: "rule:r1", count: 7, bytes: 0 }),
    e(t0 - 5, { actor: "rule:r1", count: 7 }),
    e(at(2026, 10, 6), { action: "rule_execute", actor: "rule:r2", count: 3,
      bytes: 0 }),
  ], now);
  expect(s.mails).toBe(10);
});

test("groups consecutive entries by month", () => {
  const g = groupByMonth([e(at(2026, 10, 9)), e(at(2026, 10, 1)),
    e(at(2026, 9, 30))]);
  expect(g.map((m) => m.entries.length)).toEqual([2, 1]);
});

test("localIso is the local date and time", () => {
  expect(localIso(new Date(2026, 9, 5, 7, 8).getTime() / 1000))
    .toBe("2026-10-05T07:08");
});

test("rescues from Junk / Trash and mark-as-read rules are not cleaning", () => {
  const t0 = at(2026, 10, 5);
  const s = monthSummary([
    e(t0, { action: "move", label: "3 mails from Junk", count: 3 }),
    e(t0, { action: "rule_execute", actor: "rule:r9", count: 8, bytes: 0 }),
    e(t0, { count: 2 }),
  ], now, [{ id: "r9", action: "mark_read" } as any]);
  expect(s.mails).toBe(2);
});

test("a partial or cancelled run counts by what it really affected", () => {
  const s = monthSummary([
    e(at(2026, 10, 5), { outcome: "partial", count: 4 }),
    e(at(2026, 10, 6), { outcome: "cancelled", count: 6 }),
    e(at(2026, 10, 7), { outcome: "error", count: 0 }),
  ], now);
  expect(s.mails).toBe(10);
});

test("mails restored by an undo are subtracted from the month", () => {
  const s = monthSummary([
    e(at(2026, 10, 2), { id: "a", count: 10, bytes: 1000 }),
    e(at(2026, 10, 3), { id: "b", count: 4, bytes: 400 }),
    e(at(2026, 10, 4), { action: "undo", id: "u1", count: 4, bytes: 0,
      undoes: { id: "b", count: 4 } }),
    e(at(2026, 10, 5), { action: "undo", id: "u2", count: 5, bytes: 0,
      undoes: { id: "a", count: 5 } }),
  ], now);
  expect(s.mails).toBe(5);
  expect(s.bytes).toBe(500);
  expect(s.weeks).toEqual([5, 0, 0, 0]);
});

test("the same undo entry listed twice is counted once", () => {
  const u = e(at(2026, 10, 4), { action: "undo", id: "u1",
    undoes: { id: "a", count: 3 } });
  expect(undoneCounts([u, u]).get("a")).toBe(3);
});

test("from_role marks a rescue without the label text", () => {
  const s = monthSummary([
    e(at(2026, 10, 5), { action: "move", label: "whatever", count: 3,
      from_role: "junk" }),
    e(at(2026, 10, 6), { count: 2 }),
  ], now);
  expect(s.mails).toBe(2);
});

test("an undo that restores more than the entry had never makes a negative", () => {
  const s = monthSummary([
    e(at(2026, 10, 2), { id: "a", count: 3, bytes: 300 }),
    e(at(2026, 10, 3), { action: "undo", id: "u1", undoes: { id: "a", count: 9 } }),
    e(at(2026, 10, 4), { count: 2, bytes: 200 }),
  ], now);
  expect(s.mails).toBe(2);
  expect(s.weeks).toEqual([2, 0, 0, 0]);
  expect(s.bytes).toBe(200);
});

test("an undone rule move does not let the rule run count instead", () => {
  const t0 = at(2026, 10, 5);
  const s = monthSummary([
    e(t0, { action: "rule_execute", actor: "rule:r1", count: 7, bytes: 0 }),
    e(t0 - 5, { id: "m", actor: "rule:r1", count: 7 }),
    e(t0 + 60, { action: "undo", id: "u1", undoes: { id: "m", count: 7 } }),
  ], now);
  expect(s.mails).toBe(0);
});

const DAY = 86400;
const NOW = at(2026, 10, 20);

test("cleaned mails per rolling 7-day bucket by the month card's rules", () => {
  const t0 = NOW - 3 * DAY;
  const w = cleanedWeeks([
    e(NOW - 1 * DAY, { count: 4 }), e(NOW - 6.9 * DAY, { count: 1 }),
    e(NOW - 8 * DAY, { action: "archive", count: 5 }),
    e(NOW - 55 * DAY, { count: 2 }),
    e(NOW - 57 * DAY, { count: 99 }),                       // too old
    e(NOW - DAY, { action: "move", label: "3 mails from Junk", count: 3 }),
    e(NOW - DAY, { action: "unsubscribe", count: 7 }),
    e(NOW - DAY, { outcome: "error", count: 0 }),
    // a rule run and its own move entry count once
    e(t0, { action: "rule_execute", actor: "rule:r1", count: 6, bytes: 0 }),
    e(t0 - 5, { actor: "rule:r1", count: 6 }),
  ], NOW);
  expect(w).toEqual([2, 0, 0, 0, 0, 0, 5, 4 + 1 + 6]);
  expect(w.reduce((a, b) => a + b, 0)).toBe(2 + 5 + 4 + 1 + 6);
});

test("weekBucket: the last bucket is the 7 days up to now", () => {
  expect(weekBucket(0)).toBe(7);
  expect(weekBucket(-30)).toBe(7);
  expect(weekBucket(7 * DAY - 1)).toBe(7);
  expect(weekBucket(7 * DAY)).toBe(6);
  expect(weekBucket(56 * DAY - 1)).toBe(0);
  expect(weekBucket(56 * DAY)).toBe(-1);
});

test("entriesSince pages back until the window is covered", async () => {
  const log = Array.from({ length: 7 }, (_, i) => e(1000 - i * 100));
  const page = async (offset: number, limit: number) => ({
    total: log.length, entries: log.slice(offset, offset + limit) });
  const a = await entriesSince(page, 750, 6, 3);       // 3 + 3 pages of 3
  expect(a.entries).toHaveLength(3 + 3);
  expect(a.complete).toBe(true);                       // ts 500 < 750
  const b = await entriesSince(page, 0, 2, 3);         // the cap cuts it
  expect(b.entries).toHaveLength(6);
  expect(b.complete).toBe(false);
  const c = await entriesSince(page, 0, 6, 3);         // log ends first
  expect(c.entries).toHaveLength(7);
  expect(c.complete).toBe(true);
});

test("the weekly balance subtracts what an undo restored, like the month", () => {
  const w = cleanedWeeks([
    e(NOW - 2 * DAY, { id: "a", count: 10, bytes: 1000 }),
    e(NOW - 1 * DAY, { action: "undo", id: "u", count: 4, bytes: 0,
      undoes: { id: "a", count: 4 } }),
    // a rescue marked by from_role, whatever its label says
    e(NOW - 1 * DAY, { action: "move", from_role: "junk", label: "x",
      count: 9 }),
  ], NOW);
  expect(w[7]).toBe(6);
});

test("splits the month by rules / by you and counts the unsubscribes", () => {
  const s = monthSummary([
    e(at(2026, 10, 5), { action: "rule_execute", actor: "rule:r1", count: 7,
      bytes: 0 }),
    e(at(2026, 10, 6), { count: 2 }),
    e(at(2026, 10, 6), { action: "unsubscribe", count: 1, outcome: "done" }),
    e(at(2026, 10, 7), { action: "unsubscribe", count: 1, outcome: "ok" }),
    e(at(2026, 10, 7), { action: "unsubscribe", count: 1, outcome: "failed" }),
    e(at(2026, 10, 8), { action: "unsubscribe", count: 1, outcome: "link" }),
    e(at(2026, 9, 8), { action: "unsubscribe", count: 1, outcome: "done" }),
  ], now);
  expect([s.byRules, s.byYou, s.mails]).toEqual([7, 2, 9]);
  expect(s.unsubscribed).toBe(2);
});

test("the week ranges of a month end on its last day", () => {
  expect(weekRanges(new Date(2026, 1, 10))).toEqual(
    [[1, 7], [8, 14], [15, 21], [22, 28]]);
  expect(weekRanges(new Date(2026, 9, 10))[3]).toEqual([22, 31]);
});
