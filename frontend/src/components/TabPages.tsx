import { BarChart3, ChevronRight, ClipboardList, Copy, Eye, History,
  Layers, LayoutGrid, Paperclip, Play, ShieldAlert, Trash2, Wand2 }
  from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, fmtSize } from "../api";
import { nowDate } from "../clock";
import { fmtNum, fmtPct } from "../numfmt";
import { getLang, t } from "../i18n";
import { fmtAgo } from "../lib";
import { biggestSenders, totalsOf } from "../overview";
import { computeQuickWins, isDismissed, loadDismissed, splitTotals } from "../quickwins";
import { senderItem, toneOf } from "../spacemap";
import { squarify } from "../treemap";
import type { AppState, AuditEntry, DupSummary, Group, StatsResp, TrackerReport,
  WrappedResp }
  from "../types";
import { TimelineRow } from "./AuditLogPanel";
import { TONE_BAR } from "./spaceUi";
import { cardsFor } from "./WrappedStory";
import { retryableGroup } from "../unsub";
import { Avatar, Button, MiniBars, Ring }
  from "./ui";

/* The Clean up / Insights tab pages (below 1024 px): a "what is waiting"
 * card, a feature card and tool tiles / widgets. Every tool of the old list
 * stays one tap away; numbers come from data the app already has (loaded
 * groups, the status payload, the endpoints the tools fetch themselves) and
 * a tool whose number needs a run shows "Check" instead. */

export type TabTool = "triage" | "duplicates" | "attachments" | "rules"
  | "junk" | "trash" | "stats" | "space" | "wrapped" | "trackers" | "activity";

/** Legend / bar colour of each quick-win source (semantic tokens). */
const SOURCE_FILL: Record<string, string> = {
  old_newsletters: "bg-info-fg", quiet_low: "bg-muted",
  unsubscribed: "bg-review-fg", big_attachments: "bg-attach-fg",
  ai_safe: "bg-safe-fg",
};

const CARD = "rounded-card bg-panel p-4 text-left";
const CARD_BTN = `${CARD} flex w-full min-w-0 flex-col transition-colors
  enabled:hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-60`;

/** A small placeholder with the height of the content it stands in for, so
 *  a widget does not jump when its data arrives. */
const Skeleton = ({ className }: { className: string }) => (
  <span aria-hidden className={`block rounded-control bg-panel2 ${className}`} />
);

function Tile({ icon, tone, label, value, sub, disabled, onClick }: {
  icon: ReactNode; tone: string; label: string;
  /** null = unknown without a run: shows "Check". */
  value: ReactNode | null; sub?: string; disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`${CARD_BTN} relative min-h-32 gap-3`}>
      <span className={`inline-flex size-10 items-center justify-center
        rounded-control ${tone}`}>{icon}</span>
      <span className="block min-w-0 flex-1">
        <span className="block type-body font-semibold">{label}</span>
        {sub && <span className="block type-meta text-muted">{sub}</span>}
      </span>
      {/* after the label in the DOM (accessible name), top right on screen */}
      <span className={`absolute right-4 top-4 tabular-nums
        ${value == null ? "type-body font-semibold text-accent"
        : "type-heading"}`}>
        {value ?? t("tab.check")}
      </span>
    </button>
  );
}

