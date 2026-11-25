/* The "All accounts" scope: the choice in the account switcher that shows
 * every mailbox of the signed-in user side by side (Overview) and - for
 * the lists that follow - across them.
 *
 * Reading may span accounts; ACTING never does. Whatever a view offers to do
 * to several accounts at once goes through `runPerAccount`: one step per
 * ticked account, each through the ordinary per-account call pinned to that
 * account (`inAccount`), each with its own Undo and Activity entry on the
 * server. A step that fails does not stop the others. The multi-account
 * confirm (components/AcrossAccountsConfirm.tsx) is the one place that asks
 * and runs it. */

import { nowMs } from "./clock";
import { loadVisit, saveVisit, visitSince } from "./overview";

/** The remembered scope, like the current account (`pmc_account`). The
 *  account itself stays stored too: it is what "All accounts" falls back to
 *  and what the per-account pages (Settings ...) keep working on. */
export const SCOPE_KEY = "pmc_scope";

export const loadAllScope = (): boolean => {
  try { return localStorage.getItem(SCOPE_KEY) === "all"; }
  catch { return false; }
};

export const saveAllScope = (on: boolean): void => {
  try {
    if (on) localStorage.setItem(SCOPE_KEY, "all");
    else localStorage.removeItem(SCOPE_KEY);
  } catch { /* private mode: the scope is not remembered */ }
};

/** All accounts needs two mailboxes to mean anything. */
export const canScopeAll = (names: string[]): boolean => names.length >= 2;

/* ---- "+N new": the visit each account remembers ---- */

/** Per account the epoch SECOND its "+N new" counts from: the remembered
 *  visit of the single Overview (same record, so both views agree). An
 *  account with none is left out - the backend counts its last week. */
export function visitMarks(names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const since = visitSince(loadVisit(name), nowMs());
    if (since !== null) out[name] = Math.floor(since / 1000);
  }
  return out;
}

/** Leaving the All Overview is a visit of every account in it. `marks` =
 *  what `visitMarks` said when it opened (the window the page showed). */
export function rememberVisit(names: string[],
    marks: Record<string, number>): void {
  const left = nowMs();
  for (const name of names) {
    saveVisit(name, { since: name in marks ? marks[name] * 1000 : null,
      left });
  }
}

/* ---- one step per account ---- */

/** What became of one account's step. `skipped`: it never ran - the account
 *  was removed or renamed while the confirm was open ("gone"), or the user
 *  switched view before its turn ("switched"). */
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
 *  An account that is gone, or every account left after a view switch, is
 *  reported as skipped - never acted on. A step that throws is a failed
 *  outcome with the error's text; the loop goes on. */
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
