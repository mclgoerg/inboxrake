// @vitest-environment jsdom
/* Permanent delete in the Folders panel (P6, irreversible): the live count
 * comes from the server, the danger confirm shows the counts (to delete /
 * skipped protected / skipped pinned) and the word "permanently", the delete
 * sends back exactly the counted uv + UIDs, nothing runs without the
 * confirm, refusals surface as errors. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { noteAccountSwitch } from "./accountGuard";
import { FoldersPanel } from "./components/FoldersPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";
import { popupPick } from "./toolTestUtils";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import type { AppState, PurgePreview } from "./types";

const foldersPanel = vi.fn();
const purgePreview = vi.fn();
const purge = vi.fn();

vi.mock("./api", () => ({
  api: {
    foldersPanel: (role: string) => foldersPanel(role),
    purgePreview: (...a: unknown[]) => purgePreview(...a),
    purge: (...a: unknown[]) => purge(...a),
  },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const state = { folders: ["INBOX"], folders_raw: ["INBOX"] } as unknown as AppState;

const mail = (uid: number, addr: string, subject: string) => ({
  uid, folder: "X", date: "2026-01-02", ts: uid, subject, addr, size: 700,
  seen: true, ai: null });
const listing = (folder: string, uv: number) => ({
  folder, uv, total: 3, max_uid: 42,
  mails: [mail(42, "bob@friends.example", "Wrongly caught"),
    mail(41, "win@lottery.example", "Again"),
    mail(40, "win@lottery.example", "You won")],
  senders: [
    { addr: "win@lottery.example", count: 2, size: 1100, unread: 0, ts: 3,
      date: "2026-01-03", uids: [40, 41] },
    { addr: "bob@friends.example", count: 1, size: 700, unread: 0, ts: 4,
      date: "2026-01-04", uids: [42] }],
});
const preview = (over: Partial<PurgePreview> = {}): PurgePreview => ({
  role: "junk", folder: "Spam", trash_folder: "Trash", uv: 4, uids: [40, 41], count: 2, total: 3, size: 1100,
  skipped_protected: 0, skipped_pinned: 0, via_trash: true, ...over });

beforeEach(() => {
  foldersPanel.mockImplementation((role: string) =>
    Promise.resolve(role === "junk" ? listing("Spam", 4)
      : listing("Trash", 7)));
  purgePreview.mockResolvedValue(preview());
  purge.mockResolvedValue({ deleted: 2, skipped_protected: 0,
    skipped_pinned: 0, missing: 0, capped: 0, unverified: 0, undo: null });
});
afterEach(() => {
  cleanup();
  foldersPanel.mockReset(); purgePreview.mockReset(); purge.mockReset();
  setLang("en");
});

function panel(initialRole: "junk" | "trash" = "junk",
               onChanged = () => {}, onUndo: (e: unknown) => void = () => {}) {
  return render(<ToastProvider><DialogProvider>
    <FoldersPanel state={state} initialRole={initialRole} onClose={() => {}}
      onChanged={onChanged} onEmptyTrash={async () => true}
      onUndo={onUndo} onProtect={async () => true} />
  </DialogProvider></ToastProvider>);
}

/** Enter Select mode (once), then tick one row by its label. */
const pick = async (label: string) => {
  if (!screen.queryByRole("button", { name: /^(Done|Fertig)$/ })) {
    fireEvent.click(await screen.findByRole("button",
      { name: /^(Select|Auswählen)$/ }));
  }
  fireEvent.click(await screen.findByLabelText(label));
};

const pickDelete = async (label = "Action…") => {
  popupPick(await screen.findByRole("button", { name: label }),
    /^(Delete permanently|Endgültig löschen)/);
};

