// @vitest-environment jsdom
/* "You keep doing this": the Rules section (cards, evidence, Make it a rule,
 * Not this one, Why these?) and the phone Overview widget. */

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

import { HabitSection, HabitWidget } from "./components/HabitCards";
import { ToastProvider } from "./components/ui";
import { habitDate } from "./habits";
import { bank, chirp, deals } from "./habitsFixtures";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";

const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const phone = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: true, media: q, addEventListener: () => {},
  removeEventListener: () => {} }));

beforeEach(() => {
  setLang("en");
  createRule.mockResolvedValue({ id: "r1", name: "Trash Deals Daily" });
  runRule.mockResolvedValue({});
  habitDismiss.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  createRule.mockReset(); runRule.mockReset(); habitDismiss.mockReset();
  setLang("en");
});

const card = (id: string) =>
  document.querySelector(`[data-habit="${id}"]`) as HTMLElement;

test("nothing to suggest: no section at all", () => {
  const { container } = wrap(<HabitSection habits={[]} account="proton"
    onChanged={() => {}} />);
  expect(container.textContent).toBe("");
});

test("the section and its cards read as the board: title, evidence, the rule "
  + "sentence, what it would catch", () => {
  wrap(<HabitSection habits={[deals, bank, chirp]} account="proton"
    onChanged={() => {}} />);
  expect(screen.getByRole("heading", { name: "You keep doing this" })).toBeTruthy();
  expect(screen.getByText(/Found in your Activity of the last 60.days on proton/))
    .toBeTruthy();
  const first = card("h-deals");
  expect(within(first).getByText(
    `You trashed Deals Daily 5 times since ${habitDate(deals.since)}`)).toBeTruthy();
  expect(within(first).getByText("Always unread · 14 to 22 mails each time"))
    .toBeTruthy();
  // "When Deals Daily then move to Trash if older than 7 days · weekly"
  expect(first.textContent).toContain("When Deals Daily then move to Trash");
  expect(within(first).getByText("if older than 7 days")).toBeTruthy();
  expect(within(first).getByText("weekly")).toBeTruthy();
  expect(within(first).getByText(
    "Would catch 19 mails now · starts in Report only")).toBeTruthy();
  // the first card is accent-outlined, the others are not
  expect(first.className).toContain("border-accent");
  expect(card("h-bank").className).not.toContain("border-accent");
  // a move names its folder, has no age, and counts the mails of every step
  const b = card("h-bank");
  expect(within(b).getByText(
    `You moved PayBank to Finance 4 times since ${habitDate(bank.since)}`)).toBeTruthy();
  expect(within(b).getByText("2 to 4 mails each time")).toBeTruthy();
  expect(b.textContent).toContain("then move to Finance");
  expect(b.textContent).not.toContain("older than");
  expect(within(card("h-chirp")).getByText("Always unread · 9 mails each time"))
    .toBeTruthy();
});

test("no scan yet: the card says it starts in Report only, without a count", () => {
  wrap(<HabitSection habits={[{ ...deals, catch: null }]} account="proton"
    onChanged={() => {}} />);
  expect(screen.getByText("Starts in Report only")).toBeTruthy();
  expect(screen.queryByText(/Would catch/)).toBeNull();
});

test("Make it a rule creates an ordinary rule (no mode sent: the server starts "
  + "in report), runs its report once and says so", async () => {
  const changed = vi.fn();
  wrap(<HabitSection habits={[deals]} account="proton" onChanged={changed} />);
  fireEvent.click(within(card("h-deals")).getByRole("button",
    { name: "Make it a rule" }));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("r1"));
  expect(createRule).toHaveBeenCalledTimes(1);
  expect(createRule).toHaveBeenCalledWith({
    name: "Trash Deals Daily", grouping: "sender",
    query: "from:deals@dealsdaily.example", action: "trash", dest: "",
    schedule: "weekly", older_than_days: 7 });
  expect(createRule.mock.calls[0][0]).not.toHaveProperty("mode");
  expect(await screen.findByText(/Rule .Trash Deals Daily. created\. It starts in Report only/))
    .toBeTruthy();
  await waitFor(() => expect(changed).toHaveBeenCalled());
});

test("a move rule carries its folder; mark read has no age", async () => {
  wrap(<HabitSection habits={[bank, chirp]} account="proton"
    onChanged={() => {}} />);
  fireEvent.click(within(card("h-bank")).getByRole("button",
    { name: "Make it a rule" }));
  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
  expect(createRule.mock.calls[0][0]).toMatchObject({
    name: "Move PayBank to Finance", action: "move", dest: "Finance",
    older_than_days: null, schedule: "daily" });
});

