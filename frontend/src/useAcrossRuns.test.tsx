// @vitest-environment jsdom
/* What the All accounts page starts and the app follows after the page is
 * gone: the one toast of a Trash / Archive queued in several accounts ("Undo
 * all N"), a failure toast per account when a job ends with an error later,
 * and Scan all. Nothing here selects an account: every call carries its own. */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const overviewCall = vi.fn();
const undoCall = vi.fn();
const scanCall = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { accountsOverview: (...a: unknown[]) => overviewCall(...a),
    undo: (...a: unknown[]) => undoCall(...a),
    scan: (...a: unknown[]) => scanCall(...a) },
}));

import { setLang } from "./i18n";
import { card, overview } from "./allAccountsFixtures";
import { CLAIM_GRACE_MS, FOLLOW_MS, POLL_MS, stepKey, useAcrossRuns }
  from "./useAcrossRuns";
import type { AllAccountCard, AllAccountsResp } from "./types";

const step = (id: string, count: number) => ({ id, ts: 5, label: "Deals Daily",
  count, action: "trash" });
const rowsOf = (over: Record<string, Partial<AllAccountCard>>):
    AllAccountsResp => overview({ accounts: ["work", "proton", "old"].map(
  (n) => card(n, over[n] ?? {})) });

const toast = vi.fn((_m: string, _o?: unknown) => 1);
const onChanged = vi.fn();
const hook = (names = ["work", "proton", "old"]) => renderHook(() =>
  useAcrossRuns({ toast, names, onChanged }));

beforeEach(() => { setLang("en"); vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  for (const f of [overviewCall, undoCall, scanCall, toast, onChanged]) f.mockReset();
  setLang("en");
});

const settle = (ms = 10) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test("a move in three accounts ends in ONE toast with Undo all 3", async () => {
  const { result } = hook();
  overviewCall.mockResolvedValueOnce(rowsOf({ work: { busy: true },
    proton: { busy: true }, old: { busy: true } }));
  overviewCall.mockResolvedValue(rowsOf({
    work: { undo_last: step("w2", 210) }, proton: { undo_last: step("p2", 93) },
    old: { undo_last: step("o2", 36) } }));
  act(() => result.current.follow({ kind: "trash",
    accounts: ["work", "proton", "old"],
    before: { work: "w1", proton: null, old: "o1" } }));
  // while the jobs run the selected account's own toast stays quiet
  expect([...result.current.claimed.current]).toEqual(["work", "proton", "old"]);
  await settle();
  expect(toast).not.toHaveBeenCalled();
  await settle(POLL_MS + 10);
  expect(toast).toHaveBeenCalledTimes(1);
  const [text, opts] = toast.mock.calls[0] as [string,
    { action: { label: string; onClick: () => void } }];
  expect(text).toBe("Moved 339 mails to Trash in 3 accounts");
  expect(opts.action.label).toBe("Undo all 3");
  expect(onChanged).toHaveBeenCalledWith(["work", "proton", "old"]);
  // the app's own toast for the selected account stays quiet a little longer
  // (its state may arrive after this one), then the claim is let go
  expect(result.current.claimed.current.size).toBe(3);
  await settle(CLAIM_GRACE_MS + 10);
  expect(result.current.claimed.current.size).toBe(0);
});

test("Undo all undoes each account's own step, by identity, in its own account", async () => {
  const { result } = hook();
  overviewCall.mockResolvedValue(rowsOf({
    work: { undo_last: step("w2", 210) }, proton: { undo_last: step("p2", 93) } }));
  undoCall.mockResolvedValue({ restored: 100, of: 100, rescan: true });
  act(() => result.current.follow({ kind: "trash", accounts: ["work", "proton"],
    before: { work: "w1", proton: "p1" } }));
  await settle();
  const opts = toast.mock.calls[0][1] as { action: { onClick: () => void } };
  toast.mockClear();
  await act(async () => { opts.action.onClick(); await vi.advanceTimersByTimeAsync(10); });
  expect(undoCall.mock.calls).toEqual([
    [-1, { ts: 5, label: "Deals Daily", count: 210, id: "w2" }, "work"],
    [-1, { ts: 5, label: "Deals Daily", count: 93, id: "p2" }, "proton"]]);
  expect(toast.mock.calls[0][0]).toBe("Restored 200 mails in 2 accounts");
});

test("an account whose Undo fails is named; the others are still undone", async () => {
  const { result } = hook();
  overviewCall.mockResolvedValue(rowsOf({
    work: { undo_last: step("w2", 5) }, proton: { undo_last: step("p2", 5) } }));
  undoCall.mockImplementation((_i: number, _id: unknown, account: string) =>
    account === "work" ? Promise.reject(new Error("nothing to undo"))
      : Promise.resolve({ restored: 5, of: 5, rescan: true }));
  act(() => result.current.follow({ kind: "archive", accounts: ["work", "proton"],
    before: {} }));
  await settle();
  expect(toast.mock.calls[0][0]).toBe("Archived 10 mails in 2 accounts");
  const opts = toast.mock.calls[0][1] as { action: { onClick: () => void } };
  toast.mockClear();
  await act(async () => { opts.action.onClick(); await vi.advanceTimersByTimeAsync(10); });
  expect(toast.mock.calls.map((c) => c[0])).toEqual([
    expect.stringContaining("Couldn't undo in work:"),
    "Restored 5 mails in 1 account"]);
  expect(undoCall).toHaveBeenCalledTimes(2);
});

