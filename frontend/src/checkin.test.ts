// @vitest-environment jsdom
/* Weekly check-in, the pure parts: the week the kept place belongs to, the
 * place itself (kept until next week, ignored when damaged), where the stepper
 * resumes, the closing card's parts and the Next steps line's text. */

import { afterEach, beforeEach, expect, test } from "vitest";
import { addDid, clearProgress, leftActivity, lineText, loadProgress,
  minutesText, NO_DID, PLACES, progressKey, resumeIndex, saveProgress,
  summaryParts, weekId } from "./checkin";
import { setLang } from "./i18n";

// a Monday, a Wednesday and the Sunday that ends their week (local time)
const MON = new Date(2026, 10, 23, 9, 0).getTime();
const WED = new Date(2026, 10, 25, 14, 30).getTime();
const SUN = new Date(2026, 10, 29, 23, 59).getTime();
const NEXT_MON = new Date(2026, 10, 30, 0, 1).getTime();

beforeEach(() => setLang("en"));
afterEach(() => { localStorage.clear(); setLang("en"); });

test("a week is Monday to Sunday, named by its Monday", () => {
  for (const day of [MON, WED, SUN]) expect(weekId(day)).toBe("2026-11-23");
  expect(weekId(NEXT_MON)).toBe("2026-11-30");
  // a week that crosses a month and a year
  expect(weekId(new Date(2027, 0, 2, 12).getTime())).toBe("2026-12-28");
});

test("the places are in the order the server walks them", () => {
  expect([...PLACES]).toEqual(["new", "still", "past", "waiting", "rules",
    "junk"]);
});

const place = (over = {}) => ({ week: "2026-11-23", at: "past" as const,
  went: ["new" as const], did: { ...NO_DID, blocked: 2 }, ms: 90_000, ...over });

test("a kept place comes back during its week, per account", () => {
  saveProgress("proton", place());
  expect(loadProgress("proton", WED)).toEqual(place());
  expect(loadProgress("proton", SUN)).toEqual(place());
  expect(loadProgress("icloud", WED)).toBeNull();
  clearProgress("proton");
  expect(loadProgress("proton", WED)).toBeNull();
});

test("until next week: the place of an earlier week is not offered", () => {
  saveProgress("proton", place());
  expect(loadProgress("proton", NEXT_MON)).toBeNull();
});

test("a damaged place is no place", () => {
  const key = progressKey("proton");
  for (const raw of ["not json", "null", "[]", '{"week":"2026-11-23"}',
    '{"week":"2026-11-23","at":"nowhere"}']) {
    localStorage.setItem(key, raw);
    expect(loadProgress("proton", WED)).toBeNull();
  }
  // odd numbers and places inside an otherwise good record are cleaned
  localStorage.setItem(key, JSON.stringify({ week: "2026-11-23", at: "junk",
    went: ["new", "elsewhere", 3], ms: "soon",
    did: { blocked: -4, trashed: 2.7, reminders: "x" } }));
  expect(loadProgress("proton", WED)).toEqual({ week: "2026-11-23",
    at: "junk", went: ["new"], ms: 0,
    did: { ...NO_DID, trashed: 2 } });
});

test("the stepper resumes at the kept place, or the next one that has " +
  "something", () => {
  expect(resumeIndex(["new", "past", "junk"], null)).toBe(0);
  expect(resumeIndex(["new", "past", "junk"], "past")).toBe(1);
  // the kept place has emptied meanwhile: the next place after it
  expect(resumeIndex(["new", "junk"], "past")).toBe(1);
  expect(resumeIndex(["new", "past", "junk"], "new")).toBe(0);
  // nothing is left after it: the closing card
  expect(resumeIndex(["new", "past"], "junk")).toBe(2);
  expect(resumeIndex([], "new")).toBe(0);
});

test("the closing card counts the steps walked through and only what was " +
  "confirmed", () => {
  expect(summaryParts(NO_DID, 0)).toEqual([]);
  expect(summaryParts(NO_DID, 1)).toEqual(["1 step"]);
  expect(summaryParts({ ...NO_DID, trashedPast: 47, blocked: 2, reminders: 1 },
    5)).toEqual(["5 steps", "47 mails past their date to Trash",
    "2 senders blocked", "1 reminder set"]);
  expect(summaryParts({ trashed: 3, trashedPast: 0, blocked: 1,
    unsubscribed: 1, notJunk: 4, reminders: 2, noAnswer: 1, rules: 2 }, 2))
    .toEqual(["2 steps", "3 mails to Trash", "1 sender blocked",
      "1 sender unsubscribed", "4 mails back to the Inbox",
      "2 reminders set", "1 marked as no answer needed",
      "2 rule findings dealt with"]);
});

test("the closing card in German", () => {
  setLang("de");
  expect(summaryParts({ ...NO_DID, blocked: 1, trashedPast: 2 }, 3)).toEqual([
    "3 Schritte", "2 abgelaufene Mails in den Papierkorb",
    "1 Absender blockiert"]);
});

test("only a step that left an Activity entry says so", () => {
  expect(leftActivity(NO_DID)).toBe(false);
  expect(leftActivity({ ...NO_DID, reminders: 3, noAnswer: 1, rules: 2 }))
    .toBe(false);
  for (const k of ["trashed", "trashedPast", "blocked", "unsubscribed",
    "notJunk"] as const)
    expect(leftActivity({ ...NO_DID, [k]: 1 })).toBe(true);
});

test("things done add up; nothing negative", () => {
  expect(addDid(NO_DID, { blocked: 1, trashed: 4 })).toEqual(
    { ...NO_DID, blocked: 1, trashed: 4 });
  expect(addDid({ ...NO_DID, blocked: 1 }, { blocked: 2, trashed: -5 }))
    .toEqual({ ...NO_DID, blocked: 3 });
});

test("the Next steps line: things, the window, minutes", () => {
  expect(lineText(6, 2, "week")).toBe("6 things this week · about 2 minutes");
  expect(lineText(1, 1, "week")).toBe("1 thing this week · about 1 minute");
  expect(lineText(3, 1, "since")).toBe(
    "3 things since your last visit · about 1 minute");
  expect(minutesText(0)).toBe("about 1 minute");
  setLang("de");
  expect(lineText(6, 2, "week")).toBe("6 Dinge diese Woche · etwa 2 Minuten");
  expect(lineText(1, 1, "since")).toBe(
    "1 Ding seit deinem letzten Besuch · etwa 1 Minute");
});
