// @vitest-environment jsdom
/* Clean up > Your folders: the page (rows, hints, totals), the pane of a
 * folder, merge / rename / delete / New folder with their confirms, the scan
 * switch, locked and label folders, the phone layout and German. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const yourFolders = vi.fn();
const folderCheck = vi.fn();
const createFolder = vi.fn();
const renameFolder = vi.fn();
const mergeFolder = vi.fn();
const deleteFolder = vi.fn();
const undo = vi.fn();
const getConfig = vi.fn();
const saveConfig = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: {
    yourFolders: (...a: unknown[]) => yourFolders(...a),
    folderCheck: (...a: unknown[]) => folderCheck(...a),
    createFolder: (...a: unknown[]) => createFolder(...a),
    renameFolder: (...a: unknown[]) => renameFolder(...a),
    mergeFolder: (...a: unknown[]) => mergeFolder(...a),
    deleteFolder: (...a: unknown[]) => deleteFolder(...a),
    undo: (...a: unknown[]) => undo(...a),
    getConfig: () => getConfig(),
    saveConfig: (...a: unknown[]) => saveConfig(...a),
  },
}));

import { YourFoldersPanel } from "./components/YourFoldersPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import { clockShiftFor } from "./subscriptionsTestUtils";
import { ARCHIVE, FAMILY, INBOX, NEWSLETTERS, NOW, PHONE, RECEIPTS,
  RECEIPTS_2019, RECEIPTS_OLD, ROWS, TAXES, TRAVEL, mergeCheck, renameCheck,
  resp, rule } from "./yourFoldersFixtures";

const viewport = (width: number) =>
  vi.stubGlobal("matchMedia", (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || width >= +min[1]) && (!max || width <= +max[1])
      && !q.includes("pointer") && !q.includes("reduced");
    return { matches, media: q, addEventListener: () => {},
      removeEventListener: () => {} };
  });

const onClose = vi.fn();
const onChanged = vi.fn();
const onOpenAllMail = vi.fn();
const onOpenSender = vi.fn();
const onSettings = vi.fn();
const show = (props: Record<string, unknown> = {}) => render(
  <ToastProvider><DialogProvider>
    <YourFoldersPanel account="proton" onClose={onClose}
      onChanged={onChanged} hasSender={() => true}
      onOpenAllMail={onOpenAllMail} onOpenSender={onOpenSender}
      onSettings={onSettings} {...props} />
  </DialogProvider></ToastProvider>);

let restoreClock = () => {};
beforeEach(() => {
  setLang("en");
  restoreClock = clockShiftFor(NOW / 1000);
  viewport(1440);
  yourFolders.mockResolvedValue(resp());
  getConfig.mockResolvedValue({ accounts: { proton: {
    excluded_folders: ["Old phone backup", "Labels/*"] } } });
  saveConfig.mockResolvedValue({});
  undo.mockResolvedValue({ restored: 41 });
});
afterEach(() => {
  cleanup();
  restoreClock();
  vi.unstubAllGlobals();
  for (const f of [yourFolders, folderCheck, createFolder, renameFolder,
    mergeFolder, deleteFolder, undo, getConfig, saveConfig, onClose, onChanged,
    onOpenAllMail, onOpenSender, onSettings]) f.mockReset();
  localStorage.clear();
  setLang("en");
});

const rows = () => screen.getAllByTestId("folder-row");
const pane = () => screen.getByTestId("folder-pane");
const row = (name: string) => rows().find((r) =>
  within(r).queryByText(name, { exact: true }))!;
const open = async (name: string) => {
  await screen.findAllByTestId("folder-row");
  fireEvent.click(within(row(name)).getByRole("button"));
};
const typeInto = (dialog: HTMLElement, text: string) =>
  fireEvent.change(within(dialog).getByRole("textbox"),
    { target: { value: text } });

/* --------------------------------- the page -------------------------------- */

