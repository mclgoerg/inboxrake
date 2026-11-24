// @vitest-environment jsdom
/* The All accounts scope: its remembered choice, the visit marks behind
 * "+N new", and runPerAccount - one step per account, in order, where a step
 * that fails or an account that is gone never stops (or reaches) the others. */

import { afterEach, expect, test, vi } from "vitest";
import { accountGuard, noteAccountSwitch } from "./accountGuard";
import { canScopeAll, loadAllScope, rememberVisit, runPerAccount, saveAllScope,
  SCOPE_KEY, visitMarks, type StepOutcome } from "./allAccounts";
import { loadVisit, saveVisit } from "./overview";

afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

test("the scope is remembered like the current account", () => {
  expect(loadAllScope()).toBe(false);
  saveAllScope(true);
  expect(localStorage.getItem(SCOPE_KEY)).toBe("all");
  expect(loadAllScope()).toBe(true);
  saveAllScope(false);
  expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
  expect(loadAllScope()).toBe(false);
});

test("All accounts needs two mailboxes", () => {
  expect(canScopeAll([])).toBe(false);
  expect(canScopeAll(["one"])).toBe(false);
  expect(canScopeAll(["one", "two"])).toBe(true);
});

test("visit marks: the remembered visit of each account, in seconds; an " +
  "account without one is left out", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  const now = Date.now();
  // left a day ago, long ago enough to be a visit of its own
  saveVisit("one", { since: null, left: now - 86_400_000 });
  expect(visitMarks(["one", "two"])).toEqual({
    one: Math.floor((now - 86_400_000) / 1000) });
});

test("leaving records a visit of every account, from the window it showed",
  () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  rememberVisit(["one", "two"], { one: 1000 });
  expect(loadVisit("one")).toEqual({ since: 1_000_000, left: Date.now() });
  expect(loadVisit("two")).toEqual({ since: null, left: Date.now() });
});

const guard = (over: Partial<Parameters<typeof runPerAccount>[2]> = {}) => ({
  exists: () => true, switched: accountGuard(),
  gone: (a: string) => `gone ${a}`, away: (a: string) => `away ${a}`,
  failed: (a: string, e: unknown) => `failed ${a}: ${(e as Error).message}`,
  ...over });
const done = (account: string): StepOutcome =>
  ({ account, status: "done", text: "ok" });

test("one step per account, one after the other, in the order given", async () => {
  const seen: string[] = [];
  let running = 0, most = 0;
  const out = await runPerAccount(["c", "a", "b"], async (account) => {
    running++; most = Math.max(most, running);
    await Promise.resolve();
    seen.push(account);
    running--;
    return done(account);
  }, guard());
  expect(seen).toEqual(["c", "a", "b"]);
  expect(most).toBe(1);
  expect(out.map((o) => o.account)).toEqual(["c", "a", "b"]);
});

test("a step that fails does not stop the others", async () => {
  const seen: string[] = [];
  const out = await runPerAccount(["a", "b", "c"], async (account) => {
    seen.push(account);
    if (account === "b") throw new Error("server said no");
    return done(account);
  }, guard());
  expect(seen).toEqual(["a", "b", "c"]);
  expect(out.map((o) => o.status)).toEqual(["done", "failed", "done"]);
  expect(out[1].text).toBe("failed b: server said no");
});

test("an account that is gone is reported and never acted on", async () => {
  const step = vi.fn(async (a: string) => done(a));
  const out = await runPerAccount(["a", "b", "c"], step,
    guard({ exists: (a) => a !== "b" }));
  expect(step.mock.calls.map((c) => c[0])).toEqual(["a", "c"]);
  expect(out[1]).toEqual({ account: "b", status: "skipped", text: "gone b" });
});

test("a switch of view stands every account not yet run down", async () => {
  const step = vi.fn(async (a: string) => {
    if (a === "a") noteAccountSwitch();       // the user left during the first
    return done(a);
  });
  const out = await runPerAccount(["a", "b", "c"], step, guard());
  expect(step.mock.calls.map((c) => c[0])).toEqual(["a"]);
  expect(out.map((o) => o.status)).toEqual(["done", "skipped", "skipped"]);
  expect(out[2].text).toBe("away c");
});

test("progress is reported around each step", async () => {
  const events: string[] = [];
  await runPerAccount(["a", "b"], async (a) => done(a), guard(),
    (account, at) => events.push(`${at}:${account}`));
  expect(events).toEqual(["start:a", "end:a", "start:b", "end:b"]);
});
