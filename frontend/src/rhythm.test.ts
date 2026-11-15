// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { setLang } from "./i18n";
import {
  busiest, daysText, gridMax, heatLevel, kpiShares, quietest, rateText,
  senderRhythm, standsOut, usuallyText, weekdayName,
  type RhythmKind, type RhythmKindData, type RhythmResp,
} from "./rhythm";

afterEach(() => setLang("en"));

const blank = () => Array.from({ length: 7 }, () => Array(24).fill(0));
const kind = (grid: number[][], top: RhythmKindData["top"] = {}): RhythmKindData =>
  ({ total: grid.flat().reduce((a, b) => a + b, 0), grid, top });
const resp = (over: Partial<Record<RhythmKind, RhythmKindData>> = {},
    daily: RhythmResp["daily"] = []): RhythmResp => ({
  period: "30d", tz: "UTC", from: 0, daily,
  kinds: { all: kind(blank()), newsletters: kind(blank()),
    people: kind(blank()), orders: kind(blank()), ...over },
});

test("the colour step is quantised on the period's own maximum", () => {
  expect(heatLevel(0, 10)).toBe(0);
  expect(heatLevel(1, 10)).toBe(1);       // anything above zero is visible
  expect(heatLevel(3, 10)).toBe(2);
  expect(heatLevel(5, 10)).toBe(2);
  expect(heatLevel(6, 10)).toBe(3);
  expect(heatLevel(8, 10)).toBe(4);
  expect(heatLevel(10, 10)).toBe(4);      // the busiest slot is the top step
  // the same count is a different step on a quieter period
  expect(heatLevel(3, 3)).toBe(4);
  expect(heatLevel(3, 100)).toBe(1);
  expect(heatLevel(2, 0)).toBe(0);
});

test("busiest and quietest slot", () => {
  const g = blank();
  g[1][6] = 46; g[0][6] = 31; g[6][9] = 2;
  expect(busiest(g)).toEqual({ day: 1, hour: 6, count: 46 });
  expect(gridMax(g)).toBe(46);
  expect(busiest(blank())).toBeNull();
  // an empty Sunday night is the quietest block (a later one wins a tie)
  expect(quietest(blank())).toEqual({ day: 6, part: 3 });
  const h = blank().map((r) => r.map(() => 1));
  h[2][0] = 0;                              // Wednesday small hours
  expect(quietest(h)).toEqual({ day: 2, part: 0 });
});

test("the four shares overlap by design and are percents of the period", () => {
  const g = blank();
  g[0][6] = 38;                 // Monday before 8:00
  g[1][10] = 31;                // Tuesday office hours
  g[2][19] = 24;                // Wednesday evening
  g[5][3] = 7;                  // Saturday night: before 8:00 AND weekend
  expect(kpiShares(g)).toEqual({ before: 45, office: 31, after: 24, weekend: 7 });
  expect(kpiShares(blank())).toEqual({ before: 0, office: 0, after: 0, weekend: 0 });
});

test("weekday names follow the language; ranges read as ranges", () => {
  expect(weekdayName(0)).toBe("Mon");
  expect(weekdayName(6, true)).toBe("Sunday");
  expect(daysText([0, 1, 2, 3])).toBe("Mon - Thu");
  expect(daysText([3, 4])).toBe("Thu, Fri");
  expect(daysText([0, 2, 4])).toBe("Mon, Wed, Fri");
  setLang("de");
  expect(weekdayName(0)).toBe("Mo");
  expect(weekdayName(4, true)).toBe("Freitag");
});

// ------------------------------------------------------------ What stands out

const wave = (n = 62, rest = 38) => {
  const g = blank();
  g[0][6] = n; g[1][12] = rest;
  return kind(g, { "0-6": { senders: [{ key: "a", label: "Deals", count: n }], more: 0 } });
};

test("the morning wave speaks only when most of the kind arrives before 8:00", () => {
  const out = standsOut(resp({ newsletters: wave() }));
  expect(out.map((s) => s.id)).toEqual(["wave"]);
  expect(out[0].title).toBe("62% of newsletters arrive before 8:00");
  expect(out[0].action?.slot).toMatchObject({ kind: "newsletters", from: 0, to: 8 });
  // 49%: no sentence; a thin sample (19 mails): none either
  expect(standsOut(resp({ newsletters: wave(49, 51) }))).toEqual([]);
  expect(standsOut(resp({ newsletters: wave(12, 7) }))).toEqual([]);
});

test("a daily sender becomes a sentence with Unsubscribe", () => {
  const out = standsOut(resp({}, [{ key: "d@x.example", label: "Deals Daily",
    hour: 6, per_day: 4.1, mails: 123, open_pct: 2 }]));
  expect(out).toHaveLength(1);
  expect(out[0].title).toBe("Deals Daily mails you every day at 06:0x");
  expect(out[0].detail).toBe("4.1 mails a day · you open 2%");
  expect(out[0].action).toEqual({ label: "Unsubscribe…", unsubscribe: "d@x.example" });
  const one = standsOut(resp({}, [{ key: "d", label: "D", hour: 7, per_day: 1,
    mails: 30, open_pct: 0 }]));
  expect(one[0].detail).toBe("1 mail a day · you open 0%");
});

