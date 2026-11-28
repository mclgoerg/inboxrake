// @vitest-environment jsdom
/* The Weekly check-in stepper: one step per place that has something (the
 * server says which; empty ones are skipped), Skip / Back / Next, a place that
 * is kept when you close and the card at the end that only counts what you
 * did. Each step hosts that place's own list and its own actions - the app's
 * confirmed Block / Trash / Unsubscribe, Mail past its date's move, Waiting's
 * Remind me, the Rule checkup's buttons, Junk's Not junk / Block / Trash. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const checkin = vi.fn();
const expired = vi.fn();
const expiredMails = vi.fn();
const deleteMessages = vi.fn();
const keepSafeCheck = vi.fn();
const waiting = vi.fn();
const waitingRemind = vi.fn();
const waitingNeeded = vi.fn();
const ruleCheckup = vi.fn();
const ignoreFinding = vi.fn();
const deleteRule = vi.fn();
const foldersPanel = vi.fn();
const folderMove = vi.fn();

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    checkin: (...a: unknown[]) => checkin(...a),
    expired: () => expired(),
    expiredMails: (...a: unknown[]) => expiredMails(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    keepSafeCheck: (...a: unknown[]) => keepSafeCheck(...a),
    waiting: () => waiting(),
    waitingRemind: (...a: unknown[]) => waitingRemind(...a),
    waitingNeeded: (...a: unknown[]) => waitingNeeded(...a),
    ruleCheckup: () => ruleCheckup(),
    ignoreFinding: (...a: unknown[]) => ignoreFinding(...a),
    deleteRule: (...a: unknown[]) => deleteRule(...a),
    foldersPanel: (...a: unknown[]) => foldersPanel(...a),
    folderMove: (...a: unknown[]) => folderMove(...a),
  },
}));

import { WeeklyCheckin } from "./components/WeeklyCheckin";
import type { CheckinActions } from "./components/CheckinSteps";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import { loadProgress, progressKey, weekId } from "./checkin";
import { setClockShift } from "./clock";
import { setLang } from "./i18n";
import type { CheckinPlace, CheckinResp, CheckupFinding, Group, Rule,
  RuleCheckup, SenderGroup, WaitingItem } from "./types";

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const MB = 1048576;

/** an unsubscribe that ran to the end */
const DONE_UNSUB = { n: 1, of: 1, status: "done" as const, link: "",
  addr: "" };
const group = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: `Sender ${key.split("@")[0]}`, sub: key, count: 12, size: MB,
  unread: 0, first: "2026-01-01", last: "2026-11-20", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50, ...over });
const fresh = (key: string, over: Partial<Group> = {}) => group(key, {
  new: true, new_ts: NOW - 2 * DAY, unsub: true, ...over });
const late = (key: string, over: Partial<Group> = {}) => group(key, {
  unsub: true, unsubscribed: { ...DONE_UNSUB },
  still_mailing: { n: 14, senders: 1, since_ts: NOW - 30 * DAY,
    last_ts: NOW - DAY, addrs: [key] }, ...over });
const GROUPS: Record<string, Group> = Object.fromEntries([
  fresh("acme@x.example", { count: 14 }), fresh("chirp@x.example", { count: 9 }),
  fresh("deal@x.example", { count: 4, unsub: false }),
  late("store@x.example", { count: 20, pinned: 2 }),
  late("hunt@x.example", { count: 5 }),
  group("old@x.example"),
].map((g) => [g.key, g]));

const resp = (...ids: CheckinPlace[]): CheckinResp => ({
  window: "week", from: NOW - 7 * DAY, things: ids.length,
  minutes: Math.max(1, Math.ceil(ids.length / 3)),
  steps: ids.map((id) => ({ id, n: 3 })) });

const actions = {
  blockGroup: vi.fn(), trashGroup: vi.fn(), unsubscribe: vi.fn(),
  blockAddress: vi.fn(), protect: vi.fn(), undo: vi.fn(), changed: vi.fn(),
};
// the mocks stand in for the app's own, confirmed actions
const host = actions as unknown as CheckinActions;
const navigate = vi.fn();
const onClose = vi.fn();

const RULE: Rule = { id: "r4", name: "Archive old event tickets",
  scope: "mail", grouping: "sender", query: "tag:travel", action: "archive",
  dest: "", schedule: "weekly", mode: "execute", keep_latest: null,
  older_than_days: null, origin: "manual", report_runs: 1, created: 1,
  last_run: null };

