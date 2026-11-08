import { Archive, ChevronLeft, ChevronRight, ListChecks, MailMinus, Sparkles,
  Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent, type ReactNode } from "react";
import { api, fmtSize, saveBlob } from "../api";
import { getLang, t } from "../i18n";
import { fmtNum } from "../numfmt";
import type { WrappedResp, WrappedSender } from "../types";
import {
  buildSummarySvg, paletteFromTheme, senderName, svgToPngBlob,
  type SummaryStrings,
} from "../wrapped";
import { Avatar, Button, Checkbox, Loading, Modal, PopupSelect } from "./ui";

/** How long an auto-advancing card stays up. */
export const CARD_MS = 6000;
const TICK_MS = 100;
const HOLD_MS = 250;
/** Horizontal travel that counts as a swipe. */
const SWIPE_PX = 50;

const num = (n: number) => fmtNum(n);
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
const monthName = (m: number) =>
  new Date(2001, m - 1, 1).toLocaleString(getLang(), { month: "long" });
// 1 Jan 2001 was a Monday; the API counts Monday as 0
const weekdayName = (d: number) =>
  new Date(2001, 0, 1 + d).toLocaleString(getLang(), { weekday: "long" });

type CardKey = "intro" | "senders" | "loudest" | "month" | "rhythm"
  | "ghosts" | "biggest" | "cleanup" | "summary";

/** The cards that have data, in story order. A year without mail is just
 *  the intro (with the year switcher, so another year can be picked). */