test("the page: title, totals, the hint cards and every folder", async () => {
  show();
  await screen.findAllByTestId("folder-row");
  expect(screen.getAllByText("Your folders").length).toBeGreaterThan(0);
  expect(screen.getByText(/^8 scanned · 2,137 mails · .*MB · 2 not scanned$/))
    .toBeTruthy();
  expect(rows()).toHaveLength(ROWS.length);
  // the three hint cards with their reasons spelled out
  const look = screen.getByRole("button", { name: /3 look-alike names/ });
  expect(look.textContent).toContain("Receipts, Receipts 2019, receipts-old");
  expect(screen.getByRole("button", { name: /1 empty folder/ }).textContent)
    .toContain("receipts-old");
  expect(screen.getByRole("button", { name: /1 folder gone quiet/ })
    .textContent).toMatch(
    /Newsletters 2019 · 120\smails, 98% unread, nothing new since 2021/);
  // the table: mails, size, newest, used by
  const r = rows().find((x) => within(x).queryByText("Receipts"))!;
  expect(within(r).getByText("164")).toBeTruthy();
  expect(within(r).getByText(/MB$/)).toBeTruthy();
  expect(within(r).getByText("24 Nov")).toBeTruthy();
  expect(within(r).getByText("1 rule")).toBeTruthy();
  expect(within(row("Receipts 2019")).getByText("30 Dec 2019")).toBeTruthy();
  for (const col of ["Folder", "Mails", "Size", "Newest", "Used by"])
    expect(screen.getAllByText(col).length).toBeGreaterThan(0);
});

test("one chip per row: look-alike, empty, quiet, not scanned, excluded by a pattern", async () => {
  show();
  await screen.findAllByTestId("folder-row");
  expect(within(row("Receipts 2019")).getByText("look-alike")).toBeTruthy();
  expect(within(row("receipts-old")).getByText("empty")).toBeTruthy();
  expect(within(row("Newsletters 2019")).getByText("quiet since 2021"))
    .toBeTruthy();
  expect(within(row("Old phone backup")).getByText("not scanned")).toBeTruthy();
  expect(within(row("Labels/Family")).getByText("excluded by Labels/*"))
    .toBeTruthy();
  // unscanned folders have no numbers
  expect(within(row("Old phone backup")).queryByText(/MB/)).toBeNull();
  expect(within(row("Travel")).queryByText(/look-alike|empty|quiet/)).toBeNull();
});

test("the inbox and the archive are locked rows; the footer names the special folders", async () => {
  show();
  await screen.findAllByTestId("folder-row");
  expect(within(row("INBOX")).getByLabelText("Locked: no rename, merge or delete here")).toBeTruthy();
  expect(within(row("Archive")).getByLabelText("Locked: no rename, merge or delete here")).toBeTruthy();
  expect(within(row("Travel")).queryByLabelText("Locked: no rename, merge or delete here")).toBeNull();
  expect(screen.getByText(
    "Sent, Drafts, Junk and Trash are special folders: not part of the cleanup scan, set in"))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Settings › Account" }));
  expect(onSettings).toHaveBeenCalled();
});

