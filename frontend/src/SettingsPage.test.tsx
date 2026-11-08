// @vitest-environment jsdom
/* Provider presets: selecting one prefills the connection fields but
 * keeps everything editable; "custom" changes nothing. */

import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within }
  from "@testing-library/react";
import { useState, type ComponentProps, type ReactElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

const foldersCalls: (string | undefined)[] = [];
const saveCalls: any[] = [];
const testDigestCalls: string[] = [];
const scanCalls: (string | undefined)[] = [];
const roleCalls: unknown[][] = [];
const oauthDisconnectCalls: string[] = [];
let foldersResult: unknown = null;   // null: picker stays loading
let saveResult: Promise<unknown> | null = null;   // null: a save never answers
let testDigestResult: { sent: boolean; demo: boolean } =
  { sent: true, demo: false };
const signOutAllCalls: number[] = [];
vi.mock("./api", () => ({
  api: {
    signOutAll: () => { signOutAllCalls.push(1); return Promise.resolve({ ok: true }); },
    folders: (account?: string) => {
      foldersCalls.push(account);
      return foldersResult
        ? Promise.resolve(foldersResult)
        : new Promise(() => {});                 // picker stays loading
    },
    setFolderRole: (...a: unknown[]) => {
      roleCalls.push(a);
      return Promise.resolve({ role: "trash", folder: "Trash",
        source: "override" });
    },
    saveConfig: (body: any) => {
      saveCalls.push(body);
      return saveResult ?? new Promise(() => {});   // response mostly irrelevant
    },
    testDigest: (account: string) => {
      testDigestCalls.push(account);
      return Promise.resolve(testDigestResult);
    },
    scan: (account?: string) => { scanCalls.push(account);
      return Promise.resolve({ ok: true }); },
    getConfig: () => Promise.resolve(cfg),
    knowledge: () => Promise.resolve({ entries: [{ key: "a:amy@solo.example",
      kind: "orders", src: "user", ts: 1, note: "", status: "active",
      reason: "", senders: 1, rows: ["k:orders"] }], complete: true,
    unscanned: [], categories: [], max: 5000, ai_running: false }),
    oauthDisconnect: (a: string) => { oauthDisconnectCalls.push(a);
      return Promise.resolve({}); },
    adminStats: () => Promise.resolve({ tenants: [{
      id: "alice_x.example_ab12cd34", label: "", is_admin_workspace: false,
      accounts: 1, mails: 42, size: 1048576, scans: 3,
      last_scan_ts: Date.now() / 1000 - 3600, rules: 0, verdicts: 5,
      actions_month: { trash: 7, archive: 0, move: 0, mark_read: 0,
        freed: 2048, purge: 3, purged_bytes: 4096 },
      ai: { source: "shared" as const, runs: 2, input_tokens: 100,
        output_tokens: 10, cost: 0.5, month_cost: 0.5, budget_usd: 5 },
      disk_bytes: 4096,
    }] }),
  },
  fmtUsd: (n: number) => `$${n.toFixed(2)}`,
}));

import { SettingsPage } from "./components/SettingsPage";
import type { SettingsSection } from "./nav";
import { popupItem, popupPick } from "./toolTestUtils";
import { presetLabel } from "./presets";
import { DialogProvider, ToastProvider } from "./components/ui";
// The folder picker toasts its outcomes, so every render has a provider.
const render = (ui: ReactElement) =>
  rtlRender(<ToastProvider>{ui}</ToastProvider>);
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { Config, Preset } from "./types";

const acct = {
  excluded_folders: [] as string[],
  host: "127.0.0.1", port: 1143, security: "ssl" as const,
  smtp_host: "", smtp_port: 1025, smtp_security: "auto" as const,
  user: "me@proton.example", password: "", password_set: true,
  cafile: "/certs/bridge-cert.pem", preset: "proton" as const,
  oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg: Config = {
  accounts: {
    default: acct,
    icloud: { ...acct, host: "imap.mail.me.com", preset: "custom",
      user: "me@icloud.example" },
  },
  default_account: "default",
  oauth_providers: ["google", "microsoft"],
  oauth_ms_device_available: false,
  auth: {
    mode: "none", is_admin: true, password_set: false,
    oidc: { issuer: "", client_id: "", client_secret_set: false,
      redirect_base: "", allowed: [] },
  },
  protected: [],
  categories: {}, new_sender_window_days: 7,
  ai: {
    provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0,
  },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};

/** The page with its route kept in state, like App keeps it in the URL:
 *  `section` is the open section (the account section unless told), null the
 *  phone root list. Rendered without matchMedia (jsdom), i.e. the < 1024 layout. */
let goto: (s: SettingsSection | null) => void = () => {};
function Settings({ section: first = "account", ...props }: Partial<
  Omit<ComponentProps<typeof SettingsPage>, "section">> & { cfg: Config;
  account: string; section?: SettingsSection | null }) {
  const [section, setSection] = useState<SettingsSection | null>(first);
  goto = setSection;
  return <SettingsPage onClose={() => {}} onSaved={() => {}}
    onAccountsChanged={() => {}} {...props} section={section}
    onSection={(s) => setSection(s)} />;
}
const openSection = (s: SettingsSection | null) => act(() => { goto(s); });
/** Pick an account like a tap on its row of the root list does. */
const selectAccount = async (name: string) => {
  openSection(null);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
  await screen.findByLabelText("Host");
};

afterEach(() => {
  cleanup();
  setLang("en");
  testDigestCalls.length = 0;
  scanCalls.length = 0;
  testDigestResult = { sent: true, demo: false };
});

const presetButton = () =>
  screen.getByRole("button", { name: /^Provider/ });
const pickPreset = (p: Preset) => popupPick(presetButton(), presetLabel(p));
const hostInput = () => screen.getByLabelText("Host") as HTMLInputElement;

test("gmail preset prefills IMAP + SMTP fields", () => {
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(hostInput().value).toBe("127.0.0.1");
  pickPreset("gmail");
  expect(hostInput().value).toBe("imap.gmail.com");
  expect((screen.getByLabelText(/IMAP port/) as HTMLInputElement).value)
    .toBe("993");
  fireEvent.click(screen.getByText("Sending server (unsubscribe mails)"));
  expect((screen.getByLabelText(/SMTP host/) as HTMLInputElement).value)
    .toBe("smtp.gmail.com");
  // Bridge cert must not leak into a non-Proton account
  expect((screen.getByLabelText(/CA file/) as HTMLInputElement).value)
    .toBe("");
  // A new Gmail account starts on App password (see the sign-in tests).
  expect(screen.getByText(/App password or OAuth - choose below/))
    .toBeTruthy();
});

test("custom preset keeps the current fields", () => {
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  pickPreset("custom");
  expect(hostInput().value).toBe("127.0.0.1");
  expect(presetButton().textContent).toMatch(/Custom/);
});

test("switching Proton -> Custom drops Proton's CA path; Custom keeps its own",
  () => {
    render(<Settings cfg={cfg} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    const ca = () => (screen.getByLabelText(/CA file/) as HTMLInputElement);
    expect(ca().value).toBe("/certs/bridge-cert.pem");
    pickPreset("custom");
    expect(ca().value).toBe("");
    fireEvent.change(ca(), { target: { value: "/my/ca.pem" } });
    pickPreset("custom");
    expect(ca().value).toBe("/my/ca.pem");
  });

test("prefilled fields stay editable", () => {
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  pickPreset("fastmail");
  fireEvent.change(hostInput(), { target: { value: "imap.mine.example" } });
  expect(hostInput().value).toBe("imap.mine.example");
});

test("folder discovery follows the account being edited", async () => {
  foldersCalls.length = 0;
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(foldersCalls).toEqual(["default"]);
  await selectAccount("icloud");
  await waitFor(() => expect(foldersCalls).toEqual(["default", "icloud"]));
  expect(hostInput().value).toBe("imap.mail.me.com");
  // manual re-discover button
  fireEvent.click(screen.getByText(/Discover/));
  expect(foldersCalls).toEqual(["default", "icloud", "icloud"]);
});

test("a virtual view folder is listed under special folders, no checkbox",
  async () => {
    foldersResult = { wildcards: [], folders: [
      { raw: "INBOX", name: "INBOX", role: null, view: false,
        excluded: false },
      { raw: "[Gmail]/Starred", name: "[Gmail]/Starred", role: null,
        view: true, excluded: true }] };
    try {
      render(<Settings cfg={cfg} account="default" onClose={() => {}}
        onSaved={() => {}} onAccountsChanged={() => {}} />);
      expect(await screen.findByText("[Gmail]/Starred")).toBeTruthy();
      expect(screen.getByText(/Views of other folders - never scanned/))
        .toBeTruthy();
      expect(screen.queryByLabelText(/\[Gmail\]\/Starred/)).toBeNull();
      expect((screen.getByLabelText("INBOX") as HTMLButtonElement).disabled)
        .toBe(false);
    } finally {
      foldersResult = null;
    }
  });

test("a look-alike of a special folder is locked and unticked", async () => {
  foldersResult = { wildcards: [], folders: [
    { raw: "Deleted Items", name: "Deleted Items", role: "trash",
      role_source: "flag", ambiguous: false, looks_like: null,
      excluded: true },
    { raw: "Gelöschte Elemente", name: "Gelöschte Elemente", role: null,
      role_source: null, ambiguous: false, looks_like: "trash",
      excluded: true }] };
  try {
    render(<Settings cfg={cfg} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    const box = await screen.findByLabelText(/Gelöschte Elemente/);
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(box.closest("span[title]")?.getAttribute("title"))
      .toMatch(/second special folder/);
  } finally {
    foldersResult = null;
  }
});

const tiedTrash = () => ({ wildcards: [], special: [{
  role: "trash", raw: "Deleted Items", name: "Deleted Items",
  source: "name", ambiguous: true, choices: [
    { raw: "Deleted Items", name: "Deleted Items", count: 3 },
    { raw: "Trash", name: "Trash", count: 1 }] }],
folders: [
  { raw: "INBOX", name: "INBOX", role: null, excluded: false },
  { raw: "Projects", name: "Projects", role: null, excluded: false },
  { raw: "Deleted Items", name: "Deleted Items", role: "trash",
    excluded: true },
  { raw: "Trash", name: "Trash", looks_like: "trash", role: null,
    excluded: true }] });

test("choosing a role folder acts on the edited account, not the active one",
  async () => {
    roleCalls.length = 0;
    foldersResult = tiedTrash();
    try {
      render(<Settings cfg={cfg} account="default" onClose={() => {}}
        onSaved={() => {}} onAccountsChanged={() => {}} />);
      await selectAccount("icloud");
      fireEvent.click(await screen.findByRole("button",
        { name: /Which folder is your Trash folder\?/ }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /^Trash/ }));
      await waitFor(() => expect(roleCalls).toEqual(
        [["trash", "Trash", "icloud"]]));
    } finally {
      foldersResult = null;
    }
  });

test("unsaved ticks survive the reload after a role choice", async () => {
  foldersResult = tiedTrash();
  try {
    render(<Settings cfg={cfg} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    const box = await screen.findByLabelText("Projects");
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);                       // untick, not saved yet
    expect(box.getAttribute("aria-checked")).toBe("false");
    const before = foldersCalls.length;
    fireEvent.click(screen.getByRole("button",
      { name: /Which folder is your Trash folder\?/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Trash/ }));
    await waitFor(() => expect(foldersCalls.length).toBeGreaterThan(before));
    // the reload answers "Projects is scanned" again - the user's untick stays
    await waitFor(() => expect(
      screen.getByLabelText("Projects").getAttribute("aria-checked"))
      .toBe("false"));
    expect(screen.getByLabelText("INBOX").getAttribute("aria-checked"))
      .toBe("true");
  } finally {
    foldersResult = null;
  }
});

const renderWithDialogs = (over: Partial<Parameters<typeof Settings>[0]>
  = {}) => render(<DialogProvider><Settings cfg={cfg} account="default"
  onClose={() => {}} onSaved={() => {}} onAccountsChanged={() => {}}
  {...over} /></DialogProvider>);

test("rename sends rename_account for the edited account", async () => {
  saveCalls.length = 0;
  renderWithDialogs();
  fireEvent.click(screen.getByText("Rename…"));
  const dlg = await findDialog();
  fireEvent.change(within(dlg).getByRole("textbox"),
    { target: { value: "bridge" } });
  await pressDialog("Rename");
  await waitFor(() => expect(saveCalls).toEqual(
    [{ rename_account: { from: "default", to: "bridge" } }]));
});

test("rename validates: empty and duplicate names are refused", async () => {
  saveCalls.length = 0;
  renderWithDialogs();
  fireEvent.click(screen.getByText("Rename…"));
  const dlg = await findDialog();
  const box = within(dlg).getByRole("textbox");
  fireEvent.change(box, { target: { value: "  " } });
  expect(within(dlg).getByRole("alert").textContent).toBe("Enter a name.");
  fireEvent.change(box, { target: { value: "icloud" } });
  expect(within(dlg).getByRole("alert").textContent)
    .toContain('"icloud" already exists');
  await pressDialog("Rename");               // refused: dialog stays open
  expect(await findDialog()).toBe(dlg);
  expect(saveCalls).toEqual([]);
  await cancelDialog();
  await expectNoDialog();
  expect(saveCalls).toEqual([]);
});

test("a new account is named in a prompt and sent as add_account",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs({ section: null });
    fireEvent.click(screen.getByText("Add account"));
    const dlg = await findDialog();
    fireEvent.change(within(dlg).getByRole("textbox"),
      { target: { value: " gmail " } });
    await pressDialog("Add account");
    await waitFor(() => expect(saveCalls).toEqual([{ add_account: "gmail" }]));
  });

test("deleting an account names it in a danger dialog; Cancel keeps it",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    fireEvent.click(screen.getByText('Delete account "default"…'));
    const dlg = await findDialog();
    expect(dlg.textContent).toContain('Delete account "default"');
    expect(dlg.textContent).toContain("Mails on the server are untouched.");
    // ties the text to the backend: mail rules stay (and stop running), only
    // the account's Junk / Trash purge rules are deleted with it
    expect(dlg.textContent).toContain(
      "Its mail rules keep the account name but stop running; its Junk and "
      + "Trash purge rules are deleted.");
    await cancelDialog();
    await expectNoDialog();
    expect(saveCalls).toEqual([]);
    fireEvent.click(screen.getByText('Delete account "default"…'));
    await pressDialog("Delete account");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ delete_account: "default" }]));
  });

