import { Archive, BellOff, Ban, ChevronLeft, ChevronRight, CircleAlert,
  CircleCheck, CircleX, Download, ExternalLink, FolderInput, Hand, KeyRound, ListChecks,
  Circle, Mail, MailCheck, ScrollText, Send, Trash2, Undo2, type LucideIcon }
  from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { entryText, groupByMonth, localIso, monthSummary, tOr, undoneCounts,
  weekRanges } from "../activity";
import { nowDate } from "../clock";
import { api, downloadFile, errorText, fmtSize } from "../api";
import { getLang, t } from "../i18n";
import type { AuditEntry, Group, Rule } from "../types";
import { retryableGroup } from "../unsub";
import { Button, EmptyState, Loading, PanelHeader, Modal, SectionLabel,
  ShortDate, Tag } from "./ui";

export { tOr };

const PAGE_SIZE = 50;
/** The month summary pages through the log (newest first) until the month
 *  starts: pages of 500 (the API cap), at most this many. */
const SUMMARY_LIMIT = 500;
const SUMMARY_PAGES = 4;

/** Rules are referenced by id (stable across renames); resolve to the
 *  rule's current name for display, falling back to the id if it was
 *  since deleted. */
export const actorLabel = (actor: string, rules: Rule[]): string => {
  if (!actor.startsWith("rule:")) return t("audit.by", { actor: t(actor) });
  const id = actor.slice(5);
  const name = rules.find((r) => r.id === id)?.name;
  return t("audit.by_rule", { name: name || id });
};

/** Icon + tint of an action's tile in the timeline. */
const ACTION_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  trash: { icon: Trash2, tone: "bg-keep-bg text-keep-fg" },
  purge: { icon: Trash2, tone: "bg-keep-bg text-keep-fg" },
  empty_trash: { icon: Trash2, tone: "bg-keep-bg text-keep-fg" },
  archive: { icon: Archive, tone: "bg-safe-bg text-safe-fg" },
  move: { icon: FolderInput, tone: "bg-safe-bg text-safe-fg" },
  move_contents: { icon: FolderInput, tone: "bg-safe-bg text-safe-fg" },
  mark_read: { icon: MailCheck, tone: "bg-chip text-chiptext" },
  rule_execute: { icon: ListChecks, tone: "bg-review-bg text-review-fg" },
  rule_report: { icon: ListChecks, tone: "bg-chip text-chiptext" },
  unsubscribe: { icon: BellOff, tone: "bg-info-bg text-info-fg" },
  undo: { icon: Undo2, tone: "bg-chip text-chiptext" },
  digest_sent: { icon: Send, tone: "bg-chip text-chiptext" },
  assistant_token_created: { icon: KeyRound, tone: "bg-info-bg text-info-fg" },
  assistant_token_revoked: { icon: KeyRound, tone: "bg-chip text-chiptext" },
};
const FALLBACK_LOOK = { icon: Mail, tone: "bg-chip text-chiptext" };

/** Icon + colour of an entry's status ("Done", "Failed", ...). */
const STATUS_LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  ok: { icon: CircleCheck, tone: "text-safe-fg" },
  done: { icon: CircleCheck, tone: "text-safe-fg" },
  link: { icon: ExternalLink, tone: "text-info-fg" },
  partial: { icon: CircleAlert, tone: "text-review-fg" },
  cancelled: { icon: Ban, tone: "text-muted" },
  error: { icon: CircleX, tone: "text-danger-fg" },
  failed: { icon: CircleX, tone: "text-danger-fg" },
};

/** An outcome this release does not know (a newer one): neutral. */
const STATUS_FALLBACK = { icon: Circle, tone: "text-muted" };

const monthName = (ts: number): string => {
  const d = new Date(ts * 1000);
  const sameYear = d.getFullYear() === nowDate().getFullYear();
  return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-GB",
    sameYear ? { month: "long" } : { month: "long", year: "numeric" })
    .format(d);
};

/** "This month" card: mails cleaned (+ size when the log has it), the weekly
 *  bars with their values and the split (by rules / by you / unsubscribed),
 *  all from the audit log. */
