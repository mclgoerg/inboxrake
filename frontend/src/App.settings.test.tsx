// @vitest-environment jsdom
/* N1: Settings as a page - the route (`#/settings/<section>`), the section
 * column from 1024 px and the drill-down list below it, Esc / Back, the
 * search field, and the unsaved-changes prompt when the page is left. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const saveCalls: any[] = [];

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    undo: () => Promise.resolve({ restored: 1, of: 1, rescan: true }),
    version: () => Promise.resolve({ build: "v1" }),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    foldersPanel: () => Promise.resolve({ mails: [], total: 0, senders: [] }),
    knowledge: () => new Promise(() => {}),
    mails: () => Promise.resolve({ items: [], total: 0 }),
    group: () => Promise.resolve([]),
    saveConfig: (body: any) => {
      saveCalls.push(body);
      return Promise.resolve({ ...cfg, protected: body.protected ?? [] });
    },
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  undoLabel: (u: { label: string }) => u.label,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { backStackBusy } from "./backStack";
import { setLang } from "./i18n";
import type { AppState, Config } from "./types";

const cfg: Config = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: true },
  protected: ["boss@work.example"], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto",
    user: "me@proton.example", password: "", password_set: true,
    cafile: "", preset: "custom", oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
  } },
} as unknown as Config;

const state = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState;

Element.prototype.scrollIntoView = () => {};

const mount = (wide: boolean) => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return wide && q.includes("1024"); }, media: q,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};
const side = () => screen.findByRole("navigation", { name: "Main navigation" });
const column = () => screen.findByRole("navigation", { name: "Settings" });
const h1 = (name: string) => screen.findByRole("heading", { level: 1, name });
/** The URL hash is written by the app after the history has settled
 *  (`afterBackSettles`), not in the click that asked for it. */
const hashIs = (hash: string) =>
  waitFor(() => expect(window.location.hash).toBe(hash));
/** Waits until no hash write or history pop of the app is still on its way. */
const navSettled = () => waitFor(() => expect(backStackBusy()).toBe(false));

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); localStorage.clear(); setLang("en");
  saveCalls.length = 0; window.location.hash = "";
});

test(">= 1024: the gear opens the page with a section column; sections are routes",
  async () => {
    window.location.hash = "#/senders";
    mount(true);
    fireEvent.click(within(await side()).getByRole("button", { name: "Settings" }));
    await h1("General");
    await hashIs("#/settings");
    const col = within(await column());
    // the grouped sections of board 22, the admin's Server group included
    for (const name of ["proton", "Add account", "General", "Notifications",
      "Protected senders", "Categories", "Filed senders", "Activity digest",
      "Auto-scan", "AI review", "Sign-in & users", "Backup & restore"])
      expect(col.getByRole("button", { name: new RegExp(name) })).toBeTruthy();
    expect(col.getByRole("button", { name: /^General/ })
      .getAttribute("aria-current")).toBe("page");
    // a section is a route, and the count of protected senders is shown
    fireEvent.click(col.getByRole("button", { name: /^Protected senders/ }));
    await h1("Protected senders");
    await hashIs("#/settings/protected");
    expect(col.getByRole("button", { name: /^Protected senders/ }).textContent)
      .toContain("1");
    expect(screen.getByText("boss@work.example")).toBeTruthy();
    // the account is a section too
    fireEvent.click(col.getByRole("button", { name: /^proton/ }));
    await h1("proton");
    await hashIs("#/settings/account/proton");
    expect(screen.getByLabelText("Host")).toBeTruthy();
  });

test("a section route opens straight on it, and Esc returns where Settings was opened",
  async () => {
    window.location.hash = "#/senders";
    mount(true);
    fireEvent.click(within(await side()).getByRole("button", { name: "Settings" }));
    await h1("General");
    fireEvent.click(within(await column()).getByRole("button", { name: /^AI review/ }));
    await h1("AI review");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await hashIs("#/senders");
    expect(screen.queryByRole("navigation", { name: "Settings" })).toBeNull();
    await navSettled();
    cleanup();
    window.location.hash = "#/settings/digest";
    mount(true);
    await h1("Activity digest");
  });

test("the search field filters sections and rows by label", async () => {
  window.location.hash = "#/settings";
  mount(true);
  const col = within(await column());
  const search = col.getByRole("searchbox", { name: "Search settings" });
  fireEvent.change(search, { target: { value: "digest" } });
  expect(col.getByRole("button", { name: /Activity digest/ })).toBeTruthy();
  expect(col.queryByRole("button", { name: /^General/ })).toBeNull();
  // a row label finds its section, and says which row matched
  fireEvent.change(search, { target: { value: "own row" } });
  expect(col.getByRole("button", { name: /^General/ }).textContent)
    .toContain("Own row from N mails");
  expect(col.queryByRole("button", { name: /Activity digest/ })).toBeNull();
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(col.getByText(/No settings match/)).toBeTruthy();
  // Enter opens the first hit
  fireEvent.change(search, { target: { value: "auto" } });
  fireEvent.keyDown(search, { key: "Enter" });
  await h1("Auto-scan");
});