test("a selected sender: live count, danger confirm with counts, then the exact counted uv + UIDs",
  async () => {
    purgePreview.mockResolvedValue(preview({
      skipped_protected: 1, skipped_pinned: 2 }));
    const onChanged = vi.fn();
    panel("junk", onChanged);
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    // the whole sender row -> the server counts that sender live
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("junk",
      { senders: ["win@lottery.example"] }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Permanently delete from Junk?")).toBeTruthy();
    expect(within(dlg).getByText(/moved to Trash first and then deleted/))
      .toBeTruthy();
    expect(within(dlg).getByText("2 mails will be deleted permanently"))
      .toBeTruthy();
    expect(within(dlg).getByText("1 mail from a protected sender is skipped"))
      .toBeTruthy();
    expect(within(dlg).getByText("2 protected mails are skipped")).toBeTruthy();
    expect(purge).not.toHaveBeenCalled();                // not before confirm
    await pressDialog("Delete permanently (2)");
    await waitFor(() => expect(purge).toHaveBeenCalledWith(
      "junk", [40, 41], 4, "Spam", "Trash"));           // counted uv + UIDs
    await screen.findByText("Permanently deleted 2 mails");
    expect(onChanged).toHaveBeenCalled();
    expect(foldersPanel).toHaveBeenCalledTimes(2);       // listing reloaded
  });

test("the confirm button is the danger tone and names verb + count",
  async () => {
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    const dlg = await findDialog();
    const btn = within(dlg).getByRole("button",
      { name: "Delete permanently (2)" });
    expect(btn.className).toContain("bg-danger");
    expect(btn.textContent).toContain("permanently");
  });

test("switching account while the count loads shows no confirm and deletes nothing",
  async () => {
    let release!: (v: unknown) => void;
    purgePreview.mockReturnValue(new Promise((r) => { release = r; }));
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    await waitFor(() => expect(purgePreview).toHaveBeenCalled());
    noteAccountSwitch();
    release(preview());
    await expectNoDialog();
    expect(purge).not.toHaveBeenCalled();
  });

test("switching account while the confirm is open: confirming deletes nothing",
  async () => {
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    await findDialog();
    noteAccountSwitch();
    await pressDialog("Delete permanently (2)");
    await new Promise((r) => setTimeout(r, 30));
    expect(purge).not.toHaveBeenCalled();
  });

test("Cancel deletes nothing", async () => {
  panel("junk");
  await screen.findByText("win@lottery.example");
  await pick("Select win@lottery.example");
  await pickDelete();
  await findDialog();
  await cancelDialog();
  await new Promise((r) => setTimeout(r, 50));
  expect(purge).not.toHaveBeenCalled();
});

test("selected mails (mails view) are counted by their UIDs", async () => {
  purgePreview.mockResolvedValue(preview({ uids: [41], count: 1,
    via_trash: false, role: "trash", folder: "Trash", trash_folder: null,
    uv: 4 }));
  panel("trash");
  await screen.findByText("Again");
  await pick("Select Again");
  await pickDelete();
  await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("trash",
    { uids: [41] }));
  const dlg = await findDialog();
  expect(within(dlg).getByText("1 mail will be deleted permanently"))
    .toBeTruthy();
  expect(within(dlg).getByText("Permanently delete from Trash?")).toBeTruthy();
  // Trash is deleted in place: no "via Trash" wording
  expect(within(dlg).queryByText(/moved to Trash first/)).toBeNull();
  await pressDialog("Delete permanently (1)");
  await waitFor(() => expect(purge).toHaveBeenCalledWith("trash", [41], 4,
      "Trash", null));
});

/* "Delete older than N days" is three short tests, not one long one: every
 * dialog step waits out the arming delay, so a single test chaining all of
 * them used ~2.5 s unloaded and hit the 5 s limit on a busy CI runner. */
const openOlderThan = async () => {
  panel("trash");
  await screen.findByText("Again");
  fireEvent.click(screen.getByRole("button", { name: "Delete older than…" }));
  return await findDialog();
};

