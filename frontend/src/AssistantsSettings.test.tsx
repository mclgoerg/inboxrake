// @vitest-environment jsdom
/* Settings > AI assistants: the admin cap, the address, the token list, the
 * create / created dialogs and their states. The levels on offer come from
 * `cfg.assistants.levels`, so each test says which ones the server has. */

import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor,
  within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AssistantToken, Config } from "./types";

const NOW = Math.floor(Date.now() / 1000);
const tok = (over: Partial<AssistantToken> = {}): AssistantToken => ({
  id: "t1", name: "Claude Code · laptop", prefix: "irk_7Fq2",
  accounts: ["proton", "icloud"], level: "read", subjects: true,
  daily_cap: 2000, created: NOW - 86400, expires: NOW + 30 * 86400,
  last_used: NOW - 240, calls_today: 38, mails_today: 0, ...over });

let listed: AssistantToken[] = [];
let freshCfg: Config | null = null;   // what GET /api/config answers (counts)
const created: any[] = [];
const revoked: string[] = [];
const saveCalls: any[] = [];
let createResult: () => Promise<unknown> = () => Promise.resolve({
  token: tok({ id: "new", name: "New one" }), secret: "irk_AbCd" + "x".repeat(43) });
vi.mock("./api", () => ({
  api: {
    assistantTokens: () => Promise.resolve({ tokens: listed, access: "act",
      levels: ["read"] }),
    createAssistantToken: (b: unknown) => { created.push(b); return createResult(); },
    revokeAssistantToken: (id: string) => { revoked.push(id);
      return Promise.resolve({ ok: true }); },
    getConfig: () => freshCfg ? Promise.resolve(freshCfg)
      : Promise.reject(new Error("offline")),
    saveConfig: (b: unknown) => { saveCalls.push(b); return new Promise(() => {}); },
    folders: () => new Promise(() => {}),
  },
  fmtUsd: (n: number) => `$${n}`,
}));

import { SettingsPage } from "./components/SettingsPage";
import { setupSnippet } from "./components/AssistantsSettings";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setDemo } from "./demoMode";
import { setLang } from "./i18n";
import type { SettingsSection } from "./nav";

const render = (ui: ReactElement) =>
  rtlRender(<ToastProvider><DialogProvider>{ui}</DialogProvider></ToastProvider>);

const acct = {
  excluded_folders: [] as string[], host: "127.0.0.1", port: 1143,
  security: "ssl" as const, smtp_host: "", smtp_port: 1025,
  smtp_security: "auto" as const, user: "me@proton.example", password: "",
  password_set: true, cafile: "", preset: "proton" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const baseCfg = (assistants?: Config["assistants"], admin = true): Config => ({
  accounts: { proton: acct, icloud: { ...acct, user: "me@icloud.example" } },
  default_account: "proton", oauth_providers: [],
  oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: admin, password_set: false,
    oidc: { issuer: "", client_id: "", client_secret_set: false,
      redirect_base: "", allowed: [] } },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  ...(assistants ? { assistants } : {}),
});
const READ_ONLY = { access: "read_propose" as const, levels: ["read" as const],
  options: ["off" as const, "read_propose" as const, "act" as const] };
const ALL = { access: "act" as const,
  levels: ["read" as const, "propose" as const, "act" as const],
  options: READ_ONLY.options };

