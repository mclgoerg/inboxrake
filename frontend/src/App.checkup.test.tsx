// @vitest-environment jsdom
/* The Rule checkup hands its lists to the rest of the app: "Show the N
 * senders" opens the Senders list narrowed to those senders (a chip says so;
 * Show all senders lifts it), "Show the N mails" opens All mail on that
 * finding's mails. Leaving the page drops the narrowing. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

let state: any;
const mails = vi.fn();

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    rules: () => Promise.resolve({ rules: state?.rules ?? [], cap: 500 }),
    ruleCheckup: () => Promise.resolve(checkup),
    ignoreFinding: () => Promise.resolve({ ok: true }),
    mails: (...a: unknown[]) => mails(...a),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
    group: () => Promise.resolve([]),
    overview: () => Promise.reject(new Error("offline")),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
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
import { setLang } from "./i18n";
import type { AppState, Config, Group, Rule, RuleCheckup } from "./types";

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
  accounts: { proton: { ...acct, user: "me@proton.example" } },
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
const rule = (id: string, name: string, over: Partial<Rule> = {}): Rule => ({
  id, name, scope: "mail", grouping: "sender", query: "", action: "trash",
  dest: "", schedule: "manual", mode: "execute", keep_latest: null,
  older_than_days: null, origin: "manual", report_runs: 1, created: 1,
  last_run: null, ...over });
const RULES = [rule("r1", "Sweep"), rule("r2", "Keep five", { keep_latest: 5 })];

const finding = (over: object) => ({ id: "0123456789abcdef", kind: "overlap",
  rules: ["r1", "r2"], ignored: false, defeated: "r2", by: "r1", n: 4,
  senders_total: 2, keep_latest: 5, older_than_days: null,
  senders: [{ addr: "a@x.example", label: "Label a", n: 2, last: 1 },
    { addr: "b@x.example", label: "Label b", n: 2, last: 1 }],
  compare: { unit: "senders", only_a: 0, both: 2, only_b: 1 }, ...over });
let checkup: RuleCheckup;

const baseState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [], ai: { status: "idle",
    grouping: "sender", progress: "", error: "", usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: RULES,
  presets: [],
} as unknown as AppState;

Element.prototype.scrollIntoView = () => {};
const widen = () => vi.stubGlobal("matchMedia", (q: string) => ({
  get matches() { return q.includes("1024"); }, media: q,
  addEventListener: () => {}, removeEventListener: () => {},
}));

const mount = async (findings: object[]) => {
  widen();
  checkup = { account: "proton", scanned_ts: 1, analysed: true,
    needs_scan: false, checked: 1, rules: 2,
    findings: findings as RuleCheckup["findings"] };
  const groups = ["a", "b", "c"].map((k) => mk(`${k}@x.example`));
  state = { ...baseState, groups: { sender: Object.fromEntries(
    groups.map((g) => [g.key, g])), smart: {}, domain: {}, subject: {},
    thread: {} } };
  localStorage.setItem("pmc_account", "proton");
  window.location.hash = "#/rules";
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await screen.findByTestId("checkup-card");
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = "";
  mails.mockReset();
  setLang("en");
});

const rows = () => ["a", "b", "c"].filter((k) =>
  screen.queryAllByText(`Label ${k}`).length > 0);

test("Show the 2 senders: the Sender list narrowed to them, a chip, Show all senders",
  async () => {
    await mount([finding({})]);
    fireEvent.click(screen.getByRole("button", { name: /^Show the 2\s+senders$/ }));
    const chip = (await screen.findAllByTestId("checkup-chip"))[0];
    expect(chip.textContent!.replace(/ /g, " "))
      .toContain("2 senders from the Rule checkup");
    expect(rows()).toEqual(["a", "b"]);
    expect(window.location.hash).toContain("senders");
    fireEvent.click(within(chip).getByRole("button", { name: "Show all senders" }));
    await waitFor(() => expect(rows()).toEqual(["a", "b", "c"]));
    expect(screen.queryByTestId("checkup-chip")).toBeNull();
  });

test("the narrowing is gone once the page is left", async () => {
  await mount([finding({})]);
  fireEvent.click(screen.getByRole("button", { name: /^Show the 2\s+senders$/ }));
  await screen.findAllByTestId("checkup-chip");
  window.location.hash = "#/overview";
  await waitFor(() => expect(screen.queryByTestId("checkup-chip")).toBeNull());
  window.location.hash = "#/senders";
  await waitFor(() => expect(rows()).toEqual(["a", "b", "c"]));
  expect(screen.queryByTestId("checkup-chip")).toBeNull();
});

test("Show the 12 mails: All mail on that finding's mails", async () => {
  mails.mockResolvedValue({ total: 12, offset: 0, ignored: [], mails: [{
    uid: 1, folder: "INBOX", date: "2026-01-01", ts: 1, subject: "Subject 1",
    addr: "a@x.example", size: 10, seen: true, ai: null, pinned: false }] });
  await mount([finding({ kind: "conflict", id: "fedcba9876543210", n: 12,
    first: "r1", senders_total: 1, senders: [{ addr: "a@x.example",
      label: "Label a", n: 12, last: 1 }],
    compare: { unit: "mails", only_a: 0, both: 12, only_b: 0 } })]);
  fireEvent.click(screen.getByRole("button", { name: /^Show the 12\s+mails$/ }));
  await screen.findByText("Subject 1");
  expect(mails).toHaveBeenCalledWith(expect.objectContaining(
    { finding: "fedcba9876543210" }));
  expect(screen.getByTestId("checkup-chip").textContent!
    .replace(/ /g, " ")).toContain("12 mails from the Rule checkup");
});
