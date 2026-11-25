/* The Senders page across accounts (All accounts selected): the Sender rows
 * of every account in one list. The same address in several accounts is ONE
 * row - counts summed, one chip per account - and opens a detail that lists
 * the accounts it is in.
 *
 * Reading spans the accounts; acting never does. The bulk bar and the detail
 * buttons open the multi-account confirm (`AcrossActions`): one ordinary
 * per-account step for each ticked account. There are no keyboard shortcuts
 * here (j / k / x / # belong to a single account's list), so nothing is ever
 * done to an account the user did not see named. What is per account -
 * Move to a folder, Block, labels, the grade's details, limits (Protect is
 * workspace-wide but is done from one account's detail, too) - is one click
 * away: "Open in <account>". */

import { Archive, BellOff, ListTree, MailOpen, Shield, Trash2, X }
  from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtSize } from "../api";
import { nowMs } from "../clock";
import { categoryName } from "../categories";
import { t } from "../i18n";
import { matchGroup, parseFilter } from "../lib";
import { fmtPct } from "../numfmt";
import { usePaneHeight, useSplitPane } from "../splitPane";
import type { AcrossAction } from "../acrossLists";
import type { AcrossGroup, AcrossPart, AllSendersResp, Group, SameSenderRow }
  from "../types";
import { AcrossSendersConfirm } from "./AcrossActions";
import { PartChips } from "./AcrossChips";
import { AccountChips } from "./AllAccountsOverview";
import { FilterField } from "./FilterMenu";
import { GradeBadge } from "./GradeUi";
import { GroupTable, RowAvatar, type SortKey } from "./GroupTable";
import { QueryBuilder } from "./QueryBuilder";
import { SelectMatches } from "./SelectMatches";
import { SortControl } from "./SortControl";
import { UnsubscribeAcross, unsubscribable } from "./UnsubscribeAcross";
import { AiTag, Avatar, BarButton, BulkBar, Button, EmptyState, FILTER_ROW,
  Loading, Meta, Modal, PageScope, Segmented, ShortDate, StatTile, Tag,
  useMediaQuery } from "./ui";

type AcrossSort = Exclude<SortKey, "grade">;

const SORT_OPTIONS: { k: AcrossSort; label: string }[] = [
  { k: "count", label: "Sort: mails" },
  { k: "size", label: "Sort: size" },
  { k: "last", label: "Sort: last activity" },
  { k: "unreadPct", label: "Sort: unread %" },
  { k: "engagement", label: "Sort: engagement" },
  { k: "label", label: "Sort: name" },
];

const sortValue = (g: Group, k: AcrossSort): number | string => {
  if (k === "unreadPct") return g.count ? g.unread / g.count : 0;
  return g[k];
};

/** One account's side of a row, as a row of its own (the account chip picked
 *  above the list): that account's figures, nothing of the others. */
export function inOneAccount(row: AcrossGroup, account: string):
    AcrossGroup | null {
  const p = row.accounts.find((x) => x.account === account);
  if (!p) return null;
  return { ...row, count: p.count, size: p.size, unread: p.unread,
    pinned: p.pinned, first: p.first, last: p.last, protected: p.protected,
    accounts: [p] };
}

/** A row as the Overview's "Same sender" row, so "Unsubscribe in N…" is the
 *  one confirm both places share. */
export function asSameSender(row: AcrossGroup): SameSenderRow {
  return {
    key: row.key, name: row.label || row.key, match: "address",
    accounts: row.accounts.map((p) => ({ account: p.account, addr: row.key,
      mails: p.count, size: p.size, unsub: p.unsub,
      state: p.unsubscribed === "done" || p.unsubscribed === "link"
        || p.unsubscribed === "failed" ? p.unsubscribed : null })),
    mails: row.count, size: row.size,
    opened: row.count ? Math.round(100 * (row.count - row.unread) / row.count)
      : 0 };
}

const unreadPct = (g: { count: number; unread: number }) =>
  g.count ? Math.round((100 * g.unread) / g.count) : 0;

