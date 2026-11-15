/* When mail arrives: the shapes of GET /api/rhythm and everything the card,
 * the Insights widget and the sender strip derive from them (levels, busiest
 * and quietest slot, KPI shares, the "What stands out" sentences, a sender's
 * usual hours). Pure - wording goes through t(), numbers through numfmt. */

import { getLang, t } from "./i18n";
import { fmtNum, fmtPct } from "./numfmt";

export type RhythmKind = "all" | "newsletters" | "people" | "orders";
export const RHYTHM_KINDS: readonly RhythmKind[] =
  ["all", "newsletters", "people", "orders"];
export type RhythmPeriod = "30d" | "12m" | "all";

export interface RhythmSender { key: string; label: string; count: number }
/** The top senders of one slot: two named, the rest counted. */
export interface RhythmCell { senders: RhythmSender[]; more: number }
export interface RhythmKindData {
  total: number;
  /** [weekday Mon = 0][hour] */
  grid: number[][];
  /** "<weekday>-<hour>" -> who; slots without mail have no entry */
  top: Record<string, RhythmCell>;
}
export interface DailySender {
  key: string; label: string; hour: number; per_day: number; mails: number;
  open_pct: number;
}
export interface RhythmResp {
  period: RhythmPeriod;
  tz: string;
  from: number;
  kinds: Record<RhythmKind, RhythmKindData>;
  daily: DailySender[];
}

/** A slot of the card as a filter of the flat mail list (a view parameter of
 *  GET /api/mails, not a query qualifier). `to` is exclusive. */
export interface ArrivalSlot {
  kind: RhythmKind;
  period: RhythmPeriod;
  days: number[];
  from: number;
  to: number;
}

/** The browser's zone, sent with every request: the IANA name (daylight
 *  saving included) and today's UTC offset in minutes east as the fallback. */
export function userZone(): { tz: string; tzoff: number } {
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; }
  catch { /* no Intl zone: the offset alone */ }
  return { tz, tzoff: -new Date().getTimezoneOffset() };
}

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const DAYS = [0, 1, 2, 3, 4, 5, 6];

export const hh = (h: number): string => `${String(h % 24).padStart(2, "0")}:00`;

const lc = () => (getLang() === "de" ? "de-DE" : "en-GB");
/** Weekday names, Monday first ("Mon" / "Mo", or the long form). */
export function weekdayName(d: number, long = false): string {
  // 2024-01-01 was a Monday
  const s = new Intl.DateTimeFormat(lc(), {
    weekday: long ? "long" : "short", timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, 0, 1 + d)));
  return s.replace(/\.$/, "");
}

/** Colour step of a cell: 0 = no mail, 1-4 = fewer to more, quantised on the
 *  period's own maximum (the busiest slot always gets the top step). */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * count) / max)));
}

export const gridMax = (grid: number[][]): number =>
  Math.max(0, ...grid.map((r) => Math.max(0, ...r)));

export function busiest(grid: number[][]):
    { day: number; hour: number; count: number } | null {
  let best: { day: number; hour: number; count: number } | null = null;
  for (const day of DAYS) {
    for (const hour of HOURS) {
      const count = grid[day][hour];
      if (count > 0 && (!best || count > best.count)) best = { day, hour, count };
    }
  }
  return best;
}

/** Four-hour parts of a day, for the quietest line ("Sun night"). */
export const PARTS = ["night", "morning", "afternoon", "evening"] as const;
const PART_HOURS = [[0, 6], [6, 12], [12, 18], [18, 24]];

/** The weekday + part of day with the fewest mails (a later one wins a tie,
 *  so an empty Sunday night is "quietest"). */
export function quietest(grid: number[][]): { day: number; part: number } | null {
  let best: { day: number; part: number } | null = null;
  let fewest = Infinity;
  for (const day of DAYS) {
    for (let part = 0; part < PART_HOURS.length; part++) {
      const [a, b] = PART_HOURS[part];
      const n = grid[day].slice(a, b).reduce((s, v) => s + v, 0);
      if (n <= fewest) { fewest = n; best = { day, part }; }
    }
  }
  return best;
}

