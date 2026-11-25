// @vitest-environment jsdom
/* Not now in the sender pane, the mail reader and the selection bar: what
   each asks the API for, what it tells the app, and how a refusal reads. */
import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import { epoch } from "./snooze";
import type { Group, Mail, SnoozeSummary } from "./types";

const group_ = vi.fn();
const snooze = vi.fn();
const snoozeBatch = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      group: (...a: unknown[]) => group_(...a),
      snooze: (...a: unknown[]) => snooze(...a),
      snoozeBatch: (...a: unknown[]) => snoozeBatch(...a),
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setLang("en");
  for (const f of [group_, snooze, snoozeBatch, refresh, onDeleted, onEmptied,
    onClose]) f.mockReset();
  snooze.mockResolvedValue(ok);
  snoozeBatch.mockResolvedValue({ ok: true, slot: "weekly", next: 1 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the sender pane has Not now; a time snoozes the sender's unread mails", async () => {
  show({ group: mkGroup({ count: 5, unread: 3 }) });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: /Snooze the 3/ })).toBeTruthy();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { grouping: "sender", keys: ["deals@promo.example"] }, TOMORROW, true));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(refresh).toHaveBeenCalled();
  expect(onEmptied).not.toHaveBeenCalled();           // read mails stay
});

test("snoozing every mail of a group closes the pane like Trash all does", async () => {
  show({ group: mkGroup({ count: 3, unread: 3, pinned: 0 }) });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(onEmptied).toHaveBeenCalled());
});

test("a group with pinned mails stays open", async () => {
  show({ group: mkGroup({ count: 3, unread: 3, pinned: 1 }) });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(onEmptied).not.toHaveBeenCalled();
});

test("nothing queued says why instead of pretending", async () => {
  snooze.mockResolvedValue({ ...ok, queued: 0, skipped_pinned: 3 });
  show();
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(menuItem(/Tomorrow morning/));
  await screen.findByText(/Nothing to snooze here/);
  expect(onEmptied).not.toHaveBeenCalled();
});

test("what the server left alone is named", async () => {
  snooze.mockResolvedValue({ ...ok, queued: 2, skipped_protected: 1 });
  show();
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(menuItem(/Tomorrow morning/));
  await screen.findByText(/1 mail stayed where it is/);
});

test("an API refusal reads as a toast, nothing closes", async () => {
  snooze.mockRejectedValue(new Error("Pick a time in the future"));
  show();
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(menuItem(/Tomorrow morning/));
  await screen.findByText(/Pick a time in the future/);
  expect(onEmptied).not.toHaveBeenCalled();
});

test("a sender can deliver in batches: the menu sets and ends one", async () => {
  show({}, { count: 0, until: {}, batches: {} });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /once a week/ }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "weekly", expect.any(String), "Promo Deals"));
  await screen.findByText(/New mail from Promo Deals now arrives once a week, Sat 09:00/);
  expect(refresh).toHaveBeenCalled();
});

test("a sender with a batch shows it checked and can stop it", async () => {
  snoozeBatch.mockResolvedValue({ ok: true, slot: "off", returned: 4 });
  show({}, { count: 4, until: { "deals@promo.example": 1 },
    batches: { "deals@promo.example": "weekly" } });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("menuitemradio", { name: /once a week/ })
    .getAttribute("aria-checked")).toBe("true");
  fireEvent.click(menuItem(/Stop delivering in batches/));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "off", expect.any(String), "Promo Deals"));
  await screen.findByText(/No more batches|new mail arrives as usual again/);
  await screen.findByText(/4 held mails are back/);
});

test("other groupings snooze the group but offer no batch", async () => {
  show({ grouping: "domain", group: mkGroup({ key: "promo.example" }) });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("group", { name: /Every new mail/ })).toBeNull();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { grouping: "domain", keys: ["promo.example"] }, TOMORROW, true));
});

test("a one-sender Smart row can deliver in batches by its address", async () => {
  show({ grouping: "smart", group: mkGroup({ key: "sender:deals", kind: "sender",
    addr: "deals@promo.example" }) });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /once a day/ }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "daily", expect.any(String), "Promo Deals"));
});

test("ticked mails: Not now in the selection bar snoozes exactly those", async () => {
  show();
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByLabelText("Select Mail 2"));
  fireEvent.click(screen.getByLabelText("Select Mail 3"));
  const bar = screen.getByText(/2 selected/).parentElement!.parentElement!;
  fireEvent.click(within(bar).getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: /Snooze the 2/ })).toBeTruthy();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 2], ["INBOX", 3]] }, TOMORROW));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
});

const wide = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q.includes("min-width: 768px"), media: q,
  addEventListener() {}, removeEventListener() {} }));

test("the open mail has Not now in the reader's toolbar (a menu from 768 px)", async () => {
  wide();
  show();
  fireEvent.click(await screen.findByText("Mail 1"));
  fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: "Snooze this mail until" }))
    .toBeTruthy();
  fireEvent.click(menuItem(/Tomorrow morning/));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 1]] }, TOMORROW));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  // the mail left the list and the reader closed
  await waitFor(() => expect(screen.queryByText("Mail 1")).toBeNull());
});

test("below 768 px the reader's bottom bar opens the sheet", async () => {
  show();
  fireEvent.click(await screen.findByText("Mail 1"));
  fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
  const sheet = screen.getByRole("dialog", { name: "Not now" });
  expect(within(sheet).queryByRole("switch")).toBeNull();     // no batch here
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow/ }));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 1]] }, TOMORROW));
});

test("on a phone the sender pane opens the sheet with the batch switch", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("width < 40rem"), media: q,
    addEventListener() {}, removeEventListener() {} }));
  show({}, { count: 0, until: {}, batches: {} });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  const sheet = screen.getByRole("dialog", { name: "Not now" });
  expect(plain(sheet)).toContain("Promo Deals · 3 unread");
  fireEvent.click(within(sheet).getByRole("switch",
    { name: "Deliver in batches" }));
  await waitFor(() => expect(snoozeBatch).toHaveBeenCalledWith(
    "deals@promo.example", "weekly", expect.any(String), "Promo Deals"));
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow/ }));
  await waitFor(() => expect(snooze).toHaveBeenCalled());
});

test("German: the pane's button and menu", async () => {
  setLang("de");
  show({}, { count: 0, until: {}, batches: {} });
  await screen.findByText("Mail 1");
  fireEvent.click(screen.getByRole("button", { name: "Nicht jetzt" }));
  expect(screen.getByRole("group", { name: /Die 3\sungelesenen Mails/ }))
    .toBeTruthy();
  expect(screen.getByRole("menuitemradio", { name: /Einmal pro Tag zustellen/ }))
    .toBeTruthy();
});
