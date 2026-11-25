/* What a selection does in each account (the pure part of the lists across
 * accounts): protected senders are left out of a Trash, pinned mails stay
 * (except for Mark as read), accounts come in their own order, and an account
 * a selection does not reach has no step. */

import { expect, test } from "vitest";
import { itemsOf, planMails, planSenders, skipsPinned, stillThere }
  from "./acrossLists";
import { mail, sender } from "./allAccountsFixtures";
import { mailKey } from "./lib";

const ORDER = ["gmail", "icloud", "proton", "gmx"];

const deals = sender("deals@dealsdaily.example", "Deals Daily",
  [["proton", 96, { pinned: 2 }], ["gmail", 210]]);
const boss = sender("keep@boss.example", "The Boss",
  [["gmail", 12, { protected: true }], ["icloud", 3]]);

test("one step per account the rows reach, in the accounts' own order", () => {
  const steps = planSenders([deals, boss], "trash", ORDER);
  expect(steps.map((s) => s.account)).toEqual(["gmail", "icloud", "proton"]);
  // an account no row has a part in has no step
  expect(planSenders([deals], "trash", ORDER).map((s) => s.account))
    .toEqual(["gmail", "proton"]);
});

test("a Trash leaves protected senders out; the others in that account stay in",
  () => {
  const [gmail, icloud] = planSenders([deals, boss], "trash", ORDER);
  expect(gmail.keys).toEqual(["deals@dealsdaily.example"]);
  expect(gmail.protectedSkipped).toBe(1);
  expect(gmail.mails).toBe(210);
  // the same sender is not protected in the other account's part
  expect(icloud.keys).toEqual(["keep@boss.example"]);
  expect(icloud.protectedSkipped).toBe(0);
});

test("pinned mails stay for every move and are counted apart", () => {
  const proton = planSenders([deals], "trash", ORDER)
    .find((s) => s.account === "proton")!;
  expect(proton.mails).toBe(94);
  expect(proton.pinned).toBe(2);
  expect(planSenders([deals], "archive", ORDER)
    .find((s) => s.account === "proton")!.mails).toBe(94);
});

test("Mark as read touches pinned mails and protected senders too", () => {
  const steps = planSenders([deals, boss], "mark_read", ORDER);
  const gmail = steps.find((s) => s.account === "gmail")!;
  expect(gmail.keys).toEqual(["deals@dealsdaily.example", "keep@boss.example"]);
  expect(gmail.protectedSkipped).toBe(0);
  expect(steps.find((s) => s.account === "proton")!.mails).toBe(96);
  expect(skipsPinned("mark_read")).toBe(false);
  expect(skipsPinned("trash")).toBe(true);
});

test("a step whose senders are all protected has nothing to move", () => {
  const only = planSenders([sender("k@boss.example", "Boss",
    [["gmail", 5, { protected: true }]])], "trash", ORDER);
  expect(only).toHaveLength(1);
  expect(only[0].keys).toEqual([]);
  expect(only[0].mails).toBe(0);
  expect(only[0].protectedSkipped).toBe(1);
});

test("mails: grouped by account, pinned ones stay, order is the accounts'",
  () => {
  const ms = [mail("proton", 3), mail("gmail", 1), mail("gmail", 2,
    { pinned: true }), mail("proton", 4)];
  const steps = planMails(ms, "trash", ORDER);
  expect(steps.map((s) => s.account)).toEqual(["gmail", "proton"]);
  expect(steps[0].acting.map((m) => m.uid)).toEqual([1]);
  expect(steps[0].pinned).toBe(1);
  expect(steps[1].acting.map((m) => m.uid)).toEqual([3, 4]);
  // Mark as read includes the pinned one
  expect(planMails(ms, "mark_read", ORDER)[0].acting.map((m) => m.uid))
    .toEqual([1, 2]);
});

test("the same (folder, uid) in two accounts is two mails", () => {
  const a = mail("gmail", 7), b = mail("proton", 7);
  expect(mailKey(a)).not.toBe(mailKey(b));
  expect(mailKey({ folder: "INBOX", uid: 7 })).toBe("INBOX 7");
  const steps = planMails([a, b], "trash", ORDER);
  expect(steps.map((s) => itemsOf(s.acting))).toEqual([
    [["INBOX", 7]], [["INBOX", 7]]]);
});

test("a mail without an account is not part of any step", () => {
  expect(planMails([{ ...mail("gmail", 1), account: undefined }], "trash",
    ORDER)).toEqual([]);
});

test("stillThere keeps only what is still on screen ticked", () => {
  const ms = [mail("gmail", 1), mail("proton", 1)];
  const sel = new Set(ms.map(mailKey));
  expect([...stillThere(sel, [ms[1]])]).toEqual([mailKey(ms[1])]);
});
