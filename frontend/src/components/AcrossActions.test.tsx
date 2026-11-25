// @vitest-environment jsdom
/* The selection actions across accounts: the multi-account confirm lists every
 * account the selection reaches, then runs ONE ordinary per-account call per
 * ticked account (pinned to it, one after the other). Unticked accounts are
 * never called, a failing account does not stop the others, a removed account
 * is skipped, protected senders and pinned mails stay. (api mocked.) */

import { cleanup, fireEvent, render, screen, waitFor, within } from
  "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteAccountSwitch } from "../accountGuard";
import { mail, sender } from "../allAccountsFixtures";
import { setLang } from "../i18n";

const calls: { fn: string; account: string; args: unknown[] }[] = [];
const del = vi.fn();
const delMsgs = vi.fn();
const confirmTrash = vi.fn();

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  const at = () => /account=([^&]*)/.exec(actual.withAccount("/x"))?.[1] ?? "";
  const rec = (fn: string, f: (...a: any[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ fn, account: decodeURIComponent(at()), args });
      return f(...args);
    };
  return { ...actual, api: {
    deleteGroups: rec("deleteGroups", (...a) => del(...a)),
    deleteMessages: rec("deleteMessages", (...a) => delMsgs(...a)),
  } };
});
vi.mock("../keepsafe", () => ({
  KEEP_SAFE_MIN: 20,
  confirmTrash: (...a: unknown[]) => confirmTrash(...a),
}));

import { AcrossMailsConfirm, AcrossSendersConfirm } from "./AcrossActions";
import { DialogProvider, ToastProvider } from "./ui";

const ORDER = ["gmail", "icloud", "proton", "gmx"];
const deals = sender("deals@dealsdaily.example", "Deals Daily",
  [["gmail", 210], ["proton", 96, { pinned: 2 }]]);
const boss = sender("keep@boss.example", "The Boss",
  [["gmail", 12, { protected: true }], ["icloud", 3]]);

const NOTE_MOVE = "Each account runs its own step, with its own Undo and " +
  "Activity entry. Protected senders and pinned mails stay where they are.";
const sp = (s: string): string => s.replace(/ /g, " ");
const txt = (el: Element): string => sp(el.textContent ?? "");
const press = (btn: HTMLElement) => fireEvent.click(btn, { detail: 0 });

const mountSenders = (over: Partial<Parameters<typeof AcrossSendersConfirm>[0]> = {}) => {
  const p = { rows: [deals], action: "trash" as const, order: ORDER,
    exists: () => true, onOpenActivity: vi.fn(), onChanged: vi.fn(),
    onClose: vi.fn(), ...over };
  render(<ToastProvider><DialogProvider>
    <AcrossSendersConfirm {...p} /></DialogProvider></ToastProvider>);
  return p;
};
const mountMails = (mails = [mail("gmail", 1), mail("gmail", 2),
    mail("proton", 3)], over: Partial<Parameters<typeof AcrossMailsConfirm>[0]> = {}) => {
  const p = { mails, action: "trash" as const, order: ORDER,
    exists: () => true, onOpenActivity: vi.fn(), onChanged: vi.fn(),
    onClose: vi.fn(), ...over };
  render(<ToastProvider><DialogProvider>
    <AcrossMailsConfirm {...p} /></DialogProvider></ToastProvider>);
  return p;
};

