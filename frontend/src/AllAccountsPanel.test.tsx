// @vitest-environment jsdom
/* The All accounts page: the cards, the space bar, "Same sender, several
 * accounts" with its pane, the phone layout and German. The page is a PAGE:
 * nothing in it selects an account - only Open, Open in <account> and Fix it
 * leave it, through callbacks the app answers like the switcher does. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const overviewCall = vi.fn();
const copiesCall = vi.fn();
const trashCopies = vi.fn();
const setAccount = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  setAccount: (...a: unknown[]) => setAccount(...a),
  api: { accountsOverview: (...a: unknown[]) => overviewCall(...a),
    accountsCopies: (...a: unknown[]) => copiesCall(...a),
    trashCopies: (...a: unknown[]) => trashCopies(...a) },
}));

import { AllAccountsPanel } from "./components/AllAccountsPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import { clockShiftFor } from "./subscriptionsTestUtils";
import { overview, card } from "./allAccountsFixtures";
import type { AllAccountsResp, Config } from "./types";

const NOW = 1_700_000_300;
const cfg = (over: Record<string, unknown> = {}) => ({ accounts: Object
  .fromEntries(["proton", "icloud", "work", "old"].map((n) => [n, {
    user: `demo@${n}.example`, password_set: true, verified: true,
    oauth: null, ...(over[n] as object) }])) }) as unknown as Config;

const viewport = (width: number, coarse = false) =>
  vi.stubGlobal("matchMedia", (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = q.includes("pointer: coarse") ? coarse
      : (!min || width >= +min[1]) && (!max || width <= +max[1])
        && !q.includes("pointer") && !q.includes("reduced");
    return { matches, media: q, addEventListener: () => {},
      removeEventListener: () => {} };
  });

const cb = {
  onScanAll: vi.fn(), onClose: vi.fn(), onOpen: vi.fn(), onFix: vi.fn(),
  onOpenSender: vi.fn(), onFollow: vi.fn(), onClaim: vi.fn(), onShowCopies: vi.fn(),
  onAdd: vi.fn() };

const NAMES = ["proton", "icloud", "work", "old"];
const show = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <AllAccountsPanel cfg={cfg()} names={NAMES} current="proton" demo={false}
      scanRun={null} exists={() => true} {...cb} {...props} />
  </DialogProvider></ToastProvider>);

let restore = () => {};
beforeEach(() => {
  setLang("en");
  restore = clockShiftFor(NOW);
  viewport(1440);
  overviewCall.mockResolvedValue(overview());
  copiesCall.mockResolvedValue({ left_out: 1204, pairs: [
    { a: "old", b: "proton", mails: 412, size: 61 * 1048576, first: 1_679_000_000,
      last: 1_700_000_000, in_a: { trash: 409, size: 61 * 1048576, held: 3 },
      in_b: { trash: 412, size: 61 * 1048576, held: 0 } },
    { a: "work", b: "icloud", mails: 96, size: 18 * 1048576, first: 1_690_000_000,
      last: 1_700_000_000, in_a: { trash: 96, size: 18 * 1048576, held: 0 },
      in_b: { trash: 96, size: 18 * 1048576, held: 0 } }] });
  trashCopies.mockResolvedValue({ ok: true, queued: 409, job: "j-old", held: 3 });
});
afterEach(() => {
  cleanup();
  restore();
  vi.unstubAllGlobals();
  for (const f of [overviewCall, copiesCall, trashCopies, setAccount,
    ...Object.values(cb)]) f.mockReset();
  localStorage.clear();
  setLang("en");
});

const cards = () => screen.getAllByTestId("account-card");
const rows = () => screen.getAllByTestId("same-row");

test("desktop: a card per account with size, mails, new mail and its last scan",
  async () => {
  show();
  await screen.findByText("Where your 7.3 GB are");
  expect(cards()).toHaveLength(4);
  const proton = within(cards()[0]);
  expect(proton.getByText(/^proton/).textContent).toContain("· current");
  expect(proton.getByText("demo@proton.example")).toBeTruthy();
  expect(proton.getByText("236.0 MB")).toBeTruthy();
  expect(proton.getByText(/2,137\s+mails/)).toBeTruthy();
  expect(proton.getByText(/\+63 new/).textContent).toContain("scanned 1m ago");
  // only the selected account is marked
  expect(within(cards()[1]).queryByText(/current/)).toBeNull();
  expect(within(cards()[2]).getByText("5.9 GB")).toBeTruthy();
  expect(within(cards()[2]).getByText(/\+312 new/).textContent)
    .toContain("scanned 4m ago");
  // header: title, the one-line total, Scan all
  expect(screen.getByText("All accounts")).toBeTruthy();
  expect(screen.getByText("4 mailboxes · 26,891 mails · 7.3 GB")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Scan all" })).toBeTruthy();
});

test("a failed scan is orange with its age and a Fix it; the others have none",
  async () => {
  show();
  await screen.findByText("Where your 7.3 GB are");
  const old = within(cards()[3]);
  const line = old.getByText(/scan failed/);
  expect(line.textContent).toBe("scan failed 2h ago");
  expect(line.className).toContain("text-review-fg");
  expect(old.getByText(/\+21 new/)).toBeTruthy();
  fireEvent.click(old.getByRole("button", { name: "Fix it" }));
  expect(cb.onFix).toHaveBeenCalledWith("old");
  expect(cb.onOpen).not.toHaveBeenCalled();
  for (const i of [0, 1, 2])
    expect(within(cards()[i]).queryByRole("button", { name: "Fix it" })).toBeNull();
});

test("an account that is not signed in also offers Fix it, with the switcher's words",
  async () => {
  show({ cfg: cfg({ work: { password_set: false } }) });
  await screen.findByText("Where your 7.3 GB are");
  const work = within(cards()[2]);
  expect(work.getByText("Not signed in - set it up")).toBeTruthy();
  fireEvent.click(work.getByRole("button", { name: "Fix it" }));
  expect(cb.onFix).toHaveBeenCalledWith("work");
});

test("Open switches through the app's callback - for any card, the current one too",
  async () => {
  show();
  await screen.findByText("Where your 7.3 GB are");
  fireEvent.click(within(cards()[2]).getByRole("button", { name: "Open work" }));
  expect(cb.onOpen).toHaveBeenCalledWith("work");
  fireEvent.click(within(cards()[0]).getByRole("button", { name: "Open proton" }));
  expect(cb.onOpen).toHaveBeenLastCalledWith("proton");
});

test("the space bar and its legend, by account, in account order", async () => {
  show();
  const bar = await screen.findByRole("img", { name: /^Space by account:/ });
  expect(bar.getAttribute("aria-label")).toBe(
    "Space by account: proton 236.0 MB, icloud 131.5 MB, "
    + "work 5.9 GB, old 512.0 MB");
  expect(bar.children).toHaveLength(4);
  expect(screen.getByText("by account")).toBeTruthy();
  const share = (i: number) => parseFloat((bar.children[i] as HTMLElement)
    .style.width);
  expect(share(2)).toBeGreaterThan(share(0) * 10);   // work is the big one
  const total = [0, 1, 2, 3].reduce((n, i) => n + share(i), 0);
  expect(Math.round(total)).toBeLessThanOrEqual(100);
});

test("Same sender, several accounts: the first four rows with a chip per account",
  async () => {
  show();
  await screen.findByText("Same sender, several accounts");
  expect(screen.getByText("matched by sender address and domain")).toBeTruthy();
  expect(rows()).toHaveLength(4);
  const first = within(rows()[0]);
  expect(first.getByText("Deals Daily")).toBeTruthy();
  expect(first.getByText("you open 2% · in 3 accounts")).toBeTruthy();
  for (const n of ["210", "93", "44"]) expect(first.getByText(n)).toBeTruthy();
  expect(first.getByText("347")).toBeTruthy();
  expect(first.getByText("mails")).toBeTruthy();
  // the account names are for screen readers
  expect(first.getByText("work: 210 mails")).toBeTruthy();
  expect(first.getByText("old: 44 mails")).toBeTruthy();
});

test("All N expands the list in place and Fewer takes it back", async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    ...overview().same_sender[1], key: `s${i}.example`, name: `Sender ${i}` }));
  overviewCall.mockResolvedValue(overview({ same_sender: many }));
  show();
  await screen.findByText("Same sender, several accounts");
  expect(rows()).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "All 7" }));
  expect(rows()).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "Fewer" }));
  expect(rows()).toHaveLength(4);
});

test("no sender in several accounts: a plain line, no 'All N'", async () => {
  overviewCall.mockResolvedValue(overview({ same_sender: [] }));
  show();
  expect(await screen.findByText(
    "No sender writes to more than one of your accounts.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^All \d/ })).toBeNull();
});

test("the first row's pane opens beside the list: four actions, one line per account",
  async () => {
  viewport(1440);
  show();
  const pane = await screen.findByTestId("same-pane");
  const inPane = within(pane);
  expect(inPane.getByRole("heading", { name: "Deals Daily" })).toBeTruthy();
  expect(inPane.getByText("3 accounts · 347 mails · 8.9 MB · you open 2%"))
    .toBeTruthy();
  for (const label of ["Unsubscribe in 3", "Trash in 3", "Archive in 3",
    "Block in 3"])
    expect(inPane.getByRole("button", { name: label })).toBeTruthy();
  const list = within(inPane.getByRole("list",
    { name: "The accounts this sender writes to" }));
  const items = list.getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(within(items[0]).getByText("work")).toBeTruthy();
  expect(within(items[0]).getByText("deals@dealsdaily.example")).toBeTruthy();
  expect(within(items[0]).getByText(/210\s+mails · 5\.1\s+MB · one-click unsubscribe/))
    .toBeTruthy();
  expect(within(items[1]).getByText(/unsubscribe opens a page/)).toBeTruthy();
  expect(within(items[2]).getByText("promo@dealsdaily.example")).toBeTruthy();
  expect(inPane.getByText(/Each account runs its own step, with its own Undo and Activity entry/))
    .toBeTruthy();
  // a protected sender / pinned mails / blocked address say so
  fireEvent.click(within(items[2]).getByRole("button", { name: "Open in old" }));
  expect(cb.onOpenSender).toHaveBeenCalledWith("old", "promo@dealsdaily.example");
});

test("opening a pane or a row changes nothing: no account is switched", async () => {
  show();
  await screen.findByTestId("same-pane");
  fireEvent.click(rows()[2].querySelector("button")!);
  expect(within(screen.getByTestId("same-pane"))
    .getByRole("heading", { name: "ACME Store" })).toBeTruthy();
  expect(setAccount).not.toHaveBeenCalled();
  expect(localStorage.getItem("pmc_account")).toBeNull();
  for (const f of [cb.onOpen, cb.onFix, cb.onOpenSender]) {
    expect(f).not.toHaveBeenCalled();
  }
});

test("an action counts only the accounts it can still reach", async () => {
  const r = overview();
  r.same_sender[0].accounts[0] = { ...r.same_sender[0].accounts[0],
    state: "done", blocked: true };
  r.same_sender[0].accounts[1] = { ...r.same_sender[0].accounts[1],
    mails: 93, pinned: 93 };
  overviewCall.mockResolvedValue(r);
  show();
  const pane = within(await screen.findByTestId("same-pane"));
  expect(pane.getByRole("button", { name: "Unsubscribe in 2" })).toBeTruthy();
  expect(pane.getByRole("button", { name: "Trash in 2" })).toBeTruthy();
  expect(pane.getByRole("button", { name: "Block in 2" })).toBeTruthy();
  expect(pane.getByText("Blocked")).toBeTruthy();
  expect(pane.getByText("93 pinned stay")).toBeTruthy();
});

test("nothing left to unsubscribe: the button says so and is off", async () => {
  const r = overview();
  r.same_sender[0].accounts = r.same_sender[0].accounts
    .map((a) => ({ ...a, state: "done" as const }));
  overviewCall.mockResolvedValue(r);
  show();
  const pane = within(await screen.findByTestId("same-pane"));
  const btn = pane.getByRole("button", { name: "Unsubscribed" });
  expect((btn as HTMLButtonElement).disabled).toBe(true);
});

test("a protected account of the sender is listed as left alone", async () => {
  const r = overview();
  r.same_sender[0].left_out = [{ account: "icloud",
    addr: "deals@dealsdaily.example", why: "protected" }];
  overviewCall.mockResolvedValue(r);
  show();
  const pane = within(await screen.findByTestId("same-pane"));
  expect(pane.getByText("protected sender - left alone")).toBeTruthy();
  expect(pane.getByRole("button", { name: "Open in icloud" })).toBeTruthy();
});

test("Scan all runs in the app; while it runs the button names the account",
  async () => {
  const { rerender } = show();
  await screen.findByText("Where your 7.3 GB are");
  fireEvent.click(screen.getByRole("button", { name: "Scan all" }));
  expect(cb.onScanAll).toHaveBeenCalledTimes(1);
  rerender(
    <ToastProvider><DialogProvider>
      <AllAccountsPanel cfg={cfg()} names={NAMES} current="proton"
        demo={false} exists={() => true} {...cb}
        scanRun={{ account: "work", done: 1, total: 4 }} />
    </DialogProvider></ToastProvider>);
  const busy = screen.getByRole("button", { name: /Scanning work… \(2 of 4\)/ });
  expect((busy as HTMLButtonElement).disabled).toBe(true);
});

test("the cards poll while an account scans and stop when it is done", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const scanning = overview();
    scanning.accounts[1] = card("icloud", { status: "scanning", busy: false });
    overviewCall.mockResolvedValueOnce(scanning)
      .mockResolvedValue(overview());
    show();
    await screen.findByText("Scanning…");
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(screen.queryByText("Scanning…")).toBeNull());
    const n = overviewCall.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(overviewCall.mock.calls.length).toBe(n);   // not polled any more
  } finally { vi.useRealTimers(); }
});

test("the numbers failing to load show a retry, not a mode", async () => {
  overviewCall.mockRejectedValueOnce(new Error("x"))
    .mockResolvedValue(overview());
  show();
  expect(await screen.findByText("Couldn't load these numbers.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Where your 7.3 GB are")).toBeTruthy();
});

test("with one account the page says it needs two - and offers Add account",
  async () => {
  show({ names: ["proton"] });
  expect(await screen.findByText("All accounts needs two accounts")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Scan all" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  expect(cb.onAdd).toHaveBeenCalled();
});

test("it never asks to pick an account", async () => {
  show();
  await screen.findByText("Where your 7.3 GB are");
  expect(document.body.textContent).not.toMatch(/pick an account/i);
});

test("phone: rows with the size and what is new, a failed one with Fix it, rows open the sheet",
  async () => {
  viewport(390, true);
  show();
  await screen.findByText("Same sender, several accounts");
  expect(screen.queryByTestId("account-card")).toBeNull();
  // (the avatar's letter comes first in the row's text)
  const rowOf = (name: string) => screen.getAllByRole("button").find(
    (b) => b.textContent!.slice(1).startsWith(name))!;
  expect(rowOf("proton").textContent).toContain("236.0 MB");
  expect(rowOf("old").textContent).toContain("scan failed 2h ago");
  fireEvent.click(rowOf("work"));
  expect(cb.onOpen).toHaveBeenCalledWith("work");
  fireEvent.click(screen.getByRole("button", { name: "Fix it" }));
  expect(cb.onFix).toHaveBeenCalledWith("old");
  // a same-sender row opens the pane as a sheet, with the same four actions
  fireEvent.click(rows()[0].querySelector("button")!);
  const sheet = await screen.findByRole("dialog", { name: "Deals Daily" });
  for (const label of ["Unsubscribe in 3", "Trash in 3", "Archive in 3",
    "Block in 3"])
    expect(within(sheet).getByRole("button", { name: label })).toBeTruthy();
  fireEvent.click(within(sheet).getByRole("button", { name: "Open in work" }));
  expect(cb.onOpenSender).toHaveBeenCalledWith("work", "deals@dealsdaily.example");
});

test("German", async () => {
  setLang("de");
  show();
  await screen.findByText("Gleicher Absender, mehrere Konten");
  expect(screen.getByText("Alle Konten")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Alle scannen" })).toBeTruthy();
  expect(screen.getByText("gefunden über Absenderadresse und Domain")).toBeTruthy();
  expect(within(cards()[3]).getByRole("button", { name: "Beheben" })).toBeTruthy();
  expect(within(cards()[3]).getByText(/Scan vor 2\sStd\. fehlgeschlagen/))
    .toBeTruthy();
  const pane = within(screen.getByTestId("same-pane"));
  for (const label of ["Abbestellen in 3", "Papierkorb in 3",
    "Archivieren in 3", "Blockieren in 3"])
    expect(pane.getByRole("button", { name: label })).toBeTruthy();
  expect(pane.getByRole("button", { name: "In old öffnen" })).toBeTruthy();
});

test("every part of the existing UI is untouched: this panel adds, it removes nothing",
  async () => {
  // the account cards keep their own order and the current one stays marked;
  // an account in a different state is not hidden (no filter on the page)
  const r: AllAccountsResp = overview();
  overviewCall.mockResolvedValue(r);
  show();
  await screen.findByText("Where your 7.3 GB are");
  expect(cards().map((c) => c.querySelector("div")!.textContent))
    .toEqual(r.accounts.map((a) => expect.stringContaining(a.name)));
});


/* ------------------------ Same mails in several accounts ------------------------ */

