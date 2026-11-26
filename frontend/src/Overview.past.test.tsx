// @vitest-environment jsdom
/* The Overview's Next steps line "Mail past its date": one more LINE after
 * the subscriptions line, only a Review button, outside the top-3 cap and
 * outside "Review N". The three cards, "Review 3", "Show all 5", the
 * subscriptions line and "Not now" stay exactly as they are
 * (INVENTORY.md, Overview). */

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
// five cards, biggest first: newsletters, quiet, unsubscribed, attachments, AI
const FIVE = [
  mk("g1@x.example", { tags: ["newsletter"], unread: 20, size: 60 * MB }),
  mk("g2@x.example", { engagement: 5, size: 50 * MB }),
  mk("g3@x.example", { unsubscribed: done, size: 40 * MB }),
  mk("g4@x.example", { att_size: 30 * MB, size: 30 * MB }),
  mk("g5@x.example", { ai: { verdict: "delete_safe", reason: "" } as Group["ai"],
    size: 20 * MB }),
];

const EXPIRED: ExpiredResp = {
  mails: 148, size: 9.6 * MB, kept: 18,
  reasons: [
    { id: "codes", mails: 64, size: 1.1 * MB, ticked: true },
    { id: "parcels", mails: 52, size: 4.0 * MB, ticked: true },
    { id: "events", mails: 21, size: 2.9 * MB, ticked: true },
    { id: "offers", mails: 11, size: 1.6 * MB, ticked: false },
  ] };

const noop = () => {};
const onReview = vi.fn();
const onReviewMany = vi.fn();
const onReviewSubs = vi.fn();
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
  onReviewSubscriptions: onReviewSubs, onReviewExpired };

beforeEach(() => { setLang("en"); setClockShift(Date.now() - NOW * 1000); });
afterEach(() => {
  cleanup(); setClockShift(0); localStorage.clear(); setLang("en");
  vi.unstubAllGlobals();
  for (const f of [onReview, onReviewMany, onReviewSubs, onReviewExpired])
    f.mockReset();
});

const nextSteps = async () => screen.findByRole("region", { name: "Next steps" });
const nb = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");

test("the line says what it found; Review opens the sheet and nothing else",
  async () => {
  render(<Overview {...base} expired={EXPIRED} />);
  const step = await screen.findByTestId("past-step");
  expect(within(step).getByText("Mail past its date")).toBeTruthy();
  expect(nb(step.textContent)).toContain("148 mails · 9.6 MB · sign-in codes, "
    + "delivered parcels, appointments that are over");
  fireEvent.click(within(step).getByRole("button", { name: /^Review/ }));
  expect(onReviewExpired).toHaveBeenCalledTimes(1);
  expect(onReview).not.toHaveBeenCalled();
  expect(onReviewMany).not.toHaveBeenCalled();
  expect(onReviewSubs).not.toHaveBeenCalled();
});

test("with a line alone, Next steps is only that line (no cards, no Review N)",
  async () => {
  render(<Overview {...base} expired={EXPIRED} />);
  const region = await nextSteps();
  expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  expect(within(region).queryByRole("button", { name: /^Review \d/ })).toBeNull();
  expect(screen.queryByTestId("qw-card")).toBeNull();
});

test("it comes after the subscriptions line, which comes after the cards",
  async () => {
  render(<Overview {...base} groups={FIVE} subs={resp()}
    expired={EXPIRED} />);
  const region = await nextSteps();
  const rows = within(region).getAllByRole("listitem");
  expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(
    ["qw-card", "qw-card", "qw-card", "subs-step", "past-step"]);
});

