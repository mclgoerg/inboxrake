import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cleanedWeeks, entriesSince, WEEK_S } from "../activity";
import { api } from "../api";
import { nowMs } from "../clock";
import { t } from "../i18n";
import { fmtSize } from "../lib";
import { biggestSenders, loadVisit, saveVisit, storageSegments, totalsOf,
  trendOf, visitSince } from "../overview";
import { computeQuickWins, isDismissed, loadDismissed, saveDismissed,
  unionTotals, type Dismissed, type QuickWinCard } from "../quickwins";
import type { AuditEntry, Group, OverviewResp, Rule } from "../types";
import { BalanceCard, KindsCard, LastWeekCard, NextSteps, type WeekRange }
  from "./OverviewCards";
import { Avatar, Button, EmptyState, hueFillAt, HUE_COUNT, hueIndex,
  ProgressBar, Spinner } from "./ui";

/** What the page shows: the figures, or the guidance of a mailbox that has
 *  none yet (replaces the old first-run card on the Senders page). */
export type OverviewPhase = "data" | "setup" | "unverified" | "ready"
  | "scanning";

export interface OverviewProps {
  phase: OverviewPhase;
  /** The Sender groups of the whole mailbox (not the current grouping). */
  groups: Group[];
  account: string;
  /** Account name · address in the hero card. */
  accountLine: string;
  /** The account name asked to be finished (unverified state). */
  unverifiedName: string;
  progress: { done: number; total: number } | null;
  progressLabel: string;
  canScan: boolean;
  /** Setup is not available in the demo: the reason as a hint. */
  setupHint?: string;
  /** Changes when a scan or an action changed the mailbox: the numbers are
   *  fetched again (at most every REFETCH_MS). */
  rev: number;
  /** The last finished scan: the numbers are fetched again at once. */
  scannedTs: number | null;
  /** The account's rules (a mark-as-read rule is not cleaning). */
  rules: Rule[];
  /** Mails in Junk now; unknown / not scanned = null or undefined. */
  junk: number | null | undefined;
  onSetup: () => void;
  onVerify: () => void;
  onTest: () => void;
  onScan: () => void;
  onReview: (c: QuickWinCard) => void;
  /** Review of the checked next steps: the union of their senders. */
  onReviewMany: (cs: QuickWinCard[]) => void;
  onCleanUp: (c: QuickWinCard) => void;
  /** Open one sender's detail on the Senders page. */
  onOpenSender: (g: Group) => void;
  /** The "Last week" rows open the list their count came from; `window` is
   *  the `in:` term value of the view's time range ("7d", "90min"). */
  onOpenAllMail: (window: string) => void;
  onOpenNewSenders: (window: string) => void;
  onOpenStillMailing: (window: string) => void;
  onOpenJunk: () => void;
  /** New AI verdicts: Senders, the ones the AI called safe, in the window. */
  onOpenAiVerdicts: (window: string) => void;
}

