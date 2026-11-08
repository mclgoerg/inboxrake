// @vitest-environment jsdom
/* The mail reader (MessageView + ThreadView chrome): Apple-Mail-like header,
 * chips from the index facts, plain text only (never HTML, never links),
 * folded quotes, the unsubscribe card, the toolbar - every action calls the
 * opener's own handler - prev / next, and the loading / error states. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ReaderHostProvider, parseFrom, toLine, type ReaderActions,
  type ReaderHost } from "./components/MailReader";
import { pickFolder } from "./folderPickerTestUtil";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { Mail, MessageDetail } from "./types";

const message = vi.fn();
const thread = vi.fn();
const messages = vi.fn();
const pinApi = vi.fn();

vi.mock("./api", () => ({
  api: {
    message: (...a: unknown[]) => message(...a),
    thread: (...a: unknown[]) => thread(...a),
    messages: (...a: unknown[]) => messages(...a),
    pin: (...a: unknown[]) => pinApi(...a),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
  },
  fmtSize: (n: number) => `${n} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2000-11-07 18:50", ts: uid,
  subject: "Weekend sale", addr: "news@shop.example", size: 18000,
  seen: true, ai: null, ...over,
});
const detail = (over: Partial<MessageDetail> = {}): MessageDetail => ({
  from: '"Shop News" <news@shop.example>', to: "Me <me@self.example>",
  date: "Tue, 07 Nov 2000 18:50:21 +0000", subject: "Weekend sale",
  text: "Hi there\n\nUp to 70% off.", ...over,
});

afterEach(() => {
  cleanup();
  message.mockReset();
  thread.mockReset();
  messages.mockReset();
  pinApi.mockReset();
  setLang("en");
});

const host = (over: Partial<ReaderHost> = {}): ReaderHost => ({
  selfAddrs: ["me@self.example"], account: "proton",
  folders: [{ value: "INBOX", label: "Inbox" },
    { value: "Archive", label: "Archive" }, { value: "Receipts", label: "Receipts" }],
  ...over,
});
const show = (mail: Mail, props: Partial<Parameters<typeof MessageView>[0]> = {},
    h: ReaderHost = host()) =>
  render(
    <ReaderHostProvider value={h}>
      <MessageView mail={mail} onBack={() => {}} {...props} />
    </ReaderHostProvider>);

/* ------------------------------ header + body ----------------------------- */

