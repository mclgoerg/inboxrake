// @vitest-environment jsdom
/* `#/connect` in the app: the consent page of a hosted app is a page of its
 * own (no shell), only once signed in - the sign-in keeps the route. */

import { act, cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let probe: { mode: string; authed: boolean } = { mode: "password", authed: false };
const connect = vi.fn();
const tokenList = vi.fn();
let state: any;

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve(probe),
    login: () => { probe = { mode: "password", authed: true }; return Promise.resolve({}); },
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    assistantConnect: () => connect(),
    assistantTokens: () => { tokenList(); return Promise.resolve({ tokens: [] }); },
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    stats: () => Promise.reject(new Error("no stats")),
    wrapped: () => Promise.reject(new Error("no wrapped")),
    clearNotice: () => Promise.resolve(),
    version: () => Promise.resolve({ build: "v1" }),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    group: () => Promise.resolve([]),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    mails: () => Promise.resolve({ items: [], total: 0 }),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
  undoLabel: (u: { label: string }) => u.label,
  errorText: (e: unknown) => String(e),
  noticeParams: () => ({}),
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import type { AppState, Config } from "./types";

const cfg: Config = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto",
    user: "me@proton.example", password: "", password_set: true,
    cafile: "", preset: "custom", oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
  } },
} as unknown as Config;

const mk = (label: string, count: number) => ({
  key: `${label.toLowerCase()}@x.example`, label, sub: `${label.toLowerCase()}@x.example`,
  count, size: 1000, unread: 0, first: "2024-01-01", last: "2024-06-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
});
// Default sort is by count, descending: Alpha, Bravo, Charlie.
const A = mk("Alpha", 30), B = mk("Bravo", 20), C = mk("Charlie", 10);

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: null, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: { [A.key]: A, [B.key]: B, [C.key]: C },
    smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState;



Element.prototype.scrollIntoView = () => {};
const mount = () => {
  state = { ...baseState, scanned_ts: 1 };
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};
afterEach(() => {
  cleanup(); localStorage.clear(); window.location.hash = "";
  connect.mockReset(); tokenList.mockReset(); delete (cfg as any).assistants;
  probe = { mode: "password", authed: false };
});

const REQ = { request_id: "r", client: { client_id: "https://claude.example/c.json",
  host: "claude.example", name: "Claude", redirect_host: "claude.example" },
  ceiling: "read", accounts: ["proton"],
  defaults: { level: "read", subjects: false, expires_days: 90,
    daily_cap: 2000, name: "Claude · claude.example" } };

test("signed out: the sign-in comes first, and #/connect survives it", async () => {
  window.location.hash = "#/connect";
  connect.mockResolvedValue(REQ);
  mount();
  fireEvent.change(await screen.findByLabelText("Password"),
    { target: { value: "pw" } });
  expect(connect).not.toHaveBeenCalled();   // no request is read before sign-in
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("wants to access your Inboxrake")).toBeTruthy();
  expect(window.location.hash).toBe("#/connect");
  expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
});

test("signed in: the consent page replaces the app shell; leaving returns to the app", async () => {
  probe = { mode: "password", authed: true };
  window.location.hash = "#/connect";
  connect.mockRejectedValue(Object.assign(new Error("expired"),
    { code: "connect_request_gone" }));
  mount();
  expect(await screen.findByText("This connection can't be set up")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Inboxrake" }));
  expect(await screen.findByRole("navigation", { name: "Main navigation" }))
    .toBeTruthy();
  await waitFor(() => expect(window.location.hash).toBe("#/"));
});

const oauth = (over: object) => {
  (cfg as any).assistants = { access: "act", levels: ["read", "propose", "act"],
    oauth: { enabled: true, available: true, reason: "", mcp_url: "https://m.example/mcp", ...over } };
};

test("OAuth inactive (access Off, switch still on): the app asks for no connections", async () => {
  probe = { mode: "password", authed: true };
  oauth({ available: false, reason: "oauth_needs_access" });
  mount();
  expect(await screen.findByRole("navigation", { name: "Main navigation" })).toBeTruthy();
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(tokenList).not.toHaveBeenCalled();
});

test("OAuth active: the app looks at the connections", async () => {
  probe = { mode: "password", authed: true };
  oauth({});
  mount();
  await waitFor(() => expect(tokenList).toHaveBeenCalled());
});
