// @vitest-environment jsdom
/* Entry points of the Folders panel on phones / tablets: the Junk and Trash
 * rows (with their counts) on the Clean up tab; each opens its panel. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
let stateLoaded = false;
const foldersPanel = vi.fn();

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => { stateLoaded = true; return Promise.resolve(state); },
    logout: () => Promise.resolve(),
    exportUrl: () => "",
    version: () => Promise.resolve({ build: "v1" }),
    group: () => Promise.resolve([]),
    foldersPanel: (role: string) => foldersPanel(role),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import { DialogProvider, ToastProvider } from "./components/ui";
import type { AppState, Config } from "./types";

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

const cfgBase: Omit<Config, "accounts" | "default_account"> = {
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

const multiCfg: Config = {
  ...cfgBase,
  default_account: "proton",
  accounts: {
    proton: { ...acct, user: "marcel@proton.example" },
    icloud: { ...acct, user: "marcel@icloud.example" },
    gmail: { ...acct, user: "marcel@gmail.example" },
  },
};

const singleCfg: Config = {
  ...cfgBase,
  default_account: "proton",
  accounts: { proton: { ...acct, user: "marcel@proton.example" } },
};


import App from "./App";
import { setLang } from "./i18n";

let cfg: Config = singleCfg;

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
  trash_count: 12, junk_count: 3, notice: null, undo: [], folders_raw: [],
  rules: [], presets: [],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  foldersPanel.mockReset();
  setLang("en");
});

const mount = async (over: Partial<AppState> = {},
                     config: Config = singleCfg) => {
  cfg = config;
  stateLoaded = false;
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, ...over };
  foldersPanel.mockImplementation((role: string) => Promise.resolve({
    folder: role === "junk" ? "Spam" : "Trash", uv: 1, total: 0, max_uid: 0,
    mails: [], senders: [] }));
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByRole("link", { name: /Clean up|Aufräumen/ });
  await waitFor(() => expect(stateLoaded).toBe(true));
  fireEvent.click(screen.getByRole("link", { name: /Clean up|Aufräumen/ }));
};

test("Junk tile before the Trash tile: icon + count", async () => {
  await mount();
  const junk = await screen.findByRole("button", { name: /^Junk/ });
  const trash = screen.getByRole("button", { name: /^Trash/ });
  expect(junk.textContent).toContain("3");
  expect(trash.textContent).toContain("12");
  expect(junk.querySelector("svg")).toBeTruthy();
  expect(junk.compareDocumentPosition(trash)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("German labels", async () => {
  setLang("de");
  await mount({ junk_count: 4 }, multiCfg);
  expect((await screen.findByRole("button", { name: /^Spam/ })).textContent)
    .toContain("4");
  expect(screen.getByRole("button", { name: /^Papierkorb/ }).textContent)
    .toContain("12");
});

test("the tiles stay while Junk is empty (0) or unknown (Check)",
  async () => {
  await mount({ junk_count: 0 });
  expect((await screen.findByRole("button", { name: /^Junk/ })).textContent)
    .toContain("0");
  cleanup();
  await mount({ junk_count: null });
  expect((await screen.findByRole("button", { name: /^Junk/ })).textContent)
    .toContain("Check");
  cleanup();
  await mount({ junk_count: undefined });
  expect((await screen.findByRole("button", { name: /^Junk/ })).textContent)
    .toContain("Check");
  expect(screen.getByRole("button", { name: /^Trash/ }).textContent)
    .toContain("12");
});

test("the Trash row opens the panel on Trash, the Junk row on Junk",
  async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Trash/ }));
    await waitFor(() => expect(foldersPanel).toHaveBeenLastCalledWith("trash"));
    await screen.findByText("Trash is empty");
    fireEvent.click(screen.getByRole("button", { name: "Back to Clean up" }));
    fireEvent.click(screen.getByRole("button", { name: /^Junk/ }));
    await waitFor(() => expect(foldersPanel).toHaveBeenLastCalledWith("junk"));
    await screen.findByText("Junk is empty");
  });

test("the Junk row works without any count", async () => {
  await mount({ junk_count: 0, trash_count: 0 });
  fireEvent.click(await screen.findByRole("button", { name: /^Junk/ }));
  await waitFor(() => expect(foldersPanel).toHaveBeenLastCalledWith("junk"));
});