function MonthCard({ recent, rules }: {
  recent: { entries: AuditEntry[]; complete: boolean } | null; rules: Rule[];
}) {
  const sum = useMemo(() => recent
    && monthSummary(recent.entries, nowDate(), rules), [recent, rules]);
  if (!sum) return null;
  const max = Math.max(1, ...sum.weeks);
  const now = nowDate();
  // a history cut short by the page cap may hold more than it shows
  const count = (n: number): string => !recent!.complete && n > 0
    ? t("activity.at_least_n", { n }) : String(n);
  const month = new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-GB",
    { month: "short" }).format(now);
  const split: { icon: LucideIcon; label: string; n: number }[] = [
    { icon: ListChecks, label: t("activity.by_rules"), n: sum.byRules },
    { icon: Hand, label: t("activity.by_you"), n: sum.byYou },
    { icon: BellOff, label: t("activity.unsubscribed"), n: sum.unsubscribed },
  ];
  return (
    <section aria-label={t("activity.month")}
      className="rounded-card border border-line bg-panel p-4
        lg:sticky lg:top-0 lg:col-start-2 lg:row-start-1 lg:self-start">
      <div className="type-meta text-muted">{t("activity.month")}</div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="type-largetitle tabular-nums">
          {recent!.complete ? sum.mails : t("activity.at_least", { n: sum.mails })}
        </span>
        <span className="type-body text-muted">
          {t("activity.cleaned", { n: sum.mails })}
          {sum.bytes > 0 ? ` · ${fmtSize(sum.bytes)}` : ""}
        </span>
      </div>
      {sum.mails === 0 ? (
        <p className="mt-2 type-meta text-muted">
          {t("activity.month_empty")}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-4 gap-3">
          {sum.weeks.map((v, i) => {
            const [from, to] = weekRanges(now)[i];
            return (
              <li key={i} className="flex flex-col items-stretch gap-1">
                <span aria-hidden className="text-center type-meta
                  font-medium tabular-nums">{v ? count(v) : "–"}</span>
                <div className="flex h-16 items-end">
                  <div className="w-full rounded-badge bg-accent/70"
                    // bar height = this week's share of the busiest week
                    style={{ height: `${v ? Math.max(6, (100 * v) / max) : 2}%` }} />
                </div>
                <span className="text-center type-meta text-muted">
                  {i === 0 ? `${from}–${to} ${month}` : `${from}–${to}`}
                  <span className="sr-only">
                    {" "}({t("activity.week", { n: i + 1 })}): {t("n.mails", { n: v })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
        {split.map(({ icon: Icon, label, n }) => (
          <li key={label} className="flex items-center gap-2 type-body">
            <Icon size={16} aria-hidden className="shrink-0 text-muted" />
            <span className="flex-1">{label}</span>
            <span className="font-semibold tabular-nums">{count(n)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One entry of the log; the Insights hub's Recent activity uses it too. */
export function TimelineRow({ e, rules, retry, undone = 0 }: {
  e: AuditEntry; rules: Rule[];
  /** Mails of this entry that a later undo restored. */
  undone?: number;
  /** The Retry button of a failed unsubscribe, when there is one. */
  retry?: ReactNode;
}) {
  const look = ACTION_LOOK[e.action] ?? FALLBACK_LOOK;
  const Icon = look.icon;
  const status = STATUS_LOOK[e.outcome] ?? STATUS_FALLBACK;
  const StatusIcon = status.icon;
  const failed = e.outcome === "error" || e.outcome === "failed";
  const text = entryText(e, rules);
  const [why, setWhy] = useState(false);
  // Grid: icon | headline + second line | date + status. On phones the date
  // and status drop under the headline so it keeps the full width.
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3
      py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]">
      <span aria-hidden className={`row-span-3 grid size-10 place-items-center
        rounded-control ${look.tone}`}>
        <Icon size={18} />
      </span>
      <span className="col-start-2 min-w-0">
        <span className="block type-body-mobile font-medium md:type-body">
          {text.title}
        </span>
        <span className="flex min-w-0 type-meta text-muted">
          {text.detail && (
            <span className="min-w-0 truncate" title={text.detail}>
              {text.detail}</span>
          )}
          <span className="shrink-0 whitespace-pre-wrap">
            {text.detail && (text.who || e.bytes > 0) ? " · " : ""}
            {text.who}
            {e.bytes > 0 && `${text.who ? " · " : ""}${fmtSize(e.bytes)}`}
          </span>
        </span>
      </span>
      <span className="col-start-2 row-start-2 flex flex-wrap items-center
        gap-x-2 sm:col-start-3 sm:row-span-3 sm:row-start-1 sm:flex-col
        sm:items-end sm:gap-1">
        <ShortDate iso={localIso(e.ts)} time
          className="type-meta text-muted" />
        <span className={`inline-flex items-center gap-1 type-meta
          font-medium ${status.tone}`}>
          <StatusIcon size={14} aria-hidden />
          {tOr("audit.outcome", e.outcome)}
          {e.error && (<>
            <span aria-hidden className="text-muted">·</span>
            <button type="button" aria-expanded={why}
              onClick={() => setWhy((v) => !v)}
              className="rounded-control px-1 text-accent hover:underline
                focus-visible:ring-2 focus-visible:ring-accent
                coarse:-my-3 coarse:min-h-11">
              {t("audit.why")}
            </button>
          </>)}
          {retry}
        </span>
      </span>
      <span className="col-start-2 row-start-3 min-w-0 empty:hidden
        sm:row-start-2">
        {why && e.error && (
          <span className={`block type-meta ${failed
            ? "text-danger-fg" : "text-muted"}`}>{errorText(e.error)}</span>
        )}
        {undone > 0 && (
          <span className="mt-1 block">
            <Tag tone="neutral">
              {undone >= e.count ? t("activity.undone")
                : t("activity.undone_n", { n: undone })}
            </Tag>
          </span>
        )}
      </span>
    </li>
  );
}

/** Append-only history of every action Inboxrake took on this mailbox:
 *  bulk/rule trash-archive-move-mark_read, rule runs, unsubscribes, undo,
 *  empty-trash. The Activity page: a month summary, `above` (the undo
 *  cards), then the log as a timeline grouped by month. Paged, newest
 *  first, CSV export. */
export function AuditLogPanel({ rules, onClose, above, reloadKey, groups, onRetryUnsub }: {
  rules: Rule[]; onClose: () => void;
  /** The Activity page puts the undo cards here, under the month summary. */
  above?: ReactNode;
  /** Changes when something new was logged behind the panel (an undo). */
  reloadKey?: number;
  /** Sender groups + the retry action (the detail panel's unsubscribe):
   *  a failed unsubscribe whose sender can still be retried gets "Retry". */
  groups?: Record<string, Group>;
  onRetryUnsub?: (g: Group) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [recent, setRecent] = useState<{ entries: AuditEntry[];
    complete: boolean } | null>(null);
  const [error, setError] = useState("");

  const load = (off: number, keep = false) => {
    if (!keep) setEntries(null);
    api.audit(off, PAGE_SIZE)
      .then((r) => { setEntries(r.entries); setTotal(r.total); })
      .catch((e) => setError(String(e.message ?? e)));
  };
  useEffect(() => load(offset), [offset, reloadKey]);
  // The month summary needs the whole month, not just this page.
  useEffect(() => {
    let live = true;
    const d = nowDate();
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000;
    (async () => {
      const all: AuditEntry[] = [];
      let complete = false;
      for (let i = 0; i < SUMMARY_PAGES && !complete; i++) {
        const r = await api.audit(all.length, SUMMARY_LIMIT);
        all.push(...r.entries);
        complete = all.length >= r.total || r.entries.length === 0
          || all[all.length - 1].ts < monthStart;
      }
      if (live) setRecent({ entries: all, complete });
    })().catch(() => live && setRecent({ entries: [], complete: true }));
    return () => { live = false; };
  }, [reloadKey]);

  const retryButton = (e: AuditEntry): ReactNode => {
    const g = onRetryUnsub && e.action === "unsubscribe"
      && (e.outcome === "failed" || e.outcome === "error")
      ? retryableGroup(groups, e.label) : null;
    if (!g) return null;
    return (
      <Button variant="tinted" size="sm" className="coarse:-my-3 coarse:min-h-11"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          await onRetryUnsub!(g);
          setRetrying(false);
          load(offset, true);
        }}>
        {t("tab.retry")}
      </Button>
    );
  };

  const months = useMemo(() => groupByMonth(entries ?? []), [entries]);
  // An undo is newer than what it undid, so it may sit on an earlier page:
  // read the undone counts from this page and the recent entries together.
  const undone = useMemo(
    () => undoneCounts([...(recent?.entries ?? []), ...(entries ?? [])]),
    [recent, entries]);

  return (
    <Modal onClose={onClose} size="lg"
      full={!!above || !entries || entries.length > 0}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <ScrollText size={18} /> {t("nav.activity")}
        </span>}
        sub={total == null ? t("loading…") : total === 0 ? ""
          : t("audit.entries", { n: total })}
        actions={!!total && (
          <Button variant="secondary" size="icon"
            label={t("audit.export")}
            onClick={() => downloadFile(api.auditExportUrl())}>
            <Download size={18} />
          </Button>)}
        onClose={onClose}
      />
      <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        {/* phones / tablets: the month card on top; from 1024 px the log on
            the left, the card beside it */}
        <div className="mx-auto flex max-w-180 flex-col gap-4
          lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
          {total !== 0 && <MonthCard recent={recent} rules={rules} />}
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1
            lg:row-start-1">
          {above}
          {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
          {!entries && !error && <Loading />}
          {entries && entries.length === 0 && (
            <EmptyState icon={<ScrollText size={18} />}
              title={t("audit.empty")} hint={t("audit.empty_hint")} />
          )}
          {months.map((m) => (
            <section key={m.key} aria-label={monthName(m.ts)}>
              <SectionLabel className="px-1 pb-1">{monthName(m.ts)}</SectionLabel>
              <ul className="divide-y divide-line rounded-card border
                border-line bg-panel">
                {m.entries.map((e, i) => (
                  <TimelineRow key={`${e.ts}-${i}`} e={e} rules={rules}
                    undone={e.id ? undone.get(e.id) ?? 0 : 0}
                    retry={retryButton(e)} />
                ))}
              </ul>
            </section>
          ))}
          </div>
        </div>
      </div>
      {!!total && total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2
          max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <span className="mr-auto type-meta text-muted">{t("audit.page", {
            from: offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}
          </span>
          <Button variant="secondary" size="sm" disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ChevronLeft size={16} className="mr-1 inline align-text-bottom" />
            {t("Previous")}
          </Button>
          <Button variant="secondary" size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>
            {t("Next")}
            <ChevronRight size={16} className="ml-1 inline align-text-bottom" />
          </Button>
        </div>
      )}
    </Modal>
  );
}
