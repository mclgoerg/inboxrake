/* "You keep doing this": the habits the server mined from the account's
 * Activity (backend/habits.py), as the app shows them - one hook that keeps
 * them fresh, and the plain helpers the Rules card, the Overview line, the
 * toast and the tests share. Local data; nothing is asked of the mail
 * server. */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { getLang, t } from "./i18n";
import { fmtTs } from "./lib";
import type { Habit, HabitsResp, Rule } from "./types";

/** Debounce of the refetch after the mailbox or the rules changed. */
const REFETCH_MS = 600;

/** The habits of `account`, fetched when it, `on` (signed in, scanned) or
 *  `sig` (anything that can change them: a finished action, the rule list,
 *  the setting) changes. `reload` fetches at once (after Make it a rule /
 *  Not this one). `drop` takes one suggestion off the shown list right away
 *  (its rule was made, or it was dismissed): every place that shows it - the
 *  Rules card, the Overview line - follows before the next answer arrives. A
 *  failed fetch keeps what there was. */
export function useHabits(account: string, on: boolean, sig: string) {
  const [data, setData] = useState<HabitsResp | null>(null);
  const ask = useRef(0);
  const dataRef = useRef<HabitsResp | null>(null);
  dataRef.current = data;
  const reload = useCallback((): Promise<HabitsResp | null> => {
    const me = ++ask.current;
    return Promise.resolve().then(() => api.habits())
      .then((d) => { if (me === ask.current) setData(d); return d; })
      .catch(() => null);
  }, []);
  const drop = useCallback((id: string) => setData((d) => d
    ? { ...d, suggestions: d.suggestions.filter((h) => h.id !== id) } : d),
  []);
  useEffect(() => { ask.current++; setData(null); }, [account]);
  useEffect(() => {
    if (!on) return;
    const h = setTimeout(() => { void reload(); }, REFETCH_MS);
    return () => clearTimeout(h);
  }, [account, on, sig, reload]);
  return { data, reload, drop, dataRef };
}

/** The manual steps a rule can repeat - the only ones a suggestion is made
 *  from (backend/habitlog.py HABIT_ACTIONS). */
export const HABIT_ACTIONS = ["trash", "archive", "move", "mark_read"];

/** Suggestions to show (none while the setting is off). */
export const habitList = (d: HabitsResp | null | undefined): Habit[] =>
  d?.enabled ? d.suggestions : [];

/** "12 Oct" - the day of a timestamp, short. */
export const habitDate = (ts: number): string => fmtTs(ts, getLang(), false);

/** How often: "every day", "every week", "every 4 days", "every 3-5 days"
 *  (the shortest and longest gap between the days it was done on). */
export function habitEvery(h: Habit): string {
  const { gap_min: lo, gap_max: hi } = h;
  if (lo >= 6 && hi <= 8) return t("habit.every_week");
  return lo === hi ? t("habit.every_same", { n: lo })
    : t("habit.every", { min: lo, max: hi });
}

/** The evidence line of a card: "every 3-5 days · 41 mails · all unread". */
export const habitEvidence = (h: Habit): string =>
  [habitEvery(h), t("n.mails", { n: h.mails }),
    h.always_unread ? t("habit.all_unread") : ""].filter(Boolean).join(" · ");

/** "You trashed Deals Daily 5 times since 12 Oct". */
export const habitTitle = (h: Habit): string => t(`habit.did_${h.action}`, {
  sender: h.label, n: h.times, date: habitDate(h.since),
  folder: h.dest_name });

/** The name the made rule gets. */
export const habitRuleName = (h: Habit): string =>
  t(`habit.rule_${h.action}`, { sender: h.label, folder: h.dest_name })
    .slice(0, 80);

/** The rule a suggestion stands for, shaped like a rule of the list so the
 *  card can read it with the very sentence the rule cards use. Report only,
 *  as every new rule starts; `dest` is the folder as the sentence names it. */
export const habitAsRule = (h: Habit): Rule => ({
  id: h.id, name: habitRuleName(h), scope: "mail",
  grouping: h.rule.grouping, query: h.rule.query, action: h.rule.action,
  dest: h.dest_name, schedule: h.rule.schedule, mode: "report",
  keep_latest: null, older_than_days: h.rule.older_than_days, only_kind: null,
  origin: "manual", report_runs: 0, created: 0, last_run: null });

/** The rule in plain words, for a phone: "A rule: Trash its mail older than
 *  3 days, daily. Would catch 12 now · Report only first." */
export function habitPlain(h: Habit): string {
  const older = h.older_than_days != null
    ? t("habit.plain_older", { n: h.older_than_days }) : "";
  const rule = t(`habit.plain_${h.action}`, { older, folder: h.dest_name,
    schedule: t(`sched.${h.schedule}`) });
  return `${rule} ${h.catch == null ? t("habit.plain_first")
    : t("habit.plain_catch", { n: h.catch })}`;
}

/** One step of "Why these?": "Moved 9 mails to Trash" and what the mails
 *  were like ("all unread", else "youngest 3 days old" when known). */
export function habitStepNote(h: Habit, s: Habit["steps"][number]): string {
  if (s.n > 0 && s.unread >= s.n) return t("habit.all_unread");
  return s.youngest_days != null && h.action !== "mark_read"
    ? t("habit.youngest", { n: s.youngest_days }) : "";
}

/** How recent a suggestion's newest step must be for a toast to credit it
 *  to the step that just finished (seconds). An older one that only came
 *  back (e.g. its rule was deleted) is not offered. */
const FRESH_STEP_S = 600;

/** The habit a step just made appear: asks the server again and returns the
 *  first suggestion `known` did not have whose newest step is recent. The
 *  toast of the step is already up; it gets Automate… when this answers (a
 *  toast that is gone by then simply stays as it was). */
export async function newHabit(
    reload: () => Promise<HabitsResp | null>, known: Set<string>,
    now = Date.now() / 1000): Promise<Habit | undefined> {
  return habitList(await reload()).find(
    (h) => !known.has(h.id) && h.last >= now - FRESH_STEP_S);
}
