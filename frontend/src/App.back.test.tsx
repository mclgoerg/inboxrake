// @vitest-environment jsdom
/* V8: below 1024 px browser Back (Safari's swipe, Android's system Back, the
   installed app's edge swipe) closes the top-most overlay and lands on the
   page underneath. Each test is one kind of modal or one way in / out. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const blockCall = vi.fn();
const mails = [1, 2].map((uid) => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0, subject: `Mail ${uid}`,
  addr: "alpha@x.example", size: 1000, seen: true, ai: null }));

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    clearNotice: () => Promise.resolve(),
    group: () => Promise.resolve(mails),
    message: () => Promise.resolve({ from: "", to: "", date: "", subject: "",
      text: "body" }),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    scan: () => Promise.resolve({ ok: true }),
    block: (...a: unknown[]) => { blockCall(...a); return Promise.resolve({}); },
    wrapped: () => Promise.reject(new Error("no wrapped")),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { backStackBusy } from "./backStack";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { openTool } from "./toolTestUtils";
import type { AppState, Config, Group } from "./types";

const cfg = {
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto", user: "",
    password: "", password_set: true, cafile: "", preset: "custom",
    oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
  } },
  default_account: "proton", oauth_providers: [],
  oauth_ms_device_available: false, auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "m", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const grp = (key: string, label: string, count: number): Group => ({
  key, label, sub: key, count, size: 500, unread: 1, first: "2024-01-01",
  last: "2025-06-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 20,
} as Group);
const GROUPS = [grp("alpha@x.example", "Alpha", 50),
  grp("bravo@x.example", "Bravo", 40)];

const baseState = (): AppState => ({
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: Object.fromEntries(GROUPS.map((g) => [g.key, g])),
    smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState);

Element.prototype.scrollIntoView = () => {};
let wide = false;
beforeEach(() => {
  wide = false;
  // a phone: nothing matches, in particular not the 1024 px sidebar query
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return wide && q.includes("1024"); }, media: q, addEventListener: () => {},
    removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = async (hash = "#/senders") => {
  localStorage.setItem("pmc_account", "proton");
  window.location.hash = hash;
  state = baseState();
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Alpha").length)
    .toBeGreaterThan(0));
};
/** What the Back button, Safari's swipe or Android's system Back does. */
const settle = () => act(async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (!backStackBusy()) break;
  }
  await new Promise((r) => setTimeout(r, 10));
});
const back = async () => { act(() => { window.history.back(); }); await settle(); };
const onLayer = () => !!(window.history.state as { irkLayer?: string } | null)
  ?.irkLayer;
const dialogs = () => screen.queryAllByRole("dialog");

test("a tool opened from the Clean up tab: Back closes it and shows the tab again", async () => {
  await mount();
  openTool("Clean up", /^Rules/);
  await screen.findByRole("dialog");
  await settle();
  expect(window.location.hash).toBe("#/cleanup");
  await back();
  expect(dialogs()).toHaveLength(0);
  expect(window.location.hash).toBe("#/cleanup");
  expect(await screen.findByRole("heading", { level: 1, name: "Clean up" }))
    .toBeTruthy();
});

test("closing a tool with its back link leaves no entry behind", async () => {
  await mount();
  openTool("Clean up", /^Rules/);
  const dlg = await screen.findByRole("dialog");
  await settle();
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Clean up" }));
  await settle();
  expect(dialogs()).toHaveLength(0);
  expect(onLayer()).toBe(false);
  // the next Back leaves the tab page for the one before it, not a stale modal
  await back();
  expect(window.location.hash).toBe("#/senders");
  expect(dialogs()).toHaveLength(0);
});

test("a sender's detail: Back closes it, the list stays where it was", async () => {
  await mount();
  fireEvent.click(screen.getAllByText("Alpha")[0]);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  await settle();
  expect(onLayer()).toBe(true);
  await back();
  expect(dialogs()).toHaveLength(0);
  expect(window.location.hash).toBe("#/senders");
  expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
});

test("a mail opened in the detail: Back closes the mail first, then the detail", async () => {
  await mount();
  fireEvent.click(screen.getAllByText("Alpha")[0]);
  await screen.findByText("Mail 1");
  await settle();
  fireEvent.click(screen.getByText("Mail 1"));
  await screen.findByRole("button", { name: "Trash this mail" });
  await settle();
  await back();
  expect(screen.queryByRole("button", { name: "Trash this mail" })).toBeNull();
  expect(screen.getByText("Mail 2")).toBeTruthy();      // the detail is still open
  expect(dialogs()).toHaveLength(1);
  await back();
  expect(dialogs()).toHaveLength(0);
  expect(window.location.hash).toBe("#/senders");
});

