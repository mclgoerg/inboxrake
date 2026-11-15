// @vitest-environment jsdom
/* "When mail arrives": the grid, its tooltip, the table with the same
 * numbers, the kind filter, What stands out and the four shares - desktop
 * (hover, click opens the slot) and phone (tap selects, a button opens). */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ArrivalStrip, RhythmCard } from "./components/RhythmCard";
import { setLang } from "./i18n";
import type { RhythmKindData, RhythmResp } from "./rhythm";

const rhythm = vi.fn();
vi.mock("./api", () => ({ api: { rhythm: (...a: unknown[]) => rhythm(...a) } }));

const blank = () => Array.from({ length: 7 }, () => Array(24).fill(0));
const kind = (grid: number[][], top: RhythmKindData["top"] = {}): RhythmKindData =>
  ({ total: grid.flat().reduce((a, b) => a + b, 0), grid, top });

const all = blank();
all[1][6] = 46; all[0][6] = 31; all[1][7] = 31; all[6][3] = 1; all[5][9] = 14;
const news = blank();
news[0][6] = 31; news[1][6] = 28; news[2][6] = 25;
const DATA: RhythmResp = {
  period: "30d", tz: "Europe/Berlin", from: 0,
  kinds: { all: kind(all, {
    "1-6": { senders: [{ key: "a", label: "Deals Daily", count: 18 },
      { key: "b", label: "Gadget Weekly", count: 9 }], more: 19 } }),
  newsletters: kind(news), people: kind(blank()), orders: kind(blank()) },
  daily: [{ key: "d@x.example", label: "Deals Daily", hour: 6, per_day: 4.1,
    mails: 123, open_pct: 2 }],
};

const coarse = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: on && q.includes("coarse"), media: q, addEventListener() {},
  removeEventListener() {} }));

beforeEach(() => { rhythm.mockResolvedValue(DATA); coarse(false); });
afterEach(() => { cleanup(); setLang("en"); vi.unstubAllGlobals(); rhythm.mockReset(); });

const cell = (d: number, h: number) =>
  document.querySelector(`[data-cell="${d}-${h}"]`) as HTMLElement;

const open = vi.fn();
const unsub = vi.fn();
const renderCard = (period: "30d" | "12m" | "all" = "30d") => render(
  <RhythmCard period={period} onOpenSlot={open} onUnsubscribe={unsub} />);

test("asks for the period and draws 7 x 24 squares in five steps", async () => {
  renderCard("12m");
  await screen.findByRole("heading", { name: "When mail arrives" });
  await waitFor(() => expect(cell(1, 6)).toBeTruthy());
  expect(rhythm).toHaveBeenCalledWith("12m");
  expect(document.querySelectorAll("[data-cell]")).toHaveLength(168);
  expect(cell(1, 6).dataset.level).toBe("4");          // the busiest
  expect(cell(0, 6).dataset.level).toBe("3");          // 31 of 46
  expect(cell(6, 3).dataset.level).toBe("1");          // one mail is visible
  expect(cell(3, 3).dataset.level).toBe("0");          // none
  // the legend always shows, the zone is named
  expect(screen.getByRole("img", { name: /five steps of one colour/ })).toBeTruthy();
  expect(screen.getByText(/your time zone \(Europe\/Berlin\)/)).toBeTruthy();
  expect(screen.getByText("Busiest: Tue 06:00 · quietest: Sun evening")).toBeTruthy();
});

test("the grid is one image with a text summary", async () => {
  renderCard();
  const img = await screen.findByRole("img", { name: /Mails per hour of the week/ });
  expect(img.getAttribute("aria-label")).toBe(
    "Mails per hour of the week, 123 in 30\u00a0days. Busiest: Tue 06:00.");
});

