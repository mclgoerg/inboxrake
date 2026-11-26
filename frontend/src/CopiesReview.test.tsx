// @vitest-environment jsdom
/* "Same mails in several accounts" > Review…: which account keeps the exact
 * copies, the one step in the other (worked out again on the server, Undo),
 * or just showing them. */

import { act, cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const copiesCall = vi.fn();
const trashCall = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { accountsCopies: (...a: unknown[]) => copiesCall(...a),
    trashCopies: (...a: unknown[]) => trashCall(...a) },
}));

import { CopiesReview } from "./components/CopiesReview";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { CopiesPair } from "./types";

const MB = 1048576;
const pair = (over: Partial<CopiesPair> = {}): CopiesPair => ({
  a: "old", b: "proton", mails: 412, size: 61 * MB, first: 1_600_000_000,
  last: 1_700_000_000,
  in_a: { trash: 409, size: 61 * MB, held: 3 },
  in_b: { trash: 405, size: 60 * MB, held: 7 }, ...over });

const onFollow = vi.fn();
const onClaim = vi.fn();
const onShow = vi.fn();
const onChanged = vi.fn();
const onClose = vi.fn();
const mount = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <CopiesReview pair={pair()} current="work" exists={() => true} onFollow={onFollow}
      onClaim={onClaim} onShow={onShow} onChanged={onChanged}
      onClose={onClose} {...props} />
  </DialogProvider></ToastProvider>);

beforeEach(() => {
  setLang("en");
  copiesCall.mockResolvedValue({ pairs: [pair()], left_out: 0 });
  trashCall.mockResolvedValue({ ok: true, queued: 409, job: "j-old", held: 3 });
});
afterEach(() => {
  cleanup();
  for (const f of [copiesCall, trashCall, onFollow, onClaim, onShow, onChanged,
    onClose]) f.mockReset();
  setLang("en");
});

const flex = (name: string) => new RegExp(`^${name.replace(/ /g, "\\s")}$`);
const button = (name: string) => screen.getByRole("button", { name: flex(name) });
const ready = () => screen.findByRole("radiogroup");
const radio = (re: RegExp) => screen.getByRole("radio", { name: re });

test("the board's dialog: title, the three choices, the note and the button", async () => {
  mount();
  await ready();
  expect(screen.getByText(/^412\smails are in both old and proton$/)).toBeTruthy();
  expect(screen.getByText("Same Message-ID and size in old and proton.")).toBeTruthy();
  expect(radio(/^Keep them in proton, trash the copies in old/).getAttribute("aria-checked"))
    .toBe("true");
  expect(screen.getByText(/^old frees 61\.0\sMB · nothing in proton changes$/)).toBeTruthy();
  expect(radio(/^Keep them in old, trash the copies in proton/).getAttribute("aria-checked"))
    .toBe("false");
  expect(screen.getByText(/^proton frees 60\.0\sMB$/)).toBeTruthy();
  expect(radio(/^Just show them/)).toBeTruthy();
  expect(screen.getByText("opens All mail, filtered to them")).toBeTruthy();
  expect(screen.getByText(/One step in old with Undo\. Pinned copies and protected senders are taken out of the 412 before it runs \(3 left out\)\./))
    .toBeTruthy();
  expect(button("Trash 409 copies in old")).toBeTruthy();
});

test("the other choice moves the button and the note; just show them has its own", async () => {
  mount();
  await ready();
  fireEvent.click(radio(/^Keep them in old, trash the copies in proton/));
  expect(button("Trash 405 copies in proton")).toBeTruthy();
  expect(screen.getByText(/One step in proton with Undo\./)).toBeTruthy();
  fireEvent.click(radio(/^Just show them/));
  expect(button("Show them")).toBeTruthy();
  expect(screen.getByText(/Nothing is moved\./)).toBeTruthy();
});