test("the German delete-account confirm tells the same truth: mail rules stay, purge rules go",
  async () => {
    setLang("de");
    saveCalls.length = 0;
    renderWithDialogs();
    fireEvent.click(screen.getByText('Konto "default" löschen…'));
    const dlg = await findDialog();
    expect(dlg.textContent).toContain('Konto "default" löschen');
    expect(dlg.textContent).toContain("Mails auf dem Server bleiben unangetastet.");
    // ties the German text to the backend (`rules.drop_account`): mail rules
    // keep the account name but stop running, only the account's Junk /
    // Trash purge rules are deleted with it
    expect(dlg.textContent).toContain(
      "Seine Mail-Regeln behalten den Kontonamen, laufen aber nicht mehr; "
      + "seine Lösch-Regeln für Spam und Papierkorb werden gelöscht.");
    // the English wording must not leak into the German dialog
    expect(dlg.textContent).not.toContain("purge rules");
    await pressDialog("Konto löschen");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ delete_account: "default" }]));
  });

test("a single account cannot be deleted (no Remove section)", () => {
  renderWithDialogs({ cfg: { ...cfg, accounts: { default: acct } } });
  expect(screen.queryByText("Remove account")).toBeNull();
});

test("sections switch the visible form; one section shows at a time", () => {
  renderWithDialogs();
  expect(hostInput()).toBeTruthy();
  openSection("general");
  expect(screen.getByText("Appearance")).toBeTruthy();
  expect(screen.queryByLabelText("Host")).toBeNull();
  openSection("ai");
  expect(screen.getByText("Usage")).toBeTruthy();
  expect(screen.queryByText("Appearance")).toBeNull();
  openSection("backup");
  expect(screen.getByText("Export")).toBeTruthy();
  expect(screen.queryByText("Usage")).toBeNull();
});

