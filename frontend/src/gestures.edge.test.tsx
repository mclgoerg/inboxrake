// @vitest-environment jsdom
/* Edge swipe back (V5): only in an installed app, only from the left 20 px,
   only for the page on top, through the page's own back handler. */

import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useEdgeBack } from "./gestures";
import { Modal, PageSlot } from "./components/ui";
import { ReaderFrame } from "./components/MailReader";

const WIDTH = 390;
let standalone = true;
let reduced = false;

beforeEach(() => {
  standalone = true;
  reduced = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: (standalone && q.includes("display-mode: standalone"))
      || (reduced && q.includes("reduced-motion")),
    media: q, addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(WIDTH);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Ev = { x: number; y?: number; t: number; type?: string };

function fire(target: Element | Window | Document, name: string, e: Ev) {
  const ev = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    clientX: { value: e.x }, clientY: { value: e.y ?? 0 },
    pointerId: { value: 1 }, isPrimary: { value: true },
    pointerType: { value: e.type ?? "touch" }, timeStamp: { value: e.t },
  });
  act(() => { target.dispatchEvent(ev); });
  return ev;
}

/** Down at xs[0] (on `on`), move through the rest, release at the last. */
function drag(on: Element, xs: number[], opts: { y?: number[]; step?: number;
  type?: string } = {}) {
  const step = opts.step ?? 100;
  const y = (i: number) => opts.y?.[i] ?? 0;
  fire(on, "pointerdown", { x: xs[0], y: y(0), t: 0, type: opts.type });
  xs.slice(1).forEach((x, i) => fire(window, "pointermove",
    { x, y: y(i + 1), t: (i + 1) * step, type: opts.type }));
  fire(window, "pointerup", { x: xs[xs.length - 1], y: y(xs.length - 1),
    t: xs.length * step, type: opts.type });
}

const tool = (onClose: () => void) => (
  <PageSlot page={false} parent="Clean up">
    <Modal label="Tool" onClose={onClose}><p>page</p></Modal>
  </PageSlot>
);
const dlg = (name = "Tool") => screen.getByRole("dialog", { name });

test("in an installed app a drag from the edge past a third closes the tool page", () => {
  const onClose = vi.fn();
  render(tool(onClose));
  fire(dlg(), "pointerdown", { x: 8, t: 0 });
  fire(window, "pointermove", { x: 60, t: 100 });
  fire(window, "pointermove", { x: 150, t: 200 });
  expect(dlg().style.transform).toBe("translateX(142px)");   // follows
  fire(window, "pointerup", { x: 150, t: 1000 });            // 142 > 35 % of 390
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a short, slow drag snaps back and closes nothing", () => {
  const onClose = vi.fn();
  render(tool(onClose));
  drag(dlg(), [8, 40, 90], { step: 400 });
  expect(onClose).not.toHaveBeenCalled();
  expect(dlg().style.transform).toBe("");
});

