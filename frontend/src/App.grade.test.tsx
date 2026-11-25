// @vitest-environment jsdom
/* Sender grade in the Senders list: the badge on desktop rows and phone
 * cards, the Grade sort (worst first), the `grade:` filter, the report card
 * in the detail pane. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeEventSource.instances.push(this); }
  close() {}
}
vi.stubGlobal("EventSource", FakeEventSource);

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    emptyTrash: () => Promise.resolve({ ok: true }),
    logout: () => Promise.resolve(),
    exportUrl: (mode: string) => `/api/export?grouping=${mode}`,
    version: () => Promise.resolve({ build: "v1" }),
    deleteGroups: vi.fn().mockResolvedValue({ ok: true, queued: 1, skipped: 0 }),
    group: vi.fn().mockResolvedValue([]),
    rhythm: () => Promise.reject(new Error("no rhythm")),
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    wrapped: () => Promise.reject(new Error("no wrapped")),
    trackers: () => Promise.reject(new Error("no trackers")),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    stats: () => Promise.resolve({
      mails: 105, size: 1000, senders: 5, unread: 1, bulk: 1,
      replied_senders: 0, oldest: "2025-01-01", years: [], months: [],
      categories: [], top_domains: [], top_senders: [], scans: [],
      actions: {}, ai: { rated: 0, groups: 0 },
      ai_groups: { delete_safe: 0, review: 0, keep: 0, unrated: 0 },
      rated_mails: { delete_safe: 0, review: 0, keep: 0 } }),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { gradedGroup, mkGrade } from "./gradeTestUtil";
import { setLang } from "./i18n";
import { openTool, popupPick } from "./toolTestUtils";
import type { AppState, Config, Group } from "./types";

const acctCfg = {
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
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  ai: { provider: "anthropic", model: "claude-sonnet-5",
    foundry_endpoint: "", price_in: 0, price_out: 0, budget_usd: 0,
    month_cost: 0, prices_effective: [2, 10], api_key: "",
    api_key_set: false, available: false, source: null,
    shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: { ...acctCfg, user: "marcel@proton.example" } },
};

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["Archive"],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Archive"],
  rules: [], presets: [],
};

const withGroups = (...gs: Group[]): AppState => ({ ...baseState,
  groups: { sender: Object.fromEntries(gs.map((g) => [g.key, g])),
    smart: {}, domain: {}, subject: {}, thread: {} } });

const sample = () => withGroups(
  gradedGroup("a@x.example", "Alpha", "A", { count: 5 }),
  gradedGroup("c@x.example", "Charlie", "C", { count: 40 }),
  gradedGroup("f@x.example", "Foxtrot", "F", { count: 10 }),
  gradedGroup("d@x.example", "Delta", "D", { count: 20 }),
  gradedGroup("b@x.example", "Bravo", "B", { count: 30 }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  setLang("en");
  FakeEventSource.instances.length = 0;
});

const mount = async (n: number) => {
  localStorage.setItem("pmc_account", "proton");
  const r = render(<ToastProvider><DialogProvider><App />
  </DialogProvider></ToastProvider>);
  await waitFor(() => expect(rowLabels(r.container).length).toBe(n),
    { timeout: 5000 });
  return r;
};
const rowLabels = (c: HTMLElement) =>
  [...c.querySelectorAll("tbody tr[data-gidx]")]
    .map((tr) => tr.querySelector("button")!.textContent);

test("every Sender row shows its grade, on the desktop table and the phone cards",
  async () => {
    state = sample();
    const { container } = await mount(5);
    const table = container.querySelector("table")!;
    const cards = container.querySelector(".md\\:hidden")!;
    for (const [label, letter] of [["Alpha", "A"], ["Foxtrot", "F"]]) {
      const row = [...table.querySelectorAll("tbody tr[data-gidx]")]
        .find((r) => r.textContent!.includes(label))!;
      expect(row.querySelector(`[aria-label="Grade ${letter}"]`)).toBeTruthy();
    }
    expect(cards.querySelectorAll('[role="img"][aria-label^="Grade "]'))
      .toHaveLength(5);
    expect(screen.getAllByRole("columnheader", { name: "Grade" })).toBeTruthy();
  });

test("Grade · worst first sorts F first, the arrow flips it, the choice is kept",
  async () => {
    state = sample();
    const { container } = await mount(5);
    popupPick(/^Sort: Mails/, "Grade · worst first");
    await waitFor(() => expect(rowLabels(container))
      .toEqual(["Foxtrot", "Delta", "Charlie", "Bravo", "Alpha"]));
    expect(localStorage.getItem("pmc_sort_k")).toBe("grade");
    popupPick(/^Sort: Grade · worst first/, "Ascending");
    await waitFor(() => expect(rowLabels(container))
      .toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Foxtrot"]));
    expect(screen.getByRole("button", { name: /^Sort: Grade · best first/ }))
      .toBeTruthy();
  });

test("equal grades keep the bigger sender first", async () => {
  state = withGroups(
    gradedGroup("a@x.example", "Small", "D", { count: 3 }),
    gradedGroup("b@x.example", "Big", "D", { count: 90 }));
  const { container } = await mount(2);
  popupPick(/^Sort: Mails/, "Grade · worst first");
  await waitFor(() => expect(localStorage.getItem("pmc_sort_k"))
    .toBe("grade"));
  expect(rowLabels(container)).toEqual(["Big", "Small"]);
});

test("the grade filter words narrow the list", async () => {
  state = sample();
  const { container } = await mount(5);
  const filter = screen.getByPlaceholderText(/Filter/i);
  fireEvent.change(filter, { target: { value: "grade:<=d" } });
  await waitFor(() => expect(rowLabels(container).sort())
    .toEqual(["Delta", "Foxtrot"]));
  fireEvent.change(filter, { target: { value: "grade:>=b" } });
  await waitFor(() => expect(rowLabels(container).sort())
    .toEqual(["Alpha", "Bravo"]));
  fireEvent.change(filter, { target: { value: "grade:c" } });
  await waitFor(() => expect(rowLabels(container)).toEqual(["Charlie"]));
});

test("opening a sender shows its report card with the six checks", async () => {
  state = withGroups(gradedGroup("d@x.example", "Delta", "D", {
    grade: mkGrade("D", { pattern: "loud" }) }));
  const { container } = await mount(1);
  fireEvent.click(container.querySelector("tbody tr[data-gidx] button")!);
  expect(await screen.findByRole("heading",
    { name: "Grade D · loud and ignored" })).toBeTruthy();
  expect(screen.getByText("Stops when asked")).toBeTruthy();
  expect(screen.getByRole("button", { name: "How grades work" })).toBeTruthy();
});

test("the German list says Note", async () => {
  setLang("de");
  state = sample();
  const { container } = await mount(5);
  expect(container.querySelector('[aria-label="Note F"]')).toBeTruthy();
  popupPick(/^Sortieren: Mails/, "Note · schlechteste zuerst");
  await waitFor(() => expect(rowLabels(container)[0]).toBe("Foxtrot"));
});

test("the Subject tab has no Grade sort and falls back to mails", async () => {
  state = sample();
  state.groups.subject = {
    "s1": { ...gradedGroup("s1", "Small subject", "A", { count: 2 }),
      grade: undefined },
    "s2": { ...gradedGroup("s2", "Big subject", "A", { count: 50 }),
      grade: undefined } };
  localStorage.setItem("pmc_sort_k", "grade");
  const { container } = await mount(5);
  fireEvent.click(await screen.findByRole("tab", { name: "Subject" }));
  await waitFor(() => expect(rowLabels(container))
    .toEqual(["Big subject", "Small subject"]));
  // no Grade column, no badge, and the Sort menu does not offer the key
  expect(container.querySelector('[aria-label^="Grade "]')).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Grade" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Sort: Mails/ }));
  expect(screen.queryByRole("menuitemradio", { name: /Grade/ })).toBeNull();
});

test("Statistics: the grades card, and Show them opens the Senders list " +
  "filtered to D and F", async () => {
  state = sample();
  const { container } = await mount(5);
  openTool("Insights", /^Statistics/);
  expect(await screen.findByText("Your senders' grades")).toBeTruthy();
  // D (20) + F (10) of 105 mails
  expect(screen.getByText(
    "The 2 senders graded D or F send 29% of your mail.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show them" }));
  await waitFor(() => expect((screen.getByPlaceholderText(/Filter/i) as
    HTMLInputElement).value).toBe("grade:<=d"));
  await waitFor(() => expect(rowLabels(container).sort())
    .toEqual(["Delta", "Foxtrot"]));
});
