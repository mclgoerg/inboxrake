// @vitest-environment jsdom
/* All mail across accounts: the list is the union (every row names its
 * account), the account chip narrows it, a selection acts through the
 * multi-account confirm (one step per account, the exact (folder, uid) of each
 * mail), the reader's own calls go to the mail's account - and whatever the
 * app's reader host offers for ONE account is not there. (api mocked.) */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mail } from "./allAccountsFixtures";
import { setLang } from "./i18n";
import type { Mail, MailsResp } from "./types";

const calls: { fn: string; account: string; args: unknown[] }[] = [];
const accountsMails = vi.fn();
const plainMails = vi.fn();
const deleteMessages = vi.fn();
const pin = vi.fn();

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
    accountsMails: rec("accountsMails", (...a) => accountsMails(...a)),
    mails: rec("mails", (...a) => plainMails(...a)),
    deleteMessages: rec("deleteMessages", (...a) => deleteMessages(...a)),
    pin: rec("pin", (...a) => pin(...a)),
    message: rec("message", () => Promise.resolve({ from: "x", to: "", date: "d",
      subject: "s", text: "body text" })),
    thread: rec("thread", () => Promise.resolve({ mails: [], count: 1 })),
    keepSafeCheck: () => Promise.resolve({ total: 0, kept: 0, classes: [] }),
  } };
});

import { AllMailsView } from "./components/AllMailsView";
import { ReaderHostProvider } from "./components/MailReader";
import { DialogProvider, ToastProvider } from "./components/ui";

const NAMES = ["gmail", "icloud", "proton"];
const resp = (list: Mail[], total = list.length): MailsResp =>
  ({ total, offset: 0, mails: list, ignored: [] });
const sp = (s: string | null | undefined): string =>
  (s ?? "").replace(/ /g, " ");
const press = (btn: HTMLElement) => fireEvent.click(btn, { detail: 0 });

const onChanged = vi.fn();
const onPage = vi.fn();
const onOpenActivity = vi.fn();
const renderView = (over: { follow?: string; phone?: boolean } = {}) => {
  if (over.phone) vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("48rem"), media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  const view = (follow: string) => (
    <ToastProvider><DialogProvider>
      {/* the app's own host: ONE account's folders, a Block flow ... */}
      <ReaderHostProvider value={{ selfAddrs: [], account: "gmail",
        folders: [{ value: "INBOX", label: "INBOX" }],
        hasSender: () => true, openSender: vi.fn(), isBlocked: () => false,
        blockSender: vi.fn() }}>
        <AllMailsView onChanged={onChanged} across={{ names: NAMES,
          follow, exists: () => true, onPage, onOpenActivity }} />
      </ReaderHostProvider>
    </DialogProvider></ToastProvider>);
  const r = render(view(over.follow ?? "a"));
  return { ...r, again: (follow: string) => r.rerender(view(follow)) };
};

const LIST = [mail("gmail", 1, { subject: "Offer one" }),
  mail("proton", 1, { subject: "Offer two", folder: "Archive" }),
  mail("gmail", 2, { subject: "Offer three", pinned: true })];

