// @vitest-environment jsdom
/* V5: phone gestures in the app. A swipe is only a shortcut to the button
   path: each test pins which existing handler it reaches, and that the
   confirm / guard / undo of that path is still there. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let state: any;
const deleteGroups = vi.fn().mockResolvedValue({ ok: true });
const protect = vi.fn();
const block = vi.fn().mockResolvedValue({ ok: true });
const scan = vi.fn().mockResolvedValue({ ok: true });
const deleteMessages = vi.fn().mockResolvedValue({ ok: true });
const pin = vi.fn().mockResolvedValue({ ok: true });
let mailsResp: any = { mails: [], total: 0, ignored: [] };

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => Promise.resolve(state),
    version: () => Promise.resolve({ build: "v1" }),
    clearNotice: () => Promise.resolve(),
    group: () => Promise.resolve([]),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    protect: (...a: unknown[]) => protect(...a),
    block: (...a: unknown[]) => block(...a),
    scan: (...a: unknown[]) => scan(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    pin: (...a: unknown[]) => pin(...a),
    mails: () => Promise.resolve(mailsResp),
  },
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
  downloadFile: () => Promise.resolve(),
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import type { AppState, Config } from "./types";

const cfg = {
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
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto",
    user: "me@proton.example", password: "", password_set: true,
    cafile: "", preset: "custom", oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
  } },
} as unknown as Config;

const mk = (label: string, count: number, over: Record<string, unknown> = {}) => ({
  key: `${label.toLowerCase()}@x.example`, label,
  sub: `${label.toLowerCase()}@x.example`, count, size: 1000, unread: 0,
  first: "2024-01-01", last: "2024-06-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, ...over,
});
const ALPHA = mk("Alpha", 30, { unread: 4 });
const BRAVO = mk("Bravo", 20);
const CHARLIE = mk("Charlie", 10, { protected: true });

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1700000000, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: { [ALPHA.key]: ALPHA, [BRAVO.key]: BRAVO,
    [CHARLIE.key]: CHARLIE }, smart: {}, domain: {}, subject: {}, thread: {} },
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

beforeEach(() => {
  protect.mockReset().mockResolvedValue({ protected: ["alpha@x.example"] });
  vi.stubGlobal("matchMedia", (q: string) => ({
    // a touch phone: coarse pointer, narrower than 1024
    matches: q.includes("pointer: coarse"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  deleteGroups.mockClear(); block.mockClear(); scan.mockClear();
  deleteMessages.mockClear(); pin.mockClear();
  mailsResp = { mails: [], total: 0, ignored: [] };
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

type Ev = { x: number; y?: number; t: number };
function fire(target: Element | Window, name: string, e: Ev) {
  const ev = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, {
    clientX: { value: e.x }, clientY: { value: e.y ?? 0 },
    pointerId: { value: 1 }, isPrimary: { value: true },
    pointerType: { value: "touch" }, timeStamp: { value: e.t },
  });
  act(() => { target.dispatchEvent(ev); });
}
/** Down at xs[0], move through the rest, release at the last (100 ms apart). */
function swipe(target: Element, xs: number[], step = 100) {
  fire(target, "pointerdown", { x: xs[0], t: 0 });
  xs.slice(1).forEach((x, i) => fire(window, "pointermove",
    { x, t: (i + 1) * step }));
  fire(window, "pointerup", { x: xs[xs.length - 1], t: xs.length * step });
}
const FULL_LEFT = [350, 250, 150, 40];
const FULL_RIGHT = [60, 160, 260, 360];
const OPEN_LEFT = [300, 200, 100];
const OPEN_RIGHT = [100, 200, 300];

const mount = async (over: Partial<AppState> = {}, hash = "#/senders",
    ready = "Alpha") => {
  localStorage.setItem("pmc_account", "proton");
  window.location.hash = hash;
  state = { ...baseState, ...over };
  render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
  await waitFor(() => expect(screen.getAllByText(ready).length)
    .toBeGreaterThan(0));
};
/** The sliding part of a Senders card (the table twin has none). */
const body = (label: string) => screen.getAllByText(label)
  .map((n) => n.closest<HTMLElement>("[data-swipe-body]"))
  .find(Boolean)!;