const copyRows = () => screen.getAllByTestId("copies-row");

test("the card lists each pair of accounts with its exact copies, size and a Review", async () => {
  show();
  const card = within(await screen.findByTestId("copies-card"));
  expect(card.getByText("Same mails in several accounts")).toBeTruthy();
  expect(card.getByText("exact copies: same Message-ID and size")).toBeTruthy();
  expect(copyRows()).toHaveLength(2);
  expect(within(copyRows()[0]).getByText(/^412\smails · 61\.0\sMB in old and proton$/)).toBeTruthy();
  expect(within(copyRows()[0]).getByText(/^since /)).toBeTruthy();
  expect(within(copyRows()[1]).getByText(/^96\smails · 18\.0\sMB in work and icloud$/)).toBeTruthy();
  // what "Move to another account" made is named, not offered
  expect(card.getByText(/^Left out: 1,204\scopies you made yourself with “Move to another account”\. Duplicates inside one account stay in Duplicates\.$/))
    .toBeTruthy();
  // the page is still the page: the cards and the same-sender list are there
  expect(screen.getAllByTestId("account-card")).toHaveLength(4);
  expect(screen.getAllByTestId("same-row")).toHaveLength(4);
});

test("without copies the card says so, and still names the Duplicates", async () => {
  copiesCall.mockResolvedValue({ pairs: [], left_out: 0 });
  show();
  const card = within(await screen.findByTestId("copies-card"));
  expect(card.getByText("No mail is in more than one of your accounts.")).toBeTruthy();
  expect(card.getByText("Duplicates inside one account stay in Duplicates.")).toBeTruthy();
});

