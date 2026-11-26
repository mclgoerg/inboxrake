// @vitest-environment jsdom
/* Search: This account | All accounts. "This account" is Search as it always
 * was (nothing new on the page but the choice); "All accounts" lists the hits
 * of every account with an account chip, opening a hit switches to its account
 * (the panel keeps its results), a selection's Trash is one confirm and one step
 * per account. Nothing here selects an account but opening a hit / a sender. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactElement } from "react";

const search = vi.fn();
const accountsSearch = vi.fn();
const deleteMessages = vi.fn();
const keepCheck = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: { search: (...a: unknown[]) => search(...a),
    accountsSearch: (...a: unknown[]) => accountsSearch(...a),
    message: () => Promise.resolve({ from: "x", to: "", date: "d",
      subject: "s", text: "body text", thread: null }),
    thread: () => new Promise(() => {}),
    messages: () => Promise.resolve({ messages: [] }),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    keepSafeCheck: (...a: unknown[]) => keepCheck(...a),
    keepSafePin: () => Promise.resolve({ pinned: 0, items: [] }) },
}));

import { SearchPanel } from "./components/SearchPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { AcrossSearchResp, Group, Mail } from "./types";

const mail = (uid: number, account: string | undefined, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2026-01-02", ts: 10 - uid, subject: `Invoice ${uid}`,
  addr: "billing@cloudbox.example", size: 10, seen: true, ai: null,
  ...(account ? { account, pinned: false, protected: false } : {}), ...over });
const hits = (over: Partial<AcrossSearchResp> = {}): AcrossSearchResp => ({
  mails: [mail(1, "proton"), mail(2, "work"), mail(3, "work", { pinned: true })],
  notes: [],
  senders: [
    { account: "proton", key: "billing@cloudbox.example", label: "CloudBox", count: 30, size: 2048 },
    { account: "work", key: "billing@hosting.example", label: "Hosting Co", count: 12, size: 1024 }],
  ...over });
const group = (key: string, label: string): Group => ({ key, label, sub: "", count: 3,
  size: 2048, unread: 0, first: "", last: "2026-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 0 });

const across = (over: Record<string, unknown> = {}) => ({
  account: "proton", names: ["proton", "work", "old"], exists: () => true,
  onSwitchAccount: vi.fn(), onOpenSender: vi.fn(), onFollow: vi.fn(),
  onClaim: vi.fn(), ...over });
const mount = (a: ReturnType<typeof across> | undefined, props: Record<string, unknown> = {}) => {
  const ui = (acc: typeof a, extra: Record<string, unknown> = {}): ReactElement => (
    <ToastProvider><DialogProvider>
      <SearchPanel across={acc} bodySearch onClose={() => {}} onDeleted={() => {}}
        groups={{ "billing@cloudbox.example": group("billing@cloudbox.example", "CloudBox") }}
        {...props} {...extra} />
    </DialogProvider></ToastProvider>);
  const r = render(ui(a));
  return { ...r, again: (acc: typeof a) => r.rerender(ui(acc)) };
};

beforeEach(() => {
  setLang("en");
  search.mockResolvedValue({ mails: [mail(1, undefined)], notes: [] });
  accountsSearch.mockResolvedValue(hits());
  deleteMessages.mockImplementation((...a: unknown[]) => Promise.resolve(
    { ok: true, queued: (a[0] as unknown[]).length, job: `j-${a[4]}` }));
  keepCheck.mockResolvedValue({ total: 1, kept: 0, classes: [] });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  for (const f of [search, accountsSearch, deleteMessages, keepCheck]) f.mockReset();
  setLang("en");
});

const field = () => screen.getByRole("searchbox");
const type = (value: string) => {
  fireEvent.change(field(), { target: { value } });
  fireEvent.keyDown(field(), { key: "Enter" });
};
/** A row's subject (the match is highlighted: the text is split in <mark>s). */
const subj = (n: number) => screen.getAllByText((_c, el) =>
  el?.tagName === "SPAN" && el.classList.contains("truncate")
  && el.textContent === `Invoice ${n}`)[0];
const pickAll = async () => {
  fireEvent.click(screen.getByRole("radio", { name: "All accounts" }));
};

test("without a second account nothing is added: no choice, the ordinary search", async () => {
  mount(undefined);
  expect(screen.queryByRole("radio", { name: "All accounts" })).toBeNull();
  type("invoice");
  await waitFor(() => expect(search).toHaveBeenCalledWith("invoice", false));
  expect(accountsSearch).not.toHaveBeenCalled();
});

