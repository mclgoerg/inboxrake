// @vitest-environment jsdom
/* Sender changes: the filter words, the Overview rows, the line above the
 * Senders list, the arrival strip's line and the Statistics card. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const overview = vi.fn();
const audit = vi.fn();
const rhythm = vi.fn();
const senderChanges = vi.fn();
vi.mock("./api", () => ({
  api: {
    overview: (...a: unknown[]) => overview(...a),
    audit: (...a: unknown[]) => audit(...a),
    rhythm: (...a: unknown[]) => rhythm(...a),
    senderChanges: (...a: unknown[]) => senderChanges(...a),
    stats: () => Promise.resolve({
      mails: 10, size: 1000, senders: 2, unread: 1, bulk: 1,
      replied_senders: 0, oldest: "2025-01-01", years: [], months: [],
      categories: [], top_domains: [], top_senders: [], scans: [],
      actions: {}, ai: { rated: 0, groups: 0 },
      ai_groups: { delete_safe: 0, review: 0, keep: 0, unrated: 0 },
      rated_mails: { delete_safe: 0, review: 0, keep: 0 } }),
  },
  fmtSize: (n: number) => `${n} B`,
}));

import { ChangesNote, ChangesRows, arrivalChangeLines, monthsOf,
  windowText } from "./components/SenderChanges";
import { Overview, type OverviewProps } from "./components/Overview";
import { ArrivalStrip } from "./components/RhythmCard";
import { StatsPanel } from "./components/StatsPanel";
import { setLang } from "./i18n";
import { BACK_DAYS, louderInWindow, matchGroup, parseFilter } from "./lib";
import { louderWindow, saveVisit } from "./overview";
import type { Group, GroupBack, GroupLouder, OverviewResp, OverviewWindow,
  SenderChangesResp } from "./types";

const DAY = 86400;
const NOW_MS = Date.now();
const NOW = Math.floor(NOW_MS / 1000);

const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: `Label ${key.split("@")[0]}`, sub: key, count: 5, size: 1000,
  unread: 0, first: "2020-01-01", last: "2099-01-01", tags: [],
  samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 80, ...over,
});
const louder = (over: Partial<GroupLouder> = {}): GroupLouder => ({
  addr: "n@x.example", label: "Northwind News", n: 5, usual: 1, factor: 5,
  ts: [NOW - 3600, NOW - DAY, NOW - 2 * DAY, NOW - 3 * DAY, NOW - 5 * DAY],
  ...over });
const back = (over: Partial<GroupBack> = {}): GroupBack => ({
  addr: "h@x.example", label: "Harbor Books", ts: NOW - 5 * DAY,
  gap_days: 456, n: 3, never_opened: true, ...over });

afterEach(() => { cleanup(); setLang("en"); localStorage.clear(); });

// ----------------------------------------------------------- the filter words

test("the words parse and combine with the others", () => {
  const f = parseFilter("is:louder is:back unread:>50 in:3d");
  expect(f.louder && f.back).toBe(true);
  expect(f.unreadMin).toBe(50);
  expect(f.inSeconds).toBe(3 * DAY);
  const g = parseFilter("is:louder");
  expect(g.louder).toBe(true);
  expect(g.back).toBe(false);
  expect(g.text).toEqual([]);
  expect(parseFilter("is:loud").text).toEqual(["is:loud"]);
});

test("is:louder = the last 7 days; in: counts a shorter window", () => {
  const g = mk("k@x.example", { louder: louder() });
  const now = NOW_MS;
  expect(matchGroup(g, parseFilter("is:louder"), now)).toBe(true);
  expect(matchGroup(mk("k@x.example"), parseFilter("is:louder"), now)).toBe(false);
  // the group's mails: 1 hour, 1, 2, 3 and 5 days ago
  expect(matchGroup(g, parseFilter("is:louder in:6d"), now)).toBe(true);
  expect(matchGroup(g, parseFilter("is:louder in:4d"), now)).toBe(true);
  expect(matchGroup(g, parseFilter("is:louder in:3d"), now)).toBe(false);
  expect(matchGroup(g, parseFilter("is:louder in:2h"), now)).toBe(false);
  // wider than a week: the same seven days
  expect(matchGroup(g, parseFilter("is:louder in:30d"), now)).toBe(true);
  // twice the usual week is not louder
  const busy = mk("k@x.example", { louder: louder({ usual: 2 }) });
  expect(matchGroup(busy, parseFilter("is:louder in:4d"), now)).toBe(false);
  expect(louderInWindow({ ts: [NOW, NOW, NOW, NOW], usual: 2 }, 0)).toBeNull();
  expect(louderInWindow({ ts: [NOW, NOW, NOW], usual: 0 }, 0)).toBeNull();
  expect(louderInWindow({ ts: [NOW, NOW, NOW, NOW], usual: 1.5 }, 0)).toBe(4);
});

test("is:back = the last 30 days; in: replaces them", () => {
  const now = NOW_MS;
  const g = mk("k@x.example", { back: back() });
  expect(BACK_DAYS).toBe(30);
  expect(matchGroup(g, parseFilter("is:back"), now)).toBe(true);
  expect(matchGroup(mk("k@x.example"), parseFilter("is:back"), now)).toBe(false);
  const old = mk("k@x.example", { back: back({ ts: NOW - 40 * DAY }) });
  expect(matchGroup(old, parseFilter("is:back"), now)).toBe(false);
  expect(matchGroup(old, parseFilter("is:back in:60d"), now)).toBe(true);
  expect(matchGroup(g, parseFilter("is:back in:2d"), now)).toBe(false);
});

// ------------------------------------------------------------ Overview rows

const win = (o: Partial<OverviewWindow> = {}): OverviewWindow => ({
  from: NOW - 7 * DAY, mails: 63, senders: 36, newsletters: 27,
  new_senders: 4, still_mailing: 3, verdicts: 5, verdicts_safe: 2, ...o });
const LOUDER = { louder: 2, louder_top: { label: "Northwind News", n: 4,
  usual: 1 } };
const BACK = { back: 1, back_top: { label: "Harbor Books", months: 14,
  never_opened: true } };
const resp = (o: Partial<OverviewResp> = {}): OverviewResp => ({
  now: NOW, weeks: [10, 20, 30, 25, 15, 20, 40, 81],
  weeks_estimated: [false, false, false, false, false, false, false, false],
  weeks_in_mailbox: [10, 20, 30, 25, 15, 20, 40, 81],
  week: win(), since: null,
  kinds: { days: 30, total: 0, items: [] }, trend: null, ...o });
const cbs = {
  onSetup: vi.fn(), onVerify: vi.fn(), onTest: vi.fn(), onScan: vi.fn(),
  onReview: vi.fn(), onReviewMany: vi.fn(), onCleanUp: vi.fn(),
  onOpenSender: vi.fn(), onOpenAllMail: vi.fn(), onOpenNewSenders: vi.fn(),
  onOpenStillMailing: vi.fn(), onOpenJunk: vi.fn(),
  onOpenAiVerdicts: vi.fn(), onOpenLouder: vi.fn(), onOpenBack: vi.fn(),
};
const base: OverviewProps = {
  phase: "data", groups: [mk("a@x.example")], account: "proton",
  accountLine: "proton · me@proton.example", unverifiedName: "",
  progress: null, progressLabel: "", canScan: true, rev: 1, scannedTs: 1,
  rules: [], junk: 11, ...cbs };
const showOverview = (over: Partial<OverviewProps> = {}) =>
  render(<Overview {...base} {...over} />);
const lastWeek = async () => within(await screen.findByRole("region",
  { name: "Last week" }));

beforeEach(() => {
  Object.values(cbs).forEach((f) => f.mockClear());
  audit.mockResolvedValue({ total: 0, entries: [] });
  overview.mockResolvedValue(resp({ week: win({ ...LOUDER, ...BACK }) }));
});

test("Last week: two more rows AFTER today's rows, each opening Senders", async () => {
  showOverview();
  const card = await lastWeek();
  await card.findByText("2 senders got louder");
  expect(card.getByText(
    /^Northwind News: 4 in the last 7\sdays, usually 1 a week$/)).toBeTruthy();
  expect(card.getByText("1 came back after 14 months")).toBeTruthy();
  expect(card.getByText("Harbor Books · you never opened it before"))
    .toBeTruthy();
  // today's rows are all still there, in their order, the new ones last
  const ids = card.getAllByRole("listitem").map((li) => li.dataset.testid);
  expect(ids).toEqual(["ov-row-mails", "ov-row-new", "ov-row-still",
    "ov-row-junk", "ov-row-ai", "ov-row-louder", "ov-row-back"]);
  fireEvent.click(card.getByText("2 senders got louder"));
  expect(cbs.onOpenLouder).toHaveBeenCalledWith("7d");
  fireEvent.click(card.getByText("1 came back after 14 months"));
  expect(cbs.onOpenBack).toHaveBeenCalledWith("7d");
  // nothing of today's rows moved or changed
  expect(card.getByText("63 new mails")).toBeTruthy();
  expect(card.getByText("4 new senders")).toBeTruthy();
  expect(card.getByText("3 still mailing")).toBeTruthy();
  expect(card.getByText("11 in Junk")).toBeTruthy();
  expect(card.getByText("5 new AI verdicts")).toBeTruthy();
});

test("Last week: a row is left out at zero, and for a server without them", async () => {
  overview.mockResolvedValue(resp({ week: win({ louder: 0, louder_top: null,
    ...BACK }) }));
  showOverview();
  let card = await lastWeek();
  await card.findByText("1 came back after 14 months");
  expect(card.queryByText(/got louder/)).toBeNull();
  cleanup();
  // the count decides, not the name that came with it
  overview.mockResolvedValue(resp({ week: win({ louder: 0, ...BACK,
    louder_top: LOUDER.louder_top, back: 0 }) }));
  showOverview();
  card = await lastWeek();
  await card.findByText("63 new mails");
  expect(card.queryByText(/got louder|came back/)).toBeNull();
  cleanup();
  overview.mockResolvedValue(resp({ week: win() }));     // no new fields
  showOverview();
  card = await lastWeek();
  await card.findByText("63 new mails");
  expect(card.queryByText(/got louder|came back/)).toBeNull();
  expect(card.getAllByRole("listitem")).toHaveLength(5);
  cleanup();
  overview.mockResolvedValue(resp({ week: win({ mails: 0, senders: 0,
    new_senders: 0, still_mailing: 0, verdicts: 0, verdicts_safe: 0 }) }));
  showOverview({ junk: null });
  expect(await screen.findByText("Nothing new in the last 7 days."))
    .toBeTruthy();
});

test("Last week: singular and plural titles, several that came back", async () => {
  overview.mockResolvedValue(resp({ week: win({
    louder: 1, louder_top: { label: "Chirper", n: 15, usual: 6 },
    back: 3, back_top: { label: "Harbor Books", months: 6,
      never_opened: false } }) }));
  showOverview();
  const card = await lastWeek();
  await card.findByText("1 sender got louder");
  expect(card.getByText(
    /^Chirper: 15 in the last 7\sdays, usually 6 a week$/)).toBeTruthy();
  expect(card.getByText("3 came back after 6+ months")).toBeTruthy();
  expect(card.getByText("Harbor Books and 2 more")).toBeTruthy();
  cleanup();
  overview.mockResolvedValue(resp({ week: win({ back: 1, back_top: {
    label: "Harbor Books", months: 9, never_opened: false } }) }));
  showOverview();
  expect(await screen.findByText("Harbor Books · quiet for 9 months"))
    .toBeTruthy();
});

test("Since last visit: a short window is used as it is, a long one counts the last 7 days",
  async () => {
    const left = NOW_MS - 3 * 3600_000;
    saveVisit("proton", { since: null, left });
    overview.mockResolvedValue(resp({
      week: win({ ...LOUDER }),
      since: win({ from: Math.floor(left / 1000), mails: 5, ...LOUDER,
        louder: 1, back: 0, back_top: null }) }));
    showOverview();
    let card = await lastWeek();
    fireEvent.click(await card.findByRole("tab", { name: "Since last visit" }));
    await card.findByText("1 sender got louder");
    expect(card.getByText(
      "Northwind News: 4 since your last visit, usually 1 a week")).toBeTruthy();
    fireEvent.click(card.getByText("1 sender got louder"));
    expect(cbs.onOpenLouder).toHaveBeenCalledWith(expect.stringMatching(
      /^\d+(min|h)$/));
    cleanup();
    localStorage.clear();
    // away for three weeks: louder is a weekly idea - the last 7 days
    saveVisit("proton", { since: null, left: NOW_MS - 21 * DAY * 1000 });
    showOverview();
    card = await lastWeek();
    fireEvent.click(await card.findByRole("tab", { name: "Since last visit" }));
    await card.findByText("1 sender got louder");
    expect(card.getByText(/Northwind News: 4 in the last 7/)).toBeTruthy();
    fireEvent.click(card.getByText("1 sender got louder"));
    expect(cbs.onOpenLouder).toHaveBeenLastCalledWith("7d");
  });

test("the louder window: 7d for the week, a long visit gap and none", () => {
  expect(louderWindow("week", null, NOW_MS)).toBe("7d");
  expect(louderWindow("since", null, NOW_MS)).toBe("7d");
  expect(louderWindow("since", NOW_MS - 8 * DAY * 1000, NOW_MS)).toBe("7d");
  expect(louderWindow("since", NOW_MS - 6 * DAY * 1000, NOW_MS)).toBe("6d");
  expect(louderWindow("since", NOW_MS - 90 * 60_000, NOW_MS)).toBe("90min");
});

test("German rows", async () => {
  setLang("de");
  overview.mockResolvedValue(resp({ week: win({ ...LOUDER, ...BACK }) }));
  showOverview();
  const card = within(await screen.findByRole("region",
    { name: "Letzte Woche" }));
  await card.findByText("2 Absender sind lauter geworden");
  expect(card.getByText(
    /^Northwind News: 4 in den letzten 7\sTagen, sonst 1 pro Woche$/))
    .toBeTruthy();
  expect(card.getByText("1 meldet sich nach 14 Monaten wieder")).toBeTruthy();
  expect(card.getByText(
    "Harbor Books · du hast bisher nichts davon geöffnet")).toBeTruthy();
  expect(card.getByText("63 neue Mails")).toBeTruthy();
});

// ----------------------------------------------- the line above the Senders list

test("one line says why the rows are there: names and how much louder", () => {
  const groups = [
    mk("n@x.example", { louder: louder({ factor: 4, label: "Northwind News" }) }),
    mk("c@x.example", { louder: louder({ factor: 2.5, label: "Chirper" }) })];
  render(<ChangesNote filter={parseFilter("is:louder")} groups={groups} />);
  expect(screen.getByTestId("changes-note").textContent).toBe(
    "Got louder: their last 7 days vs their usual week"
    + " · Northwind News ×4, Chirper ×2.5");
});

test("the louder line names a shorter window and folds a long list", () => {
  const groups = ["a", "b", "c", "d", "e"].map((k, i) => mk(`${k}@x.example`, {
    louder: louder({ factor: 5 - i, label: `Sender ${k}` }) }));
  render(<ChangesNote filter={parseFilter("is:louder in:90min")}
    groups={groups} />);
  expect(screen.getByTestId("changes-note").textContent).toBe(
    "Got louder: their last 90 min vs their usual week"
    + " · Sender a ×5, Sender b ×4, Sender c ×3 and 2 more");
});

test("the came-back line, and both words together", () => {
  const groups = [mk("h@x.example", { back: back() }),
    mk("o@x.example", { back: back({ label: "Old Friend", ts: NOW - DAY,
      gap_days: 200 }) })];
  render(<ChangesNote filter={parseFilter("is:back is:louder")}
    groups={groups} />);
  const lines = within(screen.getByTestId("changes-note"))
    .getAllByRole("status").map((n) => n.textContent);
  expect(lines).toEqual([
    "Got louder: their last 7 days vs their usual week",
    "Came back after 6+ months of silence: first mail in the last 30 days"
    + " · Old Friend (6 months), Harbor Books (14 months)"]);
});

test("the line is German, and there is none without the words", () => {
  setLang("de");
  const { container } = render(<ChangesNote filter={parseFilter("is:back in:7d")}
    groups={[mk("h@x.example", { back: back() })]} />);
  expect(container.textContent).toBe(
    "Nach 6+ Monaten Stille wieder da: erste Mail in den letzten 7 d"
    + " · Harbor Books (14 Monate)");
  cleanup();
  const none = render(<ChangesNote filter={parseFilter("tag:news")}
    groups={[]} />);
  expect(none.container.textContent).toBe("");
});

test("window text and months", () => {
  expect(windowText(7 * DAY)).toBe("7 d");
  expect(windowText(3 * 3600)).toBe("3 h");
  expect(windowText(5400)).toBe("90 min");
  expect(monthsOf(456)).toBe(14);
  expect(monthsOf(183)).toBe(6);
});

// ------------------------------------------------------------ arrival strip

const stamps = Array.from({ length: 14 }, (_, d) =>
  new Date(2026, 0, d + 1, 6, 10).getTime() / 1000);

test("the strip keeps its line, bars and day chips and gains one line", () => {
  const notes = arrivalChangeLines({ louder: louder({ n: 4 }) });
  render(<ArrivalStrip stamps={stamps} notes={notes} />);
  expect(screen.getByText("Usually 06:00 - 07:00, every day")).toBeTruthy();
  expect(screen.getByRole("img", { name: /Mails of this sender per hour/ }))
    .toBeTruthy();
  expect(screen.getByText("Mon")).toBeTruthy();
  const lines = screen.getAllByTestId("strip-change");
  expect(lines.map((l) => l.textContent)).toEqual([
    "Last 7 days: 4 mails - more than twice its usual week"]);
});

test("the strip says when a sender came back; none without a change", () => {
  const notes = arrivalChangeLines({ back: back({ n: 3, ts: 1_700_000_000 }) });
  expect(notes).toHaveLength(1);
  render(<ArrivalStrip stamps={stamps} notes={notes} />);
  expect(screen.getByTestId("strip-change").textContent).toMatch(
    /^3 mails since .+, quiet for 14 months before$/);
  cleanup();
  expect(arrivalChangeLines({})).toEqual([]);
  render(<ArrivalStrip stamps={stamps} notes={[]} />);
  expect(screen.queryByTestId("strip-change")).toBeNull();
  expect(screen.getByText("Usually 06:00 - 07:00, every day")).toBeTruthy();
});

test("a sender with too few mails for a strip still shows its line", () => {
  const notes = arrivalChangeLines({ louder: louder({ n: 5 }) });
  render(<ArrivalStrip stamps={stamps.slice(0, 3)} notes={notes} />);
  expect(screen.getByTestId("strip-change")).toBeTruthy();
  expect(screen.queryByText(/^Usually/)).toBeNull();
  cleanup();
  const none = render(<ArrivalStrip stamps={stamps.slice(0, 3)} />);
  expect(none.container.textContent).toBe("");
});

test("the strip line is German", () => {
  setLang("de");
  render(<ArrivalStrip stamps={stamps}
    notes={arrivalChangeLines({ louder: louder({ n: 5 }) })} />);
  expect(screen.getByTestId("strip-change").textContent).toBe(
    "Letzte 7 Tage: 5 Mails – mehr als das Doppelte der üblichen Woche");
});

// -------------------------------------------------------- Statistics card

const CHANGES: SenderChangesResp = {
  days: 30, since: NOW - 90 * DAY,
  louder: [
    { key: "n@x.example", label: "Northwind News", unsub: true,
      protected: false, n: 4, usual: 1, factor: 4, start: NOW - 7 * DAY,
      end: NOW },
    { key: "c@x.example", label: "Chirper", unsub: false, protected: false,
      n: 15, usual: 6, factor: 2.5, start: NOW - 14 * DAY,
      end: NOW - 7 * DAY },
    { key: "p@x.example", label: "Pinned Shop", unsub: true, protected: true,
      n: 6, usual: 1, factor: 6, start: NOW - 7 * DAY, end: NOW }],
  back: [
    { key: "h@x.example", label: "Harbor Books", unsub: true,
      protected: false, ts: NOW - 5 * DAY, gap_days: 456, n: 3 },
    { key: "b@x.example", label: "Blocked Co", unsub: false,
      protected: false, ts: NOW - 6 * DAY, gap_days: 300, n: 1 },
    { key: "q@x.example", label: "Kept Friend", unsub: false,
      protected: true, ts: NOW - 4 * DAY, gap_days: 400, n: 2 }],
};
const RHYTHM = (daily: string[] = []) => {
  const blank = () => Array.from({ length: 7 }, () => Array(24).fill(0));
  const kind = () => ({ total: 0, grid: blank(), top: {} });
  return { period: "12m", tz: "Europe/Berlin", from: 0,
    kinds: { all: kind(), newsletters: kind(), people: kind(), orders: kind() },
    daily: daily.map((k) => ({ key: k, label: k, hour: 6, per_day: 4.1,
      mails: 123, open_pct: 2 })) };
};
const acts = { onUnsubscribe: vi.fn(), onBlock: vi.fn(), onShowMails: vi.fn(),
  onClose: vi.fn() };
const card = async () => within(await screen.findByRole("heading",
  { name: "Changes in the last 30 days" }).then((h) => h.closest("section")!));

beforeEach(() => {
  Object.values(acts).forEach((f) => f.mockClear());
  rhythm.mockResolvedValue(RHYTHM());
  senderChanges.mockResolvedValue(CHANGES);
});

test("the Statistics card: rows, figures and the fitting action", async () => {
  render(<StatsPanel {...acts} blockedKeys={new Set(["b@x.example"])} />);
  const c = await card();
  expect(c.getByText("vs each sender's usual week")).toBeTruthy();
  expect(c.getByRole("region", { name: "Got louder" })).toBeTruthy();
  expect(c.getByRole("region", { name: "Came back" })).toBeTruthy();
  // louder: 4 a week, usually 1 - ×4, Unsubscribe… (an unsubscribe is open)
  const north = within(c.getByText("Northwind News").closest("li")!);
  expect(north.getByText("×4")).toBeTruthy();
  expect(north.getByText("4 a week, usually 1")).toBeTruthy();
  fireEvent.click(north.getByRole("button", { name: "Unsubscribe…" }));
  expect(acts.onUnsubscribe).toHaveBeenCalledWith("n@x.example");
  // an older week says which one; without an unsubscribe: Show mails
  const chirp = within(c.getByText("Chirper").closest("li")!);
  expect(chirp.getByText("×2.5")).toBeTruthy();
  expect(chirp.getByText(/^15 in the 7 days to .+, usually 6 a week$/))
    .toBeTruthy();
  fireEvent.click(chirp.getByRole("button", { name: "Show mails" }));
  expect(acts.onShowMails).toHaveBeenCalledWith("c@x.example");
  // protected senders only get Show mails
  const pinned = within(c.getByText("Pinned Shop").closest("li")!);
  expect(pinned.queryByRole("button", { name: "Unsubscribe…" })).toBeNull();
  fireEvent.click(pinned.getByRole("button", { name: "Show mails" }));
  expect(acts.onShowMails).toHaveBeenLastCalledWith("p@x.example");
  // came back: Block…, unless it is blocked already
  const harbor = within(c.getByText("Harbor Books").closest("li")!);
  expect(harbor.getByText(/^3 mails since .+, quiet for 14 months before$/))
    .toBeTruthy();
  fireEvent.click(harbor.getByRole("button", { name: "Block…" }));
  expect(acts.onBlock).toHaveBeenCalledWith("h@x.example");
  const blocked = within(c.getByText("Blocked Co").closest("li")!);
  expect(blocked.getByText(/^1 mail since .+, quiet for 9 months before$/))
    .toBeTruthy();
  expect(blocked.queryByRole("button", { name: "Block…" })).toBeNull();
  expect(blocked.getByRole("button", { name: "Show mails" })).toBeTruthy();
  // a protected sender that came back is not offered a Block either
  const friend = within(c.getByText("Kept Friend").closest("li")!);
  expect(friend.queryByRole("button", { name: "Block…" })).toBeNull();
  fireEvent.click(friend.getByRole("button", { name: "Show mails" }));
  expect(acts.onShowMails).toHaveBeenLastCalledWith("q@x.example");
  expect(c.getByText(
    "Senders already named in “What stands out” are left out here."))
    .toBeTruthy();
});

test("the card comes after When mail arrives and before Top senders", async () => {
  render(<StatsPanel {...acts} />);
  await card();
  const heads = screen.getAllByRole("heading").map((h) => h.textContent);
  const at = (name: string) => heads.indexOf(name);
  expect(at("When mail arrives")).toBeGreaterThan(-1);
  expect(at("Changes in the last 30 days")).toBeGreaterThan(at("When mail arrives"));
  expect(at("Top senders")).toBeGreaterThan(at("Changes in the last 30 days"));
});

test("senders What stands out already names are left out; no rows, no card",
  async () => {
    rhythm.mockResolvedValue(RHYTHM(["n@x.example", "h@x.example"]));
    render(<StatsPanel {...acts} />);
    const c = await card();
    expect(c.queryByText("Northwind News")).toBeNull();
    expect(c.queryByText("Harbor Books")).toBeNull();
    expect(c.getByText("Chirper")).toBeTruthy();
    cleanup();
    // everything named: the card is gone
    senderChanges.mockResolvedValue({ ...CHANGES, back: [CHANGES.back[0]] });
    rhythm.mockResolvedValue(RHYTHM(["n@x.example", "c@x.example",
      "p@x.example", "h@x.example"]));
    render(<StatsPanel {...acts} />);
    await screen.findAllByText(/mails you every day at/i);
    await waitFor(() => expect(senderChanges).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("heading", { name: "Changes in the last 30 days" }))
      .toBeNull();
  });

test("no change = no card; a failing request hides it; the rest stays", async () => {
  senderChanges.mockResolvedValue({ ...CHANGES, louder: [], back: [] });
  render(<StatsPanel {...acts} />);
  await screen.findByRole("heading", { name: "When mail arrives" });
  await waitFor(() => expect(senderChanges).toHaveBeenCalled());
  expect(screen.queryByRole("heading", { name: "Changes in the last 30 days" }))
    .toBeNull();
  cleanup();
  senderChanges.mockRejectedValue(new Error("offline"));
  render(<StatsPanel {...acts} />);
  await screen.findByRole("heading", { name: "When mail arrives" });
  await screen.findByRole("heading", { name: "Top senders" });
  expect(screen.queryByRole("heading", { name: "Changes in the last 30 days" }))
    .toBeNull();
  // Statistics still has what it had
  expect(screen.getByText("What stands out")).toBeTruthy();
});

test("the Statistics card is German", async () => {
  setLang("de");
  render(<StatsPanel {...acts} />);
  const c = within((await screen.findByRole("heading",
    { name: "Änderungen der letzten 30 Tage" })).closest("section")!);
  expect(c.getByText("im Vergleich zur üblichen Woche jedes Absenders"))
    .toBeTruthy();
  expect(c.getByRole("region", { name: "Lauter geworden" })).toBeTruthy();
  expect(c.getByRole("region", { name: "Wieder da" })).toBeTruthy();
  expect(c.getByText("4 pro Woche, sonst 1")).toBeTruthy();
  expect(c.getByRole("button", { name: "Abbestellen…" })).toBeTruthy();
  expect(c.getAllByRole("button", { name: "Blockieren…" })).toHaveLength(2);
  expect(c.getAllByRole("button", { name: "Mails anzeigen" }).length)
    .toBeGreaterThan(0);
  expect(c.getByText(
    "Absender, die schon unter „Was auffällt“ stehen, sind hier weggelassen."))
    .toBeTruthy();
});

test("rows render without the action handlers (nothing to call)", () => {
  render(<ChangesRows data={CHANGES} named={new Set()} nowS={NOW}
    blocked={new Set()} />);
  expect(screen.getAllByRole("button", { name: "Show mails" }).length)
    .toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button", { name: "Show mails" })[0]);
});