type Props = Partial<React.ComponentProps<typeof WeeklyCheckin>>;
const show = (props: Props = {}) => render(
  <ToastProvider><DialogProvider>
    <WeeklyCheckin account="proton" since={null} groups={GROUPS}
      blockedKeys={new Set()} rules={[RULE]}
      actions={host} navigate={navigate} onClose={onClose} {...props} />
  </DialogProvider></ToastProvider>);

const dialog = () => screen.getByRole("dialog", { name: "Weekly check-in" });
const header = () => screen.getByText(/^Weekly check-in · step/).textContent;
const step = async (place: CheckinPlace) =>
  within(await screen.findByTestId(`checkin-step-${place}`));
const next = () => screen.getByRole("button", { name: /^(Next|Finish)/ });
/** the text Close button (the header has its own X) */
const closeText = () => screen.getAllByRole("button", { name: "Close" }).at(-1)!;
/** counts and their nouns are joined by a no-break space */
const nb = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");
const texts = (rows: HTMLElement[]) => rows.map((r) => nb(r.textContent));

beforeEach(() => {
  setLang("en");
  checkin.mockReset().mockResolvedValue(resp("new", "still", "junk"));
  for (const f of [expired, expiredMails, deleteMessages, waiting,
    waitingRemind, waitingNeeded, ruleCheckup, ignoreFinding, deleteRule,
    foldersPanel, folderMove, onClose, navigate]) f.mockReset();
  for (const f of Object.values(actions)) f.mockReset();
  actions.blockGroup.mockResolvedValue(true);
  // what the app's own move queued (see below)
  actions.trashGroup.mockResolvedValue(15);
  actions.blockAddress.mockResolvedValue(true);
  actions.protect.mockResolvedValue(true);
  keepSafeCheck.mockReset().mockResolvedValue({ total: 0, kept: 0,
    classes: [] });
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  ignoreFinding.mockResolvedValue({ ok: true });
  deleteRule.mockResolvedValue({});
  waitingRemind.mockResolvedValue({ ok: true, at: 1 });
  waitingNeeded.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup(); setClockShift(0); localStorage.clear(); setLang("en");
  vi.unstubAllGlobals();
});

/* ------------------------------ the walk ---------------------------------- */

test("one step per place the server lists, in order, each skipped when empty",
  async () => {
  show();
  await step("new");
  expect(header()).toBe("Weekly check-in · step 1 of 3");
  expect(within(dialog()).getByText("about 1 minute")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-label")).toBe("Step 1 of 3: New senders");
  expect([...bar.children].map((c) => c.getAttribute("data-state")))
    .toEqual(["now", "todo", "todo"]);
  // the primary button names the next place; the places that have nothing
  // (mail past its date, replies, the rule checkup) are not in the walk
  expect(next().textContent).toBe(
    "Next: Still mailing after you unsubscribed");
  fireEvent.click(next());
  await step("still");
  expect(header()).toBe("Weekly check-in · step 2 of 3");
  expect(next().textContent).toBe("Next: Junk waiting");
  expect([...screen.getByRole("progressbar").children]
    .map((c) => c.getAttribute("data-state")))
    .toEqual(["done", "now", "todo"]);
  expect(expired).not.toHaveBeenCalled();
  expect(waiting).not.toHaveBeenCalled();
  expect(ruleCheckup).not.toHaveBeenCalled();
});

test("Back goes back, Skip moves on; the last step ends in Finish", async () => {
  foldersPanel.mockResolvedValue({ folder: "Junk", uv: 1, total: 0, max_uid: 0,
    mails: [], senders: [] });
  show();
  await step("new");
  expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement)
    .disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await step("still");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await step("new");
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await step("junk");
  expect(header()).toBe("Weekly check-in · step 3 of 3");
  expect(next().textContent).toBe("Finish");
  fireEvent.click(next());
  expect(await screen.findByTestId("checkin-done")).toBeTruthy();
});

test("the card at the end only counts what you did", async () => {
  checkin.mockResolvedValue(resp("new", "still"));
  show();
  await step("new");
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));   // skipped
  await step("still");
  fireEvent.click(next());                                         // Finish
  const done = await screen.findByTestId("checkin-done");
  // one step walked through, nothing confirmed: no counts, no Undo claim
  expect(done.textContent).toContain("Done for this week");
  expect(done.textContent).toContain("1 step.");
  expect(done.textContent).not.toContain("Undo");
  expect(within(dialog()).queryByRole("button", { name: "Skip" })).toBeNull();
  fireEvent.click(closeText());
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("skipping everything says nothing changed", async () => {
  checkin.mockResolvedValue(resp("new"));
  show();
  await step("new");
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect((await screen.findByTestId("checkin-done")).textContent).toContain(
    "You skipped everything - nothing changed.");
});

