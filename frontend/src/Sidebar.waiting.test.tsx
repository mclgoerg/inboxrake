// @vitest-environment jsdom
/* The Waiting for a reply item of the sidebar: its badge, the route, and the
 * phone Insights widget. */

import { cleanup, fireEvent, render, screen, waitFor } from
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

beforeEach(() => {
  stats.mockResolvedValue({ mails: 1, months: [] });
  trackers.mockResolvedValue({ usable: false, checked: 0, pixel: 0, senders: 0 });
  audit.mockResolvedValue({ total: 0, entries: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); setLang("en"); });

const mount = (n?: number) => {
  const onOpen = vi.fn();
  render(<Sidebar page="overview" onPage={() => {}} onOpen={onOpen}
    account={null} disabled={{}} waiting={n} />);
  return onOpen;
};

test("a Waiting for a reply item under Insights with the count of what is overdue", () => {
  const onOpen = mount(3);
  const item = screen.getByRole("button", { name: /Waiting for a reply/ });
  expect(item.textContent).toContain("3");
  expect(item.textContent).toContain("3 waiting longer than usual");
  fireEvent.click(item);
  expect(onOpen).toHaveBeenCalledWith("waiting");
});

test("it follows Your addresses, the last of the Insights tools", () => {
  mount(1);
  const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const at = (re: RegExp) => names.findIndex((n) => re.test(n));
  expect(at(/Waiting for a reply/)).toBeGreaterThan(at(/Your addresses/));
});

test("no badge before there is one", () => {
  mount(undefined);
  expect(screen.getByRole("button", { name: "Waiting for a reply" }).textContent)
    .toBe("Waiting for a reply");
  cleanup();
  mount(0);
  expect(screen.getByRole("button", { name: "Waiting for a reply" }).textContent)
    .toBe("Waiting for a reply");
});

test("German name and badge words", () => {
  setLang("de");
  mount(2);
  expect(screen.getByRole("button", { name: /Warten auf Antwort/ })).toBeTruthy();
  expect(screen.getByText(/warten länger als üblich/)).toBeTruthy();
});

test("it is a tool page at #/waiting that lives on the Insights tab below 1024 px", () => {
  expect(TOOL_PAGES).toContain("waiting");
  expect(TOOL_TAB.waiting).toBe("insights");
  expect(parseHash("#/waiting")).toBe("waiting");
  expect(isToolPage("waiting")).toBe(true);
});

/* ----------------------------- the phone widget ---------------------------- */

const insights = (waiting: unknown) => {
  const onOpen = vi.fn();
  render(<InsightsPage groups={[]} state={{ status: "done", rules: [] } as unknown as AppState}
    waiting={waiting as never} onOpen={onOpen} />);
  return onOpen;
};

test("Insights: the Waiting widget says how many wait and who, and opens the page", async () => {
  const onOpen = insights({ overdue: 3, people_n: 3, more: 0, oldest_days: 12,
    people: ["Travelly", "Alex Doe", "City Library"] });
  await waitFor(() => expect(stats).toHaveBeenCalled());
  const w = screen.getByRole("button", { name: /^Waiting for a reply/ });
  expect(w.textContent).toContain("3 longer than usual");
  expect(w.textContent).toContain("Travelly, Alex Doe, City Library");
  fireEvent.click(w);
  expect(onOpen).toHaveBeenCalledWith("waiting");
});

test("Insights: the widget keeps its place while unknown and when nobody waits", async () => {
  insights(null);
  await waitFor(() => expect(stats).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /^Waiting for a reply/ }).textContent)
    .toContain("See who hasn't answered you");
  cleanup();
  insights({ overdue: 0, people_n: 0, more: 0, oldest_days: 0, people: [] });
  await waitFor(() => expect(stats).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /^Waiting for a reply/ }).textContent)
    .toContain("Nobody is keeping you waiting");
});