test("a hint card shows only those folders, and one tap shows all again", async () => {
  show();
  await screen.findAllByTestId("folder-row");
  fireEvent.click(screen.getByRole("button", { name: /1 folder gone quiet/ }));
  expect(rows()).toHaveLength(1);
  expect(within(rows()[0]).getByText("Newsletters 2019")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show all folders" }));
  expect(rows()).toHaveLength(ROWS.length);
});

test("before the first scan: a note, and no numbers", async () => {
  yourFolders.mockResolvedValue(resp({ scanned: false,
    rows: [{ ...TRAVEL, scanned: false, mails: null, size: null,
      newest: null }], hints: [],
    totals: { scanned: 0, mails: 0, size: 0, not_scanned: 1 } }));
  show();
  expect(await screen.findByText(
    "Scan your mailbox first: then every folder shows its mails and size."))
    .toBeTruthy();
});

test("a failed load says so and Retry loads again", async () => {
  yourFolders.mockRejectedValueOnce(new Error("down"));
  show();
  expect(await screen.findByText("Could not load your folders.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findAllByTestId("folder-row")).toHaveLength(ROWS.length);
});

test("a busy server says what keeps folders from changing and turns the buttons off", async () => {
  yourFolders.mockResolvedValue(resp({ busy: "busy_action" }));
  show();
  await screen.findAllByTestId("folder-row");
  expect(screen.getByText(/move or deletion job is running|running/i)).toBeTruthy();
  await open("Receipts 2019");
  expect((within(pane()).getByRole("button", { name: /Rename/ }) as
    HTMLButtonElement).disabled).toBe(true);
});

/* ---------------------------------- the pane -------------------------------- */

test("the pane of a look-alike: the notice, the actions, the rule and the senders", async () => {
  show();
  await open("Receipts 2019");
  const p = pane();
  expect(within(p).getByText("Receipts 2019")).toBeTruthy();
  expect(within(p).getByText(/41 mails · .*MB · newest 30 Dec 2019/))
    .toBeTruthy();
  expect(within(p).getByText(
    "Looks like Receipts (164 mails). Merge them into one folder?"))
    .toBeTruthy();
  for (const name of [/Merge into/, /Rename/, /Open in All mail/])
    expect((within(p).getByRole("button", { name }) as HTMLButtonElement)
      .disabled).toBe(false);
  // Delete is only offered for empty folders
  expect((within(p).getByRole("button", { name: /Delete folder/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(within(p).getByText("Delete is only offered for empty folders."))
    .toBeTruthy();
  expect(within(p).getByText("Part of the cleanup scan")).toBeTruthy();
  expect(within(p).getByText("Old receipts to their folder")).toBeTruthy();
  expect(within(p).getByText("Active · weekly")).toBeTruthy();
  expect(within(p).getByText("Northwind Shop")).toBeTruthy();
  fireEvent.click(within(p).getByRole("button", { name: /Northwind Shop/ }));
  expect(onOpenSender).toHaveBeenCalledWith("orders@northwind.example");
});

test("the pane of a locked folder gives the reason in words and offers no operation", async () => {
  show();
  await open("INBOX");
  const p = pane();
  for (const name of [/Merge into/, /Rename/, /Delete folder/])
    expect((within(p).getByRole("button", { name }) as HTMLButtonElement)
      .disabled).toBe(true);
  expect(within(p).getByText("The inbox cannot be renamed, merged or deleted."))
    .toBeTruthy();
  fireEvent.click(within(rows().find((r) =>
    within(r).queryByText("Archive"))!).getByRole("button"));
  expect(within(pane()).getByText(/This is a special folder \(Archive/))
    .toBeTruthy();
  expect(within(pane()).getByText("Archive the old")).toBeTruthy();
});

test("a label cannot be merged: the reason is on the page", async () => {
  yourFolders.mockResolvedValue(resp({ rows: [INBOX, { ...TRAVEL, label: true,
    can: { rename: null, merge: "label", delete: "not_empty" } }] }));
  show();
  await open("Travel");
  expect((within(pane()).getByRole("button", { name: /Merge into/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(within(pane()).getByText(/This is a label: a mail can have several/))
    .toBeTruthy();
  expect((within(pane()).getByRole("button", { name: /Rename/ }) as
    HTMLButtonElement).disabled).toBe(false);
});

test("an empty folder and a quiet one say so", async () => {
  show();
  await open("receipts-old");
  expect(within(pane()).getByText("This folder is empty.")).toBeTruthy();
  expect((within(pane()).getByRole("button", { name: /Delete folder/ }) as
    HTMLButtonElement).disabled).toBe(false);
  // nothing to merge in a folder the scan saw empty - Delete is its way out
  expect((within(pane()).getByRole("button", { name: /Merge into/ }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(within(pane()).getByText(
    "There is nothing to merge: the folder holds no mail.")).toBeTruthy();
  fireEvent.click(within(row("Newsletters 2019")).getByRole("button"));
  expect(within(pane()).getByText("Nothing new since 2021: 120 mails, 98% unread."))
    .toBeTruthy();
});

test("Open in All mail filters by exactly that folder", async () => {
  show();
  await open("Receipts");
  fireEvent.click(within(pane()).getByRole("button", { name: /Open in All mail/ }));
  expect(onOpenAllMail).toHaveBeenCalledWith('folder:"Receipts"');
  cleanup();
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Open in All mail/ }));
  expect(onOpenAllMail).toHaveBeenLastCalledWith('folder:"Receipts 2019"');
});

/* ----------------------------------- merge ---------------------------------- */

test("Merge into…: the board's dialog, then Move 41 mails as one step with an Undo", async () => {
  folderCheck.mockResolvedValue(mergeCheck());
  mergeFolder.mockResolvedValue({ moved: 41, target: "Receipts",
    undo: { id: "u1", ts: 1, label: "Receipts 2019", count: 41 },
    rules: [{ id: "r1", name: "Old receipts to their folder", mode: "report" }],
    deleted: true, kept: "" });
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Merge into/ }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("Merge “Receipts 2019” into…")).toBeTruthy();
  // the similar folder is suggested and chosen; the others are listed
  const radios = within(dlg).getAllByRole("radio");
  const names = radios.map((r) => r.textContent ?? "");
  expect(names[0]).toContain("Receipts");
  expect(names[0]).toContain("suggested, similar name");
  expect(radios[0].getAttribute("aria-checked")).toBe("true");
  expect(names.some((n) => n.startsWith("Archive") && n.includes("318"))).toBe(true);
  expect(names.some((n) => n.startsWith("Taxes"))).toBe(true);
  // never itself, a label or a folder that is not scanned-out of reach
  expect(names.some((n) => n.startsWith("Receipts 2019"))).toBe(false);
  expect(names.some((n) => n.startsWith("Labels/Family"))).toBe(false);
  await waitFor(() => expect(folderCheck).toHaveBeenCalledWith({ op: "merge",
    folder: "Receipts 2019", target: "Receipts" }, "proton"));
  expect(await within(dlg).findByText(/41 mails move to Receipts as one step\. Undo in Activity puts them back - it recreates “Receipts 2019” if you deleted it\. Nothing is deleted\./))
    .toBeTruthy();
  // the rule is named and says it goes back to Report only
  expect(within(dlg).getByText(
    "The Active rule “Old receipts to their folder” will point at “Receipts” and go back to Report only, as every target change does today."))
    .toBeTruthy();
  fireEvent.click(within(dlg).getByRole("checkbox",
    { name: "Then delete the empty “Receipts 2019”" }));
  await pressDialog(/^Move 41\smails$/);
  await waitFor(() => expect(mergeFolder).toHaveBeenCalledWith({
    folder: "Receipts 2019", target: "Receipts", uv: 7, max_uid: 98,
    delete_after: true, rules: ["r1"] }, "proton"));
  expect(await screen.findByText(
    "Moved 41 mails to “Receipts” and deleted “Receipts 2019”."))
    .toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
  // Undo from the toast
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(undo).toHaveBeenCalledWith(-1,
    { id: "u1", ts: 1, label: "Receipts 2019", count: 41 }, "proton"));
  expect(await screen.findByText("Put 41 mails back in “Receipts 2019”."))
    .toBeTruthy();
});

test("merge: picking another folder asks the server again; the old answer is not reused", async () => {
  folderCheck.mockImplementation((b: { target: string }) => Promise.resolve(
    b.target === "Archive" ? mergeCheck({ target: "Archive", rules: [],
      count: 41, uv: 9, max_uid: 77 }) : mergeCheck()));
  mergeFolder.mockResolvedValue({ moved: 41, undo: null, rules: [],
    deleted: false, kept: "" });
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Merge into/ }));
  const dlg = await findDialog();
  await within(dlg).findByText(/will point at “Receipts”/);
  fireEvent.click(within(dlg).getAllByRole("radio")
    .find((r) => r.textContent?.startsWith("Archive"))!);
  await waitFor(() => expect(folderCheck).toHaveBeenLastCalledWith({ op: "merge",
    folder: "Receipts 2019", target: "Archive" }, "proton"));
  // no rule text for this target (the answer had none)
  await waitFor(() => expect(within(dlg).queryByText(/Active rule/)).toBeNull());
  await pressDialog(/^Move 41\smails$/);
  await waitFor(() => expect(mergeFolder).toHaveBeenCalledWith(expect.objectContaining({
    target: "Archive", uv: 9, max_uid: 77, delete_after: false, rules: [] }),
  "proton"));
});

test("merge: a ticked 'then delete' does not survive a target that cannot be deleted after", async () => {
  folderCheck.mockImplementation((b: { target: string }) => Promise.resolve(
    b.target === "Archive" ? mergeCheck({ target: "Archive", rules: [],
      can_delete: "children" }) : mergeCheck({ rules: [] })));
  mergeFolder.mockResolvedValue({ moved: 41, undo: null, rules: [],
    deleted: false, kept: "" });
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Merge into/ }));
  const dlg = await findDialog();
  await within(dlg).findByText(/41\smails move to Receipts/);
  fireEvent.click(within(dlg).getByRole("checkbox"));
  expect((within(dlg).getByRole("checkbox") as HTMLInputElement).checked)
    .toBe(true);
  fireEvent.click(within(dlg).getAllByRole("radio")
    .find((r) => r.textContent?.startsWith("Archive"))!);
  await within(dlg).findByText("It has subfolders: delete or move them first.");
  expect((within(dlg).getByRole("checkbox") as HTMLInputElement).checked)
    .toBe(false);
  await pressDialog(/^Move 41\smails$/);
  await waitFor(() => expect(mergeFolder).toHaveBeenCalledWith(
    expect.objectContaining({ target: "Archive", delete_after: false }),
    "proton"));
});

test("merge: Cancel moves nothing", async () => {
  folderCheck.mockResolvedValue(mergeCheck());
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Merge into/ }));
  await findDialog();
  await pressDialog("Cancel");
  await new Promise((r) => setTimeout(r, 50));
  expect(mergeFolder).not.toHaveBeenCalled();
});