test("a flick closes over a short distance", () => {
  const onClose = vi.fn();
  render(tool(onClose));
  drag(dlg(), [8, 40, 70], { step: 20 });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("in a browser tab nothing happens: Safari's own back gesture answers", () => {
  standalone = false;
  const onClose = vi.fn();
  render(tool(onClose));
  drag(dlg(), [8, 120, 300]);
  expect(onClose).not.toHaveBeenCalled();
  expect(dlg().style.transform).toBe("");
});

test("a drag that does not start at the left edge is not a back swipe", () => {
  const onClose = vi.fn();
  render(tool(onClose));
  drag(dlg(), [60, 160, 300]);
  expect(onClose).not.toHaveBeenCalled();
});

test("a vertical move or a move to the left is a scroll, not a back swipe", () => {
  const onClose = vi.fn();
  render(tool(onClose));
  drag(dlg(), [8, 12, 20], { y: [100, 160, 240] });
  drag(dlg(), [15, 5, 0]);
  expect(onClose).not.toHaveBeenCalled();
  expect(dlg().style.transform).toBe("");
});

test("a mouse never swipes back", () => {
  const onClose = vi.fn();
  render(tool(onClose));
  drag(dlg(), [8, 120, 300], { type: "mouse" });
  expect(onClose).not.toHaveBeenCalled();
});

test("a dialog on top (a confirm) keeps the page below from swiping away", () => {
  const onClose = vi.fn();
  render(<>{tool(onClose)}
    <Modal size="sm" label="Confirm" onClose={() => {}}><p>sure?</p></Modal></>);
  drag(dlg("Confirm"), [8, 120, 300]);
  expect(onClose).not.toHaveBeenCalled();
});

test("only a page with a back target swipes: a plain dialog does not", () => {
  const onClose = vi.fn();
  render(<Modal label="Plain" onClose={onClose}><p>x</p></Modal>);
  drag(dlg("Plain"), [8, 120, 300]);
  expect(onClose).not.toHaveBeenCalled();
  cleanup();
  render(<Modal label="Detail" full edgeBack onClose={onClose}><p>x</p></Modal>);
  drag(dlg("Detail"), [8, 120, 300]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a bottom sheet never edge-swipes (it has its own swipe down)", () => {
  const onClose = vi.fn();
  render(<Modal size="sm" label="Sheet" edgeBack onClose={onClose}><p>x</p></Modal>);
  drag(dlg("Sheet"), [8, 120, 300]);
  expect(onClose).not.toHaveBeenCalled();
});

test("the page on top is the one that goes back", () => {
  const lower = vi.fn(), upper = vi.fn();
  render(<>
    <Modal label="Lower" full edgeBack onClose={lower}><p>1</p></Modal>
    <Modal label="Upper" full edgeBack onClose={upper}><p>2</p></Modal>
  </>);
  drag(dlg("Upper"), [8, 120, 300]);
  expect(upper).toHaveBeenCalledTimes(1);
  expect(lower).not.toHaveBeenCalled();
});

test("reduced motion: the page does not follow, the distance alone decides", () => {
  reduced = true;
  const onClose = vi.fn();
  render(tool(onClose));
  fire(dlg(), "pointerdown", { x: 8, t: 0 });
  fire(window, "pointermove", { x: 90, t: 100 });
  expect(dlg().style.transform).toBe("");
  fire(window, "pointermove", { x: 200, t: 200 });
  fire(window, "pointerup", { x: 200, t: 1000 });
  expect(onClose).toHaveBeenCalledTimes(1);
});

function Page({ back, enabled = true }: { back: () => void; enabled?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  useEdgeBack(el, back, enabled);
  return <div ref={el} data-testid="page">page</div>;
}

test("useEdgeBack works on any page element and lets go when it unmounts or is off", () => {
  const back = vi.fn();
  const { rerender, unmount } = render(<Page back={back} />);
  drag(screen.getByTestId("page"), [8, 120, 300]);
  expect(back).toHaveBeenCalledTimes(1);
  rerender(<Page back={back} enabled={false} />);
  drag(screen.getByTestId("page"), [8, 120, 300]);
  expect(back).toHaveBeenCalledTimes(1);
  rerender(<Page back={back} />);
  unmount();
  drag(document.body, [8, 120, 300]);
  expect(back).toHaveBeenCalledTimes(1);
});

test("the latest back handler is the one called", () => {
  const first = vi.fn(), second = vi.fn();
  const { rerender } = render(<Page back={first} />);
  rerender(<Page back={second} />);
  drag(screen.getByTestId("page"), [8, 120, 300]);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test("a reader inside a tool: the swipe closes the reader, not the tool "
  + "(and not while a dialog covers the reader)", () => {
  const onClose = vi.fn();
  const onBack = vi.fn();
  const mail = { uid: 1, folder: "INBOX", date: "2025-01-01", ts: 0,
    subject: "Hello", addr: "a@x.example", size: 1, seen: true, ai: null };
  const pin = { can: false, on: false, toggle: () => {} };
  const reader = (open: boolean, extra: React.ReactNode = null) => (
    <PageSlot page={false} parent="Clean up">
      <Modal label="Tool" onClose={onClose}>
        {open && <ReaderFrame mail={mail} pin={pin} onBack={onBack}>
          <p>body</p>
        </ReaderFrame>}
      </Modal>
      {extra}
    </PageSlot>);
  const { rerender } = render(reader(false));
  rerender(reader(true));                    // opened from the tool
  drag(dlg(), [8, 120, 300]);
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  onBack.mockClear();
  rerender(reader(true, <Modal size="sm" label="Confirm" onClose={() => {}}>
    <p>sure?</p></Modal>));
  drag(dlg("Confirm"), [8, 120, 300]);
  expect(onBack).not.toHaveBeenCalled();
});
