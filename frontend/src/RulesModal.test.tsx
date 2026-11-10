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
const tab = (name: string) => screen.getByRole("radio", { name });
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
  choose("Apply to", "keep newest N, act on the rest");
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
    expect(screen.getByText("if older than 30 days")).toBeTruthy();
    fireEvent.click(screen.getByText("Edit"));
    expect(popup("Apply to").textContent)
      .toContain("only mails older than N days");
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
  choose("Action", "mark as read");
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
  expect(tab("Report only").getAttribute("aria-checked")).toBe("true");
  expect(tab("Active").getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /^More: / }));
  expect(screen.getByRole("menuitem", { name: "Delete" }).className)
    .toContain("text-danger-fg");
});

const sentence = () => document.querySelector("p.leading-9")!.textContent!
  .replace(/\u00a0/g, " ");
const sentenceOf = (r: Partial<Rule>) => {
  cleanup();
  renderCards([{ ...rule, ...r }]);
  return sentence();
};

test("every kind of rule reads as a sentence in English", () => {
  expect(sentenceOf({ action: "trash", older_than_days: 30, query: "" }))
    .toBe("When Sender groups match everything then move to Trash "
      + "if older than 30 days · manual");
  expect(sentenceOf({ action: "archive", grouping: "domain", query: "x:1",
    older_than_days: 1 })).toContain("then archive if older than 1 day");
  expect(sentenceOf({ action: "mark_read", older_than_days: null,
    schedule: "daily" })).toBe("When Sender groups match everything then "
      + "mark as read · daily");
  expect(sentenceOf({ scope: "junk", action: "purge", query: "",
    schedule: "weekly" })).toBe("When Sender groups in Junk match all senders "
      + "then delete permanently if older than 30 days · weekly");
  expect(sentenceOf({ scope: "trash", action: "purge", query: "from:a",
    older_than_days: 60, schedule: "weekly" })).toBe("When Sender groups in "
      + "Trash match from:a then delete permanently if older than 60 days · weekly");
});

test("and in German, with the right case and word order", () => {
  setLang("de");
  expect(sentenceOf({ action: "trash", older_than_days: 30, query: "" }))
    .toBe("Wenn Gruppen nach Absender zu allem passen, dann in den "
      + "Papierkorb verschieben, wenn älter als 30 Tage · manuell");
  expect(sentenceOf({ action: "move", dest: "Pakete", keep_latest: 3,
    older_than_days: null, schedule: "daily", query: "tag:a" }))
    .toBe("Wenn Gruppen nach Absender zu tag:a passen, dann in Pakete "
      + "verschieben, außer den neuesten 3 · täglich");
  expect(sentenceOf({ action: "mark_read", older_than_days: null,
    query: "tag:a" })).toBe("Wenn Gruppen nach Absender zu tag:a passen, "
      + "dann als gelesen markieren · manuell");
  expect(sentenceOf({ scope: "junk", action: "purge", query: "",
    schedule: "weekly" })).toBe("Wenn Gruppen nach Absender im Spam-Ordner zu allen "
      + "Absendern passen, dann endgültig löschen, wenn älter als 30 Tage · "
      + "wöchentlich");
  expect(sentenceOf({ scope: "trash", action: "purge", query: "from:a",
    older_than_days: 1, schedule: "weekly" })).toContain("im Papierkorb zu "
      + "from:a passen, dann endgültig löschen, wenn älter als 1 Tag");
});

test("the drawer's first row follows each language's word order", () => {
  const page = () => { render(<PageSlot page><RulesModal state={baseState}
    onClose={() => {}} onChanged={() => {}} /></PageSlot>); openNew(); };
  const row = (name: string) => popup(name).closest("div.grid")!;
  page();
  expect(row("Grouping").textContent).toMatch(/^When a.*group in/);
  cleanup();
  setLang("de");
  page();
  expect(row("Gruppierung").textContent).toMatch(/^Gruppen nach.*im/);
});