test("Delete older than N days: asks for N and rejects anything but 1-36500",
  async () => {
    const ask = await openOlderThan();
    expect(within(ask).getByText("Received more than this many days ago"))
      .toBeTruthy();
    const input = within(ask).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("30");
    for (const bad of ["0", "36501", "99999", "x"]) {
      fireEvent.change(input, { target: { value: bad } });
      await pressDialog("Count mails");
      expect(await within(await findDialog()).findByText(
        "Enter a whole number of days from 1 to 36500.")).toBeTruthy();
      expect(purgePreview).not.toHaveBeenCalled();
    }
    fireEvent.change(input, { target: { value: "36500" } });
    await pressDialog("Count mails");
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("trash",
      { older_than_days: 36500 }));
  });

test("Delete older than N days: the confirm says '1 day' in the singular",
  async () => {
    const again = await openOlderThan();
    fireEvent.change(within(again).getByRole("textbox"),
      { target: { value: "1" } });
    await pressDialog("Count mails");
    expect(within(await findDialog()).getByText(
      /received more than 1 day ago/)).toBeTruthy();
  });

test("Delete older than N days: counts live, confirms, sends the counted UIDs",
  async () => {
    purgePreview.mockResolvedValue(preview({ uids: [40], count: 1,
      via_trash: false, role: "trash", folder: "Trash", trash_folder: null,
      uv: 7 }));
    const third = await openOlderThan();
    fireEvent.change(within(third).getByRole("textbox"),
      { target: { value: "90" } });
    await pressDialog("Count mails");
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("trash",
      { older_than_days: 90 }));
    const dlg = await findDialog();
    expect(within(dlg).getByText(/received more than 90 days ago/)).toBeTruthy();
    await pressDialog("Delete permanently (1)");
    await waitFor(() => expect(purge).toHaveBeenCalledWith("trash", [40], 7,
      "Trash", null));
  });

test("bottom bar: Empty Junk · n next to Delete older than, Trash keeps Empty Trash",
  async () => {
    purgePreview.mockResolvedValue(preview({ uids: [40, 41, 42], count: 3 }));
    panel("junk");
    await screen.findByText("win@lottery.example");
    expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Empty Junk (3)" }));
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("junk",
      { everything: true }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Empty Junk permanently?")).toBeTruthy();
    await pressDialog("Delete permanently (3)");
    await waitFor(() => expect(purge).toHaveBeenCalledWith(
      "junk", [40, 41, 42], 4, "Spam", "Trash"));
    cleanup();
    panel("trash");
    expect(await screen.findByRole("button", { name: "Empty Trash (3)" }))
      .toBeTruthy();
    expect(screen.queryByRole("button", { name: /Empty Junk/ })).toBeNull();
  });

test("nothing deletable (all skipped): a toast, no confirm, no delete",
  async () => {
    purgePreview.mockResolvedValue(preview({ uids: [], count: 0,
      skipped_protected: 2, skipped_pinned: 1 }));
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    await screen.findByText("Nothing to delete. 2 mails from protected senders are skipped; 1 protected "
      + "mail is skipped. Remove the protection first to delete them.");
    expect(purge).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("dialog")
      .filter((d) => d.hasAttribute("aria-labelledby"))).toHaveLength(0);
  });

test("a refused delete (ambiguous role, changed folder) shows the error and keeps the rows",
  async () => {
    purge.mockRejectedValue(new Error(
      "Trash is ambiguous - choose it in Settings first"));
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    await pressDialog("Delete permanently (2)");
    expect((await screen.findAllByText(/Trash is ambiguous/)).length)
      .toBeGreaterThan(0);
    expect(screen.getByText("win@lottery.example")).toBeTruthy();
  });

test("a refused count (ambiguous Junk) never reaches the confirm", async () => {
  purgePreview.mockRejectedValue(new Error(
    "Junk is ambiguous - choose it in Settings first"));
  panel("junk");
  await screen.findByText("win@lottery.example");
  await pick("Select win@lottery.example");
  await pickDelete();
  expect((await screen.findAllByText(/Junk is ambiguous/)).length)
    .toBeGreaterThan(0);
  expect(purge).not.toHaveBeenCalled();
});

