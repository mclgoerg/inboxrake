// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AccountSwitcher } from "./AccountSwitcher";
import type { Config } from "../types";

const im = (over: object) => ({
  excluded_folders: [], host: "h", port: 993, security: "ssl", smtp_host: "",
  smtp_port: 587, smtp_security: "auto", user: "", password: "",
  password_set: true, verified: true, cafile: "", preset: "custom",
  oauth: null, ...over });
const cfg = { default_account: "alpha", accounts: {
  alpha: im({ user: "a@one.example" }),
  beta: im({ user: "b@two.example" }),
  gamma: im({ user: "c@three.example", verified: false }),
} } as unknown as Config;
const summary = {
  alpha: { status: "done", scanned_ts: 1, mails: 1623, size: 238000000 },
  beta: { status: "idle", scanned_ts: null, mails: 0, size: 0 },
  gamma: { status: "idle", scanned_ts: null, mails: 0, size: 0 },
};

afterEach(cleanup);

const mount = (over: object = {}) => {
  const h = { onSwitch: vi.fn(), onFix: vi.fn(), onAdd: vi.fn(),
    onSettings: vi.fn(), onActivity: vi.fn(), onAppearance: vi.fn() };
  render(<AccountSwitcher menu={false} cfg={cfg} account="alpha"
    summary={summary} appearance="dark" {...h} {...over} />);
  return h;
};

test("a card per account shows address, status, mails and size", () => {
  mount();
  const card = screen.getByRole("button", { name: /alpha/ });
  expect(card.getAttribute("aria-current")).toBe("true");
  expect(card.textContent).toContain("a@one.example");
  expect(card.textContent).toContain("Signed in");
  expect(card.textContent).toContain("1,623\u00a0mails");
  expect(screen.getByRole("button", { name: /beta/ }).textContent)
    .toContain("not scanned yet");
});

test("tapping another account switches; the active card does nothing", () => {
  const h = mount();
  fireEvent.click(screen.getByRole("button", { name: /alpha/ }));
  expect(h.onSwitch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /beta/ }));
  expect(h.onSwitch).toHaveBeenCalledWith("beta");
});

test("a broken account still switches on tap; its fix link opens settings", () => {
  const h = mount();
  const card = screen.getByRole("button", { name: /gamma/ });
  expect(card.textContent).not.toContain("Sign-in failed");
  fireEvent.click(card);
  expect(h.onSwitch).toHaveBeenCalledWith("gamma");
  expect(h.onFix).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sign-in failed - fix it" }));
  expect(h.onFix).toHaveBeenCalledWith("gamma");
  expect(h.onSwitch).toHaveBeenCalledTimes(1);
});

test("a scanning account says Scanning…; one mail is singular", () => {
  mount({ summary: {
    ...summary,
    beta: { status: "scanning", scanned_ts: null, mails: 0, size: 0 },
    alpha: { status: "done", scanned_ts: 1, mails: 1, size: 2048 } } });
  expect(screen.getByRole("button", { name: /beta/ }).textContent)
    .toContain("Scanning…");
  expect(screen.getByRole("button", { name: /beta/ }).textContent)
    .not.toContain("not scanned yet");
  expect(screen.getByRole("button", { name: /alpha/ }).textContent)
    .toContain("1\u00a0mail · 2\u00a0KB");
});

test("Add account, Appearance, Settings and Activity call their handlers", () => {
  const h = mount();
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  expect(h.onAdd).toHaveBeenCalledOnce();
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Appearance" }))
    .getByRole("radio", { name: "Light" }));
  expect(h.onAppearance).toHaveBeenCalledWith("light");
  fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
  fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
  expect(h.onSettings).toHaveBeenCalledOnce();
  expect(h.onActivity).toHaveBeenCalledOnce();
});

test("in a menu the cards and rows are menu items; no Empty Trash", () => {
  mount({ menu: true });
  expect(screen.getByRole("menuitemradio", { name: /alpha/ })
    .getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeTruthy();
  expect(screen.queryByText(/Empty Trash/)).toBeNull();
});

test("count and size of an account never split across lines", () => {
  mount();
  const card = screen.getByRole("button", { name: /alpha/ });
  // "1,623 mails · 238 MB" is one unbreakable unit: a wrapped line breaks
  // after the dot before it, so "227.4 MB" never sits alone
  const unit = [...card.querySelectorAll("span.whitespace-nowrap")]
    .find((s) => s.textContent!.includes("1,623\u00a0mails"))!;
  expect(unit.textContent).toMatch(/^1,623\u00a0mails · [\d.]+\u00a0MB$/);
});
