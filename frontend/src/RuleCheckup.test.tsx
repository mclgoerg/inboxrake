// @vitest-environment jsdom
/* The Rule checkup on the Rules page: the card with the findings (below the
 * proposals, above the rules), one row on phones that opens the same list,
 * the quiet "all fine" line, badges at the end of a rule's sentence, Compare,
 * Ignore, and the buttons that hand over to today's editor / confirm / lists.
 * The existing rule cards keep everything INVENTORY.md lists for them. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider, PageSlot } from "./components/ui";
import { expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState, CheckupFinding, Rule, RuleCheckup } from "./types";

/** Counts and their nouns are joined by a no-break space. */
const nb = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");

const deleteRule = vi.fn().mockResolvedValue({});
const ignoreFinding = vi.fn().mockResolvedValue({ ok: true });
let checkup: RuleCheckup | Error;
const ruleCheckup = vi.fn(() => checkup instanceof Error
  ? Promise.reject(checkup) : Promise.resolve(checkup));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { createRule: vi.fn(), updateRule: vi.fn(),
         deleteRule: (id: string) => deleteRule(id), runRule: vi.fn(),
         rules: () => Promise.resolve({ rules: [], cap: 500 }),
         ruleCheckup: () => ruleCheckup(),
         ignoreFinding: (id: string, on: boolean) => ignoreFinding(id, on) },
}));

const base: Rule = {
  id: "x", name: "", scope: "mail", grouping: "sender", query: "tag:news",
  action: "trash", dest: "", schedule: "manual", mode: "execute",
  keep_latest: null, older_than_days: null, origin: "manual", report_runs: 1,
  created: 1, last_run: { ts: 1_700_000_000, mode: "execute", groups: 4,
    mails: 150, acted: 150, capped: 0, skipped_protected: 0, skipped_pinned: 0,
    preview: [], error: "" } };
const SWEEP: Rule = { ...base, id: "r1", name: "Sweep old newsletters",
  query: "is:unsub age:>1y" };
const KEEP: Rule = { ...base, id: "r2", name: "Keep the latest 5 of every newsletter",
  query: "tag:newsletter", keep_latest: 5, schedule: "daily" };
const RECEIPTS: Rule = { ...base, id: "r3", name: "Receipts into their own folder",
  query: "tag:finance", action: "move", dest: "Receipts", schedule: "weekly" };
const TICKETS: Rule = { ...base, id: "r4", name: "Archive old event tickets",
  query: "tag:travel", action: "archive", schedule: "weekly" };
const RULES = [SWEEP, KEEP, RECEIPTS, TICKETS];

const OVERLAP: CheckupFinding = {
  id: "aaaaaaaaaaaaaaa1", kind: "overlap", rules: ["r1", "r2"],
  ignored: false, defeated: "r2", by: "r1", n: 15, keep_latest: 5,
  older_than_days: null, senders_total: 3,
  senders: [
    { addr: "a@old.example", label: "Old Forum", n: 5, last: 1_752_364_800 },
    { addr: "b@old.example", label: "Retro Weekly", n: 5, last: 1_740_873_600 },
    { addr: "c@old.example", label: "Garden Notes", n: 5, last: 1_756_512_000 }],
  compare: { unit: "senders", only_a: 1, both: 3, only_b: 6 } };
const DEST: CheckupFinding = {
  id: "aaaaaaaaaaaaaaa2", kind: "dest_missing", rules: ["r3"], ignored: false,
  folder: "Receipts", due: true };
const NEVER: CheckupFinding = {
  id: "aaaaaaaaaaaaaaa3", kind: "never_matches", rules: ["r4"], ignored: false,
  runs: 8, since: 1_759_300_000 };
const CONFLICT: CheckupFinding = {
  id: "aaaaaaaaaaaaaaa4", kind: "conflict", rules: ["r1", "r3"], ignored: false,
  first: "r1", n: 12, senders_total: 1,
  senders: [{ addr: "s@shop.example", label: "Shop", n: 12, last: 1_752_364_800 }],
  compare: { unit: "mails", only_a: 2, both: 12, only_b: 0 } };
