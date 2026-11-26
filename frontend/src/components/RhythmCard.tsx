import { Briefcase, CalendarDays, Moon, Repeat, ShoppingBag, Sunrise, Users }
  from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { api } from "../api";
import { fmtNum, fmtPct } from "../numfmt";
import { t } from "../i18n";
import {
  busiest, cellTip, DAYS, gridLabel, gridMax, heatLevel, HOURS, hh, kpiShares,
  PARTS, quietest, RHYTHM_KINDS, senderRhythm, slotLabel, slotText, standsOut,
  rateText, usuallyText, userZone, weekdayName,
  type ArrivalSlot, type RhythmKind, type RhythmKindData, type RhythmPeriod,
  type RhythmResp, type Sentence,
} from "../rhythm";
import { Button, IconTile, LINK, LINK_ACCENT, Segmented, type TagTone,
  useMediaQuery } from "./ui";

/* "When mail arrives" (Statistics): the 7 x 24 grid in one hue (the Space
 * map's --color-heat) in five steps with a legend and a table view, the
 * sentences that stand out, and the four shares. */

/** The five steps, fewer to more: none, then four tints of the one hue. */
const HEAT = ["bg-chip", "bg-heat/30", "bg-heat/55", "bg-heat/80", "bg-heat"];

const zoneName = (): string => {
  const z = userZone();
  if (z.tz) return z.tz;
  const m = Math.abs(z.tzoff);
  return `UTC${z.tzoff < 0 ? "-" : "+"}${Math.floor(m / 60)}${
    m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}`;
};

/** The slot of one cell as a list filter. */
const cellSlot = (kind: RhythmKind, period: RhythmPeriod, day: number,
    hour: number): ArrivalSlot =>
  ({ kind, period, days: [day], from: hour, to: hour + 1 });

/** The grid: one square per weekday and hour. `mini` (the phone widget) is a
 *  picture only. Otherwise it is one control with a roving tab stop: arrow
 *  keys move between the squares, Enter / Space opens one, and each square's
 *  name is its tooltip text (hour, count, top senders); the numbers are also
 *  in the table. Hover and focus show the tooltip. */
