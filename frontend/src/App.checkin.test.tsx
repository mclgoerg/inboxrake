// @vitest-environment jsdom
/* The Weekly check-in inside the whole app: the Overview's last Next steps
 * line starts it over the Overview, closing keeps the place, the link of the
 * digest mail / the Monday push (`#/overview/check-in`) opens it and tidies
 * the URL, and each step's buttons are the app's own - Block is the usual
 * confirm and block rule, a Rule checkup finding's Edit… opens that rule's
 * editor on Rules, Show the N senders opens the narrowed Senders list. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
let checkinResp: any;
let checkup: any;
const block = vi.fn();
const deleteGroups = vi.fn();
const setAccountCalls = vi.fn();
const checkin = vi.fn(() => Promise.resolve(checkinResp));

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    checkin: (...a: unknown[]) => (checkin as any)(...a),
    block: (...a: unknown[]) => block(...a),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    rules: () => Promise.resolve({ rules: state?.rules ?? [], cap: 500 }),
    ruleCheckup: () => Promise.resolve(checkup),
    ignoreFinding: () => Promise.resolve({ ok: true }),
    keepSafeCheck: () => Promise.resolve({ total: 0, kept: 0, classes: [] }),
    mails: () => Promise.resolve({ total: 0, offset: 0, mails: [],
      ignored: [] }),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
    group: () => Promise.resolve([]),
    overview: () => Promise.reject(new Error("offline")),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: (n: string) => setAccountCalls(n),
  withAccount: (p: string) => p,
  noticeParams: (p: Record<string, unknown>) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, CheckinPlace, Config, Group, Rule } from "./types";

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
const NOW = Math.floor(Date.now() / 1000);
const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 80, ...over });
const rule = (id: string, name: string, over: Partial<Rule> = {}): Rule => ({
  id, name, scope: "mail", grouping: "sender", query: "", action: "trash",
  dest: "", schedule: "manual", mode: "execute", keep_latest: null,
  older_than_days: null, origin: "manual", report_runs: 1, created: 1,
  last_run: null, ...over });
const RULES = [rule("r1", "Sweep"), rule("r2", "Keep five", { keep_latest: 5 })];

const baseState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [], ai: { status: "idle",
    grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: RULES,
  presets: [],
} as unknown as AppState;

const resp = (...ids: CheckinPlace[]) => ({ window: "week", from: 0,
  things: ids.length, minutes: 1, steps: ids.map((id) => ({ id, n: 2 })) });

Element.prototype.scrollIntoView = () => {};
const nb = (e: Element) => e.textContent!.replace(/ /g, " ");

const GROUPS = [
  mk("acme@x.example", { new: true, new_ts: NOW - 3600, count: 14 }),
  mk("chirp@x.example", { new: true, new_ts: NOW - 7200, count: 9 }),
  mk("other@x.example")];

const mount = async (hash = "", stored: string | null = "proton") => {
  // `stored` = the account the browser remembers (null: a browser that never
  // opened Inboxrake - a mail app, a private window, another device)
  if (stored) localStorage.setItem("pmc_account", stored);
  state = { ...baseState, groups: { sender: Object.fromEntries(
    GROUPS.map((g) => [g.key, g])), smart: {}, domain: {}, subject: {},
    thread: {} } };
  window.location.hash = hash;
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByRole("region", { name: /^(Storage|Speicher)$/ });
};

beforeEach(() => {
  setLang("en");
  checkinResp = resp("new", "still", "rules");
  checkup = { account: "proton", scanned_ts: 1, analysed: true,
    needs_scan: false, checked: 1, rules: 2, findings: [] };
  checkin.mockClear();
  setAccountCalls.mockReset();
  block.mockReset().mockResolvedValue({ rule: RULES[0] });
  deleteGroups.mockReset().mockResolvedValue({ queued: 0 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
  setLang("en");
});

const stepper = () => screen.findByRole("dialog", { name: "Weekly check-in" });

test("the line starts the check-in over the Overview; closing keeps the " +
  "place and the line says Continue", async () => {
  await mount();
  const line = await screen.findByTestId("checkin-step");
  expect(nb(line)).toContain("3 things this week · about 1 minute");
  fireEvent.click(within(line).getByRole("button", { name: /^Start/ }));
  const dlg = within(await stepper());
  expect(dlg.getByText("Weekly check-in · step 1 of 3")).toBeTruthy();
  // the Overview is still behind it
  expect(screen.getByRole("region", { name: "Next steps" })).toBeTruthy();
  fireEvent.click(dlg.getByRole("button", { name: /^Next/ }));
  await dlg.findByText("Weekly check-in · step 2 of 3");
  fireEvent.click(dlg.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Weekly check-in" })).toBeNull());
  expect(within(screen.getByTestId("checkin-step")).getByRole("button",
    { name: /^Continue/ })).toBeTruthy();
  fireEvent.click(within(screen.getByTestId("checkin-step")).getByRole(
    "button", { name: /^Continue/ }));
  expect((await stepper()).textContent).toContain(
    "Weekly check-in · step 2 of 3");
});

test("the digest mail's and the push's link opens it over the Overview and " +
  "tidies the URL", async () => {
  await mount("#/overview/check-in");
  const dlg = within(await stepper());
  expect(await dlg.findByText("Weekly check-in · step 1 of 3")).toBeTruthy();
  expect(window.location.hash).toBe("#/overview");
  expect(screen.getByRole("region", { name: "Next steps" })).toBeTruthy();
  // the app was already open: the same link again opens it again
  fireEvent.click(dlg.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Weekly check-in" })).toBeNull());
  window.location.hash = "#/overview/check-in";
  await stepper();
  await waitFor(() => expect(window.location.hash).toBe("#/overview"));
});

test("any other hash does not open it", async () => {
  await mount("#/overview");
  await screen.findByTestId("checkin-step");
  expect(screen.queryByRole("dialog", { name: "Weekly check-in" })).toBeNull();
});

test("a sender step's Block… is the app's own: its confirm, its block rule",
  async () => {
  checkinResp = resp("new");
  await mount();
  fireEvent.click(within(await screen.findByTestId("checkin-step")).getByRole(
    "button", { name: /^Start/ }));
  const dlg = within(await stepper());
  const row = within((await dlg.findAllByTestId("checkin-row"))[0]);
  fireEvent.click(row.getByRole("button", { name: /^Block…/ }));
  await pressDialog("Block");                     // 'Block "Label acme"?'
  await pressDialog("Only block");                // the second question
  await waitFor(() => expect(block).toHaveBeenCalledTimes(1));
  expect(block).toHaveBeenCalledWith("sender", "acme@x.example",
    "Label acme", false);
  fireEvent.click(dlg.getByRole("button", { name: "Finish" }));
  expect((await dlg.findByTestId("checkin-done")).textContent).toContain(
    "1 sender blocked");
});

test("a Rule checkup finding's Edit… closes the check-in and opens that " +
  "rule's editor on Rules", async () => {
  checkinResp = resp("rules");
  checkup.findings = [{ id: "f1", kind: "never_matches", rules: ["r2"],
    ignored: false, runs: 8, since: 1_759_300_000 }];
  await mount();
  fireEvent.click(within(await screen.findByTestId("checkin-step")).getByRole(
    "button", { name: /^Start/ }));
  const dlg = within(await stepper());
  fireEvent.click(await dlg.findByRole("button", { name: "Edit…" }));
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Weekly check-in" })).toBeNull());
  // Rules, with the editor of "Keep five" open
  expect(await screen.findByDisplayValue("Keep five")).toBeTruthy();
  expect(screen.queryByDisplayValue("Sweep")).toBeNull();
  // the place is kept for later
  expect(localStorage.getItem("pmc_checkin:proton")).toContain('"at":"rules"');
});

test("Show the N senders: the narrowed Senders list, and the place is kept",
  async () => {
  checkinResp = resp("rules");
  checkup.findings = [{ id: "f2", kind: "overlap", rules: ["r1", "r2"],
    ignored: false, defeated: "r2", by: "r1", n: 4, senders_total: 2,
    keep_latest: 5, older_than_days: null,
    senders: [{ addr: "acme@x.example", label: "Label acme", n: 2, last: 1 },
      { addr: "chirp@x.example", label: "Label chirp", n: 2, last: 1 }],
    compare: { unit: "senders", only_a: 0, both: 2, only_b: 1 } }];
  await mount();
  fireEvent.click(within(await screen.findByTestId("checkin-step")).getByRole(
    "button", { name: /^Start/ }));
  const dlg = within(await stepper());
  fireEvent.click(await dlg.findByRole("button", { name: /^Show the 2\s+senders$/ }));
  const chip = (await screen.findAllByTestId("checkup-chip"))[0];
  expect(nb(chip)).toContain("2 senders from the Rule checkup");
  expect(screen.queryByRole("dialog", { name: "Weekly check-in" })).toBeNull();
  await waitFor(() => expect(window.location.hash).toContain("senders"));
  expect(screen.queryByText("Label other")).toBeNull();
});

/* ---- the link of the digest mail / the push, in a browser that is cold ---- */