export const slotText = (day: number, hour: number): string =>
  `${weekdayName(day)} ${hh(hour)}`;

/** "Mon - Thu" for a run of 3+ weekdays, else "Thu, Fri". */
export function daysText(days: number[], long = false): string {
  const ds = [...days].sort((a, b) => a - b);
  const run = ds.every((d, i) => i === 0 || d === ds[i - 1] + 1);
  return run && ds.length >= 3
    ? `${weekdayName(ds[0], long)} - ${weekdayName(ds[ds.length - 1], long)}`
    : ds.map((d) => weekdayName(d, long)).join(", ");
}

export const periodName = (p: RhythmPeriod): string =>
  t(p === "30d" ? "rhythm.in30" : p === "12m" ? "rhythm.in12" : "rhythm.inall");

/** The period on its own ("30 days"; periodName is the form after "in"). */
export const periodTitle = (p: RhythmPeriod): string => t(`rhythm.per_${p}`);

/** "Tue, 06:00 - 07:00" / "Mon - Thu, 9:00 - 17:00" */
export const slotRangeText = (days: number[], from: number, to: number): string =>
  `${daysText(days)}, ${hh(from)} - ${hh(to)}`;

/** What the chip above a list opened from the card says (one template per
 *  language, so the period reads right: "... (in 12 months)"). */
export function slotLabel(s: ArrivalSlot): string {
  return t("rhythm.slot_chip", {
    slot: [slotRangeText(s.days, s.from, s.to),
      s.kind === "all" ? "" : t(`rhythm.kind_${s.kind}`)]
      .filter(Boolean).join(" · "),
    period: periodName(s.period) });
}

/** The tooltip / selected-slot text of one cell: the hour, the count, the
 *  top senders. */
export function cellTip(data: RhythmKindData, day: number, hour: number,
    period: RhythmPeriod): { head: string; who: string } {
  const n = data.grid[day][hour];
  const head = `${weekdayName(day)}, ${hh(hour)} - ${hh(hour + 1)} · ${
    t("rhythm.n_in", { n, period: periodName(period) })}`;
  const cell = data.top[`${day}-${hour}`];
  const who = !cell ? "" : [
    ...cell.senders.map((s) => `${s.label} ${fmtNum(s.count)}`),
    ...(cell.more > 0 ? [t("rhythm.more_n", { n: cell.more })] : []),
  ].join(" · ");
  return { head, who };
}

/** The summary read out for the grid (role=img). */
export function gridLabel(data: RhythmKindData, period: RhythmPeriod): string {
  const b = busiest(data.grid);
  return [t("rhythm.grid_label", { n: data.total, period: periodName(period) }),
    b ? t("rhythm.busiest_is", { slot: slotText(b.day, b.hour) }) : ""]
    .filter(Boolean).join(" ");
}

/** Shares of the period (percent): before 8:00, office hours (8-18, Mon-Fri),
 *  after 18:00, weekend. They overlap by design (a Saturday morning is both
 *  "before 8:00" and "weekend"). */
export function kpiShares(grid: number[][]):
    { before: number; office: number; after: number; weekend: number } {
  const sum = (days: number[], a: number, b: number) =>
    days.reduce((s, d) => s + grid[d].slice(a, b).reduce((x, v) => x + v, 0), 0);
  const total = sum(DAYS, 0, 24);
  const pct = (n: number) => (total ? Math.round((100 * n) / total) : 0);
  return {
    before: pct(sum(DAYS, 0, 8)), office: pct(sum([0, 1, 2, 3, 4], 8, 18)),
    after: pct(sum(DAYS, 18, 24)), weekend: pct(sum([5, 6], 0, 24)),
  };
}

// ------------------------------------------------------------ what stands out

/** Fewest mails a rule needs before it may speak (a thin sample is no
 *  pattern). */
export const MIN_MAILS = 20;
const WAVE_SHARE = 50;        // percent of a kind that must arrive before 8:00
const EVENING = [18, 22];     // the weekday-evening block, hours [18, 22)
const EVENING_RATIO = 2;      // block vs the other weekdays
const EVENING_MIN = 4;        // mails per day of the block
const PEAK_SHARE = 0.5;       // "busy" = at least half of the busiest