beforeEach(() => {
  setLang("en");
  calls.length = 0;
  accountsMails.mockReset().mockResolvedValue(resp(LIST));
  plainMails.mockReset().mockResolvedValue(resp([]));
  deleteMessages.mockReset().mockImplementation(async (items: unknown[]) =>
    ({ ok: true, queued: items.length }));
  pin.mockReset().mockResolvedValue({ ok: true, pinned: true });
  onChanged.mockReset();
  onPage.mockReset();
  onOpenActivity.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("the list is read across accounts - never from the single-account " +
  "endpoint - and every row names its account", async () => {
  renderView();
  await screen.findByText("Offer one");
  expect(accountsMails).toHaveBeenCalledTimes(1);
  expect(plainMails).not.toHaveBeenCalled();
  expect(accountsMails.mock.calls[0][0]).toMatchObject({ offset: 0, sort: "date",
    dir: "desc" });
  expect(accountsMails.mock.calls[0][0].only).toBeUndefined();
  expect(screen.getAllByText("gmail").length).toBeGreaterThan(0);
  expect(screen.getAllByText("proton").length).toBeGreaterThan(0);
  expect(screen.getByText("3 of 3 mails")).toBeTruthy();
});

test("the same (folder, uid) in two accounts is two rows with their own tick",
  async () => {
  renderView();
  await screen.findByText("Offer one");
  const boxes = screen.getAllByRole("checkbox");
  // gmail uid 1 and proton uid 1 are both INBOX / Archive 1: tick one only
  fireEvent.click(boxes[0]);
  expect(screen.getByText("1 selected")).toBeTruthy();
});

test("a row's meta line wraps on a phone (the account's name makes it long " +
  "enough to run under the AI pill); the account stays in the line", async () => {
  renderView();
  await screen.findByText("Offer one");
  const meta = document.querySelector(".max-sm\\:flex-wrap")!;
  expect(meta.textContent).toContain("gmail");
  // the sender is the item that truncates, and it goes last when wrapped
  expect(meta.querySelector(".max-sm\\:order-last")?.textContent)
    .toContain("deals@dealsdaily.example");
});

test("the account chip asks the server for that account only", async () => {
  renderView();
  await screen.findByText("Offer one");
  fireEvent.click(within(screen.getByRole("group",
    { name: "Show one account or all" })).getByRole("button", { name: "proton" }));
  await waitFor(() => expect(accountsMails).toHaveBeenCalledTimes(2));
  expect(accountsMails.mock.calls[1][0].only).toBe("proton");
});

test("a read again follows a change in any account", async () => {
  const v = renderView({ follow: "gmail:1" });
  await screen.findByText("Offer one");
  v.again("gmail:2");
  await waitFor(() => expect(accountsMails).toHaveBeenCalledTimes(2));
});

test("the bar has no Move (a folder of one account means nothing in another)",
  async () => {
  renderView();
  await screen.findByText("Offer one");
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  const bar = screen.getByRole("region", { name: "Selection actions" });
  expect(within(bar).queryByRole("button", { name: "Move" })).toBeNull();
  expect(within(bar).getByRole("button", { name: "Archive" })).toBeTruthy();
  expect(within(bar).getByRole("button", { name: "Mark read" })).toBeTruthy();
});

test("Trash: the multi-account confirm, then one deleteMessages per account " +
  "with the exact items; the mails leave the list", async () => {
  renderView();
  await screen.findByText("Offer one");
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[0]);        // gmail 1
  fireEvent.click(boxes[1]);        // proton 1
  const bar = screen.getByRole("region", { name: "Selection actions" });
  press(within(bar).getByRole("button", { name: /^Trash selected/ }));
  await screen.findByText(/Move to Trash: 2 mails in 2 accounts\?/);
  expect(deleteMessages).not.toHaveBeenCalled();
  press(screen.getByRole("button", { name: "Move to Trash (2)" }));
  await screen.findByText("2 done");
  expect(calls.filter((c) => c.fn === "deleteMessages")
    .map((c) => c.account)).toEqual(["gmail", "proton"]);
  expect(deleteMessages.mock.calls[0]).toEqual([[["INBOX", 1]], "trash", "", false]);
  expect(deleteMessages.mock.calls[1]).toEqual([[["Archive", 1]], "trash", "", false]);
  expect(screen.getAllByText("Undo is in this account's Activity.")).toHaveLength(2);
  press(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByText("Offer one")).toBeNull());
  expect(screen.getByText("Offer three")).toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
});

test("a pinned mail stays: a selection of only pinned mails has nothing to " +
  "move", async () => {
  renderView();
  await screen.findByText("Offer three");
  fireEvent.click(screen.getAllByRole("checkbox")[2]);
  press(within(screen.getByRole("region", { name: "Selection actions" }))
    .getByRole("button", { name: /^Trash selected/ }));
  await screen.findByText(/all pinned - left alone/);
  expect((screen.getByRole("button", { name: "Move to Trash (0)" }) as
    HTMLButtonElement).disabled).toBe(true);
  expect(deleteMessages).not.toHaveBeenCalled();
});

test("Mark read marks the mail read in its account, pinned or not", async () => {
  renderView();
  await screen.findByText("Offer three");
  fireEvent.click(screen.getAllByRole("checkbox")[2]);
  press(within(screen.getByRole("region", { name: "Selection actions" }))
    .getByRole("button", { name: "Mark read" }));
  await screen.findByText(/Mark as read: 1 mail in 1 account\?/);
  press(screen.getByRole("button", { name: "Mark as read (1)" }));
  await screen.findByText("1 done");
  expect(deleteMessages.mock.calls[0]).toEqual([[["INBOX", 2]], "mark_read", "", false]);
  expect(calls.find((c) => c.fn === "deleteMessages")!.account).toBe("gmail");
});

