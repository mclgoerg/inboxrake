// @vitest-environment jsdom
/* BulkBar on a phone: the actions take their own width (and grow), so a row
 * that is too narrow for them AND the primary button wraps the primary below
 * instead of letting the buttons slide under it (a 320 px screen, a long German
 * label). From md up nothing changes: the capsule's row stays as it was. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { BarButton, BulkBar } from "./components/ui";

afterEach(cleanup);

test("the actions row can wrap on a phone and keeps its md layout", () => {
  render(<BulkBar summary="2 selected" onClear={() => {}}
    actions={<BarButton icon={<span />}>Archive</BarButton>}
    primary={<button type="button">Trash selected (2)</button>} />);
  const actions = screen.getByRole("button", { name: "Archive" }).parentElement!;
  expect(actions.className).toContain("max-md:grow");
  expect(actions.className).toContain("md:flex-none");
  // not a zero-basis item, which never makes its row wrap
  expect(actions.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
  const row = actions.parentElement!;
  expect(row.className).toContain("flex-wrap");
  expect(row.className).toContain("md:flex-nowrap");
  expect(screen.getByText("Trash selected (2)").parentElement!.className)
    .toContain("max-md:ml-auto");
});