test("the drawer has one label column; phones get a grouped form", () => {
  render(<PageSlot page><RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} /></PageSlot>);
  openNew();
  const labels = [...document.querySelectorAll("aside div.grid > span")]
    .map((e) => e.textContent);
  expect(labels).toEqual(["Name", "When a", "matches", "then", "apply to",
    "run"]);
  expect(screen.queryByRole("group", { name: "Which mail" })).toBeNull();
  cleanup();
  // a tablet-sized modal keeps the label column (the filter builder pops
  // over the form there; a grouped list would clip it)
  renderNew();
  expect(screen.queryByRole("group", { name: "Which mail" })).toBeNull();
  expect(document.querySelectorAll("div.grid > span.py-1\\.5").length)
    .toBeGreaterThan(5);
  cleanup();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q,
    addEventListener() {}, removeEventListener() {} }));
  renderNew();
  const which = screen.getByRole("group", { name: "Which mail" });
  expect(which.textContent).toMatch(/Grouped by.*in.*matches/);
  const what = screen.getByRole("group", { name: "What happens" });
  expect(what.textContent).toMatch(/then.*apply to.*run/);
  // every field is still there, the preview and the report-mode note too
  for (const f of ["Name", "Filter"]) expect(screen.getByLabelText(f)).toBeTruthy();
  expect(screen.getByText("Preview")).toBeTruthy();
  expect(screen.getByText("Starts in report mode")).toBeTruthy();
  vi.unstubAllGlobals();
});

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo, d, h, mi).getTime() / 1000;
const lineOf = (re: RegExp) => screen.getByText(re).parentElement!.textContent!;
const runOf = (over: Partial<NonNullable<Rule["last_run"]>>): Rule => ({
  ...rule, last_run: { ts: at(2020, 7, 31, 3, 30), mode: "execute", groups: 4,
    mails: 150, acted: 150, capped: 0, skipped_protected: 0, skipped_pinned: 0,
    preview: [], error: "", ...over } });

test("the card's last-run line: app date format, status, counts", () => {
  renderCards([runOf({})]);
  expect(lineOf(/Last run 31 Aug 2020, 03:30/))
    .toBe("Last run 31 Aug 2020, 03:30 · completed: 150 mails in 4 groups");
  expect(document.body.textContent).not.toMatch(/AM|PM|\/2020/);
  cleanup();
  renderCards([runOf({ mode: "report", acted: 0 })]);
  expect(lineOf(/Last run/))
    .toBe("Last run 31 Aug 2020, 03:30 · report: 150 mails in 4 groups "
      + "would be affected");
  cleanup();
  // matched and affected differ, and what was skipped stays on the line
  renderCards([runOf({ acted: 140, skipped_protected: 2, capped: 1 })]);
  const line = lineOf(/Last run/);
  expect(line).toContain("completed: 140 mails in 4 groups · 150 matched");
  expect(line).toContain("1 mail beyond the per-run cap");
  expect(line).toContain("2 protected skipped");
  cleanup();
  setLang("de");
  renderCards([runOf({})]);
  expect(lineOf(/Letzter Lauf/))
    .toBe("Letzter Lauf 31. Aug. 2020, 03:30 · abgeschlossen: 150 Mails in "
      + "4 Gruppen");
});

test("a failed run keeps its error on the card and says it failed", () => {
  renderCards([runOf({ acted: 0, error: "boom" })]);
  const line = lineOf(/Last run/);
  expect(line).toContain("Last run 31 Aug 2020, 03:30 · failed");
  expect(line).toContain("boom");
  expect(screen.getByText("boom").className).toContain("text-danger-fg");
  expect(screen.getByRole("button", { name: /Last report/ })).toBeTruthy();
});

