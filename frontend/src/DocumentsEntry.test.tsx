// @vitest-environment jsdom
/* Where Your documents is opened from: the last item under Insights in the
 * sidebar (after All accounts when that is there), its route, and the last
 * card of the phone's Insights tab - with everything INVENTORY.md lists for
 * Insights still where it was. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const documentsSummary = vi.fn();
const stats = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { documentsSummary: () => documentsSummary(),
    stats: () => stats(),
    accountsOverview: () => Promise.reject(new Error("x")),
    accountsCopies: () => Promise.reject(new Error("x")),
    trackers: () => Promise.resolve({ usable: false, checked: 0, pixel: 0, senders: 0 }),
    wrapped: () => Promise.reject(new Error("x")),
    rhythm: () => Promise.reject(new Error("x")),
    addressesSummary: () => Promise.resolve({ leaked: 0, total: 0, scanned: true }),
    audit: () => Promise.resolve({ total: 0, entries: [] }) },
}));

import { Sidebar } from "./components/Sidebar";
import { InsightsPage } from "./components/TabPages";
import { summary } from "./documentsFixtures";
import { setLang } from "./i18n";
import { TOOL_PAGES, TOOL_TAB, isToolPage, parseHash } from "./nav";
import type { AppState } from "./types";

beforeEach(() => {
  documentsSummary.mockResolvedValue(summary());
  stats.mockResolvedValue({ mails: 1, months: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); setLang("en"); });

/* -------------------------------- the sidebar ------------------------------ */

const side = (allAccounts?: boolean) => {
  const onOpen = vi.fn();
  render(<Sidebar page="overview" onPage={() => {}} onOpen={onOpen}
    account={null} disabled={{}} allAccounts={allAccounts} leaked={2} />);
  return onOpen;
};
const names = () => screen.getAllByRole("button").map((b) => b.textContent ?? "");

