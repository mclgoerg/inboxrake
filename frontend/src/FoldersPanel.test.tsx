// @vitest-environment jsdom
/* Trash and Junk pages: size card, Restore per Trash row, by-sender Junk rows
 * with Not junk / Block / Trash, the "senders you know" banner, Select mode
 * with its actions, "Not junk" with an Undo + Protect toast, restore (the note
 * says whether the views refresh by themselves), the bottom bar. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FoldersPanel } from "./components/FoldersPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { findPicker, pickFolder } from "./folderPickerTestUtil";
import { popupOptions, popupPick } from "./toolTestUtils";
import { findDialog, pressDialog, cancelDialog, expectNoDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { AppState } from "./types";

const trashRestore = vi.fn();
const folderMove = vi.fn();
const foldersPanel = vi.fn();
const clearNotice = vi.fn().mockResolvedValue({ ok: true });
const fmtSize = vi.fn((_b: number) => "1 KB");

vi.mock("./api", () => ({
  api: {
    foldersPanel: (role: string) => foldersPanel(role),
    folderMove: (...a: unknown[]) => folderMove(...a),
    trashRestore: (...a: unknown[]) => trashRestore(...a),
    clearNotice: (...a: unknown[]) => clearNotice(...a),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
    purgePreview: vi.fn().mockResolvedValue({ count: 0, size: 0 }),
    message: () => Promise.resolve({ from: "x", to: "", date: "d",
      subject: "s", text: "body text" }),
  },
  errorText: (s: string) => s,
  fmtSize: (b: number) => fmtSize(b),
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

let total = 1;
let emptyList = false;
const state = {
  account: "proton",
  folders: ["INBOX", "Trash"], folders_raw: ["INBOX", "Trash"],
  // bob replied to us: a known sender in Junk
  groups: { sender: { "bob@friends.example": {
    key: "bob@friends.example", replied: true } } },
} as unknown as AppState;

const trashListing = () => ({
  folder: "Trash", uv: 1, total, max_uid: 77,
  mails: emptyList ? [] : [{ uid: 30, folder: "Trash", date: "2026-01-02",
    ts: 1, subject: "Deleted elsewhere", addr: "old@gone.example", size: 700,
    seen: false, ai: null }],
  senders: emptyList ? [] : [{ addr: "old@gone.example", count: 1,
    size: 700, unread: 1, ts: 1, date: "2026-01-02", uids: [30] }],
});
const junkListing = () => ({
  folder: "Spam", uv: 4, total: 3, max_uid: 42,
  mails: [
    { uid: 42, folder: "Spam", date: "2026-01-04", ts: 4,
      subject: "Wrongly caught", addr: "bob@friends.example", size: 700,
      seen: false, ai: null },
    { uid: 41, folder: "Spam", date: "2026-01-03", ts: 3, subject: "Again",
      addr: "win@lottery.example", size: 600, seen: true, ai: null },
    { uid: 40, folder: "Spam", date: "2026-01-02", ts: 2, subject: "You won",
      addr: "win@lottery.example", size: 500, seen: false, ai: null },
  ],
  senders: [
    { addr: "win@lottery.example", count: 2, size: 1100, unread: 1, ts: 3,
      date: "2026-01-03", first_ts: 2, first_date: "2026-01-02",
      uids: [40, 41] },
    { addr: "bob@friends.example", count: 1, size: 700, unread: 1, ts: 4,
      date: "2026-01-04", first_ts: 4, first_date: "2026-01-04",
      uids: [42] },
  ],
});

beforeEach(() => {
  foldersPanel.mockImplementation((role: string) =>
    Promise.resolve(role === "junk" ? junkListing() : trashListing()));
});

afterEach(() => {
  cleanup();
  folderMove.mockReset();
  foldersPanel.mockReset();
  trashRestore.mockReset();
  clearNotice.mockClear();
  total = 1;
  emptyList = false;
  setLang("en");
  fmtSize.mockImplementation(() => "1 KB");
});

const onUndo = vi.fn();
const onProtect = vi.fn().mockResolvedValue(true);
function panel(over: Partial<React.ComponentProps<typeof FoldersPanel>> = {}) {
  return render(<ToastProvider><DialogProvider>
    <FoldersPanel state={state} onClose={() => {}} onChanged={() => {}}
      onEmptyTrash={async () => true} onUndo={onUndo} onProtect={onProtect}
      {...over} />
  </DialogProvider></ToastProvider>);
}

/** Select mode (the page's "Select" button), then tick the one row. */
async function selectMode() {
  fireEvent.click(await screen.findByRole("button", { name: "Select" }));
}
async function restoreOne() {
  panel();
  await selectMode();
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /Restore to/ }));
  await pickFolder("Inbox");
}