test("header: name, address, to me, readable date, large subject, chips", async () => {
  message.mockResolvedValue(detail());
  show(mk(1));
  await screen.findByText(/Hi there/);
  expect(screen.getByText("Shop News")).toBeTruthy();
  expect(screen.getByText(/news@shop\.example · to me/)).toBeTruthy();
  expect(screen.getByText(/Tue, 7 Nov 2000, 18:50/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Weekend sale" })).toBeTruthy();
  expect(screen.getByText("INBOX")).toBeTruthy();
  expect(screen.getByText("18000 B")).toBeTruthy();
});

test("to-line: someone else, several recipients, German", () => {
  const me = ["me@self.example"];
  expect(toLine("Me <ME@self.example>", me)).toBe("to me");
  expect(toLine("a@x.example, me@self.example, c@x.example", me))
    .toBe("to me and 2 others");
  expect(toLine("a@x.example", me)).toBe("to a@x.example");
  expect(toLine("a@x.example, b@x.example", me)).toBe("to a@x.example and 1 other");
  expect(toLine("", me)).toBe("");
  setLang("de");
  expect(toLine("me@self.example", me)).toBe("an mich");
  expect(parseFrom('"Shop News" <news@shop.example>'))
    .toEqual({ name: "Shop News", addr: "news@shop.example" });
  expect(parseFrom("plain@shop.example"))
    .toEqual({ name: "", addr: "plain@shop.example" });
});

test("shows what the list knows at once, before the text arrives", () => {
  message.mockReturnValue(new Promise(() => {}));            // never answers
  show(mk(1));
  expect(screen.getByRole("heading", { name: "Weekend sale" })).toBeTruthy();
  expect(screen.getByText("news@shop.example")).toBeTruthy();
  expect(screen.getByRole("status")).toBeTruthy();       // the spinner
});

test("a failed load says so and keeps the header and Back", async () => {
  message.mockRejectedValue(new Error("fetch failed"));
  const onBack = vi.fn();
  show(mk(1), { onBack });
  expect((await screen.findByRole("alert")).textContent).toBe("fetch failed");
  expect(screen.getByRole("heading", { name: "Weekend sale" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalled();
});

test("PRIVACY: the body is plain text - markup stays text, links stay text",
  async () => {
    message.mockResolvedValue(detail({
      text: 'See <a href="https://evil.example/x">offers</a> or '
        + "https://evil.example/pay now\n<img src=\"https://t.example/p.gif\">" }));
    const { container } = show(mk(1));
    await screen.findByText(/See <a href/);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe, script, style")).toBeNull();
    expect(container.textContent).toContain("https://evil.example/pay now");
  });

test("quoted history is folded with its line count", async () => {
  message.mockResolvedValue(detail({
    text: "Sounds good.\n\nOn Mon, Boss wrote:\n> Can we meet?\n> Soon?\n" }));
  show(mk(1));
  await screen.findByText(/Sounds good\./);
  expect(screen.queryByText(/Can we meet/)).toBeNull();
  const toggle = screen.getByRole("button", { name: /Show quoted text/ });
  expect(toggle.textContent).toContain("3 lines");
  fireEvent.click(toggle);
  expect(screen.getByText(/Can we meet/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Hide quoted text/ }));
  expect(screen.queryByText(/Can we meet/)).toBeNull();
});

/* --------------------------------- chips ---------------------------------- */

test("tracker and attachment chips only when the index knows them", async () => {
  message.mockResolvedValue(detail());
  const { unmount } = show(mk(1));
  await screen.findByText(/Hi there/);
  expect(screen.queryByText(/Tracking pixel/)).toBeNull();
  expect(screen.queryByText(/No tracking found/)).toBeNull();
  expect(document.body.textContent).not.toContain("lookbook");
  unmount();

  message.mockResolvedValue(detail({
    trackers: { pixel: true, click: true, hosts: ["tracker.example"] },
    atts: [{ name: "lookbook.pdf", size: 1200 }] }));
  show(mk(1));
  await screen.findByText("Tracking pixel - not loaded");
  expect(screen.getByText("Click tracking")).toBeTruthy();
  expect(screen.getByText(/lookbook\.pdf · 1200 B/)).toBeTruthy();
  cleanup();

  message.mockResolvedValue(detail({
    trackers: { pixel: false, click: false, hosts: [] } }));
  show(mk(1));
  await screen.findByText("No tracking found");
});

/* ------------------------------ unsubscribe card -------------------------- */

test.each([
  ["one_click", "one click - done right away"],
  ["mailto", "sends a mail from your address"],
  ["http", "web page - you confirm on the sender's page"],
] as const)("unsubscribe card (%s) runs the sender flow", async (method, line) => {
  message.mockResolvedValue(detail({
    unsub: { method, one_click: method === "one_click" } }));
  const unsubscribe = vi.fn().mockResolvedValue(undefined);
  show(mk(1), {}, host({ unsubscribe, canUnsubscribe: () => true }));
  await screen.findByText("Unsubscribe link found");
  expect(screen.getByText(`In this mail: ${line}`)).toBeTruthy();
  // the button works on the sender's newest mail: say so
  expect(screen.getByText(/using its newest mail/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
  await waitFor(() => expect(unsubscribe).toHaveBeenCalledWith("news@shop.example"));
});

test("unsubscribe card: no button where the flow cannot run, done state, "
  + "none without a header", async () => {
  message.mockResolvedValue(detail({ unsub: { method: "http", one_click: false } }));
  const { unmount } = show(mk(1), {}, host({
    unsubscribe: vi.fn(), canUnsubscribe: () => false }));
  await screen.findByText("Unsubscribe link found");
  expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  expect(screen.queryByText(/using its newest mail/)).toBeNull();   // no button, no promise
  unmount();

  const { unmount: u2 } = show(mk(1), {}, host({
    unsubscribe: vi.fn(), canUnsubscribe: () => true, unsubscribed: () => "done" }));
  await screen.findByText("Unsubscribe link found");
  expect(screen.getByText("Unsubscribed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  u2();

  message.mockResolvedValue(detail());
  show(mk(1));
  await screen.findByText(/Hi there/);
  expect(screen.queryByText("Unsubscribe link found")).toBeNull();
});

/* -------------------------------- toolbar --------------------------------- */

const open = async (actions?: ReaderActions, h = host(), mail = mk(1),
    extra: Partial<MessageDetail> = {}) => {
  message.mockResolvedValue(detail({ pinnable: true, pinned: false,
    thread: { count: 3 }, ...extra }));
  show(mail, { actions }, h);
  await screen.findByText(/Hi there/);
};

test("Trash, Move and Pin call the opener's handlers; Move picks the folder",
  async () => {
    const actions: ReaderActions = { trash: vi.fn(), move: vi.fn(),
      pin: vi.fn().mockResolvedValue(true) };
    await open(actions);
    fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
    expect(actions.trash).toHaveBeenCalledWith(expect.objectContaining({ uid: 1 }));

    // Move opens the folder picker ("Move 1 mail"); picking runs the opener's move
    fireEvent.click(screen.getByRole("button", { name: "Move this mail to a folder" }));
    await pickFolder("Archive");
    await waitFor(() => expect(actions.move).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 1 }), "Archive"));

    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unpin" })
      .getAttribute("aria-pressed")).toBe("true"));
    expect(actions.pin).toHaveBeenCalledWith(expect.objectContaining({ uid: 1 }), true);
    expect(pinApi).not.toHaveBeenCalled();           // the opener's handler, not ours
  });

test("a failed pin leaves the button as it was", async () => {
  const actions: ReaderActions = { pin: vi.fn().mockResolvedValue(false) };
  await open(actions);
  fireEvent.click(screen.getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(actions.pin).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Pin" })
    .getAttribute("aria-pressed")).toBe("false");
});

test("without a pin handler the reader pins through the endpoint, when the "
  + "mail can be pinned", async () => {
  pinApi.mockResolvedValue({ ok: true, pinned: true });
  await open(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(pinApi).toHaveBeenCalledWith("INBOX", 1, true));
  await screen.findByRole("button", { name: "Unpin" });
  cleanup();

  // a mail outside the scan (Junk / Trash / Sent) cannot be pinned: no button
  message.mockResolvedValue(detail({ pinnable: false }));
  show(mk(2));
  await screen.findByText(/Hi there/);
  expect(screen.queryByRole("button", { name: /Pin/ })).toBeNull();
});

test("controls whose handler is missing are not shown", async () => {
  await open(undefined, host({ folders: [] }), mk(1), { pinnable: false,
    thread: null });
  expect(screen.queryByRole("button", { name: "Trash this mail" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Move this mail to a folder" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Read conversation" })).toBeNull();
  expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
});

test("More: open sender (closes the reader first), copy address, block, headers",
  async () => {
    const order: string[] = [];
    const h = host({
      hasSender: () => true,
      openSender: () => { order.push("open"); },
      blockSender: vi.fn().mockResolvedValue(true),
    });
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    message.mockResolvedValue(detail({ pinnable: false }));
    show(mk(1), { onBack: () => order.push("back") }, h);
    await screen.findByText(/Hi there/);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Open sender/ }));
    expect(order).toEqual(["back", "open"]);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy address/ }));
    expect(writeText).toHaveBeenCalledWith("news@shop.example");

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Block sender/ }));
    expect(h.blockSender).toHaveBeenCalledWith("news@shop.example");

    // today's raw header lines stay reachable
    expect(screen.queryByRole("region", { name: "Raw headers" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Show headers/ }));
    const raw = screen.getByRole("region", { name: "Raw headers" });
    expect(raw.textContent).toContain('From: "Shop News" <news@shop.example>');
    expect(raw.textContent).toContain("Date: Tue, 07 Nov 2000 18:50:21 +0000");
    expect(raw.textContent).toContain("Subject: Weekend sale");
    vi.unstubAllGlobals();
  });

