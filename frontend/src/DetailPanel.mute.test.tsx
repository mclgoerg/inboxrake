// @vitest-environment jsdom
/* "Mute this conversation…" is the LAST item of the sender pane's More menu in
 * Thread grouping (after Read conversation and Protect all mails in this
 * group, which stay); in the other groupings it does not exist. */

import { cleanup, fireEvent, render, screen, waitFor } from
  "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import type { Group, Mail } from "./types";

const group_ = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      group: (...args: unknown[]) => group_(...args),
      folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
      message: () => Promise.resolve({ from: "", to: "", date: "",
        subject: "", text: "body" }),
      thread: vi.fn(),
    },
  };
});

import { DetailPanel } from "./components/DetailPanel";
import { DialogProvider } from "./components/ui";

const mkMail = (uid: number): Mail => ({
  uid, folder: "INBOX", date: "2025-01-01", ts: 0, subject: `Mail ${uid}`,
  addr: "kim@team.example", size: 1000, seen: true, ai: null,
});

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: "4f9c1e0a7b2d3c58", label: "Team dinner on Friday",
  sub: "23 mails, 7 senders", count: 2, size: 2000, unread: 0,
  first: "2025-01-01", last: "2025-01-02", tags: [], samples: [], bulk: false,
  unsub: false, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 50,
  ...over,
});

const noop = () => {};

const renderPanel = (extra: Partial<Parameters<typeof DetailPanel>[0]> = {}) => {
  group_.mockResolvedValue([mkMail(1), mkMail(2)]);
  return render(<DialogProvider>
    <DetailPanel grouping="thread" group={mkGroup()} aiEnabled={false}
      protectedNow={false} unsubscribedNow={null} onUnsubscribe={noop}
      onTrash={async () => true} folders={["Archive"]} sieve={false}
      onClose={noop} onDeleted={noop} {...extra} />
  </DialogProvider>);
};

const openMore = async () => {
  await waitFor(() => screen.getByText("Mail 1"));
  fireEvent.click(screen.getByRole("button", { name: /^(More|Mehr)$/ }));
};
const items = () => screen.getAllByRole("menuitem")
  .map((i) => i.textContent?.trim());

beforeEach(() => { setLang("en"); group_.mockReset(); });
afterEach(cleanup);

it("ends the More menu of a conversation with Mute", async () => {
  const onMute = vi.fn();
  const group = mkGroup();
  renderPanel({ group, onMute, onUnmute: vi.fn() });
  await openMore();
  expect(items()).toEqual(["Read conversation",
    "Protect all mails in this group", "Mute this conversation…"]);
  fireEvent.click(screen.getByRole("menuitem",
    { name: /Mute this conversation/ }));
  expect(onMute).toHaveBeenCalledWith(expect.objectContaining(
    { key: "4f9c1e0a7b2d3c58" }));
});

it("says Unmute while the conversation is muted", async () => {
  const onUnmute = vi.fn();
  renderPanel({ onMute: vi.fn(), onUnmute, muted: true });
  await openMore();
  expect(items().at(-1)).toBe("Unmute this conversation");
  fireEvent.click(screen.getByRole("menuitem",
    { name: "Unmute this conversation" }));
  expect(onUnmute).toHaveBeenCalledOnce();
});

it("is not offered in the other groupings, or without the handler",
  async () => {
    renderPanel({ grouping: "sender", onMute: vi.fn(), onUnmute: vi.fn() });
    await openMore();
    expect(screen.queryByRole("menuitem", { name: /Mute this/ })).toBeNull();
    cleanup();

    renderPanel({});
    await openMore();
    expect(screen.queryByRole("menuitem", { name: /Mute this/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Read conversation" }))
      .toBeTruthy();
  });

it("German", async () => {
  setLang("de");
  renderPanel({ onMute: vi.fn(), onUnmute: vi.fn() });
  await openMore();
  expect(items().at(-1)).toBe("Konversation stummschalten…");
});
