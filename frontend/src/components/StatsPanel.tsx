import { BarChart3, HardDrive, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, fmtSize } from "../api";
import { nowDate } from "../clock";
import { categoryHues, categoryName } from "../categories";
import { fmtNum } from "../numfmt";
import { getLang, t } from "../i18n";
import { fmtDate } from "../lib";
import type { StatsResp } from "../types";
import {
  Avatar, Button, Donut, hueFillAt, IconTile, Loading, MiniBars, Modal,
  PanelHeader, ProgressBar, Ring, Segmented, useMediaQuery,
} from "./ui";

// A wide main column and a narrower one beside it, 1.7 : 1 (one third of the
// width is too tight for the category legend).
const TWO_COLS = "xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]";

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

/** KPI tile, one shape for all four: the figure, a short label, one detail
 *  line (it never wraps) and a small picture at the right of the figure
 *  (decorative - the figure already says it; phones drop it). */
function Kpi({ value, label, detail, visual }: {
  value: ReactNode; label: ReactNode; detail: ReactNode; visual?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center
      rounded-card bg-panel2 p-4">
      <div className="min-w-0">
        <div className="type-title2 tabular-nums">{value}</div>
        <div className="type-body font-semibold">{label}</div>
      </div>
      {visual && <div className="ml-3 shrink-0 max-sm:hidden">{visual}</div>}
      <div className="col-span-2 mt-0.5 whitespace-nowrap type-meta
        text-muted">{detail}</div>
    </div>
  );
}

/** A card's table: caption for screen readers, column headers, right-aligned
 *  numeric columns. */
