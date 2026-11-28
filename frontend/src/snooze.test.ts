// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { setLang } from "./i18n";
import { DE } from "./locales/de";
import { EN } from "./locales/en";
import { batchWhen, epoch, localInput, menuTime, parseLocalInput, slotLabel,
  slotSentence, slotTime, snoozeChoices, whenText, zoneName } from "./snooze";

afterEach(() => setLang("en"));

/** Local date helper: month is 1-based. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi);
const keys = (now: Date) => snoozeChoices(now).map((c) => c.key);
const wall = (c: { at: Date }) => `${c.at.getDate()} ${c.at.getHours()}:${
  String(c.at.getMinutes()).padStart(2, "0")}`;

// 2026-11-23 is a Monday.
test("a Tuesday morning offers four times, soonest first", () => {
  const now = at(2026, 11, 24, 9, 30);
  const c = snoozeChoices(now);
  expect(c.map((x) => x.key)).toEqual(["later", "tomorrow", "weekend",
    "monday"]);
  expect(c.map(wall)).toEqual(["24 18:00", "25 8:00", "28 9:00", "30 8:00"]);
});

test("a Friday: tomorrow morning, Monday, and the weekend after tomorrow (the board's example)", () => {
  const c = snoozeChoices(at(2026, 11, 27, 10));
  expect(c.map((x) => x.key)).toEqual(["later", "tomorrow", "monday",
    "weekend"]);
  expect(c.map(wall)).toEqual(["27 18:00", "28 8:00", "30 8:00", "5 9:00"]);
});

test("later today moves to the next full hour once 18:00 is near, and goes at night", () => {
  expect(wall(snoozeChoices(at(2026, 11, 24, 17, 20))[0])).toBe("24 19:00");
  expect(wall(snoozeChoices(at(2026, 11, 24, 17, 0))[0])).toBe("24 18:00");
  expect(wall(snoozeChoices(at(2026, 11, 24, 19, 5))[0])).toBe("24 21:00");
  expect(keys(at(2026, 11, 24, 22, 30))).not.toContain("later");
  expect(keys(at(2026, 11, 24, 23, 10))).not.toContain("later");
});

test("the weekend is the first Saturday 09:00 more than two days ahead", () => {
  const sat = (now: Date) => wall(snoozeChoices(now).find(
    (c) => c.key === "weekend")!);
  expect(sat(at(2026, 11, 23, 7))).toBe("28 9:00");   // Mon
  expect(sat(at(2026, 11, 25, 7))).toBe("28 9:00");   // Wed: three days
  expect(sat(at(2026, 11, 26, 7))).toBe("5 9:00");    // Thu: two days is too close
  expect(sat(at(2026, 11, 27, 7))).toBe("5 9:00");    // Fri: not tomorrow
  expect(sat(at(2026, 11, 28, 7))).toBe("5 9:00");    // Sat: a week ahead
  expect(sat(at(2026, 11, 29, 7))).toBe("5 9:00");    // Sun
});

test("Monday morning is the coming Monday 08:00, a week ahead on a Monday, and not offered on a Sunday", () => {
  const mon = (now: Date) => snoozeChoices(now).find((c) => c.key === "monday");
  expect(wall(mon(at(2026, 11, 23, 7))!)).toBe("30 8:00");   // Mon -> next Mon
  expect(wall(mon(at(2026, 11, 27, 7))!)).toBe("30 8:00");   // Fri
  expect(wall(mon(at(2026, 11, 28, 7))!)).toBe("30 8:00");   // Sat
  expect(mon(at(2026, 11, 29, 7))).toBeUndefined();          // Sun: tomorrow
});

test("choices cross a month end", () => {
  const c = snoozeChoices(at(2026, 11, 30, 12));         // Monday
  expect(c.find((x) => x.key === "tomorrow")!.at.getMonth()).toBe(11);
  expect(wall(c.find((x) => x.key === "monday")!)).toBe("7 8:00");
});

test("epoch seconds are whole and match the Date", () => {
  const d = at(2026, 11, 24, 9, 30);
  expect(epoch(d)).toBe(Math.floor(d.getTime() / 1000));
  expect(Number.isInteger(epoch(d))).toBe(true);
});

test("menu times: the clock today, the weekday within a week, the date beyond", () => {
  const now = at(2026, 11, 24, 9, 30);
  expect(menuTime(at(2026, 11, 24, 18), now)).toBe("18:00");
  expect(menuTime(at(2026, 11, 25, 8), now)).toBe("Wed 08:00");
  expect(menuTime(at(2026, 11, 30, 8), now)).toBe("Mon 08:00");
  expect(menuTime(at(2026, 12, 5, 9), now)).toBe("Sat 5 Dec");
  setLang("de");
  expect(menuTime(at(2026, 11, 28, 9), now)).toMatch(/^Sa\.? 09:00$/);
  expect(menuTime(at(2026, 12, 5, 9), now)).toMatch(/^Sa\.? 5\. Dez\.?$/);
  // the same weekday spelling beside a clock and beside a date
  expect(menuTime(at(2026, 11, 28, 9), now).split(" ")[0])
    .toBe(menuTime(at(2026, 12, 5, 9), now).split(" ")[0]);
});

test("a return time is worded today / tomorrow / weekday / date", () => {
  const now = at(2026, 11, 24, 9, 30);
  const ts = (d: Date) => epoch(d);
  expect(whenText(ts(at(2026, 11, 24, 18)), now)).toBe("today 18:00");
  expect(whenText(ts(at(2026, 11, 25, 8)), now)).toBe("tomorrow 08:00");
  expect(whenText(ts(at(2026, 11, 28, 9)), now)).toBe("Sat 09:00");
  expect(whenText(ts(at(2026, 12, 1, 9)), now)).toBe("1 Dec 09:00");
  setLang("de");
  expect(whenText(ts(at(2026, 11, 25, 8)), now)).toBe("morgen 08:00");
  expect(whenText(ts(at(2026, 12, 1, 9)), now)).toBe("1. Dez. 09:00");
});

test("a batch's slot reads off its next delivery: the weekday for a weekly one", () => {
  expect(batchWhen("weekly", epoch(at(2026, 11, 28, 9)))).toBe("Sat 09:00");
  expect(batchWhen("daily", epoch(at(2026, 11, 24, 18)))).toBe("18:00");
});

test("batch slots: Saturday 09:00 and every day 18:00, always in the future", () => {
  const tue = at(2026, 11, 24, 9, 30);
  expect(slotTime("weekly", tue)).toEqual(at(2026, 11, 28, 9));
  expect(slotTime("daily", tue)).toEqual(at(2026, 11, 24, 18));
  const sat = at(2026, 11, 28, 9, 30);
  expect(slotTime("weekly", sat)).toEqual(at(2026, 12, 5, 9));
  expect(slotTime("daily", at(2026, 11, 24, 18, 0))).toEqual(at(2026, 11, 25, 18));
  expect(slotLabel("weekly", tue)).toBe("Sat 09:00");
  expect(slotLabel("daily", tue)).toBe("18:00");
  expect(slotSentence("weekly", tue)).toBe("once a week, Sat 09:00");
  setLang("de");
  expect(slotSentence("daily", tue)).toBe("einmal pro Tag, 18:00");
});

test("datetime-local values round trip and reject text", () => {
  const d = at(2026, 12, 1, 9, 5);
  expect(localInput(d)).toBe("2026-12-01T09:05");
  expect(parseLocalInput("2026-12-01T09:05")).toEqual(d);
  expect(parseLocalInput("")).toBeNull();
  expect(parseLocalInput("tomorrow")).toBeNull();
  expect(parseLocalInput("2026-12-01")).toBeNull();
});

test("the zone name is the browser's (or empty)", () => {
  expect(typeof zoneName()).toBe("string");
});

test("every Not now string has a German twin", () => {
  const mine = (k: string) => k.startsWith("snooze.") || k === "toast.snoozed"
    || k.startsWith("toast.snoozed_") || k.startsWith("audit.h.snooze")
    || k.startsWith("audit.act.snooze") || k === "audit.by_snooze"
    || k === "role.snoozed" || k.startsWith("ferr.snooze_");
  const en = Object.keys(EN).filter(mine).sort();
  expect(en.length).toBeGreaterThan(60);
  // the keys the old (reverted) design had and this one does not use
  expect(en).not.toContain("snooze.chip_day");
  expect(Object.keys(DE).filter(mine).sort()).toEqual(en);
});
