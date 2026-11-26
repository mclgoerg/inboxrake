// @vitest-environment jsdom
/* Where Your folders is reached from: the sidebar item after Trash, its route,
 * and the last tile of the phone Clean up tab - with everything of today's
 * Clean up listed in INVENTORY.md still there, in its order. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const yourFolders = vi.fn();
const duplicates = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { yourFolders: (...a: unknown[]) => yourFolders(...a),
    duplicatesSummary: () => duplicates() },
}));

import { Sidebar } from "./components/Sidebar";
import { CleanupPage } from "./components/TabPages";
import { setLang } from "./i18n";
import { TOOL_PAGES, TOOL_TAB, isToolPage, parseHash } from "./nav";
import type { AppState, Group } from "./types";
import { forgetFolders } from "./yourFoldersCache";
import { resp } from "./yourFoldersFixtures";

beforeEach(() => {
  forgetFolders();
  yourFolders.mockResolvedValue(resp());
  duplicates.mockRejectedValue(new Error("x"));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); setLang("en"); });

/* --------------------------------- sidebar --------------------------------- */

const sidebar = () => {
  const onOpen = vi.fn();
  render(<Sidebar page="overview" onPage={() => {}} onOpen={onOpen}
    account={null} disabled={{}} junkCount={11} trashCount={70} proposals={2} />);
  return onOpen;
};

test("a Your folders item follows Trash, with no count, and opens the page", () => {
  const onOpen = sidebar();
  const item = screen.getByRole("button", { name: "Your folders" });
  expect(item.textContent).toBe("Your folders");
  fireEvent.click(item);
  expect(onOpen).toHaveBeenCalledWith("yourfolders");
  const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const at = (re: RegExp) => names.findIndex((n) => re.test(n));
  expect(at(/^Your folders$/)).toBe(at(/^Trash/) + 1);
});