test("unverified Junk mails are reported as still being in Trash", async () => {
  const undo = { ts: 5, label: "2 mails from Junk", count: 2 };
  purge.mockResolvedValue({ deleted: 0, skipped_protected: 0,
    skipped_pinned: 0, missing: 0, capped: 0, unverified: 2, undo });
  const onUndo = vi.fn();
  panel("junk", () => {}, onUndo);
  await screen.findByText("win@lottery.example");
  await pick("Select win@lottery.example");
  await pickDelete();
  await pressDialog("Delete permanently (2)");
  const msg = await screen.findByText(/Nothing was deleted permanently/);
  expect(msg.textContent).toContain("Moved 2\u00a0mails to Trash, but could not "
    + "verify them for permanent deletion");
  // not a success toast: an alert that stays, with Undo for the move
  const toast = msg.closest("[data-variant]")!;
  expect(toast.getAttribute("data-variant")).toBe("error");
  expect(toast.getAttribute("role")).toBe("alert");
  expect(screen.queryByText(/Permanently deleted/)).toBeNull();
  fireEvent.click(within(toast as HTMLElement)
    .getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledWith(undo);
});

test("unverified in German says nothing was deleted permanently", async () => {
  setLang("de");
  purge.mockResolvedValue({ deleted: 0, skipped_protected: 0,
    skipped_pinned: 0, missing: 0, capped: 0, unverified: 1, undo: null });
  panel("junk");
  await screen.findByText("win@lottery.example");
  await pick("win@lottery.example auswählen");
  popupPick(screen.getByRole("button", { name: "Aktion…" }),
    /^Endgültig löschen/);
  await pressDialog("Endgültig löschen (2)");
  const msg = await screen.findByText(/Es wurde nichts endgültig gelöscht/);
  expect(msg.textContent).toContain("1\u00a0Mail in den Papierkorb verschoben");
  expect(msg.closest("[data-variant]")!.getAttribute("data-variant"))
    .toBe("error");
});

test("everything vanished: an info toast, never 'Permanently deleted 0'",
  async () => {
    purge.mockResolvedValue({ deleted: 0, skipped_protected: 0,
      skipped_pinned: 0, missing: 2, capped: 0, unverified: 0, undo: null });
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    await pressDialog("Delete permanently (2)");
    const msg = await screen.findByText(
      "Nothing was left to delete - the mails were already gone.");
    expect(msg.closest("[data-variant]")!.getAttribute("data-variant"))
      .toBe("info");
    expect(screen.queryByText(/Permanently deleted/)).toBeNull();
  });

test("the delete is sent with the role, folder, uv and UIDs of the PREVIEW, not the panel's state",
  async () => {
    // panel on Junk, but the count came back for Trash / another folder:
    // that is exactly what must be sent
    purgePreview.mockResolvedValue(preview({ role: "trash",
      folder: "Deleted Items", trash_folder: null, uv: 99, uids: [7, 8],
      count: 2, via_trash: false }));
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    await pickDelete();
    await pressDialog("Delete permanently (2)");
    await waitFor(() => expect(purge).toHaveBeenCalledWith(
      "trash", [7, 8], 99, "Deleted Items", null));
  });

test("the confirm bullet shows the LIVE count, not the selection size",
  async () => {
    purgePreview.mockResolvedValue(preview({ uids: [41], count: 1 }));
    panel("junk");
    await screen.findByText("win@lottery.example");
    await pick("Select win@lottery.example");
    expect(screen.getByRole("button", { name: "Not junk (2)" })).toBeTruthy();
    await pickDelete();
    const dlg = await findDialog();
    expect(within(dlg).getByText("1 mail will be deleted permanently"))
      .toBeTruthy();
    expect(within(dlg).queryByText(/2 mails will be deleted/)).toBeNull();
    expect(within(dlg).getByRole("button", { name: "Delete permanently (1)" }))
      .toBeTruthy();
  });

test("a partial / mixed selection is sent as exact UIDs, never as senders",
  async () => {
    panel("junk");
    await screen.findByText("win@lottery.example");
    // select ONE mail of the sender in the mails view, then switch grouping
    fireEvent.click(screen.getByRole("tab", { name: "Mails" }));
    await pick("Select You won");
    fireEvent.click(screen.getByRole("tab", { name: "By sender" }));
    await pickDelete();
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("junk",
      { uids: [40] }));
  });

