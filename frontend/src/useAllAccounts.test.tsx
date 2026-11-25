// @vitest-environment jsdom
/* useAllAccounts: the numbers, the visit each account's "+N new" counts from,
 * and Scan all - one account after the other, each waited for, one that is
 * busy or fails never stopping the rest. */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ACCOUNTS, DATA, card } from "./allAccountsFixtures";
import { loadVisit, saveVisit } from "./overview";
import type { AllAccountsResp } from "./types";

const overview = vi.fn();
const scan = vi.fn();
vi.mock("./api", () => ({
  api: {
    accountsOverview: (...a: unknown[]) => overview(...a),
    scan: (...a: unknown[]) => scan(...a),
  },
}));
import { POLL_MS, useAllAccounts } from "./useAllAccounts";

const NAMES = ["gmail", "icloud", "proton"];
/** The answer with the given accounts in the given scan status. */
const answer = (status: Record<string, string>,
    failed: string[] = []): AllAccountsResp => ({ ...DATA,
  accounts: NAMES.map((n) => card(n, { status: status[n] ?? "done",
    failed: failed.includes(n) })) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  overview.mockReset().mockResolvedValue(answer({}));
  scan.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms = POLL_MS + 50) =>
  act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test("nothing is fetched while All accounts is not the scope", async () => {
  renderHook(() => useAllAccounts(false, false, NAMES));
  await flush();
  expect(overview).not.toHaveBeenCalled();
});

test("the numbers are fetched when it is the scope, and again when the " +
  "account list changes", async () => {
  const { result, rerender } = renderHook(
    ({ names }) => useAllAccounts(true, false, names),
    { initialProps: { names: NAMES } });
  await flush();
  expect(result.current.data?.accounts).toHaveLength(3);
  expect(overview).toHaveBeenCalledTimes(1);
  rerender({ names: ["gmail", "icloud"] });
  await flush();
  expect(overview).toHaveBeenCalledTimes(2);
});

test("a failed fetch says so and keeps nothing; a retry reads again", async () => {
  overview.mockRejectedValueOnce(new Error("offline"));
  const { result } = renderHook(() => useAllAccounts(true, false, NAMES));
  await flush();
  expect(result.current.failed).toBe(true);
  expect(result.current.data).toBeNull();
  await act(async () => { await result.current.reload(); });
  expect(result.current.failed).toBe(false);
  expect(result.current.data).not.toBeNull();
});

test("the Overview sends each account's remembered visit (seconds); leaving " +
  "records a visit of every account", async () => {
  const day = 86_400_000;
  saveVisit("gmail", { since: null, left: Date.now() - day });
  const { rerender } = renderHook(
    ({ open }) => useAllAccounts(true, open, NAMES),
    { initialProps: { open: true } });
  await flush();
  expect(overview.mock.calls[0][0]).toEqual({
    gmail: Math.floor((Date.now() - day) / 1000) });
  rerender({ open: false });
  await flush();
  // every account in it was visited now
  for (const n of NAMES) expect(loadVisit(n)?.left).toBe(Date.now());
  // and the next fetch of the (closed) Overview carries no marks
  expect(overview.mock.calls.at(-1)?.[0]).toEqual({});
});

test("it polls while a scan runs, and stops when none does", async () => {
  overview.mockResolvedValue(answer({ icloud: "scanning" }));
  renderHook(() => useAllAccounts(true, false, NAMES));
  await flush();
  expect(overview).toHaveBeenCalledTimes(1);
  await tick();
  await tick();
  expect(overview.mock.calls.length).toBeGreaterThanOrEqual(3);
  overview.mockResolvedValue(answer({}));
  await tick();
  const n = overview.mock.calls.length;
  await tick(POLL_MS * 3);
  expect(overview.mock.calls.length).toBe(n);
});

test("Scan all: one account at a time, in order, each waited for", async () => {
  const states: string[] = [];
  overview.mockImplementation(async () => {
    // the scan of an account shows as running for one poll, then is done
    const running = scan.mock.calls.length - 1;
    const doneAfter = overview.mock.calls.length % 2 === 0;
    states.push(`${scan.mock.calls.length}`);
    return answer(running >= 0 && !doneAfter ? { [NAMES[running]]: "scanning" } : {});
  });
  const { result } = renderHook(() => useAllAccounts(true, false, NAMES));
  await flush();
  let outcome: any;
  await act(async () => {
    const p = result.current.scanAll(NAMES).then((r) => { outcome = r; });
    await vi.advanceTimersByTimeAsync(POLL_MS * 12);
    await p;
  });
  expect(scan.mock.calls.map((c) => c[0])).toEqual(NAMES);
  expect(outcome).toEqual({ scanned: NAMES, failed: [], busy: [] });
  expect(result.current.run).toBeNull();
});

test("the run says which account it is on", async () => {
  overview.mockResolvedValue(answer({ gmail: "scanning" }));
  const { result } = renderHook(() => useAllAccounts(true, false, NAMES));
  await flush();
  act(() => { void result.current.scanAll(NAMES); });
  await flush();
  expect(result.current.run).toEqual({ account: "gmail", done: 0, total: 3 });
});

test("an account that is busy or whose scan fails does not stop the rest",
  async () => {
  scan.mockImplementation(async (a: string) => {
    if (a === "gmail") throw new Error("busy");
    return { ok: true };
  });
  overview.mockResolvedValue(answer({}, ["proton"]));   // proton's scan failed
  const { result } = renderHook(() => useAllAccounts(true, false, NAMES));
  await flush();
  let outcome: any;
  await act(async () => {
    const p = result.current.scanAll(NAMES).then((r) => { outcome = r; });
    await vi.advanceTimersByTimeAsync(POLL_MS * 8);
    await p;
  });
  expect(scan.mock.calls.map((c) => c[0])).toEqual(["gmail", "icloud", "proton"]);
  expect(outcome).toEqual({ scanned: ["icloud"], failed: ["proton"],
    busy: ["gmail"] });
});

test("an account removed meanwhile ends its wait", async () => {
  overview.mockResolvedValue({ ...DATA, accounts: [ACCOUNTS[0]] });
  const { result } = renderHook(() => useAllAccounts(true, false, ["gone"]));
  await flush();
  let outcome: any;
  await act(async () => {
    const p = result.current.scanAll(["gone"]).then((r) => { outcome = r; });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    await p;
  });
  expect(outcome.failed).toEqual(["gone"]);
});
