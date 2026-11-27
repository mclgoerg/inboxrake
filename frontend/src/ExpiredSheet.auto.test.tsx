// @vitest-environment jsdom
/* Automatic mail in "Mail past its date" (backend/pastdate.py): out-of-office
 * replies, delivery failures, read receipts and calendar answers join the
 * sheet as three more reasons at its END - the first two ticked, the last
 * unticked like offers - with one more phrase in the lead line. Everything
 * the sheet showed before stays (INVENTORY.md, Overview): today's four
 * reasons with their sizes and ticks, the lead line, the Kept note with Show
 * them, Open in All mail, Cancel and the Trash step. German, and phones. */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const expiredMails = vi.fn();
const deleteMessages = vi.fn();
const keepSafeCheck = vi.fn();
const keepSafePin = vi.fn();

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    expiredMails: (...a: unknown[]) => expiredMails(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    keepSafeCheck: (...a: unknown[]) => keepSafeCheck(...a),
    keepSafePin: (...a: unknown[]) => keepSafePin(...a),
  },
}));

import { ExpiredSheet } from "./components/ExpiredSheet";
import { DialogProvider, ToastProvider } from "./components/ui";
import { findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { ExpiredResp } from "./types";

const MB = 1048576;
const KB = 1024;
// the numbers of the board: 197 mails, 90 of them ticked
const AUTO: ExpiredResp = {
  mails: 197, size: 4.5 * MB, kept: 12,
  reasons: [
    { id: "codes", mails: 21, size: 377 * KB, ticked: true },
    { id: "parcels", mails: 9, size: 316 * KB, ticked: true },
    { id: "events", mails: 17, size: 410 * KB, ticked: true },
    { id: "offers", mails: 90, size: 2.9 * MB, ticked: false },
    { id: "ooo", mails: 34, size: 290 * KB, ticked: true },
    { id: "bounces", mails: 9, size: 180 * KB, ticked: true },
    { id: "answers", mails: 17, size: 85 * KB, ticked: false },
  ] };
const TODAYS_FOUR = [
  "Sign-in codes and links, older than a day",
  "Updates for parcels that have arrived",
  "Appointments and events that are over",
  "Offers that have ended"];
const THE_NEW_THREE = [
  "Out-of-office replies, older than a week",
  "Delivery failures, older than a week",
  "Read receipts and calendar answers"];

const onClose = vi.fn();
const onOpenAllMail = vi.fn();
const onShowKept = vi.fn();
const onMoved = vi.fn();

const show = (data = AUTO) => render(
  <ToastProvider><DialogProvider>
    <ExpiredSheet data={data} onClose={onClose} onOpenAllMail={onOpenAllMail}
      onShowKept={onShowKept} onMoved={onMoved} />
  </DialogProvider></ToastProvider>);
const items = (n: number): [string, number][] =>
  Array.from({ length: n }, (_, i) => ["INBOX", i + 1]);
const row = (name: string | RegExp) =>
  screen.getByRole("checkbox", { name }) as HTMLInputElement;
const phone = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q.includes("767"), media: q,
  addEventListener: () => {}, removeEventListener: () => {} }));

beforeEach(() => {
  setLang("en");
  expiredMails.mockReset();
  deleteMessages.mockReset().mockResolvedValue({ ok: true, queued: 1 });
  keepSafeCheck.mockReset().mockResolvedValue({ total: 0, kept: 0,
    classes: [] });
  keepSafePin.mockReset();
  for (const f of [onClose, onOpenAllMail, onShowKept, onMoved]) f.mockReset();
});
afterEach(() => { cleanup(); setLang("en"); vi.unstubAllGlobals(); });