test("restore with a started rescan says the views update by themselves",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: true });
    await restoreOne();
    await waitFor(() => expect(screen.getByText(
      "Restored 1 mail - the views update automatically.")).toBeTruthy());
  });

test("a Trash restore drops its banner notice (the toast is the result)",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: true });
    await restoreOne();
    await waitFor(() => expect(clearNotice).toHaveBeenCalledWith(
      ["junk_rescued", "trash_restored"]));
  });

test("restore while the server is busy still asks for a manual rescan",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: false });
    await restoreOne();
    await waitFor(() => expect(screen.getByText(
      "Restored 1 mail - rescan to see it in the views.")).toBeTruthy());
  });

test("the bottom bar's Empty Trash runs the shared handler and reloads the list",
  async () => {
    const onEmptyTrash = vi.fn().mockResolvedValue(true);
    total = 7;
    panel({ state: { ...state, trash_count: 1 } as AppState, onEmptyTrash });
    await screen.findByText("Deleted elsewhere");
    // the panel's own listing total, not the (possibly stale) state count
    fireEvent.click(screen.getByRole("button", { name: "Empty Trash (7)" }));
    await waitFor(() => expect(onEmptyTrash).toHaveBeenCalledWith(
      expect.objectContaining({ total: 7, uv: 1, max_uid: 77 })));
  });

test("no Empty Trash footer when Trash is empty", async () => {
  total = 0;
  panel({ state: { ...state, trash_count: 3 } as AppState });
  await screen.findByText("Deleted elsewhere");
  expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
});

test("rows are MailRows; Select mode shows the boxes, the restore pop-up needs a selection",
  async () => {
    panel();
    await screen.findByText("Deleted elsewhere");
    expect(screen.getByText("old@gone.example · 1 KB")).toBeTruthy();
    // (on a phone the day also heads its group: the row's date is the <time>)
    expect(screen.getAllByText("2 Jan").find((e) => e.tagName === "TIME")!
      .getAttribute("title")).toBe("2026-01-02");
    expect(screen.getByText("unread")).toBeTruthy();   // seen: false
    expect(screen.queryByRole("checkbox")).toBeNull();  // only in Select mode
    await selectMode();
    expect(screen.getByLabelText("Select Deleted elsewhere")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restore to/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /Restore to… \(1\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByRole("button", { name: /Restore to/ })).toBeNull();
    // Done ends Select mode and drops the selection
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Restore to/ })).toBeNull();
  });

test("Trash: the size card says how much the folder holds; no Junk | Trash switch",
  async () => {
    panel();
    await screen.findByText("Deleted elsewhere");
    expect(screen.getByText("1 KB")).toBeTruthy();          // 700 B, fmtSize mocked
    expect(screen.getByText("in 1 mail")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Folder" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Junk" })).toBeNull();
  });

test("Trash: every row has a Restore button that puts the mail back in the inbox",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: true });
    const onChanged = vi.fn();
    panel({ onChanged });
    await screen.findByText("Deleted elsewhere");
    fireEvent.click(screen.getByRole("button",
      { name: "Restore: Deleted elsewhere" }));
    await waitFor(() => expect(trashRestore).toHaveBeenCalledWith([30],
      "INBOX", 1));
    await screen.findByText("Restored 1 mail - the views update automatically.");
    expect(screen.queryByText("Deleted elsewhere")).toBeNull();   // row gone
    expect(onChanged).toHaveBeenCalled();
  });

test("Search is a header button that opens the field and clears it again",
  async () => {
    panel();
    await screen.findByText("Deleted elsewhere");
    expect(screen.queryByPlaceholderText("Search subject or sender")).toBeNull();
    const btn = screen.getByRole("button", { name: "Search" });
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    const input = screen.getByPlaceholderText("Search subject or sender");
    fireEvent.change(input, { target: { value: "nothing like it" } });
    expect(screen.getByText("No matching mails")).toBeTruthy();
    fireEvent.click(btn);                                   // closes + clears
    expect(screen.getByText("Deleted elsewhere")).toBeTruthy();
  });

