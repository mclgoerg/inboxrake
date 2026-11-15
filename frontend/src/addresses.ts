import { getLang, t } from "./i18n";
import { fmtTs } from "./lib";
import type { AddressRow, AddressStranger } from "./types";

/** "1 year, 6 months" / "5 months" / "75 days" for a span of days (the quiet
 *  stretch before the first stranger). */
export function spanText(days: number): string {
  const months = Math.floor(days / 30.4);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0 && months === 0) return t("addr.span_days", { n: days });
  const parts: string[] = [];
  if (years > 0) parts.push(t("addr.span_years", { n: years }));
  if (rest > 0) parts.push(t("addr.span_months", { n: rest }));
  return parts.join(", ");
}

/** The strangers of a leaked address whose mails Strangers to Junk may move
 *  (a protected sender's stay). */
export const movableStrangers = (row: AddressRow): AddressStranger[] =>
  (row.leak?.strangers ?? []).filter((s) => !s.protected);

/** Mails Strangers to Junk will move. */
export const junkCount = (row: AddressRow): number =>
  movableStrangers(row).reduce((a, s) => a + s.mails, 0);

/** The strangers "Block the N" acts on: not protected, not blocked yet. */
export const blockable = (row: AddressRow): AddressStranger[] =>
  (row.leak?.strangers ?? []).filter((s) => !s.protected
    && s.to_block.length > 0);

/** The row's one-line description under its address (list and pane header). */
export function addressSub(row: AddressRow): string {
  const name = row.given_to?.name ?? "";
  switch (row.kind) {
    case "alias":
      return name ? t("addr.sub_alias", { name,
        date: fmtTs(row.given_to!.ts, getLang(), false) })
        : t("addr.kind.alias");
    case "catchall":
      return row.senders === 1 && name
        ? t("addr.sub_catchall_sole", { name })
        : t("addr.sub_catchall", { n: row.senders });
    case "tag":
      return t("addr.sub_tag", { tag: row.tag, n: row.senders });
    case "main":
      return t("addr.sub_main", { year: row.first_ts
        ? String(new Date(row.first_ts * 1000).getFullYear()) : "" });
    default:
      return t("addr.sub_other", { n: row.senders });
  }
}