const evening = (a: number, b: number, rest: number) => {
  const g = blank();
  for (const d of [0, 1, 2]) g[d][19] = rest;
  g[a][19] = 9; g[b][20] = 9;
  return kind(g, {
    [`${a}-19`]: { senders: [{ key: "s", label: "Acme Store", count: 9 },
      { key: "g", label: "Gadget Weekly", count: 3 }], more: 0 } });
};

test("the evening block names the two weekdays and how much more mail they get", () => {
  const out = standsOut(resp({ orders: evening(3, 4, 3) }));
  expect(out).toHaveLength(1);
  expect(out[0].title).toBe("Thursday and Friday evening: 3× the shop mail");
  expect(out[0].detail).toBe("Acme Store, Gadget Weekly");
  expect(out[0].action?.slot).toEqual({ kind: "orders", period: "30d",
    days: [3, 4], from: 18, to: 22 });
  // an even week: no peak, no sentence
  const flat = blank();
  for (const d of [0, 1, 2, 3, 4]) flat[d][19] = 6;
  expect(standsOut(resp({ orders: kind(flat) }))).toEqual([]);
});

test("people you write to: their weekdays and hours, and their share", () => {
  const g = blank();
  for (const d of [0, 1, 2, 3]) for (let h = 9; h < 17; h++) g[d][h] = 3;
  g[5][11] = 1;
  const all = blank();
  all[0][5] = 800;
  const out = standsOut(resp({ people: kind(g), all: kind(all) }));
  expect(out.map((s) => s.id)).toEqual(["people"]);
  expect(out[0].title).toBe("People you write to: Mon - Thu, 9 - 17");
  expect(out[0].detail).toBe("Their mail is 12% of everything");
});

test("at most four sentences, in the order of the board", () => {
  const daily = [1, 2, 3].map((i) => ({ key: `d${i}`, label: `D${i}`, hour: 6,
    per_day: 1, mails: 30, open_pct: 0 }));
  const g = blank();
  for (const d of [0, 1, 2, 3]) for (let h = 9; h < 17; h++) g[d][h] = 3;
  const out = standsOut(resp({ newsletters: wave(), orders: evening(3, 4, 3),
    people: kind(g) }, daily));
  expect(out.map((s) => s.id)).toEqual(["wave", "daily:d1", "evening", "people"]);
});

test("German sentences", () => {
  setLang("de");
  const out = standsOut(resp({ newsletters: wave(), orders: evening(3, 4, 3) },
    [{ key: "d", label: "Deals Daily", hour: 6, per_day: 4.1, mails: 99, open_pct: 2 }]));
  expect(out.map((s) => s.title)).toEqual([
    "62\u00a0% der Newsletter kommen vor 8:00 Uhr",
    "Deals Daily schreibt dir jeden Tag um 06:0x Uhr",
    "Donnerstag und Freitag abends: 3× so viel Shop-Post"]);
  expect(out[1].detail).toBe("4,1 Mails am Tag · du öffnest 2\u00a0%");
  expect(out[1].action?.label).toBe("Abbestellen…");
});

// ------------------------------------------------------------ sender strip

// local times: the strip reads the browser's own zone, whatever it is
const at = (day: number, h: number, mi = 0) =>
  new Date(2026, 0, day, h, mi).getTime() / 1000;

test("a daily sender: usual hours, every day, mails per day", () => {
  const stamps: number[] = [];
  for (let d = 1; d <= 14; d++) {          // two weeks, 4 mails a day at 06:xx
    for (let k = 0; k < 4; k++) stamps.push(at(d, 6, 5 + k * 10));
  }
  stamps.push(at(14, 6, 55));              // 57 mails over 14 days
  const r = senderRhythm(stamps)!;
  expect(r.hours[6]).toBe(57);
  expect([r.from, r.to]).toEqual([6, 7]);
  expect(r.weekdays).toHaveLength(7);
  expect(usuallyText(r)).toBe("Usually 06:00 - 07:00, every day");
  expect(rateText(r.perDay)).toBe("4.1 a day");
});

test("the usual window grows over neighbouring hours; weekday senders", () => {
  const stamps: number[] = [];
  // Mon-Fri (2026-01-05 is a Monday): hours 08 and 09 busy, 12 not
  for (const d of [5, 6, 7, 8, 9]) {
    stamps.push(at(d, 8), at(d, 8, 30), at(d, 9), at(d, 9, 15), at(d, 12));
  }
  stamps.push(at(12, 8), at(12, 8), at(12, 9));
  const r = senderRhythm(stamps)!;
  expect([r.from, r.to]).toEqual([8, 10]);
  expect(r.weekdays).toEqual([0, 1, 2, 3, 4]);
  expect(usuallyText(r)).toBe("Usually 08:00 - 10:00, on weekdays");
});

test("a thin history shows no rhythm; sparse senders switch the unit", () => {
  expect(senderRhythm([at(1, 6), at(2, 6)])).toBeNull();
  expect(rateText(1 / 7)).toBe("1 a week");
  expect(rateText(1 / 30)).toBe("1 a month");
  expect(rateText(0.5)).toBe("0.5 a day");
  setLang("de");
  expect(rateText(4.1)).toBe("4,1 am Tag");
});
