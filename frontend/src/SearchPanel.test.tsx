// @vitest-environment jsdom
/* Search panel: the mail-text toggle only exists for body_search=server,
 * the query asks for scope=body only when ticked, and the server's notes
 * (partial / charset / stale folder) are rendered. */

import { act, cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { SearchPanel } from "./components/SearchPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import { setLang } from "./i18n";
import type { Group, SearchResp } from "./types";

const search = vi.fn();
const deleteMessages = vi.fn();
const threadOf = vi.fn();
let threaded: { count: number } | null = null;     // the opened mail's thread

vi.mock("./api", () => ({
  api: { search: (...a: unknown[]) => search(...a),
    message: () => Promise.resolve({ from: "x", to: "", date: "d",
      subject: "s", text: "body text", thread: threaded }),
    thread: (...a: unknown[]) => threadOf(...a),
    messages: (items: [string, number][]) => Promise.resolve({
      messages: items.map(([folder, uid]) => ({ folder, uid, from: "x",
        to: "", date: "d", subject: "s", text: `text ${uid}` })) }),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a) },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  search.mockReset();
  deleteMessages.mockReset();
  threadOf.mockReset();
  threaded = null;
  setLang("en");
});

const resp = (notes: SearchResp["notes"] = []): SearchResp =>
  ({ mails: [], notes });

/** Rows highlight the match, splitting the subject into text + <mark>. */
const subject = (text: string) => screen.queryAllByText((_c, el) =>
  el?.tagName === "SPAN" && el.textContent === text
  && el.classList.contains("truncate"));

const field = () => screen.getByRole("searchbox");
/** Types and presses Enter (the explicit run). */
const type = (value: string) => {
  fireEvent.change(field(), { target: { value } });
  fireEvent.keyDown(field(), { key: "Enter" });
};

const mail = (uid: number, over: Record<string, unknown> = {}) => ({ uid,
  folder: "INBOX", date: "2026-01-02", ts: 1, subject: `Parcel ${uid}`,
  addr: "shop@x.example", size: 10, seen: true, ai: null, ...over });

const group = (key: string, label: string, count = 3,
  over: Partial<Group> = {}): Group => ({ key, label, sub: "", count,
  size: 2048, unread: 0, first: "", last: "2026-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 0, ...over });

const withDialogs = (ui: ReactElement) =>
  render(<DialogProvider>{ui}</DialogProvider>);

test("mail-text scope is disabled with a reason when body search is off",
  () => {
    render(<SearchPanel bodySearch={false} onClose={() => {}}
      onDeleted={() => {}} />);
    const seg = screen.getByRole("radio", { name: "Also mail text" });
    expect((seg as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/switched off for this account/)).toBeTruthy();
  });

test("results appear while typing after a pause, metadata only; "
  + "one character does nothing", async () => {
  vi.useFakeTimers();
  search.mockResolvedValue({ mails: [mail(1)], notes: [] });
  render(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  fireEvent.change(field(), { target: { value: "p" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(search).not.toHaveBeenCalled();
  fireEvent.change(field(), { target: { value: "pa" } });
  fireEvent.change(field(), { target: { value: "parcel" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith("parcel", false);
  vi.useRealTimers();
  await screen.findByText("1 matches");
});

test("a stale response never replaces a newer one", async () => {
  let first!: (r: unknown) => void;
  search.mockImplementationOnce(() => new Promise((r) => { first = r; }))
    .mockResolvedValueOnce({ mails: [mail(2, { subject: "Second" })],
      notes: [] });
  render(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  type("first");
  type("second");
  await waitFor(() => expect(subject("Second").length).toBe(1));
  await act(async () => {
    first({ mails: [mail(1, { subject: "Stale" })], notes: [] });
  });
  expect(subject("Stale")).toHaveLength(0);
  expect(subject("Second")).toHaveLength(1);
});

test("mail-text scope only runs on pick / Enter and asks for scope=body",
  async () => {
    search.mockResolvedValue(resp());
    render(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
    fireEvent.change(field(), { target: { value: "parcel" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("parcel", false));
    fireEvent.click(screen.getByRole("radio", { name: "Also mail text" }));
    await waitFor(() => expect(search).toHaveBeenLastCalledWith("parcel", true));
    expect(screen.getByText(/asks your mail server/)).toBeTruthy();
    search.mockClear();
    fireEvent.change(field(), { target: { value: "parcel two" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(search)
      .toHaveBeenCalledWith("parcel two", true));
  });

test("server notes are rendered with their parameters", async () => {
  search.mockResolvedValue(resp([
    { key: "partial", params: {} },
    { key: "stale_folder", params: { folder: "Archive" } },
    { key: "charset_fallback", params: {} },
  ]));
  render(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  fireEvent.change(field(), { target: { value: "parcel" } });
  await waitFor(() => expect(screen.getByText(
    /Not every folder was searched in time/)).toBeTruthy());
  expect(screen.getByText(/"Archive" changed since the last scan/))
    .toBeTruthy();
  expect(screen.getByText(/does not support UTF-8 search/)).toBeTruthy();
});

test("local mode explains whole words and shows index notes", async () => {
  search.mockResolvedValue(resp([{ key: "index_behind", params: { n: 3 } }]));
  render(<SearchPanel bodySearch bodyMode="local" onClose={() => {}}
    onDeleted={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "Also mail text" }));
  expect(screen.getByText(/local word index: whole words only/)).toBeTruthy();
  expect(screen.queryByText(/asks your mail server/)).toBeNull();
  type("parcel");
  await waitFor(() => expect(search).toHaveBeenCalledWith("parcel", true));
  await screen.findByText(/3 newer mails are not in the index yet/);
});

test("no hits offers 'Search mail text too', which re-runs on the body",
  async () => {
    search.mockResolvedValue(resp());
    withDialogs(<SearchPanel bodySearch onClose={() => {}}
      onDeleted={() => {}} />);
    type("parcel");
    await screen.findByText("No matches");
    fireEvent.click(screen.getByRole("button",
      { name: "Search mail text too" }));
    await waitFor(() => expect(search).toHaveBeenLastCalledWith("parcel", true));
  });

test("matching senders are listed first and open the sender view; "
  + "the match is highlighted", async () => {
  search.mockResolvedValue({ mails: [mail(1)], notes: [] });
  const onOpenSender = vi.fn();
  const g = group("shop@x.example", "Parcel Shop", 18);
  withDialogs(<SearchPanel groups={{ [g.key]: g,
    "other@y.example": group("other@y.example", "Other") }}
    onOpenSender={onOpenSender} onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await screen.findByText("Senders · 1");
  const btn = screen.getByRole("button", { name: /Shop/ });
  expect(btn.textContent).toContain("18\u00a0mails");
  expect(screen.queryByText("Other")).toBeNull();
  expect(document.querySelectorAll("mark").length).toBeGreaterThan(1);
  fireEvent.click(btn);
  expect(onOpenSender).toHaveBeenCalledWith(g);
});

test("time and folder chips filter the results client-side", async () => {
  search.mockResolvedValue({ notes: [], mails: [
    mail(1, { subject: "Inbox one" }),
    mail(2, { subject: "Archive one", folder: "Archive" })] });
  withDialogs(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  type("one");
  await waitFor(() => expect(subject("Inbox one").length).toBe(1));
  fireEvent.change(screen.getByLabelText("Folder"),
    { target: { value: "Archive" } });
  expect(subject("Inbox one")).toHaveLength(0);
  expect(subject("Archive one")).toHaveLength(1);
  expect(search).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "30d" } });
  await screen.findByText("No matches");   // ts 1 is long ago
});

test("empty state: recent searches (device only, clearable) and Try presets "
  + "with live counts; zero-count presets are hidden", async () => {
  localStorage.setItem("pmc_recent_searches", JSON.stringify(["invoice"]));
  const onOpenFiltered = vi.fn();
  const groups = { a: group("a@x.example", "A", 5, { replied: true }),
    b: group("b@x.example", "B", 7, { replied: true }) };
  render(<SearchPanel groups={groups} onOpenFiltered={onOpenFiltered}
    onClose={() => {}} onDeleted={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "invoice" }));
  expect((field() as HTMLInputElement).value).toBe("invoice");
  cleanup();
  render(<SearchPanel groups={groups} onOpenFiltered={onOpenFiltered}
    onClose={() => {}} onDeleted={() => {}} />);
  expect(screen.getByText("2 senders")).toBeTruthy();
  expect(screen.queryByText("Mails with big attachments")).toBeNull();
  fireEvent.click(screen.getByRole("button",
    { name: /From people you replied to/ }));
  expect(onOpenFiltered).toHaveBeenCalledWith("is:replied");
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByText("Recent")).toBeNull();
  expect(localStorage.getItem("pmc_recent_searches")).toBe("[]");
});

test("only committed searches are remembered: Enter with hits, newest "
  + "first, no duplicates; never prefixes, empty or failed searches",
async () => {
  search.mockResolvedValue({ mails: [mail(1)], notes: [] });
  render(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  const stored = () => JSON.parse(
    localStorage.getItem("pmc_recent_searches") ?? "[]");
  // typed, results shown, but not committed yet (no Enter, no pause)
  fireEvent.change(field(), { target: { value: "alp" } });
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  expect(stored()).toEqual([]);
  type("alpha");
  await waitFor(() => expect(stored()).toEqual(["alpha"]));
  type("beta");
  await waitFor(() => expect(stored()).toEqual(["beta", "alpha"]));
  type("ALPHA");
  await waitFor(() => expect(stored()).toEqual(["ALPHA", "beta"]));
  search.mockResolvedValue(resp());
  type("nothing here");
  await screen.findByText("No matches");
  search.mockRejectedValue(new Error("boom"));
  type("failing");
  await screen.findByText(/boom/);
  expect(stored()).toEqual(["ALPHA", "beta"]);
});

test("a query left standing for ~2 s with hits is remembered", async () => {
  vi.useFakeTimers();
  search.mockResolvedValue({ mails: [mail(1)], notes: [] });
  render(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  fireEvent.change(field(), { target: { value: "parcel" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(localStorage.getItem("pmc_recent_searches")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(JSON.parse(localStorage.getItem("pmc_recent_searches")!))
    .toEqual(["parcel"]);
});

test("selection and Trash selected only ever cover the visible mails",
async () => {
  search.mockResolvedValue({ notes: [], mails: [
    mail(1), mail(2), mail(3, { folder: "Archive" })] });
  withDialogs(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(subject("Parcel 1")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Select all 3" }));
  expect(screen.getByRole("button", { name: "Trash selected (3)" }))
    .toBeTruthy();
  fireEvent.change(screen.getByLabelText("Folder"),
    { target: { value: "Archive" } });
  expect(screen.getByRole("button", { name: "Trash selected (1)" }))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["Archive", 3]]));
  // widening the filter again does not bring the hidden picks back
  fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "" } });
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
});

test("results are MailRows; Select all N feeds the selection, the danger "
  + "button needs a selection, and a cancelled confirm trashes nothing",
async () => {
  search.mockResolvedValue({ mails: [mail(1), mail(2)], notes: [] });
  const onDeleted = vi.fn();
  withDialogs(<SearchPanel onClose={() => {}} onDeleted={onDeleted} />);
  type("parcel");
  await waitFor(() => expect(subject("Parcel 1").length).toBe(1));
  expect(screen.getByText("2 matches")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trash selected/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select all 2" }));
  const trash = screen.getByRole("button", { name: "Trash selected (2)" });
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  expect(screen.getByRole("button", { name: "Trash selected (1)" }))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  expect(trash).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 2]]));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
});

test("the reader's Trash: the panel's confirm and call for the one mail, then "
  + "the mail leaves the results; previous / next walk the results", async () => {
  search.mockResolvedValue({ mails: [mail(1), mail(2)], notes: [] });
  deleteMessages.mockResolvedValue({ ok: true });
  withDialogs(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(subject("Parcel 1")).toHaveLength(1));
  fireEvent.click(subject("Parcel 1")[0]);
  await screen.findByText("body text");
  fireEvent.click(screen.getByRole("button", { name: "Next mail" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Next mail" }) as
    HTMLButtonElement).disabled).toBe(true));

  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  expect((await findDialog()).textContent).toContain('"Parcel 2"');   // named, not "1 selected"
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith([["INBOX", 2]]));
  await waitFor(() => expect(screen.queryByText("body text")).toBeNull());
  expect(subject("Parcel 1")).toHaveLength(1);
  expect(subject("Parcel 2")).toHaveLength(0);
});

test("the reader's Trash drops only that mail from the selection", async () => {
  search.mockResolvedValue({ mails: [mail(1), mail(2), mail(3)], notes: [] });
  deleteMessages.mockResolvedValue({ ok: true });
  withDialogs(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(subject("Parcel 3")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Select all 3" }));
  fireEvent.click(subject("Parcel 3")[0]);
  await screen.findByText("body text");
  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(screen.queryByText("body text")).toBeNull());
  expect(screen.getByRole("button", { name: "Trash selected (2)" })).toBeTruthy();
});

test("Trash selected with one pick names that mail's subject", async () => {
  search.mockResolvedValue({ notes: [], mails: [mail(1), mail(2)] });
  withDialogs(<SearchPanel onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(subject("Parcel 1")).toHaveLength(1));
  fireEvent.click(screen.getByLabelText("Select Parcel 2"));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  expect((await findDialog()).textContent).toContain('"Parcel 2"');
  await cancelDialog();
});

test("the reader's Trash on a conversation card outside the results trashes "
  + "that mail (not an empty list)", async () => {
  search.mockResolvedValue({ mails: [mail(1)], notes: [] });
  deleteMessages.mockResolvedValue({ ok: true });
  threaded = { count: 2 };
  threadOf.mockResolvedValue({ key: "k", label: "Plan", notes: [],
    mails: [mail(1), mail(9, { subject: "Elsewhere" })] });
  withDialogs(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(subject("Parcel 1")).toHaveLength(1));
  fireEvent.click(subject("Parcel 1")[0]);
  await screen.findByText("body text");
  fireEvent.click(screen.getByRole("button", { name: "Read conversation" }));
  await screen.findByText("2 mails");
  const cards = document.querySelectorAll(
    "[aria-expanded]:not([aria-haspopup])");
  fireEvent.click(cards[1]);                 // the card outside the results
  fireEvent.click(cards[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Trash this mail" }));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages)
    .toHaveBeenCalledWith([["INBOX", 9]]));
  await waitFor(() => expect(screen.queryByText("text 9")).toBeNull());
  expect(subject("Parcel 1")).toHaveLength(1);   // the results are untouched
});

test("a search that finished while the trash confirm was open is not "
  + "overwritten by the old results", async () => {
  search.mockResolvedValue({ mails: [mail(1), mail(2)], notes: [] });
  deleteMessages.mockResolvedValue({ ok: true });
  withDialogs(<SearchPanel bodySearch onClose={() => {}} onDeleted={() => {}} />);
  type("parcel");
  await waitFor(() => expect(subject("Parcel 1")).toHaveLength(1));
  fireEvent.click(screen.getByLabelText("Select Parcel 1"));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (1)" }));
  await findDialog();
  // a newer search lands behind the confirm
  search.mockResolvedValue({ mails: [mail(5, { subject: "Newer 5" })], notes: [] });
  type("newer");
  await waitFor(() => expect(subject("Newer 5")).toHaveLength(1));
  await pressDialog(/Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalled());
  expect(subject("Newer 5")).toHaveLength(1);
  expect(subject("Parcel 2")).toHaveLength(0);
});
