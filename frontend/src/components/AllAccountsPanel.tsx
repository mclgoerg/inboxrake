import { Boxes, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useCoarsePointer } from "../gestures";
import { t } from "../i18n";
import { fmtAgo, fmtSizeGb } from "../lib";
import { fmtNum } from "../numfmt";
import { useSplitPane } from "../splitPane";
import { useAllAccounts } from "../useAllAccounts";
import type { Follow, ScanAllRun } from "../useAcrossRuns";
import type { AllAccountCard, AllAccountsResp, Config, SameSenderRow }
  from "../types";
import type { SameAction } from "../sameSender";
import { SameSenderConfirm } from "./SameSenderConfirm";
import { SameSenderPane } from "./SameSenderPane";
import { statusOf } from "./SettingsPage";
import { Avatar, Button, EmptyState, hueFillAt, Loading, Modal, PanelHeader,
  useIsPage, useMediaQuery } from "./ui";

/** Rows of "Same sender, several accounts" shown before "All N". */
export const SAME_SHOWN = 4;

/** The card line: "+63 new · scanned 1 min ago", a failed scan in the warm
 *  colour ("+21 new · scan failed 2 h ago"). */
function ScanLine({ a }: { a: AllAccountCard }) {
  if (a.status === "scanning") return <>{t("account.scan_running")}</>;
  const fresh = a.new > 0 ? t(a.new_basis === "visit" ? "allp.new"
    : "allp.new_week", { n: a.new }) : "";
  const ago = fmtAgo(a.failed ? a.failed_ts : a.scanned_ts);
  const scan = a.failed
    ? <span className="font-medium text-review-fg">
      {ago ? t("allp.failed_ago", { ago }) : t("allp.failed")}</span>
    : a.scanned_ts ? <>{t("scan.age", { ago })}</>
      : <>{t("account.never_scanned")}</>;
  return (
    <>{fresh && <>{fresh}<span aria-hidden>{" · "}</span></>}{scan}</>
  );
}

/** One account of the space bar, in account order. */
const share = (size: number, total: number): number =>
  total > 0 ? (100 * size) / total : 0;

function SpaceBar({ accounts, total }: {
  accounts: AllAccountCard[]; total: number;
}) {
  const parts = accounts.map((a) => `${a.name} ${fmtSizeGb(a.size)}`)
    .join(", ");
  return (
    <div role="img" aria-label={t("allp.space_bar", { parts })}
      className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
      {accounts.map((a, i) => (
        <i key={a.name} className={`block ${hueFillAt(i)}`}
          // the width IS the data: this account's share of the bytes
          style={{ width: `${share(a.size, total)}%` }} />
      ))}
    </div>
  );
}

/** The accounts of one same-sender row: each one's avatar and mail count (the
 *  name is read by screen readers). */
function Chips({ row }: { row: SameSenderRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {row.accounts.map((a) => (
        <span key={a.account} className="inline-flex items-center gap-1.5
          rounded-full bg-chip py-0.5 pl-0.5 pr-2.5 type-meta tabular-nums">
          <Avatar name={a.account} />
          <span className="sr-only">{t("allp.chip",
            { account: a.account, n: a.mails })}</span>
          <span aria-hidden>{fmtNum(a.mails)}</span>
        </span>
      ))}
    </span>
  );
}

/** The page "All accounts": every mailbox side by side and the senders that
 *  write to more than one of them. A PAGE, never a mode - the account that is
 *  selected stays selected through everything here. Only `Open`, `Open in
 *  <account>` and `Fix it` leave it (they switch / open settings like the
 *  account switcher does); the actions run one step per account, pinned to
 *  that account. */
