// @vitest-environment jsdom
/* Not now in the app shell: the toast of a snooze (with Undo), the Snoozed
   entry of the sidebar and of the Clean up tab with its page, the chip on a
   sender row, and Not now in the selection bar. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeEventSource.instances.push(this); }
  close() {}
}
vi.stubGlobal("EventSource", FakeEventSource);

const snooze = vi.fn();
const snoozed = vi.fn();
const undoApi = vi.fn().mockResolvedValue({ ok: true });

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    logout: () => Promise.resolve(),
    exportUrl: (mode: string) => `/api/export?grouping=${mode}`,
    version: () => Promise.resolve({ build: "v1" }),
    undo: (...a: unknown[]) => undoApi(...a),
    clearNotice: vi.fn().mockResolvedValue({ ok: true }),
    snooze: (...a: unknown[]) => snooze(...a),
    snoozed: (...a: unknown[]) => snoozed(...a),
    snoozedBack: vi.fn().mockResolvedValue({ returned: 1, gone: 0 }),
    snoozeBatch: vi.fn().mockResolvedValue({ ok: true, slot: "weekly" }),
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    mails: () => Promise.resolve({ items: [], total: 0 }),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import { epoch } from "./snooze";
import type { AppState, Config, Group } from "./types";

// Tuesday 2026-11-24, 09:30 local
const NOW = new Date(2026, 10, 24, 9, 30);
const TOMORROW = epoch(new Date(2026, 10, 25, 8));

const acctCfg = {
  excluded_folders: [] as string[], host: "h", port: 993,
  security: "ssl" as const, smtp_host: "", smtp_port: 587,
  smtp_security: "auto" as const, user: "", password: "",
  password_set: true, cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
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
  accounts: { proton: { ...acctCfg, user: "me@proton.example" } },
};
const group = (label: string, count: number, unread: number): Group => ({
  key: `${label.toLowerCase()}@x.example`, label,
  sub: `${label.toLowerCase()}@x.example`, count, size: 1000, unread,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50 });
const A = group("Alpha", 30, 5), B = group("Bravo", 20, 0);

const baseState = (over: Partial<AppState> = {}): AppState => ({
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: { [A.key]: A, [B.key]: B }, smart: {}, domain: {},
    subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Archive"],
  rules: [], presets: [], ...over }) as unknown as AppState;

Element.prototype.scrollIntoView = () => {};

let wide = true;
const media = (isWide: boolean) => {
  wide = isWide;
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return wide && q.includes("1024"); }, media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
};
const mount = async (st: AppState, isWide = true) => {
  media(isWide);
  state = st;
  localStorage.setItem("pmc_account", "proton");
  const r = render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  await waitFor(() => expect(r.container.textContent).toMatch(/scanned|No scan|Alpha|Clean up/));
  return r;
};
const tick = (patch: Partial<AppState>) => {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  const { groups: _g, ...slim } = { ...state, ...patch };
  state = { ...state, ...patch };
  act(() => es.onmessage!({ data: JSON.stringify(slim) }));
};
const job = (status: string, extra: object = {}) =>
  ({ status, progress: "", error: "", moved: 0, ...extra });
const entry = (ts: number, count: number, extra: object = {}) =>
  ({ ts, label: "Alpha", count, action: "snooze", ...extra });
const side = () => screen.findByRole("navigation", { name: "Main navigation" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  snooze.mockReset().mockResolvedValue({ ok: true, queued: 5, until: TOMORROW,
    skipped_pinned: 0, skipped_protected: 0, skipped_no_id: 0 });
  snoozed.mockReset().mockResolvedValue({ count: 10, stale: false, now: 1,
    batches: [], rows: [{ kind: "sender", addr: "alpha@x.example",
      label: "Alpha", count: 5, until: TOMORROW, subject: "",
      msgids: ["<a@x>"] }] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", FakeEventSource);
  localStorage.clear();
  FakeEventSource.instances.length = 0;
  undoApi.mockClear();
  window.location.hash = "";
  setLang("en");
});

test("a finished snooze toasts what it did, with an Undo for that step", async () => {
  await mount(baseState());
  tick({ delete: job("done", { moved: 5 }) as any, undo: [entry(7, 5)] });
  const msg = await screen.findByText(/5\s+mails snoozed\. They come back unread\./);
  fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(undoApi).toHaveBeenCalledWith(-1,
    { ts: 7, label: "Alpha", count: 5 }, "proton"));
});

test("one mail, and German", async () => {
  await mount(baseState());
  tick({ delete: job("done", { moved: 1 }) as any, undo: [entry(8, 1)] });
  await screen.findByText(/1\s+mail snoozed\. It comes back unread\./);
  cleanup();
  setLang("de");
  await mount(baseState());
  tick({ delete: job("done", { moved: 4 }) as any, undo: [entry(9, 4)] });
  await screen.findByText(/4\s+Mails zurückgestellt\. Die Mails kommen ungelesen wieder\./);
});

test("a batch's quiet step is not announced", async () => {
  await mount(baseState());
  tick({ delete: job("done", { moved: 3 }) as any,
    undo: [entry(7, 3, { quiet: true })] });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText(/snoozed/)).toBeNull();
});

test(">= 1024: Snoozed sits in the sidebar with its count and opens its page", async () => {
  await mount(baseState({ snoozed: { count: 10, until: {}, batches: {} } }));
  const nav = within(await side());
  const item = nav.getByRole("button", { name: /Snoozed/ });
  expect(item.textContent).toContain("10");
  fireEvent.click(item);
  await waitFor(() => expect(snoozed).toHaveBeenCalled());
  expect(await screen.findByText(/back tomorrow 08:00/)).toBeTruthy();
  expect(window.location.hash).toBe("#/snoozed");
  expect(nav.getByRole("button", { name: /Snoozed/ })
    .getAttribute("aria-current")).toBe("page");
});

test("the sidebar's Snoozed count follows the stream", async () => {
  await mount(baseState({ snoozed: { count: 10, until: {}, batches: {} } }));
  const nav = within(await side());
  tick({ snoozed: { count: 2, until: {}, batches: {} } });
  await waitFor(() => expect(nav.getByRole("button", { name: /Snoozed/ })
    .textContent).toContain("2"));
});

test("< 1024: the Clean up tab has a Snoozed tile with the count", async () => {
  window.location.hash = "#/cleanup";
  await mount(baseState({ snoozed: { count: 10, until: {}, batches: {} } }), false);
  const tile = await screen.findByRole("button", { name: /Snoozed/ });
  expect(tile.textContent).toMatch(/10\smails/);
  fireEvent.click(tile);
  await waitFor(() => expect(snoozed).toHaveBeenCalled());
});

test("a sender with snoozed mail shows the chip in the list", async () => {
  await mount(baseState({ snoozed: { count: 5,
    until: { "alpha@x.example": TOMORROW }, batches: {} } }));
  expect(screen.getAllByText("back tomorrow").length).toBeGreaterThan(0);
});

test("Not now in the selection bar snoozes the selected groups' unread mails", async () => {
  await mount(baseState());
  fireEvent.click(screen.getAllByLabelText("Select Alpha")[0]);
  const bar = await screen.findByRole("region", { name: "Selection actions" });
  fireEvent.click(within(bar).getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: /Snooze the 5/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: /Tomorrow morning/ }));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { grouping: "sender", keys: ["alpha@x.example"] }, TOMORROW, true));
  // the selection is cleared once it went through
  await waitFor(() => expect(screen.queryByRole("region",
    { name: "Selection actions" })).toBeNull());
});