export function HeatGrid({ grid, label, mini = false, active, tip, onCell,
  onHover, nameOf, keys = true }: {
  grid: number[][];
  label: string;
  mini?: boolean;
  /** the square that is hovered / focused / tapped (outlined) */
  active?: [number, number] | null;
  /** the tooltip of the active square (fine pointers) */
  tip?: ReactNode;
  onCell?: (day: number, hour: number) => void;
  onHover?: (cell: [number, number] | null) => void;
  /** the accessible name of a square */
  nameOf?: (day: number, hour: number) => string;
  /** squares are keyboard controls (off on touch screens: there a tap selects
   *  and the table's 44 px buttons are the way in) */
  keys?: boolean;
}) {
  const max = gridMax(grid);
  const step = mini ? 6 : 3;
  const live = !mini && !!onCell && keys;
  const root = useRef<HTMLDivElement>(null);
  const start = busiest(grid);
  const [stop, setStop] = useState<[number, number]>(
    start ? [start.day, start.hour] : [0, 0]);
  // (spans inside the widget: it sits in a button, where a div is not allowed)
  const move = (e: ReactKeyboardEvent, d: number, h: number) => {
    const to: [number, number] | null =
      e.key === "ArrowRight" ? [d, (h + 1) % 24]
      : e.key === "ArrowLeft" ? [d, (h + 23) % 24]
      : e.key === "ArrowDown" ? [Math.min(6, d + 1), h]
      : e.key === "ArrowUp" ? [Math.max(0, d - 1), h]
      : e.key === "Home" ? [d, 0] : e.key === "End" ? [d, 23] : null;
    if (to) {
      e.preventDefault();
      setStop(to);
      root.current?.querySelector<HTMLElement>(
        `[data-cell="${to[0]}-${to[1]}"]`)?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCell?.(d, h);
    }
  };
  const Box = mini ? "span" : "div";
  return (
    <Box ref={root as never} role={live ? "group" : "img"} aria-label={label}
      className="block">
      {/* a 2 px gap (gap-0.5), the weekday column, then 24 hours; the
          column width is arbitrary: one label ("Mon") plus the gap */}
      <Box className={`grid gap-0.5 ${mini
        ? "grid-cols-[1rem_repeat(24,minmax(0,1fr))]"
        : "grid-cols-[2.25rem_repeat(24,minmax(0,1fr))]"}`}
        onMouseLeave={() => onHover?.(null)}>
        {DAYS.map((d) => (
          <Fragment key={d}>
            <span aria-hidden className={`flex items-center text-muted ${
              mini ? "type-caption" : "type-meta"}`}>
              {mini ? weekdayName(d).slice(0, 2) : weekdayName(d)}</span>
            {HOURS.map((h) => {
              const n = grid[d][h];
              const on = active?.[0] === d && active?.[1] === h;
              const cls = `relative block rounded-xs sm:rounded-badge ${
                mini ? "aspect-square" : "aspect-square sm:aspect-auto sm:h-5"
              } ${HEAT[heatLevel(n, max)]} ${onCell && n > 0 ? "cursor-pointer" : ""
              } ${on ? "outline-2 outline-body" : ""}`;
              return (
                <Box key={h} data-cell={`${d}-${h}`} data-level={heatLevel(n, max)}
                  className={cls}
                  {...(live ? {
                    role: "button", "aria-label": nameOf?.(d, h),
                    tabIndex: stop[0] === d && stop[1] === h ? 0 : -1,
                    onFocus: () => { setStop([d, h]); onHover?.([d, h]); },
                    onBlur: () => onHover?.(null),
                    onKeyDown: (e: ReactKeyboardEvent) => move(e, d, h),
                  } : {})}
                  onMouseEnter={() => onHover?.([d, h])}
                  onClick={onCell ? () => onCell(d, h) : undefined}>
                  {on && tip && (
                    <div role="tooltip" className={`pointer-events-none absolute
                      bottom-full z-10 mb-1 w-max max-w-sm rounded-control border
                      border-line bg-panel p-2 text-left shadow-popover max-sm:hidden
                      ${h < 6 ? "left-0" : h > 17 ? "right-0"
                      : "left-1/2 -translate-x-1/2"}`}>{tip}</div>
                  )}
                </Box>
              );
            })}
          </Fragment>
        ))}
        <span aria-hidden />
        {Array.from({ length: 24 / step }, (_, i) => (
          <span key={i} aria-hidden className={`type-caption text-muted ${
            mini ? "col-span-6" : "col-span-3 max-sm:hidden"}`}>
            {String(i * step).padStart(2, "0")}</span>
        ))}
        {!mini && Array.from({ length: 4 }, (_, i) => (
          <span key={`p${i}`} aria-hidden className="col-span-6 type-caption
            text-muted sm:hidden">{String(i * 6).padStart(2, "0")}</span>
        ))}
      </Box>
    </Box>
  );
}

/** "fewer [five steps] more" */
export function HeatLegend() {
  return (
    <span className="inline-flex items-center gap-1.5 type-caption text-muted"
      role="img" aria-label={t("rhythm.legend")}>
      <span aria-hidden>{t("rhythm.fewer")}</span>
      <span aria-hidden className="flex gap-0.5">
        {/* the lowest step is the empty cell: a hairline keeps it visible */}
        {HEAT.map((c) => <span key={c} className={`size-3 rounded-xs border
          border-line ${c}`} />)}
      </span>
      <span aria-hidden>{t("rhythm.more")}</span>
    </span>
  );
}

/** "Tue 06:00" / "Sun night" for the busiest / quietest line. */
export function busiestLine(data: RhythmKindData): string {
  const b = busiest(data.grid);
  const q = quietest(data.grid);
  if (!b || !q) return "";
  return t("rhythm.busiest", { slot: slotText(b.day, b.hour),
    quiet: t("rhythm.quiet", { day: weekdayName(q.day),
      part: t(`rhythm.part_${PARTS[q.part]}`) }) });
}

/** The same numbers as the grid, for screen readers and copying; a number
 *  opens its mails. */
