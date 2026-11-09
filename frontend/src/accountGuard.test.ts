import { expect, test } from "vitest";
import { accountEpoch, accountGuard, noteAccountSwitch } from "./accountGuard";

test("one counter: App's generation and the guards move together", () => {
  const switched = accountGuard();
  const at = accountEpoch();
  expect(switched()).toBe(false);
  noteAccountSwitch();
  expect(accountEpoch()).toBe(at + 1);
  expect(switched()).toBe(true);
  expect(accountGuard()()).toBe(false);   // a guard taken after is clean
});
