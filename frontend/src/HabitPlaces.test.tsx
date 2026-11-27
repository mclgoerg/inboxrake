// @vitest-environment jsdom
/* Where "You keep doing this" shows: on the Rules page after the Rule checkup
 * and before the rules (a card; a box on a phone), and as one line at the end
 * of Overview > Next steps - and that what stood there before is all still
 * there (INVENTORY.md: the Rules page, Next steps). */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const createRule = vi.fn();
const runRule = vi.fn();
const habitDismiss = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    createRule: (b: unknown) => createRule(b),
    runRule: (id: string) => runRule(id),
    habitDismiss: (k: string) => habitDismiss(k),
    rules: () => Promise.resolve({ rules: [], cap: 500 }),
    ruleCheckup: () => Promise.resolve({
      account: "proton", scanned_ts: Date.now() / 1000 - 120, analysed: true,
      needs_scan: false, checked: 0, rules: 1, findings: [{
        id: "aaaaaaaaaaaaaaa3", kind: "never_matches", rules: ["abc1"],
        ignored: false, runs: 8, since: 1_759_300_000 }] }),
    overview: () => Promise.resolve({
      now: 1, weeks: [0, 0, 0, 0, 0, 0, 0, 0], weeks_estimated: Array(8).fill(false),
      weeks_in_mailbox: Array(8).fill(0),
      week: { from: 0, mails: 0, senders: 0, newsletters: 0, new_senders: 0,
        still_mailing: 0, verdicts: 0, verdicts_safe: 0 },
      since: null, kinds: { days: 30, total: 0, items: [] }, trend: null }),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
  },
}));

import { Overview, type OverviewProps } from "./components/Overview";
import { RulesModal } from "./components/RulesModal";
import { DialogProvider, PageSlot, ToastProvider } from "./components/ui";
import { bank, deals, news } from "./habitsFixtures";
import { setLang } from "./i18n";
import type { AppState, Group, Rule } from "./types";

const baseState: AppState = {
  account: "proton", status: "done", scanned_ts: 1, groups_rev: 0,
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
  id: "abc1", name: "Old shop mail", scope: "mail", grouping: "sender",
  query: "age:>1y", action: "trash", dest: "", schedule: "weekly",
  mode: "report", keep_latest: null, older_than_days: 30, origin: "manual",
  report_runs: 1, created: 0, last_run: null };

const phone = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: true, media: q, addEventListener: () => {},
  removeEventListener: () => {} }));

beforeEach(() => {
  setLang("en");
  createRule.mockResolvedValue({ id: "r1", name: "x" });
  runRule.mockResolvedValue({});
  habitDismiss.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); setLang("en"); });

const mountRules = (habits = [deals, news], rules: Rule[] = [rule],
    props: Record<string, unknown> = {}) =>
  render(<DialogProvider><ToastProvider><PageSlot page>
    <RulesModal state={{ ...baseState, rules }} habits={habits}
      onClose={() => {}} onChanged={() => {}} {...props} />
  </PageSlot></ToastProvider></DialogProvider>);

/** Counts and their nouns are joined by a no-break space. */
const nb = (s: string | null | undefined) => (s ?? "").replace(/\u00a0/g, " ");

const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// ---------------------------------------------------------------- Rules