test("closing keeps your place until next week", async () => {
  const a = show();
  await step("new");
  fireEvent.click(next());
  await step("still");
  fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  const kept = loadProgress("proton", Date.now())!;
  expect(kept.at).toBe("still");
  expect(kept.went).toEqual(["new"]);
  a.unmount();
  // opened again the same week: back on that step, the first one counted
  show();
  await step("still");
  expect(header()).toBe("Weekly check-in · step 2 of 3");
  cleanup();
  // a week later: the place is gone, it starts at the first step
  setClockShift(-8 * DAY * 1000);
  show();
  await step("new");
  expect(header()).toBe("Weekly check-in · step 1 of 3");
});

test("the time you spent is kept with the place and told at the end; a tab " +
  "left open overnight does not count for hours", async () => {
  checkin.mockResolvedValue(resp("new", "still"));
  const a = show();
  await step("new");
  fireEvent.click(next());
  await step("still");
  setClockShift(-5 * 60_000);                    // five minutes later
  fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
  const kept = loadProgress("proton", Date.now() + 5 * 60_000)!;
  expect(kept.ms).toBeGreaterThanOrEqual(5 * 60_000);
  expect(kept.ms).toBeLessThan(5 * 60_000 + 5000);
  a.unmount();
  // the next sitting adds to it: 3 more minutes, then the card says 8
  setClockShift(-5 * 60_000);
  show();
  await step("still");
  setClockShift(-8 * 60_000);
  fireEvent.click(next());
  const done = await screen.findByTestId("checkin-done");
  expect(done.textContent).toContain("8 min");
  cleanup();
  // overnight in one sitting: at most half an hour
  localStorage.clear();
  setClockShift(0);
  show();
  await step("new");
  setClockShift(-10 * 3600_000);
  fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
  expect(loadProgress("proton", Date.now() + 10 * 3600_000)!.ms)
    .toBeLessThanOrEqual(30 * 60_000);
});

test("a kept place whose place has emptied resumes at the next one", async () => {
  localStorage.setItem(progressKey("proton"), JSON.stringify({
    week: weekId(Date.now()), at: "past", went: ["new", "still"],
    did: {}, ms: 0 }));
  show();
  // "past" has nothing now: the next place that has something is Junk
  foldersPanel.mockResolvedValue({ folder: "Junk", uv: 1, total: 0, max_uid: 0,
    mails: [], senders: [] });
  await step("junk");
  expect(header()).toBe("Weekly check-in · step 3 of 3");
});

test("a kept place with nothing after it goes straight to the card",
  async () => {
  // the kept place was Junk, which has emptied since: nothing is left after it
  checkin.mockResolvedValue(resp("new", "still"));
  localStorage.setItem(progressKey("proton"), JSON.stringify({
    week: weekId(Date.now()), at: "junk", went: ["new", "still"],
    did: { blocked: 2 }, ms: 0 }));
  show();
  const done = await screen.findByTestId("checkin-done");
  expect(done.textContent).toContain("2 steps");
  expect(done.textContent).toContain("2 senders blocked");
});

test("finishing clears the kept place; closing the card keeps nothing",
  async () => {
  checkin.mockResolvedValue(resp("new"));
  show();
  await step("new");
  fireEvent.click(next());
  await screen.findByTestId("checkin-done");
  expect(localStorage.getItem(progressKey("proton"))).toBeNull();
  fireEvent.click(closeText());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(progressKey("proton"))).toBeNull();
});

test("Esc closes it like Close, keeping the place", async () => {
  show();
  await step("new");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(loadProgress("proton", Date.now())?.at).toBe("new");
});

