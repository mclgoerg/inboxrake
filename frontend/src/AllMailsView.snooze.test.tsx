// @vitest-environment jsdom
/* Not now in All mails: the selection bar's menu snoozes exactly the ticked
   mails (the server leaves pinned ones), and the reader's own button. */

import { cleanup, fireEvent, render, screen, waitFor, within }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { epoch } from "./snooze";
import type { AppState, Mail, MailsResp } from "./types";

const mails = vi.fn();
const snooze = vi.fn();

vi.mock("./api", () => ({
  api: {
    mails: (...a: unknown[]) => mails(...a),
    snooze: (...a: unknown[]) => snooze(...a),
    pin: vi.fn(),
    folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
    message: () => Promise.resolve({ from: "x", to: "", date: "d",
      subject: "s", text: "body text" }),
  },
  fmtSize: (b: number) => `${b} B`,
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

import { AllMailsView } from "./components/AllMailsView";
import { ReaderHostProvider } from "./components/MailReader";
import { SnoozeProvider } from "./components/snoozeContext";
import { DialogProvider, ToastProvider } from "./components/ui";

// Tuesday 2026-11-24, 09:30 local
const NOW = new Date(2026, 10, 24, 9, 30);
const TOMORROW = epoch(new Date(2026, 10, 25, 8));

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: `2026-01-${10 + uid}`, ts: uid,
  subject: `Subject ${uid}`, addr: `s${uid}@x.example`, size: 100 * uid,
  seen: true, ai: null, pinned: false, ...over });
const resp = (list: Mail[]): MailsResp =>
  ({ total: list.length, offset: 0, mails: list, ignored: [] });
const state = { account: "proton", groups_rev: 1, folders: ["INBOX"],
  folders_raw: ["INBOX"] } as unknown as AppState;
const onChanged = vi.fn();
const refresh = vi.fn();

const renderView = () => render(<ToastProvider><DialogProvider>
  <SnoozeProvider value={{ refresh }}>
    <ReaderHostProvider value={{ selfAddrs: [], account: "proton",
      folders: [{ value: "INBOX", label: "INBOX" }] }}>
      <AllMailsView state={state} onChanged={onChanged} />
    </ReaderHostProvider>
  </SnoozeProvider></DialogProvider></ToastProvider>);
const tick = (uid: number) =>
  screen.getByText(`Subject ${uid}`).closest("div.flex")!
    .querySelector("input[type=checkbox]") as HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  snooze.mockResolvedValue({ ok: true, queued: 2, until: TOMORROW,
    skipped_pinned: 0, skipped_protected: 0, skipped_no_id: 0 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  mails.mockReset();
  snooze.mockReset();
  onChanged.mockReset();
  refresh.mockReset();
});

test("Not now in the selection bar snoozes the ticked mails and drops them", async () => {
  mails.mockResolvedValue(resp([mk(1), mk(2), mk(3)]));
  renderView();
  await screen.findByText("Subject 1");
  fireEvent.click(tick(1));
  fireEvent.click(tick(3));
  const bar = screen.getByRole("region", { name: "Selection actions" });
  fireEvent.click(within(bar).getByRole("button", { name: "Not now" }));
  expect(screen.getByRole("group", { name: /Snooze the 2/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: /Tomorrow morning/ }));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 1], ["INBOX", 3]] }, TOMORROW));
  await waitFor(() => expect(screen.queryByText("Subject 1")).toBeNull());
  expect(screen.getByText("Subject 2")).toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Selection actions" })).toBeNull();
});

test("a pinned mail in the selection stays in the list (the server leaves it)", async () => {
  mails.mockResolvedValue(resp([mk(1), mk(2, { pinned: true })]));
  renderView();
  await screen.findByText("Subject 1");
  fireEvent.click(tick(1));
  fireEvent.click(tick(2));
  const bar = screen.getByRole("region", { name: "Selection actions" });
  fireEvent.click(within(bar).getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Tomorrow morning/ }));
  await waitFor(() => expect(screen.queryByText("Subject 1")).toBeNull());
  expect(screen.getByText("Subject 2")).toBeTruthy();
});

test("the open mail's reader snoozes just that mail", async () => {
  mails.mockResolvedValue(resp([mk(1), mk(2)]));
  renderView();
  fireEvent.click(await screen.findByText("Subject 2"));
  fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
  const sheet = screen.getByRole("dialog", { name: "Not now" });
  fireEvent.click(within(sheet).getByRole("button", { name: /Tomorrow/ }));
  await waitFor(() => expect(snooze).toHaveBeenCalledWith(
    { items: [["INBOX", 2]] }, TOMORROW));
  await waitFor(() => expect(screen.queryByText("Subject 2")).toBeNull());
});