const PURGE: CheckupFinding = {
  id: "aaaaaaaaaaaaaaa5", kind: "overlap", rules: ["r5", "r6"], ignored: false,
  purge: true, scope: "trash", defeated: "r5", by: "r6", n: 0, senders: [],
  senders_total: 0, older_than_days: 30, winner_days: 7, compare: null };

const result = (findings: CheckupFinding[], over: Partial<RuleCheckup> = {}):
  RuleCheckup => ({ account: "proton", scanned_ts: Date.now() / 1000 - 120,
  analysed: true, needs_scan: false, checked: 0, rules: 4, findings, ...over });

const state = (rules: Rule[]): AppState => ({
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 1,
  progress: "", error: "", folders: [],
  groups: { sender: {}, smart: {}, domain: {}, subject: {}, thread: {} },
  ai: { status: "idle", grouping: "sender", progress: "", error: "",
    usage: null },
  delete: { status: "idle", progress: "", error: "", moved: 0 },
  atts: { status: "idle", progress: "", error: "", mails: 0, size: 0 },
  unsub: { status: "idle", progress: "", error: "", total: 0, done: 0,
    links: 0, failed: 0, skipped: 0 },
  trash_count: 0, notice: null, undo: [], folders_raw: ["INBOX", "Archive"],
  rules, presets: [] } as unknown as AppState);

const onShowSenders = vi.fn();
const onShowMails = vi.fn();

const mount = (rules = RULES, props: Record<string, unknown> = {}) =>
  render(<DialogProvider><PageSlot page>
    <RulesModal state={state(rules)} onClose={() => {}} onChanged={() => {}}
      onShowSenders={onShowSenders} onShowMails={onShowMails} {...props} />
  </PageSlot></DialogProvider>);

const phone = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: true, media: q, addEventListener() {}, removeEventListener() {} }));

beforeEach(() => { checkup = result([OVERLAP, DEST, NEVER]); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setLang("en");
});

const card = () => screen.findByTestId("checkup-card");

test("the card sits below the proposals, above the rules, and names every finding", async () => {
  const proposal: Rule = { ...base, id: "p1", name: "Proposed sweep",
    origin: "mcp", mode: "report", proposed_by: { token_id: "t", name: "Bot",
      at: 1_700_000_000 } };
  mount([proposal, ...RULES]);
  const c = await card();
  expect(nb(c.textContent)).toContain("Rule checkup · 3 things to look at");
  expect(nb(c.textContent)).toContain("nothing is changed by itself");
  expect(nb(c.textContent)).toContain("checked after the scan 2m ago");
  // order on the page: proposal, checkup, first rule
  const html = document.body.innerHTML;
  const at = (s: string) => html.indexOf(s);
  expect(at("Proposed sweep")).toBeGreaterThan(0);
  expect(at("Proposed sweep")).toBeLessThan(at("Rule checkup ·"));
  expect(at("Rule checkup ·")).toBeLessThan(
    at("Sweep old newsletters</div>"));
  const text = nb(c.textContent);
  expect(text).toContain("Overlap");
  expect(text).toContain("Sweep old newsletters and Keep the latest 5 of every "
    + "newsletter both act on Old Forum, Retro Weekly and Garden Notes.");
  expect(text).toContain("(except the newest 5)");
  expect(text).toContain("Points nowhere");
  expect(text).toContain("Receipts into their own folder moves mail to "
    + "“Receipts”, which is no longer on the server (renamed or deleted?). "
    + "It is due today, and the run would fail.");
  expect(text).toContain("A changed target puts the rule back in Report only");
  expect(text).toContain("Never matches");
  expect(text).toContain("found nothing in its last 8 runs (since 1 Oct 2025)");
  // the checks that found nothing are named
  expect(text).toContain("Also checked, nothing found: conflicts (one rule "
    + "archives what another trashes), rules that only meet protected senders "
    + "or mails, report-only rules whose report is 30+ days old.");
});