function RhythmTable({ data, kind, period, onOpen }: {
  data: RhythmKindData; kind: RhythmKind; period: RhythmPeriod;
  onOpen: (s: ArrivalSlot) => void;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full type-meta">
        <caption className="pb-2 text-left type-caption text-muted">
          {t("rhythm.table_note")}</caption>
        <thead>
          <tr className="text-right type-caption text-muted">
            <th scope="col" className="pb-1.5 text-left font-normal">
              {t("rhythm.col_hour")}</th>
            {DAYS.map((d) => (
              <th key={d} scope="col" className="pb-1.5 font-normal">
                {weekdayName(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h} className="border-t border-line/60">
              <th scope="row" className="py-1.5 text-left font-normal
                tabular-nums">{hh(h)}</th>
              {DAYS.map((d) => {
                const n = data.grid[d][h];
                return (
                  <td key={d} className="py-1.5 text-right tabular-nums">
                    {n > 0 ? (
                      <button type="button" className={`${LINK} coarse:min-h-11`}
                        aria-label={t("rhythm.open_cell", {
                          slot: `${weekdayName(d)} ${hh(h)}`, n })}
                        onClick={() => onOpen(cellSlot(kind, period, d, h))}>
                        {fmtNum(n)}</button>
                    ) : <span className="text-muted">0</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SENTENCE_ICON: Record<string, [ReactNode, TagTone]> = {
  wave: [<Sunrise size={16} />, "accent"],
  daily: [<Repeat size={16} />, "review"],
  evening: [<ShoppingBag size={16} />, "info"],
  people: [<Users size={16} />, "safe"],
};

/** What stands out: the sentences, each with its action. */
export function StandsOut({ items, onOpenSlot, onUnsubscribe, onOpenRecipe }: {
  items: Sentence[];
  onOpenSlot: (s: ArrivalSlot) => void;
  onUnsubscribe?: (key: string) => void;
  onOpenRecipe?: (id: string) => void;
}) {
  if (!items.length) {
    return <p className="type-meta text-muted">{t("rhythm.so_none")}</p>;
  }
  return (
    <ul className="divide-y divide-line/60">
      {items.map((s) => {
        const [icon, tone] = SENTENCE_ICON[s.id.split(":")[0]];
        const act = s.action;
        const go = !act ? null : act.slot ? () => onOpenSlot(act.slot!)
          : onUnsubscribe && act.unsubscribe
            ? () => onUnsubscribe(act.unsubscribe!)
          : onOpenRecipe && act.recipe ? () => onOpenRecipe(act.recipe!) : null;
        return (
          <li key={s.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <IconTile tone={tone}>{icon}</IconTile>
            <div className="min-w-0">
              <div className="type-body font-semibold">{s.title}</div>
              {s.detail && <div className="type-meta text-muted">{s.detail}</div>}
              {act && go && (
                <div className="type-meta">
                  {act.prefix && <span className="text-muted">{act.prefix} </span>}
                  <button type="button" onClick={go}
                    className={`${LINK_ACCENT} coarse:min-h-11`}>
                    {act.label}</button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Share({ value, label, icon }: {
  value: number; label: string; icon: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between rounded-card
      bg-panel2 p-4">
      <div className="min-w-0">
        <div className="type-title2 tabular-nums">{fmtPct(value)}</div>
        <div className="type-body font-semibold">{label}</div>
      </div>
      <IconTile tone="accent">{icon}</IconTile>
    </div>
  );
}

/** The whole block of the Statistics page: the card with the grid, What
 *  stands out beside it and the four shares below. `onOpenSlot` opens the
 *  mails of a slot (the list view), `onUnsubscribe` the unsubscribe sheet of
 *  a sender. */
export function RhythmCard({ period, onOpenSlot, onUnsubscribe, onOpenRecipe,
  onNamed, className = "" }: {
  period: RhythmPeriod;
  /** The senders "What stands out" names (keys) once it is known - [] when
   *  it could not be loaded; null while loading. */
  onNamed?: (keys: string[] | null) => void;
  onOpenSlot: (s: ArrivalSlot) => void;
  onUnsubscribe?: (key: string) => void;
  onOpenRecipe?: (id: string) => void;
  /** the grid classes of the two columns (Statistics' 1.7 : 1) */
  className?: string;
}) {
  const [resp, setResp] = useState<{ period: RhythmPeriod; data: RhythmResp } | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<RhythmKind>("all");
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [picked, setPicked] = useState<[number, number] | null>(null);
  const [table, setTable] = useState(false);
  const coarse = useMediaQuery("(pointer: coarse)");

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setPicked(null);
    // (a throw before the request - an older API object - is a failure too)
    Promise.resolve().then(() => api.rhythm(period))
      .then((d) => alive && setResp({ period, data: d }))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [period]);

  const data = resp && resp.period === period ? resp.data : null;
  const cur = data?.kinds[kind];
  const sentences = useMemo(() => data ? standsOut(data) : [], [data]);
  useEffect(() => {
    onNamed?.(data ? sentences.flatMap((s) => s.keys ?? [])
      : failed ? [] : null);
  }, [data, failed, sentences, onNamed]);
  const shown = coarse ? picked : hover;
  const sub = t(`rhythm.sub_${period}`, { zone: data?.tz || zoneName() });
  const kpi = cur ? kpiShares(cur.grid) : null;

  return (
    <div className="space-y-3">
      <div className={`grid items-start gap-3 ${className}`}>
        <section className="min-w-0 rounded-card bg-panel2 p-4"
          aria-labelledby="rhythm-title">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h3 id="rhythm-title" className="type-heading">
                {t("stats.rhythm")}</h3>
              <p className="type-meta text-muted">{sub}</p>
            </div>
            {data && (
              <Segmented label={t("rhythm.kinds")} role="radio" value={kind}
                tall={coarse} equal onChange={(k) => { setKind(k); setPicked(null); }}
                options={RHYTHM_KINDS.map((k) => ({
                  value: k, label: t(`rhythm.kind_${k}`) }))} />
            )}
          </div>
          {failed && <p className="type-meta text-danger-fg">{t("rhythm.failed")}</p>}
          {!data && !failed && (
            <span aria-hidden className="block h-40 rounded-control bg-chip" />
          )}
          {data && cur && (
            <>
              <HeatGrid grid={cur.grid} label={gridLabel(cur, period)}
                active={shown} keys={!coarse}
                nameOf={(d, h) => {
                  const tp = cellTip(cur, d, h, period);
                  return [tp.head, tp.who].filter(Boolean).join(". ");
                }}
                tip={!coarse && shown && cur.grid[shown[0]][shown[1]] > 0 && (() => {
                  const tp = cellTip(cur, shown[0], shown[1], period);
                  return <>
                    <div className="type-meta font-semibold">{tp.head}</div>
                    {tp.who && <div className="type-meta text-muted">{tp.who}</div>}
                  </>;
                })()}
                onHover={coarse ? undefined : setHover}
                onCell={(d, h) => {
                  if (cur.grid[d][h] <= 0) return;
                  if (coarse) setPicked([d, h]);
                  else onOpenSlot(cellSlot(kind, period, d, h));
                }} />
              {coarse && (
                <div className="mt-2 min-h-12 rounded-control bg-chip p-2"
                  aria-live="polite">
                  {picked && cur.grid[picked[0]][picked[1]] > 0 ? (() => {
                    const tp = cellTip(cur, picked[0], picked[1], period);
                    return <>
                      <div className="type-meta font-semibold">{tp.head}</div>
                      {tp.who && <div className="type-meta text-muted">{tp.who}</div>}
                      <Button variant="secondary" size="sm" className="mt-1"
                        onClick={() => onOpenSlot(cellSlot(kind, period,
                          picked[0], picked[1]))}>
                        {t("rhythm.open_slot")}</Button>
                    </>;
                  })() : (
                    <span className="type-meta text-muted">{t("rhythm.tap_hint")}</span>
                  )}
                </div>
              )}
              {cur.total === 0 && (
                <p className="mt-2 type-meta text-muted">{t("rhythm.none")}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between
                gap-x-4 gap-y-2">
                <HeatLegend />
                <span className="flex flex-wrap items-center gap-x-3 type-meta
                  text-muted">
                  <span>{busiestLine(cur)}</span>
                  <button type="button" aria-expanded={table}
                    className={`${LINK_ACCENT} coarse:min-h-11`}
                    onClick={() => setTable(!table)}>
                    {t(table ? "rhythm.hide_table" : "rhythm.show_table")}
                  </button>
                </span>
              </div>
              {table && <RhythmTable data={cur} kind={kind} period={period}
                onOpen={onOpenSlot} />}
            </>
          )}
        </section>

        <section className="min-w-0 rounded-card bg-panel2 p-4">
          <h3 className="mb-3 type-heading">{t("rhythm.stands_out")}</h3>
          {data ? (
            <StandsOut items={sentences} onOpenSlot={onOpenSlot}
              onUnsubscribe={onUnsubscribe} onOpenRecipe={onOpenRecipe} />
          ) : !failed && (
            <span aria-hidden className="block h-24 rounded-control bg-chip" />
          )}
        </section>
      </div>

      {kpi && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Share value={kpi.before} label={t("rhythm.kpi_before")}
            icon={<Sunrise size={16} />} />
          <Share value={kpi.office} label={t("rhythm.kpi_office")}
            icon={<Briefcase size={16} />} />
          <Share value={kpi.after} label={t("rhythm.kpi_after")}
            icon={<Moon size={16} />} />
          <Share value={kpi.weekend} label={t("rhythm.kpi_weekend")}
            icon={<CalendarDays size={16} />} />
        </div>
      )}
    </div>
  );
}

/** The chip above a list that was opened from the card: what it is filtered
 *  to, and the way back to every mail. */
export function SlotChip({ slot, onClear }: {
  slot: ArrivalSlot; onClear: () => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-meta
      text-muted">
      <span className="rounded-full bg-chip px-2 py-0.5 text-body">
        {slotLabel(slot)}</span>
      <button type="button" className={`${LINK} coarse:min-h-11`} onClick={onClear}>
        {t("rhythm.slot_clear")}</button>
    </div>
  );
}

/** A sender's usual hours and weekdays (sender detail): "Usually 06:00 -
 *  07:00, every day", the rate, a 24-hour strip and the weekday chips. From
 *  the mails the detail already loaded (`stamps` = their epoch seconds), in
 *  the browser's time zone; nothing is shown for a handful of mails. */
export function ArrivalStrip({ stamps, notes = [] }: {
  stamps: number[];
  /** Extra lines under the strip when the rhythm changed (sender changes);
   *  a sender with too few mails for a strip still shows them. */
  notes?: { id: string; icon: ReactNode; text: string }[];
}) {
  const r = useMemo(() => senderRhythm(stamps), [stamps]);
  const noteLines = notes.length > 0 && (
    <ul className="mt-2 space-y-1">
      {notes.map((n) => (
        <li key={n.id} data-testid="strip-change" className="flex items-center
          gap-1.5 type-meta text-review-fg">
          <span className="shrink-0">{n.icon}</span>{n.text}</li>
      ))}
    </ul>
  );
  if (!r) {
    return noteLines ? (
      <section className="mx-4 mt-3 rounded-card bg-panel2 p-3"
        aria-label={t("rhythm.strip_title")}>{noteLines}</section>
    ) : null;
  }
  const max = Math.max(...r.hours);
  const listed = HOURS.filter((h) => r.hours[h] > 0)
    .map((h) => `${hh(h)} (${r.hours[h]})`).join(", ");
  return (
    <section className="mx-4 mt-3 rounded-card bg-panel2 p-3"
      aria-label={t("rhythm.strip_title")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="type-meta">{usuallyText(r)}</span>
        <span className="type-meta text-muted tabular-nums">{rateText(r.perDay)}</span>
      </div>
      <div role="img" aria-label={`${t("rhythm.strip_label")}. ${
        t("rhythm.hours_label")} ${listed}`}>
        <div className="mt-2 grid grid-cols-24 gap-0.5">
          {HOURS.map((h) => (
            <span key={h} data-level={heatLevel(r.hours[h], max)}
              className={`aspect-square rounded-xs sm:rounded-badge sm:aspect-auto sm:h-3 ${
                HEAT[heatLevel(r.hours[h], max)]}`} />
          ))}
        </div>
        <div aria-hidden className="mt-1 flex justify-between type-caption
          text-muted">
          {["00", "06", "12", "18", "24"].map((x) => <span key={x}>{x}</span>)}
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1">
        {DAYS.map((d) => (
          <li key={d} className={`rounded-full px-2 py-0.5 type-caption ${
            r.weekdays.includes(d) ? "bg-accent-tint text-accent"
              : "bg-chip text-muted"}`}>{weekdayName(d)}</li>
        ))}
      </ul>
      {noteLines}
    </section>
  );
}
