// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import type { Group } from "./types";

const unsubscribe = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { unsubscribe: (...a: unknown[]) => unsubscribe(...a) },
}));

import { retryableGroup, unsubscribeGroup } from "./unsub";

const mk = (over: Partial<Group> = {}): Group => ({
  key: "a@x.example", label: "a", sub: "", count: 1, size: 1, unread: 0,
  first: "", last: "", tags: [], samples: [], bulk: false, unsub: true,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: { n: 1, of: 1, status: "failed", link: "", addr: "" },
  new: false, pinned: 0, engagement: 0, ...over,
});

afterEach(() => vi.clearAllMocks());

test("retryableGroup: only an existing, unsubscribable, unfinished sender", () => {
  const g = mk();
  expect(retryableGroup({ [g.key]: g }, g.key)).toBe(g);
  expect(retryableGroup({ [g.key]: g }, "gone@x.example")).toBeNull();
  expect(retryableGroup({ [g.key]: g }, "")).toBeNull();
  expect(retryableGroup(undefined, g.key)).toBeNull();
  const noMethod = mk({ unsub: false });
  expect(retryableGroup({ [g.key]: noMethod }, g.key)).toBeNull();
  const done = mk({ unsubscribed: { n: 1, of: 1, status: "done", link: "",
    addr: "" } });
  expect(retryableGroup({ [g.key]: done }, g.key)).toBeNull();
});

test("unsubscribeGroup calls the same API and words the result", async () => {
  unsubscribe.mockResolvedValue({ action: "mailto", method: "mailto" });
  const r = await unsubscribeGroup("sender", mk(), false);
  expect(unsubscribe).toHaveBeenCalledWith("sender", "a@x.example");
  expect(r).toEqual({ ok: true, message: "Unsubscribed (mailto)." });
});

test("unsubscribeGroup turns an error into a message, never throws",
  async () => {
  unsubscribe.mockRejectedValue(new Error("boom"));
  const r = await unsubscribeGroup("sender", mk(), false);
  expect(r.ok).toBe(false);
  expect(r.message).toContain("boom");
});