test("a refused rule is shown on its card and nothing is run", async () => {
  createRule.mockRejectedValue(new Error("move needs a target folder"));
  wrap(<HabitSection habits={[deals]} account="proton" onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Make it a rule" }));
  expect((await screen.findByRole("alert")).textContent)
    .toContain("move needs a target folder");
  expect(runRule).not.toHaveBeenCalled();
});

test("Not this one hides the sender for good", async () => {
  const changed = vi.fn();
  wrap(<HabitSection habits={[deals]} account="proton" onChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Not this one" }));
  await waitFor(() => expect(habitDismiss).toHaveBeenCalledWith(
    "deals@dealsdaily.example"));
  expect(createRule).not.toHaveBeenCalled();
  expect(await screen.findByText(/Deals Daily won't be suggested again/))
    .toBeTruthy();
  await waitFor(() => expect(changed).toHaveBeenCalled());
});

test("Why these? lists the steps of each suggestion and what never counts", () => {
  wrap(<HabitSection habits={[deals, bank]} account="proton"
    onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Why these?" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Why “Deals Daily”?")).toBeTruthy();
  expect(within(dialog).getByText("Why “PayBank”?")).toBeTruthy();
  const rows = within(dialog).getAllByRole("listitem").map((li) => li.textContent);
  expect(rows).toContain(`${habitDate(deals.steps[0].ts)} · Moved 14 to Trash · all unread`);
  expect(rows).toContain(`${habitDate(deals.steps[4].ts)} · Moved 22 to Trash · all unread`);
  // PayBank's steps were not all unread: no "all unread"
  expect(rows).toContain(`${habitDate(bank.steps[1].ts)} · Moved 4 to Finance`);
  expect(dialog.textContent).toContain("Steps you undid don't count.");
  expect(dialog.textContent).toContain("The age is the youngest mail you moved");
  fireEvent.keyDown(dialog, { key: "Escape" });
});

test("the age note is left out when no suggestion has an age", () => {
  wrap(<HabitSection habits={[bank]} account="proton" onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Why these?" }));
  expect(screen.getByRole("dialog").textContent)
    .not.toContain("youngest mail you moved");
});

test("German: du, the sentence reads in German, every habit key is translated", () => {
  setLang("de");
  wrap(<HabitSection habits={[deals]} account="proton" onChanged={() => {}} />);
  expect(screen.getByRole("heading", { name: "Das machst du immer wieder" }))
    .toBeTruthy();
  expect(screen.getByText(new RegExp(
    `^Du hast Deals Daily 5.Mal in den Papierkorb gelegt, seit ${habitDate(deals.since)}$`)))
    .toBeTruthy();
  expect(screen.getByText("Immer ungelesen · 14 bis 22 Mails pro Mal")).toBeTruthy();
  expect(screen.getByText(/^wenn älter als 7\sTage$/)).toBeTruthy();
  expect(screen.getByText("wöchentlich")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Als Regel anlegen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Nicht diesen" })).toBeTruthy();
  expect(screen.getByText(/Würde jetzt 19.Mails erfassen · startet im Berichtsmodus/))
    .toBeTruthy();
  const keys = Object.keys(EN).filter((k) => k.startsWith("habit."));
  expect(keys.length).toBeGreaterThan(30);
  for (const k of keys) expect(DE[k], k).toBeTruthy();
});

// ----------------------------------------------------------- phone widget

test("desktop: no widget (Next steps carries a line instead)", () => {
  const { container } = wrap(<HabitWidget habits={[deals, bank]}
    onOpen={() => {}} onChanged={() => {}} />);
  expect(container.textContent).toBe("");
});

test("phone: the first suggestion with both buttons, the others as rows that "
  + "open Rules at their card", async () => {
  phone();
  const open = vi.fn();
  const changed = vi.fn();
  wrap(<HabitWidget habits={[deals, bank, chirp]} onOpen={open}
    onChanged={changed} />);
  const w = screen.getByRole("region", { name: "You keep doing this" });
  expect(within(w).getByText("3")).toBeTruthy();
  expect(within(w).getByText(
    `You trashed Deals Daily 5 times since ${habitDate(deals.since)}`)).toBeTruthy();
  expect(within(w).getAllByText("Always unread").length).toBeGreaterThan(0);
  // only the first one has the buttons
  expect(within(w).getAllByRole("button", { name: "Make it a rule" })).toHaveLength(1);
  expect(within(w).getAllByRole("button", { name: "Not this one" })).toHaveLength(1);
  fireEvent.click(within(w).getByRole("button", { name: new RegExp(
    `^You moved PayBank to Finance 4 times`) }));
  expect(open).toHaveBeenCalledWith("h-bank");
  fireEvent.click(within(w).getByRole("button", { name: "Make it a rule" }));
  await waitFor(() => expect(runRule).toHaveBeenCalled());
  expect(changed).toHaveBeenCalled();
});

test("phone: Not this one on the widget hides the sender", async () => {
  phone();
  wrap(<HabitWidget habits={[deals]} onOpen={() => {}} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Not this one" }));
  await waitFor(() => expect(habitDismiss).toHaveBeenCalledWith(
    "deals@dealsdaily.example"));
});

test("phone: touch targets of the buttons are 44 px on a coarse pointer", () => {
  phone();
  wrap(<HabitWidget habits={[deals]} onOpen={() => {}} onChanged={() => {}} />);
  for (const name of ["Make it a rule", "Not this one"])
    expect(screen.getByRole("button", { name }).className).toContain("coarse:min-h-11");
});
