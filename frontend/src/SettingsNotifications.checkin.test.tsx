// @vitest-environment jsdom
/* Settings > Notifications: the Weekly check-in's push switch is the LAST row,
 * after today's rows (the main switch, Send test, Waiting for a reply), and it
 * is ON by default - the maintainer's decision - until somebody switches it
 * off. It changes at once, per user, and says what it needs while
 * notifications are off here. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ support: "ok" as string,
  get: vi.fn(), set: vi.fn() }));
vi.mock("./push", () => ({
  NOTIFY_KEY: "pmc_notify",
  pushSupport: () => h.support,
  enablePush: () => Promise.resolve("granted"),
  disablePush: () => Promise.resolve(),
  sendTestPush: () => Promise.resolve(),
  prefetchPushKey: () => Promise.resolve("key"),
}));
vi.mock("./api", () => ({
  api: new Proxy({
    checkinSettingsGet: (...a: unknown[]) => h.get(...a),
    checkinSettings: (...a: unknown[]) => h.set(...a),
    waitingSettingsGet: () => Promise.resolve({ watch: false, notify: false,
      mode: "usual", days: 3, subject: false }),
  }, { get: (t, k) => (t as Record<string, unknown>)[k as string]
    ?? (() => new Promise(() => {})) }),
  fmtUsd: (n: number) => `$${n}`,
  downloadFile: () => Promise.resolve(),
  errorText: (s: string) => s,
}));

import { SettingsPage } from "./components/SettingsPage";
import { ToastProvider, DialogProvider } from "./components/ui";
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

const page = () => render(<ToastProvider><DialogProvider>
  <SettingsPage cfg={cfg} account="default" section="notifications"
    onClose={() => {}} onAddAccount={() => {}} onSaved={() => {}}
    onAccountsChanged={() => {}} onSection={() => {}} />
</DialogProvider></ToastProvider>);

const ROW = "Remind me of my weekly check-in";

beforeEach(() => {
  setLang("en");
  h.support = "ok";
  localStorage.clear();
  (globalThis as any).Notification = Object.assign(function () {}, {
    permission: "default", requestPermission: () => Promise.resolve("default") });
  h.get.mockResolvedValue({ push: true });
  h.set.mockImplementation((patch: object) => Promise.resolve(
    { push: true, ...patch }));
});
afterEach(() => {
  cleanup();
  h.get.mockReset(); h.set.mockReset();
  delete (globalThis as any).Notification;
  setLang("en");
});

test("the switch is the last row, after today's rows, and ON by default",
  async () => {
  page();
  const main = await screen.findByRole("switch", { name: "Notifications" });
  const tell = await screen.findByRole("switch",
    { name: "Tell me when a reply is overdue" });
  const subject = await screen.findByRole("switch",
    { name: "Show the subject in the notification" });
  const check = await screen.findByRole("switch", { name: ROW });
  // on without anybody having touched it (the settings say so)
  await waitFor(() => expect(check.getAttribute("aria-checked")).toBe("true"));
  for (const before of [main, tell, subject]) {
    expect(before.compareDocumentPosition(check)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  // today's rows are all still there
  expect(screen.getByRole("radio", { name: "Fixed days" })).toBeTruthy();
  expect(screen.getByText(/A push on Monday 09:00 when there is something to look at - no names, no subjects\./))
    .toBeTruthy();
});

test("switching it off is saved at once, and on again", async () => {
  page();
  const check = await screen.findByRole("switch", { name: ROW });
  await waitFor(() => expect(check.getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(check);
  await waitFor(() => expect(h.set).toHaveBeenCalledWith({ push: false }));
  await waitFor(() => expect(check.getAttribute("aria-checked")).toBe("false"));
  fireEvent.click(check);
  await waitFor(() => expect(h.set).toHaveBeenLastCalledWith({ push: true }));
  await waitFor(() => expect(check.getAttribute("aria-checked")).toBe("true"));
});

test("a user who switched it off finds it off", async () => {
  h.get.mockResolvedValue({ push: false });
  page();
  const check = await screen.findByRole("switch", { name: ROW });
  await waitFor(() => expect(h.get).toHaveBeenCalled());
  expect(check.getAttribute("aria-checked")).toBe("false");
});

test("while Notifications are off here it says what it needs", async () => {
  page();
  await screen.findByRole("switch", { name: ROW });
  const needs = () => screen.queryAllByText(
    /Needs Notifications on - switch them on above\./);
  // this row and the Waiting row above it say it
  expect(needs()).toHaveLength(2);
  fireEvent.click(screen.getByRole("switch", { name: "Notifications" }));
  await waitFor(() => expect(needs()).toHaveLength(0));
});

test("a refused change is said and the switch stays as it was", async () => {
  h.set.mockRejectedValue(new Error("nope"));
  page();
  const check = await screen.findByRole("switch", { name: ROW });
  await waitFor(() => expect(check.getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(check);
  expect(await screen.findByText(/nope/)).toBeTruthy();
  expect(check.getAttribute("aria-checked")).toBe("true");
});

test("German", async () => {
  setLang("de");
  page();
  const check = await screen.findByRole("switch",
    { name: "Erinnere mich an meinen Wochen-Check" });
  expect(check).toBeTruthy();
  expect(screen.getByText(/Eine Benachrichtigung am Montag um 9:00/))
    .toBeTruthy();
});