test("a gone folder reads differently for a report-only rule and for one not due", async () => {
  checkup = result([{ ...DEST, due: false }]);
  mount();
  let c = await card();
  expect(nb(c.textContent)).toContain("(renamed or deleted?). Its next run "
    + "would fail.");
  cleanup();
  checkup = result([DEST]);
  mount(RULES.map((r) => r.id === "r3" ? { ...r, mode: "report" } : r));
  c = await card();
  expect(nb(c.textContent)).toContain("It is in Report only; once it is Active, "
    + "its run would fail.");
  expect(nb(c.textContent)).not.toContain("due today");
});

test("the buttons per kind: Edit, Delete, Compare, Show, Ignore", async () => {
  mount();
  const c = await card();
  const rowOf = (id: string) => c.querySelector(`[data-finding="${id}"]`)!;
  const btns = (id: string) => within(rowOf(id) as HTMLElement)
    .getAllByRole("button").map((b) => nb(b.textContent));
  expect(btns(OVERLAP.id)).toEqual(["Show the 3 senders", "Compare", "Ignore"]);
  expect(btns(DEST.id)).toEqual(["Edit…", "Ignore"]);
  expect(btns(NEVER.id)).toEqual(["Edit…", "Delete…", "Ignore"]);
});

test("a conflict shows the mails button and Compare; a purge overlap has no sender list", async () => {
  checkup = result([CONFLICT, PURGE]);
  mount([...RULES, { ...base, id: "r5", name: "Wait 30", scope: "trash",
    action: "purge", older_than_days: 30 },
  { ...base, id: "r6", name: "Wait 7", scope: "trash", action: "purge",
    older_than_days: 7 }]);
  const c = await card();
  const conflict = c.querySelector(`[data-finding="${CONFLICT.id}"]`)!;
  // as the board words it: "A archives 12 mails that B moves to Trash."
  expect(nb(conflict.textContent)).toContain("Sweep old newsletters moves 12 "
    + "mails to Trash that Receipts into their own folder moves to “Receipts”. "
    + "The one created first acts first.");
  expect(within(conflict as HTMLElement).getAllByRole("button")
    .map((b) => nb(b.textContent))).toEqual(["Show the 12 mails", "Compare", "Ignore"]);
  fireEvent.click(within(conflict as HTMLElement)
    .getByRole("button", { name: /^Show the 12\s+mails$/ }));
  expect(onShowMails).toHaveBeenCalledWith(CONFLICT.id, 12);
  const purge = c.querySelector(`[data-finding="${PURGE.id}"]`)! as HTMLElement;
  expect(nb(purge.textContent)).toContain("both delete permanently from this folder: "
    + "Trash. Wait 30 waits (if older than 30 days), but Wait 7 deletes "
    + "sooner (if older than 7 days)");
  expect(within(purge).getAllByRole("button").map((b) => nb(b.textContent)))
    .toEqual(["Compare", "Ignore"]);
});

test("Show the 3 senders hands the addresses to the Senders page", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /^Show the 3\s+senders$/ }));
  expect(onShowSenders).toHaveBeenCalledWith(
    ["a@old.example", "b@old.example", "c@old.example"]);
});

test("without a host for the lists the Show buttons are not offered", async () => {
  mount(RULES, { onShowSenders: undefined, onShowMails: undefined });
  const c = await card();
  expect(within(c).queryByRole("button", { name: /Show the/ })).toBeNull();
  expect(within(c).getByRole("button", { name: "Compare" })).toBeTruthy();
});

