// @vitest-environment jsdom
/* Where the All accounts page is opened from: one more row after the account
 * cards (switcher popover and phone sheet), the last item under Insights in
 * the sidebar, and the last card of the phone's Insights tab - each only with
 * two accounts or more, and none of them changes what was there. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const overviewCall = vi.fn();
const copiesCall = vi.fn();
const stats = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { accountsOverview: (...a: unknown[]) => overviewCall(...a),
    accountsCopies: () => copiesCall(),
    stats: () => stats(),
    trackers: () => Promise.resolve({ usable: false, checked: 0, pixel: 0, senders: 0 }),
    wrapped: () => Promise.reject(new Error("x")),
    rhythm: () => Promise.reject(new Error("x")),
    addressesSummary: () => Promise.resolve({ leaked: 0, total: 0, scanned: true }),
    audit: () => Promise.resolve({ total: 0, entries: [] }) },
}));

import { AccountSwitcher } from "./components/AccountSwitcher";
import { Sidebar } from "./components/Sidebar";
import { InsightsPage } from "./components/TabPages";
import { setLang } from "./i18n";
import { TOOL_PAGES, TOOL_TAB, isToolPage, parseHash } from "./nav";
import { overview } from "./allAccountsFixtures";
import type { AppState, Config } from "./types";

const im = (over: object) => ({
  excluded_folders: [], host: "h", port: 993, security: "ssl", smtp_host: "",
  smtp_port: 587, smtp_security: "auto", user: "", password: "",
  password_set: true, verified: true, cafile: "", preset: "custom",
  oauth: null, ...over });
const cfg = { default_account: "alpha", accounts: {
  alpha: im({ user: "a@one.example" }),
  beta: im({ user: "b@two.example" }),
  gamma: im({ user: "c@three.example" }),
} } as unknown as Config;
const summary = {
  alpha: { status: "done", scanned_ts: 1, mails: 1623, size: 2.5 * 1073741824 },
  beta: { status: "done", scanned_ts: 1, mails: 10, size: 1073741824 },
  gamma: { status: "idle", scanned_ts: null, mails: 0, size: 0 },
};

beforeEach(() => {
  overviewCall.mockResolvedValue(overview());
  copiesCall.mockResolvedValue({ left_out: 0, pairs: [
    { a: "a", b: "b", mails: 412, size: 1, first: 1, last: 2, in_a: { trash: 1, size: 1, held: 0 },
      in_b: { trash: 1, size: 1, held: 0 } },
    { a: "a", b: "c", mails: 96, size: 1, first: 1, last: 2, in_a: { trash: 1, size: 1, held: 0 },
      in_b: { trash: 1, size: 1, held: 0 } }] });
  stats.mockResolvedValue({ mails: 1, months: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); setLang("en"); });

/* ---------------------------- the account switcher ------------------------- */

const switcher = (over: object = {}, menu = false) => {
  const h = { onSwitch: vi.fn(), onFix: vi.fn(), onAdd: vi.fn(),
    onSettings: vi.fn(), onActivity: vi.fn(), onAppearance: vi.fn(),
    onAllAccounts: vi.fn() };
  render(<AccountSwitcher menu={menu} cfg={cfg} account="alpha"
    summary={summary} appearance="dark" {...h} {...over} />);
  return h;
};

test("switcher: one more row after the account cards, before Add account", () => {
  switcher();
  const all = screen.getByRole("button", { name: /All accounts/ });
  expect(all.textContent).toContain("3 mailboxes");
  expect(all.textContent).toContain("3.5 GB");
  expect(all.textContent).toContain("opens a page");
  const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const at = (re: RegExp) => labels.findIndex((l) => re.test(l));
  expect(at(/alpha/)).toBeLessThan(at(/beta/));
  expect(at(/gamma/)).toBeLessThan(at(/All accounts/));
  expect(at(/All accounts/)).toBe(at(/Add account/) - 1);
});

test("switcher: the row OPENS the page - it is no card, no check, no switch", () => {
  const h = switcher();
  fireEvent.click(screen.getByRole("button", { name: /All accounts/ }));
  expect(h.onAllAccounts).toHaveBeenCalledOnce();
  expect(h.onSwitch).not.toHaveBeenCalled();
  // the current account keeps its check and its place, every card still works
  expect(screen.getByRole("button", { name: /alpha/ })
    .getAttribute("aria-current")).toBe("true");
  expect(screen.getByRole("button", { name: /All accounts/ })
    .getAttribute("aria-current")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /beta/ }));
  expect(h.onSwitch).toHaveBeenCalledWith("beta");
});

test("switcher: the cards, Add account, Appearance, Settings, Activity are as before", () => {
  const h = switcher();
  const card = screen.getByRole("button", { name: /alpha/ });
  expect(card.textContent).toContain("a@one.example");
  expect(card.textContent).toContain("Signed in");
  expect(card.textContent).toContain("1,623 mails");
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
  fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
  expect(h.onAdd).toHaveBeenCalledOnce();
  expect(h.onSettings).toHaveBeenCalledOnce();
  expect(h.onActivity).toHaveBeenCalledOnce();
  expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
});

test("switcher: without the prop (one account) there is no row", () => {
  switcher({ onAllAccounts: undefined });
  expect(screen.queryByRole("button", { name: /All accounts/ })).toBeNull();
});

test("switcher: in the popover it is a menu item; German", () => {
  setLang("de");
  switcher({}, true);
  const item = screen.getByRole("menuitem", { name: /Alle Konten/ });
  expect(item.textContent).toContain("3 Postfächer");
  expect(item.textContent).toContain("öffnet eine Seite");
});

