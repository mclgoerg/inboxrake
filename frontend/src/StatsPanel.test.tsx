// @vitest-environment jsdom
/* Statistics: "freed" is what permanent deletes freed (`purged_bytes`) and
 * is only shown from the version that added them on; the old move-based
 * `freed` of earlier months is history and never shown as freed space. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StatsPanel } from "./components/StatsPanel";
import { setLang } from "./i18n";

let actions: Record<string, object> = {};
let extra: Record<string, unknown> = {};
vi.mock("./api", () => ({
  api: { stats: () => Promise.resolve({
    mails: 10, size: 1000, senders: 2, unread: 1, bulk: 1, replied_senders: 0,
    oldest: "2025-01-01", years: [], months: [], categories: [],
    top_domains: [], top_senders: [], scans: [], actions,
    ai: { rated: 0, groups: 0 }, ai_groups: { delete_safe: 0, review: 0,
      keep: 0, unrated: 0 },
    rated_mails: { delete_safe: 0, review: 0, keep: 0 }, ...extra }) },
  fmtSize: (n: number) => `${n} B`,
}));

const thisMonth = new Date().toISOString().slice(0, 7);
afterEach(() => {
  cleanup(); setLang("en"); extra = {}; vi.unstubAllGlobals();
});
/** jsdom has no matchMedia: the page renders its phone layout. This makes it
 *  a >= 640 px screen (tables instead of stacked rows). */
const wideScreen = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q.includes("min-width"), media: q, addEventListener() {},
  removeEventListener() {} }));

test("freed is shown from purged_bytes only; old months show no figure",
  async () => {
    actions = {
      "2026-01": { trash: 4, archive: 1, move: 0, mark_read: 0, freed: 9999 },
      [thisMonth]: { trash: 2, archive: 0, move: 0, mark_read: 0,
        freed: 7777, purge: 3, purged_bytes: 1234 },
    };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByText("moved to Trash");
    expect(screen.getByText(
      "permanently deleted this month: 3 mails · 1234 B freed")).toBeTruthy();
    // the old move-based figures are never presented as freed space
    expect(document.body.textContent).not.toContain("9999");
    expect(document.body.textContent).not.toContain("7777");
    // phones: one row per month, the Trash count at the right, details below
    const text = document.body.textContent ?? "";
    expect(text).toContain("Jan 20264 to Trash1 archived");
    expect(text).toContain("2 to Trash3 deleted · 1234 B freed");
    // the old month has no "freed" at all
    expect(document.body.textContent?.match(/1234 B freed/g)).toHaveLength(2);
  });

test("cleaned up per month: a table on a wide screen, zero as a dash",
  async () => {
    wideScreen();
    actions = {
      "2026-01": { trash: 4, archive: 1, move: 0, mark_read: 0, freed: 9999 },
      "2025-12": { trash: 2, archive: 0, move: 3, mark_read: 5, freed: 0,
        purge: 3, purged_bytes: 1234 },
    };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByRole("table", { name: "Cleaned up per month" });
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(["Month", "To Trash",
      "Archived", "Moved", "Marked read", "Deleted"]));
    const rows = screen.getAllByRole("row").map((r) => r.textContent);
    expect(rows).toContain("Jan 202641---");
    expect(rows).toContain("Dec 20252-353 · 1234 B freed");
  });

test("a month without permanent deletes shows no freed line", async () => {
  actions = { [thisMonth]: { trash: 5, archive: 0, move: 0, mark_read: 0,
    freed: 5000 } };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("moved to Trash");
  expect(document.body.textContent).not.toContain("freed");
});

test("German labels", async () => {
  setLang("de");
  actions = { [thisMonth]: { trash: 1, archive: 0, move: 0, mark_read: 0,
    freed: 0, purge: 1, purged_bytes: 20 } };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("in den Papierkorb");
  expect(screen.getByText(
    "diesen Monat endgültig gelöscht: 1 Mail · 20 B frei")).toBeTruthy();
  expect(document.body.textContent).toContain("1 gelöscht · 20 B frei");
});

test("the header offers 'Your year in mail' when the host wires it", async () => {
  actions = {};
  const onWrapped = vi.fn();
  render(<StatsPanel onClose={() => {}} onWrapped={onWrapped} />);
  fireEvent.click(await screen.findByRole("button",
    { name: "Your year in mail" }));
  expect(onWrapped).toHaveBeenCalledTimes(1);
  cleanup();
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("moved to Trash");
  expect(screen.queryByRole("button", { name: "Your year in mail" })).toBeNull();
});