test("a failing read leaves the page without the card, nothing else", async () => {
  copiesCall.mockRejectedValue(new Error("x"));
  show();
  await screen.findByText("Where your 7.3 GB are");
  await waitFor(() => expect(copiesCall).toHaveBeenCalled());
  expect(screen.queryByTestId("copies-card")).toBeNull();
  expect(screen.getAllByTestId("same-row")).toHaveLength(4);
});

test("Review opens the dialog of that pair - and opening it selects no account", async () => {
  show();
  await screen.findByTestId("copies-card");
  fireEvent.click(within(copyRows()[0]).getByRole("button", { name: "Review the copies in old and proton" }));
  expect(await screen.findByText(/^412\smails are in both old and proton$/)).toBeTruthy();
  expect(setAccount).not.toHaveBeenCalled();
  for (const f of [cb.onOpen, cb.onFix, cb.onOpenSender, cb.onShowCopies]) {
    expect(f).not.toHaveBeenCalled();
  }
});

test("the step runs through the app: claimed, ONE job followed, nothing switched", async () => {
  show();
  await screen.findByTestId("copies-card");
  fireEvent.click(within(copyRows()[0]).getByRole("button", { name: /^Review/ }));
  await screen.findByRole("radiogroup");
  fireEvent.click(screen.getByRole("button", { name: /^Trash\s409\scopies\sin\sold$/ }));
  await waitFor(() => expect(cb.onFollow).toHaveBeenCalled());
  expect(trashCopies).toHaveBeenCalledWith("proton", "old");
  expect(cb.onClaim).toHaveBeenCalledWith(["old"], true);
  expect(cb.onFollow).toHaveBeenCalledWith({ kind: "trash", steps: [{ account: "old", job: "j-old" }] });
  expect(setAccount).not.toHaveBeenCalled();
  expect(cb.onOpen).not.toHaveBeenCalled();
});

