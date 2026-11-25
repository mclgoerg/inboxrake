import { BellOff, Copy, HardDrive } from "lucide-react";
import { useState, type ReactNode } from "react";
import { fmtAgo, fmtSizeGb as fmtSize } from "../lib";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import type { AllAccountCard, AllAccountsResp, SameSenderRow } from "../types";
import { unsubscribable } from "./UnsubscribeAcross";
import { CARD, CardHead } from "./OverviewCards";
import { Avatar, Button, Chip, hueFillAt, Spinner } from "./ui";

/* The Overview of ALL accounts: every mailbox side by side (size, mails,
 * what is new, when it was scanned), one bar for where the space is, and the
 * senders that write to more than one account with "Unsubscribe in N…".
 * Presentational: the numbers come from `useAllAccounts`, the actions
 * (open an account, the multi-account confirm, Scan all) from the app. */

/** Rows of "Same sender, several accounts" shown before "All N". */
export const SAME_SHOWN = 4;

/** "+312 new · scanned 4m ago", "scan failed" in the warm colour, ... */
function CardLine({ a }: { a: AllAccountCard }) {
  const ago = fmtAgo(a.scanned_ts);
  if (a.status === "scanning") {
    return <span>{t("account.scan_running")}</span>;
  }
  const fresh = a.new > 0 ? t(a.new_basis === "visit" ? "all.new"
    : "all.new_week", { n: a.new }) : "";
  const scan = a.failed
    ? <span className="font-medium text-review-fg">
      {ago ? t("all.failed_ago", { ago }) : t("all.failed")}</span>
    : ago ? <span>{t("scan.age", { ago })}</span>
      : <span>{t("account.never_scanned")}</span>;
  return (
    <span>{fresh && <>{fresh}<span aria-hidden>{" · "}</span></>}{scan}</span>
  );
}

/** One account of the space bar / legend, in account order. */
const share = (a: AllAccountCard, total: number): number =>
  total > 0 ? (100 * a.size) / total : 0;

function SpaceBar({ accounts, total, thick }: {
  accounts: AllAccountCard[]; total: number; thick: boolean;
}) {
  const parts = accounts.map((a) => `${a.name} ${fmtSize(a.size)}`).join(", ");
  return (
    <div role="img" aria-label={t("all.space_bar", { parts })}
      className={`flex gap-0.5 overflow-hidden rounded-full
        ${thick ? "h-3.5" : "h-2.5"}`}>
      {accounts.map((a, i) => (
        <i key={a.name} className={`block ${hueFillAt(i)}`}
          // the width IS the data: this account's share of the bytes
          style={{ width: `${share(a, total)}%` }} />
      ))}
    </div>
  );
}

/** The accounts' chips of one same-sender row: the account's avatar and its
 *  mail count (the name is read by screen readers). */
function AccountChipsOf({ row }: { row: SameSenderRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {row.accounts.map((a) => (
        <span key={a.account} className="inline-flex items-center gap-1.5
          rounded-full bg-chip py-0.5 pl-1 pr-2.5 type-meta tabular-nums">
          <Avatar name={a.account} />
          <span className="sr-only">{t("all.chip",
            { account: a.account, n: a.mails })}</span>
          <span aria-hidden>{fmtNum(a.mails)}</span>
        </span>
      ))}
    </span>
  );
}

const hintOf = (row: SameSenderRow): string =>
  t("all.same_hint", { pct: row.opened, n: row.accounts.length });

/** The button of a row: "Unsubscribe in 3…" - or the plain fact that it is
 *  done everywhere. */
function UnsubButton({ row, tone, onOpen }: {
  row: SameSenderRow; tone: "tinted" | "quiet";
  onOpen: (row: SameSenderRow) => void;
}) {
  const n = unsubscribable(row).length;
  if (!n) {
    return <span className="type-meta text-muted">
      {t("all.unsub_all_done")}</span>;
  }
  return (
    <Button variant={tone} size="sm" className="shrink-0"
      onClick={() => onOpen(row)}>
      <BellOff size={14} aria-hidden className="mr-1 inline align-text-bottom" />
      {t("all.unsub_in", { n })}
    </Button>
  );
}

