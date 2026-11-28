// @vitest-environment jsdom
/* The Overview's "Mail past its date" line counts the automatic mail
 * (out-of-office replies, delivery failures, read receipts and calendar
 * answers) with the rest - the server's totals - and names its reasons when
 * there is room. The line stays a line: the three cards, "Review 3", "Show all
 * 5" and the subscriptions line do not know about it (INVENTORY.md, Overview;
 * see Overview.past.test.tsx for those). */

import { cleanup, fireEvent, render, screen, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("./api", () => ({
  api: {
    overview: () => Promise.resolve({
      now: 1, weeks: [0, 0, 0, 0, 0, 0, 0, 0],
      weeks_estimated: Array(8).fill(false),
      weeks_in_mailbox: Array(8).fill(0),
      week: { from: 0, mails: 0, senders: 0, newsletters: 0, new_senders: 0,
        still_mailing: 0, verdicts: 0, verdicts_safe: 0 },
      since: null, kinds: { days: 30, total: 0, items: [] }, trend: null }),
    audit: () => Promise.resolve({ total: 0, entries: [] }),
  },
}));

import { Overview, type OverviewProps } from "./components/Overview";
import { setClockShift } from "./clock";
import { setLang } from "./i18n";
import { TOP_CARDS } from "./quickwins";
import { NOW, resp } from "./subscriptionsFixtures";
import type { ExpiredResp, Group } from "./types";

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

// today's four reasons with mail, plus the automatic mail: 197 in all
const WITH_AUTO: ExpiredResp = {
  mails: 197, size: 4.5 * MB, kept: 12,
  reasons: [
    { id: "codes", mails: 21, size: 377 * 1024, ticked: true },
    { id: "parcels", mails: 9, size: 316 * 1024, ticked: true },
    { id: "events", mails: 17, size: 410 * 1024, ticked: true },
    { id: "offers", mails: 90, size: 2.9 * MB, ticked: false },
    { id: "ooo", mails: 34, size: 290 * 1024, ticked: true },
    { id: "bounces", mails: 9, size: 180 * 1024, ticked: true },
    { id: "answers", mails: 17, size: 85 * 1024, ticked: false },
  ] };
// nothing but automatic mail
const ONLY_AUTO: ExpiredResp = {
  mails: 60, size: 555 * 1024, kept: 0,
  reasons: WITH_AUTO.reasons.map((r) => ["ooo", "bounces", "answers"]
    .includes(r.id) ? r : { ...r, mails: 0, size: 0 }) };

const noop = () => {};
const onReview = vi.fn();
const onReviewMany = vi.fn();
const onReviewExpired = vi.fn();
const base: OverviewProps = {
  phase: "data", groups: [mk("a@x.example", { count: 5, size: 1000,
    last: "2099-01-01" })], account: "proton",
  accountLine: "proton", unverifiedName: "", progress: null, progressLabel: "",
  canScan: true, rev: 1, scannedTs: 1, rules: [], junk: 0,
  onSetup: noop, onVerify: noop, onTest: noop, onScan: noop,
  onReview, onReviewMany, onCleanUp: noop, onOpenSender: noop,
  onOpenAllMail: noop, onOpenNewSenders: noop, onOpenStillMailing: noop,
  onOpenJunk: noop, onOpenAiVerdicts: noop,
  onReviewSubscriptions: noop, onReviewExpired };

beforeEach(() => { setLang("en"); setClockShift(Date.now() - NOW * 1000); });
afterEach(() => {
  cleanup(); setClockShift(0); localStorage.clear(); setLang("en");
  for (const f of [onReview, onReviewMany, onReviewExpired]) f.mockReset();
});
const nb = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");

test("the line counts the automatic mail too, and names today's reasons first",
  async () => {
  render(<Overview {...base} expired={WITH_AUTO} />);
  const step = await screen.findByTestId("past-step");
  expect(within(step).getByText("Mail past its date")).toBeTruthy();
  // 197 mails in all, the server's total; three reasons are named, in order
  expect(nb(step.textContent)).toContain("197 mails · 4.5 MB · sign-in codes, "
    + "delivered parcels, appointments that are over");
  fireEvent.click(within(step).getByRole("button", { name: /^Review/ }));
  expect(onReviewExpired).toHaveBeenCalledTimes(1);
});

test("with only automatic mail the line names it", async () => {
  render(<Overview {...base} expired={ONLY_AUTO} />);
  const step = await screen.findByTestId("past-step");
  expect(nb(step.textContent)).toContain("60 mails · 555 KB · out-of-office "
    + "replies, delivery failures, read receipts");
  expect(within(step).getAllByRole("button")).toHaveLength(1);
});

test("a few of the old reasons leave room for the automatic ones", async () => {
  render(<Overview {...base} expired={{ ...WITH_AUTO, reasons:
    WITH_AUTO.reasons.map((r) => ["parcels", "events", "offers"]
      .includes(r.id) ? { ...r, mails: 0, size: 0 } : r) }} />);
  const step = await screen.findByTestId("past-step");
  expect(nb(step.textContent)).toContain(
    "sign-in codes, out-of-office replies, delivery failures");
});

test("the cards, Review 3 and Show all 5 do not know about the automatic mail",
  async () => {
  render(<Overview {...base} groups={FIVE} subs={resp()}
    expired={WITH_AUTO} />);
  const region = await screen.findByRole("region", { name: "Next steps" });
  expect(screen.getAllByTestId("qw-card")).toHaveLength(TOP_CARDS);
  fireEvent.click(within(region).getByRole("button", { name: "Review 3" }));
  expect(onReviewMany.mock.calls[0][0]).toHaveLength(3);
  expect(within(region).getByRole("button", { name: "Show all 5" })).toBeTruthy();
  expect(within(region).getAllByRole("listitem").map((r) =>
    r.getAttribute("data-testid"))).toEqual(
    ["qw-card", "qw-card", "qw-card", "subs-step", "past-step"]);
  // the line's 4.5 MB is not part of what the cards say can go
  expect(within(region).getByText(/Up to 200\.0 MB can go/)).toBeTruthy();
});

test("German: the automatic reasons are named", async () => {
  setLang("de");
  render(<Overview {...base} expired={ONLY_AUTO} />);
  const step = await screen.findByTestId("past-step");
  expect(nb(step.textContent)).toContain("60 Mails · 555 KB · "
    + "Abwesenheitsnotizen, Zustellfehler, Lesebestätigungen");
});