function Section({ title, action, children }: {
  title: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="type-title2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** First-run guidance in place of the figures (setup not done / sign-in
 *  unconfirmed / nothing scanned yet / the first scan running). */
function Guidance({ p }: { p: OverviewProps }) {
  if (p.phase === "scanning") {
    return (
      <div className="mx-auto my-10 max-w-md rounded-card bg-panel p-5
        type-body">
        <div className="mb-3 flex items-center gap-2 type-heading">
          <Spinner /> {t("onboard.scanning")}
        </div>
        <ProgressBar label={p.progressLabel || t("onboard.scanning")}
          value={p.progress?.done ?? 0} max={p.progress?.total ?? 0}
          indeterminate={!p.progress} />
        <p className="mt-3 text-muted">{t("onboard.scanning_text")}</p>
      </div>
    );
  }
  const setup = p.phase === "setup";
  const unverified = p.phase === "unverified";
  return (
    <div className="mx-auto my-10 max-w-md rounded-card bg-panel p-5
      type-body">
      <div className="mb-3 break-words type-heading">
        {setup ? t("wizard.setup_btn")
          : unverified ? t("onboard.unverified", { account: p.unverifiedName })
          : t("onboard.ready")}
      </div>
      <p className="text-muted">
        {setup ? t("wizard.setup_text")
          : unverified ? t("onboard.unverified_text")
          : t("onboard.step_scan")}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {setup ? (
          <Button disabled={!!p.setupHint} title={p.setupHint}
            onClick={p.onSetup}>{t("wizard.setup_btn")}</Button>
        ) : unverified ? (
          <Button onClick={p.onVerify}>{t("onboard.unverified_btn")}</Button>
        ) : (<>
          {p.canScan && (
            <Button variant="secondary" onClick={p.onTest}>
              {t("onboard.test")}</Button>
          )}
          <Button onClick={p.onScan} disabled={!p.canScan}>
            {t("Scan")}</Button>
        </>)}
      </div>
    </div>
  );
}

/** Min. time between two refetches caused by `rev` bumps alone (every bump
 *  repeats a locked pass over the index on the server). */
export const REFETCH_MS = 30_000;

/** The counts behind the cards (`/api/overview`) and the mails cleaned per
 *  week (the audit log). Fetched at once on mount, on an account switch, a
 *  finished scan and "Retry"; other `rev` bumps (deleting, undo, a running
 *  scan's ticks) refetch at most every REFETCH_MS, the last one still
 *  arriving. A failed fetch leaves the old numbers in place and shows
 *  "Retry" while there are none. `cleanedFloor`: epoch s before which the
 *  audit log was not read (null = all of it). */
function useOverviewData(account: string, rev: number,
    scannedTs: number | null, rules: Rule[], since: number | null,
    on: boolean) {
  const [data, setData] = useState<OverviewResp | null>(null);
  const [audit, setAudit] = useState<{ entries: AuditEntry[];
    floor: number | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const last = useRef(0);          // when the numbers were last asked for
  const ask = useRef(0);           // the newest request: older ones are dropped
  useEffect(() => { setData(null); setAudit(null); }, [account]);
  const load = useCallback(() => {
    const me = ++ask.current;
    last.current = Date.now();
    setFailed(false);
    Promise.resolve()
      .then(() => api.overview(
        since === null ? null : Math.floor(since / 1000)))
      .then((d) => me === ask.current && setData(d))
      .catch(() => me === ask.current && setFailed(true));
    const from = nowMs() / 1000 - 8 * WEEK_S;
    Promise.resolve()
      .then(() => entriesSince((o, l) => api.audit(o, l), from))
      .then((r) => me === ask.current && setAudit({ entries: r.entries,
        floor: r.complete || !r.entries.length ? null
          : r.entries[r.entries.length - 1].ts }))
      .catch(() => { /* the chart then shows only what arrived */ });
  }, [since]);
  // at once
  useEffect(() => {
    if (on) load();
    return () => { ask.current++; };
  }, [account, since, on, scannedTs, tries, load]);
  // `rev` bumps: throttled, trailing
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!on) return;
    const wait = Math.max(0, last.current + REFETCH_MS - Date.now());
    if (wait === 0) { load(); return; }
    const h = setTimeout(load, wait);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);
  const cleaned = useMemo(() => data && audit
    ? cleanedWeeks(audit.entries, data.now, rules, data.weeks.length) : null,
  [data, audit, rules]);
  return { data, cleaned, cleanedFloor: audit?.floor ?? null, failed,
    retry: () => setTries((n) => n + 1) };
}

/** The moment of the previous visit of `account` (ms; null = none yet).
 *  Leaving the Overview - or the page - records the visit. */
