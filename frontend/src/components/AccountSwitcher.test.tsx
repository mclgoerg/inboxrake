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
  // each bit is one unbreakable unit and carries its dot in front: a wrapped
  // line may start with a dot but never ends with one, and "227.4 MB"
  // never splits
  const units = [...card.querySelectorAll("span.whitespace-nowrap")]
    .map((s) => s.textContent!);
  expect(units).toContain("· 1,623\u00a0mails");
  expect(units.some((u) => /^· [\d.]+\u00a0MB$/.test(u))).toBe(true);
  expect(units.some((u) => u.endsWith("·"))).toBe(false);
});

/* All accounts: the first card of the list. */

test("All accounts is the first card: stacked avatars, the mailbox count", () => {
  mount({ onAll: vi.fn() });
  const all = screen.getByRole("button", { name: /All accounts/ });
  expect(all.textContent).toContain("3 mailboxes");
  // a decorative stack of the accounts' initials, no text of its own
  const stack = all.querySelector("[aria-hidden='true']")!;
  expect(stack.textContent).toBe("abg");   // shown uppercase by CSS
  const buttons = screen.getAllByRole("button");
  expect(buttons.indexOf(all)).toBeLessThan(
    buttons.indexOf(screen.getByRole("button", { name: /alpha/ })));
});

test("selecting All accounts calls onAll; while it is selected no single " +
  "account is current", () => {
  const onAll = vi.fn();
  mount({ onAll });
  fireEvent.click(screen.getByRole("button", { name: /All accounts/ }));
  expect(onAll).toHaveBeenCalledOnce();
  cleanup();
  const h = mount({ onAll, scopeAll: true });
  const all = screen.getByRole("button", { name: /All accounts/ });
  expect(all.getAttribute("aria-current")).toBe("true");
  expect(screen.getByRole("button", { name: /alpha/ })
    .getAttribute("aria-current")).toBeNull();
  // the card that is already selected does nothing; another account switches
  fireEvent.click(all);
  expect(onAll).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /alpha/ }));
  expect(h.onSwitch).toHaveBeenCalledWith("alpha");
});

test("in a menu All accounts is a radio item", () => {
  mount({ menu: true, onAll: vi.fn(), scopeAll: true });
  expect(screen.getByRole("menuitemradio", { name: /All accounts/ })
    .getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("menuitemradio", { name: /alpha/ })
    .getAttribute("aria-checked")).toBe("false");
});

test("no All accounts item without a handler, or with a single account", () => {
  mount();
  expect(screen.queryByRole("button", { name: /All accounts/ })).toBeNull();
  cleanup();
  const one = { default_account: "alpha",
    accounts: { alpha: cfg.accounts.alpha } } as unknown as Config;
  mount({ onAll: vi.fn(), cfg: one });
  expect(screen.queryByRole("button", { name: /All accounts/ })).toBeNull();
});

test("German: Alle Konten, with the mailbox count", async () => {
  const { setLang } = await import("../i18n");
  setLang("de");
  mount({ onAll: vi.fn() });
  expect(screen.getByRole("button", { name: /Alle Konten/ }).textContent)
    .toContain("3 Postfächer");
  setLang("en");
});