/** The two pages across accounts that are lists, as a switch (below 1024 px
 *  there is no sidebar to go from one to the other). */
export function AcrossPages({ page, onPage }: {
  page: "senders" | "all"; onPage: (p: "senders" | "all") => void;
}) {
  return (
    <div className="mb-2 lg:hidden">
      <Segmented<"senders" | "all"> label={t("view.group_by")} fill
        value={page} onChange={onPage}
        options={[{ value: "senders", label: t("nav.senders") },
          { value: "all", label: t("view.all_mails") }]} />
    </div>
  );
}

/* ------------------------------ the detail ------------------------------ */

function PartRow({ part, onOpen }: {
  part: AcrossPart; onOpen: (account: string) => void;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Avatar name={part.account} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate type-body font-medium">{part.account}</span>
          {part.protected && (
            <Tag tone="neutral" className="inline-flex items-center gap-1">
              <Shield size={14} aria-hidden /> {t("protected")}
            </Tag>
          )}
          {part.unsubscribed === "done" && (
            <Tag tone="info">{t("Unsubscribed")}</Tag>
          )}
          {part.still > 0 && (
            <Tag tone="review">{t("alist.still_mailing", { n: part.still })}</Tag>
          )}
        </div>
        <div className="type-meta text-muted">
          <Meta items={[t("n.mails", { n: part.count }), fmtSize(part.size),
            `${fmtPct(unreadPct(part))} ${t("unread")}`,
            part.pinned > 0 && t("pin.n_protected", { n: part.pinned }),
            <>{t("row.last")} <ShortDate iso={part.last} /></>]} />
        </div>
        <Button variant="plain" size="sm" className="-ml-2.5 mt-0.5"
          onClick={() => onOpen(part.account)}>
          {t("alist.open_in", { account: part.account })}
        </Button>
      </div>
      {part.grade && <GradeBadge letter={part.grade} />}
    </li>
  );
}

function SenderDetail({ row, variant, onClose, onOpenIn, onShowMails, onAct,
  onUnsubscribe }: {
  row: AcrossGroup;
  variant: "pane" | "modal";
  onClose: () => void;
  onOpenIn: (account: string) => void;
  onShowMails: () => void;
  onAct: (action: AcrossAction) => void;
  onUnsubscribe: () => void;
}) {
  const open = unsubscribable(asSameSender(row)).length;
  const opened = row.count ? Math.round(
    100 * (row.count - row.unread) / row.count) : 0;
  const movable = row.accounts.filter((p) => !p.protected)
    .reduce((n, p) => n + p.count - p.pinned, 0);
  const content = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-4">
          <div className="flex items-start gap-3">
            <RowAvatar g={row} grouping="sender" size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="break-words type-title2">{row.label}</h2>
              {row.sub && (
                <div className="truncate type-body text-muted">{row.sub}</div>
              )}
              {row.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {row.tags.map((tag) => (
                    <Tag key={tag} tone="category">{categoryName(tag)}</Tag>
                  ))}
                </div>
              )}
            </div>
            <Button variant="secondary" size="icon" label={t("Close")}
              className="shrink-0" onClick={onClose}>
              <X size={18} />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            {row.ai && <AiTag ai={row.ai} />}
            {row.new && <Tag tone="new" dot>{t("New")}</Tag>}
            {row.replied && <Tag tone="info" dot>{t("replied")}</Tag>}
            <PartChips parts={row.accounts} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pt-4">
          <StatTile label={t("detail.mails")} value={row.count} />
          <StatTile label={t("detail.size")} value={fmtSize(row.size)} />
          <StatTile label={t("detail.opened")} value={fmtPct(opened)} />
        </div>
        <h3 className="px-4 pb-1 pt-5 type-heading">
          {t("alist.in_accounts", { n: row.accounts.length })}</h3>
        <ul className="divide-y divide-line border-y border-line">
          {row.accounts.map((p) => (
            <PartRow key={p.account} part={p} onOpen={onOpenIn} />
          ))}
        </ul>
        <p className="px-4 pt-3 type-meta text-muted">
          {t("alist.detail_note")}</p>
      </div>
      <div className="border-t border-line px-4 py-3"
        style={{ paddingBottom:
          "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {open > 0 && (
            <Button variant="tinted" size="sm" onClick={onUnsubscribe}>
              <BellOff size={14} aria-hidden
                className="mr-1 inline align-text-bottom" />
              {t("all.unsub_in", { n: open })}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => onAct("archive")}>
            <Archive size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />{t("Archive")}
          </Button>
          <Button variant="secondary" size="sm"
            onClick={() => onAct("mark_read")}>
            <MailOpen size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />{t("Mark read")}
          </Button>
          <Button variant="plain" size="sm" onClick={onShowMails}>
            <ListTree size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
            {t("alist.show_mails")}
          </Button>
        </div>
        <Button variant="danger-tint" disabled={movable === 0}
          className="inline-flex w-full items-center justify-center gap-1.5"
          onClick={() => onAct("trash")}>
          <Trash2 size={16} aria-hidden />
          {t("detail.trash_all", { n: movable })}
        </Button>
      </div>
    </>
  );
  return variant === "pane" ? (
    <section aria-label={t("detail.region", { label: row.label })}
      data-split-pane tabIndex={-1}
      className="flex h-full min-h-0 flex-col overflow-hidden border-l
        border-line bg-panel outline-none">
      <PageScope>{content}</PageScope>
    </section>
  ) : (
    <Modal onClose={onClose} full edgeBack>{content}</Modal>
  );
}

