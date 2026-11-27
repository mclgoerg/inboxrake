// @vitest-environment jsdom
/* "You keep doing this": the Rules card (header, suggestions, evidence, Make it
 * a rule, Not this one, Why these?) on a wide screen and on a phone. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const createRule = vi.fn();
const runRule = vi.fn();
const habitDismiss = vi.fn();

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { createRule: (b: unknown) => createRule(b),
    runRule: (id: string) => runRule(id),
    habitDismiss: (k: string) => habitDismiss(k) },
}));

import { HabitSection } from "./components/HabitCards";
import { ToastProvider } from "./components/ui";
import { habitDate } from "./habits";
import { bank, chirp, deals, news } from "./habitsFixtures";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import type { Habit } from "./types";

// the rule cards' sentence is tested with the Rules page (HabitPlaces)
const sentence = (h: Habit) => <p data-testid="sentence">{h.rule.query}</p>;
const section = (habits: Habit[], over: Record<string, unknown> = {}) =>
  <HabitSection habits={habits} phone={false} renderSentence={sentence}
    onChanged={() => {}} {...over} />;
const wrap = (ui: React.ReactElement) =>
  render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setLang("en");
  createRule.mockResolvedValue({ id: "r1", name: "Trash Deals Daily" });
  runRule.mockResolvedValue({});
  habitDismiss.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  createRule.mockReset(); runRule.mockReset(); habitDismiss.mockReset();
  setLang("en");
});

/** Counts and their nouns are joined by a no-break space. */
const nb = (s: string | null | undefined) => (s ?? "").replace(/\u00a0/g, " ");

const card = (id: string) =>
  document.querySelector(`[data-habit="${id}"]`) as HTMLElement;

test("nothing to suggest: no card at all", () => {
  const { container } = wrap(section([]));
  expect(container.textContent).toBe("");
});

test("the card reads as the board: header with the count and Why these?, then "
  + "each suggestion with its evidence, the rule and what it would catch", () => {
  wrap(section([deals, news]));
  const head = screen.getByRole("heading");
  expect(nb(head.textContent)).toBe("You keep doing this · 2 rules suggested");
  expect(screen.getByText("from what you did by hand in the last 60 days · no AI"))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Why these?" })).toBeTruthy();
  const first = card("h-deals");
  expect(within(first).getByText(
    `You trashed Deals Daily 5 times since ${habitDate(deals.since)}`)).toBeTruthy();
  expect(within(first).getByText("every 3-5 days · 41 mails · all unread"))
    .toBeTruthy();
  expect(within(first).getByTestId("sentence").textContent)
    .toBe("from:deals@dealsdaily.example");
  expect(within(first).getByText(
    "Would catch 12 mails now · starts in Report only")).toBeTruthy();
  expect(within(card("h-news")).getByText("every week · 22 mails")).toBeTruthy();
  // the first suggestion is accent-outlined, the others are not
  expect(first.className).toContain("border-accent");
  expect(card("h-news").className).not.toContain("border-accent");
});

test("one suggestion: the header says 1 rule", () => {
  wrap(section([bank]));
  expect(nb(screen.getByRole("heading").textContent))
    .toBe("You keep doing this · 1 rule suggested");
  expect(within(card("h-bank")).getByText(
    `You moved PayBank to Finance 4 times since ${habitDate(bank.since)}`))
    .toBeTruthy();
});

test("no scan yet: the card says it starts in Report only, without a count", () => {
  wrap(section([{ ...deals, catch: null }]));
  expect(screen.getByText("Starts in Report only")).toBeTruthy();
  expect(screen.queryByText(/Would catch/)).toBeNull();
});

test("the suggestion Automate… brought here is outlined and focused", () => {
  wrap(section([deals, news], { focusId: "h-news" }));
  expect(card("h-news").className).toContain("border-accent");
  expect(document.activeElement).toBe(card("h-news"));
});

test("Make it a rule creates an ordinary rule (no mode sent: the server starts "
  + "in report), runs its report once and says so", async () => {
  const changed = vi.fn();
  wrap(section([deals], { onChanged: changed }));
  fireEvent.click(within(card("h-deals")).getByRole("button",
    { name: "Make it a rule" }));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("r1"));
  expect(createRule).toHaveBeenCalledTimes(1);
  expect(createRule).toHaveBeenCalledWith({
    name: "Trash Deals Daily", grouping: "sender",
    query: "from:deals@dealsdaily.example", action: "trash", dest: "",
    schedule: "daily", older_than_days: 3 });
  expect(createRule.mock.calls[0][0]).not.toHaveProperty("mode");
  expect(await screen.findByText(/Rule .Trash Deals Daily. created\. It starts in Report only/))
    .toBeTruthy();
  await waitFor(() => expect(changed).toHaveBeenCalled());
});

test("a move rule carries its folder; mark read has no age", async () => {
  wrap(section([bank, chirp]));
  fireEvent.click(within(card("h-bank")).getByRole("button",
    { name: "Make it a rule" }));
  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
  expect(createRule.mock.calls[0][0]).toMatchObject({
    name: "Move PayBank to Finance", action: "move", dest: "Finance",
    older_than_days: null, schedule: "weekly" });
});

test("a refused rule is shown on its card and nothing is run", async () => {
  createRule.mockRejectedValue(new Error("move needs a target folder"));
  wrap(section([deals]));
  fireEvent.click(screen.getByRole("button", { name: "Make it a rule" }));
  expect((await screen.findByRole("alert")).textContent)
    .toContain("move needs a target folder");
  expect(runRule).not.toHaveBeenCalled();
});

