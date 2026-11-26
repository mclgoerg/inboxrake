/* Waiting for a reply (Insights -> Waiting for a reply): the small pure
 * helpers the page, the pane, the Overview row and the tests share - the
 * times "Remind me" offers and how a row's age and a reminder read. The
 * matching itself is the server's (backend/waiting.py); nothing here is sent
 * anywhere. */

import { getLang, t } from "./i18n";
import { fmtTs } from "./lib";
import type { WaitingItem } from "./types";

/** The hour of day a reminder is set for. */
export const REMIND_HOUR = 9;

const locale = (): string => getLang() === "de" ? "de-DE" : "en-GB";

/** 09:00 local time on `d`'s day, as epoch seconds. */
export const at9 = (d: Date): number => Math.floor(new Date(
  d.getFullYear(), d.getMonth(), d.getDate(), REMIND_HOUR, 0, 0).getTime()
  / 1000);

const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Tomorrow, 09:00. */
export const tomorrow9 = (now: Date): number => at9(addDays(now, 1));

/** The next Monday after today, 09:00 (a Monday asks for the one after). */
export const nextMonday9 = (now: Date): number =>
  at9(addDays(now, ((8 - now.getDay()) % 7) || 7));

/** In a week (the same weekday), 09:00. */
export const inAWeek9 = (now: Date): number => at9(addDays(now, 7));

export type RemindChoice = "tomorrow" | "monday" | "week" | "pick";

/** The ready-made times, in the order the pane lists them. Monday is left
 *  out when it is tomorrow (a Sunday) or a week away (a Monday): the same
 *  time twice is no choice. */
export function remindTimes(now: Date): { tomorrow: number;
  monday: number | null; week: number } {
  const tomorrow = tomorrow9(now), week = inAWeek9(now);
  const monday = nextMonday9(now);
  return { tomorrow, week,
    monday: monday === tomorrow || monday === week ? null : monday };
}

/** Which ready-made choice a set reminder is, else "pick". */
export function remindChoice(at: number, now: Date): RemindChoice {
  const r = remindTimes(now);
  if (at === r.tomorrow) return "tomorrow";
  if (r.monday !== null && at === r.monday) return "monday";
  if (at === r.week) return "week";
  return "pick";
}

/** "Mon" for the day of `ts`. */
const weekday = (ts: number, style: "short" | "long" = "short"): string =>
  new Intl.DateTimeFormat(locale(), { weekday: style })
    .format(new Date(ts * 1000));

/** "Monday" / "Montag": the choice's label. */
export const weekdayName = (ts: number): string => weekday(ts, "long");

/** "09:00" (24-hour in both languages). */
const clock = (ts: number): string => {
  const d = new Date(ts * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** "Tomorrow 09:00": the first choice's label. */
export const tomorrowLabel = (ts: number): string =>
  t("waiting.rem_tomorrow", { time: clock(ts) });

/** When a reminder is set for: "Mon 09:00" within the coming week, else
 *  "5 Dec 09:00". */
export function whenText(ts: number, now: Date): string {
  const days = (at9(new Date(ts * 1000)) - at9(now)) / 86400;
  const day = days >= 0 && days < 7 ? weekday(ts) : fmtTs(ts, getLang(), false);
  return `${day} ${clock(ts)}`;
}

/** The date input's value ("2026-12-05") of a time, in local time. */
export const dateValue = (ts: number): string => {
  const d = new Date(ts * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

/** 09:00 local on a date input's value; null for a value that is no date. */
export function atDateValue(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? at9(new Date(+m[1], +m[2] - 1, +m[3])) : null;
}

/** "12 days" / "1 day". */
export const daysText = (n: number): string => t("waiting.n_days", { n });

/** The pill of a row: "9 days · usually 3" while it waits, how long they
 *  took once answered. */
export function pillText(item: WaitingItem): string {
  if (item.state === "answered") return answeredText(item);
  return item.usual_days !== null
    ? `${daysText(item.days)} · ${t("waiting.usually",
      { n: item.usual_days })}` : daysText(item.days);
}

/** The pill of an answered row: how long they took. */
export const answeredText = (item: WaitingItem): string =>
  (item.answered_days ?? 0) === 0 ? t("waiting.answered_same")
    : t("waiting.answered_after", { n: item.answered_days ?? 0 });

/** The page's third tile: "1.5 days". */
export const typicalText = (days: number): string =>
  t("waiting.tile_days", { n: days });

/** A name for a short line: an address is cut at the @ ("steuerberater@…"),
 *  a display name stays. */
export function shortName(name: string): string {
  const at = name.indexOf("@");
  return at > 0 ? `${name.slice(0, at + 1)}…` : name;
}

/** The Overview row's second line: "steuerberater@…, Clara Neumann +1". */
export const peopleLine = (people: string[], more: number): string =>
  people.map(shortName).join(", ") + (more > 0 ? ` +${more}` : "");
