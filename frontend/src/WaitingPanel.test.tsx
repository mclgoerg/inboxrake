// @vitest-environment jsdom
/* Insights > Waiting for a reply: the page (figures, segmented list, pane),
 * the phone layout with its swipes, Remind me, No answer needed, opening the
 * conversation, the empty / off / failure states and German. */

import { act, cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const waiting = vi.fn();
const item = vi.fn();
const needed = vi.fn();
const remind = vi.fn();
const thread = vi.fn();
const message = vi.fn();
vi.mock("./api", () => ({
  api: {
    waiting: () => waiting(),
    waitingItem: (...a: unknown[]) => item(...a),
    waitingNeeded: (...a: unknown[]) => needed(...a),
    waitingRemind: (...a: unknown[]) => remind(...a),
    thread: (...a: unknown[]) => thread(...a),
    message: (...a: unknown[]) => message(...a),
    messages: () => Promise.resolve({ messages: [] }),
  },
  fmtSize: (b: number) => `${b} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import { WaitingPanel } from "./components/WaitingPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { clockShiftFor } from "./subscriptionsTestUtils";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { nextMonday9, tomorrow9 } from "./waiting";
import { alex, answered, bank, detailOf, library, NOW, resp, sam, skipped,
  travelly } from "./waitingFixtures";

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
const show = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <WaitingPanel account="main" onClose={onClose} onChanged={onChanged}
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
  message.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  restoreClock();
  vi.unstubAllGlobals();
  for (const f of [waiting, item, needed, remind, thread, message, onChanged,
    onNotifications, onSettings, onClose]) f.mockReset();
  localStorage.clear();
  setLang("en");
});

const rows = () => screen.getAllByTestId("waiting-row");
const pane = () => screen.getByTestId("waiting-pane");

/* --------------------------------- desktop -------------------------------- */

test("desktop: the three figures, the counts, the rows of the board", async () => {
  show();
  expect(await screen.findByText("waiting longer than usual")).toBeTruthy();
  expect(screen.getByText("sent in the last 3 days")).toBeTruthy();
  expect(screen.getByText("of your mails got an answer · 30 days")).toBeTruthy();
  expect(screen.getByText("94%")).toBeTruthy();
  for (const name of [/^Open · 5$/, /^Answered · 41$/, /^Not needed · 7$/])
    expect(screen.getByRole("tab", { name })).toBeTruthy();
  expect(screen.getByText("Sorted by how overdue")).toBeTruthy();
  expect(rows()).toHaveLength(5);
  const first = rows()[0];
  expect(within(first).getByText("Travelly")).toBeTruthy();
  expect(within(first).getByText("help@travelly.example")).toBeTruthy();
  expect(within(first).getByText("Re: Change of booking 88213")).toBeTruthy();
  expect(within(first).getByText("12 Nov")).toBeTruthy();
  expect(within(first).getByText("you wrote")).toBeTruthy();
  // overdue: the pill with the days; young: a plain pill
  expect(within(first).getByText(/^12\sdays$/)).toBeTruthy();
  expect(within(rows()[4]).getByText(/^1\sday$/)).toBeTruthy();
  expect(screen.getByText(/Counted: mails to a person \(not to a list or a no-reply address\)/))
    .toBeTruthy();
});

test("desktop: the pane of the first row tells the conversation", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  expect(await within(p).findByRole("heading",
    { name: "Re: Change of booking 88213" })).toBeTruthy();
  expect(within(p).getByText("Travelly · help@travelly.example")).toBeTruthy();
  expect(within(p).getByText("No answer for 12 days.")).toBeTruthy();
  expect(within(p).getByText(
    /Travelly usually answers you within 2 days \(4 earlier conversations\)\./))
    .toBeTruthy();
  expect(await within(p).findByText(
    /Your booking 88213 is confirmed/)).toBeTruthy();
  expect(within(p).getByText(/You: “Change of booking 88213”/)).toBeTruthy();
  expect(within(p).getByText(/answered 10 Nov/)).toBeTruthy();
  expect(within(p).getByText("Last word is yours · sent to 1 person, not a list"))
    .toBeTruthy();
  expect(within(p).getByText(/still no answer/)).toBeTruthy();
  expect(within(p).getByText(/2 newsletters from Travelly since/)).toBeTruthy();
  expect(within(p).getByText("Remind me")).toBeTruthy();
  for (const label of ["Tomorrow", "Pick…"])
    expect(within(p).getByRole("radio", { name: label })).toBeTruthy();
  expect(within(p).getByRole("radio", { name: "Mon 09:00" })).toBeTruthy();
  expect(within(p).getByText(
    "A push notification, or a line in the digest. Cleared by itself when they answer."))
    .toBeTruthy();
  expect(within(p).getByRole("button", { name: "Open the conversation" }))
    .toBeTruthy();
  expect(within(p).getByRole("button", { name: "No answer needed" }))
    .toBeTruthy();
  expect(within(p).getByText(/Inboxrake never sends mail for you/)).toBeTruthy();
  expect(item).toHaveBeenCalledWith(travelly.id);
});

test("a young mail is no orange notice and says when it counts", async () => {
  show();
  await screen.findByTestId("waiting-pane");
  fireEvent.click(within(rows()[3]).getByRole("button"));
  const p = pane();
  expect(await within(p).findByText("No answer for 2 days.")).toBeTruthy();
  expect(within(p).getByText("Mails count as waiting after 3 days.")).toBeTruthy();
});

test("another row opens its own pane", async () => {
  show();
  await screen.findByTestId("waiting-pane");
  fireEvent.click(within(rows()[1]).getByRole("button"));
  expect(await within(pane()).findByRole("heading",
    { name: "Saturday dinner - are you in?" })).toBeTruthy();
  expect(item).toHaveBeenLastCalledWith(alex.id);
});

/* ------------------------------- Remind me ------------------------------- */

test("Remind me: Tomorrow and next Monday, 09:00 each", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  const now = new Date(NOW * 1000);
  fireEvent.click(within(p).getByRole("radio", { name: "Tomorrow" }));
  await waitFor(() => expect(remind).toHaveBeenCalledWith(travelly.id,
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9)
      .getTime() / 1000));
  expect(remind.mock.calls[0][1]).toBe(tomorrow9(now));
  fireEvent.click(within(p).getByRole("radio", { name: "Mon 09:00" }));
  await waitFor(() => expect(remind).toHaveBeenCalledTimes(2));
  expect(remind.mock.calls[1]).toEqual([travelly.id, nextMonday9(now)]);
  expect(new Date(nextMonday9(now) * 1000).getDay()).toBe(1);
  expect(onChanged).toHaveBeenCalled();
});

test("Remind me: a day of your own", async () => {
  show();
  const p = await screen.findByTestId("waiting-pane");
  fireEvent.click(within(p).getByRole("radio", { name: "Pick…" }));
  const input = within(p).getByLabelText("Remind me on") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "2026-12-05" } });
  await waitFor(() => expect(remind).toHaveBeenCalledWith(travelly.id,
    new Date(2026, 11, 5, 9).getTime() / 1000));
});

test("a set reminder shows as the chosen time and can be cancelled", async () => {
  const at = tomorrow9(new Date(NOW * 1000));
  waiting.mockResolvedValue(resp({ items: [
    { ...travelly, reminder: { at, fired: 0 } }, alex, library, sam, bank] }));
  show();
  const p = await screen.findByTestId("waiting-pane");
  expect(within(p).getByRole("radio", { name: "Tomorrow", checked: true }))
    .toBeTruthy();
  expect(within(p).getByText(/Reminder set for Wed 09:00/)).toBeTruthy();
  fireEvent.click(within(p).getByRole("button", { name: "Cancel reminder" }));
  await waitFor(() => expect(remind).toHaveBeenCalledWith(travelly.id, null));
});

test("a reminder with notifications off says so and links to Settings", async () => {
  const at = tomorrow9(new Date(NOW * 1000));
  waiting.mockResolvedValue(resp({ items: [
    { ...travelly, reminder: { at, fired: 0 } }, alex] }));
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
  await waitFor(() => expect(needed).toHaveBeenCalledWith(travelly.id, true));
  expect(await screen.findByText("Travelly: no answer needed.")).toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(needed).toHaveBeenLastCalledWith(travelly.id, false));
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
    expect(await within(p).findByText("Kim Roe answered after 2 days."))
      .toBeTruthy();
    // an answered mail has no reminder and nothing to skip
    expect(within(p).queryByText("Remind me")).toBeNull();
    expect(within(p).queryByRole("button", { name: "No answer needed" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^Not needed/ }));
    expect(rows()).toHaveLength(1);
    const q = pane();
    expect(await within(q).findByText("Marked as not needing an answer."))
      .toBeTruthy();
    fireEvent.click(within(q).getByRole("button", { name: "Bring it back" }));
    await waitFor(() => expect(needed).toHaveBeenCalledWith(skipped.id, false));
    expect(await screen.findByText("Back on the list.")).toBeTruthy();
  });

/* ------------------------- Open the conversation ------------------------- */

test("Open the conversation shows the existing conversation view, Back returns",
  async () => {
    show();
    const p = await screen.findByTestId("waiting-pane");
    await within(p).findByText(/2 newsletters from Travelly since/);
    fireEvent.click(within(p).getByRole("button", { name: "Open the conversation" }));
    await waitFor(() => expect(thread).toHaveBeenCalledWith("INBOX", 40));
    expect(screen.queryByTestId("waiting-pane")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
  });

test("a conversation you started opens your sent mail", async () => {
  item.mockResolvedValue(detailOf({ thread: null }));
  show();
  const p = await screen.findByTestId("waiting-pane");
  await within(p).findByText(/2 newsletters from Travelly since/);
  fireEvent.click(within(p).getByRole("button", { name: "Open the conversation" }));
  await waitFor(() => expect(message).toHaveBeenCalledWith("Sent", 11));
  expect(thread).not.toHaveBeenCalled();
});

/* --------------------------------- states -------------------------------- */

test("states: loading, failure with retry, tracking off, no scan, nothing open",
  async () => {
    waiting.mockReturnValue(new Promise(() => {}));
    show();
    expect(await screen.findByRole("status")).toBeTruthy();
    cleanup();
    waiting.mockRejectedValueOnce(new Error("down")).mockResolvedValue(resp());
    show();
    expect(await screen.findByText("Couldn't load the list.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Travelly")).toBeTruthy();
    cleanup();
    waiting.mockResolvedValue(resp({ tracking: false, items: [] }));
    show();
    expect(await screen.findByText("Tracking is off for this account"))
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
    expect(screen.getByText(/The first scan after you turn this on reads the last 90 days/))
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
  await screen.findByText("Travelly");
  expect(screen.queryByTestId("waiting-pane")).toBeNull();
  fireEvent.click(within(rows()[0]).getByRole("button"));
  const dialog = await screen.findByRole("dialog", { name: "Travelly" });
  expect(within(dialog).getByRole("button", { name: "No answer needed" }))
    .toBeTruthy();
});

/* -------------------------------- the phone ------------------------------ */

test("phone: a row per mail with the days, no figures, the swipe hint", async () => {
  viewport(390);
  show();
  expect(await screen.findByText(/^3\slonger than usual$/)).toBeTruthy();
  expect(screen.queryByText("waiting longer than usual")).toBeNull();
  expect(rows()).toHaveLength(5);
  expect(within(rows()[0]).getByText("Travelly")).toBeTruthy();
  expect(within(rows()[0]).getByText("12d")).toBeTruthy();
  expect(within(rows()[0]).getByText("Re: Change of booking 88213")).toBeTruthy();
  // an overdue one reads orange, a young one muted
  expect(within(rows()[0]).getByText("12d").className).toContain("text-review-fg");
  expect(within(rows()[4]).getByText("1d").className).not.toContain("text-review-fg");
  expect(screen.getByText("Swipe left: No answer needed · swipe right: Remind me"))
    .toBeTruthy();
});

test("phone: tapping a row opens the pane as a dialog with the buttons", async () => {
  viewport(390);
  show();
  await screen.findByText("Travelly");
  fireEvent.click(within(rows()[0]).getByRole("button"));
  const dialog = await screen.findByRole("dialog", { name: "Travelly" });
  expect(within(dialog).getByRole("button", { name: "No answer needed" }))
    .toBeTruthy();
  expect(within(dialog).getByRole("radio", { name: "Tomorrow" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "No answer needed" }));
  await waitFor(() => expect(needed).toHaveBeenCalledWith(travelly.id, true));
  await waitFor(() => expect(screen.queryByRole("dialog",
    { name: "Travelly" })).toBeNull());
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
  await screen.findByText("Travelly");
  swipe(body("Travelly"), [300, 200, 100]);
  const under = within(body("Travelly").parentElement!.firstElementChild as HTMLElement);
  fireEvent.click(await under.findByRole("button", { name: "No answer needed" }));
  await waitFor(() => expect(needed).toHaveBeenCalledWith(travelly.id, true));
  vi.restoreAllMocks();
});

test("phone: swipe right is Remind me (tomorrow, 09:00)", async () => {
  viewport(390, true);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
  show();
  await screen.findByText("Alex Doe");
  swipe(body("Alex Doe"), [100, 200, 300]);
  const lead = within(body("Alex Doe").parentElement!.firstElementChild as HTMLElement);
  fireEvent.click(await lead.findByRole("button", { name: "Remind me" }));
  await waitFor(() => expect(remind).toHaveBeenCalledWith(alex.id,
    tomorrow9(new Date(NOW * 1000))));
  vi.restoreAllMocks();
});

test("phone: rows of the other tabs have no swipe actions", async () => {
  viewport(390, true);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
  show();
  await screen.findByText("Travelly");
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
  expect(await screen.findByText("warten länger als üblich")).toBeTruthy();
  expect(screen.getByRole("tab", { name: /^Offen · 5$/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /^Beantwortet · 41$/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /^Nicht nötig · 7$/ })).toBeTruthy();
  expect(screen.getByText("Sortiert danach, wie überfällig")).toBeTruthy();
  expect(within(rows()[0]).getByText(/^12\sTage$/)).toBeTruthy();
  const p = pane();
  expect(await within(p).findByText(/^Seit 12\sTagen keine Antwort\.$/))
    .toBeTruthy();
  expect(within(p).getByText(
    /Travelly antwortet dir sonst innerhalb von 2\sTagen \(4 frühere Unterhaltungen\)/))
    .toBeTruthy();
  expect(within(p).getByRole("button", { name: "Unterhaltung öffnen" })).toBeTruthy();
  expect(within(p).getByRole("button", { name: "Keine Antwort nötig" })).toBeTruthy();
  expect(within(p).getByRole("radio", { name: "Morgen" })).toBeTruthy();
  expect(within(p).getByText(/Inboxrake sendet nie Mails für dich/)).toBeTruthy();
});

test("every waiting string exists in both languages", () => {
  const keys = (d: Record<string, string>) => Object.keys(d)
    .filter((k) => k.startsWith("waiting.") || k.startsWith("tab.waiting"));
  expect(keys(EN).length).toBeGreaterThan(60);
  expect(keys(DE).sort()).toEqual(keys(EN).sort());
});

test("the pill of the board: the days, an overdue one with the hourglass", async () => {
  show();
  await screen.findByText("Travelly");
  const pill = within(rows()[0]).getByText(/^12\sdays$/);
  expect(pill.closest("span.rounded-full")?.className).toContain("text-review-fg");
  expect(within(rows()[2]).getByText(/^4\sdays$/)).toBeTruthy();
  expect(sam.overdue).toBe(false);
  expect(bank.overdue).toBe(false);
  expect(answered.state).toBe("answered");
  expect(library.overdue).toBe(true);
});
