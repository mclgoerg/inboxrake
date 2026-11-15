/* Subscriptions (Insights -> Subscriptions): money, dates and the .ics file.
 * Pure helpers over the server's `Subscription`, so the page, the Overview
 * line and the tests share one definition. Everything is local: the .ics is
 * built in the browser and handed over as a download - no request. */

import { getLang, t } from "./i18n";
import { nowDate } from "./clock";
import { fmtDate, fmtTs } from "./lib";
import { fmtNum, NBSP } from "./numfmt";
import type { Subscription, SubTotals } from "./types";

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

/** "€7.99" / "7,99 €" (CHF: "CHF 39.00" / "39,00 CHF"). `whole` drops the
 *  cents of a rounded figure ("€32"), as the KPI tiles show them. */
export function fmtMoney(amount: number, currency: string,
    opts: { whole?: boolean } = {}): string {
  const num = fmtNum(amount, opts.whole
    ? { digits: 0 } : { digits: 2 });
  const sym = SYMBOL[currency] ?? currency;
  if (getLang() === "de") return `${num}${NBSP}${sym}`;
  return SYMBOL[currency] ? `${sym}${num}` : `${sym}${NBSP}${num}`;
}

/** The English ordinal of a day of the month ("5th"); German writes "5.". */
export function ordinal(n: number): string {
  if (getLang() === "de") return `${n}.`;
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const locale = (): string => getLang() === "de" ? "de-DE" : "en-GB";

/** "Jan 2023" in the user's time zone. */
export const monthYear = (ts: number): string =>
  new Intl.DateTimeFormat(locale(), { month: "short", year: "numeric" })
    .format(new Date(ts * 1000));

/** "Mar" - with the year when it is not this one ("Mar 2025"). */
export function monthShort(ts: number, nowDate: Date): string {
  const d = new Date(ts * 1000);
  return d.getFullYear() === nowDate.getFullYear()
    ? new Intl.DateTimeFormat(locale(), { month: "short" }).format(d)
    : monthYear(ts);
}

/** "5 Dec" (with the year when it is not this one). */
export const dayMonth = (ts: number): string => fmtTs(ts, getLang(), false);

/** The next expected date ("5 Dec"): the server's date, shown as it is. */
export const nextDay = (s: Subscription): string =>
  fmtDate(s.next_date, nowDate(), { lang: getLang() });

/** "monthly, around the 5th" / "yearly, around 14 Jan". */
export const cadenceSentence = (s: Subscription): string =>
  s.cadence === "monthly"
    ? t("sub.cadence_monthly_day", { day: ordinal(s.day) })
    : t("sub.cadence_yearly_date", { date: nextDay(s) });

/** What the "next receipt" cell adds: a pill while a YEARLY renewal is near
 *  (a monthly one is always near, so it gets none). */
export type NextPill = { kind: "in"; n: number } | { kind: "today" }
  | { kind: "due" } | null;

export const RENEW_DAYS = 60;

export function nextPill(s: Subscription): NextPill {
  if (s.cadence !== "yearly" || s.next_days > RENEW_DAYS) return null;
  if (s.next_days < 0) return { kind: "due" };
  return s.next_days === 0 ? { kind: "today" } : { kind: "in", n: s.next_days };
}

export const pillText = (p: NonNullable<NextPill>): string =>
  p.kind === "in" ? t("sub.in_days", { n: p.n })
    : p.kind === "today" ? t("sub.today") : t("sub.due");

/** The amount line of a row ("€12.99"), or null when no price is known. */
export const amountText = (s: Subscription): string | null =>
  s.amount === null ? null : fmtMoney(s.amount, s.currency);

/** Services that look unused, as "A, B" (at most two, then "+N"). */
export function unusedNames(items: Subscription[], max = 2): string {
  const names = items.filter((s) => !s.hidden && !s.use.in_use)
    .map((s) => s.name);
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

/** The "about €32 a month" figure of a totals block, or null without one. */
export const monthlyText = (tot: SubTotals): string | null =>
  tot.monthly === null || !tot.currency ? null
    : fmtMoney(tot.monthly, tot.currency, { whole: true });

/** An inline link's touch area (40 px high on touch) without stretching its
 *  line: the padding is cancelled by an equal negative margin, so the line
 *  box keeps its own height. */
export const LINK_TAP = "coarse:py-3 coarse:-my-3";

/** The server leaves a device out of a push when it was looking at the app
 *  within this long before (webpush.PRESENCE_TTL, plus slack). */
export const PRESENCE_SLACK_S = 90;

/** Whether the page shows a fired reminder as a toast. Without Web Push on
 *  this device: always. With it, the server pushed the reminder to every
 *  device that was NOT looking at the app, so a toast would double it - but
 *  a device that WAS looking (it last saw the page visible at
 *  `lastVisibleAt`, epoch s, when the reminder fired at `firedAt`) got no
 *  push and relies on the toast, however late it comes back to the app. */
export const showReminderToast = (pushOn: boolean, firedAt: number,
    lastVisibleAt: number): boolean =>
  !pushOn || firedAt - lastVisibleAt <= PRESENCE_SLACK_S;

/* ----------------------------- the .ics file ----------------------------- */

/** "2026-12-05" -> "20261205". */
const compact = (iso: string): string => iso.replace(/-/g, "");
/** The day after an ISO date (UTC arithmetic: no time zone involved). */
const dayAfter = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** An iCalendar text value: backslash, semicolon, comma and line breaks. */
const esc = (s: string): string => s.replace(/\\/g, "\\\\")
  .replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Content lines are folded at 75 octets (RFC 5545 3.1); counting UTF-8
 *  bytes so a multi-byte name never splits inside a character. */
function fold(line: string): string[] {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ""; bytes = 0;
    }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.map((l, i) => (i ? " " : "") + l);
}

/** A VEVENT for the next expected receipt: an all-day event on that date,
 *  with an alarm three days before. Built locally; `now` stamps it. */
export function subscriptionIcs(s: Subscription, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const price = amountText(s);
  const summary = t("sub.ics_summary", { name: s.name });
  const note = [price ? t("sub.ics_amount", { amount: price }) : "",
    t("sub.ics_note")].filter(Boolean).join(" ");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Inboxrake//Subscriptions//EN",
    "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:inboxrake-sub-${s.key.replace(/[^A-Za-z0-9]+/g, "-")}-${
      compact(s.next_date)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(s.next_date)}`,
    `DTEND;VALUE=DATE:${compact(dayAfter(s.next_date))}`,
    `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(note)}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(summary)}`,
    "TRIGGER:-P3D", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"];
  return lines.flatMap(fold).join("\r\n") + "\r\n";
}

/** The download's file name: the service's name, nothing exotic. */
export const icsName = (s: Subscription): string =>
  `${s.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
    || "subscription"}.ics`;