test("the numbers are read again when it opens: what the page showed is not trusted", async () => {
  copiesCall.mockResolvedValue({ pairs: [pair({ mails: 300,
    in_a: { trash: 298, size: MB, held: 2 }, in_b: { trash: 300, size: MB, held: 0 } })],
  left_out: 0 });
  mount();
  await ready();
  expect(screen.getByText(/^300\smails are in both/)).toBeTruthy();
  expect(button("Trash 298 copies in old")).toBeTruthy();
});

test("Trash: keep in the other account, ONE step in this one - its job is followed", async () => {
  mount();
  await ready();
  fireEvent.click(button("Trash 409 copies in old"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  // keep = proton, drop = old: the account that keeps them is the first argument;
  // the third is the number on the button - what the user confirmed
  expect(trashCall).toHaveBeenCalledWith("proton", "old", 409);
  expect(trashCall).toHaveBeenCalledTimes(1);
  expect(onClaim.mock.calls[0]).toEqual([["old"], true]);
  expect(onClaim.mock.invocationCallOrder[0]).toBeLessThan(trashCall.mock.invocationCallOrder[0]);
  expect(onFollow).toHaveBeenCalledWith({ kind: "trash",
    steps: [{ account: "old", job: "j-old" }] });
  expect(onChanged).toHaveBeenCalled();
  expect(onShow).not.toHaveBeenCalled();
});

test("the other direction keeps the first account and trashes in the second", async () => {
  mount();
  await ready();
  fireEvent.click(radio(/^Keep them in old, trash the copies in proton/));
  fireEvent.click(button("Trash 405 copies in proton"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(trashCall).toHaveBeenCalledWith("old", "proton", 405);
  expect(onFollow.mock.calls[0][0].steps).toEqual([{ account: "proton", job: "j-old" }]);
});

test("Just show them moves nothing: the app opens All mail", async () => {
  mount();
  await ready();
  fireEvent.click(radio(/^Just show them/));
  fireEvent.click(button("Show them"));
  expect(onShow).toHaveBeenCalledWith("old", "proton");
  expect(onClose).toHaveBeenCalled();
  expect(trashCall).not.toHaveBeenCalled();
  expect(onClaim).not.toHaveBeenCalled();
});

test("a refusal from the server is shown, the claim let go and the dialog stays", async () => {
  trashCall.mockRejectedValue(Object.assign(new Error("No exact copy is left to move to Trash."), { code: "copies_none" }));
  mount();
  await ready();
  fireEvent.click(button("Trash 409 copies in old"));
  expect(await screen.findByText("No exact copy is left to move to Trash.")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(onFollow).not.toHaveBeenCalled();
  expect(onClaim).toHaveBeenLastCalledWith(["old"], false);
  expect(button("Trash 409 copies in old")).toBeTruthy();      // try again
});

test("Just show them opens the selected account of the pair first: no switch when it is the second", async () => {
  mount({ current: "proton" });
  await ready();
  fireEvent.click(radio(/^Just show them/));
  expect(screen.getByText(/^Opens All mail in proton, narrowed to the mails that are also in old, with a link to the same view in old\./))
    .toBeTruthy();
  fireEvent.click(button("Show them"));
  expect(onShow).toHaveBeenCalledWith("proton", "old");
});

test("Just show them opens the first account of the pair when neither is selected, and the first when it is selected", async () => {
  mount({ current: "work" });
  await ready();
  fireEvent.click(radio(/^Just show them/));
  fireEvent.click(button("Show them"));
  expect(onShow).toHaveBeenLastCalledWith("old", "proton");
  cleanup();
  mount({ current: "old" });
  await ready();
  fireEvent.click(radio(/^Just show them/));
  fireEvent.click(button("Show them"));
  expect(onShow).toHaveBeenLastCalledWith("old", "proton");
});

test("a step the server refuses as more than confirmed: the numbers are read again, the next confirm is of the new one", async () => {
  trashCall.mockRejectedValueOnce(Object.assign(new Error("copies_changed"), { code: "copies_changed" }));
  mount();
  await ready();
  copiesCall.mockResolvedValue({ pairs: [pair({ in_a: { trash: 420, size: 62 * MB, held: 3 } })],
    left_out: 0 });
  fireEvent.click(button("Trash 409 copies in old"));
  expect(await screen.findByText(/more copies than the number you confirmed/)).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: flex("Trash 420 copies in old") })).toBeTruthy();
  expect(copiesCall).toHaveBeenCalledTimes(2);
  expect(trashCall).toHaveBeenCalledTimes(1);          // nothing runs by itself
  fireEvent.click(button("Trash 420 copies in old"));
  await waitFor(() => expect(trashCall).toHaveBeenCalledTimes(2));
  expect(trashCall).toHaveBeenLastCalledWith("proton", "old", 420);
});

test("a move that queued nothing (no job) is not followed", async () => {
  trashCall.mockResolvedValue({ ok: true, queued: 5, job: "", held: 0 });
  mount();
  await ready();
  fireEvent.click(button("Trash 409 copies in old"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(onFollow).not.toHaveBeenCalled();
  expect(onClaim).toHaveBeenLastCalledWith(["old"], false);
});

test("nothing left between the two: said so, nothing to confirm", async () => {
  copiesCall.mockResolvedValue({ pairs: [], left_out: 0 });
  mount();
  expect(await screen.findByText(/None of these copies is left/)).toBeTruthy();
  expect(screen.queryByRole("radiogroup")).toBeNull();
  // the one button left cannot run
  const go = screen.getAllByRole("button").find((b) => /^Trash/.test(b.textContent ?? ""));
  expect((go as HTMLButtonElement).disabled).toBe(true);
  expect(trashCall).not.toHaveBeenCalled();
});

test("all of one side's copies held back: that choice cannot run", async () => {
  copiesCall.mockResolvedValue({ pairs: [pair({
    in_a: { trash: 0, size: 0, held: 412 } })], left_out: 0 });
  mount();
  await ready();
  expect((button("Trash 0 copies in old") as HTMLButtonElement).disabled).toBe(true);
  expect(trashCall).not.toHaveBeenCalled();
});

test("an account that was removed meanwhile: said so, nothing is called", async () => {
  mount({ exists: (a: string) => a !== "proton" });
  await ready();
  fireEvent.click(button("Trash 409 copies in old"));
  expect(await screen.findByText(/no longer there/)).toBeTruthy();
  expect(trashCall).not.toHaveBeenCalled();
  expect(onClaim).not.toHaveBeenCalled();
});

test("Esc and Cancel do nothing while the step runs", async () => {
  let release: (v: unknown) => void = () => {};
  trashCall.mockImplementation(() => new Promise((r) => { release = r; }));
  mount();
  await ready();
  fireEvent.click(button("Trash 409 copies in old"));
  await waitFor(() => expect(trashCall).toHaveBeenCalled());
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { release({ ok: true, queued: 1, job: "j", held: 0 }); });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("Cancel runs nothing", async () => {
  mount();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalled();
  expect(trashCall).not.toHaveBeenCalled();
});

test("one copy reads right; German", async () => {
  copiesCall.mockResolvedValue({ pairs: [pair({ mails: 1,
    in_a: { trash: 1, size: MB, held: 0 }, in_b: { trash: 1, size: MB, held: 0 } })], left_out: 0 });
  mount();
  await ready();
  expect(screen.getByText(/^1\smail is in both old and proton$/)).toBeTruthy();
  expect(button("Trash 1 copy in old")).toBeTruthy();
  expect(screen.getByText(/One step in old with Undo\. Pinned copies and protected senders are taken out before it runs\./))
    .toBeTruthy();
  cleanup();
  setLang("de");
  copiesCall.mockResolvedValue({ pairs: [pair()], left_out: 0 });
  mount();
  await ready();
  expect(screen.getByText(/^412\sMails liegen in old und in proton$/)).toBeTruthy();
  expect(radio(/^In proton behalten, die Kopien in old in den Papierkorb/)).toBeTruthy();
  expect(radio(/^Nur anzeigen/)).toBeTruthy();
  expect(button("409 Kopien in old in den Papierkorb")).toBeTruthy();
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Abbrechen" })).toBeTruthy();
});
