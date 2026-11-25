// @vitest-environment jsdom
/* With All accounts selected the app still has ONE account loaded behind the
 * view (the last single account). A move that finishes there must not toast
 * "Moved N mails to Trash" with an Undo for it: the user acted on the accounts
 * of the confirm, whose own list says what happened and where the Undo is. The
 * same tick in single-account mode still toasts (the control). */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DATA, SENDERS_RESP } from "./allAccountsFixtures";

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
    version: () => Promise.resolve({ build: "v1" }),
    accountsOverview: () => Promise.resolve(DATA),
    accountsSummary: () => Promise.resolve({}),
    accountsSenders: () => Promise.resolve(SENDERS_RESP),
    undo: vi.fn().mockResolvedValue({ ok: true }),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { AppState, Config } from "./types";

const acct = {
  excluded_folders: [] as string[], host: "h", port: 993,
  security: "ssl" as const, smtp_host: "", smtp_port: 587,
  smtp_security: "auto" as const, user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6, align_minute: 0 },
};
const cfg = {
  default_account: "gmail",
  accounts: { gmail: { ...acct, user: "a@x.example" },
    icloud: { ...acct, user: "b@x.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const baseState = {
  account: "gmail", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [] } as unknown as AppState;
const job = (status: string, extra: object = {}) =>
  ({ status, progress: "", error: "", moved: 0, ...extra });

const tick = (patch: Partial<AppState>) => {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  const { groups: _g, ...slim } = { ...state, ...patch };
  state = { ...state, ...patch };
  act(() => es.onmessage!({ data: JSON.stringify(slim) }));
};
const finishAMove = () => {
  tick({ delete: job("running", { progress: "3/12" }) as any });
  tick({ delete: job("done", { moved: 12 }) as any,
    undo: [{ ts: 7, label: "Shop News", count: 12, action: "trash" }] });
};

beforeEach(() => {
  setLang("en");
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.instances.length = 0;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("1024"), media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  Element.prototype.scrollIntoView = () => {};
  state = { ...baseState };
  localStorage.setItem("pmc_account", "gmail");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear();
  window.location.hash = ""; });

const mount = async (hash: string) => {
  window.location.hash = hash;
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
};

test("All accounts: a move that finishes in the loaded account is not toasted",
  async () => {
  localStorage.setItem("pmc_scope", "all");
  await mount("#/senders");
  await screen.findAllByText("Deals Daily");
  finishAMove();
  await new Promise((r) => setTimeout(r, 150));
  expect(screen.queryByText("Moved 12 mails to Trash")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

test("control: the same tick in single-account mode toasts with an Undo",
  async () => {
  await mount("#/senders");
  await waitFor(() => expect(document.body.textContent).toMatch(/scanned|No scan/));
  finishAMove();
  const msg = await screen.findByText("Moved 12 mails to Trash");
  expect(msg.parentElement!.querySelector("button")!.textContent).toBe("Undo");
});
