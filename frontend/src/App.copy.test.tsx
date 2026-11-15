// @vitest-environment jsdom
/* Move to another account inside the app: the Settings entry opens the page
 * (a route, at every width), Back returns to the account's settings, and the
 * Tell-them step's "Review N unsubscribes" opens the unsubscribe review of the
 * OLD account (which becomes the active one). */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let current = "proton";
const setAccountCalls: string[] = [];
const previewCalls: unknown[][] = [];

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve({ ...state, account: current }),
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    version: () => Promise.resolve({ build: "v1" }),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    knowledge: () => new Promise(() => {}),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    group: () => Promise.resolve([]),
    copyPlan: () => Promise.resolve(plan),
    copySpace: () => Promise.resolve({ free: null }),
    copyStatus: () => Promise.resolve({ job: copyJob }),
    copyTell: () => Promise.resolve(tellData),
    unsubscribePreview: (...a: unknown[]) => {
      previewCalls.push(a);
      return Promise.resolve({ senders: [{ addr: "n@news.example",
        name: "News", via: "one_click", mails: 2, size: 1 }],
      skipped_protected: 0, skipped_done: 0, capped: 0, skipped_no_header: 0,
      trash: { groups: [], mails: 0, size: 0, pinned: 0 } });
    },
  },
  downloadFile: () => Promise.resolve(),
  setAccount: (n: string) => { current = n; setAccountCalls.push(n); },
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  undoLabel: (u: { label: string }) => u.label,
  errorText: (d: string) => d,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { backStackBusy } from "./backStack";
import { setLang } from "./i18n";
import type { AppState, Config, CopyJob, CopyPlan, CopyTell } from "./types";

const block = (user: string) => ({
  excluded_folders: [], host: "h", port: 993, security: "ssl",
  smtp_host: "", smtp_port: 587, smtp_security: "auto", user, password: "",
  password_set: true, cafile: "", preset: "custom", oauth: null,
  digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
});
const cfg = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: true },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: block("me@proton.example"),
    icloud: block("me@icloud.example") },
} as unknown as Config;

const state = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState;

const plan: CopyPlan = {
  source: { name: "proton", address: "me@proton.example", mails: 10,
    size: 1000 },
  target: { name: "icloud", address: "me@icloud.example" },
  folder: "From proton", kinds: [{ id: "orders", mails: 4, size: 400,
    default: true }],
  bits: { replied: 1, orders: 2, accounts: 4, appointments: 8, protected: 16,
    pinned: 32, newsletter: 64, other: 128 },
  combos: [{ mask: 2, mails: 4, size: 400 }], scanned: true, scanning: false,
};
let copyJob: CopyJob | null = null;
const tellData: CopyTell = {
  source: { name: "proton", address: "me@proton.example" },
  target: { name: "icloud", address: "me@icloud.example" },
  total: 0, done: 0, senders: [], newsletters: 2,
  newsletter_keys: ["n@news.example", "m@news.example"],
};

Element.prototype.scrollIntoView = () => {};

const mount = (wide: boolean) => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return wide && q.includes("1024"); }, media: q,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider>
  </ToastProvider>);
};
const hashIs = (hash: string) =>
  waitFor(() => expect(window.location.hash).toBe(hash));
const navSettled = () => waitFor(() => expect(backStackBusy()).toBe(false));

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); localStorage.clear(); setLang("en");
  window.location.hash = ""; current = "proton"; copyJob = null;
  setAccountCalls.length = 0; previewCalls.length = 0;
});

const openMove = async () => {
  fireEvent.click(await screen.findByRole("button",
    { name: /Move to another account…/ }));
};

test(">= 1024: Settings > the account > Move to another account… opens the " +
  "page; Back returns to that account", async () => {
  window.location.hash = "#/settings/account/proton";
  mount(true);
  await openMove();
  await screen.findByText("Orders & deliveries");
  await hashIs("#/move");
  expect(screen.getByText("Copy what matters from one mailbox to another - "
    + "for a provider switch or to merge two")).toBeTruthy();
  // the page closes with its Esc / close button: back to the account's settings
  fireEvent.click(screen.getByRole("button",
    { name: "Back to Settings" }));
  await hashIs("#/settings/account/proton");
  await navSettled();
  await screen.findByLabelText("Host");
});

test("< 1024: the page is a full screen with a back link to Settings",
  async () => {
    window.location.hash = "#/settings/account/proton";
    mount(false);
    await openMove();
    await screen.findByText("Orders & deliveries");
    await hashIs("#/move");
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    await hashIs("#/settings/account/proton");
  });

test("a deep link #/move opens the page for the active account", async () => {
  window.location.hash = "#/move";
  mount(true);
  await screen.findByText("Orders & deliveries");
  expect(screen.getAllByText("me@proton.example").length).toBeGreaterThan(0);
});

test("Review N unsubscribes opens the review of the OLD account", async () => {
  copyJob = { id: "j", source: "icloud", target: "proton",
    folder: "From icloud", kinds: ["orders"], status: "done", total: 4,
    bytes_total: 4, processed: 4, copied: 4, skipped: 0, checked: 4,
    unchecked: 0, too_large: 0, missing: 0, failed: 0, bytes_done: 4,
    started: 1, finished: 2, error: "", active_s: 1, eta_s: null };
  window.location.hash = "#/move";
  mount(true);                                  // the active account: proton
  fireEvent.click(await screen.findByRole("button", { name: "Tell them…" }));
  fireEvent.click(await screen.findByRole("button",
    { name: "Review 2 unsubscribes" }));
  // the old account is the active one now, and its review lists the senders
  await waitFor(() => expect(setAccountCalls).toContain("icloud"));
  await waitFor(() => expect(previewCalls).toEqual([["sender",
    ["n@news.example", "m@news.example"]]]));
  const dlg = await screen.findByText("News");
  expect(within(dlg.closest("[role=dialog]") as HTMLElement)).toBeTruthy();
});
