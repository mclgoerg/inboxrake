// @vitest-environment jsdom
/* The helpers behind Waiting for a reply: the times Remind me offers, how a
 * reminder and a row's age read, the Overview line. */

import { afterEach, expect, test } from "vitest";
import { setLang } from "./i18n";
import { answeredText, at9, atDateValue, dateValue, daysText, limitDays,
  nextMonday9, remindChoice, summaryLine, tomorrow9, whenText } from "./waiting";
import { alex, answered, travelly } from "./waitingFixtures";

afterEach(() => setLang("en"));

const local = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m - 1, d, h).getTime() / 1000;

test("09:00 on the day, in local time", () => {
  expect(at9(new Date(2026, 10, 24, 17, 45))).toBe(local(2026, 11, 24));
  expect(at9(new Date(2026, 10, 24, 0, 5))).toBe(local(2026, 11, 24));
});

test("tomorrow is the next day at 09:00, across a month end", () => {
  expect(tomorrow9(new Date(2026, 10, 24, 22))).toBe(local(2026, 11, 25));
  expect(tomorrow9(new Date(2026, 10, 30, 8))).toBe(local(2026, 12, 1));
});

test("the next Monday is always a Monday after today, even on a Monday", () => {
  // Mon 23 Nov .. Sun 29 Nov 2026
  for (let d = 23; d <= 29; d++) {
    const at = nextMonday9(new Date(2026, 10, d, 12));
    const when = new Date(at * 1000);
    expect(when.getDay()).toBe(1);
    expect(when.getHours()).toBe(9);
    expect(at).toBeGreaterThan(local(2026, 11, d, 12));
  }
  expect(nextMonday9(new Date(2026, 10, 23, 12))).toBe(local(2026, 11, 30));
  expect(nextMonday9(new Date(2026, 10, 24, 12))).toBe(local(2026, 11, 30));
  expect(nextMonday9(new Date(2026, 10, 29, 12))).toBe(local(2026, 11, 30));
});

test("when a reminder is set: the weekday within a week, else the date", () => {
  const now = new Date(2026, 10, 24, 10);
  expect(whenText(local(2026, 11, 30), now)).toBe("Mon 09:00");
  expect(whenText(local(2026, 11, 25), now)).toBe("Wed 09:00");
  expect(whenText(local(2026, 12, 5), now)).toBe("5 Dec 09:00");
  setLang("de");
  expect(whenText(local(2026, 11, 30), now)).toMatch(/^Mo\.? 09:00$/);
});

test("which choice a set reminder is", () => {
  const now = new Date(2026, 10, 24, 10);
  expect(remindChoice(tomorrow9(now), now)).toBe("tomorrow");
  expect(remindChoice(nextMonday9(now), now)).toBe("monday");
  expect(remindChoice(local(2026, 12, 12), now)).toBe("pick");
});

test("a date input value and back", () => {
  expect(dateValue(local(2026, 12, 5))).toBe("2026-12-05");
  expect(atDateValue("2026-12-05")).toBe(local(2026, 12, 5));
  expect(atDateValue("")).toBeNull();
  expect(atDateValue("5.12.2026")).toBeNull();
});

test("a mail counts as waiting after the setting or the person's usual time", () => {
  expect(limitDays(travelly, 3)).toBe(3);                  // usual 2
  expect(limitDays({ ...travelly, usual_days: 9 }, 3)).toBe(9);
  expect(limitDays(alex, 7)).toBe(7);                      // usual unknown
});

test("the pill and the answered line", () => {
  expect(daysText(12)).toMatch(/^12\sdays$/);
  expect(daysText(1)).toMatch(/^1\sday$/);
  expect(answeredText(answered)).toMatch(/^answered in 2\sdays$/);
  expect(answeredText({ ...answered, answered_days: 1 })).toMatch(/^answered in 1\sday$/);
  expect(answeredText({ ...answered, answered_days: 0 })).toBe("answered the same day");
  setLang("de");
  expect(daysText(3)).toMatch(/^3\sTage$/);
  expect(answeredText({ ...answered, answered_days: 0 })).toBe("am selben Tag beantwortet");
});

test("the Overview line names who and how old", () => {
  const s = { overdue: 3, people_n: 3,
    people: ["Travelly", "Alex Doe", "City Library"], more: 0, oldest_days: 12 };
  expect(summaryLine(s)).toMatch(/^Travelly, Alex Doe, City Library · oldest 12\sdays$/);
  expect(summaryLine({ ...s, more: 2, oldest_days: 1 }))
    .toMatch(/^Travelly, Alex Doe, City Library \+2 · oldest 1\sday$/);
  setLang("de");
  expect(summaryLine(s)).toMatch(/älteste 12\sTage$/);
});
