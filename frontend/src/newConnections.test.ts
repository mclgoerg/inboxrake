// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AssistantToken } from "./types";

let listed: Partial<AssistantToken>[] = [];
const fetched = vi.fn();
vi.mock("./api", () => ({
  api: { assistantTokens: () => { fetched(); return Promise.resolve({ tokens: listed }); } },
}));

import { CONNECTION_POLL_MS, useNewConnections } from "./newConnections";

const grant = (id: string): Partial<AssistantToken> => ({
  id, kind: "oauth", client_host: `${id}.example`, level: "read" });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers(); listed = []; fetched.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

test("connections already there at the start are not new; a later one is, once", async () => {
  listed = [grant("old")];
  const onNew = vi.fn();
  renderHook(() => useNewConnections(true, onNew));
  await tick(0);
  expect(onNew).not.toHaveBeenCalled();
  listed = [grant("old"), grant("fresh")];
  await tick(CONNECTION_POLL_MS);
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(onNew.mock.calls[0][0]).toMatchObject({ id: "fresh" });
  await tick(CONNECTION_POLL_MS);
  expect(onNew).toHaveBeenCalledTimes(1);
});

test("static tokens are not connections", async () => {
  const onNew = vi.fn();
  renderHook(() => useNewConnections(true, onNew));
  await tick(0);
  listed = [{ id: "t", kind: "token" }, { id: "u" }];
  await tick(CONNECTION_POLL_MS);
  expect(onNew).not.toHaveBeenCalled();
});

test("it asks nothing while disabled", async () => {
  renderHook(() => useNewConnections(false, vi.fn()));
  await tick(CONNECTION_POLL_MS * 3);
  expect(fetched).not.toHaveBeenCalled();
});

test("it does not look while the page is hidden", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  renderHook(() => useNewConnections(true, vi.fn()));
  await tick(CONNECTION_POLL_MS * 2);
  expect(fetched).not.toHaveBeenCalled();
  hidden.mockRestore();
});

test("it stops when unmounted", async () => {
  const { unmount } = renderHook(() => useNewConnections(true, vi.fn()));
  await tick(0);
  unmount();
  fetched.mockClear();
  await tick(CONNECTION_POLL_MS * 2);
  expect(fetched).not.toHaveBeenCalled();
});
