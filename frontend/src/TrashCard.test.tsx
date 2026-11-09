// @vitest-environment jsdom
/* "Empty automatically" on the Trash page = a purge rule that deletes mail
 * for good, so the order of rules.py is part of the contract: a live preview
 * first (nothing written), the danger confirm, and only after it the rule is
 * written, reported and armed (never by itself). Declining leaves everything
 * exactly as it was. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { noteAccountSwitch } from "./accountGuard";
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
  older_than_days: 30, origin: "auto_empty", report_runs: 1, created: 1,
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
  purgePreview.mockResolvedValue(preview());
});
afterEach(() => {
  cleanup();
  for (const m of [createRule, updateRule, deleteRule, runRule, purgePreview]) {
    m.mockReset();
  }
  setLang("en");
});

const preview = (over: Record<string, number> = {}) => ({
  count: 9, size: 2100, skipped_protected: 0, skipped_pinned: 0, ...over });

/** No write of any kind happened. */
const untouched = () => {
  expect(createRule).not.toHaveBeenCalled();
  expect(updateRule).not.toHaveBeenCalled();
  expect(deleteRule).not.toHaveBeenCalled();
  expect(runRule).not.toHaveBeenCalled();
};

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

test("turning it on: preview first, nothing written, then rule + report + arm only after the confirm",
  async () => {
    card();
    fireEvent.click(sw());
    const dlg = await findDialog();
    // the live preview of exactly what the rule selects ...
    expect(purgePreview).toHaveBeenCalledWith("trash",
      { older_than_days: 30 }, 30);
    expect(within(dlg).getByText("Empty Trash automatically?")).toBeTruthy();
    expect(within(dlg).getByText("Right now this would delete 9 mails · 2100 B"))
      .toBeTruthy();
    expect(within(dlg).getByText(/up to 500 per run/)).toBeTruthy();
    // ... and nothing was created, edited, run or armed before the confirm
    untouched();
    await pressDialog("Turn on");
    await waitFor(() => expect(updateRule).toHaveBeenCalledWith("r1",
      { mode: "execute" }));
    // created without a mode (the server starts it in report mode), reported
    expect(createRule).toHaveBeenCalledWith(expect.objectContaining({
      scope: "trash", action: "purge", grouping: "sender", query: "",
      schedule: "daily", older_than_days: 30, origin: "auto_empty" }));
    expect(createRule.mock.calls[0][0]).not.toHaveProperty("mode");
    expect(runRule).toHaveBeenCalledWith("r1");
    expect(runRule.mock.invocationCallOrder[0])
      .toBeLessThan(updateRule.mock.invocationCallOrder[0]);
    expect(deleteRule).not.toHaveBeenCalled();
  });

test("declining the preview writes nothing at all", async () => {
  card();
  fireEvent.click(sw());
  await findDialog();
  await cancelDialog();
  await expectNoDialog();
  untouched();
});

test("cancel after Apply leaves an armed rule exactly as it was", async () => {
  card([rule()]);
  fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Older than" }),
    { key: "ArrowUp" });                                   // 31
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await findDialog();
  expect(purgePreview).toHaveBeenLastCalledWith("trash",
    { older_than_days: 31 }, 31);
  await cancelDialog();
  await expectNoDialog();
  untouched();                       // still armed at 30 days, nothing edited
  expect(sw().getAttribute("aria-checked")).toBe("true");
});

test("cancel on a report-only rule made on the Rules page leaves it untouched",
  async () => {
    card([rule({ mode: "report", report_runs: 0, name: "My own sweep",
      origin: "manual", older_than_days: 45 })]);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Not active yet/)).toBeTruthy();
    fireEvent.click(sw());
    await findDialog();
    await cancelDialog();
    await expectNoDialog();
    untouched();
  });

test("the preview names what protected senders and pinned mails keep, and why nothing is due",
  async () => {
    purgePreview.mockResolvedValue(preview({ count: 0, size: 0,
      skipped_protected: 2, skipped_pinned: 1 }));
    card();
    fireEvent.click(sw());
    const dlg = await findDialog();
    expect(within(dlg).getByText("Right now there is nothing to delete"))
      .toBeTruthy();
    expect(within(dlg).getByText(
      "Mails count once they have been in Trash for 30 days.")).toBeTruthy();
    expect(within(dlg).getByText("2 mails from protected senders are skipped"))
      .toBeTruthy();
    expect(within(dlg).getByText("1 protected mail is skipped")).toBeTruthy();
    await cancelDialog();
  });