/* -------------------------------- the page -------------------------------- */

export function AllSendersView({ data, failed, onRetry, names, phone,
  exists, demo, initialFilter = "", onOpenIn, onShowMails, onPage,
  onOpenActivity, onChanged }: {
  data: AllSendersResp | null;
  failed: boolean;
  onRetry: () => void;
  /** The accounts' own order. */
  names: string[];
  phone: boolean;
  exists: (account: string) => boolean;
  demo: boolean;
  initialFilter?: string;
  /** Switch to this account and open the sender there (everything that is
   *  per account lives on that page). */
  onOpenIn: (account: string, key: string) => void;
  /** All mail across accounts, narrowed to this sender. */
  onShowMails: (key: string) => void;
  onPage: (p: "senders" | "all") => void;
  onOpenActivity: (account: string) => void;
  /** Something was changed: the numbers are fetched again. */
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [only, setOnly] = useState<string | null>(null);
  const [sortK, setSortK] = useState<AcrossSort>("count");
  const [sortDir, setSortDir] = useState(-1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // What the confirm was opened for stays as it was drawn: the numbers that
  // come in while it is open do not change what is asked (or run).
  const [confirm, setConfirm] = useState<{ rows: AcrossGroup[];
    action: AcrossAction } | null>(null);
  const [unsub, setUnsub] = useState<SameSenderRow | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const split = useSplitPane();
  const [paneEl, setPaneEl] = useState<HTMLDivElement | null>(null);
  usePaneHeight(paneEl);

  // The account chip narrows the list to that account's side of each row.
  useEffect(() => {
    if (only && !names.includes(only)) setOnly(null);
  }, [names, only]);
  // (a ticked row would stay ticked with only that account's share of it:
  // the selection starts over with the chip)
  useEffect(() => { setPicked(new Set()); }, [only]);
  const all = useMemo<AcrossGroup[]>(() => {
    const rows = data?.senders ?? [];
    if (!only) return rows;
    return rows.flatMap((r) => inOneAccount(r, only) ?? []);
  }, [data, only]);
  const groups = useMemo(() => {
    const f = parseFilter(filter);
    const now = nowMs();
    return all.filter((g) => matchGroup(g, f, now)).sort((a, b) => {
      const va = sortValue(a, sortK), vb = sortValue(b, sortK);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return cmp * sortDir || b.count - a.count;
    });
  }, [all, filter, sortK, sortDir]);

  // A selection only covers what is on screen.
  const selected = useMemo(() => {
    const visible = new Set(groups.map((g) => g.key));
    return new Set([...picked].filter((k) => visible.has(k)));
  }, [picked, groups]);
  useEffect(() => {
    if (selected.size !== picked.size) setPicked(selected);
  }, [selected, picked]);
  const chosen = useMemo(
    () => groups.filter((g) => selected.has(g.key)), [groups, selected]);

  const matchKeys = useMemo(() => filter.trim()
    ? groups.filter((g) => !g.protected).map((g) => g.key) : [], [groups, filter]);
  const allMatches = matchKeys.length > 0
    && matchKeys.every((k) => selected.has(k));

  const open = openKey ? all.find((g) => g.key === openKey) ?? null : null;
  useEffect(() => { if (openKey && !open) setOpenKey(null); }, [openKey, open]);

  const toggle = (k: string) => {
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    setPicked(next);
  };
  const rowsFor = (keys: string[]): AcrossGroup[] =>
    (data?.senders ?? []).filter((r) => keys.includes(r.key)).flatMap((r) =>
      (only ? inOneAccount(r, only) : r) ?? []);

  const sortControl = (
    <SortControl value={sortK} plain={phone} options={SORT_OPTIONS}
      dir={sortDir < 0 ? "desc" : "asc"}
      onValue={(k) => { setSortK(k); setSortDir(k === "label" ? 1 : -1); }}
      onDir={(d) => setSortDir(d === "asc" ? 1 : -1)} />
  );
  const mails = groups.reduce((n, g) => n + g.count, 0);
  const size = groups.reduce((n, g) => n + g.size, 0);
  const summary = (
    <Meta items={[filter
      ? t("status.groups_of", { n: groups.length, total: all.length })
      : t("n.groups", { n: groups.length }),
      t("n.mails", { n: mails }), fmtSize(size)]} />
  );
  const selectBtn = (
    <Button variant={phone ? "plain" : "secondary"} aria-pressed={selectMode}
      className={phone ? "px-2 coarse:min-h-11" : undefined}
      onClick={() => {
        if (selectMode) setPicked(new Set());
        setSelectMode(!selectMode);
      }}>
      {selectMode ? t("select.done") : t("select.enter")}
    </Button>
  );

  const detail = open && (
    <SenderDetail row={open} variant={split ? "pane" : "modal"}
      onClose={() => setOpenKey(null)}
      onOpenIn={(a) => onOpenIn(a, open.key)}
      onShowMails={() => onShowMails(open.key)}
      onAct={(action) => setConfirm({ rows: rowsFor([open.key]), action })}
      onUnsubscribe={() => setUnsub(asSameSender(open))} />
  );
  const paneOpen = split && !!open;

  const act = (action: AcrossAction) =>
    setConfirm({ rows: rowsFor([...selected]), action });
  const bar = selected.size > 0 && (
    <BulkBar
      summary={t("alist.bar_selected", { n: selected.size,
        mails: chosen.reduce((n, g) => n + g.count, 0) })}
      onClear={() => setPicked(new Set())}
      actions={<>
        <BarButton icon={<BellOff size={16} aria-hidden />}
          disabled={selected.size !== 1 || !chosen[0]
            || unsubscribable(asSameSender(chosen[0])).length === 0}
          title={selected.size !== 1 ? t("alist.unsub_one_only") : undefined}
          onClick={() => setUnsub(asSameSender(chosen[0]))}>
          {t("Unsubscribe")}
        </BarButton>
        <BarButton icon={<Archive size={16} aria-hidden />}
          onClick={() => act("archive")}>{t("Archive")}</BarButton>
        <BarButton icon={<MailOpen size={16} aria-hidden />}
          onClick={() => act("mark_read")}>{t("Mark read")}</BarButton>
      </>}
      primary={
        <Button variant="danger" size="sm"
          className="min-h-9 whitespace-nowrap rounded-full"
          onClick={() => act("trash")}>
          {t("Trash")} {chosen.reduce((n, g) => n + g.count, 0)}
        </Button>
      } />
  );

  return (
    <div>
      <AcrossPages page="senders" onPage={onPage} />
      <div className={FILTER_ROW}>
        <div className="relative min-w-0 flex-1 max-md:basis-full md:min-w-48">
          <FilterField value={filter} onChange={setFilter} token={null}
            inputRef={filterRef}
            builder={<QueryBuilder value={filter} onChange={setFilter} plain
              label={t("qb.title")} />} />
        </div>
        {phone ? (
          <div className="flex basis-full items-center">
            <div className="min-w-0 flex-1 type-meta text-muted">{summary}</div>
            {sortControl}
            {selectBtn}
          </div>
        ) : (<>{sortControl}{selectBtn}</>)}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <AccountChips names={names} selected={only} onSelect={setOnly} />
        {!phone && (
          <span className="type-meta text-muted">{summary}</span>
        )}
      </div>

      {failed && !data && (
        <EmptyState title={t("overview.load_failed")}
          action={<Button variant="secondary" onClick={onRetry}>
            {t("tab.retry")}</Button>} />
      )}
      {!data && !failed && <Loading label={t("loading…")} />}
      {data && groups.length === 0 && (
        <EmptyState>{filter ? t("no.matches") : t("alist.none")}</EmptyState>
      )}
      {data && groups.length > 0 && (
        <div className={paneOpen
          ? "grid grid-cols-[minmax(0,11fr)_minmax(0,9fr)]" : ""}>
          <div className="min-w-0">
            <GroupTable groups={groups} selected={selected} noGrade
              banner={matchKeys.length > 0 && (
                <SelectMatches n={matchKeys.length}
                  skipped={groups.length - matchKeys.length}
                  allSelected={allMatches}
                  onSelect={() => {
                    setPicked(new Set([...selected, ...matchKeys]));
                    setSelectMode(true);
                  }}
                  onClear={() => {
                    const keep = new Set(selected);
                    matchKeys.forEach((k) => keep.delete(k));
                    setPicked(keep);
                  }} />
              )}
              chips={(g) => (
                <PartChips parts={(g as AcrossGroup).accounts} />)}
              compact={paneOpen} selectMode={selectMode}
              openKey={paneOpen ? openKey : null} focusedKey={null}
              onToggle={toggle}
              onToggleAll={(checked, keys) => {
                const next = new Set(selected);
                keys.forEach((k) => checked ? next.add(k) : next.delete(k));
                setPicked(next);
              }}
              onOpen={(g) => setOpenKey(g.key)}
              sortK={sortK} sortDir={sortDir}
              onSort={(k) => {
                if (k === "grade") return;
                if (k === sortK) setSortDir(-sortDir);
                else { setSortK(k); setSortDir(k === "label" ? 1 : -1); }
              }}
              groupLabel={t("nav.senders")} grouping="sender"
              resetSignal={`${filter}\u0000${only ?? ""}`} />
          </div>
          {paneOpen && (
            <div className="min-w-0">
              <div ref={setPaneEl} className="sticky top-0 h-app">
                {detail}
              </div>
            </div>
          )}
        </div>
      )}
      {open && !split && detail}
      {bar}
      {confirm && (
        <AcrossSendersConfirm rows={confirm.rows} action={confirm.action}
          order={names} exists={exists}
          onOpenActivity={(a) => { setConfirm(null); onOpenActivity(a); }}
          onChanged={() => { setPicked(new Set()); onChanged(); }}
          onClose={() => setConfirm(null)} />
      )}
      {unsub && (
        <UnsubscribeAcross row={unsub} demo={demo} exists={exists}
          onOpenActivity={(a) => { setUnsub(null); onOpenActivity(a); }}
          onChanged={onChanged} onClose={() => setUnsub(null)} />
      )}
    </div>
  );
}
