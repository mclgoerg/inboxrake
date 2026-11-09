// @vitest-environment jsdom
/* UX3-10: tools as pages (>= 1024 px) - deep links, handovers back to the
 * list, key handling under dialogs, and surviving a resize with their state. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const stateCalls = { n: 0 };
let state: any;
let stateGate: Promise<void> | null = null;   // holds api.state() back
let dupCalls = 0;
let dupSets: unknown[] = [];
const deleteMessages = vi.fn().mockResolvedValue({ ok: true, queued: 1 });
const attachments = vi.fn();
let auditCalls = 0;
const aiFilter = vi.fn();
const undoCall = vi.fn().mockResolvedValue({ restored: 1, of: 1, rescan: true });

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: async () => {
      stateCalls.n++;
      if (stateGate) await stateGate;
      return state;
    },
    audit: () => { auditCalls++; return Promise.resolve({ entries: [], total: 0 }); },
    stats: () => Promise.reject(new Error("no stats")),
    wrapped: () => Promise.reject(new Error("no wrapped")),
    undo: (...a: unknown[]) => undoCall(...a),
    clearNotice: () => Promise.resolve(),
    version: () => Promise.resolve({ build: "v1" }),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    aiFilter: (...a: unknown[]) => aiFilter(...a),
    group: () => Promise.resolve([]),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    foldersPanel: () => Promise.resolve({ mails: [], total: 0, senders: [] }),
    duplicates: () => { dupCalls++; return Promise.resolve(dupSets); },
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    attachments: () => attachments(),
    attachmentsSummary: () => Promise.resolve({ total: 0, mails: 0, kinds: [],
      repeats: null }),
    duplicateVersions: () => Promise.resolve([]),
    possibleDuplicates: () => Promise.resolve([]),
    trackers: () => Promise.resolve({
      usable: true, reason: null, docs: 3, checked: 3, pixel: 2, click: 1,
      any: 2, senders: 1, top_senders: [{ key: "alpha@x.example",
        label: "Alpha", checked: 3, tracked: 2, pixel: 2, click: 1, hosts: [] }],
      top_hosts: [], mode: "local", secret_key_set: true, scanned: true,
      estimate_full: {}, job: { status: "idle" } }),
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
import { findDialog, pressDialog } from "./dialogTestUtils";
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


// jsdom has no scrollIntoView (App scrolls the focused row into view).
Element.prototype.scrollIntoView = () => {};

// matchMedia with live listeners, so a test can cross 1024 px.
let isWide = true;
const listeners = new Set<() => void>();
const stubMedia = () => vi.stubGlobal("matchMedia", (q: string) => ({
  get matches() { return isWide && q.includes("1024"); }, media: q,
  addEventListener: (_: string, f: () => void) => listeners.add(f),
  removeEventListener: (_: string, f: () => void) => listeners.delete(f),
}));
const resize = (wide: boolean) => {
  isWide = wide;
  act(() => { listeners.forEach((f) => f()); });
};
const mount = (wide = true, patch: Partial<AppState> = {}) => {
  isWide = wide;
  stubMedia();
  state = { ...baseState, scanned_ts: 1, junk_count: 4, trash_count: 7, ...patch };
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};
const side = () => screen.findByRole("navigation", { name: "Main navigation" });
const goto = (hash: string) => act(() => {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
});

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); localStorage.clear();
  window.location.hash = ""; stateGate = null; listeners.clear();
  dupCalls = 0; auditCalls = 0; dupSets = [];
  deleteMessages.mockClear(); attachments.mockReset(); aiFilter.mockReset(); undoCall.mockClear();
  (cfg as any).ai.available = false;
});

test("a reload on #/triage waits for the state: no empty deck, no crash",
  async () => {
  let release!: () => void;
  stateGate = new Promise<void>((r) => { release = r; });
  window.location.hash = "#/triage";
  mount();
  await side();
  // nothing yet: the panel is not mounted on an empty deck
  expect(screen.queryByText(/Nothing to apply/)).toBeNull();
  expect(screen.queryByText(/Card 1 of/)).toBeNull();
  await act(async () => { release(); });
  expect(await screen.findByText("Card 1 of 3")).toBeTruthy();
  // keep, keep, keep -> summary; "Back to cards" works and nothing throws
  for (let i = 0; i < 3; i++)
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  fireEvent.click(await screen.findByRole("button", { name: "Back to cards" }));
  expect(await screen.findByText("Card 3 of 3")).toBeTruthy();
});

test("Triage ignores keys meant for a dialog opened over it", async () => {
  window.location.hash = "#/triage";
  mount();
  await screen.findByText("Card 1 of 3");
  fireEvent.click(within(await side()).getByRole("button",
    { name: "Your year in mail" }));
  await screen.findByRole("dialog");
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  fireEvent.keyDown(document.body, { key: "ArrowLeft" });
  // still card 1 once the dialog is gone: nothing was decided behind it
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Card 1 of 3")).toBeTruthy();
  // and a text field on the page keeps its arrow keys
  const input = document.createElement("input");
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: "ArrowRight" });
  input.remove();
  expect(screen.getByText("Card 1 of 3")).toBeTruthy();
  // while a plain key still decides
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(await screen.findByText("Card 2 of 3")).toBeTruthy();
});

test("switching account on a tool page starts the panel over", async () => {
  window.location.hash = "#/triage";
  (cfg as any).accounts.work = { ...(cfg as any).accounts.proton,
    user: "me@work.example" };
  try {
    mount();
    await screen.findByText("Card 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(await screen.findByText("Card 2 of 3")).toBeTruthy();
    fireEvent.click(within(await side()).getByRole("button", { name: /proton/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /work/ }));
    // the old deck is gone with the old account; the new one starts at 1
    expect(await screen.findByText("Card 1 of 3")).toBeTruthy();
  } finally {
    delete (cfg as any).accounts.work;
  }
});

// A confirm belongs to the whole app and outlives the page that asked: if the
// account changed meanwhile, the old account's mail ids must not be sent.
const copy = (uid: number, folder: string) => ({ uid, folder, subject: "Receipt",
  date: "2026-01-02 10:30", ts: 1000 + uid, addr: "a@x.example", size: 2048,
  seen: true, ai: null, msgid: "<r@x.example>", pinned: false });
const switchToWork = async () => {
  fireEvent.click(within(await side()).getByRole("button", { name: /proton/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /work/ }));
};
const withWorkAccount = async (run: () => Promise<void>) => {
  (cfg as any).accounts.work = { ...(cfg as any).accounts.proton,
    user: "me@work.example" };
  try { await run(); } finally { delete (cfg as any).accounts.work; }
};

test("an account switch while the Duplicates confirm is open moves nothing",
  async () => withWorkAccount(async () => {
  window.location.hash = "#/duplicates";
  dupSets = [{ key: "<r@x.example>", wasted: 2048, locked: null,
    mails: [copy(2, "INBOX"), copy(1, "Archive")] }];
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Remove 1 copy" }));
  await findDialog();
  await switchToWork();
  await pressDialog(/Move to Trash \(1\)/);
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteMessages).not.toHaveBeenCalled();
}));

test("an account switch while the Attachments confirm is open moves nothing",
  async () => withWorkAccount(async () => {
  window.location.hash = "#/attachments";
  attachments.mockResolvedValue([{ uid: 1, folder: "INBOX", date: "2026-01-02",
    ts: 1e9, subject: "Scan", addr: "a@x.example", size: 10, seen: false,
    ai: null, att_size: 2e6,
    atts: [{ name: "doc.pdf", size: 2e6, kind: "pdf", ext: "pdf", copies: 1 }] }]);
  mount(true, { atts: { status: "done", progress: "", error: "", mails: 1,
    size: 2e6 } } as Partial<AppState>);
  fireEvent.click(await screen.findByLabelText("Select doc.pdf"));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  await findDialog();
  await switchToWork();
  await pressDialog(/Move to Trash \(1\)/);
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteMessages).not.toHaveBeenCalled();
}));

test("a tool survives crossing 1024 px in both directions: Triage decisions",
  async () => {
  window.location.hash = "#/triage";
  mount();
  await screen.findByText("Card 1 of 3");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(await screen.findByText("Card 2 of 3")).toBeTruthy();
  resize(false);                       // narrowing: the same panel, a modal
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Card 2 of 3")).toBeTruthy();
  resize(true);                        // widening: back to a page
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Card 2 of 3")).toBeTruthy();
  expect(window.location.hash).toBe("#/triage");
});

test("a modal opened below 1024 becomes its page when the window widens, "
  + "with the draft intact", async () => {
  mount(false);
  fireEvent.click(await screen.findByRole("link", { name: "Clean up" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Rules/ }));
  fireEvent.click(await screen.findByRole("button", { name: "New rule" }));
  const name = await screen.findByPlaceholderText("Rule name") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Draft rule" } });
  expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
  resize(true);
  await waitFor(() => expect(window.location.hash).toBe("#/rules"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByPlaceholderText("Rule name") as HTMLInputElement).value)
    .toBe("Draft rule");
  // and back: a deep-linked / resized tool shows as the full-screen modal
  resize(false);
  // the tool as a dialog again, the builder as a sheet over it
  expect((await screen.findAllByRole("dialog")).length).toBe(2);
  expect((screen.getByPlaceholderText("Rule name") as HTMLInputElement).value)
    .toBe("Draft rule");
});

test("below 1024 a tool route opens the full-screen modal; closing leaves it",
  async () => {
  window.location.hash = "#/rules";
  mount(false);
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Clean up" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // back on the tab page that lists the tool
  expect(window.location.hash).toBe("#/cleanup");
  expect(await screen.findByRole("heading", { level: 1, name: "Clean up" }))
    .toBeTruthy();
});

test("a tool reached by resize returns to its tab page on close (Insights)",
  async () => {
  mount(true);
  window.location.hash = "#/trackers";
  goto("#/trackers");
  resize(false);
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Insights" }));
  await waitFor(() => expect(window.location.hash).toBe("#/insights"));
});

test("a tool modal opened from the Clean up tab returns there", async () => {
  mount(false);
  fireEvent.click(await screen.findByRole("link", { name: "Clean up" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Rules/ }));
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Clean up" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(window.location.hash).toBe("#/cleanup");
});

test("widening on #/cleanup replaces the history entry with #/overview",
  async () => {
  window.location.hash = "#/cleanup";
  const replace = vi.spyOn(window.history, "replaceState");
  mount(false);
  await screen.findByRole("heading", { level: 1, name: "Clean up" });
  const len = window.history.length;
  resize(true);
  await waitFor(() => expect(window.location.hash).toBe("#/overview"));
  expect(replace).toHaveBeenCalled();
  expect(window.history.length).toBe(len);
  replace.mockRestore();
});

test("Junk and Trash are two pages: the route and the sidebar pick the folder",
  async () => {
    window.location.hash = "#/junk";
    mount();
    await screen.findByText("Junk is empty");
    // no Junk | Trash switch inside a page any more
    expect(screen.queryByRole("tab", { name: "Trash" })).toBeNull();
    fireEvent.click(within(await side()).getByRole("button", { name: /Trash/ }));
    expect(window.location.hash).toBe("#/trash");
    await screen.findByText("Trash is empty");
    goto("#/junk");                                   // Back
    await screen.findByText("Junk is empty");
    expect(screen.queryByText("Trash is empty")).toBeNull();
  });

test("leaving a page by Back refreshes (Duplicates)", async () => {
  mount();
  fireEvent.click(within(await side()).getByRole("button", { name: /Duplicates/ }));
  await waitFor(() => expect(dupCalls).toBeGreaterThan(0));
  const before = stateCalls.n;
  goto("#/senders");
  await waitFor(() => expect(stateCalls.n).toBeGreaterThan(before));
});

test("Space map -> select senders lands on Senders with the selection",
  async () => {
  window.location.hash = "#/space";
  mount();
  const map = await screen.findByTestId("space-map");
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  fireEvent.click(within(map).getAllByRole("button")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Review in Senders" }));
  await waitFor(() => expect(window.location.hash).toBe("#/senders"));
  expect(screen.queryByTestId("space-map")).toBeNull();
  expect(await screen.findByRole("region", { name: "Selection actions" }))
    .toBeTruthy();
});

test("Trackers -> a sender filters the Senders list by from:", async () => {
  window.location.hash = "#/trackers";
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/senders"));
  expect((await screen.findByPlaceholderText("Search or filter…") as
    HTMLInputElement).value).toBe("from:alpha@x.example");
});

test("AI filter 'Save as rule' opens the Rules page with the query",
  async () => {
  (cfg as any).ai.available = true;
  localStorage.setItem("pmc_ai_ack", "1");
  aiFilter.mockResolvedValue({ query: "tag:newsletter unread:>90",
    explanation: "", unsupported: [] });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Filter" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Describe a filter/ }));
  const dlg = await screen.findByRole("dialog", { name: "Describe a filter" });
  fireEvent.change(within(dlg).getByLabelText("Describe what you are looking for"),
    { target: { value: "newsletters I never read" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Send" }));
  await within(dlg).findByDisplayValue("tag:newsletter unread:>90");
  fireEvent.click(within(dlg).getByRole("button", { name: "Save as rule…" }));
  await waitFor(() => expect(window.location.hash).toBe("#/rules"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await screen.findByDisplayValue("tag:newsletter unread:>90"))
    .toBeTruthy();
});

test("Activity: restoring an undo entry reloads the audit log below",
  async () => {
  mount();
  state = { ...state, undo: [{ action: "delete", count: 2, label: "Older",
    ts: 1 }] };
  fireEvent.click(within(await side()).getByRole("button", { name: /Activity/ }));
  const item = await screen.findByRole("region", { name: "Undo history" });
  await waitFor(() => expect(auditCalls).toBeGreaterThan(0));
  const before = auditCalls;
  fireEvent.click(within(item).getByRole("button", { name: "Undo" }));
  await findDialog();
  await pressDialog("Restore");
  await waitFor(() => expect(undoCall).toHaveBeenCalled());
  await waitFor(() => expect(auditCalls).toBeGreaterThan(before));
});

test("the back link of a tool modal names the page it returns to", async () => {
  mount(false);
  goto("#/overview");
  fireEvent.click(await screen.findByRole("button", { name: "Search all mails" }));
  let dlg = await screen.findByRole("dialog");
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Overview" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(window.location.hash).toBe("#/overview");
  goto("#/senders");
  fireEvent.click(await screen.findByRole("button", { name: "Search all mails" }));
  dlg = await screen.findByRole("dialog");
  fireEvent.click(within(dlg).getByRole("button", { name: "Back to Senders" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(window.location.hash).toBe("#/senders");
});
