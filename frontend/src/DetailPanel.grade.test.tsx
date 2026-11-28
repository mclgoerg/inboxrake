// @vitest-environment jsdom
/* The report card in a sender's pane: a box after "What they send" and the
 * waiting line, before the Mails list; nothing else of the pane moves. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gradedGroup, mkGrade } from "./gradeTestUtil";
import { setLang } from "./i18n";
import type { Group, Mail } from "./types";

const group_ = vi.fn();
const waitingSender = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      group: (...args: unknown[]) => group_(...args),
      waitingSender: (...args: unknown[]) => waitingSender(...args),
      deleteMessages: () => Promise.resolve({}),
      rules: () => Promise.resolve({ rules: [], cap: 500 }),
      folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
    },
  };
});

import { DetailPanel } from "./components/DetailPanel";
import { DialogProvider, ToastProvider } from "./components/ui";

const SENDER = "shop@acme.example";
const mk = (uid: number, kind: string): Mail => ({
  uid, folder: "INBOX", date: "2026-10-0" + (uid % 9 + 1), ts: 1790000000 + uid,
  subject: `Mail ${uid}`, addr: SENDER, size: 1000, seen: true, ai: null,
  pinned: false, kind,
});
/** two kinds, so "What they send" shows */
const MAILS = [mk(1, "ads"), mk(2, "ads"), mk(3, "orders"), mk(4, "orders")];
let mails: Mail[] = MAILS;

const graded = (over: Partial<Group> = {}): Group => gradedGroup(
  SENDER, "ACME Store", "A", { count: 4, grade: mkGrade("A",
    { pattern: "quiet" }), ...over });

const noop = () => {};
function renderPanel(group: Group = graded(),
  grouping: "sender" | "domain" | "smart" = "sender",
  extra: Partial<Parameters<typeof DetailPanel>[0]> = {}) {
  group_.mockResolvedValue(mails);
  return render(<ToastProvider><DialogProvider>
    <DetailPanel grouping={grouping} group={group}
      aiEnabled={false} protectedNow={false} unsubscribedNow={null}
      onUnsubscribe={noop} onTrash={async () => true}
      folders={["Archive"]} sieve={false} variant="pane" onClose={noop}
      onDeleted={noop} pickEnv={{ account: "default", onOpenRules: noop }}
      waiting={{ enabled: true, onShow: noop }}
      onMove={async () => true} onProtect={noop} onBlock={noop} {...extra} />
  </DialogProvider></ToastProvider>);
}

beforeEach(() => {
  setLang("en");
  waitingSender.mockResolvedValue({ waiting: {
    id: "<x@self.example>", ts: 1790000000, days: 9, overdue: true,
    usual_days: null, subject: "Question" } });
});
afterEach(() => {
  cleanup(); group_.mockReset(); waitingSender.mockReset(); setLang("en");
  mails = MAILS;
});

const follows = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the report card in the sender pane", () => {
  it("sits after What they send and the waiting line, before Mails",
    async () => {
      renderPanel();
      const card = await screen.findByTestId("grade-card");
      const kinds = await screen.findByTestId("kinds-box");
      const waiting = await screen.findByTestId("waiting-line");
      const mails = await screen.findByRole("heading", { name: "Mails" });
      expect(follows(kinds, card)).toBe(true);
      expect(follows(waiting, card)).toBe(true);
      expect(follows(card, mails)).toBe(true);
      expect(screen.getByRole("heading",
        { name: "Grade A · quiet and useful" })).toBeTruthy();
    });

  it("stays after the arrival strip and the tiles too", async () => {
    renderPanel();
    const card = await screen.findByTestId("grade-card");
    const tiles = screen.getByText("Opened");
    expect(follows(tiles, card)).toBe(true);
  });

  it("is there without the other boxes (one kind, nothing awaited)",
    async () => {
      waitingSender.mockResolvedValue({ waiting: null });
      mails = [mk(1, ""), mk(2, "")];      // no kinds: no What they send
      renderPanel();
      expect(await screen.findByTestId("grade-card")).toBeTruthy();
      expect(screen.queryByTestId("kinds-box")).toBeNull();
      expect(screen.queryByTestId("waiting-line")).toBeNull();
    });

  it("is not there for a row without a grade (Smart, domain, subject ...)",
    async () => {
      renderPanel({ ...graded(), grade: undefined }, "smart");
      await screen.findByText("Mail 1");
      expect(screen.queryByTestId("grade-card")).toBeNull();
      cleanup();
      renderPanel({ ...graded(), grade: undefined }, "domain");
      await screen.findByText("Mail 1");
      expect(screen.queryByTestId("grade-card")).toBeNull();
    });

  it("the pane keeps everything it had (INVENTORY: header, labels, "
    + "actions, tiles, What they send, Mails list, Move N mails to Trash)",
    async () => {
      renderPanel(graded({ unsub: true }));
      await screen.findByTestId("grade-card");
      for (const name of [/^Unsubscribe/, /Block/, /Protect/, /Move/,
        /More/]) {
        expect(screen.getAllByRole("button", { name }).length)
          .toBeGreaterThan(0);
      }
      expect(screen.getAllByText("Mails").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Size")).toBeTruthy();
      expect(screen.getByText("Opened")).toBeTruthy();
      expect(screen.getByTestId("kinds-box")).toBeTruthy();
      await waitFor(() => expect(screen.getByText("Mail 1")).toBeTruthy());
      expect(screen.getByRole("button", { name: /Move 4\smails to Trash/ }))
        .toBeTruthy();
      expect(screen.getByRole("button", { name: "How grades work" }))
        .toBeTruthy();
    });

  it("German", async () => {
    setLang("de");
    renderPanel();
    expect(await screen.findByRole("heading",
      { name: "Note A · leise und nützlich" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "So entsteht die Note" }))
      .toBeTruthy();
  });
});
