import { expect, test } from "vitest";
import { acme, deals, part, row } from "./allAccountsFixtures";
import { countIn, moves, plan, whyNot } from "./sameSender";

test("each action says why an account cannot take part", () => {
  const p = (over = {}) => part("work", "deals@dealsdaily.example", over);
  expect(whyNot(p(), "unsubscribe")).toBeNull();
  expect(whyNot(p({ unsub: false }), "unsubscribe")).toBe("no_link");
  expect(whyNot(p({ state: "done" }), "unsubscribe")).toBe("done");
  // a link the user still has to confirm, or a failed try, can be tried again
  expect(whyNot(p({ state: "link" }), "unsubscribe")).toBeNull();
  expect(whyNot(p({ state: "failed" }), "unsubscribe")).toBeNull();
  expect(whyNot(p({ mails: 5, pinned: 5 }), "trash")).toBe("pinned");
  expect(whyNot(p({ mails: 5, pinned: 4 }), "archive")).toBeNull();
  expect(whyNot(p({ blocked: true }), "block")).toBe("blocked");
  // a blocked address can still be trashed; a pinned one can still be blocked
  expect(whyNot(p({ blocked: true }), "trash")).toBeNull();
  expect(whyNot(p({ mails: 3, pinned: 3 }), "block")).toBeNull();
});

test("the N of 'Trash in N' counts the accounts that can still take part", () => {
  const r = row("shop.example", "Shop", [
    part("one", "a@shop.example", { mails: 4 }),
    part("two", "a@shop.example", { mails: 4, pinned: 4, state: "done" }),
    part("three", "a@shop.example", { mails: 4, unsub: false, blocked: true })]);
  expect(countIn(r, "trash")).toBe(2);
  expect(countIn(r, "archive")).toBe(2);
  expect(countIn(r, "unsubscribe")).toBe(1);
  expect(countIn(r, "block")).toBe(2);
});

test("a move leaves the pinned mails out of its count, the others do not", () => {
  const r = row("shop.example", "Shop", [
    part("one", "a@shop.example", { mails: 10, pinned: 3 })]);
  expect(plan(r, "trash", undefined)[0].mails).toBe(7);
  expect(plan(r, "archive", undefined)[0].mails).toBe(7);
  expect(plan(r, "unsubscribe", undefined)[0].mails).toBe(10);
  expect(plan(r, "block", undefined)[0].mails).toBe(10);
  expect(plan(r, "trash", undefined)[0].pinned).toBe(3);
  expect(moves("trash") && moves("archive")).toBe(true);
  expect(moves("block") || moves("unsubscribe")).toBe(false);
});

test("an account the fresh read dropped is blocked: protected, or gone", () => {
  const first = deals();
  // work is protected NOW, proton is simply not in the row any more
  const again = row("dealsdaily.example", "Deals Daily", [
    first.accounts[2]], { left_out: [{ account: "work",
    addr: "deals@dealsdaily.example", why: "protected" }] });
  const lines = plan(first, "trash", again);
  expect(lines.map((l) => [l.account, l.blocked])).toEqual([
    ["work", "protected"], ["proton", "gone"], ["old", undefined]]);
  // the numbers of a line that stays come from the fresh read
  const changed = row("dealsdaily.example", "Deals Daily", [
    part("work", "deals@dealsdaily.example", { mails: 200, pinned: 50 }),
    first.accounts[1], first.accounts[2]]);
  expect(plan(first, "trash", changed)[0]).toMatchObject({
    account: "work", mails: 150, pinned: 50 });
});

test("a sender that is not in several accounts any more blocks every line", () => {
  const lines = plan(acme(), "trash", null);
  expect(lines.every((l) => l.blocked === "gone")).toBe(true);
  // not read yet (undefined): the first read's lines, nothing blocked
  expect(plan(acme(), "trash", undefined).some((l) => l.blocked)).toBe(false);
});

test("the fresh read also takes back an unsubscribe that was done meanwhile", () => {
  const first = deals();
  const again = deals();
  again.accounts[0] = { ...again.accounts[0], state: "done" };
  const lines = plan(first, "unsubscribe", again);
  expect(lines.map((l) => l.blocked)).toEqual(["done", undefined, undefined]);
});