test("Rules: the card sits after the Rule checkup and before the rules, and "
  + "reads the rule with the sentence of a rule card", async () => {
  const proposal: Rule = { ...rule, id: "p1", name: "Proposed sweep",
    origin: "mcp", mode: "report", proposed_by: { token_id: "t", name: "Bot",
      at: 1_700_000_000 } };
  mountRules([deals, news], [proposal, rule]);
  const checkup = await screen.findByTestId("checkup-card");
  const habit = await screen.findByTestId("habit-card");
  const prop = screen.getByText("Proposed sweep");
  // the rule's card (its name is also in the checkup's finding above it)
  const list = screen.getAllByText("Old shop mail").at(-1)!;
  expect(before(checkup, list)).toBe(true);
  expect(before(prop, checkup)).toBe(true);
  expect(before(checkup, habit)).toBe(true);
  expect(before(habit, list)).toBe(true);
  // "When [Sender] groups match [from:...] then [move to Trash] [if older
  // than 3 days] · [daily]", the way every rule card says it
  const first = habit.querySelector('[data-habit="h-deals"]') as HTMLElement;
  expect(first.textContent).toContain("When");
  expect(within(first).getByText("from:deals@dealsdaily.example")).toBeTruthy();
  expect(within(first).getByText("move to Trash")).toBeTruthy();
  expect(within(first).getByText("if older than 3 days")).toBeTruthy();
  expect(within(first).getByText("daily")).toBeTruthy();
  const second = habit.querySelector('[data-habit="h-news"]') as HTMLElement;
  expect(within(second).getByText("archive")).toBeTruthy();
  expect(within(second).getByText("weekly")).toBeTruthy();
});

test("Rules without suggestions: no card, and everything INVENTORY lists is there",
  async () => {
  mountRules([], [rule]);
  await screen.findByTestId("checkup-card");
  expect(screen.queryByTestId("habit-card")).toBeNull();
  expect(screen.queryByText("You keep doing this")).toBeNull();
  // the info line + docs link, the checkup card, the rule card with its
  // sentence, Report only / Active, Run now, Edit, the more menu, New rule
  expect(screen.getByText(/A rule runs a saved filter with an action/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "How rules work" })).toBeTruthy();
  expect(screen.getAllByText("Old shop mail").length).toBeGreaterThan(0);
  expect(screen.getByRole("radio", { name: "Report only" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Active" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Run now" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /More|more/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /New rule/ })).toBeTruthy();
});

test("with the card on the page the rule cards and the checkup are unchanged",
  async () => {
  mountRules([deals], [rule]);
  await screen.findByTestId("habit-card");
  expect(screen.getByRole("radio", { name: "Report only" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /New rule/ })).toBeTruthy();
  expect((await screen.findByTestId("checkup-card")).textContent)
    .toContain("Rule checkup");
  // the page header names the rules as before (no suggestion count in it)
  expect(screen.getByText(/^1\srule · new rules only report/)).toBeTruthy();
});

