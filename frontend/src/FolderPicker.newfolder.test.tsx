// @vitest-environment jsdom
/* The folder picker (Move): one more row at the END of All folders, "New
 * folder…" - it makes the folder on the server, lists it and chooses it; the
 * rest of the picker (Find a folder, Suggested, All folders with counts, the
 * Always-move switch, Move) is as it was. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const folders = vi.fn();
const createFolder = vi.fn();
const createRule = vi.fn();
vi.mock("./api", () => ({
  api: {
    folders: (...a: unknown[]) => folders(...a),
    createFolder: (...a: unknown[]) => createFolder(...a),
    createRule: (...a: unknown[]) => createRule(...a),
  },
}));

import { FolderPicker, loadRecent, rememberRecent, renameRecent }
  from "./components/FolderPicker";
import { DialogProvider, ToastProvider } from "./components/ui";
import { findDialog, pressDialog } from "./dialogTestUtils";
import { findPicker } from "./folderPickerTestUtil";
import { setLang } from "./i18n";

const RAW = ["INBOX", "Archive", "Receipts", "Travel"];
beforeEach(() => {
  localStorage.clear();
  folders.mockResolvedValue({
    special: [{ role: "archive", raw: "Archive", name: "Archive" }],
    folders: RAW.map((raw) => ({ raw, name: raw, delim: "/", role: null,
      excluded: false })),
    wildcards: [], mail_counts: { INBOX: 10, Archive: 5, Receipts: 3,
      Travel: 2 } });
  createRule.mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); setLang("en"); });

const mount = (over: Record<string, unknown> = {}) => {
  const onPick = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(<ToastProvider><DialogProvider>
    <FolderPicker count={61} folders={RAW} account="acc" onPick={onPick}
      onClose={onClose} {...over} />
  </DialogProvider></ToastProvider>);
  return { onPick, onClose };
};

test("New folder… is the last row of All folders, after every folder", async () => {
  mount();
  const dlg = await findPicker();
  const all = within(dlg).getByText("All folders").closest("[role=group]")!;
  const rows = within(all as HTMLElement).getAllByRole("button");
  expect(rows.at(-1)!.textContent).toBe("New folder…");
  expect(rows.slice(0, -1).map((r) => r.textContent!.replace(/\d+$/, "")))
    .toEqual(["Inbox", "Archive", "Receipts", "Travel"]);
  // the rest of the picker is as it was
  expect(within(dlg).getByPlaceholderText("Find a folder")).toBeTruthy();
  expect(within(dlg).getByText("Suggested")).toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Move" })).toBeTruthy();
});

test("it asks for a name, makes the folder, lists it last and chooses it", async () => {
  createFolder.mockResolvedValue({ raw: "Warranty", name: "Warranty" });
  const { onPick, onClose } = mount();
  const dlg = await findPicker();
  fireEvent.click(within(dlg).getByRole("button", { name: "New folder…" }));
  const prompt = await findDialog();
  expect(within(prompt).getByText("New folder")).toBeTruthy();
  fireEvent.change(within(prompt).getByRole("textbox"),
    { target: { value: " Warranty " } });
  await pressDialog("Create");
  await waitFor(() => expect(createFolder).toHaveBeenCalledWith("Warranty", "acc"));
  // the picker is still open (the prompt's clicks are not outside clicks)
  expect(onClose).not.toHaveBeenCalled();
  const made = await within(dlg).findByRole("button", { name: /^Warranty/ });
  expect(made.getAttribute("aria-pressed")).toBe("true");
  const all = within(dlg).getByText("All folders").closest("[role=group]")!;
  const rows = within(all as HTMLElement).getAllByRole("button");
  expect(rows.at(-2)).toBe(made);                 // just above New folder…
  expect(rows.at(-1)!.textContent).toBe("New folder…");
  // Move goes into the new folder
  fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
  expect(onPick).toHaveBeenCalledWith("Warranty");
  await waitFor(() => expect(loadRecent("acc")[0].raw).toBe("Warranty"));
});

test("the 'Always move' switch follows the new folder", async () => {
  createFolder.mockResolvedValue({ raw: "Warranty", name: "Warranty" });
  const { onPick } = mount({ rule: { kind: "sender", value: "a@x.example",
    label: "Northwind Shop" } });
  const dlg = await findPicker();
  fireEvent.click(within(dlg).getByRole("switch"));
  fireEvent.click(within(dlg).getByRole("button", { name: "New folder…" }));
  const prompt = await findDialog();
  fireEvent.change(within(prompt).getByRole("textbox"),
    { target: { value: "Warranty" } });
  await pressDialog("Create");
  await within(dlg).findByRole("button", { name: /^Warranty/ });
  fireEvent.click(within(dlg).getByRole("button", { name: "Move" }));
  expect(onPick).toHaveBeenCalledWith("Warranty");
  await waitFor(() => expect(createRule).toHaveBeenCalledWith(
    expect.objectContaining({ action: "move", dest: "Warranty",
      query: "from:a@x.example", account: "acc" })));
});

test("Cancel in the prompt creates nothing and keeps the picker", async () => {
  const { onClose } = mount();
  const dlg = await findPicker();
  fireEvent.click(within(dlg).getByRole("button", { name: "New folder…" }));
  await findDialog();
  await pressDialog("Cancel");
  await new Promise((r) => setTimeout(r, 50));
  expect(createFolder).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("a refusal is shown and nothing is chosen", async () => {
  createFolder.mockRejectedValue(new Error("A folder called “Travel” already exists."));
  mount();
  const dlg = await findPicker();
  fireEvent.click(within(dlg).getByRole("button", { name: "New folder…" }));
  const prompt = await findDialog();
  fireEvent.change(within(prompt).getByRole("textbox"),
    { target: { value: "Travel" } });
  await pressDialog("Create");
  expect(await screen.findByText("A folder called “Travel” already exists."))
    .toBeTruthy();
  expect((within(dlg).getByRole("button", { name: "Move" }) as
    HTMLButtonElement).disabled).toBe(true);
});

test("German row name", async () => {
  setLang("de");
  mount();
  const dlg = await screen.findByRole("dialog", { name: /verschieben/i });
  expect(within(dlg).getByRole("button", { name: "Neuer Ordner…" })).toBeTruthy();
});

test("a renamed folder keeps its place among the recent targets", () => {
  rememberRecent("acc", "Receipts 2019");
  rememberRecent("acc", "Travel");
  renameRecent("acc", "Receipts 2019", "Receipts 2020");
  expect(loadRecent("acc").map((r) => r.raw)).toEqual(["Travel",
    "Receipts 2020"]);
  renameRecent("acc", "Nowhere", "X");             // not there: nothing happens
  expect(loadRecent("acc")).toHaveLength(2);
  renameRecent("other", "Travel", "X");            // another account: untouched
  expect(loadRecent("other")).toEqual([]);
});