test("merge: 'then delete' is off with its reason when the folder has subfolders; pinned and protected mail is named", async () => {
  folderCheck.mockResolvedValue(mergeCheck({ can_delete: "children",
    pinned: 2, protected: 3, rules: [] }));
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Merge into/ }));
  const dlg = await findDialog();
  expect(await within(dlg).findByText(
    "Includes 2 pinned and 3 protected mails - they keep their pin and their protection."))
    .toBeTruthy();
  expect((within(dlg).getByRole("checkbox") as HTMLInputElement).disabled)
    .toBe(true);
  expect(within(dlg).getByText("It has subfolders: delete or move them first."))
    .toBeTruthy();
});

test("merge: an empty folder has nothing to move; a refusal is shown in the dialog", async () => {
  folderCheck.mockResolvedValueOnce(mergeCheck({ count: 0, max_uid: 0,
    rules: [] }));
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Merge into/ }));
  const dlg = await findDialog();
  expect(await within(dlg).findByText(
    "This folder holds no mail: there is nothing to move.")).toBeTruthy();
  expect((within(dlg).getByRole("button", { name: /^Move/ }) as
    HTMLButtonElement).disabled).toBe(true);
  folderCheck.mockRejectedValueOnce(new Error("A move or deletion job is running."));
  fireEvent.click(within(dlg).getAllByRole("radio")[1]);
  expect((await within(dlg).findByRole("alert")).textContent)
    .toContain("job is running");
});

