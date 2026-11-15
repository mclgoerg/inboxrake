/* Keep-safe: before a big move to Trash the confirm asks the backend which of
 * the mails look worth keeping (invoices, bookings, contracts, job
 * applications ...), shows them as a green box and, for the groups left
 * ticked, PINS those mails first - the existing protected-mail mechanism that
 * the move, every bulk action and every rule already skips. Every entry point
 * that ends in "Move to Trash" goes through `confirmTrash`. */

import { api } from "./api";
import { KeepSafeConfirm, type KeepSafeAnswer }
  from "./components/KeepSafeConfirm";
import { confirmDialog, customDialog } from "./components/ui";
import type { KeepSafeCheck, KeepSafeScope } from "./types";

/** A move of MORE than this many mails is checked; smaller ones are not worth
 *  the extra question. */
export const KEEP_SAFE_MIN = 20;

export interface TrashAsk {
  title: string;
  bullets: string[];
  tone?: "danger" | "primary";
  /** The confirm button's text for this many mails moving. */
  label: (moving: number) => string;
  /** Mails the move would act on. */
  n: number;
  /** What the move acts on, for the check; null = not checked (a single
   *  explicit mail, a forced move). */
  scope: KeepSafeScope | null;
  /** The account the move belongs to, so the check and the pin go to it. */
  account?: string;
}

export type TrashAnswer =
  | { ok: false }
  /** `pinned`: the mails protected for this move, which a selection-based
   *  move must leave out of its list (a group move skips them itself). */
  | { ok: true; pinned: [string, number][] };

/** The destructive confirm of a move to Trash. Over KEEP_SAFE_MIN mails it
 *  carries the keep-safe box; if the check fails or finds nothing it is the
 *  plain confirm. A failed pin THROWS: the mails the user ticked must never
 *  be moved on the strength of a protection that did not happen. */
export async function confirmTrash(ask: TrashAsk): Promise<TrashAnswer> {
  const { title, bullets, tone = "danger", label, n, scope, account } = ask;
  const plain = async (): Promise<TrashAnswer> => await confirmDialog({
    title, bullets, tone, confirmLabel: label(n) })
    ? { ok: true, pinned: [] } : { ok: false };
  if (!scope || n <= KEEP_SAFE_MIN) return plain();
  let found: KeepSafeCheck | null = null;
  try { found = await api.keepSafeCheck(scope, account); } catch { found = null; }
  if (!found?.classes?.length) return plain();
  const answer = await customDialog<KeepSafeAnswer>((done) => (
    <KeepSafeConfirm title={title} bullets={bullets} tone={tone}
      label={label} n={n} found={found!} onResult={done} />));
  if (!answer) return { ok: false };
  if (!answer.ticked.length) return { ok: true, pinned: [] };
  const r = await api.keepSafePin(scope, answer.ticked, account);
  return { ok: true, pinned: r.items };
}
