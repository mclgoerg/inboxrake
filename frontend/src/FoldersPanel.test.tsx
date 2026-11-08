// @vitest-environment jsdom
/* Trash and Junk pages: size card, Restore per Trash row, by-sender Junk rows
 * with Not junk / Block / Trash, the "senders you know" banner, Select mode
 * with its actions, "Not junk" with an Undo + Protect toast, restore (the note
 * says whether the views refresh by themselves), the bottom bar. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FoldersPanel } from "./components/FoldersPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { popupOptions, popupPick } from "./toolTestUtils";
import { setLang } from "./i18n";
import type { AppState } from "./types";

const trashRestore = vi.fn();
const folderMove = vi.fn();
const foldersPanel = vi.fn();

vi.mock("./api", () => ({
  api: {
    foldersPanel: (role: string) => foldersPanel(role),
    folderMove: (...a: unknown[]) => folderMove(...a),
    trashRestore: (...a: unknown[]) => trashRestore(...a),
    purgePreview: vi.fn().mockResolvedValue({ count: 0, size: 0 }),
  },
  errorText: (s: string) => s,
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

let total = 1;
let emptyList = false;
const state = {
  folders: ["INBOX"], folders_raw: ["INBOX"],
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
  total = 1;
  emptyList = false;
  setLang("en");
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
  popupPick(screen.getByRole("button", { name: /Restore to/ }), "INBOX");
}

test("restore with a started rescan says the views update by themselves",
  async () => {
    trashRestore.mockResolvedValue({ restored: 1, rescan: true });
    await restoreOne();
    await waitFor(() => expect(screen.getByText(
      "Restored 1 mail - the views update automatically.")).toBeTruthy());
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
    fireEvent.click(screen.getByRole("button", { name: "Empty Trash · 7" }));
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
    expect(screen.getByText("2 Jan").getAttribute("title")).toBe("2026-01-02");
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
  expect(screen.getByRole("button", { name: "Empty Junk · 3" })).toBeTruthy();
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
    const undo = { ts: 9, label: "1 mail from Junk", count: 1 };
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
    expect(onUndo).toHaveBeenCalledWith(undo);
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
