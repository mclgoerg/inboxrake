// @vitest-environment jsdom
/* Move to another account: the "What to bring" page (kinds, de-duplicated
 * sums, free space, the folder name), starting a copy, the copy states
 * (running, paused, stopped, cancelled, done) and the Tell-them step -
 * English, German and the phone's bottom button. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountCopyPanel, etaText } from "./components/AccountCopy";
import { DialogProvider } from "./components/ui";
import { setLang, t } from "./i18n";
import { fmtSize, fmtSizeGb } from "./lib";
import { EN } from "./locales/en";
import { DE } from "./locales/de";
import type { Config, CopyJob, CopyPlan, CopyTell } from "./types";

const copyPlan = vi.fn();
const copySpace = vi.fn();
const copyStatus = vi.fn();
const copyStart = vi.fn();
const copyPause = vi.fn();
const copyResume = vi.fn();
const copyCancel = vi.fn();
const copyDismiss = vi.fn();
const copyTell = vi.fn();
const copySetTold = vi.fn();
const scan = vi.fn();

vi.mock("./api", () => ({
  api: {
    copyPlan: (...a: unknown[]) => copyPlan(...a),
    copySpace: (...a: unknown[]) => copySpace(...a),
    copyStatus: () => copyStatus(),
    copyStart: (...a: unknown[]) => copyStart(...a),
    copyPause: () => copyPause(),
    copyResume: () => copyResume(),
    copyCancel: () => copyCancel(),
    copyDismiss: () => copyDismiss(),
    copyTell: (...a: unknown[]) => copyTell(...a),
    copySetTold: (...a: unknown[]) => copySetTold(...a),
    scan: (...a: unknown[]) => scan(...a),
  },
  errorText: (d: string) => `[${d}]`,
}));

const cfg = (names = ["gmail", "proton"]) => ({
  accounts: Object.fromEntries(names.map((n) => [n,
    { user: `${n}@x.example` }])),
  default_account: names[0],
}) as unknown as Config;

// bits: replied 1, orders 2, accounts 4, appointments 8, protected 16,
// pinned 32, newsletter 64, other 128
const BITS = { replied: 1, orders: 2, accounts: 4, appointments: 8,
  protected: 16, pinned: 32, newsletter: 64, other: 128 };
const plan = (over: Partial<CopyPlan> = {}): CopyPlan => ({
  source: { name: "gmail", address: "old@gmail.example", mails: 7000,
    size: 1_400_000_000 },
  target: { name: "proton", address: "me@proton.example" },
  folder: "From gmail",
  kinds: [
    { id: "replied", mails: 1240, size: 310_000_000, default: true },
    { id: "orders", mails: 420, size: 96_000_000, default: true },
    { id: "accounts", mails: 210, size: 4_000_000, default: true },
    { id: "appointments", mails: 88, size: 12_000_000, default: true },
    { id: "protected", mails: 160, size: 40_000_000, default: true },
    { id: "pinned", mails: 34, size: 22_000_000, default: true },
    { id: "newsletter", mails: 3100, size: 610_000_000, default: false },
    { id: "other", mails: 2050, size: 380_000_000, default: false },
  ],
  bits: BITS,
  // replied+orders overlap in 240 mails
  combos: [
    { mask: 1, mails: 1000, size: 250_000_000 },
    { mask: 3, mails: 240, size: 60_000_000 },
    { mask: 2, mails: 180, size: 36_000_000 },
    { mask: 4, mails: 210, size: 4_000_000 },
    { mask: 8, mails: 88, size: 12_000_000 },
    { mask: 16, mails: 160, size: 40_000_000 },
    { mask: 32, mails: 34, size: 22_000_000 },
    { mask: 64, mails: 3100, size: 610_000_000 },
    { mask: 128, mails: 2050, size: 380_000_000 },
  ],
  scanned: true, scanning: false, ...over,
});

const job = (over: Partial<CopyJob> = {}): CopyJob => ({
  id: "j1", source: "gmail", target: "proton", folder: "From gmail",
  kinds: ["replied", "orders"], status: "running", total: 2152,
  bytes_total: 484_000_000, processed: 1420, copied: 1420, skipped: 0,
  checked: 1420, unchecked: 0, too_large: 0, missing: 0, failed: 0, unsure: 0,
  bytes_done: 318_000_000, started: 1, finished: 0, error: "", active_s: 120,
  eta_s: 360, ...over,
});

const tell = (over: Partial<CopyTell> = {}): CopyTell => ({
  source: { name: "gmail", address: "old@gmail.example" },
  target: { name: "proton", address: "me@proton.example" },
  total: 3, done: 1,
  senders: [
    { addr: "bank@bank.example", name: "Bank of Example", mails: 9, last: 1,
      done: true },
    { addr: "lib@library.example", name: "City Library", mails: 4, last: 1,
      done: false },
    { addr: "shop@acme.example", name: "", mails: 2, last: 1, done: false },
  ],
  newsletters: 31, newsletter_keys: ["a@n.example", "b@n.example"], ...over,
});

const onClose = vi.fn();
const onReview = vi.fn();
const show = (names?: string[]) => render(<DialogProvider>
  <AccountCopyPanel cfg={cfg(names)} from="gmail" onClose={onClose}
    onReviewUnsubs={onReview} />
</DialogProvider>);

beforeEach(() => {
  setLang("en");
  copyPlan.mockResolvedValue(plan());
  copySpace.mockResolvedValue({ free: 12_400_000_000 });
  copyStatus.mockResolvedValue({ job: null });
  copyTell.mockResolvedValue(tell());
});
afterEach(() => {
  cleanup();
  for (const f of [copyPlan, copySpace, copyStatus, copyStart, copyPause,
    copyResume, copyCancel, copyDismiss, copyTell, copySetTold, scan, onClose,
    onReview]) f.mockReset();
  setLang("en");
});

const row = (name: string) => screen.getByRole("checkbox",
  { name: new RegExp(name) });
/** The matchers compare against whitespace-normalised DOM text: no NBSP. */
const flat = (s: string) => s.replace(/\u00a0/g, " ");
const goButtons = () => screen.getAllByRole("button").filter((b) =>
  /^(Copy [\d,]+\smails?|[\d.]+\sMails? kopieren)$/.test(b.textContent ?? ""));

