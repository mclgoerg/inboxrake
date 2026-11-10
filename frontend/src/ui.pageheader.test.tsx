// @vitest-environment jsdom
/* One page header for every page: PageHeader (page + large variants), how
 * PanelHeader routes to it, and the one tool width on tablets. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Modal, PageHeader, PageSlot, PanelHeader } from "./components/ui";

afterEach(cleanup);

test("page variant: h1 title, subtitle, actions on the right, one fixed height",
  () => {
  const { container } = render(<PageHeader title="Senders"
    sub="scanned 1m ago" actions={<button type="button">Scan</button>} />);
  const head = container.querySelector("[data-page-header='page']")!;
  expect(screen.getByRole("heading", { level: 1 }).textContent)
    .toBe("Senders");
  expect(screen.getByText("scanned 1m ago")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Scan" })).toBeTruthy();
  expect(head.querySelector(".min-h-20")).toBeTruthy();
});

test("page variant without a subtitle keeps the same height and title spot",
  () => {
  const a = render(<PageHeader title="General" />).container;
  const b = render(<PageHeader title="Rules" sub="2 rules" />).container;
  for (const c of [a, b]) {
    const row = c.querySelector("[data-page-header] > div")!;
    expect(row.className).toContain("min-h-20");
    expect(row.className).toContain("items-start");
    expect(row.className).toContain("px-5");
  }
});

test("contain bounds the inner row to the content width", () => {
  const { container } = render(<PageHeader title="General"
    contain="mx-auto max-w-3xl" />);
  expect(container.querySelector("[data-page-header] > div")!.className)
    .toContain("max-w-3xl");
});

test("large variant: back link, actions beside it, then the title", () => {
  const onBack = vi.fn();
  const { container } = render(<PageHeader variant="large" title="Rules"
    sub="2 rules" back={{ label: "Clean up", ariaLabel: "Back to Clean up",
      onClick: onBack }}
    actions={<button type="button">New</button>} />);
  fireEvent.click(screen.getByRole("button", { name: "Back to Clean up" }));
  expect(onBack).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).className)
    .toContain("type-largetitle");
  // the actions are not pulled out beyond the content inset
  expect(container.querySelector("[data-page-header='large'] > div")!.className)
    .not.toContain("-mx-");
});

test("flush large header adds no side padding of its own", () => {
  const { container } = render(<PageHeader variant="large" flush
    title="Settings" />);
  expect(container.querySelector("[data-page-header='large']")!.className)
    .not.toContain("px-4");
});

test("PanelHeader is the page header on a page, with an optional close", () => {
  const onClose = vi.fn();
  const { container } = render(<PageSlot page>
    <Modal onClose={() => {}} label="Mail">
      <PanelHeader title="Mail" onClose={onClose} closeLabel="Back" />
    </Modal>
  </PageSlot>);
  expect(container.querySelector("[data-page-header='page']")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(onClose).toHaveBeenCalled();
});

test("every tool page below 1024 px has the same width", () => {
  const widths = (size?: "md" | "lg", full = false) => {
    const { unmount } = render(<PageSlot page={false} parent="Clean up">
      <Modal onClose={() => {}} size={size} full={full} label="Tool">
        <PanelHeader title="Tool" onClose={() => {}} />
      </Modal>
    </PageSlot>);
    const cls = screen.getByRole("dialog").className;
    unmount();
    return cls.match(/sm:max-w-\S+/)![0];
  };
  const one = widths();
  expect(widths("md")).toBe(one);
  expect(widths("lg")).toBe(one);
  expect(widths(undefined, true)).toBe(one);
});
