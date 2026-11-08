// @vitest-environment jsdom
/* The Overview start page: hero totals, the biggest-senders storage bar and
 * legend, the biggest-senders list opening Senders, first-run states, no list
 * shortcuts. (Suggestions: App.quickwins.test.tsx.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
let overviewResp: unknown = null;
const deleteGroups = vi.fn()
  .mockResolvedValue({ ok: true, queued: 1, skipped: 0 });

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    group: () => Promise.resolve([]),
    mails: () => Promise.resolve({ total: 0, mails: [], ignored: [] }),
    // the Overview's own numbers (see Overview.test.tsx for the content)
    overview: () => overviewResp
      ? Promise.resolve(overviewResp) : Promise.reject(new Error("offline")),
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
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import { setLang } from "./i18n";
import { saveDismissed } from "./quickwins";
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
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [],
  samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 80, ...over,
});
const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
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
};
// Card 1 (old newsletters): news = 20 mails. Card 2 (quiet): quiet = 30
// mails; the protected sender matches it too but is skipped.
const news = mk("news@x.example", { tags: ["newsletter"], count: 20,
  unread: 19, size: 6 * MB, last: "2024-01-01" });
const quiet = mk("quiet@x.example", { count: 30, size: 10 * MB,
  engagement: 10, last: "2024-01-01" });
const prot = mk("prot@x.example", { count: 40, size: 20 * MB,
  engagement: 10, last: "2024-01-01", protected: true });
const fresh = mk("fresh@x.example");

const setup = (over: Partial<AppState> = {},
               groups = [news, quiet, prot, fresh]) => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, ...over, groups: { sender: Object.fromEntries(
    groups.map((g) => [g.key, g])), smart: {}, domain: {}, subject: {},
    thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider>
    </ToastProvider>);
};

beforeEach(() => { window.location.hash = ""; });
afterEach(() => {
  cleanup();
  overviewResp = null;
  localStorage.clear();
  sessionStorage.clear();
  delete (cfg as { setup_needed?: boolean }).setup_needed;
});
const ready = () => screen.findByRole("region", { name: "Storage" });
const six = () => ["g1", "g2", "g3", "g4", "g5", "g6"].map((k, i) =>
  mk(`${k}@x.example`, { size: (60 - i * 10) * MB, count: 10 }));

test("the hero shows the account, the total size and the counts", async () => {
  setup();
  await ready();
  const hero = screen.getByRole("region", { name: "Mailbox balance" });
  expect(hero.textContent).toContain("proton · me@proton.example");
  expect(hero.textContent).toContain("36.0 MB");
  expect(hero.textContent).toContain("in 95 mails from 4 senders");
  expect(window.location.hash).toBe("");          // the start page, no rewrite
});

test("the storage legend names the 4 biggest senders and everyone else; the " +
  "sizes add up", async () => {
  setup({}, six());
  const storage = await ready();
  const legend = within(storage).getAllByRole("listitem");
  expect(legend.map((li) => li.textContent)).toEqual([
    "Label g160.0 MB", "Label g250.0 MB", "Label g340.0 MB",
    "Label g430.0 MB", "Everyone else30.0 MB"]);   // g5 + g6 = 20 + 10
  expect(screen.getByRole("region", { name: "Mailbox balance" }).textContent)
    .toContain("210.0 MB");                         // 60+50+40+30+20+10
});

test("a legend entry opens that sender on the Senders page", async () => {
  setup({}, six());
  const hero = await ready();
  fireEvent.click(within(hero).getByRole("button", { name: /Label g2/ }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(window.location.hash).toBe("#/senders");
  expect(screen.getAllByText("Label g2").length).toBeGreaterThan(0);
});

test("Biggest senders: top 5 by size; a row opens Senders with the detail",
  async () => {
  setup({}, six());
  await ready();
  const section = within(screen.getByRole("region",
    { name: "Biggest senders" }));
  // the storage legend sits above the list: the list is the last <ul>
  const rows = within(section.getAllByRole("list").at(-1)!)
    .getAllByRole("button");
  expect(rows).toHaveLength(5);
  expect(rows[0].textContent).toContain("Label g1");
  expect(rows[0].textContent).toContain("60.0 MB");
  fireEvent.click(rows[2]);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(window.location.hash).toBe("#/senders");
  expect(await screen.findByPlaceholderText("Search or filter…")).toBeTruthy();
});

test("Scan sits in the page toolbar and list shortcuts do nothing", async () => {
  setup();
  await ready();
  expect(screen.getAllByRole("button", { name: "Scan" })).toHaveLength(1);
  expect(screen.queryByPlaceholderText("Search or filter…")).toBeNull();
  // "/" would focus the filter on Senders: here it is left alone
  expect(fireEvent.keyDown(document.body, { key: "/" })).toBe(true);
  fireEvent.keyDown(document.body, { key: "j" });
  fireEvent.keyDown(document.body, { key: "x" });
  expect(screen.queryByRole("region", { name: /Selection/i })).toBeNull();
});

test("never scanned: the ready card with Test connection and Scan", async () => {
  setup({ status: "idle", scanned_ts: 0 }, []);
  const title = await screen.findByText("Ready for the first scan");
  const card = within(title.parentElement!);
  expect(card.getByRole("button", { name: "Test connection" })).toBeTruthy();
  expect(card.getByRole("button", { name: "Scan" })).toBeTruthy();
});

test("the first scan running shows progress instead of the figures",
  async () => {
  setup({ status: "scanning", scanned_ts: 0 }, []);
  expect(await screen.findByText("Reading your mailbox")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Storage" })).toBeNull();
});

test("no account (after Set up later): the setup call to action", async () => {
  sessionStorage.setItem("pmc_wizard_later", "1");
  (cfg as { setup_needed?: boolean }).setup_needed = true;
  setup({ status: "idle", scanned_ts: 0 }, []);
  const btn = await screen.findAllByRole("button",
    { name: "Set up your mailbox" });
  expect(btn.length).toBeGreaterThan(0);
  expect(screen.queryByRole("region", { name: "Storage" })).toBeNull();
});

test("phone suggestion rows state the protected-skipped count like the cards",
  async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("767"), media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  try {
    setup();
    await ready();
    const row = screen.getAllByRole("button", { name: /^Review: / })
      .find((b) => b.textContent?.includes("protected skipped"));
    expect(row?.textContent).toContain("1 protected skipped");
  } finally { vi.unstubAllGlobals(); }
});

const week = (o: object = {}) => ({ from: 0, mails: 7, senders: 3,
  newsletters: 1, new_senders: 2, still_mailing: 1, verdicts: 4,
  verdicts_safe: 2, ...o });
const withWeek = (o: object = {}) => {
  overviewResp = { now: Math.floor(Date.now() / 1000),
    weeks: [1, 2, 3, 4, 5, 6, 7, 8],
    weeks_estimated: [true, true, true, true, true, true, true, true],
    weeks_in_mailbox: [1, 2, 3, 4, 5, 6, 7, 8], week: week(o), since: null,
    kinds: { days: 30, total: 0, items: [] }, trend: null };
};

test("Last week rows open the list their count came from, over the same " +
  "window: Senders with the in: term, All mail with it", async () => {
  withWeek();
  const filter = async () => (await screen.findByPlaceholderText(
    "Search or filter…") as HTMLInputElement).value;
  setup();
  fireEvent.click(await screen.findByText("2 new senders"));
  expect(await filter()).toBe("is:new in:7d");
  expect(window.location.hash).toBe("#/senders");
  cleanup();

  window.location.hash = "";
  setup();
  fireEvent.click(await screen.findByText("1 still mailing"));
  expect(await filter()).toBe("is:still-mailing in:7d");
  cleanup();

  window.location.hash = "";
  setup();
  fireEvent.click(await screen.findByText("4 new AI verdicts"));
  expect(await filter()).toBe("ai:safe in:7d");
  cleanup();

  // no safe verdict: the row is text - no unfiltered Senders list
  window.location.hash = "";
  withWeek({ verdicts_safe: 0 });
  setup();
  const row = (await screen.findByText("4 new AI verdicts"))
    .closest("li") as HTMLElement;
  expect(within(row).queryByRole("button")).toBeNull();
  cleanup();

  // new mails: All mail, newest first, filtered to the window
  window.location.hash = "";
  localStorage.setItem("pmc_mails_sort", "size");
  localStorage.setItem("pmc_mails_dir", "asc");
  setup();
  fireEvent.click(await screen.findByText("7 new mails"));
  await waitFor(() => expect(window.location.hash).toBe("#/all"));
  expect(localStorage.getItem("pmc_mails_sort")).toBe("date");
  expect(localStorage.getItem("pmc_mails_dir")).toBe("desc");
  expect(await screen.findByDisplayValue("in:7d")).toBeTruthy();
  cleanup();

  // the sidebar's All mail starts clean again
  window.location.hash = "#/all";
  setup();
  await screen.findByPlaceholderText("filter mails…");
  expect(screen.queryByDisplayValue("in:7d")).toBeNull();
});

test("Review N: the union of the checked next steps, protected skipped, no " +
  "filter; one checked row keeps its own query", async () => {
  withWeek();
  setup();
  const card = within(await screen.findByRole("region",
    { name: "Next steps" }));
  fireEvent.click(card.getByRole("button", { name: "Review 2" }));
  expect((await screen.findByPlaceholderText("Search or filter…") as
    HTMLInputElement).value).toBe("");
  expect(window.location.hash).toBe("#/senders");
  // quiet (30 mails, 10 MB) + news (20 mails, 6 MB); prot stays out
  await waitFor(() => expect(screen.getByText(/^2 groups · 50 mails · 16\.0 MB$/))
    .toBeTruthy());
  cleanup();

  window.location.hash = "";
  setup();
  const again = within(await screen.findByRole("region",
    { name: "Next steps" }));
  fireEvent.click(again.getByRole("checkbox", { name: /Old newsletters/ }));
  fireEvent.click(again.getByRole("button", { name: "Review 1" }));
  expect((await screen.findByPlaceholderText("Search or filter…") as
    HTMLInputElement).value).toBe("eng:low age:>1y");
});
