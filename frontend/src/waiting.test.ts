// @vitest-environment jsdom
/* The helpers behind Waiting for a reply: the times Remind me offers, how a
 * reminder and a row's age read, the short names of the Overview row. */

import { afterEach, expect, test } from "vitest";
import { setLang } from "./i18n";
import { answeredText, at9, atDateValue, dateValue, daysText, inAWeek9,
  nextMonday9, peopleLine, pillText, remindChoice, remindTimes, shortName,
  tomorrow9, tomorrowLabel, typicalText, weekdayName, whenText }
  from "./waiting";
import { answered, clara, opa, tax } from "./waitingFixtures";

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

test("in a week is the same weekday a week on", () => {
  expect(inAWeek9(new Date(2026, 10, 24, 12))).toBe(local(2026, 12, 1));
  expect(inAWeek9(new Date(2026, 11, 28, 12))).toBe(local(2027, 1, 4));
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

test("Monday is no choice of its own when it is tomorrow or a week away", () => {
  const tue = remindTimes(new Date(2026, 10, 24, 12));       // Tuesday
  expect(tue.monday).toBe(local(2026, 11, 30));
  expect(tue.tomorrow).toBe(local(2026, 11, 25));
  expect(tue.week).toBe(local(2026, 12, 1));
  expect(remindTimes(new Date(2026, 10, 29, 12)).monday).toBeNull();  // Sunday
  expect(remindTimes(new Date(2026, 10, 23, 12)).monday).toBeNull();  // Monday
  expect(remindTimes(new Date(2026, 10, 28, 12)).monday)              // Saturday
    .toBe(local(2026, 11, 30));
});

test("when a reminder is set: the weekday within a week, else the date", () => {
  const now = new Date(2026, 10, 24, 10);
  expect(whenText(local(2026, 11, 30), now)).toBe("Mon 09:00");
  expect(whenText(local(2026, 11, 25), now)).toBe("Wed 09:00");
  expect(whenText(local(2026, 12, 5), now)).toBe("5 Dec 09:00");
  setLang("de");
  expect(whenText(local(2026, 11, 30), now)).toMatch(/^Mo\.? 09:00$/);
});

test("the labels of the choices", () => {
  expect(tomorrowLabel(local(2026, 11, 25))).toBe("Tomorrow 09:00");
  expect(weekdayName(local(2026, 11, 30))).toBe("Monday");
  setLang("de");
  expect(tomorrowLabel(local(2026, 11, 25))).toBe("Morgen 09:00");
  expect(weekdayName(local(2026, 11, 30))).toBe("Montag");
});

test("which choice a set reminder is", () => {
  const now = new Date(2026, 10, 24, 10);
  expect(remindChoice(tomorrow9(now), now)).toBe("tomorrow");
  expect(remindChoice(nextMonday9(now), now)).toBe("monday");
  expect(remindChoice(inAWeek9(now), now)).toBe("week");
  expect(remindChoice(local(2026, 12, 12), now)).toBe("pick");
  // on a Sunday Monday IS tomorrow: that is the Tomorrow choice
  const sun = new Date(2026, 10, 29, 10);
  expect(remindChoice(nextMonday9(sun), sun)).toBe("tomorrow");
});

test("a date input value and back", () => {
  expect(dateValue(local(2026, 12, 5))).toBe("2026-12-05");
  expect(atDateValue("2026-12-05")).toBe(local(2026, 12, 5));
  expect(atDateValue("")).toBeNull();
  expect(atDateValue("5.12.2026")).toBeNull();
});

test("the pill: the days and how long they usually take, or how long they took", () => {
  expect(pillText(tax)).toMatch(/^9\sdays · usually 3$/);
  expect(pillText({ ...tax, usual_days: null })).toMatch(/^9\sdays$/);
  expect(pillText(opa)).toMatch(/^1\sday · usually 4$/);
  expect(pillText(answered)).toMatch(/^answered in 2\sdays$/);
  expect(daysText(12)).toMatch(/^12\sdays$/);
  expect(daysText(1)).toMatch(/^1\sday$/);
  expect(answeredText({ ...answered, answered_days: 1 })).toMatch(/^answered in 1\sday$/);
  expect(answeredText({ ...answered, answered_days: 0 })).toBe("answered the same day");
  setLang("de");
  expect(pillText(clara)).toMatch(/^6\sTage · meist 1$/);
  expect(daysText(3)).toMatch(/^3\sTage$/);
  expect(answeredText({ ...answered, answered_days: 0 })).toBe("am selben Tag beantwortet");
});

test("the third tile: how fast your contacts answer", () => {
  expect(typicalText(1.5)).toMatch(/^1\.5\sdays$/);
  expect(typicalText(1)).toMatch(/^1\sday$/);
  expect(typicalText(3)).toMatch(/^3\sdays$/);
  setLang("de");
  expect(typicalText(1.5)).toMatch(/^1,5\sTage$/);
});

test("an address is cut at the @, a name stays", () => {
  expect(shortName("steuerberater@kanzlei-brandt.example")).toBe("steuerberater@…");
  expect(shortName("Clara Neumann")).toBe("Clara Neumann");
  expect(shortName("@odd")).toBe("@odd");
});

test("the Overview row names who, shortened, and how many more", () => {
  const people = ["steuerberater@kanzlei-brandt.example", "Clara Neumann",
    "vermieter@hausverwaltung-nord.example"];
  expect(peopleLine(people, 0)).toBe("steuerberater@…, Clara Neumann, vermieter@…");
  expect(peopleLine(people, 2)).toBe(
    "steuerberater@…, Clara Neumann, vermieter@… +2");
});
