// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DE } from "../locales/de";
import { setLang } from "../i18n";
import { resetBackStack } from "../backStack";

vi.mock("../App", () => ({ default: () => <div>the app</div> }));

import { DialogProvider, ToastProvider } from "../components/ui";
import { DemoRoot } from "./DemoRoot";
import { fakeRuntime } from "./fakeWorker";

const SEEN = "pmc_demo_tip";
const mql = (matches: boolean) => (q: string) => ({
  matches: q.includes("1024") ? matches : false, media: q,
  addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;

beforeEach(() => { vi.stubGlobal("matchMedia", mql(true)); });
afterEach(() => {
  cleanup(); setLang("en"); localStorage.clear(); resetBackStack();
  window.location.hash = ""; vi.unstubAllGlobals();
});

const ready = () => {
  const f = fakeRuntime();
  f.runtime.start();
  const view = render(<ToastProvider><DialogProvider>
    <DemoRoot runtime={f.runtime} /></DialogProvider></ToastProvider>);
  act(() => f.last().emit({ type: "ready", clockShiftMs: 0 }));
  return { f, view };
};

test("the bar: DEMO pill, note, Things to try, Reset, Install your own", () => {
  localStorage.setItem(SEEN, "1");
  ready();
  const bar = document.querySelector("[data-demo-bar]") as HTMLElement;
  expect(bar.textContent).toContain("DEMO");
  expect(bar.textContent).toContain("Made-up mailboxes - your changes stay in this tab.");
  const install = screen.getByRole("link", { name: /Install your own/ });
  expect(install.getAttribute("href")).toBe("https://inboxrake.com/docs/install/");
  expect(install.getAttribute("rel")).toContain("noopener");
  expect(screen.getByRole("button", { name: "Reset demo" })).toBeTruthy();
});

test("the bar opens a bar-height hook on <html> while it is up", () => {
  localStorage.setItem(SEEN, "1");
  const { view } = ready();
  expect(document.documentElement.hasAttribute("data-demo")).toBe(true);
  view.unmount();
  expect(document.documentElement.hasAttribute("data-demo")).toBe(false);
});

test("German bar", () => {
  localStorage.setItem(SEEN, "1");
  setLang("de");
  ready();
  expect(screen.getByText(DE["demo.bar.text"])).toBeTruthy();
  expect(screen.getByRole("link", { name: new RegExp(DE["demo.bar.install"]) }))
    .toBeTruthy();
});

test("the tip shows on the first visit, once per browser", () => {
  const first = ready();
  expect(screen.getByRole("dialog", { name: "Three things to try" })).toBeTruthy();
  expect(screen.getByText("ACME Store")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("dialog", { name: "Three things to try" })).toBeNull();
  expect(localStorage.getItem(SEEN)).toBe("1");
  first.view.unmount();
  ready();                                       // a later visit: stays quiet
  expect(screen.queryByRole("dialog", { name: "Three things to try" })).toBeNull();
});

test("Things to try in the bar opens it again", () => {
  localStorage.setItem(SEEN, "1");
  ready();
  fireEvent.click(screen.getByRole("button", { name: "Things to try" }));
  expect(screen.getByRole("dialog", { name: "Three things to try" })).toBeTruthy();
});

test("Esc closes the tip and counts as seen", () => {
  ready();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Three things to try" })).toBeNull();
  expect(localStorage.getItem(SEEN)).toBe("1");
});

test("Show me goes to Senders and closes the tip", async () => {
  ready();
  fireEvent.click(screen.getByRole("button", { name: "Show me" }));
  expect(screen.queryByRole("dialog", { name: "Three things to try" })).toBeNull();
  await vi.waitFor(() => expect(window.location.hash).toBe("#/senders"));
});

test("below 1024 px the tip is a bottom sheet", () => {
  vi.stubGlobal("matchMedia", mql(false));
  ready();
  const sheet = screen.getByRole("dialog", { name: "Three things to try" });
  expect(sheet.getAttribute("aria-modal")).toBe("true");
  expect(sheet.getAttribute("data-size")).toBe("sm");
});

test("German tip", () => {
  setLang("de");
  ready();
  expect(screen.getByRole("dialog", { name: "Drei Dinge zum Ausprobieren" }))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Verstanden" })).toBeTruthy();
});

test("a press outside the popover closes it; one inside does not", () => {
  ready();
  const tip = () => screen.queryByRole("dialog", { name: "Three things to try" });
  fireEvent.pointerDown(screen.getByText("Three things to try"));
  expect(tip()).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(tip()).toBeNull();
  expect(localStorage.getItem(SEEN)).toBe("1");
});

test("the bar's Things to try is not an outside press (it only opens)", () => {
  localStorage.setItem(SEEN, "1");
  ready();
  const btn = screen.getByRole("button", { name: "Things to try" });
  fireEvent.pointerDown(btn);
  fireEvent.click(btn);
  expect(screen.getByRole("dialog", { name: "Three things to try" })).toBeTruthy();
});

test("Reset closes the tip first: never two dialogs", async () => {
  ready();
  fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
  await screen.findByText("Reset the demo?");
  expect(screen.queryByRole("dialog", { name: "Three things to try" })).toBeNull();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

test("on a phone the bar reopens a dismissed tip as a sheet", () => {
  vi.stubGlobal("matchMedia", mql(false));
  localStorage.setItem(SEEN, "1");
  ready();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Things to try" }));
  expect(screen.getByRole("dialog", { name: "Three things to try" })
    .getAttribute("data-size")).toBe("sm");
});
