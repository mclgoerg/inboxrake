// @vitest-environment jsdom
/* Not now… in the sender pane's More menu, the mail reader's ⋯ menu and the
   pane's selection menu: what each asks the API for, what it tells the app,
   how a refusal reads - and that every item that was there stays, in order,
   with Not now… last. */
import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import { epoch } from "./snooze";
import type { Group, Mail, SnoozeSummary } from "./types";

const group_ = vi.fn();
const snooze = vi.fn();
const snoozeBatch = vi.fn();
const snoozedBack = vi.fn();
const waitingSender = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      group: (...a: unknown[]) => group_(...a),
      snooze: (...a: unknown[]) => snooze(...a),
      snoozeBatch: (...a: unknown[]) => snoozeBatch(...a),
      snoozedBack: (...a: unknown[]) => snoozedBack(...a),
      waitingSender: (...a: unknown[]) => waitingSender(...a),
      folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
      pin: vi.fn(),
      message: () => Promise.resolve({ from: "", to: "", date: "",
        subject: "", text: "body" }),
      messages: (items: [string, number][]) => Promise.resolve({
        messages: items.map(([folder, uid]) => ({ folder, uid, from: "",
          to: "", date: "", subject: "", text: "body" })) }),
    },
  };
});

import { DetailPanel } from "./components/DetailPanel";
import { SnoozeProvider } from "./components/snoozeContext";
import { gradedGroup, mkGrade } from "./gradeTestUtil";
import { DialogProvider, ToastProvider } from "./components/ui";

// Tuesday 2026-11-24, 09:30 local
const NOW = new Date(2026, 10, 24, 9, 30);
const TOMORROW = epoch(new Date(2026, 10, 25, 8));

const mkMail = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2026-11-20", ts: 0, subject: `Mail ${uid}`,
  addr: "deals@promo.example", size: 1000, seen: false, ai: null, ...over });
const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "deals@promo.example", label: "Promo Deals",
  sub: "deals@promo.example", count: 3, size: 3000, unread: 3,
  first: "2026-01-01", last: "2026-11-20", tags: [], samples: [], bulk: true,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  ...over });

const refresh = vi.fn();
const onDeleted = vi.fn();
const onEmptied = vi.fn();
const onClose = vi.fn();

function show(over: Partial<Parameters<typeof DetailPanel>[0]> = {},
    summary?: SnoozeSummary) {
  group_.mockResolvedValue([mkMail(1), mkMail(2), mkMail(3)]);
  return render(<ToastProvider><DialogProvider>
    <SnoozeProvider value={{ summary, refresh }}>
      <DetailPanel grouping="sender" group={mkGroup()} aiEnabled={false}
        protectedNow={false} unsubscribedNow={null} onUnsubscribe={() => {}}
        onTrash={async () => true} folders={["Archive"]} sieve={false}
        onClose={onClose} onDeleted={onDeleted} onEmptied={onEmptied}
        {...over} />
    </SnoozeProvider></DialogProvider></ToastProvider>);
}
const ok = { ok: true, queued: 3, until: TOMORROW, skipped_pinned: 0,
  skipped_protected: 0, skipped_no_id: 0 };
const plain = (el: HTMLElement) => (el.textContent ?? "").replace(/ /g, " ");
const menuItem = (name: RegExp) =>
  screen.getByRole("menuitem", { name });