test("Compare: the bars, the senders in common, the note and an Edit per rule", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
  const dlg = await screen.findByRole("dialog", { name: "Compare" });
  const text = nb(dlg.textContent);
  expect(text).toContain("Two rules, the same 3 senders");
  expect(text).toContain("Sweep old newsletters · Keep the latest 5 of every newsletter");
  expect(text).toContain("Only Sweep old newsletters");
  expect(text).toContain("1 sender");
  expect(text).toContain("3 senders");
  expect(text).toContain("6 senders");
  expect(text).toContain("Old Forum");
  expect(text).toContain("5 left · last");
  expect(text).toContain("Rules run in the order you created them.");
  expect(text).toContain("narrow the filter of Sweep old newsletters");
  // each Edit… opens that rule in the editor and closes the sheet
  fireEvent.click(within(dlg).getByRole("button",
    { name: "Edit Keep the latest 5 of every newsletter…" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Compare" }))
    .toBeNull());
  expect((await screen.findByLabelText("Name") as HTMLInputElement).value)
    .toBe("Keep the latest 5 of every newsletter");
});

test("a conflict's Compare counts mails and says who acts first", async () => {
  checkup = result([CONFLICT]);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
  const dlg = await screen.findByRole("dialog", { name: "Compare" });
  const text = nb(dlg.textContent);
  expect(text).toContain("Two rules, the same 12 mails");
  expect(text).toContain("12 mails · last");
  expect(text).toContain("so Sweep old newsletters gets to these mails first");
});

test("Edit… opens today's editor with the rule; a changed target is explained", async () => {
  mount();
  const c = await card();
  fireEvent.click(within(c.querySelector(`[data-finding="${DEST.id}"]`)! as
    HTMLElement).getByRole("button", { name: "Edit…" }));
  expect((await screen.findByLabelText("Name") as HTMLInputElement).value)
    .toBe("Receipts into their own folder");
  expect(screen.getByText("Edit rule")).toBeTruthy();
});

test("Delete… asks first (the rule's name, danger), then deletes", async () => {
  mount();
  const c = await card();
  fireEvent.click(within(c.querySelector(`[data-finding="${NEVER.id}"]`)! as
    HTMLElement).getByRole("button", { name: "Delete…" }));
  const dlg = await findDialog();
  expect(nb(dlg.textContent)).toContain('Delete rule "Archive old event tickets"?');
  expect(deleteRule).not.toHaveBeenCalled();
  await pressDialog("Delete");
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("r4"));
});

test("Delete… cancelled deletes nothing", async () => {
  mount();
  const c = await card();
  fireEvent.click(within(c.querySelector(`[data-finding="${NEVER.id}"]`)! as
    HTMLElement).getByRole("button", { name: "Delete…" }));
  await findDialog();
  await pressDialog("Cancel");
  await expectNoDialog();
  expect(deleteRule).not.toHaveBeenCalled();
});

test("Ignore is sent for that finding and the checkup is read again", async () => {
  mount();
  const c = await card();
  const calls = ruleCheckup.mock.calls.length;
  fireEvent.click(within(c.querySelector(`[data-finding="${NEVER.id}"]`)! as
    HTMLElement).getByRole("button", { name: "Ignore" }));
  await waitFor(() => expect(ignoreFinding).toHaveBeenCalledWith(NEVER.id, true));
  await waitFor(() => expect(ruleCheckup.mock.calls.length).toBeGreaterThan(calls));
});

test("ignored findings leave the count and sit behind 'N ignored · Show'", async () => {
  checkup = result([OVERLAP, { ...DEST, ignored: true }, NEVER]);
  mount();
  const c = await card();
  expect(nb(c.textContent)).toContain("2 things to look at");
  expect(c.querySelector(`[data-finding="${DEST.id}"]`)).toBeNull();
  expect(nb(c.textContent)).toContain("1 ignored");
  fireEvent.click(within(c).getByRole("button", { name: "Show" }));
  const row = c.querySelector(`[data-finding="${DEST.id}"]`)! as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Show again" }));
  await waitFor(() => expect(ignoreFinding).toHaveBeenCalledWith(DEST.id, false));
});

test("all fine: one quiet line, no card", async () => {
  checkup = result([]);
  mount();
  expect(await screen.findByText("Rule checkup: all fine")).toBeTruthy();
  expect(screen.queryByTestId("checkup-card")).toBeNull();
  expect(screen.getByRole("button", { name: "What it checks" })).toBeTruthy();
});

