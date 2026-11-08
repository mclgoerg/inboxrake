import { expect, test } from "vitest";
import { groupByMonth, localIso, monthSummary, undoneCounts } from "./activity";
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