test("month columns are keyboard reachable and spell out mails and size",
  async () => {
    actions = {};
    extra = { months: [{ month: "2026-08", count: 85, size: 4300 },
      { month: "2026-09", count: 40, size: 11300 }] };
    render(<StatsPanel onClose={() => {}} />);
    const col = await screen.findByRole("button",
      { name: "Sep 2026 · 40 mails · 11300 B" });
    fireEvent.focus(col);
    // focusing shows the tooltip line (the column's name carries it too)
    expect(screen.getByText("Sep 2026 · 40 mails · 11300 B")).toBeTruthy();
  });

test("categories: donut with a legend that carries counts and sizes",
  async () => {
    actions = {};
    extra = { categories: [{ tag: "newsletter", count: 30, size: 900 },
      { tag: "shopping", count: 10, size: 100 }] };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByRole("img", { name: "By category" });
    expect(screen.getByText("40")).toBeTruthy();         // tagged mails
    expect(screen.getByText("30 · 900 B")).toBeTruthy();
    expect(screen.getByText("10 · 100 B")).toBeTruthy();
  });

test("a top sender opens when the host wires it", async () => {
  actions = {};
  extra = { top_senders: [{ key: "a@x.example", label: "Acme", count: 5,
    size: 50 }] };
  const onOpenSender = vi.fn();
  render(<StatsPanel onClose={() => {}} onOpenSender={onOpenSender} />);
  fireEvent.click(await screen.findByRole("button", { name: /Acme/ }));
  expect(onOpenSender).toHaveBeenCalledWith("a@x.example");
});

test("the figures of the old page are all still there", async () => {
  actions = {};
  extra = { years: [{ year: "2025", count: 3, size: 30 },
    { year: "2026", count: 7, size: 70 }],
    top_domains: [{ domain: "x.example", count: 4, size: 40 }] };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("Mails per year");
  const txt = () => document.body.textContent ?? "";
  for (const s of ["10%", "newsletters (1)", "oldest mail:", "1 Jan 2025",
    "100 B per mail", "Top domains", "by size · all time", "x.example",
    "senders you replied to (of 2)", "from 1 Jan 2025"])
    expect(txt().toLowerCase()).toContain(s.toLowerCase());
});

test("the period switch re-scopes the chart and the period KPIs", async () => {
  actions = {};
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")}`;
  extra = {
    mails: 100, size: 1000,
    months: [{ month: "2026-01", count: 60, size: 600 }],
    months_all: [{ month: "2025-01", count: 40, size: 400, unread: 4 },
      { month: "2026-01", count: 60, size: 600, unread: 6 }],
    days: [{ day, count: 3, size: 30, unread: 3 }],
  };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByRole("tablist", { name: "Period" });
  // default 12 months: 12 buckets are the newest of months_all (both here)
  expect(screen.getByText("Mails per month")).toBeTruthy();
  expect(document.body.textContent).not.toContain("(last 12)");
  expect(document.body.textContent).not.toContain("hover or focus");
  fireEvent.click(screen.getByRole("tab", { name: "30 days" }));
  expect(screen.getByText("Mails per day (last 30)")).toBeTruthy();
  expect(screen.getByText("2 senders", { exact: false })).toBeTruthy();
  expect(document.body.textContent).toContain("last 30 days · 10 B per mail");
  expect(screen.getByText("30 B")).toBeTruthy();
  expect(screen.getByText("100%")).toBeTruthy();              // unread 3 of 3
  fireEvent.click(screen.getByRole("tab", { name: "All time" }));
  expect(screen.getByText("Mails per month")).toBeTruthy();
  expect(screen.getByText("1000 B")).toBeTruthy();
  // all-time-only cards say so
  expect(screen.getAllByText("All time").length).toBeGreaterThan(1);
});

test("many categories: the rest is one 'Other' slice, still listed", async () => {
  actions = {};
  extra = { categories: ["a", "b", "c", "d", "e", "f", "g"].map((tag, i) => (
    { tag, count: 10 - i, size: 100 })) };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("Other");
  expect(screen.getByText("5 · 100 B")).toBeTruthy();        // f
  expect(screen.getByText("9 · 200 B")).toBeTruthy();        // Other = f + g
});

test("an empty mailbox: no stray figures, proper empty cards", async () => {
  actions = {};
  extra = { mails: 0, size: 0, senders: 0, unread: 0 };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("total size");
  expect(document.body.textContent).not.toContain("per mail");
  expect(screen.getAllByText("Nothing here yet").length).toBe(2);
});

test("a single month still gets its chart", async () => {
  actions = {};
  extra = { months: [{ month: "2026-01", count: 3, size: 30 }] };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByRole("button", { name: "Jan 2026 · 3 mails · 30 B" });
});

const ym = (back: number) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

