// @vitest-environment jsdom
/* V8: every overlay (modal, sheet, dialog, in-panel reader) owns one history
   entry, so Back closes the top-most one and nothing is left behind when it
   closes another way; pages (tool pages, the split pane) own none. jsdom
   runs history traversals as tasks, so each Back is awaited with `settle()`. */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { afterBackSettles, backStackBusy, disposeBackStack, resetBackStack } from "./backStack";
import { Modal, PageScope, PageSlot, useBackLayer } from "./components/ui";

let wide = false;
let pushes: ReturnType<typeof vi.spyOn>;
let replaces: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  wide = false;
  resetBackStack();
  pushes = vi.spyOn(window.history, "pushState");
  replaces = vi.spyOn(window.history, "replaceState");
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: wide && q.includes("1024"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(async () => {
  cleanup();
  await settle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 5));
    if (!backStackBusy()) break;
  }
  await new Promise((r) => setTimeout(r, 5));
});
const back = async () => { act(() => { window.history.back(); }); await settle(); };
/** Layer entries pushed so far (`irkLayer` state), swaps counted apart. */
const layerPushes = () => pushes.mock.calls
  .filter((c: unknown[]) => (c[0] as { irkLayer?: string } | null)?.irkLayer).length;
const layerSwaps = () => replaces.mock.calls
  .filter((c: unknown[]) => (c[0] as { irkLayer?: string } | null)?.irkLayer).length;
const onLayer = () => !!(window.history.state as { irkLayer?: string } | null)
  ?.irkLayer;

/** A page that opens the given modal kinds on demand. */
function Host({ nested = false, onCloseA }: { nested?: boolean;
  onCloseA?: () => void }) {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <div>
      <button onClick={() => setA(true)}>open a</button>
      {a && (
        <Modal label="Tool" full onClose={() => { onCloseA?.(); setA(false); }}>
          <button onClick={() => setA(false)}>close a</button>
          <button onClick={() => setB(true)}>open b</button>
          {nested && b && (
            <Modal label="Reader" full onClose={() => setB(false)}>
              <button onClick={() => setB(false)}>close b</button>
            </Modal>
          )}
        </Modal>
      )}
    </div>
  );
}
const open = (name: string) => act(() => { fireEvent.click(screen.getByText(name)); });
const has = (name: string) => !!screen.queryByRole("dialog", { name });

test("opening a modal pushes one entry; Back closes it and stays on the page", async () => {
  window.location.hash = "#/senders";
  render(<Host />);
  open("open a");
  await settle();
  expect(layerPushes()).toBe(1);
  expect(onLayer()).toBe(true);
  expect(window.location.hash).toBe("#/senders");
  expect(has("Tool")).toBe(true);
  await back();
  expect(has("Tool")).toBe(false);
  expect(window.location.hash).toBe("#/senders");
});

test("closing with the in-panel button pops the entry: no stale entry, no double step", async () => {
  window.location.hash = "#/senders";
  render(<Host />);
  open("open a");
  await settle();
  open("close a");
  await settle();
  expect(has("Tool")).toBe(false);
  // The next Back leaves the page, not a leftover modal entry.
  expect(onLayer()).toBe(false);
  open("open a");
  await settle();
  fireEvent.keyDown(window, { key: "Escape" });
  await settle();
  expect(has("Tool")).toBe(false);
  expect(onLayer()).toBe(false);
});

test("nested modals stack: each Back closes only the top-most", async () => {
  render(<Host nested />);
  open("open a");
  await settle();
  open("open b");
  await settle();
  expect(has("Reader")).toBe(true);
  await back();
  expect(has("Reader")).toBe(false);
  expect(has("Tool")).toBe(true);
  await back();
  expect(has("Tool")).toBe(false);
});

test("closing the lower and the upper in one commit pops both entries", async () => {
  render(<Host nested />);
  open("open a");
  await settle();
  open("open b");
  await settle();
  open("close a");   // unmounts the tool and the reader inside it
  await settle();
  expect(has("Tool")).toBe(false);
  expect(onLayer()).toBe(false);
});