// ------------------------------------------------------------ What to bring

test("the kinds are listed with counts and sizes, the board's ones ticked",
  async () => {
    show();
    await screen.findByText("People you write to");
    for (const label of ["People you write to", "Orders & deliveries",
      "Accounts & security", "Appointments & bookings", "Protected senders",
      "Pinned mails", "Newsletters", "Other senders"])
      expect(screen.getByText(label)).toBeTruthy();
    const ticked = (l: string) => (row(l) as HTMLInputElement).checked;
    for (const l of ["People you write to", "Orders & deliveries",
      "Accounts & security", "Appointments & bookings", "Protected senders",
      "Pinned mails"]) expect(ticked(l)).toBe(true);
    expect(ticked("Newsletters")).toBe(false);
    expect(ticked("Other senders")).toBe(false);
    expect(screen.getByText("1,240 mails")).toBeTruthy();
    expect(screen.getByText(flat(fmtSize(310_000_000)))).toBeTruthy();
    // the ones left behind say so
    expect(screen.getAllByText("leave behind")).toHaveLength(2);
    expect(screen.getByText(/A mail in two kinds counts once/)).toBeTruthy();
    // the two accounts of the pair, with what is in the first
    expect(screen.getByText("old@gmail.example")).toBeTruthy();
    expect(screen.getByText("me@proton.example")).toBeTruthy();
  });

test("a mail in two kinds counts once, and the sum follows the ticks",
  async () => {
    show();
    await screen.findByText("People you write to");
    // 1000 + 240 + 180 + 210 + 88 + 160 + 34 = 1912 (replied+orders: once)
    const card = screen.getByRole("region", { name: "You bring" });
    expect(within(card).getByText("1,912")).toBeTruthy();
    expect(within(card).getByText(flat(`mails · ${fmtSizeGb(424_000_000)}`)))
      .toBeTruthy();
    expect(within(card).getByText(flat(`leave ${fmtSizeGb(976_000_000)}`)))
      .toBeTruthy();
    expect(goButtons().map((b) => b.textContent))
      .toEqual(["Copy 1,912\u00a0mails", "Copy 1,912\u00a0mails"]);
    fireEvent.click(row("Newsletters"));
    expect(within(card).getByText("5,012")).toBeTruthy();
    fireEvent.click(row("People you write to"));      // its 1000 only-ones go
    expect(within(card).getByText("4,012")).toBeTruthy();
    // un-tick everything: nothing to copy, said in words, buttons off
    for (const l of ["Orders & deliveries", "Accounts & security",
      "Appointments & bookings", "Protected senders", "Pinned mails",
      "Newsletters"]) fireEvent.click(row(l));
    expect(within(card).getByText("0")).toBeTruthy();
    expect(within(card).getByText(/Nothing ticked/)).toBeTruthy();
    for (const b of goButtons()) expect((b as HTMLButtonElement).disabled)
      .toBe(true);
  });

