/* Pure helpers of Not now (snooze and batches, backend/snooze.py): the times
 * the menu offers, how a return time is worded, the batch slots. Every time
 * is the browser's own clock; the server only ever sees epoch seconds (and,
 * for a batch, the IANA zone name). */

import { nowDate } from "./clock";
import { getLang, t } from "./i18n";
import type { BatchSlot } from "./types";
import { shortDay, timeOf } from "./timemachine";

export type SnoozeKey = "later" | "tomorrow" | "monday" | "weekend";

export interface SnoozeChoice {
  key: SnoozeKey;
  at: Date;
}

/** The batch slots (backend snooze.py WEEKLY / DAILY): Saturday 09:00 and
 *  every day 18:00 of the user's own clock. */
export const WEEKLY_SLOT = { day: 6, hour: 9 };
export const DAILY_SLOT = { hour: 18 };

const HOUR_MS = 3600_000;

/** `base` moved by `days`, at `hour`:`minute` local time. */
function at(base: Date, days: number, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** The times Not now offers from `now`, soonest first: Later today (18:00, or
 *  the next full hour once it is less than an hour away; gone late in the
 *  evening), Tomorrow morning (08:00), Monday morning (the coming Monday
 *  08:00; not offered on a Sunday, when it is tomorrow) and Next weekend (the
 *  first Saturday 09:00 that is more than two days ahead - on a Friday that
 *  is not tomorrow but the Saturday after). */
export function snoozeChoices(now: Date = nowDate()): SnoozeChoice[] {
  const out: SnoozeChoice[] = [];
  let later = at(now, 0, 18);
  if (later.getTime() - now.getTime() < HOUR_MS) {
    later = new Date(now.getTime() + HOUR_MS);
    if (later.getMinutes() || later.getSeconds()) later.setHours(later.getHours() + 1);
    later.setMinutes(0, 0, 0);
  }
  if (later.getDate() === now.getDate()) out.push({ key: "later", at: later });
  out.push({ key: "tomorrow", at: at(now, 1, 8) });
  const day = now.getDay();                 // 0 = Sunday ... 6 = Saturday
  const toMonday = (8 - day) % 7 || 7;      // 1 on a Sunday ... 7 on a Monday
  if (toMonday > 1) out.push({ key: "monday", at: at(now, toMonday, 8) });
  let toSaturday = (6 - day + 7) % 7 || 7;  // 7 on a Saturday
  if (toSaturday <= 2) toSaturday += 7;
  out.push({ key: "weekend", at: at(now, toSaturday, 9) });
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Epoch seconds of a Date: what the server takes. */
export const epoch = (d: Date): number => Math.floor(d.getTime() / 1000);

const locale = (): string => getLang() === "de" ? "de-DE" : "en-GB";

/** "Wed" / "Mi." */
const weekday = (d: Date): string =>
  new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(d);

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

/** What a menu row shows on its right: `18:00` today, `Sat 08:00` within a
 *  week (the weekday and the clock), `Sat 5 Dec` beyond (the way the board
 *  draws them). */
export function menuTime(when: Date, now: Date = nowDate()): string {
  const time = timeOf(epoch(when));
  if (sameDay(when, now)) return time;
  if (daysAhead(when, now) < 7) return `${weekday(when)} ${time}`;
  // (the weekday spelled as in `Sat 09:00`: a weekday beside a date would
  // otherwise come out as "Sa." in German and "So" beside a clock)
  const day = new Intl.DateTimeFormat(locale(), { day: "numeric",
    month: "short" }).format(when);
  return `${weekday(when)} ${day}`;
}

/** Whole days from `now`'s day to `when`'s day. */
const daysAhead = (when: Date, now: Date): number =>
  Math.round((at(when, 0, 12).getTime() - at(now, 0, 12).getTime()) / (24 * HOUR_MS));

/** When mail comes back, in words: "today 18:00", "tomorrow 08:00", "Sat
 *  09:00" within a week, "1 Dec 09:00" beyond. */
export function whenText(ts: number, now: Date = nowDate()): string {
  const d = new Date(ts * 1000);
  const time = timeOf(ts);
  const n = daysAhead(d, now);
  if (n <= 0) return t("snooze.when_today", { time });
  if (n === 1) return t("snooze.when_tomorrow", { time });
  return n < 7 ? `${weekday(d)} ${time}` : `${shortDay(ts)} ${time}`;
}

/** When a batch delivers, as the Snoozed page words it: `Sat 09:00` for a
 *  weekly batch, `18:00` for a daily one - read off its next delivery `ts`. */
export function batchWhen(slot: BatchSlot, ts: number): string {
  const d = new Date(ts * 1000);
  return slot === "weekly" ? `${weekday(d)} ${timeOf(ts)}` : timeOf(ts);
}

/** The next delivery of a batch slot after `now`, as the server computes it
 *  (for the menu rows before anything is set): Saturday 09:00 / 18:00. */
export function slotTime(slot: BatchSlot, now: Date = nowDate()): Date {
  if (slot === "weekly") {
    const d = at(now, (WEEKLY_SLOT.day - now.getDay() + 7) % 7, WEEKLY_SLOT.hour);
    return d > now ? d : at(d, 7, WEEKLY_SLOT.hour);
  }
  const d = at(now, 0, DAILY_SLOT.hour);
  return d > now ? d : at(d, 1, DAILY_SLOT.hour);
}

/** "Sat 09:00" / "18:00": what a batch menu row shows on its right. The
 *  weekday of a weekly slot is always shown. */
export function slotLabel(slot: BatchSlot, now: Date = nowDate()): string {
  const d = slotTime(slot, now);
  return slot === "weekly" ? `${weekday(d)} ${timeOf(epoch(d))}` : timeOf(epoch(d));
}

/** "once a week, Sat 09:00" / "once a day, 18:00". */
export const slotSentence = (slot: BatchSlot, now: Date = nowDate()): string =>
  t(slot === "weekly" ? "snooze.slot_weekly" : "snooze.slot_daily",
    { when: slotLabel(slot, now) });

/** The user's IANA time zone ("" when the browser does not tell). */
export function zoneName(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; }
  catch { return ""; }
}

/** `YYYY-MM-DDTHH:mm` of a Date in local time (a datetime-local input). */
export function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A datetime-local value as a Date; null when it is empty or not a time. */
export function parseLocalInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}
