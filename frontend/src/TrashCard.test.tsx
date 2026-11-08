// @vitest-environment jsdom
/* "Empty automatically" on the Trash page = a purge rule that deletes mail
 * for good, so the order of rules.py is part of the contract: created in
 * report mode, one report run, the preview in a danger confirm, armed only on
 * that confirm (never by itself), a declined confirm leaves nothing armed. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { autoEmptyRule, TrashCard } from "./components/TrashCard";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { Rule, RuleRun, TrashResp } from "./types";

const createRule = vi.fn();
const updateRule = vi.fn();
const deleteRule = vi.fn();
const runRule = vi.fn();
const purgePreview = vi.fn();

vi.mock("./api", () => ({
  api: {
    createRule: (...a: unknown[]) => createRule(...a),
    updateRule: (...a: unknown[]) => updateRule(...a),
    deleteRule: (...a: unknown[]) => deleteRule(...a),
    runRule: (...a: unknown[]) => runRule(...a),
    rules: () => Promise.resolve({ cap: 500, rules: [] }),
    purgePreview: (...a: unknown[]) => purgePreview(...a),
  },
  errorText: (s: string) => s,
  fmtSize: (b: number) => `${b} B`,
}));

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: "r1", name: "Empty Trash automatically", scope: "trash",
  grouping: "sender", query: "", action: "purge", dest: "",
  schedule: "daily", mode: "execute", keep_latest: null,
  older_than_days: 30, origin: "manual", report_runs: 1, created: 1,
  last_run: null, ...over });

const report = (over: Partial<RuleRun> = {}): RuleRun => ({
  ts: 1, mode: "report", groups: 2, mails: 9, size: 2100, acted: 0,
  capped: 0, skipped_protected: 0, skipped_pinned: 0, preview: [],
  error: "", ...over });

const listing = { folder: "Trash", uv: 1, total: 70, max_uid: 9, mails: [],
  senders: [{ addr: "a@gone.example", count: 70, size: 12400, unread: 0,
    ts: 1, date: "2026-01-02", uids: [] }] } as unknown as TrashResp;

beforeEach(() => {
  createRule.mockResolvedValue(rule({ mode: "report", report_runs: 0 }));
  updateRule.mockImplementation((_id: string, body: Partial<Rule>) =>
    Promise.resolve(rule({ ...body })));
  deleteRule.mockResolvedValue(undefined);
  runRule.mockResolvedValue(report());
  purgePreview.mockResolvedValue({ count: 4, size: 900 });
});
afterEach(() => {
  cleanup();
  for (const m of [createRule, updateRule, deleteRule, runRule, purgePreview]) {
    m.mockReset();
  }
  setLang("en");
});

const onChanged = vi.fn();
const card = (rules: Rule[] = []) => render(<ToastProvider><DialogProvider>
  <TrashCard list={listing} rules={rules} onChanged={onChanged} />
</DialogProvider></ToastProvider>);

const sw = () => screen.getByRole("switch", { name: "Empty automatically" });

test("the card shows what Trash holds", () => {
  card();
  expect(screen.getByText("12400 B")).toBeTruthy();
  expect(screen.getByText("in 70 mails")).toBeTruthy();
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("Mails older than 30 days, once a day")).toBeTruthy();
});

test("turning it on: a rule in report mode, a report run, the preview, then armed only on confirm",
  async () => {
    card();
    fireEvent.click(sw());
    await findDialog();
    // 1. created as a purge rule (the server starts it in report mode) ...
    expect(createRule).toHaveBeenCalledWith(expect.objectContaining({
      scope: "trash", action: "purge", grouping: "sender", query: "",
      schedule: "daily", older_than_days: 30 }));
    expect(createRule.mock.calls[0][0]).not.toHaveProperty("mode");
    // 2. ... one report run says what it would delete right now ...
    expect(runRule).toHaveBeenCalledWith("r1");
    const dlg = await findDialog();
    expect(within(dlg).getByText("Empty Trash automatically?")).toBeTruthy();
    expect(within(dlg).getByText("Right now this would delete 9 mails · 2100 B"))
      .toBeTruthy();
    expect(within(dlg).getByText(/up to 500 per run/)).toBeTruthy();
    // 3. ... and nothing is armed before the explicit confirm
    expect(updateRule).not.toHaveBeenCalled();
    await pressDialog("Turn on");
    await waitFor(() => expect(updateRule).toHaveBeenCalledWith("r1",
      { mode: "execute" }));
    expect(deleteRule).not.toHaveBeenCalled();
  });

test("declining the preview removes the rule this click created and arms nothing",
  async () => {
    card();
    fireEvent.click(sw());
    await findDialog();
    await cancelDialog();
    await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("r1"));
    expect(updateRule).not.toHaveBeenCalled();
    await expectNoDialog();
  });

test("the preview names what protected senders and pinned mails keep",
  async () => {
    runRule.mockResolvedValue(report({ mails: 0, size: 0,
      skipped_protected: 2, skipped_pinned: 1 }));
    card();
    fireEvent.click(sw());
    const dlg = await findDialog();
    expect(within(dlg).getByText("Right now there is nothing to delete"))
      .toBeTruthy();
    expect(within(dlg).getByText("2 mails from protected senders are skipped"))
      .toBeTruthy();
    expect(within(dlg).getByText("1 protected mail is skipped")).toBeTruthy();
    await cancelDialog();
  });

test("a refused report run (ambiguous folder ...) shows the error, nothing stays behind",
  async () => {
    runRule.mockRejectedValue(new Error("Trash is ambiguous"));
    card();
    fireEvent.click(sw());
    expect(await screen.findByText(/Trash is ambiguous/)).toBeTruthy();
    expect(deleteRule).toHaveBeenCalledWith("r1");
    expect(updateRule).not.toHaveBeenCalled();
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

test("the days are editable before turning it on and go into the rule",
  async () => {
    card();
    const days = screen.getByRole("spinbutton", { name: "Older than" });
    fireEvent.keyDown(days, { key: "ArrowDown" });
    fireEvent.keyDown(days, { key: "ArrowDown" });          // 28
    expect(screen.getByText("Mails older than 28 days, once a day"))
      .toBeTruthy();
    fireEvent.click(sw());
    await findDialog();
    expect(createRule).toHaveBeenCalledWith(
      expect.objectContaining({ older_than_days: 28 }));
    expect(within(await findDialog()).getByText(/more than 28 days ago/))
      .toBeTruthy();
    await cancelDialog();
  });

test("an existing matching rule reads as on, with the live next-run numbers",
  async () => {
    card([rule()]);
    expect(sw().getAttribute("aria-checked")).toBe("true");
    // the same selection the rule's report counts: old enough AND long enough here
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("trash",
      { older_than_days: 30 }, 30));
    expect(await screen.findByText("Next run: 4 mails · 900 B")).toBeTruthy();
    expect(createRule).not.toHaveBeenCalled();
  });

test("the last run is reported, an error of it stays visible", async () => {
  card([rule({ last_run: report({ mode: "execute", acted: 3 }) })]);
  expect(await screen.findByText("Last run: 3 mails deleted")).toBeTruthy();
  cleanup();
  card([rule({ last_run: report({ mode: "execute", error: "Trash changed" }) })]);
  expect(await screen.findByText("Trash changed")).toBeTruthy();
});

test("a rule that is only reporting is NOT shown as on; turning it on goes through the preview",
  async () => {
    card([rule({ mode: "report", report_runs: 0 })]);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Not active yet/)).toBeTruthy();
    fireEvent.click(sw());
    await findDialog();
    expect(createRule).not.toHaveBeenCalled();       // the rule exists already
    expect(runRule).toHaveBeenCalledWith("r1");
    expect(updateRule).not.toHaveBeenCalled();
    await cancelDialog();
    await expectNoDialog();
    expect(deleteRule).not.toHaveBeenCalled();        // not ours to remove
  });

test("off removes the rule", async () => {
  card([rule()]);
  fireEvent.click(sw());
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("r1"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(onChanged).toHaveBeenCalled();
});

test("a changed age on an armed rule needs Apply, and Apply re-previews before arming again",
  async () => {
    card([rule()]);
    const days = screen.getByRole("spinbutton", { name: "Older than" });
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.keyDown(days, { key: "ArrowUp" });             // 31
    expect(updateRule).not.toHaveBeenCalled();               // only a draft
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await findDialog();
    // the edit sends the rule back to report on the server ...
    expect(updateRule).toHaveBeenCalledWith("r1", { older_than_days: 31 });
    expect(runRule).toHaveBeenCalledWith("r1");
    // ... and only the confirm arms it again
    expect(updateRule).toHaveBeenCalledTimes(1);
    await pressDialog("Turn on");
    await waitFor(() => expect(updateRule).toHaveBeenLastCalledWith("r1",
      { mode: "execute" }));
  });

test("Rules that are not this switch (other schedule, a filter, Junk, keep-latest) are ignored",
  () => {
    const others = [
      rule({ schedule: "weekly" }), rule({ query: "from:a@gone.example" }),
      rule({ scope: "junk" }), rule({ scope: "mail", action: "trash" }),
      rule({ older_than_days: null, keep_latest: 3 })];
    expect(autoEmptyRule(others)).toBeUndefined();
    card(others);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(autoEmptyRule([rule({ id: "a", mode: "report" }), rule({ id: "b" })])
      ?.id).toBe("b");                              // the armed one wins
  });

test("German wording says what really happens: once a day, after the preview",
  async () => {
    setLang("de");
    card();
    expect(screen.getByRole("switch", { name: "Automatisch leeren" }))
      .toBeTruthy();
    expect(screen.getByText("Mails älter als 30 Tage, einmal am Tag"))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Automatisch leeren" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Papierkorb automatisch leeren?")).toBeTruthy();
    expect(within(dlg).getByText("Jetzt würden 9 Mails · 2100 B gelöscht"))
      .toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Abbrechen" }));
  });