test("a section opens under its own heading with a way back to the root list",
  () => {
    renderWithDialogs({ section: null });
    expect(screen.getByRole("heading", { name: "Settings", level: 1 }))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^AI review/ }));
    expect(screen.getByRole("heading", { name: "AI review", level: 1 }))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings", level: 1 }))
      .toBeTruthy();
    expect(screen.queryByText("Usage")).toBeNull();
  });

test("Revert drops staged edits without saving; Save saves and stays open",
  () => {
    saveCalls.length = 0;
    const onClose = vi.fn();
    renderWithDialogs({ onClose });
    // nothing staged: no save bar
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.change(hostInput(), { target: { value: "imap.edited.example" } });
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(within(bar).getByRole("status").textContent)
      .toBe("Connection changed");
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(hostInput().value).toBe("127.0.0.1");
    expect(saveCalls).toEqual([]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.change(hostInput(), { target: { value: "imap.edited.example" } });
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

test("Export and Import live in Backup & restore", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
    { ok: true, json: () => Promise.resolve({ rules: 2, verdicts: 3 }) })));
  const onSaved = vi.fn();
  const { container } = renderWithDialogs({ onSaved });
  expect(screen.queryByText("Export")).toBeNull();
  openSection("backup");
  expect(screen.getByText("Export")).toBeTruthy();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const pick = () => fireEvent.change(input, { target: { files: [
    new File(['{"rules":[]}'], "backup.json", { type: "application/json" })] } });
  // declining the import confirm sends nothing
  pick();
  await cancelDialog();
  await expectNoDialog();
  expect(fetch).not.toHaveBeenCalled();
  // confirming imports and refreshes the config
  pick();
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Settings are overwritten.");
  await pressDialog("Import backup");
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(fetch).toHaveBeenCalledWith("/api/import_config",
    expect.objectContaining({ method: "POST" }));
  await screen.findByText("Imported: 2 rules, 3 verdicts, 0 filed senders.");
  vi.unstubAllGlobals();
});

test("an import names the rules it could not take", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true,
    json: () => Promise.resolve({ rules: 1, verdicts: 0, skipped_rules:
      ["Old rule", "Other"] }) })));
  const { container } = renderWithDialogs({ onSaved: vi.fn() });
  openSection("backup");
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [
    new File(['{"rules":[]}'], "backup.json", { type: "application/json" })] } });
  await findDialog();
  await pressDialog("Import backup");
  await screen.findByText(/Not imported: Old rule, Other\./);
  vi.unstubAllGlobals();
});

test("resetting AI spend and clearing verdicts need a confirmation",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    openSection("ai");
    fireEvent.click(screen.getByText("Reset spend…"));
    await cancelDialog();
    fireEvent.click(screen.getByText("Clear AI verdict cache…"));
    await cancelDialog();
    await expectNoDialog();
    expect(saveCalls).toEqual([]);
    fireEvent.click(screen.getByText("Reset spend…"));
    await pressDialog("Reset spend");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ reset_ai_stats: true }]));
    fireEvent.click(screen.getByText("Clear AI verdict cache…"));
    await pressDialog("Clear cache");
    await waitFor(() => expect(saveCalls.at(-1)).toEqual(
      { clear_ai_verdicts: true }));
  });

test("server settings (login + shared AI) are admin-only", () => {
  saveCalls.length = 0;
  const asUser: Config = {
    ...cfg,
    auth: { mode: "oidc", is_admin: false },
    ai: { ...cfg.ai, available: true, source: "shared",
      shared_budget_usd: 5 },
  };
  render(<Settings cfg={asUser} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  // no Server group at all for non-admins (not even by route) …
  openSection(null);
  expect(screen.queryByText("Sign-in & users")).toBeNull();
  openSection("signin");
  expect(screen.queryByText(/Login \(optional\)/)).toBeNull();
  expect(screen.queryByText(/Shared AI key/)).toBeNull();
  // … Backup & restore stays reachable for everyone …
  openSection(null);
  expect(screen.getByText("Backup & restore")).toBeTruthy();
  // … and the shared-key state is visible in the tenant's AI section
  openSection("ai");
  expect(screen.getByText(/shared key/)).toBeTruthy();
  // saving must not send server-level sections (the API would 403)
  fireEvent.change(screen.getByLabelText(/Model/),
    { target: { value: "claude-opus-5" } });
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls.length).toBe(1);
  expect(saveCalls[0].auth).toBeUndefined();
  expect(saveCalls[0].shared_ai).toBeUndefined();
});

test("the admin sees and saves the shared AI section", async () => {
  saveCalls.length = 0;
  const asAdmin: Config = {
    ...cfg,
    auth: { ...cfg.auth, mode: "oidc", is_admin: true, admin: "me@x" },
    shared_ai: { enabled: true, provider: "anthropic",
      model: "claude-sonnet-5", foundry_endpoint: "", price_in: 0,
      price_out: 0, default_tenant_budget_usd: 5, api_key: "",
      api_key_set: true },
  };
  render(<Settings cfg={asAdmin} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  openSection("signin");
  expect(screen.getByText(/Shared AI key/)).toBeTruthy();
  // the per-user usage table loads (id + shared-key spend/cap visible)
  expect(await screen.findByText(/alice_x.example/)).toBeTruthy();
  expect(screen.getByText(/\$0.50/)).toBeTruthy();
  // "Cleaned (month)": the size is what permanent deletes freed
  // (purged_bytes), never the old move-based `freed`
  const cleaned = screen.getByText(/Cleaned \(month\)/).textContent!;
  expect(cleaned).toContain("4 KB");
  expect(cleaned).not.toContain("2 KB");
  fireEvent.change(screen.getAllByLabelText(/^Model/)[0],
    { target: { value: "claude-opus-5" } });
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].auth.mode).toBe("oidc");
  expect(saveCalls[0].auth.admin).toBe("me@x");
  expect(saveCalls[0].shared_ai.enabled).toBe(true);
  expect(saveCalls[0].shared_ai.default_tenant_budget_usd).toBe(5);
});