export interface Sentence {
  id: string;
  title: string;
  /** the plain line(s) under the title */
  detail: string;
  /** senders / the people line, optional */
  extra?: string;
  action?: { label: string; slot?: ArrivalSlot; unsubscribe?: string;
    /** a rule recipe (recipes.json id) to open in New rule */
    recipe?: string;
    /** words before the action link ("Batch them:") */
    prefix?: string };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

const and = (names: string[]): string => names.length < 2 ? names[0] ?? ""
  : `${names.slice(0, -1).join(", ")} ${t("rhythm.and")} ${names[names.length - 1]}`;

/** Labels of the biggest senders over the named slots, from the per-slot
 *  tops (each slot names two). */
function sendersOf(data: RhythmKindData, days: number[], from: number,
    to: number, max = 3): string[] {
  const by = new Map<string, { label: string; n: number }>();
  for (const d of days) {
    for (let h = from; h < to; h++) {
      for (const s of data.top[`${d}-${h}`]?.senders ?? []) {
        const e = by.get(s.key) ?? { label: s.label, n: 0 };
        e.n += s.count;
        by.set(s.key, e);
      }
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, max).map((e) => e.label);
}

/** The morning wave: most newsletters arrive before 8:00. */
function morningWave(r: RhythmResp): Sentence | null {
  const d = r.kinds.newsletters;
  if (d.total < MIN_MAILS) return null;
  const share = kpiShares(d.grid).before;
  if (share < WAVE_SHARE) return null;
  return { id: "wave",
    title: t("rhythm.so_wave", { pct: fmtPct(share) }),
    detail: t("rhythm.so_wave_sub"),
    action: { prefix: t("rhythm.batch_them"), label: t("recipe.keep5.short"),
      recipe: "keep5" } };
}

/** A sender that mails at the same hour nearly every day. */
function dailySender(s: DailySender): Sentence {
  const perDay = s.per_day;
  return { id: `daily:${s.key}`,
    title: t("rhythm.so_daily", { name: s.label, hour: String(s.hour).padStart(2, "0") }),
    detail: [t("rhythm.so_daily_n", { n: round1(perDay) }),
      t("rhythm.so_open", { pct: fmtPct(s.open_pct) })].join(" · "),
    action: { label: t("rhythm.unsub"), unsubscribe: s.key } };
}

/** Two neighbouring weekdays whose evenings carry several times the mail of
 *  the other weekdays: the shop mail's Thursday / Friday peak. */
function eveningBlock(r: RhythmResp): Sentence | null {
  let best: { kind: "orders" | "newsletters"; days: number[]; ratio: number } | null = null;
  for (const kind of ["orders", "newsletters"] as const) {
    const d = r.kinds[kind];
    if (d.total < MIN_MAILS) continue;
    const ev = [0, 1, 2, 3, 4].map((day) =>
      d.grid[day].slice(EVENING[0], EVENING[1]).reduce((s, v) => s + v, 0));
    for (let a = 0; a < 4; a++) {
      const mean = (ev[a] + ev[a + 1]) / 2;
      const rest = ev.filter((_, i) => i !== a && i !== a + 1);
      const other = rest.reduce((s, v) => s + v, 0) / rest.length;
      const ratio = mean / Math.max(1, other);
      if (mean >= EVENING_MIN && ratio >= EVENING_RATIO
          && (!best || ratio > best.ratio)) best = { kind, days: [a, a + 1], ratio };
    }
  }
  if (!best) return null;
  const d = r.kinds[best.kind];
  const names = sendersOf(d, best.days, EVENING[0], EVENING[1]);
  return { id: "evening",
    title: t("rhythm.so_evening", {
      days: and(best.days.map((x) => weekdayName(x, true))),
      x: Math.round(best.ratio),
      kind: t(`rhythm.phrase_${best.kind}`) }),
    detail: names.join(", "),
    action: { label: t("rhythm.show_them"),
      slot: { kind: best.kind, period: r.period, days: best.days,
        from: EVENING[0], to: EVENING[1] } } };
}

/** When the people you write to write back: their busy weekdays and hours. */
function peopleLine(r: RhythmResp): Sentence | null {
  const d = r.kinds.people;
  if (d.total < MIN_MAILS) return null;
  const perDay = d.grid.map((row) => row.reduce((s, v) => s + v, 0));
  const dayMax = Math.max(...perDay);
  const days = DAYS.filter((x) => perDay[x] >= PEAK_SHARE * dayMax);
  const perHour = HOURS.map((h) => d.grid.reduce((s, row) => s + row[h], 0));
  const peak = perHour.indexOf(Math.max(...perHour));
  let a = peak, b = peak;
  while (a > 0 && perHour[a - 1] >= PEAK_SHARE * perHour[peak]) a--;
  while (b < 23 && perHour[b + 1] >= PEAK_SHARE * perHour[peak]) b++;
  const share = r.kinds.all.total
    ? Math.round((100 * d.total) / r.kinds.all.total) : 0;
  return { id: "people",
    title: t("rhythm.so_people", { days: daysText(days), from: a, to: b + 1 }),
    detail: t("rhythm.so_people_sub", { pct: fmtPct(share) }) };
}

/** Up to four generated sentences, each only when its rule holds. */
export function standsOut(r: RhythmResp, max = 4): Sentence[] {
  const out: Sentence[] = [];
  const push = (s: Sentence | null) => { if (s) out.push(s); };
  push(morningWave(r));
  if (r.daily[0]) out.push(dailySender(r.daily[0]));
  push(eveningBlock(r));
  push(peopleLine(r));
  for (const s of r.daily.slice(1)) {
    if (out.length < max) out.push(dailySender(s));
  }
  return out.slice(0, max);
}

// ------------------------------------------------------------ sender strip

export interface SenderRhythm {
  hours: number[];          // 24 counts
  days: number[];           // 7 counts, Monday first
  n: number;
  /** the usual hours [from, to) and weekdays */
  from: number;
  to: number;
  weekdays: number[];
  /** mails per day between the first and the last mail */
  perDay: number;
}

/** A sender's arrival hours and weekdays from its mails' times (epoch
 *  seconds), in the browser's own time zone. Null below `min` mails. */
export function senderRhythm(stamps: number[], min = 6): SenderRhythm | null {
  const ts = stamps.filter((x) => x > 0);
  if (ts.length < min) return null;
  const hours = Array(24).fill(0);
  const days = Array(7).fill(0);
  for (const s of ts) {
    const d = new Date(s * 1000);
    hours[d.getHours()]++;
    days[(d.getDay() + 6) % 7]++;
  }
  const peak = hours.indexOf(Math.max(...hours));
  let a = peak, b = peak;
  while (a > 0 && hours[a - 1] >= 0.6 * hours[peak]) a--;
  while (b < 23 && hours[b + 1] >= 0.6 * hours[peak]) b++;
  const top = Math.max(...days);
  const span = Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / 86400) + 1);
  return { hours, days, n: ts.length, from: a, to: b + 1,
    weekdays: DAYS.filter((d) => days[d] >= 0.5 * top), perDay: ts.length / span };
}

/** "every day", "on weekdays", "on weekends" or "Mon, Wed". */
export function weekdaysText(days: number[]): string {
  const key = days.join(",");
  if (days.length === 7) return t("rhythm.every_day");
  if (key === "0,1,2,3,4") return t("rhythm.weekdays");
  if (key === "5,6") return t("rhythm.weekends");
  return t("rhythm.on_days", { days: daysText(days) });
}

/** "Usually 06:00 - 07:00, every day" */
export const usuallyText = (r: SenderRhythm): string =>
  t("rhythm.usually", { from: hh(r.from), to: hh(r.to), days: weekdaysText(r.weekdays) });

/** "4.1 a day" / "3 a week" / "2 a month": the rate in the unit that keeps
 *  the figure above one. */
export function rateText(perDay: number): string {
  if (perDay >= 0.5) return t("rhythm.rate_day", { n: round1(perDay) });
  if (perDay * 7 >= 0.5) return t("rhythm.rate_week", { n: round1(perDay * 7) });
  return t("rhythm.rate_month", { n: round1(perDay * 30) });
}