test("the three cards, Review 3 and Show all 5 do not know about the line",
  async () => {
  render(<Overview {...base} groups={FIVE} subs={resp()}
    expired={EXPIRED} />);
  const region = await nextSteps();
  expect(screen.getAllByTestId("qw-card")).toHaveLength(TOP_CARDS);
  // "Review 3" counts the three cards, not the lines
  fireEvent.click(within(region).getByRole("button", { name: "Review 3" }));
  expect(onReviewMany).toHaveBeenCalledTimes(1);
  expect(onReviewMany.mock.calls[0][0]).toHaveLength(3);
  expect(within(region).getByRole("button", { name: "Show all 5" })).toBeTruthy();
  // the cards' own sizes: the line's 9.6 MB is not part of "can go"
  expect(within(region).getByText(/Up to 200\.0 MB can go/)).toBeTruthy();
  fireEvent.click(within(region).getByRole("button", { name: "Show all 5" }));
  expect(screen.getAllByTestId("qw-card")).toHaveLength(5);
  expect(within(region).getAllByRole("listitem").map((r) =>
    r.getAttribute("data-testid"))).toEqual(
    ["qw-card", "qw-card", "qw-card", "qw-card", "qw-card",
      "subs-step", "past-step"]);
  // each card keeps Review / Clean up… / Not now; the line has only Review
  const card = screen.getAllByTestId("qw-card")[0];
  expect(within(card).getByRole("button", { name: "Review" })).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Clean up…" })).toBeTruthy();
  expect(within(card).getByRole("button", { name: "Not now" })).toBeTruthy();
  const step = screen.getByTestId("past-step");
  expect(within(step).getAllByRole("button")).toHaveLength(1);
});

test("the subscriptions line keeps its Review", async () => {
  render(<Overview {...base} subs={resp()} expired={EXPIRED} />);
  fireEvent.click(within(await screen.findByTestId("subs-step"))
    .getByRole("button", { name: "Review" }));
  expect(onReviewSubs).toHaveBeenCalledTimes(1);
  expect(onReviewExpired).not.toHaveBeenCalled();
});

test("not enough to bother with: no line (the cards' floor: 10 mails or 5 MB)",
  async () => {
  const some = (mails: number, size: number): ExpiredResp => ({ ...EXPIRED,
    mails, size });
  render(<Overview {...base} expired={some(9, 4 * MB)} />);
  expect(await screen.findByText("What fills your inbox")).toBeTruthy();
  expect(screen.queryByTestId("past-step")).toBeNull();
  expect(screen.queryByText("Next steps")).toBeNull();
  cleanup();
  render(<Overview {...base} expired={some(10, 1000)} />);
  expect(await screen.findByTestId("past-step")).toBeTruthy();
  cleanup();
  render(<Overview {...base} expired={some(3, 5 * MB)} />);
  expect(await screen.findByTestId("past-step")).toBeTruthy();
});

test("nothing found or not known yet: no line", async () => {
  render(<Overview {...base} expired={null} />);
  expect(await screen.findByText("What fills your inbox")).toBeTruthy();
  expect(screen.queryByTestId("past-step")).toBeNull();
  cleanup();
  render(<Overview {...base} expired={{ ...EXPIRED, mails: 0, size: 0, kept: 0,
    reasons: EXPIRED.reasons.map((r) => ({ ...r, mails: 0, size: 0 })) }} />);
  expect(await screen.findByText("What fills your inbox")).toBeTruthy();
  expect(screen.queryByTestId("past-step")).toBeNull();
  cleanup();
  render(<Overview {...base} expired={EXPIRED} onReviewExpired={undefined} />);
  expect(await screen.findByText("What fills your inbox")).toBeTruthy();
  expect(screen.queryByTestId("past-step")).toBeNull();
});

test("only the reasons that have mail are named, the first three", async () => {
  render(<Overview {...base} expired={{ ...EXPIRED, reasons:
    EXPIRED.reasons.map((r) => r.id === "parcels"
      ? { ...r, mails: 0, size: 0 } : r) }} />);
  const step = await screen.findByTestId("past-step");
  expect(nb(step.textContent)).toContain(
    "sign-in codes, appointments that are over, ended offers");
  expect(nb(step.textContent)).not.toContain("delivered parcels");
});

test("German", async () => {
  setLang("de");
  render(<Overview {...base} expired={EXPIRED} />);
  const step = await screen.findByTestId("past-step");
  expect(within(step).getByText("Abgelaufene Mails")).toBeTruthy();
  expect(nb(step.textContent)).toContain("148 Mails · 9,6 MB · Anmeldecodes, "
    + "angekommene Pakete, vergangene Termine");
  expect(within(step).getByRole("button", { name: /^Ansehen/ })).toBeTruthy();
});

test("phones: the line is the same row (Review only), the cards keep their " +
  "More menu", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("767"), media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  render(<Overview {...base} groups={FIVE} expired={EXPIRED} />);
  const step = await screen.findByTestId("past-step");
  expect(within(step).getAllByRole("button")).toHaveLength(1);
  for (const card of screen.getAllByTestId("qw-card"))
    expect(within(card).getByRole("button", { name: "More" })).toBeTruthy();
});
