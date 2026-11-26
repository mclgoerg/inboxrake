// @vitest-environment jsdom
/* Waiting for a reply in a sender's pane: one line while you wait on that
 * sender, with a Show that opens the mail on the page. Nothing else of the
 * pane changes. */
import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const SENDER = "steuerberater@kanzlei-brandt.example";
const mk = (uid: number): Mail => ({
  uid, folder: "INBOX", date: "2026-10-0" + (uid % 9 + 1), ts: 1790000000 + uid,
  subject: `Mail ${uid}`, addr: SENDER, size: 1000, seen: true, ai: null,
  pinned: false,
});
const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: SENDER, label: SENDER, sub: SENDER, count: 2, size: 2000, unread: 0,
  first: "2025-01-01", last: "2025-01-02", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  ...over,
});
// 16 Nov 2026, noon UTC (a day that stays 16 Nov in every zone)
const SINCE = Date.UTC(2026, 10, 16, 12) / 1000;
const LINE = { id: "<tax@self.example>", ts: SINCE, days: 9, overdue: true,
  usual_days: 3, subject: "Documents for the 2025 tax return" };

const noop = () => {};
const onShow = vi.fn();
function renderPanel(extra: Partial<Parameters<typeof DetailPanel>[0]> = {},
  grouping: "sender" | "domain" | "smart" = "sender",
  group: Group = mkGroup()) {
  group_.mockResolvedValue([mk(1), mk(2)]);
  return render(<ToastProvider><DialogProvider>
    <DetailPanel grouping={grouping} group={group}
      aiEnabled={false} protectedNow={false} unsubscribedNow={null}
      onUnsubscribe={noop} onTrash={async () => true}
      folders={["Archive"]} sieve={false} variant="pane" onClose={noop}
      onDeleted={noop} pickEnv={{ account: "default", onOpenRules: noop }}
      waiting={{ enabled: true, onShow }} {...extra} />
  </DialogProvider></ToastProvider>);
}

beforeEach(() => {
  setLang("en");
  waitingSender.mockResolvedValue({ waiting: LINE });
});
afterEach(() => {
  cleanup(); onShow.mockReset(); waitingSender.mockReset(); group_.mockReset();
  setLang("en");
});

describe("the line in the sender pane", () => {
  it("says since when you wait and how long they usually take", async () => {
    renderPanel();
    const line = await screen.findByTestId("waiting-line");
    expect(within(line).getByText(
      /^You're waiting for their reply since 16 Nov · usually 3\sdays$/))
      .toBeTruthy();
    expect(waitingSender).toHaveBeenCalledWith(SENDER);
  });

  it("Show opens that mail on the page", async () => {
    renderPanel();
    fireEvent.click(within(await screen.findByTestId("waiting-line"))
      .getByRole("button", { name: "Show" }));
    expect(onShow).toHaveBeenCalledWith("<tax@self.example>");
  });

  it("without a usual time it names only the date", async () => {
    waitingSender.mockResolvedValue({ waiting: { ...LINE, usual_days: null } });
    renderPanel();
    expect(await screen.findByText(/^You're waiting for their reply since 16 Nov$/))
      .toBeTruthy();
  });

  it("one day of usual time reads in the singular", async () => {
    waitingSender.mockResolvedValue({ waiting: { ...LINE, usual_days: 1 } });
    renderPanel();
    expect(await screen.findByText(/usually 1\sday$/)).toBeTruthy();
  });

  it("German (du)", async () => {
    setLang("de");
    renderPanel();
    expect(await screen.findByText(
      /^Du wartest seit 16\. Nov\.? auf eine Antwort · meist 3\sTage$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zeigen" })).toBeTruthy();
  });
});

describe("only where it means something", () => {
  it("nothing when you are not waiting on them", async () => {
    waitingSender.mockResolvedValue({ waiting: null });
    renderPanel();
    await waitFor(() => expect(waitingSender).toHaveBeenCalled());
    await screen.findByText("Mail 1");
    expect(screen.queryByTestId("waiting-line")).toBeNull();
  });

  it("nothing is asked while the account does not watch its sent mail", async () => {
    renderPanel({ waiting: { enabled: false, onShow } });
    await screen.findByText("Mail 1");
    expect(waitingSender).not.toHaveBeenCalled();
    expect(screen.queryByTestId("waiting-line")).toBeNull();
  });

  it("nothing for a domain row (more than one sender)", async () => {
    renderPanel({}, "domain", mkGroup({ key: "kanzlei-brandt.example" }));
    await screen.findByText("Mail 1");
    expect(waitingSender).not.toHaveBeenCalled();
    expect(screen.queryByTestId("waiting-line")).toBeNull();
  });

  it("the line goes when the account stops watching its sent mail", async () => {
    const view = renderPanel();
    await screen.findByTestId("waiting-line");
    view.rerender(<ToastProvider><DialogProvider>
      <DetailPanel grouping="sender" group={mkGroup()} aiEnabled={false}
        protectedNow={false} unsubscribedNow={null} onUnsubscribe={noop}
        onTrash={async () => true} folders={["Archive"]} sieve={false}
        variant="pane" onClose={noop} onDeleted={noop}
        pickEnv={{ account: "default", onOpenRules: noop }}
        waiting={{ enabled: false, onShow }} />
    </DialogProvider></ToastProvider>);
    expect(screen.queryByTestId("waiting-line")).toBeNull();
  });

  it("a failed lookup draws nothing", async () => {
    waitingSender.mockRejectedValue(new Error("down"));
    renderPanel();
    await screen.findByText("Mail 1");
    await waitFor(() => expect(waitingSender).toHaveBeenCalled());
    expect(screen.queryByTestId("waiting-line")).toBeNull();
  });

  it("a pane without the prop is today's pane", async () => {
    renderPanel({ waiting: undefined });
    await screen.findByText("Mail 1");
    expect(waitingSender).not.toHaveBeenCalled();
  });
});

describe("the pane keeps what it had", () => {
  it("every action of the row is still there with the line shown", async () => {
    renderPanel({ onMove: async () => true, onProtect: noop, onBlock: noop },
      "sender", mkGroup({ unsub: true }));
    await screen.findByTestId("waiting-line");
    for (const name of [/^Unsubscribe/, /Block/, /Protect/, /Move/])
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    expect(screen.getByText("Mail 1")).toBeTruthy();
  });
});
