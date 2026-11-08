// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AppState, Group } from "./types";

const stats = vi.fn();
const trackers = vi.fn();
const audit = vi.fn();
const wrapped = vi.fn();
const duplicates = vi.fn();
const sum = (o: object) => ({ sets: 0, wasted: 0, versions: 0, possible: 0,
  ...o });
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { duplicatesSummary: () => duplicates(), stats: () => stats(), trackers: () => trackers(),
    wrapped: () => wrapped(),
    audit: (...a: unknown[]) => audit(...a) },
}));

import { CleanupPage, InsightsPage } from "./components/TabPages";

const MB = 1048576;
const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: key, sub: key, count: 20, size: 2 * MB, unread: 0,
  first: "2020-01-01", last: "2024-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50, ...over,
});
const state = (over: Partial<AppState> = {}) => ({
  status: "done", rules: [], junk_count: 11, trash_count: 70, ...over,
}) as unknown as AppState;

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
beforeEach(() => { duplicates.mockRejectedValue(new Error("x")); wrapped.mockRejectedValue(new Error("x")); });

const cleanupProps = (over = {}) => ({
  account: "a", groups: [] as Group[], state: state(), deckSize: 0,
  triageDisabled: false, aiShown: true, aiDisabled: false,
  onOpen: vi.fn(), onReviewAi: vi.fn(), ...over,
});

test("Clean up: every tool is reachable and opens its tool", () => {
  const p = cleanupProps();
  render(<CleanupPage {...p} />);
  for (const [name, tool] of [["Triage", "triage"], ["Duplicates",
    "duplicates"], ["Attachments", "attachments"], ["Rules", "rules"],
    ["Junk", "junk"], ["Trash", "trash"]] as const) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
    expect(p.onOpen).toHaveBeenLastCalledWith(tool);
  }
  fireEvent.click(screen.getByRole("button", { name: /^AI review/ }));
  expect(p.onReviewAi).toHaveBeenCalled();
});

test("Clean up: live numbers where known, Check where a run is needed", async () => {
  render(<CleanupPage {...cleanupProps()} />);
  const dup = screen.getByRole("button", { name: /^Duplicates/ });
  await waitFor(() => expect(dup.textContent).toContain("Check"));
  expect(screen.getByRole("button", { name: /^Junk/ }).textContent)
    .toContain("11");
  expect(screen.getByRole("button", { name: /^Trash/ }).textContent)
    .toContain("70");
});

test("Clean up: Ready to clean is built from the quick wins, no double count",
  () => {
  const gs = [
    mk("a@x.example", { engagement: 10, count: 50, size: 8 * MB }),
    mk("b@x.example", { engagement: 10, count: 15, size: 6 * MB }),
  ];
  render(<CleanupPage {...cleanupProps({ groups: gs, deckSize: 2 })} />);
  const card = screen.getByRole("region", { name: "Ready to clean" });
  expect(card.textContent).toContain("14.0 MB");
  expect(card.textContent).toContain("in 65 mails");
  expect(screen.getByRole("button", { name: /^Triage/ }).textContent)
    .toContain("2 senders waiting");
});

test("Clean up: gated tools stay disabled before a scan; AI hidden when off",
  () => {
  render(<CleanupPage {...cleanupProps({ state: state({ status: "idle" }),
    triageDisabled: true, aiShown: false })} />);
  expect((screen.getByRole("button", { name: /^Duplicates/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /^Triage/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: /^AI review/ })).toBeNull();
  expect(screen.getByText(/Scan your mailbox/)).toBeTruthy();
});

test("Insights: widgets show real data and open their tools", async () => {
  stats.mockResolvedValue({ mails: 240, months: [
    { month: "2026-09", count: 100, size: 1 },
    { month: "2026-10", count: 140, size: 1 }] });
  trackers.mockResolvedValue({ usable: true, checked: 10, pixel: 3,
    senders: 4 });
  audit.mockResolvedValue({ total: 2, entries: [
    { ts: 1700000000, account: "a", actor: "user", action: "trash", count: 5,
      bytes: 0, label: "", outcome: "ok", error: "" },
    { ts: 1699990000, account: "a", actor: "user", action: "unsubscribe",
      count: 1, bytes: 0, label: "", outcome: "failed", error: "x" }] });
  const onOpen = vi.fn();
  render(<InsightsPage groups={[mk("a@x.example"), mk("b@x.example")]}
    state={state()} onOpen={onOpen} />);
  await screen.findByText("240 mails");
  expect(screen.getByRole("img", { name: /30 %/ })).toBeTruthy();
  expect(screen.getByText("4 senders track you")).toBeTruthy();
  expect(screen.getByText("failed")).toBeTruthy();
  expect(audit).toHaveBeenCalledWith(0, 3);
  for (const [name, tool] of [["Statistics", "stats"], ["Space map", "space"],
    ["Trackers", "trackers"], ["Your year in mail", "wrapped"],
    ["Recent activity", "activity"]] as const) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    expect(onOpen).toHaveBeenLastCalledWith(tool);
  }
});