test("a mail's More menu reaches the app: Block runs the sender confirm, "
  + "Open sender closes the mail on the sender's page", async () => {
  await mount();
  fireEvent.click(screen.getAllByText("Alpha")[0]);
  await screen.findByText("Mail 1");
  await settle();
  fireEvent.click(screen.getByText("Mail 1"));
  await screen.findByRole("button", { name: "Trash this mail" });
  const more = () => within(screen.getByRole("dialog"))
    .getAllByRole("button", { name: "More" }).at(-1)!;
  fireEvent.click(more());
  fireEvent.click(screen.getByRole("menuitem", { name: /Block sender/ }));
  expect((await findDialog()).textContent).toContain("alpha@x.example");
  await pressDialog("Block");
  await waitFor(() => expect(blockCall).toHaveBeenCalledWith(
    "sender", "alpha@x.example", "alpha@x.example", false));

  fireEvent.click(more());
  fireEvent.click(screen.getByRole("menuitem", { name: /Open sender/ }));
  await settle();
  expect(screen.queryByRole("button", { name: "Trash this mail" })).toBeNull();
  expect(screen.getByText("Mail 2")).toBeTruthy();       // the sender's own list
});

test("the detail's own close button pops its entry too", async () => {
  await mount();
  fireEvent.click(screen.getAllByText("Alpha")[0]);
  const dlg = await screen.findByRole("dialog");
  await settle();
  fireEvent.click(within(dlg).getByRole("button", { name: "Close" }));
  await settle();
  expect(dialogs()).toHaveLength(0);
  expect(onLayer()).toBe(false);
});

test("a dirty draft: Back asks first and stays when cancelled (Triage)", async () => {
  await mount();
  openTool("Clean up", /^Triage/);
  const dlg = await screen.findByRole("dialog", { name: "Triage" });
  await settle();
  fireEvent.click(within(dlg).getByRole("button", { name: /Trash/ }));
  await back();
  expect((await findDialog()).textContent).toContain("Discard 1 decision?");
  await cancelDialog();
  await settle();
  expect(screen.getByRole("dialog", { name: "Triage" })).toBeTruthy();
  expect(onLayer()).toBe(true);                // the entry is back
  await back();                                // ... so Back asks again
  await findDialog();
  await pressDialog("Discard");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Triage" }))
    .toBeNull());
  await settle();
  expect(onLayer()).toBe(false);
  expect(window.location.hash).toBe("#/cleanup");
});

test("a deep link to a tool route behaves as before: no extra entry, back link goes to the tab", async () => {
  await mount("#/rules");
  const dlg = await screen.findByRole("dialog");
  await settle();
  expect(onLayer()).toBe(false);
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Clean up" }));
  await waitFor(() => expect(dialogs()).toHaveLength(0));
  expect(window.location.hash).toBe("#/cleanup");
});

test("a dialog over a routed tool still takes the first Back", async () => {
  await mount("#/triage");
  const dlg = await screen.findByRole("dialog", { name: "Triage" });
  fireEvent.click(within(dlg).getByRole("button", { name: /Trash/ }));
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Clean up" }));
  await findDialog();                           // the discard prompt
  await settle();
  await back();
  await waitFor(() => expect(screen.queryByText("Discard 1 decision?")).toBeNull());
  expect(screen.getByRole("dialog", { name: "Triage" })).toBeTruthy();
  expect(window.location.hash).toBe("#/triage");
});

test("Forward after Back (cancelling a discard prompt) neither closes the tool nor reopens the prompt", async () => {
  await mount();
  openTool("Clean up", /^Triage/);
  const dlg = await screen.findByRole("dialog", { name: "Triage" });
  await settle();
  fireEvent.click(within(dlg).getByRole("button", { name: /Trash/ }));
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Clean up" }));
  await findDialog();
  await settle();
  await back();                                  // Back = Cancel
  await waitFor(() => expect(screen.queryByText("Discard 1 decision?")).toBeNull());
  act(() => { window.history.forward(); });
  await settle();
  expect(screen.queryByText("Discard 1 decision?")).toBeNull();
  expect(screen.getByRole("dialog", { name: "Triage" })).toBeTruthy();
  await back();                                  // the tool's own Back still asks
  await findDialog();
  await pressDialog("Discard");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Triage" })).toBeNull());
  await settle();
  expect(onLayer()).toBe(false);
});

test("from 1024 px a dialog over a tool page is closed by Back; the page stays", async () => {
  wide = true;
  await mount("#/triage");
  await screen.findByText("Card 1 of 2");
  fireEvent.click(within(await screen.findByRole("navigation", { name: "Main navigation" }))
    .getByRole("button", { name: "Your year in mail" }));
  await screen.findByRole("dialog");
  await settle();
  expect(onLayer()).toBe(true);
  await back();
  expect(dialogs()).toHaveLength(0);
  expect(window.location.hash).toBe("#/triage");
  expect(screen.getByText("Card 1 of 2")).toBeTruthy();
});
