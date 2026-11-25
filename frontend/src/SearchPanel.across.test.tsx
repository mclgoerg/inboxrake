// @vitest-environment jsdom
/* Search across accounts: one search over every account, hits carry their
 * account (badge, narrowed by an account select), notes name the account they
 * are about, the reader reads from the mail's account, and Trash goes through
 * the multi-account confirm - one step per account. (api mocked.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mail } from "./allAccountsFixtures";
import { setLang } from "./i18n";
import type { Mail, SearchResp } from "./types";

const calls: { fn: string; account: string; args: unknown[] }[] = [];
const accountsSearch = vi.fn();
const plainSearch = vi.fn();
const deleteMessages = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const at = () => decodeURIComponent(
    /account=([^&]*)/.exec(actual.withAccount("/x"))?.[1] ?? "");
  const rec = (fn: string, f: (...a: any[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, account: at(), args });
      return f(...args);
    };
  return { ...actual, api: {
    accountsSearch: rec("accountsSearch", (...a) => accountsSearch(...a)),
    search: rec("search", (...a) => plainSearch(...a)),
    deleteMessages: rec("deleteMessages", (...a) => deleteMessages(...a)),
    message: rec("message", () => Promise.resolve({ from: "x", to: "", date: "d",
      subject: "s", text: "body text", pinnable: true, thread: { count: 2 } })),
    pin: rec("pin", () => Promise.resolve({ ok: true })),
    thread: rec("thread", (folder: string, uid: number) => Promise.resolve(
      { key: "k", label: "Invoice two", notes: [],
        mails: [uid, uid + 1].map((u) => ({
          ...mail("", u, { subject: "Invoice two", folder }),
          account: undefined })) })),
    messages: rec("messages", (items: [string, number][]) => Promise.resolve(
      { messages: items.map(([folder, uid]) => ({ folder, uid, from: "x",
        to: "", date: "d", subject: "Invoice two", text: "thread body" })) })),
  } };
});

import { SearchPanel } from "./components/SearchPanel";
import { DialogProvider, ToastProvider } from "./components/ui";

const NAMES = ["gmail", "icloud", "proton"];
const HITS: Mail[] = [mail("gmail", 1, { subject: "Invoice one" }),
  mail("proton", 1, { subject: "Invoice two", folder: "Archive" })];
const resp = (mails = HITS, notes: SearchResp["notes"] = []): SearchResp =>
  ({ mails, notes });
const press = (btn: HTMLElement) => fireEvent.click(btn, { detail: 0 });
const onDeleted = vi.fn();
const onOpenActivity = vi.fn();

const renderPanel = (over: Partial<Parameters<typeof SearchPanel>[0]> = {}) =>
  render(<ToastProvider><DialogProvider>
    <SearchPanel across={{ names: NAMES, exists: () => true, onOpenActivity }}
      bodySearch onClose={vi.fn()} onDeleted={onDeleted} {...over} />
  </DialogProvider></ToastProvider>);
// a hit's subject is cut by the highlight of the search word
const hit = (label: string) => (_: string, el: Element | null) =>
  !!el && el.textContent === label
  && !Array.from(el.children).some((c) => c.textContent === label);
const search = async (q = "invoice") => {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search" }),
    { target: { value: q } });
  await screen.findByText(hit("Invoice one"));
};

beforeEach(() => {
  setLang("en");
  calls.length = 0;
  accountsSearch.mockReset().mockResolvedValue(resp());
  plainSearch.mockReset().mockResolvedValue(resp([]));
  deleteMessages.mockReset().mockImplementation(async (items: unknown[]) =>
    ({ ok: true, queued: items.length }));
  onDeleted.mockReset();
  onOpenActivity.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("searches every account - not the single-account endpoint - and shows " +
  "each hit's account", async () => {
  renderPanel();
  await search();
  expect(accountsSearch).toHaveBeenCalledWith("invoice", false);
  expect(plainSearch).not.toHaveBeenCalled();
  expect(screen.getAllByText("gmail").length).toBeGreaterThan(0);
  expect(screen.getAllByText("proton").length).toBeGreaterThan(0);
  expect(screen.getByText("2 matches")).toBeTruthy();
});

test("no sender list and no 'Try' presets: they belong to one account's " +
  "groups", async () => {
  renderPanel();
  await search();
  expect(screen.queryByText(/^Senders ·/)).toBeNull();
});

test("an account select narrows the hits to one account", async () => {
  renderPanel();
  await search();
  fireEvent.change(screen.getByRole("combobox", { name: "Account" }),
    { target: { value: "proton" } });
  expect(screen.queryByText(hit("Invoice one"))).toBeNull();
  expect(screen.getByText(hit("Invoice two"))).toBeTruthy();
  expect(screen.getByText("1 matches")).toBeTruthy();
});

test("mail text search asks every account and shows each account's notes " +
  "under its name", async () => {
  accountsSearch.mockResolvedValue(resp(HITS, [
    { key: "body_off", params: {}, account: "icloud" },
    { key: "account_failed", params: {}, account: "gmx" }]));
  renderPanel();
  fireEvent.click(screen.getByRole("radio", { name: /text/i }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search" }),
    { target: { value: "invoice" } });
  fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search" }),
    { key: "Enter" });
  await waitFor(() => expect(accountsSearch).toHaveBeenCalledWith("invoice", true));
  await screen.findByText(/Mail text search is off for this account/);
  expect(screen.getByText("icloud:")).toBeTruthy();
  expect(screen.getByText(/Could not search this account/)).toBeTruthy();
  expect(screen.getByText("gmx:")).toBeTruthy();
});

test("the body scope is off when no account offers it", async () => {
  renderPanel({ bodySearch: false });
  expect((screen.getByRole("radio", { name: /text/i }) as HTMLButtonElement)
    .disabled).toBe(true);
});

test("Trash: the multi-account confirm, one deleteMessages per account, the " +
  "hits leave the results", async () => {
  renderPanel();
  await search();
  fireEvent.click(screen.getByRole("button", { name: /Select all 2/ }));
  press(screen.getByRole("button", { name: /^Trash selected/ }));
  await screen.findByText(/Move to Trash: 2 mails in 2 accounts\?/);
  expect(deleteMessages).not.toHaveBeenCalled();
  press(screen.getByRole("button", { name: "Move to Trash (2)" }));
  await screen.findByText("2 done");
  expect(calls.filter((c) => c.fn === "deleteMessages").map((c) => c.account))
    .toEqual(["gmail", "proton"]);
  expect(deleteMessages.mock.calls[1][0]).toEqual([["Archive", 1]]);
  press(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByText(hit("Invoice one"))).toBeNull());
  expect(onDeleted).toHaveBeenCalled();
});

test("a pinned hit stays", async () => {
  accountsSearch.mockResolvedValue(resp([
    mail("gmail", 1, { subject: "Invoice one", pinned: true }), HITS[1]]));
  renderPanel();
  await search();
  fireEvent.click(screen.getByRole("button", { name: /Select all 2/ }));
  press(screen.getByRole("button", { name: /^Trash selected/ }));
  await screen.findByText(/Move to Trash: 1 mail in 1 account\?/);
  press(screen.getByRole("button", { name: "Move to Trash (1)" }));
  await screen.findByText("1 done");
  expect(calls.filter((c) => c.fn === "deleteMessages").map((c) => c.account))
    .toEqual(["proton"]);
});

test("opening a hit reads it from its account; its Trash is the same confirm",
  async () => {
  renderPanel();
  await search();
  fireEvent.click(screen.getByText(hit("Invoice two")));
  await screen.findByText("body text");
  expect(calls.find((c) => c.fn === "message")).toMatchObject({
    account: "proton", args: ["Archive", 1] });
  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  await screen.findByText(/Move to Trash: 1 mail in 1 account\?/);
  expect(within(screen.getByRole("dialog", { name: /Move to Trash/ }))
    .getByRole("checkbox", { name: "Move to Trash in proton" })).toBeTruthy();
});

test("the reader's own calls - pin, conversation, its mail texts - all go to " +
  "the hit's account", async () => {
  renderPanel();
  await search();
  fireEvent.click(screen.getByText(hit("Invoice two")));
  await screen.findByText("body text");
  fireEvent.click(screen.getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(calls.some((c) => c.fn === "pin")).toBe(true));
  expect(calls.find((c) => c.fn === "pin")).toMatchObject({
    account: "proton", args: ["Archive", 1, true] });
  fireEvent.click(screen.getByRole("button", { name: "Read conversation" }));
  // (the open mail came with its text; the other card is fetched on opening)
  fireEvent.click(await screen.findByRole("button", { name: "Expand all" }));
  await waitFor(() => expect(calls.some((c) => c.fn === "messages")).toBe(true));
  expect(calls.find((c) => c.fn === "thread")).toMatchObject({
    account: "proton", args: ["Archive", 1] });
  expect(calls.find((c) => c.fn === "messages")).toMatchObject({
    account: "proton" });
});

test("German", async () => {
  setLang("de");
  accountsSearch.mockResolvedValue(resp(HITS, [
    { key: "account_failed", params: {}, account: "gmx" }]));
  renderPanel();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "invoice" } });
  await screen.findByText(hit("Invoice one"));
  expect(screen.getByRole("combobox", { name: "Konto" })).toBeTruthy();
  expect(screen.getByText(/Dieses Konto konnte nicht durchsucht werden/)).toBeTruthy();
});