let goto: (s: SettingsSection | null) => void = () => {};
function Settings({ cfg, section: first = "assistants" }: {
  cfg: Config; section?: SettingsSection | null }) {
  const [section, setSection] = useState<SettingsSection | null>(first);
  goto = setSection;
  return <SettingsPage cfg={cfg} account="proton" section={section}
    onSection={setSection} onClose={() => {}} onAddAccount={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />;
}
const show = async (cfg: Config, section: SettingsSection | null = "assistants") => {
  render(<Settings cfg={cfg} section={section} />);
  await act(async () => {});
};

beforeEach(() => {
  listed = [];
  freshCfg = null;
  created.length = 0; revoked.length = 0; saveCalls.length = 0;
  createResult = () => Promise.resolve({
    token: tok({ id: "new", name: "New one" }),
    secret: "irk_AbCd" + "x".repeat(43) });
});
afterEach(() => { cleanup(); setDemo(false); setLang("en"); });

const newTokenButton = () =>
  screen.getAllByRole("button", { name: /New access token/ })[0];

test("the section sits in the AI group after AI review, badge = token count", async () => {
  listed = [tok(), tok({ id: "t2", name: "Cursor" })];
  await show(baseCfg(READ_ONLY), null);
  const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const ai = labels.findIndex((l) => l.startsWith("AI review"));
  const as = labels.findIndex((l) => l.startsWith("AI assistants"));
  expect(as).toBe(ai + 1);
  expect(labels[as]).toMatch(/2$/);
});

test("no tokens: no badge; the search finds the section by its row labels", async () => {
  await show(baseCfg(READ_ONLY), null);
  const row = screen.getByRole("button", { name: /AI assistants/ });
  expect(row.textContent).toBe("AI assistants");
  fireEvent.change(screen.getByLabelText("Search settings"),
    { target: { value: "Revoke all" } });
  expect(screen.getByRole("button", { name: /AI assistants/ })).toBeTruthy();
});

test("with Read only the admin control is Off / On and On saves read_propose", async () => {
  await show(baseCfg({ ...READ_ONLY, access: "off" }));
  const group = screen.getByRole("radiogroup", { name: "Assistant access" });
  expect(within(group).getAllByRole("radio").map((r) => r.textContent))
    .toEqual(["Off", "On"]);
  expect(screen.getByText(/no assistant can reach this server/)).toBeTruthy();
  // nothing but the control and its explanation while it is off
  expect(screen.queryByText("Connect")).toBeNull();
  fireEvent.click(within(group).getByRole("radio", { name: "On" }));
  expect(screen.getByText(/Save to switch assistant access on/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls[0].assistants).toEqual({ access: "read_propose" });
});

test("a saved cap that only exists in a later version reads as On", async () => {
  await show(baseCfg({ ...READ_ONLY, access: "act" }));
  expect(screen.getByRole("radio", { name: "On" }).getAttribute("aria-checked"))
    .toBe("true");
});

test("turning access off asks first and names what stops", async () => {
  listed = [tok(), tok({ id: "t2", name: "Cursor" })];
  await show(baseCfg(READ_ONLY));
  await screen.findByText("Cursor");
  freshCfg = baseCfg({ ...READ_ONLY,
    token_counts: { read: 7, propose: 0, act: 0 } });
  fireEvent.click(screen.getByRole("radio", { name: "Off" }));
  await pressDialog("Cancel").catch(() => {});
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Off" }));
  const dlg = await screen.findByText("Turn assistant access off?");
  expect(dlg).toBeTruthy();
  // the cap is server-wide: the number is every user's, not this list's
  expect(screen.getByText(/7 tokens stop working/)).toBeTruthy();
  await pressDialog("Turn off");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls[0].assistants).toEqual({ access: "off" });
});

test("all three levels: Off / Read and propose / Also act; lowering Act asks", async () => {
  listed = [tok({ level: "act", mails_today: 160 })];
  await show(baseCfg(ALL));
  const group = screen.getByRole("radiogroup", { name: "Assistant access" });
  expect(within(group).getAllByRole("radio").map((r) => r.textContent))
    .toEqual(["Off", "Read and propose", "Also act"]);
  // all three columns + the Never line
  const levels = screen.getByText("What each level allows").closest("div")!
    .parentElement!;
  expect(within(levels).getByText("Everything in Propose")).toBeTruthy();
  expect(within(levels).getByText(/Never, at any level:/)).toBeTruthy();
  // an Act token shows how much of its daily cap it used
  expect(await screen.findByText(/160 of 2,000 mails moved today/)).toBeTruthy();
  freshCfg = baseCfg({ ...ALL, token_counts: { read: 1, propose: 0, act: 3 } });
  fireEvent.click(within(group).getByRole("radio", { name: "Read and propose" }));
  await screen.findByText("Lower assistant access to “Read and propose”?");
  expect(screen.getByText(/3 tokens have Act/)).toBeTruthy();
  await cancelDialog();
  await expectNoDialog();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

test("lowering is measured against the saved cap: raise, then lower again asks nothing", async () => {
  await show(baseCfg({ ...ALL, access: "read_propose" }));
  const group = screen.getByRole("radiogroup", { name: "Assistant access" });
  fireEvent.click(within(group).getByRole("radio", { name: "Also act" }));
  fireEvent.click(within(group).getByRole("radio", { name: "Read and propose" }));
  await expectNoDialog();
  // back at the saved value: nothing staged
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

test("Read only: the levels section has the Read column and the Never line only", async () => {
  await show(baseCfg(READ_ONLY));
  expect(screen.getByText("Read your rules and Activity")).toBeTruthy();
  expect(screen.queryByText("Everything in Read")).toBeNull();
  expect(screen.getByText(/Never, at any level:/)).toBeTruthy();
});

test("Connect: the address is this origin's /mcp, with Copy and the guide", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  await show(baseCfg(READ_ONLY));
  const url = `${window.location.origin}/mcp`;
  expect(screen.getByText(url)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
  const guide = screen.getByRole("link", { name: /Setup guide/ });
  expect(guide.getAttribute("href")).toBe("https://inboxrake.com/docs/assistants/");
});

test("a token row says everything board 90 does; Revoke names it and asks", async () => {
  listed = [tok(), tok({ id: "t2", name: "Open WebUI", prefix: "irk_2bXe",
    expires: NOW - 5 * 86400, subjects: false, last_used: null,
    calls_today: 0 })];
  await show(baseCfg(READ_ONLY));
  await screen.findByText("Claude Code · laptop");
  expect(screen.getByText(/irk_7Fq2… · proton, icloud · subject lines on · expires/))
    .toBeTruthy();
  expect(screen.getByText("Used 4m ago · 38 calls today")).toBeTruthy();
  expect(screen.getByText(/irk_2bXe… .*subject lines off · expired/)).toBeTruthy();
  expect(screen.getByText("Never used · 0 calls today")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revoke Claude Code · laptop" }));
  await screen.findByText("Revoke “Claude Code · laptop”?");
  await cancelDialog();
  await expectNoDialog();
  expect(revoked).toEqual([]);
  // the expired one is removed without a question
  fireEvent.click(screen.getByRole("button", { name: "Remove Open WebUI" }));
  await waitFor(() => expect(revoked).toEqual(["t2"]));
});

test("Revoke asks, then revokes and reloads the list", async () => {
  listed = [tok()];
  await show(baseCfg(READ_ONLY));
  await screen.findByText("Claude Code · laptop");
  fireEvent.click(screen.getByRole("button", { name: /^Revoke Claude Code/ }));
  listed = [];
  await pressDialog("Revoke");
  await waitFor(() => expect(revoked).toEqual(["t1"]));
  expect(await screen.findByText("No access tokens yet")).toBeTruthy();
});

test("Revoke all… counts the tokens and revokes every one", async () => {
  listed = [tok(), tok({ id: "t2", name: "Cursor" })];
  await show(baseCfg(READ_ONLY));
  await screen.findByText("Cursor");
  fireEvent.click(screen.getByRole("button", { name: "Revoke all…" }));
  await screen.findByText("Revoke all 2 access tokens?");
  // verb + count, a danger dialog: Cancel has the focus
  const dlg = await findDialog();
  expect(within(dlg).getByRole("button", { name: "Cancel" })).toBe(document.activeElement);
  expect(within(dlg).getByRole("button", { name: "Revoke all (2)" })).toBeTruthy();
  await pressDialog("Revoke all (2)");
  await waitFor(() => expect(revoked.sort()).toEqual(["t1", "t2"]));
});

test("no tokens yet: an empty state with the New access token… button", async () => {
  await show(baseCfg(READ_ONLY));
  expect(await screen.findByText("No access tokens yet")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Revoke all…" })).toBeNull();
  fireEvent.click(newTokenButton());
  expect(await screen.findByText("New access token")).toBeTruthy();
});

test("Read only: the dialog has no level choice, just the one line", async () => {
  await show(baseCfg(READ_ONLY));
  await screen.findByText("No access tokens yet");
  fireEvent.click(newTokenButton());
  const dlg = await screen.findByRole("dialog");
  expect(within(dlg).queryAllByRole("radio").map((r) => r.textContent))
    .toEqual(["30 days", "90 days", "Never"]);
  expect(within(dlg).getByText("What it may do")).toBeTruthy();
  expect(within(dlg).getByText(/Questions and statistics\. Changes nothing\./))
    .toBeTruthy();
  expect(within(dlg).getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked))
    .toEqual([true, true]);
  expect(within(dlg).getByRole("switch", { name: "Include subject lines" })
    .getAttribute("aria-checked")).toBe("false");
  expect(within(dlg).getByText(/goes to the AI provider of the assistant app/))
    .toBeTruthy();
  // the name is required
  fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
  expect(within(dlg).getByRole("alert").textContent).toBe("Give the token a name.");
  expect(created).toEqual([]);
  // at least one account
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "  Cursor " } });
  for (const c of within(dlg).getAllByRole("checkbox")) fireEvent.click(c);
  fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
  expect(within(dlg).getByText("Choose at least one account.")).toBeTruthy();
  expect(created).toEqual([]);
});

test("creating a token sends the choices, then shows the secret once with setup lines", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const)
    .map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  await show(baseCfg(READ_ONLY));
  await screen.findByText("No access tokens yet");
  fireEvent.click(newTokenButton());
  const dlg = await screen.findByRole("dialog");
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "New one" } });
  fireEvent.click(within(dlg).getAllByRole("checkbox")[1]);          // untick icloud
  fireEvent.click(within(dlg).getByRole("switch"));                  // subject lines on
  fireEvent.click(within(dlg).getByRole("radio", { name: "30 days" }));
  fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
  await screen.findByText("Token “New one” created");
  expect(created).toEqual([{ name: "New one", accounts: ["proton"],
    level: "read", subjects: true, expires_days: 30 }]);
  const secret = "irk_AbCd" + "x".repeat(43);
  const field = screen.getByLabelText("Your token") as HTMLInputElement;
  expect(field.value).toBe(secret);
  expect(screen.getByText(/shown only this once/)).toBeTruthy();
  // the snippet carries the real address and the FULL token
  const url = `${window.location.origin}/mcp`;
  expect(screen.getByRole("tabpanel").textContent)
    .toBe(setupSnippet("claude-code", url, secret));
  for (const [name, text] of [["Cursor", '"mcpServers"'], ["VS Code", '"type": "http"'],
    ["Claude Desktop", "mcp-remote"], ["Other", "Authorization: Bearer"]] as const) {
    fireEvent.click(screen.getByRole("tab", { name }));
    expect(screen.getByRole("tabpanel").textContent).toContain(text);
    expect(screen.getByRole("tabpanel").textContent).toContain(secret);
  }
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(secret));
  // copied: Done closes without a question
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByText("Token “New one” created")).toBeNull());
  // the secret is gone: not on the page, not stored, not logged
  expect(screen.queryByDisplayValue(secret)).toBeNull();
  expect(document.body.textContent).not.toContain(secret);
  expect(document.body.innerHTML).not.toContain(secret);
  for (const store of [localStorage, sessionStorage])
    expect(JSON.stringify({ ...store })).not.toContain(secret);
  for (const spy of spies)
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  spies.forEach((spy) => spy.mockRestore());
  // focus goes to the New access token… control, not <body>
  await waitFor(() => expect(document.activeElement)
    .toBe(newTokenButton()));
});

