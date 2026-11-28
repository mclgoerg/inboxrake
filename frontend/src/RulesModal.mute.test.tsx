// @vitest-environment jsdom
/* A mute ("Mute this conversation") is a rule like Block: it is listed with
 * the other rules (Run now, Last report, Edit, More > Delete as for every
 * rule), reads "When Thread groups match thread:<key> then archive and mark
 * read, after each scan", and has an Unmute button (it deletes the rule after
 * a confirm). Its editor keeps the conversation: name and schedule change. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, Rule } from "./types";

const updateRule = vi.fn().mockResolvedValue({});
const deleteRule = vi.fn().mockResolvedValue({});
const runRule = vi.fn().mockResolvedValue({});

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { createRule: vi.fn(), updateRule: (id: string, b: unknown) =>
    updateRule(id, b), deleteRule: (id: string) => deleteRule(id),
  runRule: (id: string) => runRule(id),
  rules: () => Promise.resolve({ rules: [], cap: 37 }),
  ruleCheckup: () => Promise.resolve({ account: "proton", scanned_ts: null,
    analysed: false, needs_scan: false, checked: 0, rules: 0,
    findings: [] }) },
}));

const baseState: AppState = {
  account: "proton", status: "idle", scanned_ts: null, groups_rev: 0,
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

const KEY = "4f9c1e0a7b2d3c58";
const mute = (over: Partial<Rule> = {}): Rule => ({
  id: "m1", name: "Mute: Team dinner on Friday", scope: "mail",
  grouping: "thread", query: `thread:${KEY}`, action: "archive_read",
  dest: "", schedule: "scan", mode: "execute", keep_latest: null,
  older_than_days: null, origin: "mute", mute: { key: KEY, since: 1700000000 },
  report_runs: 1, created: 0,
  last_run: { ts: 1700000100, mode: "execute", groups: 1, mails: 3, acted: 3,
    capped: 0, skipped_protected: 0, skipped_pinned: 0, preview: [],
    error: "" },
  ...over,
});
const plain: Rule = {
  id: "abc1", name: "Old shop mail", scope: "mail", grouping: "sender",
  query: "is:unsub", action: "trash", dest: "", schedule: "daily",
  mode: "report", keep_latest: null, older_than_days: 30, origin: "manual",
  report_runs: 1, created: 0, last_run: null,
};

const show = (rules: Rule[], onChanged = vi.fn()) => {
  render(<DialogProvider><RulesModal state={{ ...baseState, rules }}
    onClose={() => {}} onChanged={onChanged} /></DialogProvider>);
  return onChanged;
};

afterEach(() => {
  cleanup();
  updateRule.mockClear();
  deleteRule.mockClear();
  runRule.mockClear();
  setLang("en");
});

test("the mute is one more card: its sentence, its last run and the buttons "
  + "every rule has", () => {
  show([plain, mute()]);
  expect(screen.getByText("Mute: Team dinner on Friday")).toBeTruthy();
  expect(screen.getByText("Thread")).toBeTruthy();
  expect(screen.getByText(`thread:${KEY}`)).toBeTruthy();
  expect(screen.getByText("archive and mark read")).toBeTruthy();
  expect(screen.getByText("after each scan")).toBeTruthy();
  expect(screen.getByText(/completed: 3 mails in 1 group/)).toBeTruthy();
  // the rule list keeps its order: the existing rule first
  const names = screen.getAllByText(/^(Old shop mail|Mute: Team dinner)/)
    .map((n) => n.textContent);
  expect(names).toEqual(["Old shop mail", "Mute: Team dinner on Friday"]);
  expect(screen.getAllByRole("button", { name: "Run now" })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Last report" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: /^More: / })).toHaveLength(2);
  // it is armed and can be switched to Report only like any rule
  expect(screen.getAllByRole("radio", { name: "Active" })).toHaveLength(2);
  expect(screen.getAllByRole("radio", { name: "Report only" })).toHaveLength(2);
  // only the mute has Unmute
  expect(screen.getAllByRole("button", { name: "Unmute" })).toHaveLength(1);
});

test("a run on an account with no Archive folder says it only marked read",
  () => {
    const run = { ...mute().last_run!, read_only: true };
    show([mute({ last_run: run })]);
    expect(screen.getByText(/only marked as read \(no Archive folder\)/))
      .toBeTruthy();
  });

test("Unmute asks first, then deletes the rule", async () => {
  const onChanged = show([mute()]);
  fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("Unmute this conversation?")).toBeTruthy();
  expect(within(dlg).getByText(/Mail the rule already archived stays in Archive/))
    .toBeTruthy();
  await cancelDialog();
  await expectNoDialog();
  expect(deleteRule).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
  await pressDialog("Unmute");
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("m1"));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

test("the generic Delete stays in the menu of a mute", async () => {
  show([mute()]);
  fireEvent.click(screen.getByRole("button", { name: /^More: / }));
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
});

test("Run now on an armed mute asks like any armed rule", async () => {
  show([mute()]);
  fireEvent.click(screen.getByRole("button", { name: "Run now" }));
  await pressDialog("Run now");
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("m1"));
});

test("Edit keeps the conversation: name and schedule change, the rest is shown "
  + "as it is", async () => {
  show([mute()]);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const editor = screen.getByRole("dialog", { name: "Edit rule" });
  const q = within(editor);
  expect(q.getByLabelText("Name")).toBeTruthy();
  // the filter is not an input: the key stays
  expect(q.getByText(`thread:${KEY}`)).toBeTruthy();
  expect(q.queryByPlaceholderText(/tag:shipping/)).toBeNull();
  expect(q.getByText("only new mail of this conversation")).toBeTruthy();
  expect(q.getByText(/A mute keeps its conversation/)).toBeTruthy();
  // no live preview (it ignores what a mute leaves alone), no reset warning
  expect(q.queryByText("Preview")).toBeNull();
  expect(q.queryByText(/switches this rule back to report mode/)).toBeNull();
  // the action is fixed
  const action = q.getByRole("button", { name: /^Action/ });
  expect((action as HTMLButtonElement).disabled).toBe(true);
  // the schedule offers manual and after each scan only
  fireEvent.click(q.getByRole("button", { name: /^Schedule/ }));
  expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent))
    .toEqual(["manual", "after each scan"]);
  fireEvent.click(screen.getByRole("menuitemradio", { name: "manual" }));
  fireEvent.change(q.getByLabelText("Name"),
    { target: { value: "Quiet" } });
  fireEvent.click(q.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(updateRule).toHaveBeenCalled());
  expect(updateRule).toHaveBeenCalledWith("m1", expect.objectContaining({
    name: "Quiet", schedule: "manual", grouping: "thread",
    query: `thread:${KEY}`, action: "archive_read" }));
});

test("an ordinary rule's editor is unchanged: three schedules, a preview",
  () => {
    show([plain]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Edit rule" });
    fireEvent.click(within(editor).getByRole("button", { name: /^Schedule/ }));
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent))
      .toEqual(["manual", "daily", "weekly"]);
    expect(within(editor).getByText("Preview")).toBeTruthy();
    expect(within(editor).queryByText(/A mute keeps/)).toBeNull();
  });

test("German", () => {
  setLang("de");
  show([mute()]);
  expect(screen.getByText("archivieren und als gelesen markieren")).toBeTruthy();
  expect(screen.getByText("nach jedem Scan")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stummschaltung aufheben" }))
    .toBeTruthy();
});
