// @vitest-environment jsdom
/* "What they send": the box of a sender that sends two kinds of mail or more
 * (order confirmations, shipping updates, ads ...) in the sender pane. */
import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "./i18n";
import { findPicker, pickFolder } from "./folderPickerTestUtil";
import { expectKeepBox, KEEP_FOUND } from "./keepSafeTestUtil";
import type { Group, Mail, Rule } from "./types";

const group_ = vi.fn();
const deleteMessages = vi.fn().mockResolvedValue({});
const pinMails = vi.fn();
const rules = vi.fn();
const createRule = vi.fn();
const keepSafeCheck = vi.fn();
const keepSafePin = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      group: (...args: unknown[]) => group_(...args),
      deleteMessages: (...args: unknown[]) => deleteMessages(...args),
      pinMails: (...args: unknown[]) => pinMails(...args),
      rules: (...args: unknown[]) => rules(...args),
      createRule: (...args: unknown[]) => createRule(...args),
      keepSafeCheck: (...args: unknown[]) => keepSafeCheck(...args),
      keepSafePin: (...args: unknown[]) => keepSafePin(...args),
      folders: () => Promise.resolve({ folders: [], mail_counts: {} }),
    },
  };
});

import { DetailPanel } from "./components/DetailPanel";
import { DialogProvider, ToastProvider } from "./components/ui";
import { cancelDialog, expectNoDialog, findDialog, pressDialog }
  from "./dialogTestUtils";

const SENDER = "shop@acme.example";
const mk = (uid: number, kind: string, over: Partial<Mail> = {}): Mail => ({
  uid, folder: "INBOX", date: "2026-10-0" + (uid % 9 + 1), ts: 1790000000 + uid,
  subject: `Mail ${uid}`, addr: SENDER, size: 1000, seen: true, ai: null,
  pinned: false, kind, ...over,
});
/** 3 ads (two unread), 2 order confirmations, 1 shipping update, 1 of no kind */
const MIXED = (): Mail[] => [
  mk(1, "ads", { seen: false, size: 3000 }),
  mk(2, "ads", { seen: false, size: 3000 }),
  mk(3, "ads", { size: 3000 }),
  mk(4, "orders", { size: 5000 }),
  mk(5, "orders", { size: 5000 }),
  mk(6, "shipping", { size: 2000, date: "2026-10-02", ts: 1780000000 }),
  mk(7, ""),
];

const mkGroup = (over: Partial<Group> = {}): Group => ({
  key: SENDER, label: "ACME Store", sub: SENDER, count: 7, size: 22000,
  unread: 2, first: "2025-01-01", last: "2025-01-02", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50, ...over,
});

const noop = () => {};
const onDeleted = vi.fn();
const onOpenRules = vi.fn();

function renderPanel(mails: Mail[], extra: Partial<Parameters<
    typeof DetailPanel>[0]> = {}) {
  group_.mockResolvedValue(mails);
  return render(<ToastProvider><DialogProvider>
    <DetailPanel grouping="sender" group={mkGroup({ count: mails.length })}
      aiEnabled={false} protectedNow={false} unsubscribedNow={null}
      onUnsubscribe={noop} onTrash={async () => true}
      folders={["Archive", "Promotions"]} sieve={false} variant="pane"
      onClose={noop} onDeleted={onDeleted}
      pickEnv={{ account: "default", onOpenRules }}
      {...extra} />
  </DialogProvider></ToastProvider>);
}

const box = () => screen.findByTestId("kinds-box");
const row = async (kind: string) => {
  const b = await box();
  return b.querySelector<HTMLElement>(`[data-kind="${kind}"]`)!;
};
const rowsOf = async () => [...(await box())
  .querySelectorAll<HTMLElement>("[data-testid=kind-row]")]
  .map((r) => r.dataset.kind);

