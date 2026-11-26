/* What kind of mail a sender sends ("What they send" in the sender pane).
 *
 * The kind of every mail comes from the server (`Mail.kind`, read from the
 * subject by backend/mailkinds.py and stored in the scan index); here the
 * mails of one sender are only counted per kind. A sender with two or more
 * kinds gets the box; one that has none, or only one, does not. */

import { t } from "./i18n";
import type { Mail } from "./types";

/** The kinds, in the order the box lists equal counts (and the order of the
 *  server's `mailkinds.KINDS`). */
export const KIND_IDS = ["ads", "orders", "shipping", "invoices",
  "appointments", "jobs", "support", "accounts"] as const;
export type KindId = typeof KIND_IDS[number];

export const isKind = (k: unknown): k is KindId =>
  typeof k === "string" && (KIND_IDS as readonly string[]).includes(k);

/** "Ads and offers" - the row title and the chip. */
export const kindLabel = (k: KindId) => t(`kind.${k}`);
/** "ads" - inside a sentence ("Always trash their ads…", the rule's name). */
export const kindShort = (k: KindId) => t(`kind.short_${k}`);
/** "only ads and offers" - the rule's third retention choice. */
export const kindOnly = (k: string) =>
  t("rule.ret_kind", { kind: isKind(k) ? t(`kind.lc_${k}`) : k });

export interface KindRow {
  id: KindId;
  mails: Mail[];
  n: number;
  /** Bytes. */
  size: number;
  /** Share of its mails that were opened, 0-100. */
  opened: number;
  /** Date ("YYYY-MM-DD ...") of its newest mail. */
  last: string;
}

/** One row per kind present among `mails`, the biggest first (equal counts
 *  keep KIND_IDS order). Mails of no kind belong to no row. */
export function kindRows(mails: Mail[]): KindRow[] {
  const by = new Map<KindId, Mail[]>();
  for (const m of mails) {
    if (!isKind(m.kind)) continue;
    const list = by.get(m.kind);
    if (list) list.push(m); else by.set(m.kind, [m]);
  }
  return KIND_IDS.filter((id) => by.has(id)).map((id) => {
    const list = by.get(id)!;
    const newest = list.reduce((a, b) => (b.ts > a.ts ? b : a));
    return { id, mails: list, n: list.length,
      size: list.reduce((sum, m) => sum + m.size, 0),
      opened: Math.round(100 * list.filter((m) => m.seen).length
        / list.length),
      last: newest.date };
  }).sort((a, b) => b.n - a.n);
}

/** The box needs a sender that sends two kinds or more. */
export const hasKinds = (rows: KindRow[]) => rows.length >= 2;
