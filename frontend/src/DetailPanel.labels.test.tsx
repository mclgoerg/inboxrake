// @vitest-environment jsdom
/* Where "Edit labels" lives in the detail panel: on ONE sender (a Sender row,
 * the Smart row of one sender), never on pools / domains / subjects / threads;
 * the pill says "set by you"; a capped row says why. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import type { Group } from "./types";

const labels = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: {
    group: () => Promise.resolve([]),
    labels: (k: string) => labels(k),
    labelsPut: vi.fn(),
    knowledge: () => Promise.resolve({ entries: [], complete: true,
      unscanned: [], categories: [], max: 5000, ai_running: false }),
  } };
});

import { DetailPanel } from "./components/DetailPanel";
import { DialogProvider } from "./components/ui";

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "s@x.example", label: "Sender", sub: "s@x.example",
  count: 2, size: 2000, unread: 0, first: "2025-01-01", last: "2025-01-02",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 50, ...over,
});

const mount = (grouping: "sender" | "domain" | "smart", group: Group,
    saved: (() => void) | null = () => {}) => render(
  <DialogProvider>
    <DetailPanel grouping={grouping} group={group} aiEnabled={false}
      protectedNow={false} unsubscribedNow={null}
      onTrash={async () => true} folders={[]} sieve={false}
      onClose={() => {}} onDeleted={() => {}} onLabelsSaved={saved ?? undefined}
      labelSender={mkGroup()} categories={[]} />
  </DialogProvider>);

beforeEach(() => {
  setLang("en");
  labels.mockReset().mockResolvedValue({ key: "s@x.example", verdict: null,
    tags: null, tags_now: [], auto_tags: [], ai: null, protected: false,
    suggestions: [] });
});
afterEach(cleanup);

describe("Edit labels in the detail header", () => {
  it("is on a Sender row and opens the sheet for that sender", async () => {
    mount("sender", mkGroup());
    fireEvent.click(screen.getByRole("button", { name: "Edit labels" }));
    await waitFor(() => expect(labels).toHaveBeenCalledWith("s@x.example"));
    expect(await screen.findByRole("dialog", { name: "" })).toBeTruthy();
    expect(screen.getByText("Verdict")).toBeTruthy();
  });

  it("is on the Smart row that stands for one sender (by its address)",
    async () => {
      mount("smart", mkGroup({ key: "s:s@x.example", kind: "sender",
        addr: "s@x.example" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit labels" }));
      await waitFor(() => expect(labels).toHaveBeenCalledWith("s@x.example"));
    });

  it("is not on a pooled Smart row or a domain row", () => {
    mount("smart", mkGroup({ key: "k:other", kind: "other", n_senders: 4 }));
    expect(screen.queryByRole("button", { name: "Edit labels" })).toBeNull();
    cleanup();
    mount("domain", mkGroup({ key: "x.example" }));
    expect(screen.queryByRole("button", { name: "Edit labels" })).toBeNull();
  });

  it("is not offered where nobody can reload the state afterwards", () => {
    mount("sender", mkGroup(), null);
    expect(screen.queryByRole("button", { name: "Edit labels" })).toBeNull();
  });

  it("shows '<verdict> · set by you' for a verdict the user set", () => {
    mount("sender", mkGroup({ ai: { verdict: "keep", reason: "",
      src: "user" } }));
    expect(screen.getByText("Keep · set by you")).toBeTruthy();
  });

  it("says in words when a row's 'safe' is capped by a sender on hold", () => {
    mount("domain", mkGroup({ key: "x.example", ai: { verdict: "review",
      reason: "r", capped: "user" } }));
    expect(screen.getByText("Capped: contains a sender you put on hold"))
      .toBeTruthy();
  });
});