test("SSO warnings: open allow-list and missing admin", () => {
  const mk = (admin: string, allowed: string[]): Config => ({
    ...cfg,
    auth: { ...cfg.auth, mode: "oidc", is_admin: true, admin,
      oidc: { issuer: "", client_id: "", client_secret_set: false,
        redirect_base: "", allowed } },
  });
  const show = (c: Config) => {
    render(<Settings cfg={c} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    openSection("signin");
  };
  show(mk("me@x.example", ["me@x.example"]));
  expect(screen.queryByText(/allowed-users list is empty/)).toBeNull();
  expect(screen.queryByText(/No admin is set/)).toBeNull();
  cleanup();
  show(mk("me@x.example", []));
  expect(screen.getByText(/allowed-users list is empty/)).toBeTruthy();
  expect(screen.queryByText(/No admin is set/)).toBeNull();
  cleanup();
  show(mk("", ["me@x.example"]));
  expect(screen.queryByText(/allowed-users list is empty/)).toBeNull();
  expect(screen.getByText(/No admin is set/)).toBeTruthy();
  cleanup();
  show(mk("", []));
  expect(screen.getByText(/allowed-users list is empty.*No admin is set/))
    .toBeTruthy();
});

test("Sign out all sessions asks first, then calls the API; hidden without a login", async () => {
  signOutAllCalls.length = 0;
  const withLogin: Config = {
    ...cfg, auth: { ...cfg.auth, mode: "password", is_admin: true } };
  renderWithDialogs({ cfg: withLogin });
  openSection("signin");
  fireEvent.click(screen.getByText("Sign out all sessions…"));
  await cancelDialog();
  await expectNoDialog();
  expect(signOutAllCalls).toEqual([]);
  fireEvent.click(screen.getByText("Sign out all sessions…"));
  await pressDialog("Sign out all");
  await waitFor(() => expect(signOutAllCalls).toEqual([1]));
  expect(await screen.findByText(/All other sessions were signed out/))
    .toBeTruthy();
  cleanup();
  render(<Settings cfg={{ ...cfg, auth: { ...cfg.auth, mode: "none",
    is_admin: true } }} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  openSection("signin");
  expect(screen.queryByText("Sign out all sessions…")).toBeNull();
});

test("section switches keep unsaved edits and Save persists every section", () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  // edit on the account section …
  fireEvent.change(hostInput(), { target: { value: "imap.new.example" } });
  // … wander off and back - the edit must survive
  openSection("ai");
  fireEvent.change(screen.getByLabelText(/Model/),
    { target: { value: "claude-opus-5" } });
  openSection("account");
  expect(hostInput().value).toBe("imap.new.example");
  // Save (from any section) sends the fields of ALL sections
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].imap.host).toBe("imap.new.example");
  expect(saveCalls[0].ai.model).toBe("claude-opus-5");
});

const schedule = () => screen.getByRole("button", { name: /^Schedule/ });

test("digest schedule + recipient + time are included in Save", () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" section="digest" />);
  popupPick(schedule(), "Weekly");
  fireEvent.change(screen.getByLabelText("Recipient"),
    { target: { value: "me@elsewhere.example" } });
  fireEvent.change(screen.getByLabelText(/^Time/),
    { target: { value: "20:30" } });
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].imap.digest).toEqual(
    { schedule: "weekly", recipient: "me@elsewhere.example",
      hour: 20, minute: 30, url: "", lang: "en" });
});

test("the digest link and language are included in Save (language "
  + "defaults to the UI language)", () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" section="digest" />);
  fireEvent.change(screen.getByLabelText("Link to Inboxrake"),
    { target: { value: " https://app.example " } });
  popupPick(screen.getByRole("button", { name: /^Language of the mail/ }),
    "Deutsch");
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].imap.digest).toMatchObject(
    { url: "https://app.example", lang: "de" });
});

test("the time field only appears once a schedule is picked", () => {
  render(<Settings cfg={cfg} account="default" section="digest" />);
  expect(screen.queryByLabelText(/^Time/)).toBeNull();
  popupPick(schedule(), "Daily");
  expect(screen.getByLabelText(/^Time/)).toBeTruthy();
});

const step = (name: string | RegExp, key: string, times = 1) => {
  const sp = screen.getByRole("spinbutton", { name });
  for (let i = 0; i < times; i++) fireEvent.keyDown(sp, { key });
  return sp;
};

test("the new-sender window defaults from config and is included in Save",
  () => {
    saveCalls.length = 0;
    render(<Settings cfg={cfg} account="default" section="general" />);
    const field = screen.getByRole("spinbutton", { name: /badge stays for/ });
    expect(field.getAttribute("aria-valuenow")).toBe("7");
    expect(field.textContent).toBe("7 days");
    step(/badge stays for/, "ArrowDown", 4);
    expect(field.textContent).toBe("3 days");
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls[0].new_sender_window_days).toBe(3);
  });

test("switching the edited account reloads its own digest settings", async () => {
  render(<Settings cfg={{
    ...cfg,
    accounts: { ...cfg.accounts,
      icloud: { ...cfg.accounts.icloud,
        digest: { schedule: "daily", recipient: "icloud@elsewhere.example",
          hour: 20, minute: 15 } },
    },
  }} account="default" section="digest" />);
  expect(schedule().textContent).toContain("Off");
  popupPick(screen.getByRole("button", { name: /^Account default/ }), "icloud");
  await waitFor(() => expect(schedule().textContent).toContain("Daily"));
  expect((screen.getByLabelText("Recipient") as HTMLInputElement).value)
    .toBe("icloud@elsewhere.example");
  expect((screen.getByLabelText(/^Time/) as HTMLInputElement).value)
    .toBe("20:15");
});

