// @vitest-environment jsdom
/* The Overview's Next steps line "Weekly check-in": one more LINE, the very
 * last of them (after the cards, the subscriptions line and Mail past its
 * date), outside the top-3 cap and outside "Review N". It says how many places
 * have something and about how long that takes, over the window the Last week
 * card shows, and Start hands over to the app. The cards, "Review 3", "Show
 * all 5" and the other lines stay exactly as they are (INVENTORY.md). */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const checkin = vi.fn();
const overview = vi.fn();
vi.mock("./api", () => ({
  api: {
    overview: (...a: unknown[]) => overview(...a),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
    checkin: (...a: unknown[]) => checkin(...a),
  },
}));

import { Overview, type OverviewProps } from "./components/Overview";
import { saveProgress, NO_DID, weekId } from "./checkin";
import { setClockShift } from "./clock";
import { setLang } from "./i18n";
import { saveVisit } from "./overview";
import { TOP_CARDS } from "./quickwins";
import { NOW, resp } from "./subscriptionsFixtures";
import type { CheckinResp, ExpiredResp, Group } from "./types";

const MB = 1048576;
const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: key, sub: key, count: 20, size: 40 * MB, unread: 0,
  first: "2019-01-01", last: "2020-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 80,
  ...over });
const done = { n: 1, of: 1, status: "done" as const, link: "", addr: "" };
const FIVE = [
  mk("g1@x.example", { tags: ["newsletter"], unread: 20, size: 60 * MB }),
  mk("g2@x.example", { engagement: 5, size: 50 * MB }),
  mk("g3@x.example", { unsubscribed: done, size: 40 * MB }),
  mk("g4@x.example", { att_size: 30 * MB, size: 30 * MB }),
  mk("g5@x.example", { ai: { verdict: "delete_safe", reason: "" } as Group["ai"],
    size: 20 * MB }),
];
const EXPIRED: ExpiredResp = { mails: 148, size: 9.6 * MB, kept: 18,
  reasons: [{ id: "codes", mails: 148, size: 9.6 * MB, ticked: true }] };

const sixThings = (over: Partial<CheckinResp> = {}): CheckinResp => ({
  window: "week", from: 0, things: 6, minutes: 2,
  steps: [{ id: "new", n: 12 }, { id: "still", n: 3 }, { id: "past", n: 137 },
    { id: "waiting", n: 8 }, { id: "rules", n: 3 }, { id: "junk", n: 11 }],
  ...over });

const noop = () => {};
const onReview = vi.fn();
const onReviewMany = vi.fn();
const onReviewSubs = vi.fn();
const onReviewExpired = vi.fn();
const onStartCheckin = vi.fn();
const base: OverviewProps = {
  phase: "data", groups: [mk("a@x.example", { count: 5, size: 1000,
    last: "2099-01-01" })], account: "proton",
  accountLine: "proton", unverifiedName: "", progress: null, progressLabel: "",
  canScan: true, rev: 1, scannedTs: 1, rules: [], junk: 0,
  onSetup: noop, onVerify: noop, onTest: noop, onScan: noop,
  onReview, onReviewMany, onCleanUp: noop, onOpenSender: noop,
  onOpenAllMail: noop, onOpenNewSenders: noop, onOpenStillMailing: noop,
  onOpenJunk: noop, onOpenAiVerdicts: noop,
  onReviewSubscriptions: onReviewSubs, onReviewExpired, onStartCheckin };

const win = (over = {}) => ({ from: 0, mails: 1, senders: 1, newsletters: 0,
  new_senders: 0, still_mailing: 0, verdicts: 0, verdicts_safe: 0, ...over });

beforeEach(() => {
  setLang("en"); setClockShift(Date.now() - NOW * 1000);
  checkin.mockReset().mockResolvedValue(sixThings());
  overview.mockReset().mockResolvedValue({
    now: 1, weeks: [0, 0, 0, 0, 0, 0, 0, 0],
    weeks_estimated: Array(8).fill(false), weeks_in_mailbox: Array(8).fill(0),
    week: win(), since: null, kinds: { days: 30, total: 0, items: [] },
    trend: null });
});
afterEach(() => {
  cleanup(); setClockShift(0); localStorage.clear(); setLang("en");
  for (const f of [onReview, onReviewMany, onReviewSubs, onReviewExpired,
    onStartCheckin]) f.mockReset();
});

const nextSteps = async () => screen.findByRole("region",
  { name: "Next steps" });
const nb = (s: string | null) => (s ?? "").replace(/ /g, " ");

test("the line says how many things and how long; Start hands over, and " +
  "nothing else", async () => {
  render(<Overview {...base} />);
  const step = await screen.findByTestId("checkin-step");
  expect(within(step).getByText("Weekly check-in")).toBeTruthy();
  expect(nb(step.textContent)).toContain(
    "6 things this week · about 2 minutes");
  fireEvent.click(within(step).getByRole("button",
    { name: "Start: Weekly check-in" }));
  expect(onStartCheckin).toHaveBeenCalledTimes(1);
  expect(onStartCheckin).toHaveBeenCalledWith(null);
  expect(onReview).not.toHaveBeenCalled();
  expect(onReviewMany).not.toHaveBeenCalled();
  expect(onReviewSubs).not.toHaveBeenCalled();
  expect(onReviewExpired).not.toHaveBeenCalled();
});

test("with the line alone, Next steps is only that line", async () => {
  render(<Overview {...base} />);
  const region = await nextSteps();
  expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  expect(within(region).queryByRole("button", { name: /^Review \d/ })).toBeNull();
  expect(screen.queryByTestId("qw-card")).toBeNull();
});

