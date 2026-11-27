// @vitest-environment jsdom
/* The All mail builder offers one more per-mail flag, `automatic mail`
 * (is:auto), after `past its date` (is:expired); today's flags keep their
 * order, and the group-level builder does not offer it (it is a mail word). */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { QueryBuilder } from "./components/QueryBuilder";
import { setLang } from "./i18n";

beforeEach(() => setLang("en"));
afterEach(() => { cleanup(); setLang("en"); });

test("mailOnly: `automatic mail` follows `past its date` and writes is:auto; " +
  "the group-level builder does not offer it", () => {
  const onChange = vi.fn();
  const { unmount } = render(<QueryBuilder value="" onChange={onChange}
    mailOnly open onOpenChange={() => {}} />);
  const flags = ["unread", "read", "protected", "past its date",
    "automatic mail"].map((n) => screen.getByRole("button", { name: n }));
  // today's flags keep their order; the new one is last
  for (let i = 1; i < flags.length; i++)
    expect(flags[i - 1].compareDocumentPosition(flags[i])
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(flags[3]);
  expect(onChange).toHaveBeenLastCalledWith("is:expired");
  fireEvent.click(flags[4]);
  expect(onChange).toHaveBeenLastCalledWith("is:auto");
  unmount();
  render(<QueryBuilder value="" onChange={onChange} open
    onOpenChange={() => {}} />);
  expect(screen.queryByRole("button", { name: "automatic mail" })).toBeNull();
});

test("mailOnly, German: the flag reads `automatische Mail`", () => {
  setLang("de");
  const onChange = vi.fn();
  render(<QueryBuilder value="" onChange={onChange} mailOnly open
    onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "automatische Mail" }));
  expect(onChange).toHaveBeenLastCalledWith("is:auto");
});