test("12 months = the last 12 calendar months, gaps zero, future ignored",
  async () => {
    actions = {};
    extra = {
      months: [], days: [],
      months_all: [{ month: ym(0), count: 4, size: 40, unread: 0 },
        { month: ym(5), count: 2, size: 20, unread: 0 },
        { month: ym(-3), count: 9, size: 90, unread: 0 }],      // future
    };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByRole("tablist", { name: "Period" });
    expect(screen.getAllByRole("button", { name: /· \d+ mails? · / }).length)
      .toBe(12);
    expect(screen.getAllByRole("button", { name: /· 0 mails · 0 B/ }).length)
      .toBe(10);
    expect(document.body.textContent).toContain("last 12 months · 2 senders");
    expect(screen.getByText("6")).toBeTruthy();            // 4 + 2 mails
  });

test("an All-time axis across years labels the year", async () => {
  actions = {};
  extra = { months: [], days: [], months_all: [
    { month: "2024-01", count: 1, size: 1, unread: 0 },
    { month: "2025-06", count: 1, size: 1, unread: 0 }] };
  render(<StatsPanel onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("tab", { name: "All time" }));
  expect(screen.getByText("Jan ’24")).toBeTruthy();
});

test("categories show translated names, the rest is a grey 'Other'", async () => {
  actions = {};
  extra = { categories: [{ tag: "newsletter", count: 30, size: 900 },
    { tag: "dev/cloud", count: 12, size: 90 },
    { tag: "insurance", count: 10, size: 100 }] };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByRole("img", { name: "By category" });
  for (const n of ["Newsletters", "Dev / cloud", "Insurance"])
    expect(screen.getByText(n)).toBeTruthy();
  expect(screen.getByText("A mail can carry more than one category."))
    .toBeTruthy();
  cleanup();
  setLang("de");
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("Entwicklung & Cloud");
  expect(screen.getByText("Newsletter")).toBeTruthy();
});

test("mails per year: horizontal bars with 'so far' and 'from <date>'",
  async () => {
    actions = {};
    const y = new Date().getFullYear();
    extra = { oldest: `${y - 1}-11-30`,
      years: [{ year: String(y - 1), count: 3, size: 30 },
        { year: String(y), count: 7, size: 70 }] };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByText("Mails per year");
    expect(screen.getByText("7 mails · so far")).toBeTruthy();
    expect(screen.getByText(`3 mails · from 30 Nov ${y - 1}`)).toBeTruthy();
    // newest year first
    const rows = screen.getAllByText(/^\d{4}$/).map((e) => e.textContent);
    expect(rows).toEqual([String(y), String(y - 1)]);
  });

test("top domains and senders: the head, then 'Show all N'", async () => {
  actions = {};
  extra = {
    top_domains: Array.from({ length: 8 }, (_, i) => (
      { domain: `d${i}.example`, count: 8 - i, size: 10 })),
    top_senders: Array.from({ length: 9 }, (_, i) => (
      { key: `s${i}@x.example`, label: `Sender ${i}`, count: 9 - i, size: 5 })),
  };
  wideScreen();
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("d0.example");
  expect(screen.queryByText("d5.example")).toBeNull();
  expect(screen.queryByText("Sender 6")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 8" }));
  expect(screen.getByText("d7.example")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
  expect(screen.queryByText("d7.example")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
  expect(screen.getByText("Sender 8")).toBeTruthy();
});

test("AI verdicts: a stacked bar, a legend and the one-by-one line",
  async () => {
    actions = {};
    extra = { ai_groups: { delete_safe: 6, review: 3, keep: 3, unrated: 135 },
      rated_mails: { delete_safe: 10, review: 20, keep: 15 } };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByText("6 safe to delete");
    for (const s of ["3 review", "3 keep", "135 unrated",
      "45 mails rated one by one (10 safe to delete)"])
      expect(screen.getByText(s)).toBeTruthy();
  });

test("recent scans: a table with the app's date format", async () => {
  actions = {};
  const ts = (iso: string) => new Date(iso).getTime() / 1000;
  extra = { scans: [{ ts: ts("2020-03-05T14:13:00"), mails: 1200, senders: 14,
    size: 500 }, { ts: ts("2020-03-12T09:05:00"), mails: 1300, senders: 15,
    size: 600 }] };
  wideScreen();
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByRole("table", { name: "Recent scans" });
  const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");
  // newest first, "12 Mar 2020, 09:05" (never the US "3/12/2020, 9:05:00 AM")
  const i = rows.findIndex((r) => r.startsWith("12 Mar 2020, 09:05"));
  expect(i).toBeGreaterThan(0);
  expect(rows[i]).toContain("1,300");
  expect(rows[i + 1].startsWith("5 Mar 2020, 14:13")).toBe(true);
  expect(document.body.textContent).not.toMatch(/AM|PM/);
});

test("the KPI tiles share one shape: figure, label, one detail line",
  async () => {
    actions = { [thisMonth]: { trash: 7, archive: 2, move: 0, mark_read: 0 } };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByText("moved to Trash");
    for (const s of ["received", "unread", "this month · 2 archived"])
      expect(document.body.textContent).toContain(s);
  });
