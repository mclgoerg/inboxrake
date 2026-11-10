// @vitest-environment jsdom
/* Triage from 1024 px: up-next list, key hints, counters with words, the
   labelled engagement tag. (Decisions and apply are in App.triage.test.) */

import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import { DialogProvider } from "./components/ui";
import { TriagePanel } from "./components/TriagePanel";
import type { Group } from "./types";

const grp = (n: number, over: Partial<Group> = {}): Group => ({
  key: `s${n}@m.example`, label: `Sender ${n}`, sub: `s${n}@m.example`,
  count: 100 - n, size: 1_000_000 * (10 - n), unread: 1, first: "2024-01-01",
  last: "2025-06-01", tags: [], samples: ["Weekly digest"],
  bulk: false, unsub: n === 0, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 20, ...over,
});
const DECK = Array.from({ length: 9 }, (_, i) => grp(i));

let wide = true;
beforeEach(() => {
  wide = true;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? true
      : q.includes("1024") ? wide : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  setLang("en");
  vi.unstubAllGlobals();
});

const open = (groups = DECK) => {
  render(<DialogProvider><TriagePanel groups={groups} grouping="sender"
    onApply={() => Promise.resolve(true)} onClose={() => {}} /></DialogProvider>);
  return screen.getByRole("dialog", { name: "Triage" });
};
const card = () => screen.getByTestId("triage-card");
const key = (k: string) => fireEvent.keyDown(window, { key: k });

test("desktop: the next five cards and '+ N more' sit beside the card", () => {
  const dlg = open();
  const next = within(dlg).getByRole("region", { name: "Up next" });
  const rows = within(next).getAllByRole("listitem");
  expect(rows).toHaveLength(5);
  expect(rows[0].textContent).toContain("Sender 1");
  expect(rows[4].textContent).toContain("Sender 5");
  expect(rows[0].textContent).toContain("99\u00a0mails");
  expect(within(next).getByText("+ 3 more")).toBeTruthy();
  expect(within(dlg).getByText(/Drag the card left or right, or use the arrow keys\. Nothing changes until you apply/))
    .toBeTruthy();
  // the list moves on with the deck
  key("ArrowRight");
  const after = within(dlg).getByRole("region", { name: "Up next" });
  expect(within(after).getAllByRole("listitem")[0].textContent).toContain("Sender 2");
  expect(within(after).getByText("+ 2 more")).toBeTruthy();
});

test("desktop: no up-next list for the last card, the help line stays", () => {
  const dlg = open([grp(0), grp(1)]);
  expect(within(dlg).getByRole("region", { name: "Up next" })).toBeTruthy();
  expect(within(dlg).queryByText(/\+ \d+ more/)).toBeNull();
  key("ArrowRight");
  expect(within(dlg).queryByRole("region", { name: "Up next" })).toBeNull();
  expect(within(dlg).getByText(/Drag the card left or right/)).toBeTruthy();
});

test("desktop: key hints on the buttons (Protect has none), no far-edge pills", () => {
  const dlg = open();
  const keys = (name: RegExp) =>
    within(dlg).getByRole("button", { name }).getAttribute("aria-keyshortcuts");
  expect(keys(/Undo/)).toBe("Backspace");
  expect(keys(/Trash/)).toBe("ArrowLeft");
  expect(keys(/Unsubscribe/)).toBe("ArrowUp");
  expect(keys(/Keep/)).toBe("ArrowRight");
  expect(keys(/Protect/)).toBeNull();
  expect(dlg.querySelectorAll("kbd")).toHaveLength(4);
  // the pills ("Trash" / "Keep" at the edges) are not rendered
  expect(Array.from(dlg.querySelectorAll("span"))
    .filter((e) => e.className.includes("pointer-events-none"))).toHaveLength(0);
  // "Trash" / "Keep" appear once each: the button caption, not an edge pill
  expect(within(dlg).getAllByText("Trash")).toHaveLength(1);
  expect(within(dlg).getAllByText("Keep")).toHaveLength(1);
});

