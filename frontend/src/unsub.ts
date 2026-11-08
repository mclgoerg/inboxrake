/* Unsubscribe from one sender's group: the call and the words around it,
 * shared by the detail panel's (Retry) Unsubscribe button and the activity
 * lists' Retry. Pure of UI: callers show `message` as a note or toast. */

import { api } from "./api";
import { t } from "./i18n";
import { isPooled } from "./smart";
import type { Group } from "./types";

/** The Sender group a failed unsubscribe's audit entry (label = sender
 *  address) can be retried on: it still exists, has an unsubscribe method,
 *  is a single sender and is not already done / waiting for the user on a
 *  link. Null = show the entry without Retry. */
export function retryableGroup(groups: Record<string, Group> | undefined,
    label: string): Group | null {
  const g = label ? groups?.[label] : undefined;
  if (!g || !g.unsub || isPooled(g)) return null;
  const s = g.unsubscribed?.status;
  return s === "done" || s === "link" ? null : g;
}

/** What to tell the user about an unsubscribe link: the demo's made-up host
 *  is explained instead of opened. */
export function openUnsubPage(link: string, demo: boolean): string {
  if (demo) return t("unsub.demo_hint");
  window.open(link, "_blank", "noopener");
  return t("Opened the sender's unsubscribe page - confirm it there.");
}

/** Run the unsubscribe for `group` exactly as the detail panel does. Never
 *  throws: `ok` false carries the error text in `message`. */
export async function unsubscribeGroup(grouping: Parameters<
    typeof api.unsubscribe>[0], group: Group, demo: boolean):
    Promise<{ ok: boolean; message: string }> {
  try {
    const r = await api.unsubscribe(grouping, group.key);
    return { ok: true, message: r.action === "link"
      ? openUnsubPage(r.detail, demo)
      : `${t("Unsubscribed")} (${r.method}).` };
  } catch (e: any) {
    return { ok: false,
      message: t("err.unsub", { msg: e.message ?? String(e) }) };
  }
}
