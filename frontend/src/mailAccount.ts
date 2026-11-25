import { inAccount } from "./api";

/** The calls of a mail's own reader (its text, its conversation, its pin) go
 *  to the mail's account: in the lists across accounts a mail carries it. A
 *  mail of the single account the app shows has none and runs unchanged.
 *  Only the part of `fn` before its first await is pinned (see `inAccount`),
 *  so wrap every call on its own. */
export function forMail<T>(m: { account?: string }, fn: () => T): T {
  return m.account ? inAccount(m.account, fn) : fn();
}