test("hover shows the hour, the count and the top senders", async () => {
  renderCard();
  await waitFor(() => expect(cell(1, 6)).toBeTruthy());
  fireEvent.mouseEnter(cell(1, 6));
  const tip = screen.getByRole("tooltip");
  expect(tip.textContent).toBe(
    "Tue, 06:00 - 07:00 · 46 mails in 30\u00a0daysDeals Daily 18 · Gadget Weekly 9 · 19 more");
  fireEvent.mouseLeave(cell(1, 6).parentElement!);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("a click opens the mails of that slot", async () => {
  renderCard("all");
  await waitFor(() => expect(cell(1, 6)).toBeTruthy());
  fireEvent.click(cell(1, 6));
  expect(open).toHaveBeenCalledWith({ kind: "all", period: "all", days: [1],
    from: 6, to: 7 });
  open.mockClear();
  fireEvent.click(cell(3, 3));                          // empty: nothing to show
  expect(open).not.toHaveBeenCalled();
});

test("phones: a tap selects, the button opens the slot", async () => {
  coarse(true);
  renderCard();
  await waitFor(() => expect(cell(1, 6)).toBeTruthy());
  expect(screen.getByText("Tap an hour to see who writes then.")).toBeTruthy();
  fireEvent.click(cell(1, 6));
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText(
    "Tue, 06:00 - 07:00 · 46 mails in 30 days")).toBeTruthy();
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show these mails" }));
  expect(open).toHaveBeenCalledWith({ kind: "all", period: "30d", days: [1],
    from: 6, to: 7 });
});

test("Show as table has the same numbers as the grid", async () => {
  renderCard();
  await waitFor(() => expect(cell(1, 6)).toBeTruthy());
  expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(24);
  const grid = DATA.kinds.all.grid;
  rows.forEach((r, h) => {
    const cells = within(r).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(grid.map((day) => String(day[h])));
  });
  expect(within(table).getAllByRole("columnheader").map((c) => c.textContent))
    .toEqual(["Hour", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  // a number is a button that opens its slot (keyboard users)
  fireEvent.click(screen.getByRole("button", { name: "Tue 06:00: 46 mails - show them" }));
  expect(open).toHaveBeenCalledWith({ kind: "all", period: "30d", days: [1],
    from: 6, to: 7 });
  fireEvent.click(screen.getByRole("button", { name: "Hide table" }));
  expect(screen.queryByRole("table")).toBeNull();
});

test("the kind filter switches grid, table and shares", async () => {
  renderCard();
  await waitFor(() => expect(cell(1, 6)).toBeTruthy());
  fireEvent.click(screen.getByRole("radio", { name: "Newsletters" }));
  expect(cell(0, 6).dataset.level).toBe("4");
  expect(cell(5, 9).dataset.level).toBe("0");
  fireEvent.click(screen.getByRole("radio", { name: "People" }));
  expect(screen.getByText("No mail in this period.")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Orders" }));
  fireEvent.click(screen.getByRole("radio", { name: "Newsletters" }));
  fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
  fireEvent.click(screen.getByRole("button", { name: "Mon 06:00: 31 mails - show them" }));
  expect(open).toHaveBeenCalledWith({ kind: "newsletters", period: "30d",
    days: [0], from: 6, to: 7 });
});

test("What stands out lists the sentences; Unsubscribe and Show them act", async () => {
  renderCard();
  const wave = await screen.findByText("100% of newsletters arrive before 8:00");
  expect(wave).toBeTruthy();
  expect(screen.getByText("Deals Daily mails you every day at 06:0x")).toBeTruthy();
  expect(screen.getByText("4.1 mails a day · you open 2%")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Unsubscribe…" }));
  expect(unsub).toHaveBeenCalledWith("d@x.example");
  fireEvent.click(screen.getByRole("button", { name: "Show them" }));
  expect(open).toHaveBeenCalledWith({ kind: "newsletters", period: "30d",
    days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 8 });
});

test("the four shares of the period", async () => {
  renderCard();
  await screen.findByText("Before 8:00");
  const text = document.body.textContent ?? "";
  // all: 46+31+31+1(night) = 109 before 8:00 of 123; office 0; after 0; weekend 15
  expect(text).toContain("89%Before 8:00");
  expect(text).toContain("0%Office hours");
  expect(text).toContain("0%After 18:00");
  expect(text).toContain("12%Weekend");
});

test("German: heading, filter, table, sentences", async () => {
  setLang("de");
  renderCard();
  await screen.findByRole("heading", { name: "Wann Post kommt" });
  expect(screen.getByRole("radio", { name: "Newsletter" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Personen" })).toBeTruthy();
  expect(screen.getByText("Was auffällt")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Als Tabelle anzeigen" })).toBeTruthy();
  expect(screen.getByText("Deals Daily schreibt dir jeden Tag um 06:0x Uhr")).toBeTruthy();
  expect(screen.getByText(/deine Zeitzone \(Europe\/Berlin\)/)).toBeTruthy();
  fireEvent.mouseEnter(cell(1, 6));
  expect(screen.getByRole("tooltip").textContent).toContain("46 Mails in 30\u00a0Tagen");
});

test("a failed request says so instead of drawing an empty grid", async () => {
  rhythm.mockRejectedValue(new Error("boom"));
  renderCard();
  await screen.findByText("Could not load the arrival times.");
  expect(document.querySelector("[data-cell]")).toBeNull();
});

test("an API object without the call (older mock) does not crash", async () => {
  rhythm.mockImplementation(() => { throw new TypeError("not a function"); });
  renderCard();
  await screen.findByText("Could not load the arrival times.");
});

// ------------------------------------------------------------ sender strip

test("the sender strip: usual hours, weekday chips, a 24-hour image", () => {
  const stamps: number[] = [];
  for (let d = 1; d <= 14; d++) {
    for (let k = 0; k < 4; k++) {
      stamps.push(new Date(2026, 0, d, 6, 5 + k * 10).getTime() / 1000);
    }
  }
  stamps.push(new Date(2026, 0, 14, 6, 55).getTime() / 1000);
  render(<ArrivalStrip stamps={stamps} />);
  expect(screen.getByText("Usually 06:00 - 07:00, every day")).toBeTruthy();
  expect(screen.getByText("4.1 a day")).toBeTruthy();
  const strip = screen.getByRole("img", { name: /Mails of this sender per hour/ });
  expect(strip.getAttribute("aria-label")).toContain("06:00 (57)");
  expect(strip.querySelectorAll("[data-level]")).toHaveLength(24);
  expect(screen.getAllByRole("listitem").map((l) => l.textContent))
    .toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
});

test("no strip for a handful of mails", () => {
  const { container } = render(<ArrivalStrip stamps={[1, 2, 3]} />);
  expect(container.textContent).toBe("");
});
