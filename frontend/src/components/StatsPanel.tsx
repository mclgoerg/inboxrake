import { BarChart3, Sparkles, TrendingDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, fmtSize } from "../api";
import { nowDate } from "../clock";
import { fmtNum } from "../numfmt";
import { getLang, t } from "../i18n";
import { fmtDate } from "../lib";
import type { StatsResp } from "../types";
import {
  Avatar, Button, Donut, hueFillAt, Loading, MiniBars, Modal, PanelHeader,
  ProgressBar, Ring, Segmented, SectionLabel, Tag, useMediaQuery,
} from "./ui";

const month = () => nowDate().toISOString().slice(0, 7);
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

/** A chart card: panel2 surface, heading + optional hint line. */
function ChartCard({ title, hint, className = "", children }: {
  title: string; hint?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-card bg-panel2 p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h3 className="type-heading">{title}</h3>
        {hint && <span className="type-meta text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** KPI tile: the big figure, its caption, and a mini chart / ring at the
 *  right (decorative - the figure already says it). */
function Kpi({ value, label, extra }: {
  value: ReactNode; label: ReactNode; extra?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3
      rounded-card bg-panel2 p-4">
      <div className="min-w-0">
        <div className="type-title2 tabular-nums">{value}</div>
        <div className="type-meta text-muted">{label}</div>
      </div>
      {extra && <div className="shrink-0">{extra}</div>}
    </div>
  );
}

type Period = "30d" | "12m" | "all";
type Bucket = { key: string; label: string; tip: string; count: number;
  size: number; unread: number };

const localDay = (d: Date) => `${d.getFullYear()}-${
  String(d.getMonth() + 1).padStart(2, "0")}-${
  String(d.getDate()).padStart(2, "0")}`;

/** Donut slices: the biggest categories one each, the rest one "Other"
 *  slice (the palette has six hues). */
const CAT_HEAD = 5;

/** One legend row; `hue` undefined = no dot (a member of "Other"). */
function CatRow({ name, hue, count, bytes, sub = false }: {
  name: string; hue?: number; count: number; bytes: number; sub?: boolean;
}) {
  return (
    <li className={`flex items-center gap-2 ${sub ? "pl-4.5 text-muted" : ""}`}>
      {hue !== undefined && (
        <span aria-hidden="true"
          className={`size-2.5 shrink-0 rounded-full ${hueFillAt(hue)}`} />
      )}
      <span className="min-w-0 flex-1 break-words type-body">{name}</span>
      <span className="whitespace-nowrap text-muted tabular-nums">
        {fmtNum(count)} · {fmtSize(bytes)}</span>
    </li>
  );
}

/** "2026-09" -> short month name in the UI language ("Sep"). */
const monthName = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-US",
    { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
};

/** Column chart: one focusable column per row. The active column (hover,
 *  keyboard focus or tap) is spelled out in the line above the chart, and
 *  every column carries the same text as its accessible name. */
function Columns({ rows, hint, compact = false }: {
  rows: { key: string; label: string; tip: string; count: number }[];
  hint: string;
  /** few, wide columns (years): shorter chart, capped column width */
  compact?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <div className="mb-2 h-5 type-meta text-muted" aria-hidden="true">
        {active !== null
          ? <span className="rounded-full bg-chip px-2 py-0.5 text-body">
              {rows[active].tip}</span>
          : hint}
      </div>
      <div className={`flex items-end ${compact ? "h-32 gap-3" : "h-44 gap-1"}`}
        onMouseLeave={() => setActive(null)}>
        {rows.map((r, i) => (
          <button key={r.key} type="button" aria-label={r.tip}
            onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
            onBlur={() => setActive(null)} onClick={() => setActive(i)}
            className={`group flex h-full min-w-0 flex-1 cursor-pointer
              flex-col justify-end gap-1 rounded-control outline-offset-0
              ${compact ? "max-w-16" : ""}`}>
            <span className="flex min-h-0 flex-1 items-end">
              <span className={`w-full rounded-t-badge transition-colors
                ${active === i ? "bg-accenth" : "bg-accent/70"}`}
                style={{ height: `${Math.max(2, (100 * r.count) / max)}%` }} />
            </span>
            {/* a long series labels every n-th column; the text may spill
                over its neighbours' empty labels */}
            <span className="flex h-4 justify-center">
              <span className="shrink-0 whitespace-nowrap type-caption
                text-muted">{r.label}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Mailbox statistics: KPI tiles, volume charts, categories, top senders
 *  and domains, engagement, AI coverage, cleanup progress and scan history.
 *  `onOpenSender` (top senders are buttons when given) opens a sender. */
export function StatsPanel({ onClose, onWrapped, onOpenSender }: {
  onClose: () => void; onWrapped?: () => void;
  onOpenSender?: (key: string) => void;
}) {
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("12m");

  useEffect(() => {
    let alive = true;
    api.stats()
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);

  const thisMonth = stats?.actions?.[month()];
  const months = Object.keys(stats?.actions ?? {}).sort().reverse();
  const ratedTotal = stats
    ? stats.rated_mails.delete_safe + stats.rated_mails.review
      + stats.rated_mails.keep
    : 0;
  const cats = stats?.categories ?? [];
  const many = cats.length > CAT_HEAD + 1;
  const catHead = many ? cats.slice(0, CAT_HEAD) : cats;
  const catTail = many ? cats.slice(CAT_HEAD) : [];
  const catSlices = [...catHead.map((c) => c.count),
    ...(many ? [catTail.reduce((a, c) => a + c.count, 0)] : [])];
  const coarse = useMediaQuery("(pointer: coarse)");
  const hint = t(coarse ? "stats.tap_hint" : "stats.hover_hint");
  const tagged = stats?.categories.reduce((a, c) => a + c.count, 0) ?? 0;
  // The period switch needs the per-day / full-month series (a backend from
  // before them simply has no switch and keeps the 12-month view).
  const periods = !!stats?.days && !!stats?.months_all;
  const per: Period = periods ? period : "12m";
  const tipOf = (name: string, b: { count: number; size: number }) =>
    t("stats.month_tip", { month: name, mails: t("n.mails", { n: b.count }),
      size: fmtSize(b.size) });
  // a long history is charted per year (the Mails per year card is then
  // the chart itself)
  const yearsChart = per === "all" && (stats?.months_all?.length ?? 0) > 36;
  const buckets: Bucket[] = !stats ? [] : per === "30d"
    ? (() => {
        const byDay = new Map(stats.days?.map((d) => [d.day, d]));
        return Array.from({ length: 30 }, (_, i) => {
          const d = nowDate();
          d.setDate(d.getDate() - (29 - i));
          const k = localDay(d);
          const v = byDay.get(k) ?? { count: 0, size: 0, unread: 0 };
          return { key: k, ...v, tip: tipOf(fmtDate(k, nowDate(), { lang: getLang() }), v),
            label: i % 5 === 4 || i === 0 ? String(d.getDate()) : "" };
        });
      })()
    : per === "all" && yearsChart
    ? stats.years.map((y) => ({ key: y.year, label: y.year, count: y.count,
        size: y.size, unread: 0, tip: tipOf(y.year, y) }))
    : (() => {
        const all = stats.months_all ?? stats.months;
        const byMonth = new Map(all.map((m) => [m.month, m]));
        let rows: { month: string; count: number; size: number;
          unread?: number }[];
        if (per === "12m") {
          // the last 12 CALENDAR months, gaps zero-filled; buckets dated in
          // the future never count
          const now = nowDate();
          rows = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1)
              .padStart(2, "0")}`;
            return byMonth.get(k) ?? { month: k, count: 0, size: 0, unread: 0 };
          });
        } else rows = all;
        // an All-time axis that spans years shows the year on its labels
        const years = per === "all"
          && rows.length > 0 && rows[0].month.slice(0, 4)
            !== rows[rows.length - 1].month.slice(0, 4);
        return rows.map((m) => ({
          key: m.month, count: m.count, size: m.size, unread: m.unread ?? 0,
          label: years ? `${monthName(m.month)} ’${m.month.slice(2, 4)}`
            : monthName(m.month),
          tip: tipOf(`${monthName(m.month)} ${m.month.slice(0, 4)}`, m) }));
      })();
  const step = per === "30d" ? 1 : Math.ceil(buckets.length / 8);
  if (step > 1) buckets.forEach((b, i) => { if (i % step) b.label = ""; });
  // period-based KPIs; without the series they are the all-time figures
  const inPeriod = periods && per !== "all";
  const pMails = inPeriod ? buckets.reduce((a, b) => a + b.count, 0)
    : stats?.mails ?? 0;
  const pSize = inPeriod ? buckets.reduce((a, b) => a + b.size, 0)
    : stats?.size ?? 0;
  const pUnread = inPeriod ? buckets.reduce((a, b) => a + b.unread, 0)
    : stats?.unread ?? 0;
  const allTime = periods && t("stats.pall");   // figures the period never touches
  const pName = t(per === "30d" ? "stats.in30" : "stats.in12");

  return (
    <Modal onClose={onClose}>
      <PanelHeader title={<span className="inline-flex items-center gap-2">
        <BarChart3 size={18} /> {t("Statistics")}
      </span>} onClose={onClose}
        actions={onWrapped && (
          <Button variant="secondary" size="sm" onClick={onWrapped}>
            <Sparkles size={16} className="mr-1 inline align-text-bottom" />
            {t("wrapped.menu")}
          </Button>
        )} />
      <div className="space-y-4 p-4 type-body sm:p-5">
        {error && <div className="text-danger-fg">{error}</div>}
        {!stats && !error && <Loading />}
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Kpi value={fmtNum(pMails)}
                label={inPeriod
                  ? <>{t("mails")} · {pName}<div>{t("stats.senders_all",
                    { n: fmtNum(stats.senders) })}</div></>
                  : `${t("mails")} · ${fmtNum(stats.senders)} ${
                    t("stats.senders")}`}
                extra={buckets.length > 1 && (
                  <MiniBars className="max-sm:hidden"
                    values={buckets.map((m) => m.count)} />)} />
              <Kpi value={fmtSize(pSize)}
                label={pMails === 0 ? t("stats.total_size")
                  : t(inPeriod ? "stats.size_in" : "stats.size_sub",
                    { period: pName,
                      size: fmtSize(Math.round(pSize / pMails)) })} />
              <Kpi value={`${pct(pUnread, pMails)}%`}
                label={inPeriod
                  ? t("stats.unread_in", { n: fmtNum(pUnread),
                    period: pName })
                  : `${t("stats.unread")} · ${fmtNum(pUnread)}`}
                extra={<Ring frac={pMails ? pUnread / pMails : 0}
                  px={48} />} />
              <Kpi value={fmtNum(thisMonth?.trash ?? 0)}
                label={t("stats.trash_tile")}
                extra={(thisMonth?.purge ?? 0) > 0 && (
                  <Tag tone="safe">
                    <TrendingDown size={14} className="mr-1 inline" />
                    {t("stats.freed_pill",
                      { size: fmtSize(thisMonth?.purged_bytes ?? 0) })}
                  </Tag>)} />
            </div>
            {(thisMonth?.purge ?? 0) > 0 && (
              <div className="type-meta text-muted">
                {t("stats.freed_month", { n: thisMonth?.purge ?? 0,
                  size: fmtSize(thisMonth?.purged_bytes ?? 0) })}
              </div>
            )}

            <div className="grid gap-3 xl:grid-cols-3">
              {buckets.length > 0 && (
                <ChartCard className="xl:col-span-2"
                  title={t(per === "30d" ? "stats.per_day"
                    : per === "12m" ? "stats.per_month"
                      : yearsChart ? "stats.per_year" : "stats.per_month_all")}
                  hint={periods && (
                    <Segmented label={t("stats.period")} value={per} tall={coarse}
                      onChange={setPeriod} options={[
                        { value: "30d", label: t("stats.p30") },
                        { value: "12m", label: t("stats.p12") },
                        { value: "all", label: t("stats.pall") }]} />)}>
                  <Columns hint={hint} rows={buckets} />
                </ChartCard>
              )}
              {stats.categories.length > 0 && (
                <ChartCard title={t("stats.categories")} hint={allTime}>
                  <div className="flex flex-wrap items-center gap-4">
                    <Donut px={128} label={t("stats.categories")}
                      slices={catSlices}>
                      <span className="type-heading tabular-nums">
                        {fmtNum(tagged)}</span>
                      <span className="type-caption text-muted">
                        {t("stats.tagged")}</span>
                    </Donut>
                    <ul className="min-w-48 flex-1 space-y-1.5 type-meta">
                      {catHead.map((c, i) => (
                        <CatRow key={c.tag} name={c.tag} hue={i}
                          count={c.count} bytes={c.size} />
                      ))}
                      {catTail.length > 0 && (
                        <>
                          <CatRow name={t("stats.other")} hue={CAT_HEAD}
                            count={catTail.reduce((a, c) => a + c.count, 0)}
                            bytes={catTail.reduce((a, c) => a + c.size, 0)} />
                          {catTail.map((c) => (
                            <CatRow key={c.tag} name={c.tag} sub
                              count={c.count} bytes={c.size} />
                          ))}
                        </>
                      )}
                    </ul>
                  </div>
                </ChartCard>
              )}
            </div>

            {stats.years.length > 0 && !yearsChart && (
              <ChartCard title={t("stats.per_year")}>
                <Columns compact hint={hint}
                  rows={stats.years.map((y) => ({ key: y.year, label: y.year,
                    tip: t("stats.month_tip", { month: y.year,
                      mails: t("n.mails", { n: y.count }),
                      size: fmtSize(y.size) }),
                    count: y.count }))} />
              </ChartCard>
            )}

            <div className="grid gap-3 xl:grid-cols-3">
              <ChartCard title={t("stats.top_senders")} hint={allTime}
                className="xl:col-span-2">
                {stats.top_senders.length === 0 ? (
                  <div className="type-meta text-muted">{t("stats.none")}</div>
                ) : (
                  <ul>
                    {stats.top_senders.map((s) => {
                      const max = Math.max(1, stats.top_senders[0].count);
                      // phones: name + figures on one line, the bar under
                      // them at full width; from sm: name | bar | figures
                      const row = (
                        <>
                          <Avatar name={s.label || s.key} size="md" />
                          <span className="grid min-w-0 flex-1 items-center
                            gap-x-2 gap-y-1 text-left grid-cols-[1fr_auto]
                            sm:grid-cols-[10rem_1fr_auto]">
                            <span className="truncate" title={s.key}>
                              {s.label}</span>
                            <span className="col-span-2 row-start-2 h-2
                              rounded-full bg-chip sm:col-span-1 sm:row-start-1
                              sm:col-start-2" aria-hidden="true">
                              <span className="block h-2 rounded-full
                                bg-accent"
                                style={{ width: `${(100 * s.count) / max}%` }} />
                            </span>
                            <span className="text-right type-meta
                              whitespace-nowrap text-muted tabular-nums
                              sm:col-start-3 sm:row-start-1">
                              {t("n.mails", { n: s.count })} ·{" "}
                              {fmtSize(s.size)}</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={s.key}>
                          {onOpenSender
                            ? <button type="button" onClick={() =>
                                onOpenSender(s.key)}
                                className="flex min-h-11 w-full cursor-pointer
                                  items-center gap-2 rounded-control px-1
                                  hover:bg-chip">{row}</button>
                            : <div className="flex min-h-11 items-center gap-2
                                px-1">{row}</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ChartCard>

              <ChartCard title={t("stats.engagement")} hint={allTime}>
                <div className="flex items-center gap-3">
                  <Ring px={64} frac={stats.senders
                    ? stats.replied_senders / stats.senders : 0}>
                    <span className="type-meta font-semibold">
                      {pct(stats.replied_senders, stats.senders)}%</span>
                  </Ring>
                  <div className="min-w-0 type-meta text-muted">
                    <span className="type-heading text-body tabular-nums">
                      {fmtNum(stats.replied_senders)}</span>{" "}
                    {t("stats.replied_senders", { total: stats.senders })}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1 type-meta text-muted">
                    <span className="font-semibold text-body tabular-nums">
                      {pct(stats.bulk, stats.mails)}%</span>{" "}
                    {t("stats.newsletters")} ({fmtNum(stats.bulk)})
                  </div>
                  <ProgressBar value={stats.bulk} max={stats.mails}
                    label={t("stats.newsletters")} />
                </div>
                <div className="mt-4 type-meta text-muted">
                  {t("stats.oldest")}:{" "}
                  <span className="font-semibold text-body tabular-nums">
                    {stats.oldest || "-"}</span>
                </div>
              </ChartCard>
            </div>

            <ChartCard title={t("stats.top_domains")}>
              {stats.top_domains.length === 0 && (
                <div className="type-meta text-muted">{t("stats.none")}</div>
              )}
              <ul>
                {stats.top_domains.map((d) => (
                  <li key={d.domain} className="flex items-baseline gap-2
                    border-b border-line/60 py-1 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate">{d.domain}</span>
                    <span className="type-meta text-muted">
                      {t("n.mails", { n: d.count })}
                    </span>
                    <span className="w-20 text-right type-meta tabular-nums
                      text-muted">{fmtSize(d.size)}</span>
                  </li>
                ))}
              </ul>
            </ChartCard>

            <div>
              <SectionLabel className="mb-2">{t("stats.ai")}</SectionLabel>
              <div className="flex flex-wrap items-center gap-1.5 type-meta">
                <Tag tone="safe">
                  {t("v.delete_safe")}: {stats.ai_groups.delete_safe}
                </Tag>
                <Tag tone="review">
                  {t("v.review")}: {stats.ai_groups.review}
                </Tag>
                <Tag tone="keep">
                  {t("v.keep")}: {stats.ai_groups.keep}
                </Tag>
                <Tag>{t("v.unrated")}: {stats.ai_groups.unrated}</Tag>
                <span className="text-muted">
                  {t("stats.rated_mails", { n: ratedTotal,
                    safe: stats.rated_mails.delete_safe })}
                </span>
              </div>
            </div>

            {months.length > 0 && (
              <div>
                <SectionLabel className="mb-2">
                  {t("stats.cleanup")}
                </SectionLabel>
                {months.slice(0, 6).map((m) => {
                  const a = stats.actions[m];
                  return (
                    <div key={m} className="flex items-baseline gap-2 py-0.5
                      type-meta text-muted">
                      <span className="w-16 tabular-nums">{m}</span>
                      <span>
                        {t("stats.actions_line", { trash: a.trash,
                          archive: a.archive, move: a.move,
                          read: a.mark_read })}
                        {(a.purge ?? 0) > 0 && t("stats.actions_purged", {
                          purge: a.purge ?? 0,
                          size: fmtSize(a.purged_bytes ?? 0) })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {stats.scans.length > 1 && (
              <div>
                <SectionLabel className="mb-2">{t("stats.scans")}</SectionLabel>
                {stats.scans.slice(-8).reverse().map((s) => (
                  <div key={s.ts} className="flex items-baseline gap-2 py-0.5
                    type-meta text-muted">
                    <span className="w-32 tabular-nums">
                      {new Date(s.ts * 1000).toLocaleString()}
                    </span>
                    <span>{t("n.mails", { n: s.mails })} ·{" "}
                      {t("n.groups", { n: s.senders })} ·{" "}
                      {fmtSize(s.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