test("an empty Trash shows the empty state and no Empty Trash footer",
  async () => {
    emptyList = true;
    total = 0;
    panel();
    await screen.findByText("Trash is empty");
    expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
    expect(screen.queryByPlaceholderText("Search subject or sender")).toBeNull();
  });

/* --------------------------------- Junk ---------------------------------- */

test("the page follows the route: initialRole switches the folder", async () => {
  const { rerender } = panel();
  await screen.findByText("Deleted elsewhere");
  expect(foldersPanel).toHaveBeenLastCalledWith("trash");
  rerender(<ToastProvider><DialogProvider>
    <FoldersPanel state={state} initialRole="junk" onClose={() => {}}
      onChanged={() => {}} onEmptyTrash={async () => true} onUndo={onUndo}
      onProtect={onProtect} />
  </DialogProvider></ToastProvider>);
  await screen.findByText("win@lottery.example");          // Junk: by sender
  expect(foldersPanel).toHaveBeenLastCalledWith("junk");
  // Empty Trash belongs to Trash only
  expect(screen.queryByRole("button", { name: /Empty Trash/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Empty Junk (3)" })).toBeTruthy();
});

test("Junk: one row per sender with count, size and first seen",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    expect(screen.getByText("2 mails · 1 KB · first seen 2 Jan")).toBeTruthy();
    expect(screen.getByText("bob@friends.example")).toBeTruthy();
    expect(screen.getByText("1 mail · 1 KB · you replied before")).toBeTruthy();
    expect(screen.getByText("3 mails · checked by your mail server"))
      .toBeTruthy();
    fireEvent.click(screen.getByText("win@lottery.example"));   // drill in
    await screen.findByText("You won");
    expect(screen.getByText("Again")).toBeTruthy();
    expect(screen.queryByText("Wrongly caught")).toBeNull();   // filtered
    // back to the sender view with the By sender segment
    fireEvent.change(screen.getByPlaceholderText("Search subject or sender"),
      { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "By sender" }));
    expect(screen.getByText("2 mails · 1 KB · first seen 2 Jan")).toBeTruthy();
  });

test("Junk rows: Not junk, Block and Trash act on that sender's exact UIDs",
  async () => {
    const onBlock = vi.fn().mockResolvedValue(true);
    folderMove.mockResolvedValue({ moved: 2, rescan: false, senders: [],
      undo: null });
    panel({ initialRole: "junk", onBlock });
    await screen.findByText("win@lottery.example");
    fireEvent.click(screen.getByRole("button",
      { name: "Not junk: win@lottery.example" }));
    await screen.findByText("Moved 2 mails to your inbox");
    expect(folderMove).toHaveBeenLastCalledWith("junk", "not_junk", [40, 41], 4);
    fireEvent.click(screen.getByRole("button",
      { name: "Block: bob@friends.example" }));
    expect(onBlock).toHaveBeenCalledWith("bob@friends.example");
    folderMove.mockResolvedValue({ moved: 1, rescan: false, senders: [],
      undo: null });
    fireEvent.click(screen.getByRole("button",
      { name: "Trash: bob@friends.example" }));
    await screen.findByText("Moved 1 mail to Trash");
    expect(folderMove).toHaveBeenLastCalledWith("junk", "trash", [42], 4);
  });

test("Junk: an already blocked sender shows Blocked instead of a Block button",
  async () => {
    panel({ initialRole: "junk", onBlock: async () => true,
      blockedSenders: new Set(["win@lottery.example"]) });
    await screen.findByText("win@lottery.example");
    expect(screen.queryByRole("button",
      { name: "Block: win@lottery.example" })).toBeNull();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Block: bob@friends.example" }))
      .toBeTruthy();
  });

test("Junk: the banner counts senders you replied to and filters to them",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    expect(screen.getByText("1 sender you know")).toBeTruthy();
    expect(screen.getByText("known")).toBeTruthy();         // tag on the row
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.queryByText("win@lottery.example")).toBeNull();
    expect(screen.getByText("bob@friends.example")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("win@lottery.example")).toBeTruthy();
  });

test("Junk: no banner when nobody you replied to is in Junk", async () => {
  panel({ initialRole: "junk",
    state: { ...state, groups: { sender: {} } } as unknown as AppState });
  await screen.findByText("win@lottery.example");
  expect(screen.queryByText(/senders? you know/)).toBeNull();
  expect(screen.queryByText("known")).toBeNull();
});

