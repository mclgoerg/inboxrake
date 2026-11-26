// @vitest-environment jsdom
/* The reader and "Keep the mail, remove the file": every attachment chip
 * opens a menu (a sheet on a phone) with "Remove the file, keep the mail…",
 * and a mail that went through it shows chips for the removed files and a
 * note under its text. The chips still show name and size. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ReaderHostProvider, type ReaderHost } from "./components/MailReader";
import { ToastProvider } from "./components/ui";
import { setLang } from "./i18n";
import type { Mail, MessageDetail } from "./types";

const message = vi.fn();
const removeFlow = vi.fn();

vi.mock("./api", () => ({
  api: {
    message: (...a: unknown[]) => message(...a),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
  },
  fmtSize: (n: number) => `${n} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));
vi.mock("./removeFiles", () => ({
  removeFiles: (...a: unknown[]) => removeFlow(...a),
}));

afterEach(() => {
  cleanup();
  message.mockReset();
  removeFlow.mockReset();
  vi.unstubAllGlobals();
  setLang("en");
});

const mail: Mail = { uid: 7, folder: "INBOX", date: "2024-09-16 10:00",
  ts: 7, subject: "Scans from the family archive",
  addr: "hello@photoarchive.example", size: 12000, seen: true, ai: null };
const detail = (over: Partial<MessageDetail> = {}): MessageDetail => ({
  from: '"Photo Archive" <hello@photoarchive.example>', to: "Me <me@self.example>",
  date: "Mon, 16 Sep 2024 10:00:00 +0000", subject: mail.subject,
  text: "Hello,\n\nScans from the family archive.", ...over });
const host: ReaderHost = { selfAddrs: ["me@self.example"], account: "proton",
  folders: [] };

const phone = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({
  get matches() { return on && q.includes("639"); }, media: q,
  addEventListener: () => {}, removeEventListener: () => {},
}));

const show = (onBack = () => {}) => render(
  <ToastProvider>
    <ReaderHostProvider value={host}>
      <MessageView mail={mail} onBack={onBack} />
    </ReaderHostProvider>
  </ToastProvider>);

const ATTS = [{ name: "scan-1.pdf", size: 5000 },
  { name: "scan-2.pdf", size: 5000 }];

test("a chip still shows name and size and opens the menu; the item starts "
  + "the removal for that one file", async () => {
  phone(false);
  message.mockResolvedValue(detail({ atts: ATTS }));
  removeFlow.mockResolvedValue("started");
  const back = vi.fn();
  show(back);
  const chip = await screen.findByRole("button",
    { name: "scan-1.pdf, 5000 B. Options" });
  expect(chip.textContent).toBe("scan-1.pdf · 5000 B");
  expect(chip.getAttribute("aria-haspopup")).toBe("menu");
  fireEvent.click(chip);
  expect(screen.getByRole("menu").textContent).toContain("5000 B · PDF");
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Remove the file, keep the mail…" }));
  await waitFor(() => expect(removeFlow).toHaveBeenCalledTimes(1));
  expect(removeFlow).toHaveBeenCalledWith([{ name: "scan-1.pdf", size: 5000,
    kind: "pdf", mails: [{ folder: "INBOX", uid: 7,
      addr: "hello@photoarchive.example", subject: mail.subject }] }]);
  // started: the reader goes back (the mail's UID is replaced by the copy)
  await waitFor(() => expect(back).toHaveBeenCalled());
});

test("a refused removal says so in a toast and the reader stays", async () => {
  phone(false);
  message.mockResolvedValue(detail({ atts: ATTS }));
  removeFlow.mockRejectedValue(new Error("Scan the account first."));
  const back = vi.fn();
  show(back);
  fireEvent.click(await screen.findByRole("button",
    { name: "scan-2.pdf, 5000 B. Options" }));
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Remove the file, keep the mail…" }));
  await screen.findByText(/Scan the account first\./);
  expect(back).not.toHaveBeenCalled();
});

test("a stopped or cancelled removal leaves the reader open", async () => {
  phone(false);
  message.mockResolvedValue(detail({ atts: ATTS }));
  removeFlow.mockResolvedValue("cancelled");
  const back = vi.fn();
  show(back);
  fireEvent.click(await screen.findByRole("button",
    { name: "scan-1.pdf, 5000 B. Options" }));
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Remove the file, keep the mail…" }));
  await waitFor(() => expect(removeFlow).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 30));
  expect(back).not.toHaveBeenCalled();
});

test("on a phone the chip opens a sheet: the file, the action, Cancel", async () => {
  phone(true);
  message.mockResolvedValue(detail({ atts: ATTS }));
  removeFlow.mockResolvedValue("started");
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "scan-1.pdf, 5000 B. Options" }));
  const sheet = screen.getByRole("dialog", { name: "scan-1.pdf" });
  expect(within(sheet).getByText("5000 B · PDF")).toBeTruthy();
  // Cancel closes it and starts nothing
  fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "scan-1.pdf" })).toBeNull();
  expect(removeFlow).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",
    { name: "scan-1.pdf, 5000 B. Options" }));
  fireEvent.click(screen.getByRole("button",
    { name: "Remove the file, keep the mail…" }));
  await waitFor(() => expect(removeFlow).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog", { name: "scan-1.pdf" })).toBeNull();
});

test("German: the menu, the sheet and the labels", async () => {
  setLang("de");
  phone(false);
  message.mockResolvedValue(detail({ atts: ATTS }));
  show();
  fireEvent.click(await screen.findByRole("button",
    { name: "scan-1.pdf, 5000 B. Optionen" }));
  expect(screen.getByRole("menuitem",
    { name: "Datei entfernen, Mail behalten…" })).toBeTruthy();
});

test("without attachment facts there is no chip and so no menu", async () => {
  phone(false);
  message.mockResolvedValue(detail({ atts: null }));
  show();
  await screen.findByText(/Scans from the family archive\./);
  expect(screen.queryByRole("button", { name: /Options/ })).toBeNull();
});

test("a mail that lost files shows chips for them and the note under the text",
  async () => {
  phone(false);
  message.mockResolvedValue(detail({
    atts: [{ name: "keep.png", size: 3000 }],
    removed: [{ name: "scan-1.pdf", size: 5000, date: "2026-11-25" },
      { name: "scan-2.pdf", size: 5000, date: "2026-11-25" }] }));
  show();
  expect(await screen.findByText("scan-1.pdf removed · 5000 B")).toBeTruthy();
  expect(screen.getByText("scan-2.pdf removed · 5000 B")).toBeTruthy();
  // the kept file is still a chip with a menu of its own
  expect(screen.getByRole("button", { name: "keep.png, 3000 B. Options" }))
    .toBeTruthy();
  expect(screen.getByText(
    /^scan-1\.pdf \(5000 B\), scan-2\.pdf \(5000 B\) were removed by Inboxrake on .+\. The original mail is in Trash until it is emptied\.$/))
    .toBeTruthy();
});

test("one removed file: the note says 'was'; German wording", async () => {
  phone(false);
  message.mockResolvedValue(detail({
    removed: [{ name: "scan-1.pdf", size: 5000, date: "2026-11-25" }] }));
  const r = show();
  expect(await screen.findByText(/^scan-1\.pdf \(5000 B\) was removed by Inboxrake/))
    .toBeTruthy();
  r.unmount();
  setLang("de");
  show();
  expect(await screen.findByText("scan-1.pdf entfernt · 5000 B")).toBeTruthy();
  expect(screen.getByText(/^scan-1\.pdf \(5000 B\) wurde am .* von Inboxrake entfernt\. Die ursprüngliche Mail liegt im Papierkorb, bis er geleert wird\.$/))
    .toBeTruthy();
});

test("a mail that lost nothing shows no note", async () => {
  phone(false);
  message.mockResolvedValue(detail({ atts: ATTS }));
  show();
  await screen.findByText(/Scans from the family archive\./);
  expect(screen.queryByText(/removed by Inboxrake/)).toBeNull();
});