test("Not this one hides the sender for good and creates nothing", async () => {
  const changed = vi.fn();
  wrap(section([deals], { onChanged: changed }));
  fireEvent.click(screen.getByRole("button", { name: "Not this one" }));
  await waitFor(() => expect(habitDismiss).toHaveBeenCalledWith(
    "deals@dealsdaily.example"));
  expect(createRule).not.toHaveBeenCalled();
  expect(await screen.findByText(/Deals Daily won't be suggested again/))
    .toBeTruthy();
  await waitFor(() => expect(changed).toHaveBeenCalled());
});

test("Why these? lists every step with its date, and what never counts", () => {
  wrap(section([deals, news]));
  fireEvent.click(screen.getByRole("button", { name: "Why these?" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Same action, same sender, 3+ times on 3+ days"))
    .toBeTruthy();
  expect(within(dialog).getByText("Why “Deals Daily”?")).toBeTruthy();
  expect(within(dialog).getByText("Why “Northwind News”?")).toBeTruthy();
  const rows = within(dialog).getAllByTestId("habit-step")
    .map((li) => li.textContent?.replace(/ /g, " "));
  expect(rows).toHaveLength(deals.steps.length + news.steps.length);
  expect(rows).toContain(
    `${habitDate(deals.steps[0].ts)}Moved 9 mails to Trash`
    + "all unread");
  // the youngest mail of the last step was 3 days old: not all unread
  expect(rows).toContain(
    `${habitDate(deals.steps[4].ts)}Moved 9 mails to Trash`
    + "youngest 3 days old");
  expect(rows).toContain(`${habitDate(news.steps[1].ts)}Archived 6 mails`
    + "youngest 8 days old");
  expect(dialog.textContent).toContain(
    "Steps you undid, steps by rules or assistants, protected senders and "
    + "senders a rule already covers don't count.");
  expect(dialog.textContent).toContain("The age is the youngest mail you moved");
  fireEvent.keyDown(dialog, { key: "Escape" });
});

test("Why these? with one suggestion is that sender's own question", () => {
  wrap(section([bank]));
  fireEvent.click(screen.getByRole("button", { name: "Why these?" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByText("Why “PayBank”?").length).toBeGreaterThan(0);
  // a move names its folder; no age sentence when no suggestion has an age
  expect(nb(dialog.textContent)).toContain("Moved 4 mails to Finance");
  expect(dialog.textContent).not.toContain("youngest mail you moved");
});

test("German: du, every habit key is translated", () => {
  setLang("de");
  wrap(section([deals]));
  expect(nb(screen.getByRole("heading").textContent))
    .toBe("Das machst du immer wieder · 1 Regel vorgeschlagen");
  expect(screen.getByText(new RegExp(
    `^Du hast Deals Daily 5.Mal in den Papierkorb gelegt, seit ${habitDate(deals.since)}$`)))
    .toBeTruthy();
  expect(screen.getByText("alle 3-5 Tage · 41 Mails · alle ungelesen")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Als Regel anlegen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Nicht diesen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Warum diese?" })).toBeTruthy();
  expect(screen.getByText(/Würde jetzt 12.Mails erfassen · startet im Berichtsmodus/))
    .toBeTruthy();
  const keys = Object.keys(EN).filter((k) => k.startsWith("habit."));
  expect(keys.length).toBeGreaterThan(50);
  for (const k of keys) expect(DE[k], k).toBeTruthy();
});

// ------------------------------------------------------------------ phone

test("phone: one box, each suggestion in plain words with big buttons", async () => {
  const changed = vi.fn();
  wrap(section([deals, news], { phone: true, onChanged: changed }));
  const box = screen.getByTestId("habit-card");
  expect(within(box).getByRole("heading", { name: "You keep doing this" }))
    .toBeTruthy();
  // the board's phone card has no sentence of chips: a line of words
  expect(within(box).queryByTestId("sentence")).toBeNull();
  const first = card("h-deals");
  expect(within(first).getByText(
    `You trashed Deals Daily 5 times since ${habitDate(deals.since)}`)).toBeTruthy();
  expect(within(first).getByText("A rule: Trash its mail older than 3 days, "
    + "daily. Would catch 12 now · Report only first.")).toBeTruthy();
  expect(within(box).getAllByRole("button", { name: "Make it a rule" }))
    .toHaveLength(2);
  expect(within(box).getAllByRole("button", { name: "Not this one" }))
    .toHaveLength(2);
  for (const b of within(box).getAllByRole("button", { name: /Make it a rule|Not this one/ }))
    expect(b.className).toContain("coarse:min-h-11");
  fireEvent.click(within(first).getByRole("button", { name: "Make it a rule" }));
  await waitFor(() => expect(runRule).toHaveBeenCalled());
  expect(changed).toHaveBeenCalled();
});

test("phone: Not this one hides the sender; Why these? is there too", async () => {
  wrap(section([news], { phone: true }));
  fireEvent.click(screen.getByRole("button", { name: "Not this one" }));
  await waitFor(() => expect(habitDismiss).toHaveBeenCalledWith(
    "news@northwind.example"));
  fireEvent.click(screen.getByRole("button", { name: "Why these?" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("phone: the focused suggestion is outlined", () => {
  wrap(section([deals, news], { phone: true, focusId: "h-news" }));
  expect(card("h-news").className).toContain("ring-accent");
  expect(card("h-deals").className).not.toContain("ring-accent");
});

test("phone in German", () => {
  setLang("de");
  wrap(section([bank], { phone: true }));
  expect(screen.getByText("Eine Regel: Mails dieses Absenders nach Finance "
    + "verschieben, wöchentlich. Würde jetzt 3 erfassen · startet im Berichtsmodus."))
    .toBeTruthy();
});
