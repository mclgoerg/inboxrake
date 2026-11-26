// @vitest-environment jsdom
/* The conversation reader and "Keep the mail, remove the file": an attachment
 * chip of a card opens the same menu, and once the removal started the
 * reader leaves (its mail's UID is replaced by the lighter copy) - through
 * the single-mail reader's own way back, not just out of the conversation. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ThreadView } from "./components/ThreadView";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { Mail, MessageDetail } from "./types";

const thread = vi.fn();
const message = vi.fn();
const messages = vi.fn();
const removeFlow = vi.fn();

vi.mock("./api", () => ({
  api: {
    thread: (...a: unknown[]) => thread(...a),
    message: (...a: unknown[]) => message(...a),
    messages: (...a: unknown[]) => messages(...a),
  },
  fmtSize: (n: number) => `${n} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));
vi.mock("./removeFiles", () => ({
  removeFiles: (...a: unknown[]) => removeFlow(...a),
}));

afterEach(() => {
  cleanup();
  thread.mockReset();
  message.mockReset();
  messages.mockReset();
  removeFlow.mockReset();
  vi.unstubAllGlobals();
  setLang("en");
});

const mail: Mail = { uid: 3, folder: "INBOX", date: "2024-03-03 10:00", ts: 3,
  subject: "Plan", addr: "boss@corp.example", size: 1, seen: true, ai: null };
const body = (over: Partial<MessageDetail> = {}): MessageDetail => ({
  from: "x", to: "y", date: "d", subject: "Plan", text: "the plan",
  atts: [{ name: "plan.pdf", size: 5000 }], ...over });

const wide = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: false, media: q, addEventListener: () => {},
  removeEventListener: () => {},
}));

test("a chip of the conversation opens the menu and, once the removal "
  + "started, the reader leaves", async () => {
  wide();
  thread.mockResolvedValue({ key: "k", label: "Plan", mails: [mail],
    notes: [] });
  removeFlow.mockResolvedValue("started");
  const out = vi.fn();
  const left = vi.fn();
  render(<ToastProvider>
    <ThreadView mail={mail} initial={body()} onBack={left}
      onRemoved={out} />
  </ToastProvider>);
  fireEvent.click(await screen.findByRole("button",
    { name: "plan.pdf, 5000 B. Options" }));
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Remove the file, keep the mail…" }));
  await waitFor(() => expect(removeFlow).toHaveBeenCalledTimes(1));
  expect(removeFlow).toHaveBeenCalledWith([{ name: "plan.pdf", size: 5000,
    kind: "pdf", mails: [{ folder: "INBOX", uid: 3, addr: "boss@corp.example",
      subject: "Plan" }] }]);
  await waitFor(() => expect(out).toHaveBeenCalled());
  expect(left).not.toHaveBeenCalled();     // (the conversation's own Back)
});

test("from the single-mail reader the way out is the reader's own Back",
  async () => {
  wide();
  message.mockResolvedValue(body({ thread: { count: 2 } }));
  thread.mockResolvedValue({ key: "k", label: "Plan", mails: [mail],
    notes: [] });
  removeFlow.mockResolvedValue("started");
  const back = vi.fn();
  render(<ToastProvider>
    <MessageView mail={mail} onBack={back} />
  </ToastProvider>);
  // into the conversation, then the chip of its card
  fireEvent.click(await screen.findByRole("button", { name: /conversation/i }));
  fireEvent.click(await screen.findByRole("button",
    { name: "plan.pdf, 5000 B. Options" }));
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Remove the file, keep the mail…" }));
  await waitFor(() => expect(back).toHaveBeenCalled());
});
