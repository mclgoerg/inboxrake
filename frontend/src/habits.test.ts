// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { habitAsRule, habitEvery, habitEvidence, habitList, habitPlain,
  habitRuleName, habitStepNote, habitTitle, newHabit } from "./habits";
import { bank, chirp, deals, news, habitsResp } from "./habitsFixtures";
import { setLang } from "./i18n";

afterEach(() => { setLang("en"); vi.useRealTimers(); });

/** Counts and their nouns are joined by a no-break space. */
const nb = (s: string) => s.replace(/\u00a0/g, " ");

test("how often: every day / week / N days / a range", () => {
  expect(nb(habitEvery(deals))).toBe("every 3-5 days");
  expect(habitEvery(news)).toBe("every week");
  expect(habitEvery(chirp)).toBe("every day");
  expect(habitEvery({ ...bank, gap_min: 10, gap_max: 10 })).toBe("every 10 days");
  // a week with some jitter still reads as a week
  expect(habitEvery({ ...news, gap_min: 6, gap_max: 8 })).toBe("every week");
  expect(habitEvery({ ...news, gap_min: 5, gap_max: 8 })).toBe("every 5-8 days");
});

test("evidence line: how often, how many mails in all, all unread", () => {
  expect(nb(habitEvidence(deals))).toBe("every 3-5 days · 41 mails · all unread");
  expect(nb(habitEvidence(news))).toBe("every week · 22 mails");
  expect(nb(habitEvidence(chirp))).toBe("every day · 54 mails · all unread");
});

test("titles and rule names per action", () => {
  expect(habitTitle(chirp)).toMatch(/^You marked Chirper as read 6 times since /);
  expect(habitTitle(news)).toMatch(/^You archived Northwind News 4 times since /);
  expect(habitTitle(bank)).toMatch(/^You moved PayBank to Finance 4 times since /);
  expect(habitRuleName(deals)).toBe("Trash Deals Daily");
  expect(habitRuleName(bank)).toBe("Move PayBank to Finance");
  expect(habitRuleName({ ...deals, label: "x".repeat(200) }).length).toBe(80);
});

test("the plain sentence of a phone: the rule, then what it would catch", () => {
  expect(nb(habitPlain(deals))).toBe("A rule: Trash its mail older than 3 days, "
    + "daily. Would catch 12 now · Report only first.");
  expect(nb(habitPlain(bank))).toBe("A rule: Move its mail to Finance, weekly. "
    + "Would catch 3 now · Report only first.");
  expect(nb(habitPlain(chirp))).toBe("A rule: Mark its mail as read, daily. "
    + "Would catch 11 now · Report only first.");
  expect(nb(habitPlain({ ...news, older_than_days: 1, catch: null }))).toBe(
    "A rule: Archive its mail older than 1 day, weekly. Report only first.");
  setLang("de");
  expect(nb(habitPlain(deals))).toBe("Eine Regel: Mails dieses Absenders in den "
    + "Papierkorb legen, wenn sie älter als 3 Tage sind, täglich. Würde jetzt "
    + "12 erfassen · startet im Berichtsmodus.");
});

test("a suggestion shaped as a rule: Report only, the folder as named", () => {
  const r = habitAsRule(bank);
  expect(r).toMatchObject({ scope: "mail", grouping: "sender",
    query: "from:service@paybank.example", action: "move", dest: "Finance",
    schedule: "weekly", mode: "report", keep_latest: null,
    older_than_days: null, only_kind: null });
  expect(habitAsRule(deals).older_than_days).toBe(3);
});

test("one step of Why these?: all unread, else how young the youngest was", () => {
  expect(habitStepNote(deals, deals.steps[0])).toBe("all unread");
  expect(nb(habitStepNote(deals, deals.steps[4]))).toBe("youngest 3 days old");
  expect(nb(habitStepNote(news, { ...news.steps[0], youngest_days: 1 })))
    .toBe("youngest 1 day old");
  // not unread and no age known (a move, mark as read): nothing to add
  expect(habitStepNote(bank, bank.steps[1])).toBe("");
  expect(habitStepNote(chirp, { ...chirp.steps[0], unread: 0 })).toBe("");
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
