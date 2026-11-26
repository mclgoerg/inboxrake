/* The All accounts PAGE: one view across the signed-in user's mailboxes.
 *
 * It is a page, never a mode: opening it, or anything done on it, never
 * changes the selected account (only the explicit Open / Open in <account> /
 * Fix it, which switch like the account switcher does). Reading may span the
 * accounts; ACTING never does in one call. Whatever the page offers to do to
 * several accounts at once goes through `runPerAccount`: one step per ticked
 * account, each through the ordinary per-account call pinned to that account
 * (`?account=`, never the selected one), each with its own Undo and Activity
 * entry on the server. A step that fails does not stop the others. */

import { nowMs } from "./clock";
import { loadVisit, visitSince } from "./overview";

/** The page needs two mailboxes to mean anything. */
export const canOpenAllAccounts = (names: string[]): boolean =>
  names.length >= 2;

/* ---- "+N new": the visit each account remembers ---- */

/** Per account the epoch SECOND its "+N new" counts from: the remembered
 *  visit of the account's own Overview (same record, so both agree). An
 *  account with none is left out - the backend counts its last week. Only
 *  READ: looking at this page is not a visit of any account. */
export function visitMarks(names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const since = visitSince(loadVisit(name), nowMs());
    if (since !== null) out[name] = Math.floor(since / 1000);
  }
  return out;
}

/* ---- one step per account ---- */

/** What became of one account's step. `skipped`: it never ran - the account
 *  was removed or renamed while the confirm was open ("gone"), or the user
 *  switched account before its turn ("away"). */
export type StepStatus = "done" | "link" | "failed" | "skipped";

export interface StepOutcome {
  account: string;
  status: StepStatus;
  /** User-language text: what happened, or why it did not. */
  text: string;
  /** A page the user has to open to finish (status "link"). */
  link?: string;
}

/** Run `step` for each of `accounts`, one after the other. `exists` is asked
 *  right before a step (the account list may have changed while the confirm
 *  was open); `switched` is the `accountGuard()` taken when the flow began.
 *  An account that is gone, or every account left after a switch of the
 *  selected account, is reported as skipped - never acted on. A step that
 *  throws is a failed outcome with the error's text; the loop goes on. */
export async function runPerAccount(accounts: string[],
    step: (account: string) => Promise<StepOutcome>,
    guard: { exists: (account: string) => boolean; switched: () => boolean;
      gone: (account: string) => string; away: (account: string) => string;
      failed: (account: string, e: unknown) => string },
    progress?: (account: string, at: "start" | "end") => void,
): Promise<StepOutcome[]> {
  const out: StepOutcome[] = [];
  for (const account of accounts) {
    if (guard.switched()) {
      out.push({ account, status: "skipped", text: guard.away(account) });
      continue;
    }
    if (!guard.exists(account)) {
      out.push({ account, status: "skipped", text: guard.gone(account) });
      continue;
    }
    progress?.(account, "start");
    try {
      out.push(await step(account));
    } catch (e) {
      out.push({ account, status: "failed", text: guard.failed(account, e) });
    }
    progress?.(account, "end");
  }
  return out;
}