test("one modal replacing another in the same tick keeps a single entry", async () => {
  function Swap() {
    const [which, setWhich] = useState<"a" | "b" | null>(null);
    return (<>
      <button onClick={() => setWhich("a")}>open a</button>
      {which === "a" && <Modal label="A" full onClose={() => setWhich(null)}>
        <button onClick={() => setWhich("b")}>to b</button></Modal>}
      {which === "b" && <Modal label="B" full onClose={() => setWhich(null)}>
        <p>b</p></Modal>}
    </>);
  }
  render(<Swap />);
  open("open a");
  await settle();
  open("to b");
  await settle();
  expect(has("B")).toBe(true);
  expect(layerPushes()).toBe(1);    // swapped in place, no back + push
  expect(layerSwaps()).toBe(1);
  await back();
  expect(has("B")).toBe(false);
  expect(has("A")).toBe(false);
});

test("a close that refuses (a discard prompt) keeps the modal and gets its entry back", async () => {
  function Draft() {
    const [on, setOn] = useState(true);
    const [dirty, setDirty] = useState(true);
    return on ? (
      <Modal label="Editor" full
        onClose={() => { if (!dirty) setOn(false); }}>
        <button onClick={() => setDirty(false)}>discard</button>
      </Modal>
    ) : null;
  }
  window.location.hash = "#/senders";
  render(<Draft />);
  await settle();
  await back();
  await settle();
  expect(has("Editor")).toBe(true);   // still open: the Back was refused
  expect(onLayer()).toBe(true);       // ... with its entry put back
  open("discard");
  await back();                       // now Back is allowed to close it
  expect(has("Editor")).toBe(false);
  expect(onLayer()).toBe(false);
});

test("an overlay gets an entry at every width: a modal at 1024-1279 and a dialog over a tool page", async () => {
  wide = true;
  render(<Host />);
  open("open a");
  await settle();
  expect(layerPushes()).toBe(1);
  await back();
  expect(has("Tool")).toBe(false);
  cleanup();
  // a tool PAGE (slot) is a route, not an overlay; a dialog over it is one
  render(<PageSlot page parent="Clean up">
    <Modal label="Page" full onClose={() => {}}>
      <Modal size="sm" label="Confirm" onClose={() => {}}><p>x</p></Modal>
    </Modal>
  </PageSlot>);
  await settle();
  expect(layerPushes()).toBe(2);   // only the dialog
});

test("a reader on a page (PageScope: tool page, split pane) has no entry; in an overlay it has one", async () => {
  function Reader() {
    useBackLayer(true, () => {});
    return <p>reader</p>;
  }
  wide = true;
  render(<PageScope><Reader /></PageScope>);
  await settle();
  expect(layerPushes()).toBe(0);
  cleanup();
  render(<Modal label="M" full onClose={() => {}}><Reader /></Modal>);
  await settle();
  expect(layerPushes()).toBe(2);
});

test("Forward after Back closes nothing and steps back off the dead entry", async () => {
  render(<Host nested />);
  open("open a");
  await settle();
  open("open b");
  await settle();
  await back();                       // the reader closes
  expect(has("Reader")).toBe(false);
  act(() => { window.history.forward(); });
  await settle();
  expect(has("Tool")).toBe(true);     // not closed by the Forward
  expect(has("Reader")).toBe(false);  // and nothing reopened
  expect(onLayer()).toBe(true);       // sitting on the tool's own entry again
  await back();
  expect(has("Tool")).toBe(false);
  expect(onLayer()).toBe(false);      // no dead Back left
});

test("Forward after closing the only overlay leaves no dead Back", async () => {
  render(<Host />);
  open("open a");
  await settle();
  await back();
  expect(has("Tool")).toBe(false);
  act(() => { window.history.forward(); });
  await settle();
  expect(has("Tool")).toBe(false);
  expect(onLayer()).toBe(false);
});