test("Insights: a tracker report that is not usable shows Check", async () => {
  stats.mockRejectedValue(new Error("x"));
  trackers.mockResolvedValue({ usable: false, checked: 0, pixel: 0,
    senders: 0 });
  audit.mockResolvedValue({ total: 0, entries: [] });
  render(<InsightsPage groups={[]} state={state()} onOpen={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button",
    { name: /^Trackers/ }).textContent).toContain("Check"));
  expect(screen.getByText("Nothing recorded yet")).toBeTruthy();
});

test("Insights: Retry on a failed unsubscribe only where the group can", async () => {
  stats.mockRejectedValue(new Error("x"));
  trackers.mockRejectedValue(new Error("x"));
  const fail = (label: string, ts: number) => ({ ts, account: "a",
    actor: "user", action: "unsubscribe", count: 1, bytes: 0, label,
    outcome: "failed", error: "x" });
  audit.mockResolvedValue({ total: 2, entries: [fail("a@x.example", 2),
    fail("gone@x.example", 1)] });
  const g = mk("a@x.example", { unsub: true, unsubscribed: { n: 1, of: 1,
    status: "failed", link: "", addr: "" } });
  const st = state({ groups: { sender: { [g.key]: g } } } as never);
  const onRetry = vi.fn().mockResolvedValue(undefined);
  render(<InsightsPage groups={[g]} state={st} onOpen={vi.fn()}
    onRetryUnsub={onRetry} />);
  const btn = await screen.findByRole("button", { name: "Retry" });
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  fireEvent.click(btn);
  await waitFor(() => expect(onRetry).toHaveBeenCalledWith(g));
  // the list is fetched again afterwards
  await waitFor(() => expect(audit).toHaveBeenCalledTimes(2));
});

test("Insights: the monthly average uses the listed months, not the total",
  async () => {
  // 12 months of 76 = 912 listed; the all-time total (5000) must not leak in
  stats.mockResolvedValue({ mails: 5000, months: Array.from({ length: 12 },
    (_, i) => ({ month: `2025-${String(i + 1).padStart(2, "0")}`,
      count: 76, size: 1 })) });
  trackers.mockRejectedValue(new Error("x"));
  audit.mockResolvedValue({ total: 0, entries: [] });
  render(<InsightsPage groups={[]} state={state()} onOpen={vi.fn()} />);
  expect(await screen.findByText("76 a month")).toBeTruthy();
});

test("Insights: loading, failed and empty states of the widgets", async () => {
  // loading: nothing resolved yet, no widget text of its own
  const never = new Promise(() => {});
  stats.mockReturnValue(never); trackers.mockReturnValue(never);
  audit.mockReturnValue(never);
  const { unmount } = render(<InsightsPage groups={[]} state={state()}
    onOpen={vi.fn()} />);
  expect(screen.queryByText("Tap for the details")).toBeNull();
  expect(screen.queryByText("Nothing recorded yet")).toBeNull();
  unmount();
  // failed fetches: the entry hint, trackers "Check"
  stats.mockRejectedValue(new Error("x")); trackers.mockRejectedValue(
    new Error("x")); audit.mockRejectedValue(new Error("x"));
  render(<InsightsPage groups={[]} state={state()} onOpen={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByText("Tap for the details"))
    .toHaveLength(2));
  // a scanned mailbox without groups: the Space map says so (no skeleton)
  expect(screen.getByText("Nothing to map yet.")).toBeTruthy();
});

test("Insights: the story card shows year, stories, mails and top sender",
  async () => {
  stats.mockRejectedValue(new Error("x")); trackers.mockRejectedValue(
    new Error("x")); audit.mockResolvedValue({ total: 0, entries: [] });
  wrapped.mockResolvedValue({ year: 2026, partial: true, years: [2026],
    received: { mails: 818, bytes: 1, senders: 3, read: 1, new_senders: 0 },
    top_senders: [{ label: "Example Store", addr: "s@x.example", mails: 9,
      bytes: 1 }], loudest_month: null, busiest_weekday: null,
    busiest_hour: null, biggest: null, ghosts: { count: 0, top: [] },
    cleanup: { trashed: 0, archived: 0, purged: 0, freed_bytes: 0,
      unsubscribes: 0, rule_runs: 0, top_rule: null } });
  render(<InsightsPage groups={[]} state={state()} onOpen={vi.fn()} />);
  // intro, senders, loudest, summary
  expect(await screen.findByText("2026 in 4 stories")).toBeTruthy();
  expect(screen.getByText("818 mails · top sender Example Store"))
    .toBeTruthy();
});

