// @vitest-environment jsdom
/* Row swipe on the phone cards (V5): which buttons a row offers, and that each
   one calls its own handler. */
import { act, cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GroupTable, type GroupSwipe } from "./components/GroupTable";
import type { Group } from "./types";

const mk = (label: string, over: Partial<Group> = {}): Group => ({
  key: `${label.toLowerCase()}@x.example`, label,
  sub: `${label.toLowerCase()}@x.example`, count: 5, size: 1000, unread: 2,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer: coarse"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const handlers = () => ({
  trash: vi.fn(), read: vi.fn(), archive: vi.fn(), select: vi.fn(),
  canTarget: vi.fn(() => true), protect: vi.fn(), block: vi.fn(),
  unblock: vi.fn(),
}) satisfies GroupSwipe;

function table(groups: Group[], swipe: GroupSwipe,
    extra: Partial<Parameters<typeof GroupTable>[0]> = {}) {
  return render(<GroupTable groups={groups} selected={new Set()}
    focusedKey={null} onToggle={() => {}} onToggleAll={() => {}}
    onOpen={() => {}} sortK="count" sortDir={-1} onSort={() => {}}
    groupLabel="Sender" resetSignal="a" swipe={swipe} {...extra} />);
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

test("a swipe left offers Trash · Block · More, in that order from the edge", () => {
  table([mk("Alpha")], handlers());
  swipe(body("Alpha"), OPEN_LEFT);
  expect(names("Alpha")).toEqual(["Trash", "Block", "More"]);
});

test("a swipe right offers Protect · Read; Read only while something is unread", () => {
  const h = handlers();
  table([mk("Alpha"), mk("Bravo", { unread: 0 })], h);
  swipe(body("Alpha"), OPEN_RIGHT);
  expect(names("Alpha")).toEqual([
    "Protect this sender - bulk deletes and AI suggestions will skip it",
    "Mark read"]);
  swipe(body("Bravo"), OPEN_RIGHT);
  expect(names("Bravo")).toHaveLength(1);
});

test("each button calls its own handler with the row's group", () => {
  const h = handlers();
  const g = mk("Alpha");
  table([g], h);
  swipe(body("Alpha"), OPEN_LEFT);
  fireEvent.click(underlay("Alpha").getByRole("button", { name: "Trash" }));
  expect(h.trash).toHaveBeenCalledWith(g);
  swipe(body("Alpha"), OPEN_LEFT);
  fireEvent.click(underlay("Alpha").getByRole("button", { name: "Block" }));
  expect(h.block).toHaveBeenCalledWith(g);
  swipe(body("Alpha"), OPEN_RIGHT);
  fireEvent.click(underlay("Alpha").getByRole("button", { name: "Mark read" }));
  expect(h.read).toHaveBeenCalledWith(g);
  swipe(body("Alpha"), OPEN_RIGHT);
  fireEvent.click(underlay("Alpha").getByRole("button", { name: /^Protect this sender/ }));
  expect(h.protect).toHaveBeenCalledWith(g);
});

test("rows without a sender or domain (subject, thread, Smart buckets) get no Block / Protect", () => {
  const h = handlers();
  h.canTarget.mockReturnValue(false);
  table([mk("Alpha")], h);
  swipe(body("Alpha"), OPEN_LEFT);
  expect(names("Alpha")).toEqual(["Trash", "More"]);
  swipe(body("Alpha"), OPEN_RIGHT);
  expect(names("Alpha")).toEqual(["Mark read"]);
});

test("a blocked sender offers Unblock, a protected one Unprotect", () => {
  const h = handlers();
  const g = mk("Alpha", { protected: true });
  table([g], h, { blockedKeys: new Map([[g.key, "rule1"]]) });
  swipe(body("Alpha"), OPEN_LEFT);
  expect(names("Alpha")).toEqual(["Trash", "Unblock", "More"]);
  fireEvent.click(underlay("Alpha").getByRole("button", { name: "Unblock" }));
  expect(h.unblock).toHaveBeenCalledWith(g);
  swipe(body("Alpha"), OPEN_RIGHT);
  const label = underlay("Alpha").getAllByRole("button")[0];
  expect(label.textContent).toBe("Unprotect");
});

test("a full swipe left runs Trash, a full swipe right Protect", () => {
  const h = handlers();
  table([mk("Alpha")], h);
  swipe(body("Alpha"), [350, 250, 150, 40]);
  expect(h.trash).toHaveBeenCalledTimes(1);
  expect(h.block).not.toHaveBeenCalled();
  swipe(body("Alpha"), [60, 160, 260, 360]);
  expect(h.protect).toHaveBeenCalledTimes(1);
  expect(h.read).not.toHaveBeenCalled();
});

test("More opens a sheet: details, Select, Archive - each through its handler", () => {
  const h = handlers();
  const onOpen = vi.fn();
  const g = mk("Alpha");
  table([g], h, { onOpen });
  const more = () => {
    swipe(body("Alpha"), OPEN_LEFT);
    fireEvent.click(underlay("Alpha").getByRole("button", { name: "More" }));
    return within(screen.getByRole("dialog", { name: "Alpha" }));
  };
  fireEvent.click(more().getByRole("button", { name: "Archive" }));
  expect(h.archive).toHaveBeenCalledWith(g);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(more().getByRole("button", { name: "Select" }));
  expect(h.select).toHaveBeenCalledWith(g);
  fireEvent.click(more().getByRole("button", { name: "Open details" }));
  expect(onOpen).toHaveBeenCalledWith(g);
});

test("no swipe in select mode, or without a swipe prop", () => {
  const h = handlers();
  const { rerender } = table([mk("Alpha")], h, { selectMode: true });
  swipe(body("Alpha"), OPEN_LEFT);
  expect(body("Alpha").style.transform).toBe("");
  rerender(<GroupTable groups={[mk("Alpha")]} selected={new Set()}
    focusedKey={null} onToggle={() => {}} onToggleAll={() => {}}
    onOpen={() => {}} sortK="count" sortDir={-1} onSort={() => {}}
    groupLabel="Sender" resetSignal="a" />);
  swipe(body("Alpha"), OPEN_LEFT);
  expect(body("Alpha").style.transform).toBe("");
});