function DataTable({ caption, cols, rows }: {
  caption: string;
  cols: { label: string; right?: boolean }[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <table className="w-full type-meta">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left type-caption text-muted">
          {cols.map((c) => (
            <th key={c.label} scope="col"
              className={`pb-1.5 font-normal ${c.right ? "text-right" : ""}`}>
              {c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-line/60">
            {r.cells.map((c, i) => (
              <td key={i} className={`py-2 tabular-nums ${
                cols[i].right ? "text-right text-muted"
                  : "break-all pr-2 text-body"}`}>
                {c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Show all N" / "Show fewer" under a list cut to its head. */
function ShowAll({ open, n, onToggle }: {
  open: boolean; n: number; onToggle: () => void;
}) {
  return (
    <Button variant="plain" size="sm" className="mt-1" onClick={onToggle}>
      {open ? t("stats.show_less") : t("stats.show_all", { n })}
    </Button>
  );
}

type Period = "30d" | "12m" | "all";
type Bucket = { key: string; label: string; tip: string; count: number;
  size: number; unread: number };

const localDay = (d: Date) => `${d.getFullYear()}-${
  String(d.getMonth() + 1).padStart(2, "0")}-${
  String(d.getDate()).padStart(2, "0")}`;
/** Epoch seconds -> local "YYYY-MM-DDTHH:MM" (what `fmtDate` reads). */
const localStamp = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${localDay(d)}T${String(d.getHours()).padStart(2, "0")}:${
    String(d.getMinutes()).padStart(2, "0")}`;
};

/** Donut slices: the biggest categories one each, the rest one grey "Other"
 *  slice. */
const CAT_HEAD = 5;

/** One legend row; `hue` undefined = no dot (a member of "Other"). */
function CatRow({ name, hue, count, bytes, sub = false, neutral = false }: {
  name: string; hue?: number; count: number; bytes: number; sub?: boolean;
  /** the folded "Other" row: a grey dot, the Donut's neutral last slice */
  neutral?: boolean;
}) {
  return (
    <li className={`flex items-center gap-2 ${sub ? "pl-4.5 text-muted" : ""}`}>
      {(hue !== undefined || neutral) && (
        <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full
          ${neutral || hue === undefined ? "bg-faint" : hueFillAt(hue)}`} />
      )}
      <span className="min-w-0 flex-1 break-words type-body">{name}</span>
      <span className="whitespace-nowrap text-muted tabular-nums">
        {fmtNum(count)} · {fmtSize(bytes)}</span>
    </li>
  );
}

/** "2026-09" -> "Sept 2026" in the UI language. */
const monthYear = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat(getLang() === "de" ? "de-DE" : "en-GB",
    { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
};

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
function Columns({ rows }: {
  rows: { key: string; label: string; tip: string; count: number }[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <div className="mb-2 h-5 type-meta text-muted" aria-hidden="true">
        {active !== null && (
          <span className="rounded-full bg-chip px-2 py-0.5 text-body">
            {rows[active].tip}</span>
        )}
      </div>
      <div className="flex h-44 items-end gap-1"
        onMouseLeave={() => setActive(null)}>
        {rows.map((r, i) => (
          <button key={r.key} type="button" aria-label={r.tip}
            onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
            onBlur={() => setActive(null)} onClick={() => setActive(i)}
            className="group flex h-full min-w-0 flex-1 cursor-pointer
              flex-col justify-end gap-1 rounded-control outline-offset-0">
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
  const [allSenders, setAllSenders] = useState(false);
  const [allDomains, setAllDomains] = useState(false);
  const wide = useMediaQuery("(min-width: 640px)");   // tables, not stacked rows

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
  const catHue = categoryHues(catHead.map((c) => c.tag));
  const catSlices = [...catHead.map((c) => c.count),
    ...(many ? [catTail.reduce((a, c) => a + c.count, 0)] : [])];
  const coarse = useMediaQuery("(pointer: coarse)");
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

  const lang = getLang();
  const dateOf = (iso: string) => fmtDate(iso, nowDate(), { lang });
  const thisYear = nowDate().getFullYear();
  const years = [...(stats?.years ?? [])].sort((x, y) =>
    y.year.localeCompare(x.year));
  const oldestYear = years.length ? years[years.length - 1].year : "";
  const yearMax = Math.max(1, ...years.map((y) => y.count));
  const senders = stats?.top_senders ?? [];
  const domains = stats?.top_domains ?? [];
  const SENDERS_HEAD = 6;
  const DOMAINS_HEAD = 5;
  const senderMax = Math.max(1, senders[0]?.count ?? 1);
  const aiTotal = stats ? stats.ai_groups.delete_safe + stats.ai_groups.review
    + stats.ai_groups.keep + stats.ai_groups.unrated : 0;
  const aiParts = !stats ? [] : [
    { key: "safe", n: stats.ai_groups.delete_safe, fill: "bg-safe-fg",
      label: t("v.delete_safe") },
    { key: "review", n: stats.ai_groups.review, fill: "bg-review-fg",
      label: t("v.review") },
    { key: "keep", n: stats.ai_groups.keep, fill: "bg-keep-fg",
      label: t("v.keep") },
    { key: "unrated", n: stats.ai_groups.unrated, fill: "bg-faint",
      label: t("v.unrated") },
  ];
  const cleaned = months.slice(0, 6).map((m) => ({ m, a: stats!.actions[m] }));
  const purgedOf = (a: { purge?: number; purged_bytes?: number }) =>
    (a.purge ?? 0) > 0
      ? `${fmtNum(a.purge ?? 0)} · ${t("stats.freed_pill",
        { size: fmtSize(a.purged_bytes ?? 0) })}` : "-";
  const dash = (n: number) => (n ? fmtNum(n) : "-");

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
              <Kpi value={fmtNum(pMails)} label={t("mails")}
                detail={<>
                  {/* phones: the period names the figures of all four tiles,
                      the sender count (also on the Senders tab) steps aside */}
                  {inPeriod && <span>{pName}<span className="max-sm:hidden">
                    {" · "}</span></span>}
                  <span className={inPeriod ? "max-sm:hidden" : ""}>
                    {fmtNum(stats.senders)} {t("stats.senders")}</span></>}
                visual={buckets.length > 1 && (
                  <MiniBars values={buckets.map((m) => m.count)} />)} />
              <Kpi value={fmtSize(pSize)}
                label={pMails === 0 ? t("stats.total_size") : t("stats.received")}
                detail={pMails === 0 ? "" : <>
                  {inPeriod && <span className="max-sm:hidden">{pName} · </span>}
                  {t("stats.per_mail",
                    { size: fmtSize(Math.round(pSize / pMails)) })}</>}
                visual={<IconTile tone="accent"><HardDrive size={16} /></IconTile>} />
              <Kpi value={`${pct(pUnread, pMails)}%`} label={t("stats.unread")}
                detail={<>
                  {t("stats.unread_of", { n: fmtNum(pUnread),
                    total: fmtNum(pMails) })}
                  {inPeriod && <span className="max-sm:hidden"> · {pName}</span>}
                </>}
                visual={<Ring frac={pMails ? pUnread / pMails : 0} px={48} />} />
              <Kpi value={fmtNum(thisMonth?.trash ?? 0)}
                label={t("stats.trash_label")}
                detail={<>{t("stats.this_month")}<span className="max-sm:hidden">
                  {" · "}{t("stats.archived_n",
                    { n: fmtNum(thisMonth?.archive ?? 0) })}</span></>}
                visual={<IconTile tone="keep"><Trash2 size={16} /></IconTile>} />
            </div>
            {(thisMonth?.purge ?? 0) > 0 && (
              <div className="type-meta text-muted">
                {t("stats.freed_month", { n: thisMonth?.purge ?? 0,
                  size: fmtSize(thisMonth?.purged_bytes ?? 0) })}
              </div>
            )}

            <div className={`grid gap-3 ${TWO_COLS}`}>
              {buckets.length > 0 && (
                <ChartCard
                  title={t(per === "30d" ? "stats.per_day"
                    : per === "12m" ? "stats.per_month"
                      : yearsChart ? "stats.per_year" : "stats.per_month_all")}
                  hint={periods && (
                    <Segmented label={t("stats.period")} value={per} tall={coarse}
                      onChange={setPeriod} options={[
                        { value: "30d", label: t("stats.p30") },
                        { value: "12m", label: t("stats.p12") },
                        { value: "all", label: t("stats.pall") }]} />)}>
                  <Columns rows={buckets} />
                </ChartCard>
              )}
              {stats.categories.length > 0 && (
                <ChartCard title={t("stats.categories")} hint={allTime}>
                  <div className="flex flex-wrap items-center gap-4">
                    <Donut px={128} label={t("stats.categories")}
                      slices={catSlices} hues={catHue} restLast={many}>
                      <span className="type-heading tabular-nums">
                        {fmtNum(tagged)}</span>
                      <span className="type-caption text-muted">
                        {t("stats.tagged")}</span>
                    </Donut>
                    <ul className="min-w-48 flex-1 space-y-1.5 type-meta">
                      {catHead.map((c, i) => (
                        <CatRow key={c.tag} name={categoryName(c.tag)} hue={catHue[i]}
                          count={c.count} bytes={c.size} />
                      ))}
                      {catTail.length > 0 && (
                        <>
                          <CatRow name={t("stats.other")} neutral
                            count={catTail.reduce((a, c) => a + c.count, 0)}
                            bytes={catTail.reduce((a, c) => a + c.size, 0)} />
                          {catTail.map((c) => (
                            <CatRow key={c.tag} name={categoryName(c.tag)} sub
                              count={c.count} bytes={c.size} />
                          ))}
                        </>
                      )}
                    </ul>
                  </div>
                  <p className="mt-3 type-meta text-muted">
                    {t("stats.cat_note")}</p>
                </ChartCard>
              )}
            </div>

            <div className={`grid items-start gap-3 ${TWO_COLS}`}>
              <div className="min-w-0 space-y-3">
                <ChartCard title={t("stats.top_senders")}
                  hint={t("stats.by_mails_all")}>
                  {senders.length === 0 ? (
                    <div className="type-meta text-muted">{t("stats.none")}</div>
                  ) : (
                    <>
                      <ul>
                        {(allSenders ? senders : senders.slice(0, SENDERS_HEAD))
                          .map((s) => {
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
                                  rounded-full bg-chip sm:col-span-1
                                  sm:row-start-1 sm:col-start-2"
                                  aria-hidden="true">
                                  <span className="block h-2 rounded-full
                                    bg-accent"
                                    style={{ width: `${(100 * s.count) / senderMax}%` }} />
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
                      {senders.length > SENDERS_HEAD && (
                        <ShowAll open={allSenders} n={senders.length}
                          onToggle={() => setAllSenders(!allSenders)} />
                      )}
                    </>
                  )}
                </ChartCard>

                <ChartCard title={t("stats.top_domains")}
                  hint={t("stats.by_size_all")}>
                  {domains.length === 0 ? (
                    <div className="type-meta text-muted">{t("stats.none")}</div>
                  ) : (
                    <>
                      <DataTable caption={t("stats.top_domains")}
                        cols={[{ label: t("stats.col_domain") },
                          { label: t("stats.col_mails"), right: true },
                          { label: t("stats.col_size"), right: true }]}
                        rows={(allDomains ? domains
                          : domains.slice(0, DOMAINS_HEAD)).map((d) => ({
                          key: d.domain,
                          cells: [d.domain, fmtNum(d.count), fmtSize(d.size)] }))} />
                      {domains.length > DOMAINS_HEAD && (
                        <ShowAll open={allDomains} n={domains.length}
                          onToggle={() => setAllDomains(!allDomains)} />
                      )}
                    </>
                  )}
                </ChartCard>
              </div>

              <div className="min-w-0 space-y-3">
                {years.length > 0 && !yearsChart && (
                  <ChartCard title={t("stats.per_year")}>
                    {/* one grid, so the bars start and end in the same place */}
                    <ul className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto]
                      items-center gap-x-3 gap-y-2">
                      {years.map((y) => (
                        <li key={y.year} className="contents">
                          <span className="font-semibold tabular-nums">
                            {y.year}</span>
                          <span aria-hidden="true" className="h-2.5 rounded-full
                            bg-chip">
                            <span className="block h-2.5 min-w-1 rounded-full
                              bg-accent"
                              style={{ width: `${(100 * y.count) / yearMax}%` }} />
                          </span>
                          <span className="whitespace-nowrap type-meta
                            text-muted tabular-nums">
                            {[t("n.mails", { n: y.count }),
                              Number(y.year) === thisYear
                                ? t("stats.year_sofar") : "",
                              y.year === oldestYear && stats.oldest
                                ? t("stats.year_from",
                                  { date: dateOf(stats.oldest) }) : ""]
                              .filter(Boolean).join(" · ")}</span>
                        </li>
                      ))}
                    </ul>
                  </ChartCard>
                )}

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
                    <div className="mb-1 flex justify-between gap-2 type-meta
                      text-muted">
                      <span>{categoryName("newsletter")} ({fmtNum(stats.bulk)})</span>
                      <span className="font-semibold text-body tabular-nums">
                        {pct(stats.bulk, stats.mails)}%</span>
                    </div>
                    <ProgressBar value={stats.bulk} max={stats.mails}
                      label={categoryName("newsletter")} />
                  </div>
                  <div className="mt-4 type-meta text-muted">
                    {t("stats.oldest")}:{" "}
                    <span className="font-semibold text-body tabular-nums">
                      {stats.oldest ? dateOf(stats.oldest) : "-"}</span>
                  </div>
                </ChartCard>
              </div>
            </div>

            <div className={`grid items-start gap-3 ${TWO_COLS}`}>
              <div className="min-w-0">
                {cleaned.length > 0 && (
                  <ChartCard title={t("stats.cleanup")}
                    hint={t("stats.cleanup_hint")}>
                    {wide ? (
                      <DataTable caption={t("stats.cleanup")}
                        cols={[{ label: t("stats.col_month") },
                          { label: t("stats.col_trash"), right: true },
                          { label: t("stats.col_archived"), right: true },
                          { label: t("stats.col_moved"), right: true },
                          { label: t("stats.col_read"), right: true },
                          { label: t("stats.col_deleted"), right: true }]}
                        rows={cleaned.map(({ m, a }) => ({ key: m, cells: [
                          monthYear(m), dash(a.trash), dash(a.archive),
                          dash(a.move), dash(a.mark_read), purgedOf(a)] }))} />
                    ) : (
                      <ul>
                        {cleaned.map(({ m, a }) => {
                          const more = [
                            a.archive ? t("stats.m_archived",
                              { n: fmtNum(a.archive) }) : "",
                            a.move ? t("stats.m_moved",
                              { n: fmtNum(a.move) }) : "",
                            a.mark_read ? t("stats.m_read",
                              { n: fmtNum(a.mark_read) }) : "",
                            (a.purge ?? 0) > 0 ? t("stats.m_purged",
                              { n: fmtNum(a.purge ?? 0) }) : "",
                            (a.purge ?? 0) > 0 ? t("stats.freed_pill",
                              { size: fmtSize(a.purged_bytes ?? 0) }) : "",
                          ].filter(Boolean);
                          return (
                            <li key={m} className="border-t border-line/60 py-2
                              first:border-t-0">
                              <div className="flex items-baseline gap-2">
                                <span className="flex-1 font-semibold">
                                  {monthYear(m)}</span>
                                <span className="font-semibold tabular-nums">
                                  {t("stats.m_trash",
                                    { n: fmtNum(a.trash) })}</span>
                              </div>
                              {more.length > 0 && (
                                <div className="type-meta text-muted">
                                  {more.join(" · ")}</div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </ChartCard>
                )}
              </div>

              <div className="min-w-0 space-y-3">
                <ChartCard title={t("stats.ai")} hint={t("stats.ai_hint")}>
                  <div aria-hidden="true" className="mb-3 flex h-3 gap-0.5
                    overflow-hidden rounded-full bg-chip">
                    {aiTotal > 0 && aiParts.filter((x) => x.n > 0).map((x) => (
                      <span key={x.key} style={{ flexGrow: x.n }}
                        className={`min-w-1 ${x.fill}`} />
                    ))}
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1.5 type-meta">
                    {aiParts.map((x) => (
                      <li key={x.key} className="flex items-center gap-1.5">
                        <span aria-hidden="true" className={`size-2 shrink-0
                          rounded-full ${x.fill}`} />
                        {fmtNum(x.n)} {x.label}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 type-meta text-muted">
                    {t("stats.rated_mails", { n: ratedTotal,
                      safe: stats.rated_mails.delete_safe })}</p>
                </ChartCard>

                {stats.scans.length > 1 && (
                  <ChartCard title={t("stats.scans")}>
                    <DataTable caption={t("stats.scans")}
                      cols={[{ label: t("stats.col_scan") },
                        { label: t("stats.col_mails"), right: true },
                        { label: t("stats.col_groups"), right: true },
                        { label: t("stats.col_size"), right: true }]}
                      rows={stats.scans.slice(-8).reverse().map((s) => ({
                        key: String(s.ts), cells: [
                          fmtDate(localStamp(s.ts), nowDate(),
                            { lang, time: true }),
                          fmtNum(s.mails), fmtNum(s.senders),
                          fmtSize(s.size)] }))} />
                  </ChartCard>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