test("Insights: the Space map asks for a scan on a never-scanned mailbox",
  async () => {
  stats.mockRejectedValue(new Error("x")); trackers.mockRejectedValue(
    new Error("x")); audit.mockResolvedValue({ total: 0, entries: [] });
  render(<InsightsPage groups={[]} state={state({ status: "idle" })}
    onOpen={vi.fn()} />);
  expect(screen.getByText("Scan your mailbox to see the biggest senders."))
    .toBeTruthy();
  expect(screen.queryByText("Nothing to map yet.")).toBeNull();
});

test("Clean up: Duplicates shows the server's result, Attachments its last run",
  async () => {
  duplicates.mockResolvedValue(sum({ sets: 2, wasted: 3 * MB }));
  const st = state({ atts: { status: "done", mails: 12, size: 5 * MB,
    progress: "", error: "" }, groups_rev: 1 } as never);
  render(<CleanupPage {...cleanupProps({ state: st })} />);
  const dup = screen.getByRole("button", { name: /^Duplicates/ });
  await waitFor(() => expect(dup.textContent).toContain("2 duplicate sets"));
  expect(dup.textContent).toContain("3.0 MB");
  expect(dup.textContent).not.toContain("Check");
  const att = screen.getByRole("button", { name: /^Attachments/ });
  expect(att.textContent).toContain("12 mails");
  expect(att.textContent).not.toContain("Check");
});

test("Clean up: a running attachment analysis shows Running…", () => {
  const st = state({ atts: { status: "running", mails: 0, size: 0,
    progress: "", error: "" } } as never);
  render(<CleanupPage {...cleanupProps({ state: st })} />);
  expect(screen.getByRole("button", { name: /^Attachments/ }).textContent)
    .toContain("Running…");
});

test("Clean up: Duplicates adds the sets to compare to the sub line", async () => {
  duplicates.mockResolvedValue(sum({ sets: 2, wasted: 3 * MB, versions: 1,
    possible: 2 }));
  render(<CleanupPage {...cleanupProps()} />);
  await waitFor(() => expect(screen.getByRole("button",
    { name: /^Duplicates/ }).textContent)
    .toContain("2 duplicate sets · 3 to compare"));
});

test("Clean up: only sets to compare show their count as the value", async () => {
  duplicates.mockResolvedValue(sum({ versions: 1, possible: 3 }));
  render(<CleanupPage {...cleanupProps()} />);
  const dup = screen.getByRole("button", { name: /^Duplicates/ });
  await waitFor(() => expect(dup.textContent).toContain("4 to compare"));
  expect(dup.textContent).not.toContain("No copies found");
  expect(dup.textContent).not.toContain("duplicate set");
});

test("Clean up: no copies of any kind reads 0 / No copies found", async () => {
  duplicates.mockResolvedValue(sum({}));
  render(<CleanupPage {...cleanupProps()} />);
  await waitFor(() => expect(screen.getByRole("button",
    { name: /^Duplicates/ }).textContent).toContain("No copies found"));
});

test("Clean up: nothing left but kept sets says how many are kept", async () => {
  duplicates.mockResolvedValue(sum({ dismissed: 3 }));
  render(<CleanupPage {...cleanupProps()} />);
  await waitFor(() => expect(screen.getByRole("button",
    { name: /^Duplicates/ }).textContent).toContain("Nothing to remove · 3 kept"));
});

test("Clean up: the Attachments tile asks for a check until a size is known", () => {
  render(<CleanupPage {...cleanupProps()} />);
  expect(screen.getByRole("button", { name: /^Attachments/ }).textContent)
    .toContain("Find big attachments");
});

test("Clean up: no Check flash while loading; no refetch on groups_rev",
  async () => {
  let res: (v: unknown) => void = () => {};
  duplicates.mockReturnValue(new Promise((r) => { res = r; }));
  const props = cleanupProps({ state: state({ groups_rev: 1 } as never) });
  const { rerender } = render(<CleanupPage {...props} />);
  const dup = () => screen.getByRole("button", { name: /^Duplicates/ });
  expect(dup().textContent).not.toContain("Check");
  res(sum({ sets: 1, wasted: MB }));
  await waitFor(() => expect(dup().textContent).toContain("1 duplicate set"));
  rerender(<CleanupPage {...props}
    state={state({ groups_rev: 2 } as never)} />);
  expect(duplicates).toHaveBeenCalledTimes(1);
});

test("Clean up: a failed duplicates fetch shows Check", async () => {
  duplicates.mockRejectedValue(new Error("x"));
  render(<CleanupPage {...cleanupProps()} />);
  await waitFor(() => expect(screen.getByRole("button",
    { name: /^Duplicates/ }).textContent).toContain("Check"));
});