test("three more rows at the END, today's four first and unchanged; " +
  "out-of-office and delivery failures ticked, receipts not", () => {
  show();
  const dlg = screen.getByRole("dialog", { name: "Mail past its date" });
  const rows = within(dlg).getAllByTestId("past-reason");
  expect(rows).toHaveLength(7);
  [...TODAYS_FOUR, ...THE_NEW_THREE].forEach((title, i) =>
    expect(rows[i].textContent).toContain(title));
  // counts, sizes and the examples of the new rows
  expect(rows[4].textContent).toContain("34");
  expect(rows[4].textContent).toContain("290 KB");
  expect(rows[4].textContent).toContain("“Automatic reply: …”");
  expect(rows[5].textContent).toContain("“Undelivered Mail Returned to Sender”");
  expect(rows[6].textContent).toContain("only with the matching header");
  expect(rows[6].textContent).toContain("“Accepted: Team dinner”");
  // today's ticks (offers unticked) and the new ones
  for (const name of [TODAYS_FOUR[0], TODAYS_FOUR[1], TODAYS_FOUR[2],
    THE_NEW_THREE[0], THE_NEW_THREE[1]])
    expect(row(name).checked).toBe(true);
  expect(row(TODAYS_FOUR[3]).checked).toBe(false);
  expect(row(THE_NEW_THREE[2]).checked).toBe(false);
  // 21 + 9 + 17 + 34 + 9 are ticked (the offers and the receipts are not)
  expect(within(dlg).getByRole("button", { name: "Move 90 to Trash…" }))
    .toBeTruthy();
  expect(dlg.textContent).toMatch(/197\smails\s·\s4\.5\sMB/);
});

test("Move asks for the ticked ones, the new ids included; ticking the " +
  "receipts adds them", async () => {
  expiredMails.mockResolvedValue({ items: items(3) });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Move 90 to Trash…" }));
  await pressDialog(/Move to Trash \(3\)/);
  expect(expiredMails).toHaveBeenLastCalledWith(
    ["codes", "parcels", "events", "ooo", "bounces"]);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledTimes(1));
  cleanup();
  show();
  fireEvent.click(row(THE_NEW_THREE[2]));
  fireEvent.click(row(TODAYS_FOUR[3]));
  fireEvent.click(screen.getByRole("button", { name: "Move 197 to Trash…" }));
  await pressDialog(/Move to Trash \(3\)/);
  expect(expiredMails).toHaveBeenLastCalledWith(
    ["codes", "parcels", "events", "offers", "ooo", "bounces", "answers"]);
});

test("unticking one of the new rows leaves it out of the move", async () => {
  expiredMails.mockResolvedValue({ items: items(2) });
  show();
  fireEvent.click(row(THE_NEW_THREE[1]));
  fireEvent.click(screen.getByRole("button", { name: "Move 81 to Trash…" }));
  await pressDialog(/Move to Trash \(2\)/);
  expect(expiredMails).toHaveBeenLastCalledWith(
    ["codes", "parcels", "events", "ooo"]);
});

test("a reason with nothing in it has no row; with no automatic mail at all " +
  "the sheet is exactly today's four rows", () => {
  show({ ...AUTO, reasons: AUTO.reasons.map((r) =>
    r.id === "bounces" ? { ...r, mails: 0, size: 0 } : r) });
  expect(screen.getAllByTestId("past-reason")).toHaveLength(6);
  expect(screen.queryByText(THE_NEW_THREE[1])).toBeNull();
  cleanup();
  show({ ...AUTO, reasons: AUTO.reasons.map((r) =>
    ["ooo", "bounces", "answers"].includes(r.id)
      ? { ...r, mails: 0, size: 0 } : r) });
  expect(screen.getAllByTestId("past-reason").map((r) => r.textContent))
    .toEqual(TODAYS_FOUR.map((t) => expect.stringContaining(t)));
});

test("a reason a newer server sends and this build has no row for is left " +
  "out", () => {
  show({ ...AUTO, reasons: [...AUTO.reasons,
    { id: "from-a-newer-server" as never, mails: 5, size: 5, ticked: true }] });
  expect(screen.getAllByTestId("past-reason")).toHaveLength(7);
  expect(screen.getByRole("button", { name: "Move 90 to Trash…" })).toBeTruthy();
});

