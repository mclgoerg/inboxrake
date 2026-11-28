// @vitest-environment jsdom
/* Mute this conversation, end to end in the app: the pane's More menu in
 * Thread grouping and the reader's ⋯ menu reach the same dialog and the same
 * rule; Cancel does nothing; a muted conversation offers Unmute instead. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
let messageExtra: Record<string, unknown> = {};
const mutePreview = vi.fn();
const muteCall = vi.fn();
const deleteRuleCall = vi.fn();
const mk = (uid: number, subject: string, addr = "kim@team.example") => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0, subject,
  addr, size: 1000, seen: true, ai: null });
const KEY = "4f9c1e0a7b2d3c58";

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    clearNotice: () => Promise.resolve(),
    group: () => Promise.resolve([mk(1, "Plan A"), mk(2, "Plan B")]),
    message: () => Promise.resolve({ from: "Kim <kim@team.example>", to: "",
      date: "", subject: "Plan A", text: "body", ...messageExtra }),
    thread: () => Promise.resolve({ key: KEY, label: "Team dinner",
      notes: [], mails: [mk(1, "Plan A"), mk(2, "Plan B")] }),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    scan: () => Promise.resolve({ ok: true }),
    mutePreview: (...a: unknown[]) => mutePreview(...a),
    mute: (...a: unknown[]) => muteCall(...a),
    deleteRule: (...a: unknown[]) => deleteRuleCall(...a),
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
import { DialogProvider, ToastProvider } from "./components/ui";
import { findDialog, pressDialog, cancelDialog, expectNoDialog }
  from "./dialogTestUtils";
import type { AppState, Config, Group, Rule } from "./types";

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

const muteRule: Rule = {
  id: "mr1", name: "Mute: Team dinner", scope: "mail", grouping: "thread",
  query: `thread:${KEY}`, action: "archive_read", dest: "", schedule: "scan",
  mode: "execute", keep_latest: null, older_than_days: null, origin: "mute",
  mute: { key: KEY, since: 1 }, report_runs: 1, created: 0, last_run: null,
};

const baseState = (rules: Rule[] = []): AppState => ({
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: { "kim@team.example": grp("kim@team.example", "Kim", 5) },
    smart: {}, domain: {}, subject: {},
    thread: { [KEY]: grp(KEY, "Team dinner", 2) } },
  ai: { status: "idle", grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules,
  presets: [],
} as unknown as AppState);

const preview = (over: Record<string, unknown> = {}) => ({
  key: KEY, label: "Team dinner", mails: 2, people: 1, now: 2, protected: 0,
  pinned: 0, archive: true, muted: null, ...over });

Element.prototype.scrollIntoView = () => {};
beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false, media: q, addEventListener: () => {},
    removeEventListener: () => {}, addListener: () => {},
    removeListener: () => {},
  }));
  mutePreview.mockReset().mockResolvedValue(preview());
  muteCall.mockReset().mockResolvedValue({ rule: muteRule });
  deleteRuleCall.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  messageExtra = {};
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const mount = async (rules: Rule[] = []) => {
  localStorage.setItem("pmc_account", "proton");
  window.location.hash = "#/senders";
  state = baseState(rules);
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText("Kim").length).toBeGreaterThan(0));
};
const openThread = async () => {
  fireEvent.click(screen.getByRole("tab", { name: "Thread" }));
  fireEvent.click((await screen.findAllByText("Team dinner"))[0]);
  await screen.findByText("Plan A");
};
const paneMore = async () => {
  const dlg = screen.getByRole("dialog");
  fireEvent.click(within(dlg).getByRole("button", { name: "More" }));
};

test("the pane's More menu in Thread grouping mutes the conversation: the "
  + "dialog, then one rule through /api/mute", async () => {
  await mount();
  await openThread();
  await paneMore();
  fireEvent.click(await screen.findByRole("menuitem",
    { name: "Mute this conversation…" }));
  const dlg = await findDialog();
  expect(mutePreview).toHaveBeenCalledWith(KEY);
  expect(within(dlg).getByText("Mute “Team dinner”?")).toBeTruthy();
  await pressDialog("Mute");
  await waitFor(() => expect(muteCall).toHaveBeenCalledWith(
    KEY, "Mute: Team dinner", false));
  // said in a toast
  expect(await screen.findByText(/Muted "Team dinner"/)).toBeTruthy();
});

test("ticking the extra step also archives what is there", async () => {
  await mount();
  await openThread();
  await paneMore();
  fireEvent.click(await screen.findByRole("menuitem",
    { name: "Mute this conversation…" }));
  const dlg = await findDialog();
  fireEvent.click(within(dlg).getByRole("checkbox",
    { name: /Also archive the 2 mails already in your inbox/ }));
  await pressDialog("Mute");
  await waitFor(() => expect(muteCall).toHaveBeenCalledWith(
    KEY, "Mute: Team dinner", true));
});

test("Cancel makes no rule", async () => {
  await mount();
  await openThread();
  await paneMore();
  fireEvent.click(await screen.findByRole("menuitem",
    { name: "Mute this conversation…" }));
  await findDialog();
  await cancelDialog();
  await expectNoDialog();
  expect(muteCall).not.toHaveBeenCalled();
});

test("the reader's ⋯ menu reaches the same dialog with the mail's "
  + "conversation", async () => {
  messageExtra = { thread: { count: 2, key: KEY } };
  await mount();
  await openThread();
  fireEvent.click(screen.getByText("Plan B"));
  await screen.findByRole("button", { name: "Trash this mail" });
  fireEvent.click(within(screen.getByRole("dialog"))
    .getAllByRole("button", { name: "More" }).at(-1)!);
  const items = screen.getAllByRole("menuitem").map((i) => i.textContent?.trim());
  expect(items.at(-1)).toBe("Mute this conversation…");
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Mute this conversation…" }));
  await findDialog();
  expect(mutePreview).toHaveBeenCalledWith(KEY);
  await pressDialog("Mute");
  await waitFor(() => expect(muteCall).toHaveBeenCalledOnce());
});

test("a muted conversation offers Unmute in the pane: it asks, then deletes "
  + "the rule", async () => {
  await mount([muteRule]);
  await openThread();
  await paneMore();
  expect(screen.queryByRole("menuitem",
    { name: "Mute this conversation…" })).toBeNull();
  fireEvent.click(await screen.findByRole("menuitem",
    { name: "Unmute this conversation" }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("Unmute “Team dinner”?")).toBeTruthy();
  await pressDialog("Unmute");
  await waitFor(() => expect(deleteRuleCall).toHaveBeenCalledWith("mr1"));
  expect(muteCall).not.toHaveBeenCalled();
});

test("a conversation that was muted meanwhile is not muted twice", async () => {
  mutePreview.mockResolvedValue(preview({ muted: "mr1" }));
  await mount();
  await openThread();
  await paneMore();
  fireEvent.click(await screen.findByRole("menuitem",
    { name: "Mute this conversation…" }));
  await waitFor(() => expect(mutePreview).toHaveBeenCalled());
  await expectNoDialog();
  expect(muteCall).not.toHaveBeenCalled();
});
