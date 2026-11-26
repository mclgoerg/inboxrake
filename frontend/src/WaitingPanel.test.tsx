// @vitest-environment jsdom
/* Insights > Waiting for a reply: the page (figures, segmented list, pane),
 * the phone layout with its swipes, Remind me, No answer needed, Read
 * conversation, Open sender, the empty / off / failure states and German. */

import { act, cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const waiting = vi.fn();
const item = vi.fn();
const needed = vi.fn();
const remind = vi.fn();
const thread = vi.fn();
vi.mock("./api", () => ({
  api: {
    waiting: () => waiting(),
    waitingItem: (...a: unknown[]) => item(...a),
    waitingNeeded: (...a: unknown[]) => needed(...a),
    waitingRemind: (...a: unknown[]) => remind(...a),
    thread: (...a: unknown[]) => thread(...a),
    messages: () => Promise.resolve({ messages: [] }),
  },
  fmtSize: (b: number) => `${b} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import { WaitingPanel } from "./components/WaitingPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { clockShiftFor } from "./subscriptionsTestUtils";
import { setLang } from "./i18n";
import { inAWeek9, nextMonday9, tomorrow9 } from "./waiting";
import { clara, detailOf, landlord, NOW, opa, resp, skipped, tax, tobi }
  from "./waitingFixtures";

/** matchMedia for one viewport width; `coarse` = a touch screen. */
const viewport = (width: number, coarse = false) =>
  vi.stubGlobal("matchMedia", (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = q.includes("pointer: coarse") ? coarse
      : (!min || width >= +min[1]) && (!max || width <= +max[1])
        && !q.includes("pointer") && !q.includes("reduced");
    return { matches, media: q, addEventListener: () => {},
      removeEventListener: () => {} };
  });

const onChanged = vi.fn();
const onNotifications = vi.fn();
const onSettings = vi.fn();
const onClose = vi.fn();
const onOpenSender = vi.fn();
const show = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <WaitingPanel account="proton" onClose={onClose} onChanged={onChanged}
      hasSender={() => true} onOpenSender={onOpenSender}
      onNotifications={onNotifications} onSettings={onSettings} {...props} />
  </DialogProvider></ToastProvider>);

let restoreClock = () => {};
beforeEach(() => {
  setLang("en");
  restoreClock = clockShiftFor(NOW);
  viewport(1440);
  waiting.mockResolvedValue(resp());
  item.mockResolvedValue(detailOf());
  needed.mockResolvedValue({ ok: true });
  remind.mockResolvedValue({ ok: true });
  thread.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  restoreClock();
  vi.unstubAllGlobals();
  for (const f of [waiting, item, needed, remind, thread, onChanged,
    onNotifications, onSettings, onClose, onOpenSender]) f.mockReset();
  localStorage.clear();
  setLang("en");
});

const rows = () => screen.getAllByTestId("waiting-row");
const pane = () => screen.getByTestId("waiting-pane");

/* --------------------------------- desktop -------------------------------- */

test("desktop: the three tiles, the counts, the rows of the board", async () => {
  show();
  expect(await screen.findByText("overdue - longer than they usually take"))
    .toBeTruthy();
  expect(screen.getByText("open - you wrote last, no answer yet")).toBeTruthy();
  expect(screen.getByText("your contacts usually answer within")).toBeTruthy();
  expect(screen.getByText(/^1\.5\sdays$/)).toBeTruthy();
  expect(screen.getByText("Mail you sent where the last word is yours · proton"))
    .toBeTruthy();
  for (const name of [/^Open · 5$/, /^Answered · 41$/, /^No answer needed · 7$/])
    expect(screen.getByRole("tab", { name })).toBeTruthy();
  expect(screen.getByText("Most overdue first")).toBeTruthy();
  expect(rows()).toHaveLength(5);
  const first = rows()[0];
  expect(within(first).getByText("steuerberater@kanzlei-brandt.example")).toBeTruthy();
  expect(within(first).getByText("Documents for the 2025 tax return")).toBeTruthy();
  expect(within(first).getByText(/^you wrote 15 Nov$/)).toBeTruthy();
  // overdue: the orange pill with the days and their usual time
  expect(within(first).getByText(/^9\sdays · usually 3$/)).toBeTruthy();
  expect(within(rows()[1]).getByText("Clara Neumann")).toBeTruthy();
  expect(within(rows()[1]).getByText(/^6\sdays · usually 1$/)).toBeTruthy();
  // young: a plain pill
  expect(within(rows()[3]).getByText(/^2\sdays · usually 2$/)).toBeTruthy();
  expect(within(rows()[4]).getByText(/^1\sday · usually 4$/)).toBeTruthy();
  expect(screen.getByText(
    /Counted: mail you sent to a person \(not a list or a no-reply address\) in the last 90 days where nothing newer came back from them\. Matched by the mail headers - no mail text is read\./))
    .toBeTruthy();
});

test("desktop: the third tile has no figure before there are two answers", async () => {
  waiting.mockResolvedValue(resp({ kpis: { overdue: 3, open: 5, typical_days: null } }));
  show();
  const tile = (await screen.findByText("your contacts usually answer within"))
    .parentElement!;
  expect(tile.textContent).toBe("—your contacts usually answer within");
});

test("desktop: overdue rows read orange with the hourglass, young ones plain", async () => {
  show();
  await screen.findAllByTestId("waiting-row");
  const orange = within(rows()[0]).getByText(/^9\sdays · usually 3$/);
  expect(orange.closest("span.rounded-full")?.className).toContain("text-review-fg");
  const plain = within(rows()[3]).getByText(/^2\sdays · usually 2$/);
  expect(plain.closest("span.rounded-badge")?.className).not.toContain("text-review-fg");
  expect(plain.closest("span.rounded-full")).toBeNull();
  expect(tobi.overdue).toBe(false);
  expect(opa.overdue).toBe(false);
  expect(clara.overdue && landlord.overdue && tax.overdue).toBe(true);
});

test("desktop: a set reminder shows in the row with its bell, instead of 'you wrote'", async () => {
  const at = tomorrow9(new Date(NOW * 1000));
  waiting.mockResolvedValue(resp({ items: [
    { ...tax, reminder: { at, fired: 0 } }, clara, landlord, tobi, opa] }));
  show();
  await screen.findAllByTestId("waiting-row");
  expect(within(rows()[0]).getByText("Wed 09:00")).toBeTruthy();
  expect(within(rows()[0]).queryByText(/you wrote/)).toBeNull();
  expect(within(rows()[1]).getByText(/^you wrote 18 Nov$/)).toBeTruthy();
});

test("desktop: the pane of the first row tells the conversation", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  expect(await within(p).findByRole("heading",
    { name: "Documents for the 2025 tax return" })).toBeTruthy();
  expect(within(p).getByText("steuerberater@kanzlei-brandt.example")).toBeTruthy();
  expect(within(p).getByText("No answer for 9 days.")).toBeTruthy();
  expect(within(p).getByText(
    /They usually answer you within 3 days \(2 earlier conversations\)\./))
    .toBeTruthy();
  expect(within(p).getByText("The conversation")).toBeTruthy();
  expect(await within(p).findByText(/You: “Questions about 2024”/)).toBeTruthy();
  expect(within(p).getByText("answered after 3 days")).toBeTruthy();
  expect(within(p).getByText(/They: “Re: Questions about 2024”/)).toBeTruthy();
  expect(within(p).getByText(/You: “Documents for the 2025 tax return”/)).toBeTruthy();
  expect(within(p).getByText("last word is yours · to 1 person")).toBeTruthy();
  expect(within(p).getByText(/^· no answer for 9 days$/)).toBeTruthy();
  expect(within(p).getByText("usually 3 days (2 earlier conversations)")).toBeTruthy();
  expect(within(p).getByText("2 newsletters from them since - they are no answer"))
    .toBeTruthy();
  expect(within(p).getByText("Remind me")).toBeTruthy();
  for (const label of [/^Tomorrow 09:00$/, "Monday", "In a week", /^Pick a date/])
    expect(within(p).getByRole("radio", { name: label })).toBeTruthy();
  expect(within(p).getByText(
    "A push to your devices with notifications on (and a line in the digest, if it's on). Cleared by itself when they answer."))
    .toBeTruthy();
  expect(within(p).getByRole("button", { name: "Read conversation" })).toBeTruthy();
  expect(within(p).getByRole("button", { name: "No answer needed" })).toBeTruthy();
  expect(within(p).getByRole("button", { name: "Open sender" })).toBeTruthy();
  expect(within(p).getByText(
    "Inboxrake never sends mail for you - you reply from your own mail app."))
    .toBeTruthy();
  expect(item).toHaveBeenCalledWith(tax.id);
});

test("a young mail is no orange notice and says when it counts", async () => {
  waiting.mockResolvedValue(resp({ items: [
    { ...tobi, usual_days: null, usual_n: 0 }] , counts: { open: 1, answered: 0, needed: 0 } }));
  show();
  const p = await screen.findByTestId("waiting-pane");
  expect(await within(p).findByText("No answer for 2 days.")).toBeTruthy();
  expect(within(p).getByText("Mails count as overdue after 2 days.")).toBeTruthy();
});

test("another row opens its own pane", async () => {
  show();
  await screen.findByTestId("waiting-pane");
  fireEvent.click(within(rows()[1]).getByRole("button"));
  expect(await within(pane()).findByRole("heading",
    { name: "Coffee next week?" })).toBeTruthy();
  expect(item).toHaveBeenLastCalledWith(clara.id);
});

test("the pane's close puts the list full width, a row brings it back", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  fireEvent.click(within(p).getByRole("button", { name: "Close" }));
  expect(screen.queryByTestId("waiting-pane")).toBeNull();
  expect(rows()).toHaveLength(5);
  fireEvent.click(within(rows()[2]).getByRole("button"));
  expect(await within(pane()).findByRole("heading",
    { name: "Question about the service charges" })).toBeTruthy();
});

/* ------------------------------- Remind me ------------------------------- */

test("Remind me: Tomorrow, Monday and in a week, 09:00 each", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  const now = new Date(NOW * 1000);
  fireEvent.click(within(p).getByRole("radio", { name: /^Tomorrow 09:00$/ }));
  await waitFor(() => expect(remind).toHaveBeenCalledWith(tax.id,
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9)
      .getTime() / 1000));
  expect(remind.mock.calls[0][1]).toBe(tomorrow9(now));
  fireEvent.click(within(p).getByRole("radio", { name: "Monday" }));
  await waitFor(() => expect(remind).toHaveBeenCalledTimes(2));
  expect(remind.mock.calls[1]).toEqual([tax.id, nextMonday9(now)]);
  expect(new Date(nextMonday9(now) * 1000).getDay()).toBe(1);
  fireEvent.click(within(p).getByRole("radio", { name: "In a week" }));
  await waitFor(() => expect(remind).toHaveBeenCalledTimes(3));
  expect(remind.mock.calls[2]).toEqual([tax.id, inAWeek9(now)]);
  expect(onChanged).toHaveBeenCalled();
});

test("Remind me: a day of your own", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  fireEvent.click(within(p).getByRole("radio", { name: /^Pick a date/ }));
  const input = within(p).getByLabelText("Remind me on") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "2026-12-05" } });
  await waitFor(() => expect(remind).toHaveBeenCalledWith(tax.id,
    new Date(2026, 11, 5, 9).getTime() / 1000));
});

test("a set reminder shows as the chosen time and can be cancelled", async () => {
  const at = tomorrow9(new Date(NOW * 1000));
  waiting.mockResolvedValue(resp({ items: [
    { ...tax, reminder: { at, fired: 0 } }, clara, landlord, tobi, opa] }));
  show();
  const p = await screen.findByTestId("waiting-pane");
  expect(within(p).getByRole("radio", { name: /^Tomorrow 09:00$/, checked: true }))
    .toBeTruthy();
  expect(within(p).getByText(/Reminder set for Wed 09:00/)).toBeTruthy();
  fireEvent.click(within(p).getByRole("button", { name: "Cancel reminder" }));
  await waitFor(() => expect(remind).toHaveBeenCalledWith(tax.id, null));
});

test("a reminder with notifications off says so and links to Settings", async () => {
  const at = tomorrow9(new Date(NOW * 1000));
  waiting.mockResolvedValue(resp({ items: [
    { ...tax, reminder: { at, fired: 0 } }, clara] }));
  show();
  const p = await screen.findByTestId("waiting-pane");
  expect(within(p).getByText(/Notifications are off on this device\./))
    .toBeTruthy();
  fireEvent.click(within(p).getByRole("button", { name: "Turn them on" }));
  expect(onNotifications).toHaveBeenCalled();
});

/* ---------------------------- No answer needed ---------------------------- */

test("No answer needed takes it off the list, with an Undo", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  fireEvent.click(within(p).getByRole("button", { name: "No answer needed" }));
  await waitFor(() => expect(needed).toHaveBeenCalledWith(tax.id, true));
  expect(await screen.findByText("steuerberater@…: no answer needed.")).toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(needed).toHaveBeenLastCalledWith(tax.id, false));
});

test("the other tabs: answered rows say how long they took, not needed ones come back",
  async () => {
    show();
    await screen.findByTestId("waiting-pane");
    fireEvent.click(screen.getByRole("tab", { name: /^Answered/ }));
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText("answered in 2 days")).toBeTruthy();
    expect(screen.getByText("Newest first")).toBeTruthy();
    const p = pane();
    expect(await within(p).findByText("They answered after 2 days.")).toBeTruthy();
    // an answered mail has no reminder and nothing to skip
    expect(within(p).queryByText("Remind me")).toBeNull();
    expect(within(p).queryByRole("button", { name: "No answer needed" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^No answer needed/ }));
    expect(rows()).toHaveLength(1);
    const q = pane();
    expect(await within(q).findByText("Marked as not needing an answer."))
      .toBeTruthy();
    fireEvent.click(within(q).getByRole("button", { name: "Bring it back" }));
    await waitFor(() => expect(needed).toHaveBeenCalledWith(skipped.id, false));
    expect(await screen.findByText("Back on the list.")).toBeTruthy();
  });

/* ----------------------- Read conversation / Open sender ------------------ */

test("Read conversation opens the conversation view from your sent mail", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  await within(p).findByText(/2 newsletters from them since/);
  fireEvent.click(within(p).getByRole("button", { name: "Read conversation" }));
  await waitFor(() => expect(thread).toHaveBeenCalledWith("Sent", 11));
  expect(screen.queryByTestId("waiting-pane")).toBeNull();
});

test("Open sender opens the sender page of the person", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  fireEvent.click(within(p).getByRole("button", { name: "Open sender" }));
  expect(onOpenSender).toHaveBeenCalledWith("steuerberater@kanzlei-brandt.example");
});

test("Open sender is off, with the reason, for somebody who never wrote to you", async () => {
  show({ hasSender: () => false });
  const p = await screen.findByTestId("waiting-pane");
  const btn = within(p).getByRole("button", { name: "Open sender" });
  expect(btn.hasAttribute("disabled")).toBe(true);
  expect(within(p).getByText(/No mail from them in this mailbox/)).toBeTruthy();
});

test("opened from a sender pane: that mail is selected, on its tab", async () => {
  show({ focusId: clara.id });
  expect(await within(await screen.findByTestId("waiting-pane")).findByRole(
    "heading", { name: "Coffee next week?" })).toBeTruthy();
  cleanup();
  show({ focusId: skipped.id });
  expect(await within(await screen.findByTestId("waiting-pane")).findByRole(
    "heading", { name: "FYI: new address" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /^No answer needed/, selected: true }))
    .toBeTruthy();
});

/* --------------------------------- states -------------------------------- */

test("states: loading, failure with retry, not watching, no scan, nothing open",
  async () => {
    waiting.mockReturnValue(new Promise(() => {}));
    show();
    expect(await screen.findByRole("status")).toBeTruthy();
    cleanup();
    waiting.mockRejectedValueOnce(new Error("down")).mockResolvedValue(resp());
    show();
    expect(await screen.findByText("Couldn't load the list.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Clara Neumann")).toBeTruthy();
    cleanup();
    waiting.mockResolvedValue(resp({ watching: false, items: [] }));
    show();
    expect(await screen.findByText("Not watching this account's sent mail"))
      .toBeTruthy();
    expect(screen.getByText(/The first scan after that reads the headers of the last 90 days of your Sent folder - no mail text\./))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onSettings).toHaveBeenCalled();
    cleanup();
    waiting.mockResolvedValue(resp({ scanned: false, items: [] }));
    show();
    expect(await screen.findByText(/Scan your mailbox first/)).toBeTruthy();
    cleanup();
    waiting.mockResolvedValue(resp({ items: [], counts:
      { open: 0, answered: 0, needed: 0 } }));
    show();
    expect(await screen.findByText("Nobody is keeping you waiting")).toBeTruthy();
    expect(screen.getByText("A mail you sent shows up here once nobody has answered it."))
      .toBeTruthy();
  });

test("an action that fails shows the error and keeps the page", async () => {
  needed.mockRejectedValue(new Error("no luck"));
  show();
  const p = await screen.findByTestId("waiting-pane");
  fireEvent.click(within(p).getByRole("button", { name: "No answer needed" }));
  expect(await screen.findByText(/no luck/)).toBeTruthy();
  expect(rows()).toHaveLength(5);
});

test("a laptop width keeps the list and opens the pane as a dialog", async () => {
  viewport(1100);
  show();
  await screen.findByText("Clara Neumann");
  expect(screen.queryByTestId("waiting-pane")).toBeNull();
  fireEvent.click(within(rows()[0]).getByRole("button"));
  const dialog = await screen.findByRole("dialog",
    { name: "steuerberater@kanzlei-brandt.example" });
  expect(within(dialog).getByRole("button", { name: "No answer needed" }))
    .toBeTruthy();
});

/* -------------------------------- the phone ------------------------------ */

test("phone: a row per mail with the days, no tiles, the swipe hint", async () => {
  viewport(390);
  show();
  expect(await screen.findByText("3 overdue · 5 open")).toBeTruthy();
  expect(screen.queryByText("overdue - longer than they usually take")).toBeNull();
  expect(rows()).toHaveLength(5);
  const first = rows()[0];
  expect(within(first).getByText("steuerberater@kanzlei-brandt.example")).toBeTruthy();
  expect(within(first).getByText("9d")).toBeTruthy();
  expect(within(first).getByText("usu. 3d")).toBeTruthy();
  expect(within(first).getByText("Documents for the 2025 tax return")).toBeTruthy();
  // an overdue one reads orange, a young one muted
  expect(within(first).getByText("9d").className).toContain("text-review-fg");
  expect(within(rows()[4]).getByText("1d").className).not.toContain("text-review-fg");
  expect(screen.getByText("Swipe left: No answer needed · swipe right: Remind me"))
    .toBeTruthy();
});

test("phone: tapping a row opens the pane as a dialog with the buttons", async () => {
  viewport(390);
  show();
  await screen.findByText("Clara Neumann");
  fireEvent.click(within(rows()[1]).getByRole("button"));
  const dialog = await screen.findByRole("dialog", { name: "Clara Neumann" });
  expect(within(dialog).getByRole("button", { name: "No answer needed" }))
    .toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Open sender" })).toBeTruthy();
  expect(within(dialog).getByRole("radio", { name: /^Tomorrow 09:00$/ })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "No answer needed" }));
  await waitFor(() => expect(needed).toHaveBeenCalledWith(clara.id, true));
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Clara Neumann" })).toBeNull());
});

function fire(target: Element | Window, name: string, x: number, t: number) {
  const ev = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: 0 },
    pointerId: { value: 1 }, isPrimary: { value: true },
    pointerType: { value: "touch" }, timeStamp: { value: t } });
  act(() => { target.dispatchEvent(ev); });
}
const swipe = (el: Element, xs: number[]) => {
  fire(el, "pointerdown", xs[0], 0);
  xs.slice(1).forEach((x, i) => fire(window, "pointermove", x, (i + 1) * 100));
  fire(window, "pointerup", xs[xs.length - 1], xs.length * 100);
};
const body = (name: string) => screen.getByText(name)
  .closest<HTMLElement>("[data-swipe-body]")!;

test("phone: swipe left is No answer needed", async () => {
  viewport(390, true);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
  show();
  await screen.findByText("Clara Neumann");
  swipe(body("Clara Neumann"), [300, 200, 100]);
  const under = within(body("Clara Neumann").parentElement!.firstElementChild as HTMLElement);
  fireEvent.click(await under.findByRole("button", { name: "No answer needed" }));
  await waitFor(() => expect(needed).toHaveBeenCalledWith(clara.id, true));
  vi.restoreAllMocks();
});

test("phone: swipe right is Remind me (tomorrow, 09:00)", async () => {
  viewport(390, true);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
  show();
  await screen.findByText("Clara Neumann");
  swipe(body("Clara Neumann"), [100, 200, 300]);
  const lead = within(body("Clara Neumann").parentElement!.firstElementChild as HTMLElement);
  fireEvent.click(await lead.findByRole("button", { name: "Remind me" }));
  await waitFor(() => expect(remind).toHaveBeenCalledWith(clara.id,
    tomorrow9(new Date(NOW * 1000))));
  vi.restoreAllMocks();
});

test("phone: rows of the other tabs have no swipe actions", async () => {
  viewport(390, true);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
  show();
  await screen.findByText("Clara Neumann");
  fireEvent.click(screen.getByRole("tab", { name: /^Answered/ }));
  swipe(body("Kim Roe"), [300, 200, 100]);
  expect(screen.queryByRole("button", { name: "No answer needed" })).toBeNull();
  swipe(body("Kim Roe"), [100, 200, 300]);
  expect(screen.queryByRole("button", { name: "Remind me" })).toBeNull();
  vi.restoreAllMocks();
});

/* --------------------------------- German -------------------------------- */

test("German: the page speaks German (du)", async () => {
  setLang("de");
  show();
  expect(await screen.findByText("überfällig - länger, als sie sonst brauchen"))
    .toBeTruthy();
  expect(screen.getByText(/^1,5\sTage$/)).toBeTruthy();
  expect(screen.getByRole("tab", { name: /^Offen · 5$/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /^Beantwortet · 41$/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /^Keine Antwort nötig · 7$/ })).toBeTruthy();
  expect(screen.getByText("Am längsten überfällig zuerst")).toBeTruthy();
  expect(within(rows()[0]).getByText(/^9\sTage · meist 3$/)).toBeTruthy();
  expect(within(rows()[0]).getByText(/^du hast am 15\. Nov\.? geschrieben$/)).toBeTruthy();
  const p = pane();
  expect(await within(p).findByText(/^Seit 9\sTagen keine Antwort\.$/))
    .toBeTruthy();
  expect(within(p).getByText(
    /Die Person antwortet dir sonst innerhalb von 3\sTagen \(2 frühere Unterhaltungen\)/))
    .toBeTruthy();
  expect(within(p).getByRole("button", { name: "Unterhaltung lesen" })).toBeTruthy();
  expect(within(p).getByRole("button", { name: "Keine Antwort nötig" })).toBeTruthy();
  expect(within(p).getByRole("button", { name: "Absender öffnen" })).toBeTruthy();
  expect(within(p).getByRole("radio", { name: /^Morgen 09:00$/ })).toBeTruthy();
  expect(within(p).getByRole("radio", { name: "Montag" })).toBeTruthy();
  expect(within(p).getByRole("radio", { name: "In einer Woche" })).toBeTruthy();
  expect(within(p).getByText(/Inboxrake sendet nie Mails in deinem Namen/)).toBeTruthy();
  expect(within(p).getByText(/Aktivitätsbericht, wenn er an ist/)).toBeTruthy();
  expect(await within(p).findByText(/Gegenüber: „Re: Questions about 2024“/))
    .toBeTruthy();
});
