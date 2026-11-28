// @vitest-environment jsdom
/* "You keep doing this" in the app: the toast of a manual step that made a
 * suggestion appear offers Automate… next to Undo (it opens that card on
 * Rules; the toast keeps its text), and a switched-off setting shows nothing. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const habits = vi.fn();
const createRule = vi.fn();
const runRule = vi.fn();

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
    logout: () => Promise.resolve(),
    exportUrl: (mode: string) => `/api/export?grouping=${mode}`,
    version: () => Promise.resolve({ build: "v1" }),
    undo: vi.fn().mockResolvedValue({ ok: true }),
    clearNotice: vi.fn().mockResolvedValue({ ok: true }),
    habits: () => habits(),
    createRule: (b: unknown) => createRule(b),
    runRule: (id: string) => runRule(id),
    rules: () => Promise.resolve({ rules: [], cap: 500 }),
    subscriptions: () => Promise.reject(new Error("none")),
    subscriptionReminders: () => Promise.resolve({ reminders: [] }),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { deals, habitsResp, news } from "./habitsFixtures";
import { setLang } from "./i18n";
import type { AppState, Config, Group } from "./types";

const acctCfg = {
  excluded_folders: [] as string[], host: "h", port: 993,
  security: "ssl" as const, smtp_host: "", smtp_port: 587,
  smtp_security: "auto" as const, user: "", password: "", password_set: true,
  cafile: "", preset: "custom" as const, oauth: null,
  digest: { schedule: "off" as const, recipient: "", hour: 8, minute: 0 },
  auto_scan: { enabled: false, unit: "hours" as const, value: 6,
    align_minute: 0 },
};
const cfg: Config = {
  oauth_providers: [], oauth_ms_device_available: false,
  auth: { mode: "none", is_admin: false },
  protected: [], categories: {}, new_sender_window_days: 7,
  habits: { suggest: true },
  ai: { provider: "anthropic", model: "claude-sonnet-5", foundry_endpoint: "",
    price_in: 0, price_out: 0, budget_usd: 0, month_cost: 0,
    prices_effective: [2, 10], api_key: "", api_key_set: false,
    available: false, source: null, shared_budget_usd: 0 },
  ai_stats: { input_tokens: 0, output_tokens: 0, cost: 0, runs: 0 },
  default_account: "proton",
  accounts: { proton: { ...acctCfg, user: "marcel@proton.example" } },
};
const group: Group = {
  key: "deals@dealsdaily.example", label: "Deals Daily",
  sub: "deals@dealsdaily.example", count: 12, size: 12000, unread: 12,
  first: "2024-01-01", last: "2025-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50 };
const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["Archive"],
  groups: { sender: { [group.key]: group }, smart: {}, domain: {},
    subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Archive"],
  rules: [], presets: [],
};

beforeEach(() => {
  window.location.hash = "";
  habits.mockResolvedValue(habitsResp([]));
  createRule.mockResolvedValue({ id: "r1", name: "Trash Prize" });
  runRule.mockResolvedValue({});
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", FakeEventSource);
  localStorage.clear(); FakeEventSource.instances.length = 0;
  habits.mockReset(); createRule.mockReset(); runRule.mockReset();
  setLang("en");
  window.location.hash = "";
});
Element.prototype.scrollIntoView = () => {};

const mount = async (st: AppState) => {
  state = st;
  localStorage.setItem("pmc_account", "proton");
  const r = render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  await waitFor(() => expect(r.container.textContent).toMatch(/scanned|No scan/));
  // the first look at the habits (debounced) is the baseline of the toast
  await waitFor(() => expect(habits).toHaveBeenCalled(), { timeout: 4000 });
  await act(async () => { await Promise.resolve(); });
  return r;
};
const tick = (patch: Partial<AppState>) => {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  const { groups: _g, ...slim } = { ...state, ...patch };
  state = { ...state, ...patch };
  act(() => es.onmessage!({ data: JSON.stringify(slim) }));
};
const job = (status: string, extra: object = {}) =>
  ({ status, progress: "", error: "", moved: 0, ...extra });
const finishTrash = () => {
  const own = { actor: "user", action: "trash" };
  tick({ delete: job("running", { progress: "3/12", ...own }) as any });
  tick({ delete: job("done", { moved: 12, ...own }) as any,
    undo: [{ ts: 7, label: "Deals Daily", count: 12, action: "trash" }] });
};

test("a step that made a habit appear: the toast keeps its text and Undo and "
  + "offers Automate…, which opens that card on Rules", async () => {
  habits.mockResolvedValue(habitsResp([deals]));          // known already
  await mount({ ...baseState });
  // the step just made another one appear: its newest step is now
  habits.mockResolvedValue(habitsResp([deals,
    { ...news, last: Math.floor(Date.now() / 1000) }]));
  finishTrash();
  const msg = await screen.findByText("Moved 12 mails to Trash");
  const bar = msg.closest("[data-variant]") as HTMLElement;
  // Undo first, Automate… next to it; nothing else was added to the text
  const names = within(bar).getAllByRole("button").map((b) => b.textContent
    || b.getAttribute("aria-label"));
  expect(names.slice(0, 2)).toEqual(["Undo", "Automate…"]);
  expect(bar.textContent).not.toContain("time since");
  fireEvent.click(within(bar).getByRole("button", { name: "Automate…" }));
  // the Rules page brings THAT suggestion into view (not just the first one)
  const card = await waitFor(() => {
    const el = document.querySelector('[data-habit="h-news"]');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  expect(card.className).toContain("border-accent");
  expect(document.activeElement).toBe(card);
  // the toast closed with its action
  expect(screen.queryByText("Moved 12 mails to Trash")).toBeNull();
});

test("no new habit: the toast is the plain one, without Automate…", async () => {
  await mount({ ...baseState });
  finishTrash();
  const msg = await screen.findByText("Moved 12 mails to Trash");
  const bar = msg.closest("[data-variant]") as HTMLElement;
  expect(within(bar).queryByRole("button", { name: "Automate…" })).toBeNull();
  expect(within(bar).getByRole("button", { name: "Undo" })).toBeTruthy();
});

test("a suggestion that was already there is not announced again", async () => {
  habits.mockResolvedValue(habitsResp([deals]));
  await mount({ ...baseState });
  finishTrash();
  const msg = await screen.findByText("Moved 12 mails to Trash");
  expect(within(msg.closest("[data-variant]") as HTMLElement)
    .queryByRole("button", { name: "Automate…" })).toBeNull();
});

test("an assistant's step never offers Automate…", async () => {
  await mount({ ...baseState });
  habits.mockResolvedValue(habitsResp([deals]));
  tick({ delete: job("running", { actor: "mcp:Helper" }) as any });
  tick({ delete: job("done", { moved: 12, actor: "mcp:Helper" }) as any,
    assistant_undo: [{ ts: 9, label: "Deals Daily", count: 12,
      action: "trash", actor: "mcp:Helper", token: "t1" }] as any });
  await screen.findByText(/Helper/);
  expect(screen.queryByRole("button", { name: "Automate…" })).toBeNull();
});

test("setting off: no suggestions, no Overview line, no toast button", async () => {
  habits.mockResolvedValue(habitsResp([deals], { enabled: false }));
  await mount({ ...baseState });
  finishTrash();
  await screen.findByText("Moved 12 mails to Trash");
  expect(screen.queryByRole("button", { name: "Automate…" })).toBeNull();
  expect(screen.queryByTestId("habit-step")).toBeNull();
});

test("the toast is up at once; Automate… joins it when the answer arrives",
  async () => {
  habits.mockResolvedValue(habitsResp([deals]));
  await mount({ ...baseState });
  let answer: (v: unknown) => void = () => {};
  habits.mockReturnValue(new Promise((r) => { answer = r; }));
  finishTrash();
  // no waiting for the server: the toast and its Undo are there, Automate… is not
  const msg = await screen.findByText("Moved 12 mails to Trash");
  const bar = msg.closest("[data-variant]") as HTMLElement;
  expect(within(bar).getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(within(bar).queryByRole("button", { name: "Automate…" })).toBeNull();
  // the answer names a new suggestion: the SAME toast gets the button
  await act(async () => {
    answer(habitsResp([deals, { ...news, last: Math.floor(Date.now() / 1000) }]));
  });
  expect(await within(bar).findByRole("button", { name: "Automate…" })).toBeTruthy();
  expect(screen.getAllByText("Moved 12 mails to Trash")).toHaveLength(1);
  expect(within(bar).getByRole("button", { name: "Undo" })).toBeTruthy();
});

test("an answer that never comes leaves the toast as it is", async () => {
  await mount({ ...baseState });
  habits.mockReturnValue(new Promise(() => {}));
  finishTrash();
  const msg = await screen.findByText("Moved 12 mails to Trash");
  expect(within(msg.closest("[data-variant]") as HTMLElement)
    .queryByRole("button", { name: "Automate…" })).toBeNull();
});

test("a toast that is gone when the answer arrives is not brought back",
  async () => {
  habits.mockResolvedValue(habitsResp([deals]));
  await mount({ ...baseState });
  let answer: (v: unknown) => void = () => {};
  habits.mockReturnValue(new Promise((r) => { answer = r; }));
  finishTrash();
  const msg = await screen.findByText("Moved 12 mails to Trash");
  fireEvent.click(within(msg.closest("[data-variant]") as HTMLElement)
    .getByLabelText("Dismiss"));
  expect(screen.queryByText("Moved 12 mails to Trash")).toBeNull();
  await act(async () => {
    answer(habitsResp([deals, { ...news, last: Math.floor(Date.now() / 1000) }]));
  });
  expect(screen.queryByText("Moved 12 mails to Trash")).toBeNull();
  expect(screen.queryByRole("button", { name: "Automate…" })).toBeNull();
});

test("Make it a rule: the card and the Overview line go at once, before the "
  + "server has answered again", async () => {
  habits.mockResolvedValue(habitsResp([deals, news]));
  await mount({ ...baseState });
  fireEvent.click(within(await screen.findByTestId("habit-step"))
    .getByRole("button", { name: /^Review/ }));
  await screen.findByTestId("habit-card");
  expect(screen.getByTestId("habit-step").textContent).toContain("2");
  habits.mockReturnValue(new Promise(() => {}));      // the next answer is slow
  fireEvent.click(within(document.querySelector(
    '[data-habit="h-deals"]') as HTMLElement)
    .getByRole("button", { name: "Make it a rule" }));
  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(document.querySelector('[data-habit="h-deals"]'))
    .toBeNull());
  // the other suggestion stays, and the Overview line counts one fewer
  expect(document.querySelector('[data-habit="h-news"]')).toBeTruthy();
  expect(screen.getByTestId("habit-step").textContent).toContain("1");
  expect(screen.getByTestId("habit-step").textContent).not.toContain("2");
  // no second click can make the same rule twice
  expect(screen.queryAllByRole("button", { name: "Make it a rule" })).toHaveLength(1);
});

test("a mark-as-read step (no Undo) can offer Automate… too", async () => {
  await mount({ ...baseState });
  habits.mockResolvedValue(habitsResp([
    { ...deals, action: "mark_read", last: Math.floor(Date.now() / 1000) }]));
  tick({ delete: job("running", { actor: "user", action: "mark_read" }) as any });
  tick({ delete: job("done", { moved: 9, actor: "user",
    action: "mark_read" }) as any });
  const msg = await screen.findByText("Done: 9 mails processed.");
  const bar = msg.closest("[data-variant]") as HTMLElement;
  expect(within(bar).getByRole("button", { name: "Automate…" })).toBeTruthy();
  expect(within(bar).queryByRole("button", { name: "Undo" })).toBeNull();
});

test("a rule's step never offers Automate…", async () => {
  await mount({ ...baseState });
  habits.mockResolvedValue(habitsResp([
    { ...deals, last: Math.floor(Date.now() / 1000) }]));
  tick({ delete: job("running", { actor: "rule:r1", action: "trash" }) as any });
  tick({ delete: job("done", { moved: 12, actor: "rule:r1",
    action: "trash" }) as any,
    undo: [{ ts: 7, label: "Deals Daily", count: 12, action: "trash" }] });
  const msg = await screen.findByText("Moved 12 mails to Trash");
  expect(within(msg.closest("[data-variant]") as HTMLElement)
    .queryByRole("button", { name: "Automate…" })).toBeNull();
  // the server was not even asked about it
  expect(habits).toHaveBeenCalledTimes(1);
});

test("a suggestion shows as one line in Overview > Next steps; Review opens "
  + "Rules at its card", async () => {
  habits.mockResolvedValue(habitsResp([deals]));
  await mount({ ...baseState });
  const step = await screen.findByTestId("habit-step");
  expect(within(step).getByText("1 rule suggested from what you did by hand"))
    .toBeTruthy();
  fireEvent.click(within(step).getByRole("button", { name: /^Review/ }));
  const card = await waitFor(() => {
    const el = document.querySelector('[data-habit="h-deals"]');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  expect(card.className).toContain("border-accent");
});
