// @vitest-environment jsdom
/* The Overview's cards: balance chart + trend, "Last week" / "Since last
 * visit", next steps as a checklist, what fills the inbox, load failures. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const overview = vi.fn();
const audit = vi.fn();
vi.mock("./api", () => ({
  api: {
    overview: (...a: unknown[]) => overview(...a),
    audit: (...a: unknown[]) => audit(...a),
  },
}));

import { Overview, type OverviewProps } from "./components/Overview";
import { setLang } from "./i18n";
import { fmtDate } from "./lib";
import { saveVisit, loadVisit } from "./overview";
import type { AuditEntry, Group, OverviewResp, OverviewWindow } from
  "./types";

const MB = 1048576;
const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);

const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [],
  samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 80, ...over,
});
// Card 1 (old newsletters) and card 2 (quiet senders): both over the minimum.
const news = mk("news@x.example", { tags: ["newsletter"], count: 20,
  unread: 19, size: 6 * MB, last: "2020-01-01" });
const quiet = mk("quiet@x.example", { count: 30, size: 10 * MB,
  engagement: 10, last: "2020-01-01" });
const rest = mk("rest@x.example", { count: 10, size: 46 * MB });
const GROUPS = [news, quiet, rest];            // 62 MB, 60 mails, 3 senders

const win = (o: Partial<OverviewWindow> = {}): OverviewWindow => ({
  from: NOW - 7 * DAY, mails: 81, senders: 23, newsletters: 12,
  new_senders: 6, still_mailing: 3, verdicts: 24, verdicts_safe: 9, ...o });
const resp = (o: Partial<OverviewResp> = {}): OverviewResp => ({
  now: NOW, weeks: [10, 20, 30, 25, 15, 20, 40, 81],
  weeks_estimated: [false, false, false, false, false, false, false, false],
  weeks_in_mailbox: [10, 20, 30, 25, 15, 20, 40, 81],
  week: win(),
  since: null,
  kinds: { days: 30, total: 100, items: [
    { kind: "newsletter", count: 45 }, { kind: "shopping", count: 22 },
    { kind: "automated", count: 18 }, { kind: "finance", count: 6 },
    { kind: "other", count: 9 }] },
  trend: { ts: NOW - 30 * DAY, size: 100 * MB, mails: 5 }, ...o });
const entry = (ts: number, count: number): AuditEntry => ({
  ts, account: "proton", actor: "user", action: "trash", count, bytes: 1,
  label: "", outcome: "ok", error: "" });

const cbs = {
  onSetup: vi.fn(), onVerify: vi.fn(), onTest: vi.fn(), onScan: vi.fn(),
  onReview: vi.fn(), onReviewMany: vi.fn(), onCleanUp: vi.fn(),
  onOpenSender: vi.fn(), onOpenAllMail: vi.fn(), onOpenNewSenders: vi.fn(),
  onOpenStillMailing: vi.fn(), onOpenJunk: vi.fn(),
  onOpenAiVerdicts: vi.fn(),
};
const base: OverviewProps = {
  phase: "data", groups: GROUPS, account: "proton",
  accountLine: "proton · me@proton.example", unverifiedName: "",
  progress: null, progressLabel: "", canScan: true, rev: 1, scannedTs: 1,
  rules: [], junk: 11, ...cbs };
const el = (over: Partial<OverviewProps> = {}) =>
  <Overview {...base} {...over} />;
const show = (over: Partial<OverviewProps> = {}) => render(el(over));

beforeEach(() => {
  overview.mockResolvedValue(resp());
  audit.mockResolvedValue({ total: 0, entries: [] });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.values(cbs).forEach((f) => f.mockClear());
  overview.mockReset();
  audit.mockReset();
  setLang("en");
});
const chart = async () => within(await screen.findByRole("region",
  { name: "Mailbox balance" }));
const columns = async () => (await chart()).findAllByRole("button",
  { name: /arrived/ });

test("the balance card: size, counts, trend pill and 8 labelled columns",
  async () => {
  audit.mockResolvedValue({ total: 2, entries: [
    entry(NOW - 1 * DAY, 4), entry(NOW - 20 * DAY, 3)] });
  show();
  const card = await chart();
  expect(card.getByText("62.0 MB")).toBeTruthy();
  expect(card.getByText("in 60 mails from 3 senders")).toBeTruthy();
  expect(card.getByText("proton · me@proton.example")).toBeTruthy();
  expect(card.getByTestId("ov-trend").textContent)
    .toBe("38.0 MB less than a month ago");
  const cols = await columns();
  expect(cols).toHaveLength(8);
  // the audit log feeds the cleaned side, bucketed like the arrivals
  await waitFor(() => expect(cols[7].getAttribute("aria-label"))
    .toBe("Last 7 days: 81 arrived · 4 cleaned"));
  expect(cols[5].getAttribute("aria-label"))
    .toBe("15-21 days ago: 20 arrived · 3 cleaned");
  expect(cols[0].getAttribute("aria-label")).toContain("50-56 days ago");
  // the newest column is spelled out; hovering / tapping another one moves it
  expect(cols[7].getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(cols[1]);
  expect(cols[1].getAttribute("aria-pressed")).toBe("true");
  expect(card.getByText(/^43-49 days ago: 20 arrived/)).toBeTruthy();
  // every week counted at the scans: no estimate note
  expect(card.queryByText(/estimates/)).toBeNull();
  
});

const bars = (col: HTMLElement) => Array.from(
  col.querySelectorAll<HTMLElement>("span[style]")).map((b) => b.style.height);

test("two rows, each on its own scale: arrived on top, cleaned below",
  async () => {
  audit.mockResolvedValue({ total: 2, entries: [
    entry(NOW - 1 * DAY, 4), entry(NOW - 20 * DAY, 3)] });
  show();
  const card = await chart();
  const cols = await columns();
  await waitFor(() => expect(cols[7].getAttribute("aria-label"))
    .toContain("4 cleaned"));
  // the biggest arrival fills its row, the biggest cleanup fills its own
  expect(bars(cols[7])).toEqual(["100%", "100%"]);
  expect(bars(cols[5]).map(parseFloat)[0]).toBeCloseTo(24.69, 1);
  expect(bars(cols[5])[1]).toBe("75%");
  // a week without a cleanup is a short faint line, not a bar
  expect(bars(cols[0]).map(parseFloat)[0]).toBeCloseTo(12.35, 1);
  expect(bars(cols[0])).toHaveLength(1);
  expect(cols[0].querySelector(".h-0\\.5")).not.toBeNull();
  // the left labels carry each row's total
  expect(card.getByText("241")).toBeTruthy();
  expect(card.getByText("7")).toBeTruthy();
  expect(card.getByText("arrived")).toBeTruthy();
  expect(card.getByText("cleaned")).toBeTruthy();
  expect(card.queryByText("you cleaned")).toBeNull();
});

test("estimated arrivals are hatched and the arrived total says ~", async () => {
  overview.mockResolvedValue(resp({ weeks_estimated: [true, true, true, true,
    true, true, false, false] }));
  show();
  const card = await chart();
  const cols = await columns();
  expect(cols[0].querySelector(".bar-estimate")).not.toBeNull();
  expect(cols[7].querySelector(".bar-estimate")).toBeNull();
  expect(card.getByText("~241")).toBeTruthy();
  // the note is one line
  expect(card.getByText(/^Lighter bars are estimates from the mails still in your mailbox\.$/))
    .toBeTruthy();
});

test("the cleaned row stays empty while the audit log is missing", async () => {
  audit.mockRejectedValue(new Error("nope"));
  show();
  const card = await chart();
  const cols = await columns();
  expect(bars(cols[7])).toEqual(["100%"]);
  expect(cols[7].querySelectorAll(".h-0\\.5")).toHaveLength(0);
  expect(card.getByText("–")).toBeTruthy();
});

test("a floored cleaned total says at least; week dates sit under the columns",
  async () => {
  audit.mockImplementation((offset: number, limit: number) => Promise.resolve({
    total: 100000, entries: Array.from({ length: limit }, (_, i) =>
      entry(NOW - DAY - offset - i, 1)) }));
  show();
  const card = await chart();
  const cols = await columns();
  await waitFor(() => expect(cols[0].getAttribute("aria-label"))
    .toContain("at least"));
  expect(card.getByText(/^≥ \d/)).toBeTruthy();
  const d = new Date((NOW - 8 * 7 * DAY) * 1000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")
    }-${String(d.getDate()).padStart(2, "0")}`;
  expect(within(cols[0]).getByText(fmtDate(iso))).toBeTruthy();
  expect(within(cols[7]).getByText("this week")).toBeTruthy();
  // phones: the span in one line below the columns
  expect(card.getByText("8 weeks ago")).toBeTruthy();
});

test("German chart words", async () => {
  setLang("de");
  show();
  const card = within(await screen.findByRole("region",
    { name: "Postfach-Bilanz" }));
  expect(card.getByText("angekommen")).toBeTruthy();
  expect(card.getByText("aufgeräumt")).toBeTruthy();
  expect(card.getByText("Letzte 8 Wochen")).toBeTruthy();
  expect(card.getByText("vor 8 Wochen")).toBeTruthy();
});

test("Last week and What fills your inbox share a column, as do the balance"
  + " and the next steps; the page is not narrower than its header", async () => {
  const { container } = show();
  const last = (await screen.findByRole("region", { name: "Last week" }));
  const kinds = screen.getByRole("region", { name: "What fills your inbox" });
  const bal = screen.getByRole("region", { name: "Mailbox balance" });
  const steps = screen.getByRole("region", { name: "Next steps" });
  const col = (e: HTMLElement) => e.closest(".xl\\:flex-col");
  expect(col(last)).not.toBeNull();
  expect(col(last)).toBe(col(kinds));
  expect(col(bal)).toBe(col(steps));
  expect(col(bal)).not.toBe(col(last));
  expect(container.querySelector(".max-w-5xl")).toBeNull();
});

test("estimated weeks say so: in their text, and in the footnote", async () => {
  overview.mockResolvedValue(resp({ weeks_estimated: [true, true, true, true,
    true, true, false, false] }));
  show();
  const card = await chart();
  const cols = await columns();
  expect(cols[0].getAttribute("aria-label"))
    .toContain("50-56 days ago: about 10 arrived");
  expect(cols[7].getAttribute("aria-label")).not.toContain("about");
  expect(card.getByText(/Lighter bars are estimates/)).toBeTruthy();
});

test("the trend says its real age when the history is young, and more / same",
  async () => {
  overview.mockResolvedValue(resp({
    trend: { ts: NOW - 9 * DAY, size: 50 * MB, mails: 5 } }));
  show();
  expect((await screen.findByTestId("ov-trend")).textContent)
    .toBe("12.0 MB more than 9 days ago");
  cleanup();
  overview.mockResolvedValue(resp({
    trend: { ts: NOW - 1 * DAY, size: 62 * MB, mails: 5 } }));
  show();
  expect((await screen.findByTestId("ov-trend")).textContent)
    .toBe("Same size as 1 day ago");
  cleanup();
  overview.mockResolvedValue(resp({ trend: null }));
  show();
  await columns();
  expect(screen.queryByTestId("ov-trend")).toBeNull();
});

test("Last week: every row says what it counts and opens its view", async () => {
  show();
  const card = within(await screen.findByRole("region",
    { name: "Last week" }));
  await card.findByText("81 new mails");
  expect(card.getByText("from 23 senders · 12 newsletters")).toBeTruthy();
  expect(card.getByText("6 new senders")).toBeTruthy();
  expect(card.getByText("first seen in the last 7 days")).toBeTruthy();
  expect(card.getByText("3 still mailing")).toBeTruthy();
  expect(card.getByText("11 in Junk")).toBeTruthy();
  expect(card.getByText("24 new AI verdicts")).toBeTruthy();
  expect(card.getByText("9 safe to delete")).toBeTruthy();
  // no previous visit yet: no switch
  expect(card.queryByRole("tab")).toBeNull();

  // every row hands over the window its count covers ("Last week" = 7d)
  fireEvent.click(card.getByText("81 new mails"));
  expect(cbs.onOpenAllMail).toHaveBeenCalledWith("7d");
  fireEvent.click(card.getByText("6 new senders"));
  expect(cbs.onOpenNewSenders).toHaveBeenCalledWith("7d");
  fireEvent.click(card.getByText("3 still mailing"));
  expect(cbs.onOpenStillMailing).toHaveBeenCalledWith("7d");
  fireEvent.click(card.getByText("11 in Junk"));
  expect(cbs.onOpenJunk).toHaveBeenCalledTimes(1);
  fireEvent.click(card.getByText("24 new AI verdicts"));
  expect(cbs.onOpenAiVerdicts).toHaveBeenCalledWith("7d");
});

test("Last week: rows without a number are left out; singular forms", async () => {
  overview.mockResolvedValue(resp({ week: win({
    mails: 1, senders: 1, newsletters: 0, new_senders: 1, still_mailing: 0,
    verdicts: 1, verdicts_safe: 0 }) }));
  show({ junk: 0 });
  const card = within(await screen.findByRole("region",
    { name: "Last week" }));
  await card.findByText("1 new mail");
  expect(card.getByText("from 1 sender")).toBeTruthy();
  expect(card.getByText("1 new sender")).toBeTruthy();
  expect(card.getByText("1 new AI verdict")).toBeTruthy();
  expect(card.getByText("none safe to delete")).toBeTruthy();
  // nothing safe: the row is text, there is no list to open
  expect(within(card.getByTestId("ov-row-ai")).queryByRole("button")).toBeNull();
  expect(card.queryByText(/still mailing/)).toBeNull();
  expect(card.queryByText(/in Junk/)).toBeNull();
  cleanup();

  overview.mockResolvedValue(resp({ week: win({
    mails: 0, senders: 0, newsletters: 0, new_senders: 0, still_mailing: 0,
    verdicts: 0, verdicts_safe: 0 }) }));
  show({ junk: null });
  expect(await screen.findByText("Nothing new in the last 7 days."))
    .toBeTruthy();
});

test("Since last visit: only after an earlier visit; asks the server for " +
  "that moment and shows its numbers", async () => {
  const left = Date.now() - 3 * 3600_000;
  saveVisit("proton", { since: null, left });
  overview.mockResolvedValue(resp({ since: win({ from: Math.floor(left / 1000),
    mails: 5, senders: 2, newsletters: 0, new_senders: 1, still_mailing: 1,
    verdicts: 0 }) }));
  show();
  await waitFor(() => expect(overview).toHaveBeenCalledWith(
    Math.floor(left / 1000)));
  const card = within(await screen.findByRole("region",
    { name: "Last week" }));
  await card.findByText("81 new mails");
  const since = card.getByRole("tab", { name: "Since last visit" });
  expect(card.getByRole("tab", { name: "Last week" })
    .getAttribute("aria-selected")).toBe("true");
  fireEvent.click(since);
  expect(await card.findByText("5 new mails")).toBeTruthy();
  // the rows open lists over the same window: 3 h back, in whole minutes
  fireEvent.click(card.getByText("1 new sender"));
  expect(cbs.onOpenNewSenders.mock.calls[0][0]).toMatch(/^(3h|181min)$/);
  fireEvent.click(card.getByText("1 still mailing"));
  expect(cbs.onOpenStillMailing.mock.calls[0][0]).toMatch(/^(3h|181min)$/);
  fireEvent.click(card.getByText("5 new mails"));
  expect(cbs.onOpenAllMail.mock.calls[0][0]).toMatch(/^(3h|181min)$/);
  expect(card.getByText("1 still mailing")).toBeTruthy();
  expect(card.queryByText("6 new senders")).toBeNull();
  expect(card.getByText("1 new sender")).toBeTruthy();
  expect(card.getByText("first seen since your last visit")).toBeTruthy();
  expect(card.getByText(/^Since [A-Z][a-z]+ \d/)).toBeTruthy();
  expect(card.getByText("11 in Junk")).toBeTruthy();   // current, both views
  fireEvent.click(card.getByRole("tab", { name: "Last week" }));
  expect(await card.findByText("81 new mails")).toBeTruthy();
});

test("leaving the Overview records the visit; a quick return keeps the " +
  "earlier one", async () => {
  const left = Date.now() - 3 * 3600_000;
  saveVisit("proton", { since: null, left });
  const a = show();
  await chart();
  a.unmount();
  const rec = loadVisit("proton")!;
  expect(rec.since).toBe(left);
  expect(Date.now() - rec.left).toBeLessThan(5000);
  // back within the gap: still measured from the visit before
  show();
  await waitFor(() => expect(overview).toHaveBeenLastCalledWith(
    Math.floor(left / 1000)));
  // another account has its own record
  expect(loadVisit("other")).toBeNull();
});

test("first visit ever: no since window is requested", async () => {
  show();
  await chart();
  expect(overview).toHaveBeenCalledWith(null);
});

test("Next steps: a checklist; Review N hands over the checked rows", async () => {
  show();
  const card = within(await screen.findByRole("region",
    { name: "Next steps" }));
  expect(card.getAllByTestId("qw-card")).toHaveLength(2);
  expect(card.getByText(/Up to 16\.0 MB can go · each step shows/)).toBeTruthy();
  const review = card.getByRole("button", { name: "Review 2" });
  fireEvent.click(review);
  expect(cbs.onReviewMany).toHaveBeenCalledTimes(1);
  expect(cbs.onReviewMany.mock.calls[0][0].map(
    (c: { def: { id: string } }) => c.def.id))
    .toEqual(["quiet_low", "old_newsletters"]);
  cbs.onReviewMany.mockClear();

  // uncheck the first row: one left
  fireEvent.click(card.getByRole("checkbox", { name: /Quiet senders/ }));
  expect(card.getByRole("button", { name: "Review 1" })).toBeTruthy();
  fireEvent.click(card.getByRole("button", { name: "Review 1" }));
  expect(cbs.onReviewMany.mock.calls[0][0].map(
    (c: { def: { id: string } }) => c.def.id)).toEqual(["old_newsletters"]);
  // none checked: nothing to review
  fireEvent.click(card.getByRole("checkbox", { name: /Old newsletters/ }));
  expect((card.getByRole("button", { name: "Review 0" }) as
    HTMLButtonElement).disabled).toBe(true);

  // each row keeps its own Review / Clean up… / Not now
  const rows = card.getAllByTestId("qw-card");
  fireEvent.click(within(rows[0]).getByRole("button", { name: "Review" }));
  expect(cbs.onReview).toHaveBeenCalledWith(
    expect.objectContaining({ def: expect.objectContaining({ id: "quiet_low" }) }));
  fireEvent.click(within(rows[1]).getByRole("button", { name: "Clean up…" }));
  expect(cbs.onCleanUp).toHaveBeenCalledWith(
    expect.objectContaining({ def: expect.objectContaining({
      id: "old_newsletters" }) }));
  fireEvent.click(within(rows[0]).getByRole("button", { name: "Not now" }));
  expect(card.getAllByTestId("qw-card")).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem("pmc_qw_dismissed:proton")!))
    .toEqual({ quiet_low: 30 });
});

test("no next steps without cards; what fills the inbox stays", async () => {
  show({ groups: [rest] });
  await chart();
  expect(screen.queryByRole("region", { name: "Next steps" })).toBeNull();
  expect(screen.getByRole("region", { name: "What fills your inbox" }))
    .toBeTruthy();
});

test("What fills your inbox: shares of the last 30 days that add up to 100 %",
  async () => {
  show();
  const card = within(await screen.findByRole("region",
    { name: "What fills your inbox" }));
  const rows = await card.findAllByRole("listitem");
  expect(rows.map((li) => li.textContent)).toEqual([
    "Newsletters45 %", "Shopping22 %", "Notifications18 %", "Finance6 %",
    "Other9 %"]);
  expect(card.getByText("mails of the last 30 days, by kind")).toBeTruthy();
  cleanup();

  overview.mockResolvedValue(resp({
    kinds: { days: 30, total: 0, items: [] } }));
  show();
  expect(await screen.findByText("No mail in the last 30 days.")).toBeTruthy();
});

test("a failed load says so, keeps the page, and Retry fetches again",
  async () => {
  overview.mockRejectedValueOnce(new Error("down"));
  show();
  const retry = (await screen.findAllByRole("button", { name: "Retry" }))[0];
  expect(screen.getAllByText("Couldn't load these numbers.").length)
    .toBeGreaterThan(0);
  // the figures that need no request are still there
  expect(screen.getByText("62.0 MB")).toBeTruthy();
  fireEvent.click(retry);
  expect(await screen.findByText("81 new mails")).toBeTruthy();
  expect(overview).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Couldn't load these numbers.")).toBeNull();
});

test("a failing audit log only leaves the cleaned side empty", async () => {
  audit.mockRejectedValue(new Error("nope"));
  show();
  const cols = await columns();
  expect(cols[7].getAttribute("aria-label")).toBe("Last 7 days: 81 arrived");
});

test("the biggest senders keep the storage bar legend and the list", async () => {
  show();
  const section = within(await screen.findByRole("region",
    { name: "Biggest senders" }));
  const storage = within(section.getByRole("region", { name: "Storage" }));
  fireEvent.click(storage.getByRole("button", { name: /Label rest/ }));
  expect(cbs.onOpenSender).toHaveBeenCalledWith(rest);
  cbs.onOpenSender.mockClear();
  const list = within(section.getAllByRole("list").at(-1)!);
  fireEvent.click(list.getAllByRole("button")[0]);      // the biggest: rest
  expect(cbs.onOpenSender).toHaveBeenCalledWith(rest);
  expect(list.getAllByRole("button")).toHaveLength(3);
});

test("German", async () => {
  setLang("de");
  const left = Date.now() - 3 * 3600_000;
  saveVisit("proton", { since: null, left });
  show();
  const card = within(await screen.findByRole("region",
    { name: "Letzte Woche" }));
  await card.findByText("81 neue Mails");
  expect(card.getByText("von 23 Absendern · 12 Newsletter")).toBeTruthy();
  expect(card.getByText("3 schreiben weiter")).toBeTruthy();
  expect(card.getByText("11 im Spam")).toBeTruthy();
  expect(card.getByText("24 neue KI-Urteile")).toBeTruthy();
  expect(card.getByRole("tab", { name: "Seit letztem Besuch" })).toBeTruthy();
  expect(screen.getByTestId("ov-trend").textContent)
    .toBe("38,0 MB weniger als vor einem Monat");
  expect(screen.getByRole("region", { name: "Nächste Schritte" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "2 ansehen" })).toBeTruthy();
  expect(screen.getByText("Newsletter")).toBeTruthy();
  expect(screen.getByText("45 %")).toBeTruthy();
});

test("cleaned weeks the audit page cap cut short say \"at least\"", async () => {
  audit.mockImplementation((offset: number, limit: number) => Promise.resolve({
    total: 100000, entries: Array.from({ length: limit }, (_, i) =>
      entry(NOW - DAY - offset - i, 1)) }));
  show();
  const cols = await columns();
  await waitFor(() => expect(cols[0].getAttribute("aria-label"))
    .toContain("at least"));
  expect(audit).toHaveBeenCalledTimes(6);               // the cap
  cleanup();
  audit.mockResolvedValue({ total: 0, entries: [] });
  show();
  expect((await columns())[0].getAttribute("aria-label"))
    .not.toContain("at least");
});

test("rev bumps refetch at most every 30 s; scans, accounts and Retry at once",
  async () => {
  const real = Date.now();
  const view = show();
  await chart();
  expect(overview).toHaveBeenCalledTimes(1);
  // bumps right after a fetch: held back
  view.rerender(el({ rev: 2 }));
  view.rerender(el({ rev: 3 }));
  await new Promise((r) => setTimeout(r, 30));
  expect(overview).toHaveBeenCalledTimes(1);
  // 50 ms before the interval ends the held-back bump goes through, once
  const spy = vi.spyOn(Date, "now").mockReturnValue(real + 29_950);
  view.rerender(el({ rev: 4 }));
  await waitFor(() => expect(overview).toHaveBeenCalledTimes(2));
  await new Promise((r) => setTimeout(r, 80));
  expect(overview).toHaveBeenCalledTimes(2);
  // after the interval: at once
  spy.mockReturnValue(real + 29_950 + 31_000);
  view.rerender(el({ rev: 5 }));
  await waitFor(() => expect(overview).toHaveBeenCalledTimes(3));
  // a finished scan: at once, inside the interval
  view.rerender(el({ rev: 6, scannedTs: 2 }));
  await waitFor(() => expect(overview).toHaveBeenCalledTimes(4));
  // another account: at once
  view.rerender(el({ rev: 6, scannedTs: 2, account: "other" }));
  await waitFor(() => expect(overview.mock.calls.length)
    .toBeGreaterThanOrEqual(5));
  spy.mockRestore();
});


test("a counted week says how many of its mails are no longer in the mailbox",
  async () => {
  overview.mockResolvedValue(resp({ weeks: [10, 20, 30, 25, 15, 20, 40, 120],
    weeks_in_mailbox: [10, 20, 30, 25, 15, 20, 40, 81] }));
  show();
  const cols = await columns();
  expect(cols[7].getAttribute("aria-label")).toContain(
    "Last 7 days: 120 arrived (incl. 39 no longer in your mailbox)");
  expect(cols[6].getAttribute("aria-label")).not.toContain("no longer");
  // an estimate is the index's own number: nothing to add
  cleanup();
  overview.mockResolvedValue(resp({ weeks: [10, 20, 30, 25, 15, 20, 40, 120],
    weeks_estimated: [true, true, true, true, true, true, true, true] }));
  show();
  expect((await columns())[7].getAttribute("aria-label"))
    .not.toContain("no longer");
});
