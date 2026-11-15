// @vitest-environment jsdom
/* A subscription reminder that fired reaches the open app: asked at load, when
 * the page becomes visible again and every minute while it is visible; shown
 * once as a toast. With Web Push on, only to a device that was looking. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const reminders = vi.fn();

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeEventSource.instances.push(this); }
  close() {}
}

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    logout: () => Promise.resolve(),
    exportUrl: () => "/api/export",
    version: () => Promise.resolve({ build: "v1" }),
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    rules: () => Promise.resolve({ rules: state?.rules ?? [], cap: 500 }),
    duplicatesSummary: () => Promise.reject(new Error("x")),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    subscriptionReminders: () => reminders(),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { AppState, Config, Rule } from "./types";

const cfg = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto",
    user: "me@proton.example", password: "", password_set: true,
    cafile: "", preset: "custom", oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 } } },
} as unknown as Config;

const AT = 1_700_000_000;
const rule = (id: string, over: Partial<Rule> = {}): Rule => ({
  id, name: `Rule ${id}`, scope: "mail", grouping: "sender", query: "age:>1y",
  action: "trash", dest: "", schedule: "manual", mode: "report",
  keep_latest: null, older_than_days: null, origin: "mcp", report_runs: 1,
  created: AT, last_run: { ts: AT, mode: "report", groups: 2, mails: 12,
    acted: 0, capped: 0, skipped_protected: 0, skipped_pinned: 0, preview: [],
    error: "" },
  proposed_by: { token_id: "t1", name: "Claude Code · laptop", at: AT },
  ...over });

const baseState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [], groups: { sender: {}, smart: {},
    domain: {}, subject: {}, thread: {} },
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
const widen = (wide: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({
  get matches() { return wide && q.includes("1024"); }, media: q,
  addEventListener: () => {}, removeEventListener: () => {},
}));

const mount = async (rules: Rule[], wide = true) => {
  vi.stubGlobal("EventSource", FakeEventSource);
  widen(wide);
  state = { ...baseState, rules };
  localStorage.setItem("pmc_account", "proton");
  const r = render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  await waitFor(() => expect(document.querySelector("nav")).toBeTruthy());
  return r;
};

const fired = (over = {}) => ({ key: "fit.example", ts: Math.floor(Date.now() / 1000),
  name: "FitTrack Premium", next: Math.floor(Date.now() / 1000) + 3 * 86400,
  amount: 7.99, currency: "EUR", ...over });

beforeEach(() => {
  setLang("en");
  reminders.mockResolvedValue({ reminders: [] });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear();
  reminders.mockReset();
  FakeEventSource.instances.length = 0;
});

test("a fired reminder is shown once, at load", async () => {
  reminders.mockResolvedValue({ reminders: [fired()] });
  await mount([]);
  expect(await screen.findByText("FitTrack Premium bills again in 3 days"))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
});

test("it asks again when the page becomes visible and every minute while visible",
  async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await mount([]);
    await waitFor(() => expect(reminders).toHaveBeenCalledTimes(1));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(reminders).toHaveBeenCalledTimes(2);
    // a reminder that fires meanwhile is caught by the next minute
    reminders.mockResolvedValue({ reminders: [fired({ ts: 5 })] });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(reminders).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
    expect(await screen.findByText("FitTrack Premium bills again in 3 days"))
      .toBeTruthy();
  });

test("a hidden page does not ask", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await mount([]);
  await waitFor(() => expect(reminders).toHaveBeenCalledTimes(1));
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  try {
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(reminders).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  }
});
