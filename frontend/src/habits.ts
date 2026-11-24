/* "You keep doing this": the habits the server mined from the account's
 * Activity (backend/habits.py), as the app shows them - one hook that keeps
 * them fresh, and the plain helpers the Rules section, the Overview, the
 * toast and the tests share. Local data; nothing is asked of the mail
 * server. */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { getLang, t } from "./i18n";
import { fmtTs } from "./lib";
import type { Habit, HabitsResp } from "./types";

/** Debounce of the refetch after the mailbox or the rules changed. */
const REFETCH_MS = 600;

/** The habits of `account`, fetched when it, `on` (signed in, scanned) or
 *  `sig` (anything that can change them: a finished action, the rule list,
 *  the setting) changes. `reload` fetches at once (after Make it a rule /
 *  Not this one). A failed fetch keeps what there was. */
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
  useEffect(() => { ask.current++; setData(null); }, [account]);
  useEffect(() => {
    if (!on) return;
    const h = setTimeout(() => { void reload(); }, REFETCH_MS);
    return () => clearTimeout(h);
  }, [account, on, sig, reload]);
  return { data, reload, dataRef };
}

/** Suggestions to show (none while the setting is off). */
export const habitList = (d: HabitsResp | null | undefined): Habit[] =>
  d?.enabled ? d.suggestions : [];

/** "12 Oct" - the day of a timestamp, short. */
export const habitDate = (ts: number): string => fmtTs(ts, getLang(), false);

/** The mails a step covered of this sender, as a range ("14 to 22 mails each
 *  time") or the one number. */
export function habitMails(h: Habit): string {
  return h.min_n === h.max_n
    ? t("habit.each_same", { n: h.max_n })
    : t("habit.each", { min: h.min_n, max: h.max_n });
}

/** The evidence line of a card: "Always unread · 14 to 22 mails each time". */
export const habitEvidence = (h: Habit): string =>
  [h.always_unread ? t("habit.always_unread") : "", habitMails(h)]
    .filter(Boolean).join(" · ");

/** "You trashed Deals Daily 5 times since 12 Oct". */
export const habitTitle = (h: Habit): string => t(`habit.did_${h.action}`, {
  sender: h.label, n: h.times, date: habitDate(h.since),
  folder: h.dest_name });

/** The name the made rule gets. */
export const habitRuleName = (h: Habit): string =>
  t(`habit.rule_${h.action}`, { sender: h.label, folder: h.dest_name })
    .slice(0, 80);

/** The habit a step just made appear: asks the server again (at most
 *  `waitMs`; slower = none) and returns the first suggestion `known` did not
 *  have. A toast uses it to offer Automate…. */
export async function newHabit(
    reload: () => Promise<HabitsResp | null>, known: Set<string>,
    waitMs = 400): Promise<Habit | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((r) => { timer = setTimeout(() => r(null), waitMs); });
  const got = await Promise.race([reload(), slow]);
  clearTimeout(timer);
  return habitList(got).find((h) => !known.has(h.id));
}