test("it comes last: after the cards, the subscriptions line and Mail past " +
  "its date", async () => {
  render(<Overview {...base} groups={FIVE} subs={resp()}
    expired={EXPIRED} />);
  const region = await nextSteps();
  await screen.findByTestId("checkin-step");
  expect(within(region).getAllByRole("listitem").map((r) =>
    r.getAttribute("data-testid"))).toEqual(
    ["qw-card", "qw-card", "qw-card", "subs-step", "past-step",
      "checkin-step"]);
});

test("the cards, Review 3 and Show all 5 do not know about the line",
  async () => {
  render(<Overview {...base} groups={FIVE} subs={resp()}
    expired={EXPIRED} />);
  const region = await nextSteps();
  await screen.findByTestId("checkin-step");
  expect(screen.getAllByTestId("qw-card")).toHaveLength(TOP_CARDS);
  fireEvent.click(within(region).getByRole("button", { name: "Review 3" }));
  expect(onReviewMany.mock.calls[0][0]).toHaveLength(3);
  fireEvent.click(within(region).getByRole("button", { name: "Show all 5" }));
  expect(within(region).getAllByRole("listitem").map((r) =>
    r.getAttribute("data-testid"))).toEqual(
    ["qw-card", "qw-card", "qw-card", "qw-card", "qw-card",
      "subs-step", "past-step", "checkin-step"]);
  // each card keeps Review / Clean up… / Not now
  const card = screen.getAllByTestId("qw-card")[0];
  expect(within(card).getByRole("button", { name: "Review" })).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Clean up…" })).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Not now" })).toBeTruthy();
});

test("no line while nothing needs you, while it is unknown, or without a " +
  "way to start it", async () => {
  checkin.mockResolvedValue(sixThings({ things: 0, steps: [], minutes: 0 }));
  const a = render(<Overview {...base} />);
  await waitFor(() => expect(checkin).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByTestId("checkin-step")).toBeNull();
  a.unmount();

  checkin.mockRejectedValue(new Error("down"));
  const b = render(<Overview {...base} groups={FIVE} />);
  await nextSteps();
  expect(screen.queryByTestId("checkin-step")).toBeNull();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(TOP_CARDS);
  b.unmount();

  checkin.mockReset().mockResolvedValue(sixThings());
  render(<Overview {...base} onStartCheckin={undefined} />);
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.queryByTestId("checkin-step")).toBeNull();
  expect(checkin).not.toHaveBeenCalled();       // nothing is asked for it
});

test("the same line is drawn once for one thing, in German", async () => {
  checkin.mockResolvedValue(sixThings({ things: 1, minutes: 1,
    steps: [{ id: "junk", n: 4 }] }));
  const a = render(<Overview {...base} />);
  expect(nb((await screen.findByTestId("checkin-step")).textContent))
    .toContain("1 thing this week · about 1 minute");
  a.unmount();
  setLang("de");
  render(<Overview {...base} />);
  const step = await screen.findByTestId("checkin-step");
  expect(within(step).getByText("Wochen-Check")).toBeTruthy();
  expect(nb(step.textContent)).toContain("1 Ding diese Woche · etwa 1 Minute");
  expect(within(step).getByRole("button", { name: "Starten: Wochen-Check" }))
    .toBeTruthy();
});

test("the window is the Last week card's: since your last visit, the same " +
  "moment is asked for and handed to the check-in", async () => {
  const left = NOW * 1000 - 3 * 3600_000;   // on the test clock
  saveVisit("proton", { since: null, left });
  overview.mockResolvedValue({ now: 1, weeks: Array(8).fill(0),
    weeks_estimated: Array(8).fill(false), weeks_in_mailbox: Array(8).fill(0),
    week: win(), since: win({ from: Math.floor(left / 1000) }),
    kinds: { days: 30, total: 0, items: [] }, trend: null });
  render(<Overview {...base} />);
  // the card opens on the last 7 days: the check-in asks for that window
  await screen.findByTestId("checkin-step");
  expect(checkin).toHaveBeenLastCalledWith(null);
  checkin.mockResolvedValue(sixThings({ window: "since", things: 2,
    minutes: 1, steps: [{ id: "new", n: 1 }, { id: "junk", n: 2 }] }));
  const card = within(await screen.findByRole("region",
    { name: "Last week" }));
  fireEvent.click(card.getByRole("tab", { name: "Since last visit" }));
  await waitFor(() => expect(checkin).toHaveBeenLastCalledWith(left / 1000));
  const step = await screen.findByText(/2 things since your last visit/);
  fireEvent.click(within(step.closest("li")!).getByRole("button",
    { name: /^Start/ }));
  expect(onStartCheckin).toHaveBeenCalledWith(left);
  // back to the last 7 days: the line follows
  checkin.mockResolvedValue(sixThings());
  fireEvent.click(card.getByRole("tab", { name: "Last week" }));
  await screen.findByText(/6 things this week/);
  expect(checkin).toHaveBeenLastCalledWith(null);
});

test("a kept place says Continue until the week is over", async () => {
  // the test clock stands at NOW (see beforeEach)
  saveProgress("proton", { week: weekId(NOW * 1000), at: "past",
    went: ["new"], did: NO_DID, ms: 1000 });
  render(<Overview {...base} />);
  const step = await screen.findByTestId("checkin-step");
  fireEvent.click(within(step).getByRole("button",
    { name: "Continue: Weekly check-in" }));
  expect(onStartCheckin).toHaveBeenCalledWith(null);
  cleanup();
  // eight days later the place is gone: Start again
  setClockShift(Date.now() - (NOW + 8 * 86400) * 1000);
  render(<Overview {...base} />);
  expect(within(await screen.findByTestId("checkin-step")).getByRole("button",
    { name: "Start: Weekly check-in" })).toBeTruthy();
});