test("closing the created dialog without copying asks 'Did you copy the token?'", async () => {
  await show(baseCfg(READ_ONLY));
  await screen.findByText("No access tokens yet");
  fireEvent.click(newTokenButton());
  const dlg = await screen.findByRole("dialog");
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "New one" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
  await screen.findByText("Token “New one” created");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText("Did you copy the token?");
  await pressDialog("Go back");
  expect(screen.getByText("Token “New one” created")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await pressDialog("Yes, close");
  await waitFor(() => expect(screen.queryByText("Token “New one” created")).toBeNull());
});

test("a refusal from the server is shown in words and keeps the dialog", async () => {
  createResult = () => Promise.reject(Object.assign(
    new Error("There are already 20 access tokens - revoke one first."),
    { code: "assistant_token_limit" }));
  await show(baseCfg(READ_ONLY));
  await screen.findByText("No access tokens yet");
  fireEvent.click(newTokenButton());
  const dlg = await screen.findByRole("dialog");
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "x" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
  expect(await within(dlg).findByRole("alert")).toBeTruthy();
  expect(within(dlg).getByRole("alert").textContent).toMatch(/20 access tokens/);
  expect(within(dlg).getByRole("button", { name: "Create token" })
    .hasAttribute("disabled")).toBe(false);
});

test("with all levels the dialog offers radio rows, Act brings the warning and a daily limit", async () => {
  await show(baseCfg(ALL));
  await screen.findByText("No access tokens yet");
  fireEvent.click(newTokenButton());
  const dlg = await screen.findByRole("dialog");
  const rows = within(dlg).getByRole("radiogroup", { name: "What it may do" });
  expect(within(rows).getAllByRole("radio")).toHaveLength(3);
  expect(within(rows).getByRole("radio", { name: "Read" })
    .getAttribute("aria-checked")).toBe("true");
  expect(within(dlg).queryByText(/text written to trick an assistant/)).toBeNull();
  fireEvent.click(within(rows).getByRole("radio", { name: /Read, propose and act/ }));
  expect(within(dlg).getByText(/text written to trick an assistant/)).toBeTruthy();
  fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "Act one" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
  await waitFor(() => expect(created.length).toBe(1));
  expect(created[0]).toMatchObject({ level: "act", daily_cap: 2000 });
});

test("levels above the saved cap are disabled with a hint", async () => {
  await show(baseCfg({ ...ALL, access: "read_propose" }));
  await screen.findByText("No access tokens yet");
  fireEvent.click(newTokenButton());
  const dlg = await screen.findByRole("dialog");
  const act = within(dlg).getByRole("radio", { name: /Read, propose and act/ });
  expect(act.hasAttribute("disabled")).toBe(true);
  expect(within(dlg).getByText("Your admin allows up to Read and propose."))
    .toBeTruthy();
});

test("access off: a user sees only that it is off", async () => {
  await show(baseCfg({ ...READ_ONLY, access: "off" }, false));
  expect(screen.getByText("Assistant access is off")).toBeTruthy();
  expect(screen.queryByRole("radiogroup", { name: "Assistant access" })).toBeNull();
  expect(screen.queryByText("Connect")).toBeNull();
});

test("a user with access on gets the quiet note about the admin's cap, no control", async () => {
  await show(baseCfg({ access: "read_propose", levels: ["read", "propose"] }, false));
  expect(screen.getByText("Your admin allows up to Read and propose.")).toBeTruthy();
  expect(screen.queryByRole("radiogroup", { name: "Assistant access" })).toBeNull();
  expect(await screen.findByText("No access tokens yet")).toBeTruthy();
});

test("demo: the hint, the section as it would be, nothing to click", async () => {
  setDemo(true);
  await show(baseCfg({ ...READ_ONLY, access: "off" }));
  expect(screen.getByText(/Not in the demo: an assistant can.t reach a demo that runs inside your browser/)).toBeTruthy();
  expect(screen.getByText("Connect")).toBeTruthy();
  expect(screen.getByText("No access tokens yet")).toBeTruthy();
  expect(newTokenButton().closest("fieldset")!.disabled).toBe(true);
});

test("German: du, and the same canonical shape", async () => {
  setLang("de");
  listed = [tok()];
  await show(baseCfg(READ_ONLY));
  expect(screen.getByRole("radiogroup", { name: "Assistenten-Zugriff" })).toBeTruthy();
  expect(await screen.findByText("Zuletzt vor 4 Min. genutzt · 38 Aufrufe heute")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Claude Code · laptop widerrufen" })).toBeTruthy();
  expect(screen.getByText("Neues Zugriffs-Token…")).toBeTruthy();
});

test("setup snippets: the lines of board 91 with the real address and token", () => {
  const u = "https://mail.home.example/mcp";
  const tk = "irk_7Fq2wXbD9kLmT4sVz0aQe1uYh3NcR8pJ6gWfK5oB2iE";
  expect(setupSnippet("claude-code", u, tk)).toBe(
    `claude mcp add --transport http inboxrake \\\n  ${u} \\\n  --header "Authorization: Bearer ${tk}"`);
  expect(JSON.parse(setupSnippet("cursor", u, tk)).mcpServers.inboxrake)
    .toEqual({ url: u, headers: { Authorization: `Bearer ${tk}` } });
  expect(JSON.parse(setupSnippet("vscode", u, tk)).servers.inboxrake)
    .toEqual({ type: "http", url: u, headers: { Authorization: `Bearer ${tk}` } });
  const d = JSON.parse(setupSnippet("desktop", u, tk)).mcpServers.inboxrake;
  expect(d).toEqual({ command: "npx", args: ["mcp-remote", u, "--header",
    "Authorization:${AUTH}"], env: { AUTH: `Bearer ${tk}` } });
  expect(setupSnippet("other", u, tk)).toBe(
    `Address: ${u}\nHeader: Authorization: Bearer ${tk}`);
});