test("Make it a rule from the page: created, reported, the list refreshed", async () => {
  const changed = vi.fn();
  const habitsChanged = vi.fn();
  mountRules([deals], [], { onChanged: changed, onHabitsChanged: habitsChanged });
  fireEvent.click(await screen.findByRole("button", { name: "Make it a rule" }));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("r1"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(habitsChanged).toHaveBeenCalled();
});

test("Rules: the focused suggestion (Automate…) is brought into view", async () => {
  mountRules([deals, news], [], { habitFocus: "h-news" });
  await screen.findByTestId("habit-card");
  const c = document.querySelector('[data-habit="h-news"]') as HTMLElement;
  expect(c.className).toContain("border-accent");
  expect(document.activeElement).toBe(c);
});

test("Rules on a phone: the box comes after the Rule checkup row, with the "
  + "plain sentence", async () => {
  phone();
  mountRules([deals], [rule]);
  const row = await screen.findByTestId("checkup-row");
  const box = await screen.findByTestId("habit-card");
  expect(before(row, box)).toBe(true);
  expect(before(box, screen.getAllByText("Old shop mail").at(-1)!)).toBe(true);
  expect(within(box).getByText(/^A rule: Trash its mail older than 3 days, daily\./))
    .toBeTruthy();
  expect(within(box).getByRole("button", { name: "Make it a rule" })).toBeTruthy();
});

// --------------------------------------------------------------- Overview

const group = (key: string): Group => ({
  key, label: key, sub: key, count: 5, size: 1000, unread: 0,
  first: "2020-01-01", last: "2099-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 80 });
const noop = () => {};
const overview: OverviewProps = {
  phase: "data", groups: [group("a@x.example")], account: "proton",
  accountLine: "proton", unverifiedName: "", progress: null, progressLabel: "",
  canScan: true, rev: 1, scannedTs: 1, rules: [], junk: 0,
  onSetup: noop, onVerify: noop, onTest: noop, onScan: noop, onReview: noop,
  onReviewMany: noop, onCleanUp: noop, onOpenSender: noop,
  onOpenAllMail: noop, onOpenNewSenders: noop, onOpenStillMailing: noop,
  onOpenJunk: noop, onOpenAiVerdicts: noop };

test("Overview: Next steps gets one line at its end; Review opens the Rules "
  + "page at the first suggestion", async () => {
  const review = vi.fn();
  render(<Overview {...overview} habits={2} onReviewHabits={review} />);
  const step = await screen.findByTestId("habit-step");
  expect(within(step).getByText("You keep doing this")).toBeTruthy();
  expect(within(step).getByText("2 rules suggested from what you did by hand"))
    .toBeTruthy();
  fireEvent.click(within(step).getByRole("button", { name: /^Review/ }));
  expect(review).toHaveBeenCalledTimes(1);
  // a line of its own: it is not one of the checked steps
  expect(screen.queryByRole("checkbox", { name: /You keep doing this/ })).toBeNull();
});

test("Overview: the line is the last one; the others and Review N stay", async () => {
  const subs = { items: [{ key: "s", name: "NewsDaily+", hidden: false,
    use: { in_use: false } }], totals: { unused_monthly: 0, currency: "" } };
  render(<Overview {...overview} habits={2} onReviewHabits={noop}
    subs={subs as any} onReviewSubscriptions={noop}
    expired={{ mails: 40, size: 5_000_000, kept: 0, reasons: [
      { id: "codes", mails: 40, size: 5_000_000, ticked: true }] } as any}
    onReviewExpired={noop} />);
  const habit = await screen.findByTestId("habit-step");
  const subsStep = screen.getByTestId("subs-step");
  const past = screen.getByTestId("past-step");
  expect(before(subsStep, past)).toBe(true);
  expect(before(past, habit)).toBe(true);
  expect(habit.nextElementSibling).toBeNull();
  // Next steps keeps its other lines
  expect(within(subsStep).getByRole("button", { name: "Review" })).toBeTruthy();
});

test("Overview: one suggestion is singular; none = no line", async () => {
  render(<Overview {...overview} habits={1} onReviewHabits={noop} />);
  expect(nb((await screen.findByTestId("habit-step")).textContent))
    .toContain("1 rule suggested from what you did by hand");
  cleanup();
  render(<Overview {...overview} habits={0} onReviewHabits={noop} />);
  await screen.findByText("What fills your inbox");
  expect(screen.queryByTestId("habit-step")).toBeNull();
  // a line alone does not need cards: with nothing else, no Next steps card
  expect(screen.queryByText("Next steps")).toBeNull();
});

test("Overview: the line alone makes the Next steps card; phones show it too",
  async () => {
  phone();
  render(<Overview {...overview} habits={3} onReviewHabits={noop} />);
  const step = await screen.findByTestId("habit-step");
  expect(within(step).getByText("3 rules suggested from what you did by hand"))
    .toBeTruthy();
  expect(screen.getByRole("region", { name: "Next steps" })).toBeTruthy();
});

test("Overview in German", async () => {
  setLang("de");
  render(<Overview {...overview} habits={1} onReviewHabits={noop} />);
  const step = await screen.findByTestId("habit-step");
  expect(step.textContent).toContain("Das machst du immer wieder");
  expect(nb(step.textContent)).toContain(
    "1 Regel vorgeschlagen, aus dem, was du von Hand gemacht hast");
});

test("Rules in German: the card and its buttons", async () => {
  setLang("de");
  mountRules([bank], []);
  const head = await screen.findByTestId("habit-card");
  expect(nb(within(head).getByRole("heading").textContent))
    .toBe("Das machst du immer wieder · 1 Regel vorgeschlagen");
  expect(screen.getByRole("button", { name: "Als Regel anlegen" })).toBeTruthy();
});