test("More hides Open sender for an unknown sender and Block for a blocked "
  + "one or for yourself", async () => {
  await open(undefined, host({ hasSender: () => false, openSender: vi.fn(),
    isBlocked: () => true, blockSender: vi.fn() }));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("menuitem", { name: /Open sender/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /Block sender/ })).toBeNull();
  expect(screen.getByRole("menuitem", { name: /Copy address/ })).toBeTruthy();
  cleanup();

  await open(undefined, host({ blockSender: vi.fn() }),
    mk(1, { addr: "me@self.example" }));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("menuitem", { name: /Block sender/ })).toBeNull();
});

test("the conversation button shows the count and opens the thread", async () => {
  thread.mockResolvedValue({ key: "k", label: "Plan", notes: [],
    mails: [mk(1), mk(2, { addr: "other@shop.example" })] });
  await open();
  const btn = screen.getByRole("button", { name: "Read conversation" });
  expect(btn.textContent).toContain("3 mails");
  fireEvent.click(btn);
  await screen.findByText("2 mails");
  expect(screen.getByRole("heading", { name: "Plan" })).toBeTruthy();
});

/* ------------------------------- prev / next ------------------------------ */

test("previous / next only where the opener passes its list", async () => {
  const list = [mk(1), mk(2), mk(3)];
  const onOpen = vi.fn();
  message.mockResolvedValue(detail());
  const { unmount } = show(list[1], { nav: { list, onOpen } });
  await screen.findByText(/Hi there/);
  fireEvent.click(screen.getByRole("button", { name: "Next mail" }));
  expect(onOpen).toHaveBeenLastCalledWith(list[2]);
  fireEvent.click(screen.getByRole("button", { name: "Previous mail" }));
  expect(onOpen).toHaveBeenLastCalledWith(list[0]);
  unmount();

  // the ends are disabled, a lone mail / no list has no arrows at all
  show(list[0], { nav: { list, onOpen } });
  await screen.findByText(/Hi there/);
  expect((screen.getByRole("button", { name: "Previous mail" }) as HTMLButtonElement)
    .disabled).toBe(true);
  cleanup();
  show(list[0], { nav: { list: [list[0]], onOpen } });
  await screen.findByText(/Hi there/);
  expect(screen.queryByRole("button", { name: "Next mail" })).toBeNull();
  cleanup();
  show(list[0]);
  await screen.findByText(/Hi there/);
  expect(screen.queryByRole("button", { name: "Next mail" })).toBeNull();
});

