import { Archive, BellOff, ChevronLeft, ChevronRight, Download, FolderInput,
  ListChecks, Mail, MailCheck, ScrollText, Send, Trash2, Undo2,
  type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { groupByMonth, localIso, monthSummary, undoneCounts } from "../activity";
import { nowDate } from "../clock";
import { api, downloadFile, errorText, fmtSize } from "../api";
import { getLang, t } from "../i18n";
import type { AuditEntry, Group, Rule } from "../types";
import { retryableGroup } from "../unsub";
import { Button, EmptyState, Loading, PanelHeader, Modal, SectionLabel,
  ShortDate, Tag, type TagTone } from "./ui";

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

/** `t()` with a tiered fallback: a `prefix.<key>` translation, or the raw
 *  key itself when there is no (yet) translated entry for it. */
export const tOr = (prefix: string, key: string): string => {
  const full = `${prefix}.${key}`;
  const s = t(full);
  return s === full ? key : s;
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
};
const FALLBACK_LOOK = { icon: Mail, tone: "bg-chip text-chiptext" };

const OUTCOME_TONE: Record<string, TagTone> = {
  ok: "safe", done: "safe", link: "info", partial: "review",
  cancelled: "neutral", error: "keep", failed: "keep",
};

const monthName = (ts: number): string => {
  const d = new Date(ts * 1000);
  const sameYear = d.getFullYear() === nowDate().getFullYear();
  return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-GB",
    sameYear ? { month: "long" } : { month: "long", year: "numeric" })
    .format(d);
};

/** "This month" card: mails cleaned (+ size when the log has it) and the
 *  weekly bars, all from the audit log. */
function MonthCard({ recent, rules }: {
  recent: { entries: AuditEntry[]; complete: boolean } | null; rules: Rule[];
}) {
  const sum = useMemo(() => recent
    && monthSummary(recent.entries, nowDate(), rules), [recent, rules]);
  if (!sum) return null;
  const max = Math.max(1, ...sum.weeks);
  return (
    <section aria-label={t("activity.month")}
      className="rounded-card border border-line bg-panel p-4">
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
          {sum.weeks.map((v, i) => (
            <li key={i} className="flex flex-col items-stretch gap-1">
              <div className="flex h-16 items-end">
                <div className="w-full rounded-badge bg-accent/70"
                  // bar height = this week's share of the busiest week
                  style={{ height: `${v ? Math.max(6, (100 * v) / max) : 2}%` }} />
              </div>
              <span className="text-center type-meta text-muted">
                {t("activity.week", { n: i + 1 })}
                <span className="sr-only">: {t("n.mails", { n: v })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TimelineRow({ e, rules, retry, undone = 0 }: {
  e: AuditEntry; rules: Rule[];
  /** Mails of this entry that a later undo restored. */
  undone?: number;
  /** The Retry button of a failed unsubscribe, when there is one. */
  retry?: ReactNode;
}) {
  const look = ACTION_LOOK[e.action] ?? FALLBACK_LOOK;
  const Icon = look.icon;
  const failed = e.outcome === "error" || e.outcome === "failed";
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <span aria-hidden className={`grid size-10 shrink-0 place-items-center
        rounded-control ${look.tone}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block type-body-mobile font-medium md:type-body">
          {tOr("audit.act", e.action)}
          {e.count > 0 && ` · ${t("n.mails", { n: e.count })}`}
        </span>
        {e.label && (
          <span className="block truncate type-meta text-muted"
            title={e.label}>{e.label}</span>
        )}
        <span className="block type-meta text-muted">
          {actorLabel(e.actor, rules)}
          {e.bytes > 0 && ` · ${fmtSize(e.bytes)}`}
        </span>
        {e.error && (
          <span className={`block type-meta ${failed ? "text-danger-fg"
            : "text-muted"}`}>{errorText(e.error)}</span>
        )}
        {undone > 0 && (
          <span className="mt-1 block">
            <Tag tone="neutral">
              {undone >= e.count ? t("activity.undone")
                : t("activity.undone_n", { n: undone })}
            </Tag>
          </span>
        )}
        {retry}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <ShortDate iso={localIso(e.ts)} time
          className="type-meta text-muted" />
        <span title={e.error ? errorText(e.error) : undefined}>
          <Tag tone={OUTCOME_TONE[e.outcome] ?? "neutral"}
            className={failed ? "font-semibold" : ""}>
            {tOr("audit.outcome", e.outcome)}
          </Tag>
        </span>
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
      <Button variant="secondary" size="sm" className="mt-2 coarse:min-h-11"
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
        sub={total == null ? t("loading…") : total === 0 ? "" : t("audit.page", {
          from: offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}
        actions={!!total && (
          <Button variant="secondary" size="icon"
            label={t("audit.export")}
            onClick={() => downloadFile(api.auditExportUrl())}>
            <Download size={18} />
          </Button>)}
        onClose={onClose}
      />
      <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        <div className="mx-auto flex max-w-180 flex-col gap-4">
          {total !== 0 && <MonthCard recent={recent} rules={rules} />}
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
      {!!total && (
        <div className="flex justify-end gap-2 border-t border-line px-4 py-2
          max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
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