test("a fresh browser (no account remembered): the link still opens the " +
  "check-in once the default account is settled", async () => {
  await mount("#/overview/check-in", null);
  const dlg = within(await stepper());
  expect(await dlg.findByText("Weekly check-in · step 1 of 3")).toBeTruthy();
  expect(window.location.hash).toBe("#/overview");
  // the account was settled by the app, once, and the check-in survived it
  await waitFor(() => expect(localStorage.getItem("pmc_account"))
    .toBe("proton"));
  expect(screen.getByRole("dialog", { name: "Weekly check-in" })).toBeTruthy();
});

test("the link names an account: the app switches to it first, then opens " +
  "its check-in", async () => {
  await mount("#/overview/check-in?account=other");
  await stepper();
  expect(setAccountCalls).toHaveBeenLastCalledWith("other");
  expect(localStorage.getItem("pmc_account")).toBe("other");
  expect(window.location.hash).toBe("#/overview");
});

test("the account named is the one already selected: nothing is switched; an " +
  "account that is gone falls back to the selected one", async () => {
  await mount("#/overview/check-in?account=proton");
  await stepper();
  expect(setAccountCalls).not.toHaveBeenCalledWith("other");
  cleanup();
  setAccountCalls.mockReset();
  await mount("#/overview/check-in?account=gone");
  await stepper();
  expect(setAccountCalls).not.toHaveBeenCalledWith("gone");
  expect(localStorage.getItem("pmc_account")).toBe("proton");
});

