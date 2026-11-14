// @vitest-environment jsdom
/* Settings -> Notifications: which state the switch is in on this browser
 * (Web Push, the older in-tab fallback, or why neither), the test button and
 * the wording in both languages. push.ts itself is covered by push.test.ts. */

import { act, cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  support: "ok" as string,
  enable: vi.fn(),
  disable: vi.fn(),
  test: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("./push", () => ({
  NOTIFY_KEY: "pmc_notify",
  pushSupport: () => h.support,
  enablePush: (...a: unknown[]) => h.enable(...a),
  disablePush: () => h.disable(),
  sendTestPush: () => h.test(),
  prefetchPushKey: () => h.prefetch(),
}));
vi.mock("./api", () => ({
  api: new Proxy({}, { get: () => () => new Promise(() => {}) }),
  fmtUsd: (n: number) => `$${n}`,
  downloadFile: () => Promise.resolve(),
  errorText: (s: string) => s,
}));

import { SettingsPage } from "./components/SettingsPage";
import { ToastProvider, DialogProvider } from "./components/ui";
import { setDemo } from "./demoMode";
import { setLang } from "./i18n";
import type { Config } from "./types";

const acct = {
  excluded_folders: [] as string[], host: "127.0.0.1", port: 1143,
  security: "ssl" as const, smtp_host: "", smtp_port: 1025,
  smtp_security: "auto" as const, user: "me@proton.example", password: "",
  password_set: true, cafile: "", preset: "proton" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6, align_minute: 0 },
};
const cfg = {
  accounts: { default: acct }, default_account: "default",
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: true, password_set: false,
    oidc: { issuer: "", client_id: "", client_secret_set: false,
      redirect_base: "", allowed: [] } },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "m", foundry_endpoint: "", price_in: 0,
    price_out: 0, budget_usd: 0, month_cost: 0, prices_effective: [2, 10],
    api_key: "", api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
} as unknown as Config;

const page = () => render(
  <ToastProvider><DialogProvider>
    <SettingsPage cfg={cfg} account="default" section="notifications"
      onClose={() => {}} onAddAccount={() => {}} onSaved={() => {}}
      onAccountsChanged={() => {}} onSection={() => {}} />
  </DialogProvider></ToastProvider>);
const sw = () => screen.getByRole("switch", { name: /Notifications|Benachrichtigungen/ });

function notification(permission: NotificationPermission,
                      ask: () => Promise<NotificationPermission> = () => Promise.resolve(permission)) {
  (globalThis as any).Notification = Object.assign(function () {}, {
    permission, requestPermission: ask });
}

beforeEach(() => {
  h.support = "ok";
  h.enable.mockReset().mockResolvedValue("granted");
  h.disable.mockReset().mockResolvedValue(undefined);
  h.test.mockReset().mockResolvedValue(undefined);
  h.prefetch.mockReset().mockResolvedValue("key");
  localStorage.clear();
  notification("default");
});
afterEach(() => {
  cleanup();
  setDemo(false);
  setLang("en");
  delete (globalThis as any).Notification;
});

test("the section says what it does", () => {
  page();
  expect(screen.getAllByText("Notifications").length).toBeGreaterThan(0);
  expect(screen.getByText(/even with Inboxrake closed/)).toBeTruthy();
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(sw().hasAttribute("disabled")).toBe(false);
  expect(screen.queryByRole("button", { name: "Send test notification" })).toBeNull();
});

test("the key is fetched when the section opens, before any tap", () => {
  page();
  expect(h.prefetch).toHaveBeenCalledTimes(1);
});

test("turning it on subscribes with the language and shows the test button", async () => {
  setLang("de");
  page();
  await act(async () => { fireEvent.click(sw()); });
  expect(h.enable).toHaveBeenCalledWith("de");
  await waitFor(() => expect(sw().getAttribute("aria-checked")).toBe("true"));
  expect(screen.getByRole("button", { name: "Testbenachrichtigung senden" })).toBeTruthy();
});