test("opening a mail reads it from ITS account", async () => {
  renderView();
  fireEvent.click(await screen.findByText("Offer two"));
  await screen.findByText("body text");
  expect(calls.find((c) => c.fn === "message")).toMatchObject({
    account: "proton", args: ["Archive", 1] });
});

test("the reader's pin goes to the mail's account", async () => {
  renderView();
  fireEvent.click(await screen.findByText("Offer two"));
  await screen.findByText("body text");
  fireEvent.click(screen.getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(pin).toHaveBeenCalledWith("Archive", 1, true));
  expect(calls.find((c) => c.fn === "pin")!.account).toBe("proton");
});

test("the reader's Trash is the same confirm, for that mail's account",
  async () => {
  renderView();
  fireEvent.click(await screen.findByText("Offer two"));
  await screen.findByText("body text");
  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  await screen.findByText(/Move to Trash: 1 mail in 1 account\?/);
  expect(screen.getByRole("checkbox", { name: "Move to Trash in proton" }))
    .toBeTruthy();
  press(screen.getByRole("button", { name: "Move to Trash (1)" }));
  await screen.findByText("1 done");
  expect(calls.find((c) => c.fn === "deleteMessages")!.account).toBe("proton");
  expect(deleteMessages.mock.calls[0][0]).toEqual([["Archive", 1]]);
});

test("the reader offers nothing that belongs to one account: no Move, no " +
  "sender page, no Block (the app's own host is not reachable)", async () => {
  renderView();
  fireEvent.click(await screen.findByText("Offer two"));
  await screen.findByText("body text");
  expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: /More/ })[0]);
  expect(screen.queryByRole("menuitem", { name: /Open sender/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /Block/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Unsubscribe/ })).toBeNull();
});

test("a row's pin button pins in that mail's account", async () => {
  renderView();
  await screen.findByText("Offer two");
  const row = screen.getByText("Offer two").closest("button")!.parentElement!;
  fireEvent.click(within(row).getByRole("button", { name: /^Protect/ }));
  await waitFor(() => expect(pin).toHaveBeenCalledWith("Archive", 1, true));
  expect(calls.find((c) => c.fn === "pin")!.account).toBe("proton");
});

/** A touch swipe (the gesture helper of App.gestures.test). */
function swipeLeft(target: Element) {
  const fire = (el: Element | Window, name: string, x: number, t: number) => {
    const ev = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: 0 },
      pointerId: { value: 1 }, isPrimary: { value: true },
      pointerType: { value: "touch" }, timeStamp: { value: t } });
    act(() => { el.dispatchEvent(ev); });
  };
  fire(target, "pointerdown", 350, 0);
  [250, 150, 40].forEach((x, i) => fire(window, "pointermove", x, (i + 1) * 100));
  fire(window, "pointerup", 40, 400);
}

test("a swipe Trash on a row asks the multi-account confirm first - nothing " +
  "is moved before it", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer: coarse"), media: q,
    addEventListener: () => {}, removeEventListener: () => {} }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
  renderView();
  await screen.findByText("Offer two");
  await act(async () => {});
  swipeLeft(screen.getByText("Offer two").closest("[data-swipe-body]")!);
  await screen.findByText(/Move to Trash: 1 mail in 1 account\?/);
  expect(deleteMessages).not.toHaveBeenCalled();
  press(screen.getByRole("button", { name: "Move to Trash (1)" }));
  await screen.findByText("1 done");
  expect(calls.filter((c) => c.fn === "deleteMessages")
    .map((c) => c.account)).toEqual(["proton"]);
});

test("phone: Senders | All mails switch", async () => {
  renderView({ phone: true });
  await screen.findByText("Offer one");
  const tabs = screen.getByRole("tablist", { name: "Group by" });
  expect(within(tabs).getByRole("tab", { name: "All mails" })
    .getAttribute("aria-selected")).toBe("true");
  fireEvent.click(within(tabs).getByRole("tab", { name: "Senders" }));
  expect(onPage).toHaveBeenCalledWith("senders");
});

test("German", async () => {
  setLang("de");
  renderView();
  await screen.findByText("Offer one");
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  const bar = screen.getByRole("region", { name: "Aktionen für die Auswahl" });
  press(within(bar).getByRole("button", { name: /^Auswahl löschen/ }));
  await screen.findByText(/In den Papierkorb: 1 Mail in 1 Konto\?/);
  expect(sp(document.body.textContent)).toContain("Jedes Konto führt seinen");
});
