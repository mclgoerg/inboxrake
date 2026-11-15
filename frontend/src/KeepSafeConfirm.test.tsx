// @vitest-environment jsdom
/* Keep-safe confirm: the green box inside the destructive confirm, the
 * threshold, the button that counts only what moves, the pin of the ticked
 * groups, and the German texts. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { setLang } from "./i18n";
import { confirmTrash, KEEP_SAFE_MIN, type TrashAsk } from "./keepsafe";
import type { KeepSafeCheck } from "./types";

const check = vi.fn();
const pin = vi.fn();

vi.mock("./api", () => ({
  api: {
    keepSafeCheck: (...a: unknown[]) => check(...a),
    keepSafePin: (...a: unknown[]) => pin(...a),
  },
}));

const FOUND: KeepSafeCheck = { total: 326, kept: 12, classes: [
  { id: "invoices", count: 8,
    senders: [{ name: "ACME Store", count: 5 }, { name: "Gadget Weekly", count: 3 }],
    subjects: [
      { subject: "Invoice 2026-0412 for your order", sender: "ACME Store",
        ts: 1759500000 },
      { subject: "Your receipt - order 88213", sender: "Gadget Weekly",
        ts: 1755000000 }] },
  { id: "bookings", count: 2,
    senders: [{ name: "Travelly", count: 2 }],
    subjects: [{ subject: "A booking for 3 Dec", sender: "Travelly", ts: 1759500000 },
      { subject: "Your ticket", sender: "Travelly", ts: 1759400000 }] },
  { id: "contracts", count: 2,
    senders: [{ name: "Bank of Example", count: 2 }],
    subjects: [{ subject: "Changes to your terms", sender: "Bank of Example",
      ts: 1759500000 }] },
] };

const SCOPE = { grouping: "sender" as const, keys: ["a@x.example"] };
const ask = (over: Partial<TrashAsk> = {}): TrashAsk => ({
  title: "Move to Trash", bullets: ["326 selected mails"], tone: "danger",
  label: (k) => `Move to Trash (${k})`, n: 326, scope: SCOPE, ...over });

let answer: Promise<unknown>;
const run = (over: Partial<TrashAsk> = {}) => {
  render(<DialogProvider><div /></DialogProvider>);
  answer = confirmTrash(ask(over));
  return answer;
};

beforeEach(() => {
  check.mockResolvedValue(FOUND);
  pin.mockResolvedValue({ pinned: 12, items: [["INBOX", 1], ["INBOX", 2]] });
});
afterEach(() => {
  cleanup();
  check.mockReset();
  pin.mockReset();
  setLang("en");
  vi.unstubAllGlobals();
});

const moveButton = (dlg: HTMLElement) =>
  within(dlg).getByRole("button", { name: /^Move to Trash/ });

test("the threshold is more than 20 mails: 20 asks nothing, 21 checks", async () => {
  expect(KEEP_SAFE_MIN).toBe(20);
  run({ n: 20 });
  await findDialog();
  expect(check).not.toHaveBeenCalled();
  await pressDialog(/Move to Trash \(20\)/);
  expect(await answer).toEqual({ ok: true, pinned: [] });
  cleanup();
  run({ n: 21 });
  await findDialog();
  expect(check).toHaveBeenCalledWith(SCOPE, undefined);
  await cancelDialog();
});

test("a move that is not a scope (single, forced) is never checked", async () => {
  run({ scope: null });
  await findDialog();
  expect(check).not.toHaveBeenCalled();
  await cancelDialog();
});

test("the box lists the groups, ticked, with the footer and the counting button",
  async () => {
  run();
  const dlg = await findDialog();
  expect(within(dlg).getByText("12 look worth keeping")).toBeTruthy();
  expect(within(dlg).getByText(/stay where they are/)).toBeTruthy();
  expect(within(dlg).getByText(/Invoices & receipts · 8/)).toBeTruthy();
  expect(within(dlg).getByText(/Bookings & tickets · 2/)).toBeTruthy();
  expect(within(dlg).getByText(/Contracts & policy notices · 2/)).toBeTruthy();
  // job applications / account mails: none found, no row
  expect(within(dlg).queryByText(/Job applications/)).toBeNull();
  expect(within(dlg).getByText(/ACME Store 5, Gadget Weekly 3/)).toBeTruthy();
  for (const box of within(dlg).getAllByRole("checkbox"))
    expect((box as HTMLInputElement).checked).toBe(true);
  // 326 selected - 12 kept: the button counts only what really moves
  expect(moveButton(dlg).textContent).toBe("Move to Trash (314)");
  expect(within(dlg).getByText("326 selected · 12 kept safe")).toBeTruthy();
  await cancelDialog();
  expect(await answer).toEqual({ ok: false });
  expect(pin).not.toHaveBeenCalled();
});

test("unticking a group is the one-click 'no, it's fine': it moves again",
  async () => {
  run();
  const dlg = await findDialog();
  fireEvent.click(within(dlg).getByRole("checkbox",
    { name: /Keep Invoices & receipts: 8 mails/ }));
  expect(moveButton(dlg).textContent).toBe("Move to Trash (322)");
  expect(within(dlg).getByText("326 selected · 4 kept safe")).toBeTruthy();
  await pressDialog(/Move to Trash \(322\)/);
  expect(await answer).toEqual({ ok: true, pinned: [["INBOX", 1], ["INBOX", 2]] });
  // only the groups still ticked are pinned
  expect(pin).toHaveBeenCalledWith(SCOPE, ["bookings", "contracts"], undefined);
});

test("confirming with everything ticked pins every group first", async () => {
  run();
  await findDialog();
  await pressDialog(/Move to Trash \(314\)/);
  expect(await answer).toEqual({ ok: true, pinned: [["INBOX", 1], ["INBOX", 2]] });
  expect(pin).toHaveBeenCalledWith(SCOPE,
    ["invoices", "bookings", "contracts"], undefined);
});

test("everything unticked: nothing is pinned and the move is the plain one",
  async () => {
  run();
  const dlg = await findDialog();
  for (const box of within(dlg).getAllByRole("checkbox")) fireEvent.click(box);
  expect(moveButton(dlg).textContent).toBe("Move to Trash (326)");
  await pressDialog(/Move to Trash \(326\)/);
  expect(await answer).toEqual({ ok: true, pinned: [] });
  expect(pin).not.toHaveBeenCalled();
});

test("a group opens to its subjects with sender and date, and '+N more'",
  async () => {
  run();
  const dlg = await findDialog();
  const toggle = within(dlg).getByRole("button",
    { name: "Show the mails of Invoices & receipts" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(within(dlg).queryByText("Invoice 2026-0412 for your order")).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(within(dlg).getByText("Invoice 2026-0412 for your order")).toBeTruthy();
  expect(within(dlg).getByText(/^ACME Store · /)).toBeTruthy();
  expect(within(dlg).getByText("+6 more")).toBeTruthy();    // 8 - 2 shown
  await cancelDialog();
});

test("a failed check is the plain confirm; so is one that finds nothing",
  async () => {
  check.mockRejectedValue(new Error("down"));
  run();
  let dlg = await findDialog();
  expect(within(dlg).queryByText(/look worth keeping/)).toBeNull();
  // ... and it says so, instead of looking like nothing was found
  expect(within(dlg).getByText(/Could not check for mail worth keeping/))
    .toBeTruthy();
  await pressDialog(/Move to Trash \(326\)/);
  expect(await answer).toEqual({ ok: true, pinned: [] });
  cleanup();
  check.mockResolvedValue({ total: 326, kept: 0, classes: [] });
  run();
  dlg = await findDialog();
  expect(within(dlg).queryByText(/look worth keeping/)).toBeNull();
  expect(within(dlg).queryByText(/Could not check/)).toBeNull();
  await cancelDialog();
});

test("a pin that fails stops the move: the error is thrown, nothing moves",
  async () => {
  pin.mockRejectedValue(new Error("pin failed"));
  const failed = vi.fn();
  render(<DialogProvider><div /></DialogProvider>);
  const p = confirmTrash(ask()).catch(failed);
  await findDialog();
  await pressDialog(/Move to Trash \(314\)/);
  await p;
  expect(failed).toHaveBeenCalledOnce();
  expect(String(failed.mock.calls[0][0])).toContain("pin failed");
});

test("Esc / Cancel resolve not-ok and pin nothing", async () => {
  run();
  await findDialog();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(await answer).toEqual({ ok: false });
  await expectNoDialog();
  expect(pin).not.toHaveBeenCalled();
});

test("the confirm waits for its arming delay like every destructive dialog",
  async () => {
  run();
  const dlg = await findDialog();
  fireEvent.click(moveButton(dlg), { detail: 1 });
  await new Promise((r) => setTimeout(r, 50));
  expect(pin).not.toHaveBeenCalled();
  await cancelDialog();
});

test("the account is passed to the check and the pin", async () => {
  run({ account: "work" });
  await findDialog();
  expect(check).toHaveBeenCalledWith(SCOPE, "work");
  await pressDialog(/Move to Trash \(314\)/);
  await waitFor(() => expect(pin).toHaveBeenCalled());
  expect(pin.mock.calls[0][2]).toBe("work");
});

test("a primary (non-danger) ask keeps its own button", async () => {
  run({ tone: "primary", label: () => "Apply" });
  const dlg = await findDialog();
  expect(within(dlg).getByRole("button", { name: "Apply" })).toBeTruthy();
  await cancelDialog();
});

test("phone: a bottom sheet whose button also says how many are kept",
  async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width: 639px"),
    media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {} }));
  run();
  const dlg = await findDialog();
  expect(dlg.getAttribute("data-size")).toBe("sm");
  expect(moveButton(dlg).textContent).toBe("Move to Trash (314) · keep 12");
  // the footer line is the desktop's; the phone has the button suffix
  expect(within(dlg).getByText("326 selected · 12 kept safe").className)
    .toContain("max-sm:hidden");
  // the row's expander and the checkbox are phone-sized (44 px touch targets)
  expect(within(dlg).getByRole("button",
    { name: "Show the mails of Invoices & receipts" }).className)
    .toContain("coarse:size-11");
  await cancelDialog();
});

test("German: the box, the groups, the footer and the button", async () => {
  setLang("de");
  run({ label: (k) => `In den Papierkorb (${k})`, title: "In den Papierkorb" });
  const dlg = await findDialog();
  expect(within(dlg).getByText("12 Mails könnten wichtig sein")).toBeTruthy();
  expect(within(dlg).getByText(/Rechnungen & Belege · 8/)).toBeTruthy();
  expect(within(dlg).getByText(/Buchungen & Tickets · 2/)).toBeTruthy();
  expect(within(dlg).getByText(/Verträge & Vertragsänderungen · 2/)).toBeTruthy();
  expect(within(dlg).getByText("326 ausgewählt · 12 behalten")).toBeTruthy();
  expect(within(dlg).getByText(/Angehakte werden geschützt/)).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Abbrechen" }));
  expect(await answer).toEqual({ ok: false });
});

test("one mail found reads in the singular", async () => {
  check.mockResolvedValue({ total: 30, kept: 1, classes: [
    { id: "jobs", count: 1, senders: [{ name: "Careers", count: 1 }],
      subjects: [{ subject: "Your application", sender: "Careers", ts: 1759500000 }] }] });
  run({ n: 30 });
  const dlg = await findDialog();
  expect(within(dlg).getByText("1 looks worth keeping")).toBeTruthy();
  expect(within(dlg).getByRole("checkbox",
    { name: "Keep Job applications: 1 mail" })).toBeTruthy();
  await cancelDialog();
});

test("a failed check is said in German too", async () => {
  setLang("de");
  check.mockRejectedValue(new Error("down"));
  run({ label: (k) => `In den Papierkorb (${k})` });
  const dlg = await findDialog();
  expect(within(dlg).getByText(/Die Prüfung .* war nicht möglich/)).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: "Abbrechen" }));
  expect(await answer).toEqual({ ok: false });
});

test("onlyIfFound: nothing found or too small asks nothing; a failed check "
  + "still asks, saying so", async () => {
  render(<DialogProvider><div /></DialogProvider>);
  check.mockResolvedValue({ total: 326, kept: 0, classes: [] });
  expect(await confirmTrash(ask({ onlyIfFound: true })))
    .toEqual({ ok: true, pinned: [] });
  expect(await confirmTrash(ask({ onlyIfFound: true, n: 5 })))
    .toEqual({ ok: true, pinned: [] });
  check.mockRejectedValue(new Error("down"));
  const p = confirmTrash(ask({ onlyIfFound: true }));
  const dlg = await findDialog();
  expect(within(dlg).getByText(/Could not check/)).toBeTruthy();
  await cancelDialog();
  expect(await p).toEqual({ ok: false });
});

test("bullets follow the ticks: counts there leave out what is kept safe",
  async () => {
  run({ bullets: (kept) => [`Move ${326 - kept} mails`] });
  const dlg = await findDialog();
  expect(within(dlg).getByText("Move 314 mails")).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("checkbox",
    { name: /Keep Invoices & receipts: 8 mails/ }));
  expect(within(dlg).getByText("Move 322 mails")).toBeTruthy();
  await cancelDialog();
});

test("the pin goes to the account that answered the check", async () => {
  check.mockResolvedValue({ ...FOUND, account: "work" });
  run({ account: "home" });
  await findDialog();
  await pressDialog(/Move to Trash \(314\)/);
  await waitFor(() => expect(pin).toHaveBeenCalled());
  expect(pin.mock.calls[0][2]).toBe("work");
});