test("merge: when the emptied folder stayed, the toast says why", async () => {
  folderCheck.mockResolvedValue(mergeCheck({ rules: [] }));
  mergeFolder.mockResolvedValue({ moved: 41, undo: null, rules: [],
    deleted: false, kept: "folder_not_empty" });
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Merge into/ }));
  const dlg = await findDialog();
  await within(dlg).findByText(/41 mails move to/);
  fireEvent.click(within(dlg).getByRole("checkbox"));
  await pressDialog(/^Move 41\smails$/);
  expect(await screen.findByText(
    "Moved 41 mails to “Receipts”. “Receipts 2019” stays: new mail arrived in it meanwhile."))
    .toBeTruthy();
});

/* ----------------------------------- rename --------------------------------- */

test("Rename…: a rule that follows is named in the confirm, then it is renamed", async () => {
  folderCheck.mockResolvedValue(renameCheck());
  renameFolder.mockResolvedValue({ raw: "Receipts 2020", name: "Receipts 2020",
    rules: [rule()], failed: [] });
  show();
  await open("Receipts 2019");
  fireEvent.click(within(pane()).getByRole("button", { name: /Rename/ }));
  const prompt = await findDialog();
  expect((within(prompt).getByRole("textbox") as HTMLInputElement).value)
    .toBe("Receipts 2019");
  typeInto(prompt, "Receipts 2020");
  await pressDialog("Rename");
  await waitFor(() => expect(folderCheck).toHaveBeenCalledWith({ op: "rename",
    folder: "Receipts 2019", name: "Receipts 2020" }, "proton"));
  const confirm = await screen.findByText("Rename “Receipts 2019” to “Receipts 2020”?");
  expect(confirm).toBeTruthy();
  expect(screen.getByText(
    "The Active rule “Old receipts to their folder” will point at “Receipts 2020” and go back to Report only, as every target change does today."))
    .toBeTruthy();
  await pressDialog("Rename");
  await waitFor(() => expect(renameFolder).toHaveBeenCalledWith(
    "Receipts 2019", "Receipts 2020", ["r1"], "proton"));
  expect(await screen.findByText("Renamed to “Receipts 2020”.")).toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
});