/** The Clean up tab: Ready to clean, Triage and the tool tiles. */
export function CleanupPage({ account, groups, state, deckSize, triageDisabled,
  aiShown, aiDisabled, demoHint, onOpen, onReviewAi }: {
  account: string;
  /** The Sender groups of the whole mailbox. */
  groups: Group[];
  state: AppState | null;
  /** Senders the triage deck would show. */
  deckSize: number;
  triageDisabled: boolean;
  aiShown: boolean;
  aiDisabled: boolean;
  demoHint?: string;
  onOpen: (tool: TabTool) => void;
  onReviewAi: () => void;
}) {
  const done = state?.status === "done";
  // Same suggestions (and dismissals) as the Overview's quick wins.
  const ready = useMemo(() => {
    const cards = computeQuickWins(groups).filter((c) =>
      !isDismissed(loadDismissed(account), c.def.id, c.mails));
    const parts = splitTotals(cards, groups);
    return { parts, mails: parts.reduce((n, p) => n + p.mails, 0),
      size: parts.reduce((n, p) => n + p.size, 0) };
  }, [groups, account]);
  const weight = (p: { mails: number; size: number }) =>
    ready.size > 0 ? p.size : p.mails;
  const attBytes = useMemo(
    () => groups.reduce((n, g) => n + g.att_size, 0), [groups]);
  // Duplicates are derived from the scanned index, so the server always has
  // the current result: fetched on mount, account change and scan done only
  // (AI batches bump groups_rev every few seconds; the call is not free).
  const [dups, setDups] = useState<DupSummary | "failed" | null>(null);
  useEffect(() => {
    if (!done) { setDups(null); return; }
    let alive = true;
    Promise.resolve().then(() => api.duplicatesSummary())
      .then((sum) => alive && setDups(sum))
      .catch(() => alive && setDups("failed"));
    return () => { alive = false; };
  }, [account, done]);
  const dupReady = dups != null && dups !== "failed";
  const dupCompare = dupReady ? dups.versions + dups.possible : 0;
  const compareText = t("tab.dup_compare", { n: fmtNum(dupCompare) });
  const dupLoading = done && dups == null;
  const atts = state?.atts;
  const attRunning = atts?.status === "running";
  const attSize = atts && atts.size > 0 ? atts.size : attBytes;
  const aiSafe = useMemo(() => groups.reduce(
    (n, g) => n + (g.ratings?.delete_safe ?? 0), 0), [groups]);
  const rules = state?.rules ?? [];
  const lastRun = Math.max(0, ...rules.map((r) => r.last_run?.ts ?? 0));
  const ago = fmtAgo(lastRun);

  return (
    <div className="mb-4 space-y-3">
      <section aria-label={t("tab.ready")} className={CARD}>
        <div className="type-meta text-muted">{t("tab.ready")}</div>
        {ready.parts.length === 0 ? (
          <p className="mt-2 type-body text-muted">
            {t(done ? "tab.ready_none" : "tab.ready_scan")}
          </p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="type-largetitle tabular-nums">
                {fmtSize(ready.size)}
              </span>
              <span className="type-meta text-muted">
                {t("tab.in_mails", { n: fmtNum(ready.mails) })}
              </span>
            </div>
            <div aria-hidden className="mt-3 flex h-2 gap-0.5
              overflow-hidden rounded-full">
              {ready.parts.map((p) => (
                <span key={p.id} className={SOURCE_FILL[p.id]}
                  style={{ flexGrow: weight(p), flexBasis: 0 }} />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {ready.parts.map((p) => (
                <li key={p.id} className="flex items-center gap-1.5
                  type-meta text-muted">
                  <span aria-hidden className={`size-2 rounded-full
                    ${SOURCE_FILL[p.id]}`} />
                  {t(`tab.src.${p.id}`)}
                  {" "}{fmtSize(p.size)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <button type="button" disabled={triageDisabled}
        onClick={() => onOpen("triage")}
        className="flex w-full items-center gap-3 rounded-card bg-accent-tint
          p-4 text-left transition-colors disabled:cursor-not-allowed
          disabled:opacity-60">
        <span aria-hidden className="relative size-14 shrink-0">
          {/* A hairline on every card: without it the white cards melt into
              the tinted tile in the light theme. */}
          <span className="absolute inset-0 rotate-6 rounded-card border
            border-line bg-panel2" />
          <span className="absolute inset-0 -rotate-6 rounded-card border
            border-line bg-panel" />
          <span className="absolute inset-0 flex items-center justify-center
            rounded-card border border-line bg-panel">
            {groups[0] ? <Avatar name={groups[0].label} size="md" />
              : <Layers size={18} className="text-muted" />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block type-heading">{t("triage.menu")}</span>
          <span className="block type-meta text-muted">
            {deckSize > 0
              ? t("tab.triage_waiting", { n: deckSize })
              : t("triage.menu_sub")}
          </span>
        </span>
        <span aria-hidden className="inline-flex min-h-11 items-center
          rounded-full bg-accent px-5 type-body font-semibold text-on-accent">
          {t("tab.start")}
        </span>
      </button>

      <ul aria-label={t("tools.group_cleanup")}
        className="grid grid-cols-2 gap-3">
        <li className="contents">
          <Tile icon={<Copy size={18} aria-hidden />}
            tone="bg-info-bg text-info-fg" label={t("Duplicates")}
            value={dupLoading ? <Skeleton className="h-6 w-14" />
              : dupReady ? (dups.sets > 0 ? fmtSize(dups.wasted)
                : dupCompare > 0 ? fmtNum(dupCompare)
                : t("tab.dup_none_value")) : null}
            sub={dupReady ? (dups.sets > 0
              ? [t("tab.dup_sets", { n: fmtNum(dups.sets) }),
                ...(dupCompare > 0 ? [compareText] : [])].join(" · ")
              : dupCompare > 0 ? compareText
                : (dups.dismissed ?? 0) > 0
                  ? t("tab.dup_kept", { n: dups.dismissed })
                  : t("tab.dup_none"))
              : t("tab.dup_sub")} disabled={!done}
            onClick={() => onOpen("duplicates")} />
        </li>
        <li className="contents">
          <Tile icon={<Paperclip size={18} aria-hidden />}
            tone="bg-attach-bg text-attach-fg" label={t("Attachments")}
            value={attRunning ? t("tab.running")
              : attSize > 0 ? fmtSize(attSize) : null}
            sub={!attRunning && atts && atts.mails > 0 && atts.size > 0
              ? t("tab.in_mails", { n: fmtNum(atts.mails) })
              : attSize > 0 || attRunning ? t("tab.att_sub")
                : t("tab.att_find")}
            onClick={() => onOpen("attachments")} />
        </li>
        {aiShown && (
          <li className="contents">
            <Tile icon={<Wand2 size={18} aria-hidden />}
              tone="bg-safe-bg text-safe-fg" label={t("AI review")}
              value={aiSafe > 0 ? t("n.mails", { n: aiSafe }) : null}
              sub={demoHint ?? (aiSafe > 0 ? t("tab.ai_sub") : undefined)}
              disabled={aiDisabled} onClick={onReviewAi} />
          </li>
        )}
        <li className="contents">
          <Tile icon={<ShieldAlert size={18} aria-hidden />}
            tone="bg-review-bg text-review-fg" label={t("role.junk")}
            value={state?.junk_count != null
              ? t("n.mails", { n: state.junk_count }) : null}
            sub={t("tab.junk_sub")}
            onClick={() => onOpen("junk")} />
        </li>
        <li className="contents">
          <Tile icon={<ClipboardList size={18} aria-hidden />}
            tone="bg-new-bg text-new-fg" label={t("Rules")}
            value={t("n.rules", { n: rules.length })}
            sub={ago ? t("tab.rules_last", { ago }) : t("tab.rules_none")}
            onClick={() => onOpen("rules")} />
        </li>
        <li className="contents">
          <Tile icon={<Trash2 size={18} aria-hidden />}
            tone="bg-keep-bg text-keep-fg" label={t("role.trash")}
            value={state?.trash_count != null
              ? t("n.mails", { n: state.trash_count }) : null}
            // The big number is the count: the sub-line adds the size.
            sub={state?.trash_size ? fmtSize(state.trash_size) : undefined}
            onClick={() => onOpen("trash")} />
        </li>
      </ul>
    </div>
  );
}

/** Widget header: icon, title and a chevron. */
const WidgetTitle = ({ icon, children, chevron = false }: {
  icon: ReactNode; children: ReactNode; chevron?: boolean;
}) => (
  <span className="flex items-center gap-2 type-meta font-semibold
    text-muted">
    <span aria-hidden className="text-accent">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {chevron && <ChevronRight size={16} aria-hidden className="text-faint" />}
  </span>
);

const monthName = (ym: string): string =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(
    getLang() === "de" ? "de-DE" : "en-GB", { month: "short", timeZone: "UTC" });

/** `n` consecutive months (YYYY-MM) ending at `last`. */
function monthsEnding(last: string, n: number): string[] {
  const [y, m] = last.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1)
      .padStart(2, "0")}`;
  });
}

/** The Insights tab: a preview widget per tool. Each widget loads what its
 *  tool loads (once per visit) and opens the tool on tap. */
export function InsightsPage({ groups, state, onOpen, onRetryUnsub }: {
  /** The Sender groups of the whole mailbox. */
  groups: Group[];
  state: AppState | null;
  onOpen: (tool: TabTool) => void;
  /** Retry a failed unsubscribe on its group (toast + refresh are the
   *  caller's); without it the entries show no Retry. */
  onRetryUnsub?: (g: Group) => Promise<void>;
}) {
  type Load<T> = { data: T | null; failed: boolean };
  const [stats, setStats] = useState<Load<StatsResp>>(
    { data: null, failed: false });
  const [trk, setTrk] = useState<Load<TrackerReport>>(
    { data: null, failed: false });
  const [audit, setAudit] = useState<Load<AuditEntry[]>>(
    { data: null, failed: false });
  const [wrapped, setWrapped] = useState<WrappedResp | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Bumped after a retry: the audit list is fetched again (not stats / trackers).
  const [auditTick, setAuditTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api.audit(0, 3).then((d) => alive
        && setAudit({ data: d.entries, failed: false }))
      .catch(() => alive && setAudit({ data: null, failed: true }));
    return () => { alive = false; };
  }, [auditTick]);
  useEffect(() => {
    let alive = true;
    api.stats().then((d) => alive && setStats({ data: d, failed: false }))
      .catch(() => alive && setStats({ data: null, failed: true }));
    api.wrapped().then((d) => alive && setWrapped(d)).catch(() => {});
    api.trackers().then((d) => alive && setTrk({ data: d, failed: false }))
      .catch(() => alive && setTrk({ data: null, failed: true }));
    return () => { alive = false; };
  }, []);

  const done = state?.status === "done";
  const series = useMemo(() => {
    const months = stats.data?.months ?? [];
    if (!months.length) return null;
    const by = new Map(months.map((m) => [m.month, m]));
    const last = months.map((m) => m.month).sort().at(-1) ?? "";
    const keys = monthsEnding(last, 12);
    return { keys, counts: keys.map((k) => by.get(k)?.count ?? 0),
      running: last === nowDate().toISOString().slice(0, 7) };
  }, [stats.data]);
  // Average of the months listed (their own sum, not the all-time total).
  const perMonth = stats.data?.months.length
    ? Math.round(stats.data.months.reduce((n, m) => n + m.count, 0)
      / stats.data.months.length) : 0;

  const space = useMemo(() => {
    const total = totalsOf(groups).size;
    const top = biggestSenders(groups, 4).filter((g) => g.size > 0);
    if (total <= 0 || !top.length) return null;
    // 240 x 100: about the widget's aspect, so tiles come out squarish.
    const rects = squarify(top.map((g) => ({ key: g.key, value: g.size })),
      { x: 0, y: 0, w: 240, h: 100 });
    return { top, rects, tones: top.map((g) =>
      toneOf(senderItem(g), "engagement")), pct: Math.round(
      100 * top.reduce((n, g) => n + g.size, 0) / total) };
  }, [groups]);

  const rep = trk.data;
  const trackerPct = rep && rep.usable && rep.checked > 0
    ? Math.round(100 * rep.pixel / rep.checked) : null;
  const rules = state?.rules ?? [];
  // Year, stories (the same cards the story plays), mails and top sender;
  // without mail (or a failed fetch) the card stays the plain entry.
  const story = useMemo(() => {
    if (!wrapped || !wrapped.received.mails) return null;
    const top = wrapped.top_senders[0];
    return { year: wrapped.year, n: cardsFor(wrapped).length,
      line: [t("n.mails", { n: fmtNum(wrapped.received.mails) }),
        top && t("tab.year_top", { name: top.label || top.addr })]
        .filter(Boolean).join(" · ") };
  }, [wrapped]);

  return (
    <div className="mb-4 space-y-3">
      <button type="button" onClick={() => onOpen("stats")}
        className={CARD_BTN}>
        <WidgetTitle icon={<BarChart3 size={16} />} chevron>
          {t("Statistics")}
        </WidgetTitle>
        <span className="mt-1 block min-h-32">
        {stats.data && series ? (
          <>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="type-title tabular-nums">
                {t("n.mails", { n: fmtNum(stats.data.mails) })}
              </span>
              <span className="type-meta text-muted">
                {t("tab.per_month", { n: fmtNum(perMonth) })}
              </span>
            </span>
            <MiniBars className="mt-3 gap-1" sizeClass="h-16 w-full" barClass="rounded-t-badge"
              values={series.counts}
              dimLast={series.running}
              label={series.keys.map((k, i) =>
                `${monthName(k)} ${series.counts[i]}`).join(", ")} />
            <span aria-hidden className="mt-1 flex justify-between
              type-caption text-muted">
              <span>{monthName(series.keys[0])}</span>
              <span>{monthName(series.keys[6])}</span>
              <span>{monthName(series.keys[11])}</span>
            </span>
          </>
        ) : stats.failed || (stats.data && !series) ? (
          <span className="block type-meta text-muted">
            {t("tab.open_details")}
          </span>
        ) : <Skeleton className="h-32" />}
        </span>
      </button>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={!done} onClick={() => onOpen("space")}
          className={CARD_BTN}>
          <WidgetTitle icon={<LayoutGrid size={16} />}>
            {t("space.title")}
          </WidgetTitle>
          <span className="mt-2 block min-h-32">
          {space ? (
            <>
              <span aria-hidden className="relative block h-24">
                {/* the Space map page's engagement tones, same colours */}
                {space.rects.map((r, i) => (
                  <span key={r.key} className={`absolute rounded-badge
                    border border-panel ${TONE_BAR[space.tones[i]]}`}
                    style={{ left: `${r.x / 2.4}%`, top: `${r.y}%`,
                      width: `${r.w / 2.4}%`, height: `${r.h}%` }} />
                ))}
              </span>
              <span className="mt-2 block type-meta text-muted">
                {t("tab.space_share", { n: space.top.length,
                  pct: fmtPct(space.pct) })}
              </span>
            </>
          ) : state ? (
            <span className="block type-meta text-muted">
              {t(done ? "tab.space_empty" : "tab.space_scan")}
            </span>
          ) : <Skeleton className="h-24" />}
          </span>
        </button>

        <button type="button" onClick={() => onOpen("trackers")}
          className={CARD_BTN}>
          <WidgetTitle icon={<Eye size={16} />}>
            {t("tracker.menu")}
          </WidgetTitle>
          <span className="mt-2 block min-h-32">
          {trackerPct != null && rep ? (
            <>
              <span className="flex items-center gap-2">
                <Ring frac={trackerPct / 100} px={64}
                  label={t("tab.trackers_ring", { pct: fmtPct(trackerPct) })}>
                  <b className="type-meta font-semibold">{fmtPct(trackerPct)}</b>
                </Ring>
                <span className="min-w-0 type-meta text-muted">
                  {t("tab.trackers_of")}
                </span>
              </span>
              <span className="mt-2 block type-meta">
                {t("tab.trackers_senders", { n: rep.senders })}
              </span>
            </>
          ) : trk.failed || rep ? (
            <>
              <span className="block type-body font-semibold
                text-accent">{t("tab.check")}</span>
              <span className="mt-1 block type-meta text-muted">
                {t("tab.trackers_sub")}
              </span>
            </>
          ) : <Skeleton className="h-24" />}
          </span>
        </button>
      </div>

      <button type="button" onClick={() => onOpen("wrapped")}
        className="flex w-full items-center gap-3 rounded-card
          bg-linear-to-br from-accent to-attach-fg p-4 text-left
          text-on-accent">
        <span className="min-w-0 flex-1">
          <span className="block type-caption font-semibold uppercase">
            {t("wrapped.menu")}
          </span>
          <span className="block type-title">
            {story
              ? t("tab.year_stories", { year: story.year, n: story.n })
              : t("tab.year_title", { year: nowDate().getFullYear() })}
          </span>
          {/* kept in the DOM so the card keeps its height while loading */}
          <span className="block min-h-5 truncate type-meta">
            {story?.line}
          </span>
        </span>
        <span aria-hidden className="inline-flex size-11 items-center
          justify-center rounded-full bg-on-accent/20">
          <Play size={18} />
        </span>
      </button>

      <section aria-label={t("tab.recent")} className={CARD}>
        <button type="button" onClick={() => onOpen("activity")}
          className="block w-full min-w-0 text-left">
          <WidgetTitle icon={<History size={16} />} chevron>
            {t("tab.recent")}
          </WidgetTitle>
        </button>
        <div className="mt-1 min-h-48">
        {audit.data ? (audit.data.length === 0 ? (
          <p className="mt-1 type-meta text-muted">{t("audit.empty")}</p>
        ) : (
          <ul className="-mx-3 divide-y divide-line">
            {audit.data.map((e, i) => {
              const retry = e.action === "unsubscribe" && onRetryUnsub
                && (e.outcome === "failed" || e.outcome === "error")
                ? retryableGroup(state?.groups.sender, e.label) : null;
              return (
                <TimelineRow key={`${e.ts}-${i}`} e={e} rules={rules}
                  retry={retry && (
                    <Button variant="secondary" size="sm"
                      className="mt-2 coarse:min-h-11" disabled={retrying}
                      onClick={async () => {
                        setRetrying(true);
                        await onRetryUnsub!(retry);
                        setRetrying(false);
                        setAuditTick((n) => n + 1);
                      }}>
                      {t("tab.retry")}
                    </Button>)} />
              );
            })}
          </ul>
        )) : audit.failed ? (
          <p className="mt-1 type-meta text-muted">{t("tab.open_details")}</p>
        ) : <Skeleton className="h-48" />}
        </div>
      </section>
    </div>
  );
}
