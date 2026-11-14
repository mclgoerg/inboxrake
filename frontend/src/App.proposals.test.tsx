// @vitest-environment jsdom
/* A rule an AI assistant proposes reaches the user in the open app: a count
 * badge on Rules (sidebar, phone Clean up tile), a toast whose Review opens
 * Rules, and a browser notification when the device has them on and the page
 * is hidden. A proposal that is already waiting at load only gets the badge. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

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
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
  FakeEventSource.instances.length = 0;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  setLang("en");
});

test("the sidebar's Rules carries a count badge while proposals wait", async () => {
  await mount([rule("a"), rule("b"), rule("c", { origin: "manual" }),
    rule("d", { mode: "execute" })]);
  const btn = screen.getByRole("button", { name: /^Rules/ });
  expect(btn.textContent).toContain("2");
  expect(within(btn).getByText("2 proposals waiting")).toBeTruthy();
});

test("no proposals: no badge", async () => {
  await mount([rule("c", { origin: "manual" })]);
  expect(within(screen.getByRole("button", { name: /^Rules/ }))
    .queryByText(/proposal/)).toBeNull();
});

test("phones: the Clean up tile says 1 proposal waiting and shows the badge", async () => {
  window.location.hash = "#/cleanup";
  await mount([rule("a")], false);
  const tile = await screen.findByRole("button", { name: /^Rules/ });
  expect(tile.textContent!.replace(/\u00a0/g, " ")).toContain("1 proposal waiting");
  expect(tile.textContent).not.toContain("1 rules");
});

test("a proposal that appears while the app is open raises a toast whose Review opens Rules", async () => {
  await mount([]);
  tick({ rules: [rule("a")] });
  const msg = await screen.findByText("Claude Code · laptop proposes a rule");
  fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "Review" }));
  expect(await screen.findByText("Proposal · waiting for you")).toBeTruthy();
});

test("a proposal already waiting at load gets no toast, and a tick does not repeat it", async () => {
  await mount([rule("a")]);
  tick({ groups_rev: 2 });
  await act(async () => {});                 // the refetch it triggers settles
  expect(screen.queryByText(/proposes a rule/)).toBeNull();
  tick({ rules: [rule("a"), rule("b")] });
  expect(await screen.findAllByText(/proposes a rule/)).toHaveLength(1);
  tick({ groups_rev: 3 });
  expect(screen.getAllByText(/proposes a rule/)).toHaveLength(1);
});

test("approved, edited or ordinary rules never toast", async () => {
  await mount([]);
  tick({ rules: [rule("a", { mode: "execute" }), rule("b", { origin: "manual" })] });
  await act(async () => {});
  expect(screen.queryByText(/proposes a rule/)).toBeNull();
});

const stubNotification = () => {
  const made: { title: string; opts: any }[] = [];
  vi.stubGlobal("Notification", Object.assign(function (this: any, title: string, opts: any) {
    made.push({ title, opts });
  }, { permission: "granted" }));
  return made;
};

test("a hidden page with Desktop notifications on gets a browser notification", async () => {
  localStorage.setItem("pmc_notify", "1");
  const made = stubNotification();
  await mount([]);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  tick({ rules: [rule("a", { proposed_by: { token_id: "t", at: AT,
    name: "x".repeat(200) } })] });
  await waitFor(() => expect(made).toHaveLength(1));
  expect(made[0].title).toBe("Inboxrake");
  expect(made[0].opts.body).toBe(`${"x".repeat(80)} proposes a rule. Review it in Rules.`);
});

test("a visible page, or the switch off, gets no browser notification", async () => {
  const made = stubNotification();
  localStorage.setItem("pmc_notify", "1");
  await mount([]);
  tick({ rules: [rule("a")] });                       // page visible
  await screen.findByText(/proposes a rule/);
  expect(made).toHaveLength(0);
  localStorage.setItem("pmc_notify", "0");
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  tick({ rules: [rule("a"), rule("b")] });            // hidden, switch off
  await act(async () => {});
  expect(made).toHaveLength(0);
});

test("German toast", async () => {
  setLang("de");
  await mount([]);
  tick({ rules: [rule("a")] });
  expect(await screen.findByText("Claude Code · laptop schlägt eine Regel vor")).toBeTruthy();
});