test("every Clean up item of today is still there, in its order, with its counts", () => {
  sidebar();
  const links = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const at = (re: RegExp) => links.findIndex((n) => re.test(n));
  const order = [/^Triage/, /^Duplicates/, /^Attachments/, /^Rules/, /^Junk/,
    /^Trash/, /^Your folders$/].map(at);
  expect(order.every((n) => n >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(screen.getByRole("button", { name: /^Junk/ }).textContent).toContain("11");
  expect(screen.getByRole("button", { name: /^Trash/ }).textContent).toContain("70");
  expect(screen.getByRole("button", { name: /^Rules/ }).textContent).toContain("2");
  // the Insights group starts right after it
  expect(at(/^Statistics/)).toBeGreaterThan(at(/^Your folders$/));
});

test("German name", () => {
  setLang("de");
  sidebar();
  expect(screen.getByRole("button", { name: "Deine Ordner" })).toBeTruthy();
});

test("it is a tool page at #/yourfolders on the Clean up tab below 1024 px", () => {
  expect(TOOL_PAGES).toContain("yourfolders");
  expect(TOOL_TAB.yourfolders).toBe("cleanup");
  expect(parseHash("#/yourfolders")).toBe("yourfolders");
  expect(isToolPage("yourfolders")).toBe(true);
  // the routes of today are unchanged
  for (const p of ["junk", "trash", "rules", "duplicates", "attachments"])
    expect(TOOL_TAB[p as keyof typeof TOOL_TAB]).toBe("cleanup");
});

/* --------------------------------- phone tile -------------------------------- */

const mk = (key: string): Group => ({
  key, label: key, sub: key, count: 20, size: 2 * 1048576, unread: 0,
  first: "2020-01-01", last: "2024-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50,
}) as Group;
const state = (over: Partial<AppState> = {}) => ({
  status: "done", rules: [], junk_count: 11, trash_count: 70,
  folders_raw: ["INBOX", "Archive"], ...over }) as unknown as AppState;
const cleanup_ = (over = {}) => {
  const p = { account: "a", groups: [mk("a@x.example")], state: state(),
    deckSize: 0, triageDisabled: false, aiShown: true, aiDisabled: false,
    onOpen: vi.fn(), onReviewAi: vi.fn(), ...over };
  render(<CleanupPage {...p} />);
  return p;
};

test("Clean up: the tile is the last one, shows the folders and the things to tidy", async () => {
  const p = cleanup_();
  const tile = screen.getByRole("button", { name: /^Your folders/ });
  expect(tile.parentElement!.parentElement!.lastElementChild)
    .toBe(tile.parentElement);
  await waitFor(() => expect(tile.textContent).toMatch(/10\sfolders/));
  expect(tile.textContent).toContain("3 things to tidy");
  expect(yourFolders).toHaveBeenCalledWith("a");
  fireEvent.click(tile);
  expect(p.onOpen).toHaveBeenCalledWith("yourfolders");
});

test("Clean up: no number until the answer is there (no 8 that turns into 10)", () => {
  yourFolders.mockReturnValue(new Promise(() => {}));
  cleanup_();
  const tile = screen.getByRole("button", { name: /^Your folders/ });
  expect(tile.textContent).not.toMatch(/\d/);
  expect(tile.textContent).toContain("See and tidy them");
  expect(tile.querySelector("[aria-hidden].rounded-control.bg-panel2")).toBeTruthy();
});

test("Clean up: the mail server is asked once per scan, not on every visit", async () => {
  const s = state({ scanned_ts: 1000 });
  cleanup_({ state: s });
  await waitFor(() => expect(screen.getByRole("button", { name: /^Your folders/ })
    .textContent).toMatch(/10\sfolders/));
  expect(yourFolders).toHaveBeenCalledTimes(1);
  cleanup();
  // the tab again (a new mount): the kept answer is there at once
  cleanup_({ state: s });
  expect(screen.getByRole("button", { name: /^Your folders/ }).textContent)
    .toMatch(/10\sfolders/);
  expect(yourFolders).toHaveBeenCalledTimes(1);
  cleanup();
  // another account, or the next scan: asked again
  cleanup_({ state: s, account: "b" });
  await waitFor(() => expect(yourFolders).toHaveBeenCalledTimes(2));
  cleanup();
  cleanup_({ state: state({ scanned_ts: 2000 }) });
  await waitFor(() => expect(yourFolders).toHaveBeenCalledTimes(3));
});

test("Clean up: a failed answer leaves the tile without a number", async () => {
  yourFolders.mockRejectedValue(new Error("down"));
  cleanup_();
  await waitFor(() => expect(yourFolders).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.getByRole("button", { name: /^Your folders/ }).textContent)
    .not.toMatch(/\d/);
});

test("Clean up: nothing to tidy says so; before a scan the server is not asked", async () => {
  yourFolders.mockResolvedValue(resp({ hints: [] }));
  cleanup_();
  const tile = screen.getByRole("button", { name: /^Your folders/ });
  await waitFor(() => expect(tile.textContent).toContain("Nothing to tidy"));
  cleanup();
  yourFolders.mockClear();
  cleanup_({ state: state({ status: "idle", folders_raw: [] }) });
  expect(yourFolders).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /^Your folders/ }).textContent)
    .toContain("Check");
});

test("Clean up: every tile of today is still there in its order, the new one after Trash", () => {
  cleanup_();
  const names = ["Duplicates", "Attachments", "AI review", "Junk", "Rules",
    "Trash", "Your folders"];
  const buttons = screen.getAllByRole("button").map((b) => b.textContent ?? "");
  const idx = names.map((n) => buttons.findIndex((b) => b.startsWith(n)));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  expect(screen.getByRole("button", { name: /^Junk/ }).textContent)
    .toContain("11");
});

test("Clean up: German tile", async () => {
  setLang("de");
  cleanup_();
  const tile = screen.getByRole("button", { name: /^Deine Ordner/ });
  await waitFor(() => expect(tile.textContent).toMatch(/10\sOrdner/));
  expect(tile.textContent).toContain("3 Dinge zum Aufräumen");
});