test("the notes: dates and flags, duplicates, free space, nothing deleted",
  async () => {
    show();
    const card = await screen.findByRole("region", { name: "You bring" });
    await within(card).findByText(flat(`proton has ${fmtSizeGb(12_400_000_000)} free.`));
    expect(within(card).getByText(
      "Dates, read / unread and flags stay as they were.")).toBeTruthy();
    expect(within(card).getByText(
      "Mails already in proton (same Message-ID) are skipped.")).toBeTruthy();
    expect(within(card).getByText(
      "Nothing is deleted. gmail stays as it is until you decide.")).toBeTruthy();
    expect(copySpace).toHaveBeenCalledWith("proton", "From gmail");
  });

test("without a quota the free-space line is left out, not guessed",
  async () => {
    copySpace.mockResolvedValue({ free: null });
    show();
    const card = await screen.findByRole("region", { name: "You bring" });
    await waitFor(() => expect(copySpace).toHaveBeenCalled());
    expect(within(card).queryByText(/free\./)).toBeNull();
    expect(within(card).getByText(/Nothing is deleted/)).toBeTruthy();
  });

test("a folder that exists is said to be added to", async () => {
  copySpace.mockResolvedValue({ free: null, exists: true, reserved: false });
  show();
  const card = await screen.findByRole("region", { name: "You bring" });
  await within(card).findByText(
    "That folder already exists in proton - the mails are added to it.");
  expect((goButtons()[0] as HTMLButtonElement).disabled).toBe(false);
});