test("selecting a sender selects all of its mails; actions only with a selection",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    expect(screen.queryByLabelText("Action…")).toBeNull();
    await selectMode();
    // the row's own buttons give way to the checkbox + the page's actions
    expect(screen.queryByRole("button", { name: /^Not junk:/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Select win@lottery.example"));
    expect(screen.getByRole("button", { name: "Not junk (2)" })).toBeTruthy();
    expect(screen.getByLabelText("Action…")).toBeTruthy();
    // permanent delete lives in the Action select only (P6), never as a
    // button of its own - the primary action stays the safe "Not junk"
    expect(screen.queryByRole("button", { name: /permanently/i })).toBeNull();
    expect(popupOptions(screen.getByRole("button", { name: "Action…" })))
      .toContain("Delete permanently…");
    fireEvent.click(screen.getByLabelText("Select win@lottery.example"));
    expect(screen.queryByRole("button", { name: /Not junk \(/ })).toBeNull();
  });

test("Not junk (Select mode) moves the exact UIDs, toasts with Undo and Protect sender",
  async () => {
    const onChanged = vi.fn();
    const undo = { id: "1a2b", ts: 9, label: "1 mail from Junk", count: 1 };
    folderMove.mockResolvedValue({ moved: 1, rescan: true,
      senders: ["bob@friends.example"], undo });
    panel({ initialRole: "junk", onChanged });
    await screen.findByText("bob@friends.example");
    await selectMode();
    fireEvent.click(screen.getByLabelText("Select bob@friends.example"));
    fireEvent.click(screen.getByRole("button", { name: "Not junk (1)" }));
    await screen.findByText("Moved 1 mail to your inbox");
    expect(folderMove).toHaveBeenCalledWith("junk", "not_junk", [42], 4);
    // the row is gone; the count in the sub line follows
    expect(screen.queryByText("bob@friends.example")).toBeNull();
    expect(screen.getByText("2 mails · checked by your mail server"))
      .toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    // nothing was protected by the move itself
    expect(onProtect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Protect sender" }));
    expect(onProtect).toHaveBeenCalledWith(["bob@friends.example"]);
    cleanup();
    panel({ initialRole: "junk" });
    await screen.findByText("bob@friends.example");
    fireEvent.click(screen.getByRole("button",
      { name: "Not junk: bob@friends.example" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    // the whole identity, id included: the App finds the entry in
    // state.undo by it
    expect(onUndo).toHaveBeenCalledWith(undo);
    // Not junk drops the "Moved N mails" banner notice of the same move
    expect(clearNotice).toHaveBeenCalledWith(["junk_rescued", "trash_restored"]);
  });

test("Move to Trash from Junk; protected mails ask before a forced retry",
  async () => {
    const err = Object.assign(new Error("Some are protected."),
      { code: "protected_mails" });
    folderMove.mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ moved: 1, rescan: false,
        senders: ["bob@friends.example"], undo: null });
    panel({ initialRole: "junk" });
    await screen.findByText("bob@friends.example");
    fireEvent.click(screen.getByRole("button",
      { name: "Trash: bob@friends.example" }));
    expect(await screen.findByText("Some are protected.")).toBeTruthy();
    expect(folderMove).toHaveBeenCalledTimes(1);          // nothing forced yet
    expect(folderMove).toHaveBeenLastCalledWith("junk", "trash", [42], 4);
    fireEvent.click(screen.getByRole("button", { name: "Move anyway" }));
    await screen.findByText("Moved 1 mail to Trash");
    expect(folderMove).toHaveBeenLastCalledWith("junk", "trash", [42], 4, true);
  });

test("German labels", async () => {
  setLang("de");
  panel({ initialRole: "junk" });
  await screen.findByText("win@lottery.example");
  expect(screen.getByRole("tab", { name: "Nach Absender" })).toBeTruthy();
  expect(screen.getByText("1 Absender, den du kennst")).toBeTruthy();
  expect(screen.getByText("2 Mails · 1 KB · erstmals 2. Jan.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
  fireEvent.click(screen.getByLabelText("bob@friends.example auswählen"));
  expect(screen.getByRole("button", { name: "Kein Spam (1)" })).toBeTruthy();
  expect(screen.getByLabelText("Aktion…")).toBeTruthy();
});

test("the By sender | Mails switch has equal-width segments", async () => {
  panel({ initialRole: "junk" });
  await screen.findByText("win@lottery.example");
  expect(screen.getByRole("tablist", { name: "Group by" }).className)
    .toContain("auto-cols-fr");
});

test("phone layout: the select actions are >= 44px targets",
  async () => {
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    await selectMode();
    fireEvent.click(screen.getByLabelText("Select bob@friends.example"));
    expect(screen.getByRole("button", { name: "Not junk (1)" }).className)
      .toContain("max-sm:coarse:min-h-11");
    expect(screen.getByLabelText("Action…").className)
      .toContain("max-sm:coarse:min-h-11");
  });


test("Restore to… is the folder picker, and Trash itself is not offered",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: false });
    panel();
    await selectMode();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Restore to/ }));
    const dlg = await findPicker();
    const names = within(dlg).getAllByRole("button").map((b) => b.textContent);
    expect(names.some((n) => /^Inbox/.test(n ?? ""))).toBe(true);
    expect(names.some((n) => /^Trash\d*$/.test(n ?? ""))).toBe(false);
    // it is a restore, not a move
    expect(within(dlg).getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(within(dlg).queryByRole("button", { name: "Move" })).toBeNull();
  });

/* -------------------- selection only ever covers what you see ------------- */

test("a selection hidden by a search is not acted on (Restore to…)",
  async () => {
    foldersPanel.mockResolvedValue({ ...trashListing(), total: 2,
      mails: [
        { uid: 30, folder: "Trash", date: "2026-01-02", ts: 2,
          subject: "Cancelled order", addr: "a@gone.example", size: 700,
          seen: true, ai: null },
        { uid: 31, folder: "Trash", date: "2026-01-02", ts: 1,
          subject: "Weekly news", addr: "b@gone.example", size: 700,
          seen: true, ai: null }],
      senders: [] });
    trashRestore.mockResolvedValue({ restored: 1, rescan: false });
    panel();
    await screen.findByText("Cancelled order");
    await selectMode();
    fireEvent.click(screen.getByLabelText("Select Cancelled order"));
    fireEvent.click(screen.getByLabelText("Select Weekly news"));
    expect(screen.getByRole("button", { name: /Restore to… \(2\)/ }))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search subject or sender"),
      { target: { value: "cancelled" } });
    // only the visible one counts and is sent
    fireEvent.click(screen.getByRole("button", { name: /Restore to… \(1\)/ }));
    await pickFolder("Inbox");
    await waitFor(() => expect(trashRestore).toHaveBeenCalledWith([30],
      "INBOX", 1));
    // clearing the search does not bring the hidden tick back
    fireEvent.change(screen.getByPlaceholderText("Search subject or sender"),
      { target: { value: "" } });
    expect((screen.getByLabelText("Select Weekly news") as HTMLInputElement)
      .checked).toBe(false);
  });

test("Delete permanently counts only the visible selected mails",
  async () => {
    const purgePreview = (await import("./api")).api.purgePreview as
      ReturnType<typeof vi.fn>;
    purgePreview.mockResolvedValue({ role: "trash", folder: "Trash", uv: 1,
      trash_folder: null, uids: [], count: 0, total: 2, size: 0,
      skipped_protected: 0, skipped_pinned: 0, via_trash: false });
    foldersPanel.mockResolvedValue({ ...trashListing(), total: 2,
      mails: [
        { uid: 30, folder: "Trash", date: "2026-01-02", ts: 2,
          subject: "Cancelled order", addr: "a@gone.example", size: 700,
          seen: true, ai: null },
        { uid: 31, folder: "Trash", date: "2026-01-02", ts: 1,
          subject: "Weekly news", addr: "b@gone.example", size: 700,
          seen: true, ai: null }],
      senders: [] });
    panel();
    await screen.findByText("Cancelled order");
    await selectMode();
    fireEvent.click(screen.getByLabelText("Select Cancelled order"));
    fireEvent.click(screen.getByLabelText("Select Weekly news"));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Search subject or sender"),
      { target: { value: "cancelled" } });
    popupPick(screen.getByRole("button", { name: "Action…" }),
      "Delete permanently…");
    await waitFor(() => expect(purgePreview).toHaveBeenCalledWith("trash",
      { uids: [30] }));
  });

