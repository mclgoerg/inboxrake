// @vitest-environment jsdom
/* Conversation reader: oldest-first stack of collapsible mails (incl. the
 * user's Sent replies), lazy bodies fetched in batches over one request,
 * folded quotes, notes, and the entry point from MessageView. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageView } from "./components/MailList";
import { ThreadView } from "./components/ThreadView";
import { setLang } from "./i18n";
import type { ConversationResp, Mail, MessageDetail } from "./types";

const thread = vi.fn();
const message = vi.fn();          // single mail (MessageView)
const messages = vi.fn();         // batch (ThreadView)

vi.mock("./api", () => ({
  api: {
    thread: (...a: unknown[]) => thread(...a),
    message: (...a: unknown[]) => message(...a),
    messages: (...a: unknown[]) => messages(...a),
  },
  fmtSize: () => "1 KB",
  mailKey: (m: { folder: string; uid: number }) => `${m.folder}\0${m.uid}`,
}));

const mk = (uid: number, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: `2024-03-0${uid % 9} 10:00`, ts: uid,
  subject: "Plan", addr: "boss@corp.example", size: 1, seen: true, ai: null,
  ...over,
});
const a1 = mk(1), r1 = mk(2, { folder: "Sent", sent: true,
  addr: "me@self.example", subject: "Re: Plan" });
const a2 = mk(3, { seen: false, subject: "Re: Plan" });

const conv = (notes: ConversationResp["notes"] = [],
              mails: Mail[] = [a1, r1, a2]): ConversationResp =>
  ({ key: "k", label: "Plan", mails, notes });

const bodyOf = (text: string): MessageDetail =>
  ({ from: "x", to: "y", date: "d", subject: "s", text });

/** The batch endpoint: a text per uid, `bad` uids answer with an error. */
const serve = (text = (uid: number) => `body of ${uid}`, bad: number[] = []) =>
  messages.mockImplementation((items: [string, number][]) =>
    Promise.resolve({ messages: items.map(([folder, uid]) => ({
      folder, uid, ...(bad.includes(uid) ? { error: "fetch failed" }
        : bodyOf(text(uid))) })) }));

afterEach(() => {
  cleanup();
  thread.mockReset();
  message.mockReset();
  messages.mockReset();
  setLang("en");
});