test("a folder the server uses for something else switches Copy off",
  async () => {
    copySpace.mockImplementation((_t: string, folder: string) =>
      Promise.resolve({ free: null, exists: true, reserved: folder === "Trash" }));
    show();
    const input = await screen.findByRole("textbox", { name: "Folder name" });
    fireEvent.change(input, { target: { value: "Trash" } });
    await screen.findByText(/“Trash” is a folder the server uses for something else/);
    for (const b of goButtons()) expect((b as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.change(input, { target: { value: "Old mail" } });
    await waitFor(() => expect(screen.queryByText(/uses for something else/))
      .toBeNull());
    expect((goButtons()[0] as HTMLButtonElement).disabled).toBe(false);
  });

test("a target with too little room warns", async () => {
  copySpace.mockResolvedValue({ free: 100_000_000 });
  show();
  const card = await screen.findByRole("region", { name: "You bring" });
  await within(card).findByText(flat(
    `proton has only ${fmtSizeGb(100_000_000)} free - that may not be enough.`));
});

test("the new folder's name is editable and Copy starts with it", async () => {
  copyStart.mockResolvedValue({ job: job() });
  show();
  const input = await screen.findByRole("textbox", { name: "Folder name" });
  expect((input as HTMLInputElement).value).toBe("From gmail");
  fireEvent.change(input, { target: { value: "Old mail" } });
  fireEvent.click(goButtons()[0]);
  await waitFor(() => expect(copyStart).toHaveBeenCalledWith("gmail", "proton",
    ["replied", "orders", "accounts", "appointments", "protected", "pinned"],
    "Old mail"));
  // the page moves on to the Copy step
  await screen.findByText("1,420");
});

test("an empty folder name switches Copy off", async () => {
  show();
  const input = await screen.findByRole("textbox", { name: "Folder name" });
  fireEvent.change(input, { target: { value: "  " } });
  for (const b of goButtons()) expect((b as HTMLButtonElement).disabled)
    .toBe(true);
});

test("phone: the Copy button is also in a bar under the page", async () => {
  show();
  await screen.findByText("People you write to");
  const [card, bar] = goButtons();
  // the card's button is for wide screens, the bar's for phones
  expect(card.className).toContain("max-lg:hidden");
  expect(bar.closest("div")!.className).toContain("lg:hidden");
  expect(bar.closest("div")!.className).toContain("safe-area-inset-bottom");
});

test("a source that was never scanned asks for a scan first", async () => {
  copyPlan.mockResolvedValue(plan({ scanned: false, kinds: [], combos: [] }));
  scan.mockResolvedValue({ ok: true });
  show();
  await screen.findByText(/Scan gmail first/);
  fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
  await waitFor(() => expect(scan).toHaveBeenCalledWith("gmail"));
});

test("two accounts are needed", async () => {
  show(["gmail"]);
  await screen.findByText("Add a second account first.");
  expect(copyPlan).not.toHaveBeenCalled();
});

test("a refusal of the plan is shown", async () => {
  copyPlan.mockRejectedValue(new Error("[copy_unknown_account]"));
  show();
  await screen.findByText("[copy_unknown_account]");
});

test("a start that is refused shows why and stays on the page", async () => {
  copyStart.mockRejectedValue(new Error("[copy_busy]"));
  show();
  await screen.findByText("People you write to");
  fireEvent.click(goButtons()[0]);
  await screen.findByText("[copy_busy]");
  expect(screen.queryByText("1,420")).toBeNull();
});

// ------------------------------------------------------------- Copy states

test("running: progress, minutes left, Pause and Cancel", async () => {
  copyStatus.mockResolvedValue({ job: job() });
  copyPause.mockResolvedValue({ job: job({ status: "paused", eta_s: null }) });
  show();
  await screen.findByText("1,420");
  expect(screen.getByText(flat(`of 2,152 copied · ${fmtSizeGb(318_000_000)} of ${fmtSizeGb(484_000_000)}`)))
    .toBeTruthy();
  expect(screen.getByText("about 6 min left")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Copy" })).toBeTruthy();
  expect(screen.getByText(/Each mail is checked in proton after it is copied/))
    .toBeTruthy();
  expect(screen.getByText(/You can close this page/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await screen.findByText("Paused");
  expect(screen.getByText(/nothing more is copied until you resume/))
    .toBeTruthy();
  expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
});

test("the pickers and ticks are locked while a copy is live", async () => {
  copyStatus.mockResolvedValue({ job: job() });
  show();
  await screen.findByText("1,420");
  fireEvent.click(screen.getByRole("button", { name: /What to bring/ }));
  await screen.findByText("People you write to");
  expect((row("Newsletters") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/A copy is already running/)).toBeTruthy();
  for (const b of goButtons()) expect((b as HTMLButtonElement).disabled)
    .toBe(true);
});

test("resume and cancel call the server", async () => {
  copyStatus.mockResolvedValue({ job: job({ status: "paused" }) });
  copyResume.mockResolvedValue({ job: job() });
  copyCancel.mockResolvedValue({ job: job({ status: "cancelled",
    copied: 1420 }) });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
  await waitFor(() => expect(copyResume).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(copyCancel).toHaveBeenCalled());
  await screen.findByText(
    "Copy cancelled. 1,420 mails were copied; nothing was deleted.");
  expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
});

test("a stopped copy says why, with Resume", async () => {
  copyStatus.mockResolvedValue({ job: job({ status: "error",
    error: "copy_target_full" }) });
  show();
  await screen.findByText("The copy stopped");
  expect(screen.getByText("[copy_target_full]")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
});

test("two accounts that are one mailbox: nothing to resume, only Start over",
  async () => {
    copyStatus.mockResolvedValue({ job: job({ status: "error",
      error: "copy_same_mailbox" }) });
    copyDismiss.mockResolvedValue({ job: null });
    show();
    await screen.findByText("The copy stopped");
    expect(screen.getByText("[copy_same_mailbox]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(copyDismiss).toHaveBeenCalled());
    await screen.findByText("People you write to");
  });

test("done with mails the server never confirmed says they may be missing",
  async () => {
    copyStatus.mockResolvedValue({ job: job({ status: "done", processed: 9,
      copied: 8, checked: 8, unsure: 1 }) });
    copyStart.mockResolvedValue({ job: job() });
    show();
    await screen.findByText(/8 mails are in proton/);
    expect(screen.queryByText(/All checked/)).toBeNull();
    expect(screen.getAllByText(
      "1 mail may not have been copied - the server never confirmed it"))
      .toHaveLength(2);                 // the sub line and the notice
    fireEvent.click(screen.getByRole("button", { name: "Copy the rest" }));
    await waitFor(() => expect(copyStart).toHaveBeenCalled());
  });

test("done: the card as decided - originals stay, no trash offer", async () => {
  copyStatus.mockResolvedValue({ job: job({ status: "done", total: 2152,
    processed: 2152, copied: 2146, skipped: 6, checked: 2146 }) });
  show();
  await screen.findByText("2,146 mails are in proton › From gmail");
  expect(screen.getByText("All checked · 6 were already there and skipped"))
    .toBeTruthy();
  expect(screen.getByText(
    "The originals are still in gmail - nothing was deleted.")).toBeTruthy();
  // copy only: nothing offers to trash the originals
  expect(screen.queryByText(/Trash/)).toBeNull();
  expect(screen.getByRole("button", { name: "Tell them…" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy more…" })).toBeTruthy();
});

test("done with nothing new has a title of its own", async () => {
  copyStatus.mockResolvedValue({ job: job({ status: "done", processed: 7,
    copied: 0, skipped: 7, checked: 0 }) });
  show();
  await screen.findByText("Nothing new to copy - 7 mails were already in proton");
  expect(screen.queryByText(/0 mails are in/)).toBeNull();
  expect(screen.getByText("All checked")).toBeTruthy();
  cleanup();
  setLang("de");
  show();
  await screen.findByText("Nichts Neues zu kopieren – 7 Mails waren schon in proton");
});

test("done with leftovers names each kind of leftover", async () => {
  copyStatus.mockResolvedValue({ job: job({ status: "done", processed: 100,
    copied: 80, skipped: 5, checked: 70, unchecked: 10, too_large: 2,
    missing: 3, failed: 4 }) });
  copyStart.mockResolvedValue({ job: job() });
  show();
  await screen.findByText(/80 mails are in proton/);
  expect(screen.queryByText(/All checked/)).toBeNull();
  expect(screen.getByText(
    "10 without a Message-ID could not be checked · 5 were already there and "
    + "skipped · 2 over 50 MB were skipped · 3 were no longer in gmail"))
    .toBeTruthy();
  expect(screen.getByText("4 mails could not be copied.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy the rest" }));
  await waitFor(() => expect(copyStart).toHaveBeenCalledWith("gmail",
    "proton", ["replied", "orders"], "From gmail"));
});

test("Copy more… forgets the finished copy and returns to the choice",
  async () => {
    copyStatus.mockResolvedValue({ job: job({ status: "done", processed: 5,
      copied: 5 }) });
    copyDismiss.mockResolvedValue({ job: null });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Copy more…" }));
    await waitFor(() => expect(copyDismiss).toHaveBeenCalled());
    await screen.findByText("People you write to");
  });

test("minutes left: under a minute, minutes, hours", () => {
  expect(etaText(null)).toBe("");
  expect(etaText(20)).toBe("less than a minute left");
  expect(etaText(61)).toBe("about 2 min left");
  expect(etaText(3600)).toBe("about 60 min left");
  expect(etaText(3 * 3600)).toBe("about 3 h left");
});

// ---------------------------------------------------------------- Tell them

const openTell = async () => {
  copyStatus.mockResolvedValue({ job: job({ status: "done", processed: 5,
    copied: 5 }) });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Tell them…" }));
  await screen.findByText("Bank of Example");
};

test("Tell them: the senders, the new address, the count done", async () => {
  await openTell();
  // the page's title is now the step's
  expect(screen.queryByText("Move to another account")).toBeNull();
  expect(screen.getAllByText("Tell them").length).toBeGreaterThan(1);
  expect(screen.getByText("Your new address: proton@x.example")).toBeTruthy();
  expect(screen.getByText(/These senders wrote to/)).toBeTruthy();
  expect(screen.getByText("old@gmail.example")).toBeTruthy();   // bold address
  expect(copyTell).toHaveBeenCalledWith("gmail", "proton");
  expect(screen.getByText("City Library")).toBeTruthy();
  // a sender without a name is shown by its address
  expect(screen.getAllByText("shop@acme.example")).toHaveLength(2);
  expect(screen.getByText("1 of 3 done")).toBeTruthy();
  const bank = screen.getByRole("checkbox", { name: "Told Bank of Example" });
  expect((bank as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("Bank of Example").className)
    .toContain("line-through");
});

test("ticking a sender is saved and counted", async () => {
  await openTell();
  copySetTold.mockResolvedValue(tell({ done: 2, senders: tell().senders.map(
    (s) => s.addr === "lib@library.example" ? { ...s, done: true } : s) }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Told City Library" }));
  await waitFor(() => expect(copySetTold).toHaveBeenCalledWith("gmail",
    "proton", "lib@library.example", true));
  await screen.findByText("2 of 3 done");
});

test("newsletters are not told: they go to the unsubscribe review",
  async () => {
    await openTell();
    expect(screen.getByText("31 newsletters")).toBeTruthy();
    expect(screen.getByText(
      "No need to tell them - unsubscribe the old address instead."))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button",
      { name: "Review 31 unsubscribes" }));
    expect(onReview).toHaveBeenCalledWith("gmail",
      ["a@n.example", "b@n.example"]);
  });

test("a long list shows the first eight and N more", async () => {
  const senders = Array.from({ length: 12 }, (_, i) => ({
    addr: `s${i}@x.example`, name: `Sender ${i}`, mails: 1, last: 1,
    done: false }));
  copyTell.mockResolvedValue(tell({ senders, total: 12, done: 0 }));
  copyStatus.mockResolvedValue({ job: job({ status: "done", processed: 5,
    copied: 5 }) });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Tell them…" }));
  await screen.findByText("Sender 0");
  expect(screen.queryByText("Sender 8")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /4 more/ }));
  expect(screen.getByText("Sender 11")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
  expect(screen.queryByText("Sender 11")).toBeNull();
});

test("nobody wrote: an empty state, newsletters still offered", async () => {
  copyTell.mockResolvedValue(tell({ senders: [], total: 0, done: 0 }));
  await openTell().catch(() => {});
  await screen.findByText("Nobody wrote to old@gmail.example in the last 90 days.");
});

// -------------------------------------------------------------------- German

test("German: the page, the copy states and the Tell-them step", async () => {
  setLang("de");
  copyStatus.mockResolvedValue({ job: job() });
  show();
  await screen.findByText("1.420");
  expect(screen.getByText("Auf ein anderes Konto umziehen")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pausieren" })).toBeTruthy();
  expect(screen.getByText("noch etwa 6 Min.")).toBeTruthy();
  expect(screen.getByText(/Jede Mail wird in proton geprüft/)).toBeTruthy();
});

test("German: the kinds and the notes", async () => {
  setLang("de");
  show();
  await screen.findByText("Leute, denen du schreibst");
  expect(screen.getByText("Angeheftete Mails")).toBeTruthy();
  expect(screen.getAllByText("zurücklassen")).toHaveLength(2);
  expect(screen.getByText(/Eine Mail in zwei Arten zählt nur einmal/))
    .toBeTruthy();
  const card = screen.getByRole("region", { name: "Du nimmst mit" });
  await within(card).findByText(
    flat(`In proton sind noch ${fmtSizeGb(12_400_000_000)} frei.`));
  expect(goButtons.call(null)).toBeTruthy;
});

test("German: the folder defaults to Von <account>", async () => {
  setLang("de");
  show();
  const input = await screen.findByRole("textbox", { name: "Ordnername" });
  expect((input as HTMLInputElement).value).toBe("Von gmail");
});

test("every copy.* text has a German version, and its words differ", () => {
  const keys = Object.keys(EN).filter((k) => k.startsWith("copy."));
  expect(keys.length).toBeGreaterThan(60);
  for (const k of keys) {
    expect(DE[k], k).toBeTruthy();
    // the same placeholders in both languages
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)]
      .map((m) => m[1]).sort();
    expect(params(DE[k]), k).toEqual(params(EN[k]));
  }
  expect(t("copy.go", { n: 3 })).toBe("Copy 3\u00a0mails");
  expect(t("copy.go", { n: 1 })).toBe("Copy 1\u00a0mail");
});
