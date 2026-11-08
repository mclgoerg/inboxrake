// @vitest-environment jsdom
/* SwipeRow: the touch-only row that reveals buttons (V5). Pointer events are
   simulated like the sheet-swipe tests: jsdom has no PointerEvent. */

import { act, cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { SwipeRow, type SwipeAction } from "./components/ui";

const WIDTH = 390;
let coarse = true;
let reduced = false;

beforeEach(() => {
  coarse = true;
  reduced = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: (coarse && q.includes("pointer: coarse"))
      || (reduced && q.includes("reduced-motion")),
    media: q, addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(WIDTH);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Ev = { x: number; y?: number; t: number; type?: string };

function fire(target: Element | Window, name: string, e: Ev) {
  const ev = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    clientX: { value: e.x }, clientY: { value: e.y ?? 0 },
    pointerId: { value: 1 }, isPrimary: { value: true },
    pointerType: { value: e.type ?? "touch" }, timeStamp: { value: e.t },
  });
  act(() => { target.dispatchEvent(ev); });
  return ev;
}

/** Down at xs[0], move through the rest (`step` ms apart), release at the last. */
function swipe(target: Element, xs: number[], opts: { y?: number[];
  type?: string; step?: number } = {}) {
  const step = opts.step ?? 100;
  const y = (i: number) => opts.y?.[i] ?? 0;
  fire(target, "pointerdown", { x: xs[0], y: y(0), t: 0, type: opts.type });
  xs.slice(1).forEach((x, i) => fire(window, "pointermove",
    { x, y: y(i + 1), t: (i + 1) * step, type: opts.type }));
  fire(window, "pointerup", { x: xs[xs.length - 1], y: y(xs.length - 1),
    t: xs.length * step, type: opts.type });
}

const act1 = (key: string, fn: () => void): SwipeAction => ({
  key, label: key, tone: "neutral", icon: null, onAction: fn,
});

const row = (props: Partial<Parameters<typeof SwipeRow>[0]> = {},
  body = "Row") => (
  <SwipeRow {...props}>
    <button type="button">{body}</button>
  </SwipeRow>
);
const bodyOf = (i = 0) =>
  document.querySelectorAll<HTMLElement>("[data-swipe-body]")[i];

test("swiping left follows the finger and opens on the trailing buttons", () => {
  const trash = vi.fn(), more = vi.fn();
  render(row({ trailing: [act1("Trash", trash), act1("More", more)] }));
  expect(screen.queryByRole("button", { name: "Trash" })).toBeNull();
  const b = bodyOf();
  fire(b, "pointerdown", { x: 300, t: 0 });
  fire(window, "pointermove", { x: 280, t: 100 });
  fire(window, "pointermove", { x: 230, t: 200 });
  expect(b.style.transform).toBe("translateX(-70px)");
  expect(screen.getByRole("button", { name: "Trash" })).toBeTruthy();
  fire(window, "pointermove", { x: 150, t: 300 });
  fire(window, "pointerup", { x: 150, t: 400 });   // 150 px: past half of 144
  expect(b.style.transform).toBe("translateX(-144px)");   // 2 buttons x 72
  expect(trash).not.toHaveBeenCalled();
  expect(more).not.toHaveBeenCalled();
});

test("the first action sits at the outer edge of each side", () => {
  render(row({ trailing: [act1("Trash", () => {}), act1("More", () => {})] }));
  swipe(bodyOf(), [300, 200, 100]);
  const trash = screen.getByRole("button", { name: "Trash" });
  // flex-row-reverse: the first of the list is at the right edge
  expect(trash.parentElement!.className).toContain("flex-row-reverse");
  expect(trash.parentElement!.firstElementChild).toBe(trash);
  cleanup();
  render(row({ leading: [act1("Protect", () => {}), act1("Read", () => {})] }));
  swipe(bodyOf(), [100, 200, 300]);
  const protect = screen.getByRole("button", { name: "Protect" });
  expect(protect.parentElement!.className).not.toContain("flex-row-reverse");
  expect(protect.parentElement!.firstElementChild).toBe(protect);   // left edge
});

test("a short, slow drag snaps back and the buttons leave the DOM", async () => {
  render(row({ trailing: [act1("Trash", () => {})] }));
  swipe(bodyOf(), [300, 290, 280], { step: 400 });   // 20 px, slow
  expect(bodyOf().style.transform).toBe("");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Trash" }))
    .toBeNull());
});

