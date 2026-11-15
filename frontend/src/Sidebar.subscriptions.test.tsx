// @vitest-environment jsdom
/* The Subscriptions item of the sidebar: its count, and the route. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Sidebar } from "./components/Sidebar";
import { setLang } from "./i18n";
import { TOOL_PAGES, TOOL_TAB } from "./nav";

afterEach(() => { cleanup(); setLang("en"); });

const mount = (n?: number) => {
  const onOpen = vi.fn();
  render(<Sidebar page="overview" onPage={() => {}} onOpen={onOpen}
    account={null} disabled={{}} subscriptions={n} />);
  return onOpen;
};

test("a Subscriptions item under Insights with the count of what was found", () => {
  const onOpen = mount(6);
  const item = screen.getByRole("button", { name: /Subscriptions/ });
  expect(item.textContent).toContain("6");
  fireEvent.click(item);
  expect(onOpen).toHaveBeenCalledWith("subscriptions");
});

test("no count before there is one", () => {
  mount(undefined);
  expect(screen.getByRole("button", { name: "Subscriptions" }).textContent)
    .toBe("Subscriptions");
  cleanup();
  mount(0);
  expect(screen.getByRole("button", { name: "Subscriptions" }).textContent)
    .toBe("Subscriptions");
});

test("German name", () => {
  setLang("de");
  mount(2);
  expect(screen.getByRole("button", { name: /Abos/ })).toBeTruthy();
});

test("it is a tool page that lives on the Insights tab below 1024 px", () => {
  expect(TOOL_PAGES).toContain("subscriptions");
  expect(TOOL_TAB.subscriptions).toBe("insights");
});