function SameSenderCard({ rows, onUnsubscribe, expanded, onExpand }: {
  rows: SameSenderRow[]; onUnsubscribe: (row: SameSenderRow) => void;
  expanded: boolean; onExpand: (v: boolean) => void;
}) {
  const shown = expanded ? rows : rows.slice(0, SAME_SHOWN);
  return (
    <section aria-label={t("all.same_title")}
      className="overflow-hidden rounded-card bg-panel">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <CardHead title={t("all.same_title")} sub={t("all.same_sub")}
          right={rows.length > SAME_SHOWN && (
            <Button variant="plain" size="sm" aria-expanded={expanded}
              onClick={() => onExpand(!expanded)}>
              {expanded ? t("all.fewer") : t("all.all_n", { n: rows.length })}
            </Button>)} />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 type-body text-muted sm:px-6 sm:pb-6">
          {t("all.same_none")}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {shown.map((row, i) => (
            <li key={row.key} aria-label={t("all.same_row", { name: row.name,
              n: row.accounts.length, mails: row.mails })}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3
                sm:px-6 lg:flex-nowrap">
              <Avatar name={row.name} size="md" />
              <div className="min-w-0 flex-1 basis-40">
                <div className="truncate type-body font-medium">{row.name}</div>
                <div className="truncate type-meta text-muted">
                  {hintOf(row)}</div>
              </div>
              <AccountChipsOf row={row} />
              <div className="w-16 shrink-0 text-right">
                <div className="type-body font-semibold tabular-nums">
                  {fmtNum(row.mails)}</div>
                <div className="type-meta text-muted">
                  {t("all.mails_label", { n: row.mails })}
                </div>
              </div>
              <UnsubButton row={row} onOpen={onUnsubscribe}
                tone={i === 0 ? "tinted" : "quiet"} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The account chips of the phone Overview: All + each account. */
export function AccountChips({ names, selected, onSelect }: {
  names: string[];
  /** The selected account, or null for All accounts. */
  selected: string | null;
  onSelect: (account: string | null) => void;
}) {
  return (
    <div role="group" aria-label={t("all.chips_label")}
      className="-mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:-mx-5
        sm:px-5">
      <Chip on={selected === null} className="shrink-0"
        onClick={() => onSelect(null)}>{t("all.chip_all")}</Chip>
      {names.map((n) => (
        <Chip key={n} on={selected === n} className="shrink-0"
          onClick={() => onSelect(n)}>{n}</Chip>
      ))}
    </div>
  );
}

/** The mailbox cards, the space bar and the same-sender list (>= 768 px). */
function Wide({ data, onOpenAccount, onUnsubscribe, expanded, onExpand }: {
  data: AllAccountsResp; onOpenAccount: (a: string) => void;
  onUnsubscribe: (row: SameSenderRow) => void;
  expanded: boolean; onExpand: (v: boolean) => void;
}) {
  const { accounts, totals } = data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
        {accounts.map((a) => (
          <button key={a.name} type="button" onClick={() => onOpenAccount(a.name)}
            className="flex min-w-0 flex-col gap-2 rounded-card bg-panel p-4
              text-left enabled:hover:bg-panel2">
            <span className="flex items-center gap-2.5">
              <Avatar name={a.name} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate type-body font-medium">
                  {a.name}</span>
                <span className="block truncate type-meta text-muted">
                  {a.user}</span>
              </span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="type-title2 tabular-nums">{fmtSize(a.size)}</span>
              <span className="type-meta text-muted">
                {t("n.mails", { n: a.mails })}</span>
            </span>
            <span className="type-meta text-muted"><CardLine a={a} /></span>
          </button>
        ))}
      </div>
      <section className={CARD}
        aria-label={t("all.space_title", { size: fmtSize(totals.size) })}>
        <CardHead title={t("all.space_title", { size: fmtSize(totals.size) })}
          right={<span className="type-meta text-muted">
            {t("all.by_account")}</span>} />
        <SpaceBar accounts={accounts} total={totals.size} thick />
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {accounts.map((a, i) => (
            <li key={a.name} className="inline-flex items-center gap-1.5
              type-meta text-muted">
              <i aria-hidden className={`size-2.5 rounded-badge ${hueFillAt(i)}`} />
              {a.name} {fmtSize(a.size)}
            </li>
          ))}
        </ul>
      </section>
      <SameSenderCard rows={data.same_sender} onUnsubscribe={onUnsubscribe}
        expanded={expanded} onExpand={onExpand} />
    </div>
  );
}

/** The two phone widgets: the mailboxes (bar + one row each) and the top
 *  sender that writes to several of them. */
function Narrow({ data, onOpenAccount, onUnsubscribe, expanded, onExpand }: {
  data: AllAccountsResp; onOpenAccount: (a: string) => void;
  onUnsubscribe: (row: SameSenderRow) => void;
  expanded: boolean; onExpand: (v: boolean) => void;
}) {
  const { accounts, totals } = data;
  const top = data.same_sender[0];
  return (
    <div className="space-y-3">
      <section className="rounded-card bg-panel p-4"
        aria-label={t("all.mailboxes_card", { n: accounts.length })}>
        <div className="mb-3 flex items-center gap-2 type-meta font-medium
          text-muted">
          <HardDrive size={14} aria-hidden />
          <span className="flex-1">{t("all.mailboxes_card",
            { n: accounts.length })}</span>
          <span>{fmtSize(totals.size)}</span>
        </div>
        <SpaceBar accounts={accounts} total={totals.size} thick={false} />
        <ul className="mt-1">
          {accounts.map((a, i) => (
            <li key={a.name}>
              <button type="button" onClick={() => onOpenAccount(a.name)}
                className="flex min-h-11 w-full items-center gap-2.5 text-left">
                <Avatar name={a.name} size="md" />
                <i aria-hidden className={`size-2 shrink-0 rounded-full
                  ${hueFillAt(i)}`} />
                <span className="min-w-0 flex-1 truncate type-body-mobile">
                  {a.name}</span>
                <span className="shrink-0 whitespace-nowrap type-meta
                  text-muted">
                  {a.status === "scanning" ? t("account.scan_running")
                    : a.failed
                      ? <span className="font-medium text-review-fg">
                        {t("all.failed")}</span>
                      : a.new > 0 ? t(a.new_basis === "visit" ? "all.new"
                        : "all.new_week", { n: a.new }) : ""}
                </span>
                <span className="w-20 shrink-0 whitespace-nowrap text-right
                  type-body font-semibold tabular-nums">{fmtSize(a.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {top && !expanded ? (
        <section className="rounded-card bg-panel p-4"
          aria-label={t("all.same_title")}>
          <div className="mb-2 flex items-center gap-2 type-meta font-medium
            text-muted">
            <Copy size={14} aria-hidden />
            <span className="flex-1">{t("all.same_title")}</span>
            {data.same_sender.length > 1 && (
              <Button variant="plain" size="sm" aria-expanded={false}
                onClick={() => onExpand(true)}>
                {t("all.all_n", { n: data.same_sender.length })}</Button>
            )}
          </div>
          <div className="type-body-mobile font-semibold">
            {t("all.phone_same", { name: top.name, n: top.accounts.length })}
          </div>
          <div className="type-meta text-muted">
            {t("all.phone_same_line", { mails: top.mails, pct: top.opened })}
            {unsubscribable(top).length > 0 && (
              <Button variant="plain" size="sm"
                onClick={() => onUnsubscribe(top)}>
                {t("all.unsub_in", { n: unsubscribable(top).length })}
              </Button>
            )}
          </div>
        </section>
      ) : (
        <SameSenderCard rows={data.same_sender} onUnsubscribe={onUnsubscribe}
          expanded onExpand={onExpand} />
      )}
    </div>
  );
}

export function AllAccountsOverview({ data, failed, phone, chips, onRetry,
  onOpenAccount, onUnsubscribe }: {
  data: AllAccountsResp | null; failed: boolean; phone: boolean;
  /** The phone's account chips (All + each account), above the widgets. */
  chips?: ReactNode;
  onRetry: () => void;
  /** Switch to one account (a card, a chip, a row). */
  onOpenAccount: (account: string) => void;
  /** Open the multi-account confirm for a same-sender row. */
  onUnsubscribe: (row: SameSenderRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!data) {
    return (<>
      {chips}
      <div className="flex min-h-24 items-center gap-3 type-meta text-muted">
        {failed ? (<>
          <span>{t("overview.load_failed")}</span>
          <Button variant="quiet" size="sm" onClick={onRetry}>
            {t("tab.retry")}</Button>
        </>) : (<><Spinner /><span>{t("loading…")}</span></>)}
      </div>
    </>);
  }
  if (!data.accounts.some((a) => a.scanned_ts)) {
    return (<>
      {chips}
      <div className={`${CARD} type-body text-muted`}>{t("all.none_yet")}</div>
    </>);
  }
  const View = phone ? Narrow : Wide;
  return (<>
    {chips}
    <View data={data} onOpenAccount={onOpenAccount}
      onUnsubscribe={onUnsubscribe} expanded={expanded}
      onExpand={setExpanded} />
  </>);
}