test("auto-scan fields only show cadence/alignment once enabled, and " +
    "save in the shape the backend expects", () => {
  render(<Settings cfg={cfg} account="default" section="autoscan" />);
  expect(screen.queryByRole("spinbutton", { name: "Every" })).toBeNull();
  expect(screen.queryByRole("spinbutton", { name: /Start at minute/ }))
    .toBeNull();

  const on = screen.getByRole("switch", { name: "Enabled" });
  expect(on.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(on);
  expect(on.getAttribute("aria-checked")).toBe("true");
  const every = screen.getByRole("spinbutton", { name: "Every" });
  const align = screen.getByRole("spinbutton", { name: /Start at minute/ });
  expect(every.getAttribute("aria-valuenow")).toBe("6");
  expect(align.getAttribute("aria-valuenow")).toBe("0");

  step("Every", "PageUp");             // 16
  step("Every", "ArrowDown");          // 15
  step(/Start at minute/, "PageUp");   // 10
  saveCalls.length = 0;
  fireEvent.click(screen.getByText("Save"));
  expect(saveCalls[0].imap.auto_scan).toEqual(
    { enabled: true, unit: "hours", value: 15, align_minute: 10 });
});

test("the auto-scan steppers stay inside what the backend accepts", () => {
  render(<Settings cfg={cfg} account="default" section="autoscan" />);
  fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
  step("Every", "End");
  expect(screen.getByRole("spinbutton", { name: "Every" })
    .getAttribute("aria-valuenow")).toBe("24");
  // minutes allow up to 1440, and a bigger hour value is clamped when
  // the unit goes back to hours
  popupPick(screen.getByRole("button", { name: /^Every hours/ }), "minutes");
  step("Every", "End");
  expect(screen.getByRole("spinbutton", { name: "Every" })
    .getAttribute("aria-valuenow")).toBe("1440");
  popupPick(screen.getByRole("button", { name: /^Every minutes/ }), "hours");
  expect(screen.getByRole("spinbutton", { name: "Every" })
    .getAttribute("aria-valuenow")).toBe("24");
  step(/Start at minute/, "End");
  expect(screen.getByRole("spinbutton", { name: /Start at minute/ })
    .getAttribute("aria-valuenow")).toBe("59");
});

test("send test digest reports success", async () => {
  render(<Settings cfg={cfg} account="default" section="digest" />);
  fireEvent.click(screen.getByRole("button", { name: "Send test digest" }));
  expect(testDigestCalls).toEqual(["default"]);
  expect(await screen.findByText("Sent!")).toBeTruthy();
});

test("send test digest reports a demo send distinctly from a real one",
  async () => {
    testDigestResult = { sent: true, demo: true };
    render(<Settings cfg={cfg} account="default" section="digest" />);
    fireEvent.click(screen.getByRole("button", { name: "Send test digest" }));
    expect(await screen.findByText(/preview with example data/)).toBeTruthy();
  });

const searchSwitch = () =>
  screen.getByRole("switch", { name: "Search inside mail text" });
const searchWith = () => screen.getByRole("button", { name: /^Search with/ });

test("mail-text search defaults to the server and saves the chosen mode",
  () => {
    render(<Settings cfg={cfg} account="default" section="general" />);
    expect(searchSwitch().getAttribute("aria-checked")).toBe("true");
    expect(searchWith().textContent).toContain("Ask the mail server");
    fireEvent.click(searchSwitch());
    expect(searchSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Search with/ })).toBeNull();
    saveCalls.length = 0;
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls[0].imap.body_search).toBe("disabled");
  });

test("turning mail-text search back on restores the mode that was set", () => {
  const withKey: Config = { ...cfg, secret_key_set: true };
  render(<Settings cfg={withKey} account="default" section="general" />);
  popupPick(searchWith(), /Local word index/);
  fireEvent.click(searchSwitch());
  expect(searchSwitch().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(searchSwitch());
  expect(searchWith().textContent).toContain("Local word index");
});

test("the Smart threshold defaults to 10 and saves clamped to 2-50", () => {
  const name = "Own row from N mails";
  for (const [key, times, sent] of [["PageUp", 1, 20], ["Home", 1, 2],
    ["End", 1, 50], ["ArrowUp", 5, 15]] as [string, number, number][]) {
    saveCalls.length = 0;
    render(<Settings cfg={cfg} account="default" section="general" />);
    expect(screen.getByRole("spinbutton", { name }).getAttribute("aria-valuenow"))
      .toBe("10");
    step(name, key, times);
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls[0].imap.smart_min, key).toBe(sent);
    cleanup();
  }
});

test("the Smart threshold is read from the account being edited", () => {
  const custom: Config = { ...cfg, accounts: { ...cfg.accounts,
    default: { ...acct, smart_min: 4 } } };
  render(<Settings cfg={custom} account="default" section="general" />);
  expect(screen.getByRole("spinbutton", { name: "Own row from N mails" })
    .getAttribute("aria-valuenow")).toBe("4");
});

test("mail-text search mode is read from the account being edited", () => {
  const off: Config = { ...cfg, accounts: { ...cfg.accounts,
    default: { ...acct, body_search: "disabled" } } };
  render(<Settings cfg={off} account="default" section="general" />);
  expect(searchSwitch().getAttribute("aria-checked")).toBe("false");
});

test("the local index option needs INBOXRAKE_SECRET_KEY on the server", () => {
  render(<Settings cfg={cfg} account="default" section="general" />);
  const local = popupItem(searchWith(), /Local word index/) as
    HTMLButtonElement;
  expect(local.disabled).toBe(true);
});

test("picking the local index saves it and points to the index panel",
  () => {
    const withKey: Config = { ...cfg, secret_key_set: true };
    render(<Settings cfg={withKey} account="default" section="general" />);
    expect((popupItem(searchWith(), /Local word index/) as HTMLButtonElement)
      .disabled).toBe(false);
    fireEvent.click(screen.getByRole("menuitemradio",
      { name: /Local word index/ }));
    expect(screen.getByText(/stores NO readable mail text/)).toBeTruthy();
    // not saved as "local" yet: the build controls wait for the save
    expect(screen.getByText(/Save the settings first/)).toBeTruthy();
    saveCalls.length = 0;
    fireEvent.click(screen.getByText("Save"));
    expect(saveCalls[0].imap.body_search).toBe("local");
  });

test("deleting sends delete_account for the account selected, not the active one",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs();
    await selectAccount("icloud");
    fireEvent.click(screen.getByText('Delete account "icloud"…'));
    await pressDialog("Delete account");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ delete_account: "icloud" }]));
  });

test("the delete dialog lists the data that goes with the account",
  async () => {
    renderWithDialogs();
    fireEvent.click(screen.getByText('Delete account "default"…'));
    const dlg = await findDialog();
    for (const part of ["sign-in and connection settings", "scan results",
      "local search index", "saved filters", "pins", "unsubscribe records",
      "known senders", "digest and auto-scan"]) {
      expect(dlg.textContent).toContain(part);
    }
    await cancelDialog();
  });

test("account names like 'constructor' are valid, real duplicates are not",
  async () => {
    saveCalls.length = 0;
    renderWithDialogs({ section: null });
    fireEvent.click(screen.getByText("Add account"));
    const dlg = await findDialog();
    fireEvent.change(within(dlg).getByRole("textbox"),
      { target: { value: "constructor" } });
    expect(within(dlg).queryByRole("alert")).toBeNull();
    await pressDialog("Add account");
    await waitFor(() => expect(saveCalls).toEqual(
      [{ add_account: "constructor" }]));
  });

test("OAuth disconnect asks first; Cancel disconnects nothing", async () => {
  oauthDisconnectCalls.length = 0;
  const oauthCfg: Config = { ...cfg, accounts: { ...cfg.accounts,
    default: { ...acct, preset: "gmail", oauth: { provider: "google",
      client_id: "id", client_secret_set: true, connected: true } as any } } };
  renderWithDialogs({ cfg: oauthCfg });
  fireEvent.click(screen.getByText("Disconnect"));
  await cancelDialog();
  await expectNoDialog();
  expect(oauthDisconnectCalls).toEqual([]);
  fireEvent.click(screen.getByText("Disconnect"));
  await pressDialog("Disconnect");
  await waitFor(() => expect(oauthDisconnectCalls).toEqual(["default"]));
});

test("resetting spend names the amounts it clears", async () => {
  renderWithDialogs();
  openSection("ai");
  fireEvent.click(screen.getByText("Reset spend…"));
  expect((await findDialog()).textContent).toContain("this month's spend");
  await cancelDialog();
});