/** More › Not now… (the popover opens beside the menu). */
const openNotNow = (within_?: HTMLElement) => {
  fireEvent.click(within(within_ ?? document.body).getByRole("button",
    { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Not now…" }));
  return screen.getByRole("menu", { name: /Not now/ });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setLang("en");
  for (const f of [group_, snooze, snoozeBatch, snoozedBack, waitingSender,
    refresh, onDeleted, onEmptied, onClose]) f.mockReset();
  snooze.mockResolvedValue(ok);
  snoozeBatch.mockResolvedValue({ ok: true, slot: "weekly", next: 1 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the pane's More menu ends with Not now…; a time snoozes the sender's unread mails", async () => {
  show({ group: mkGroup({ count: 5, unread: 3 }) });
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { grouping: "sender", keys: ["deals@promo.example"] }, TOMORROW, true));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(refresh).toHaveBeenCalled();
  expect(onEmptied).not.toHaveBeenCalled();           // read mails stay
});

test("every More item that was there stays, in order, with Not now… last", async () => {
  show({ aiEnabled: true, sieve: true });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getAllByRole("menuitem").map((i) => plain(i))).toEqual([
    "AI rate mails", "Protect all mails in this group", "Sieve filter",
    "Not now…"]);
});

test("a sender with nothing unread: the times are off (and say why), a batch still works", async () => {
  show({ group: mkGroup({ count: 3, unread: 0 }) }, { count: 0, until: {},
    mails: {}, batches: {} });
  await screen.findByText("Mail 1");
  const pop = openNotNow();
  expect(plain(pop)).toContain("Nothing unread to snooze here");
  expect((menuItem(/Tomorrow morning/) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("menuitemradio", { name: /once a day/ }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "daily", expect.any(String), "Promo Deals"));
  expect(snooze).not.toHaveBeenCalled();
});

test("snoozing every mail of a group closes the pane like Trash all does", async () => {
  show({ group: mkGroup({ count: 3, unread: 3, pinned: 0 }) });
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(onEmptied).toHaveBeenCalled());
});

test("a group with pinned mails stays open", async () => {
  show({ group: mkGroup({ count: 3, unread: 3, pinned: 1 }) });
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(onEmptied).not.toHaveBeenCalled();
});

test("nothing queued says why instead of pretending", async () => {
  snooze.mockResolvedValue({ ...ok, queued: 0, skipped_pinned: 3 });
  show();
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await screen.findByText(/Nothing to snooze here/);
  expect(onEmptied).not.toHaveBeenCalled();
});

test("what the server left alone is named", async () => {
  snooze.mockResolvedValue({ ...ok, queued: 2, skipped_protected: 1 });
  show();
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await screen.findByText(/1 mail stayed where it is/);
});

test("a mail that is already snoozed is named among those left alone", async () => {
  snooze.mockResolvedValue({ ...ok, queued: 2, skipped_duplicate: 1 });
  show();
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await screen.findByText(/1 mail stayed where it is \(pinned, from a protected sender or already snoozed\)/);
});

test("an API refusal reads as a toast, nothing closes", async () => {
  snooze.mockRejectedValue(new Error("Pick a time in the future"));
  show();
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await screen.findByText(/Pick a time in the future/);
  expect(onEmptied).not.toHaveBeenCalled();
});

test("a sender can deliver in batches: the popover sets one", async () => {
  show({}, { count: 0, until: {}, mails: {}, batches: {} });
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(screen.getByRole("menuitemradio", { name: /once a week/ }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "weekly", expect.any(String), "Promo Deals"));
  await screen.findByText(/New mail from Promo Deals now arrives once a week, Sat 09:00/);
  expect(refresh).toHaveBeenCalled();
});

test("a sender with a batch shows it checked and a click turns it off", async () => {
  snoozeBatch.mockResolvedValue({ ok: true, slot: "off", returned: 4 });
  show({}, { count: 4, until: { "deals@promo.example": 1 },
    mails: { "deals@promo.example": 4 },
    batches: { "deals@promo.example": "weekly" } });
  await screen.findByText("Mail 1");
  openNotNow();
  const on = screen.getByRole("menuitemradio", { name: /once a week/ });
  expect(on.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(on);
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "off", expect.any(String), "Promo Deals"));
  await screen.findByText(/4 held mails are back/);
});

test("other groupings snooze the group but offer no batch", async () => {
  show({ grouping: "domain", group: mkGroup({ key: "promo.example" }) });
  await screen.findByText("Mail 1");
  openNotNow();
  expect(screen.queryByRole("group", { name: /Every new mail/ })).toBeNull();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { grouping: "domain", keys: ["promo.example"] }, TOMORROW, true));
});

test("a one-sender Smart row can deliver in batches by its address", async () => {
  show({ grouping: "smart", group: mkGroup({ key: "sender:deals", kind: "sender",
    addr: "deals@promo.example" }) });
  await screen.findByText("Mail 1");
  openNotNow();
  fireEvent.click(screen.getByRole("menuitemradio", { name: /once a day/ }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "daily", expect.any(String), "Promo Deals"));
});

test("while something of the sender is snoozed the pane says so and Back now returns it", async () => {
  snoozedBack.mockResolvedValue({ returned: 3, gone: 0 });
  show({}, { count: 3, until: { "deals@promo.example": TOMORROW },
    mails: { "deals@promo.example": 3 }, batches: {} });
  const line = await screen.findByTestId("snoozed-line");
  expect(plain(line)).toContain("3 mails snoozed until tomorrow 08:00");
  fireEvent.click(within(line).getByRole("button", { name: "Back now" }));
  await waitFor(() => expect(snoozedBack).toHaveBeenCalledWith(
    [], "", "deals@promo.example"));
  await screen.findByText(/3 mails are back, unread/);
  expect(refresh).toHaveBeenCalled();
});

