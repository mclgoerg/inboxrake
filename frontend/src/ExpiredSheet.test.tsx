// @vitest-environment jsdom
/* Mail past its date: the sheet behind the Overview's Next steps line. One row
 * per reason with a tick ("Offers that have ended" starts unticked), the Kept
 * note, the footer, and "Move N to Trash…" - which fetches the ticked mails,
 * asks the usual confirm (the Keep-safe box on a big move) and hands them to
 * the per-mail Trash step. German, and the phone layout. */

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
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from
  "./dialogTestUtils";
import { setLang } from "./i18n";
import { expectKeepBox, KEEP_FOUND } from "./keepSafeTestUtil";
import type { ExpiredResp } from "./types";

const MB = 1048576;
const DATA: ExpiredResp = {
  mails: 148, size: 9.6 * MB, kept: 18,
  reasons: [
    { id: "codes", mails: 64, size: 1.1 * MB, ticked: true },
    { id: "parcels", mails: 52, size: 4.0 * MB, ticked: true },
    { id: "events", mails: 21, size: 2.9 * MB, ticked: true },
    { id: "offers", mails: 11, size: 1.6 * MB, ticked: false },
  ] };

const onClose = vi.fn();
const onOpenAllMail = vi.fn();
const onShowKept = vi.fn();
const onMoved = vi.fn();

const show = (data = DATA) => render(
  <ToastProvider><DialogProvider>
    <ExpiredSheet data={data} onClose={onClose} onOpenAllMail={onOpenAllMail}
      onShowKept={onShowKept} onMoved={onMoved} />
  </DialogProvider></ToastProvider>);

const items = (n: number): [string, number][] =>
  Array.from({ length: n }, (_, i) => ["INBOX", i + 1]);
const row = (name: string | RegExp) =>
  screen.getByRole("checkbox", { name }) as HTMLInputElement;

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

test("one row per reason with its count and size; offers start unticked; " +
  "the Kept note and the footer", () => {
  show();
  const dlg = screen.getByRole("dialog", { name: "Mail past its date" });
  expect(dlg.textContent).toMatch(/148\smails\s·\s9\.6\sMB/);
  expect(within(dlg).getByText(/protected mails and protected senders are never listed/))
    .toBeTruthy();
  const rows = within(dlg).getAllByTestId("past-reason");
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringContaining("Sign-in codes and links, older than a day"),
    expect.stringContaining("Updates for parcels that have arrived"),
    expect.stringContaining("Appointments and events that are over"),
    expect.stringContaining("Offers that have ended")]);
  expect(rows[0].textContent).toContain("64");
  expect(rows[0].textContent).toContain("1.1\u00a0MB");
  expect(rows[1].textContent).toContain("“Out for delivery”");
  expect(row("Sign-in codes and links, older than a day").checked).toBe(true);
  expect(row("Updates for parcels that have arrived").checked).toBe(true);
  expect(row("Appointments and events that are over").checked).toBe(true);
  expect(row("Offers that have ended").checked).toBe(false);
  const kept = within(dlg).getByTestId("past-kept");
  expect(kept.textContent).toContain("Kept:");
  expect(kept.textContent).toContain("the 18 order confirmations, invoices "
    + "and bookings that belong to these parcels and appointments stay where "
    + "they are.");
  // 64 + 52 + 21 = 137 (the offers are not ticked)
  expect(within(dlg).getByRole("button", { name: "Move 137 to Trash…" }))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Open in All mail" }))
    .toBeTruthy();
});

test("ticking offers adds them; unticking everything disables the button",
  () => {
  show();
  fireEvent.click(row("Offers that have ended"));
  expect(screen.getByRole("button", { name: "Move 148 to Trash…" })).toBeTruthy();
  for (const name of [/^Sign-in/, /^Updates/, /^Appointments/, /^Offers/])
    fireEvent.click(row(name));
  const move = screen.getByRole("button", { name: "Move 0 to Trash…" });
  expect((move as HTMLButtonElement).disabled).toBe(true);
});

test("a reason with nothing in it has no row; no kept receipts, no note",
  () => {
  show({ ...DATA, kept: 0, reasons: DATA.reasons.map((r) =>
    r.id === "events" ? { ...r, mails: 0, size: 0 } : r) });
  expect(screen.getAllByTestId("past-reason")).toHaveLength(3);
  expect(screen.queryByText("Appointments and events that are over")).toBeNull();
  expect(screen.queryByTestId("past-kept")).toBeNull();
  expect(screen.getByRole("button", { name: "Move 116 to Trash…" })).toBeTruthy();
});

