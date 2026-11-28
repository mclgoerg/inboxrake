/* Weekly check-in: the pure parts. Which places the stepper walks through is
 * the server's say (GET /api/checkin: only the places that have something);
 * what is kept here is the person's place - "closing keeps your place until
 * next week" - and the tally the closing summary reads. Nothing is sent
 * anywhere: the place lives in this browser, per account, like the Overview's
 * "since your last visit". */

import { t } from "./i18n";
import type { CheckinPlace } from "./types";

/** The places in walking order (the server lists them in this order, too). */
export const PLACES: readonly CheckinPlace[] = ["new", "still", "past",
  "waiting", "rules", "junk"];

/** What the person did in this check-in, by kind; only what they confirmed. */
export interface Did {
  /** mails moved to Trash from the sender steps / the Junk step */
  trashed: number;
  /** mails past their date moved to Trash */
  trashedPast: number;
  blocked: number;
  unsubscribed: number;
  /** mails rescued from Junk */
  notJunk: number;
  reminders: number;
  noAnswer: number;
  /** rule checkup findings dealt with (deleted / ignored) */
  rules: number;
}

export const NO_DID: Did = { trashed: 0, trashedPast: 0, blocked: 0,
  unsubscribed: 0, notJunk: 0, reminders: 0, noAnswer: 0, rules: 0 };

export interface Progress {
  /** the Monday (local date) of the week it belongs to */
  week: string;
  /** the place the person was on */
  at: CheckinPlace;
  /** places gone through with Next (a skipped one is not counted) */
  went: CheckinPlace[];
  did: Did;
  /** minutes spent so far (open time, summed over the sittings) */
  ms: number;
}

/** The Monday (local date, YYYY-MM-DD) of the week `ms` is in. */
export function weekId(ms: number): string {
  const d = new Date(ms);
  const monday = new Date(d.getFullYear(), d.getMonth(),
    d.getDate() - ((d.getDay() + 6) % 7));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${monday.getFullYear()}-${p2(monday.getMonth() + 1)}-${
    p2(monday.getDate())}`;
}

export const progressKey = (account: string): string =>
  `pmc_checkin:${account}`;

const isPlace = (v: unknown): v is CheckinPlace =>
  typeof v === "string" && (PLACES as readonly string[]).includes(v);

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/** The saved place of `account` for the week `now` is in; null when there is
 *  none, it belongs to an earlier week, or it is damaged. */
export function loadProgress(account: string, now: number): Progress | null {
  try {
    const raw = JSON.parse(localStorage.getItem(progressKey(account)) ?? "null");
    if (!raw || typeof raw !== "object" || raw.week !== weekId(now)
        || !isPlace(raw.at)) return null;
    const did: Did = { ...NO_DID };
    for (const k of Object.keys(NO_DID) as (keyof Did)[]) {
      did[k] = count(raw.did?.[k]);
    }
    return { week: raw.week, at: raw.at,
      went: Array.isArray(raw.went) ? raw.went.filter(isPlace) : [],
      did, ms: count(raw.ms) };
  } catch {
    return null;
  }
}

export function saveProgress(account: string, p: Progress): void {
  try { localStorage.setItem(progressKey(account), JSON.stringify(p)); }
  catch { /* private mode: the place is simply not kept */ }
}

export function clearProgress(account: string): void {
  try { localStorage.removeItem(progressKey(account)); }
  catch { /* nothing to forget */ }
}

/** Where the stepper starts among `steps` (the places that have something
 *  now): the saved place, or - when it has emptied meanwhile - the next place
 *  after it that has something; `steps.length` = nothing is left (Done). */
export function resumeIndex(steps: readonly CheckinPlace[],
    at: CheckinPlace | null): number {
  if (!at) return 0;
  const want = PLACES.indexOf(at);
  const i = steps.findIndex((s) => PLACES.indexOf(s) >= want);
  return i < 0 ? steps.length : i;
}

/** "about 2 minutes" */
export const minutesText = (n: number): string =>
  t("checkin.minutes", { n: Math.max(1, n) });

/** The Next steps line's second row: "6 things this week · about 2 minutes"
 *  (the window follows Overview's Last week card). */
export function lineText(things: number, minutes: number,
    window: "week" | "since"): string {
  return `${t(window === "since" ? "checkin.line_since" : "checkin.line_week",
    { n: things })} · ${minutesText(minutes)}`;
}

/** What the closing card says you did: the steps walked through and then
 *  only what was confirmed, each part only when it is more than none. */
export function summaryParts(did: Did, steps: number): string[] {
  const part = (key: string, n: number) => n > 0 ? [t(key, { n })] : [];
  return [
    ...part("checkin.sum_steps", steps),
    ...part("checkin.sum_trash_past", did.trashedPast),
    ...part("checkin.sum_trash", did.trashed),
    ...part("checkin.sum_blocked", did.blocked),
    ...part("checkin.sum_unsub", did.unsubscribed),
    ...part("checkin.sum_not_junk", did.notJunk),
    ...part("checkin.sum_reminders", did.reminders),
    ...part("checkin.sum_no_answer", did.noAnswer),
    ...part("checkin.sum_rules", did.rules),
  ];
}

/** Whether any of it left a step in Activity (with its own Undo). */
export const leftActivity = (did: Did): boolean =>
  did.trashed + did.trashedPast + did.blocked + did.unsubscribed
    + did.notJunk > 0;

/** An open sitting can not count for hours: a tab left open overnight. */
export const SITTING_CAP_MS = 30 * 60_000;

/** `did` plus a few more things done. */
export const addDid = (did: Did, more: Partial<Did>): Did => {
  const out = { ...did };
  for (const k of Object.keys(more) as (keyof Did)[]) {
    out[k] = did[k] + Math.max(0, Math.floor(more[k] ?? 0));
  }
  return out;
};