test("moving to another mail loads its text", async () => {
  message.mockImplementation((_f: string, uid: number) =>
    Promise.resolve(detail({ text: `text of ${uid}` })));
  const list = [mk(1), mk(2)];
  const { rerender } = render(
    <ReaderHostProvider value={host()}>
      <MessageView mail={list[0]} onBack={() => {}} nav={{ list, onOpen: () => {} }} />
    </ReaderHostProvider>);
  await screen.findByText("text of 1");
  rerender(
    <ReaderHostProvider value={host()}>
      <MessageView mail={list[1]} onBack={() => {}} nav={{ list, onOpen: () => {} }} />
    </ReaderHostProvider>);
  await screen.findByText("text of 2");
  expect(message).toHaveBeenCalledWith("INBOX", 2);
});

test("the back button names where it goes", async () => {
  message.mockResolvedValue(detail());
  const { container } = show(mk(1), { backLabel: "All mail" });
  await screen.findByText(/Hi there/);
  expect(within(container).getByRole("button", { name: "All mail" })).toBeTruthy();
});

test("Copy address: the success toast only after the copy worked, an error "
  + "toast when it did not", async () => {
  const mount = () => render(
    <ToastProvider>
      <ReaderHostProvider value={host()}>
        <MessageView mail={mk(1)} onBack={() => {}} />
      </ReaderHostProvider>
    </ToastProvider>);
  message.mockResolvedValue(detail({ pinnable: false }));
  const copy = async () => {
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy address/ }));
  };
  vi.stubGlobal("navigator", { ...navigator,
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  mount();
  await screen.findByText(/Hi there/);
  await copy();
  await screen.findByText("Address copied");
  cleanup();

  vi.stubGlobal("navigator", { ...navigator,
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  mount();
  await screen.findByText(/Hi there/);
  await copy();
  await screen.findByText("Could not copy the address");
  expect(screen.queryByText("Address copied")).toBeNull();
  cleanup();

  vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
  mount();
  await screen.findByText(/Hi there/);
  await copy();
  await screen.findByText("Could not copy the address");
  vi.unstubAllGlobals();
});

test("the pin shown is the server's answer, not the list's older flag", async () => {
  message.mockResolvedValue(detail({ pinnable: true, pinned: true }));
  show(mk(1, { pinned: false }));
  await screen.findByRole("button", { name: "Unpin" });
});

test("a pin made without an opener handler is reported to the opener",
  async () => {
    pinApi.mockResolvedValue({ ok: true });
    const pinned = vi.fn();
    await open({ pinned });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(pinned).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 1 }), true));
  });

test("inside the conversation Back names the mail it returns to", async () => {
  thread.mockResolvedValue({ key: "k", label: "Plan", notes: [], mails: [mk(1)] });
  await open(undefined, host(), mk(1), {});
  fireEvent.click(screen.getByRole("button", { name: "Read conversation" }));
  await screen.findByRole("heading", { name: "Plan" });
  expect(screen.getByRole("button", { name: "Mail" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "All mail" })).toBeNull();
});

test("forwarded content is not folded away; a reply's quote still is",
  async () => {
    message.mockResolvedValue(detail({ subject: "Fwd: Plan", text:
      "fyi\n---------- Forwarded message ---------\nFrom: x\nDate: Mon\n"
      + "Subject: Plan\n\nthe passed-on text" }));
    show(mk(1, { subject: "Fwd: Plan" }));
    await screen.findByText(/the passed-on text/);
    expect(screen.queryByRole("button", { name: /Show quoted text/ })).toBeNull();
  });