test("Open in All mail, Show them and Cancel hand over to the app", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Open in All mail" }));
  expect(onOpenAllMail).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Show them" }));
  expect(onShowKept).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(deleteMessages).not.toHaveBeenCalled();
});

test("Move asks for the ticked reasons, then the usual confirm; Cancel moves " +
  "nothing", async () => {
  expiredMails.mockResolvedValue({ items: items(3) });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Move 137 to Trash…" }));
  const dlg = await findDialog();
  expect(expiredMails).toHaveBeenCalledWith(["codes", "parcels", "events"]);
  // the verb + the count, in the danger tone
  expect(dlg.textContent).toContain("3 selected mails");
  expect(within(dlg).getByRole("button", { name: /Move to Trash \(3\)/ }))
    .toBeTruthy();
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(onMoved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();     // still on the sheet
});

test("confirming trashes exactly the fetched mails (the app's per-mail step), " +
  "then closes", async () => {
  expiredMails.mockResolvedValue({ items: items(3) });
  show();
  fireEvent.click(row("Offers that have ended"));          // all four ticked
  fireEvent.click(screen.getByRole("button", { name: "Move 148 to Trash…" }));
  await pressDialog(/Move to Trash \(3\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith(items(3), "trash"));
  expect(expiredMails).toHaveBeenCalledWith(
    ["codes", "parcels", "events", "offers"]);
  await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a big move carries the Keep-safe box: what is kept safe stays out of " +
  "the move", async () => {
  expiredMails.mockResolvedValue({ items: items(25) });
  keepSafeCheck.mockResolvedValue(KEEP_FOUND);
  keepSafePin.mockResolvedValue({ pinned: 2,
    items: [["INBOX", 2], ["INBOX", 3]] });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Move 137 to Trash…" }));
  expectKeepBox(await findDialog());
  expect(keepSafeCheck).toHaveBeenCalled();
  await pressDialog(/Move to Trash/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledTimes(1));
  const sent = deleteMessages.mock.calls[0][0] as [string, number][];
  expect(sent).toHaveLength(23);
  expect(sent.some(([, uid]) => uid === 2 || uid === 3)).toBe(false);
});

test("nothing left to move (everything was pinned meanwhile): a note, no " +
  "confirm, no move", async () => {
  expiredMails.mockResolvedValue({ items: [] });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Move 137 to Trash…" }));
  expect(await screen.findByText("Nothing is left to move.")).toBeTruthy();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("a failing step says so and keeps the sheet open", async () => {
  expiredMails.mockResolvedValue({ items: items(2) });
  deleteMessages.mockRejectedValue(new Error("protected_sender_selected"));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Move 137 to Trash…" }));
  await pressDialog(/Move to Trash \(2\)/);
  expect(await screen.findByText(/protected_sender_selected/)).toBeTruthy();
  expect(onMoved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("German: the sheet, the Kept note and the buttons", () => {
  setLang("de");
  show();
  const dlg = screen.getByRole("dialog", { name: "Abgelaufene Mails" });
  expect(within(dlg).getByText("Anmeldecodes und -links, älter als ein Tag"))
    .toBeTruthy();
  expect(within(dlg).getByText("Angebote, die beendet sind")).toBeTruthy();
  expect(within(dlg).getByTestId("past-kept").textContent).toContain(
    "Bleibt erhalten: die 18 Bestellbestätigungen, Rechnungen und Buchungen "
    + "zu diesen Paketen und Terminen.");
  expect(within(dlg).getByRole("button", { name: "137 in den Papierkorb…" }))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Abbrechen" })).toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "In „Alle Mails“ öffnen" }))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Anzeigen" })).toBeTruthy();
});

test("phones: the short Kept line, the big button and the caption with the " +
  "link; no examples", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("767"), media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  expiredMails.mockResolvedValue({ items: items(2) });
  show();
  const dlg = screen.getByRole("dialog", { name: "Mail past its date" });
  expect(within(dlg).queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(within(dlg).queryByText(/“Out for delivery”/)).toBeNull();
  expect(within(dlg).getByTestId("past-kept").textContent).toContain(
    "The 18 receipts and bookings of these orders stay.");
  expect(within(dlg).getByText(/Goes to Trash - Undo brings it back\./))
    .toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Open in All mail" }));
  expect(onOpenAllMail).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dlg).getByRole("button", { name: "Move 137 to Trash…" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalled());
});

test("one kept receipt reads in the singular", () => {
  show({ ...DATA, kept: 1 });
  expect(screen.getByTestId("past-kept").textContent).toContain(
    "the 1 order confirmation, invoice or booking that belongs to these "
    + "parcels and appointments stays where it is.");
});