export function cardsFor(d: WrappedResp): CardKey[] {
  if (!d.received.mails) return ["intro"];
  const c = d.cleanup;
  const cleaned = c.trashed + c.archived + c.purged + c.unsubscribes
    + c.rule_runs > 0;
  return [
    "intro", "senders",
    ...(d.top_senders.length ? ["loudest" as const] : []),
    ...(d.loudest_month ? ["month" as const] : []),
    ...(d.busiest_weekday && d.busiest_hour ? ["rhythm" as const] : []),
    ...(d.ghosts.count ? ["ghosts" as const] : []),
    ...(d.biggest ? ["biggest" as const] : []),
    ...(cleaned ? ["cleanup" as const] : []),
    "summary",
  ];
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A card: small lead line, one big figure, a unit line, extra content. The
 *  gradient and light text belong to the story, not to the theme. */
function Slide({ lead, big, unit, word = false, children }: {
  lead: string; big: ReactNode; unit?: ReactNode; word?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 px-6 py-8
      sm:px-10">
      <div className="type-heading text-knob/80">{lead}</div>
      <div className={`${word ? "type-display-word" : "type-display"}
        text-knob`}>{big}</div>
      {unit && <div className="type-title text-knob">{unit}</div>}
      {children}
    </div>
  );
}

/** Ranked sender rows (avatar, name, count) on a story card. */
function Rows({ rows, showNames, from = 1 }: {
  rows: WrappedSender[]; showNames: boolean; from?: number;
}) {
  return (
    <ol className="mt-3 space-y-2">
      {rows.map((s, i) => (
        <li key={s.addr} className="story-tile flex items-center gap-3
          rounded-card px-3 py-2 type-body text-knob">
          <span className="w-4 shrink-0 text-knob/70 tabular-nums">
            {i + from}</span>
          <Avatar name={showNames ? s.label || s.addr : "?"} size="md" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {senderName(s, showNames)}
          </span>
          <span className="shrink-0 text-knob/70 tabular-nums">
            {s.mails}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="story-tile rounded-card p-3 text-knob">
      <div className="type-title tabular-nums">{value}</div>
      <div className="type-meta text-knob/70">{label}</div>
    </div>
  );
}

/** Plain-CSS column chart. The peak column is solid white; the chart is an
 *  image for assistive tech, with its values as the text alternative. */
function Bars({ values, peak, label, height = "h-32", labels, alt }: {
  values: number[]; peak: number; label: string; height?: string;
  labels?: [ReactNode, ReactNode, ReactNode]; alt: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="mt-4">
      <div role="img" aria-label={`${label}: ${alt}`}
        className={`flex ${height} items-end gap-1`}>
        {values.map((v, i) => (
          <div key={i} aria-hidden
            className={`min-w-0 flex-1 rounded-t-sm ${i === peak
              ? "story-bar-hi" : "story-bar"}`}
            style={{ height: `${Math.max(4, (100 * v) / max)}%` }} />
        ))}
      </div>
      {labels && (
        <div aria-hidden className="mt-1 flex justify-between type-caption
          text-knob/70">
          <span>{labels[0]}</span><span>{labels[1]}</span>
          <span>{labels[2]}</span>
        </div>
      )}
    </div>
  );
}

/** The summary tiles: shared by the last card and the saved image. */
export function summaryStats(d: WrappedResp): { value: string; label: string }[] {
  const r = d.received;
  return [
    { value: num(r.senders), label: t("wrapped.stat.senders") },
    { value: `${pct(r.read, r.mails)}%`, label: t("wrapped.stat.read") },
    { value: num(r.new_senders), label: t("wrapped.stat.new") },
    { value: num(d.ghosts.count), label: t("wrapped.stat.ghosts") },
    { value: num(d.cleanup.trashed + d.cleanup.archived + d.cleanup.purged),
      label: t("wrapped.stat.cleaned") },
    { value: num(d.cleanup.unsubscribes),
      label: t("wrapped.stat.unsubscribed") },
  ];
}

function summaryStrings(d: WrappedResp): SummaryStrings {
  return {
    title: t("wrapped.title_year", { year: d.year }),
    lead: t("wrapped.intro.lead"),
    big: num(d.received.mails),
    unit: t(d.partial ? "wrapped.intro.unit_partial" : "wrapped.intro.unit",
      { n: d.received.mails, year: d.year }),
    note: t("wrapped.based_on_short"),
    stats: summaryStats(d),
    topTitle: t("wrapped.loudest.top"),
    topRows: d.top_senders.map((s) => t("n.mails", { n: s.mails })),
    footer: t("wrapped.footer"),
  };
}

/** Gradient per card (CSS classes `story-g0..5`, cycling). */
const GRAD: Record<CardKey, number> = { intro: 0, senders: 1, loudest: 1,
  month: 0, rhythm: 4, ghosts: 3, biggest: 5, cleanup: 2, summary: 2 };

const shortMonth = (m: number) =>
  new Date(2001, m - 1, 1).toLocaleString(getLang(), { month: "short" });
const shortWeekday = (d: number) =>
  new Date(2001, 0, 1 + d).toLocaleString(getLang(), { weekday: "short" });

/** Days the mails of the year were spread over (a running year: so far). */
function daysSpan(d: WrappedResp): number {
  const now = new Date();
  if (d.partial) {
    return Math.max(1, Math.round((now.getTime()
      - new Date(d.year, 0, 1).getTime()) / 864e5) + 1);
  }
  return (d.year % 4 === 0 && d.year % 100 !== 0) || d.year % 400 === 0
    ? 366 : 365;
}

function Card({ card, d, showNames, onYear }: {
  card: CardKey; d: WrappedResp; showNames: boolean;
  onYear: (y: number) => void;
}) {
  const r = d.received;
  const c = d.cleanup;
  const interactive = "pointer-events-auto relative";
  switch (card) {
    case "intro":
      return (
        <Slide lead={t("wrapped.intro.lead")}
          big={num(r.mails)}
          unit={r.mails ? t(
            d.partial ? "wrapped.intro.unit_partial" : "wrapped.intro.unit",
            { n: r.mails, year: d.year })
            : t("wrapped.empty", { year: d.year })}>
          {d.years.length > 1 && (
            <div className={`${interactive} mt-2 max-w-48`}>
              <PopupSelect<string> className="w-full"
                label={t("wrapped.year")} value={String(d.year)}
                onChange={(y) => onYear(Number(y))}
                options={[...d.years].reverse().map((y) => ({
                  value: String(y), label: String(y) }))} />
            </div>
          )}
          <p className="mt-2 type-meta text-knob/70">{t("wrapped.based_on")}</p>
        </Slide>
      );
    case "senders":
      return (
        <Slide lead={t("wrapped.senders.lead")} big={num(r.senders)}
          unit={t("wrapped.senders.unit", { n: r.senders })}>
          <p className="type-body text-knob/80">
            {t("wrapped.senders.sub", { pct: pct(r.read, r.mails),
              new: r.new_senders })}
          </p>
        </Slide>
      );
    case "loudest": {
      const top = d.top_senders[0];
      const every = daysSpan(d) / Math.max(1, top.mails);
      const rate = every >= 1
        ? t("wrapped.loudest.rate", { mails: t("n.mails", { n: top.mails }),
          days: (Math.round(every * 10) / 10).toLocaleString(getLang()) })
        : t("wrapped.loudest.rate_day", { mails: t("n.mails", { n: top.mails }),
          per: (Math.round(10 / every) / 10).toLocaleString(getLang()) });
      return (
        <div className="flex flex-1 flex-col justify-center gap-3 px-6 py-8
          text-center text-knob sm:px-10">
          <div className="type-heading text-knob/80">
            {t("wrapped.loudest.lead")}</div>
          <Avatar name={top.label || top.addr} size="xl"
            className="mx-auto ring-4 ring-knob/30" />
          <div className="type-title2 break-words">{top.label || top.addr}</div>
          <div className="type-body text-knob/80">
            {rate} · {fmtSize(top.bytes)}</div>
          <div className="text-left">
            <Rows rows={d.top_senders.slice(1)} showNames from={2} />
          </div>
        </div>
      );
    }
    case "month": {
      const peak = d.loudest_month!;
      return (
        <Slide lead={t("wrapped.month.lead")}
          word big={monthName(peak.month)}
          unit={t("wrapped.month.unit", { n: peak.mails })}>
          <Bars values={d.by_month} peak={peak.month - 1}
            label={t("wrapped.month.chart")}
            alt={d.by_month.map((v, i) => `${shortMonth(i + 1)} ${v}`)
              .join(", ")}
            labels={[shortMonth(1),
              t("wrapped.month.peak", { month: shortMonth(peak.month),
                n: peak.mails }), shortMonth(12)]} />
        </Slide>
      );
    }
    case "rhythm": {
      const day = d.busiest_weekday!;
      const hour = d.busiest_hour!;
      return (
        <Slide lead={t("wrapped.rhythm.lead")}
          word big={weekdayName(day.weekday)}
          unit={t("wrapped.rhythm.unit", { n: day.mails })}>
          <Bars values={d.by_weekday} peak={day.weekday} height="h-20"
            label={t("wrapped.rhythm.chart_days")}
            alt={d.by_weekday.map((v, i) => `${shortWeekday(i)} ${v}`)
              .join(", ")}
            labels={[shortWeekday(0), "", shortWeekday(6)]} />
          <p className="type-body text-knob/80">
            {t("wrapped.rhythm.hour", { hour: `${hour.hour}:00`,
              n: hour.mails })}
          </p>
          <Bars values={d.by_hour} peak={hour.hour} height="h-20"
            label={t("wrapped.rhythm.chart_hours")}
            alt={d.by_hour.map((v, i) => `${i}:00 ${v}`).join(", ")}
            labels={["0:00", "12:00", "23:00"]} />
        </Slide>
      );
    }
    case "ghosts":
      return (
        <Slide lead={t("wrapped.ghosts.lead")} big={num(d.ghosts.count)}
          unit={t("wrapped.ghosts.unit", { n: d.ghosts.count })}>
          <Rows rows={d.ghosts.top} showNames />
        </Slide>
      );
    case "biggest":
      return (
        <Slide lead={t("wrapped.biggest.lead")}
          big={fmtSize(d.biggest!.bytes)}
          unit={t("wrapped.biggest.unit",
            { sender: d.biggest!.label || d.biggest!.addr })} />
      );
    case "cleanup":
      return (
        <Slide lead={t("wrapped.cleanup.lead")}
          big={num(c.trashed + c.archived + c.purged)}
          unit={t("wrapped.cleanup.unit", {
            n: c.trashed + c.archived + c.purged })}>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              { icon: <Trash2 size={18} />, value: c.trashed,
                label: t("wrapped.cleanup.tile_trashed") },
              { icon: <Archive size={18} />, value: c.archived,
                label: t("wrapped.cleanup.tile_archived") },
              { icon: <MailMinus size={18} />, value: c.unsubscribes,
                label: t("wrapped.cleanup.tile_unsubs") },
              { icon: <ListChecks size={18} />, value: c.rule_runs,
                label: t("wrapped.cleanup.tile_rules") },
            ].map((x) => (
              <div key={x.label} className="story-tile rounded-card p-3
                text-knob">
                <span aria-hidden>{x.icon}</span>
                <div className="mt-1 type-title2 tabular-nums">
                  {num(x.value)}</div>
                <div className="type-meta text-knob/70">{x.label}</div>
              </div>
            ))}
          </div>
          <ul className="space-y-1 type-body text-knob/80">
            {c.purged > 0 && (
              <li>{t("wrapped.cleanup.purged",
                { n: c.purged, size: fmtSize(c.freed_bytes) })}</li>
            )}
            {c.top_rule && (
              <li>{c.top_rule.deleted
                ? t("wrapped.cleanup.top_rule_gone", { n: c.top_rule.mails })
                : t("wrapped.cleanup.top_rule", {
                  name: c.top_rule.name, n: c.top_rule.mails })}</li>
            )}
          </ul>
        </Slide>
      );
    case "summary":
      return (
        <Slide lead={t("wrapped.summary.lead")} big={num(r.mails)}
          unit={t(d.partial ? "wrapped.intro.unit_partial"
            : "wrapped.intro.unit", { n: r.mails, year: d.year })}>
          <div className="grid grid-cols-2 gap-2">
            {summaryStats(d).map((s) => (
              <Stat key={s.label} value={s.value} label={s.label} />
            ))}
          </div>
          {/* short windows: the card keeps tiles and controls, not rows */}
          <div className="hidden [@media(min-height:60rem)]:block">
            <Rows rows={d.top_senders.slice(0, 3)} showNames={showNames} />
          </div>
        </Slide>
      );
  }
}

/** "Your year in mail": a full-screen, story-style walk through one
 *  calendar year. Tap the right / left half (or arrow keys) for next /
 *  back, hold to pause, Esc closes. Cards advance by themselves unless the
 *  user prefers reduced motion. */
export function WrappedStory({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<WrappedResp | null>(null);
  const [error, setError] = useState("");
  const [year, setYear] = useState<number | undefined>(undefined);
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [saving, setSaving] = useState(false);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasHeld = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const motion = useMemo(() => !reducedMotion(), []);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    api.wrapped(year)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [year]);

  const cards = useMemo(() => (data ? cardsFor(data) : []), [data]);
  const last = Math.max(0, cards.length - 1);
  const go = (to: number) => {
    setIdx(Math.min(last, Math.max(0, to)));
    setElapsed(0);
  };
  const next = () => go(idx + 1);
  const back = () => go(idx - 1);

  // The intro (year switcher) and the summary (save) wait for the user.
  const timed = motion && !!data && idx > 0 && idx < last;
  const auto = timed && !paused;
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(id);
  }, [auto]);
  useEffect(() => {
    if (auto && elapsed >= CARD_MS) go(idx + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, auto]);

  // Layout effect, not a passive one: re-registered in the same commit that
  // shows the loaded cards, so a key pressed right then never reaches the
  // loading state's listener (which still sees no cards) - see #147.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the year select and text fields keep their own arrow keys
      const el = e.target as HTMLInputElement | null;
      if (el?.tagName === "SELECT" || el?.tagName === "TEXTAREA"
        || el?.closest?.("[data-popup-select], [role=menu]")
        || (el?.tagName === "INPUT" && el.type !== "checkbox")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pressStart = (e: PointerEvent<HTMLElement>) => {
    wasHeld.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    held.current = setTimeout(() => {
      wasHeld.current = true;
      setPaused(true);
    }, HOLD_MS);
  };
  const pressEnd = (e?: PointerEvent<HTMLElement>) => {
    if (held.current) clearTimeout(held.current);
    held.current = null;
    setPaused(false);
    // A horizontal swipe turns the card; the click that follows is no tap.
    const s0 = start.current;
    start.current = null;
    if (e && s0) {
      const dx = e.clientX - s0.x;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - s0.y)) {
        wasHeld.current = true;
        if (dx < 0) next(); else back();
      }
    }
  };
  const tap = (fn: () => void) => () => {
    if (wasHeld.current) { wasHeld.current = false; return; }
    fn();
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const svg = buildSummarySvg(data, summaryStrings(data),
        paletteFromTheme(), showNames);
      saveBlob(`inboxrake-wrapped-${data.year}.png`, await svgToPngBlob(svg));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const zone = "absolute inset-y-0 z-0 w-1/2 cursor-pointer touch-pan-y";
  // Phones: screen-reader-only until focused (then a visible corner button)
  const arrow = `max-sm:sr-only max-sm:focus-visible:not-sr-only
    max-sm:focus-visible:absolute max-sm:focus-visible:bottom-4
    max-sm:focus-visible:z-20 sm:shrink-0`;
  const cur = cards[idx];
  return (
    <Modal full onClose={onClose} label={t("wrapped.menu")}>
      <div className="flex min-h-0 flex-1 items-center justify-center
        sm:gap-3 sm:p-4">
        <Button variant="secondary" size="icon" label={t("wrapped.back")}
          className={`${arrow} max-sm:focus-visible:left-4`} disabled={idx === 0} onClick={back}>
          <ChevronLeft size={18} />
        </Button>
        {/* Phones: the card is the whole screen. Desktop: a 9:16 card. */}
        <div className={`${cur ? `story-g${GRAD[cur] % 6}` : "bg-panel2"}
          relative flex h-full min-h-0 w-full flex-col overflow-hidden
          sm:aspect-9/16 sm:w-auto sm:max-w-full sm:rounded-dialog`}>
          <div className="relative z-10 flex items-center gap-3 px-4 pt-4">
            <div role="progressbar" aria-label={t("wrapped.progress")}
              aria-valuemin={1} aria-valuemax={Math.max(1, cards.length)}
              aria-valuenow={idx + 1} className="flex min-w-0 flex-1 gap-1">
              {cards.map((k, i) => (
                <div key={k} aria-hidden className="story-track h-1 flex-1
                  overflow-hidden rounded-full">
                  <div className="story-bar-hi h-full rounded-full"
                    style={{ width: i < idx || (i === idx && !timed) ? "100%"
                      : i === idx
                        ? `${Math.min(100, (100 * elapsed) / CARD_MS)}%`
                        : "0%" }} />
                </div>
              ))}
            </div>
          </div>
          <div className="relative z-10 flex items-center gap-2 px-4 pt-3
            text-knob">
            <Sparkles size={14} aria-hidden />
            <span className="min-w-0 flex-1 truncate type-meta font-medium">
              {data ? t("wrapped.title_year", { year: data.year })
                : t("wrapped.menu")}
              {data?.partial && <> · {t("wrapped.so_far")}</>}
            </span>
            <Button variant="secondary" size="icon" label={t("Close")}
              onClick={onClose}>
              <X size={18} />
            </Button>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col
            overflow-y-auto text-knob">
            {error && <div className="p-6 text-knob">{error}</div>}
            {!data && !error && <Loading />}
            {data && cur && (
              <>
                {/* The tap zones sit under the content; text lets taps
                    through, controls (year, save) opt back in. They are not
                    tab stops: the buttons beside the card and the arrow keys
                    do the same. */}
                <button type="button" tabIndex={-1} aria-hidden
                  className={`${zone} left-0`}
                  onPointerDown={pressStart} onPointerUp={pressEnd}
                  onPointerLeave={() => pressEnd()}
                  onPointerCancel={() => pressEnd()}
                  onClick={tap(back)} />
                <button type="button" tabIndex={-1} aria-hidden
                  className={`${zone} right-0`}
                  onPointerDown={pressStart} onPointerUp={pressEnd}
                  onPointerLeave={() => pressEnd()}
                  onPointerCancel={() => pressEnd()}
                  onClick={tap(next)} />
                <div className="pointer-events-none relative z-10 flex flex-1
                  flex-col">
                  <Card card={cur} d={data} showNames={showNames}
                    onYear={(y) => { setYear(y); setIdx(0); setElapsed(0); }} />
                </div>
              </>
            )}
          </div>
          {data && cur === "summary" && (
            <div className="relative z-10 flex shrink-0 flex-col gap-2 px-6
              pb-5 pt-2 text-knob sm:px-10">
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={saving} onClick={save}>
                  {t("wrapped.save")}
                </Button>
                <Checkbox label={t("wrapped.show_names")} checked={showNames}
                  onChange={(e) => setShowNames(e.target.checked)} />
              </div>
              <p className="type-meta text-knob/70">
                {showNames ? t("wrapped.names_shown")
                  : t("wrapped.names_hidden")}
                {" "}{t("wrapped.local_only")}
              </p>
            </div>
          )}
        </div>
        <Button variant="secondary" size="icon" label={t("wrapped.next")}
          className={`${arrow} max-sm:focus-visible:right-4`}
          disabled={!data || idx >= last} onClick={next}>
          <ChevronRight size={18} />
        </Button>
      </div>
    </Modal>
  );
}
