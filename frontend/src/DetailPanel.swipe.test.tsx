// @vitest-environment jsdom
/* Sender detail: the mail rows swipe like All mail (V5) - Trash on a swipe
   left, Pin / Read on a swipe right, through the panel's own mail actions. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const group_ = vi.fn();
const deleteMessages = vi.fn().mockResolvedValue({});
const pin = vi.fn().mockResolvedValue({ ok: true, pinned: true });

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: {
    group: (...a: unknown[]) => group_(...a),
    deleteMessages: (...a: unknown[]) => deleteMessages(...a),
    pin: (...a: unknown[]) => pin(...a),
  } };
});

import { DetailPanel } from "./components/DetailPanel";
import { DialogProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog } from "./dialogTestUtils";
import type { Group, Mail } from "./types";

const mail = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0, subject: `Mail ${uid}`,
  addr: "s@x.example", size: 1000, seen: true, ai: null, ...over,
});
const group: Group = {
  key: "s@x.example", label: "Sender", sub: "s@x.example", count: 3,
  size: 3000, unread: 1, first: "2025-01-01", last: "2025-01-02", tags: [],
  samples: [], bulk: false, unsub: false, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 50,
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer: coarse"), media: q,
    addEventListener() {}, removeEventListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(390);
});
afterEach(() => {
  cleanup(); deleteMessages.mockClear(); pin.mockClear();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function open(mails: Mail[]) {
  group_.mockResolvedValue(mails);
  render(<DialogProvider><DetailPanel grouping="sender" group={group}
    aiEnabled={false} protectedNow={false} unsubscribedNow={null}
    onUnsubscribe={() => {}} onTrash={async () => true} folders={[]} sieve={false} variant="pane"
    onClose={() => {}} onDeleted={() => {}} /></DialogProvider>);
  await screen.findByText("Mail 1");
}

function fire(target: Element | Window, name: string, x: number, t: number) {
  const ev = new Event(name, { bubbles: true, cancelable: true });
  Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: 0 },
    pointerId: { value: 1 }, isPrimary: { value: true },
    pointerType: { value: "touch" }, timeStamp: { value: t } });
  act(() => { target.dispatchEvent(ev); });
}
const swipe = (el: Element, xs: number[]) => {
  fire(el, "pointerdown", xs[0], 0);
  xs.slice(1).forEach((x, i) => fire(window, "pointermove", x, (i + 1) * 100));
  fire(window, "pointerup", xs[xs.length - 1], xs.length * 100);
};
const body = (subject: string) =>
  screen.getByText(subject).closest<HTMLElement>("[data-swipe-body]")!;

test("a full swipe left on a mail asks the Trash confirm, then moves just that mail", async () => {
  await open([mail(1), mail(2), mail(3)]);
  swipe(body("Mail 2"), [350, 250, 150, 40]);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Mail 2");
  expect(deleteMessages).not.toHaveBeenCalled();
  await pressDialog(/^Move to Trash \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 2]], "trash", "", false));
});

test("declining the confirm moves nothing", async () => {
  await open([mail(1), mail(2)]);
  swipe(body("Mail 1"), [350, 250, 150, 40]);
  await cancelDialog();
  await expectNoDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
});

test("swiping a pinned mail to Trash keeps the pinned-mail warning", async () => {
  await open([mail(1, { pinned: true }), mail(2)]);
  swipe(body("Mail 1"), [350, 250, 150, 40]);
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Mail 1");
  expect(dlg.textContent).toMatch(/protected|pinned/i);
  await cancelDialog();
  expect(deleteMessages).not.toHaveBeenCalled();
});

test("a full swipe right pins through the row's Pin handler", async () => {
  await open([mail(1), mail(2)]);
  swipe(body("Mail 2"), [60, 160, 260, 360]);
  await waitFor(() => expect(pin).toHaveBeenCalledWith("INBOX", 2, true));
});

test("Read is offered for unread mail only and marks through the confirm", async () => {
  await open([mail(1, { seen: false }), mail(2)]);
  swipe(body("Mail 2"), [100, 200, 300]);
  expect(within(body("Mail 2").parentElement!.firstElementChild as HTMLElement)
    .queryByRole("button", { name: "Mark read" })).toBeNull();
  swipe(body("Mail 1"), [100, 200, 300]);
  fireEvent.click(within(body("Mail 1").parentElement!.firstElementChild as HTMLElement)
    .getByRole("button", { name: "Mark read" }));
  const dlg = await findDialog();
  expect(dlg.textContent).toContain("Mark as read");
  await pressDialog(/^Mark as read \(1\)/);
  await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
    [["INBOX", 1]], "mark_read", "", false));
});