test("a fresh browser and a named account together", async () => {
  await mount("#/overview/check-in?account=other", null);
  await stepper();
  expect(localStorage.getItem("pmc_account")).toBe("other");
});

/* ---- Trash… on a still-mailing sender is the app's own confirmed move ---- */

const LATE = mk("store@x.example", { count: 20, pinned: 2, unsub: true,
  unsubscribed: { n: 1, of: 1, status: "done", link: "", addr: "" },
  still_mailing: { n: 14, senders: 1, since_ts: NOW - 30 * 86400,
    last_ts: NOW - 86400, addrs: ["store@x.example"] } });

const startStill = async () => {
  checkinResp = resp("still");
  GROUPS.push(LATE);
  await mount();
  fireEvent.click(within(await screen.findByTestId("checkin-step")).getByRole(
    "button", { name: /^Start/ }));
  const dlg = within(await stepper());
  const row = within((await dlg.findAllByTestId("checkin-row"))[0]);
  return { dlg, row };
};

test("Trash… asks the usual confirm before anything moves", async () => {
  try {
    const { row } = await startStill();
    fireEvent.click(row.getByRole("button", { name: /^Trash…/ }));
    // the confirm names the mails (20 minus the 2 pinned); nothing has moved
    const ask = await findDialog();
    expect(nb(ask)).toContain("18 mails");
    expect(deleteGroups).not.toHaveBeenCalled();
    await pressDialog(/Move to Trash \(18\)/);
    await waitFor(() => expect(deleteGroups).toHaveBeenCalledTimes(1));
    expect(deleteGroups.mock.calls[0].slice(0, 3)).toEqual(
      ["sender", ["store@x.example"], "trash"]);
    expect(await row.findByText("Moved to Trash")).toBeTruthy();
  } finally { GROUPS.pop(); }
});

test("a declined Trash… moves nothing and is not counted", async () => {
  try {
    const { row } = await startStill();
    fireEvent.click(row.getByRole("button", { name: /^Trash…/ }));
    await findDialog();
    await cancelDialog();
    await expectNoDialog();
    expect(deleteGroups).not.toHaveBeenCalled();
    expect(row.queryByText("Moved to Trash")).toBeNull();
  } finally { GROUPS.pop(); }
});

test("the closing card says what the move really took, not the group's " +
  "count minus pinned", async () => {
  deleteGroups.mockResolvedValue({ queued: 15 });   // 3 more kept safe
  try {
    const { dlg, row } = await startStill();
    fireEvent.click(row.getByRole("button", { name: /^Trash…/ }));
    await pressDialog(/Move to Trash \(18\)/);
    await row.findByText("Moved to Trash");
    fireEvent.click(dlg.getByRole("button", { name: "Finish" }));
    expect((await dlg.findByTestId("checkin-done")).textContent)
      .toContain("15 mails to Trash");
  } finally { GROUPS.pop(); }
});
