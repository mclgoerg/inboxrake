// @vitest-environment jsdom
/* The All accounts PAGE inside the app: a page, never a mode. Opening it and
 * every action on it leave the selected account alone - only Open and Open in
 * <account> switch (like the switcher), Fix it opens that account's settings.
 * Every step is pinned to its own account; no page ever asks to pick one. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let current = "proton";                       // what api.setAccount last got
const setAccount = vi.fn((n: string) => { current = n; });
let holdState: Record<string, Promise<unknown> | undefined> = {};
const deleteGroups = vi.fn();
const unsubscribe = vi.fn();
const block = vi.fn();
const keepCheck = vi.fn();
const overviewCall = vi.fn();
const undo = vi.fn();

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => {
      const at = current;
      return (holdState[at] ?? Promise.resolve()).then(() => stateFor(at));
    },
    accountsSummary: () => Promise.resolve({}),
    accountsOverview: (...a: unknown[]) => overviewCall(...a),
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    undo: (...a: unknown[]) => undo(...a),
    version: () => Promise.resolve({ build: "v1" }),
    group: () => Promise.resolve([]),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    unsubscribe: (...a: unknown[]) => unsubscribe(...a),
    block: (...a: unknown[]) => block(...a),
    keepSafeCheck: (...a: unknown[]) => keepCheck(...a),
    keepSafePin: () => Promise.resolve({ pinned: 0, items: [] }),
    deleteRule: () => Promise.resolve(),
    scan: () => Promise.resolve({ ok: true }),
    mails: () => Promise.resolve({ items: [], total: 0 }),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
  },
  setAccount: (n: string) => setAccount(n),
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  undoLabel: (u: { label: string }) => u.label,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
  errorText: (m: string) => m,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { overview, row, part } from "./allAccountsFixtures";
import { setLang } from "./i18n";
import type { AppState, Config } from "./types";

const im = (user: string) => ({ excluded_folders: [], host: "h", port: 993,
  security: "ssl", smtp_host: "", smtp_port: 587, smtp_security: "auto",
  user, password: "", password_set: true, verified: true, cafile: "",
  preset: "custom", oauth: null,
  digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 } });
const cfg = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "x", foundry_endpoint: "", price_in: 0,
    price_out: 0, budget_usd: 0, month_cost: 0, prices_effective: [2, 10],
    api_key: "", api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: im("me@proton.example"), icloud: im("me@icloud.example"),
    work: im("me@work.example") },
} as unknown as Config;

const sender = (key: string, label: string, count: number) => ({
  key, label, sub: key, count, size: 1000, unread: 0, first: "2024-01-01",
  last: "2024-06-01", tags: [], samples: [], bulk: true, unsub: true, ai: null,
  ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null });
// set by a test: what the selected account's state says after a move ran
let after: Partial<AppState> | null = null;
const stateFor = (account: string): AppState => ({
  account, status: "done", scanned_ts: 1, groups_rev: 0, progress: "",
  error: "", folders: [],
  groups: { sender: { "deals@dealsdaily.example":
    sender("deals@dealsdaily.example", `Deals Daily (${account})`, 30) },
    smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0, seq: 1 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0, links: 0,
    failed: 0, skipped: 0 },
  trash_count: 0, junk_count: 0, notice: null, undo: [], folders_raw: [],
  rules: [], presets: [], ...(after ?? {}) }) as unknown as AppState;

Element.prototype.scrollIntoView = () => {};

let wide = true;
const widen = (w: boolean) => {
  wide = w;
  vi.stubGlobal("matchMedia", (q: string) => ({
    // the sidebar from 1024 px, the split pane from 1280 px
    get matches() { return wide && (q.includes("1024") || q.includes("1280")); },
    media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
};
const mount = (w = true) => {
  widen(w);
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};

const dealsRow = () => row("dealsdaily.example", "Deals Daily", [
  part("proton", "deals@dealsdaily.example", { mails: 30 }),
  part("icloud", "deals@dealsdaily.example", { mails: 20 }),
  part("work", "deals@dealsdaily.example", { mails: 10 })]);

beforeEach(() => {
  setLang("en");
  current = "proton";
  holdState = {};
  after = null;
  overviewCall.mockResolvedValue(overview({
    accounts: overview().accounts.slice(0, 3).map((a, i) => ({ ...a,
      name: ["proton", "icloud", "work"][i], failed: false, status: "done",
      failed_ts: null })),
    same_sender: [dealsRow()] }));
  deleteGroups.mockResolvedValue({ ok: true, queued: 5, skipped: 0 });
  unsubscribe.mockResolvedValue({ action: "done", via: "one_click", detail: "", addr: "x" });
  block.mockResolvedValue({ rule: { id: "r1" } });
  keepCheck.mockResolvedValue({ total: 1, kept: 0, classes: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const f of [setAccount, deleteGroups, unsubscribe, block, keepCheck,
    overviewCall, undo]) f.mockReset();
  setAccount.mockImplementation((n: string) => { current = n; });
  localStorage.clear();
  window.location.hash = "";
});

const side = () => screen.findByRole("navigation", { name: "Main navigation" });
const openPage = async () => {
  fireEvent.click(within(await side()).getByRole("button", { name: "All accounts" }));
  await screen.findByText("Same sender, several accounts");
};
const confirm = (name: RegExp) => screen.getByRole("button", { name });
const selectedBefore = () => localStorage.getItem("pmc_account");

test("the sidebar's last Insights item opens the page at #/accounts - and selects nothing",
  async () => {
  mount();
  await openPage();
  expect(window.location.hash).toBe("#/accounts");
  expect(screen.queryByRole("dialog")).toBeNull();          // a page, not a modal
  expect(selectedBefore()).toBe("proton");
  expect(setAccount).toHaveBeenCalledTimes(1);               // App's own start-up call only
  expect(setAccount).toHaveBeenCalledWith("proton");
  expect(within(await side()).getByRole("button", { name: "All accounts" })
    .getAttribute("aria-current")).toBe("page");
  expect(document.body.textContent).not.toMatch(/pick an account/i);
});

test("the switcher popover has the row; it opens the page and the account stays",
  async () => {
  mount();
  fireEvent.click(within(await side()).getByRole("button", { name: /proton/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /All accounts/ }));
  await screen.findByText("Same sender, several accounts");
  expect(window.location.hash).toBe("#/accounts");
  expect(selectedBefore()).toBe("proton");
  expect(setAccount).toHaveBeenCalledTimes(1);
});

test("the existing pages are untouched while the page exists: Senders still lists the selected account's senders",
  async () => {
  mount();
  await openPage();
  fireEvent.click(within(await side()).getByRole("link", { name: /Senders/ }));
  expect((await screen.findAllByText("Deals Daily (proton)")).length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toMatch(/pick an account/i);
  expect(selectedBefore()).toBe("proton");
});

test("a step on the page runs in ITS account and the selected account never changes",
  async () => {
  mount();
  await openPage();
  const pane = within(await screen.findByTestId("same-pane"));
  fireEvent.click(pane.getByRole("button", { name: "Trash in 3" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Trash \d+\sin\s3\saccounts$/ }));
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledTimes(3));
  // pinned to its own account, in order - the 10th argument is the account
  expect(deleteGroups.mock.calls.map((c) => c[9])).toEqual(
    ["proton", "icloud", "work"]);
  expect(deleteGroups.mock.calls.every((c) => c[8] === true)).toBe(true);
  // ... and nothing switched: no setAccount, the stored account is untouched
  expect(setAccount).toHaveBeenCalledTimes(1);
  expect(selectedBefore()).toBe("proton");
  expect(current).toBe("proton");
});

test("a move in several accounts has ONE toast: the selected account's own 'moved' toast stays quiet",
  async () => {
  const step = (id: string, count: number) => ({ id, ts: 7, label: "Deals Daily",
    count, action: "trash" });
  // the steps exist only once the moves were queued
  let queued = false;
  deleteGroups.mockImplementation(() => {
    queued = true;
    return Promise.resolve({ ok: true, queued: 5, skipped: 0 });
  });
  overviewCall.mockImplementation(() => Promise.resolve(overview({
    accounts: ["proton", "icloud", "work"].map((n, i) => ({
      ...overview().accounts[0], name: n, busy: false,
      undo_last: queued ? step(`s${i}`, 5) : null })),
    same_sender: [dealsRow()] })));
  mount();
  await openPage();
  fireEvent.click(within(await screen.findByTestId("same-pane"))
    .getByRole("button", { name: "Trash in 3" }));
  await screen.findAllByRole("checkbox");
  // by the time the move has run, the selected account's state carries its step
  after = { undo: [{ id: "s0", ts: 7, label: "Deals Daily", count: 5,
    action: "trash" }] as never,
  delete: { status: "done", progress: "", error: "", moved: 5, seq: 2 } };
  fireEvent.click(await screen.findByRole("button",
    { name: /^Trash \d+\sin\s3\saccounts$/ }));
  expect(await screen.findByText("Moved 15 mails to Trash in 3 accounts"))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo all 3" })).toBeTruthy();
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByText(/^Moved 5 mails to Trash$/)).toBeNull();
  expect(screen.getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
});

test("Unsubscribe and Block in N: also one call per account, none of them selects one",
  async () => {
  mount();
  await openPage();
  fireEvent.click(within(await screen.findByTestId("same-pane"))
    .getByRole("button", { name: "Unsubscribe in 3" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Unsubscribe in 3\saccounts$/ }));
  await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(3));
  expect(unsubscribe.mock.calls.map((c) => c[3])).toEqual(["proton", "icloud", "work"]);
  fireEvent.click(within(await screen.findByTestId("same-pane"))
    .getByRole("button", { name: "Block in 3" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Block in 3\saccounts$/ }));
  await waitFor(() => expect(block).toHaveBeenCalledTimes(3));
  expect(block.mock.calls.map((c) => c[4])).toEqual(["proton", "icloud", "work"]);
  expect(setAccount).toHaveBeenCalledTimes(1);
  expect(selectedBefore()).toBe("proton");
});

test("Open on a card switches to that account and shows its Overview",
  async () => {
  mount();
  await openPage();
  fireEvent.click(within(screen.getAllByTestId("account-card")[1])
    .getByRole("button", { name: "Open icloud" }));
  await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("icloud"));
  expect(selectedBefore()).toBe("icloud");
  await waitFor(() => expect(window.location.hash).toBe("#/overview"));
});

test("Fix it opens that account's settings - and switches nothing", async () => {
  overviewCall.mockResolvedValue(overview({
    accounts: overview().accounts.slice(0, 3).map((a, i) => ({ ...a,
      name: ["proton", "icloud", "work"][i], failed: i === 2, status: i === 2 ? "error" : "done",
      failed_ts: i === 2 ? 1 : null })),
    same_sender: [dealsRow()] }));
  mount();
  await openPage();
  fireEvent.click(within(screen.getAllByTestId("account-card")[2])
    .getByRole("button", { name: "Fix it" }));
  await waitFor(() => expect(window.location.hash).toBe("#/settings/account/work"));
  expect(setAccount).toHaveBeenCalledTimes(1);
  expect(selectedBefore()).toBe("proton");
});

test("Open in <account> switches there and opens the sender once it is loaded",
  async () => {
  mount();
  await openPage();
  fireEvent.click(within(await screen.findByTestId("same-pane"))
    .getByRole("button", { name: "Open in icloud" }));
  await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("icloud"));
  expect(await screen.findAllByText(/Deals Daily \(icloud\)/)).toBeTruthy();
  expect(selectedBefore()).toBe("icloud");
});

test("a pending Open in <account> is dropped when the account changes meanwhile",
  async () => {
  let release: (v?: unknown) => void = () => {};
  holdState.icloud = new Promise((r) => { release = r; });
  mount();
  await openPage();
  fireEvent.click(within(await screen.findByTestId("same-pane"))
    .getByRole("button", { name: "Open in icloud" }));
  await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("icloud"));
  // the user picks ANOTHER account before icloud has loaded
  fireEvent.click(within(await side()).getByRole("button", { name: /icloud/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /work/ }));
  await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("work"));
  await act(async () => { release(); });
  // later a return to icloud must not open that sender out of the blue
  fireEvent.click(within(await side()).getByRole("button", { name: /work/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /icloud/ }));
  await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("icloud"));
  await new Promise((r) => setTimeout(r, 200));
  expect(screen.queryByText(/Deals Daily \(icloud\)/)).toBeNull();
});

test("phone: the Accounts sheet has the row and the Insights tab ends with the card",
  async () => {
  mount(false);
  fireEvent.click(await screen.findByRole("button", { name: /^Account:/ }));
  const sheet = await screen.findByRole("dialog");
  expect(within(sheet).getByRole("button", { name: /All accounts/ })).toBeTruthy();
  // the cards of the sheet are as before
  for (const n of ["proton", "icloud", "work"])
    expect(within(sheet).getByRole("button", { name: new RegExp(n) })).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: /All accounts/ }));
  // the sheet closes, the page opens (a modal below 1024), nothing is selected
  expect(await screen.findByText("Same sender, several accounts")).toBeTruthy();
  expect(selectedBefore()).toBe("proton");
  expect(setAccount).toHaveBeenCalledTimes(1);
});

test("German: the row, the sidebar item and the page", async () => {
  setLang("de");
  mount();
  fireEvent.click(within(await screen.findByRole("navigation",
    { name: "Hauptnavigation" })).getByRole("button", { name: "Alle Konten" }));
  expect(await screen.findByText("Gleicher Absender, mehrere Konten")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Konto auswählen/);
});