test("Rename…: with no rule and nothing else to say there is no second question", async () => {
  folderCheck.mockResolvedValue(renameCheck({ rules: [] }));
  renameFolder.mockResolvedValue({ raw: "Travel 2026", name: "Travel 2026",
    rules: [], failed: [] });
  show();
  await open("Travel");
  fireEvent.click(within(pane()).getByRole("button", { name: /Rename/ }));
  typeInto(await findDialog(), "Travel 2026");
  await pressDialog("Rename");
  await waitFor(() => expect(renameFolder).toHaveBeenCalledWith(
    "Travel", "Travel 2026", [], "proton"));
});

test("Rename…: subfolders and an exclude pattern are said before; Cancel keeps the name", async () => {
  folderCheck.mockResolvedValue(renameCheck({ rules: [], children: 2,
    stops_scanning: true }));
  show();
  await open("Travel");
  fireEvent.click(within(pane()).getByRole("button", { name: /Rename/ }));
  typeInto(await findDialog(), "Trips");
  await pressDialog("Rename");
  expect(await screen.findByText("2 subfolders are renamed with it.")).toBeTruthy();
  expect(screen.getByText(
    "The new name matches an exclude pattern: the folder will no longer be part of the cleanup scan."))
    .toBeTruthy();
  await pressDialog("Cancel");
  await new Promise((r) => setTimeout(r, 50));
  expect(renameFolder).not.toHaveBeenCalled();
});

test("Rename…: the same name asks nothing and changes nothing", async () => {
  show();
  await open("Travel");
  fireEvent.click(within(pane()).getByRole("button", { name: /Rename/ }));
  typeInto(await findDialog(), "  Travel ");
  await pressDialog("Rename");
  await new Promise((r) => setTimeout(r, 80));
  expect(folderCheck).not.toHaveBeenCalled();
  expect(renameFolder).not.toHaveBeenCalled();
});

