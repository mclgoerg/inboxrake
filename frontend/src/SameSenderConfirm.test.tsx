// @vitest-environment jsdom
/* "Unsubscribe / Trash / Archive / Block in N": the confirm that lists each
 * account with its own tick, count and Keep-safe result, reads the numbers
 * again on open, then runs one step per ticked account - each pinned to its
 * own account, never to the selected one. */

import { act, cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const overviewCall = vi.fn();
const keepCheck = vi.fn();
const keepPin = vi.fn();
const unsubscribe = vi.fn();
const deleteGroups = vi.fn();
const block = vi.fn();
const deleteRule = vi.fn();
const ack = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    accountsOverview: (...a: unknown[]) => overviewCall(...a),
    keepSafeCheck: (...a: unknown[]) => keepCheck(...a),
    keepSafePin: (...a: unknown[]) => keepPin(...a),
    unsubscribe: (...a: unknown[]) => unsubscribe(...a),
    deleteGroups: (...a: unknown[]) => deleteGroups(...a),
    block: (...a: unknown[]) => block(...a),
    deleteRule: (...a: unknown[]) => deleteRule(...a),
    unsubscribeAck: (...a: unknown[]) => ack(...a),
  },
}));

import { noteAccountSwitch } from "./accountGuard";
import { SameSenderConfirm } from "./components/SameSenderConfirm";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import { deals, overview, row } from "./allAccountsFixtures";
import type { KeepSafeCheck, SameSenderRow } from "./types";
import type { SameAction } from "./sameSender";

const found = (kept: number): KeepSafeCheck => ({ total: 100, kept,
  classes: [{ id: "invoices", count: kept, senders: [{ name: "Deals", count: kept }],
    subjects: [{ subject: "Your invoice for November", sender: "Deals",
      ts: 1_700_000_000 }] }] });

const onFollow = vi.fn();
const onChanged = vi.fn();
const onClose = vi.fn();
const mount = (action: SameAction, props: Record<string, unknown> = {}) =>
  render(<ToastProvider><DialogProvider>
    <SameSenderConfirm row={deals()} action={action} exists={() => true}
      demo={false} onFollow={onFollow} onChanged={onChanged} onClose={onClose}
      {...props} />
  </DialogProvider></ToastProvider>);

beforeEach(() => {
  setLang("en");
  overviewCall.mockResolvedValue(overview({ same_sender: [deals()] }));
  keepCheck.mockImplementation((_s: unknown, account: string) =>
    Promise.resolve(account === "work" ? found(6)
      : account === "proton" ? found(2) : { total: 44, kept: 0, classes: [] }));
  keepPin.mockResolvedValue({ pinned: 1, items: [] });
  deleteGroups.mockImplementation((...a: unknown[]) =>
    Promise.resolve({ ok: true, queued: a[3] === "" ? 1 : 1, skipped: 0 }));
  unsubscribe.mockResolvedValue({ action: "done", via: "one_click",
    detail: "", addr: "x" });
  block.mockImplementation((_g: string, _k: string, _l: string, _t: boolean,
      account: string) => Promise.resolve({ rule: { id: `rule-${account}` } }));
  deleteRule.mockResolvedValue(undefined);
  ack.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  for (const f of [overviewCall, keepCheck, keepPin, unsubscribe, deleteGroups,
    block, deleteRule, ack, onFollow, onChanged, onClose]) f.mockReset();
  localStorage.clear();
  setLang("en");
});

const box = (account: string) => screen.getByRole("checkbox",
  { name: new RegExp(`in ${account}$`) }) as HTMLInputElement;
// (button names keep the no-break space between a number and its unit)
const flex = (name: string | RegExp) => typeof name !== "string" ? name
  : new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s")}$`);
const confirm = (name: string | RegExp) => screen.getByRole("button",
  { name: flex(name) });
const dialog = () => screen.getByRole("dialog");