test("the pane's lines keep the board's order: What they send, the waiting line, the snoozed line, the report card, then Mails", async () => {
  waitingSender.mockResolvedValue({ waiting: {
    id: "<x@self.example>", ts: 1790000000, days: 9, overdue: true,
    usual_days: null, subject: "Question" } });
  const g = gradedGroup("deals@promo.example", "Promo Deals", "D",
    { count: 4, unread: 3, grade: mkGrade("D", { pattern: "loud" }) });
  group_.mockResolvedValue([
    mkMail(1, { kind: "ads" }), mkMail(2, { kind: "ads" }),
    mkMail(3, { kind: "orders" }), mkMail(4, { kind: "orders" })]);
  render(<ToastProvider><DialogProvider>
    <SnoozeProvider value={{ refresh, summary: { count: 2, until: {
      "deals@promo.example": TOMORROW }, mails: { "deals@promo.example": 2 },
      batches: {} } }}>
      <DetailPanel grouping="sender" group={g} aiEnabled={false}
        protectedNow={false} unsubscribedNow={null} onUnsubscribe={() => {}}
        onTrash={async () => true} folders={["Archive"]} sieve={false}
        onClose={onClose} onDeleted={onDeleted}
        waiting={{ enabled: true, onShow: () => {} }} />
    </SnoozeProvider></DialogProvider></ToastProvider>);
  const kinds = await screen.findByTestId("kinds-box");
  const waiting = await screen.findByTestId("waiting-line");
  const line = await screen.findByTestId("snoozed-line");
  const card = await screen.findByTestId("grade-card");
  const mails = await screen.findByRole("heading", { name: "Mails" });
  const follows = (a: Element, b: Element) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(follows(kinds, waiting)).toBe(true);
  expect(follows(waiting, line)).toBe(true);
  expect(follows(line, card)).toBe(true);
  expect(follows(card, mails)).toBe(true);
});

test("no line when nothing of this sender is snoozed", async () => {
  show({}, { count: 2, until: { "other@x.example": TOMORROW },
    mails: { "other@x.example": 2 }, batches: {} });
  await screen.findByText("Mail 1");
  expect(screen.queryByTestId("snoozed-line")).toBeNull();
});

test("a pooled row (no single sender) has no line", async () => {
  show({ grouping: "smart", group: mkGroup({ key: "k:newsletter", kind: "newsletter" }) },
    { count: 3, until: { "deals@promo.example": TOMORROW },
      mails: { "deals@promo.example": 3 }, batches: {} });
  await screen.findByText("Mail 1");
  expect(screen.queryByTestId("snoozed-line")).toBeNull();
});

test("ticked mails: Not now… is the last item of the pane's Action… menu and snoozes exactly those", async () => {
  show();
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByLabelText("Select Mail 2"));
  fireEvent.click(screen.getByLabelText("Select Mail 3"));
  const bar = screen.getByText(/2 selected/).parentElement!.parentElement!;
  fireEvent.click(within(bar).getByRole("button", { name: /Action/ }));
  expect(screen.getAllByRole("menuitemradio").map((i) => plain(i))).toEqual([
    "Archive", "Move to folder…", "Mark read", "Not now…"]);
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Not now…" }));
  const pop = screen.getByRole("menu", { name: /Not now/ });
  expect(within(pop).queryByRole("group", { name: /Every new mail/ })).toBeNull();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 2], ["INBOX", 3]] }, TOMORROW));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
});

const wide = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q.includes("min-width: 768px"), media: q,
  addEventListener() {}, removeEventListener() {} }));

test("the open mail has Not now… last in the reader's ⋯ menu", async () => {
  wide();
  show();
  fireEvent.click(await screen.findByText("Mail 1"));
  // the reader sits on top of the pane: its toolbar has the second More
  const mores = await screen.findAllByRole("button", { name: "More" });
  fireEvent.click(mores[mores.length - 1]);
  const items = screen.getAllByRole("menuitem").map((i) => plain(i));
  expect(items.at(-1)).toBe("Not now…");
  expect(items).toContain("Copy address");
  fireEvent.click(screen.getByRole("menuitem", { name: "Not now…" }));
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 1]] }, TOMORROW));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  // the mail left the list and the reader closed
  await waitFor(() => expect(screen.queryByText("Mail 1")).toBeNull());
});

test("below 768 px the reader's bottom bar opens the sheet from its More menu", async () => {
  show();
  fireEvent.click(await screen.findByText("Mail 1"));
  const mores = await screen.findAllByRole("button", { name: "More" });
  fireEvent.click(mores[mores.length - 1]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Not now…" }));
  // (the sheet is the layout below 640 px; here the popover answers)
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 1]] }, TOMORROW));
});

test("on a phone the sender pane opens the sheet with the two batch switches", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("width < 40rem"), media: q,
    addEventListener() {}, removeEventListener() {} }));
  show({}, { count: 0, until: {}, mails: {}, batches: {} });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Not now…" }));
  const sheet = screen.getByRole("dialog", { name: "Not now · Promo Deals" });
  expect(plain(sheet)).toContain("3 unread mails");
  fireEvent.click(within(sheet).getByRole("switch",
    { name: "Deliver once a week" }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "weekly", expect.any(String), "Promo Deals"));
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow/ }));
  await waitFor(() => expect(snooze).toHaveBeenCalled());
});

test("German: the item and the popover", async () => {
  setLang("de");
  show({}, { count: 0, until: {}, mails: {}, batches: {} });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Mehr" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Nicht jetzt…" }));
  const pop = screen.getByRole("menu", { name: /Nicht jetzt/ });
  expect(within(pop).getByRole("group", { name: "Jede neue Mail von Promo Deals" }))
    .toBeTruthy();
  expect(within(pop).getByRole("menuitemradio", { name: /Einmal pro Tag zustellen/ }))
    .toBeTruthy();
});
