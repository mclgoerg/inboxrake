// @vitest-environment jsdom
/* Not now… on the phone cards: the LAST item of a swipe row's More sheet, with
   every item that was there before it - and no pill, chip or extra swipe
   button on the rows themselves. */
import { act, cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GroupTable, type GroupSwipe } from "./components/GroupTable";
import { setLang } from "./i18n";
import type { Group } from "./types";

const mk = (label: string, over: Partial<Group> = {}): Group => ({
  key: `${label.toLowerCase()}@x.example`, label,
  sub: `${label.toLowerCase()}@x.example`, count: 5, size: 1000, unread: 2,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  ...over,
});

const stubPhone = () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer: coarse"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
};

beforeEach(stubPhone);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLang("en");
});

function table(groups: Group[], swipe: GroupSwipe,
    extra: Partial<Parameters<typeof GroupTable>[0]> = {}) {
  return render(<GroupTable groups={groups} selected={new Set()}
    focusedKey={null} onToggle={() => {}} onToggleAll={() => {}}
    onOpen={() => {}} sortK="count" sortDir={-1} onSort={() => {}}
    groupLabel="Sender" resetSignal="a" grouping="sender" swipe={swipe}
    {...extra} />);
}
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
const OPEN_LEFT = [300, 200, 100], OPEN_RIGHT = [100, 200, 300];
const body = (label: string) => screen.getAllByText(label)
  .map((n) => n.closest<HTMLElement>("[data-swipe-body]")).find(Boolean)!;
const underlay = (label: string) =>
  within(body(label).parentElement!.firstElementChild as HTMLElement);
const names = (label: string) => underlay(label).getAllByRole("button")
  .map((b) => b.getAttribute("aria-label") ?? b.textContent);
const handlers = (over: Partial<GroupSwipe> = {}): GroupSwipe => ({
  trash: vi.fn(), read: vi.fn(), archive: vi.fn(), select: vi.fn(),
  canTarget: vi.fn(() => true), protect: vi.fn(), block: vi.fn(),
  unblock: vi.fn(), snooze: vi.fn(), ...over });
const more = (label = "Alpha") => {
  swipe(body(label), OPEN_LEFT);
  fireEvent.click(underlay(label).getByRole("button", { name: "More" }));
  return within(screen.getByRole("dialog", { name: label }));
};

test("the swipe's More sheet ends with Not now… and every item before it stays", () => {
  table([mk("Alpha")], handlers());
  const sheet = more();
  expect(sheet.getAllByRole("button")
    .map((b) => b.textContent).filter((x) => x !== "Done")).toEqual([
    "Open details", "Select", "Archive", "Not now…"]);
});

test("Not now… closes the sheet and hands the row to the caller", () => {
  const h = handlers();
  const g = mk("Alpha");
  table([g], h);
  fireEvent.click(more().getByRole("button", { name: "Not now…" }));
  expect(h.snooze).toHaveBeenCalledWith(g);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("without the handler the sheet is as it was", () => {
  table([mk("Alpha")], handlers({ snooze: undefined }));
  expect(more().queryByRole("button", { name: "Not now…" })).toBeNull();
});

test("the swipe rows themselves are as they were: no Not now button, no pill", () => {
  table([mk("Alpha")], handlers());
  swipe(body("Alpha"), OPEN_LEFT);
  expect(names("Alpha")).toEqual(["Trash", "Block", "More"]);
  cleanup();
  table([mk("Alpha")], handlers());
  swipe(body("Alpha"), OPEN_RIGHT);
  expect(names("Alpha")).toEqual([
    "Protect this sender - bulk deletes and AI suggestions will skip it",
    "Mark read"]);
  expect(screen.queryByText(/^back /)).toBeNull();
});

test("German: the sheet's last row", () => {
  setLang("de");
  table([mk("Alpha")], handlers());
  swipe(body("Alpha"), OPEN_LEFT);
  fireEvent.click(underlay("Alpha").getByRole("button", { name: "Mehr" }));
  const sheet = within(screen.getByRole("dialog", { name: "Alpha" }));
  expect(sheet.getByRole("button", { name: "Nicht jetzt…" })).toBeTruthy();
});
