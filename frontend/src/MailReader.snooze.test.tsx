// @vitest-environment jsdom
/* The reader's ⋯ menu: Not now… comes after Block sender and right BEFORE
 * Mute this conversation… (the cross-board order), every older item stays,
 * and without a snooze action there is no Not now… at all. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ReaderHostProvider, type ReaderActions, type ReaderHost }
  from "./components/MailReader";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { Mail, MessageDetail } from "./types";

const message = vi.fn();

vi.mock("./api", () => ({
  api: {
    message: (...a: unknown[]) => message(...a),
    thread: () => new Promise(() => {}),
    messages: () => Promise.resolve({ messages: [] }),
    pin: vi.fn(),
    unsubscribePreview: vi.fn(),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
  },
  fmtSize: (n: number) => `${n} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mail: Mail = {
  uid: 1, folder: "INBOX", date: "2000-11-07 18:50", ts: 1, subject: "Re: Plan",
  addr: "kim@team.example", size: 14000, seen: true, ai: null };
const detail: MessageDetail = {
  from: '"Kim Example" <kim@team.example>', to: "Me <me@self.example>",
  date: "Tue, 07 Nov 2000 18:50:21 +0000", subject: "Re: Plan",
  text: "Count me in!", pinnable: true, pinned: false,
  thread: { count: 23, key: "4f9c1e0a7b2d3c58" } };

afterEach(() => { cleanup(); message.mockReset(); setLang("en"); });

const host: ReaderHost = {
  selfAddrs: ["me@self.example"], account: "proton",
  folders: [{ value: "INBOX", label: "Inbox" }],
  hasSender: () => true, openSender: vi.fn(), blockSender: vi.fn(),
  muteConversation: vi.fn().mockResolvedValue(true),
  unmuteConversation: vi.fn().mockResolvedValue(true),
  isMuted: () => false };

const open = async (actions?: ReaderActions) => {
  message.mockResolvedValue(detail);
  render(<ToastProvider><ReaderHostProvider value={host}>
    <MessageView mail={mail} onBack={() => {}} actions={actions} />
  </ReaderHostProvider></ToastProvider>);
  await screen.findByText(/Count me in/);
  fireEvent.click(screen.getByRole("button", { name: /^(More|Mehr)$/ }));
};
const items = () => screen.getAllByRole("menuitem")
  .map((i) => i.textContent?.trim());

test("Not now… sits after Block sender and right before Mute", async () => {
  await open({ snooze: vi.fn().mockResolvedValue(true) });
  expect(items()).toEqual(["Open sender", "Copy address", "Show headers",
    "Block sender", "Not now…", "Mute this conversation…"]);
});

test("without a snooze action the menu is exactly as it was", async () => {
  await open({});
  expect(items()).toEqual(["Open sender", "Copy address", "Show headers",
    "Block sender", "Mute this conversation…"]);
});

test("a time chosen in the popover reaches the snooze action for that mail", async () => {
  const snooze = vi.fn().mockResolvedValue(true);
  await open({ snooze });
  fireEvent.click(screen.getByRole("menuitem", { name: "Not now…" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Tomorrow morning/ }));
  expect(snooze).toHaveBeenCalledTimes(1);
  expect(snooze.mock.calls[0][0]).toBe(mail);
  expect(typeof snooze.mock.calls[0][1]).toBe("number");
});