test("nothing to look at: a note and Close; a failed load can be retried",
  async () => {
  checkin.mockResolvedValue(resp());
  const a = show();
  expect((await screen.findByTestId("checkin-none")).textContent)
    .toBe("Nothing needs you right now.");
  expect(screen.queryByRole("progressbar")).toBeNull();
  a.unmount();
  checkin.mockReset().mockRejectedValueOnce(new Error("down"))
    .mockResolvedValue(resp("new"));
  show();
  expect(await screen.findByText("Couldn't load your check-in.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await step("new");
});

test("the window of the Last week card: 7 days, or since the last visit",
  async () => {
  const a = show();
  await step("new");
  expect(checkin).toHaveBeenLastCalledWith(null);
  a.unmount();
  const left = Date.now() - 3 * 3600_000;
  show({ since: left });
  await step("new");
  expect(checkin).toHaveBeenLastCalledWith(left / 1000);
});

test("German: header, buttons, places and the card", async () => {
  setLang("de");
  checkin.mockResolvedValue(resp("new", "still"));
  show();
  await screen.findByTestId("checkin-step-new");
  expect(screen.getByText("Wochen-Check · Schritt 1 von 2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Zurück" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Überspringen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Weiter: Schreiben trotz "
    + "Abmeldung weiter" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Überspringen" }));
  fireEvent.click(await screen.findByRole("button", { name: "Fertig" }));
  expect((await screen.findByTestId("checkin-done")).textContent).toContain(
    "Fertig für diese Woche");
});

test("phones: the next button is a plain Next", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("639"), media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  show();
  await step("new");
  expect(next().textContent).toBe("Next");
});

/* --------------------------- new senders / still -------------------------- */

test("new senders: the list of Senders › is:new, most mail first, each with " +
  "its own actions", async () => {
  show();
  const s = await step("new");
  const rows = s.getAllByTestId("checkin-row");
  expect(texts(rows)).toEqual([
    expect.stringContaining("Sender acme"),
    expect.stringContaining("Sender chirp"),
    expect.stringContaining("Sender deal")]);
  // not the ones that are old or that keep mailing after an unsubscribe
  expect(s.queryByText("Sender old")).toBeNull();
  expect(texts(rows)[0]).toMatch(/first seen .+ · 14 mails/);
  // Keep / Unsubscribe… / Block…; a sender without an unsubscribe has none
  const first = within(rows[0]);
  expect(first.getByRole("button", { name: /^Keep/ })).toBeTruthy();
  expect(first.getByRole("button", { name: /^Unsubscribe…/ })).toBeTruthy();
  expect(first.getByRole("button", { name: /^Block…/ })).toBeTruthy();
  expect(within(rows[2]).queryByRole("button", { name: /^Unsubscribe…/ }))
    .toBeNull();
});

test("Block… is the app's confirmed Block and counts only when it went " +
  "ahead", async () => {
  actions.blockGroup.mockResolvedValueOnce(false).mockResolvedValue(true);
  checkin.mockResolvedValue(resp("new"));
  show();
  const s = await step("new");
  const row = within(s.getAllByTestId("checkin-row")[0]);
  fireEvent.click(row.getByRole("button", { name: /^Block…/ }));
  await waitFor(() => expect(actions.blockGroup).toHaveBeenCalledTimes(1));
  expect(actions.blockGroup.mock.calls[0][0].key).toBe("acme@x.example");
  // declined at its confirm: the button is still there, nothing counted
  fireEvent.click(await row.findByRole("button", { name: /^Block…/ }));
  await waitFor(() => expect(actions.blockGroup).toHaveBeenCalledTimes(2));
  fireEvent.click(next());
  const done = await screen.findByTestId("checkin-done");
  expect(done.textContent).toContain("1 step · 1 sender blocked.");
  expect(done.textContent).toContain("Every step is in Activity with its own "
    + "Undo.");
});

test("a sender that already has a Block rule shows Blocked, not the button",
  async () => {
  show({ blockedKeys: new Set(["acme@x.example"]) });
  const s = await step("new");
  const row = within(s.getAllByTestId("checkin-row")[0]);
  expect(row.getByText("Blocked")).toBeTruthy();
  expect(row.queryByRole("button", { name: /^Block…/ })).toBeNull();
});

test("Keep leaves the sender as it is and says so in its row", async () => {
  show();
  const s = await step("new");
  const row = within(s.getAllByTestId("checkin-row")[1]);
  fireEvent.click(row.getByRole("button", { name: /^Keep/ }));
  expect(row.getByText("Kept")).toBeTruthy();
  expect(row.queryByRole("button", { name: /^Keep/ })).toBeNull();
  for (const f of Object.values(actions)) expect(f).not.toHaveBeenCalled();
});

test("Unsubscribe… opens the app's unsubscribe sheet; it counts once it ran " +
  "to the end", async () => {
  checkin.mockResolvedValue(resp("new"));
  const a = show();
  const s = await step("new");
  fireEvent.click(within(s.getAllByTestId("checkin-row")[0]).getByRole(
    "button", { name: /^Unsubscribe…/ }));
  expect(actions.unsubscribe).toHaveBeenCalledTimes(1);
  expect(actions.unsubscribe.mock.calls[0][0].key).toBe("acme@x.example");
  // the sheet did its work: the sender now reads as unsubscribed
  const live = { ...GROUPS, "acme@x.example": { ...GROUPS["acme@x.example"],
    unsubscribed: { ...DONE_UNSUB } } };
  a.rerender(
    <ToastProvider><DialogProvider>
      <WeeklyCheckin account="proton" since={null} groups={live}
        blockedKeys={new Set()} rules={[RULE]} actions={host}
        navigate={navigate} onClose={onClose} />
    </DialogProvider></ToastProvider>);
  expect(await s.findByText("Unsubscribed")).toBeTruthy();
  fireEvent.click(next());
  expect((await screen.findByTestId("checkin-done")).textContent)
    .toContain("1 sender unsubscribed");
});

test("an unsubscribe that was never finished (the sheet was closed) counts " +
  "nothing", async () => {
  checkin.mockResolvedValue(resp("new"));
  show();
  const s = await step("new");
  fireEvent.click(within(s.getAllByTestId("checkin-row")[0]).getByRole(
    "button", { name: /^Unsubscribe…/ }));
  expect(actions.unsubscribe).toHaveBeenCalledTimes(1);
  // the sender is still not unsubscribed: no tag, and the button stays
  expect(s.queryByText("Unsubscribed")).toBeNull();
  fireEvent.click(next());
  const done = (await screen.findByTestId("checkin-done")).textContent;
  expect(done).toContain("1 step.");
  expect(done).not.toContain("unsubscribed");
});

test("still mailing: Block… and Trash…; trashing counts what the app's move " +
  "queued - not the group's count", async () => {
  checkin.mockResolvedValue(resp("still"));
  show();
  const s = await step("still");
  const rows = s.getAllByTestId("checkin-row");
  expect(texts(rows)).toEqual([
    expect.stringMatching(/Sender store.*unsubscribed .+ · 14 mails since/),
    expect.stringMatching(/Sender hunt.*14 mails since/)]);
  expect(s.queryByText("Sender acme")).toBeNull();
  const row = within(rows[0]);
  expect(row.queryByRole("button", { name: /^Unsubscribe…/ })).toBeNull();
  fireEvent.click(row.getByRole("button", { name: /^Trash…/ }));
  await waitFor(() => expect(actions.trashGroup).toHaveBeenCalledTimes(1));
  expect(actions.trashGroup.mock.calls[0][0].key).toBe("store@x.example");
  expect(await row.findByText("Moved to Trash")).toBeTruthy();
  expect(row.queryByRole("button", { name: /^Trash…/ })).toBeNull();
  fireEvent.click(next());
  // 20 mails, 2 pinned, 3 more kept safe by the confirm: the move took 15
  expect((await screen.findByTestId("checkin-done")).textContent)
    .toContain("15 mails to Trash");
});

test("a Trash… that was declined (null) counts nothing and keeps the button",
  async () => {
  actions.trashGroup.mockResolvedValue(null);
  checkin.mockResolvedValue(resp("still"));
  show();
  const s = await step("still");
  const row = within(s.getAllByTestId("checkin-row")[0]);
  fireEvent.click(row.getByRole("button", { name: /^Trash…/ }));
  await waitFor(() => expect(actions.trashGroup).toHaveBeenCalledTimes(1));
  expect(row.queryByText("Moved to Trash")).toBeNull();
  expect(row.getByRole("button", { name: /^Trash…/ })).toBeTruthy();
  fireEvent.click(next());
  expect((await screen.findByTestId("checkin-done")).textContent)
    .not.toContain("to Trash");
});

test("more senders than fit: a link to the full list in Senders, which " +
  "closes the check-in and keeps the place", async () => {
  const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => {
    const g = fresh(`n${i}@x.example`, { count: 50 - i });
    return [g.key, g];
  }));
  checkin.mockResolvedValue(resp("new", "junk"));
  show({ groups: many });
  const s = await step("new");
  expect(s.getAllByTestId("checkin-row")).toHaveLength(8);
  fireEvent.click(s.getByRole("button", { name: "Show all 11 in Senders" }));
  expect(navigate).toHaveBeenCalledWith({ to: "senders",
    query: "is:new in:7d" });
  expect(loadProgress("proton", Date.now())?.at).toBe("new");
});

test("since your last visit the lists use that window", async () => {
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => {
    const g = fresh(`n${i}@x.example`, { new_ts: NOW - 60 });
    return [g.key, g];
  }));
  const left = Date.now() - 3 * 3600_000;
  checkin.mockResolvedValue(resp("new"));
  show({ groups: many, since: left });
  const s = await step("new");
  fireEvent.click(s.getByRole("button", { name: "Show all 10 in Senders" }));
  expect(navigate.mock.calls[0][0].query).toMatch(
    /^is:new in:(3h|181min|180min)$/);
});