test("the choice is next to today's controls, defaults to this account, and changes none of them", async () => {
  mount(across());
  // today's scope, time and folder controls are all still there
  expect(screen.getByRole("radio", { name: "Subject & sender" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Also mail text" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "This account" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "All accounts" }).getAttribute("aria-checked")).toBe("false");
  type("invoice");
  await waitFor(() => expect(search).toHaveBeenCalledWith("invoice", false));
  expect(accountsSearch).not.toHaveBeenCalled();
  // "This account": the results are as ever - no account chip, no hint
  await waitFor(() => expect(subj(1)).toBeTruthy());
  expect(screen.queryByText(/Opening a result switches to its account/)).toBeNull();
  expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);   // time, folder
});

test("All accounts: the hits of every account with an account chip, the senders with theirs", async () => {
  mount(across());
  type("invoice");
  await waitFor(() => expect(subj(1)).toBeTruthy());
  await pickAll();
  await waitFor(() => expect(accountsSearch).toHaveBeenCalledWith("invoice", false));
  await screen.findByText(/Hosting Co/);
  expect(screen.getByText(/^Senders · 2$/)).toBeTruthy();
  expect(screen.getByText(/^Mails · 3$/)).toBeTruthy();
  expect(screen.getByText(/^Select all 3$/)).toBeTruthy();
  // an account chip on each sender and each mail
  const sender = screen.getByText("Hosting Co").closest("button")!;
  expect(within(sender).getByText("work")).toBeTruthy();
  // (the mails' chips: proton once, work twice - plus the sender chips)
  expect(screen.getAllByText("work").length).toBeGreaterThanOrEqual(3);
  expect(screen.getAllByText("proton").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/Opening a result switches to its account\. Trash selected runs one step per account/))
    .toBeTruthy();
  // the ordinary single-account sender list is not mixed in
  expect(screen.queryByText("CloudBox")?.closest("button")?.textContent).toContain("proton");
});

test("opening a hit of another account switches to it; the results stay", async () => {
  const a = across();
  const { again } = mount(a);
  type("invoice");
  await pickAll();
  await screen.findByText(/Hosting Co/);
  fireEvent.click(subj(2));
  expect(a.onSwitchAccount).toHaveBeenCalledWith("work");
  // the app answers with the new selected account: the panel keeps its results
  again(across({ ...a, account: "work" }));
  expect(await screen.findByText("body text")).toBeTruthy();      // the reader
  expect((field() as HTMLInputElement).value).toBe("invoice");   // not started over
  expect(screen.getByRole("radio", { name: "All accounts", hidden: true })
    .getAttribute("aria-checked")).toBe("true");
});

test("a hit of the selected account opens without switching", async () => {
  const a = across();
  mount(a);
  type("invoice");
  await pickAll();
  await screen.findByText(/Hosting Co/);
  fireEvent.click(subj(1));
  expect(a.onSwitchAccount).not.toHaveBeenCalled();
});

test("a switch the panel did not ask for starts it over, as it always did", async () => {
  const a = across();
  const { again } = mount(a);
  type("invoice");
  await pickAll();
  await screen.findByText(/Hosting Co/);
  again(across({ ...a, account: "old" }));          // the account menu
  await waitFor(() => expect(screen.queryByText(/Hosting Co/)).toBeNull());
  expect((field() as HTMLInputElement).value).toBe("");
  expect(screen.getByRole("radio", { name: "This account" }).getAttribute("aria-checked")).toBe("true");
});

test("a sender of another account opens in that account", async () => {
  const a = across();
  mount(a);
  type("invoice");
  await pickAll();
  fireEvent.click((await screen.findByText("Hosting Co")).closest("button")!);
  expect(a.onOpenSender).toHaveBeenCalledWith("work", "billing@hosting.example");
  expect(a.onSwitchAccount).not.toHaveBeenCalled();     // the app does the switch
});

test("Select all and Trash selected: one confirm, pinned left out, one step per account", async () => {
  const a = across();
  mount(a);
  type("invoice");
  await pickAll();
  await screen.findByText(/Hosting Co/);
  fireEvent.click(screen.getByText(/^Select all 3$/));
  fireEvent.click(screen.getByRole("button", { name: /^Trash selected \(3\)$/ }));
  const dlg = await screen.findByRole("dialog", { name: /Move\s2\smails\sto\sTrash\sin\s2\saccounts\?/ });
  expect(within(dlg).getByText("1 pinned or protected stays")).toBeTruthy();
  fireEvent.click(within(dlg).getByRole("button", { name: /^Trash\s2\smails\sin\s2\saccounts$/ }));
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledTimes(2));
  expect(deleteMessages.mock.calls.map((c) => [c[0], c[4]])).toEqual([
    [[["INBOX", 1]], "proton"], [[["INBOX", 2]], "work"]]);
  expect(a.onFollow).toHaveBeenCalledWith({ kind: "trash", steps: [
    { account: "proton", job: "j-proton" }, { account: "work", job: "j-work" }] });
  // the moved mails leave the results, the pinned one stays
  await waitFor(() => expect(screen.queryAllByText((_c, el) =>
    el?.textContent === "Invoice 1" && el.tagName === "SPAN")).toHaveLength(0));
  expect(subj(3)).toBeTruthy();
  // and the selected account was never switched by any of it
  expect(a.onSwitchAccount).not.toHaveBeenCalled();
});

test("the same folder and UID in two accounts are two mails", async () => {
  accountsSearch.mockResolvedValue(hits({ mails: [mail(7, "proton"), mail(7, "work")] }));
  mount(across());
  type("invoice");
  await pickAll();
  await screen.findByText(/^Mails · 2$/);
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  expect(screen.getByRole("button", { name: /^Trash selected \(1\)$/ })).toBeTruthy();
  // only THAT mail is ticked - the other has the same folder and UID
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes.map((b) => b.checked)).toEqual([true, false]);
});

test("one account failing is a note with its name; the rest is listed", async () => {
  accountsSearch.mockResolvedValue(hits({ notes: [{ key: "account_failed", params: {}, account: "old" }] }));
  mount(across());
  type("invoice");
  await pickAll();
  expect(await screen.findByText(/This account could not be searched\./)).toBeTruthy();
  expect(screen.getByText("old:")).toBeTruthy();
  expect(screen.getByText(/^Mails · 3$/)).toBeTruthy();
});

test("the Try presets belong to one account: gone while searching all", async () => {
  mount(across(), { onOpenFiltered: () => {} });
  await pickAll();
  expect(screen.queryByText(/^Try$/i)).toBeNull();
});

test("German", async () => {
  setLang("de");
  mount(across());
  expect(screen.getByRole("radio", { name: "Dieses Konto" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Alle Konten" }));
  type("invoice");
  await screen.findByText(/Hosting Co/);
  expect(screen.getByText(/Ein Treffer öffnet sich in seinem Konto/)).toBeTruthy();
});
