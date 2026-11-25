// @vitest-environment jsdom
/* The Senders read across accounts: read once when the page shows, read again
 * when any account's data changed, not read while the page is away, and a read
 * that was overtaken by a newer one never wins. */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SENDERS_RESP } from "./allAccountsFixtures";

const accountsSenders = vi.fn();
vi.mock("./api", () => ({
  api: { accountsSenders: (...a: unknown[]) => accountsSenders(...a) } }));

import { useAllSenders } from "./useAllSenders";

beforeEach(() => accountsSenders.mockReset().mockResolvedValue(SENDERS_RESP));

test("reads once when the page shows; nothing while it is away", async () => {
  const { result, rerender } = renderHook(
    ({ on }) => useAllSenders(on, ""), { initialProps: { on: false } });
  expect(accountsSenders).not.toHaveBeenCalled();
  rerender({ on: true });
  await waitFor(() => expect(result.current.data).toEqual(SENDERS_RESP));
  expect(accountsSenders).toHaveBeenCalledTimes(1);
  rerender({ on: false });
  expect(result.current.data).toBeNull();
});

test("the numbers that follow arriving first are no change; a change in " +
  "any account reads again", async () => {
  const { rerender } = renderHook(
    ({ f }) => useAllSenders(true, f), { initialProps: { f: "" } });
  await waitFor(() => expect(accountsSenders).toHaveBeenCalledTimes(1));
  rerender({ f: "gmail:1,proton:1" });
  await new Promise((r) => setTimeout(r, 30));
  expect(accountsSenders).toHaveBeenCalledTimes(1);
  rerender({ f: "gmail:1,proton:2" });
  await waitFor(() => expect(accountsSenders).toHaveBeenCalledTimes(2));
});

test("a failed read says so; a later read heals it", async () => {
  accountsSenders.mockRejectedValueOnce(new Error("down"));
  const { result } = renderHook(() => useAllSenders(true, ""));
  await waitFor(() => expect(result.current.failed).toBe(true));
  await act(async () => { await result.current.reload(); });
  expect(result.current.failed).toBe(false);
  expect(result.current.data).toEqual(SENDERS_RESP);
});

test("an older read that comes back late does not overwrite a newer one",
  async () => {
  let release: (v: unknown) => void = () => {};
  accountsSenders.mockReset()
    .mockImplementationOnce(() => new Promise((r) => { release = r; }))
    .mockResolvedValueOnce({ ...SENDERS_RESP, senders: [] });
  const { result } = renderHook(() => useAllSenders(true, ""));
  await waitFor(() => expect(accountsSenders).toHaveBeenCalledTimes(1));
  await act(async () => { await result.current.reload(); });
  expect(result.current.data?.senders).toEqual([]);
  await act(async () => { release(SENDERS_RESP); });
  expect(result.current.data?.senders).toEqual([]);
});
