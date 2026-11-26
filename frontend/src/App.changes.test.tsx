// @vitest-environment jsdom
/* Sender changes in the app: the Statistics card's actions reach the existing
 * paths (the Block confirm, All mail) and the card leaves the rest of
 * Statistics where it was. (Overview rows + the list's line:
 * App.overview.test.tsx; the pieces: SenderChanges.test.tsx.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const blank = () => Array.from({ length: 7 }, () => Array(24).fill(0));
const kind = () => ({ total: 0, grid: blank(), top: {} });
const mails = vi.fn().mockResolvedValue({ total: 0, mails: [], ignored: [] });

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    group: () => Promise.resolve([]),
    mails: (...a: unknown[]) => mails(...a),
    overview: () => Promise.reject(new Error("offline")),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
    stats: () => Promise.resolve({
      mails: 10, size: 1000, senders: 2, unread: 1, bulk: 1,
      replied_senders: 0, oldest: "2025-01-01", years: [], months: [],
      categories: [], top_domains: [], top_senders: [], scans: [],
      actions: {}, ai: { rated: 0, groups: 0 },
      ai_groups: { delete_safe: 0, review: 0, keep: 0, unrated: 0 },
      rated_mails: { delete_safe: 0, review: 0, keep: 0 } }),
    rhythm: () => Promise.resolve({ period: "12m", tz: "UTC", from: 0,
      kinds: { all: kind(), newsletters: kind(), people: kind(),
        orders: kind() }, daily: [] }),
    senderChanges: () => Promise.resolve({ days: 30, since: NOW - 90 * DAY,
      louder: [{ key: "n@x.example", label: "Northwind News", unsub: false,
        protected: false, n: 4, usual: 1, factor: 4, start: NOW - 7 * DAY,
        end: NOW }],
      back: [{ key: "h@x.example", label: "Harbor Books", unsub: false,
        protected: false, ts: NOW - 5 * DAY, gap_days: 456, n: 3 }] }),
    block: (...a: unknown[]) => block(...a),
  },
  downloadFile: () => Promise.resolve(),
  setAccount: () => {},
  withAccount: (p: string) => p,
  noticeParams: (p: Record<string, unknown>) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));
const block = vi.fn().mockResolvedValue({ ok: true });

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog } from "./dialogTestUtils";
import type { AppState, Config, Group } from "./types";

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

const setup = () => {
  localStorage.setItem("pmc_account", "proton");
  const groups = [mk("n@x.example", { label: "Northwind News" }),
    mk("h@x.example", { label: "Harbor Books", count: 0 })];
  state = { ...baseState, groups: { sender: Object.fromEntries(
    groups.map((g) => [g.key, g])), smart: {}, domain: {}, subject: {},
    thread: {} } };
  window.location.hash = "#/stats";
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};

beforeEach(() => { block.mockClear(); mails.mockClear(); });
afterEach(() => { cleanup(); localStorage.clear(); window.location.hash = ""; });

const card = async () => within((await screen.findByRole("heading",
  { name: "Changes in the last 30 days" })).closest("section")!);

test("the card sits in Statistics and leaves the other cards where they were",
  async () => {
    setup();
    await card();
    for (const name of ["When mail arrives", "What stands out", "Top senders",
      "Top domains"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

test("Block… on a came-back sender asks first, and cancelling blocks nothing",
  async () => {
    setup();
    const c = await card();
    fireEvent.click(c.getByRole("button", { name: "Block…" }));
    const dlg = await findDialog();
    expect(dlg.textContent).toContain('Block "Harbor Books"?');
    await cancelDialog();
    await expectNoDialog();
    expect(block).not.toHaveBeenCalled();
  });

test("Show mails opens All mail on that sender", async () => {
  setup();
  const c = await card();
  fireEvent.click(c.getByRole("button", { name: "Show mails" }));
  await waitFor(() => expect(window.location.hash).toBe("#/all"));
  expect(await screen.findByDisplayValue("from:n@x.example")).toBeTruthy();
});