test("the AI section has a box for the user's own AI-sorting instructions, "
  + "saved with the rest and capped at 1500 characters", () => {
  saveCalls.length = 0;
  renderWithDialogs();
  openSection("ai");
  const box = screen.getByRole("textbox",
    { name: "Your instructions for AI sorting (optional)" }) as
    HTMLTextAreaElement;
  expect(box.value).toBe("");
  expect(box.maxLength).toBe(1500);
  expect(screen.getByText(/Added to the fixed instructions when the AI sorts/))
    .toBeTruthy();
  fireEvent.change(box, { target: { value: "Mails from my landlord are support." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls.at(-1).ai.sort_instructions)
    .toBe("Mails from my landlord are support.");
});


test("the Filed senders section lists what the user filed; nothing to save there",
  async () => {
    render(<ToastProvider><DialogProvider><Settings cfg={cfg}
      account="default" onClose={() => {}} onSaved={() => {}}
      onAccountsChanged={() => {}} aiAnswers={2} /></DialogProvider></ToastProvider>);
    openSection("filed");
    expect(await screen.findByText("What Inboxrake knows about your senders"))
      .toBeTruthy();
    expect(await screen.findByText("amy@solo.example")).toBeTruthy();
    expect(screen.getByText(/Changes here apply at once/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep all AI answers" }))
      .toHaveProperty("disabled", false);
    expect(screen.queryByLabelText("Host")).toBeNull();
  });

test("the backup text says the file lists sender addresses", () => {
  renderWithDialogs();
  openSection("backup");
  expect(screen.getByText(/The file lists sender addresses - keep it private\./))
    .toBeTruthy();
});

// ---------------------------------------------------- Gmail sign-in method

const signinTab = (name: string) =>
  screen.getByRole("radio", { name }) as HTMLElement;
// The tabpanel is labelled by its tab, so the label text matches both.
/** A saved password sits behind "Change…": open it. */
const revealPassword = () => {
  const b = screen.queryByRole("button", { name: "Change…" });
  if (b) fireEvent.click(b);
};
const appPw = () => (revealPassword(), screen.getAllByLabelText("App password"))
  .find((el) => el.tagName === "INPUT") as HTMLInputElement;
const lastSave = () => saveCalls[saveCalls.length - 1].imap;
const clickSave = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveCalls.length).toBeGreaterThan(0));
};
const oauthAcct = (over: object = {}) => ({
  ...acct, host: "imap.gmail.com", preset: "gmail" as const,
  user: "me@gmail.example", password_set: true,
  oauth: { provider: "google" as const, client_id: "cid",
    client_secret_set: true, connected: true }, ...over });
const gmailCfg = (a: object): Config =>
  ({ ...cfg, accounts: { ...cfg.accounts, default: a as any } });

test("new account + gmail preset starts on App password: Password " +
  "field, no OAuth card, Save sends auth=password and no oauth block",
  async () => {
    saveCalls.length = 0;
    render(<Settings cfg={cfg} account="default" onClose={() => {}}
      onSaved={() => {}} onAccountsChanged={() => {}} />);
    pickPreset("gmail");
    expect(signinTab("App password").getAttribute("aria-checked"))
      .toBe("true");
    expect(appPw()).toBeTruthy();
    expect(screen.queryByText(/Connect your Gmail account/)).toBeNull();
    expect(screen.getByText(/Create an app password at/))
      .toBeTruthy();
    await clickSave();
    expect(lastSave().auth).toBe("password");
    expect(lastSave().oauth).toBeUndefined();
  });

test("switching to OAuth shows the OAuth card instead of the Password " +
  "field; Save sends auth=oauth + oauth.provider google", async () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  pickPreset("gmail");
  fireEvent.click(signinTab("OAuth"));
  expect(screen.getByText(/Connect your Gmail account/)).toBeTruthy();
  expect(screen.queryByText(/Create an app password/)).toBeNull();
  expect(screen.queryByLabelText("Password")).toBeNull();
  await clickSave();
  expect(lastSave().auth).toBe("oauth");
  expect(lastSave().oauth.provider).toBe("google");
});

test("a saved gmail account opens on the stored method - even when OAuth " +
  "is still connected but the method is App password", () => {
  const { unmount } = render(<Settings
    cfg={gmailCfg(oauthAcct({ auth: "oauth" }))} account="default"
    onClose={() => {}} onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(signinTab("OAuth").getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("Connected")).toBeTruthy();
  unmount();
  render(<Settings cfg={gmailCfg(oauthAcct({ auth: "password" }))}
    account="default" onClose={() => {}} onSaved={() => {}}
    onAccountsChanged={() => {}} />);
  expect(signinTab("App password").getAttribute("aria-checked"))
    .toBe("true");
  expect(screen.queryByText("Connected")).toBeNull();
});

test("an older backend (no auth field) derives the method from the " +
  "connected token", () => {
  render(<Settings cfg={gmailCfg(oauthAcct())} account="default"
    onClose={() => {}} onSaved={() => {}} onAccountsChanged={() => {}} />);
  expect(signinTab("OAuth").getAttribute("aria-checked")).toBe("true");
});

test("switching back and forth then Save never sends disconnect and keeps " +
  "the client id", async () => {
  saveCalls.length = 0;
  oauthDisconnectCalls.length = 0;
  render(<Settings cfg={gmailCfg(oauthAcct({ auth: "oauth" }))}
    account="default" onClose={() => {}} onSaved={() => {}}
    onAccountsChanged={() => {}} />);
  fireEvent.click(signinTab("App password"));
  fireEvent.click(signinTab("OAuth"));
  fireEvent.click(signinTab("App password"));
  await clickSave();
  expect(JSON.stringify(saveCalls[0])).not.toContain("disconnect");
  expect(lastSave().auth).toBe("password");
  expect(lastSave().oauth).toBeUndefined();
  cleanup();
  saveCalls.length = 0;
  render(<Settings cfg={gmailCfg(oauthAcct({ auth: "oauth" }))}
    account="default" />);
  fireEvent.click(signinTab("App password"));
  fireEvent.click(signinTab("OAuth"));
  // back on the saved method the form equals what is saved: nothing to save
  // until something else is edited
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.change(screen.getByLabelText("User"),
    { target: { value: "me2@gmail.example" } });
  await clickSave();
  expect(JSON.stringify(saveCalls[0])).not.toContain("disconnect");
  expect(lastSave().auth).toBe("oauth");
  expect(lastSave().oauth.client_id).toBe("cid");
  expect(oauthDisconnectCalls).toEqual([]);
});

test("whitespace is stripped from a Gmail app password", async () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  pickPreset("gmail");
  fireEvent.change(appPw(), { target: { value: "abcd efgh\u00a0ijkl  mnop" } });
  await clickSave();
  expect(lastSave().password).toBe("abcdefghijklmnop");
});

test("other presets keep the password exactly as typed", async () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  pickPreset("icloud");
  revealPassword();
  fireEvent.change(screen.getByLabelText("Password"),
    { target: { value: "ab cd" } });
  await clickSave();
  expect(lastSave().password).toBe("ab cd");
});

test("connected gmail account -> iCloud preset: Save sends " +
  "auth=password and no oauth block (fix A)", async () => {
  saveCalls.length = 0;
  render(<Settings cfg={gmailCfg(oauthAcct({ auth: "oauth" }))}
    account="default" onClose={() => {}} onSaved={() => {}}
    onAccountsChanged={() => {}} />);
  pickPreset("icloud");
  expect(screen.queryByRole("radio", { name: "OAuth" })).toBeNull();
  expect(screen.getByText("Password")).toBeTruthy();
  await clickSave();
  expect(lastSave().auth).toBe("password");
  expect(lastSave().oauth).toBeUndefined();
});