test("switcher: without sizes yet it still names the mailboxes", () => {
  switcher({ summary: null });
  expect(screen.getByRole("button", { name: /All accounts/ }).textContent)
    .toContain("3 mailboxes · opens a page");
});

/* -------------------------------- the sidebar ------------------------------ */

const side = (allAccounts?: boolean) => {
  const onOpen = vi.fn();
  render(<Sidebar page="overview" onPage={() => {}} onOpen={onOpen}
    account={null} disabled={{}} allAccounts={allAccounts} leaked={2} />);
  return onOpen;
};

test("sidebar: All accounts is the last item under Insights, after Waiting for a reply", () => {
  const onOpen = side(true);
  const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const at = (re: RegExp) => names.findIndex((n) => re.test(n));
  expect(at(/All accounts/)).toBe(at(/Waiting for a reply/) + 1);
  const order = [/Statistics/, /Space map/, /Your year in mail/, /Trackers/,
    /Subscriptions/, /Your addresses/, /Waiting for a reply/, /All accounts/]
    .map(at);
  expect(order.every((n) => n >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  fireEvent.click(screen.getByRole("button", { name: "All accounts" }));
  expect(onOpen).toHaveBeenCalledWith("accounts");
});

test("sidebar: with one account there is no item, and nothing else moved", () => {
  side(false);
  expect(screen.queryByRole("button", { name: "All accounts" })).toBeNull();
  for (const n of ["Statistics", "Space map", "Trackers", "Subscriptions",
    "Your addresses", "Waiting for a reply", "Activity"])
    expect(screen.getByRole("button", { name: new RegExp(n) })).toBeTruthy();
});

test("sidebar: German name", () => {
  setLang("de");
  side(true);
  expect(screen.getByRole("button", { name: "Alle Konten" })).toBeTruthy();
});

test("it is a tool page at #/accounts that lives on the Insights tab below 1024 px", () => {
  expect(TOOL_PAGES).toContain("accounts");
  expect(TOOL_TAB.accounts).toBe("insights");
  expect(parseHash("#/accounts")).toBe("accounts");
  expect(isToolPage("accounts")).toBe(true);
  // the pages that were there are still there, in their order
  expect(TOOL_PAGES.indexOf("accounts")).toBe(TOOL_PAGES.indexOf("waiting") + 1);
  expect(TOOL_PAGES.indexOf("waiting")).toBe(TOOL_PAGES.indexOf("addresses") + 1);
});

/* ---------------------------- the Insights tab card ------------------------ */

const insights = (accounts?: string[]) => {
  const onOpen = vi.fn();
  render(<InsightsPage groups={[]}
    state={{ status: "done", rules: [] } as unknown as AppState}
    accounts={accounts} onOpen={onOpen} />);
  return onOpen;
};

test("Insights: the card follows Waiting for a reply, Your documents comes after it", async () => {
  const onOpen = insights(["a", "b", "c", "d"]);
  const card = await screen.findByRole("button", { name: /^All accounts/ });
  await waitFor(() => expect(card.textContent).toContain("4 mailboxes · 7.3 GB"));
  expect(card.textContent).toContain("4 senders in several accounts");
  const waiting = screen.getByRole("button", { name: /^Waiting for a reply/ });
  expect(waiting.compareDocumentPosition(card)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // only Your documents (the page after it) comes later
  expect(card.nextElementSibling).toBe(
    screen.getByRole("button", { name: /^Your documents/ }));
  expect(card.parentElement!.lastElementChild).toBe(card.nextElementSibling);
  for (const name of [/^Statistics/, /^Subscriptions/, /^Your addresses/])
    expect(screen.getByRole("button", { name })).toBeTruthy();
  fireEvent.click(card);
  expect(onOpen).toHaveBeenCalledWith("accounts");
});

test("Insights: the card reads the numbers once - it does not poll while an account scans", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const scanning = overview();
    scanning.accounts[0] = { ...scanning.accounts[0], status: "scanning" };
    overviewCall.mockResolvedValue(scanning);
    insights(["a", "b"]);
    await screen.findByRole("button", { name: /^All accounts/ });
    await vi.advanceTimersByTimeAsync(100);
    const n = overviewCall.mock.calls.length;
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(overviewCall.mock.calls.length).toBe(n);
  } finally { vi.useRealTimers(); }
});

test("Insights: the card also says how many copies the accounts hold, and reads them once", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    insights(["a", "b", "c"]);
    const card = await screen.findByRole("button", { name: /^All accounts/ });
    await waitFor(() => expect((card.textContent ?? "").replace(/\u00a0/g, " "))
      .toContain("4 senders in several accounts · 508 copies"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(copiesCall).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
  cleanup();
  copiesCall.mockResolvedValue({ left_out: 3, pairs: [] });
  insights(["a", "b"]);
  const plain = await screen.findByRole("button", { name: /^All accounts/ });
  await waitFor(() => expect((plain.textContent ?? "").replace(/\u00a0/g, " "))
    .toContain("4 senders in several accounts"));
  expect(plain.textContent).not.toContain("copies");
});

test("Insights: before the numbers arrive it still has its place", async () => {
  overviewCall.mockReturnValue(new Promise(() => {}));
  insights(["a", "b"]);
  const card = await screen.findByRole("button", { name: /^All accounts/ });
  expect(card.textContent).toContain("Every mailbox side by side");
});

test("Insights: one account, no card; German", async () => {
  insights(["a"]);
  await waitFor(() => expect(stats).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /^All accounts/ })).toBeNull();
  cleanup();
  setLang("de");
  insights(["a", "b"]);
  const card = await screen.findByRole("button", { name: /^Alle Konten/ });
  await waitFor(() => expect(within(card).getByText(/Absender in mehreren Konten/)).toBeTruthy());
});
