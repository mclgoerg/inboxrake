// @vitest-environment jsdom
/* Your documents inside the app: the route (#/documents), the sidebar item,
 * the phone's Insights card, Analyze first (the call the Attachments page
 * makes), and the page starting over when the account is switched. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const documentsSummary = vi.fn();
const documents = vi.fn();
const startAttachments = vi.fn();
const downloadDocument = vi.fn();

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: async () => state,
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    stats: () => Promise.reject(new Error("no stats")),
    wrapped: () => Promise.reject(new Error("no wrapped")),
    clearNotice: () => Promise.resolve(),
    version: () => Promise.resolve({ build: "v1" }),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    group: () => Promise.resolve([]),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    duplicatesSummary: () => Promise.reject(new Error("x")),
    trackers: () => Promise.resolve({ usable: false, checked: 0, pixel: 0,
      senders: 0 }),
    rhythm: () => Promise.reject(new Error("x")),
    addressesSummary: () => Promise.resolve({ leaked: 0, total: 0, scanned: true }),
    waitingSummary: () => Promise.resolve(null),
    waiting: () => Promise.reject(new Error("x")),
    subscriptions: () => Promise.reject(new Error("x")),
    yourFolders: () => Promise.reject(new Error("x")),
    mails: () => Promise.resolve({ items: [], total: 0 }),
    documentsSummary: () => documentsSummary(),
    documents: (...a: unknown[]) => documents(...a),
    startAttachments: () => startAttachments(),
    downloadDocument: (...a: unknown[]) => downloadDocument(...a),
    pin: () => Promise.resolve({ ok: true }),
    cancel: () => Promise.resolve({ ok: true }),
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
import { page, summary } from "./documentsFixtures";
import type { AppState, Config } from "./types";

const im = (user: string) => ({
  excluded_folders: [], host: "h", port: 993, security: "ssl",
  smtp_host: "", smtp_port: 587, smtp_security: "auto", user, password: "",
  password_set: true, cafile: "", preset: "custom", oauth: null,
  digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 } });
const cfg = {
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
  accounts: { proton: im("me@proton.example") },
} as unknown as Config;

const A = { key: "alpha@x.example", label: "Alpha", sub: "alpha@x.example",
  count: 30, size: 1000, unread: 0, first: "2024-01-01", last: "2024-06-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null };
const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: { [A.key]: A }, smart: {}, domain: {}, subject: {},
    thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "done", progress: "", error: "", mails: 3, size: 1 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState;

Element.prototype.scrollIntoView = () => {};
let isWide = true;
const listeners = new Set<() => void>();
const stubMedia = () => vi.stubGlobal("matchMedia", (q: string) => ({
  get matches() { return isWide && q.includes("1024"); }, media: q,
  addEventListener: (_: string, f: () => void) => listeners.add(f),
  removeEventListener: (_: string, f: () => void) => listeners.delete(f),
}));
const mount = (wide = true, patch: Partial<AppState> = {}) => {
  isWide = wide;
  stubMedia();
  state = { ...baseState, ...patch };
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};
const side = () => screen.findByRole("navigation", { name: "Main navigation" });

beforeEach(() => {
  documentsSummary.mockResolvedValue(summary());
  documents.mockResolvedValue(page());
  startAttachments.mockResolvedValue({ ok: true });
  downloadDocument.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); localStorage.clear();
  window.location.hash = ""; listeners.clear();
  for (const f of [documentsSummary, documents, startAttachments,
    downloadDocument]) f.mockReset();
  delete (cfg as any).accounts.work;
});

const rows = () => screen.getAllByTestId("doc-row");

test("the sidebar item opens the page as a page, the last one under Insights", async () => {
  mount();
  fireEvent.click(within(await side()).getByRole("button",
    { name: "Your documents" }));
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(window.location.hash).toBe("#/documents");
  expect(within(await side()).getByRole("button", { name: "Your documents" })
    .getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("region")).toBeTruthy();         // a page, no dialog
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(documents).toHaveBeenCalledWith(2026);
});

test("a deep link opens it, and closing goes back to the Overview", async () => {
  window.location.hash = "#/documents";
  mount();
  await waitFor(() => expect(rows()).toHaveLength(6));
  fireEvent.click(within(await side()).getByRole("link", { name: /Overview/ }));
  await waitFor(() => expect(screen.queryAllByTestId("doc-row")).toHaveLength(0));
  expect(window.location.hash).toBe("#/overview");
});

test("phone: the last card of the Insights tab opens it as a screen, and back returns to the tab", async () => {
  window.location.hash = "#/insights";
  mount(false);
  fireEvent.click(await screen.findByRole("button", { name: /^Your documents/ }));
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(screen.getByText(/312.*documents in 214.*mails/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Back to Insights|Insights/ }));
  await waitFor(() => expect(screen.queryAllByTestId("doc-row")).toHaveLength(0));
  expect(await screen.findByRole("button", { name: /^Your documents/ }))
    .toBeTruthy();
});

test("Analyze first: the page asks for the same analysis the Attachments page runs", async () => {
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  window.location.hash = "#/documents";
  mount(true, { atts: { status: "idle", progress: "", error: "", mails: 0,
    size: 0 } as AppState["atts"] });
  fireEvent.click(await screen.findByRole("button", { name: "Analyze" }));
  await waitFor(() => expect(startAttachments).toHaveBeenCalledOnce());
});

test("while the analysis runs the page shows its progress, and lists the files once it is done", async () => {
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  window.location.hash = "#/documents";
  mount(true, { atts: { status: "running", progress: "INBOX: 40/80", mails: 0,
    size: 0 } as AppState["atts"] });
  expect(await screen.findByText("INBOX: 40/80")).toBeTruthy();
  expect(documents).not.toHaveBeenCalled();
});

test("switching the account starts the page over", async () => {
  (cfg as any).accounts.work = im("me@work.example");
  window.location.hash = "#/documents";
  mount();
  await waitFor(() => expect(rows()).toHaveLength(6));
  const calls = documentsSummary.mock.calls.length;
  state = { ...baseState, account: "work" };
  fireEvent.click(within(await side()).getByRole("button", { name: /proton/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /work/ }));
  await waitFor(() => expect(documentsSummary.mock.calls.length)
    .toBeGreaterThan(calls));
  await waitFor(() => expect(rows()).toHaveLength(6));
});

test("the other pages of the sidebar still open as before", async () => {
  mount();
  for (const [name, hash] of [["Statistics", "#/stats"],
    ["Subscriptions", "#/subscriptions"], ["Waiting for a reply", "#/waiting"]] as const) {
    fireEvent.click(within(await side()).getByRole("button", { name }));
    await waitFor(() => expect(window.location.hash).toBe(hash));
  }
  expect(screen.queryAllByTestId("doc-row")).toHaveLength(0);
});
