// @vitest-environment jsdom
/* Settings > General, last rows: "Suggest rules from what I do" (staged with
 * the Save bar, sent as `habits`) and "Hidden suggestions · Show". */

import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor }
  from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const saveCalls: any[] = [];
const habits = vi.fn();
const habitsShow = vi.fn();
vi.mock("./api", () => ({
  api: {
    saveConfig: (body: any) => { saveCalls.push(body); return new Promise(() => {}); },
    folders: () => new Promise(() => {}),
    habits: (account?: string) => habits(account),
    habitsShow: (account?: string) => habitsShow(account),
    adminStats: () => Promise.resolve({ tenants: [] }),
    subscriptionSettingsGet: () => Promise.resolve({ body_amounts: false }),
  },
  fmtUsd: (n: number) => `$${n.toFixed(2)}`,
}));

import { SettingsPage } from "./components/SettingsPage";
import { HabitsSettings } from "./components/HabitsSettings";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { SettingsSection } from "./nav";
import type { Config } from "./types";

const render = (ui: ReactElement) =>
  rtlRender(<ToastProvider>{ui}</ToastProvider>);

const acct = {
  excluded_folders: [] as string[], host: "127.0.0.1", port: 1143,
  security: "ssl" as const, smtp_host: "", smtp_port: 1025,
  smtp_security: "auto" as const, user: "me@proton.example", password: "",
  password_set: true, cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg: Config = {
  accounts: { default: acct }, default_account: "default",
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: true, password_set: false,
    oidc: { issuer: "", client_id: "", client_secret_set: false,
      redirect_base: "", allowed: [] } },
  protected: [], categories: {}, new_sender_window_days: 7,
  habits: { suggest: true },
  ai: { provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};

let goto: (s: SettingsSection | null) => void = () => {};
function Settings({ c = cfg, section: first = "general", routeAccount }: {
  c?: Config; section?: SettingsSection | null; routeAccount?: string }) {
  const [section, setSection] = useState<SettingsSection | null>(first);
  goto = setSection;
  return <SettingsPage cfg={c} account="default" routeAccount={routeAccount}
    onClose={() => {}}
    onAddAccount={() => {}} onSaved={() => {}} onAccountsChanged={() => {}}
    section={section} onSection={(s) => setSection(s)} />;
}
const sw = (name: string) =>
  screen.getByRole("switch", { name }) as HTMLButtonElement;

beforeEach(() => {
  habits.mockResolvedValue({ enabled: true, suggestions: [], hidden: 2 });
  habitsShow.mockResolvedValue({ shown: 2 });
});
afterEach(() => {
  cleanup(); setLang("en"); saveCalls.length = 0;
  habits.mockReset(); habitsShow.mockReset();
});

test("the switch is on by default, with the board's sub text, in the last "
  + "rows of General", async () => {
  render(<Settings />);
  const row = sw("Suggest rules from what I do");
  expect(row.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("Off: no suggestions, no Automate… button")).toBeTruthy();
  const last = await screen.findByText("Hidden suggestions");
  const earlier = screen.getByText("Language");
  expect(earlier.compareDocumentPosition(row)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(row.compareDocumentPosition(last)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // what General had before is still there
  for (const name of ["Appearance", "Language", "Number format"])
    expect(screen.getByText(name)).toBeTruthy();
});

test("it is staged with the Save bar and saved as habits.suggest", () => {
  render(<Settings />);
  fireEvent.click(sw("Suggest rules from what I do"));
  expect(saveCalls).toHaveLength(0);
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].habits).toEqual({ suggest: false });
});

test("a server without it is not sent the key and shows nothing", () => {
  const old = { ...cfg } as Partial<Config>;
  delete old.habits;
  render(<Settings c={old as Config} />);
  expect(screen.queryByText("Suggest rules from what I do")).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Search inside mail text" }));
  fireEvent.click(screen.getByText("Save"));
  expect("habits" in saveCalls[0]).toBe(false);
});

test("Hidden suggestions: the count, and Show brings them back at once", async () => {
  const shown = vi.fn();
  render(<HabitsSettings account="icloud" on onChange={() => {}}
    onShown={shown} />);
  expect(await screen.findByText("2 you dismissed with “Not this one”"))
    .toBeTruthy();
  expect(habits).toHaveBeenCalledWith("icloud");
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await waitFor(() => expect(habitsShow).toHaveBeenCalledWith("icloud"));
  expect(await screen.findByText("None dismissed with “Not this one”"))
    .toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
  expect(shown).toHaveBeenCalled();
  expect(await screen.findByText("Hidden suggestions are shown again.")).toBeTruthy();
});

test("Hidden suggestions belong to the account the page is editing, like the "
  + "per-account rows before them", async () => {
  const two = { ...cfg, accounts: { default: acct,
    other: { ...acct, user: "me@other.example" } } } as Config;
  render(<Settings c={two} routeAccount="other" />);
  expect(await screen.findByText("2 you dismissed with “Not this one”"))
    .toBeTruthy();
  expect(habits).toHaveBeenCalledWith("other");
  expect(habits).not.toHaveBeenCalledWith("default");
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await waitFor(() => expect(habitsShow).toHaveBeenCalledWith("other"));
});

test("nothing hidden: no Show button; one is singular", async () => {
  habits.mockResolvedValue({ enabled: true, suggestions: [], hidden: 0 });
  render(<HabitsSettings account="default" on onChange={() => {}} />);
  expect(await screen.findByText("None dismissed with “Not this one”"))
    .toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
  cleanup();
  habits.mockResolvedValue({ enabled: true, suggestions: [], hidden: 1 });
  render(<HabitsSettings account="default" on onChange={() => {}} />);
  expect(await screen.findByText("1 you dismissed with “Not this one”"))
    .toBeTruthy();
});

test("a failed list shows none (the switch still works)", async () => {
  habits.mockRejectedValue(new Error("x"));
  const change = vi.fn();
  render(<HabitsSettings account="default" on={false} onChange={change} />);
  expect(await screen.findByText("None dismissed with “Not this one”"))
    .toBeTruthy();
  fireEvent.click(sw("Suggest rules from what I do"));
  expect(change).toHaveBeenCalledWith(true);
});

test("a failed Show says so and keeps the list", async () => {
  habitsShow.mockRejectedValue(new Error("boom"));
  render(<HabitsSettings account="default" on onChange={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Show" }));
  expect(await screen.findByText(/boom/)).toBeTruthy();
  expect(screen.getByText("2 you dismissed with “Not this one”")).toBeTruthy();
});

test("found by the settings search; German", async () => {
  render(<Settings section={null} />);
  fireEvent.change(screen.getByLabelText("Search settings"),
    { target: { value: "hidden suggestions" } });
  expect(screen.getByRole("button", { name: /^General/ })).toBeTruthy();
  cleanup();
  setLang("de");
  render(<Settings />);
  expect(sw("Regeln aus dem vorschlagen, was ich tue")).toBeTruthy();
  expect(screen.getByText("Ausgeblendete Vorschläge")).toBeTruthy();
  expect(await screen.findByText("2 mit „Nicht diesen“ ausgeblendet"))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Anzeigen" })).toBeTruthy();
  act(() => goto("general"));
});