test("only ignored findings left: the quiet line says how many are ignored", async () => {
  checkup = result([{ ...NEVER, ignored: true }]);
  mount();
  expect(await screen.findByText("Rule checkup: all fine")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^1\s+ignored$/ }));
  const dlg = await screen.findByRole("dialog", { name: "Rule checkup" });
  fireEvent.click(within(dlg).getByRole("button", { name: "Show" }));
  expect(within(dlg).getByRole("button", { name: "Show again" })).toBeTruthy();
});

test("no scan yet: it says what a scan adds, and lists no scan-based 'nothing found'", async () => {
  checkup = result([], { analysed: false, needs_scan: true, scanned_ts: null });
  mount();
  expect(await screen.findByText("Rule checkup: scan once to check your rules "
    + "against your mail")).toBeTruthy();
});

test("no rules, no checkup; a failed checkup shows nothing", async () => {
  mount([]);
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByTestId("checkup-card")).toBeNull();
  expect(screen.queryByText(/Rule checkup/)).toBeNull();
  cleanup();
  checkup = new Error("boom");
  mount();
  await waitFor(() => expect(ruleCheckup).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByTestId("checkup-card")).toBeNull();
  expect(screen.getByText("Sweep old newsletters", { selector: "div" })).toBeTruthy();   // page intact
});

test("a checkup call that throws instead of failing shows nothing, and is no uncaught error", async () => {
  vi.useFakeTimers();
  try {
    ruleCheckup.mockImplementationOnce(() => { throw new TypeError("not a function"); });
    mount();
    // the debounce timer runs the call: a throw must not leave the timer
    await vi.advanceTimersByTimeAsync(300);
    expect(ruleCheckup).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
  expect(screen.queryByTestId("checkup-card")).toBeNull();
  expect(screen.getByText("Sweep old newsletters", { selector: "div" })).toBeTruthy();
});

test("What it checks lists the six checks and what is counted", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "What it checks" }));
  const dlg = await screen.findByRole("dialog",
    { name: "What the Rule checkup looks at" });
  for (const w of ["Overlap:", "Conflict:", "Points nowhere:", "Only protected mail:",
    "Never matches:", "Old report:"]) expect(nb(dlg.textContent)).toContain(w);
  expect(nb(dlg.textContent)).toContain("the per-run cap");
  expect(nb(dlg.textContent)).toContain("Keep-safe");
});

test("badges at the end of an affected rule's sentence open that rule's findings", async () => {
  checkup = result([OVERLAP, DEST, NEVER, CONFLICT]);
  mount();
  await card();
  const sweep = screen.getByText("Sweep old newsletters", { selector: "div" }).closest(".rounded-card")!;
  // r1 is in the overlap and the conflict
  expect(within(sweep as HTMLElement).getByText("overlaps 1")).toBeTruthy();
  expect(within(sweep as HTMLElement).getByText("conflicts 1")).toBeTruthy();
  const sentence = sweep.querySelector("p")!;
  expect(sentence.lastElementChild!.textContent).toMatch(/overlaps 1$/);
  expect(within(screen.getByText("Receipts into their own folder", { selector: "div" })
    .closest(".rounded-card")! as HTMLElement).getByText("folder gone")).toBeTruthy();
  expect(within(screen.getByText("Archive old event tickets", { selector: "div" })
    .closest(".rounded-card")! as HTMLElement).getByText("never matches")).toBeTruthy();
  fireEvent.click(within(sweep as HTMLElement).getByRole("button",
    { name: /Rule checkup: overlaps 1/ }));
  const dlg = await screen.findByRole("dialog", { name: "Rule checkup" });
  // only the findings that name this rule
  expect(dlg.querySelectorAll("[data-finding]").length).toBe(2);
  expect(nb(dlg.textContent)).not.toContain("Points nowhere");
  expect(nb(dlg.textContent)).toContain("Sweep old newsletters");
});

test("a rule without findings gets no badge; ignored findings leave their badge", async () => {
  checkup = result([{ ...DEST, ignored: true }]);
  mount();
  await screen.findByText("Rule checkup: all fine");
  expect(document.querySelectorAll("[data-badge]").length).toBe(0);
});