test("nothing in the list any more: a quiet note", async () => {
  show({ groups: { "old@x.example": GROUPS["old@x.example"] } });
  const s = await step("new");
  expect(s.getByTestId("checkin-empty").textContent).toBe("All done here.");
});

/* --------------------------- mail past its date --------------------------- */

const EXPIRED = { mails: 148, size: 9.6 * MB, kept: 18,
  reasons: [
    { id: "codes", mails: 64, size: 1.1 * MB, ticked: true },
    { id: "parcels", mails: 52, size: 4 * MB, ticked: true },
    { id: "events", mails: 21, size: 2.9 * MB, ticked: true },
    { id: "offers", mails: 11, size: 1.6 * MB, ticked: false }] };

test("mail past its date: the sheet's reasons with their ticks; Move N to " +
  "Trash… is the same confirmed per-mail step", async () => {
  checkin.mockResolvedValue(resp("past"));
  expired.mockResolvedValue(EXPIRED);
  expiredMails.mockResolvedValue({ items: [["INBOX", 1], ["INBOX", 2]] });
  show();
  const s = await step("past");
  expect(await s.findAllByTestId("past-reason")).toHaveLength(4);
  expect((s.getByRole("checkbox", { name: "Offers that have ended" }) as
    HTMLInputElement).checked).toBe(false);          // offers start unticked
  expect(s.getByTestId("past-kept").textContent).toContain("Kept:");
  fireEvent.click(s.getByRole("button", { name: "Move 137 to Trash…" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1], ["INBOX", 2]], "trash"));
  expect(expiredMails).toHaveBeenCalledWith(["codes", "parcels", "events"]);
  expect(actions.changed).toHaveBeenCalled();
  expect(await s.findByText(/2 mails are on their way to Trash/)).toBeTruthy();
  fireEvent.click(next());
  expect((await screen.findByTestId("checkin-done")).textContent)
    .toContain("2 mails past their date to Trash");
});

