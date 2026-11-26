// @vitest-environment jsdom
/* "Trash selected" over Search: All accounts - one confirm, one step per
 * account, each pinned to its own account; pinned mails and protected senders
 * out before anything runs; Keep-safe per account; Esc ignored while it runs. */

import { act, cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const deleteMessages = vi.fn();
const keepCheck = vi.fn();
const keepPin = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    keepSafeCheck: (...a: unknown[]) => keepCheck(...a),
    keepSafePin: (...a: unknown[]) => keepPin(...a) },
}));

import { noteAccountSwitch } from "./accountGuard";
import { planAcross, SearchTrashConfirm } from "./components/SearchTrashConfirm";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { KeepSafeCheck, Mail } from "./types";

const mail = (uid: number, account: string, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2026-01-02", ts: 1, subject: `Invoice ${uid}`,
  addr: "billing@cloudbox.example", size: 10, seen: true, ai: null, account,
  pinned: false, protected: false, ...over });
const many = (n: number, account: string, start = 1) =>
  Array.from({ length: n }, (_, i) => mail(start + i, account));
const found = (kept: number): KeepSafeCheck => ({ total: 30, kept,
  classes: [{ id: "invoices", count: kept, senders: [{ name: "Cloud", count: kept }],
    subjects: [{ subject: "Your invoice for November", sender: "Cloud", ts: 1_700_000_000 }] }] });

const onFollow = vi.fn();
const onClaim = vi.fn();
const onActed = vi.fn();
const onClose = vi.fn();
const mount = (mails: Mail[], props: Record<string, unknown> = {}) =>
  render(<ToastProvider><DialogProvider>
    <SearchTrashConfirm mails={mails} order={["proton", "work", "old"]}
      exists={() => true} onFollow={onFollow} onClaim={onClaim}
      onActed={onActed} onClose={onClose} {...props} />
  </DialogProvider></ToastProvider>);

beforeEach(() => {
  setLang("en");
  deleteMessages.mockImplementation((...a: unknown[]) => Promise.resolve(
    { ok: true, queued: (a[0] as unknown[]).length, job: `j-${a[4]}` }));
  keepCheck.mockResolvedValue({ total: 1, kept: 0, classes: [] });
  keepPin.mockResolvedValue({ pinned: 0, items: [] });
});
afterEach(() => {
  cleanup();
  for (const f of [deleteMessages, keepCheck, keepPin, onFollow, onClaim,
    onActed, onClose]) f.mockReset();
  setLang("en");
});

const flex = (name: string) => new RegExp(`^${name.replace(/ /g, "\\s")}$`);
const box = (account: string) => screen.getByRole("checkbox",
  { name: new RegExp(`in ${account}$`) }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name: flex(name) });
const ready = () => screen.findAllByRole("checkbox");

test("the plan groups by account in the accounts' own order and takes pinned and protected out", () => {
  const plan = planAcross([mail(1, "work"), mail(2, "proton", { pinned: true }),
    mail(3, "proton"), mail(4, "proton", { protected: true }),
    mail(5, "old", { pinned: true })], ["proton", "work", "old"]);
  expect(plan.map((p) => [p.account, p.acting.map((m) => m.uid), p.stay])).toEqual([
    ["proton", [3], 2], ["work", [1], 0], ["old", [], 1]]);
  // a mail without an account is never part of a plan
  expect(planAcross([{ ...mail(1, "x"), account: undefined }], ["x"])).toEqual([]);
});

test("each account with its own tick and count; the title and the button count what moves", async () => {
  mount([...many(2, "proton"), mail(9, "work", { pinned: true }),
    mail(10, "work"), mail(11, "old", { protected: true })]);
  await ready();
  expect(await screen.findByText(/Move 3 mails to Trash in 2 accounts\?/)).toBeTruthy();
  const proton = box("proton").closest("li")!;
  expect(within(proton).getByText("2 mails")).toBeTruthy();
  const work = box("work").closest("li")!;
  expect(within(work).getByText("1 pinned or protected stays")).toBeTruthy();
  // an account with nothing left is listed, not tickable
  expect(box("old").disabled).toBe(true);
  expect(within(box("old").closest("li")!).getByText(
    "all pinned or protected - left alone")).toBeTruthy();
  expect(button("Trash 3 mails in 2 accounts")).toBeTruthy();
});

test("one step per ticked account, each pinned to its own account, in order; unticked never called", async () => {
  mount([...many(2, "proton"), mail(10, "work"), mail(20, "old")]);
  await ready();
  fireEvent.click(box("work"));
  fireEvent.click(button("Trash 3 mails in 2 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(deleteMessages.mock.calls.map((c) => [c[0], c[1], c[4]])).toEqual([
    [[["INBOX", 1], ["INBOX", 2]], "trash", "proton"],
    [[["INBOX", 20]], "trash", "old"]]);
  expect(deleteMessages.mock.calls.every((c) => c[3] === false)).toBe(true);
  expect(onClaim.mock.calls[0]).toEqual([["proton", "old"], true]);
  expect(onClaim.mock.invocationCallOrder[0])
    .toBeLessThan(deleteMessages.mock.invocationCallOrder[0]);
  expect(onFollow).toHaveBeenCalledWith({ kind: "trash", steps: [
    { account: "proton", job: "j-proton" }, { account: "old", job: "j-old" }] });
  // the results lose exactly the mails that moved
  expect(onActed.mock.calls[0][0].map((m: Mail) => [m.account, m.uid])).toEqual([
    ["proton", 1], ["proton", 2], ["old", 20]]);
});

