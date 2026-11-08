// @vitest-environment jsdom
/* New-sender review queue (PR #6): the "New (n)" chip only appears once
 * something is flagged, shows a live count, and tapping it adds the
 * flagged, non-protected groups to the selection (same ADD, not
 * replace, semantics as the other quick-select chips). */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import type { AppState, Config, Group } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};

const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "marcel@proton.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "a@x.example", label: "Sender A", sub: "a@x.example", count: 5,
  size: 1000, unread: 0, first: "2024-01-01", last: "2025-01-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 50, ...over,
});

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("no New chip renders when nothing is flagged", async () => {
  localStorage.setItem("pmc_account", "proton");
  const a = mkGroup();
  state = { ...baseState,
    groups: { sender: { [a.key]: a }, smart: {}, domain: {}, subject: {}, thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));
  expect(screen.queryByText(/^New senders/)).toBeNull();
});

test("the New senders row shows a live count; tapping it filters, the "
  + "banner selects only the flagged, non-protected groups, tapping the "
  + "checked row clears the filter", async () => {
  localStorage.setItem("pmc_account", "proton");
  const flagged = mkGroup({
    key: "a@x.example", label: "Sender A", count: 5, new: true });
  const flaggedProtected = mkGroup({
    key: "b@x.example", label: "Sender B", count: 9, new: true,
    protected: true });
  const notFlagged = mkGroup({
    key: "c@x.example", label: "Sender C", count: 3, new: false });
  state = { ...baseState, groups: { sender: {
    [flagged.key]: flagged, [flaggedProtected.key]: flaggedProtected,
    [notFlagged.key]: notFlagged }, smart: {}, domain: {}, subject: {}, thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Sender A").length)
    .toBeGreaterThan(0));

  await screen.findByRole("button", { name: "Filter" });
  const tap = () => {
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^New senders/ }));
  };
  // The row's count is every flagged group (2) - protection only affects
  // which ones the banner adds to the selection.
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect(screen.getByRole("menuitemradio", { name: /^New senders/ })
    .textContent).toBe("New senders2");
  fireEvent.keyDown(document, { key: "Escape" });

  // Tap: filters to is:new, selection untouched. Both flagged groups stay
  // visible (protection only affects selection), the unflagged one goes.
  tap();
  expect((screen.getByPlaceholderText("Search or filter…") as HTMLInputElement)
    .value).toBe("is:new");
  expect(screen.queryAllByText("Sender A").length).toBeGreaterThan(0);
  expect(screen.queryAllByText("Sender B").length).toBeGreaterThan(0);
  expect(screen.queryAllByText("Sender C").length).toBe(0);
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();
  // The row survives its OWN filter being active (count from the full
  // mailbox) and is the one checked.
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect(screen.getByRole("menuitemradio", { name: /^New senders/ })
    .getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });

  // Banner: selects every match except the protected one (bar scoped to
  // exactly Sender A's 5 mails); it says so and keeps the filter on Clear.
  expect(screen.getAllByText("1 protected stays unselected").length)
    .toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button",
    { name: /^Select the 1 match/ })[0]);
  await waitFor(() => expect(screen.getByText("Trash 5")).toBeTruthy());
  expect(screen.getAllByText("The 1 match is selected").length)
    .toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button", { name: "Clear" })[0]);
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();
  expect((screen.getByPlaceholderText("Search or filter…") as HTMLInputElement)
    .value).toBe("is:new");

  // Tapping the checked row again clears the filter.
  tap();
  await waitFor(() => {
    const el = screen.getByPlaceholderText("Search or filter…");
    expect((el as HTMLInputElement).value).toBe("");
  });
  expect(screen.queryAllByText("Sender C").length).toBeGreaterThan(0);

  // A second round behaves the same: filter, then the banner reselects.
  tap();
  expect(screen.queryByText(/^Trash \d+$/)).toBeNull();
  fireEvent.click(screen.getAllByRole("button",
    { name: /^Select the 1 match/ })[0]);
  await waitFor(() => expect(screen.getByText("Trash 5")).toBeTruthy());
});
