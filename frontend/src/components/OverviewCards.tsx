import { ChevronRight, Hourglass, Info, Mail, MoreHorizontal, Newspaper, Paperclip,
  ShieldAlert, Sparkles, BellOff, TrendingDown, TrendingUp, TriangleAlert,
  UserPlus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { getLang, t } from "../i18n";
import { fmtNum, fmtPct } from "../numfmt";
import { fmtSize } from "../lib";
import { WEEK_S } from "../activity";
import { categoryHues, categoryName } from "../categories";
import { nowMs } from "../clock";
import { kindShares, type Trend, windowTerm } from "../overview";
import { TOP_CARDS, type QuickWinCard } from "../quickwins";
import type { OverviewResp } from "../types";
import { Button, Checkbox, hueFillAt, IconTile, Menu, MenuItem, Segmented,
  Spinner, tabPanelProps, useMediaQuery, type TagTone } from "./ui";

/* The cards of the Overview besides the biggest senders: the balance of the
 * last 8 weeks, "Last week" / "Since last visit", the next steps and what
 * fills the inbox. Presentational - Overview.tsx owns the data and the
 * actions. */

const CARD = "rounded-card bg-panel p-5 sm:p-6";

/** Card title (+ muted line under it, + something on the right). */
function CardHead({ title, sub, right }: {
  title: string; sub?: ReactNode; right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3
      gap-y-2">
      <div className="min-w-0">
        <h2 className="type-heading">{title}</h2>
        {sub && <p className="type-meta text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Hairline between rows, starting after the icon tile. */
const ROW_LINE = `relative [&:not(:first-child)]:before:absolute
  [&:not(:first-child)]:before:left-14 [&:not(:first-child)]:before:right-0
  [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:border-t
  [&:not(:first-child)]:before:border-line`;

/** Shown while a card's numbers load or failed: one min-height across the
 *  states, so the page does not jump. */
function CardStatus({ failed, onRetry }: {
  failed: boolean; onRetry: () => void;
}) {
  return (
    <div className="flex min-h-24 items-center gap-3 type-meta text-muted">
      {failed ? (<>
        <span>{t("overview.load_failed")}</span>
        <Button variant="quiet" size="sm" onClick={onRetry}>
          {t("tab.retry")}</Button>
      </>) : (<><Spinner /><span>{t("loading…")}</span></>)}
    </div>
  );
}

/* ------------------------------ balance card ----------------------------- */

const TREND_TONE: Record<Trend["dir"], { tone: string; icon: ReactNode }> = {
  less: { tone: "bg-safe-bg text-safe-fg",
    icon: <TrendingDown size={16} aria-hidden /> },
  more: { tone: "bg-review-bg text-review-fg",
    icon: <TrendingUp size={16} aria-hidden /> },
  same: { tone: "bg-chip text-chiptext", icon: null },
};

/** "38 MB less than a month ago" - or the reference's real age in days. */
export function trendText(tr: Trend): string {
  const when = tr.month ? t("overview.trend_month")
    : t("overview.trend_days", { n: tr.days });
  return tr.dir === "same" ? t("overview.trend_same", { when })
    : t(tr.dir === "less" ? "overview.trend_less" : "overview.trend_more",
      { size: fmtSize(tr.bytes), when });
}

/** Days ago the column's 7 days span: "8-14 days ago"; the last column is
 *  "Last 7 days". */
const weekLabel = (i: number, weeks: number): string =>
  i === weeks - 1 ? t("overview.last_7_days")
    : t("overview.days_ago_range",
      { from: (weeks - 1 - i) * 7 + 1, to: (weeks - i) * 7 });

/** First day of the column's 7 days as day + month ("27 Jul", never a year:
 *  the label must fit its column in late December too); the last column is
 *  "this week". */
const weekDate = (i: number, weeks: number, now: number): string =>
  i === weeks - 1 ? t("overview.balance_this_week")
    : new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-GB",
      { day: "numeric", month: "short" })
      .format(new Date((now - (weeks - i) * WEEK_S) * 1000));

/** Height of a bar in percent of its row; a non-zero value keeps a sliver. */
const pct = (v: number, max: number): number =>
  Math.max(3, (100 * v) / Math.max(1, max));

/** Two rows on the same week columns: what arrived on top, what you cleaned
 *  below, each on its own scale (a big cleanup week must not shrink the
 *  arrivals to stubs). Every column is a button whose accessible name is its
 *  `tips[i]` text (colour is never the only signal; the caller also shows the
 *  selected column's text). Estimated arrivals are hatched. Weeks with
 *  nothing get a short faint line, so an empty week reads as a week. The
 *  left labels give each row's total; `cleaned` is null while / if it did not
 *  load (that row then stays empty). Week dates sit under the columns from
 *  640 px; below, one line spells the span out. */
function BalanceChart({ arrived, cleaned, estimated, tips, labels, active,
  onActive, cleanedAtLeast }: {
  arrived: number[]; cleaned: number[] | null; estimated: boolean[];
  tips: string[]; labels: string[]; active: number;
  onActive: (i: number) => void;
  /** Some week's cleaned count is a floor (the audit log was cut short). */
  cleanedAtLeast: boolean;
}) {
  const maxA = Math.max(...arrived, 0);
  const maxC = Math.max(...(cleaned ?? []), 0);
  const ROW = "h-11 sm:h-14";   // each row: 44 px on phones, 56 px from 640
  const LAB = "flex flex-col justify-end";
  const CAP = "inline-flex items-center gap-1.5 whitespace-nowrap type-caption text-muted";
  const total = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const any = estimated.some(Boolean);
  return (
    <div>
      <div className="flex gap-3">
        <div className="flex w-24 shrink-0 flex-col gap-1.5">
          <div className={`${LAB} ${ROW}`}>
            <b className="type-heading tabular-nums">
              {any ? "~" : ""}{fmtNum(total(arrived))}</b>
            <span className={CAP}>
              <span aria-hidden className="size-2 rounded-full bg-accent" />
              {t("overview.balance_arrived")}
            </span>
          </div>
          <div className={`${LAB} ${ROW}`}>
            <b className="type-heading tabular-nums">
              {cleaned ? `${cleanedAtLeast ? "≥ " : ""}${fmtNum(total(cleaned))}`
                : "–"}</b>
            <span className={CAP}>
              <span aria-hidden className="size-2 rounded-full bg-safe-fg" />
              {t("overview.balance_cleaned")}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid grid-flow-col auto-cols-fr gap-1.5">
            {tips.map((tip, i) => {
              const a = arrived[i] ?? 0;
              const c = cleaned?.[i];
              const dim = i === active ? "" : "opacity-80";
              const zero = "mt-1 h-0.5 w-3/5 max-w-6 rounded-full bg-faint opacity-50";
              return (
                <button key={i} type="button" aria-label={tip}
                  aria-pressed={i === active}
                  onMouseEnter={() => onActive(i)} onFocus={() => onActive(i)}
                  onClick={() => onActive(i)}
                  className={`flex min-w-0 cursor-pointer flex-col gap-1.5
                    rounded-control px-1 outline-offset-0 transition-colors
                    ${i === active ? "bg-accent-tint" : ""}`}>
                  <span className={`flex items-end justify-center ${ROW}`}>
                    {a > 0 ? (
                      <span className={`w-full max-w-10 rounded-t-badge ${dim}
                        ${estimated[i] ? "bar-estimate" : "bg-accent"}`}
                        style={{ height: `${pct(a, maxA)}%` }} />
                    ) : <span className={`${zero} self-end`} />}
                  </span>
                  <span className={`flex items-start justify-center border-t
                    border-line ${ROW}`}>
                    {c === undefined ? null : c > 0 ? (
                      <span className={`w-full max-w-10 rounded-b-badge
                        bg-safe-fg ${dim}`}
                        style={{ height: `${pct(c, maxC)}%` }} />
                    ) : <span className={zero} />}
                  </span>
                  {/* the last label ("diese Woche") may wrap: it is longer
                      than its column in German */}
                  <span aria-hidden className={`hidden min-h-5 text-center
                    type-caption sm:block ${i === tips.length - 1
                    ? "" : "whitespace-nowrap"} ${i === active
                    ? "font-semibold text-accent" : "text-muted"}`}>
                    {labels[i]}</span>
                </button>
              );
            })}
          </div>
          <div aria-hidden className="mt-1.5 flex justify-between type-caption
            text-muted sm:hidden">
            <span>{t("overview.balance_from", { n: tips.length })}</span>
            <span>{t("overview.balance_this_week")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The main card: size, mails, senders, the trend against a month back and
 *  the 8-week balance (mails that arrived vs mails you cleaned). */
export function BalanceCard({ accountLine, size, mails, senders, trend,
  data, cleaned, cleanedFloor, failed, onRetry }: {
  accountLine: string; size: number; mails: number; senders: number;
  trend: Trend | null; data: OverviewResp | null;
  /** Mails cleaned per week (oldest first); null while / if not loaded. */
  cleaned: number[] | null;
  /** Epoch s before which the audit log was not read (its page cap cut the
   *  history short): older weeks then say "at least". Null = all read. */
  cleanedFloor: number | null;
  failed: boolean; onRetry: () => void;
}) {
  const weeks = data?.weeks ?? [];
  const est = data?.weeks_estimated ?? [];
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked ?? weeks.length - 1;
  const tips = weeks.map((a, i) => {
    const c = cleaned?.[i];
    const range = weekLabel(i, weeks.length);
    const kept = data?.weeks_in_mailbox?.[i] ?? a;
    const arrived = est[i] ? t("overview.balance_est", { n: a }) : a;
    // counted at the scans: some may be cleaned or moved since
    const gone = !est[i] && a > kept
      ? t("overview.balance_gone", { n: a - kept }) : "";
    const partial = cleanedFloor !== null && data
      && data.now - (weeks.length - i) * WEEK_S < cleanedFloor;
    return c === undefined
      ? t("overview.balance_tip_arrived", { range, arrived, gone })
      : t("overview.balance_tip", { range, arrived, gone,
        cleaned: partial ? t("activity.at_least", { n: c }) : c });
  });
  const floored = cleanedFloor !== null && !!data && weeks.some((_, i) =>
    data.now - (weeks.length - i) * WEEK_S < cleanedFloor);
  const tr = trend && TREND_TONE[trend.dir];
  return (
    <section aria-label={t("overview.balance")} className={CARD}>
      <div className="type-meta font-medium text-muted">{accountLine}</div>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4
        gap-y-2">
        <div>
          <div className="type-hero tabular-nums">{fmtSize(size)}</div>
          <div className="type-body text-muted">
            {t("overview.summary", { mails: t("n.mails", { n: mails }),
              n: senders })}
          </div>
        </div>
        {trend && tr && (
          <span data-testid="ov-trend" className={`mb-1 inline-flex
            items-center gap-1.5 rounded-full px-3 py-1 type-body font-medium
            ${tr.tone}`}>
            {tr.icon}{trendText(trend)}
          </span>
        )}
      </div>
      <div className="mt-5">
        {!data ? <CardStatus failed={failed} onRetry={onRetry} /> : (<>
          <div className="mb-3 flex flex-wrap items-center justify-between
            gap-x-3 gap-y-2">
            <h3 className="type-body font-semibold">
              {t("overview.balance_title", { n: weeks.length })}</h3>
            <div className="min-h-5 type-meta text-muted" aria-live="polite">
              <span className="rounded-full bg-chip px-2 py-0.5 text-body">
                {tips[active]}</span>
            </div>
          </div>
          <BalanceChart arrived={weeks} cleaned={cleaned} estimated={est}
            tips={tips} active={active} onActive={setPicked}
            labels={weeks.map((_, i) => weekDate(i, weeks.length, data.now))}
            cleanedAtLeast={floored} />
          {est.some(Boolean) && (
            <p className="mt-3 flex items-center gap-1.5 type-meta text-muted">
              <Info size={14} aria-hidden className="shrink-0" />
              {t("overview.balance_note")}</p>
          )}
        </>)}
      </div>
    </section>
  );
}

/* ----------------------------- last week card ---------------------------- */

/** One row of a list card: icon tile, two lines, chevron; the whole row
 *  is a button. */
function OverviewRow({ icon, tone, title, sub, onClick, testId }: {
  icon: ReactNode; tone: TagTone; title: string; sub?: string;
  /** Without it the row is plain text (nothing to open). */
  onClick?: () => void; testId?: string;
}) {
  const inner = (<>
    <span className="shrink-0"><IconTile tone={tone}>{icon}</IconTile></span>
    <span className="min-w-0 flex-1">
      <span className="block type-body font-medium">{title}</span>
      {sub && <span className="block type-meta text-muted">{sub}</span>}
    </span>
  </>);
  return (
    <li data-testid={testId} className={ROW_LINE}>
      {onClick ? (
        <button type="button" onClick={onClick}
          className="flex min-h-14 w-full items-center gap-3 rounded-card py-2
            pl-1 pr-1 text-left transition-colors hover:bg-panel2">
          {inner}
          <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
        </button>
      ) : (
        <div className="flex min-h-14 w-full items-center gap-3 py-2 pl-1
          pr-1">{inner}</div>
      )}
    </li>
  );
}

export type WeekRange = "week" | "since";

/** The numbers of a window as rows; a row whose count is 0 is left out. */
export function LastWeekCard({ data, since, range, onRange, junk, failed,
  onRetry, onOpenAllMail, onOpenNew, onOpenStill, onOpenJunk, onOpenAi }: {
  data: OverviewResp | null;
  /** Start of the previous visit (ms); null = there is none yet. */
  since: number | null;
  range: WeekRange;
  onRange: (r: WeekRange) => void;
  /** Mails in Junk now (not a window: the same in both views). */
  junk: number | null | undefined;
  failed: boolean;
  onRetry: () => void;
  /** Each row opens the list its count came from, over the same window:
   *  the `in:` term value ("7d", "90min") is handed over. */
  onOpenAllMail: (window: string) => void;
  onOpenNew: (window: string) => void;
  onOpenStill: (window: string) => void;
  onOpenJunk: () => void;
  onOpenAi: (window: string) => void;
}) {
  const showSince = since !== null;
  const mode: WeekRange = showSince ? range : "week";
  const w = mode === "since" ? data?.since ?? null : data?.week ?? null;
  const when = t(mode === "since" ? "overview.when_since"
    : "overview.when_week");
  const win = () => windowTerm(mode, since, nowMs());
  const rows: ReactNode[] = [];
  if (w) {
    if (w.mails > 0) {
      const from = t("overview.from_senders", { n: w.senders });
      rows.push(
        <OverviewRow key="mails" testId="ov-row-mails"
          icon={<Mail size={16} />} tone="info"
          title={t("overview.row_mails", { n: w.mails })}
          sub={w.newsletters > 0
            ? `${from} · ${t("n.newsletters", { n: w.newsletters })}` : from}
          onClick={() => onOpenAllMail(win())} />);
    }
    if (w.new_senders > 0) {
      rows.push(
        <OverviewRow key="new" testId="ov-row-new"
          icon={<UserPlus size={16} />} tone="new"
          title={t("overview.row_new_senders", { n: w.new_senders })}
          sub={t("overview.first_seen", { when })}
          onClick={() => onOpenNew(win())} />);
    }
    if (w.still_mailing > 0) {
      rows.push(
        <OverviewRow key="still" testId="ov-row-still"
          icon={<TriangleAlert size={16} />} tone="review"
          title={t("overview.row_still", { n: w.still_mailing })}
          sub={t("overview.row_still_sub")}
          onClick={() => onOpenStill(win())} />);
    }
  }
  if (junk && junk > 0) {
    rows.push(
      <OverviewRow key="junk" testId="ov-row-junk"
        icon={<ShieldAlert size={16} />} tone="keep"
        title={t("overview.row_junk", { n: junk })}
        sub={t("overview.row_junk_sub")} onClick={onOpenJunk} />);
  }
  if (w && w.verdicts > 0) {
    rows.push(
      <OverviewRow key="ai" testId="ov-row-ai"
        icon={<Sparkles size={16} />} tone="attach"
        title={t("overview.row_verdicts", { n: w.verdicts })}
        sub={w.verdicts_safe > 0
          ? t("overview.verdicts_safe", { n: w.verdicts_safe })
          : t("overview.verdicts_none_safe")}
        // the list is the safe ones: with none there is nothing to open
        onClick={w.verdicts_safe > 0 ? () => onOpenAi(win()) : undefined} />);
  }
  const title = t("overview.week_title");
  return (
    <section aria-label={title} className={CARD}>
      <CardHead title={title}
        right={showSince && (
          <Segmented value={mode} onChange={onRange} idPrefix="ov-week"
            label={t("overview.week_range")}
            options={[{ value: "week", label: t("overview.week_tab") },
              { value: "since", label: t("overview.since_tab") }]} />
        )}
        sub={mode === "since" && since !== null
          ? t("overview.since_date", { date: sinceDate(since) }) : undefined} />
      <div {...tabPanelProps("ov-week", mode)}>
        {!data ? <CardStatus failed={failed} onRetry={onRetry} />
          : rows.length > 0 ? <ul>{rows}</ul>
          : <p className="flex min-h-24 items-center type-body text-muted">
              {t("overview.week_empty", { when })}</p>}
      </div>
    </section>
  );
}

/** "12 Oct, 14:30" in the UI language. */
const sinceDate = (ms: number): string =>
  new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-US",
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    .format(new Date(ms));

/* ------------------------------- next steps ------------------------------ */

// Icon tile per suggestion: a fitting icon in a semantic tone.
const CARD_TILE: Record<string, { icon: ReactNode; tone: TagTone }> = {
  old_newsletters: { icon: <Newspaper size={16} />, tone: "review" },
  quiet_low: { icon: <Hourglass size={16} />, tone: "info" },
  unsubscribed: { icon: <BellOff size={16} />, tone: "new" },
  big_attachments: { icon: <Paperclip size={16} />, tone: "attach" },
  ai_safe: { icon: <Sparkles size={16} />, tone: "safe" },
};

/** Today's suggestions as a checklist. Review (one row) / Review N (the
 *  checked rows) open Senders, Clean up goes through the caller's normal
 *  confirm, the cross hides a row until it grows - nothing here touches the
 *  mailbox itself. */
export function NextSteps({ cards, canGo, onDismiss, onReview, onReviewMany,
  onCleanUp }: {
  cards: QuickWinCard[];
  /** Mails + size the union of all cards could free. */
  canGo: { mails: number; size: number };
  onDismiss: (c: QuickWinCard) => void;
  onReview: (c: QuickWinCard) => void;
  onReviewMany: (cs: QuickWinCard[]) => void;
  onCleanUp: (c: QuickWinCard) => void;
}) {
  const [all, setAll] = useState(false);
  // ids the user switched OFF (everything is checked until then, so a card
  // that appears after a scan joins the selection)
  const [off, setOff] = useState<Set<string>>(new Set());
  const phone = useMediaQuery("(max-width: 767px)");
  const shown = all ? cards : cards.slice(0, TOP_CARDS);
  const checked = shown.filter((c) => !off.has(c.def.id));
  const toggle = (id: string) => setOff((s) => {
    const n = new Set(s);
    if (!n.delete(id)) n.add(id);
    return n;
  });
  const title = t("overview.next");
  return (
    <section aria-label={title} className={CARD}>
      <CardHead title={title}
        sub={`${t("overview.can_go", { size: fmtSize(canGo.size) })} · ${
          t("overview.next_hint")}`}
        right={(
          <Button variant="tinted" disabled={!checked.length}
            onClick={() => onReviewMany(checked)}>
            {t("overview.review_n", { n: checked.length })}</Button>
        )} />
      <ul>
        {shown.map((c) => {
          const tile = CARD_TILE[c.def.id];
          const name = t(c.def.titleKey);
          const meta = (
            <>
              {t("qw.card_meta", { mails: c.mails, size: fmtSize(c.size) })}
              {c.protectedSkipped > 0 && (
                <span> · {t("qw.protected_skipped",
                  { n: c.protectedSkipped })}</span>
              )}
            </>
          );
          const checkbox = (
            <Checkbox round checked={!off.has(c.def.id)}
              onChange={() => toggle(c.def.id)}
              aria-label={t("overview.check_step", { title: name })} />
          );
          const tileEl = tile && (
            <span className="shrink-0">
              <IconTile tone={tile.tone}>{tile.icon}</IconTile></span>
          );
          return phone ? (
            /* Phones: the row is Review; Clean up and Not now sit in the
               row's More menu. */
            <li key={c.def.id} data-testid="qw-card"
              className={`${ROW_LINE} flex items-center`}>
              {checkbox}
              <button type="button" onClick={() => onReview(c)}
                aria-label={`${t("qw.review")}: ${name}`}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3
                  rounded-card py-2 pl-1 text-left transition-colors
                  hover:bg-panel2">
                {tileEl}
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-body font-medium">
                    {name}</span>
                  <span className="block type-meta text-muted">{meta}</span>
                </span>
              </button>
              <Menu variant="quiet" icon label={t("menu.more")}
                className="shrink-0" triggerClass="coarse:size-11"
                trigger={<MoreHorizontal size={18} aria-hidden />}>
                <MenuItem onClick={() => onCleanUp(c)}>
                  {t("qw.clean_up")}</MenuItem>
                <MenuItem onClick={() => onDismiss(c)}>
                  {t("qw.not_now")}</MenuItem>
              </Menu>
              <ChevronRight size={16} aria-hidden
                className="mr-1 shrink-0 text-faint" />
            </li>
          ) : (
            <li key={c.def.id} data-testid="qw-card"
              className={`${ROW_LINE} flex items-center gap-3 py-2`}>
              {checkbox}
              {tileEl}
              <div className="min-w-0 flex-1">
                <div className="type-body font-medium">{name}</div>
                <div className="type-meta text-muted">{meta} ·{" "}
                  <span data-testid="qw-hint">{t(c.def.hintKey)}</span></div>
              </div>
              <Button variant="tinted" size="sm" className="shrink-0"
                onClick={() => onReview(c)}>{t("qw.review")}</Button>
              <Button variant="quiet" size="sm" className="shrink-0"
                onClick={() => onCleanUp(c)}>{t("qw.clean_up")}</Button>
              <Button variant="quiet" size="icon" label={t("qw.not_now")}
                className="shrink-0 text-muted" onClick={() => onDismiss(c)}>
                <X size={16} />
              </Button>
            </li>
          );
        })}
      </ul>
      {cards.length > TOP_CARDS && (
        <div className="mt-2 flex justify-center">
          <Button variant="quiet" size="sm" onClick={() => setAll(!all)}>
            {all ? t("qw.less") : t("overview.show_all", { n: cards.length })}
          </Button>
        </div>
      )}
    </section>
  );
}

/* ------------------------- what fills your inbox ------------------------- */

/** The last 30 days by kind of sender as a stacked bar + legend with shares. */
export function KindsCard({ data, failed, onRetry }: {
  data: OverviewResp | null; failed: boolean; onRetry: () => void;
}) {
  const title = t("overview.kinds");
  const shares = data ? kindShares(data.kinds.items) : [];
  const hues = categoryHues(shares.map((s) => s.kind));
  return (
    <section aria-label={title} className={CARD}>
      <CardHead title={title}
        sub={t("overview.kinds_sub", { n: data?.kinds.days ?? 30 })} />
      {!data ? <CardStatus failed={failed} onRetry={onRetry} />
        : !shares.length ? (
          <p className="flex min-h-24 items-center type-body text-muted">
            {t("overview.kinds_empty", { n: data.kinds.days })}</p>
        ) : (<>
          {/* Decorative: the legend names every share. */}
          <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden
            rounded-full">
            {shares.map((s, i) => (
              <span key={s.kind} style={{ flexGrow: s.count }}
                className={`min-w-1 ${s.rest ? "bg-faint" : hueFillAt(hues[i])}`} />
            ))}
          </div>
          <ul className="mt-3">
            {shares.map((s, i) => (
              <li key={s.kind} className="flex items-center gap-2 py-1.5
                type-body">
                <span aria-hidden className={`size-2 shrink-0 rounded-full
                  ${s.rest ? "bg-faint" : hueFillAt(hues[i])}`} />
                <span className="min-w-0 flex-1 truncate">
                  {categoryName(s.kind)}</span>
                <span className="text-muted tabular-nums">
                  {fmtPct(s.pct)}</span>
              </li>
            ))}
          </ul>
        </>)}
    </section>
  );
}
