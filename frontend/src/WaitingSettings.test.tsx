// @vitest-environment jsdom
/* Settings: "Watch my sent mail for replies" (Account, per account, off by
 * default) and the Notifications group under today's two rows. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("./api", () => ({
  api: {
    waitingSettingsGet: (...a: unknown[]) => get(...a),
    waitingSettings: (...a: unknown[]) => post(...a),
  },
}));

import { WaitingNotifySettings, WaitingSettings }
  from "./components/WaitingSettings";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";

const DEFAULTS = { watch: false, notify: false, mode: "usual", days: 3,
  subject: false };
const onChanged = vi.fn();

beforeEach(() => {
  setLang("en");
  get.mockResolvedValue(DEFAULTS);
  post.mockImplementation((patch) => Promise.resolve({ ...DEFAULTS, ...patch }));
});
afterEach(() => {
  cleanup(); get.mockReset(); post.mockReset(); onChanged.mockReset();
  setLang("en");
});

const account = () => render(<ToastProvider>
  <WaitingSettings account="work" onChanged={onChanged} /></ToastProvider>);
const notify = (on = true) => render(<ToastProvider>
  <WaitingNotifySettings notificationsOn={on} onChanged={onChanged} />
  </ToastProvider>);
const enabled = async (el: HTMLElement) =>
  waitFor(() => expect(el.hasAttribute("disabled")).toBe(false));

/* ----------------------------- Settings > Account ----------------------------- */

test("Account: the switch is off by default and says what is kept", async () => {
  account();
  const sw = await screen.findByRole("switch",
    { name: "Watch my sent mail for replies" });
  await enabled(sw);
  expect(sw.getAttribute("aria-checked")).toBe("false");
  expect(get).toHaveBeenCalledWith("work");
  expect(screen.getByText(/Keeps the headers of the last 90 days of your Sent folder/))
    .toBeTruthy();
  expect(screen.getByText(/never the mail text/)).toBeTruthy();
  expect(screen.getByText(/Off: nothing extra is read and the index is deleted/))
    .toBeTruthy();
});

test("Account: switching it on is saved at once, for that account", async () => {
  account();
  const sw = await screen.findByRole("switch");
  await enabled(sw);
  fireEvent.click(sw);
  await waitFor(() => expect(post).toHaveBeenCalledWith({ watch: true }, "work"));
  await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
  expect(onChanged).toHaveBeenCalled();
});

test("Account: nothing can be changed before the setting is known, and it never reads on", async () => {
  get.mockReturnValue(new Promise(() => {}));
  account();
  const sw = await screen.findByRole("switch");
  expect(sw.hasAttribute("disabled")).toBe(true);
  expect(sw.getAttribute("aria-checked")).toBe("false");
});

test("Account: a failed save says so and tells nobody it changed", async () => {
  account();
  const sw = await screen.findByRole("switch");
  await enabled(sw);
  post.mockRejectedValue(new Error("no luck"));
  fireEvent.click(sw);
  expect(await screen.findByText(/no luck/)).toBeTruthy();
  expect(onChanged).not.toHaveBeenCalled();
  expect(sw.getAttribute("aria-checked")).toBe("false");
});

/* ------------------------- Settings > Notifications -------------------------- */

test("Notifications: the group of the board, four rows, defaults", async () => {
  notify();
  const tell = await screen.findByRole("switch",
    { name: "Tell me when a reply is overdue" });
  await enabled(tell);
  expect(screen.getByText("Waiting for a reply")).toBeTruthy();
  expect(tell.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText(/For accounts that watch their sent mail \(Settings › Account\)\./))
    .toBeTruthy();
  expect(screen.getByRole("radio", { name: "Their usual time", checked: true }))
    .toBeTruthy();
  expect(screen.getByRole("radio", { name: "Fixed days" })).toBeTruthy();
  expect(screen.getByText("Their usual answer time, from earlier conversations"))
    .toBeTruthy();
  for (const n of [2, 3, 7])
    expect(screen.getByRole("radio", { name: new RegExp(`^${n}\\sdays$`) })).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^3\sdays$/, checked: true })).toBeTruthy();
  expect(screen.getByText(
    "Used while there is no history yet - or always, with Fixed days")).toBeTruthy();
  const subject = screen.getByRole("switch",
    { name: "Show the subject in the notification" });
  expect(subject.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("Off: only who and how long (lock screen)")).toBeTruthy();
  expect(get).toHaveBeenCalledWith(undefined);
});

