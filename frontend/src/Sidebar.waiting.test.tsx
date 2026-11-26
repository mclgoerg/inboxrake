// @vitest-environment jsdom
/* The Waiting for a reply item of the sidebar (after Your addresses, no
 * badge), its route, and the phone Insights card at the end of the tab. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const stats = vi.fn();
const trackers = vi.fn();
const audit = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { stats: () => stats(), trackers: () => trackers(),
    wrapped: () => Promise.reject(new Error("x")),
    rhythm: () => Promise.reject(new Error("x")),
    addressesSummary: () => Promise.resolve({ leaked: 0, total: 0, scanned: true }),
    audit: (...a: unknown[]) => audit(...a) },
}));

import { Sidebar } from "./components/Sidebar";
import { InsightsPage } from "./components/TabPages";
import { setLang } from "./i18n";
import { TOOL_PAGES, TOOL_TAB, isToolPage, parseHash } from "./nav";
import type { AppState } from "./types";
import { resp } from "./waitingFixtures";

beforeEach(() => {
  stats.mockResolvedValue({ mails: 1, months: [] });
  trackers.mockResolvedValue({ usable: false, checked: 0, pixel: 0, senders: 0 });
  audit.mockResolvedValue({ total: 0, entries: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); setLang("en"); });

const mount = () => {
  const onOpen = vi.fn();
  render(<Sidebar page="overview" onPage={() => {}} onOpen={onOpen}
    account={null} disabled={{}} leaked={2} />);
  return onOpen;
};

test("a Waiting for a reply item under Insights, with no count", () => {
  const onOpen = mount();
  const item = screen.getByRole("button", { name: "Waiting for a reply" });
  expect(item.textContent).toBe("Waiting for a reply");
  fireEvent.click(item);
  expect(onOpen).toHaveBeenCalledWith("waiting");
});

test("it follows Your addresses, the last of the Insights tools", () => {
  mount();
  const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const at = (re: RegExp) => names.findIndex((n) => re.test(n));
  expect(at(/Waiting for a reply/)).toBe(at(/Your addresses/) + 1);
  // and every Insights tool is still there, in its order
  const order = [/Statistics/, /Space map/, /Your year in mail/, /Trackers/,
    /Subscriptions/, /Your addresses/, /Waiting for a reply/].map(at);
  expect(order.every((n) => n >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("the leak badge of Your addresses is unchanged", () => {
  mount();
  expect(screen.getByRole("button", { name: /Your addresses/ }).textContent)
    .toContain("2");
});

test("German name", () => {
  setLang("de");
  mount();
  expect(screen.getByRole("button", { name: "Warten auf Antwort" })).toBeTruthy();
});

test("it is a tool page at #/waiting that lives on the Insights tab below 1024 px", () => {
  expect(TOOL_PAGES).toContain("waiting");
  expect(TOOL_TAB.waiting).toBe("insights");
  expect(parseHash("#/waiting")).toBe("waiting");
  expect(isToolPage("waiting")).toBe(true);
  // after Your addresses in the page list, too
  expect(TOOL_PAGES.indexOf("waiting")).toBe(TOOL_PAGES.indexOf("addresses") + 1);
});

/* ----------------------------- the phone card ----------------------------- */

const insights = (waiting: unknown) => {
  const onOpen = vi.fn();
  render(<InsightsPage groups={[]} state={{ status: "done", rules: [] } as unknown as AppState}
    waiting={waiting as never} onOpen={onOpen} />);
  return onOpen;
};

test("Insights: the card is the last one, after Recent activity", async () => {
  insights(resp().summary);
  await waitFor(() => expect(stats).toHaveBeenCalled());
  const card = screen.getByRole("button", { name: /^Waiting for a reply/ });
  const recent = screen.getByRole("region", { name: "Recent activity" });
  // the card follows the Recent activity section in the page
  expect(recent.compareDocumentPosition(card)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(card.parentElement!.lastElementChild).toBe(card);
  // every card of today is still there
  for (const name of [/^Statistics/, /^Subscriptions/, /^Your addresses/])
    expect(screen.getByRole("button", { name })).toBeTruthy();
});

test("Insights: the card says how many are overdue, the oldest and its usual time", async () => {
  const onOpen = insights(resp().summary);
  await waitFor(() => expect(stats).toHaveBeenCalled());
  const w = screen.getByRole("button", { name: /^Waiting for a reply/ });
  expect(within(w).getByText(/^3\sreplies overdue$/).className)
    .toContain("text-review-fg");
  expect(within(w).getByText(/^oldest: 9\sdays · usually 3$/)).toBeTruthy();
  fireEvent.click(w);
  expect(onOpen).toHaveBeenCalledWith("waiting");
});

test("Insights: no usual time yet, and one reply in the singular", async () => {
  insights({ ...resp().summary, overdue: 1, oldest_days: 1, oldest_usual: null });
  await waitFor(() => expect(stats).toHaveBeenCalled());
  const w = screen.getByRole("button", { name: /^Waiting for a reply/ });
  expect(within(w).getByText(/^1\sreply overdue$/)).toBeTruthy();
  expect(within(w).getByText(/^oldest: 1\sday$/)).toBeTruthy();
});

test("Insights: the card keeps its place while unknown, off, and when nothing is overdue", async () => {
  insights(null);
  await waitFor(() => expect(stats).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /^Waiting for a reply/ }).textContent)
    .toContain("See who hasn't answered you");
  cleanup();
  insights({ ...resp().summary, watching: false, overdue: 0 });
  await waitFor(() => expect(stats).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /^Waiting for a reply/ }).textContent)
    .toContain("Off for this account");
  cleanup();
  insights({ ...resp().summary, overdue: 0, people: [], oldest_days: 0 });
  await waitFor(() => expect(stats).toHaveBeenCalled());
  const w = screen.getByRole("button", { name: /^Waiting for a reply/ });
  expect(w.textContent).toContain("No reply is overdue");
  expect(w.textContent).not.toContain("oldest");
});

test("Insights: German", async () => {
  setLang("de");
  insights(resp().summary);
  await waitFor(() => expect(stats).toHaveBeenCalled());
  const w = screen.getByRole("button", { name: /^Warten auf Antwort/ });
  expect(w.textContent).toMatch(/3\sAntworten überfällig/);
  expect(w.textContent).toMatch(/älteste: 9\sTage · meist 3/);
});
