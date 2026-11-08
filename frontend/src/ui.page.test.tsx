// @vitest-environment jsdom
/* UX3-10: a top-level Modal under PageSlot is a page, not a dialog. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { isModalOpen, Modal, PageSlot, PanelHeader } from "./components/ui";

afterEach(cleanup);

test("a Modal under PageSlot renders inline: no dialog, not on the stack, "
  + "no close button, Esc does nothing", () => {
  const onClose = vi.fn();
  render(<PageSlot page>
    <Modal onClose={onClose} label="Things" full>
      <PanelHeader title="Things" onClose={onClose} />
      <p>body</p>
    </Modal>
  </PageSlot>);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("region", { name: "Things" })).toBeTruthy();
  expect(screen.getByText("body")).toBeTruthy();
  expect(isModalOpen()).toBe(false);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});

test("a header with its own back label keeps its button on a page", () => {
  const back = vi.fn();
  render(<PageSlot page>
    <Modal onClose={() => {}}>
      <PanelHeader title="Mail" onClose={back} closeLabel="Back" />
    </Modal>
  </PageSlot>);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(back).toHaveBeenCalled();
});

test("a Modal opened from inside a page is a real dialog again", () => {
  const inner = vi.fn();
  render(<PageSlot page>
    <Modal onClose={() => {}} full>
      <PanelHeader title="Page" onClose={() => {}} />
      <Modal size="sm" onClose={inner} label="Sure?">
        <PanelHeader title="Sure?" onClose={inner} />
      </Modal>
    </Modal>
  </PageSlot>);
  const dlg = screen.getByRole("dialog", { name: "Sure?" });
  expect(dlg).toBeTruthy();
  expect(isModalOpen()).toBe(true);
  // only the dialog has a close button; Esc closes just the dialog
  expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(inner).toHaveBeenCalledTimes(1);
});

test("a scrolling page Modal body is a scroll-memory scroller; a dialog's is not", () => {
  const { container, unmount } = render(<PageSlot page>
    <Modal onClose={() => {}} label="Things"><p>body</p></Modal>
  </PageSlot>);
  expect(container.querySelector('[data-scroll-id="page"]')).toBeTruthy();
  unmount();
  render(<Modal onClose={() => {}} label="Dlg" size="lg"><p>body</p></Modal>);
  expect(document.querySelector("[data-scroll-id]")).toBeNull();
});