test("a declined confirm moves and counts nothing", async () => {
  checkin.mockResolvedValue(resp("past"));
  expired.mockResolvedValue(EXPIRED);
  expiredMails.mockResolvedValue({ items: [["INBOX", 1]] });
  show();
  const s = await step("past");
  fireEvent.click(await s.findByRole("button", { name: "Move 137 to Trash…" }));
  await findDialog();
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(s.queryByText(/on their way to Trash/)).toBeNull();
  fireEvent.click(next());
  expect((await screen.findByTestId("checkin-done")).textContent)
    .not.toContain("past their date");
});

test("Show them and Open in All mail hand over to the app", async () => {
  checkin.mockResolvedValue(resp("past"));
  expired.mockResolvedValue(EXPIRED);
  show();
  const s = await step("past");
  fireEvent.click(await s.findByRole("button", { name: "Show them" }));
  expect(navigate).toHaveBeenLastCalledWith({ to: "kept", n: 18 });
  fireEvent.click(s.getByRole("button", { name: "Open in All mail" }));
  expect(navigate).toHaveBeenLastCalledWith({ to: "all",
    query: "is:expired" });
});

/* ------------------------------ replies overdue --------------------------- */

const waitItem = (id: string, name: string, over: Partial<WaitingItem> = {}):
  WaitingItem => ({ id, uid: 1, state: "open",
  person: { addr: `${name.toLowerCase()}@x.example`, name }, subject: `Re ${name}`,
  ts: NOW - 6 * DAY, age: 6 * DAY, days: 6, overdue: true, limit_days: 3,
  usual_days: null, usual_n: 0, answered_ts: null, answered_days: null,
  recipients: 1, reminder: null, ...over });

const waitingResp = (items: WaitingItem[]) => ({ watching: true,
  scanned: true, mode: "usual", days: 3, counts: {}, kpis: {},
  summary: {}, items });

test("replies overdue: only the overdue ones, Remind me and No answer " +
  "needed", async () => {
  checkin.mockResolvedValue(resp("waiting"));
  waiting.mockResolvedValue(waitingResp([
    waitItem("<a@s>", "Pat", { age: 9 * DAY, days: 9 }),
    waitItem("<b@s>", "Lee"),
    waitItem("<c@s>", "Sam", { overdue: false }),
    waitItem("<d@s>", "Kim", { state: "answered" })]));
  show();
  const s = await step("waiting");
  const rows = await s.findAllByTestId("checkin-row");
  expect(texts(rows)).toEqual([
    expect.stringMatching(/Pat.*Re Pat · 9 days/),
    expect.stringMatching(/Lee.*Re Lee · 6 days/)]);
  // Remind me: tomorrow 09:00 - the existing endpoint, the existing times
  const pat = within(rows[0]);
  fireEvent.click(pat.getByRole("button", { name: "Remind me" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Tomorrow/ }));
  await waitFor(() => expect(waitingRemind).toHaveBeenCalledTimes(1));
  const [id, at] = waitingRemind.mock.calls[0];
  expect(id).toBe("<a@s>");
  const d = new Date(at * 1000);
  expect([d.getHours(), d.getMinutes()]).toEqual([9, 0]);
  expect(await pat.findByText(/^Reminder set for/)).toBeTruthy();
  // No answer needed, with an Undo in the toast
  const lee = within(rows[1]);
  fireEvent.click(lee.getByRole("button", { name: /^No answer needed/ }));
  await waitFor(() => expect(waitingNeeded).toHaveBeenCalledWith("<b@s>", true));
  expect(await lee.findByText("Marked as not needing an answer.")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(waitingNeeded).toHaveBeenLastCalledWith(
    "<b@s>", false));
  fireEvent.click(next());
  const done = (await screen.findByTestId("checkin-done")).textContent;
  expect(done).toContain("1 reminder set");
  expect(done).toContain("1 marked as no answer needed");
});

