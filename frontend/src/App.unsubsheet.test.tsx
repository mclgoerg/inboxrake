// @vitest-environment jsdom
/* The unsubscribe sheet inside the app: the bulk bar and the sender detail
 * open it, a run's end is shown by the sheet (not a toast), the optional
 * Trash step goes through the app's own trash path AFTER the run, and the
 * toast comes back when the sheet is hidden mid-run. */

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

const unsubscribePreview = vi.fn();
const unsubscribeBulk = vi.fn();
const unsubscribeResults = vi.fn();
const deleteGroups = vi.fn();

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    group: () => Promise.resolve([]),
    unsubscribePreview: (...a: unknown[]) => unsubscribePreview(...a),
    unsubscribeBulk: (...a: unknown[]) => unsubscribeBulk(...a),
    unsubscribeResults: (...a: unknown[]) => unsubscribeResults(...a),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { findDialog, pressDialog } from "./dialogTestUtils";
import { barAction } from "./barTestUtil";
import { openUnsubscribeSheet } from "./components/UnsubscribeSheet";
import { setLang } from "./i18n";
import type { AppState, Config, Group } from "./types";

const acct = {
  excluded_folders: [] as string[], host: "h", port: 993,
  security: "ssl" as const, smtp_host: "", smtp_port: 587,
  smtp_security: "auto" as const, user: "", password: "",
  password_set: true, cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg = {
  accounts: { proton: acct }, default_account: "proton",
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "m", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const KEY = "news@shop.example";
const group: Group = {
  key: KEY, label: "Shop News", sub: KEY, count: 12, size: 12000, unread: 2,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [],
  bulk: true, unsub: true, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50,
};
const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["INBOX"],
  groups: { sender: { [KEY]: group }, smart: {}, domain: {}, subject: {},
    thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0, seq: 4 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["INBOX"], rules: [],
  presets: [],
};

const PREVIEW = {
  senders: [{ addr: KEY, name: "Shop News", via: "one_click", mails: 12,
    size: 12000 }],
  skipped_protected: 0, skipped_done: 0, capped: 0, skipped_no_header: 0,
  trash: { groups: [{ key: KEY, addrs: [KEY], mails: 12, size: 12000 }],
    mails: 12, size: 12000, pinned: 0 },
};

beforeEach(() => {
  setLang("en");
  localStorage.setItem("pmc_account", "proton");
  unsubscribePreview.mockReset().mockResolvedValue(PREVIEW);
  unsubscribeBulk.mockReset().mockResolvedValue({ queued: 1,
    skipped_protected: 0, skipped_done: 0, capped: 0, run: 5 });
  unsubscribeResults.mockReset().mockResolvedValue({ run: 5, items: [
    { addr: KEY, status: "done", via: "one_click", link: "", error: "" }] });
  deleteGroups.mockReset().mockResolvedValue({ ok: true, queued: 12,
    skipped: 0 });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  FakeEventSource.instances.length = 0;
});

Element.prototype.scrollIntoView = () => {};

const mount = async () => {
  state = baseState;
  const r = render(<ToastProvider><DialogProvider><App /></DialogProvider>
    </ToastProvider>);
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  await waitFor(() => expect(r.container.textContent).toMatch(/scanned|Shop News/));
  return r;
};
const tick = (patch: Partial<AppState>) => {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  const { groups: _g, ...slim } = { ...state, ...patch };
  state = { ...state, ...patch };
  act(() => es.onmessage!({ data: JSON.stringify(slim) }));
};
const unsubState = (status: string, over: object = {}) => ({
  status, progress: "", error: "", total: 1, done: 1, links: 0, failed: 0,
  skipped: 0, seq: 5, ...over }) as any;

const openBulkSheet = async () => {
  await mount();
  fireEvent.click(screen.getAllByLabelText("Select Shop News")[0]);
  barAction("unsubscribe");
  const dlg = await findDialog();
  await within(dlg).findByText("One click");
  return dlg;
};

test("the bulk bar opens the sheet - nothing is sent until its button", async () => {
  const dlg = await openBulkSheet();
  expect(unsubscribePreview).toHaveBeenCalledWith("sender", [KEY]);
  expect(unsubscribeBulk).not.toHaveBeenCalled();
  expect(within(dlg).getByText("1 sender · how it works:")).toBeTruthy();
  await pressDialog("Unsubscribe 1 sender");
  await waitFor(() => expect(unsubscribeBulk)
    .toHaveBeenCalledWith("sender", [KEY]));
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("the run's end is shown by the sheet, not announced as a toast",
  async () => {
  await openBulkSheet();
  await pressDialog("Unsubscribe 1 sender");
  await waitFor(() => expect(unsubscribeBulk).toHaveBeenCalled());
  tick({ unsub: unsubState("running", { progress: "0/1" }) });
  tick({ unsub: unsubState("done") });
  expect(await screen.findByText("1 done")).toBeTruthy();
  expect(screen.getByText("Unsubscribed")).toBeTruthy();
  expect(screen.queryByText(/Unsubscribe done:/)).toBeNull();
  expect(deleteGroups).not.toHaveBeenCalled();     // Trash was not asked for
});

test("also move to Trash: the app's trash path runs after the unsubscribe",
  async () => {
  const dlg = await openBulkSheet();
  fireEvent.click(within(dlg).getByRole("switch"));
  await pressDialog("Unsubscribe and move to Trash");
  await waitFor(() => expect(unsubscribeBulk).toHaveBeenCalled());
  expect(deleteGroups).not.toHaveBeenCalled();
  tick({ unsub: unsubState("done") });
  // the same call every group trash makes (not forced: protected groups
  // were never offered)
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledWith("sender",
    [KEY], "trash", "", false, null, null));
  expect(await screen.findByText(
    "Moved their 12 mails to Trash - you can undo it.")).toBeTruthy();
});

test("hiding the sheet mid-run brings the result toast back", async () => {
  await openBulkSheet();
  await pressDialog("Unsubscribe 1 sender");
  await waitFor(() => expect(unsubscribeBulk).toHaveBeenCalled());
  tick({ unsub: unsubState("running", { progress: "0/1" }) });
  fireEvent.click(await screen.findByRole("button", { name: "Hide" }));
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Unsubscribe" })).toBeNull());
  tick({ unsub: unsubState("done") });
  expect(await screen.findByText(/Unsubscribe done: 1 done/)).toBeTruthy();
});

test("a sender's own Unsubscribe asks for the one-sender preview", async () => {
  await mount();
  fireEvent.click(screen.getAllByText("Shop News")[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Unsubscribe" }));
  await waitFor(() => expect(unsubscribePreview)
    .toHaveBeenCalledWith("sender", [KEY], true));
  expect(await screen.findByText("One click")).toBeTruthy();
  expect(unsubscribeBulk).not.toHaveBeenCalled();
});

test("any component can open the sheet through the registered opener", async () => {
  expect(openUnsubscribeSheet({ kind: "single", grouping: "sender", key: KEY }))
    .toBe(false);                                  // no app mounted yet
  await mount();
  act(() => {
    expect(openUnsubscribeSheet({ kind: "single", grouping: "sender",
      key: KEY })).toBe(true);
  });
  await waitFor(() => expect(unsubscribePreview)
    .toHaveBeenCalledWith("sender", [KEY], true));
  expect(await screen.findByText("One click")).toBeTruthy();
  cleanup();
  expect(openUnsubscribeSheet({ kind: "run", run: 1 })).toBe(false);   // unmounted
});
