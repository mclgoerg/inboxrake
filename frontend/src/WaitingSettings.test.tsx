// @vitest-environment jsdom
/* Settings > Account: the switch and the threshold of Waiting for a reply. */

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

import { WaitingSettings } from "./components/WaitingSettings";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";

const mount = () => render(<ToastProvider><WaitingSettings account="work" /></ToastProvider>);

beforeEach(() => {
  setLang("en");
  get.mockResolvedValue({ track: true, days: 3 });
  post.mockImplementation((patch) => Promise.resolve({ track: true, days: 3, ...patch }));
});
afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); setLang("en"); });

test("the board's two rows, read for the account being edited", async () => {
  mount();
  const sw = await screen.findByRole("switch", { name: "Track mails waiting for a reply" });
  await waitFor(() => expect((sw as HTMLInputElement).checked
    ?? sw.getAttribute("aria-checked") === "true").toBeTruthy());
  expect(get).toHaveBeenCalledWith("work");
  expect(screen.getByText(/Reads Message-ID, date, subject and recipients of your sent mail/))
    .toBeTruthy();
  expect(screen.getByText("Waiting counts after")).toBeTruthy();
  expect(screen.getByText("Or after the person's usual answer time, if that is longer"))
    .toBeTruthy();
  for (const n of [2, 3, 7])
    expect(screen.getByRole("radio", { name: new RegExp(`^${n}\\sdays$`) })).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^3\sdays$/, checked: true })).toBeTruthy();
});

test("the days are saved at once, per account", async () => {
  mount();
  await screen.findByRole("switch");
  await waitFor(() => expect(screen.getByRole("radio", { name: /^7\sdays$/ })
    .hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("radio", { name: /^7\sdays$/ }));
  await waitFor(() => expect(post).toHaveBeenCalledWith({ days: 7 }, "work"));
  expect(await screen.findByRole("radio", { name: /^7\sdays$/, checked: true }))
    .toBeTruthy();
});

test("the switch turns tracking off and the days are then not offered", async () => {
  mount();
  const sw = await screen.findByRole("switch");
  await waitFor(() => expect(sw.hasAttribute("disabled")).toBe(false));
  post.mockResolvedValue({ track: false, days: 3 });
  fireEvent.click(sw);
  await waitFor(() => expect(post).toHaveBeenCalledWith({ track: false }, "work"));
  await waitFor(() => expect(screen.getByRole("radio", { name: /^7\sdays$/ })
    .hasAttribute("disabled")).toBe(true));
});

test("nothing can be changed before the settings are known", async () => {
  get.mockReturnValue(new Promise(() => {}));
  mount();
  expect((await screen.findByRole("switch")).hasAttribute("disabled")).toBe(true);
});

test("a failed save says so", async () => {
  mount();
  const sw = await screen.findByRole("switch");
  await waitFor(() => expect(sw.hasAttribute("disabled")).toBe(false));
  post.mockRejectedValue(new Error("no luck"));
  fireEvent.click(sw);
  expect(await screen.findByText(/no luck/)).toBeTruthy();
});

test("German (du)", async () => {
  setLang("de");
  mount();
  expect(await screen.findByRole("switch",
    { name: "Mails nachverfolgen, die auf Antwort warten" })).toBeTruthy();
  expect(screen.getByText("Als wartend zählt nach")).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^2\sTage$/ })).toBeTruthy();
});
