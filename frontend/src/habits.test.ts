// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { habitEvidence, habitList, habitMails, habitRuleName, habitTitle,
  newHabit } from "./habits";
import { bank, chirp, deals, habitsResp } from "./habitsFixtures";
import { setLang } from "./i18n";

afterEach(() => { setLang("en"); vi.useRealTimers(); });

test("evidence: always unread, the range of mails (one number when equal)", () => {
  expect(habitMails(deals)).toBe("14 to 22 mails each time");
  expect(habitMails(chirp)).toBe("9 mails each time");
  expect(habitMails({ ...chirp, min_n: 1, max_n: 1 })).toBe("1 mail each time");
  expect(habitEvidence(deals)).toBe("Always unread · 14 to 22 mails each time");
  expect(habitEvidence(bank)).toBe("2 to 4 mails each time");
});

test("titles and rule names per action", () => {
  expect(habitTitle(chirp)).toMatch(/^You marked Chirper as read 6 times since /);
  expect(habitTitle({ ...deals, action: "archive" }))
    .toMatch(/^You archived Deals Daily 5 times since /);
  expect(habitRuleName(deals)).toBe("Trash Deals Daily");
  expect(habitRuleName(bank)).toBe("Move PayBank to Finance");
  expect(habitRuleName({ ...deals, label: "x".repeat(200) }).length).toBe(80);
});

test("nothing is listed while the setting is off or nothing was loaded", () => {
  expect(habitList(null)).toEqual([]);
  expect(habitList(habitsResp([deals], { enabled: false }))).toEqual([]);
  expect(habitList(habitsResp([deals]))).toEqual([deals]);
});

test("newHabit: only a suggestion the baseline did not have", async () => {
  const reload = vi.fn().mockResolvedValue(habitsResp([deals, bank]));
  const now = bank.last + 5;
  expect(await newHabit(reload, new Set([deals.id]), 400, now)).toBe(bank);
  expect(await newHabit(reload, new Set([deals.id, bank.id]), 400, now))
    .toBeUndefined();
});

test("newHabit: a suggestion whose newest step is old is not credited to this step", async () => {
  const reload = vi.fn().mockResolvedValue(habitsResp([bank]));
  expect(await newHabit(reload, new Set(), 400, bank.last + 601)).toBeUndefined();
  expect(await newHabit(reload, new Set(), 400, bank.last + 599)).toBe(bank);
});

test("newHabit: a slow or failed answer is no answer", async () => {
  vi.useFakeTimers();
  const slow = vi.fn().mockReturnValue(new Promise(() => {}));
  const p = newHabit(slow, new Set(), 400);
  await vi.advanceTimersByTimeAsync(401);
  expect(await p).toBeUndefined();
  expect(await newHabit(vi.fn().mockResolvedValue(null), new Set())).toBeUndefined();
});
