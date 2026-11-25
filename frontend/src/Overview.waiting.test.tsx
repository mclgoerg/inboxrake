// @vitest-environment jsdom
/* The Overview's Next steps line "N people haven't answered you": shown only
 * when somebody waits longer than usual; Show opens Waiting for a reply. */

import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
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
import { setLang } from "./i18n";
import type { Group } from "./types";

const group = (key: string): Group => ({
  key, label: key, sub: key, count: 5, size: 1000, unread: 0,
  first: "2020-01-01", last: "2099-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 80 });

const noop = () => {};
const onShow = vi.fn();
const base: OverviewProps = {
  phase: "data", groups: [group("a@x.example")], account: "proton",
  accountLine: "proton", unverifiedName: "", progress: null, progressLabel: "",
  canScan: true, rev: 1, scannedTs: 1, rules: [], junk: 0,
  onSetup: noop, onVerify: noop, onTest: noop, onScan: noop, onReview: noop,
  onReviewMany: noop, onCleanUp: noop, onOpenSender: noop,
  onOpenAllMail: noop, onOpenNewSenders: noop, onOpenStillMailing: noop,
  onOpenJunk: noop, onOpenAiVerdicts: noop, onShowWaiting: onShow };

const summary = (over = {}) => ({ overdue: 3, people_n: 3, more: 0,
  oldest_days: 12, people: ["Travelly", "Alex Doe", "City Library"], ...over });

beforeEach(() => setLang("en"));
afterEach(() => { cleanup(); onShow.mockReset(); localStorage.clear(); setLang("en"); });

test("three people: the line, their names, the oldest, and Show", () => {
  render(<Overview {...base} waiting={summary()} />);
  const step = screen.getByTestId("waiting-step");
  expect(within(step).getByText("3 people haven't answered you")).toBeTruthy();
  expect(within(step).getByText(/Travelly, Alex Doe, City Library · oldest 12\sdays/))
    .toBeTruthy();
  fireEvent.click(within(step).getByRole("button", { name: "Show" }));
  expect(onShow).toHaveBeenCalled();
});

test("one person reads in the singular", () => {
  render(<Overview {...base}
    waiting={summary({ overdue: 1, people_n: 1, people: ["Alex Doe"], oldest_days: 1 })} />);
  const step = screen.getByTestId("waiting-step");
  expect(within(step).getByText("1 person hasn't answered you")).toBeTruthy();
  expect(within(step).getByText(/Alex Doe · oldest 1\sday/)).toBeTruthy();
});

test("only when somebody waits: nothing for none, unknown, or no way to open it", () => {
  for (const waiting of [summary({ overdue: 0, people_n: 0, people: [] }), null,
    undefined]) {
    render(<Overview {...base} waiting={waiting} />);
    expect(screen.queryByTestId("waiting-step")).toBeNull();
    cleanup();
  }
  render(<Overview {...base} waiting={summary()} onShowWaiting={undefined} />);
  expect(screen.queryByTestId("waiting-step")).toBeNull();
});

test("German (du)", () => {
  setLang("de");
  render(<Overview {...base} waiting={summary()} />);
  const step = screen.getByTestId("waiting-step");
  expect(within(step).getByText("3 Personen haben dir nicht geantwortet")).toBeTruthy();
  expect(within(step).getByRole("button", { name: "Zeigen" })).toBeTruthy();
});
