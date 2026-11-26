// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { canOpenAllAccounts, runPerAccount, visitMarks,
  type StepOutcome } from "./allAccounts";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 26, 12)); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

test("the page is offered from two accounts up", () => {
  expect(canOpenAllAccounts([])).toBe(false);
  expect(canOpenAllAccounts(["one"])).toBe(false);
  expect(canOpenAllAccounts(["one", "two"])).toBe(true);
});

test("+N new counts from each account's own remembered visit, and only reads it", () => {
  const long = Date.now() - 3 * 3600 * 1000;
  localStorage.setItem("pmc_ov_visit:one",
    JSON.stringify({ since: null, left: long }));
  const before = JSON.stringify(Object.entries(localStorage));
  const marks = visitMarks(["one", "two"]);
  // account one left its Overview 3 h ago: it counts from then; two has no
  // visit yet and is left out (the backend counts its last week)
  expect(marks).toEqual({ one: Math.floor(long / 1000) });
  // looking at the page is no visit: nothing was written
  expect(JSON.stringify(Object.entries(localStorage))).toBe(before);
});

const guard = (over: Partial<Parameters<typeof runPerAccount>[2]> = {}) => ({
  exists: () => true, switched: () => false,
  gone: (a: string) => `${a} gone`, away: (a: string) => `${a} away`,
  failed: (a: string, e: unknown) => `${a} failed: ${(e as Error).message}`,
  ...over });
const ok = (account: string): StepOutcome => ({ account, status: "done",
  text: "ok" });

test("one step per ticked account, in order, and nothing for the others", async () => {
  const step = vi.fn(async (a: string) => ok(a));
  const out = await runPerAccount(["b", "a"], step, guard());
  expect(step.mock.calls.map((c) => c[0])).toEqual(["b", "a"]);
  expect(out.map((o) => o.status)).toEqual(["done", "done"]);
});

test("a step that fails does not stop the next one", async () => {
  const step = vi.fn(async (a: string) => {
    if (a === "a") throw new Error("down");
    return ok(a);
  });
  const out = await runPerAccount(["a", "b"], step, guard());
  expect(out).toEqual([
    { account: "a", status: "failed", text: "a failed: down" }, ok("b")]);
});

test("an account removed meanwhile is skipped and said so, never acted on", async () => {
  const step = vi.fn(async (a: string) => ok(a));
  const out = await runPerAccount(["a", "b"], step,
    guard({ exists: (a) => a !== "a" }));
  expect(step.mock.calls.map((c) => c[0])).toEqual(["b"]);
  expect(out[0]).toEqual({ account: "a", status: "skipped", text: "a gone" });
});

test("after a switch of the selected account the rest stand down", async () => {
  let switched = false;
  const step = vi.fn(async (a: string) => { switched = true; return ok(a); });
  const out = await runPerAccount(["a", "b", "c"], step,
    guard({ switched: () => switched }));
  expect(step.mock.calls.map((c) => c[0])).toEqual(["a"]);
  expect(out.map((o) => o.status)).toEqual(["done", "skipped", "skipped"]);
});
