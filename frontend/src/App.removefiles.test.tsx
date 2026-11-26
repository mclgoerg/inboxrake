// @vitest-environment jsdom
/* Keep the mail, remove the file: the job's outcome is a toast with Undo
 * ("Removed 2 files from 3 mails - originals in Trash"), a job that left
 * mails as they were says why in the notice, and Activity words the step. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
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
    logout: () => Promise.resolve(),
    exportUrl: (mode: string) => `/api/export?grouping=${mode}`,
    version: () => Promise.resolve({ build: "v1" }),
    undo: vi.fn().mockResolvedValue({ ok: true }),
    clearNotice: vi.fn().mockResolvedValue({ ok: true }),
    deleteGroups: vi.fn().mockResolvedValue({ ok: true, queued: 1, skipped: 0 }),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
}));

const { api } = await import("./api");
const undoApi = api.undo as ReturnType<typeof vi.fn>;

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
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

const group: Group = {
  key: "news@shop.example", label: "Shop News", sub: "news@shop.example",
  count: 12, size: 12000, unread: 2, first: "2024-01-01", last: "2025-01-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false,
  pinned: 0,
  engagement: 50,
};

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: ["Archive"],
  groups: { sender: { [group.key]: group }, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["Archive"],
  rules: [], presets: [],
};


afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", FakeEventSource);
  localStorage.clear();
  FakeEventSource.instances.length = 0;
  undoApi.mockClear();
  setLang("en");
});

Element.prototype.scrollIntoView = () => {};

const mount = async (st: AppState) => {
  state = st;
  localStorage.setItem("pmc_account", "proton");
  const r = render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
  await waitFor(() => expect(r.container.textContent).toMatch(/scanned|No scan|gescannt/));
  return r;
};
// Push a slim status tick down the SSE stream.
const tick = (patch: Partial<AppState>) => {
  const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  const { groups: _g, ...slim } = { ...state, ...patch };
  state = { ...state, ...patch };
  act(() => es.onmessage!({ data: JSON.stringify(slim) }));
};
const job = (status: string, extra: object = {}) =>
  ({ status, progress: "", error: "", moved: 0, ...extra });
const step = (over: object = {}) => ({ ts: 9, id: "s1", count: 3,
  label: "Removed 2 files from 3 mails", action: "remove_files",
  label_key: "undo.remove_files", label_params: { files: 2, n: 3 }, ...over });

test("a finished removal toasts files and mails with an Undo that targets its "
  + "own step", async () => {
  await mount({ ...baseState });
  tick({ delete: job("running", { progress: "1/3", action: "remove_files" }) as any });
  tick({ delete: job("done", { moved: 3, action: "remove_files" }) as any,
    undo: [step()] as any });
  const msg = await screen.findByText(
    "Removed 2 files from 3 mails · originals in Trash");
  fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(undoApi).toHaveBeenCalledWith(-1,
    { id: "s1", ts: 9, label: "Removed 2 files from 3 mails", count: 3 }, "proton"));
});

test("one file from one mail uses the singular forms; German wording", async () => {
  await mount({ ...baseState });
  tick({ delete: job("done", { moved: 1, action: "remove_files" }) as any,
    undo: [step({ count: 1, id: "s2",
      label_params: { files: 1, n: 1 } })] as any });
  expect(await screen.findByText("Removed 1 file from 1 mail · originals in Trash"))
    .toBeTruthy();
  cleanup();
  setLang("de");
  await mount({ ...baseState });
  tick({ delete: job("done", { moved: 3, action: "remove_files" }) as any,
    undo: [step({ id: "s3" })] as any });
  expect(await screen.findByText("2 Dateien aus 3 Mails entfernt · Originale im Papierkorb"))
    .toBeTruthy();
});

test("a job that left mails as they were says why in the notice", async () => {
  await mount({ ...baseState,
    notice: { key: "remove_files_skipped", params: { n: 2, why: "signed" } } });
  expect(await screen.findByText(
    /2 mails were left as they were: signed mail - taking a file out would break the signature\./))
    .toBeTruthy();
});

test("one mail left alone: the singular notice, in German too", async () => {
  setLang("de");
  await mount({ ...baseState,
    notice: { key: "remove_files_skipped", params: { n: 1, why: "labels" } } });
  expect(await screen.findByText(
    /1 Mail blieb unverändert: sie liegt auch in einem Label-Ordner, dem eine Kopie nicht beitreten würde\./))
    .toBeTruthy();
});
