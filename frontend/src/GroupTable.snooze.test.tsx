// @vitest-environment jsdom
/* Not now on the lists: the blue "back tomorrow" chip of a sender with
   snoozed mail (table and phone cards) and the phone swipe that opens the
   sheet. */
import { act, cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GroupTable, type GroupSwipe } from "./components/GroupTable";
import { setLang } from "./i18n";
import { epoch } from "./snooze";
import type { Group, Grouping } from "./types";

// Tuesday 2026-11-24, 09:30 local
const NOW = new Date(2026, 10, 24, 9, 30);
const TOMORROW = epoch(new Date(2026, 10, 25, 8));
const SATURDAY = epoch(new Date(2026, 10, 28, 9));

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLang("en");
});

function table(groups: Group[], extra: Partial<Parameters<typeof GroupTable>[0]> = {}) {
  return render(<GroupTable groups={groups} selected={new Set()}
    focusedKey={null} onToggle={() => {}} onToggleAll={() => {}}
    onOpen={() => {}} sortK="count" sortDir={-1} onSort={() => {}}
    groupLabel="Sender" resetSignal="a" grouping="sender" {...extra} />);
}

// (the table and the phone cards are both rendered, CSS picks one: a chip
// shows once in each)
const chips = (text: string) => screen.queryAllByText(text).length;

test("a sender with snoozed mail shows when it comes back", () => {
  table([mk("Alpha"), mk("Bravo"), mk("Charlie")], { snoozed: {
    "alpha@x.example": TOMORROW, "bravo@x.example": SATURDAY } });
  const alpha = screen.getAllByText("Alpha")[0].closest("tr")!;
  expect(within(alpha).getByText("back tomorrow")).toBeTruthy();
  expect(within(screen.getAllByText("Bravo")[0].closest("tr")!)
    .getByText("back Sat")).toBeTruthy();
  expect(within(screen.getAllByText("Charlie")[0].closest("tr")!)
    .queryByText(/^back /)).toBeNull();
  expect(chips("back tomorrow")).toBe(2);
  expect(chips("back Sat")).toBe(2);
});

test("the chip is German in German", () => {
  setLang("de");
  table([mk("Alpha")], { snoozed: { "alpha@x.example": TOMORROW } });
  expect(chips("morgen zurück")).toBe(2);
});

test("the chip is for Sender rows and one-sender Smart rows, not pools or subjects", () => {
  const snoozed = { "alpha@x.example": TOMORROW };
  const pool = mk("Alpha", { key: "alpha@x.example", kind: "company" });
  const cases: [Grouping, Group, boolean][] = [
    ["sender", mk("Alpha"), true],
    ["smart", mk("Alpha", { kind: "sender", addr: "alpha@x.example",
      key: "sender:alpha" }), true],
    ["smart", pool, false],
    ["domain", mk("Alpha"), false],
    ["subject", mk("Alpha"), false],
  ];
  for (const [grouping, g, shown] of cases) {
    const { unmount } = table([g], { grouping, snoozed });
    expect(chips("back tomorrow") > 0, `${grouping} ${g.kind}`).toBe(shown);
    unmount();
  }
});

test("phone cards show the chip too", () => {
  stubPhone();
  table([mk("Alpha")], { snoozed: { "alpha@x.example": TOMORROW } });
  expect(chips("back tomorrow")).toBeGreaterThan(0);
});

// ---- swipe
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
const body = (label: string) => screen.getAllByText(label)
  .map((n) => n.closest<HTMLElement>("[data-swipe-body]")).find(Boolean)!;
const underlay = (label: string) =>
  within(body(label).parentElement!.firstElementChild as HTMLElement);
const handlers = (over: Partial<GroupSwipe> = {}): GroupSwipe => ({
  trash: vi.fn(), read: vi.fn(), archive: vi.fn(), select: vi.fn(),
  canTarget: vi.fn(() => true), protect: vi.fn(), block: vi.fn(),
  unblock: vi.fn(), snooze: vi.fn(), ...over });

test("a swipe right offers Not now after Protect and Read, and calls its handler", () => {
  stubPhone();
  const h = handlers();
  const g = mk("Alpha");
  table([g], { swipe: h });
  swipe(body("Alpha"), [100, 200, 300]);
  const names = underlay("Alpha").getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent);
  expect(names.at(-1)).toBe("Not now: snooze");
  expect(names).toHaveLength(3);
  fireEvent.click(underlay("Alpha").getByRole("button",
    { name: "Not now: snooze" }));
  expect(h.snooze).toHaveBeenCalledWith(g);
});

test("a row with nothing unread has no Not now swipe, nor does a list without the handler", () => {
  stubPhone();
  table([mk("Alpha", { unread: 0 })], { swipe: handlers() });
  swipe(body("Alpha"), [100, 200, 300]);
  expect(underlay("Alpha").queryByRole("button", { name: "Not now: snooze" }))
    .toBeNull();
  cleanup();
  table([mk("Alpha")], { swipe: handlers({ snooze: undefined }) });
  swipe(body("Alpha"), [100, 200, 300]);
  expect(underlay("Alpha").queryByRole("button", { name: "Not now: snooze" }))
    .toBeNull();
});