/* -------------------------------- rule checkup ---------------------------- */

const NEVER: CheckupFinding = { id: "f3", kind: "never_matches",
  rules: ["r4"], ignored: false, runs: 8, since: 1_759_300_000 };
const checkupOf = (findings: CheckupFinding[]): RuleCheckup => ({
  account: "proton", scanned_ts: NOW - 120, analysed: true, needs_scan: false,
  checked: 0, rules: 1, findings });

test("the rule checkup: the Rules page's findings with the same buttons",
  async () => {
  checkin.mockResolvedValue(resp("rules"));
  ruleCheckup.mockResolvedValue(checkupOf([NEVER]));
  show();
  const s = await step("rules");
  const finding = (await s.findByText(/Archive old event tickets/))
    .closest("li")!;
  const f = within(finding);
  // Edit… opens that rule's editor on the Rules page
  fireEvent.click(f.getByRole("button", { name: "Edit…" }));
  expect(navigate).toHaveBeenLastCalledWith({ to: "rules", edit: "r4" });
  // Ignore: the existing endpoint, then the list is read again
  fireEvent.click(f.getByRole("button", { name: "Ignore" }));
  await waitFor(() => expect(ignoreFinding).toHaveBeenCalledWith("f3", true));
  await waitFor(() => expect(ruleCheckup).toHaveBeenCalledTimes(2));
  fireEvent.click(next());
  expect((await screen.findByTestId("checkin-done")).textContent)
    .toContain("1 rule finding dealt with");
});

test("Delete… asks the rule's own confirm first", async () => {
  checkin.mockResolvedValue(resp("rules"));
  ruleCheckup.mockResolvedValue(checkupOf([NEVER]));
  show();
  const s = await step("rules");
  const f = within((await s.findByText(/Archive old event tickets/))
    .closest("li")!);
  fireEvent.click(f.getByRole("button", { name: "Delete…" }));
  await findDialog();
  await cancelDialog();
  await expectNoDialog();
  expect(deleteRule).not.toHaveBeenCalled();
  fireEvent.click(f.getByRole("button", { name: "Delete…" }));
  await pressDialog("Delete");
  await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("r4"));
  expect(actions.changed).toHaveBeenCalled();
});

test("a finding about a rule that is gone is not listed; none left: a note",
  async () => {
  checkin.mockResolvedValue(resp("rules"));
  ruleCheckup.mockResolvedValue(checkupOf([NEVER]));
  show({ rules: [] });
  const s = await step("rules");
  expect((await s.findByTestId("checkin-empty")).textContent)
    .toBe("All done here.");
  expect(s.queryByText(/Archive old event tickets/)).toBeNull();
});

/* ---------------------------------- Junk ---------------------------------- */

const jsender = (addr: string, count: number, uids: number[]): SenderGroup => ({
  addr, count, size: count * 1000, unread: 0, ts: NOW, date: "2026-11-20",
  first_ts: NOW - 5 * DAY, first_date: "2026-11-15", uids });
const JUNK = { folder: "Junk", uv: 7, total: 9, max_uid: 9, mails: [],
  senders: [jsender("spam1@junk.example", 6, [1, 2, 3, 4, 5, 6]),
    jsender("friend@x.example", 3, [7, 8, 9])] };
const MOVED = { moved: 3, rescan: false, senders: ["friend@x.example"],
  undo: { ts: 1, label: "x", count: 3 } };