test("sidebar: Your documents is the last item under Insights, after All accounts", () => {
  const onOpen = side(true);
  const at = (re: RegExp) => names().findIndex((n) => re.test(n));
  const order = [/Statistics/, /Space map/, /Your year in mail/, /Trackers/,
    /Subscriptions/, /Your addresses/, /Waiting for a reply/, /All accounts/,
    /^Your documents$/].map(at);
  expect(order.every((n) => n >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // nothing sits between it and the footer (Activity, Settings)
  expect(at(/^Activity/)).toBe(at(/^Your documents$/) + 1);
  fireEvent.click(screen.getByRole("button", { name: "Your documents" }));
  expect(onOpen).toHaveBeenCalledWith("documents");
});

test("sidebar: with one account it follows Waiting for a reply", () => {
  side(false);
  const at = (re: RegExp) => names().findIndex((n) => re.test(n));
  expect(screen.queryByRole("button", { name: "All accounts" })).toBeNull();
  expect(at(/^Your documents$/)).toBe(at(/Waiting for a reply/) + 1);
});

test("sidebar: every other item is still there", () => {
  side(true);
  for (const n of ["Overview", "Senders", "All mail", "Triage", "Duplicates",
    "Attachments", "Rules", "Junk", "Trash", "Your folders", "Statistics",
    "Space map", "Your year in mail", "Trackers", "Subscriptions",
    "Your addresses", "Waiting for a reply", "All accounts", "Activity"])
    expect(screen.queryByRole("button", { name: new RegExp(n) })
      ?? screen.queryByRole("link", { name: new RegExp(n) })).toBeTruthy();
});

test("sidebar: German name", () => {
  setLang("de");
  side(true);
  expect(screen.getByRole("button", { name: "Deine Dokumente" })).toBeTruthy();
});

test("it is a tool page at #/documents on the Insights tab below 1024 px", () => {
  expect(TOOL_PAGES).toContain("documents");
  expect(TOOL_TAB.documents).toBe("insights");
  expect(parseHash("#/documents")).toBe("documents");
  expect(isToolPage("documents")).toBe(true);
  // the pages that were there are still there, in their order
  expect(TOOL_PAGES.indexOf("accounts")).toBe(TOOL_PAGES.indexOf("waiting") + 1);
  expect(TOOL_PAGES.indexOf("waiting")).toBe(TOOL_PAGES.indexOf("addresses") + 1);
  for (const p of ["stats", "space", "trackers", "subscriptions", "addresses",
    "waiting", "accounts", "activity"])
    expect(TOOL_TAB[p as keyof typeof TOOL_TAB]).toBe("insights");
});

/* ---------------------------- the Insights tab card ------------------------ */

const state = (over: object = {}) => ({ status: "done", rules: [],
  account: "proton", scanned_ts: 1,
  atts: { status: "done", progress: "", error: "", mails: 3, size: 1 },
  ...over }) as unknown as AppState;
const insights = (accounts?: string[], st: AppState = state()) => {
  const onOpen = vi.fn();
  render(<InsightsPage groups={[]} state={st} accounts={accounts}
    onOpen={onOpen} />);
  return onOpen;
};

test("Insights: the card is the very last one, after All accounts", async () => {
  const onOpen = insights(["a", "b"]);
  const card = await screen.findByRole("button", { name: /^Your documents/ });
  await waitFor(() => expect((card.textContent ?? "").replace(/\u00a0/g, " "))
    .toContain("312 documents in 2026"));
  expect((card.textContent ?? "").replace(/\u00a0/g, " "))
    .toContain("184 invoices");
  const all = screen.getByRole("button", { name: /^All accounts/ });
  expect(all.compareDocumentPosition(card)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.parentElement!.lastElementChild).toBe(card);
  const waiting = screen.getByRole("button", { name: /^Waiting for a reply/ });
  expect(waiting.compareDocumentPosition(all)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  for (const name of [/^Statistics/, /^Subscriptions/, /^Your addresses/])
    expect(screen.getByRole("button", { name })).toBeTruthy();
  fireEvent.click(card);
  expect(onOpen).toHaveBeenCalledWith("documents");
});

test("Insights: with one account it follows Waiting for a reply", async () => {
  insights(undefined);
  const card = await screen.findByRole("button", { name: /^Your documents/ });
  expect(screen.queryByRole("button", { name: /^All accounts/ })).toBeNull();
  const waiting = screen.getByRole("button", { name: /^Waiting for a reply/ });
  expect(waiting.nextElementSibling).toBe(card);
  expect(card.parentElement!.lastElementChild).toBe(card);
});

test("Insights: before the analysis the card says what to do", async () => {
  documentsSummary.mockResolvedValue(summary({ analyzed: false, years: [] }));
  insights(undefined, state({ atts: { status: "idle", progress: "", error: "",
    mails: 0, size: 0 } }));
  const card = await screen.findByRole("button", { name: /^Your documents/ });
  await waitFor(() => expect(card.textContent).toContain(
    "Analyze your attachments to find them"));
});

test("Insights: analysed, nothing found", async () => {
  documentsSummary.mockResolvedValue(summary({ years: [] }));
  insights();
  const card = await screen.findByRole("button", { name: /^Your documents/ });
  await waitFor(() => expect(card.textContent).toContain(
    "No documents found yet"));
});

test("Insights: before the numbers arrive it has its place and says what it is", async () => {
  documentsSummary.mockReturnValue(new Promise(() => {}));
  insights();
  const card = await screen.findByRole("button", { name: /^Your documents/ });
  expect(card.textContent).toContain("Invoices, contracts and tickets by year");
});

test("Insights: it asks once per scan and analysis, not on every render", async () => {
  const { rerender } = render(<InsightsPage groups={[]} state={state()}
    onOpen={() => {}} />);
  await screen.findByRole("button", { name: /^Your documents/ });
  expect(documentsSummary).toHaveBeenCalledTimes(1);
  rerender(<InsightsPage groups={[]} state={state({ rules: [] })}
    onOpen={() => {}} />);
  expect(documentsSummary).toHaveBeenCalledTimes(1);
  rerender(<InsightsPage groups={[]} state={state({ scanned_ts: 2 })}
    onOpen={() => {}} />);
  await waitFor(() => expect(documentsSummary).toHaveBeenCalledTimes(2));
});

test("Insights: nothing is asked while the mailbox is not scanned", async () => {
  insights(undefined, state({ status: "idle" }));
  const card = await screen.findByRole("button", { name: /^Your documents/ });
  expect(card.textContent).toContain("Invoices, contracts and tickets by year");
  expect(documentsSummary).not.toHaveBeenCalled();
});

test("Insights: German", async () => {
  setLang("de");
  insights();
  const card = await screen.findByRole("button", { name: /^Deine Dokumente/ });
  await waitFor(() => expect((card.textContent ?? "").replace(/\u00a0/g, " "))
    .toContain("312 Dokumente in 2026"));
  expect((card.textContent ?? "").replace(/\u00a0/g, " "))
    .toContain("184 Rechnungen");
});
