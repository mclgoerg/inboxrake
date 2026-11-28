// @vitest-environment jsdom
/* Not now…: the last item of a More menu, the popover it opens beside the menu
   from 640 px, the bottom sheet of the board on a phone, the date dialog and
   the batch rows - what each asks the caller to do, in English and German. */
import { act, cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import { NotNowSheet, useNotNow, type NotNowSpec } from "./components/NotNow";
import { Menu, MenuItem } from "./components/ui";
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

/** A More menu with one older item and Not now… last, as the callers build it. */
function Host({ spec }: { spec: NotNowSpec }) {
  const nn = useNotNow(spec);
  return (
    <div ref={nn.anchorRef}>
      <Menu label="More" trigger={<span>More</span>}>
        <MenuItem>Older item</MenuItem>
        {nn.item}
      </Menu>
      {nn.overlay}
    </div>
  );
}

const spec = (over: Partial<NotNowSpec> = {}): NotNowSpec => ({
  scope: "unread", n: 14, who: "Deals Daily", onSnooze: vi.fn(), ...over });
const text = (s: string) => s.replace(/\u00a0/g, " ");
const plain = (el: HTMLElement) => text(el.textContent ?? "");
const at = (d: number, h: number, mi = 0) =>
  epoch(new Date(2026, 10, d, h, mi));

/** More › Not now… */
function open() {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Not now/ }));
}
const popover = () => screen.getByRole("menu", { name: /Not now/ });