beforeEach(() => {
  setLang("en");
  vi.clearAllMocks();
  deleteMessages.mockResolvedValue({});
  pinMails.mockResolvedValue({ ok: true, pinned: true, changed: 3,
    skipped: 0 });
  rules.mockResolvedValue({ rules: [], cap: 500 });
  createRule.mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the box", () => {
  it("lists one row per kind, the biggest first, with its numbers",
    async () => {
    renderPanel(MIXED());
    expect(await rowsOf()).toEqual(["ads", "orders", "shipping"]);
    const b = await box();
    expect(within(b).getByText("What they send")).toBeTruthy();
    expect(within(b).getByText("3 kinds · from the subjects")).toBeTruthy();
    const ads = await row("ads");
    expect(within(ads).getByText("Ads and offers")).toBeTruthy();
    // 3 mails, 9 KB, one of three opened
    expect(ads.textContent).toMatch(/3\smails · 9\sKB · you open 33\s?%/);
    const orders = await row("orders");
    expect(within(orders).getByText("Order confirmations")).toBeTruthy();
    expect(orders.textContent).toMatch(/2\smails .* you open 100\s?%/);
    // a shipping update says when the last one came instead
    const ship = await row("shipping");
    expect(within(ship).getByText("Shipping updates")).toBeTruthy();
    expect(ship.textContent).toMatch(/1\smail · 2\sKB · last 2\sOct/);
    expect(ship.textContent).not.toMatch(/you open/);
  });

  it("is between the tiles / arrival strip and the Mails list", async () => {
    renderPanel(MIXED());
    const b = await box();
    const heading = screen.getByRole("heading", { name: "Mails" });
    expect(b.compareDocumentPosition(heading)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const opened = screen.getByText("Opened");
    expect(opened.compareDocumentPosition(b)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("comes right after the arrival strip and before the Mails list",
    async () => {
    // 14 mails at the same hour: the strip is there
    const daily = Array.from({ length: 14 }, (_, d) => mk(d + 1,
      d % 3 ? "ads" : "orders", {
        ts: new Date(2026, 0, d + 1, 6, 10).getTime() / 1000 }));
    renderPanel(daily);
    const strip = await screen.findByText("Usually 06:00 - 07:00, every day");
    const b = await box();
    const heading = screen.getByRole("heading", { name: "Mails" });
    expect(strip.compareDocumentPosition(b)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(heading)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // nothing sits between the strip's section and the box
    const strips = strip.closest("section")!;
    expect(strips.nextElementSibling).toBe(b);
  });

  it.each([
    ["one kind only", [mk(1, "ads"), mk(2, "ads"), mk(3, "")]],
    ["no kind at all", [mk(1, ""), mk(2, "")]],
    ["mails of an older server", [mk(1, "ads", { kind: undefined }),
      mk(2, "orders", { kind: undefined })]],
    ["a kind nobody knows", [mk(1, "weird"), mk(2, "odd")]],
  ])("is not shown for %s", async (_name, mails) => {
    renderPanel(mails as Mail[]);
    await screen.findByText("Mail 1");
    expect(screen.queryByTestId("kinds-box")).toBeNull();
    expect(screen.queryByText("What they send")).toBeNull();
  });

  it("is not shown for a subject or thread row, a pooled Smart row, or "
    + "before the mails are there", async () => {
    for (const grouping of ["subject", "thread", "domain"] as const) {
      const { unmount } = renderPanel(MIXED(), { grouping });
      await screen.findByText("Mail 1");
      expect(screen.queryByTestId("kinds-box")).toBeNull();
      unmount();
    }
    const pool = renderPanel(MIXED(), { grouping: "smart",
      group: mkGroup({ kind: "newsletter", members: ["a@x.example",
        "b@x.example"] }) });
    await screen.findByText("Mail 1");
    expect(screen.queryByTestId("kinds-box")).toBeNull();
    pool.unmount();
    // the mails are still loading
    group_.mockReturnValue(new Promise(() => {}));
    render(<ToastProvider><DialogProvider>
      <DetailPanel grouping="sender" group={mkGroup()} aiEnabled={false}
        protectedNow={false} unsubscribedNow={null} onUnsubscribe={noop}
        onTrash={async () => true} folders={[]} sieve={false} variant="pane"
        onClose={noop} onDeleted={noop} /></DialogProvider></ToastProvider>);
    expect(screen.queryByTestId("kinds-box")).toBeNull();
  });

  it("is shown for a Smart row that stands for one sender", async () => {
    renderPanel(MIXED(), { grouping: "smart",
      group: mkGroup({ kind: "sender", addr: SENDER } as Partial<Group>) });
    expect(await rowsOf()).toEqual(["ads", "orders", "shipping"]);
  });

  it("goes when a kind's last mail is gone and one kind is left",
    async () => {
    renderPanel([mk(1, "ads"), mk(2, "orders"), mk(3, "orders")]);
    await row("ads");
    fireEvent.click(within(await row("ads")).getByRole("button",
      { name: /^Show only/ }));
    expect(screen.getByTestId("kind-chip")).toBeTruthy();
    // the mails reload without the ads
    group_.mockResolvedValue([mk(2, "orders"), mk(3, "orders")]);
    cleanup();
    renderPanel([mk(2, "orders"), mk(3, "orders")]);
    await screen.findByText("Mail 2");
    expect(screen.queryByTestId("kinds-box")).toBeNull();
    expect(screen.queryByTestId("kind-chip")).toBeNull();
  });
});

describe("Show", () => {
  it("narrows the Mails list to the kind, as a chip that can be removed",
    async () => {
    renderPanel(MIXED());
    await row("ads");
    expect(screen.getAllByText(/^Mail \d$/)).toHaveLength(7);
    fireEvent.click(within(await row("ads")).getByRole("button",
      { name: "Show only Ads and offers" }));
    expect(screen.getAllByText(/^Mail \d$/).map((e) => e.textContent).sort())
      .toEqual(["Mail 1", "Mail 2", "Mail 3"]);
    const chip = screen.getByTestId("kind-chip");
    expect(chip.textContent).toBe("Ads and offers");
    expect(screen.getByText(/^3 \/ 7\smails$/)).toBeTruthy();
    // the row says it is the one shown
    expect(within(await row("ads")).getByRole("button",
      { name: "Show only Ads and offers" }).getAttribute("aria-pressed"))
      .toBe("true");
    // the chip sits next to the Mails heading
    const heading = screen.getByRole("heading", { name: "Mails" });
    expect(heading.parentElement!.contains(chip)).toBe(true);
    fireEvent.click(within(chip).getByRole("button",
      { name: "Remove the filter Ads and offers" }));
    expect(screen.queryByTestId("kind-chip")).toBeNull();
    expect(screen.getAllByText(/^Mail \d$/)).toHaveLength(7);
  });

  it("another kind replaces it; the same kind again turns it off",
    async () => {
    renderPanel(MIXED());
    await row("ads");
    const show = async (kind: string, name: string) => fireEvent.click(
      within(await row(kind)).getByRole("button", { name }));
    await show("ads", "Show only Ads and offers");
    await show("orders", "Show only Order confirmations");
    expect(screen.getByTestId("kind-chip").textContent)
      .toBe("Order confirmations");
    expect(screen.getAllByText(/^Mail \d$/).map((e) => e.textContent).sort())
      .toEqual(["Mail 4", "Mail 5"]);
    await show("orders", "Show only Order confirmations");
    expect(screen.queryByTestId("kind-chip")).toBeNull();
  });

  it("clears the selection it would otherwise act on unseen", async () => {
    renderPanel(MIXED());
    await row("ads");
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[4]);
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(within(await row("ads")).getByRole("button",
      { name: "Show only Ads and offers" }));
    expect(screen.queryByText("1 selected")).toBeNull();
  });

  it("leaves the rest of the pane as it is: the footer still moves the "
    + "whole sender", async () => {
    renderPanel(MIXED());
    await row("ads");
    fireEvent.click(within(await row("ads")).getByRole("button",
      { name: "Show only Ads and offers" }));
    expect(screen.getByText(/^Move 7\smails to Trash$/)).toBeTruthy();
  });
});

describe("Trash N", () => {
  it("is today's confirm and the usual background job, for that kind only",
    async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await row("ads")).getByRole("button",
      { name: /^Move 3\smails of Ads and offers to Trash$/ }));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Move to Trash")).toBeTruthy();
    expect(within(dlg).getByText("3 selected mails")).toBeTruthy();
    await pressDialog("Move to Trash (3)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]], "trash", "", false));
    expect(deleteMessages).toHaveBeenCalledOnce();
    // gone from the list; the other kinds are still there
    await waitFor(() => expect(screen.queryByText("Mail 1")).toBeNull());
    expect(screen.getByText("Mail 4")).toBeTruthy();
    expect(onDeleted).toHaveBeenCalled();
  });

  it("is labelled with its count and sends nothing when declined",
    async () => {
    renderPanel(MIXED());
    const r = await row("orders");
    expect(within(r).getByRole("button", { name: /^Move 2\smails/ })
      .textContent)
      .toBe("Trash 2");
    fireEvent.click(within(r).getByText("Trash 2"));
    await cancelDialog();
    await expectNoDialog();
    expect(deleteMessages).not.toHaveBeenCalled();
    expect(screen.getByText("Mail 4")).toBeTruthy();
  });

  it("never counts or sends a protected mail", async () => {
    const mails = MIXED();
    mails[0] = { ...mails[0], pinned: true };
    renderPanel(mails);
    const r = await row("ads");
    expect(within(r).getByText("Trash 2")).toBeTruthy();       // not 3
    fireEvent.click(within(r).getByText("Trash 2"));
    await pressDialog("Move to Trash (2)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledOnce());
    expect(deleteMessages.mock.calls[0][0]).toEqual(
      [["INBOX", 2], ["INBOX", 3]]);
  });

  it("is off when every mail of the kind is protected", async () => {
    renderPanel(MIXED().map((m) => m.kind === "shipping"
      ? { ...m, pinned: true } : m));
    const r = await row("shipping");
    expect((within(r).getByText("Trash 0") as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("asks Keep-safe above 20 mails, protects what is ticked first and "
    + "sends the rest", async () => {
    keepSafeCheck.mockResolvedValue(KEEP_FOUND);
    keepSafePin.mockResolvedValue({ pinned: 2,
      items: [["INBOX", 1], ["INBOX", 2]] });
    const ads = Array.from({ length: 22 }, (_, i) => mk(i + 1, "ads"));
    renderPanel([...ads, mk(30, "orders"), mk(31, "orders")]);
    fireEvent.click(within(await row("ads")).getByText("Trash 22"));
    const dlg = await findDialog();
    expectKeepBox(dlg);
    expect(keepSafeCheck.mock.calls[0][0].items).toHaveLength(22);
    await pressDialog("Move to Trash (18)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledOnce());
    const [sent, action] = deleteMessages.mock.calls[0];
    expect(action).toBe("trash");
    expect(sent).toHaveLength(20);
    expect(sent).not.toContainEqual(["INBOX", 1]);
    expect(sent).not.toContainEqual(["INBOX", 30]);
    // the pin was written before anything was moved
    expect(keepSafePin.mock.invocationCallOrder[0])
      .toBeLessThan(deleteMessages.mock.invocationCallOrder[0]);
  });

  it("does not ask Keep-safe for 20 mails or fewer", async () => {
    const ads = Array.from({ length: 20 }, (_, i) => mk(i + 1, "ads"));
    renderPanel([...ads, mk(30, "orders"), mk(31, "orders")]);
    fireEvent.click(within(await row("ads")).getByText("Trash 20"));
    await pressDialog("Move to Trash (20)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledOnce());
    expect(keepSafeCheck).not.toHaveBeenCalled();
  });

  it("says so when the move is refused", async () => {
    deleteMessages.mockRejectedValue(new Error("protected_sender_selected"));
    renderPanel(MIXED());
    fireEvent.click(within(await row("ads")).getByText("Trash 3"));
    await pressDialog("Move to Trash (3)");
    expect(await screen.findByText(/protected_sender_selected/)).toBeTruthy();
    expect(screen.getByText("Mail 1")).toBeTruthy();
  });
});

describe("the menu on a row", () => {
  const openMenu = async (kind: string, label = "Ads and offers") => {
    fireEvent.click(within(await row(kind)).getByRole("button",
      { name: `More for ${label}` }));
    return screen.findByRole("menu");
  };

  it("has the board's entries in the board's order", async () => {
    renderPanel(MIXED());
    const menu = await openMenu("ads");
    const items = within(menu).getAllByRole("menuitem")
      .map((i) => i.textContent);
    expect(items).toEqual(["Archive these 3", "Move these 3…",
      "Mark these as read", "Protect these 3", "Always trash their ads…"]);
    // the rule sits apart, below a separator
    const sep = within(menu).getByRole("separator");
    const last = within(menu).getByText("Always trash their ads…");
    expect(sep.compareDocumentPosition(last)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Archive these N archives that kind after the usual confirm",
    async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await openMenu("orders", "Order confirmations"))
      .getByText("Archive these 2"));
    await pressDialog("Archive (2)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 4], ["INBOX", 5]], "archive", "", false));
  });

  it("Move these N… picks a folder and moves that kind", async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await openMenu("ads")).getByText("Move these 3…"));
    await findPicker();
    await pickFolder("Promotions");
    await pressDialog(/^Move/);
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledOnce());
    expect(deleteMessages.mock.calls[0].slice(0, 2)).toEqual(
      [[["INBOX", 1], ["INBOX", 2], ["INBOX", 3]], "move"]);
    expect(deleteMessages.mock.calls[0][2]).toBe("Promotions");
  });

  it("Mark these as read marks the unread ones of that kind (the usual "
    + "confirm)", async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await openMenu("ads"))
      .getByText("Mark these as read"));
    await pressDialog("Mark as read (2)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 1], ["INBOX", 2]], "mark_read", "", false));
  });

  it("Mark these as read is off when everything of the kind was read",
    async () => {
    renderPanel(MIXED());
    const menu = await openMenu("orders", "Order confirmations");
    expect((within(menu).getByText("Mark these as read")
      .closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Protect these N protects the unprotected mails of that kind",
    async () => {
    const mails = MIXED();
    mails[1] = { ...mails[1], pinned: true };
    renderPanel(mails);
    fireEvent.click(within(await openMenu("ads")).getByText("Protect these 2"));
    await waitFor(() => expect(pinMails).toHaveBeenCalledWith(
      [["INBOX", 1], ["INBOX", 3]], true));
    expect(await screen.findByText(/^3\smails protected\.$/)).toBeTruthy();
    expect(onDeleted).toHaveBeenCalled();
    expect(group_).toHaveBeenCalledTimes(2);          // reloaded from the server
  });

  it("Protect these N says what could not be protected", async () => {
    pinMails.mockResolvedValue({ ok: true, pinned: true, changed: 2,
      skipped: 1 });
    renderPanel(MIXED());
    fireEvent.click(within(await openMenu("ads")).getByText("Protect these 3"));
    expect(await screen.findByText(/without a Message-ID/)).toBeTruthy();
  });

  it("Protect these N reports a failure and changes nothing", async () => {
    pinMails.mockRejectedValue(new Error("disk full"));
    renderPanel(MIXED());
    fireEvent.click(within(await openMenu("ads")).getByText("Protect these 3"));
    expect(await screen.findByText(/disk full/)).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("Always trash their …", () => {
  const start = async (kind = "ads", label = "Ads and offers") => {
    fireEvent.click(within(await row(kind)).getByRole("button",
      { name: `More for ${label}` }));
    fireEvent.click(await screen.findByText(/^Always trash their /));
  };

  it("asks first, then creates an ordinary rule that starts in Report only",
    async () => {
    renderPanel(MIXED());
    await start();
    const dlg = await findDialog();
    expect(within(dlg).getByText("Always trash their ads?")).toBeTruthy();
    expect(dlg.textContent).toMatch(/ACME Store/);
    expect(dlg.textContent).toMatch(/Report only/);
    expect(createRule).not.toHaveBeenCalled();
    await pressDialog("Create rule");
    await waitFor(() => expect(createRule).toHaveBeenCalledOnce());
    expect(createRule).toHaveBeenCalledWith({
      name: "ACME Store: ads to Trash", scope: "mail", grouping: "sender",
      query: `from:${SENDER}`, action: "trash", dest: "",
      schedule: "daily", only_kind: "ads", account: "default" });
    // it says so, with a way to the rules; no mail was touched
    expect(await screen.findByText(/It starts in Report only/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rules" }));
    expect(onOpenRules).toHaveBeenCalled();
    expect(deleteMessages).not.toHaveBeenCalled();
  });

  it("makes nothing when declined", async () => {
    renderPanel(MIXED());
    await start();
    await cancelDialog();
    await expectNoDialog();
    expect(rules).not.toHaveBeenCalled();
    expect(createRule).not.toHaveBeenCalled();
  });

  it("names the kind it was asked for", async () => {
    renderPanel(MIXED());
    await start("shipping", "Shipping updates");
    await pressDialog("Create rule");
    await waitFor(() => expect(createRule).toHaveBeenCalledOnce());
    expect(createRule.mock.calls[0][0]).toMatchObject({
      name: "ACME Store: shipping updates to Trash", only_kind: "shipping" });
  });

  it("does not make the same rule twice", async () => {
    rules.mockResolvedValue({ rules: [{
      id: "r1", name: "x", scope: "mail", grouping: "sender",
      query: `from:${SENDER}`, action: "trash", only_kind: "ads",
      account: "default" } as Rule], cap: 500 });
    renderPanel(MIXED());
    await start();
    await pressDialog("Create rule");
    expect(await screen.findByText(
      "There is already a rule for the ads from ACME Store.")).toBeTruthy();
    expect(createRule).not.toHaveBeenCalled();
  });

  it("a rule of another kind, or of another account, does not count",
    async () => {
    rules.mockResolvedValue({ rules: [
      { id: "r1", scope: "mail", grouping: "sender", query: `from:${SENDER}`,
        action: "trash", only_kind: "orders", account: "default" },
      { id: "r2", scope: "mail", grouping: "sender", query: `from:${SENDER}`,
        action: "trash", only_kind: "ads", account: "other" },
    ] as Rule[], cap: 500 });
    renderPanel(MIXED());
    await start();
    await pressDialog("Create rule");
    await waitFor(() => expect(createRule).toHaveBeenCalledOnce());
  });

  it("says why when the rule could not be made", async () => {
    createRule.mockRejectedValue(new Error("rule limit"));
    renderPanel(MIXED());
    await start();
    await pressDialog("Create rule");
    expect(await screen.findByText(/The rule was not created: rule limit/))
      .toBeTruthy();
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(width < 40rem)", media: q,
      addEventListener() {}, removeEventListener() {},
    }));
  });

  it("a row is one button with a chevron that opens a sheet with the same "
    + "actions", async () => {
    renderPanel(MIXED());
    const r = await row("ads");
    // no Show / Trash buttons on the row itself
    expect(within(r).queryByText("Show")).toBeNull();
    expect(within(r).queryByText(/^Trash/)).toBeNull();
    const open = within(r).getByRole("button");
    expect(open.getAttribute("aria-label")).toMatch(/^Ads and offers: 3/);
    fireEvent.click(open);
    const sheet = await screen.findByRole("dialog", { name: "Ads and offers" });
    for (const label of ["Show", "Trash 3", "Archive these 3",
      "Move these 3…", "Mark these as read", "Protect these 3",
      "Always trash their ads…"]) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
  });

  it("Show in the sheet narrows the list and closes the sheet", async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await row("orders")).getByRole("button"));
    const sheet = await screen.findByRole("dialog",
      { name: "Order confirmations" });
    fireEvent.click(within(sheet).getByText("Show"));
    await waitFor(() => expect(screen.queryByRole("dialog",
      { name: "Order confirmations" })).toBeNull());
    expect(screen.getByTestId("kind-chip").textContent)
      .toBe("Order confirmations");
    expect(screen.getAllByText(/^Mail \d$/)).toHaveLength(2);
  });

  it("Trash N in the sheet runs the usual confirm", async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await row("ads")).getByRole("button"));
    const sheet = await screen.findByRole("dialog", { name: "Ads and offers" });
    fireEvent.click(within(sheet).getByText("Trash 3"));
    await pressDialog("Move to Trash (3)");
    await waitFor(() => expect(deleteMessages).toHaveBeenCalledWith(
      [["INBOX", 1], ["INBOX", 2], ["INBOX", 3]], "trash", "", false));
  });

  it("the sheet's actions are off where there is nothing to do",
    async () => {
    renderPanel(MIXED().map((m) => ({ ...m, pinned: m.kind === "orders" })));
    fireEvent.click(within(await row("orders")).getByRole("button"));
    const sheet = await screen.findByRole("dialog",
      { name: "Order confirmations" });
    for (const label of ["Archive these 0", "Move these 0…",
      "Protect these 0", "Mark these as read"]) {
      expect((within(sheet).getByText(label).closest("button")!
        ).disabled).toBe(true);
    }
  });
});

describe("German", () => {
  beforeEach(() => setLang("de"));
  afterEach(() => setLang("en"));

  it("speaks German, with du", async () => {
    renderPanel(MIXED());
    const b = await box();
    expect(within(b).getByText("Was sie schicken")).toBeTruthy();
    expect(within(b).getByText("3 Arten · nach den Betreffzeilen"))
      .toBeTruthy();
    const ads = await row("ads");
    expect(within(ads).getByText("Werbung und Angebote")).toBeTruthy();
    expect(ads.textContent).toMatch(/33\s?% geöffnet/);
    expect(within(ads).getByText("Anzeigen")).toBeTruthy();
    expect(within(ads).getByText("3 löschen")).toBeTruthy();
    fireEvent.click(within(ads).getByRole("button",
      { name: "Mehr zu Werbung und Angebote" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent))
      .toEqual(["Diese 3 archivieren", "Diese 3 verschieben…",
        "Diese als gelesen markieren", "Diese 3 schützen",
        "Immer in den Papierkorb: Werbung…"]);
    expect(within(await row("shipping")).getByText("Versandmitteilungen"))
      .toBeTruthy();
    expect((await row("shipping")).textContent).toMatch(/zuletzt 2\. Okt/);
  });

  it("filters and says so in German", async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await row("orders")).getByRole("button",
      { name: "Nur Bestellbestätigungen anzeigen" }));
    const chip = screen.getByTestId("kind-chip");
    expect(chip.textContent).toBe("Bestellbestätigungen");
    expect(within(chip).getByRole("button",
      { name: "Filter Bestellbestätigungen entfernen" })).toBeTruthy();
  });

  it("the rule's confirm is in German", async () => {
    renderPanel(MIXED());
    fireEvent.click(within(await row("ads")).getByRole("button",
      { name: "Mehr zu Werbung und Angebote" }));
    fireEvent.click(await screen.findByText(/^Immer in den Papierkorb:/));
    const dlg = await findDialog();
    expect(within(dlg).getByText("Immer in den Papierkorb: Werbung?"))
      .toBeTruthy();
    expect(dlg.textContent).toMatch(/Nur Bericht/);
    await pressDialog("Regel anlegen");
    await waitFor(() => expect(createRule).toHaveBeenCalledOnce());
    expect(createRule.mock.calls[0][0].name)
      .toBe("ACME Store: Werbung in den Papierkorb");
  });
});

describe("the sender pane keeps everything it had", () => {
  it("every control the inventory lists is still there next to the box",
    async () => {
    renderPanel(MIXED(), {
      onProtect: noop, onBlock: noop, onMove: async () => true,
      onLabelsSaved: noop, labelSender: mkGroup(), unsubscribedNow: null,
      group: mkGroup({ unsub: true, count: 7 }),
    });
    await row("ads");
    for (const name of [/Edit labels/, /^Unsubscribe$/, /Block/,
      /Protect/, /^Move$/, /^More$/]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
    // the three tiles
    for (const tile of ["Mails", "Size", "Opened"]) {
      expect(screen.getAllByText(tile).length).toBeGreaterThan(0);
    }
    // the Mails list: sort, Select..., the footer
    expect(screen.getByRole("heading", { name: "Mails" })).toBeTruthy();
    expect(screen.getByText("Sort: date")).toBeTruthy();
    expect(screen.getByText("Select…")).toBeTruthy();
    expect(screen.getByText(/^Move 7\smails to Trash$/)).toBeTruthy();
    expect(screen.getAllByText(/^Mail \d$/)).toHaveLength(7);
    // a sender without kinds is exactly as before
    cleanup();
    renderPanel([mk(1, ""), mk(2, "")], {
      group: mkGroup({ count: 2 }) });
    await screen.findByText("Mail 1");
    expect(screen.getByText(/^Move 2\smails to Trash$/)).toBeTruthy();
    expect(screen.queryByText("What they send")).toBeNull();
  });
});
