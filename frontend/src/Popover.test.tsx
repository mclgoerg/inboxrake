// @vitest-environment jsdom
/* The Popover primitive: a panel beside an anchor, for what a menu item opens.
   Placement against the viewport, focus on the first item, arrows, Esc, a
   press outside, Tab - and focus back on the anchor's button. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MenuItem, Popover } from "./components/ui";

const rect = (r: Partial<DOMRect>) => ({ left: 0, right: 0, top: 0, bottom: 0,
  width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...r }) as DOMRect;

/** An anchor with a button, and a popover that is open from the start. */
function Host({ up = false, onClose = () => {} }: {
  up?: boolean; onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div ref={ref}><button type="button">Anchor</button></div>
      <button type="button">Elsewhere</button>
      {open && (
        <Popover anchor={ref} up={up} label="Pick one"
          onClose={() => { setOpen(false); onClose(); }}>
          <MenuItem>First</MenuItem>
          <MenuItem disabled>Second</MenuItem>
          <MenuItem>Third</MenuItem>
        </Popover>
      )}
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 800);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The anchor sits at x 600..700, y 100..140; the popover is 288 x 150. */
function geometry() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? rect({ width: 288, height: 150 })
        : this.querySelector(":scope > button")?.textContent === "Anchor"
          ? rect({ left: 600, right: 700, top: 100, bottom: 140, width: 100, height: 40 })
          : rect({});
    });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
}

test("it is a labelled menu beside the anchor: right edge on the anchor's, just below it", () => {
  geometry();
  render(<Host />);
  const pop = screen.getByRole("menu", { name: "Pick one" });
  expect(pop.style.left).toBe("412px");          // 700 - 288
  expect(pop.style.top).toBe("144px");           // 140 + 4
  expect(pop.style.opacity).toBe("1");
});

test("with `up` it opens above the anchor when there is room, and flips below when there is not", () => {
  const at = (top: number) => vi.spyOn(HTMLElement.prototype,
    "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menu" ? rect({ width: 288, height: 150 })
      : this.querySelector(":scope > button")?.textContent === "Anchor"
        ? rect({ left: 600, right: 700, top, bottom: top + 40 }) : rect({});
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
  at(500);
  const { unmount } = render(<Host up />);
  const pop = screen.getByRole("menu", { name: "Pick one" });
  expect(pop.style.bottom).toBe("308px");        // 800 - 500 + 8
  expect(pop.style.top).toBe("");
  unmount();
  vi.restoreAllMocks();
  at(100);                                       // no room above: below it
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
  render(<Host up />);
  expect(screen.getByRole("menu").style.top).toBe("144px");
});

test("it stays 8 px inside the viewport", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? rect({})
        : this.querySelector(":scope > button")?.textContent === "Anchor"
          ? rect({ left: 0, right: 100, top: 100, bottom: 140 }) : rect({});
    });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
  render(<Host />);
  expect(screen.getByRole("menu").style.left).toBe("8px");
});

test("focus lands on the first enabled item; arrows skip the disabled one and wrap", () => {
  geometry();
  render(<Host />);
  const pop = screen.getByRole("menu");
  expect(document.activeElement?.textContent).toBe("First");
  fireEvent.keyDown(pop, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toBe("Third");   // Second is off
  fireEvent.keyDown(pop, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toBe("First");
  fireEvent.keyDown(pop, { key: "ArrowUp" });
  expect(document.activeElement?.textContent).toBe("Third");
  fireEvent.keyDown(pop, { key: "Home" });
  expect(document.activeElement?.textContent).toBe("First");
  fireEvent.keyDown(pop, { key: "End" });
  expect(document.activeElement?.textContent).toBe("Third");
});

test("Escape closes it, nothing else sees the key, and focus goes back to the anchor's button", () => {
  geometry();
  const onClose = vi.fn();
  const elsewhere = vi.fn();
  window.addEventListener("keydown", elsewhere);
  render(<Host onClose={onClose} />);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Anchor");
  expect(elsewhere).not.toHaveBeenCalled();     // stopPropagation at the document
  window.removeEventListener("keydown", elsewhere);
});

test("a press outside closes it; a press on the anchor or inside does not", () => {
  geometry();
  const onClose = vi.fn();
  render(<Host onClose={onClose} />);
  fireEvent.mouseDown(screen.getByText("Anchor"));
  fireEvent.mouseDown(screen.getByRole("menu"));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.mouseDown(screen.getByText("Elsewhere"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("Tab closes it and hands focus back, so the browser moves on from the anchor", () => {
  geometry();
  render(<Host />);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Anchor");
});

test("it closes when the anchor scrolls out of view", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? rect({ width: 288, height: 150 })
        : this.querySelector(":scope > button")?.textContent === "Anchor"
          ? rect({ left: 600, right: 700, top: -200, bottom: -160 }) : rect({});
    });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(150);
  const onClose = vi.fn();
  render(<Host onClose={onClose} />);
  fireEvent.scroll(document);
  expect(onClose).toHaveBeenCalled();
});