test("one whole sender row plus a stray mail of another sender falls back to UIDs",
  async () => {
    panel("junk");
    await screen.findByText("win@lottery.example");
    fireEvent.click(screen.getByRole("tab", { name: "Mails" }));
    await pick("Select You won");   // 1 of 2
    await pick("Select Wrongly caught"); // all of bob
    fireEvent.click(screen.getByRole("tab", { name: "By sender" }));
    await pickDelete();
    await waitFor(() => expect(purgePreview).toHaveBeenCalledTimes(1));
    expect(purgePreview.mock.calls[0][1]).toEqual({ uids: [40, 42] });
  });

test("German strings", async () => {
  setLang("de");
  purgePreview.mockResolvedValue(preview({ skipped_protected: 1,
    skipped_pinned: 1 }));
  panel("junk");
  await screen.findByText("win@lottery.example");
  expect(screen.getByRole("button", { name: "Spam leeren (3)" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ältere löschen…" })).toBeTruthy();
  await pick("win@lottery.example auswählen");
  popupPick(screen.getByRole("button", { name: "Aktion…" }),
    /^Endgültig löschen/);
  const dlg = await findDialog();
  expect(within(dlg).getByText("Endgültig aus „Spam“ löschen?")).toBeTruthy();
  expect(within(dlg).getByText("2 Mails werden endgültig gelöscht"))
    .toBeTruthy();
  expect(within(dlg).getByText("1 Mail eines geschützten Absenders wird übersprungen"))
    .toBeTruthy();
  expect(within(dlg).getByText("1 geschützte Mail wird übersprungen"))
    .toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Endgültig löschen (2)" }))
    .toBeTruthy();
});

test("phone: the delete controls are >= 44px targets", async () => {
  panel("junk");
  await screen.findByText("win@lottery.example");
  for (const name of [/Empty Junk/, /Delete older than/]) {
    expect(screen.getByRole("button", { name }).className)
      .toContain("max-sm:coarse:min-h-11");
  }
  await pick("Select win@lottery.example");
  expect(screen.getByLabelText("Action…").className)
    .toContain("max-sm:coarse:min-h-11");
});

test("every new fp / stats string exists in EN and DE with its _one form", () => {
  const keys = Object.keys(EN).filter((k) =>
    /^(fp\.(purge|older|empty_junk|delete_permanently|purged)|stats\.(freed_month|actions_purged)|audit\.act\.purge)/
      .test(k));
  expect(keys.length).toBeGreaterThan(25);
  for (const k of keys) {
    expect(DE[k], `DE ${k}`).toBeTruthy();
    expect(DE[k].trim(), k).not.toBe(EN[k]);          // translated
  }
  for (const k of Object.keys(DE).filter((x) => keys.includes(x))) {
    expect(EN[k], `EN ${k}`).toBeTruthy();
  }
  for (const base of ["fp.purge_b_delete", "fp.purge_b_protected",
    "fp.purge_b_pinned", "fp.purged", "fp.purged_skipped",
    "fp.purge_unverified", "fp.purge_scope_older", "stats.freed_month"]) {
    expect(EN[`${base}_one`], `EN ${base}_one`).toBeTruthy();
    expect(DE[`${base}_one`], `DE ${base}_one`).toBeTruthy();
  }
  // the UI's own terms: pinned mails are "protected mails" / "geschützte Mails"
  expect(EN["fp.purge_b_pinned"]).toContain("protected");
  expect(DE["fp.purge_b_pinned"]).toContain("geschützte");
  expect(DE["fp.purge_none_skipped"]).toContain("Schutz aufheben");
  expect(JSON.stringify([...Object.entries(EN), ...Object.entries(DE)]
    .filter(([k]) => k.startsWith("fp.purge")).map(([, v]) => v)))
    .not.toMatch(/pinned|angeheftet/i);
});