test("desktop: counters with words follow the decisions", () => {
  const dlg = open();
  for (const w of ["0 trashed", "0 kept", "0 unsubscribed", "0 protected"]) {
    expect(within(dlg).getByText(w)).toBeTruthy();
  }
  key("ArrowLeft");
  key("ArrowRight");
  key("ArrowRight");
  expect(within(dlg).getByText("1 trashed")).toBeTruthy();
  expect(within(dlg).getByText("2 kept")).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: /Protect/ }));
  expect(within(dlg).getByText("1 protected")).toBeTruthy();
  // the words are decoration; the status line still says it
  expect(within(dlg).getByRole("status").textContent)
    .toMatch(/^Trash 1\u00a0group · .+ · Protect 1$/);
});

test("desktop: Backspace and the Undo button restore the list and counters", () => {
  const dlg = open();
  const upNext = () => within(within(dlg).getByRole("region", { name: "Up next" }));
  key("ArrowLeft");
  key("ArrowRight");
  expect(upNext().getAllByRole("listitem")[0].textContent).toContain("Sender 3");
  key("Backspace");
  expect(within(dlg).getByText("0 kept")).toBeTruthy();
  expect(within(dlg).getByText("1 trashed")).toBeTruthy();
  expect(upNext().getAllByRole("listitem")[0].textContent).toContain("Sender 2");
  expect(upNext().getByText("+ 2 more")).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Undo last decision" }));
  expect(within(dlg).getByText("0 trashed")).toBeTruthy();
  expect(upNext().getAllByRole("listitem")[0].textContent).toContain("Sender 1");
  expect(within(card()).getByText("Sender 0")).toBeTruthy();
});

test("engagement is a labelled tag with the same popover, on both layouts", () => {
  for (const w of [true, false]) {
    wide = w;
    open();
    const tag = within(card()).getByRole("button", { name: "Low engagement" });
    expect(tag.getAttribute("data-eng")).toBe("low");
    expect(tag.getAttribute("title")).toContain("Engagement 20/100 (low)");
    expect(document.getElementById(tag.getAttribute("aria-describedby")!)!
      .textContent).toContain("Engagement 20/100 (low)");
    fireEvent.click(tag);
    expect(within(card()).getByRole("dialog").textContent)
      .toContain("Engagement score 20/100 · low");
    cleanup();
  }
});

test("below 1024: no up-next list, the swipe hint and the footer buttons stay", () => {
  wide = false;
  const dlg = open();
  expect(within(dlg).queryByRole("region", { name: "Up next" })).toBeNull();
  expect(within(dlg).getByText(/Swipe left to trash, right to keep/)).toBeTruthy();
  expect(dlg.querySelectorAll("kbd")).toHaveLength(0);
  expect(within(dlg).getByRole("button", { name: /Keep/ })
    .getAttribute("aria-keyshortcuts")).toBe("ArrowRight");
  // the icon counters stay on phones
  expect(within(dlg).queryByText("0 trashed")).toBeNull();
});

test("German: counters, up next and help line", () => {
  setLang("de");
  const dlg = open();
  expect(within(dlg).getByText("0 im Papierkorb")).toBeTruthy();
  expect(within(dlg).getByText("0 behalten")).toBeTruthy();
  expect(within(dlg).getByText("0 abbestellt")).toBeTruthy();
  expect(within(dlg).getByText("0 geschützt")).toBeTruthy();
  expect(within(dlg).getByRole("region", { name: "Als Nächstes" })).toBeTruthy();
  expect(within(dlg).getByText("+ 3 weitere")).toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Geringe Interaktion" })).toBeTruthy();
});

test("the card's tags: categories are one neutral style that never wraps, "
  + "status is tinted", () => {
  open([grp(0, { tags: ["newsletter", "shopping"], new: true, ai: {
    verdict: "keep", reason: "r" } as Group["ai"],
  unsubscribed: { n: 1, of: 1, status: "done", link: "", addr: "" } }),
  ...DECK.slice(1)]);
  const c = within(card());
  const cat = c.getByText("Newsletters");
  expect(cat.className).toMatch(/whitespace-nowrap/);
  expect(cat.className).toMatch(/border-line/);
  expect(c.getByText("Shopping").className).toBe(cat.className);
  // Unsubscribed / New are tinted statuses; Keep is calm, not Trash's red
  expect(c.getByText("Unsubscribed").className).toMatch(/bg-info-bg/);
  expect(c.getByText("New").className).toMatch(/bg-new-bg/);
  expect(c.getByText("keep", { exact: false }).closest("span.rounded-full")!
    .className).toMatch(/bg-info-bg/);
});
