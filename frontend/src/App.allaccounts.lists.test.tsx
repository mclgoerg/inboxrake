// @vitest-environment jsdom
/* Senders, All mail and Search with All accounts selected: the lists read
 * across the accounts (no "Pick an account"), a selection acts through the
 * multi-account confirm, no keyboard shortcut acts on an implicit account, and
 * "Open in <account>" switches to that account and opens the sender there.
 * (The pieces have their own tests: AllSendersView, AcrossActions,
 * AllMailsView.across, SearchPanel.across.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DATA, mail, SENDERS_RESP } from "./allAccountsFixtures";

let state: any;
/** An account whose state answer is held back until `release()` (a slow
 *  load: what a click does while an account is still loading). */
let hold: { account: string; gate: Promise<void> } | null = null;
let release: () => void = () => {};
const holdState = (account: string) => {
  hold = { account, gate: new Promise<void>((r) => { release = r; }) };
};
const calls: { fn: string; account: string; args: unknown[] }[] = [];
const accountsSenders = vi.fn();
const accountsMails = vi.fn();
const accountsSearch = vi.fn();
const deleteGroups = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const at = () => decodeURIComponent(
    /account=([^&]*)/.exec(actual.withAccount("/x"))?.[1] ?? "");
  const rec = (fn: string, f: (...a: any[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, account: at(), args });
      return f(...args);
    };
  const known = {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: async () => {
      const account = at() || state.account;
      if (hold && hold.account === account) await hold.gate;
      return { ...state, account };
    },
    version: () => Promise.resolve({ build: "v1" }),
    accountsOverview: () => Promise.resolve(DATA),
    accountsSummary: () => Promise.resolve({}),
    accountsSenders: rec("accountsSenders", (...a) => accountsSenders(...a)),
    accountsMails: rec("accountsMails", (...a) => accountsMails(...a)),
    accountsSearch: rec("accountsSearch", (...a) => accountsSearch(...a)),
    deleteGroups: rec("deleteGroups", (...a) => deleteGroups(...a)),
    overview: () => Promise.reject(new Error("offline")),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    group: () => Promise.resolve([]),
    mails: rec("mails", () => Promise.resolve({ total: 0, mails: [], ignored: [] })),
    keepSafeCheck: () => Promise.resolve({ total: 0, kept: 0, classes: [] }),
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
  auto_scan: { enabled: false, unit: "hours" as const, value: 6, align_minute: 0 },
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

const group = (key: string, label: string): Group => ({
  key, label, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 80 });
const baseState = {
  account: "gmail", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: {
    "solo@x.example": group("solo@x.example", "Only in the single account"),
    "deals@dealsdaily.example": group("deals@dealsdaily.example", "Deals Daily"),
  }, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "", usage: null },
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

const mount = (opts: { wide?: boolean; hash?: string; scope?: boolean } = {}) => {
  wide = opts.wide ?? true;
  narrow = !wide;
  media();
  cfg = cfgOf(names);
  state = { ...baseState };
  localStorage.setItem("pmc_account", "gmail");
  if (opts.scope !== false) localStorage.setItem("pmc_scope", "all");
  window.location.hash = opts.hash ?? "#/senders";
  return render(<ToastProvider><DialogProvider><App /></DialogProvider>
    </ToastProvider>);
};
const sp = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ");
const press = (btn: HTMLElement) => fireEvent.click(btn, { detail: 0 });
const rowOf = (label: string): HTMLElement =>
  screen.getAllByRole("row").find((r) => r.hasAttribute("data-gidx")
    && r.textContent?.includes(label))!;

beforeEach(() => {
  setLang("en");
  calls.length = 0;
  accountsSenders.mockReset().mockResolvedValue(SENDERS_RESP);
  accountsMails.mockReset().mockResolvedValue({ total: 2, offset: 0, ignored: [],
    mails: [mail("gmail", 1, { subject: "Offer one" }),
      mail("proton", 1, { subject: "Offer two" })] });
  accountsSearch.mockReset().mockResolvedValue({ notes: [], mails: [
    mail("gmail", 1, { subject: "Offer one" })] });
  deleteGroups.mockReset().mockResolvedValue({ ok: true, queued: 3, skipped: 0 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear();
  release(); hold = null; window.location.hash = ""; });

test("Senders reads across the accounts: no Pick an account, the single " +
  "account's own list is not shown", async () => {
  mount();
  await screen.findAllByText("Deals Daily");
  expect(screen.queryByText("Pick an account")).toBeNull();
  expect(screen.queryByText("Only in the single account")).toBeNull();
  expect(accountsSenders).toHaveBeenCalledTimes(1);
  expect(sp(screen.getByRole("heading", { level: 1 }).parentElement!
    .textContent)).toContain("All accounts · 4 mailboxes · 41,230 mails");
  expect(screen.getAllByText("gmail: 210 mails").length).toBeGreaterThan(0);
});

test("no keyboard shortcut acts on an account while All accounts is selected",
  async () => {
  mount();
  await screen.findAllByText("Deals Daily");
  fireEvent.click(within(rowOf("Deals Daily")).getByRole("checkbox"));
  for (const key of ["j", "#", "x", "Enter", "#", "o", "ArrowDown", "#"]) {
    fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(window, { key });
  }
  expect(deleteGroups).not.toHaveBeenCalled();
  expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  // the one thing that works is the selection the user made
  expect(screen.getByRole("region", { name: "Selection actions" })).toBeTruthy();
});

test("Trash from the bar: the confirm names each account, then one step per " +
  "account pinned to it", async () => {
  mount();
  await screen.findAllByText("Deals Daily");
  fireEvent.click(within(rowOf("Deals Daily")).getByRole("checkbox"));
  press(within(screen.getByRole("region", { name: "Selection actions" }))
    .getByRole("button", { name: /^Trash/ }));
  await screen.findByText(/Move to Trash: 304 mails in 2 accounts\?/);
  expect(deleteGroups).not.toHaveBeenCalled();
  press(screen.getByRole("button", { name: "Move to Trash (304)" }));
  await screen.findByText("2 done");
  expect(calls.filter((c) => c.fn === "deleteGroups").map((c) => c.account))
    .toEqual(["gmail", "proton"]);
});

test("'Open in proton' switches to that account and opens the sender there",
  async () => {
  mount();
  fireEvent.click((await screen.findAllByText("Deals Daily"))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Open in proton" }));
  await waitFor(() => expect(localStorage.getItem("pmc_account")).toBe("proton"));
  expect(localStorage.getItem("pmc_scope")).toBeNull();
  // the single account's own detail (its grade card ... ) is open on the sender
  await waitFor(() => expect(screen.getByRole("heading", { level: 2,
    name: "Deals Daily" })).toBeTruthy());
  expect(screen.queryByText("Pick an account")).toBeNull();
});

const pickAccount = async (name: RegExp) => {
  fireEvent.click(await screen.findByRole("button", { name: /^Account: |All accounts, 4/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
};

test("'Open in proton' also returns the grouping to Sender: after Smart the " +
  "single account's page shows the detail", async () => {
  // the single account's grouping is left on Subject ...
  mount({ scope: false });
  fireEvent.click(await screen.findByRole("tab", { name: "Subject" }));
  // ... then All accounts, and a sender opened in proton
  await pickAccount(/All accounts/);
  fireEvent.click((await screen.findAllByText("Deals Daily"))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Open in proton" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 2,
    name: "Deals Daily" })).toBeTruthy());
  expect(screen.getByRole("tab", { name: "Sender" })
    .getAttribute("aria-selected")).toBe("true");
});

test("a sender still waiting to open is forgotten when another account is " +
  "picked: it does not pop up when that account is shown later", async () => {
  mount();
  fireEvent.click((await screen.findAllByText("Deals Daily"))[0]);
  holdState("proton");
  fireEvent.click(await screen.findByRole("button", { name: "Open in proton" }));
  await waitFor(() => expect(localStorage.getItem("pmc_account")).toBe("proton"));
  await pickAccount(/icloud/);
  await waitFor(() => expect(localStorage.getItem("pmc_account")).toBe("icloud"));
  release();
  await pickAccount(/proton/);
  await waitFor(() => expect(localStorage.getItem("pmc_account")).toBe("proton"));
  await screen.findAllByText("Deals Daily");
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryByRole("heading", { level: 2, name: "Deals Daily" })).toBeNull();
});

// (picking All accounts also drops the in-flight load of that account - the
// view change bumps the account generation - so this holds twice over)
test("a sender still waiting to open is forgotten when All accounts is " +
  "picked: the page is not pulled back to Senders", async () => {
  mount();
  fireEvent.click((await screen.findAllByText("Deals Daily"))[0]);
  holdState("proton");
  fireEvent.click(await screen.findByRole("button", { name: "Open in proton" }));
  await waitFor(() => expect(localStorage.getItem("pmc_account")).toBe("proton"));
  await pickAccount(/All accounts/);
  window.location.hash = "#/overview";
  await screen.findByText(/All accounts · 4 mailboxes/);
  release();
  await new Promise((r) => setTimeout(r, 100));
  expect(window.location.hash).toBe("#/overview");
});

test("'Show the mails' opens All mail across accounts for that sender",
  async () => {
  mount();
  fireEvent.click((await screen.findAllByText("Deals Daily"))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Show the mails" }));
  await screen.findByText("Offer one");
  expect(accountsMails).toHaveBeenCalled();
  expect(accountsMails.mock.calls.at(-1)![0].q).toBe("from:deals@dealsdaily.example");
});

test("All mail reads across the accounts and every row names its account",
  async () => {
  mount({ hash: "#/all" });
  await screen.findByText("Offer one");
  expect(screen.queryByText("Pick an account")).toBeNull();
  expect(accountsMails).toHaveBeenCalled();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("All mail");
  expect(screen.getAllByText("proton").length).toBeGreaterThan(0);
});

test("Search is the search over every account", async () => {
  mount({ hash: "#/search" });
  // (the page slot re-mounts once when the layout settles: type until it took)
  await waitFor(() => {
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }),
      { target: { value: "offer" } });
    expect(accountsSearch).toHaveBeenCalled();
  });
  expect(accountsSearch.mock.calls[0]).toEqual(["offer", false]);
  expect(screen.queryByText("Pick an account")).toBeNull();
});

test("what works on one account is still asked: Rules shows Pick an account",
  async () => {
  mount({ hash: "#/rules" });
  await screen.findByText("Pick an account");
  expect(accountsSenders).not.toHaveBeenCalled();
});

test("phone: the Senders | All mails switch moves between the two lists",
  async () => {
  mount({ wide: false });
  await screen.findAllByText("Deals Daily");
  const tabs = screen.getByRole("tablist", { name: "Group by" });
  fireEvent.click(within(tabs).getByRole("tab", { name: "All mails" }));
  await screen.findByText("Offer one");
  expect(window.location.hash).toBe("#/all");
  const back = screen.getByRole("tablist", { name: "Group by" });
  fireEvent.click(within(back).getByRole("tab", { name: "Senders" }));
  await screen.findAllByText("Deals Daily");
});

test("German: the page and the confirm speak German", async () => {
  setLang("de");
  mount();
  await screen.findAllByText("Deals Daily");
  expect(sp(document.body.textContent)).toContain("Alle Konten · 4 Postfächer");
  fireEvent.click(within(rowOf("Deals Daily")).getByRole("checkbox"));
  press(within(screen.getByRole("region", { name: "Aktionen für die Auswahl" }))
    .getByRole("button", { name: /^Papierkorb/ }));
  await screen.findByText(/In den Papierkorb: 304 Mails in 2 Konten\?/);
});
