/* Pure helpers of Not now (snooze and batches, backend/snooze.py): the times
 * the menu offers, how a return time is worded, the batch slots. Every time
 * is the browser's own clock; the server only ever sees epoch seconds (and,
 * for a batch, the IANA zone name). */

import { nowDate } from "./clock";
import { getLang, t } from "./i18n";
import type { BatchSlot } from "./types";
import { shortDay, timeOf } from "./timemachine";

export type SnoozeKey = "later" | "tomorrow" | "weekend" | "nextweek";

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

/** The times Not now offers from `now`: Later today (18:00, or the next full
 *  hour once it is less than an hour away; gone late in the evening),
 *  Tomorrow morning (08:00), This weekend (Saturday 09:00, Monday to Friday
 *  only) and Next week (Monday 08:00). */
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
  if (day >= 1 && day <= 5) out.push({ key: "weekend", at: at(now, 6 - day, 9) });
  out.push({ key: "nextweek", at: at(now, (8 - day) % 7 || 7, 8) });
  return out;
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

/** The clock a menu row shows on its right: `18:00` today, `Wed 08:00`
 *  otherwise (the weekday, the way the board draws it). */
export function menuTime(when: Date, now: Date = nowDate()): string {
  const time = timeOf(epoch(when));
  return sameDay(when, now) ? time : `${weekday(when)} ${time}`;
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

/** The blue chip of a sender row: "back tomorrow" / "back Sat" / "back 1 Dec". */
export function chipText(ts: number, now: Date = nowDate()): string {
  const d = new Date(ts * 1000);
  const n = daysAhead(d, now);
  if (n <= 0) return t("snooze.chip_today");
  if (n === 1) return t("snooze.chip_tomorrow");
  return t("snooze.chip_day", { day: n < 7 ? weekday(d) : shortDay(ts) });
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