test("a flick opens even over a short distance", () => {
  render(row({ trailing: [act1("Trash", () => {}), act1("More", () => {})] }));
  swipe(bodyOf(), [300, 285, 270], { step: 20 });   // 30 px in 40 ms
  expect(bodyOf().style.transform).toBe("translateX(-144px)");
});

test("a full swipe runs the FIRST action and the row returns", () => {
  const trash = vi.fn(), more = vi.fn();
  render(row({ trailing: [act1("Trash", trash), act1("More", more)] }));
  swipe(bodyOf(), [350, 250, 150, 40]);   // 310 px >= 65 % of 390
  expect(trash).toHaveBeenCalledTimes(1);
  expect(more).not.toHaveBeenCalled();
  expect(bodyOf().style.transform).toBe("");
});

test("just past the buttons is not a full swipe", () => {
  const trash = vi.fn();
  render(row({ trailing: [act1("Trash", trash), act1("More", () => {})] }));
  swipe(bodyOf(), [350, 250, 170], { step: 400 });   // 180 px
  expect(trash).not.toHaveBeenCalled();
  expect(bodyOf().style.transform).toBe("translateX(-144px)");
});

test("a full swipe right runs the first leading action", () => {
  const protect = vi.fn();
  render(row({ leading: [act1("Protect", protect), act1("Read", () => {})] }));
  swipe(bodyOf(), [60, 160, 260, 340]);
  expect(protect).toHaveBeenCalledTimes(1);
});

test("a side without actions does not move", () => {
  render(row({ trailing: [act1("Trash", () => {})] }));
  swipe(bodyOf(), [100, 200, 300], { step: 400 });   // right: nothing there
  expect(bodyOf().style.transform).toBe("");
  expect(screen.queryByRole("button", { name: "Trash" })).toBeNull();
});

test("vertical scroll wins: a mostly vertical move is not a swipe", () => {
  render(row({ trailing: [act1("Trash", () => {})] }));
  swipe(bodyOf(), [300, 296, 280], { y: [100, 130, 160] });
  expect(bodyOf().style.transform).toBe("");
  expect(screen.queryByRole("button", { name: "Trash" })).toBeNull();
});

test("a clearly horizontal move wins even with a little vertical drift", () => {
  render(row({ trailing: [act1("Trash", () => {})] }));
  swipe(bodyOf(), [300, 280, 230, 150], { y: [100, 104, 108, 112] });
  expect(bodyOf().style.transform).toBe("translateX(-72px)");
});

test("a mouse never swipes; neither does a touch pointer-less device", () => {
  render(row({ trailing: [act1("Trash", () => {})] }));
  swipe(bodyOf(), [300, 200, 100], { type: "mouse" });
  expect(bodyOf().style.transform).toBe("");
  cleanup();
  coarse = false;
  render(row({ trailing: [act1("Trash", () => {})] }));
  swipe(bodyOf(), [300, 200, 100]);
  expect(bodyOf().style.transform).toBe("");
});

test("`enabled` off (Select mode) switches the swipe off and resets an open row", () => {
  const { rerender } = render(
    row({ trailing: [act1("Trash", () => {})], enabled: true }));
  swipe(bodyOf(), [300, 200, 100]);
  expect(bodyOf().style.transform).toBe("translateX(-72px)");
  rerender(row({ trailing: [act1("Trash", () => {})], enabled: false }));
  expect(bodyOf().style.transform).toBe("");
  swipe(bodyOf(), [300, 200, 100]);
  expect(bodyOf().style.transform).toBe("");
});

test("a drag that starts in the left 20 px belongs to swipe back", () => {
  render(row({ leading: [act1("Protect", () => {})] }));
  swipe(bodyOf(), [12, 120, 240]);
  expect(bodyOf().style.transform).toBe("");
  swipe(bodyOf(), [30, 140, 260]);
  expect(bodyOf().style.transform).toBe("translateX(72px)");
});