test("lists the conversation oldest first with the user's replies as You",
  async () => {
    thread.mockResolvedValue(conv());
    serve();
    render(<ThreadView mail={a2} onBack={() => {}} />);
    await screen.findByText("3 mails");
    expect(thread).toHaveBeenCalledWith("INBOX", 3);
    // one card per mail (the toolbar's menus are popups, not cards)
    expect(document.querySelectorAll("[aria-expanded]:not([aria-haspopup])"))
      .toHaveLength(3);
    expect(screen.getByText(/^You/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("boss@corp.example"))
      .toBeLessThan(text.indexOf("You"));
  });

test("the opened mail's text is reused - no request for it", async () => {
  thread.mockResolvedValue(conv());
  serve();
  render(<ThreadView mail={a2} initial={bodyOf("already loaded")}
    onBack={() => {}} />);
  await screen.findByText("already loaded");
  expect(messages).not.toHaveBeenCalled();
});

test("expanding a card fetches just that mail, once", async () => {
  thread.mockResolvedValue(conv());
  serve();
  render(<ThreadView mail={a2} initial={bodyOf("opened")}
    onBack={() => {}} />);
  await screen.findByText("opened");
  fireEvent.click(screen.getByText(/^You/));
  await screen.findByText("body of 2");
  expect(messages).toHaveBeenCalledTimes(1);
  expect(messages).toHaveBeenCalledWith([["Sent", 2]]);
  // collapsing and re-opening does not refetch
  fireEvent.click(screen.getByText(/^You/));
  fireEvent.click(screen.getByText(/^You/));
  expect(messages).toHaveBeenCalledTimes(1);
});

test("expand all loads in batches of 8 instead of one request per mail",
  async () => {
    const many = Array.from({ length: 12 }, (_, i) => mk(i + 1));
    thread.mockResolvedValue(conv([], many));
    serve();
    render(<ThreadView mail={many[0]} initial={bodyOf("first")}
      onBack={() => {}} />);
    await screen.findByText("first");
    fireEvent.click(screen.getByText("Expand all"));
    await screen.findByText("body of 12");
    expect(messages.mock.calls.map((c) => c[0].length)).toEqual([8, 3]);
    fireEvent.click(screen.getByText("Collapse all"));
    expect(document.querySelectorAll('[aria-expanded="true"]:not([aria-haspopup])'))
      .toHaveLength(0);
    expect(document.querySelector(".type-reader")).toBeNull();
  });

test("quoted history is folded behind a toggle", async () => {
  thread.mockResolvedValue(conv());
  render(<ThreadView mail={a2} onBack={() => {}}
    initial={bodyOf("Sounds good.\n\nOn Mon, Boss wrote:\n> Can we meet?\n")}
  />);
  await screen.findByText(/Sounds good\./);
  expect(screen.queryByText(/Can we meet/)).toBeNull();
  fireEvent.click(screen.getByText("Show quoted text"));
  expect(screen.getByText(/Can we meet/)).toBeTruthy();
  fireEvent.click(screen.getByText("Hide quoted text"));
  expect(screen.queryByText(/Can we meet/)).toBeNull();
});

test("a mail that cannot be loaded shows its error in that card only",
  async () => {
    thread.mockResolvedValue(conv());
    serve(undefined, [2]);
    render(<ThreadView mail={a2} initial={bodyOf("ok")} onBack={() => {}} />);
    await screen.findByText("ok");
    fireEvent.click(screen.getByText(/^You/));
    await screen.findByText("fetch failed");
    expect(screen.getByText("ok")).toBeTruthy();
  });

test("a failed batch request marks its mails with the error", async () => {
  thread.mockResolvedValue(conv());
  messages.mockRejectedValue(new Error("connection reset"));
  render(<ThreadView mail={a2} initial={bodyOf("ok")} onBack={() => {}} />);
  await screen.findByText("3 mails");
  fireEvent.click(screen.getByText(/^You/));
  await screen.findByText("connection reset");
});

test("server notes are shown and a failed conversation load is reported",
  async () => {
    thread.mockResolvedValue(conv([{ key: "sent_unavailable", params: {} }]));
    const { unmount } = render(<ThreadView mail={a2} initial={bodyOf("x")}
      onBack={() => {}} />);
    await screen.findByText(/could not be loaded from the Sent folder/);
    unmount();
    thread.mockRejectedValue(new Error("boom"));
    render(<ThreadView mail={a2} initial={bodyOf("x")} onBack={() => {}} />);
    await screen.findByText("boom");
  });

test("the toolbar acts on nothing while the conversation loads or failed",
  async () => {
    const trash = vi.fn().mockResolvedValue(true);
    thread.mockReturnValue(new Promise(() => {}));            // still loading
    const { unmount } = render(<ThreadView mail={a2} initial={bodyOf("x")}
      onBack={() => {}} actions={{ trash }} />);
    const btn = () => screen.getByRole("button", { name: "Trash this mail" });
    expect((btn() as HTMLButtonElement).disabled).toBe(true);
    unmount();
    thread.mockReset();
    thread.mockRejectedValue(new Error("boom"));              // failed
    render(<ThreadView mail={a2} initial={bodyOf("x")} onBack={() => {}}
      actions={{ trash }} />);
    await screen.findByText("boom");
    expect((btn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/did not load - Trash, Pin and Move are off/))
      .toBeTruthy();
    expect(trash).not.toHaveBeenCalled();
  });

test("back returns to the caller", async () => {
  thread.mockResolvedValue(conv());
  const onBack = vi.fn();
  render(<ThreadView mail={a1} initial={bodyOf("x")} onBack={onBack} />);
  await screen.findByText("3 mails");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalled();
});

// ------------------------------------------------- entry from a mail

test("MessageView offers the reader only for threaded mails, and hands the "
  + "loaded text over", async () => {
  message.mockResolvedValue({ ...bodyOf("single"), thread: null });
  const { unmount } = render(<MessageView mail={a1} onBack={() => {}} />);
  await screen.findByText("single");
  expect(screen.queryByRole("button", { name: "Read conversation" })).toBeNull();
  unmount();

  message.mockResolvedValue({ ...bodyOf("part of a thread"),
    thread: { count: 2 } });
  thread.mockResolvedValue(conv());
  render(<MessageView mail={a1} onBack={() => {}} />);
  await screen.findByText("part of a thread");
  fireEvent.click(screen.getByRole("button", { name: "Read conversation" }));
  await screen.findByText("3 mails");
  expect(screen.getByText("part of a thread")).toBeTruthy();   // not refetched
  expect(messages).not.toHaveBeenCalled();
  // and back from the reader lands on the single message again (named so)
  fireEvent.click(screen.getByRole("button", { name: "Mail" }));
  await screen.findByRole("button", { name: "Read conversation" });
});

// ------------------------------------------------- cards (board 50)

test("own replies are marked 'from Sent'; the header counts them", async () => {
  thread.mockResolvedValue(conv());
  serve();
  render(<ThreadView mail={a2} initial={bodyOf("opened")} onBack={() => {}} />);
  await screen.findByText("3 mails");
  expect(screen.getByText(/you replied once/)).toBeTruthy();
  expect(screen.getByText("from Sent")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Plan" })).toBeTruthy();
});

test("a conversation without replies says nothing about replies", async () => {
  thread.mockResolvedValue(conv([], [a1, a2]));
  render(<ThreadView mail={a2} initial={bodyOf("opened")} onBack={() => {}} />);
  await screen.findByText("2 mails");
  expect(screen.queryByText(/you replied/)).toBeNull();
  expect(screen.queryByText("from Sent")).toBeNull();
});

test("collapsed cards preview the subject, then the text once it was loaded",
  async () => {
    thread.mockResolvedValue(conv());
    serve((uid) => `Hello from ${uid}\n\nmore`);
    render(<ThreadView mail={a2} initial={bodyOf("opened")} onBack={() => {}} />);
    await screen.findByText("3 mails");
    // not loaded yet: the subject stands in (no extra fetch for previews)
    expect(screen.getAllByText("Plan").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/^You/));            // open the reply ...
    await screen.findByText(/Hello from 2/);
    fireEvent.click(screen.getByText(/^You/));            // ... and fold it again
    expect(screen.getByText("Hello from 2")).toBeTruthy();  // one-line preview
  });

test("Expand all is a plain text button, not an underlined link", async () => {
  thread.mockResolvedValue(conv());
  render(<ThreadView mail={a2} initial={bodyOf("x")} onBack={() => {}} />);
  await screen.findByText("3 mails");
  const btn = screen.getByRole("button", { name: "Expand all" });
  expect(btn.className).not.toContain("underline");
});

test("the toolbar acts on the mail the reader was opened from", async () => {
  thread.mockResolvedValue(conv());
  const trash = vi.fn();
  render(<ThreadView mail={a2} initial={bodyOf("x")} onBack={() => {}}
    actions={{ trash }} />);
  await screen.findByText("3 mails");
  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  expect(trash).toHaveBeenCalledWith(a2);
  // no Conversation button inside the conversation
  expect(screen.queryByRole("button", { name: "Read conversation" })).toBeNull();
});

test("a collapsed card shows the sender's name learnt from an opened mail",
  async () => {
    thread.mockResolvedValue(conv([], [a1, a2]));
    render(<ThreadView mail={a2} onBack={() => {}}
      initial={{ ...bodyOf("opened"), from: "Boss Person <boss@corp.example>" }} />);
    await screen.findByText("2 mails");
    // a1 is collapsed and has the same address as the opened a2
    expect(screen.getAllByText("Boss Person")).toHaveLength(2);
  });

test("another mail (previous / next) restarts the conversation: the open "
  + "card is always the mail the toolbar acts on", async () => {
  thread.mockResolvedValue(conv());
  serve();
  const trash = vi.fn();
  const { rerender } = render(<ThreadView mail={a1} initial={bodyOf("first")}
    onBack={() => {}} actions={{ trash }} />);
  await screen.findByText("3 mails");
  await screen.findByText("first");
  rerender(<ThreadView mail={a2} onBack={() => {}} actions={{ trash }} />);
  await waitFor(() => expect(thread).toHaveBeenLastCalledWith("INBOX", 3));
  await screen.findByText("body of 3");                     // a2 is shown ...
  expect(screen.queryByText("first")).toBeNull();           // ... a1's card is not
  expect(document.querySelectorAll(
    '[aria-expanded="true"]:not([aria-haspopup])')).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Trash this mail" }));
  expect(trash).toHaveBeenCalledWith(a2);                   // ... and it is the target
});

// ----------------------------------- which mail the toolbar acts on

const cards = () => [...document.querySelectorAll(
  "[aria-expanded]:not([aria-haspopup])")] as HTMLElement[];
const trashBtn = () => screen.getByRole("button", { name: "Trash this mail" }) as HTMLButtonElement;

test("the toolbar acts on the ONE open card, which is marked; collapsing the "
  + "target and opening another moves the target", async () => {
  thread.mockResolvedValue(conv([], [a1, a2]));
  serve();
  const trash = vi.fn();
  render(<ThreadView mail={a2} initial={bodyOf("opened")} onBack={() => {}}
    actions={{ trash }} />);
  await screen.findByText("2 mails");
  expect(screen.getAllByText("This mail")).toHaveLength(1);
  fireEvent.click(trashBtn());
  expect(trash).toHaveBeenLastCalledWith(a2);

  fireEvent.click(cards()[1]);                          // collapse a2 (the target)
  expect(trashBtn().disabled).toBe(true);               // nothing open: off, with a hint
  expect(screen.getByText("Open one mail to act on it.")).toBeTruthy();
  expect(screen.queryByText("This mail")).toBeNull();
  fireEvent.click(cards()[0]);                          // open a1
  await screen.findByText("body of 1");
  expect(trashBtn().disabled).toBe(false);
  expect(screen.queryByText("Open one mail to act on it.")).toBeNull();
  fireEvent.click(trashBtn());
  expect(trash).toHaveBeenLastCalledWith(a1);           // it names the OPEN one
  expect(screen.getAllByText("This mail")).toHaveLength(1);
  expect(cards()[0].closest("div.mb-2")!.className).toContain("border-accent");
});

test("Collapse all and Expand all switch Trash / Pin / Move off", async () => {
  thread.mockResolvedValue(conv([], [a1, a2]));
  serve();
  render(<ThreadView mail={a2} initial={bodyOf("opened")} onBack={() => {}}
    actions={{ trash: vi.fn(), move: vi.fn(), pin: vi.fn() }} />);
  await screen.findByText("2 mails");
  fireEvent.click(screen.getByText("Expand all"));
  await screen.findByText("body of 1");
  expect(trashBtn().disabled).toBe(true);               // several open: no target
  expect((screen.getByRole("button", { name: "Pin" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("This mail")).toBeNull();
  expect(screen.getByText("Open one mail to act on it.")).toBeTruthy();
  fireEvent.click(screen.getByText("Collapse all"));
  expect(trashBtn().disabled).toBe(true);               // none open
  expect(screen.getByText("Open one mail to act on it.")).toBeTruthy();
});

test("your own Sent mail is never a target: actions are off with a reason",
  async () => {
    thread.mockResolvedValue(conv());
    serve();
    render(<ThreadView mail={a2} initial={bodyOf("opened")} onBack={() => {}}
      actions={{ trash: vi.fn() }} />);
    await screen.findByText("3 mails");
    fireEvent.click(cards()[2]);                        // fold a2
    fireEvent.click(cards()[1]);                        // open the reply from Sent
    await screen.findByText("body of 2");
    expect(trashBtn().disabled).toBe(true);
    expect(screen.getByText("Your own sent mail cannot be changed here.")).toBeTruthy();
  });
