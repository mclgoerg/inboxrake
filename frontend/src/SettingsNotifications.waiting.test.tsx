// @vitest-environment jsdom
/* Settings: where Waiting for a reply sits. Notifications keeps its switch and
 * "Send test notification" exactly as they are and gets the new group under
 * them; the Account page keeps everything it had and gets one switch. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ support: "ok" as string,
  settings: vi.fn(), change: vi.fn() }));
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
    waitingSettingsGet: (...a: unknown[]) => h.settings(...a),
    waitingSettings: (...a: unknown[]) => h.change(...a),
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

const page = (section: "notifications" | "account", onWaitingChanged = () => {}) =>
  render(<ToastProvider><DialogProvider>
    <SettingsPage cfg={cfg} account="default" section={section}
      onClose={() => {}} onAddAccount={() => {}} onSaved={() => {}}
      onAccountsChanged={() => {}} onSection={() => {}}
      onWaitingChanged={onWaitingChanged} />
  </DialogProvider></ToastProvider>);

beforeEach(() => {
  setLang("en");
  h.support = "ok";
  localStorage.clear();
  (globalThis as any).Notification = Object.assign(function () {}, {
    permission: "default", requestPermission: () => Promise.resolve("default") });
  h.settings.mockResolvedValue({ watch: false, notify: false, mode: "usual",
    days: 3, subject: false });
  h.change.mockImplementation((patch: object) => Promise.resolve({
    watch: false, notify: false, mode: "usual", days: 3, subject: false,
    ...patch }));
});
afterEach(() => {
  cleanup();
  h.settings.mockReset(); h.change.mockReset();
  delete (globalThis as any).Notification;
  setLang("en");
});

test("Notifications: today's switch and Send test stay, the new group follows them", async () => {
  page("notifications");
  const main = await screen.findByRole("switch", { name: "Notifications" });
  const tell = await screen.findByRole("switch",
    { name: "Tell me when a reply is overdue" });
  // the order on the page: the switch, then (with Web Push) the test button,
  // then the new group (Send test needs Web Push, covered by SettingsNotifications)
  expect(main.compareDocumentPosition(tell)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("On this device, when a scan or clean-up you started finishes - even with Inboxrake closed."))
    .toBeTruthy();
  expect(screen.getByText("Waiting for a reply")).toBeTruthy();
});

test("Notifications: the rows of the board are all there", async () => {
  page("notifications");
  await screen.findByRole("switch", { name: "Tell me when a reply is overdue" });
  expect(screen.getByRole("radio", { name: "Fixed days" })).toBeTruthy();
  expect(screen.getByRole("switch",
    { name: "Show the subject in the notification" })).toBeTruthy();
});

test("Account: the new switch comes with today's rows, and tells the app", async () => {
  const changed = vi.fn();
  page("account", changed);
  const sw = await screen.findByRole("switch",
    { name: "Watch my sent mail for replies" });
  // today's rows of the account page are all still there
  for (const label of ["Provider", "Host", "User", "Password"])
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  expect(screen.getByText(/Sending server/)).toBeTruthy();
  await waitFor(() => expect(sw.hasAttribute("disabled")).toBe(false));
  fireEvent.click(sw);
  await waitFor(() => expect(h.change).toHaveBeenCalledWith({ watch: true },
    "default"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(within(document.body).getByText("Sent mail")).toBeTruthy();
});

test("German: the group and the switch", async () => {
  setLang("de");
  page("notifications");
  expect(await screen.findByRole("switch",
    { name: "Sag mir Bescheid, wenn eine Antwort überfällig ist" })).toBeTruthy();
  cleanup();
  page("account");
  expect(await screen.findByRole("switch",
    { name: "Gesendete Mails auf Antworten beobachten" })).toBeTruthy();
});