test("a full swipe left on a Senders row asks the Trash confirm - nothing is moved before it", async () => {
  await mount();
  swipe(body("Alpha"), FULL_LEFT);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Move to Trash");
  expect(dlg.textContent).toContain("30 mails from Alpha");
  expect(deleteGroups).not.toHaveBeenCalled();
  await pressDialog(/^Move to Trash \(30\)/);
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledOnce());
  // the same call the detail's "Move N mails to Trash" makes
  expect(deleteGroups).toHaveBeenCalledWith("sender", ["alpha@x.example"],
    "trash", "", false, null, null);
});

test("declining the confirm of a swiped Trash moves nothing", async () => {
  await mount();
  swipe(body("Alpha"), FULL_LEFT);
  await cancelDialog();
  await expectNoDialog();
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("a swiped Trash of a protected sender keeps the protected warning", async () => {
  await mount();
  swipe(body("Charlie"), FULL_LEFT);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain('The group "Charlie" is protected');
  expect(deleteGroups).not.toHaveBeenCalled();
  await cancelDialog();
});

test("an open row offers Trash, Block and More; Block asks its own confirm", async () => {
  await mount();
  swipe(body("Alpha"), OPEN_LEFT);
  const row = body("Alpha").parentElement!;
  expect(within(row).getByRole("button", { name: "Trash" })).toBeTruthy();
  expect(within(row).getByRole("button", { name: "More" })).toBeTruthy();
  fireEvent.click(within(row).getByRole("button", { name: "Block" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain('Block "Alpha"?');
  expect(block).not.toHaveBeenCalled();
  await cancelDialog();
  expect(block).not.toHaveBeenCalled();
});

test("a full swipe right protects through the Protect handler and offers Undo", async () => {
  await mount();
  swipe(body("Bravo"), FULL_RIGHT);
  await waitFor(() => expect(protect).toHaveBeenCalledWith("bravo@x.example", true));
  expect(await screen.findByText("Bravo is protected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(protect).toHaveBeenLastCalledWith("bravo@x.example", false));
});

test("a protected sender offers Unprotect instead of Protect", async () => {
  await mount();
  swipe(body("Charlie"), OPEN_RIGHT);
  const row = body("Charlie").parentElement!;
  expect(within(row).getByRole("button", { name: /Protected - click to remove/ }))
    .toBeTruthy();
});

test("Read marks through the same confirm as the bar's Mark read; a read sender has none", async () => {
  await mount();
  swipe(body("Bravo"), OPEN_RIGHT);
  expect(within(body("Bravo").parentElement!).queryByRole("button", { name: "Mark read" }))
    .toBeNull();
  swipe(body("Alpha"), OPEN_RIGHT);
  fireEvent.click(within(body("Alpha").parentElement!)
    .getByRole("button", { name: "Mark read" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Mark as read");
  await pressDialog(/^Mark as read \(30\)/);
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledWith("sender",
    ["alpha@x.example"], "mark_read", "", false, null, null));
});

test("More offers details, Select and Archive; Archive asks its confirm", async () => {
  await mount();
  swipe(body("Alpha"), OPEN_LEFT);
  fireEvent.click(within(body("Alpha").parentElement!)
    .getByRole("button", { name: "More" }));
  const sheet = screen.getByRole("dialog", { name: "Alpha" });
  expect(within(sheet).getByRole("button", { name: "Open details" })).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: "Archive" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Archive");
  expect(deleteGroups).not.toHaveBeenCalled();
  await cancelDialog();
});

test("More > Select starts Select mode with that row ticked, and swiping is off there", async () => {
  await mount();
  swipe(body("Alpha"), OPEN_LEFT);
  fireEvent.click(within(body("Alpha").parentElement!)
    .getByRole("button", { name: "More" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Alpha" }))
    .getByRole("button", { name: "Select" }));
  await waitFor(() => expect(screen.getAllByRole("checkbox", { name: "Select Alpha" })
    .some((c) => (c as HTMLInputElement).checked)).toBe(true));
  swipe(body("Bravo"), FULL_LEFT);
  await expectNoDialog();
  expect(body("Bravo").style.transform).toBe("");
});

test("the Scan header subline names the scan's progress", async () => {
  await mount({ status: "scanning", progress: "Inbox: 640/1623" });
  expect(screen.getByText("Scanning… 640 of 1,623 mails")).toBeTruthy();
  expect(screen.queryByText(/scanned .* ago/)).toBeNull();
});

test("the subline says just Scanning… while there is no count yet", async () => {
  await mount({ status: "scanning", progress: "connecting…" });
  expect(screen.getAllByText("Scanning…").length).toBeGreaterThan(0);
  expect(screen.queryByText(/ of /)).toBeNull();
});

function pullDown() {
  const t = (name: string, y: number, touches = true) => {
    const ev = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches",
      { value: touches ? [{ clientX: 200, clientY: y }] : [] });
    act(() => { document.body.dispatchEvent(ev); });
  };
  t("touchstart", 100); t("touchmove", 160); t("touchmove", 300);
  t("touchend", 300, false);
}

test("pulling down on Senders starts the scan - the Scan button's call", async () => {
  await mount();
  pullDown();
  await waitFor(() => expect(scan).toHaveBeenCalledOnce());
});

test("pulling down on the Overview scans too", async () => {
  await mount({}, "#/overview", "Overview");
  pullDown();
  await waitFor(() => expect(scan).toHaveBeenCalledOnce());
});

test("no pull to scan while a scan (or other job) runs - the button is disabled too", async () => {
  await mount({ status: "scanning", progress: "Inbox: 1/10" });
  pullDown();
  await new Promise((r) => setTimeout(r, 50));
  expect(scan).not.toHaveBeenCalled();
});

test("no pull to scan under a dialog", async () => {
  await mount();
  swipe(body("Alpha"), FULL_LEFT);
  await findDialog();
  pullDown();
  await new Promise((r) => setTimeout(r, 50));
  expect(scan).not.toHaveBeenCalled();
  await cancelDialog();
});

/* ------------------------------ mail rows ------------------------------ */

const MAIL = (uid: number, over: Record<string, unknown> = {}) => ({
  folder: "INBOX", uid, subject: `Subject ${uid}`, addr: "alpha@x.example",
  from: "Alpha", date: "2024-06-01T10:00:00", size: 1000, seen: false,
  pinned: false, ...over });

test("All mail rows: a full swipe left asks the same confirm as the bar's Trash", async () => {
  mailsResp = { mails: [MAIL(1), MAIL(2, { seen: true })], total: 2,
    ignored: [] };
  await mount({}, "#/all", "Subject 1");
  swipe(body("Subject 1"), FULL_LEFT);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Move to Trash");
  expect(dlg.textContent).toContain("Subject 1");
  expect(deleteMessages).not.toHaveBeenCalled();
  await pressDialog(/^Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1]], "trash", "", false));
});

test("a swiped Trash of a pinned mail keeps the pinned-mail warning", async () => {
  mailsResp = { mails: [MAIL(1, { pinned: true })], total: 1, ignored: [] };
  await mount({}, "#/all", "Subject 1");
  swipe(body("Subject 1"), FULL_LEFT);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Subject 1");
  expect(deleteMessages).not.toHaveBeenCalled();
  await pressDialog(/anyway/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1]], "trash", "", true));
});

test("mail rows: Pin is the first right-swipe action, Read only for unread mail", async () => {
  mailsResp = { mails: [MAIL(1), MAIL(2, { seen: true })], total: 2,
    ignored: [] };
  await mount({}, "#/all", "Subject 1");
  swipe(body("Subject 1"), OPEN_RIGHT);
  const row1 = body("Subject 1").parentElement!;
  expect(within(row1).getByRole("button", { name: "Mark read" })).toBeTruthy();
  // (the row's own pin button has the same name: the revealed one is the
  // wrapper's first child)
  fireEvent.click(within(row1.firstElementChild as HTMLElement)
    .getByRole("button", { name: /^Protect this mail/ }));
  await waitFor(() => expect(pin).toHaveBeenCalledWith("INBOX", 1, true));
  swipe(body("Subject 2"), OPEN_RIGHT);
  expect(within(body("Subject 2").parentElement!)
    .queryByRole("button", { name: "Mark read" })).toBeNull();
});

test("mail rows: swipe is off while mails are ticked", async () => {
  mailsResp = { mails: [MAIL(1), MAIL(2)], total: 2, ignored: [] };
  await mount({}, "#/all", "Subject 1");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Subject 2" }));
  swipe(body("Subject 1"), FULL_LEFT);
  await expectNoDialog();
  expect(body("Subject 1").style.transform).toBe("");
});

