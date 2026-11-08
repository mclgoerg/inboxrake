// @vitest-environment jsdom
/* UX3-4: sidebar navigation from 1024 px; the old header and Tools menu below. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const stateCalls = { n: 0 };
let state: any;
let versions = ["v1"];        // api.version() walks through this in order
let versionCalls = 0;

const block = vi.fn().mockResolvedValue({ rule: { id: "r1" } });
const deleteRule = vi.fn().mockResolvedValue(undefined);
const deleteGroups = vi.fn()
  .mockResolvedValue({ ok: true, queued: 1, skipped: 0 });
const aiReview = vi.fn().mockResolvedValue({ ok: true });
const downloadFile = vi.fn().mockResolvedValue(undefined);
const mails = (key: string) => [1, 2, 3].map((uid) => ({
  uid, folder: "INBOX", date: "2024-01-01", ts: uid,
  subject: `Mail ${uid} of ${key}`, addr: key, size: 100,
  seen: true, ai: null, pinned: false }));
// Every group-detail fetch goes through here (count it, or hold it back).
const groupFetch = vi.fn((key: string) => Promise.resolve(mails(key)));

vi.mock("./api", () => ({
  api: {
    authProbe: () => Promise.resolve({ mode: "none", authed: true }),
    getConfig: () => Promise.resolve(cfg),
    state: () => { stateCalls.n++; return Promise.resolve(state); },
    emptyTrash: () => Promise.resolve({ ok: true }),
    audit: () => Promise.resolve({ entries: [], total: 0 }),
    undo: () => Promise.resolve({ restored: 1, of: 1, rescan: true }),
    logout: () => Promise.resolve(),
    exportUrl: (mode: string, keys?: string[]) =>
      `/api/export?grouping=${mode}`
      + (keys?.length ? `&keys=${keys.join(",")}` : ""),
    version: () => Promise.resolve(
      { build: versions[Math.min(versionCalls++, versions.length - 1)] }),
    block: (...args: unknown[]) => block(...args),
    deleteRule: (...args: unknown[]) => deleteRule(...args),
    // three unpinned mails, matching groupFixture.count (the detail panel's
    // "Trash all N" counts the loaded, unpinned mails)
    group: (_grouping: string, key: string) => groupFetch(key),
    deleteGroups: (...args: unknown[]) => deleteGroups(...args),
    aiReview: (...args: unknown[]) => aiReview(...args),
    mails: () => Promise.resolve({ items: [], total: 0 }),
    folders: () => Promise.resolve({ folders: [], wildcards: [] }),
    foldersPanel: () => Promise.resolve({ mails: [], total: 0, senders: [] }),
  },
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  setAccount: () => {},
  withAccount: (p: string) => p,
  fmtSize: (b: number) => `${b} B`,
  fmtUsd: (c: number) => `$${c}`,
  undoLabel: (u: { label: string }) => u.label,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder} ${m.uid}`,
}));

import App from "./App";
import { DialogProvider, ToastProvider } from "./components/ui";
import { expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import type { AppState, Config } from "./types";

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
  accounts: { proton: {
    excluded_folders: [], host: "h", port: 993, security: "ssl",
    smtp_host: "", smtp_port: 587, smtp_security: "auto",
    user: "me@proton.example", password: "", password_set: true,
    cafile: "", preset: "custom", oauth: null,
    digest: { schedule: "off", recipient: "", hour: 8, minute: 0 },
    auto_scan: { enabled: false, unit: "hours", value: 6, align_minute: 0 },
  } },
} as unknown as Config;

const mk = (label: string, count: number) => ({
  key: `${label.toLowerCase()}@x.example`, label, sub: `${label.toLowerCase()}@x.example`,
  count, size: 1000, unread: 0, first: "2024-01-01", last: "2024-06-01",
  tags: [], samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
});
// Default sort is by count, descending: Alpha, Bravo, Charlie.
const A = mk("Alpha", 30), B = mk("Bravo", 20), C = mk("Charlie", 10);

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: null, groups_rev: 0,
  progress: "", error: "", folders: [],
  groups: { sender: { [A.key]: A, [B.key]: B, [C.key]: C },
    smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: [], rules: [],
  presets: [],
} as unknown as AppState;

// jsdom has no scrollIntoView (App scrolls the focused row into view).
Element.prototype.scrollIntoView = () => {};

let isWide = true;
const widen = (wide: boolean) => {
  isWide = wide;
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return isWide && q.includes("1024"); }, media: q,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
};
const mount = (wide = true) => {
  widen(wide);
  state = { ...baseState, scanned_ts: 1, junk_count: 4, trash_count: 7 };
  localStorage.setItem("pmc_account", "proton");
  return render(<ToastProvider><DialogProvider><App /></DialogProvider></ToastProvider>);
};
const side = () => screen.findByRole("navigation", { name: "Main navigation" });
const row = async (label: string) => {
  const find = () => [...document.querySelectorAll("tr[data-gidx]")]
    .find((tr) => tr.textContent?.includes(label)) as HTMLElement | undefined;
  await waitFor(() => expect(find()).toBeTruthy());
  return find()!;
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear();
  window.location.hash = ""; });

test(">= 1024: sidebar with counts replaces the header, Tools menu and links",
  async () => {
  mount();
  const nav = within(await side());
  await waitFor(() => expect(
    nav.getByRole("link", { name: /Senders/ }).textContent).toContain("3"));
  expect(nav.getByRole("link", { name: /All mail/ }).textContent).toContain("60");
  expect(nav.getByRole("button", { name: /Junk/ }).textContent).toContain("4");
  expect(nav.getByRole("button", { name: /Trash/ }).textContent).toContain("7");
  for (const n of ["Triage", "Duplicates", "Attachments", "Rules", "Statistics",
    "Space map", "Trackers", "Activity", "Settings", "Search all mails"])
    expect(nav.getByRole("button", { name: new RegExp(n) })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Inboxrake" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Tools/ })).toBeNull();
  // the work moved to a "More" menu next to Scan: Export CSV is still there
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(await screen.findByRole("menuitem", { name: /Export CSV/ })).toBeTruthy();
});

test("< 1024: top bar, tab bar and five segments, no sidebar, no Tools menu",
  async () => {
  mount(false);
  expect(await screen.findByRole("heading", { level: 1, name: "Senders" }))
    .toBeTruthy();
  const tabs = within(screen.getByRole("navigation",
    { name: "Main navigation" }));
  expect(tabs.getAllByRole("link").map((l) => l.textContent))
    .toEqual(["Overview", "Senders", "Clean up", "Insights"]);
  expect(screen.queryByRole("button", { name: /Tools/ })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Inboxrake" })).toBeNull();
  expect(screen.getByRole("tab", { name: "All mails" })).toBeTruthy();
  expect(screen.getByLabelText("Search all mails")).toBeTruthy();
  expect(screen.getByLabelText("Scan")).toBeTruthy();
});

test("the tab bar publishes --tabbar-h and steps aside for the selection bar",
  async () => {
  mount(false);
  await screen.findByRole("heading", { level: 1, name: "Senders" });
  expect(document.documentElement.style.getPropertyValue("--tabbar-h"))
    .not.toBe("");
  expect(document.documentElement.dataset.bulkbar).toBeUndefined();
  fireEvent.click((await screen.findAllByRole("checkbox"))[1]);
  await screen.findByRole("region", { name: "Selection actions" });
  // CSS hides .pmc-tabbar while this flag is set
  expect(document.documentElement.dataset.bulkbar).toBe("");
});

test("#/cleanup shows the tool list below 1024 and the default page from 1024",
  async () => {
  window.location.hash = "#/cleanup";
  mount(false);
  expect(await screen.findByRole("heading", { level: 1, name: "Clean up" }))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: /^Rules/ })).toBeTruthy();
  expect(screen.queryByPlaceholderText("Search or filter…")).toBeNull();
  cleanup();
  window.location.hash = "#/insights";
  mount(true);
  const nav = within(await side());
  expect(nav.getByRole("link", { name: /Overview/ })
    .getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("link", { name: "Insights" })).toBeNull();
});

test("account menu in the sidebar carries the profile items", async () => {
  mount();
  fireEvent.click(within(await side()).getByRole("button", { name: /proton/ }));
  expect(await screen.findByRole("menuitem", { name: /Settings/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Add account/ })).toBeTruthy();
  expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Activity/ })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /Empty Trash/ })).toBeNull();
});

test("the phone avatar opens an Accounts sheet whose Activity row opens the "
  + "audit log", async () => {
  mount(false);
  fireEvent.click(await screen.findByRole("button", { name: /^Account:/ }));
  const sheet = await screen.findByRole("dialog");
  expect(within(sheet).getByText("Accounts")).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: /Activity/ }));
  await waitFor(() => expect(screen.getByRole("dialog").textContent)
    .toContain("Activity"));
  expect(screen.queryByText("Accounts")).toBeNull();
});

test("#/cleanup at >= 1024: the sidebar's Senders rewrites the URL",
  async () => {
  window.location.hash = "#/cleanup";
  mount(true);
  const nav = within(await side());
  expect(nav.getByRole("link", { name: /Overview/ })
    .getAttribute("aria-current")).toBe("page");
  fireEvent.click(nav.getByRole("link", { name: /Senders/ }));
  expect(window.location.hash).toBe("#/senders");
});

test("the phone top bar is sticky and turns glass once the page scrolls",
  async () => {
  mount(false);
  const head = (await screen.findByRole("heading", { level: 1 }))
    .closest("header")!;
  expect(head.className).toContain("sticky");
  expect(head.className).not.toContain("bar-glass");
  act(() => {
    document.body.scrollTop = 40;
    document.body.dispatchEvent(new Event("scroll"));
  });
  expect(head.className).toContain("bar-glass");
});

test("tool items open as pages beside the sidebar; Settings is a page too",
  async () => {
  mount();
  const nav = within(await side());
  fireEvent.click(nav.getByRole("button", { name: /Search all mails/ }));
  expect(window.location.hash).toBe("#/search");
  // a page, not a dialog: no overlay, no close button, current item marked
  expect(await screen.findByRole("region")).toBeTruthy();
  expect(await screen.findByPlaceholderText(/Search subject or sender/))
    .toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  expect(nav.getByRole("button", { name: /Search all mails/ })
    .getAttribute("aria-current")).toBe("page");
  // Esc on a page does nothing
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(window.location.hash).toBe("#/search");
  fireEvent.click(nav.getByRole("button", { name: "Settings" }));
  // Settings: its own route, a section column beside the form (the first
  // section open), no dialog, the gear marked current
  expect(await screen.findByRole("heading", { level: 1, name: "General" }))
    .toBeTruthy();
  expect(window.location.hash).toBe("#/settings");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(nav.getByRole("button", { name: "Settings" })
    .getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("navigation", { name: "Settings" })).toBeTruthy();
});

test("a tool page survives a reload and Back/forward; leaving refreshes",
  async () => {
  window.location.hash = "#/trash";
  mount();
  const nav = within(await side());
  await waitFor(() => expect(nav.getByRole("button", { name: /Trash/ })
    .getAttribute("aria-current")).toBe("page"));
  expect(screen.queryByRole("dialog")).toBeNull();
  const before = stateCalls.n;
  fireEvent.click(nav.getByRole("link", { name: /Senders/ }));
  expect(window.location.hash).toBe("#/senders");
  // the panel's close side effect (refresh) ran on the way out
  await waitFor(() => expect(stateCalls.n).toBeGreaterThan(before));
  expect(screen.queryByRole("heading", { name: /Trash/ })).toBeNull();
  act(() => {
    window.location.hash = "#/triage";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await waitFor(() => expect(nav.getByRole("button", { name: /Triage/ })
    .getAttribute("aria-current")).toBe("page"));
});

test("< 1024: tools stay modals", async () => {
  mount(false);
  fireEvent.click(await screen.findByLabelText("Search all mails"));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(window.location.hash).not.toMatch(/search/);
});

test("Activity page: the undo history above the audit log, each restorable",
  async () => {
  mount();
  state = { ...state, undo: [
    { action: "delete", count: 2, label: "Older", ts: 1 },
    { action: "delete", count: 5, label: "Newer", ts: 2 }] };
  fireEvent.click(within(await side()).getByRole("button",
    { name: /Activity/ }));
  expect(window.location.hash).toBe("#/activity");
  const cards = await screen.findByRole("region", { name: "Undo history" });
  const undos = within(cards).getAllByRole("button", { name: "Undo" });
  // newest first
  expect(undos.length).toBe(2);
  expect(undos[0].parentElement!.textContent).toContain("Newer");
  expect(undos[1].parentElement!.textContent).toContain("Older");
  fireEvent.click(undos[0]);
  // the same confirm as the status line's menu (a real dialog over the page)
  expect(await findDialog()).toBeTruthy();
});

test("All mail is a page: hash follows, back/forward work, selection resets",
  async () => {
  mount();
  const nav = within(await side());
  expect(nav.getByRole("link", { name: /Senders/ }).getAttribute("aria-current"))
    .toBe("page");
  fireEvent.click(nav.getByRole("link", { name: /All mail/ }));
  expect(window.location.hash).toBe("#/all");
  expect(nav.getByRole("link", { name: /All mail/ }).getAttribute("aria-current"))
    .toBe("page");
  // no grouping segments on the All mail page
  expect(screen.getByRole("tab", { name: "Subject" }).closest(".hidden"))
    .toBeTruthy();
  act(() => {
    window.location.hash = "#/senders";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await waitFor(() => expect(
    nav.getByRole("link", { name: /Senders/ }).getAttribute("aria-current"))
    .toBe("page"));
  expect(screen.getByRole("tab", { name: "Subject" }).closest(".hidden"))
    .toBeNull();
});

test("keyboard shortcuts act only on the senders page", async () => {
  mount();
  await row("Alpha");
  fireEvent.keyDown(document.body, { key: "j" });
  fireEvent.keyDown(document.body, { key: "x" });
  await waitFor(() => expect(screen.getByRole("region", { name: /selected|Selection/i }))
    .toBeTruthy());
  fireEvent.click(within(await side()).getByRole("link", { name: /All mail/ }));
  // switching page cleared the selection
  expect(screen.queryByRole("region", { name: /selected|Selection/i })).toBeNull();
  fireEvent.keyDown(document.body, { key: "x" });
  expect(screen.queryByRole("region", { name: /selected|Selection/i })).toBeNull();
});

test("a reload on #/all lands on All mail", async () => {
  window.location.hash = "#/all";
  mount();
  expect((await within(await side()).findByRole("link", { name: /All mail/ }))
    .getAttribute("aria-current")).toBe("page");
});

test("fresh load lands on Overview; All mail, Back lands on Overview again (sidebar and segment)",
  async () => {
  window.location.hash = "";
  mount();
  const nav = within(await side());
  expect(nav.getAllByRole("link")[0].textContent).toContain("Overview");
  await waitFor(() => expect(
    nav.getByRole("link", { name: /Overview/ }).getAttribute("aria-current"))
    .toBe("page"));
  fireEvent.click(nav.getByRole("link", { name: /All mail/ }));
  expect(window.location.hash).toBe("#/all");
  act(() => {
    window.location.hash = "";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await waitFor(() => expect(
    nav.getByRole("link", { name: /Overview/ }).getAttribute("aria-current"))
    .toBe("page"));
  cleanup();
  // phones: the Overview has a title and the tab bar, no grouping segments
  window.location.hash = "";
  mount(false);
  expect(await screen.findByRole("heading", { level: 1, name: "Overview" }))
    .toBeTruthy();
  expect(screen.queryByRole("tab", { name: "Sender" })).toBeNull();
  const tabs = within(screen.getByRole("navigation",
    { name: "Main navigation" }));
  expect(tabs.getByRole("link", { name: "Overview" })
    .getAttribute("aria-current")).toBe("page");
  fireEvent.click(tabs.getByRole("link", { name: "Senders" }));
  fireEvent.click(await screen.findByRole("tab", { name: "All mails" }));
  expect(window.location.hash).toBe("#/all");
  act(() => {
    window.location.hash = "";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Overview" }))
    .toBeTruthy();
});

test("Welcome and the first-run wizard cover the whole viewport: no sidebar", async () => {
  (cfg as { setup_needed?: boolean }).setup_needed = true;
  try {
    mount();
    expect(await screen.findByText("Welcome to Inboxrake")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Get started/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  } finally {
    delete (cfg as { setup_needed?: boolean }).setup_needed;
  }
});
