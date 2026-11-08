import { BarChart3, Sparkles, TrendingDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, fmtSize } from "../api";
import { nowDate } from "../clock";
import { getLang, t } from "../i18n";
import type { StatsResp } from "../types";
import {
  Avatar, Button, Donut, hueFillAt, Loading, MiniBars, Modal, PanelHeader,
  ProgressBar, Ring, SectionLabel, Tag,
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
      {extra}
    </div>
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
            <span className="block truncate text-center type-caption
              text-muted">{r.label}</span>
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
  const tagged = stats?.categories.reduce((a, c) => a + c.count, 0) ?? 0;
  const monthTip = (m: { month: string; count: number; size: number }) =>
    t("stats.month_tip", { month: `${monthName(m.month)} ${m.month.slice(0, 4)}`,
      mails: t("n.mails", { n: m.count }), size: fmtSize(m.size) });

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
              <Kpi value={stats.mails.toLocaleString()}
                label={`${t("mails")} · ${stats.senders.toLocaleString()} ${
                  t("stats.senders")}`}
                extra={stats.months.length > 1 && (
                  <MiniBars className="max-sm:hidden"
                    values={stats.months.map((m) => m.count)} />)} />
              <Kpi value={fmtSize(stats.size)}
                label={t("stats.size_sub", { size: stats.mails
                  ? fmtSize(Math.round(stats.size / stats.mails)) : "-" })} />
              <Kpi value={`${pct(stats.unread, stats.mails)}%`}
                label={`${t("stats.unread")} · ${stats.unread.toLocaleString()}`}
                extra={<Ring frac={stats.mails ? stats.unread / stats.mails : 0}
                  px={48} />} />
              <Kpi value={(thisMonth?.trash ?? 0).toLocaleString()}
                label={t("stats.trash_tile")}
                extra={(thisMonth?.purge ?? 0) > 0 && (
                  <Tag tone="safe">
                    <TrendingDown size={14} className="mr-1 inline" />
                    {fmtSize(thisMonth?.purged_bytes ?? 0)}
                  </Tag>)} />
            </div>
            {(thisMonth?.purge ?? 0) > 0 && (
              <div className="type-meta text-muted">
                {t("stats.freed_month", { n: thisMonth?.purge ?? 0,
                  size: fmtSize(thisMonth?.purged_bytes ?? 0) })}
              </div>
            )}

            <div className="grid gap-3 xl:grid-cols-3">
              {stats.months.length > 1 && (
                <ChartCard title={t("stats.per_month")}
                  className="xl:col-span-2">
                  <Columns hint={t("stats.hover_hint")}
                    rows={stats.months.map((m) => ({ key: m.month,
                      label: monthName(m.month), tip: monthTip(m),
                      count: m.count }))} />
                </ChartCard>
              )}
              {stats.categories.length > 0 && (
                <ChartCard title={t("stats.categories")}>
                  <div className="flex flex-wrap items-center gap-4">
                    <Donut px={128} label={t("stats.categories")}
                      slices={stats.categories.map((c) => c.count)}>
                      <span className="type-heading tabular-nums">
                        {tagged.toLocaleString()}</span>
                      <span className="type-caption text-muted">
                        {t("stats.tagged")}</span>
                    </Donut>
                    <ul className="min-w-44 flex-1 space-y-1.5 type-meta">
                      {stats.categories.map((c, i) => (
                        <li key={c.tag} className="flex items-center gap-2">
                          <span aria-hidden="true" className={`size-2.5
                            shrink-0 rounded-full ${hueFillAt(i)}`} />
                          <span className="min-w-0 flex-1 truncate type-body"
                            title={c.tag}>{c.tag}</span>
                          <span className="whitespace-nowrap text-muted
                            tabular-nums">
                            {c.count} · {fmtSize(c.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </ChartCard>
              )}
            </div>

            {stats.years.length > 1 && (
              <ChartCard title={t("stats.per_year")}>
                <Columns compact hint={t("stats.hover_hint")}
                  rows={stats.years.map((y) => ({ key: y.year, label: y.year,
                    tip: t("stats.month_tip", { month: y.year,
                      mails: t("n.mails", { n: y.count }),
                      size: fmtSize(y.size) }),
                    count: y.count }))} />
              </ChartCard>
            )}

            <div className="grid gap-3 xl:grid-cols-3">
              <ChartCard title={t("stats.top_senders")}
                className="xl:col-span-2">
                <ul>
                  {stats.top_senders.map((s) => {
                    const max = Math.max(1, stats.top_senders[0].count);
                    const row = (
                      <>
                        <Avatar name={s.label || s.key} size="md" />
                        <span className="w-28 shrink-0 truncate text-left
                          sm:w-40" title={s.key}>{s.label}</span>
                        <span className="h-2 min-w-0 flex-1 rounded-full
                          bg-chip" aria-hidden="true">
                          <span className="block h-2 rounded-full bg-accent"
                            style={{ width: `${(100 * s.count) / max}%` }} />
                        </span>
                        <span className="shrink-0 text-right type-meta
                          whitespace-nowrap text-muted tabular-nums">
                          {t("n.mails", { n: s.count })} · {fmtSize(s.size)}
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
              </ChartCard>

              <ChartCard title={t("stats.engagement")}>
                <div className="flex items-center gap-3">
                  <Ring px={64} frac={stats.senders
                    ? stats.replied_senders / stats.senders : 0}>
                    <span className="type-meta font-semibold">
                      {pct(stats.replied_senders, stats.senders)}%</span>
                  </Ring>
                  <div className="min-w-0 type-meta text-muted">
                    <span className="type-heading text-body tabular-nums">
                      {stats.replied_senders}</span>{" "}
                    {t("stats.replied_senders", { total: stats.senders })}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1 type-meta text-muted">
                    <span className="font-semibold text-body tabular-nums">
                      {pct(stats.bulk, stats.mails)}%</span>{" "}
                    {t("stats.newsletters")} ({stats.bulk.toLocaleString()})
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
