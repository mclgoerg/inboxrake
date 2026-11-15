// @vitest-environment jsdom
/* A Time machine restore is a background job: when its state ends, the app
 * says so wherever the user is (a toast), clears the restore notice and
 * lets the lists catch up; a job that was already over at load says nothing. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
const clearNotice = vi.fn().mockResolvedValue({ ok: true });

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
    clearNotice: (...a: unknown[]) => clearNotice(...a),
    rules: () => Promise.resolve({ rules: state?.rules ?? [], cap: 500 }),
    duplicatesSummary: () => Promise.reject(new Error("x")),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
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
const tick = (patch: Partial<AppState>) => {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  state = { ...state, ...patch };
  const { groups: _g, ...slim } = state;
  act(() => es.onmessage!({ data: JSON.stringify(slim) }));
};

afterEach(() => {
  clearNotice.mockClear();
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
  FakeEventSource.instances.length = 0;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  setLang("en");
});


const restoring = (over: Partial<NonNullable<AppState["restore"]>> = {}) => ({
  status: "running", progress: "1/2", error: "", seq: 1, steps_done: 1,
  steps_total: 2, moved: 10, point_ts: 1_700_000_000, ...over });

test("a restore that ends raises a toast with the count and the moment, " +
  "clears the restore notice and refetches", async () => {
  await mount([]);
  tick({ restore: restoring() as any });
  expect(screen.queryByText(/Restored \d+/)).toBeNull();
  tick({ restore: restoring({ status: "done", moved: 47 }) as any });
  const toast = await screen.findByText(/^Restored 47.mails to /);
  expect(toast.textContent!.replace(/\u00a0/g, " ")).toMatch(
    /^Restored 47 mails to \d+ Nov, \d\d:\d\d$/);
  await waitFor(() => expect(clearNotice).toHaveBeenCalledWith(
    ["restored", "restored_rescan"]));
});

test("a restore that failed says so; one that stopped half-way says what came back",
  async () => {
    await mount([]);
    tick({ restore: restoring() as any });
    tick({ restore: restoring({ status: "error", moved: 0,
      error: "nothing_to_undo" }) as any });
    expect(await screen.findByText(/The restore failed: There is nothing to undo any more\./))
      .toBeTruthy();
    tick({ restore: restoring({ seq: 2 }) as any });
    tick({ restore: restoring({ seq: 2, status: "done", moved: 5,
      error: "cannot_move" }) as any });
    expect(await screen.findByText(/^Restored 5.mails to .*then stopped: /))
      .toBeTruthy();
  });

test("a job that was already over when the page loaded says nothing", async () => {
  await mount([]);
  tick({ restore: restoring({ status: "done", moved: 3, seq: 4 }) as any });
  await act(async () => {});
  expect(screen.queryByText(/Restored/)).toBeNull();
  expect(clearNotice).not.toHaveBeenCalled();
});

test("the same finished job is not announced twice", async () => {
  await mount([]);
  tick({ restore: restoring() as any });
  tick({ restore: restoring({ status: "done", moved: 8 }) as any });
  await screen.findByText(/^Restored 8.mails/);
  tick({ groups_rev: 5 });
  tick({ restore: restoring({ status: "done", moved: 8 }) as any });
  expect(screen.getAllByText(/^Restored 8.mails/)).toHaveLength(1);
});
