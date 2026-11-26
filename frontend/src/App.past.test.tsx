// @vitest-environment jsdom
/* Mail past its date inside the whole app: the Overview line (fetched once the
 * scan is done), Review opens the sheet, "Open in All mail" lists `is:expired`,
 * "Show them" lists the kept receipts under their own chip, "Move N to
 * Trash…" is All mail's per-mail step. The cards above it behave as before
 * (the cap, Review 3, Show all 5), and Rule-checkup lists keep their chip. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
let expiredResp: any;
const expired = vi.fn(() => expiredResp instanceof Error
  ? Promise.reject(expiredResp) : Promise.resolve(expiredResp));
const expiredMails = vi.fn();
const deleteMessages = vi.fn();
const mails = vi.fn();

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    expired: () => expired(),
    expiredMails: (...a: unknown[]) => expiredMails(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    keepSafeCheck: () => Promise.resolve({ total: 0, kept: 0, classes: [] }),
    mails: (...a: unknown[]) => mails(...a),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
    group: () => Promise.resolve([]),
    overview: () => Promise.reject(new Error("offline")),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  noticeParams: (p: Record<string, unknown>) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, Config, Group } from "./types";

const MB = 1048576;
const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "me@proton.example" },
    other: { ...acct, user: "me@other.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};
const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 20, size: 40 * MB,
  unread: 0, first: "2019-01-01", last: "2020-01-01", tags: [],
  samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 80, ...over,
});
const done = { n: 1, of: 1, status: "done" as const, link: "", addr: "" };
const FIVE = [
  mk("g1@x.example", { tags: ["newsletter"], unread: 20, size: 60 * MB }),
  mk("g2@x.example", { engagement: 5, size: 50 * MB }),
  mk("g3@x.example", { unsubscribed: done, size: 40 * MB }),
  mk("g4@x.example", { att_size: 30 * MB, size: 30 * MB }),
  mk("g5@x.example", { ai: { verdict: "delete_safe", reason: "" } as Group["ai"],
    size: 20 * MB }),
];
const baseState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [], ai: { status: "idle",
    grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState;

const EXPIRED = {
  mails: 148, size: 9.6 * MB, kept: 18,
  reasons: [
    { id: "codes", mails: 64, size: 1.1 * MB, ticked: true },
    { id: "parcels", mails: 52, size: 4.0 * MB, ticked: true },
    { id: "events", mails: 21, size: 2.9 * MB, ticked: true },
    { id: "offers", mails: 11, size: 1.6 * MB, ticked: false },
  ] };
const mailRow = (n: number, subject: string) => ({
  uid: n, folder: "INBOX", date: "2026-11-01", ts: 1, subject,
  addr: "a@x.example", size: 10, seen: true, ai: null, pinned: false });

Element.prototype.scrollIntoView = () => {};
const nb = (e: Element) => e.textContent!.replace(/\u00a0/g, " ");

const mount = async (groups = FIVE) => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, groups: { sender: Object.fromEntries(
    groups.map((g) => [g.key, g])), smart: {}, domain: {}, subject: {},
    thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByRole("region", { name: /^(Storage|Speicher)$/ });
};

beforeEach(() => {
  window.location.hash = "";
  expiredResp = EXPIRED;
  expired.mockClear();
  expiredMails.mockReset().mockResolvedValue({
    items: [["INBOX", 1], ["INBOX", 2]] });
  // the job changes the mailbox: the next state carries a new revision
  deleteMessages.mockReset().mockImplementation(() => {
    state = { ...state, groups_rev: state.groups_rev + 1 };
    return Promise.resolve({ ok: true, queued: 2 });
  });
  mails.mockReset().mockResolvedValue({ total: 0, offset: 0, mails: [],
    ignored: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
  setLang("en");
});

test("the line shows up after the cards, the cap and Review 3 unchanged",
  async () => {
  await mount();
  const step = await screen.findByTestId("past-step");
  expect(nb(step)).toContain("Mail past its date");
  expect(screen.getAllByTestId("qw-card")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Review 3" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show all 5" })).toBeTruthy();
  const region = screen.getByRole("region", { name: "Next steps" });
  const rows = within(region).getAllByRole("listitem");
  expect(rows.at(-1)).toBe(step);
});

test("on a wide screen the sheet is a dialog over the Overview, not a page of " +
  "the tool slot", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return q.includes("1024"); }, media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  await mount();
  fireEvent.click(within(await screen.findByTestId("past-step"))
    .getByRole("button", { name: /^Review/ }));
  const dlg = await screen.findByRole("dialog", { name: "Mail past its date" });
  expect(within(dlg).getByRole("button", { name: "Move 137 to Trash…" }))
    .toBeTruthy();
  // the Overview stays behind it
  expect(screen.getByRole("region", { name: "Storage" })).toBeTruthy();
});

test("no data from the server (an error): the Overview is as it was",
  async () => {
  expiredResp = new Error("offline");
  await mount();
  await waitFor(() => expect(expired).toHaveBeenCalled());
  expect(screen.queryByTestId("past-step")).toBeNull();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(3);
});

test("Review opens the sheet; Cancel closes it and nothing is moved",
  async () => {
  await mount();
  fireEvent.click(within(await screen.findByTestId("past-step"))
    .getByRole("button", { name: /^Review/ }));
  const dlg = await screen.findByRole("dialog", { name: "Mail past its date" });
  expect(within(dlg).getAllByTestId("past-reason")).toHaveLength(4);
  expect((within(dlg).getByRole("checkbox", { name: "Offers that have ended" }) as
    HTMLInputElement).checked).toBe(false);
  fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Mail past its date" })).toBeNull());
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");
});

test("Open in All mail: the list with is:expired in the filter box",
  async () => {
  mails.mockResolvedValue({ total: 148, offset: 0, ignored: [],
    mails: [mailRow(1, "Your sign-in code")] });
  await mount();
  fireEvent.click(within(await screen.findByTestId("past-step"))
    .getByRole("button", { name: /^Review/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open in All mail" }));
  await screen.findByText("Your sign-in code");
  expect(mails).toHaveBeenCalledWith(expect.objectContaining(
    { q: "is:expired" }));
  expect(screen.queryByRole("dialog", { name: "Mail past its date" })).toBeNull();
  expect(window.location.hash).toBe("#/all");
  expect(screen.queryByTestId("checkup-chip")).toBeNull();
});

test("Show them: All mail on the kept receipts, with its own chip and way back",
  async () => {
  mails.mockResolvedValue({ total: 18, offset: 0, ignored: [],
    mails: [mailRow(1, "Order confirmation #1")] });
  await mount();
  fireEvent.click(within(await screen.findByTestId("past-step"))
    .getByRole("button", { name: /^Review/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Show them" }));
  await screen.findByText("Order confirmation #1");
  expect(mails).toHaveBeenCalledWith(expect.objectContaining(
    { finding: "past-kept" }));
  const chip = screen.getByTestId("checkup-chip");
  expect(nb(chip)).toContain("18 receipts and bookings kept by Mail past its date");
  expect(nb(chip)).not.toContain("Rule checkup");
  fireEvent.click(within(chip).getByRole("button", { name: "Show all mail" }));
  await waitFor(() => expect(screen.queryByTestId("checkup-chip")).toBeNull());
});

test("Move N to Trash…: the usual confirm, then the per-mail step, then the " +
  "sheet is gone and the line is fetched again", async () => {
  await mount();
  fireEvent.click(within(await screen.findByTestId("past-step"))
    .getByRole("button", { name: /^Review/ }));
  const calls = expired.mock.calls.length;
  fireEvent.click(await screen.findByRole("button",
    { name: "Move 137 to Trash…" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("2 selected mails");
  expect(deleteMessages).not.toHaveBeenCalled();
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1], ["INBOX", 2]], "trash"));
  expect(expiredMails).toHaveBeenCalledWith(["codes", "parcels", "events"]);
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Mail past its date" })).toBeNull());
  await waitFor(() => expect(expired.mock.calls.length).toBeGreaterThan(calls));
});

test("German", async () => {
  setLang("de");
  await mount();
  const step = await screen.findByTestId("past-step");
  expect(nb(step)).toContain("Abgelaufene Mails");
  fireEvent.click(within(step).getByRole("button", { name: /^Ansehen/ }));
  const dlg = await screen.findByRole("dialog", { name: "Abgelaufene Mails" });
  expect(within(dlg).getByRole("button", { name: "137 in den Papierkorb…" }))
    .toBeTruthy();
});