test("the lead line gets one more phrase on wide screens", () => {
  show();
  const lead = screen.getByText(/Found from the subject and the date/);
  expect(lead.textContent).toBe(
    "Found from the subject and the date, on your server · automatic mail "
    + "also from its headers · protected mails and protected senders are "
    + "never listed.");
  expect(screen.queryByText("Automatic mail also from its headers.")).toBeNull();
});

test("phones: today's line stays and the phrase has a line of its own",
  () => {
  phone();
  show();
  const dlg = screen.getByRole("dialog", { name: "Mail past its date" });
  expect(within(dlg).getByText("Found from the subject and the date, on your "
    + "server · protected mails and protected senders are never listed."))
    .toBeTruthy();
  expect(within(dlg).getByText("Automatic mail also from its headers."))
    .toBeTruthy();
  const rows = within(dlg).getAllByTestId("past-reason");
  expect(rows).toHaveLength(7);
  expect(rows[4].textContent).not.toContain("“Automatic reply");   // no examples
  expect(row(THE_NEW_THREE[0]).checked).toBe(true);
  expect(row(THE_NEW_THREE[2]).checked).toBe(false);
  expect(within(dlg).getByRole("button", { name: "Move 90 to Trash…" }))
    .toBeTruthy();
  expect(within(dlg).getByText(/Goes to Trash - Undo brings it back\./))
    .toBeTruthy();
});

test("today's sheet is whole beside the new rows: lead line, Kept note with " +
  "Show them, Open in All mail, Cancel and the Trash step", async () => {
  expiredMails.mockResolvedValue({ items: items(3) });
  show();
  const dlg = screen.getByRole("dialog", { name: "Mail past its date" });
  expect(within(dlg).getByText(
    /protected mails and protected senders are never listed/)).toBeTruthy();
  const kept = within(dlg).getByTestId("past-kept");
  expect(kept.textContent).toContain("Kept:");
  expect(kept.textContent).toContain("the 12 order confirmations, invoices "
    + "and bookings that belong to these parcels and appointments stay where "
    + "they are.");
  fireEvent.click(within(dlg).getByRole("button", { name: "Show them" }));
  expect(onShowKept).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dlg).getByRole("button", { name: "Open in All mail" }));
  expect(onOpenAllMail).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  // the same per-mail step: its confirm (verb + count), then the delete
  fireEvent.click(within(dlg).getByRole("button", { name: "Move 90 to Trash…" }));
  const confirm = await findDialog();
  expect(confirm.textContent).toContain("3 selected mails");
  await pressDialog(/Move to Trash \(3\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith(items(3), "trash"));
  await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
});

test("German: the new rows, the lead line and the button", () => {
  setLang("de");
  show();
  const dlg = screen.getByRole("dialog", { name: "Abgelaufene Mails" });
  expect(within(dlg).getByText("Abwesenheitsnotizen, älter als eine Woche"))
    .toBeTruthy();
  expect(within(dlg).getByText("Zustellfehler, älter als eine Woche"))
    .toBeTruthy();
  expect(within(dlg).getByText("Lesebestätigungen und Kalenderantworten"))
    .toBeTruthy();
  expect(within(dlg).getByText(/nur mit der passenden Kopfzeile/)).toBeTruthy();
  expect(within(dlg).getByText(/automatische Mails auch an ihren Kopfzeilen/))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "90 in den Papierkorb…" }))
    .toBeTruthy();
});

test("German on phones: the phrase on its own line", () => {
  setLang("de");
  phone();
  show();
  const dlg = screen.getByRole("dialog", { name: "Abgelaufene Mails" });
  expect(within(dlg).getByText("Automatische Mails auch an ihren Kopfzeilen."))
    .toBeTruthy();
  expect(within(dlg).getByText("Gefunden an Betreff und Datum, auf deinem "
    + "Server · geschützte Mails und geschützte Absender werden nie "
    + "aufgelistet.")).toBeTruthy();
});
