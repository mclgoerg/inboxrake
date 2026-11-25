/* Waiting for a reply (Insights -> Waiting for a reply): the small pure
 * helpers the page, the pane, the Overview line and the tests share - the
 * times "Remind me" offers and how a row's age and a reminder read. The
 * matching itself is the server's (backend/waiting.py); nothing here is sent
 * anywhere. */

import { getLang, t } from "./i18n";
import { fmtTs } from "./lib";
import type { WaitingItem, WaitingSummary } from "./types";

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

/** "Mon" for the day of `ts`. */
const weekday = (ts: number): string =>
  new Intl.DateTimeFormat(locale(), { weekday: "short" })
    .format(new Date(ts * 1000));

/** "09:00" (24-hour in both languages). */
const clock = (ts: number): string => {
  const d = new Date(ts * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** When a reminder is set for: "Mon 09:00" within the coming week, else
 *  "5 Dec 09:00". */
export function whenText(ts: number, now: Date): string {
  const days = (at9(new Date(ts * 1000)) - at9(now)) / 86400;
  const day = days >= 0 && days < 7 ? weekday(ts) : fmtTs(ts, getLang(), false);
  return `${day} ${clock(ts)}`;
}

/** Which of the three choices a set reminder is. */
export function remindChoice(at: number, now: Date): "tomorrow" | "monday" | "pick" {
  if (at === tomorrow9(now)) return "tomorrow";
  if (at === nextMonday9(now)) return "monday";
  return "pick";
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

/** After how many days a mail counts as waiting: the setting, or the
 *  person's usual answer time when that is longer. */
export const limitDays = (item: WaitingItem, threshold: number): number =>
  Math.max(threshold, item.usual_days ?? 0);

/** "12 days" / "1 day" (the pill). */
export const daysText = (n: number): string => t("waiting.n_days", { n });

/** The pill of an answered row: how long they took. */
export const answeredText = (item: WaitingItem): string =>
  (item.answered_days ?? 0) === 0 ? t("waiting.answered_same")
    : t("waiting.answered_after", { n: item.answered_days ?? 0 });

/** The Overview line's second part: "Travelly, Alex Doe · oldest 12 days". */
export function summaryLine(s: WaitingSummary): string {
  const names = s.people.join(", ") + (s.more > 0 ? ` +${s.more}` : "");
  return `${names} · ${t("waiting.next_oldest", { n: s.oldest_days })}`;
}