test("a refused report run (ambiguous folder ...) shows the error, the new rule is removed, nothing armed",
  async () => {
    runRule.mockRejectedValue(new Error("Trash is ambiguous"));
    card();
    fireEvent.click(sw());
    await findDialog();
    await pressDialog("Turn on");
    expect(await screen.findByText(/Trash is ambiguous/)).toBeTruthy();
    expect(deleteRule).toHaveBeenCalledWith("r1");
    expect(updateRule).not.toHaveBeenCalled();
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

test("a refused preview shows the error and writes nothing", async () => {
  purgePreview.mockRejectedValue(new Error("Trash is ambiguous"));
  card();
  fireEvent.click(sw());
  expect(await screen.findByText(/Trash is ambiguous/)).toBeTruthy();
  untouched();
});

test("switching account while the preview loads arms nothing in the other account",
  async () => {
    let release!: (v: unknown) => void;
    purgePreview.mockReturnValue(new Promise((r) => { release = r; }));
    card();
    fireEvent.click(sw());
    await waitFor(() => expect(purgePreview).toHaveBeenCalled());
    noteAccountSwitch();                         // the user picks another account
    release(preview());
    await new Promise((r) => setTimeout(r, 30));
    await expectNoDialog();                      // A's count is never shown for B
    untouched();
  });

test("switching account while the confirm is open: confirming writes nothing",
  async () => {
    card();
    fireEvent.click(sw());
    await findDialog();
    noteAccountSwitch();
    await pressDialog("Turn on");
    await new Promise((r) => setTimeout(r, 30));
    untouched();
  });

test("a refused report run puts an edited armed rule back to the age it had",
  async () => {
    runRule.mockRejectedValue(new Error("A rule is running right now"));
    card([rule()]);                                          // armed, 30 days
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Older than" }),
      { key: "ArrowUp" });                                   // 31
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await findDialog();
    await pressDialog("Turn on");
    expect(await screen.findByText(/A rule is running right now/))
      .toBeTruthy();
    expect(updateRule).toHaveBeenNthCalledWith(1, "r1", { older_than_days: 31 });
    expect(updateRule).toHaveBeenLastCalledWith("r1", { older_than_days: 30 });
    expect(updateRule).not.toHaveBeenCalledWith("r1", { mode: "execute" });
    expect(deleteRule).not.toHaveBeenCalled();   // it is not ours to remove
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
    const dlg = await findDialog();
    expect(purgePreview).toHaveBeenCalledWith("trash",
      { older_than_days: 28 }, 28);
    expect(within(dlg).getByText(/more than 28 days ago/)).toBeTruthy();
    await pressDialog("Turn on");
    await waitFor(() => expect(createRule).toHaveBeenCalledWith(
      expect.objectContaining({ older_than_days: 28 })));
  });

test("an existing matching rule reads as on, with the live next-run numbers",
  async () => {
    purgePreview.mockResolvedValue(preview({ count: 4, size: 900 }));
    card([rule()]);
    expect(sw().getAttribute("aria-checked")).toBe("true");
    // the same selection the rule's report counts: old enough AND long enough here
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("trash",
      { older_than_days: 30 }, 30));
    expect(await screen.findByText("Next run: 4 mails · 900 B")).toBeTruthy();
    untouched();
  });

test("nothing due yet says why", async () => {
  purgePreview.mockResolvedValue(preview({ count: 0, size: 0 }));
  card([rule()]);
  expect(await screen.findByText(
    "Next run: nothing to delete yet. Mails count once they have been in "
    + "Trash for 30 days.")).toBeTruthy();
});

test("the last run is reported, an error of it stays visible", async () => {
  card([rule({ last_run: report({ mode: "execute", acted: 3 }) })]);
  expect(await screen.findByText("Last run: 3 mails deleted")).toBeTruthy();
  cleanup();
  card([rule({ last_run: report({ mode: "execute", error: "Trash changed" }) })]);
  expect(await screen.findByText("Trash changed")).toBeTruthy();
});

test("turning on a report-only rule previews first, then reports and arms it",
  async () => {
    card([rule({ mode: "report", report_runs: 0 })]);
    fireEvent.click(sw());
    await findDialog();
    untouched();
    await pressDialog("Turn on");
    await waitFor(() => expect(updateRule).toHaveBeenCalledWith("r1",
      { mode: "execute" }));
    expect(createRule).not.toHaveBeenCalled();       // the rule exists already
    expect(runRule).toHaveBeenCalledWith("r1");
  });

test("off removes a rule this switch made", async () => {
  card([rule()]);
  fireEvent.click(sw());
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("r1"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(onChanged).toHaveBeenCalled();
});

test("off only disarms a rule made elsewhere - even one with the switch's own name",
  async () => {
    card([rule({ origin: "manual" })]);          // same name, made by hand
    fireEvent.click(sw());
    await waitFor(() => expect(updateRule).toHaveBeenCalledWith("r1",
      { mode: "report" }));
    expect(deleteRule).not.toHaveBeenCalled();
    expect(await screen.findByText(
      "Automatic emptying is off - the rule stays in Rules, report only"))
      .toBeTruthy();
  });

test("a switch rule the user renamed is still recognised by its marker",
  async () => {
    card([rule({ name: "My nightly sweep" })]);   // origin auto_empty
    fireEvent.click(sw());
    await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("r1"));
    expect(updateRule).not.toHaveBeenCalled();
  });

test("after Off the age goes back to the default", async () => {
  card([rule({ older_than_days: 90 })]);
  const days = screen.getByRole("spinbutton", { name: "Older than" });
  expect(days.getAttribute("aria-valuenow")).toBe("90");
  fireEvent.click(sw());
  await waitFor(() => expect(deleteRule).toHaveBeenCalled());
  await waitFor(() => expect(
    screen.getByRole("spinbutton", { name: "Older than" })
      .getAttribute("aria-valuenow")).toBe("30"));
});

test("a changed age on an armed rule needs Apply; only the confirm edits, reports and arms again",
  async () => {
    card([rule()]);
    const days = screen.getByRole("spinbutton", { name: "Older than" });
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.keyDown(days, { key: "ArrowUp" });             // 31
    untouched();                                             // only a draft
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await findDialog();
    untouched();                                             // preview only
    await pressDialog("Turn on");
    await waitFor(() => expect(updateRule).toHaveBeenLastCalledWith("r1",
      { mode: "execute" }));
    expect(updateRule).toHaveBeenNthCalledWith(1, "r1", { older_than_days: 31 });
    expect(runRule).toHaveBeenCalledWith("r1");
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