test("Just show them goes through the app (it opens All mail there, like Open)", async () => {
  show();
  await screen.findByTestId("copies-card");
  fireEvent.click(within(copyRows()[1]).getByRole("button", { name: /^Review/ }));
  await screen.findByRole("radiogroup");
  fireEvent.click(screen.getByRole("radio", { name: /^Just show them/ }));
  fireEvent.click(screen.getByRole("button", { name: "Show them" }));
  expect(cb.onShowCopies).toHaveBeenCalledWith("work", "icloud");
  expect(trashCopies).not.toHaveBeenCalled();
});

test("the copies are counted again once a move or a scan has ended", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const busy = overview();
    busy.accounts[0] = { ...busy.accounts[0], busy: true };
    overviewCall.mockResolvedValueOnce(busy).mockResolvedValue(overview());
    show();
    await screen.findByTestId("copies-card");
    const n = copiesCall.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(copiesCall.mock.calls.length).toBeGreaterThan(n));
  } finally { vi.useRealTimers(); }
});

test("phone: the card is on the page too, with the same Review", async () => {
  viewport(390, true);
  show();
  const card = within(await screen.findByTestId("copies-card"));
  expect(card.getAllByRole("button", { name: /^Review/ })).toHaveLength(2);
});

test("German card", async () => {
  setLang("de");
  show();
  const card = within(await screen.findByTestId("copies-card"));
  expect(card.getByText("Gleiche Mails in mehreren Konten")).toBeTruthy();
  expect(card.getAllByRole("button", { name: /^Die Kopien in/ })).toHaveLength(2);
  expect(card.getByText(/^Nicht dabei: 1\.204\sKopien, die du selbst mit „Auf ein anderes Konto umziehen“/)).toBeTruthy();
});
