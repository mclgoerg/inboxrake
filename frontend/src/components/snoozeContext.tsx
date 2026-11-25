import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { slotSentence, zoneName } from "../snooze";
import type { BatchSlot, Grouping, SnoozeResult, SnoozeSummary } from "../types";
import { useOptionalToast } from "./ui";

/* What every Not now control needs from the app around it: what waits in the
 * Snoozed folder (the state's `snoozed`: which senders deliver in batches) and
 * a way to reload the state after a change. The actions below call the API and
 * word the outcome; the "N mails snoozed" toast with its Undo comes from the
 * state change itself (App), like any other move. */

export interface SnoozeHost {
  summary?: SnoozeSummary;
  /** Reload the state (a move job was queued, a batch changed). */
  refresh: () => void;
}

const SnoozeContext = createContext<SnoozeHost>({ refresh: () => {} });
export const SnoozeProvider = SnoozeContext.Provider;

const msgOf = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** The Not now actions of the app around the caller (its provider). */
export const useSnooze = () => useSnoozeActions(useContext(SnoozeContext));

/** The Not now actions of the current account. Each resolves true when
 *  something was queued / changed. (App itself, above the provider, passes its
 *  own `host`.) */
export function useSnoozeActions(host: SnoozeHost) {
  const toast = useOptionalToast();
  return useMemo(() => {
    const fail = (e: unknown) =>
      toast?.show(t("err.generic", { msg: msgOf(e) }), { variant: "error" });
    /** Word what a snooze request left alone; true when it moved anything. */
    const settle = (r: SnoozeResult): boolean => {
      const left = r.skipped_pinned + r.skipped_protected + r.skipped_no_id
        + (r.skipped_duplicate ?? 0);
      if (r.queued === 0) toast?.show(t("snooze.nothing"));
      else if (left > 0) toast?.show(t("snooze.skipped", { n: left }));
      host.refresh();
      return r.queued > 0;
    };
    return {
      summary: host.summary,
      /** The unread mails of whole groups wait until `until`. */
      async groups(grouping: Grouping, keys: string[], until: number,
          unreadOnly = true): Promise<boolean> {
        try {
          return settle(await api.snooze({ grouping, keys }, until, unreadOnly));
        } catch (e) { fail(e); return false; }
      },
      /** Exact mails wait until `until`. */
      async mails(items: [string, number][], until: number): Promise<boolean> {
        try {
          return settle(await api.snooze({ items }, until));
        } catch (e) { fail(e); return false; }
      },
      /** Set / change / stop the batch of one sender. */
      async batch(key: string, label: string, slot: BatchSlot | "off"):
          Promise<boolean> {
        try {
          const r = await api.snoozeBatch(key, slot, zoneName(), label);
          if (slot === "off") {
            toast?.show(t("snooze.batch_stopped", { name: label })
              + (r.returned ? ` ${t("snooze.batch_stopped_back",
                { n: r.returned })}` : ""), { variant: "success" });
          } else {
            toast?.show(t("snooze.batch_started", { name: label,
              slot: slotSentence(slot) }), { variant: "success" });
          }
          host.refresh();
          return true;
        } catch (e) { fail(e); return false; }
      },
    };
  }, [host, toast]);
}
