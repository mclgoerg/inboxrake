import { BellOff, ChevronRight, Hourglass, Newspaper, Paperclip, Sparkles,
  X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { fmtSize } from "../lib";
import { biggestSenders, storageSegments, totalsOf } from "../overview";
import { computeQuickWins, isDismissed, loadDismissed, saveDismissed,
  TOP_CARDS, unionTotals, type Dismissed, type QuickWinCard }
  from "../quickwins";
import type { Group } from "../types";
import { Avatar, Button, EmptyState, hueFill, ProgressBar, Spinner }
  from "./ui";

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
  onSetup: () => void;
  onVerify: () => void;
  onTest: () => void;
  onScan: () => void;
  onReview: (c: QuickWinCard) => void;
  onCleanUp: (c: QuickWinCard) => void;
  /** Open one sender's detail on the Senders page. */
  onOpenSender: (g: Group) => void;
}

// Icon tile per suggestion: a fitting icon in a semantic tone.
const CARD_TILE: Record<string, { icon: ReactNode; tone: string }> = {
  old_newsletters: { icon: <Newspaper size={18} aria-hidden />,
    tone: "bg-review-bg text-review-fg" },
  quiet_low: { icon: <Hourglass size={18} aria-hidden />,
    tone: "bg-info-bg text-info-fg" },
  unsubscribed: { icon: <BellOff size={18} aria-hidden />,
    tone: "bg-new-bg text-new-fg" },
  big_attachments: { icon: <Paperclip size={18} aria-hidden />,
    tone: "bg-attach-bg text-attach-fg" },
  ai_safe: { icon: <Sparkles size={18} aria-hidden />,
    tone: "bg-safe-bg text-safe-fg" },
};

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

/** Suggestions: today's Quick wins as cards. Review shows the list, Clean
 *  up goes through the caller's normal confirm - nothing here touches the
 *  mailbox itself. */
function Suggestions({ cards, onDismiss, onReview, onCleanUp }: {
  cards: QuickWinCard[];
  onDismiss: (c: QuickWinCard) => void;
  onReview: (c: QuickWinCard) => void;
  onCleanUp: (c: QuickWinCard) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, TOP_CARDS);
  return (
    <Section title={t("overview.suggestions")}
      action={cards.length > TOP_CARDS && (
        <Button variant="quiet" size="sm" onClick={() => setAll(!all)}>
          {all ? t("qw.less") : t("overview.show_all", { n: cards.length })}
        </Button>
      )}>
      <ul className="grid gap-3 md:grid-cols-3">
        {shown.map((c) => {
          const tile = CARD_TILE[c.def.id];
          return (
            <li key={c.def.id} data-testid="qw-card"
              className="flex flex-col gap-3 rounded-card bg-panel p-4">
              <div className="flex items-start justify-between gap-2">
                <span className={`inline-flex size-10 items-center
                  justify-center rounded-control ${tile?.tone ?? "bg-chip"}`}>
                  {tile?.icon}
                </span>
                <Button variant="quiet" size="icon" label={t("qw.not_now")}
                  className="-mr-2 -mt-2 text-muted"
                  onClick={() => onDismiss(c)}>
                  <X size={16} />
                </Button>
              </div>
              <div>
                <div className="type-heading">{t(c.def.titleKey)}</div>
                <div className="type-body">
                  {t("qw.card_meta", { mails: c.mails,
                    size: fmtSize(c.size) })}
                  {c.protectedSkipped > 0 && (
                    <span className="text-muted"> · {t("qw.protected_skipped",
                      { n: c.protectedSkipped })}</span>
                  )}
                </div>
                <div data-testid="qw-hint" className="mt-1 type-meta
                  text-muted">{t(c.def.hintKey)}</div>
              </div>
              <div className="mt-auto flex items-center gap-2 pt-1">
                <Button variant="tinted" size="sm"
                  onClick={() => onReview(c)}>{t("qw.review")}</Button>
                <Button variant="quiet" size="sm"
                  onClick={() => onCleanUp(c)}>{t("qw.clean_up")}</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
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

/** The start page: how much space the mailbox takes, who holds it, and the
 *  ready-made cleanups. Read-only apart from opening Senders. */
export function Overview(p: OverviewProps) {
  const { groups, account } = p;
  const [dismissed, setDismissed] = useState<Dismissed>(
    () => loadDismissed(account));
  useEffect(() => setDismissed(loadDismissed(account)), [account]);
  const totals = useMemo(() => totalsOf(groups), [groups]);
  const segments = useMemo(
    () => storageSegments(groups, t("overview.everyone_else")), [groups]);
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
    <div className="mx-auto max-w-5xl pb-6">
      <section aria-label={t("overview.storage")}
        className="rounded-card bg-panel p-5 sm:p-6">
        <div className="type-meta font-medium text-muted">{p.accountLine}</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4
          gap-y-2">
          <div>
            <div className="type-hero tabular-nums">{fmtSize(totals.size)}</div>
            <div className="type-body text-muted">
              {t("overview.summary", { mails: t("n.mails", { n: totals.mails }),
                senders: t("n.senders", { n: totals.senders }) })}
            </div>
          </div>
          {canGo.size > 0 && (
            <span className="mb-1 inline-flex items-center gap-1.5
              rounded-full bg-safe-bg px-3 py-1 type-body font-medium
              text-safe-fg">
              <Sparkles size={16} aria-hidden />
              {t("overview.can_go", { size: fmtSize(canGo.size) })}
            </span>
          )}
        </div>
        {/* Decorative: the legend below names every segment. */}
        <div aria-hidden className="mt-5 flex h-2.5 gap-0.5 overflow-hidden
          rounded-full">
          {segments.map((s) => (
            <span key={s.key || "rest"} style={{ flexGrow: s.size }}
              className={`min-w-1 ${s.group ? hueFill(s.label) : "bg-chip"}`} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 type-meta">
          {segments.map((s) => {
            const inner = (<>
              <span aria-hidden className={`size-2 shrink-0 rounded-full
                ${s.group ? hueFill(s.label) : "bg-chip"}`} />
              <span className="truncate">{s.label}</span>
              <span className="text-muted">{fmtSize(s.size)}</span>
            </>);
            return (
              <li key={s.key || "rest"} className="min-w-0">
                {s.group ? (
                  <button type="button" onClick={() => p.onOpenSender(s.group!)}
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

      {cards.length > 0 && (
        <Suggestions cards={cards} onDismiss={dismiss} onReview={p.onReview}
          onCleanUp={p.onCleanUp} />
      )}

      <Section title={t("overview.biggest")}>
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
