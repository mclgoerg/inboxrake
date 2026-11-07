// @vitest-environment jsdom
/* Quick wins as the Overview's Suggestions: cards, Review, Clean up (always
 * via the confirm), "Not now" per account, German; gone from Senders. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const deleteGroups = vi.fn()
  .mockResolvedValue({ ok: true, queued: 1, skipped: 0 });

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    group: () => Promise.resolve([]),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  noticeParams: (p: Record<string, unknown>) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import { setLang } from "./i18n";
import { saveDismissed } from "./quickwins";
import type { AppState, Config, Group } from "./types";

const MB = 1048576;
const acct = {
  excluded_folders: [] as string[],
  host: "h", port: 993, security: "ssl" as const,
  smtp_host: "", smtp_port: 587, smtp_security: "auto" as const,
  user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg: Config = {
  default_account: "proton",
  accounts: { proton: { ...acct, user: "me@proton.example" },
    other: { ...acct, user: "me@other.example" } },
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
};
const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [],
  samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 80, ...over,
});
const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
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
};
// Card 1 (old newsletters): news = 20 mails. Card 2 (quiet): quiet = 30
// mails; the protected sender matches it too but is skipped.
const news = mk("news@x.example", { tags: ["newsletter"], count: 20,
  unread: 19, size: 6 * MB, last: "2024-01-01" });
const quiet = mk("quiet@x.example", { count: 30, size: 10 * MB,
  engagement: 10, last: "2024-01-01" });
const prot = mk("prot@x.example", { count: 40, size: 20 * MB,
  engagement: 10, last: "2024-01-01", protected: true });
const fresh = mk("fresh@x.example");

const setup = (over: Partial<AppState> = {},
               groups = [news, quiet, prot, fresh]) => {
  localStorage.setItem("pmc_account", "proton");
  state = { ...baseState, ...over, groups: { sender: Object.fromEntries(
    groups.map((g) => [g.key, g])), smart: {}, domain: {}, subject: {},
    thread: {} } };
  render(<ToastProvider><DialogProvider><App /></DialogProvider>
    </ToastProvider>);
};
// No route = the Overview, the start page; Senders is opened by hash.
beforeEach(() => { window.location.hash = ""; });
const ready = () => screen.findByRole("region", { name: "Storage" });
const readySenders = () => waitFor(() => expect(
  screen.getAllByText("Label fresh").length).toBeGreaterThan(0));
const big = () => {
  const old = { last: "2020-01-01", count: 20 };
  const done = { n: 1, of: 1, status: "done" as const, link: "", addr: "" };
  const ai = { verdict: "delete_safe", reason: "" } as Group["ai"];
  setup({}, [
    mk("g1@x.example", { ...old, tags: ["newsletter"], unread: 20,
      size: 60 * MB }),
    mk("g2@x.example", { ...old, engagement: 5, size: 50 * MB }),
    mk("g3@x.example", { ...old, unsubscribed: done, size: 40 * MB }),
    mk("g4@x.example", { ...old, att_size: 30 * MB, size: 30 * MB }),
    mk("g5@x.example", { ...old, ai, size: 20 * MB }),
  ]);
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  deleteGroups.mockClear();
  setLang("en");
});

test("the suggestions list the cards, the hero the union size", async () => {
  setup();
  await ready();
  const cards = screen.getAllByTestId("qw-card");
  expect(cards).toHaveLength(2);
  expect(cards[0].textContent).toContain("Quiet senders");   // 10 MB first
  expect(cards[0].textContent).toContain("30 mails - 10.0 MB");
  expect(cards[1].textContent).toContain("20 mails - 6.0 MB");
  expect(cards[0].textContent).toContain("1 protected skipped");
  expect(screen.getByText("Up to 16.0 MB can go")).toBeTruthy();
});

test("no suggestions section without cards; the Senders list has no strip",
  async () => {
  setup({}, [fresh]);
  await ready();
  expect(screen.queryByRole("heading", { name: "Suggestions" })).toBeNull();
  expect(screen.queryByText(/can go/)).toBeNull();
  cleanup();

  window.location.hash = "#/senders";
  setup();
  await readySenders();
  expect(screen.queryByTestId("qw-card")).toBeNull();
  expect(screen.queryByRole("region", { name: "Quick wins" })).toBeNull();
});

test("Review lands on Senders with the filter set and the card's groups " +
  "selected", async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);
  expect((await screen.findByPlaceholderText("Search or filter…") as
    HTMLInputElement).value).toBe("eng:low age:>1y");
  expect(window.location.hash).toBe("#/senders");
  // exactly the one non-protected match is selected (bar: groups + mails)
  await waitFor(() => expect(screen.getByText(/^1 group · 30 mails · 10\.0 MB$/))
    .toBeTruthy());
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("Clean up opens the trash confirm with the card's counts and does " +
  "nothing on Cancel", async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Clean up…" })[0]);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("30 mails");
  expect(dlg.textContent).not.toContain("40");       // protected skipped
  expect(window.location.hash).toBe("");              // still on the Overview
  expect(deleteGroups).not.toHaveBeenCalled();
  await cancelDialog();
  await expectNoDialog();
  expect(deleteGroups).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");              // Cancel: where we were
  expect(screen.getByRole("region", { name: "Storage" })).toBeTruthy();
});

test("confirming Clean up trashes exactly the card's non-protected keys, " +
  "in the Sender grouping", async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Clean up…" })[0]);
  await pressDialog(/Move to Trash/);
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledWith(
    "sender", ["quiet@x.example"], "trash", "", false, null, null));
  expect(window.location.hash).toBe("");              // Overview, in place
});

test("Clean up and Review work on the Sender groups whatever grouping " +
  "Senders was left on (Smart, Thread)", async () => {
  for (const tab of ["Smart", "Thread"]) {
    window.location.hash = "#/senders";
    setup();
    await readySenders();
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    if (tab === "Smart")
      expect(screen.getByText(/Smart pools small senders/)).toBeTruthy();
    const bar = within(screen.getByRole("navigation",
      { name: "Main navigation" }));
    fireEvent.click(bar.getByRole("link", { name: "Overview" }));
    await ready();
    // the Smart first-use help belongs to Senders only
    expect(screen.queryByText(/Smart pools small senders/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Clean up…" })[0]);
    await pressDialog(/Move to Trash/);
    await waitFor(() => expect(deleteGroups).toHaveBeenLastCalledWith(
      "sender", ["quiet@x.example"], "trash", "", false, null, null));
    expect(window.location.hash).toBe("#/overview");
    // Review lands on the Sender tab with the card's query and selection
    fireEvent.click(screen.getAllByRole("button", { name: "Review" })[0]);
    expect((await screen.findByPlaceholderText("Search or filter…") as
      HTMLInputElement).value).toBe("eng:low age:>1y");
    expect(screen.getByRole("tab", { name: "Sender" })
      .getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(screen.getByText(/^1 group · 30 mails · 10\.0 MB$/))
      .toBeTruthy());
    cleanup();
    localStorage.clear();
    window.location.hash = "";
    deleteGroups.mockClear();
  }
});

test("phones: Suggestions are a compact list; the row is Review, More holds " +
  "Clean up… and Not now", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("767"), media: q,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
  try {
    setup();
    await ready();
    const rows = screen.getAllByTestId("qw-card");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("30 mails - 10.0 MB");
    expect(within(rows[0]).queryByRole("button", { name: "Not now" })).toBeNull();
    fireEvent.click(within(rows[0]).getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Not now" }));
    expect(screen.getAllByTestId("qw-card")).toHaveLength(1);
    fireEvent.click(within(screen.getAllByTestId("qw-card")[0])
      .getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Clean up…" }));
    await findDialog();
    await cancelDialog();
    fireEvent.click(within(screen.getAllByTestId("qw-card")[0])
      .getByRole("button", { name: /^Review/ }));
    expect((await screen.findByPlaceholderText("Search or filter…") as
      HTMLInputElement).value).toBe("tag:newsletter unread:>90 age:>6m");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("Not now hides the card for this account only, and it returns after " +
  "25 % more mails", async () => {
  setup();
  await ready();
  fireEvent.click(screen.getAllByRole("button", { name: "Not now" })[0]);
  expect(screen.getAllByTestId("qw-card")).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem("pmc_qw_dismissed:proton")!))
    .toEqual({ quiet_low: 30 });
  expect(localStorage.getItem("pmc_qw_dismissed:other")).toBeNull();
  cleanup();

  // a later scan: 37 mails is below +25 % (37.5), 38 is above
  saveDismissed("proton", { quiet_low: 30 });
  quiet.count = 37;
  setup();
  await ready();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(1);
  cleanup();
  quiet.count = 38;
  setup();
  await ready();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(2);
  quiet.count = 30;
});

test("a dismissal of another account does not hide the card", async () => {
  saveDismissed("other", { quiet_low: 30, old_newsletters: 20 });
  setup();
  await ready();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(2);
});

test("only the top 3 cards show; Show all reveals the rest; the hero counts " +
  "all of them", async () => {
  big();
  await ready();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(3);
  expect(screen.getByText("Up to 200.0 MB can go")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show all 5" }));
  expect(screen.getAllByTestId("qw-card")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
  expect(screen.getAllByTestId("qw-card")).toHaveLength(3);
});

test("a card carries its hint, and Not now is an always-visible icon button",
  async () => {
  setup();
  await ready();
  const card = screen.getAllByTestId("qw-card")[0];
  expect(within(card).getByTestId("qw-hint")).toBeTruthy();
  const dismiss = within(card).getByRole("button", { name: "Not now" });
  expect(dismiss.textContent).toBe("");
  expect(within(card).getByRole("button", { name: "Review" })).toBeTruthy();
});

test("German strings", async () => {
  setLang("de");
  setup();
  await waitFor(() => expect(
    screen.getByRole("heading", { name: "Vorschläge" })).toBeTruthy());
  expect(screen.getAllByRole("button", { name: "Aufräumen…" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Nicht jetzt" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Ansehen" })).toHaveLength(2);
});

test("the cached-verdicts notice is a muted status-line suffix, not a banner",
  async () => {
    window.location.hash = "#/senders";
    setup({ notice: { key: "cached_verdicts", params: { n: 12 } } });
    await readySenders();
    const suffix = screen.getByTestId("cached-verdicts");
    expect(suffix.textContent).toContain("12 cached AI verdicts");
    expect(suffix.getAttribute("title")).toBe(
      "12 cached AI verdicts applied (AI review only evaluates new groups).");
    expect(suffix.parentElement!.textContent).toContain("groups");
    expect(screen.queryByText(/verdicts applied/)).toBeNull();   // no banner
    cleanup();
    setup({ notice: { key: "scan_cancelled", params: {} } });
    await readySenders();
    expect(screen.getByText("Scan cancelled.")).toBeTruthy();    // others stay
    expect(screen.queryByTestId("cached-verdicts")).toBeNull();
  });

test("the chip row is gone: quick filters live in the Filter menu", async () => {
  window.location.hash = "#/senders";
  setup();
  await readySenders();
  expect(screen.queryByTestId("chip-row")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect(screen.getByRole("menuitemradio", { name: /^AI-safe groups/ }))
    .toBeTruthy();
});