test("the known-senders filter ends when the last known sender is handled",
  async () => {
    folderMove.mockResolvedValue({ moved: 1, rescan: false, senders: [],
      undo: null });
    panel({ initialRole: "junk" });
    await screen.findByText("win@lottery.example");
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.queryByText("win@lottery.example")).toBeNull();
    fireEvent.click(screen.getByRole("button",
      { name: "Not junk: bob@friends.example" }));
    await screen.findByText("Moved 1 mail to your inbox");
    // banner gone AND the filter with it: the 2 remaining mails show again
    expect(screen.queryByText(/senders? you know/)).toBeNull();
    expect(screen.getByText("win@lottery.example")).toBeTruthy();
    expect(screen.queryByText("No matching mails")).toBeNull();
  });

test("the size card follows a Restore (and every other removal)", async () => {
  fmtSize.mockImplementation((b: number) => `${b} B`);
  trashRestore.mockResolvedValue({ restored: 1, rescan: false });
  foldersPanel.mockResolvedValue({ ...trashListing(), total: 2,
    mails: [
      { uid: 30, folder: "Trash", date: "2026-01-02", ts: 2, subject: "One",
        addr: "a@gone.example", size: 700, seen: true, ai: null },
      { uid: 31, folder: "Trash", date: "2026-01-02", ts: 1, subject: "Two",
        addr: "b@gone.example", size: 300, seen: true, ai: null }],
    senders: [
      { addr: "a@gone.example", count: 1, size: 700, unread: 0, ts: 2,
        date: "2026-01-02", uids: [30] },
      { addr: "b@gone.example", count: 1, size: 300, unread: 0, ts: 1,
        date: "2026-01-02", uids: [31] }] });
  panel();
  expect(await screen.findByText("1000 B")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Restore: One" }));
  expect(await screen.findByText("300 B")).toBeTruthy();
  expect(screen.getByText("in 1 mail")).toBeTruthy();
});

test("Block asks whether the sender's mails in Junk should go to Trash too",
  async () => {
    const onBlock = vi.fn().mockResolvedValue(true);
    folderMove.mockResolvedValue({ moved: 2, rescan: false, senders: [],
      undo: null });
    panel({ initialRole: "junk", onBlock });
    await screen.findByText("win@lottery.example");
    fireEvent.click(screen.getByRole("button",
      { name: "Block: win@lottery.example" }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Also move its 2 mails in Junk to Trash now?"))
      .toBeTruthy();
    await pressDialog("Keep them in Junk");
    await expectNoDialog();
    expect(onBlock).toHaveBeenCalledWith("win@lottery.example");
    expect(folderMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",
      { name: "Block: win@lottery.example" }));
    await findDialog();
    await pressDialog("Move to Trash (2)");
    await waitFor(() => expect(folderMove).toHaveBeenCalledWith("junk",
      "trash", [40, 41], 4));
  });

test("Junk: the reader's Trash is the row's move (protected confirm included) "
  + "and closes the reader; Trash has no reader Trash", async () => {
  folderMove.mockResolvedValue({ moved: 1, rescan: false, senders: [], undo: null });
  panel({ initialRole: "junk" });
  await screen.findByText("win@lottery.example");
  fireEvent.click(screen.getByText("win@lottery.example"));   // drill in
  fireEvent.click(await screen.findByText("You won"));
  await screen.findByText("body text");
  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  await waitFor(() => expect(folderMove)
    .toHaveBeenLastCalledWith("junk", "trash", [40], 4));
  await waitFor(() => expect(screen.queryByText("body text")).toBeNull());
  cleanup();

  panel({ initialRole: "trash" });
  fireEvent.click(await screen.findByText("Deleted elsewhere"));
  await screen.findByText("body text");
  expect(screen.queryByRole("button", { name: "Trash this mail" })).toBeNull();
});


/* ------------- two folders could be the role: said before any click ------- */

test("an ambiguous Junk role is named up front, deletes are disabled, moves stay",
  async () => {
    foldersPanel.mockResolvedValue({ ...junkListing(),
      ambiguous: [{ role: "junk", choices: ["Spam", "Junk Email"] }] });
    const choose = vi.fn();
    panel({ initialRole: "junk", onChooseFolder: choose });
    const notice = (await screen.findByText(/Spam, Junk Email/))
      .closest("[role=status]") as HTMLElement;
    expect(notice.textContent).toContain("choose one");
    fireEvent.click(within(notice).getByRole("button",
      { name: "Choose folder" }));
    expect(choose).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: /Empty Junk/ }) as
      HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete older than…" }) as
      HTMLButtonElement).disabled).toBe(true);
    // the reversible moves are untouched
    expect((screen.getAllByRole("button", { name: /Not junk/ })[0] as
      HTMLButtonElement).disabled).toBe(false);
    await selectMode();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Action/ }));
    const del = within(screen.getByRole("menu")).getByRole("menuitemradio",
      { name: "Delete permanently…" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

test("a clear role shows no notice and keeps the delete buttons live",
  async () => {
    foldersPanel.mockResolvedValue({ ...junkListing(), ambiguous: [] });
    panel({ initialRole: "junk" });
    await screen.findByRole("button", { name: /Empty Junk/ });
    expect(screen.queryByText(/could be your/)).toBeNull();
    expect((screen.getByRole("button", { name: /Empty Junk/ }) as
      HTMLButtonElement).disabled).toBe(false);
  });

test("after a toast Undo the page re-reads its folder", async () => {
  folderMove.mockResolvedValue({ moved: 1, rescan: true, senders: [],
    undo: { id: "u1", ts: 9, label: "1 mail from Junk", count: 1 } });
  const undone = vi.fn().mockResolvedValue(undefined);
  panel({ initialRole: "junk", onUndo: undone });
  await screen.findByText("bob@friends.example");
  fireEvent.click(screen.getByRole("button",
    { name: "Not junk: bob@friends.example" }));
  const before = foldersPanel.mock.calls.length;
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(foldersPanel.mock.calls.length).toBe(before + 1));
  expect(undone).toHaveBeenCalledTimes(1);
});

test("Choose folder names the page's own role", async () => {
  foldersPanel.mockResolvedValue({ ...junkListing(), ambiguous: [
    { role: "junk", choices: ["Spam", "Junk Email"] },
    { role: "trash", choices: ["Trash", "Deleted Items"] }] });
  const choose = vi.fn();
  panel({ initialRole: "junk", onChooseFolder: choose });
  fireEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
  expect(choose).toHaveBeenCalledWith("junk");
});

test("two ambiguous roles get one combined notice with one button, and a "
  + "visible reason beside the disabled buttons", async () => {
  foldersPanel.mockResolvedValue({ ...junkListing(), ambiguous: [
    { role: "junk", choices: ["Spam", "Junk Email"] },
    { role: "trash", choices: ["Trash", "Deleted Items"] }] });
  const choose = vi.fn();
  panel({ initialRole: "junk", onChooseFolder: choose });
  const notice = (await screen.findByText(/Spam, Junk Email/))
    .closest("[role=status]") as HTMLElement;
  expect(notice.textContent).toContain("Trash, Deleted Items");
  expect(notice.textContent).toContain("choose one of each");
  expect(within(notice).getAllByRole("button", { name: "Choose folder" }))
    .toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Choose folder" }))
    .toHaveLength(1);
  const reason = screen.getByText("Choose your folder first to delete permanently.");
  const empty = screen.getByRole("button", { name: /Empty Junk/ });
  expect(empty.getAttribute("aria-describedby")).toBe(reason.id);
  expect(empty.getAttribute("title")).toBeNull();
});

test("Trash on a phone: mails under Today / Yesterday / date, one icon "
  + "restore per row that names its mail", async () => {
  const day = (back: number) => {
    const d = new Date();
    d.setDate(d.getDate() - back);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const mail = (uid: number, date: string, subject: string) => ({
    uid, folder: "Trash", date, ts: uid, subject, addr: "a@b.example",
    size: 700, seen: true, ai: null });
  foldersPanel.mockResolvedValue({ folder: "Trash", uv: 1, total: 3, max_uid: 9,
    mails: [mail(3, day(0), "Fresh one"), mail(2, day(1), "Older one"),
      mail(1, "2025-03-02", "Ancient one")],
    senders: [] });
  trashRestore.mockResolvedValue({ restored: 1, rescan: false });
  panel();
  await screen.findByText("Fresh one");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent))
    .toEqual(["Today", "Yesterday", "2 Mar 2025"]);
  // the same restore as before, named after its mail (the word is for
  // screen readers on a phone)
  const btn = screen.getByRole("button", { name: "Restore: Older one" });
  fireEvent.click(btn);
  await waitFor(() => expect(trashRestore).toHaveBeenCalledWith([2], "INBOX", 1));
});
