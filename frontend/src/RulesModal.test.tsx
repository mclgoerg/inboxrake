// @vitest-environment jsdom
/* Retention fields (keep_latest / older_than_days) on saved rules. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider, PageSlot } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import { EN } from "./locales/en";
import type { AppState, Rule } from "./types";

const createRule = vi.fn().mockResolvedValue({});
const updateRule = vi.fn().mockResolvedValue({});
const deleteRule = vi.fn().mockResolvedValue({});
const runRule = vi.fn().mockResolvedValue({});
const listRules = vi.fn().mockResolvedValue({ rules: [], cap: 37 });

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { createRule: (body: unknown) => createRule(body),
         updateRule: (id: string, body: unknown) => updateRule(id, body),
         deleteRule: (id: string) => deleteRule(id),
         runRule: (id: string) => runRule(id),
         rules: () => listRules() },
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

const rule: Rule = {
  id: "abc1", name: "Old shop mail", scope: "mail", grouping: "sender", query: "",
  action: "trash", dest: "", schedule: "manual", mode: "report",
  keep_latest: null, older_than_days: 30, origin: "manual", report_runs: 1,
  created: 0, last_run: null,
};


// New / Edit rule is a side panel (a sheet here): its fields are pop-ups.
const openNew = () =>
  fireEvent.click(screen.getByRole("button", { name: /New rule|Neue Regel/ }));
const renderNew = () => {
  const r = render(<RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} />);
  openNew();
  return r;
};
const popup = (field: string) => screen.getByRole("button",
  { name: new RegExp(`^${field}( |$)`) });
const choose = (field: string, option: string) => {
  fireEvent.click(popup(field));
  fireEvent.click(screen.getByRole("menuitemradio", { name: option }));
};
const SCOPE = { mail: "Inbox & folders", junk: "Junk", trash: "Trash" };
const pickScope = (value: keyof typeof SCOPE) =>
  choose("Applies to", SCOPE[value]);
const tab = (name: string) => screen.getByRole("tab", { name });
const clickDelete = () => {
  fireEvent.click(screen.getByRole("button", { name: /^More: / }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
};

afterEach(() => {
  cleanup();
  createRule.mockClear();
  updateRule.mockClear();
  deleteRule.mockClear();
  runRule.mockClear();
  listRules.mockClear();
  setLang("en");
});

test("creating a rule with keep-latest sends the field, leaves the other " +
  "null", () => {
  renderNew();
  fireEvent.change(screen.getByLabelText("Name"),
    { target: { value: "My rule" } });
  choose("Apply to", "Keep newest N, act on the rest");
  fireEvent.change(screen.getByPlaceholderText("N"),
    { target: { value: "5" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).toHaveBeenCalledWith(expect.objectContaining(
    { keep_latest: 5, older_than_days: null }));
});

test("editing a rule prefills the retention selector and shows its tag",
  () => {
    render(<RulesModal state={{ ...baseState, rules: [rule] }}
      onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText("older than 30d")).toBeTruthy();
    fireEvent.click(screen.getByText("Edit"));
    expect(popup("Apply to").textContent)
      .toContain("Only mails older than N days");
    expect(screen.getByDisplayValue("30")).toBeTruthy();
  });

const grp = (key: string, count: number, pinned: number) => ({
  key, label: key, sub: "", count, size: 0, unread: 0, first: "2024-01-01",
  last: "2025-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned, engagement: 50,
});

test("the live match count leaves pinned mails out (mark_read excepted)",
  () => {
  const state = { ...baseState, groups: { ...baseState.groups,
    sender: { a: grp("a", 10, 3), b: grp("b", 5, 0) } } };
  render(<RulesModal state={state} onClose={() => {}}
    onChanged={() => {}} />);
  openNew();
  const preview = () => screen.getByText("Preview").parentElement!.textContent;
  expect(preview()).toMatch(/2groups12mails0protected skipped/);
  choose("Action", "Mark as read");
  expect(preview()).toMatch(/2groups15mails/);
});

test("a run summary names the protected mails it skipped", () => {
  const ran: Rule = { ...rule, last_run: {
    ts: 1, mode: "report", groups: 1, mails: 4, acted: 0, capped: 0,
    skipped_protected: 0, skipped_pinned: 3, preview: [], error: "" } };
  render(<RulesModal state={{ ...baseState, rules: [ran] }}
    onClose={() => {}} onChanged={() => {}} />);
  expect(screen.getByText(/3 protected mails skipped/)).toBeTruthy();
});

test("every field of the new-rule form has a label", () => {
  renderNew();
  for (const label of ["Name", "Filter"]) {
    expect(screen.getByLabelText(label)).toBeTruthy();
  }
  for (const label of ["Grouping", "Applies to", "Action", "Schedule",
    "Apply to"]) {
    expect(popup(label)).toBeTruthy();
  }
});

const renderCards = (rules: Rule[], onChanged = () => {}) =>
  render(<DialogProvider>
    <RulesModal state={{ ...baseState, rules }} onClose={() => {}}
      onChanged={onChanged} />
  </DialogProvider>);

test("a card: Run now, Edit, More (Delete inside), Report only / Active",
  () => {
  renderCards([rule]);
  const names = screen.getAllByRole("button")
    .map((b) => b.textContent?.trim() || b.getAttribute("aria-label"))
    .filter((x) => ["Run now", "Edit", "More: Old shop mail"].includes(x!));
  expect(names).toEqual(["Run now", "Edit", "More: Old shop mail"]);
  expect(tab("Report only").getAttribute("aria-selected")).toBe("true");
  expect(tab("Active").getAttribute("aria-selected")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /^More: / }));
  expect(screen.getByRole("menuitem", { name: "Delete" }).className)
    .toContain("text-danger-fg");
});

test("a card reads as a sentence", () => {
  renderCards([{ ...rule, query: "tag:shipping age:>1y", action: "move",
    dest: "Parcels", keep_latest: 3, older_than_days: null,
    schedule: "weekly" }]);
  const p = screen.getByText("When").closest("p")!;
  expect(p.textContent).toBe("WhenSendergroups matchtag:shipping age:>1y"
    + "thenMove to folder → Parcelskeep newest 3·weekly");
});

test("Delete asks first, then deletes the rule", async () => {
  const onChanged = vi.fn();
  renderCards([rule], onChanged);
  clickDelete();
  expect((await findDialog()).textContent).toContain("Old shop mail");
  expect(deleteRule).not.toHaveBeenCalled();
  await pressDialog("Delete");
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("abc1"));
  expect(onChanged).toHaveBeenCalled();
});

test("cancelling Delete keeps the rule", async () => {
  renderCards([rule]);
  clickDelete();
  await cancelDialog();
  await expectNoDialog();
  expect(deleteRule).not.toHaveBeenCalled();
});

test("Enable execute asks first, then switches the rule to execute",
  async () => {
  renderCards([rule]);
  fireEvent.click(tab("Active"));
  expect((await findDialog()).textContent).toContain("cap 500 per run");
  expect(updateRule).not.toHaveBeenCalled();
  await pressDialog("Enable execute");
  await waitFor(() => expect(updateRule)
    .toHaveBeenCalledWith("abc1", { mode: "execute" }));
});

test("cancelling Enable execute leaves the rule in report mode", async () => {
  renderCards([rule]);
  fireEvent.click(tab("Active"));
  await cancelDialog();
  await expectNoDialog();
  expect(updateRule).not.toHaveBeenCalled();
});

test("Run now on an execute-mode rule confirms; report mode runs directly",
  async () => {
  const exec: Rule = { ...rule, mode: "execute" };
  const { unmount } = renderCards([exec]);
  fireEvent.click(screen.getByText("Run now"));
  await cancelDialog();
  await expectNoDialog();
  expect(runRule).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Run now"));
  await pressDialog("Run now");
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("abc1"));
  unmount();
  runRule.mockClear();
  renderCards([rule]);
  fireEvent.click(screen.getByText("Run now"));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("abc1"));
});

// ------------------------------------------------ purge rules (Junk / Trash)

const purgeRule: Rule = {
  ...rule, id: "pg1", name: "Old junk", scope: "junk", action: "purge",
  schedule: "weekly", older_than_days: 30, report_runs: 1,
};

test("the Folder select offers Inbox & folders, Junk and Trash", () => {
  renderNew();
  expect(popup("Applies to").textContent).toContain("Inbox & folders");
  fireEvent.click(popup("Applies to"));
  expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent))
    .toEqual(["Inbox & folders", "Junk", "Trash"]);
  expect(screen.queryByText(/on the server, permanently/)).toBeNull();
});

test("choosing Junk fixes the action, shows the warning and offers the " +
  "defaults: older than 30 days, weekly", () => {
  renderNew();
  pickScope("junk");
  expect(screen.getByText(/Deletes mail on the server, permanently/))
    .toBeTruthy();
  // shown as a real warning (the red danger tone), not as a neutral note
  expect(screen.getByText(/Deletes mail on the server, permanently/)
    .closest('[role="status"]')!.className).toContain("bg-keep-bg");
  const action = popup("Action") as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  expect(action.textContent).toContain("Delete permanently");
  expect(screen.getByLabelText("In Trash/Junk for more than this many days"))
    .toHaveProperty("value", "30");
  expect(popup("Schedule").textContent).toContain("weekly");
  expect(screen.queryByRole("button", { name: /^Grouping/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Apply to/ })).toBeNull();
  // the filter stays the Input + the query builder
  expect(screen.getByLabelText("Filter")).toBeTruthy();
  expect(screen.getByRole("button", { name: /filter builder|Build/i })
    ).toBeTruthy();
  expect(screen.getByText("Create rule (report only)")).toBeTruthy();
});

test("a new purge rule is sent as purge on the chosen folder, 30 days " +
  "unless changed; the server forces report mode", () => {
  renderNew();
  pickScope("trash");
  fireEvent.change(screen.getByLabelText("Name"),
    { target: { value: "Weekly purge" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).toHaveBeenCalledWith(expect.objectContaining({
    name: "Weekly purge", scope: "trash", action: "purge",
    grouping: "sender", older_than_days: 30, keep_latest: null,
    schedule: "weekly", dest: "" }));
  expect(createRule.mock.calls[0][0]).not.toHaveProperty("mode");
});

test("a purge rule needs a whole number of days", () => {
  renderNew();
  pickScope("junk");
  fireEvent.change(screen.getByLabelText("Name"),
    { target: { value: "x" } });
  fireEvent.change(screen.getByLabelText("In Trash/Junk for more than this many days"),
    { target: { value: "0" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).not.toHaveBeenCalled();
  expect(screen.getByText(/whole number of days/)).toBeTruthy();
});

test("switching back to Inbox & folders restores an ordinary rule form", () => {
  renderNew();
  pickScope("junk");
  pickScope("mail");
  expect(screen.queryByText(/on the server, permanently/)).toBeNull();
  expect(popup("Action").textContent).toContain("Move to Trash");
  expect(popup("Schedule").textContent).toContain("manual");
  expect(popup("Apply to").textContent).toContain("All mails");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "m" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  expect(createRule).toHaveBeenCalledWith(expect.objectContaining(
    { scope: "mail", action: "trash", older_than_days: null }));
});

test("the query builder of a purge rule only offers sender conditions",
  () => {
  renderNew();
  pickScope("trash");
  fireEvent.click(screen.getByRole("button", { name: EN["qb.tip"] }));
  expect(screen.getByText(EN["qb.age_sender"])).toBeTruthy();
  expect(screen.getByText(EN["qb.unread"])).toBeTruthy();
  for (const k of ["qb.tag", "qb.ai", "qb.att", "qb.flags"]) {
    expect(screen.queryByText(EN[k]), k).toBeNull();
  }
  expect(screen.queryByText(EN["qb.is_protected"])).toBeNull();
});

test("a purge rule card shows folder, action, mode and a sender-level " +
  "preview", () => {
  const ran: Rule = { ...purgeRule, last_run: {
    ts: 1, mode: "report", groups: 2, mails: 5, acted: 0, capped: 0,
    skipped_protected: 1, skipped_pinned: 2, error: "", preview: [
      { key: "a@gone.example", label: "Anna", count: 3 },
      { key: "b@gone.example", label: "b@gone.example", count: 2 }] } };
  renderCards([ran]);
  const tags = [...document.querySelectorAll("span")].map((e) => e.textContent);
  expect(tags).toContain("Junk");           // the folder tag (not the option)
  expect(screen.getByText("Delete permanently")).toBeTruthy();
  expect(tab("Report only").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText(/5 mails would be deleted permanently · senders: 2/))
    .toBeTruthy();
  expect(screen.getByText(/Anna \(3\) · b@gone.example \(2\)/)).toBeTruthy();
  expect(screen.getByText(/2 protected mails skipped/)).toBeTruthy();
  expect(screen.getByText(/1 protected skipped/)).toBeTruthy();
});

test("in report mode Run report is the primary button", async () => {
  renderCards([purgeRule]);
  const btn = screen.getByText("Run report");
  expect(btn.className).toContain("bg-accent");
  fireEvent.click(btn);
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("pg1"));
});

test("Enable execute on a purge rule opens a danger dialog with the " +
  "permanent wording and only then switches", async () => {
  renderCards([purgeRule]);
  fireEvent.click(tab("Active"));
  const dlg = (await findDialog()).textContent ?? "";
  expect(dlg).toContain("permanently");
  expect(dlg).toContain("on the server");
  expect(dlg).toContain("up to 37 mails per run");       // from the API
  expect(dlg).not.toContain("500");
  expect(dlg).toContain("Protected senders and protected mails are never touched");
  expect(dlg).toContain("switch back to report mode");
  expect(updateRule).not.toHaveBeenCalled();
  await pressDialog("Delete permanently (up to 37)");
  await waitFor(() => expect(updateRule)
    .toHaveBeenCalledWith("pg1", { mode: "execute" }));
});

test("cancelling the purge confirm leaves the rule in report mode",
  async () => {
  renderCards([purgeRule]);
  fireEvent.click(tab("Active"));
  await cancelDialog();
  await expectNoDialog();
  expect(updateRule).not.toHaveBeenCalled();
});

test("a purge rule without a report run cannot be switched to execute",
  () => {
  renderCards([{ ...purgeRule, report_runs: 0 }]);
  expect(tab("Active").hasAttribute("disabled")).toBe(true);
  // and says why, in plain text (not only a tooltip)
  expect(screen.getByText("Run at least one report first")).toBeTruthy();
});

test("Run on an execute-mode purge rule confirms with the permanent wording",
  async () => {
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Run now"));
  const dlg = (await findDialog()).textContent ?? "";
  expect(dlg).toContain("permanently, on the server");
  expect(dlg).toContain("up to 37 mails per run");
  expect(dlg).toContain("Protected senders and protected mails are never touched");
  expect(dlg).toContain("switch the rule back to report mode");
  expect(runRule).not.toHaveBeenCalled();
  await pressDialog("Delete permanently (up to 37)");
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("pg1"));
});

test("going back to report mode needs no confirmation", async () => {
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(tab("Report only"));
  await waitFor(() => expect(updateRule)
    .toHaveBeenCalledWith("pg1", { mode: "report" }));
});

test("editing an execute-mode purge rule says it goes back to report mode",
  () => {
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Edit"));
  expect(screen.getByText(/switches this rule back to report mode/))
    .toBeTruthy();
  expect(popup("Applies to").textContent).toContain("Junk");
  expect(screen.getByLabelText("In Trash/Junk for more than this many days"))
    .toHaveProperty("value", "30");
  fireEvent.click(screen.getByText("Save"));
  expect(updateRule).toHaveBeenCalledWith("pg1", expect.objectContaining(
    { scope: "junk", action: "purge", older_than_days: 30 }));
});

test("a purge run's unverified mails are named", () => {
  renderCards([{ ...purgeRule, last_run: {
    ts: 1, mode: "execute", groups: 1, mails: 2, acted: 1, capped: 0,
    skipped_protected: 0, skipped_pinned: 0, preview: [], error: "",
    unverified: 1 } }]);
  expect(screen.getByText(/1 mail moved to Trash but not deleted/))
    .toBeTruthy();
  expect(screen.getByText(/executed: 1 mail deleted permanently/))
    .toBeTruthy();
});

test("German: folder select, warning, defaults and the confirm", async () => {
  setLang("de");
  renderCards([purgeRule]);
  expect(screen.getByText("Endgültig löschen")).toBeTruthy();
  fireEvent.click(screen.getByText("Bearbeiten"));
  expect(popup("Gilt für")).toBeTruthy();
  choose("Gilt für", "Papierkorb");
  expect(screen.getByText(/Löscht Mails auf dem Server, endgültig/))
    .toBeTruthy();
  expect(screen.getByLabelText("Mehr als so viele Tage in Papierkorb/Spam"))
    .toHaveProperty("value", "30");
  expect((popup("Aktion") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(tab("Aktiv"));
  const dlg = (await findDialog()).textContent ?? "";
  expect(dlg).toContain("endgültig");
  expect(dlg).toContain("auf dem Server");
  expect(dlg).toContain("bis zu 37 Mails pro Lauf");
  expect(dlg).toContain("Geschützte Absender und geschützte Mails werden nie");
  expect(dlg).toContain("Berichtsmodus");
  expect(screen.getByRole("button", { name: "Endgültig löschen (bis zu 37)" }))
    .toBeTruthy();
});

test("every purge-rule string exists in English and German with _one forms",
  async () => {
  const { EN } = await import("./locales/en");
  const { DE } = await import("./locales/de");
  const keys = Object.keys(EN).filter((k) => /^rule\.purge_|^rule\.reset_|^action\.purge$|^qb\.age_sender$|^rule\.(f_scope|scope_mail|run_report_btn)$/
    .test(k));
  expect(keys.length).toBeGreaterThan(10);
  for (const k of keys) expect(DE[k], k).toBeTruthy();
  for (const base of ["rule.purge_run_report", "rule.purge_run_exec",
    "rule.purge_unverified", "rule.purge_run_body", "rule.purge_enable_body"]) {
    expect(EN[`${base}_one`], base).toBeTruthy();
    expect(DE[`${base}_one`], base).toBeTruthy();
  }
});

const tonedConfirm = async () => {
  const dlg = await findDialog();
  const buttons = [...dlg.querySelectorAll("button")];
  const ok = buttons.at(-1)!;
  return { ok, cancel: buttons.find((b) => b.textContent === "Cancel")! };
};

test("both purge confirms are danger dialogs: Cancel focused, red confirm " +
  "button 'Delete permanently (up to N)'", async () => {
  const { unmount } = renderCards([purgeRule]);
  fireEvent.click(tab("Active"));
  let { ok, cancel } = await tonedConfirm();
  expect(ok.className).toContain("bg-danger");
  expect(document.activeElement).toBe(cancel);
  expect(ok.textContent).toBe("Delete permanently (up to 37)");
  await cancelDialog();
  unmount();
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Run now"));
  ({ ok, cancel } = await tonedConfirm());
  expect(ok.className).toContain("bg-danger");
  expect(document.activeElement).toBe(cancel);
  expect(ok.textContent).toBe("Delete permanently (up to 37)");
  await cancelDialog();
});

test("an empty filter says ALL senders in the editor help, the card, the " +
  "report preview and both confirms", async () => {
  const ran = { ...purgeRule, query: "", last_run: {
    ts: 1, mode: "report" as const, groups: 2, mails: 3, acted: 0, capped: 0,
    skipped_protected: 0, skipped_pinned: 0, preview: [], error: "" } };
  const { unmount } = renderCards([ran]);
  expect(screen.getAllByText(/all senders/).length).toBeGreaterThanOrEqual(2);
  fireEvent.click(tab("Active"));
  expect((await findDialog()).textContent)
    .toContain("The filter is empty: this applies to ALL senders in the Junk folder.");
  await cancelDialog();
  unmount();
  renderCards([{ ...ran, mode: "execute" }]);
  fireEvent.click(screen.getByText("Run now"));
  expect((await findDialog()).textContent)
    .toContain("applies to ALL senders in the Junk folder");
  await cancelDialog();
  cleanup();
  renderNew();
  pickScope("trash");
  expect(screen.getByText(/An empty filter means ALL senders/)).toBeTruthy();
  for (const fam of ["tag:", "ai:", "eng:", "att:", "is:", "has:", "domain:"]) {
    expect(screen.getByText(new RegExp(fam)), fam).toBeTruthy();
  }
});

test("a filter with text does not claim ALL senders", async () => {
  renderCards([{ ...purgeRule, query: "from:a@gone.example" }]);
  expect(screen.queryByText(/all senders/)).toBeNull();
  fireEvent.click(tab("Active"));
  expect((await findDialog()).textContent).not.toContain("ALL senders");
  await cancelDialog();
});

test("German: empty filter says alle Absender in both confirms", async () => {
  setLang("de");
  renderCards([{ ...purgeRule, query: "" }]);
  expect(screen.getByText("alle Absender")).toBeTruthy();
  fireEvent.click(tab("Aktiv"));
  expect((await findDialog()).textContent)
    .toContain("gilt für ALLE Absender im Ordner Spam");
  await pressDialog("Abbrechen");
});

test("the preview line has no plural trap for one mail or one sender", () => {
  renderCards([{ ...purgeRule, last_run: {
    ts: 1, mode: "report", groups: 1, mails: 1, acted: 0, capped: 0,
    skipped_protected: 0, skipped_pinned: 0, preview: [], error: "" } }]);
  expect(screen.getByText(/1 mail would be deleted permanently · senders: 1/))
    .toBeTruthy();
  expect(document.body.textContent).not.toMatch(/1 senders/);
});

test("the folder select is labelled apart from the Move destination", () => {
  renderNew();
  expect(popup("Applies to")).toBeTruthy();
  choose("Action", "Move to folder");
  expect(popup("Folder")).toBeTruthy();    // the target
  expect(popup("Applies to")).toBeTruthy();
  setLang("de");
  cleanup();
  renderNew();
  fireEvent.click(popup("Gilt für"));
  expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent))
    .toEqual(["Posteingang & Ordner", "Spam", "Papierkorb"]);
});

test("the query builder of a purge rule says the age is the sender's " +
  "newest mail", () => {
  renderNew();
  pickScope("junk");
  fireEvent.click(screen.getByRole("button", { name: EN["qb.tip"] }));
  expect(screen.getByText("Sender's newest mail older than")).toBeTruthy();
  expect(screen.queryByText("Older than")).toBeNull();
});

test("a card says why an armed rule went back to report mode", () => {
  for (const why of ["edited", "account", "folder"] as const) {
    const { unmount } = renderCards([{ ...purgeRule, reset_reason: why }]);
    expect(screen.getByText(new RegExp("Back in report mode"))).toBeTruthy();
    expect(document.body.textContent).toContain(EN[`rule.reset_${why}`]);
    unmount();
  }
  renderCards([{ ...purgeRule, reset_reason: "" }]);
  expect(screen.queryByText(/Back in report mode:/)).toBeNull();
});

test("a refused save is shown in the modal", async () => {
  createRule.mockRejectedValueOnce(new Error(
    "filter not available for Junk and Trash rules: tag:"));
  renderNew();
  pickScope("junk");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
  fireEvent.change(screen.getByLabelText("Filter"),
    { target: { value: "tag:shipping" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  await waitFor(() => expect(screen.getByText(/filter not available for Junk/))
    .toBeTruthy());
});

test("a refused run (ambiguous folder) is shown in the modal", async () => {
  runRule.mockRejectedValueOnce(new Error(
    "Trash is ambiguous - choose it in Settings first"));
  renderCards([purgeRule]);
  fireEvent.click(screen.getByText("Run report"));
  await waitFor(() => expect(screen.getByText(/ambiguous - choose it/))
    .toBeTruthy());
});

test("if the cap cannot be read no destructive confirm opens", async () => {
  listRules.mockRejectedValue(new Error("offline"));
  renderCards([purgeRule]);
  fireEvent.click(tab("Active"));
  await waitFor(() => expect(screen.getByText(/offline/)).toBeTruthy());
  expect(screen.queryAllByRole("dialog")
    .filter((d) => d.hasAttribute("aria-labelledby"))).toHaveLength(0);
  expect(updateRule).not.toHaveBeenCalled();
  listRules.mockResolvedValue({ rules: [], cap: 37 });
});

test("German: the run confirm of an execute-mode rule has the full " +
  "wording", async () => {
  setLang("de");
  renderCards([{ ...purgeRule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Jetzt ausführen"));
  const dlg = (await findDialog()).textContent ?? "";
  expect(dlg).toContain("endgültig auf dem Server, bis zu 37 Mails pro Lauf");
  expect(dlg).toContain("Geschützte Absender und geschützte Mails werden nie "
    + "angefasst");
  expect(dlg).toContain("zurück in den Berichtsmodus");
  expect(screen.getByRole("button", { name: "Endgültig löschen (bis zu 37)" }))
    .toBeTruthy();
  await pressDialog("Abbrechen");
});

test("German: the editor help says an empty filter means ALL senders and " +
  "lists the refused filters", () => {
  setLang("de");
  renderNew();
  choose("Gilt für", "Spam");
  const help = screen.getByText(/Ein leerer Filter bedeutet ALLE Absender/);
  for (const fam of ["tag:", "ai:", "eng:", "att:", "is:", "has:", "domain:"]) {
    expect(help.textContent, fam).toContain(fam);
  }
});

// ---------------------------------------- errors in the interface language

const failedRun = (error: string): Rule => ({ ...purgeRule, last_run: {
  ts: 1, mode: "execute", groups: 0, mails: 0, acted: 0, capped: 0,
  skipped_protected: 0, skipped_pinned: 0, preview: [], error } });

test("a purge rule's failed run is worded in the interface language", () => {
  renderCards([failedRun("role_unconfirmed:role=trash")]);
  expect(screen.getByText(
    "More than one folder could be “Trash” - choose the right one in "
    + "Settings first."))
    .toBeTruthy();
  expect(screen.queryByText(/role_unconfirmed|RuntimeError/)).toBeNull();
  cleanup();
  setLang("de");
  renderCards([failedRun("role_unconfirmed:role=trash")]);
  expect(screen.getByText("Für „Papierkorb“ kommen mehrere Ordner infrage – "
    + "wähle zuerst in den Einstellungen den richtigen.")).toBeTruthy();
});

test("a failed run keeps its numbers and its singular / plural form", () => {
  renderCards([failedRun(
    "deleted_then_failed:n=1,cause=folder_changed%3Arole%3Djunk")]);
  expect(screen.getByText("The “Junk” folder changed on the server - reload "
    + "the list and try again. (1 mail was permanently deleted before the failure)"))
    .toBeTruthy();
  cleanup();
  setLang("de");
  renderCards([failedRun(
    "deleted_then_failed:n=7,cause=folder_changed%3Arole%3Djunk")]);
  expect(screen.getByText("Der Ordner „Spam“ hat sich auf dem Server "
    + "geändert – lade die Liste neu und versuche es erneut. (7 Mails wurden vor dem Fehler "
    + "endgültig gelöscht)")).toBeTruthy();
});

test("an error that is not a code (an older run, a raw failure) stays as is",
  () => {
    setLang("de");
    renderCards([failedRun("RuntimeError: Trash is ambiguous - choose it in "
      + "Settings first")]);
    expect(screen.getByText("RuntimeError: Trash is ambiguous - choose it in "
      + "Settings first")).toBeTruthy();
  });

test("the editor of an armed mail rule shows the reset note", () => {
  renderCards([{ ...rule, mode: "execute" }]);
  fireEvent.click(screen.getByText("Edit"));
  expect(document.body.textContent).toContain(EN["rule.edit_reset"]);
});

test("a card says why an edited mail rule went back to report mode", () => {
  renderCards([{ ...rule, mode: "report", reset_reason: "edited" }]);
  expect(document.body.textContent).toContain(EN["rule.reset_edited"]);
});

test("the editor is closed until New rule / Edit; Cancel and Close shut it",
  () => {
  renderCards([rule]);
  expect(screen.queryByLabelText("Name")).toBeNull();
  openNew();
  expect(screen.getByLabelText("Name")).toBeTruthy();
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.queryByLabelText("Name")).toBeNull();
  fireEvent.click(screen.getByText("Edit"));
  expect(screen.getByText("Edit rule")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  expect(screen.queryByLabelText("Name")).toBeNull();
});

test("a filter handed in (the AI's) opens the editor with it", () => {
  render(<RulesModal state={baseState} initialQuery="tag:shipping"
    onClose={() => {}} onChanged={() => {}} />);
  expect(screen.getByLabelText("Filter")).toHaveProperty("value", "tag:shipping");
});

test("on a page the editor is a side panel, not a dialog; Esc closes it",
  () => {
  render(<PageSlot page><RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} /></PageSlot>);
  openNew();
  const aside = screen.getByRole("complementary");
  expect(aside.querySelector('[role="dialog"]')).toBeNull();
  expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
});

test("the preview names protected skips and example senders", () => {
  const state = { ...baseState, groups: { ...baseState.groups, sender: {
    a: grp("Anna Shop", 10, 0), b: grp("Bob Post", 5, 0),
    c: { ...grp("Cleo", 4, 0), protected: true } } } };
  render(<RulesModal state={state} onClose={() => {}} onChanged={() => {}} />);
  openNew();
  expect(screen.getByText("Preview").parentElement!.textContent)
    .toMatch(/2groups15mails1protected skipped/);
  expect(screen.getByText("Anna Shop")).toBeTruthy();
  expect(screen.queryByText("Cleo")).toBeNull();
});

test("a new rule says it starts in report mode (the server always does)",
  () => {
  renderNew();
  expect(screen.getByText("Starts in report mode")).toBeTruthy();
});