function usePreviousVisit(account: string): number | null {
  const [since, setSince] = useState<number | null>(
    () => visitSince(loadVisit(account), nowMs()));
  useEffect(() => {
    const s = visitSince(loadVisit(account), nowMs());
    setSince(s);
    const leave = () => saveVisit(account, { since: s, left: nowMs() });
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [account]);
  return since;
}

/** The start page: the balance of the last 8 weeks, what is new, the next
 *  steps, what fills the inbox, and who holds the space. Read-only apart
 *  from opening other pages and the "Not now" dismissals. */
export function Overview(p: OverviewProps) {
  const { groups, account } = p;
  const [dismissed, setDismissed] = useState<Dismissed>(
    () => loadDismissed(account));
  useEffect(() => setDismissed(loadDismissed(account)), [account]);
  const [range, setRange] = useState<WeekRange>("week");
  const since = usePreviousVisit(account);
  const { data, cleaned, cleanedFloor, failed, retry } = useOverviewData(
    account, p.rev, p.scannedTs, p.rules, since,
    p.phase === "data" && groups.length > 0);
  const totals = useMemo(() => totalsOf(groups), [groups]);
  const trend = useMemo(
    () => trendOf(data?.trend ?? null, totals.size, nowMs()),
    [data, totals.size]);
  const segments = useMemo(
    () => storageSegments(groups, t("overview.everyone_else"), 4, hueIndex,
      HUE_COUNT), [groups]);
  const top = useMemo(() => biggestSenders(groups, 5), [groups]);
  const cards = useMemo(
    () => computeQuickWins(groups)
      .filter((c) => !isDismissed(dismissed, c.def.id, c.mails)),
    [groups, dismissed]);

  if (p.phase !== "data") return <Guidance p={p} />;
  if (!groups.length) {
    return <EmptyState>{t("status.no_mails")}</EmptyState>;
  }
  const canGo = unionTotals(cards, groups);
  const dismiss = (c: QuickWinCard) => {
    const next = { ...dismissed, [c.def.id]: c.mails };
    saveDismissed(account, next);
    setDismissed(next);
  };
  const biggest = top[0]?.size || 1;

  return (
    <div className="pb-6">
      {/* From 1280 two columns that stack on their own (so a short card
          leaves no gap under it); below, one column in the order Balance,
          Last week, Next steps, Kinds (the wrappers vanish, `order` sorts). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4
        xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          <BalanceCard accountLine={p.accountLine} size={totals.size}
            mails={totals.mails} senders={totals.senders} trend={trend}
            data={data} cleaned={cleaned} cleanedFloor={cleanedFloor}
            failed={failed} onRetry={retry} />
          {cards.length > 0 && (
            <div className="max-xl:order-2">
              <NextSteps cards={cards} canGo={canGo} onDismiss={dismiss}
                onReview={p.onReview} onReviewMany={p.onReviewMany}
                onCleanUp={p.onCleanUp} />
            </div>
          )}
        </div>
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          <div className="max-xl:order-1">
            <LastWeekCard data={data} since={since} range={range}
              onRange={setRange} junk={p.junk} failed={failed}
              onRetry={retry}
              onOpenAllMail={p.onOpenAllMail} onOpenNew={p.onOpenNewSenders}
              onOpenStill={p.onOpenStillMailing} onOpenJunk={p.onOpenJunk}
              onOpenAi={p.onOpenAiVerdicts} />
          </div>
          {cards.length > 0 && (
            <div className="max-xl:order-3">
              <KindsCard data={data} failed={failed} onRetry={retry} />
            </div>
          )}
        </div>
        {/* without Next steps the left column is just the balance: the kinds
            card takes the second row across both columns */}
        {cards.length === 0 && (
          <div className="max-xl:order-3 xl:col-span-2">
            <KindsCard data={data} failed={failed} onRetry={retry} />
          </div>
        )}
      </div>

      <Section title={t("overview.biggest")}>
        <section aria-label={t("overview.storage")}
          className="mb-3 rounded-card bg-panel p-5">
          {/* Decorative: the legend below names every segment. */}
          <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden
            rounded-full">
            {segments.map((s) => (
              <span key={s.key || "rest"} style={{ flexGrow: s.size }}
                className={`min-w-1 ${s.hue != null ? hueFillAt(s.hue) : "bg-faint"}`} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 type-meta">
            {segments.map((s) => {
              const inner = (<>
                <span aria-hidden className={`size-2 shrink-0 rounded-full
                  ${s.hue != null ? hueFillAt(s.hue) : "bg-faint"}`} />
                <span className="truncate">{s.label}</span>
                <span className="text-muted">{fmtSize(s.size)}</span>
              </>);
              return (
                <li key={s.key || "rest"} className="min-w-0">
                  {s.group ? (
                    <button type="button"
                      onClick={() => p.onOpenSender(s.group!)}
                      className="inline-flex max-w-full items-center gap-1.5
                        rounded-control py-1.5 hover:text-accent">{inner}</button>
                  ) : (
                    <span className="inline-flex max-w-full items-center
                      gap-1.5 py-1.5">{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <ul className="rounded-card bg-panel">
          {top.map((g) => (
            <li key={g.key}
              className="relative [&:not(:first-child)]:before:absolute
                [&:not(:first-child)]:before:left-16
                [&:not(:first-child)]:before:right-0
                [&:not(:first-child)]:before:top-0
                [&:not(:first-child)]:before:border-t
                [&:not(:first-child)]:before:border-line">
              <button type="button" onClick={() => p.onOpenSender(g)}
                className="flex min-h-14 w-full items-center gap-3
                  rounded-card py-2 pl-4 pr-3 text-left transition-colors
                  hover:bg-panel2">
                <Avatar name={g.label} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-body font-medium">
                    {g.label}</span>
                  <span className="block type-meta text-muted">
                    {t("n.mails", { n: g.count })}</span>
                </span>
                <span aria-hidden className="hidden h-1.5 w-1/3 shrink-0
                  overflow-hidden rounded-full bg-chip sm:block">
                  <span className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(2, g.size / biggest * 100)}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right type-body
                  tabular-nums">{fmtSize(g.size)}</span>
                <ChevronRight size={16} aria-hidden
                  className="shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
