// @vitest-environment jsdom
/* "Mute this conversation…" is the LAST item of the reader's ⋯ menu (after
 * Open sender, Copy address, Show headers and Block sender, which stay as
 * they are), for a mail that is part of a conversation: the open mail's
 * thread hint, or the key of the conversation view. It says Unmute while the
 * conversation is muted. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ReaderHostProvider, type ReaderHost } from "./components/MailReader";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { Mail, MessageDetail } from "./types";

const message = vi.fn();
const thread = vi.fn();

vi.mock("./api", () => ({
  api: {
    message: (...a: unknown[]) => message(...a),
    thread: (...a: unknown[]) => thread(...a),
    messages: () => Promise.resolve({ messages: [] }),
    pin: vi.fn(),
    unsubscribePreview: vi.fn(),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
  },
  fmtSize: (n: number) => `${n} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2000-11-07 18:50", ts: uid,
  subject: "Re: Plan", addr: "kim@team.example", size: 14000,
  seen: true, ai: null, ...over,
});
const detail = (over: Partial<MessageDetail> = {}): MessageDetail => ({
  from: '"Kim Example" <kim@team.example>', to: "Me <me@self.example>",
  date: "Tue, 07 Nov 2000 18:50:21 +0000", subject: "Re: Plan",
  text: "Count me in!", pinnable: true, pinned: false,
  thread: { count: 23, key: "4f9c1e0a7b2d3c58" }, ...over,
});

afterEach(() => {
  cleanup();
  message.mockReset();
  thread.mockReset();
  setLang("en");
});

const host = (over: Partial<ReaderHost> = {}): ReaderHost => ({
  selfAddrs: ["me@self.example"], account: "proton",
  folders: [{ value: "INBOX", label: "Inbox" }],
  hasSender: () => true, openSender: vi.fn(), blockSender: vi.fn(),
  muteConversation: vi.fn().mockResolvedValue(true),
  unmuteConversation: vi.fn().mockResolvedValue(true),
  isMuted: () => false, ...over,
});

const open = async (h: ReaderHost, extra: Partial<MessageDetail> = {}) => {
  message.mockResolvedValue(detail(extra));
  render(<ToastProvider><ReaderHostProvider value={h}>
    <MessageView mail={mk(1)} onBack={() => {}} />
  </ReaderHostProvider></ToastProvider>);
  await screen.findByText(/Count me in/);
  fireEvent.click(screen.getByRole("button", { name: /^(More|Mehr)$/ }));
};

const items = () => screen.getAllByRole("menuitem")
  .map((i) => i.textContent?.trim());

test("the menu keeps today's items in order and ends with Mute", async () => {
  await open(host());
  expect(items()).toEqual(["Open sender", "Copy address", "Show headers",
    "Block sender", "Mute this conversation…"]);
});

test("Mute this conversation… asks the app to mute that conversation",
  async () => {
    const h = host();
    await open(h);
    fireEvent.click(screen.getByRole("menuitem",
      { name: /Mute this conversation/ }));
    expect(h.muteConversation).toHaveBeenCalledWith("4f9c1e0a7b2d3c58");
    expect(h.unmuteConversation).not.toHaveBeenCalled();
  });

test("while the conversation is muted the item says Unmute", async () => {
  const h = host({ isMuted: (k) => k === "4f9c1e0a7b2d3c58" });
  await open(h);
  expect(items().at(-1)).toBe("Unmute this conversation");
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Unmute this conversation" }));
  expect(h.unmuteConversation).toHaveBeenCalledWith("4f9c1e0a7b2d3c58");
  expect(h.muteConversation).not.toHaveBeenCalled();
});

test("a mail that is no part of a conversation has no Mute item", async () => {
  await open(host(), { thread: null });
  expect(items()).toEqual(["Open sender", "Copy address", "Show headers",
    "Block sender"]);
  cleanup();
  // a hint from an older server names no key: nothing to mute
  await open(host(), { thread: { count: 3 } });
  expect(screen.queryByRole("menuitem", { name: /Mute this/ })).toBeNull();
});

test("without the app's handlers the item is not shown", async () => {
  await open(host({ muteConversation: undefined }));
  expect(screen.queryByRole("menuitem", { name: /Mute this/ })).toBeNull();
  expect(screen.getByRole("menuitem", { name: /Block sender/ })).toBeTruthy();
});

test("Mute is offered to yourself's mail too, Block is not", async () => {
  message.mockResolvedValue(detail());
  render(<ToastProvider><ReaderHostProvider value={host()}>
    <MessageView mail={mk(1, { addr: "me@self.example" })}
      onBack={() => {}} />
  </ReaderHostProvider></ToastProvider>);
  await screen.findByText(/Count me in/);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("menuitem", { name: /Block sender/ })).toBeNull();
  expect(items().at(-1)).toBe("Mute this conversation…");
});

test("in the conversation view the key is the conversation's own",
  async () => {
    const h = host();
    thread.mockResolvedValue({ key: "aaaaaaaaaaaaaaaa", label: "Plan",
      notes: [], mails: [mk(1), mk(2, { addr: "lee@team.example" })] });
    message.mockResolvedValue(detail());
    render(<ToastProvider><ReaderHostProvider value={h}>
      <MessageView mail={mk(1)} onBack={() => {}} />
    </ReaderHostProvider></ToastProvider>);
    await screen.findByText(/Count me in/);
    fireEvent.click(screen.getByRole("button", { name: /Read conversation|Conversation/ }));
    await waitFor(() => expect(thread).toHaveBeenCalled());
    await screen.findByRole("heading", { name: "Plan" });
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(await screen.findByRole("menuitem",
      { name: /Mute this conversation/ }));
    expect(h.muteConversation).toHaveBeenCalledWith("aaaaaaaaaaaaaaaa");
  });

test("the desktop toolbar (>= 768 px) has the same menu, Mute last", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("768"), media: q, addEventListener: () => {},
    removeEventListener: () => {}, addListener: () => {},
    removeListener: () => {} }));
  try {
    await open(host());
    expect(items()).toEqual(["Open sender", "Copy address", "Show headers",
      "Block sender", "Mute this conversation…"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("German", async () => {
  setLang("de");
  await open(host());
  expect(items().at(-1)).toBe("Konversation stummschalten…");
  cleanup();
  await open(host({ isMuted: () => true }));
  expect(items().at(-1)).toBe("Stummschaltung dieser Konversation aufheben");
});
