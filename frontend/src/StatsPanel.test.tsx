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
afterEach(() => { cleanup(); setLang("en"); extra = {}; });

test("freed is shown from purged_bytes only; old months show no figure",
  async () => {
    actions = {
      "2026-01": { trash: 4, archive: 1, move: 0, mark_read: 0, freed: 9999 },
      [thisMonth]: { trash: 2, archive: 0, move: 0, mark_read: 0,
        freed: 7777, purge: 3, purged_bytes: 1234 },
    };
    render(<StatsPanel onClose={() => {}} />);
    await screen.findByText("moved to Trash this month");
    expect(screen.getByText(
      "permanently deleted this month: 3 mails · 1234 B freed")).toBeTruthy();
    // the old move-based figures are never presented as freed space
    expect(document.body.textContent).not.toContain("9999");
    expect(document.body.textContent).not.toContain("7777");
    expect(document.body.textContent).toContain(
      "4 moved to Trash · 1 archived · 0 moved · 0 marked read");
    expect(document.body.textContent).toContain(
      "2 moved to Trash · 0 archived · 0 moved · 0 marked read · 3 deleted "
      + "permanently (1234 B freed)");
    // the old month has no "freed" at all
    expect(document.body.textContent?.match(/freed\)/g)).toHaveLength(1);
  });

test("a month without permanent deletes shows no freed line", async () => {
  actions = { [thisMonth]: { trash: 5, archive: 0, move: 0, mark_read: 0,
    freed: 5000 } };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("moved to Trash this month");
  expect(document.body.textContent).not.toContain("freed");
});

test("German labels", async () => {
  setLang("de");
  actions = { [thisMonth]: { trash: 1, archive: 0, move: 0, mark_read: 0,
    freed: 0, purge: 1, purged_bytes: 20 } };
  render(<StatsPanel onClose={() => {}} />);
  await screen.findByText("diesen Monat in den Papierkorb verschoben");
  expect(screen.getByText(
    "diesen Monat endgültig gelöscht: 1 Mail · 20 B frei")).toBeTruthy();
  expect(document.body.textContent).toContain("1 endgültig gelöscht (20 B frei)");
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
  await screen.findByText("moved to Trash this month");
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
  for (const s of ["10%", "10% newsletters (1)", "oldest mail:", "2025-01-01",
    "100 B per mail", "Top domains by size", "x.example", "senders you replied to (of 2)"])
    expect(txt().toLowerCase()).toContain(s.toLowerCase());
});