test("Rename…: the server's refusal is shown and nothing else happens", async () => {
  folderCheck.mockRejectedValue(new Error("A folder called “Travel” already exists."));
  show();
  await open("Taxes");
  fireEvent.click(within(pane()).getByRole("button", { name: /Rename/ }));
  typeInto(await findDialog(), "Travel");
  await pressDialog("Rename");
  expect(await screen.findByText("A folder called “Travel” already exists."))
    .toBeTruthy();
  expect(renameFolder).not.toHaveBeenCalled();
});

/* ----------------------------------- delete --------------------------------- */

test("Delete folder: the server counts first, then a danger confirm", async () => {
  folderCheck.mockResolvedValue({ folder: "receipts-old", name: "receipts-old",
    count: 0, uv: 4 });
  deleteFolder.mockResolvedValue({ deleted: "receipts-old" });
  show();
  await open("receipts-old");
  fireEvent.click(within(pane()).getByRole("button", { name: /Delete folder/ }));
  await waitFor(() => expect(folderCheck).toHaveBeenCalledWith({ op: "delete",
    folder: "receipts-old" }, "proton"));
  expect(await screen.findByText("Delete the empty folder “receipts-old”?"))
    .toBeTruthy();
  expect(screen.getByText(
    "The server says it holds no mail. You can create it again with New folder…"))
    .toBeTruthy();
  expect(deleteFolder).not.toHaveBeenCalled();
  await pressDialog("Delete folder");
  await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith(
    "receipts-old", 4, "proton"));
  expect(await screen.findByText("Deleted “receipts-old”.")).toBeTruthy();
});

test("Delete folder: a folder the server still finds mail in is not deleted", async () => {
  folderCheck.mockRejectedValue(new Error("“receipts-old” still holds mail on the server, so it was not deleted."));
  show();
  await open("receipts-old");
  fireEvent.click(within(pane()).getByRole("button", { name: /Delete folder/ }));
  expect(await screen.findByText(/still holds mail on the server/)).toBeTruthy();
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteFolder).not.toHaveBeenCalled();
});

test("Delete folder: Cancel keeps it", async () => {
  folderCheck.mockResolvedValue({ folder: "receipts-old", count: 0, uv: 4 });
  show();
  await open("receipts-old");
  fireEvent.click(within(pane()).getByRole("button", { name: /Delete folder/ }));
  await findDialog();
  await pressDialog("Cancel");
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteFolder).not.toHaveBeenCalled();
});

/* -------------------------------- New folder ---------------------------------- */