export function AllAccountsPanel({ cfg, names, current, scanRun, demo,
  onScanAll, onClose, onOpen, onFix, onOpenSender, onFollow, onAdd, exists }: {
  cfg: Config;
  /** The accounts of this workspace, in order. */
  names: string[];
  /** The selected account ("· current"): shown, never changed here. */
  current: string;
  /** Scan all is running (it lives in the app, not in this page). */
  scanRun: ScanAllRun | null;
  demo: boolean;
  onScanAll: () => void;
  onClose: () => void;
  /** Open (switch to) an account, like the switcher does. */
  onOpen: (account: string) => void;
  /** Fix it: that account's settings (no switch). */
  onFix: (account: string) => void;
  /** Open in <account>: switch and open the sender there. */
  onOpenSender: (account: string, addr: string) => void;
  /** A Trash / Archive was queued: the app follows the jobs. */
  onFollow: (follow: Follow) => void;
  /** Add account (the page needs two). */
  onAdd: () => void;
  exists: (account: string) => boolean;
}) {
  const { data, failed, reload } = useAllAccounts(names);
  const [sel, setSel] = useState<string | null>(null);
  const [paneOff, setPaneOff] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // the row is kept as it was when the confirm opened: the page's numbers
  // change under a running step, the confirm must not
  const [ask, setAsk] = useState<{ row: SameSenderRow; action: SameAction }
    | null>(null);
  const split = useSplitPane();
  const phone = useMediaQuery("(max-width: 767px)");
  const coarse = useCoarsePointer();
  const onPage = useIsPage();
  const card = onPage ? "bg-panel" : "bg-panel2";
  const hover = onPage ? "hover:bg-panel2" : "hover:bg-chip";

  const rows = data?.same_sender ?? [];
  const shown = expanded ? rows : rows.slice(0, SAME_SHOWN);
  const cur = rows.find((r) => r.key === sel)
    ?? (split && !paneOff ? rows[0] : undefined);
  const scanning = !!scanRun;
  const busy = !!data?.accounts.some((a) => a.busy || a.status === "scanning");

  const pick = (r: SameSenderRow) => {
    setSel(r.key);
    setPaneOff(false);
    if (!split) setSheet(true);
  };
  const pane = (r: SameSenderRow) => (
    <SameSenderPane row={r} busy={busy || scanning}
      onClose={split ? () => { setPaneOff(true); setSel(null); } : undefined}
      onAction={(action) => { setSheet(false); setAsk({ row: r, action }); }}
      onOpenIn={(account, addr) => { setSheet(false); onOpenSender(account, addr); }} />
  );

  const fixable = (a: AllAccountCard): boolean =>
    a.failed || statusOf(cfg.accounts[a.name] ?? {} as never) !== "ok";

  const cards = (d: AllAccountsResp) => phone ? (
    <ul className={`overflow-hidden rounded-card ${card}`}>
      {d.accounts.map((a) => (
        <li key={a.name} className="border-t border-line first:border-0">
          <button type="button" onClick={() => onOpen(a.name)}
            className={`flex min-h-14 w-full items-center gap-3 px-3 py-2
              text-left ${hover}`}>
            <Avatar name={a.name} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate type-body-mobile font-medium">
                {a.name}</span>
              <span className="block type-meta text-muted">
                <ScanLine a={a} /></span>
            </span>
            <b className="w-20 shrink-0 text-right type-body tabular-nums">
              {fmtSizeGb(a.size)}</b>
            <ChevronRight size={16} aria-hidden
              className="shrink-0 text-faint" />
          </button>
          {fixable(a) && (
            <div className="px-3 pb-2 pl-14">
              <Button variant="tinted" size="sm" className="coarse:min-h-11"
                onClick={() => onFix(a.name)}>{t("allp.fix")}</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
      {d.accounts.map((a) => (
        <div key={a.name} data-testid="account-card"
          className={`flex min-w-0 flex-col gap-1.5 rounded-card p-3.5 ${card}`}>
          <div className="flex items-center gap-2">
            <Avatar name={a.name} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate type-body font-semibold">
                {a.name}
                {a.name === current && (
                  <span className="font-normal text-muted">
                    {" · "}{t("allp.current")}</span>
                )}
              </div>
              <div className="truncate type-meta text-muted">{a.user}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <b className="type-title2 tabular-nums">{fmtSizeGb(a.size)}</b>
            <span className="type-meta text-muted">
              {t("n.mails", { n: a.mails })}</span>
          </div>
          <div className="type-meta text-muted"><ScanLine a={a} /></div>
          {fixable(a) && !a.failed && (
            <div className="type-meta font-medium text-review-fg">
              {t(statusOf(cfg.accounts[a.name] ?? {} as never) === "check"
                ? "menu.signin_failed" : "menu.signin_missing")}</div>
          )}
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {fixable(a) && (
              <Button variant="tinted" size="sm" onClick={() => onFix(a.name)}>
                {t("allp.fix")}</Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => onOpen(a.name)}
              aria-label={t("allp.open_account", { account: a.name })}>
              <span className="inline-flex items-center gap-0.5">
                {t("allp.open")}
                <ChevronRight size={14} aria-hidden />
              </span>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );

  const space = (d: AllAccountsResp) => (
    <section aria-label={t("allp.space_title", { size: fmtSizeGb(d.totals.size) })}
      className={`rounded-card p-4 ${card}`}>
      <div className="flex items-baseline">
        <h2 className="flex-1 type-body font-semibold">
          {t("allp.space_title", { size: fmtSizeGb(d.totals.size) })}</h2>
        <span className="type-meta text-muted">{t("allp.by_account")}</span>
      </div>
      <div className="my-2.5">
        <SpaceBar accounts={d.accounts} total={d.totals.size} />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {d.accounts.map((a, i) => (
          <li key={a.name} className="inline-flex items-center gap-1.5
            type-meta text-muted">
            <i aria-hidden className={`size-2.5 rounded-badge ${hueFillAt(i)}`} />
            {a.name} {fmtSizeGb(a.size)}
          </li>
        ))}
      </ul>
    </section>
  );

  const same = (
    <section aria-label={t("allp.same_title")}
      className={`overflow-hidden rounded-card ${card}`}>
      <div className="flex items-start gap-3 px-4 pb-2 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="type-body font-semibold">{t("allp.same_title")}</h2>
          <div className="type-meta text-muted">{t("allp.same_sub")}</div>
        </div>
        {rows.length > SAME_SHOWN && (
          <Button variant="plain" size="sm" aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}>
            {expanded ? t("allp.fewer") : t("allp.all_n", { n: rows.length })}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 type-body text-muted">{t("allp.same_none")}</p>
      ) : (
        <ul className="border-t border-line">
          {shown.map((r) => {
            const selected = split && cur?.key === r.key;
            return (
              <li key={r.key} data-testid="same-row"
                className="border-t border-line first:border-0">
                <button type="button" onClick={() => pick(r)}
                  aria-current={selected ? "true" : undefined}
                  aria-label={t("allp.same_row", { name: r.name,
                    n: r.accounts.length, mails: r.mails })}
                  className={`flex min-h-14 w-full items-center gap-3 px-4
                    py-2.5 text-left ${selected ? "bg-panel2 shadow-open-edge"
                    : hover}`}>
                  <Avatar name={r.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate type-body font-medium">
                      {r.name}</span>
                    <span className="block truncate type-meta text-muted
                      max-sm:hidden">
                      {t("allp.same_hint", { pct: r.opened,
                        n: r.accounts.length })}</span>
                  </span>
                  {phone ? (
                    <span className="flex shrink-0 gap-0.5">
                      {r.accounts.map((a) => (
                        <Avatar key={a.account} name={a.account} />
                      ))}
                    </span>
                  ) : <Chips row={r} />}
                  <span className="w-14 shrink-0 text-right">
                    <b className="block type-body tabular-nums">
                      {fmtNum(r.mails)}</b>
                    <span className="block type-caption text-muted">
                      {t("allp.mails_label", { n: r.mails })}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const content = () => {
    if (!data) {
      return failed ? (
        <div className="flex items-center gap-3 p-4 type-body text-muted">
          <span>{t("overview.load_failed")}</span>
          <Button variant="quiet" size="sm" onClick={() => void reload()}>
            {t("tab.retry")}</Button>
        </div>
      ) : <Loading />;
    }
    return (
      <div className={split && !!cur && !paneOff
        ? "grid min-h-full grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]"
        : ""}>
        <div className="min-w-0 space-y-3 p-4 sm:p-5">
          {cards(data)}
          {space(data)}
          {same}
        </div>
        {split && cur && !paneOff && (
          <aside aria-label={t("allp.pane_title")} data-testid="same-pane"
            className="min-w-0 border-l border-line">
            {/* the page header above is 5rem: the pane fills what is left, so
                its actions stay in view however long the list is */}
            <div className="sticky top-0 h-[calc(100dvh-5rem)] overflow-y-auto">
              {pane(cur)}
            </div>
          </aside>
        )}
      </div>
    );
  };

  const sub = data ? t("allp.sub", {
    boxes: t("allp.mailboxes", { n: data.accounts.length }),
    mails: t("n.mails", { n: data.totals.mails }),
    size: fmtSizeGb(data.totals.size) }) : undefined;

  return (
    <Modal onClose={onClose} size="lg" full>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Boxes size={18} /> {t("allp.menu")}
        </span>}
        sub={sub} onClose={onClose}
        actions={names.length >= 2 ? (
          <Button variant="secondary" disabled={scanning || busy}
            className={coarse ? "min-h-11" : ""} onClick={onScanAll}>
            <RefreshCw size={16} aria-hidden
              className={`mr-1.5 inline ${scanning ? "animate-spin" : ""}`} />
            {scanRun ? t("allp.scanning", { account: scanRun.account,
              done: scanRun.done + 1, total: scanRun.total })
              : t("allp.scan_all")}
          </Button>
        ) : undefined} />
      <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
        max-sm:pb-[env(safe-area-inset-bottom)]">
        {names.length < 2 ? (
          <EmptyState icon={<Boxes size={18} />} title={t("allp.need_two")}
            hint={t("allp.need_two_hint")}
            action={<Button variant="secondary" onClick={onAdd}
              disabled={demo}>{t("account.add")}</Button>} />
        ) : content()}
      </div>
      {sheet && !split && cur && (
        <Modal size="md" onClose={() => setSheet(false)} label={cur.name}>
          <PanelHeader title={t("allp.pane_title")}
            onClose={() => setSheet(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">{pane(cur)}</div>
        </Modal>
      )}
      {ask && (
        <SameSenderConfirm row={ask.row} action={ask.action} exists={exists}
          demo={demo} onFollow={onFollow} onChanged={() => void reload()}
          onClose={() => setAsk(null)} />
      )}
    </Modal>
  );
}