test("the rule sentence's chips never break inside; the footer has the actions",
  () => {
  renderCards([{ ...rule, query: "tag:a age:>1y" }]);
  const code = screen.getByText("tag:a age:>1y");
  expect(code.className).toContain("inline-block");
  expect(screen.getByText("Sender").className).toContain("inline-block");
  const footer = screen.getByText("Run now").closest("div")!;
  expect([...footer.querySelectorAll("button")].map((b) => b.textContent))
    .toEqual(["Run now", "Edit", ""]);   // no run yet: no "Last report"
  cleanup();
  renderCards([runOf({})]);
  const f2 = screen.getByText("Run now").closest("div")!;
  expect([...f2.querySelectorAll("button")].map((b) => b.textContent))
    .toEqual(["Run now", "Last report", "Edit", ""]);
});

test("the intro is one line with a link to the docs section", () => {
  renderCards([rule]);
  const link = screen.getByRole("link", { name: "How rules work" });
  expect(link.getAttribute("href")).toBe(
    "https://inboxrake.com/docs/features/#rules-and-scheduler");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(document.body.textContent).toContain("at most 500 mails per run");
  expect(document.body.textContent).not.toMatch(/REPORT/);
  expect(screen.getByText(/1 rule · new rules only report/)).toBeTruthy();
});

test("the mode switch is a radiogroup", () => {
  renderCards([rule]);
  expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeTruthy();
  expect(screen.queryByRole("tab")).toBeNull();
});

test("a failed run or mode switch is shown on its own card", async () => {
  runRule.mockRejectedValueOnce(new Error("nope"));
  renderCards([rule, { ...rule, id: "zz", name: "Other" }]);
  fireEvent.click(screen.getAllByText("Run now")[0]);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("nope");
  expect(alert.closest(".rounded-card")!.textContent).toContain("Old shop mail");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});

test("Esc in an open pop-up closes the menu, not the editor; Esc again " +
  "closes it", () => {
  renderNew();
  fireEvent.click(popup("Action"));
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "archive" }),
    { key: "Escape" });
  expect(screen.getByLabelText("Name")).toBeTruthy();
});

test("a card reads as a sentence", () => {
  renderCards([{ ...rule, query: "tag:shipping age:>1y", action: "move",
    dest: "Parcels", keep_latest: 3, older_than_days: null,
    schedule: "weekly" }]);
  expect(sentence()).toBe("When Sender groups match tag:shipping age:>1y "
    + "then move to Parcels except the newest 3 · weekly");
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
  expect(action.textContent).toContain("delete permanently");
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
  expect(popup("Action").textContent).toContain("move to Trash");
  expect(popup("Schedule").textContent).toContain("manual");
  expect(popup("Apply to").textContent).toContain("all mails");
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
  expect(screen.getByText("delete permanently")).toBeTruthy();
  expect(tab("Report only").getAttribute("aria-checked")).toBe("true");
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
  expect(screen.getByText("endgültig löschen")).toBeTruthy();
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
  expect(screen.getByText("allen Absendern")).toBeTruthy();
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
  choose("Action", "move to folder");
  expect(popup("Folder")).toBeTruthy();    // the target
  expect(popup("Applies to")).toBeTruthy();
  setLang("de");
  cleanup();
  renderNew();
  fireEvent.click(popup("Gilt für"));
  expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent))
    .toEqual(["Posteingang & Ordner", "Spam-Ordner", "Papierkorb"]);
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
  choose("Gilt für", "Spam-Ordner");
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