beforeEach(() => {
  setLang("en");
  calls.length = 0;
  del.mockReset().mockImplementation(async (_g, keys: string[]) =>
    ({ ok: true, queued: keys.length * 10, skipped: 0 }));
  delMsgs.mockReset().mockImplementation(async (items: unknown[]) =>
    ({ ok: true, queued: items.length }));
  confirmTrash.mockReset().mockResolvedValue({ ok: true, pinned: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("senders: the review", () => {
  it("lists every account the rows reach with its own checkbox and count; " +
    "the confirm is the danger kind with the verb and the count", () => {
    mountSenders({ rows: [deals, boss] });
    expect(screen.getByText(/Move to Trash: 307 mails in 3 accounts\?/))
      .toBeTruthy();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    const rows = screen.getAllByRole("listitem");
    expect(txt(rows[0])).toContain("gmail");
    expect(txt(rows[0])).toContain("210 mails");
    expect(txt(rows[0])).toContain("2 senders");
    expect(txt(rows[0])).toContain("1 protected left alone");
    expect(txt(rows[1])).toContain("icloud");
    expect(txt(rows[1])).toContain("3 mails");
    expect(txt(rows[2])).toContain("proton");
    expect(txt(rows[2])).toContain("94 mails");
    expect(txt(rows[2])).toContain("2 pinned stay");
    const btn = screen.getByRole("button", { name: "Move to Trash (307)" });
    expect(btn.className).toMatch(/danger/);
    expect(screen.getByText(NOTE_MOVE)).toBeTruthy();
    // nothing ran yet
    expect(calls).toEqual([]);
  });

  it("a sender protected in one account is blocked there when all it holds " +
    "is protected", () => {
    mountSenders({ rows: [sender("k@boss.example", "Boss",
      [["gmail", 5, { protected: true }], ["icloud", 4]])] });
    const first = screen.getAllByRole("listitem")[0];
    expect(txt(first)).toContain("all protected - left alone");
    const box = within(first).getByRole("checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });

  it("Archive and Mark as read are not danger confirms of a protected " +
    "sender - protected rows are included there", () => {
    mountSenders({ rows: [boss], action: "mark_read" });
    const btn = screen.getByRole("button", { name: "Mark as read (15)" });
    expect(btn.className).not.toMatch(/danger/);
    expect(screen.getByText("Each account runs its own step, with its own " +
      "Activity entry.")).toBeTruthy();
  });
});

describe("senders: the run", () => {
  it("runs one deleteGroups per ticked account, pinned to it, in order",
    async () => {
    const p = mountSenders({ rows: [deals, boss] });
    press(screen.getByRole("button", { name: "Move to Trash (307)" }));
    await screen.findByText("3 done");
    expect(calls.map((c) => [c.fn, c.account])).toEqual([
      ["deleteGroups", "gmail"], ["deleteGroups", "icloud"],
      ["deleteGroups", "proton"]]);
    // the protected sender is not in gmail's keys
    expect(del.mock.calls[0].slice(0, 3)).toEqual(
      ["sender", ["deals@dealsdaily.example"], "trash"]);
    expect(del.mock.calls[1][1]).toEqual(["keep@boss.example"]);
    expect(del.mock.calls[2][1]).toEqual(["deals@dealsdaily.example"]);
    expect(screen.getAllByText(/10 mails are moving to Trash/)).toHaveLength(3);
    expect(p.onChanged).toHaveBeenCalledWith(["gmail", "icloud", "proton"]);
    // each account's own Undo is in its Activity
    expect(screen.getAllByText("Undo is in this account's Activity."))
      .toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Open Activity" })[2]);
    expect(p.onOpenActivity).toHaveBeenCalledWith("proton");
  });

  it("an unticked account is never called", async () => {
    const p = mountSenders({ rows: [deals, boss] });
    fireEvent.click(screen.getByRole("checkbox",
      { name: "Move to Trash in icloud" }));
    press(screen.getByRole("button", { name: "Move to Trash (304)" }));
    await screen.findByText("2 done");
    expect(calls.map((c) => c.account)).toEqual(["gmail", "proton"]);
    expect(p.onChanged).toHaveBeenCalledWith(["gmail", "proton"]);
  });

  it("a failing account is reported and the next one still runs", async () => {
    del.mockImplementation(async (_g, keys: string[]) => {
      if (calls.at(-1)!.account === "gmail") throw new Error("busy_action");
      return { ok: true, queued: 5, skipped: 0 };
    });
    mountSenders();
    press(screen.getByRole("button", { name: "Move to Trash (304)" }));
    await screen.findByText("1 done · 1 failed");
    expect(calls.map((c) => c.account)).toEqual(["gmail", "proton"]);
    expect(screen.getByText(/Failed: /)).toBeTruthy();
  });

  it("an account that is gone is skipped and said so - never called",
    async () => {
    mountSenders({ exists: (a) => a !== "gmail" });
    press(screen.getByRole("button", { name: "Move to Trash (304)" }));
    await screen.findByText("1 done · 1 not run");
    expect(calls.map((c) => c.account)).toEqual(["proton"]);
    expect(screen.getByText(/no longer there/)).toBeTruthy();
  });

  it("switching the view before an account's turn stands the rest down",
    async () => {
    mountSenders();
    // (the account was switched after the confirm opened)
    noteAccountSwitch();
    press(screen.getByRole("button", { name: "Move to Trash (304)" }));
    await screen.findByText("2 not run");
    expect(calls).toEqual([]);
  });

  it("a big move asks the keep-safe question per account; declining runs " +
    "nothing at all", async () => {
    confirmTrash.mockResolvedValue({ ok: false, pinned: [] });
    const p = mountSenders();
    press(screen.getByRole("button", { name: "Move to Trash (304)" }));
    await waitFor(() => expect(confirmTrash).toHaveBeenCalledTimes(1));
    expect(confirmTrash.mock.calls[0][0]).toMatchObject({
      account: "gmail", onlyIfFound: true,
      scope: { grouping: "sender", keys: ["deals@dealsdaily.example"] } });
    expect(calls).toEqual([]);
    // back in the review, still open
    expect(screen.getByRole("button", { name: "Move to Trash (304)" })).toBeTruthy();
    expect(p.onChanged).not.toHaveBeenCalled();
  });

  it("a keep-safe protection that could not be written stops the run",
    async () => {
    confirmTrash.mockRejectedValue(new Error("boom"));
    mountSenders();
    press(screen.getByRole("button", { name: "Move to Trash (304)" }));
    await screen.findByRole("alert");
    expect(calls).toEqual([]);
  });

  it("a small move (20 mails or fewer) is not asked again", async () => {
    mountSenders({ rows: [sender("a@x.example", "A",
      [["gmail", 5], ["proton", 4]])] });
    press(screen.getByRole("button", { name: "Move to Trash (9)" }));
    await screen.findByText("2 done");
    expect(confirmTrash).not.toHaveBeenCalled();
  });

  it("Archive sends the archive action; Mark as read counts pinned mails",
    async () => {
    mountSenders({ action: "archive" });
    press(screen.getByRole("button", { name: "Archive (304)" }));
    await screen.findByText("2 done");
    expect(del.mock.calls.map((c) => c[2])).toEqual(["archive", "archive"]);
    cleanup();
    calls.length = 0;
    mountSenders({ action: "mark_read" });
    press(screen.getByRole("button", { name: "Mark as read (306)" }));
    await screen.findByText("2 done");
    expect(del.mock.calls.at(-1)![2]).toBe("mark_read");
    // Mark as read has no Undo to point at
    expect(screen.queryByText("Undo is in this account's Activity.")).toBeNull();
  });
});

describe("mails", () => {
  it("lists the accounts the mails sit in and runs one deleteMessages each " +
    "with the exact (folder, uid) items", async () => {
    const p = mountMails();
    expect(screen.getByText(/Move to Trash: 3 mails in 2 accounts\?/)).toBeTruthy();
    press(screen.getByRole("button", { name: "Move to Trash (3)" }));
    await screen.findByText("2 done");
    expect(calls.map((c) => [c.fn, c.account])).toEqual([
      ["deleteMessages", "gmail"], ["deleteMessages", "proton"]]);
    expect(delMsgs.mock.calls[0]).toEqual([
      [["INBOX", 1], ["INBOX", 2]], "trash", "", false]);
    expect(delMsgs.mock.calls[1][0]).toEqual([["INBOX", 3]]);
    expect(p.onChanged).toHaveBeenCalledTimes(1);
    expect(p.onChanged.mock.calls[0][0].map((m: any) => `${m.account}:${m.uid}`))
      .toEqual(["gmail:1", "gmail:2", "proton:3"]);
  });

  it("a pinned mail stays; an account with only pinned mails is blocked",
    async () => {
    mountMails([mail("gmail", 1, { pinned: true }), mail("proton", 3),
      mail("proton", 4, { pinned: true })]);
    const rows = screen.getAllByRole("listitem");
    expect(txt(rows[0])).toContain("all pinned - left alone");
    expect(txt(rows[1])).toContain("1 pinned stay");
    press(screen.getByRole("button", { name: "Move to Trash (1)" }));
    await screen.findByText("1 done");
    expect(calls.map((c) => c.account)).toEqual(["proton"]);
    expect(delMsgs.mock.calls[0][0]).toEqual([["INBOX", 3]]);
  });

  it("one mail is named by its subject", () => {
    mountMails([mail("gmail", 1, { subject: "Your invoice" })]);
    expect(txt(screen.getAllByRole("listitem")[0])).toContain("Your invoice");
  });

  it("the mails the keep-safe box protected are not moved", async () => {
    const many = Array.from({ length: 22 }, (_, i) => mail("gmail", i + 1));
    confirmTrash.mockResolvedValue({ ok: true, pinned: [["INBOX", 5]] });
    const p = mountMails(many);
    press(screen.getByRole("button", { name: "Move to Trash (22)" }));
    await screen.findByText("1 done");
    expect(confirmTrash.mock.calls[0][0].scope.items).toHaveLength(22);
    const sent = delMsgs.mock.calls[0][0] as [string, number][];
    expect(sent).toHaveLength(21);
    expect(sent.some(([, uid]) => uid === 5)).toBe(false);
    expect(p.onChanged.mock.calls[0][0]).toHaveLength(21);
  });

  it("a failing account does not stop the next", async () => {
    delMsgs.mockImplementation(async (items: unknown[]) => {
      if (calls.at(-1)!.account === "gmail") throw new Error("busy_action");
      return { ok: true, queued: items.length };
    });
    const p = mountMails();
    press(screen.getByRole("button", { name: "Move to Trash (3)" }));
    await screen.findByText("1 done · 1 failed");
    expect(calls.map((c) => c.account)).toEqual(["gmail", "proton"]);
    // only the account that ran is reported as changed
    expect(p.onChanged.mock.calls[0][0].map((m: any) => m.account))
      .toEqual(["proton"]);
  });
});

describe("German", () => {
  it("the confirm speaks German", async () => {
    setLang("de");
    mountSenders({ rows: [deals, boss] });
    expect(sp(document.body.textContent ?? "")).toContain(
      "In den Papierkorb: 307 Mails in 3 Konten?");
    expect(sp(document.body.textContent ?? "")).toContain(
      "1 geschützte bleiben unberührt");
    expect(sp(document.body.textContent ?? "")).toContain("2 angeheftet bleiben");
  });
});