test("New folder… asks for a name and creates it", async () => {
  createFolder.mockResolvedValue({ raw: "Warranty", name: "Warranty" });
  show();
  await screen.findAllByTestId("folder-row");
  fireEvent.click(screen.getByRole("button", { name: /New folder…/ }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("New folder")).toBeTruthy();
  typeInto(dlg, "  Warranty ");
  await pressDialog("Create");
  await waitFor(() => expect(createFolder).toHaveBeenCalledWith("Warranty",
    "proton"));
  expect(await screen.findByText("Created “Warranty”.")).toBeTruthy();
  expect(yourFolders.mock.calls.length).toBeGreaterThan(1);   // listed again
});

test("New folder… needs a name", async () => {
  show();
  await screen.findAllByTestId("folder-row");
  fireEvent.click(screen.getByRole("button", { name: /New folder…/ }));
  const dlg = await findDialog();
  typeInto(dlg, "   ");
  await new Promise((r) => setTimeout(r, 600));
  fireEvent.click(within(dlg).getByRole("button", { name: "Create" }));
  expect(await within(dlg).findByText("Enter a name.")).toBeTruthy();
  expect(createFolder).not.toHaveBeenCalled();
});

/* --------------------------------- scan switch -------------------------------- */

test("the scan switch is the Settings switch: it writes the same exclusion list", async () => {
  show();
  await open("Old phone backup");
  const sw = within(pane()).getByRole("switch");
  expect(sw.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(sw);
  await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({
    account: "proton", excluded_folders: ["Labels/*"] }));
  expect(await screen.findByText(
    "“Old phone backup” is part of the cleanup scan now. The next scan reads it."))
    .toBeTruthy();
  // and the other way round
  cleanup();
  show();
  await open("Travel");
  fireEvent.click(within(pane()).getByRole("switch"));
  await waitFor(() => expect(saveConfig).toHaveBeenLastCalledWith({
    account: "proton", excluded_folders: ["Old phone backup", "Labels/*",
      "Travel"] }));
});

test("a folder an exclude pattern keeps out has its switch off, with the pattern named", async () => {
  show();
  await open("Labels/Family");
  const sw = within(pane()).getByRole("switch") as HTMLButtonElement;
  expect(sw.disabled).toBe(true);
  expect(within(pane()).getByText(/Excluded by the pattern Labels\/\*/)).toBeTruthy();
  fireEvent.click(within(pane()).getByRole("button", { name: "Settings › Account" }));
  expect(onSettings).toHaveBeenCalled();
});

/* ------------------------------------ phone ----------------------------------- */

test("phone: a card per folder, the pane opens as a sheet, New folder… sits on the page", async () => {
  viewport(390);
  show();
  await screen.findAllByTestId("folder-row");
  expect(rows()).toHaveLength(ROWS.length);
  expect(screen.queryByTestId("folder-pane")).toBeNull();
  expect(screen.getByRole("button", { name: /New folder…/ })).toBeTruthy();
  const r = row("Receipts 2019");
  expect(within(r).getByText(/41 mails · .*MB · 30 Dec 2019/)).toBeTruthy();
  expect(within(r).getByText("look-alike")).toBeTruthy();
  expect(within(r).getByText("1 rule")).toBeTruthy();
  fireEvent.click(within(r).getByRole("button"));
  const sheet = await screen.findByRole("dialog", { name: "Receipts 2019" });
  expect(within(sheet).getByRole("button", { name: /Merge into/ })).toBeTruthy();
  expect(within(sheet).getByText("Old receipts to their folder")).toBeTruthy();
});

/* ------------------------------------ German ---------------------------------- */

test("German: the page, the pane and the merge dialog", async () => {
  setLang("de");
  folderCheck.mockResolvedValue(mergeCheck());
  show();
  await screen.findAllByTestId("folder-row");
  expect(screen.getAllByText("Deine Ordner").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /3 ähnliche Namen/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /1 leerer Ordner/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /1 Ordner ohne neue Mails/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Neuer Ordner…/ })).toBeTruthy();
  expect(screen.getByText(/^8 gescannt · 2\.137 Mails · .* · 2 nicht gescannt$/))
    .toBeTruthy();
  expect(within(row("Receipts 2019")).getByText("ähnlicher Name")).toBeTruthy();
  fireEvent.click(within(row("Receipts 2019")).getByRole("button"));
  expect(within(pane()).getByText(
    "Sieht aus wie Receipts (164 Mails). Zu einem Ordner zusammenführen?"))
    .toBeTruthy();
  expect(within(pane()).getByText("Löschen gibt es nur für leere Ordner."))
    .toBeTruthy();
  fireEvent.click(within(pane()).getByRole("button", { name: /Zusammenführen in…/ }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("„Receipts 2019“ zusammenführen in…")).toBeTruthy();
  expect(await within(dlg).findByText(/Die aktive Regel „Old receipts to their folder“ zeigt dann auf „Receipts“ und geht zurück auf „Nur Bericht“/))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: /^41\sMails verschieben$/ }))
    .toBeTruthy();
});

/* ---------------- everything of the Clean up pages stays reachable --------- */

test("the page shows every folder of the account: nothing is hidden by a hint filter at the start", async () => {
  show();
  await screen.findAllByTestId("folder-row");
  const names = ROWS.map((x) => x.name);
  for (const n of names)
    expect(rows().some((r) => within(r).queryByText(n, { exact: true })),
      n).toBe(true);
  expect(ARCHIVE.lock).toBe("role");
  expect([RECEIPTS, RECEIPTS_OLD, TAXES, NEWSLETTERS, PHONE, FAMILY]
    .every((x) => names.includes(x.name))).toBe(true);
});
