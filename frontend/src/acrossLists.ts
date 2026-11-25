/* The lists across accounts (All accounts: Senders, All mail, Search) - the
 * pure part: what a selection action would do in each account, so the
 * multi-account confirm can list it and the run can do it, one ordinary
 * per-account call per account (`allAccounts.ts` runPerAccount).
 *
 * The rules are the single-account ones, applied per account: protected
 * senders are left out of a Trash, pinned mails stay (except for Mark read),
 * and a row's part in an account that is not ticked is never touched. */

import { mailKey } from "./lib";
import type { AcrossGroup, Mail } from "./types";

/** The actions a selection takes across accounts. Everything else (move to a
 *  folder, protect, block, limits ...) is per account: open the account. */
export type AcrossAction = "trash" | "archive" | "mark_read";

/** Pinned mails are left alone by every move; Mark read changes no place. */
export const skipsPinned = (action: AcrossAction): boolean =>
  action !== "mark_read";

/** What a sender selection does in ONE account. */
export interface SenderStep {
  account: string;
  /** Sender addresses (Sender group keys there) the step acts on. */
  keys: string[];
  /** Their names, for the confirm's second line. */
  labels: string[];
  /** Mails the step would move or mark (pinned excluded where they stay). */
  mails: number;
  /** Pinned mails that stay. */
  pinned: number;
  /** Selected senders there that are protected (a Trash leaves them out). */
  protectedSkipped: number;
}

/** The step of each account a selection of Sender rows reaches, in `order`
 *  (the accounts' own order). An account none of the rows has a part in has
 *  no step. A protected sender is left out of a Trash. */
export function planSenders(rows: AcrossGroup[], action: AcrossAction,
    order: string[]): SenderStep[] {
  const steps = new Map<string, SenderStep>();
  for (const row of rows) {
    for (const part of row.accounts) {
      const step = steps.get(part.account) ?? { account: part.account,
        keys: [], labels: [], mails: 0, pinned: 0, protectedSkipped: 0 };
      steps.set(part.account, step);
      if (action === "trash" && part.protected) {
        step.protectedSkipped++;
        continue;
      }
      const pinned = skipsPinned(action) ? part.pinned : 0;
      step.keys.push(row.key);
      step.labels.push(row.label || row.key);
      step.mails += part.count - pinned;
      step.pinned += pinned;
    }
  }
  return order.filter((a) => steps.has(a)).map((a) => steps.get(a)!);
}

/** What a mail selection does in ONE account. */
export interface MailStep {
  account: string;
  /** The mails the step acts on. */
  acting: Mail[];
  /** Pinned mails that stay. */
  pinned: number;
}

/** The step of each account the selected mails sit in, in `order`. */
export function planMails(mails: Mail[], action: AcrossAction,
    order: string[]): MailStep[] {
  const steps = new Map<string, MailStep>();
  for (const m of mails) {
    if (!m.account) continue;       // (a mail of the single account: not ours)
    const step = steps.get(m.account)
      ?? { account: m.account, acting: [], pinned: 0 };
    steps.set(m.account, step);
    if (skipsPinned(action) && m.pinned) step.pinned++;
    else step.acting.push(m);
  }
  return order.filter((a) => steps.has(a)).map((a) => steps.get(a)!);
}

/** [folder, uid] pairs of mails, the shape the per-account move takes. */
export const itemsOf = (mails: Mail[]): [string, number][] =>
  mails.map((m) => [m.folder, m.uid]);

/** The selected mails that are still in `mails` (a list that reloaded or
 *  lost mails keeps only what is still on screen ticked). */
export const stillThere = (sel: Set<string>, mails: Mail[]): Set<string> => {
  const present = new Set(mails.map(mailKey));
  return new Set([...sel].filter((k) => present.has(k)));
};