test("phones: one row that opens the same list on a sheet", async () => {
  phone();
  mount();
  const row = await screen.findByTestId("checkup-row");
  expect(nb(row.textContent)).toContain("Rule checkup");
  expect(nb(row.textContent)).toContain("3 things to look at · overlap, folder gone, "
    + "never matches");
  expect(screen.queryByTestId("checkup-card")).toBeNull();
  fireEvent.click(row);
  const dlg = await screen.findByRole("dialog", { name: "Rule checkup" });
  expect(dlg.querySelectorAll("[data-finding]").length).toBe(3);
  // the same buttons as on a wide screen
  expect(within(dlg).getByRole("button", { name: "Compare" })).toBeTruthy();
  expect(within(dlg).getAllByRole("button", { name: "Ignore" }).length).toBe(3);
});

test("phones: the quiet line when all is fine", async () => {
  phone();
  checkup = result([]);
  mount();
  expect(await screen.findByText("Rule checkup: all fine")).toBeTruthy();
  expect(screen.queryByTestId("checkup-row")).toBeNull();
});

test("German: card, texts, buttons and the compare sheet", async () => {
  setLang("de");
  mount();
  const c = await card();
  const text = nb(c.textContent);
  expect(text).toContain("Regel-Check · 3 Hinweise");
  expect(text).toContain("geprüft nach dem Scan vor 2 Min.");
  expect(text).toContain("Überschneidung");
  expect(text).toContain("betreffen beide Old Forum, Retro Weekly und Garden Notes");
  expect(text).toContain("(außer den neuesten 5)");
  expect(text).toContain("Ordner fehlt");
  expect(text).toContain("verschiebt Mails nach „Receipts“");
  expect(text).toContain("Trifft nie zu");
  expect(text).toContain("in den letzten 8 Läufen nichts gefunden");
  expect(text).toContain("Außerdem geprüft, nichts gefunden");
  for (const b of [/^Die 3\s+Absender zeigen$/, "Vergleichen", "Ignorieren",
    "Bearbeiten…", "Löschen…"]) {
    expect(within(c).getAllByRole("button", { name: b }).length).toBeGreaterThan(0);
  }
  fireEvent.click(within(c).getByRole("button", { name: "Vergleichen" }));
  const dlg = await screen.findByRole("dialog", { name: "Vergleichen" });
  const d = nb(dlg.textContent);
  expect(d).toContain("Zwei Regeln, dieselben 3 Absender");
  expect(d).toContain("Nur Sweep old newsletters");
  expect(d).toContain("5 bleiben");
  expect(d).toContain("Keep the latest 5 of every newsletter bearbeiten…");
});

test("a conflict reads as the board words it, for archive and folders too, in German", async () => {
  const arch = { ...TICKETS, id: "r7", name: "Archive shop mail" };
  checkup = result([{ ...CONFLICT, rules: ["r7", "r1"], first: "r7" }]);
  mount([arch, SWEEP]);
  let c = await card();
  expect(nb(c.textContent)).toContain("Archive shop mail archives 12 mails "
    + "that Sweep old newsletters moves to Trash. The one created first acts "
    + "first.");
  cleanup();
  setLang("de");
  checkup = result([{ ...CONFLICT, rules: ["r7", "r1"], first: "r7" }]);
  mount([arch, SWEEP]);
  c = await card();
  expect(nb(c.textContent)).toContain("Archive shop mail archiviert 12 Mails, "
    + "die Sweep old newsletters in den Papierkorb verschiebt. Die zuerst "
    + "angelegte Regel greift zuerst zu.");
  cleanup();
  checkup = result([{ ...CONFLICT, rules: ["r1", "r3"] }]);
  mount();
  c = await card();
  expect(nb(c.textContent)).toContain("Sweep old newsletters verschiebt 12 Mails "
    + "in den Papierkorb, die Receipts into their own folder nach „Receipts“ "
    + "verschiebt.");
});