test("pinned and protected mails are never sent", async () => {
  mount([mail(1, "proton"), mail(2, "proton", { pinned: true }),
    mail(3, "proton", { protected: true })]);
  await ready();
  fireEvent.click(button("Trash 1 mail in 1 account"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(deleteMessages.mock.calls[0][0]).toEqual([["INBOX", 1]]);
});

test("a big move asks Keep-safe per account; what it holds back is protected first and stays", async () => {
  keepCheck.mockImplementation((_s: unknown, account: string) =>
    Promise.resolve(account === "proton" ? found(4) : { total: 5, kept: 0, classes: [] }));
  keepPin.mockResolvedValue({ pinned: 4, items: [["INBOX", 1], ["INBOX", 2], ["INBOX", 3], ["INBOX", 4]] });
  mount([...many(25, "proton"), ...many(3, "work", 100)]);
  await ready();
  expect(keepCheck.mock.calls.map((c) => c[1])).toEqual(["proton"]);   // 3 mails: not asked
  expect(screen.getByText("Keep-safe: 4 look worth keeping - they stay")).toBeTruthy();
  expect(button("Trash 24 mails in 2 accounts")).toBeTruthy();         // 25 - 4 + 3
  fireEvent.click(button("Trash 24 mails in 2 accounts"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(keepPin.mock.calls[0][2]).toBe("proton");
  expect(keepPin.mock.invocationCallOrder[0]).toBeLessThan(deleteMessages.mock.invocationCallOrder[0]);
  const moved = deleteMessages.mock.calls.find((c) => c[4] === "proton")![0];
  expect(moved).toHaveLength(21);
  expect(moved).not.toContainEqual(["INBOX", 1]);
});

test("a protection that cannot be written sends the confirm back to review - nothing moved", async () => {
  keepCheck.mockResolvedValue(found(2));
  keepPin.mockRejectedValue(new Error("disk full"));
  mount(many(25, "proton"));
  await ready();
  fireEvent.click(button("Trash 23 mails in 1 account"));
  expect(await screen.findByText(/Couldn't protect the mails worth keeping in proton: .*disk full.* - nothing was moved\./))
    .toBeTruthy();
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(onClaim).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("a failing account is shown and does not stop the others", async () => {
  deleteMessages.mockImplementation((...a: unknown[]) => a[4] === "proton"
    ? Promise.reject(new Error("refused"))
    : Promise.resolve({ ok: true, queued: 1, job: `j-${a[4]}` }));
  mount([mail(1, "proton"), mail(2, "work")]);
  await ready();
  fireEvent.click(button("Trash 2 mails in 2 accounts"));
  expect(await screen.findByText("1 done · 1 failed")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(deleteMessages).toHaveBeenCalledTimes(2);
  expect(onFollow.mock.calls[0][0].steps).toEqual([{ account: "work", job: "j-work" }]);
  expect(onClaim).toHaveBeenCalledWith(["proton"], false);
  expect(onActed.mock.calls[0][0].map((m: Mail) => m.account)).toEqual(["work"]);
});

test("Esc is ignored while the steps run", async () => {
  let release: (v: unknown) => void = () => {};
  deleteMessages.mockImplementation(() => new Promise((r) => { release = r; }));
  mount([mail(1, "proton")]);
  await ready();
  fireEvent.click(button("Trash 1 mail in 1 account"));
  await screen.findByText(/Working on proton… \(0 of 1\)/);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { release({ ok: true, queued: 1, job: "j" }); });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("a removed account is skipped and said so; a switch of the selected account stands the rest down", async () => {
  mount([mail(1, "proton"), mail(2, "work")], { exists: (a: string) => a !== "proton" });
  await ready();
  fireEvent.click(button("Trash 2 mails in 2 accounts"));
  expect(await screen.findByText("1 done · 1 not run")).toBeTruthy();
  expect(deleteMessages.mock.calls.map((c) => c[4])).toEqual(["work"]);
  cleanup();
  deleteMessages.mockReset();
  deleteMessages.mockImplementation(() => { noteAccountSwitch(); return Promise.resolve({ ok: true, queued: 1, job: "j" }); });
  mount([mail(1, "proton"), mail(2, "work")]);
  await ready();
  fireEvent.click(button("Trash 2 mails in 2 accounts"));
  expect(await screen.findByText("1 done · 1 not run")).toBeTruthy();
  expect(deleteMessages).toHaveBeenCalledTimes(1);
});

test("Cancel runs nothing; German", async () => {
  mount([mail(1, "proton"), mail(2, "work")]);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled();
  expect(deleteMessages).not.toHaveBeenCalled();
  cleanup();
  setLang("de");
  mount([mail(1, "proton"), mail(2, "work")]);
  await ready();
  expect(await screen.findByText(/2 Mails in 2 Konten in den Papierkorb verschieben\?/)).toBeTruthy();
  expect(button("2 Mails in 2 Konten in den Papierkorb")).toBeTruthy();
});
