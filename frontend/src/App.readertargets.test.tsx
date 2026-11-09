// @vitest-environment jsdom
/* The reader and the sender / group detail act on the mail you are looking
   at: each test is one hole found in the 2.3.0 release review (R2). */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
let messageExtra: Record<string, unknown> = {};
const blockCall = vi.fn();
const previewCall = vi.fn();
const mk = (uid: number, subject: string, addr = "alpha@x.example") => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0, subject,
  addr, size: 1000, seen: true, ai: null });
const mails = [1, 2].map((uid) => mk(uid, `Mail ${uid}`));
/** What api.group answers per "grouping:key" (default: the sender's mails). */
let groupMails: Record<string, ReturnType<typeof mk>[]> = {};
const deleteCall = vi.fn();
const groupDeleteCall = vi.fn();

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    clearNotice: () => Promise.resolve(),
    group: (g: string, k: string) =>
      Promise.resolve(groupMails[`${g}:${k}`] ?? mails),
    deleteGroups: (...a: unknown[]) => { groupDeleteCall(...a);
      return Promise.resolve({ queued: 1 }); },
    deleteMessages: (...a: unknown[]) => { deleteCall(...a);
      return Promise.resolve({}); },
    message: () => Promise.resolve({ from: "", to: "", date: "", subject: "",
      text: "body", ...messageExtra }),
    unsubscribePreview: (...a: unknown[]) => { previewCall(...a);
      return Promise.resolve({ senders: [{ addr: "alpha@x.example", name: "Alpha",
        via: "one_click", mails: 2, size: 1 }], skipped_protected: 0,
        skipped_done: 0, capped: 0, skipped_no_header: 0,
        trash: { groups: [], mails: 0, size: 0, pinned: 0 } }); },
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
    smart: {}, domain: {}, subject: {},
    thread: { t1: grp("t1", "Topic", 2) } },
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
  groupMails = {};
  deleteCall.mockClear();
  groupDeleteCall.mockClear();
  // a phone: nothing matches, in particular not the 1024 px sidebar query
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return wide && q.includes("1024"); }, media: q, addEventListener: () => {},
    removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
});
afterEach(async () => {
  messageExtra = {};
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

test("Open sender from a conversation's reader shows the sender's own "
  + "mails and selection, not the conversation's", async () => {
  groupMails["thread:t1"] = [mk(1, "Plan A"), mk(2, "Plan B")];
  await mount();
  fireEvent.click(screen.getByRole("tab", { name: "Thread" }));
  fireEvent.click((await screen.findAllByText("Topic"))[0]);
  await screen.findByText("Plan A");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Plan A" }));
  expect(screen.getByRole("button", { name: "Trash selected (1)" }))
    .toBeTruthy();
  fireEvent.click(screen.getByText("Plan B"));
  await screen.findByRole("button", { name: "Trash this mail" });
  fireEvent.click(within(screen.getByRole("dialog"))
    .getAllByRole("button", { name: "More" }).at(-1)!);
  fireEvent.click(screen.getByRole("menuitem", { name: /Open sender/ }));
  await settle();
  // the sender's mails (Mail 1 / 2) - and nothing ticked from the old list
  await screen.findByText("Mail 1");
  expect(screen.queryByText("Plan A")).toBeNull();
  expect(screen.queryByRole("button", { name: /Trash selected/ }))
    .toBeNull();
});

test("a filter that hides a ticked sender takes it out of the Trash and its "
  + "count; clearing the filter does not bring the tick back", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Select Alpha" })[0]);
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Select Bravo" })[0]);
  expect(screen.getByRole("button", { name: "Trash 90" })).toBeTruthy();
  const box = screen.getByPlaceholderText("Search or filter…");
  fireEvent.change(box, { target: { value: "bravo" } });
  await screen.findByRole("button", { name: "Trash 40" });
  fireEvent.change(box, { target: { value: "" } });      // Alpha stays unticked
  fireEvent.click(await screen.findByRole("button", { name: "Trash 40" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Bravo");
  expect(dlg.textContent).not.toContain("Alpha");
  await pressDialog("Move to Trash (40)");
  await waitFor(() => expect(groupDeleteCall).toHaveBeenCalled());
  expect(groupDeleteCall.mock.calls[0][1]).toEqual(["bravo@x.example"]);
});

test("x and # after a filter shrank the list under the focused row do "
  + "nothing instead of throwing", async () => {
  await mount();
  const errors: string[] = [];
  const onError = (e: ErrorEvent) => { errors.push(String(e.error)); e.preventDefault(); };
  window.addEventListener("error", onError);
  try {
    await act(async () => {});
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });                 // Bravo, row 2
    fireEvent.change(screen.getByPlaceholderText("Search or filter…"),
      { target: { value: "alpha" } });                       // one row left
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "#" });
    await settle();
    expect(errors).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Trash \d+$/ })).toBeNull();
    expect(groupDeleteCall).not.toHaveBeenCalled();
  } finally { window.removeEventListener("error", onError); }
});