test("every sender goes to the Senders page and counts in the button, "
  + "whatever a Compare lists", async () => {
  const cut: CheckupFinding = { ...OVERLAP, senders_total: 4,
    senders: OVERLAP.senders!.slice(0, 1),
    addrs: ["a@old.example", "b@old.example", "c@old.example", "d@old.example"] };
  checkup = result([cut]);
  mount();
  fireEvent.click(await screen.findByRole("button",
    { name: /^Show the 4\s+senders$/ }));
  expect(onShowSenders).toHaveBeenCalledWith(cut.addrs);
  // the sentence names the first and counts the rest
  expect(nb(screen.getByTestId("checkup-card").textContent)).toContain(
    "both act on Old Forum and 3 more.");
  // the Compare lists the rows it has and says how many more there are
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  const dlg = await screen.findByRole("dialog", { name: "Compare" });
  expect(nb(dlg.textContent)).toContain("+3 more");
});

test("German: the sender list in a sentence ends with 'und N weitere'", async () => {
  setLang("de");
  checkup = result([{ ...OVERLAP, senders_total: 5, senders: [...OVERLAP.senders!,
    { addr: "d@old.example", label: "Hobby Post", n: 1, last: 1 }] }]);
  mount();
  expect(nb((await card()).textContent)).toContain(
    "betreffen beide Old Forum, Retro Weekly, Garden Notes und 2 weitere.");
});

test("German: What it checks names the feature as the app does", async () => {
  setLang("de");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Was geprüft wird" }));
  const dlg = await screen.findByRole("dialog", { name: "Was der Regel-Check prüft" });
  expect(nb(dlg.textContent)).toContain("„Sicher behalten“");
  expect(nb(dlg.textContent)).not.toContain("Keep-safe");
});

test("German phone row", async () => {
  setLang("de");
  phone();
  mount();
  const row = await screen.findByTestId("checkup-row");
  expect(nb(row.textContent)).toContain(
    "3 Hinweise · Überschneidung, Ordner weg, trifft nie zu");
});

test("what INVENTORY lists for a rule card is still there with the checkup shown", async () => {
  mount();
  await card();
  // header: title, the info line, How rules work, New rule
  expect(screen.getByText("Rules")).toBeTruthy();
  expect(screen.getByText("How rules work")).toBeTruthy();
  expect(screen.getByRole("button", { name: /New rule/ })).toBeTruthy();
  const sweep = screen.getByText("Sweep old newsletters", { selector: "div" })
    .closest(".rounded-card")! as HTMLElement;
  // name, last-run line, Report only / Active, the sentence with its parts
  expect(nb(sweep.textContent)).toContain("Last run");
  expect(within(sweep).getByRole("radio", { name: "Report only" })).toBeTruthy();
  expect(within(sweep).getByRole("radio", { name: "Active" })).toBeTruthy();
  expect(nb(sweep.textContent)).toContain("is:unsub age:>1y");
  expect(nb(sweep.textContent)).toContain("move to Trash");
  // Run now / Last report / Edit / More > Delete
  for (const b of ["Run now", "Last report", "Edit"]) {
    expect(within(sweep).getByRole("button", { name: b })).toBeTruthy();
  }
  fireEvent.click(within(sweep).getByRole("button", { name: /More: Sweep/ }));
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  // today's retention words stay in the sentence
  const keep = screen.getByText("Keep the latest 5 of every newsletter",
    { selector: "div" }).closest(".rounded-card")! as HTMLElement;
  expect(nb(keep.textContent)).toContain("except the newest 5");
});

test("the checkup is read again when the rules change", async () => {
  const r = mount();
  await card();
  const calls = ruleCheckup.mock.calls.length;
  r.rerender(<DialogProvider><PageSlot page>
    <RulesModal state={state([...RULES, { ...base, id: "r9", name: "Another" }])}
      onClose={() => {}} onChanged={() => {}} />
  </PageSlot></DialogProvider>);
  await waitFor(() => expect(ruleCheckup.mock.calls.length).toBeGreaterThan(calls));
});
