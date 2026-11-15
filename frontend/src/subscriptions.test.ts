// @vitest-environment jsdom
/* Subscriptions helpers: money in both languages, the next-receipt pill, the
 * unused names, and the .ics file (built locally: no request). */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setClockShift } from "./clock";
import { setLang } from "./i18n";
import { cadenceSentence, fmtMoney, icsName, monthlyText, nextPill,
  ordinal, pillText, subscriptionIcs, unusedNames } from "./subscriptions";
import { clouddrive, fittrack, ITEMS, newsdaily, NOW, resp, streambox }
  from "./subscriptionsFixtures";

beforeEach(() => {
  setLang("en");
  setClockShift(Date.now() - NOW * 1000);
});
afterEach(() => { setClockShift(0); setLang("en"); vi.unstubAllGlobals(); });

test("money: the symbol first in English, last in German; cents or whole", () => {
  expect(fmtMoney(7.99, "EUR")).toBe("€7.99");
  expect(fmtMoney(32.21, "EUR", { whole: true })).toBe("€32");
  expect(fmtMoney(39, "CHF")).toBe("CHF 39.00");
  expect(fmtMoney(1234.5, "USD")).toBe("$1,234.50");
  setLang("de");
  expect(fmtMoney(7.99, "EUR")).toBe("7,99 €");
  expect(fmtMoney(39, "CHF")).toBe("39,00 CHF");
  expect(fmtMoney(32.21, "EUR", { whole: true })).toBe("32 €");
});

test("ordinals: 1st 2nd 3rd 4th 11th 12th 13th 21st, German 5.", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  setLang("de");
  expect(ordinal(5)).toBe("5.");
});

test("the cadence sentence: the day of the month, or the date of a yearly one",
  () => {
    expect(cadenceSentence(streambox)).toBe("monthly, around the 5th");
    expect(cadenceSentence(clouddrive)).toMatch(/^yearly, around \d+ \w+/);
    setLang("de");
    expect(cadenceSentence(streambox)).toBe("monatlich, um den 5.");
  });

test("the next-receipt pill is for a yearly renewal within 60 days: in N days, "
  + "today, due; a monthly one never gets it", () => {
  expect(nextPill({ ...clouddrive, next_days: 61 })).toBeNull();
  const p = nextPill({ ...clouddrive, next_days: 60 })!;
  expect(pillText(p)).toBe("in 60\u00a0days");
  expect(pillText(nextPill({ ...clouddrive, next_days: 1 })!)).toBe("in 1\u00a0day");
  expect(pillText(nextPill({ ...clouddrive, next_days: 0 })!)).toBe("today");
  expect(pillText(nextPill({ ...clouddrive, next_days: -3 })!)).toBe("due now");
  expect(nextPill({ ...streambox, next_days: 5 })).toBeNull();
  setLang("de");
  expect(pillText(p)).toBe("in 60\u00a0Tagen");
});

test("unused names: at most two, then +N; hidden ones do not count", () => {
  expect(unusedNames(ITEMS)).toBe("FitTrack Premium, NewsDaily+");
  const three = [fittrack, newsdaily, { ...streambox, use: fittrack.use }];
  expect(unusedNames(three)).toBe("FitTrack Premium, NewsDaily+ +1");
  expect(unusedNames([{ ...fittrack, hidden: true }])).toBe("");
});

test("the monthly figure of the totals: whole euros, none without amounts",
  () => {
    expect(monthlyText(resp().totals)).toBe("€32");
    expect(monthlyText({ ...resp().totals, monthly: null })).toBeNull();
    expect(monthlyText({ ...resp().totals, currency: "" })).toBeNull();
  });

test(".ics: a VEVENT on the next expected date with an alarm 3 days before", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const ics = subscriptionIcs(fittrack, new Date(Date.UTC(2026, 10, 15, 10)));
  const lines = ics.split("\r\n");
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines.at(-2)).toBe("END:VCALENDAR");
  expect(lines.at(-1)).toBe("");                       // ends with CRLF
  expect(ics).not.toMatch(/(?<!\r)\n/);                // only CRLF line ends
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toContain("DTSTART;VALUE=DATE:20261205");
  expect(ics).toContain("DTEND;VALUE=DATE:20261206");
  expect(ics).toContain("DTSTAMP:20261115T100000Z");
  expect(ics).toContain("SUMMARY:FitTrack Premium bills again (expected)");
  expect(ics).toContain("About €7.99.");
  expect(ics).toContain("TRIGGER:-P3D");
  expect(ics).toContain("UID:inboxrake-sub-fittrack-example-20261205");
  expect(ics).not.toContain("@");                      // no address leaks in
  expect(fetchSpy).not.toHaveBeenCalled();             // nothing is requested
});

test(".ics: text is escaped, long lines folded, German words", () => {
  const odd = { ...fittrack, name: "A, B; C\\D " + "x".repeat(90) };
  const ics = subscriptionIcs(odd, new Date(0));
  expect(ics).toContain("SUMMARY:A\\, B\\; C\\\\D ");
  for (const line of ics.split("\r\n"))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(ics).toMatch(/\r\n [x]+/);                    // a continuation line
  setLang("de");
  expect(subscriptionIcs(fittrack, new Date(0)))
    .toContain("SUMMARY:FitTrack Premium rechnet wieder ab (erwartet)");
});

test("the file name is the service's name", () => {
  expect(icsName(fittrack)).toBe("FitTrack-Premium.ics");
  expect(icsName({ ...fittrack, name: "NewsDaily+" })).toBe("NewsDaily.ics");
  expect(icsName({ ...fittrack, name: "***" })).toBe("subscription.ics");
});