test("the test button sends one and reports it", async () => {
  localStorage.setItem("pmc_notify", "push");
  page();
  fireEvent.click(screen.getByRole("button", { name: "Send test notification" }));
  expect(await screen.findByText("Test notification sent.")).toBeTruthy();
  expect(h.test).toHaveBeenCalledTimes(1);
});

test("a failed test shows the reason", async () => {
  localStorage.setItem("pmc_notify", "push");
  h.test.mockRejectedValue(new Error("The push service answered with error 503."));
  page();
  fireEvent.click(screen.getByRole("button", { name: "Send test notification" }));
  expect(await screen.findByText("The push service answered with error 503.")).toBeTruthy();
});

test("turning it off unsubscribes this device", async () => {
  localStorage.setItem("pmc_notify", "push");
  page();
  expect(sw().getAttribute("aria-checked")).toBe("true");
  await act(async () => { fireEvent.click(sw()); });
  expect(h.disable).toHaveBeenCalled();
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByRole("button", { name: "Send test notification" })).toBeNull();
});

test("a refused permission says it is blocked and stays off", async () => {
  h.enable.mockResolvedValue("denied");
  page();
  await act(async () => { fireEvent.click(sw()); });
  expect(await screen.findAllByText(/Notifications are blocked/)).not.toHaveLength(0);
  expect(sw().getAttribute("aria-checked")).toBe("false");
});

test("a blocked browser permission disables the switch with the way out", () => {
  notification("denied");
  page();
  expect(sw().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/allow them for Inboxrake in the browser or system settings/i)
    .textContent).toMatch(/Allow them/i);
});

test("an error while subscribing is shown", async () => {
  h.enable.mockRejectedValue(new Error("boom"));
  page();
  await act(async () => { fireEvent.click(sw()); });
  expect(await screen.findByText("Couldn't turn notifications on: boom")).toBeTruthy();
  expect(sw().getAttribute("aria-checked")).toBe("false");
});

test("an iPhone browser tab is told to use the Home Screen", () => {
  h.support = "home_screen";
  page();
  expect(sw().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/add Inboxrake to the Home Screen/)).toBeTruthy();
  expect(h.prefetch).not.toHaveBeenCalled();
});

test("http says it needs HTTPS", () => {
  h.support = "insecure";
  page();
  expect(sw().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Needs HTTPS.")).toBeTruthy();
});

test("a browser with nothing at all says so", () => {
  h.support = "unsupported";
  delete (globalThis as any).Notification;
  page();
  expect(sw().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("This browser can't show notifications.")).toBeTruthy();
});

test("a browser with Notification but no push keeps the in-tab switch", async () => {
  h.support = "unsupported";
  notification("default", () => Promise.resolve("granted"));
  page();
  expect(sw().hasAttribute("disabled")).toBe(false);
  await act(async () => { fireEvent.click(sw()); });
  expect(localStorage.getItem("pmc_notify")).toBe("1");
  expect(h.enable).not.toHaveBeenCalled();
  expect(sw().getAttribute("aria-checked")).toBe("true");
  await act(async () => { fireEvent.click(sw()); });
  expect(localStorage.getItem("pmc_notify")).toBe("0");
  expect(h.disable).not.toHaveBeenCalled();
});

test("the demo disables the switch with the demo hint", () => {
  setDemo(true);
  page();
  expect(sw().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Not available in the demo.")).toBeTruthy();
  expect(h.prefetch).not.toHaveBeenCalled();
});

test("the German wording", () => {
  setLang("de");
  h.support = "home_screen";
  page();
  expect(screen.getAllByText("Benachrichtigungen").length).toBeGreaterThan(0);
  expect(screen.getByText(/Füge Inboxrake zum Home-Bildschirm hinzu/)).toBeTruthy();
  expect(screen.getByText(/auch wenn Inboxrake geschlossen ist/)).toBeTruthy();
});