test("a routed tool (deep link) and a page have no entry of their own", async () => {
  render(<PageSlot page={false} parent="Clean up" entry={false}>
    <Modal label="Routed" full onClose={() => {}}><p>x</p></Modal>
  </PageSlot>);
  await settle();
  expect(layerPushes()).toBe(0);
  cleanup();
  render(<PageSlot page parent="Clean up">
    <Modal label="Page" full onClose={() => {}}><p>x</p></Modal>
  </PageSlot>);
  await settle();
  expect(layerPushes()).toBe(0);
});

test("a dialog opened from a routed tool still stacks", async () => {
  render(<PageSlot page={false} parent="Clean up" entry={false}>
    <Modal label="Routed" full onClose={() => {}}>
      <Modal size="sm" label="Confirm" onClose={() => {}}><p>x</p></Modal>
    </Modal>
  </PageSlot>);
  await settle();
  expect(layerPushes()).toBe(1);   // the confirm; the routed tool has none
});

test("a modal that opts out (the first-run wizard) has no entry", async () => {
  render(<Modal label="Wizard" full backLayer={false} onClose={() => {}}>
    <p>x</p></Modal>);
  await settle();
  expect(layerPushes()).toBe(0);
});

test("a page change waits for the pop and the overlay's entry is gone, not buried", async () => {
  window.location.hash = "#/overview";
  render(<Host />);
  open("open a");
  await settle();
  const seen: string[] = [];
  const on = () => seen.push(window.location.hash);
  window.addEventListener("hashchange", on);
  act(() => {
    afterBackSettles(() => { window.location.hash = "#/senders"; });
  });
  await settle();
  window.removeEventListener("hashchange", on);
  expect(seen).toEqual(["#/senders"]);
  // Back from the new page lands on the old one, not on a leftover modal entry.
  expect(onLayer()).toBe(false);
  await back();
  expect(window.location.hash).toBe("#/overview");
});
test("an in-panel reader (useBackLayer) closes on Back; closing it itself pops the entry", async () => {
  function Panel() {
    const [reading, setReading] = useState(false);
    useBackLayer(reading, () => setReading(false));
    return (<>
      <button onClick={() => setReading(true)}>read</button>
      {reading && <p>the mail</p>}
      {reading && <button onClick={() => setReading(false)}>back to list</button>}
    </>);
  }
  render(<Panel />);
  open("read");
  await settle();
  expect(onLayer()).toBe(true);
  await back();
  expect(screen.queryByText("the mail")).toBeNull();
  open("read");
  await settle();
  open("back to list");
  await settle();
  expect(screen.queryByText("the mail")).toBeNull();
  expect(onLayer()).toBe(false);
  expect(layerPushes()).toBe(2);
});

/** A fresh copy of the module, as after a reload: history kept, memory gone. */
async function reloaded() {
  disposeBackStack();            // this copy is "gone with the old page"
  vi.resetModules();
  return await import("./backStack");
}

test("reload: leftover layer entries are stepped off until none is current", async () => {
  window.location.hash = "#/senders";
  window.history.pushState({ irkLayer: "x1.1" }, "");
  window.history.pushState({ irkLayer: "x1.2" }, "");
  await reloaded();
  await settle();
  expect(onLayer()).toBe(false);
  expect(window.location.hash).toBe("#/senders");
});

test("reload: a new layer never matches an old entry, so its first Back works", async () => {
  window.location.hash = "#/senders";
  window.history.pushState({ irkLayer: "l1" }, "");   // what the old load called its first
  const fresh = await reloaded();
  await settle();
  const close = vi.fn();
  const off = fresh.registerBackLayer(close);
  await settle(); await new Promise((r) => setTimeout(r, 20));
  expect(onLayer()).toBe(true);
  act(() => { window.history.back(); });
  await new Promise((r) => setTimeout(r, 40));
  expect(close).toHaveBeenCalledTimes(1);
  off();
  fresh.disposeBackStack();
});
