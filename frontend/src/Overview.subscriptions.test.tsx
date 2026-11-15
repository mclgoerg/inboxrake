// @vitest-environment jsdom
/* The Overview's Next steps line "N subscriptions you may not use": shown
 * only when something looks unused, Review opens the Subscriptions page. */

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
import { fittrack, ITEMS, newsdaily, NOW, resp, streambox }
  from "./subscriptionsFixtures";
import type { Group } from "./types";

const group = (key: string): Group => ({
  key, label: key, sub: key, count: 5, size: 1000, unread: 0,
  first: "2020-01-01", last: "2099-01-01", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 80 });

const noop = () => {};
const onReviewSubs = vi.fn();
const base: OverviewProps = {
  phase: "data", groups: [group("a@x.example")], account: "proton",
  accountLine: "proton", unverifiedName: "", progress: null, progressLabel: "",
  canScan: true, rev: 1, scannedTs: 1, rules: [], junk: 0,
  onSetup: noop, onVerify: noop, onTest: noop, onScan: noop, onReview: noop,
  onReviewMany: noop, onCleanUp: noop, onOpenSender: noop,
  onOpenAllMail: noop, onOpenNewSenders: noop, onOpenStillMailing: noop,
  onOpenJunk: noop, onOpenAiVerdicts: noop,
  onReviewSubscriptions: onReviewSubs };

beforeEach(() => { setLang("en"); setClockShift(Date.now() - NOW * 1000); });
afterEach(() => {
  cleanup(); setClockShift(0); localStorage.clear(); onReviewSubs.mockReset();
  setLang("en");
});

test("two unused: the line names them with the monthly cost; Review opens the page",
  async () => {
    render(<Overview {...base} subs={resp()} />);
    const step = await screen.findByTestId("subs-step");
    expect(within(step).getByText("2 subscriptions you may not use")).toBeTruthy();
    expect(within(step).getByText("FitTrack Premium, NewsDaily+ · about €8 a month"))
      .toBeTruthy();
    fireEvent.click(within(step).getByRole("button", { name: "Review" }));
    expect(onReviewSubs).toHaveBeenCalledTimes(1);
  });

test("one unused, German", async () => {
  setLang("de");
  const items = [streambox, fittrack];
  render(<Overview {...base} subs={resp({}, items)} />);
  const step = await screen.findByTestId("subs-step");
  expect(within(step).getByText("1 Abo, das du vielleicht nicht nutzt"))
    .toBeTruthy();
  expect(within(step).getByText(/FitTrack Premium · etwa 8 € im Monat/))
    .toBeTruthy();
});

test("nothing looks unused (or no data yet): no line, and no empty card", async () => {
  render(<Overview {...base} subs={resp({}, [streambox])} />);
  expect(await screen.findByText("What fills your inbox")).toBeTruthy();
  expect(screen.queryByTestId("subs-step")).toBeNull();
  expect(screen.queryByText("Next steps")).toBeNull();
  cleanup();
  render(<Overview {...base} subs={null} />);
  await screen.findByText("What fills your inbox");
  expect(screen.queryByTestId("subs-step")).toBeNull();
});

test("hidden subscriptions are not counted", async () => {
  render(<Overview {...base}
    subs={resp({}, [{ ...fittrack, hidden: true }, newsdaily, streambox])} />);
  const step = await screen.findByTestId("subs-step");
  expect(within(step).getByText("1 subscription you may not use")).toBeTruthy();
  expect(ITEMS.length).toBe(6);
});

test("it shares the card with the clean-up steps and keeps their Review N", async () => {
  const big = { ...group("news@x.example"), tags: ["newsletter"], count: 20,
    unread: 19, size: 6 * 1048576, last: "2020-01-01" };
  render(<Overview {...base} groups={[big, group("b@x.example")]} subs={resp()} />);
  const step = await screen.findByTestId("subs-step");
  expect(screen.getAllByTestId("qw-card").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /^Review \d/ })).toBeTruthy();
  expect(step).toBeTruthy();
});