test("< 1024: a root list drills down into a section and Back returns to it",
  async () => {
    window.location.hash = "#/senders";
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: /^Account:/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Settings/ }));
    await h1("Settings");
    await hashIs("#/settings");
    // the account card, then the grouped rows with their current values
    expect(screen.getByRole("button", { name: /^proton/ }).textContent)
      .toContain("me@proton.example");
    expect(screen.getByRole("button", { name: /^Protected senders/ }).textContent)
      .toContain("1");
    expect(screen.getByRole("button", { name: /^Activity digest/ }).textContent)
      .toContain("Off");
    fireEvent.click(screen.getByRole("button", { name: /^AI review/ }));
    await h1("AI review");
    await hashIs("#/settings/ai");
    expect(screen.queryByRole("button", { name: /^Protected senders/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await h1("Settings");
    await hashIs("#/settings");
    // no dialog, and the tab bar is still the way out
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Senders" }));
    await hashIs("#/senders");
  });

test("< 1024: a section opened by its URL goes up to the root list, not out of the app",
  async () => {
    window.location.hash = "#/settings/ai";
    mount(false);
    await h1("AI review");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await h1("Settings");
    await hashIs("#/settings");
  });

const editProtected = async () => {
  window.location.hash = "#/senders";
  mount(true);
  fireEvent.click(within(await side()).getByRole("button", { name: "Settings" }));
  fireEvent.click(within(await column()).getByRole("button", { name: /^Protected senders/ }));
  fireEvent.click(await screen.findByRole("button",
    { name: "Add address or domain…" }));
  const input = await screen.findByRole("textbox",
    { name: "Add address or domain…" });
  fireEvent.change(input, { target: { value: "bank.example" } });
  fireEvent.keyDown(input, { key: "Enter" });
};

test("edits show a save bar with what changed; Revert drops them", async () => {
  await editProtected();
  const bar = screen.getByRole("region", { name: "Unsaved changes" });
  expect(within(bar).getByRole("status").textContent)
    .toBe("Protected senders changed");
  fireEvent.click(within(bar).getByRole("button", { name: "Revert" }));
  expect(screen.getByText("boss@work.example")).toBeTruthy();
  expect(screen.queryByText("bank.example")).toBeNull();
  expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  expect(saveCalls).toEqual([]);
});

test("Save sends the same call as before and hides the bar", async () => {
  await editProtected();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0].protected).toEqual(["boss@work.example", "@bank.example"]);
  expect(saveCalls[0].account).toBe("proton");
  await waitFor(() => expect(
    screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull());
  expect(await screen.findByText("Saved.")).toBeTruthy();
});

test("leaving with unsaved edits asks: Cancel stays, Discard leaves, Save saves first",
  async () => {
    await editProtected();
    const sidebar = within(await side());
    // Cancel: still on the page, edits kept
    fireEvent.click(sidebar.getByRole("link", { name: /Senders/ }));
    expect((await findDialog()).textContent).toContain("Save your changes?");
    await cancelDialog();
    await expectNoDialog();
    expect(window.location.hash).toBe("#/settings/protected");
    expect(screen.getByText("bank.example")).toBeTruthy();
    // Discard: leaves without saving
    fireEvent.click(sidebar.getByRole("link", { name: /Senders/ }));
    await pressDialog("Discard changes");
    await hashIs("#/senders");
    expect(saveCalls).toEqual([]);
    // Save: saves, then leaves
    await navSettled();
    cleanup();
    await editProtected();
    fireEvent.click(within(await side()).getByRole("link", { name: /Senders/ }));
    await pressDialog("Save");
    await hashIs("#/senders");
    expect(saveCalls).toHaveLength(1);
  });

test("Esc and the browser's Back ask too, and clean pages leave at once", async () => {
  await editProtected();
  fireEvent.keyDown(document.body, { key: "Escape" });
  await findDialog();
  await cancelDialog();
  expect(window.location.hash).toBe("#/settings/protected");
  // the URL moves away (Back button): the page is kept until the user decides
  act(() => {
    window.location.hash = "#/senders";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await pressDialog("Discard changes");
  await waitFor(() => expect(screen.queryByRole("navigation",
    { name: "Settings" })).toBeNull());
  // leaving writes the URL once the history is clear of the dialog's entry:
  // let that land before the next mount reads the hash
  await hashIs("#/senders");
  await navSettled();
  cleanup();
  window.location.hash = "#/settings/general";
  mount(true);
  await h1("General");
  fireEvent.click(within(await side()).getByRole("link", { name: /Senders/ }));
  await hashIs("#/senders");
  await expectNoDialog();
});

test("switching the edited account with unsaved edits asks first", async () => {
  const two = { ...cfg, accounts: { ...cfg.accounts,
    work: { ...cfg.accounts.proton, user: "me@work.example" } } };
  (cfg as any).accounts = two.accounts;
  try {
    window.location.hash = "#/settings/account/proton";
    mount(true);
    const host = await screen.findByLabelText("Host");
    fireEvent.change(host, { target: { value: "imap.edited.example" } });
    fireEvent.click(within(await column()).getByRole("button", { name: /^work/ }));
    await findDialog();
    await cancelDialog();
    expect((screen.getByLabelText("Host") as HTMLInputElement).value)
      .toBe("imap.edited.example");
    fireEvent.click(within(await column()).getByRole("button", { name: /^work/ }));
    await pressDialog("Discard changes");
    await h1("work");
    expect((screen.getByLabelText("Host") as HTMLInputElement).value)
      .toBe("h");
    await hashIs("#/settings/account/work");
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  } finally {
    delete (cfg as any).accounts.work;
  }
});