test("outlook preset: OAuth card, no switch, no Password field, " +
  "auth=oauth", async () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  pickPreset("outlook");
  expect(screen.queryByRole("radio", { name: "OAuth" })).toBeNull();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.getByText(/Connect your Outlook account/)).toBeTruthy();
  await clickSave();
  expect(lastSave().auth).toBe("oauth");
});

test("German: the sign-in switch is translated", () => {
  setLang("de");
  render(<Settings cfg={gmailCfg(oauthAcct({ auth: "password" }))}
    account="default" onClose={() => {}} onSaved={() => {}}
    onAccountsChanged={() => {}} />);
  expect(screen.getByRole("radio", { name: "App-Passwort" })).toBeTruthy();
  expect(screen.getByText("Anmeldeart", { selector: "span" })).toBeTruthy();
});

test("the client-secret placeholder is 'optional' for Outlook and " +
  "'required' for Gmail", () => {
  const secret = () => screen.getByLabelText("Client secret")
    .getAttribute("placeholder");
  render(<Settings cfg={cfg} account="default" onClose={() => {}}
    onSaved={() => {}} onAccountsChanged={() => {}} />);
  pickPreset("outlook");
  expect(secret()).toBe("optional");
  pickPreset("gmail");
  fireEvent.click(screen.getByRole("radio", { name: "OAuth" }));
  expect(secret()).toBe("required");
});

test("Save waits for the request in flight: no double submit", () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" />);
  fireEvent.change(hostInput(), { target: { value: "imap.edited.example" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
    .disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls).toHaveLength(1);
});

test("OAuth Connect saves, then leaves without the browser's 'Leave site?' prompt",
  async () => {
    saveCalls.length = 0;
    saveResult = Promise.resolve(cfg);
    try {
      render(<Settings cfg={gmailCfg(oauthAcct({ auth: "oauth",
        oauth: { provider: "google", client_id: "", client_secret_set: false,
          connected: false } }))} account="default" />);
      fireEvent.change(screen.getByLabelText("Client ID"),
        { target: { value: "new-id" } });
      const stay = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(stay);
      expect(stay.defaultPrevented).toBe(true);       // dirty: asks on reload
      fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
      await waitFor(() => expect(saveCalls).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 20));
      const go = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(go);
      expect(go.defaultPrevented).toBe(false);        // the redirect is ours
    } finally {
      saveResult = null;
    }
  });

test("changing the language with unsaved edits asks first (the switch reloads)",
  async () => {
    renderWithDialogs({ section: "general" });
    fireEvent.click(screen.getByRole("switch", { name: "Search inside mail text" }));
    popupPick(screen.getByRole("button", { name: /^Language/ }), "Deutsch");
    expect((await findDialog()).textContent).toContain("Save your changes?");
    await cancelDialog();
    await expectNoDialog();
    expect(localStorage.getItem("pmc_lang")).not.toBe("de");
  });

test("the language switch reloads without the 'Leave site?' prompt after Save or Discard",
  async () => {
    for (const choice of ["Save", "Discard changes"]) {
      saveResult = Promise.resolve(cfg);
      try {
        renderWithDialogs({ section: "general" });
        fireEvent.click(screen.getByRole("switch",
          { name: "Search inside mail text" }));
        popupPick(screen.getByRole("button", { name: /^Language/ }), "Deutsch");
        await pressDialog(choice);
        await waitFor(() => expect(localStorage.getItem("pmc_lang")).toBe("de"));
        const ev = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(ev);
        expect(ev.defaultPrevented, choice).toBe(false);
      } finally {
        saveResult = null;
        localStorage.removeItem("pmc_lang");
        setLang("en");
        cleanup();
      }
    }
  });

test("account header: status pill from the saved sign-in and the scan state; " +
  "Scan now scans the edited account", async () => {
  const ago = Date.now() / 1000 - 600;
  render(<Settings cfg={cfg} account="default"
    scanState={{ account: "default", status: "done", scanned_ts: ago,
      error: "" }} />);
  expect(screen.getByText("Signed in · scanned 10m ago")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Scan now/ }));
  await waitFor(() => expect(scanCalls).toEqual(["default"]));
  cleanup();
  render(<Settings cfg={{ ...cfg, accounts: { ...cfg.accounts,
    default: { ...acct, password_set: false } } }} account="default" />);
  expect(screen.getByText("Not signed in")).toBeTruthy();
  expect((screen.getByRole("button", { name: /Scan now/ }) as
    HTMLButtonElement).disabled).toBe(true);
});

test("account header: a failed scan shows its error; a running one disables " +
  "Scan now", () => {
  const { unmount } = render(<Settings cfg={cfg} account="default"
    scanState={{ account: "default", status: "error", scanned_ts: null,
      error: "login refused" }} />);
  expect(screen.getByText("Signed in · last scan failed")).toBeTruthy();
  expect(screen.getByText("login refused")).toBeTruthy();
  unmount();
  render(<Settings cfg={cfg} account="default"
    scanState={{ account: "default", status: "scanning", scanned_ts: null,
      error: "" }} />);
  expect((screen.getByRole("button", { name: /Scan now/ }) as
    HTMLButtonElement).disabled).toBe(true);
});