test("Not now… is the LAST item of the menu and opens the popover instead of acting", () => {
  const onSnooze = vi.fn();
  render(<Host spec={spec({ onSnooze })} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getAllByRole("menuitem").map((i) => plain(i)))
    .toEqual(["Older item", "Not now…"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Not now…" }));
  // the menu is gone, the popover took its place
  expect(screen.getAllByRole("menu")).toHaveLength(1);
  expect(popover().getAttribute("aria-label")).toBe("Not now · Deals Daily");
  expect(onSnooze).not.toHaveBeenCalled();
});

test("the popover has the board's rows and times, soonest first", () => {
  render(<Host spec={spec()} />);
  open();
  const rows = within(popover()).getAllByRole("menuitem").map((r) => plain(r));
  // Tuesday: this Saturday is more than two days away, then next Monday
  expect(rows).toEqual(["Later today18:00", "Tomorrow morningWed 08:00",
    "Next weekendSat 09:00", "Monday morningMon 08:00", "Pick a date…"]);
});

test("on a Friday the weekend is the one after tomorrow, as drawn", () => {
  vi.setSystemTime(new Date(2026, 10, 27, 9, 30));
  render(<Host spec={spec()} />);
  open();
  const rows = within(popover()).getAllByRole("menuitem").map((r) => plain(r));
  expect(rows).toEqual(["Later today18:00", "Tomorrow morningSat 08:00",
    "Monday morningMon 08:00", "Next weekendSat 5 Dec", "Pick a date…"]);
});

test("a time asks the caller to snooze until that moment and closes the popover", () => {
  const onSnooze = vi.fn();
  render(<Host spec={spec({ onSnooze })} />);
  open();
  fireEvent.click(within(popover()).getByRole("menuitem",
    { name: /Tomorrow morning/ }));
  expect(onSnooze).toHaveBeenCalledWith(at(25, 8));
  expect(screen.queryByRole("menu")).toBeNull();
  open();
  fireEvent.click(within(popover()).getByRole("menuitem",
    { name: /Next weekend/ }));
  expect(onSnooze).toHaveBeenLastCalledWith(at(28, 9));
  open();
  fireEvent.click(within(popover()).getByRole("menuitem",
    { name: /Monday morning/ }));
  expect(onSnooze).toHaveBeenLastCalledWith(at(30, 8));
});

test("Escape closes the popover and nothing is snoozed", () => {
  const onSnooze = vi.fn();
  render(<Host spec={spec({ onSnooze })} />);
  open();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(onSnooze).not.toHaveBeenCalled();
});

test("a press outside closes the popover", () => {
  render(<Host spec={spec()} />);
  open();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

test("with nothing unread the times are off and the popover says why; a batch still works", () => {
  const onSnooze = vi.fn();
  const onSet = vi.fn();
  render(<Host spec={spec({ n: 0, onSnooze, batch: { slot: null, onSet } })} />);
  open();
  const pop = popover();
  expect(plain(pop)).toContain("Nothing unread to snooze here");
  const rows = within(pop).getAllByRole("menuitem");
  for (const row of rows.slice(0, 5))
    expect((row as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(pop).getByRole("menuitemradio",
    { name: /Deliver once a day/ }));
  expect(onSet).toHaveBeenCalledWith("daily");
});

test("Pick a date opens a dialog; a past time cannot be chosen", () => {
  const onSnooze = vi.fn();
  render(<Host spec={spec({ onSnooze })} />);
  open();
  fireEvent.click(within(popover()).getByRole("menuitem",
    { name: "Pick a date…" }));
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

test("the batch section names the sender, offers a day and a week, and turns the one in use off", () => {
  const onSet = vi.fn();
  const { unmount } = render(<Host spec={spec({
    batch: { slot: null, onSet } })} />);
  open();
  expect(within(popover()).getByRole("group",
    { name: "Every new mail from Deals Daily" })).toBeTruthy();
  const day = within(popover()).getByRole("menuitemradio",
    { name: /Deliver once a day/ });
  const week = within(popover()).getByRole("menuitemradio",
    { name: /Deliver once a week/ });
  expect(plain(day)).toContain("18:00");
  expect(plain(week)).toContain("Sat 09:00");
  fireEvent.click(week);
  expect(onSet).toHaveBeenCalledWith("weekly");
  unmount();

  render(<Host spec={spec({ batch: { slot: "weekly", onSet } })} />);
  open();
  const on = within(popover()).getByRole("menuitemradio",
    { name: /once a week/ });
  expect(on.getAttribute("aria-checked")).toBe("true");
  expect(within(popover()).getByRole("menuitemradio", { name: /once a day/ })
    .getAttribute("aria-checked")).toBe("false");
  fireEvent.click(on);                       // the checked one turns it off
  expect(onSet).toHaveBeenLastCalledWith("off");
});

test("no batch section without a single sender", () => {
  render(<Host spec={spec({ scope: "selected", n: 3 })} />);
  open();
  expect(screen.queryByRole("group", { name: /Every new mail/ })).toBeNull();
});

test("the disabled entry cannot open anything", () => {
  render(<Host spec={spec({ disabled: true })} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect((screen.getByRole("menuitem", { name: "Not now…" }) as
    HTMLButtonElement).disabled).toBe(true);
});

test("on a phone it opens the board's sheet: four tiles, Pick a date, two switches, Cancel", () => {
  phone();
  const onSnooze = vi.fn();
  const onSet = vi.fn();
  render(<Host spec={spec({ onSnooze, batch: { slot: null, onSet } })} />);
  open();
  const sheet = screen.getByRole("dialog", { name: "Not now · Deals Daily" });
  expect(plain(sheet)).toContain("14 unread mails");
  const tiles = within(sheet).getAllByRole("button")
    .map((b) => plain(b)).filter((x) => /\d/.test(x) && !/Pick/.test(x));
  expect(tiles).toEqual(["Later today18:00", "TomorrowWed 08:00",
    "Next weekendSat 09:00", "MondayMon 08:00"]);
  const day = within(sheet).getByRole("switch", { name: "Deliver once a day" });
  const week = within(sheet).getByRole("switch",
    { name: "Deliver once a week" });
  expect(plain(sheet)).toContain("every new mail from Deals Daily · 18:00");
  expect(plain(sheet)).toContain("every new mail from Deals Daily · Sat 09:00");
  fireEvent.click(day);
  expect(onSet).toHaveBeenCalledWith("daily");
  expect(day.getAttribute("aria-checked")).toBe("true");   // shows at once
  fireEvent.click(week);                      // one rhythm at a time
  expect(onSet).toHaveBeenLastCalledWith("weekly");
  expect(day.getAttribute("aria-checked")).toBe("false");
  expect(week.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(week);
  expect(onSet).toHaveBeenLastCalledWith("off");
  fireEvent.click(within(sheet).getByRole("button", { name: /Next weekend/ }));
  expect(onSnooze).toHaveBeenCalledWith(at(28, 9));
  expect(screen.queryByRole("dialog", { name: /Not now/ })).toBeNull();
});

test("the sheet's Pick a date opens the dialog, and Cancel there snoozes nothing", () => {
  phone();
  const onSnooze = vi.fn();
  render(<Host spec={spec({ onSnooze })} />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Pick a date…" }));
  expect(screen.getByRole("dialog", { name: "Snooze until" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onSnooze).not.toHaveBeenCalled();
});

test("the sheet's Cancel closes it", () => {
  phone();
  render(<Host spec={spec()} />);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a sheet with nothing unread has no time tiles", () => {
  phone();
  render(<Host spec={spec({ n: 0 })} />);
  open();
  const sheet = screen.getByRole("dialog", { name: /Not now/ });
  expect(plain(sheet)).toContain("Nothing unread to snooze here");
  expect(within(sheet).queryByRole("button", { name: /Tomorrow/ })).toBeNull();
});

test("the standalone sheet (a swipe row's More) snoozes and closes", () => {
  phone();
  const onSnooze = vi.fn();
  const onClose = vi.fn();
  render(<NotNowSheet scope="mail" n={1} who="Invoice 7" onSnooze={onSnooze}
    onClose={onClose} />);
  const sheet = screen.getByRole("dialog", { name: "Not now · Invoice 7" });
  expect(within(sheet).queryByRole("switch")).toBeNull();   // no batch for a mail
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow/ }));
  expect(onSnooze).toHaveBeenCalledWith(at(25, 8));
  expect(onClose).toHaveBeenCalled();
});

test("German: the item, the popover and the sheet", () => {
  setLang("de");
  const { unmount } = render(<Host spec={spec({
    batch: { slot: null, onSet: vi.fn() } })} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Nicht jetzt…" }));
  const pop = screen.getByRole("menu", { name: /Nicht jetzt/ });
  const rows = within(pop).getAllByRole("menuitem").map((r) => plain(r));
  expect(rows[0]).toContain("Später heute");
  expect(rows[1]).toContain("Morgen früh");
  expect(rows.at(-1)).toContain("Datum wählen…");
  expect(within(pop).getByRole("group", { name: "Jede neue Mail von Deals Daily" }))
    .toBeTruthy();
  expect(within(pop).getByRole("menuitemradio", { name: /Einmal pro Woche zustellen/ }))
    .toBeTruthy();
  unmount();
  phone();
  render(<Host spec={spec({ batch: { slot: null, onSet: vi.fn() } })} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Nicht jetzt…" }));
  const sheet = screen.getByRole("dialog", { name: "Nicht jetzt · Deals Daily" });
  expect(plain(sheet)).toContain("14 ungelesene Mails");
  expect(within(sheet).getByRole("switch", { name: "Einmal pro Tag zustellen" }))
    .toBeTruthy();
  act(() => {});
});

test("the sheet and the date dialog leave a bar with a blurred background (they would be cut off and undimmed inside it)", () => {
  phone();
  render(<div data-testid="bar" className="bar-glass">
    <Host spec={spec()} /></div>);
  open();
  const sheet = screen.getByRole("dialog", { name: /Not now/ });
  expect(screen.getByTestId("bar").contains(sheet)).toBe(false);
  expect(document.body.contains(sheet)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Pick a date…" }));
  const dlg = screen.getByRole("dialog", { name: "Snooze until" });
  expect(screen.getByTestId("bar").contains(dlg)).toBe(false);
});

test("the date dialog from the popover is portalled too", () => {
  render(<div data-testid="bar" className="bar-glass">
    <Host spec={spec()} /></div>);
  open();
  fireEvent.click(within(popover()).getByRole("menuitem", { name: "Pick a date…" }));
  const dlg = screen.getByRole("dialog", { name: "Snooze until" });
  expect(screen.getByTestId("bar").contains(dlg)).toBe(false);
});

test("the popover sizes to its longest row, so nothing is cut off in German", () => {
  setLang("de");
  render(<Host spec={spec({ batch: { slot: null, onSet: vi.fn() } })} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Nicht jetzt…" }));
  const pop = screen.getByRole("menu", { name: /Nicht jetzt/ });
  expect(pop.className).toContain("w-max");
  expect(plain(pop)).toContain("Nächstes Wochenende");
  expect(plain(pop)).toContain("Einmal pro Woche zustellen");
});
