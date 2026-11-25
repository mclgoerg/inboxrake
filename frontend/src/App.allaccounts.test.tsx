// @vitest-environment jsdom
/* All accounts in the app: the switcher item, the Overview across the
 * accounts (Senders, All mail and Search across accounts: App.allaccounts.lists
 * .test), "Pick an account" on what works on one account, the remembered
 * choice, the phone's chips, and Scan all / the multi-account confirm opened
 * from the list. (The pieces have their own tests: AllAccountsOverview,
 * UnsubscribeAcross, allAccounts, useAllAccounts.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DATA } from "./allAccountsFixtures";

let state: any;
let allData: any;
const scan = vi.fn().mockResolvedValue({ ok: true });
const accountsOverview = vi.fn();
const rules = vi.fn();
const preview = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  // the account the call is pinned to (what the real app sends as ?account=)
  const at = () => /account=([^&]*)/.exec(actual.withAccount("/x"))?.[1];
  // a call this file does not care about (Settings, a tool) answers empty
  // instead of throwing after the test that made it is over
  const known = {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve({ ...state, account: at() ?? state.account }),
    version: () => Promise.resolve({ build: "v1" }),
    accountsOverview: (...a: unknown[]) => accountsOverview(...a),
    accountsSummary: () => Promise.resolve({}),
    scan: (...a: unknown[]) => scan(...a),
    overview: () => Promise.reject(new Error("offline")),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
    rules: (...a: unknown[]) => rules(...a),
    unsubscribePreview: (...a: unknown[]) => preview(...a),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    group: () => Promise.resolve([]),
    mails: () => Promise.resolve({ total: 0, mails: [], ignored: [] }),
  } as Record<string, (...a: unknown[]) => unknown>;
  return { ...actual, api: new Proxy(known, {
    get: (t, k: string) => t[k] ?? (() => Promise.resolve({})) }) };
});

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { AppState, Config, Group } from "./types";

const acct = {
  excluded_folders: [] as string[], host: "h", port: 993,
  security: "ssl" as const, smtp_host: "", smtp_port: 587,
  smtp_security: "auto" as const, user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const names = ["gmail", "icloud", "proton", "gmx"];
const cfgOf = (list: string[]): Config => ({
  default_account: list[0],
  accounts: Object.fromEntries(list.map((n) =>
    [n, { ...acct, user: `me@${n}.example` }])),
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config);
let cfg: Config = cfgOf(names);

const group = (key: string): Group => ({
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 80 });
const baseState = {
  account: "gmail", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: { "solo@x.example": group("solo@x.example") }, smart: {},
    domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [] } as unknown as AppState;

let wide = true, narrow = false;
const media = () => vi.stubGlobal("matchMedia", (q: string) => ({
  get matches() {
    return (wide && q.includes("1024")) || (narrow && q.includes("48rem"));
  }, media: q, addEventListener: () => {}, removeEventListener: () => {},
}));
Element.prototype.scrollIntoView = () => {};

const mount = (opts: { wide?: boolean; scope?: boolean; list?: string[];
    hash?: string } = {}) => {
  wide = opts.wide ?? true;
  narrow = !wide;
  media();
  cfg = cfgOf(opts.list ?? names);
  state = { ...baseState };
  allData = DATA;
  localStorage.setItem("pmc_account", cfg.default_account);
  if (opts.scope) localStorage.setItem("pmc_scope", "all");
  window.location.hash = opts.hash ?? "#/overview";
  return render(<ToastProvider><DialogProvider><App /></DialogProvider>
    </ToastProvider>);
};
const sp = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ");

beforeEach(() => {
  setLang("en");
  scan.mockClear();
  rules.mockReset().mockResolvedValue({ rules: [] });
  accountsOverview.mockReset().mockImplementation(async () => allData);
  preview.mockReset().mockImplementation(async (_g: string, keys: string[]) => ({
    senders: [{ addr: keys[0], name: "Deals Daily", via: "one_click",
      mails: 5, size: 5 }], skipped_protected: 0, skipped_done: 0, capped: 0,
    skipped_no_header: 0, trash: { groups: [], mails: 0, size: 0,
      pinned: 0 } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear();
  window.location.hash = ""; });

const switcherButton = () => screen.findByRole("button",
  { name: /Account: gmail|All accounts, 4/ });

test("the switcher offers All accounts; picking it shows the Overview across " +
  "every account, and the choice is remembered", async () => {
  mount();
  fireEvent.click(await switcherButton());
  fireEvent.click(await screen.findByRole("menuitemradio",
    { name: /All accounts/ }));
  await screen.findByRole("region", { name: "Same sender, several accounts" });
  expect(localStorage.getItem("pmc_scope")).toBe("all");
  // one card per account, from the aggregate (the single Overview is not shown)
  for (const n of names) {
    expect(screen.getAllByRole("button", { name: new RegExp(n) }).length)
      .toBeGreaterThan(0);
  }
  expect(screen.queryByRole("region", { name: "Mailbox balance" })).toBeNull();
  // the page header: the totals; the account button now says All accounts
  expect(sp(screen.getByRole("heading", { level: 1 }).parentElement!
    .textContent)).toContain("All accounts · 4 mailboxes · 41,230 mails");
  expect(screen.getByRole("button", { name: /All accounts, 4/ })).toBeTruthy();
  expect(accountsOverview).toHaveBeenCalled();
  // the sidebar counts are the sums over the accounts
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect(within(nav).getByRole("link", { name: /Senders/ }).textContent)
    .toContain("512");
  expect(within(nav).getByRole("link", { name: /All mail/ }).textContent)
    .toContain("41,230");
  expect(within(nav).getByRole("button", { name: /Junk/ }).textContent)
    .toContain("12");
});

test("a remembered All accounts opens straight on the aggregate", async () => {
  mount({ scope: true });
  await screen.findByRole("region", { name: "Same sender, several accounts" });
  expect(screen.queryByRole("region", { name: "Mailbox balance" })).toBeNull();
});

test("with a single account the choice is not in effect", async () => {
  mount({ scope: true, list: ["gmail"] });
  await screen.findByRole("region", { name: "Mailbox balance" });
  expect(accountsOverview).not.toHaveBeenCalled();
});

test("what works on one account asks which; picking one opens the page for " +
  "it", async () => {
  mount({ scope: true, hash: "#/rules" });
  await screen.findByText("Pick an account");
  expect(screen.getByText(/works on one account at a time/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /icloud/ }));
  await waitFor(() => expect(rules).toHaveBeenCalled());
  expect(localStorage.getItem("pmc_scope")).toBeNull();
  expect(localStorage.getItem("pmc_account")).toBe("icloud");
  expect(screen.queryByText("Pick an account")).toBeNull();
});

test("a tool page does the same, and its own data is never loaded", async () => {
  mount({ scope: true, hash: "#/rules" });
  await screen.findByText("Pick an account");
  expect(screen.getByText(/“Rules” works on one account/)).toBeTruthy();
  expect(rules).not.toHaveBeenCalled();
  // the list of accounts - no dead end
  expect(screen.getAllByRole("button", { name: /(gmail|icloud|proton|gmx)\.example/ }))
    .toHaveLength(4);
});

test("Settings stays reachable while All accounts is selected", async () => {
  mount({ scope: true, hash: "#/settings" });
  await waitFor(() => expect(screen.queryByText("Pick an account")).toBeNull());
  expect(screen.queryByRole("region", { name: "Same sender, several accounts" }))
    .toBeNull();
});

test("a card opens that account's own Overview", async () => {
  mount({ scope: true });
  await screen.findByRole("region", { name: "Same sender, several accounts" });
  fireEvent.click(screen.getByRole("button", { name: /icloud/ }));
  await screen.findByRole("region", { name: "Mailbox balance" });
  expect(localStorage.getItem("pmc_scope")).toBeNull();
  expect(localStorage.getItem("pmc_account")).toBe("icloud");
});

test("Scan all starts the first account's scan; the others wait their turn",
  async () => {
  mount({ scope: true });
  await screen.findByRole("region", { name: "Same sender, several accounts" });
  fireEvent.click(screen.getByRole("button", { name: "Scan all" }));
  await waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
  expect(scan).toHaveBeenCalledWith("gmail");
  // while it runs the button is busy and the subtitle says where it is
  expect((screen.getByRole("button", { name: "Scan all" }) as HTMLButtonElement)
    .disabled).toBe(true);
  expect(sp(document.body.textContent)).toContain(
    "Scanning gmail… (1 of 4)");
  expect(scan).toHaveBeenCalledTimes(1);
});

test("Unsubscribe in N… opens the multi-account confirm with every account",
  async () => {
  mount({ scope: true });
  await screen.findByRole("region", { name: "Same sender, several accounts" });
  fireEvent.click(screen.getAllByRole("button",
    { name: /^Unsubscribe in 3…$/ })[0]);
  await screen.findByText(/Unsubscribe from Deals Daily in 3\saccounts\?/);
  for (const a of ["gmail", "proton", "gmx"]) {
    await screen.findByRole("checkbox", { name: `Unsubscribe in ${a}` });
  }
  expect(preview).toHaveBeenCalledTimes(3);
});

test("phone: chips (All + each account) above the two widgets; a chip " +
  "switches", async () => {
  mount({ wide: false, scope: true });
  const chips = await screen.findByRole("group",
    { name: "Show one account or all" });
  expect(within(chips).getAllByRole("button").map((b) => b.textContent))
    .toEqual(["All", ...names]);
  expect(within(chips).getByRole("button", { name: "All" })
    .getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("region", { name: /4.mailboxes/ })).toBeTruthy();
  fireEvent.click(within(chips).getByRole("button", { name: "proton" }));
  await screen.findByRole("region", { name: "Mailbox balance" });
  expect(localStorage.getItem("pmc_account")).toBe("proton");
  // the single Overview keeps the chips, with that account selected
  const again = screen.getByRole("group", { name: "Show one account or all" });
  expect(within(again).getByRole("button", { name: "proton" })
    .getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(again).getByRole("button", { name: "All" }));
  await screen.findByRole("region", { name: "Same sender, several accounts" });
  expect(localStorage.getItem("pmc_scope")).toBe("all");
});

test("phone: the tab pages ask which account; the title stays", async () => {
  mount({ wide: false, scope: true, hash: "#/cleanup" });
  await screen.findByText("Pick an account");
  expect(screen.getByRole("heading", { level: 1 }).textContent)
    .toBe("Clean up");
});

test("German: the page speaks German", async () => {
  setLang("de");
  mount({ scope: true });
  await screen.findByRole("region", { name: "Gleicher Absender, mehrere Konten" });
  expect(screen.getByRole("button", { name: "Alle scannen" })).toBeTruthy();
  expect(sp(document.body.textContent)).toContain(
    "Alle Konten · 4 Postfächer");
});
