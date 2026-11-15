/* Pure helpers of the Time machine (Activity): where the restore point sits,
 * how its moment is worded, how a session and a step are described. */

import { getLang, t } from "./i18n";
import type { Group, TmPreview, TmSession, TmStep } from "./types";

/** Steps less than this apart form a session (backend/timemachine.py). */
export const SESSION_GAP_MIN = 30;
/** How far back the steps go (backend mailops.UNDO_KEEP_DAYS). */
export const KEEP_DAYS = 30;

const locale = (): string => getLang() === "de" ? "de-DE" : "en-GB";

/** `14:31`, 24 h in both languages. */
export const timeOf = (ts: number): string =>
  new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit",
    hourCycle: "h23" }).format(new Date(ts * 1000));

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

/** "6 Nov" / "6. Nov." */
export const shortDay = (ts: number): string =>
  new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" })
    .format(new Date(ts * 1000));

/** Which day a moment is on, relative to `now`: today, yesterday or a date. */
export function dayKind(ts: number, now: Date): "today" | "yesterday" | "date" {
  const d = new Date(ts * 1000);
  if (sameDay(d, now)) return "today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return sameDay(d, y) ? "yesterday" : "date";
}

/** "Today" / "Yesterday" / "6 Nov": the label of a session's day. */
export const dayLabel = (ts: number, now: Date): string => {
  const k = dayKind(ts, now);
  return k === "date" ? shortDay(ts) : t(`tm.${k}`);
};

/** A moment as the restore card words it: "today, 14:10" / "yesterday,
 *  09:10" / "6 Nov, 11:20". */
export const whenText = (ts: number, now: Date): string => {
  const k = dayKind(ts, now);
  return t(`tm.when_${k}`, { time: timeOf(ts), date: shortDay(ts) });
};

/** The same inside a sentence: "at 14:10" / "yesterday at 09:10" / "on 6 Nov
 *  at 11:20". */
export const atText = (ts: number, now: Date): string => {
  const k = dayKind(ts, now);
  return t(`tm.at_${k}`, { time: timeOf(ts), date: shortDay(ts) });
};

/** The session's title: "Today, 14:02 - 14:31" (one time when it is one). */
export const sessionTitle = (s: TmSession, now: Date): string =>
  t("tm.session_range", { day: dayLabel(s.start, now),
    from: timeOf(s.start), to: timeOf(s.end) });

/** The index range `[from, to)` of a session's steps in the newest-first
 *  step list (sessions are contiguous in time). */
export function sessionSlice(steps: TmStep[], s: TmSession): [number, number] {
  let from = -1;
  let to = -1;
  steps.forEach((st, i) => {
    if (st.ts >= s.start && st.ts <= s.end) {
      if (from < 0) from = i;
      to = i + 1;
    }
  });
  return from < 0 ? [0, 0] : [from, to];
}

/** Where the line starts: just below the newest step that can come back, so
 *  the first thing a restore does is the last thing done. */
export function defaultBoundary(steps: TmStep[], from: number,
    to: number): number {
  for (let i = from; i < to; i++)
    if (steps[i].status === "back") return i + 1;
  return from;
}

/** The moment a line at `boundary` (steps above it, `steps[0..boundary)`, are
 *  undone) stands for: the middle between the step above and the step below
 *  (the backend's formula, so the label never jumps when the preview lands). */
export function pointMoment(steps: TmStep[], boundary: number,
    nowSec: number): number {
  const above = steps[boundary - 1];
  const below = steps[boundary];
  if (!above) return nowSec;
  return below ? Math.floor((below.ts + above.ts) / 2) : above.ts - 60;
}

/** The id the backend takes for a line at `boundary`: the newest step that
 *  stays ("" = before every step). */
export const pointId = (steps: TmStep[], boundary: number): string =>
  steps[boundary]?.id ?? "";

/** Sender names of a step, as its second line lists them: the first two
 *  and "+N". */
export function senderLine(s: TmStep, groups?: Record<string, Group>): string {
  const list = s.senders ?? [];
  if (!list.length) return "";
  const name = (addr: string) => groups?.[addr]?.label || addr || "?";
  const total = s.senders_total ?? list.length;
  const shown = list.slice(0, 2).map((x) => name(x.addr)).join(", ");
  return total > 2 ? `${shown} +${total - 2}` : shown;
}

/** "790 mails back to Inbox, 40 to Newsletters": where a restore puts the
 *  mails, the first three folders and "N more". */
export function whereText(folders: TmPreview["folders"],
    folderName: (raw: string, name: string) => string): string {
  const parts = folders.slice(0, 3).map((f, i) => i === 0
    ? t("tm.where_back", { n: f.mails, folder: folderName(f.folder, f.name) })
    : t("tm.where_to", { n: f.mails, folder: folderName(f.folder, f.name) }));
  if (folders.length > 3) parts.push(t("tm.where_more", { n: folders.length - 3 }));
  return parts.join(", ");
}
