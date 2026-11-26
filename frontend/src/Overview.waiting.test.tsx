// @vitest-environment jsdom
/* The Overview's Last week card: one more row at its end, "3 replies
 * overdue", only while somebody's reply is overdue; it opens Waiting for a
 * reply. Today's rows and Next steps stay as they are. */

import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const WEEK = { from: 0, mails: 63, senders: 36, newsletters: 27, new_senders: 3,
  still_mailing: 2, verdicts: 0, verdicts_safe: 0 };
vi.mock("./api", () => ({
  api: {
    overview: () => Promise.resolve({
      now: 1, weeks: [0, 0, 0, 0, 0, 0, 0, 0], weeks_estimated: Array(8).fill(false),
      weeks_in_mailbox: Array(8).fill(0), week: WEEK,
      since: null, kinds: { days: 30, total: 0, items: [] }, trend: null }),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
  },
}));

import { Overview, type OverviewProps } from "./components/Overview";
import { setLang } from "./i18n";
import type { Group } from "./types";
import { resp } from "./waitingFixtures";

const group = (key: string): Group => ({
  key, label: key, sub: key, count: 5, size: 1000, unread: 0,
  first: "2020-01-01", last: "2099-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 80 });

const noop = () => {};
const onOpen = vi.fn();
const base: OverviewProps = {
  phase: "data", groups: [group("a@x.example")], account: "proton",
  accountLine: "proton", unverifiedName: "", progress: null, progressLabel: "",
  canScan: true, rev: 1, scannedTs: 1, rules: [], junk: 4,
  onSetup: noop, onVerify: noop, onTest: noop, onScan: noop, onReview: noop,
  onReviewMany: noop, onCleanUp: noop, onOpenSender: noop,
  onOpenAllMail: noop, onOpenNewSenders: noop, onOpenStillMailing: noop,
  onOpenJunk: noop, onOpenAiVerdicts: noop, onOpenWaiting: onOpen };

const summary = (over = {}) => ({ ...resp().summary, ...over });

beforeEach(() => setLang("en"));
afterEach(() => { cleanup(); onOpen.mockReset(); localStorage.clear(); setLang("en"); });

test("three overdue: the row, who it waits on, shortened, and it opens the page", async () => {
  render(<Overview {...base} waiting={summary()} />);
  const row = await screen.findByTestId("ov-row-waiting");
  expect(within(row).getByText("3 replies overdue")).toBeTruthy();
  expect(within(row).getByText("steuerberater@…, Clara Neumann, vermieter@…"))
    .toBeTruthy();
  fireEvent.click(within(row).getByRole("button"));
  expect(onOpen).toHaveBeenCalled();
});

test("the row comes last, after every row Last week has today", async () => {
  render(<Overview {...base} waiting={summary()} />);
  await screen.findByTestId("ov-row-waiting");
  const ids = screen.getAllByTestId(/^ov-row-/).map((r) =>
    r.getAttribute("data-testid"));
  expect(ids.length).toBeGreaterThan(2);
  expect(ids[ids.length - 1]).toBe("ov-row-waiting");
  expect(ids).toContain("ov-row-mails");
  expect(ids).toContain("ov-row-junk");
});

test("one overdue reads in the singular", async () => {
  render(<Overview {...base} waiting={summary({ overdue: 1, people_n: 1,
    people: ["Clara Neumann"] })} />);
  const row = await screen.findByTestId("ov-row-waiting");
  expect(within(row).getByText("1 reply overdue")).toBeTruthy();
  expect(within(row).getByText("Clara Neumann")).toBeTruthy();
});

test("more people than names: the rest is counted", async () => {
  render(<Overview {...base} waiting={summary({ overdue: 6, people_n: 5,
    more: 2 })} />);
  const row = await screen.findByTestId("ov-row-waiting");
  expect(within(row).getByText(/Clara Neumann, vermieter@… \+2$/)).toBeTruthy();
});

test("only when something is overdue and the page can be opened", async () => {
  for (const waiting of [summary({ overdue: 0, people_n: 0, people: [] }), null,
    undefined]) {
    render(<Overview {...base} waiting={waiting} />);
    await screen.findByTestId("ov-row-mails");
    expect(screen.queryByTestId("ov-row-waiting")).toBeNull();
    cleanup();
  }
  render(<Overview {...base} waiting={summary()} onOpenWaiting={undefined} />);
  await screen.findByTestId("ov-row-mails");
  expect(screen.queryByTestId("ov-row-waiting")).toBeNull();
});

test("today's Last week rows are all still there", async () => {
  render(<Overview {...base} waiting={summary()} />);
  await screen.findByTestId("ov-row-waiting");
  for (const id of ["mails", "new", "still", "junk"])
    expect(screen.getByTestId(`ov-row-${id}`)).toBeTruthy();
});

test("German (du)", async () => {
  setLang("de");
  render(<Overview {...base} waiting={summary()} />);
  const row = await screen.findByTestId("ov-row-waiting");
  expect(within(row).getByText("3 Antworten überfällig")).toBeTruthy();
  cleanup();
  render(<Overview {...base} waiting={summary({ overdue: 1 })} />);
  expect(await screen.findByText("1 Antwort überfällig")).toBeTruthy();
});