test("Trash: each account with its tick, count, size and Keep-safe result", async () => {
  mount("trash");
  await screen.findAllByRole("checkbox");
  expect(await screen.findByText(
    "Move Deals Daily's mails to Trash in 3 accounts?")).toBeTruthy();
  const work = box("work").closest("li")!;
  expect(within(work).getByText("deals@dealsdaily.example")).toBeTruthy();
  expect(within(work).getByText(/^210\s+mails · 5\.1\s+MB$/)).toBeTruthy();
  expect(within(work).getByText("Keep-safe: 6 look worth keeping - they stay"))
    .toBeTruthy();
  const proton = box("proton").closest("li")!;
  expect(within(proton).getByText("Keep-safe: 2 look worth keeping - they stay"))
    .toBeTruthy();
  // nothing worth keeping in the third: no Keep-safe line
  expect(within(box("old").closest("li")!).queryByText(/Keep-safe/)).toBeNull();
  for (const a of ["work", "proton", "old"]) expect(box(a).checked).toBe(true);
  // 347 mails, 8 of them stay: the button counts what moves
  expect(confirm("Trash 339 in 3 accounts")).toBeTruthy();
  expect(screen.getByText(/One step per account, each with its own Undo and Activity entry; protected senders and pinned mails are left out, as today\./))
    .toBeTruthy();
  // Keep-safe was asked in each account, for that account's own address
  expect(keepCheck).toHaveBeenCalledWith(
    { grouping: "sender", keys: ["deals@dealsdaily.example"] }, "work");
  expect(keepCheck).toHaveBeenCalledWith(
    { grouping: "sender", keys: ["promo@dealsdaily.example"] }, "old");
});

test("Show lists what Keep-safe holds back, and does not flip the tick", async () => {
  mount("trash");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Keep-safe: 6 look worth keeping - they stay");
  const work = box("work").closest("li")!;
  fireEvent.click(within(work).getByRole("button", { name: /Show/ }));
  expect(within(work).getByText("Your invoice for November")).toBeTruthy();
  expect(box("work").checked).toBe(true);
  fireEvent.click(within(work).getByRole("button", { name: /Hide/ }));
  expect(within(work).queryByText("Your invoice for November")).toBeNull();
});

