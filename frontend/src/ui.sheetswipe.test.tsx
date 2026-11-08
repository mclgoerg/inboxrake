// @vitest-environment jsdom
/* Modal bottom sheet: grabber and swipe-down-to-close (phones only). */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ConfirmDialog, DIALOG_ARM_MS, Modal } from "./components/ui";

const HEIGHT = 400;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("max-width"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(HEIGHT);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Ev = { y: number; x?: number; t: number; type?: string };

/** Pointer (and optionally touch) event with coordinates jsdom lacks. */
function fire(target: Element | Window, name: string, e: Ev,
  extra: Record<string, unknown> = {}) {
  const ev = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    clientX: { value: e.x ?? 0 }, clientY: { value: e.y },
    pointerId: { value: 1 }, isPrimary: { value: true },
    pointerType: { value: e.type ?? "touch" },
    timeStamp: { value: e.t }, ...Object.fromEntries(
      Object.entries(extra).map(([k, v]) => [k, { value: v }])),
  });
  act(() => { target.dispatchEvent(ev); });
  return ev;
}

/** Down at y0, move through `ys` (50 ms apart), release at the last one. */
function swipe(target: Element, ys: number[], opts: { x?: number;
  type?: string; step?: number } = {}) {
  const step = opts.step ?? 50;
  fire(target, "pointerdown", { y: ys[0], x: 0, t: 0, type: opts.type });
  ys.slice(1).forEach((y, i) => fire(window, "pointermove",
    { y, x: opts.x ?? 0, t: (i + 1) * step, type: opts.type }));
  fire(window, "pointerup", { y: ys[ys.length - 1], x: opts.x ?? 0,
    t: ys.length * step, type: opts.type });
}

const sheet = (onClose: () => void, body: React.ReactNode = <p>body</p>) =>
  render(<Modal size="sm" label="Sheet" onClose={onClose}>{body}</Modal>);
const dlg = () => screen.getByRole("dialog");
const grabber = () => dlg().querySelector("[data-sheet-grabber]")!;

test("a phone sheet has a decorative grabber; bigger modals and pages do not", () => {
  sheet(() => {});
  expect(grabber().getAttribute("aria-hidden")).toBe("true");
  expect(grabber().className).toContain("sm:hidden");
  cleanup();
  render(<Modal size="md" label="M" onClose={() => {}}>x</Modal>);
  expect(document.querySelector("[data-sheet-grabber]")).toBeNull();
});

test("dragging past a quarter of the height closes; the sheet follows", () => {
  const onClose = vi.fn();
  sheet(onClose);
  fire(grabber(), "pointerdown", { y: 0, t: 0 });
  fire(window, "pointermove", { y: 60, t: 500 });
  fire(window, "pointermove", { y: 120, t: 1000 });
  expect(dlg().style.transform).toBe("translateY(120px)");
  fire(window, "pointerup", { y: 120, t: 1500 });   // 30 % of 400, slow
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a short, slow drag snaps back", () => {
  const onClose = vi.fn();
  sheet(onClose);
  swipe(grabber(), [0, 30, 60, 80], { step: 400 });   // 20 %, slow
  expect(onClose).not.toHaveBeenCalled();
  expect(dlg().style.transform).toBe("");
  expect(dlg().style.transition).toContain("200ms");
});

test("a fast short flick closes", () => {
  const onClose = vi.fn();
  sheet(onClose);
  swipe(grabber(), [0, 40, 90], { step: 40 });   // 90 px (22 %), last 50 px in 80 ms
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("upward and mostly horizontal moves never drag", () => {
  const onClose = vi.fn();
  sheet(onClose);
  swipe(grabber(), [200, 100, 0]);
  swipe(grabber(), [0, 60, 200], { x: 400 });
  expect(onClose).not.toHaveBeenCalled();
  expect(dlg().style.transform).toBe("");
});

test("a scrolled-down scroller keeps the gesture; at the top it drags", () => {
  const onClose = vi.fn();
  sheet(onClose, <div data-testid="list"><p>row</p></div>);
  const list = screen.getByTestId("list");
  list.scrollTop = 40;
  swipe(list, [0, 150, 300], { step: 400 });
  expect(onClose).not.toHaveBeenCalled();
  list.scrollTop = 0;
  swipe(list, [0, 150, 300], { step: 400 });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the grabber drags even when the content is scrolled", () => {
  const onClose = vi.fn();
  sheet(onClose, <div data-testid="list">row</div>);
  screen.getByTestId("list").scrollTop = 40;
  swipe(grabber(), [0, 150, 300], { step: 400 });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a gesture that starts in a text field never drags", () => {
  const onClose = vi.fn();
  sheet(onClose, <input aria-label="name" />);
  swipe(screen.getByLabelText("name"), [0, 150, 300], { step: 400 });
  expect(onClose).not.toHaveBeenCalled();
});

test("mouse and wide viewports do not swipe", () => {
  const onClose = vi.fn();
  sheet(onClose);
  swipe(grabber(), [0, 150, 300], { step: 400, type: "mouse" });
  expect(onClose).not.toHaveBeenCalled();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q,
    addEventListener() {}, removeEventListener() {} }));
  swipe(grabber(), [0, 150, 300], { step: 400 });
  expect(onClose).not.toHaveBeenCalled();
});

test("reduced motion: no following, the threshold still closes", () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q,
    addEventListener() {}, removeEventListener() {} }));
  const onClose = vi.fn();
  sheet(onClose);
  fire(grabber(), "pointerdown", { y: 0, t: 0 });
  fire(window, "pointermove", { y: 100, t: 400 });
  expect(dlg().style.transform).toBe("");
  fire(window, "pointermove", { y: 200, t: 800 });
  fire(window, "pointerup", { y: 200, t: 1200 });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a vertical touchmove of ours is cancelled so the page does not scroll", () => {
  sheet(() => {});
  fire(grabber(), "pointerdown", { y: 0, t: 0 });
  const ev = fire(dlg(), "touchmove", { y: 0, t: 10 },
    { touches: [{ clientX: 0, clientY: 40 }] });
  expect(ev.defaultPrevented).toBe(true);
  fire(window, "pointercancel", { y: 40, t: 20 });
});

test("a swiped-away confirm resolves as Cancel", async () => {
  const onResult = vi.fn();
  render(<ConfirmDialog title="Delete?" confirmLabel="Delete" onResult={onResult} />);
  await new Promise((r) => setTimeout(r, DIALOG_ARM_MS + 30));
  swipe(grabber(), [0, 150, 300], { step: 400 });
  expect(onResult).toHaveBeenCalledWith(false);
});