test("a saved password is never prefilled: '••••' + Change… reveals an " +
  "empty field that is only sent once typed", async () => {
  saveCalls.length = 0;
  render(<Settings cfg={cfg} account="default" />);
  expect(screen.queryByLabelText("Password")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Change…" }));
  const pw = screen.getByLabelText("Password") as HTMLInputElement;
  expect(pw.value).toBe("");
  expect(pw.placeholder).toBe("(unchanged)");
  fireEvent.change(pw, { target: { value: "s3cret" } });
  expect(screen.getByText("Password changed")).toBeTruthy();
  await clickSave();
  expect(lastSave().password).toBe("s3cret");
});

test("the sending server unfolds under Advanced and stays staged", () => {
  render(<Settings cfg={cfg} account="default" />);
  const row = screen.getByRole("button",
    { name: /Sending server \(unsubscribe mails\)/ });
  expect(row.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByLabelText(/SMTP host/)).toBeNull();
  fireEvent.click(row);
  expect(row.getAttribute("aria-expanded")).toBe("true");
  fireEvent.change(screen.getByLabelText(/SMTP host/),
    { target: { value: "smtp.edited.example" } });
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
});

test("scanned folders show their mail count; unseen ones show none",
  async () => {
    foldersResult = { wildcards: [], mail_counts: { INBOX: 3 }, folders: [
      { raw: "INBOX", name: "INBOX", role: null, excluded: false },
      { raw: "Later", name: "Later", role: null, excluded: true }] };
    try {
      render(<Settings cfg={cfg} account="default" />);
      expect(await screen.findByText("3 mails")).toBeTruthy();
      expect(screen.getAllByText(/\d+ mails?/)).toHaveLength(1);
    } finally {
      foldersResult = null;
    }
  });

test("Scan now scans the edited account even when it is not the active one; " +
  "unsaved edits disable it with a hint", async () => {
  render(<Settings cfg={cfg} account="default" />);
  await selectAccount("icloud");
  fireEvent.click(screen.getByRole("button", { name: /Scan now/ }));
  await waitFor(() => expect(scanCalls).toEqual(["icloud"]));
  fireEvent.change(hostInput(), { target: { value: "imap.edited.example" } });
  expect((screen.getByRole("button", { name: /Scan now/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Save first/)).toBeTruthy();
});

test("the sending server folds back when another account is opened",
  async () => {
    render(<Settings cfg={cfg} account="default" />);
    fireEvent.click(screen.getByText("Sending server (unsubscribe mails)"));
    expect(screen.getByLabelText(/SMTP host/)).toBeTruthy();
    await selectAccount("icloud");
    expect(screen.queryByLabelText(/SMTP host/)).toBeNull();
  });

test("protected senders and categories save the same payload the text areas did", () => {
  saveCalls.length = 0;
  render(<Settings cfg={{ ...cfg, protected: ["boss@work.example"],
    categories: { insurance: ["allianz"], shipping: [] } }}
    account="default" section="protected" />);
  const input = () => screen.getByRole("textbox",
    { name: "Add address or domain…" });
  fireEvent.click(screen.getByRole("button", { name: "Add address or domain…" }));
  fireEvent.change(input(), { target: { value: "bank.example" } });
  fireEvent.keyDown(input(), { key: "Enter" });
  openSection("categories");
  // an empty list = a built-in turned off: visible, and stored as before
  expect(screen.getByText(/Turned off/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add a keyword to insurance" }));
  const kw = screen.getByRole("textbox", { name: "Add a keyword to insurance" });
  fireEvent.change(kw, { target: { value: "huk" } });
  fireEvent.keyDown(kw, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls[0].protected).toEqual(["boss@work.example", "@bank.example"]);
  expect(saveCalls[0].categories).toEqual(
    { insurance: ["allianz", "huk"], shipping: [] });
});

test("AI review: budget ring with spend of cap, key never prefilled, prices and instructions stay", () => {
  saveCalls.length = 0;
  render(<Settings section="ai" account="default" cfg={{ ...cfg, ai: {
    ...cfg.ai, api_key_set: true, budget_usd: 5, month_cost: 0.38 } }} />);
  expect(screen.getByRole("img", { name: "$0.38 of $5.00" })).toBeTruthy();
  expect(screen.getByText(/Budget resets/)).toBeTruthy();
  // a saved key is "•••• set · Change…", the field only appears on Change
  expect(screen.queryByLabelText("API key", { selector: "input" })).toBeNull();
  expect(screen.getByText("•••• set")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Change…" }));
  const key = screen.getByLabelText("API key", { selector: "input" }) as HTMLInputElement;
  expect(key.value).toBe("");
  fireEvent.change(key, { target: { value: "sk-new" } });
  popupPick(/^Provider/, "OpenAI");
  fireEvent.change(screen.getByLabelText("Input price ($ per 1M tokens)"),
    { target: { value: "1.5" } });
  fireEvent.change(screen.getByLabelText(/Monthly AI budget/),
    { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls[0].ai).toMatchObject({ provider: "openai",
    api_key: "sk-new", price_in: 1.5, price_out: 0, budget_usd: 7 });
});

test("AI review: a budget that is no number blocks Save instead of saving 0", () => {
  saveCalls.length = 0;
  render(<Settings section="ai" account="default" cfg={{ ...cfg, ai: {
    ...cfg.ai, budget_usd: 5 } }} />);
  const budget = screen.getByLabelText(/Monthly AI budget/);
  fireEvent.change(budget, { target: { value: "abc" } });
  expect(budget.getAttribute("aria-invalid")).toBe("true");
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toMatch(/Enter a number/);
  fireEvent.click(save);
  expect(saveCalls.length).toBe(0);
  fireEvent.change(budget, { target: { value: "7,5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls[0].ai.budget_usd).toBe(7.5);
});

test("AI review without a cap shows what was spent, no ring", () => {
  render(<Settings section="ai" account="default"
    cfg={{ ...cfg, ai: { ...cfg.ai, month_cost: 1.25 } }} />);
  expect(screen.queryByRole("img", { name: /of/ })).toBeNull();
  expect(screen.getByText(/spent this month: \$1\.25/)).toBeTruthy();
  // no saved key: the field is there at once
  expect(screen.getByLabelText("API key", { selector: "input" })).toBeTruthy();
});

test("Sign-in & users: the login method is a choice of rows with their own fields", () => {
  saveCalls.length = 0;
  render(<Settings section="signin" account="default" cfg={cfg} />);
  const none = screen.getByRole("radio", { name: /None/ });
  expect(none.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByLabelText("Login password")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Password" }));
  fireEvent.change(screen.getByLabelText("Login password"),
    { target: { value: "s3cret" } });
  fireEvent.click(screen.getByRole("radio", { name: /SSO/ }));
  expect(screen.queryByLabelText("Login password")).toBeNull();
  fireEvent.change(screen.getByLabelText("Issuer URL"),
    { target: { value: "https://id.example" } });
  fireEvent.click(screen.getByRole("radio", { name: "Password" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(saveCalls[0].auth.mode).toBe("password");
  expect(saveCalls[0].auth.password).toBe("s3cret");
  expect(saveCalls[0].auth.oidc.issuer).toBe("https://id.example");
});

test("AI key: after Save or Revert the key shows '•••• set' again", async () => {
  saveCalls.length = 0;
  const withKey = { ...cfg, ai: { ...cfg.ai, api_key_set: true } };
  saveResult = Promise.resolve(withKey);
  render(<Settings section="ai" account="default" cfg={withKey} />);
  const change = () => fireEvent.click(screen.getByRole("button", { name: "Change…" }));
  change();
  fireEvent.change(screen.getByLabelText("API key", { selector: "input" }), { target: { value: "sk-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));
  expect(screen.getByText("•••• set")).toBeTruthy();
  change();
  fireEvent.change(screen.getByLabelText("API key", { selector: "input" }), { target: { value: "sk-2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("•••• set")).toBeTruthy();
  expect(saveCalls.at(-1).ai.api_key).toBe("sk-2");
  saveResult = null;
});

test("the digest language row says so while none is stored yet", () => {
  render(<Settings cfg={cfg} account="default" section="digest" />);
  expect(screen.getByText(/Not saved yet - mails go out in English/))
    .toBeTruthy();
});

/* V5: in an installed app a drag from the left edge goes up from a section,
   exactly like the "Settings" back link. */
test("edge swipe back leaves a section for the root list (installed app only)", () => {
  const fire = (target: Element | Window, name: string, x: number, t: number) => {
    const ev = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: 0 },
      pointerId: { value: 1 }, isPrimary: { value: true },
      pointerType: { value: "touch" }, timeStamp: { value: t } });
    act(() => { target.dispatchEvent(ev); });
  };
  const edge = () => {
    fire(document.body, "pointerdown", 8, 0);
    fire(window, "pointermove", 120, 100);
    fire(window, "pointermove", 260, 200);
    fire(window, "pointerup", 260, 300);
  };
  let standalone = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: standalone && q.includes("display-mode: standalone"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
  try {
    renderWithDialogs({ section: "ai" });
    edge();                                     // in a browser tab: nothing
    expect(screen.getByRole("heading", { name: "AI review", level: 1 })).toBeTruthy();
    standalone = true;
    edge();
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
    expect(screen.queryByText("Usage")).toBeNull();
    edge();                                     // the root list has no back target
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
  } finally {
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  }
});