test("one step per ticked account, each pinned to its own account and the server's protection guard on", async () => {
  mount("trash");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Keep-safe: 6 look worth keeping - they stay");
  fireEvent.click(confirm("Trash 339 in 3 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  // the Keep-safe mails are protected FIRST, in their own accounts ...
  expect(keepPin.mock.calls.map((c) => c[2])).toEqual(["work", "proton"]);
  expect(keepPin.mock.calls[0][1]).toEqual(["invoices"]);
  // ... then ONE move per account, to that account, in order
  expect(deleteGroups.mock.calls.map((c) => [c[0], c[1], c[2], c[8], c[9]]))
    .toEqual([
      ["sender", ["deals@dealsdaily.example"], "trash", true, "work"],
      ["sender", ["deals@dealsdaily.example"], "trash", true, "proton"],
      ["sender", ["promo@dealsdaily.example"], "trash", true, "old"]]);
  expect(keepPin.mock.invocationCallOrder[1])
    .toBeLessThan(deleteGroups.mock.invocationCallOrder[0]);
  // the app follows the three jobs for ONE toast with "Undo all"
  expect(onFollow).toHaveBeenCalledTimes(1);
  const follow = onFollow.mock.calls[0][0];
  expect(follow.kind).toBe("trash");
  expect(follow.accounts).toEqual(["work", "proton", "old"]);
});

test("an unticked account is never called, and the button follows the ticks", async () => {
  mount("trash");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Keep-safe: 6 look worth keeping - they stay");
  fireEvent.click(box("proton"));
  expect(box("proton").checked).toBe(false);
  expect(confirm("Trash 248 in 2 accounts")).toBeTruthy();   // 210 - 6 + 44
  fireEvent.click(confirm("Trash 248 in 2 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(deleteGroups.mock.calls.map((c) => c[9])).toEqual(["work", "old"]);
  expect(keepPin.mock.calls.map((c) => c[2])).toEqual(["work"]);
  expect(onFollow.mock.calls[0][0].accounts).toEqual(["work", "old"]);
});

test("a sender protected after the page loaded is blocked in the confirm and never called", async () => {
  // the fresh read: work protects the address now
  overviewCall.mockResolvedValue(overview({ same_sender: [row(
    "dealsdaily.example", "Deals Daily", deals().accounts.slice(1), {
      left_out: [{ account: "work", addr: "deals@dealsdaily.example",
        why: "protected" }] })] }));
  mount("trash");
  await screen.findAllByRole("checkbox");
  expect(await screen.findByText(
    "Move Deals Daily's mails to Trash in 2 accounts?")).toBeTruthy();
  const work = box("work");
  expect(work.disabled).toBe(true);
  expect(work.checked).toBe(false);
  expect(within(work.closest("li")!).getByText("protected sender - left alone"))
    .toBeTruthy();
  expect(keepCheck.mock.calls.map((c) => c[1])).not.toContain("work");
  // 93 + 44 mails, 2 of them stay (Keep-safe in proton)
  fireEvent.click(confirm("Trash 135 in 2 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(deleteGroups.mock.calls.map((c) => c[9])).toEqual(["proton", "old"]);
  expect(keepPin.mock.calls.map((c) => c[2])).toEqual(["proton"]);
});

test("the server still refuses a protected sender: that account fails, the others go on", async () => {
  deleteGroups.mockImplementation((...a: unknown[]) => a[9] === "proton"
    ? Promise.reject(Object.assign(new Error("This sender is protected, so nothing was moved."),
      { code: "delete_protected" }))
    : Promise.resolve({ ok: true, queued: 5, skipped: 0 }));
  mount("trash");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Keep-safe: 6 look worth keeping - they stay");
  fireEvent.click(confirm(/^Trash\s\d+\sin\s3\saccounts$/));
  expect(await screen.findByText("2 done · 1 failed")).toBeTruthy();
  expect(screen.getByText(/Failed: This sender is protected, so nothing was moved\./))
    .toBeTruthy();
  // the dialog stays (something needs a look); only the two that went through
  // are followed
  expect(onClose).not.toHaveBeenCalled();
  expect(onFollow.mock.calls[0][0].accounts).toEqual(["work", "old"]);
  expect(deleteGroups).toHaveBeenCalledTimes(3);
});

test("a protection that cannot be written sends the whole confirm back to review", async () => {
  keepPin.mockImplementation((_s: unknown, _c: unknown, account: string) =>
    account === "proton" ? Promise.reject(new Error("disk full"))
      : Promise.resolve({ pinned: 1, items: [] }));
  mount("trash");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Keep-safe: 6 look worth keeping - they stay");
  fireEvent.click(confirm("Trash 339 in 3 accounts"));
  expect(await screen.findByText(
    /Couldn't protect the mails worth keeping in proton: .*disk full.* - nothing was moved\./))
    .toBeTruthy();
  expect(deleteGroups).not.toHaveBeenCalled();
  expect(onFollow).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  // back in review: the button is there to try again
  expect(confirm("Trash 339 in 3 accounts")).toBeTruthy();
});

test("Esc, Cancel and the backdrop do nothing while the steps run", async () => {
  let release: (v: unknown) => void = () => {};
  deleteGroups.mockImplementation(() => new Promise((r) => { release = r; }));
  mount("trash");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Keep-safe: 6 look worth keeping - they stay");
  fireEvent.click(confirm("Trash 339 in 3 accounts"));
  await screen.findByText(/Working on work… \(0 of 3\)/);
  fireEvent.keyDown(dialog(), { key: "Escape" });
  fireEvent.keyDown(document, { key: "Escape" });
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
    .disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { release({ ok: true, queued: 1, skipped: 0 }); });
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledTimes(2));
  await act(async () => { release({ ok: true, queued: 1, skipped: 0 }); });
  await waitFor(() => expect(deleteGroups).toHaveBeenCalledTimes(3));
  await act(async () => { release({ ok: true, queued: 1, skipped: 0 }); });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("an account removed while the confirm was open is skipped and said so", async () => {
  mount("archive", { exists: (a: string) => a !== "proton" });
  await screen.findAllByRole("checkbox");
  await screen.findByText("Archive Deals Daily's mails in 3 accounts?");
  fireEvent.click(confirm("Archive 347 in 3 accounts"));
  expect(await screen.findByText("2 done · 1 not run")).toBeTruthy();
  expect(screen.getByText(/This account is no longer there - nothing was changed\./))
    .toBeTruthy();
  expect(deleteGroups.mock.calls.map((c) => c[9])).toEqual(["work", "old"]);
});

test("switching the selected account while it runs stands the rest down", async () => {
  deleteGroups.mockImplementation(() => {
    noteAccountSwitch();
    return Promise.resolve({ ok: true, queued: 1, skipped: 0 });
  });
  mount("archive");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Archive Deals Daily's mails in 3 accounts?");
  fireEvent.click(confirm("Archive 347 in 3 accounts"));
  expect(await screen.findByText("1 done · 2 not run")).toBeTruthy();
  expect(deleteGroups).toHaveBeenCalledTimes(1);
});

test("Archive: no Keep-safe question, the archive action, the same pinned steps", async () => {
  mount("archive");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Archive Deals Daily's mails in 3 accounts?");
  expect(keepCheck).not.toHaveBeenCalled();
  expect(screen.queryByText(/Keep-safe/)).toBeNull();
  fireEvent.click(confirm("Archive 347 in 3 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(deleteGroups.mock.calls.map((c) => [c[2], c[9]])).toEqual([
    ["archive", "work"], ["archive", "proton"], ["archive", "old"]]);
  expect(keepPin).not.toHaveBeenCalled();
  expect(onFollow.mock.calls[0][0].kind).toBe("archive");
});

test("pinned mails are said to stay and are not in the count", async () => {
  const r = deals();
  r.accounts[0] = { ...r.accounts[0], mails: 210, pinned: 10 };
  overviewCall.mockResolvedValue(overview({ same_sender: [r] }));
  mount("archive", { row: r });
  await screen.findAllByRole("checkbox");
  await screen.findByText("Archive Deals Daily's mails in 3 accounts?");
  expect(within(box("work").closest("li")!).getByText(
    "deals@dealsdaily.example · 10 pinned stay")).toBeTruthy();
  expect(confirm("Archive 337 in 3 accounts")).toBeTruthy();
});

test("the numbers are read again on open; a failed read blocks the confirm", async () => {
  overviewCall.mockRejectedValue(new Error("offline"));
  mount("trash");
  expect(await screen.findByText(/Couldn't check the accounts: .*offline/))
    .toBeTruthy();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect((confirm(/^Trash/) as HTMLButtonElement).disabled).toBe(true);
  expect(deleteGroups).not.toHaveBeenCalled();
});

test("Unsubscribe: each account's own address and method, one call per account", async () => {
  mount("unsubscribe");
  await screen.findAllByRole("checkbox");
  expect(await screen.findByText(
    "Unsubscribe from Deals Daily in 3 accounts?")).toBeTruthy();
  expect(within(box("work").closest("li")!).getByText(
    "deals@dealsdaily.example · one-click")).toBeTruthy();
  expect(within(box("proton").closest("li")!).getByText(
    "deals@dealsdaily.example · opens a page")).toBeTruthy();
  expect(within(box("old").closest("li")!).getByText(
    "promo@dealsdaily.example · one-click")).toBeTruthy();
  expect(keepCheck).not.toHaveBeenCalled();
  fireEvent.click(confirm("Unsubscribe in 3 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(unsubscribe.mock.calls).toEqual([
    ["sender", "deals@dealsdaily.example", true, "work"],
    ["sender", "deals@dealsdaily.example", true, "proton"],
    ["sender", "promo@dealsdaily.example", true, "old"]]);
  expect(deleteGroups).not.toHaveBeenCalled();
  expect(onFollow).not.toHaveBeenCalled();
});

test("an account that is done already, or has no link, is listed but not ticked", async () => {
  const r = deals();
  r.accounts[0] = { ...r.accounts[0], state: "done" };
  r.accounts[2] = { ...r.accounts[2], unsub: false, via: null };
  overviewCall.mockResolvedValue(overview({ same_sender: [r] }));
  mount("unsubscribe", { row: r });
  await screen.findAllByRole("checkbox");
  await screen.findByText("Unsubscribe from Deals Daily in 1 account?");
  expect(box("work").disabled).toBe(true);
  expect(within(box("work").closest("li")!).getByText("already unsubscribed"))
    .toBeTruthy();
  expect(within(box("old").closest("li")!).getByText("no unsubscribe link here"))
    .toBeTruthy();
  fireEvent.click(confirm("Unsubscribe in 1 account"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(unsubscribe.mock.calls.map((c) => c[3])).toEqual(["proton"]);
});

test("a page the user has to confirm stays in the result with Open page and Mark as done", async () => {
  unsubscribe.mockImplementation((_g: string, _k: string, _s: boolean, account: string) =>
    Promise.resolve(account === "proton"
      ? { action: "link", via: "http", detail: "https://dealsdaily.example/u", addr: "x" }
      : { action: "done", via: "one_click", detail: "", addr: "x" }));
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  mount("unsubscribe");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Unsubscribe from Deals Daily in 3 accounts?");
  fireEvent.click(confirm("Unsubscribe in 3 accounts"));
  expect(await screen.findByText("2 done · 1 needs you")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open page" }));
  expect(open).toHaveBeenCalledWith("https://dealsdaily.example/u", "_blank", "noopener");
  fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
  await waitFor(() => expect(ack).toHaveBeenCalledWith(
    "deals@dealsdaily.example", true, "proton"));
  expect(await screen.findByText("Marked as done")).toBeTruthy();
  open.mockRestore();
});

test("Block: one rule per account, and the toast's Undo all removes exactly those", async () => {
  mount("block");
  await screen.findAllByRole("checkbox");
  expect(await screen.findByText("Block Deals Daily in 3 accounts?")).toBeTruthy();
  expect(screen.getByText(/Each account gets its own rule that moves future mail from this sender to Trash every day\./))
    .toBeTruthy();
  fireEvent.click(confirm("Block in 3 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(block.mock.calls.map((c) => [c[0], c[1], c[3], c[4]])).toEqual([
    ["sender", "deals@dealsdaily.example", false, "work"],
    ["sender", "deals@dealsdaily.example", false, "proton"],
    ["sender", "promo@dealsdaily.example", false, "old"]]);
  expect(deleteGroups).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Undo all 3" }));
  await waitFor(() => expect(deleteRule).toHaveBeenCalledTimes(3));
  expect(deleteRule.mock.calls.map((c) => c[0]).sort())
    .toEqual(["rule-old", "rule-proton", "rule-work"]);
  expect(await screen.findByText("Unblocked Deals Daily in 3 accounts"))
    .toBeTruthy();
});

test("an address that is blocked already is listed, not ticked, and not blocked twice", async () => {
  const r = deals();
  r.accounts[1] = { ...r.accounts[1], blocked: true };
  overviewCall.mockResolvedValue(overview({ same_sender: [r] }));
  mount("block", { row: r });
  await screen.findAllByRole("checkbox");
  await screen.findByText("Block Deals Daily in 2 accounts?");
  expect(box("proton").disabled).toBe(true);
  expect(within(box("proton").closest("li")!).getByText("already blocked here"))
    .toBeTruthy();
  fireEvent.click(confirm("Block in 2 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(block.mock.calls.map((c) => c[4])).toEqual(["work", "old"]);
});

test("no step ever runs before the user confirms, and Cancel runs none", async () => {
  mount("trash");
  await screen.findAllByRole("checkbox");
  await screen.findByText("Keep-safe: 6 look worth keeping - they stay");
  expect(deleteGroups).not.toHaveBeenCalled();
  expect(keepPin).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled();
  expect(deleteGroups).not.toHaveBeenCalled();
  expect(keepPin).not.toHaveBeenCalled();
});

test("German", async () => {
  setLang("de");
  mount("trash");
  await screen.findAllByRole("checkbox");
  expect(await screen.findByText(
    "Mails von Deals Daily in 3 Konten in den Papierkorb legen?")).toBeTruthy();
  expect(screen.getByText(
    "Sicher behalten: 6 Mails könnten wichtig sein - sie bleiben")).toBeTruthy();
  expect(confirm("339 in 3 Konten in den Papierkorb")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Anzeigen" })).toHaveLength(2);
});

test("a row of a different shape is unaffected: the confirm only reads what it is given", async () => {
  const solo: SameSenderRow = row("shop.example", "Shop", [
    { ...deals().accounts[0], account: "one", addr: "a@shop.example", mails: 5 },
    { ...deals().accounts[0], account: "two", addr: "a@shop.example", mails: 5 }]);
  overviewCall.mockResolvedValue(overview({ same_sender: [solo] }));
  mount("trash", { row: solo });
  await screen.findAllByRole("checkbox");
  await screen.findByText("Move Shop's mails to Trash in 2 accounts?");
  // under the Keep-safe threshold nothing is asked
  expect(keepCheck).not.toHaveBeenCalled();
  expect(confirm("Trash 10 in 2 accounts")).toBeTruthy();
});
