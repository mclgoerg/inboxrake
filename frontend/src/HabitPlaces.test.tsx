// @vitest-environment jsdom
/* Where "You keep doing this" shows: the top of Rules (above the rule list,
 * with the count in the page sub line), the nav badge, the Overview's Next
 * steps line and the phone widget; and where it must not. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const createRule = vi.fn();
const runRule = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    createRule: (b: unknown) => createRule(b),
    runRule: (id: string) => runRule(id),
    habitDismiss: () => Promise.resolve({ ok: true }),
    rules: () => Promise.resolve({ rules: [], cap: 500 }),
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
import { Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./components/ui";
import { bank, chirp, deals } from "./habitsFixtures";
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
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLang("en"); });

const mountRules = (habits = [deals, bank, chirp], rules: Rule[] = [rule]) =>
  render(<ToastProvider><RulesModal state={{ ...baseState, rules }}
    habits={habits} onClose={() => {}} onChanged={() => {}} /></ToastProvider>);

// ---------------------------------------------------------------- Rules

test("Rules: the section sits above the rule list, with 'Your rules' between "
  + "and the suggestion count in the page's sub line", () => {
  mountRules();
  expect(screen.getByText(/1\srule · 3\ssuggestions from what you do/)).toBeTruthy();
  const section = screen.getByRole("region", { name: "You keep doing this" });
  const list = screen.getByText("Old shop mail");
  expect(section.compareDocumentPosition(list)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const label = screen.getByText("Your rules");
  expect(section.compareDocumentPosition(label)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(label.compareDocumentPosition(list)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Rules without suggestions looks exactly as before", () => {
  mountRules([]);
  expect(screen.queryByText("You keep doing this")).toBeNull();
  expect(screen.queryByText("Your rules")).toBeNull();
  expect(screen.getByText(/^1\srule · new rules only report/)).toBeTruthy();
});

test("Make it a rule from the page: created, reported, the list refreshed", async () => {
  const changed = vi.fn();
  const habitsChanged = vi.fn();
  render(<ToastProvider><RulesModal state={{ ...baseState, rules: [] }}
    habits={[deals]} onClose={() => {}} onChanged={changed}
    onHabitsChanged={habitsChanged} /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Make it a rule" }));
  await waitFor(() => expect(runRule).toHaveBeenCalledWith("r1"));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(habitsChanged).toHaveBeenCalled();
});

test("Rules: the focused suggestion (Automate…) is outlined", () => {
  render(<ToastProvider><RulesModal state={{ ...baseState, rules: [] }}
    habits={[deals, bank]} habitFocus="h-bank" onClose={() => {}}
    onChanged={() => {}} /></ToastProvider>);
  const c = document.querySelector('[data-habit="h-bank"]') as HTMLElement;
  expect(c.className).toContain("border-accent");
});

// -------------------------------------------------------------- nav badge

const side = (props: Partial<React.ComponentProps<typeof Sidebar>>) =>
  render(<Sidebar page="overview" onPage={() => {}} onOpen={() => {}}
    account={null} disabled={{}} {...props} />);

test("the Rules item counts the suggestions; with proposals it counts both", () => {
  side({ habits: 3 });
  const item = screen.getByRole("button", { name: /^Rules/ });
  expect(item.textContent).toContain("3");
  expect(within(item).getByText("3 suggestions from what you do")).toBeTruthy();
  cleanup();
  side({ habits: 3, proposals: 2 });
  const both = screen.getByRole("button", { name: /^Rules/ });
  expect(both.textContent).toContain("5");
  expect(within(both).getByText(
    "2 proposals waiting. 3 suggestions from what you do")).toBeTruthy();
  cleanup();
  side({ habits: 0 });
  expect(screen.getByRole("button", { name: "Rules" }).textContent).toBe("Rules");
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

test("Overview: Next steps gets one line that names the senders; Review opens "
  + "the first suggestion", async () => {
  const open = vi.fn();
  render(<ToastProvider><Overview {...overview} habits={[deals, bank, chirp]}
    onOpenHabit={open} /></ToastProvider>);
  const step = await screen.findByTestId("habits-step");
  expect(within(step).getByText("3 cleanups you keep doing by hand")).toBeTruthy();
  expect(within(step).getByText("Deals Daily, PayBank, Chirper")).toBeTruthy();
  fireEvent.click(within(step).getByRole("button", { name: "Review" }));
  expect(open).toHaveBeenCalledWith("h-deals");
  // no widget on a wide screen
  expect(screen.queryByRole("region", { name: "You keep doing this" })).toBeNull();
});

test("Overview: one suggestion is singular; none = no line and no Next steps card",
  async () => {
  render(<ToastProvider><Overview {...overview} habits={[bank]}
    onOpenHabit={noop} /></ToastProvider>);
  expect((await screen.findByTestId("habits-step")).textContent)
    .toContain("1 cleanup you keep doing by hand");
  cleanup();
  render(<ToastProvider><Overview {...overview} habits={[]}
    onOpenHabit={noop} /></ToastProvider>);
  await screen.findByText("What fills your inbox");
  expect(screen.queryByTestId("habits-step")).toBeNull();
  expect(screen.queryByText("Next steps")).toBeNull();
});

test("Overview on a phone: the widget instead of the line", async () => {
  phone();
  const open = vi.fn();
  render(<ToastProvider><Overview {...overview} habits={[deals, bank, chirp]}
    onOpenHabit={open} onHabitsChanged={noop} /></ToastProvider>);
  const w = await screen.findByRole("region", { name: "You keep doing this" });
  expect(within(w).getByRole("button", { name: "Make it a rule" })).toBeTruthy();
  expect(screen.queryByTestId("habits-step")).toBeNull();
  // the widget alone does not make an empty Next steps card
  expect(screen.queryByText("Next steps")).toBeNull();
  fireEvent.click(within(w).getByRole("button",
    { name: /^You marked Chirper as read/ }));
  expect(open).toHaveBeenCalledWith("h-chirp");
});

test("Overview in German", async () => {
  setLang("de");
  render(<ToastProvider><Overview {...overview} habits={[bank]}
    onOpenHabit={noop} /></ToastProvider>);
  expect((await screen.findByTestId("habits-step")).textContent)
    .toContain("1 Aufräum-Schritt, den du immer wieder von Hand machst");
});
