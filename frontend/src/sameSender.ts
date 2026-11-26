/* "Same sender, several accounts": what one of the page's four actions would
 * do in each account the sender writes to - the pure part, so the confirm can
 * list it and the run can do it, one ordinary per-account call per account
 * (`allAccounts.ts` runPerAccount).
 *
 * The single-account rules hold per account: a protected sender is never part
 * of a step (the server refuses it too: `skip_protected`), pinned mails stay
 * where they are, an unsubscribe that is already done is not sent again, an
 * address that is blocked already is not blocked twice. */

import type { SameSenderPart, SameSenderRow, UnsubVia } from "./types";

/** The four actions of the pane: "<verb> in N". */
export type SameAction = "unsubscribe" | "trash" | "archive" | "block";

export const SAME_ACTIONS: readonly SameAction[] = ["unsubscribe", "trash",
  "archive", "block"];

/** Why an action cannot run in an account (the line stays listed, unticked). */
export type Why = "protected" | "gone" | "pinned" | "done" | "no_link"
  | "blocked";

/** Does the action move mails (and therefore leave pinned ones alone)? */
export const moves = (a: SameAction): boolean => a === "trash"
  || a === "archive";

/** Why `action` cannot run in this account's part, or null when it can. */
export function whyNot(part: SameSenderPart, action: SameAction): Why | null {
  switch (action) {
    case "unsubscribe":
      return !part.unsub ? "no_link" : part.state === "done" ? "done" : null;
    case "trash":
    case "archive":
      return part.mails - part.pinned <= 0 ? "pinned" : null;
    case "block":
      return part.blocked ? "blocked" : null;
  }
}

/** The N of "Trash in N": the accounts the action can still reach. */
export const countIn = (row: SameSenderRow, action: SameAction): number =>
  row.accounts.filter((p) => whyNot(p, action) === null).length;

/** What one account's line of the confirm says and does. */
export interface Plan {
  account: string;
  /** The address that stands for the sender there. */
  addr: string;
  /** Mails the step acts on (a move leaves the pinned ones out). */
  mails: number;
  size: number;
  /** Pinned mails there (they stay). */
  pinned: number;
  via: UnsubVia;
  /** Set: the line is listed but cannot be ticked. */
  blocked?: Why;
}

/** The lines of `action` for a row. `fresh` is the row read AGAIN when the
 *  confirm opened: `undefined` = not read yet, `null` = read and the sender is
 *  no longer in several accounts. An account the first read listed that the
 *  fresh read does not (anymore) is shown blocked - "protected" when the
 *  server says it is protected now, else "gone" - and the numbers come from
 *  the fresh read, so a protection or a pin that appeared after the page was
 *  drawn is honoured. */
export function plan(row: SameSenderRow, action: SameAction,
    fresh: SameSenderRow | null | undefined): Plan[] {
  return row.accounts.map((old) => {
    const base = { account: old.account, addr: old.addr, via: old.via,
      mails: old.mails, size: old.size, pinned: old.pinned };
    let part: SameSenderPart | undefined = old;
    if (fresh !== undefined) {
      part = fresh?.accounts.find((p) => p.account === old.account);
      if (!part) {
        const held = fresh?.left_out.some((l) => l.account === old.account
          && l.why === "protected");
        return { ...base, blocked: held ? "protected" as const
          : "gone" as const };
      }
    }
    const why = whyNot(part, action);
    return { account: part.account, addr: part.addr, via: part.via,
      size: part.size, pinned: part.pinned,
      mails: moves(action) ? part.mails - part.pinned : part.mails,
      ...(why ? { blocked: why } : {}) };
  });
}