test("claim quiets and restores the selected account's own toast", () => {
  const { result } = hook();
  act(() => result.current.claim(["work", "proton"], true));
  expect([...result.current.claimed.current]).toEqual(["work", "proton"]);
  act(() => result.current.claim(["proton"], false));
  expect([...result.current.claimed.current]).toEqual(["work"]);
});

test("the step an earlier move made is not mistaken for this one", async () => {
  const { result } = hook();
  // proton's newest step is the same as before: its job moved nothing
  overviewCall.mockResolvedValue(rowsOf({
    work: { undo_last: step("w2", 10) }, proton: { undo_last: step("p1", 7) } }));
  act(() => result.current.follow({ kind: "trash", accounts: ["work", "proton"],
    before: { work: "w1", proton: stepKey(step("p1", 7)) } }));
  await settle();
  expect(toast.mock.calls[0][0]).toBe("Moved 10 mails to Trash in 1 account");
  expect((toast.mock.calls[0][1] as { action: { label: string } }).action.label)
    .toBe("Undo");
});

test("a job that ends with an error says so per account, and still toasts the others", async () => {
  const { result } = hook();
  overviewCall.mockResolvedValue(rowsOf({
    work: { undo_last: step("w2", 10) },
    proton: { job_failed: { id: "d9", error: "Connection lost" } } }));
  act(() => result.current.follow({ kind: "trash", accounts: ["work", "proton"],
    before: { work: "w1", proton: "p1" } }));
  await settle();
  const texts = toast.mock.calls.map((c) => c[0]);
  expect(texts).toContain("The step in proton did not finish: Connection lost");
  expect(texts).toContain("Moved 10 mails to Trash in 1 account");
  expect(toast.mock.calls.find((c) => String(c[0]).includes("proton"))![1])
    .toMatchObject({ variant: "error" });
});

test("nothing moved: one quiet line, no Undo", async () => {
  const { result } = hook();
  overviewCall.mockResolvedValue(rowsOf({}));
  act(() => result.current.follow({ kind: "trash", accounts: ["work"],
    before: { work: null } }));
  await settle();
  expect(toast.mock.calls[0][0]).toBe(
    "Nothing was moved - the mails are protected or already gone.");
  expect(toast.mock.calls[0][1]).toMatchObject({ variant: "info" });
});

test("it keeps asking while a job runs, and gives up after a while", async () => {
  const { result } = hook();
  overviewCall.mockResolvedValue(rowsOf({ work: { busy: true } }));
  act(() => result.current.follow({ kind: "trash", accounts: ["work"],
    before: { work: null } }));
  await settle(POLL_MS * 3 + 10);
  expect(overviewCall.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(result.current.claimed.current.has("work")).toBe(true);
  await settle(FOLLOW_MS + POLL_MS);
  expect(toast).not.toHaveBeenCalled();
  expect(result.current.claimed.current.size).toBe(0);
});

test("Scan all: one account after the other, each waited for, then one toast", async () => {
  const { result } = hook();
  scanCall.mockResolvedValue({ ok: true });
  let polls = 0;
  overviewCall.mockImplementation(() => Promise.resolve(rowsOf({
    work: { status: polls++ < 1 ? "scanning" : "done" } })));
  let done: Promise<void> = Promise.resolve();
  act(() => { done = result.current.scanAll(["work", "proton"]); });
  await settle(10);
  expect(scanCall.mock.calls).toEqual([["work"]]);        // not side by side
  expect(result.current.scanRun).toEqual({ account: "work", done: 0, total: 2 });
  await settle(POLL_MS * 3);
  await act(async () => { await done; });
  expect(scanCall.mock.calls.map((c) => c[0])).toEqual(["work", "proton"]);
  expect(result.current.scanRun).toBeNull();
  expect(toast.mock.calls.at(-1)![0]).toBe("Scanned 2 accounts.");
  expect(onChanged).toHaveBeenCalledWith(["work", "proton"]);
});

test("Scan all: a busy or failing account does not stop the rest and is named", async () => {
  const { result } = hook();
  scanCall.mockImplementation((account: string) => account === "work"
    ? Promise.reject(new Error("busy")) : account === "proton"
      ? Promise.reject(new Error("boom")) : Promise.resolve({ ok: true }));
  overviewCall.mockResolvedValue(rowsOf({}));
  let done: Promise<void> = Promise.resolve();
  act(() => { done = result.current.scanAll(["work", "proton", "old"]); });
  await settle(POLL_MS + 10);
  await act(async () => { await done; });
  expect(scanCall).toHaveBeenCalledTimes(3);
  expect(toast.mock.calls.at(-1)![0]).toBe(
    "Scanned 1 of 3 accounts - 1 failed: proton.");
});

test("Scan all leaves out an account that was removed", async () => {
  const { result } = hook(["work"]);
  scanCall.mockResolvedValue({ ok: true });
  overviewCall.mockResolvedValue(rowsOf({}));
  let done: Promise<void> = Promise.resolve();
  act(() => { done = result.current.scanAll(["work", "gone"]); });
  await settle(POLL_MS + 10);
  await act(async () => { await done; });
  expect(scanCall.mock.calls.map((c) => c[0])).toEqual(["work"]);
});