test("junk: Not junk is the Junk page's move back to the Inbox, with Undo " +
  "and Protect in the toast", async () => {
  checkin.mockResolvedValue(resp("junk"));
  foldersPanel.mockResolvedValue({
    ...JUNK, senders: [...JUNK.senders] });
  folderMove.mockResolvedValue(MOVED);
  const groups = { ...GROUPS, "friend@x.example":
    group("friend@x.example", { replied: true }) };
  show({ groups });
  const s = await step("junk");
  const rows = await s.findAllByTestId("checkin-row");
  expect(texts(rows)).toEqual([
    expect.stringMatching(/spam1@junk\.example.*6 mails/),
    expect.stringMatching(/friend@x\.example.*3 mails.*you replied before/)]);
  fireEvent.click(within(rows[1]).getByRole("button", { name: /^Not junk/ }));
  await waitFor(() => expect(folderMove).toHaveBeenCalledWith(
    "junk", "not_junk", [7, 8, 9], 7));
  expect(await within(rows[1]).findByText("Back in the Inbox")).toBeTruthy();
  expect(await screen.findByText("Moved 3 mails to your inbox")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Protect/ }));
  expect(actions.protect).toHaveBeenCalledWith(["friend@x.example"]);
  expect(actions.changed).toHaveBeenCalled();
  fireEvent.click(next());
  expect((await screen.findByTestId("checkin-done")).textContent)
    .toContain("3 mails back to the Inbox");
});

test("junk: Undo in that toast is the app's confirmed Undo, and the list is " +
  "read again (the mails are back in Junk)", async () => {
  checkin.mockResolvedValue(resp("junk"));
  foldersPanel.mockResolvedValue(JUNK);
  folderMove.mockResolvedValue(MOVED);
  show();
  const s = await step("junk");
  const rows = await s.findAllByTestId("checkin-row");
  fireEvent.click(within(rows[1]).getByRole("button", { name: /^Not junk/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(actions.undo).toHaveBeenCalledWith(MOVED.undo);
  await waitFor(() => expect(foldersPanel).toHaveBeenCalledTimes(2));
});

test("junk: Trash moves the sender's mails; a protected sender needs the " +
  "explicit yes", async () => {
  checkin.mockResolvedValue(resp("junk"));
  foldersPanel.mockResolvedValue(JUNK);
  const refused = Object.assign(new Error("protected sender"),
    { code: "protected_sender_selected" });
  folderMove.mockRejectedValueOnce(refused).mockResolvedValue(
    { moved: 6, rescan: false, senders: [], undo: null });
  show();
  const s = await step("junk");
  const row = within((await s.findAllByTestId("checkin-row"))[0]);
  fireEvent.click(row.getByRole("button", { name: /^Trash/ }));
  await pressDialog("Move anyway");             // the protected-sender confirm
  await waitFor(() => expect(folderMove).toHaveBeenCalledTimes(2));
  expect(folderMove.mock.calls[0].slice(0, 4)).toEqual(
    ["junk", "trash", [1, 2, 3, 4, 5, 6], 7]);
  expect(folderMove.mock.calls[1][4]).toBe(true);          // force
  expect(await row.findByText("Moved to Trash")).toBeTruthy();
});

test("junk: Block… blocks the address first, then asks about its mails",
  async () => {
  checkin.mockResolvedValue(resp("junk"));
  foldersPanel.mockResolvedValue(JUNK);
  folderMove.mockResolvedValue({ moved: 6, rescan: false, senders: [],
    undo: null });
  show();
  const s = await step("junk");
  const row = within((await s.findAllByTestId("checkin-row"))[0]);
  fireEvent.click(row.getByRole("button", { name: /^Block…/ }));
  await waitFor(() => expect(actions.blockAddress).toHaveBeenCalledWith(
    "spam1@junk.example"));
  // "Only block" declines the move; the rule stands
  const dlg = await findDialog();
  expect(nb(dlg.textContent)).toContain("Also move its 6 mails in Junk");
  await pressDialog("Keep them in Junk");
  await expectNoDialog();
  expect(folderMove).not.toHaveBeenCalled();
  expect(await row.findByText("Blocked")).toBeTruthy();
  fireEvent.click(next());
  expect((await screen.findByTestId("checkin-done")).textContent)
    .toContain("1 sender blocked");
});

test("junk: a Block that was declined at its confirm does nothing",
  async () => {
  checkin.mockResolvedValue(resp("junk"));
  foldersPanel.mockResolvedValue(JUNK);
  actions.blockAddress.mockResolvedValue(false);
  show();
  const s = await step("junk");
  const row = within((await s.findAllByTestId("checkin-row"))[0]);
  fireEvent.click(row.getByRole("button", { name: /^Block…/ }));
  await waitFor(() => expect(actions.blockAddress).toHaveBeenCalled());
  await expectNoDialog();
  expect(folderMove).not.toHaveBeenCalled();
  expect(row.getByRole("button", { name: /^Block…/ })).toBeTruthy();
});
