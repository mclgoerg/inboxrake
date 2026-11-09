// @vitest-environment jsdom
/* Duplicates page: the one-tap "Remove N copies" (same confirm + trash call
 * as "Trash selected", only the selection is made for you), Review each,
 * the Identical / Versions / Possible segments, set cards, "Keep all" with
 * its Undo and "Show hidden", and the Compare sheet. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";

const duplicates = vi.fn();
const possibleDuplicates = vi.fn();
const duplicateVersions = vi.fn();
const duplicatesSummary = vi.fn();
const deleteMessages = vi.fn();
const dismissDuplicates = vi.fn();
const restoreDuplicates = vi.fn();
const jobState = vi.fn();

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  api: { duplicates: () => duplicates(),
    state: () => jobState(),
    possibleDuplicates: () => possibleDuplicates(),
    duplicateVersions: () => duplicateVersions(),
    duplicatesSummary: () => duplicatesSummary(),
    dismissDuplicates: (...a: unknown[]) => dismissDuplicates(...a),
    restoreDuplicates: (...a: unknown[]) => restoreDuplicates(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a) },
}));

// The mail viewer is its own component with its own tests.
vi.mock("./components/MailList", () => ({
  MessageView: ({ mail, onBack, actions }: { mail: { uid: number };
    onBack: () => void; actions?: { trash?: (m: unknown) => void;
      pinned?: (m: unknown, p: boolean) => void } }) =>
    <div>viewing mail {mail.uid}<button onClick={onBack}>back to list</button>
      {actions?.trash && <button onClick={() => actions.trash!(mail)}>reader trash</button>}
      {actions?.pinned && <button onClick={() => actions.pinned!(mail, true)}>reader pinned</button>}
    </div>,
}));

// a whole minute, so ":SS" in a test is the same in every time zone
const BASE = 1767355380;

const mk = (uid: number, folder = "INBOX", over = {}) => ({ uid, folder,
  date: "2026-01-02 10:30", ts: BASE + uid, subject: "Invoice",
  addr: "a@x.example", size: 2048, seen: false, ai: null,
  msgid: "<inv@x.example>", pinned: false, ...over });

const dset = (key: string, mails: ReturnType<typeof mk>[], over = {}) =>
  ({ key, wasted: 2048 * (mails.length - 1), locked: null, mails, ...over });

const ident = (key = "<inv@x.example>") =>
  dset(key, [mk(3), mk(2, "Archive"), mk(1)]);
const poss = (uid: number, over = {}) => mk(uid, "INBOX", {
  subject: "Offer", addr: "b@y.example", msgid: `<o${uid}@y.example>`, ...over });
const possSet = (uids = [8, 7], over = {}) =>
  dset("p:abc", uids.map((u) => poss(u)), { wasted: 0, ...over });
const ver = (uid: number, size: number, folder = "INBOX") =>
  mk(uid, folder, { subject: "Report", addr: "c@z.example", size,
    msgid: "<rep@z.example>" });
const verSet = () => dset("<rep@z.example>",
  [ver(6, 100), ver(5, 900, "Archive")], { wasted: 0 });

const summaryOf = (over = {}) => ({ sets: 0, wasted: 0, versions: 0,
  possible: 0, dismissed: 0, ...over });

let switched = false;   // the account changed under the open page

const show = (props = {}) => render(<ToastProvider><DialogProvider>
  <DuplicatesPanel onClose={() => {}} onDeleted={() => {}}
    isStale={() => switched} {...props} />
</DialogProvider></ToastProvider>);

beforeEach(() => {
  duplicates.mockResolvedValue([]);
  possibleDuplicates.mockResolvedValue([]);
  duplicateVersions.mockResolvedValue([]);
  duplicatesSummary.mockResolvedValue(summaryOf());
  dismissDuplicates.mockResolvedValue({ ok: true });
  restoreDuplicates.mockResolvedValue({ ok: true });
  jobState.mockResolvedValue({ delete: { status: "running", error: "" } });
});

afterEach(() => {
  cleanup();
  [duplicates, possibleDuplicates, duplicateVersions, duplicatesSummary,
    deleteMessages, dismissDuplicates, restoreDuplicates, jobState]
    .forEach((f) => f.mockReset());
  switched = false;
  setLang("en");
});

const identicalWorld = () => {
  duplicates.mockResolvedValue([ident()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096 }));
};

test("no duplicates: empty state and no actions", async () => {
  show();
  await screen.findByText("No duplicates found");
  expect(screen.getByText(/no possible double-sends/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Remove .* cop/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review each" })).toBeNull();
});

test("the hero shows what can go and Remove N copies is exactly all-but-newest "
  + "through the confirm; cancel does nothing", async () => {
  identicalWorld();
  deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
  show();
  await screen.findByText("4 KB");
  expect(screen.getByText(/can go - 2 identical copies/)).toBeTruthy();
  expect(screen.getByText(/keeps the newest copy of each set/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove 2 copies" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Move to Trash");
  expect(dlg.textContent).toContain("2 selected mails");
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Remove 2 copies" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["Archive", 2], ["INBOX", 1]], "trash"));
});

test("the one-tap never takes versions or possible sets", async () => {
  identicalWorld();
  duplicateVersions.mockResolvedValue([verSet()]);
  possibleDuplicates.mockResolvedValue([possSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096,
    versions: 1, possible: 1 }));
  deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Remove 2 copies" }));
  await pressDialog(/Move to Trash \(2\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledTimes(1));
  expect(deleteMessages.mock.calls[0][0]).toEqual([["Archive", 2], ["INBOX", 1]]);
});

test("pinned or protected sets are left out of the one-tap, and said so",
  async () => {
    duplicates.mockResolvedValue([ident(),
      dset("<p@x.example>", [mk(9, "INBOX", { msgid: "<p@x.example>", pinned: true }),
        mk(8, "INBOX", { msgid: "<p@x.example>", pinned: true })], { locked: "pinned" })]);
    duplicatesSummary.mockResolvedValue(summaryOf({ sets: 2, wasted: 6144 }));
    deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
    show();
    await screen.findByRole("button", { name: "Remove 2 copies" });
    expect(screen.getByText(/1 set with protected senders or pinned mails is left alone/))
      .toBeTruthy();
    // the tag, plus a pin on each pinned copy
    expect(screen.getAllByText("pinned")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove 2 copies" }));
    await pressDialog(/Move to Trash \(2\)/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["Archive", 2], ["INBOX", 1]], "trash"));
  });

test("when every identical set is locked there is no Remove button", async () => {
  duplicates.mockResolvedValue([dset("<p@x.example>", [mk(9), mk(8)],
    { locked: "protected" })]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1 }));
  show();
  await screen.findByText("Nothing to remove in one tap");
  expect(screen.getByText("protected sender")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Review each" })).toBeTruthy();
});

test("the selection is re-read right before the confirm and names the fresh count",
  async () => {
    duplicates.mockResolvedValueOnce([ident()])
      .mockResolvedValue([dset("<inv@x.example>", [mk(3), mk(2, "Archive")])]);
    duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096 }));
    deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Remove 2 copies" }));
    const dlg = await findDialog();
    expect(dlg.textContent).toContain('"Invoice"');   // one mail: named
    expect(dlg.textContent).not.toContain("2 selected");
    await pressDialog(/Move to Trash \(1\)/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["Archive", 2]], "trash"));
  });

test("if the re-read before the confirm fails, nothing is confirmed or moved",
  async () => {
    duplicates.mockResolvedValueOnce([ident()]).mockRejectedValue(new Error("offline"));
    duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096 }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Remove 2 copies" }));
    await screen.findByText(/Error: offline/);
    await expectNoDialog();
    expect(deleteMessages).not.toHaveBeenCalled();
  });

test("a reload drops ticked mails that are no longer listed, and the confirm "
  + "names what really moves", async () => {
  duplicates.mockResolvedValueOnce([ident()]).mockResolvedValue([
    dset("<inv@x.example>", [mk(3), mk(2, "Archive")])]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096 }));
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  const ui = (key: string) => <ToastProvider><DialogProvider>
    <DuplicatesPanel onClose={() => {}} onDeleted={() => {}} reloadKey={key} />
  </DialogProvider></ToastProvider>;
  const { rerender } = render(ui("1"));
  fireEvent.click(await screen.findByRole("button", { name: "Review each" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  await screen.findByRole("button", { name: "Trash selected (2)" });
  rerender(ui("2"));
  fireEvent.click(await screen.findByRole("button", { name: "Trash selected (1)" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain('"Invoice"');
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["Archive", 2]], "trash"));
});

test("when the fresh data has nothing left to remove, no confirm opens",
  async () => {
    duplicates.mockResolvedValueOnce([ident()]).mockResolvedValue([]);
    duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096 }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Remove 2 copies" }));
    await screen.findByText(/Nothing left to remove - the list was updated/);
    await expectNoDialog();
    expect(deleteMessages).not.toHaveBeenCalled();
  });

test("a new reloadKey (scan, Undo) fetches the lists again", async () => {
  duplicates.mockResolvedValueOnce([]).mockResolvedValue([ident()]);
  duplicatesSummary.mockResolvedValueOnce(summaryOf())
    .mockResolvedValue(summaryOf({ sets: 1, wasted: 4096 }));
  const ui = (key: string) => <ToastProvider><DialogProvider>
    <DuplicatesPanel onClose={() => {}} onDeleted={() => {}} reloadKey={key} />
  </DialogProvider></ToastProvider>;
  const { rerender } = render(ui("1:0"));
  await screen.findByText("No duplicates found");
  rerender(ui("2:0"));
  await screen.findByRole("button", { name: "Remove 2 copies" });
});

test("Show hidden also dismisses the lingering Hidden toast", async () => {
  duplicates.mockResolvedValue([ident(), dset("<o@x.example>",
    [mk(20, "INBOX", { subject: "Other" }), mk(21, "Archive", { subject: "Other" })])]);
  duplicatesSummary.mockResolvedValueOnce(summaryOf({ sets: 2, wasted: 8192 }))
    .mockResolvedValue(summaryOf({ sets: 2, wasted: 8192, dismissed: 1 }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Keep all: Other" }));
  await screen.findByText(/Hidden - you keep every copy/);
  fireEvent.click(await screen.findByRole("button", { name: "Show hidden (1)" }));
  await waitFor(() => expect(screen.queryByText(/Hidden - you keep every copy/))
    .toBeNull());
});

test("a refused move (a pinned copy slipped in) shows the error and keeps the "
  + "page", async () => {
  identicalWorld();
  deleteMessages.mockRejectedValue(new Error("contains pinned mails"));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Remove 2 copies" }));
  await pressDialog(/Move to Trash \(2\)/);
  await screen.findByText(/contains pinned mails/);
  expect(screen.getByRole("button", { name: "Remove 2 copies" })
    .hasAttribute("disabled")).toBe(false);
});

test("cards mark keep · newest and remove per copy, never for versions or "
  + "possible", async () => {
  identicalWorld();
  duplicateVersions.mockResolvedValue([verSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096,
    versions: 1 }));
  show();
  await screen.findByText("keep · newest");
  expect(screen.getAllByText("remove")).toHaveLength(2);
  expect(screen.getByText(/×3/)).toBeTruthy();
  expect(screen.getByText("4 KB to free")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /Versions/ }));
  await screen.findByText(/Compare them; nothing is preselected/);
  expect(screen.queryByText("keep · newest")).toBeNull();
  expect(screen.queryByText("remove")).toBeNull();
  expect(screen.getByText("largest")).toBeTruthy();
});

test("segments carry the summary's counts, start on the first non-empty one "
  + "and disable empty ones", async () => {
  possibleDuplicates.mockResolvedValue([possSet()]);
  duplicateVersions.mockResolvedValue([verSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ versions: 12, possible: 5 }));
  show();
  await screen.findByText(/Compare them; nothing is preselected/);   // versions
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((x) => x.textContent)).toEqual(
    ["Identical 0", "Versions 12", "Possible 5"]);
  expect(tabs[0].hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Review each" })).not.toBeNull();
  fireEvent.click(tabs[2]);
  await screen.findByText(/4 mails within|2 mails within/);
  expect(screen.queryByText("Report")).toBeNull();
});

test("without the summary the segments count the listed sets", async () => {
  identicalWorld();
  duplicatesSummary.mockRejectedValue(new Error("boom"));
  show();
  await screen.findByText("keep · newest");
  expect(screen.getAllByRole("tab").map((x) => x.textContent))
    .toEqual(["Identical 1", "Versions 0", "Possible 0"]);
});

test("a capped list says so", async () => {
  identicalWorld();
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 250, wasted: 4096 }));
  show();
  await screen.findByText(/Showing the biggest 1 sets/);
});

test("Review each is the manual selection mode: select all but newest, tick "
  + "rows, Trash selected", async () => {
  identicalWorld();
  duplicateVersions.mockResolvedValue([verSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096,
    versions: 1 }));
  deleteMessages.mockResolvedValue({ ok: true, queued: 3 });
  show();
  await screen.findByText("keep · newest");
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review each" }));
  expect(screen.getAllByRole("checkbox", { name: /Invoice/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  expect(screen.getByRole("button", { name: "Trash selected (2)" })).toBeTruthy();
  // ticks of another tab never come along: the Versions tab starts clean
  fireEvent.click(screen.getByRole("tab", { name: /Versions/ }));
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Select all but newest" })).toBeNull();
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Report/ })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain('"Report"');
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 6]], "trash"));
});

test("ticks and Keep newest on the Identical tab are not acted on from "
  + "another tab", async () => {
  identicalWorld();
  duplicateVersions.mockResolvedValue([verSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096,
    versions: 1 }));
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  show();
  await screen.findByText("keep · newest");
  fireEvent.click(screen.getByRole("button", { name: "Review each" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("tab", { name: /Versions/ }));
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Report/ })[1]);
  // the two identical copies ticked before are not part of it
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["Archive", 5]], "trash"));
});

test("Done leaves review mode and clears the selection", async () => {
  identicalWorld();
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Review each" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review each" }));
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
});

test("only possible sets: no hero, but Review each still lets you tick rows",
  async () => {
    possibleDuplicates.mockResolvedValue([possSet()]);
    duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
    deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
    show();
    await screen.findByText(/different Message-IDs/);
    expect(screen.queryByText("No duplicates found")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review each" }));
    expect(screen.queryByRole("button", { name: "Select all but newest" }))
      .toBeNull();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Offer/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
    await pressDialog(/Move to Trash \(1\)/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 8]], "trash"));
  });

test("a queued deletion keeps candidates visible and reconciles a failed job",
  async () => {
    identicalWorld();
    deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
    jobState.mockResolvedValue({ delete: { status: "error", error: "move refused" } });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Review each" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
    fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
    await pressDialog(/Move to Trash \(2\)/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalled());
    expect(screen.getAllByRole("checkbox", { name: /Invoice/ })).toHaveLength(3);
    await waitFor(() => expect(screen.getByText(/move refused/)).toBeTruthy(),
      { timeout: 2500 });
    expect(screen.getAllByRole("checkbox", { name: /Invoice/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Select all but newest" })
      .hasAttribute("disabled")).toBe(false);
  });

test("after a one-tap run every list and the counts refresh, even if versions "
  + "fails", async () => {
  // load, the re-read before the confirm, then the list after the run
  duplicates.mockResolvedValueOnce([ident()]).mockResolvedValueOnce([ident()])
    .mockResolvedValue([]);
  duplicatesSummary.mockResolvedValueOnce(summaryOf({ sets: 1, wasted: 4096 }))
    .mockResolvedValueOnce(summaryOf({ sets: 1, wasted: 4096 }))
    .mockResolvedValue(summaryOf());
  duplicateVersions.mockRejectedValue(new Error("boom"));
  deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
  jobState.mockResolvedValue({ delete: { status: "done", error: "" } });
  const onDeleted = vi.fn();
  show({ onDeleted });
  fireEvent.click(await screen.findByRole("button", { name: "Remove 2 copies" }));
  await pressDialog(/Move to Trash \(2\)/);
  await screen.findByText("No duplicates found", {}, { timeout: 2500 });
  expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  expect(onDeleted).toHaveBeenCalled();
});

test("a failing versions fetch keeps the identical list", async () => {
  identicalWorld();
  duplicateVersions.mockRejectedValue(new Error("boom"));
  show();
  await screen.findByText("keep · newest");
  expect(screen.getAllByText("Archive")).toHaveLength(1);
});

test("opening a copy shows the mail and back returns to the list", async () => {
  identicalWorld();
  show();
  fireEvent.click((await screen.findAllByRole("button", { name: /INBOX/ }))[0]);
  await screen.findByText("viewing mail 3");
  fireEvent.click(screen.getByText("back to list"));
  await screen.findByText("keep · newest");
});

test("the reader's Trash confirms, moves just that copy and returns to the list",
  async () => {
  identicalWorld();
  deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
  show();
  fireEvent.click((await screen.findAllByRole("button", { name: /INBOX/ }))[0]);
  await screen.findByText("viewing mail 3");
  fireEvent.click(screen.getByText("reader trash"));
  expect((await findDialog()).textContent).toContain('"Invoice"');   // the mail is named
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("reader trash"));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 3]], "trash"));
  expect(screen.queryByText("viewing mail 3")).toBeNull();
});

test("a pin made in the reader refreshes the lists (a pinned copy is locked)",
  async () => {
  identicalWorld();
  show();
  fireEvent.click((await screen.findAllByRole("button", { name: /INBOX/ }))[0]);
  await screen.findByText("viewing mail 3");
  duplicates.mockClear();
  fireEvent.click(screen.getByText("reader pinned"));
  await waitFor(() => expect(duplicates).toHaveBeenCalled());
});

test("the header says how old the scan is", async () => {
  identicalWorld();
  show({ scannedTs: Date.now() / 1000 - 600 });
  await screen.findByText(/The same mail more than once · from the scan 10m ago/);
});

// ------------------------------------------------------- Keep all / hidden

test("Keep all hides the set, reloads and offers Undo", async () => {
  possibleDuplicates.mockResolvedValueOnce([possSet()]).mockResolvedValue([]);
  duplicatesSummary.mockResolvedValueOnce(summaryOf({ possible: 1 }))
    .mockResolvedValue(summaryOf({ dismissed: 1 }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Keep all: Offer" }));
  await waitFor(() => expect(dismissDuplicates)
    .toHaveBeenCalledWith("possible", "p:abc"));
  await screen.findByText("Nothing left to review");
  expect(screen.getByText("You chose to keep 1 set as it is.")).toBeTruthy();
  expect(deleteMessages).not.toHaveBeenCalled();
  possibleDuplicates.mockResolvedValue([possSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(restoreDuplicates)
    .toHaveBeenCalledWith({ kind: "possible", key: "p:abc" }));
  await screen.findByRole("button", { name: "Keep all: Offer" });
});

test("Show hidden (N) brings every hidden set back", async () => {
  identicalWorld();
  duplicatesSummary.mockResolvedValueOnce(summaryOf({ sets: 1, wasted: 4096,
    dismissed: 3 })).mockResolvedValue(summaryOf({ sets: 1, wasted: 4096 }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Show hidden (3)" }));
  await waitFor(() => expect(restoreDuplicates).toHaveBeenCalledWith(undefined));
  await waitFor(() => expect(screen.queryByRole("button",
    { name: /Show hidden/ })).toBeNull());
});

test("Keep all drops that set's ticks from the selection", async () => {
  identicalWorld();
  duplicates.mockResolvedValueOnce([ident(), dset("<o@x.example>",
    [mk(20, "INBOX", { subject: "Other" }), mk(21, "Archive", { subject: "Other" })])])
    .mockResolvedValue([ident()]);
  deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Review each" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all but newest" }));
  expect(screen.getByRole("button", { name: "Trash selected (3)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep all: Other" }));
  await screen.findByRole("button", { name: "Trash selected (2)" });
});

test("a failed Keep all shows the error and leaves the list alone", async () => {
  possibleDuplicates.mockResolvedValue([possSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
  dismissDuplicates.mockRejectedValue(new Error("nope"));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Keep all: Offer" }));
  await screen.findByText(/nope/);
  expect(screen.getByRole("button", { name: "Keep all: Offer" })).toBeTruthy();
});

// ------------------------------------------------------------- Compare

const openCompare = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Compare: Offer" }));
  return screen.findByRole("dialog", { name: "Compare" });
};

test("Compare shows two mails side by side and marks what differs",
  async () => {
    possibleDuplicates.mockResolvedValue([dset("p:abc", [
      poss(8, { ts: BASE + 52, size: 76800, seen: false, date: "2026-01-02 12:43" }),
      poss(7, { ts: BASE + 10, size: 76800, seen: true, date: "2026-01-02 12:43" })],
      { wasted: 0 })]);
    duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
    show();
    const dlg = await openCompare();
    const cmp = within(dlg);
    expect(cmp.getByText("Mail A")).toBeTruthy();
    expect(cmp.getByText("Mail B")).toBeTruthy();
    expect(cmp.getByText("keep")).toBeTruthy();
    // the stored date has no seconds: the time comes from the timestamp
    expect(cmp.getByText(/\d\d:\d\d:52$/)).toBeTruthy();
    expect(cmp.getByText(/\d\d:\d\d:10$/)).toBeTruthy();
    // received, read and Message-ID differ on both sides; size and folder do not
    expect(cmp.getAllByText("(differs)")).toHaveLength(6);
    expect(cmp.getByText(/Same size, 42 s apart - most likely sent twice/))
      .toBeTruthy();
    expect(cmp.queryByRole("tablist", { name: "Mails to compare" })).toBeNull();
  });

test("two mails of the same minute are told apart by the seconds, and equal "
  + "times are not marked", async () => {
  possibleDuplicates.mockResolvedValue([dset("p:abc", [
    poss(8, { ts: BASE + 30, date: "2026-01-02 12:43" }),
    poss(7, { ts: BASE + 30, date: "2026-01-02 12:43" })], { wasted: 0 })]);
  duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
  show();
  const cmp = within(await openCompare());
  expect(cmp.getAllByText(/\d\d:\d\d:30$/)).toHaveLength(2);
  // only the two Message-IDs differ
  expect(cmp.getAllByText("(differs)")).toHaveLength(2);
});

test("different sizes: the note says so and equal-looking sizes show bytes",
  async () => {
    possibleDuplicates.mockResolvedValue([dset("p:abc", [
      poss(8, { ts: BASE + 1, size: 75800 }), poss(7, { ts: BASE, size: 75900 })],
      { wasted: 0 })]);
    duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
    show();
    const cmp = within(await openCompare());
    expect(cmp.getByText(/Different sizes, 1 s apart/)).toBeTruthy();
    expect(cmp.getByText("75,800 B")).toBeTruthy();
    expect(cmp.getByText("75,900 B")).toBeTruthy();
  });

test("the pair switcher walks a bigger set", async () => {
  possibleDuplicates.mockResolvedValue([dset("p:abc", [
    poss(9, { ts: BASE + 300, folder: "Inbox" }), poss(8, { ts: BASE + 200, folder: "Orders" }),
    poss(7, { ts: BASE + 100, folder: "Archive" })], { wasted: 0 })]);
  duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
  show();
  const cmp = within(await openCompare());
  const pairs = cmp.getByRole("tablist", { name: "Mails to compare" });
  expect(within(pairs).getAllByRole("tab").map((x) => x.textContent))
    .toEqual(["A↔B", "B↔C"]);
  expect(cmp.getByText("Inbox")).toBeTruthy();
  fireEvent.click(within(pairs).getByRole("tab", { name: "B↔C" }));
  expect(cmp.queryByText("Inbox")).toBeNull();
  expect(cmp.getByText("Archive")).toBeTruthy();
  expect(cmp.getByText("Mail C")).toBeTruthy();
});

test("Keep the newest moves the older copies through the normal confirm",
  async () => {
    possibleDuplicates.mockResolvedValue([possSet([9, 8, 7])]);
    duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
    deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
    show();
    const cmp = within(await openCompare());
    fireEvent.click(cmp.getByRole("button", { name: "Keep the newest, move 2 to Trash" }));
    const dlg = (await findDialog());
    expect(dlg.textContent).toContain("2 selected mails");
    await pressDialog(/Move to Trash \(2\)/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 8], ["INBOX", 7]], "trash"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Compare" }))
      .toBeNull());
  });

test("cancelling the confirm leaves Compare open and moves nothing", async () => {
  possibleDuplicates.mockResolvedValue([possSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
  show();
  const cmp = within(await openCompare());
  fireEvent.click(cmp.getByRole("button", { name: /Keep the newest/ }));
  await cancelDialog();
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Compare" })).toBeTruthy();
});

test("\"They are different\" keeps the set (dismiss) and closes Compare",
  async () => {
    possibleDuplicates.mockResolvedValueOnce([possSet()]).mockResolvedValue([]);
    duplicatesSummary.mockResolvedValueOnce(summaryOf({ possible: 1 }))
      .mockResolvedValue(summaryOf({ dismissed: 1 }));
    show();
    const cmp = within(await openCompare());
    expect(cmp.getByText(/“Keep all” hides this set from the list/)).toBeTruthy();
    fireEvent.click(cmp.getByRole("button", { name: "They are different - keep all" }));
    await waitFor(() => expect(dismissDuplicates)
      .toHaveBeenCalledWith("possible", "p:abc"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Compare" }))
      .toBeNull());
    expect(deleteMessages).not.toHaveBeenCalled();
  });

test("Compare's Open shows the mail; a locked set cannot be trashed from it",
  async () => {
    possibleDuplicates.mockResolvedValue([possSet([8, 7],
      { locked: "protected" })]);
    duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
    show();
    const cmp = within(await openCompare());
    expect(cmp.getByText(/The sender is protected/)).toBeTruthy();
    expect(cmp.getByRole("button", { name: /Keep the newest/ })
      .hasAttribute("disabled")).toBe(true);
    fireEvent.click(cmp.getByRole("button", { name: "Open mail B" }));
    await screen.findByText("viewing mail 7");
    expect(screen.queryByRole("dialog", { name: "Compare" })).toBeNull();
  });

test("versions sets compare too", async () => {
  duplicateVersions.mockResolvedValue([verSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ versions: 1 }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Compare: Report" }));
  const cmp = within(await screen.findByRole("dialog", { name: "Compare" }));
  expect(cmp.getByText("Differences are highlighted.")).toBeTruthy();
  expect(cmp.getByText("Archive")).toBeTruthy();
});

test("German wording", async () => {
  setLang("de");
  identicalWorld();
  possibleDuplicates.mockResolvedValue([possSet()]);
  duplicatesSummary.mockResolvedValue(summaryOf({ sets: 1, wasted: 4096,
    possible: 1 }));
  show();
  await screen.findByRole("button", { name: "2 Kopien entfernen" });
  expect(screen.getByRole("button", { name: "Einzeln prüfen" })).toBeTruthy();
  expect(screen.getAllByRole("tab").map((x) => x.textContent))
    .toEqual(["Identisch 1", "Versionen 0", "Mögliche 1"]);
  expect(screen.getByText("behalten · neueste")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /Mögliche/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Vergleichen: Offer" }));
  const cmp = within(await screen.findByRole("dialog", { name: "Vergleichen" }));
  expect(cmp.getByText("Neueste behalten, 1 in den Papierkorb")).toBeTruthy();
  expect(cmp.getByText("Die Mails sind verschieden - alle behalten")).toBeTruthy();
});

test("Keep the newest on a two-copy set names the one mail it moves",
  async () => {
    possibleDuplicates.mockResolvedValue([possSet([8, 7])]);
    duplicatesSummary.mockResolvedValue(summaryOf({ possible: 1 }));
    deleteMessages.mockResolvedValue({ ok: true, queued: 1 });
    show();
    const cmp = within(await openCompare());
    fireEvent.click(cmp.getByRole("button", { name: "Keep the newest, move 1 to Trash" }));
    expect((await findDialog()).textContent).toContain('"Offer"');
    await pressDialog(/Move to Trash \(1\)/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 7]], "trash"));
  });

test("Remove N copies: an account switch during the re-read moves nothing",
  async () => {
    identicalWorld();
    show();
    const btn = await screen.findByRole("button", { name: "Remove 2 copies" });
    let release!: (v: unknown) => void;
    duplicates.mockReturnValueOnce(new Promise((r) => { release = r; }));
    fireEvent.click(btn);
    switched = true;
    release([ident()]);
    await expectNoDialog();
    expect(deleteMessages).not.toHaveBeenCalled();
  });

test("Remove N copies: an account switch while the confirm is open moves "
  + "nothing", async () => {
  identicalWorld();
  deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Remove 2 copies" }));
  await findDialog();
  switched = true;
  await pressDialog(/Move to Trash \(2\)/);
  await new Promise((r) => setTimeout(r, 50));
  expect(deleteMessages).not.toHaveBeenCalled();
});

test("a double click on Remove N copies opens one confirm, not two",
  async () => {
    identicalWorld();
    deleteMessages.mockResolvedValue({ ok: true, queued: 2 });
    show();
    const btn = await screen.findByRole("button", { name: "Remove 2 copies" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await findDialog();
    await pressDialog(/Move to Trash \(2\)/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledTimes(1));
    // the second click queued nothing behind the first confirm
    await expectNoDialog();
  });
