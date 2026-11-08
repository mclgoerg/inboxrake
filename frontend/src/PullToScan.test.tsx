// @vitest-environment jsdom
/* Pull to scan (V5): a vertical pull from the top of the page past the
   threshold calls the Scan handler; everything else stays a scroll. */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { PullToScan } from "./components/PullToScan";
import { Modal } from "./components/ui";

let reduced = false;
beforeEach(() => {
  reduced = false;
  document.body.scrollTop = 0;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduced && q.includes("reduced-motion"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function touch(name: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    x: number, y: number) {
  const ev = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", {
    value: name === "touchend" || name === "touchcancel" ? [] : [{ clientX: x, clientY: y }],
  });
  act(() => { document.body.dispatchEvent(ev); });
  return ev;
}
const pull = (dy: number, dx = 0, ys = [dy]) => {
  touch("touchstart", 200, 100);
  ys.forEach((y) => touch("touchmove", 200 + dx, 100 + y));
  touch("touchend", 200 + dx, 100 + dy);
};

test("a long pull from the top calls the scan once", () => {
  const onPull = vi.fn();
  render(<PullToScan enabled onPull={onPull} />);
  pull(200, 0, [20, 80, 200]);
  expect(onPull).toHaveBeenCalledTimes(1);
});

test("the ring and its hint show while pulling and go on release", () => {
  render(<PullToScan enabled onPull={() => {}} />);
  expect(document.querySelector("[data-pull-to-scan]")).toBeNull();
  touch("touchstart", 200, 100);
  touch("touchmove", 200, 130);
  const el = document.querySelector("[data-pull-to-scan]")!;
  expect(el).toBeTruthy();
  expect(el.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByText("Pull to scan")).toBeTruthy();
  touch("touchmove", 200, 300);
  expect(screen.getByText("Release to scan")).toBeTruthy();
  touch("touchend", 200, 300);
  expect(document.querySelector("[data-pull-to-scan]")).toBeNull();
});

test("the browser's own scroll is stopped while pulling", () => {
  render(<PullToScan enabled onPull={() => {}} />);
  touch("touchstart", 200, 100);
  const ev = touch("touchmove", 200, 200);
  expect(ev.defaultPrevented).toBe(true);
});

test("a short pull does not scan", () => {
  const onPull = vi.fn();
  render(<PullToScan enabled onPull={onPull} />);
  pull(50, 0, [20, 50]);
  expect(onPull).not.toHaveBeenCalled();
});

test("not when the page is scrolled down", () => {
  const onPull = vi.fn();
  render(<PullToScan enabled onPull={onPull} />);
  document.body.scrollTop = 120;
  pull(200, 0, [100, 200]);
  expect(onPull).not.toHaveBeenCalled();
});

test("scrolling up, or sideways (a row swipe), is not a pull", () => {
  const onPull = vi.fn();
  render(<PullToScan enabled onPull={onPull} />);
  pull(-200, 0, [-100, -200]);
  pull(40, 200, [20, 40]);
  expect(onPull).not.toHaveBeenCalled();
});

test("not while a dialog is open, and not when switched off", () => {
  const onPull = vi.fn();
  const { rerender } = render(<>
    <PullToScan enabled onPull={onPull} />
    <Modal label="Dialog" onClose={() => {}}><p>x</p></Modal></>);
  pull(200, 0, [100, 200]);
  expect(onPull).not.toHaveBeenCalled();
  cleanup();
  const r = render(<PullToScan enabled={false} onPull={onPull} />);
  pull(200, 0, [100, 200]);
  expect(onPull).not.toHaveBeenCalled();
  r.rerender(<PullToScan enabled onPull={onPull} />);
  pull(200, 0, [100, 200]);
  expect(onPull).toHaveBeenCalledTimes(1);
  void rerender;
});

test("a second finger cancels the pull", () => {
  const onPull = vi.fn();
  render(<PullToScan enabled onPull={onPull} />);
  touch("touchstart", 200, 100);
  touch("touchmove", 200, 200);
  const ev = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", { value: [
    { clientX: 200, clientY: 300 }, { clientX: 50, clientY: 300 }] });
  act(() => { document.body.dispatchEvent(ev); });
  touch("touchend", 200, 300);
  expect(onPull).not.toHaveBeenCalled();
});

test("reduced motion: the indicator does not slide, the ring still fills", () => {
  reduced = true;
  render(<PullToScan enabled onPull={() => {}} />);
  touch("touchstart", 200, 100);
  touch("touchmove", 200, 170);
  const el = document.querySelector<HTMLElement>("[data-pull-to-scan]")!;
  expect(el.style.transform).toBe("");
  expect(el.style.opacity).not.toBe("");
});
