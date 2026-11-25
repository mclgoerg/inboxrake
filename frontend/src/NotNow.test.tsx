// @vitest-environment jsdom
/* Not now: the pop-up menu from 640 px, the bottom sheet of the board on a
   phone, the date picker dialog, and the batch rows - what each asks the
   caller to do, in English and German. */
import { act, cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import { NotNow, NotNowSheet, type NotNowProps } from "./components/NotNow";
import { epoch } from "./snooze";

// Tuesday 2026-11-24, 09:30 local
const NOW = new Date(2026, 10, 24, 9, 30);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setLang("en");
});

const phone = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q.includes("width < 40rem"), media: q,
  addEventListener() {}, removeEventListener() {},
}));

const props = (over: Partial<NotNowProps> = {}): NotNowProps => ({
  look: "action", scope: "unread", n: 14, who: "Deals Daily",
  onSnooze: vi.fn(), ...over });
const text = (s: string) => s.replace(/\u00a0/g, " ");
const plain = (el: HTMLElement) => text(el.textContent ?? "");
const at = (d: number, h: number, mi = 0) =>
  epoch(new Date(2026, 10, d, h, mi));

test("the menu opens with the board's rows and times", () => {
  render(<NotNow {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  const menu = screen.getByRole("menu");
  expect(plain(within(menu).getByRole("group",
    { name: /Snooze the 14/ }))).toContain("Snooze the 14 unread mails until");
  const rows = within(menu).getAllByRole("menuitem").map((r) => plain(r));
  expect(rows).toEqual(["Later today18:00", "Tomorrow morningWed 08:00",
    "This weekendSat 09:00", "Next weekMon 08:00", "Pick a date…"]);
});

test("a time asks the caller to snooze until that moment", () => {
  const onSnooze = vi.fn();
  render(<NotNow {...props({ onSnooze })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Tomorrow morning/ }));
  expect(onSnooze).toHaveBeenCalledWith(at(25, 8));
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /This weekend/ }));
  expect(onSnooze).toHaveBeenLastCalledWith(at(28, 9));
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Next week/ }));
  expect(onSnooze).toHaveBeenLastCalledWith(at(30, 8));
});

test("with nothing unread the times are off and the caption says why", () => {
  const onSnooze = vi.fn();
  render(<NotNow {...props({ n: 0, onSnooze })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getByRole("group", { name: /Nothing unread/ }))
    .toBeTruthy();
  for (const row of within(menu).getAllByRole("menuitem"))
    expect((row as HTMLButtonElement).disabled).toBe(true);
});

test("a selection and a single mail are worded as such", () => {
  const { unmount } = render(<NotNow {...props({ scope: "selected", n: 3 })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: /Snooze the 3/ })).toBeTruthy();
  unmount();
  render(<NotNow {...props({ scope: "mail", n: 1 })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: "Snooze this mail until" }))
    .toBeTruthy();
});

test("Pick a date opens a dialog; a past time cannot be chosen", () => {
  const onSnooze = vi.fn();
  render(<NotNow {...props({ onSnooze })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Pick a date…" }));
  const dlg = screen.getByRole("dialog", { name: "Snooze until" });
  const field = within(dlg).getByLabelText("Date and time") as HTMLInputElement;
  expect(field.type).toBe("datetime-local");
  expect(field.value).toBe("2026-11-25T08:00");        // tomorrow morning
  const confirm = within(dlg).getByRole("button", { name: "Snooze" });
  fireEvent.change(field, { target: { value: "2026-11-24T08:00" } });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(field, { target: { value: "2026-12-01T09:15" } });
  expect((confirm as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(confirm);
  expect(onSnooze).toHaveBeenCalledWith(epoch(new Date(2026, 11, 1, 9, 15)));
  expect(screen.queryByRole("dialog", { name: "Snooze until" })).toBeNull();
});

test("the batch section offers a week and a day, and checks the one in use", () => {
  const onSet = vi.fn();
  const { rerender } = render(<NotNow {...props({
    batch: { slot: null, onSet } })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: "Every new mail from Deals Daily" }))
    .toBeTruthy();
  const week = screen.getByRole("menuitemradio", { name: /Deliver once a week/ });
  expect(plain(week)).toContain("Sat 09:00");
  expect(plain(screen.getByRole("menuitemradio",
    { name: /Deliver once a day/ }))).toContain("18:00");
  fireEvent.click(week);
  expect(onSet).toHaveBeenCalledWith("weekly");
  expect(screen.queryByRole("menuitem", { name: /Stop delivering/ })).toBeNull();

  rerender(<NotNow {...props({ batch: { slot: "weekly", onSet } })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  const on = screen.getByRole("menuitemradio", { name: /once a week/ });
  expect(on.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(on);                       // the checked one turns it off
  expect(onSet).toHaveBeenLastCalledWith("off");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Stop delivering/ }));
  expect(onSet).toHaveBeenLastCalledWith("off");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /once a day/ }));
  expect(onSet).toHaveBeenLastCalledWith("daily");
});