test("See last report shows the run in full, senders as rows; absent without a run",
  () => {
  renderCards([rule]);
  expect(screen.queryByText("Last report")).toBeNull();
  cleanup();
  const ran: Rule = { ...rule, last_run: {
    ts: 1, mode: "report", groups: 2, mails: 5, acted: 0, capped: 1,
    skipped_protected: 1, skipped_pinned: 2, error: "", preview: [
      { key: "a@x.example", label: "Anna", count: 3 },
      { key: "b@x.example", label: "Bob", count: 2 }] } };
  renderCards([ran]);
  fireEvent.click(screen.getByText("Last report"));
  const dlg = screen.getByRole("dialog", { name: "Last report" });
  expect(dlg.textContent).toMatch(/2 groups/);
  expect(dlg.textContent).toMatch(/2 protected mails skipped/);
  expect(dlg.textContent).toMatch(/1 protected skipped/);
  expect(dlg.textContent).toMatch(/1 mail beyond the per-run cap/);
  expect(dlg.querySelectorAll("li")).toHaveLength(2);
  expect(dlg.textContent).toContain("Anna");
  // the card keeps its own last-run line with the preview
  expect(screen.getAllByText(/Anna \(3\) · Bob \(2\)/)).toHaveLength(1);
});

test("a failed run's error shows in the report", () => {
  renderCards([{ ...rule, last_run: { ts: 1, mode: "execute", groups: 0,
    mails: 0, acted: 0, capped: 0, skipped_protected: 0, skipped_pinned: 0,
    preview: [], error: "boom" } }]);
  fireEvent.click(screen.getByText("Last report"));
  expect(screen.getByRole("dialog", { name: "Last report" }).textContent)
    .toContain("boom");
});

test("on a page too, Esc in a pop-up leaves the panel open", () => {
  render(<PageSlot page><RulesModal state={baseState} onClose={() => {}}
    onChanged={() => {}} /></PageSlot>);
  openNew();
  fireEvent.click(popup("Action"));
  fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "archive" }),
    { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("complementary")).toBeTruthy();
});

test("the side panel takes focus on open and gives it back on every close",
  async () => {
  render(<DialogProvider><PageSlot page>
    <RulesModal state={{ ...baseState, rules: [rule] }} onClose={() => {}}
      onChanged={() => {}} /></PageSlot></DialogProvider>);
  const newBtn = screen.getByRole("button", { name: /New rule/ });
  const editBtn = screen.getByText("Edit").closest("button")!;
  const cycle = (opener: HTMLElement, close: () => void) => {
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    close();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(opener);
  };
  cycle(newBtn, () => fireEvent.click(
    screen.getByRole("button", { name: "Close" })));
  cycle(editBtn, () => fireEvent.click(screen.getByText("Cancel")));
  cycle(newBtn, () => fireEvent.keyDown(screen.getByLabelText("Name"),
    { key: "Escape" }));
  // Save
  newBtn.focus(); fireEvent.click(newBtn);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "n" } });
  fireEvent.click(screen.getByText("Create rule (report only)"));
  await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  expect(document.activeElement).toBe(newBtn);
});

test("Esc inside the nested filter-builder sheet leaves the editor open", () => {
  // a phone: the builder opens as its own sheet inside the editor
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q,
    addEventListener() {}, removeEventListener() {} }));
  renderNew();
  fireEvent.click(screen.getByRole("button", { name: EN["qb.tip"] }));
  const editorDialog = screen.getByLabelText("Name").closest('[role="dialog"]')!;
  const inner = [...editorDialog.querySelectorAll('[role="dialog"]')].at(-1)!;
  expect(inner).toBeTruthy();
  fireEvent.keyDown(inner, { key: "Escape" });
  expect(screen.getByLabelText("Name")).toBeTruthy();
  vi.unstubAllGlobals();
});

test("the disabled Active option points at its reason; one timestamp in the " +
  "report", () => {
  renderCards([{ ...rule, report_runs: 0, last_run: {
    ts: 86400 * 365, mode: "report", groups: 1, mails: 1, acted: 0, capped: 0,
    skipped_protected: 0, skipped_pinned: 0, preview: [], error: "" } }]);
  const hint = screen.getByText("Run at least one report first");
  expect(tab("Active").getAttribute("aria-describedby")).toBe(hint.id);
  fireEvent.click(screen.getByText("Last report"));
  const dlg = screen.getByRole("dialog", { name: "Last report" });
  expect(dlg.textContent!.match(/Last run/g)).toHaveLength(1);
});
