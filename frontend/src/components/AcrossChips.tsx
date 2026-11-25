/* The account marks of the lists across accounts (All accounts): a row that
 * exists in several accounts carries one chip per account (avatar + its
 * count, as the Overview's "Same sender, several accounts"), a mail carries
 * the badge of the account it sits in. The name is always in the text for
 * screen readers - the avatar's colour is never the only signal. */

import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import { Avatar } from "./ui";

/** One chip per account: its avatar and the count there. */
export function PartChips({ parts, className = "" }: {
  parts: { account: string; count: number }[]; className?: string;
}) {
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {parts.map((p) => (
        <span key={p.account} className="inline-flex items-center gap-1
          rounded-full bg-chip py-0.5 pl-0.5 pr-2 type-caption tabular-nums
          text-muted">
          <Avatar name={p.account} />
          <span className="sr-only">{t("all.chip",
            { account: p.account, n: p.count })}</span>
          <span aria-hidden>{fmtNum(p.count)}</span>
        </span>
      ))}
    </span>
  );
}

/** "Which account is this mail in": avatar and name, on the meta line. The
 *  name truncates (the line also carries folder, sender and size, and the AI
 *  pill sits beside it); the full name is its tooltip and stays in the text. */
export function AccountBadge({ account }: { account: string }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 align-middle">
      <Avatar name={account} />
      <span className="min-w-0 truncate" title={account}>{account}</span>
    </span>
  );
}