test("Notifications: every setting is saved at once", async () => {
  notify();
  const tell = await screen.findByRole("switch", { name: "Tell me when a reply is overdue" });
  await enabled(tell);
  fireEvent.click(tell);
  await waitFor(() => expect(post).toHaveBeenLastCalledWith({ notify: true }, undefined));
  await waitFor(() => expect(tell.getAttribute("aria-checked")).toBe("true"));
  fireEvent.click(screen.getByRole("radio", { name: "Fixed days" }));
  await waitFor(() => expect(post).toHaveBeenLastCalledWith({ mode: "fixed" }, undefined));
  fireEvent.click(screen.getByRole("radio", { name: /^7\sdays$/ }));
  await waitFor(() => expect(post).toHaveBeenLastCalledWith({ days: 7 }, undefined));
  fireEvent.click(screen.getByRole("switch", { name: "Show the subject in the notification" }));
  await waitFor(() => expect(post).toHaveBeenLastCalledWith({ subject: true }, undefined));
  expect(onChanged).toHaveBeenCalledTimes(4);
});

test("Notifications: greyed out with the reason while Notifications are off", async () => {
  get.mockResolvedValue({ ...DEFAULTS, notify: true });
  notify(false);
  const tell = await screen.findByRole("switch",
    { name: "Tell me when a reply is overdue" });
  await waitFor(() => expect(screen.getByRole("radio", { name: /^7\sdays$/ })
    .hasAttribute("disabled")).toBe(false));
  expect(tell.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/Needs Notifications on - switch them on above\./))
    .toBeTruthy();
  // it does not read as on while it cannot do anything
  expect(tell.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(tell);
  expect(post).not.toHaveBeenCalled();
});

test("Notifications: the reason is gone once they are on", async () => {
  notify(true);
  await screen.findByRole("switch", { name: "Tell me when a reply is overdue" });
  expect(screen.queryByText(/Needs Notifications on/)).toBeNull();
});

test("Notifications: nothing changes before the settings are known", async () => {
  get.mockReturnValue(new Promise(() => {}));
  notify();
  const tell = await screen.findByRole("switch", { name: "Tell me when a reply is overdue" });
  expect(tell.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("radio", { name: "Fixed days" }).hasAttribute("disabled"))
    .toBe(true);
});

/* --------------------------------- German ---------------------------------- */

test("German (du): both groups", async () => {
  setLang("de");
  account();
  expect(await screen.findByRole("switch",
    { name: "Gesendete Mails auf Antworten beobachten" })).toBeTruthy();
  cleanup();
  notify();
  expect(await screen.findByRole("switch",
    { name: "Sag mir Bescheid, wenn eine Antwort überfällig ist" })).toBeTruthy();
  expect(screen.getByText("Überfällig nach")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Üblicher Zeit" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Festen Tagen" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^2\sTage$/ })).toBeTruthy();
  expect(screen.getByRole("switch",
    { name: "Betreff in der Benachrichtigung zeigen" })).toBeTruthy();
});

test("every waiting string exists in both languages", () => {
  const keys = (d: Record<string, string>) => Object.keys(d)
    .filter((k) => k.startsWith("waiting.") || k.startsWith("tab.waiting")
      || k.startsWith("overview.row_waiting"));
  expect(keys(EN).length).toBeGreaterThan(90);
  expect(keys(DE).sort()).toEqual(keys(EN).sort());
});