test("only one row is open: opening another closes the first", async () => {
  render(<>
    {row({ trailing: [act1("Trash", () => {})] }, "One")}
    {row({ trailing: [act1("Trash", () => {})] }, "Two")}
  </>);
  swipe(bodyOf(0), [300, 200, 100]);
  expect(bodyOf(0).style.transform).toBe("translateX(-72px)");
  swipe(bodyOf(1), [300, 200, 100]);
  expect(bodyOf(1).style.transform).toBe("translateX(-72px)");
  expect(bodyOf(0).style.transform).toBe("");
});

test("a touch elsewhere, or a scroll, closes the open row", () => {
  render(<>{row({ trailing: [act1("Trash", () => {})] })}
    <p>elsewhere</p></>);
  swipe(bodyOf(), [300, 200, 100]);
  fire(screen.getByText("elsewhere"), "pointerdown", { x: 50, t: 2000 });
  expect(bodyOf().style.transform).toBe("");
  swipe(bodyOf(), [300, 200, 100]);
  expect(bodyOf().style.transform).toBe("translateX(-72px)");
  act(() => { document.dispatchEvent(new Event("scroll")); });
  expect(bodyOf().style.transform).toBe("");
});

test("a tap on an open row only closes it - what is under it is not clicked", () => {
  const open = vi.fn();
  render(
    <SwipeRow trailing={[act1("Trash", () => {})]}>
      <button type="button" onClick={open}>Open the sender</button>
    </SwipeRow>);
  fireEvent.click(screen.getByRole("button", { name: "Open the sender" }));
  expect(open).toHaveBeenCalledTimes(1);          // closed row: a normal tap
  swipe(bodyOf(), [300, 200, 100]);
  fireEvent.click(screen.getByRole("button", { name: "Open the sender" }));
  expect(open).toHaveBeenCalledTimes(1);          // open row: swallowed
  expect(bodyOf().style.transform).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Open the sender" }));
  expect(open).toHaveBeenCalledTimes(2);          // closed again
});

test("the click that ends a drag is not a tap on the row", () => {
  const open = vi.fn();
  render(
    <SwipeRow trailing={[act1("Trash", () => {})]}>
      <button type="button" onClick={open}>Open the sender</button>
    </SwipeRow>);
  swipe(bodyOf(), [300, 280, 270], { step: 400 });   // too short: snaps back
  fireEvent.click(screen.getByRole("button", { name: "Open the sender" }));
  expect(open).not.toHaveBeenCalled();
});

test("a revealed button closes the row and runs its handler once", () => {
  const more = vi.fn();
  render(row({ trailing: [act1("Trash", () => {}), act1("More", more)] }));
  swipe(bodyOf(), [300, 200, 100]);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(more).toHaveBeenCalledTimes(1);
  expect(bodyOf().style.transform).toBe("");
});

test("revealed buttons are real buttons, at least 44 px wide", () => {
  render(row({ trailing: [act1("Trash", () => {})] }));
  swipe(bodyOf(), [300, 200, 100]);
  const b = screen.getByRole("button", { name: "Trash" });
  expect(b.tagName).toBe("BUTTON");
  expect(b.className).toContain("min-w-18");   // 72 px
});

test("reduced motion: the row does not follow, the distance decides", () => {
  reduced = true;
  const trash = vi.fn();
  render(row({ trailing: [act1("Trash", trash), act1("More", () => {})] }));
  fire(bodyOf(), "pointerdown", { x: 300, t: 0 });
  fire(window, "pointermove", { x: 250, t: 100 });
  expect(bodyOf().style.transform).toBe("");     // no following
  fire(window, "pointermove", { x: 150, t: 200 });
  fire(window, "pointerup", { x: 150, t: 300 });
  expect(bodyOf().style.transform).toBe("translateX(-144px)");
  expect(bodyOf().style.transition).toBe("none");   // and no animation
  swipe(bodyOf(), [350, 250, 40]);                  // full swipe still works
  expect(trash).toHaveBeenCalledTimes(1);
});

test("the row never loses its children when the swipe is off", () => {
  coarse = false;
  render(row({ trailing: [act1("Trash", () => {})] }, "Plain row"));
  expect(screen.getByRole("button", { name: "Plain row" })).toBeTruthy();
});