test("no batch section without a sender", () => {
  render(<NotNow {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("group", { name: /Every new mail/ })).toBeNull();
});

test("on a phone the button opens the board's sheet: four tiles, the switch, Pick a date", () => {
  phone();
  const onSnooze = vi.fn();
  const onSet = vi.fn();
  render(<NotNow {...props({ onSnooze, batch: { slot: null, onSet } })} />);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  const sheet = screen.getByRole("dialog", { name: "Not now" });
  expect(plain(sheet)).toContain("Deals Daily · 14 unread");
  const tiles = within(sheet).getAllByRole("button")
    .map((b) => plain(b)).filter((x) => /\d\d:\d\d/.test(x));
  expect(tiles).toEqual(["Later today18:00", "TomorrowWed 08:00",
    "WeekendSat 09:00", "Next weekMon 08:00"]);
  const sw = within(sheet).getByRole("switch", { name: "Deliver in batches" });
  expect(sw.getAttribute("aria-checked")).toBe("false");
  expect(plain(sheet)).toContain("Every new mail · once a week, Sat 09:00");
  fireEvent.click(sw);
  expect(onSet).toHaveBeenCalledWith("weekly");
  expect(sw.getAttribute("aria-checked")).toBe("true");   // shows at once
  // a rhythm choice appears with the switch on
  fireEvent.click(within(sheet).getByRole("tab", { name: "Once a day" }));
  expect(onSet).toHaveBeenLastCalledWith("daily");
  fireEvent.click(within(sheet).getByRole("button", { name: /Weekend/ }));
  expect(onSnooze).toHaveBeenCalledWith(at(28, 9));
  expect(screen.queryByRole("dialog", { name: "Not now" })).toBeNull();
});

test("the sheet's Pick a date opens the dialog, and Cancel returns to nothing", () => {
  phone();
  const onSnooze = vi.fn();
  render(<NotNow {...props({ onSnooze })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick a date…" }));
  expect(screen.getByRole("dialog", { name: "Snooze until" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onSnooze).not.toHaveBeenCalled();
});

test("a sheet with nothing unread has no time tiles", () => {
  phone();
  render(<NotNow {...props({ n: 0 })} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  const sheet = screen.getByRole("dialog", { name: "Not now" });
  expect(plain(sheet)).toContain("Nothing unread to snooze here");
  expect(within(sheet).queryByRole("button", { name: /Tomorrow/ })).toBeNull();
});

test("the standalone sheet (a swipe) snoozes and closes", () => {
  phone();
  const onSnooze = vi.fn();
  const onClose = vi.fn();
  render(<NotNowSheet scope="mail" n={1} who="Invoice 7" onSnooze={onSnooze}
    onClose={onClose} />);
  const sheet = screen.getByRole("dialog", { name: "Not now" });
  expect(plain(sheet)).toContain("Invoice 7");
  expect(within(sheet).queryByRole("switch")).toBeNull();   // no batch for a mail
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow/ }));
  expect(onSnooze).toHaveBeenCalledWith(at(25, 8));
  expect(onClose).toHaveBeenCalled();
});

test("German: the button, the rows and the sheet", () => {
  setLang("de");
  const { unmount } = render(<NotNow {...props({
    batch: { slot: null, onSet: vi.fn() } })} />);
  fireEvent.click(screen.getByRole("button", { name: "Nicht jetzt" }));
  expect(screen.getByRole("group",
    { name: /Die 14\sungelesenen Mails zurückstellen bis/ })).toBeTruthy();
  const rows = screen.getAllByRole("menuitem").map((r) => plain(r));
  expect(rows[0]).toContain("Später heute");
  expect(rows[1]).toContain("Morgen früh");
  expect(rows.at(-1)).toContain("Datum wählen…");
  expect(screen.getByRole("group", { name: "Jede neue Mail von Deals Daily" }))
    .toBeTruthy();
  expect(screen.getByRole("menuitemradio", { name: /Einmal pro Woche zustellen/ }))
    .toBeTruthy();
  unmount();
  phone();
  render(<NotNow {...props({ batch: { slot: null, onSet: vi.fn() } })} />);
  fireEvent.click(screen.getByRole("button", { name: "Nicht jetzt" }));
  const sheet = screen.getByRole("dialog", { name: "Nicht jetzt" });
  expect(plain(sheet)).toContain("Deals Daily · 14 ungelesen");
  expect(within(sheet).getByRole("switch", { name: "Gesammelt zustellen" }))
    .toBeTruthy();
  act(() => {});
});
