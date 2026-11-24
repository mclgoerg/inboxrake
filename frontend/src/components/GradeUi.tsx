import { BellOff, Check, Eye, Minus, MousePointerClick, Radar, Repeat,
  Weight, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { fmtSize } from "../api";
import { GRADE_RULES, type GradeStats } from "../grades";
import { GRADE_LETTERS } from "../lib";
import { t } from "../i18n";
import { fmtNum, fmtPct } from "../numfmt";
import type { CheckVerdict, GradeCheck, GradeLetter, Group }
  from "../types";
import { Button, Modal } from "./ui";

/* Sender grade: the badge, the report card of the detail pane, the
   "How grades work" sheet and the Statistics card. The letter and the six
   checks come from the backend (backend/grades.py); this file words them. */

/** A to F: green, teal, blue, orange, red - the semantic tint pairs. */
const TONE: Record<GradeLetter, string> = {
  A: "bg-safe-bg text-safe-fg", B: "bg-new-bg text-new-fg",
  C: "bg-info-bg text-info-fg", D: "bg-review-bg text-review-fg",
  F: "bg-keep-bg text-keep-fg",
};

/** The letter in a rounded square (`sm` in lists, `lg` on the report card).
 *  Its name is "Grade D"; the letter itself is decoration. */
export function GradeBadge({ letter, size = "sm" }: {
  letter: GradeLetter; size?: "sm" | "lg";
}) {
  return (
    <span role="img" aria-label={t("grade.badge", { letter })}
      className={`inline-flex shrink-0 items-center justify-center font-bold
        ${TONE[letter]} ${size === "lg"
        ? "size-16 rounded-card type-largetitle"
        : "size-7 rounded-control type-body"}`}>
      <span aria-hidden>{letter}</span>
    </span>
  );
}

const CHECK_ICON: Record<GradeCheck["id"], LucideIcon> = {
  open: Eye, often: Repeat, tracking: Radar, unsub: MousePointerClick,
  stops: BellOff, size: Weight,
};

const VERDICT: Record<CheckVerdict, { icon: LucideIcon; tone: string;
  label: string }> = {
  ok: { icon: Check, tone: "text-safe-fg", label: "grade.v_ok" },
  bad: { icon: X, tone: "text-review-fg", label: "grade.v_bad" },
  neutral: { icon: Minus, tone: "text-muted", label: "grade.v_neutral" },
};

/** How often, in the unit that reads best: "4.1 a day", "2 a week". */
function oftenValue(perWeek: number): string {
  if (perWeek >= 7) {
    return t("grade.val.per_day", { n: fmtNum(perWeek / 7, { max: 1 }) });
  }
  if (perWeek >= 1) {
    return t("grade.val.per_week", { n: fmtNum(perWeek, { max: 1 }) });
  }
  return t("grade.val.per_month", { n: fmtNum(perWeek * 4.35, { max: 1 }) });
}

/** One check as the row shows it: the value on the right and the note under
 *  the name. The words live in the locale files, one key per case. */
export function checkText(c: GradeCheck): { label: string; value: string;
  note: string } {
  const label = t(`grade.check.${c.id}`);
  const few = c.total === undefined || c.pct === undefined;
  switch (c.id) {
    case "open":
      if (few) {
        return { label, value: t("grade.val.few"), note: t("grade.note.few",
          { n: GRADE_RULES.minMails }) };
      }
      return { label, value: fmtPct(c.pct!), note: c.months
        ? t("grade.note.open_months", { read: c.read ?? 0, total: c.total!,
          n: c.months })
        : t("grade.note.open", { read: c.read ?? 0, total: c.total! }) };
    case "often":
      if (c.per_week === undefined) {
        return { label, value: t("grade.val.few"), note: t("grade.note.few",
          { n: GRADE_RULES.minMails }) };
      }
      return { label, value: oftenValue(c.per_week), note:
        c.rank === undefined ? t("grade.note.often_active")
          : c.rank >= 50 ? t("grade.note.often_more",
            { k: Math.min(9, Math.floor(c.rank / 10)) })
            : t("grade.note.often_less") };
    case "tracking":
      if (c.kind === "unchecked") {
        return { label, value: t("grade.val.not_checked"),
          note: t("grade.note.tracking_unchecked") };
      }
      if (c.kind === "none") {
        return { label, value: t("grade.val.none"),
          note: t("grade.note.tracking_none", { n: c.checked ?? 0 }) };
      }
      return { label, value: t(`grade.val.track_${c.kind}`),
        note: c.kind === "links"
          ? t("grade.note.tracking_links", { pct: fmtPct(c.click_pct ?? 0) })
          : t("grade.note.tracking_pixel", { pct: fmtPct(c.pixel_pct ?? 0) }) };
    case "unsub":
      return { label, value: t(`grade.val.unsub_${c.kind}`),
        note: t(`grade.note.unsub_${c.kind}`) };
    case "stops":
      return { label, value: t(`grade.val.stops_${c.kind}`),
        note: t(`grade.note.stops_${c.kind}`, { n: c.n ?? 0 }) };
    default:
      return { label, value: fmtSize(c.avg ?? 0), note: (c.att ?? 0) > 0
        ? t("grade.note.size_att", { size: fmtSize(c.att!) })
        : t("grade.note.size") };
  }
}

function CheckRow({ c }: { c: GradeCheck }) {
  const { label, value, note } = checkText(c);
  const Icon = CHECK_ICON[c.id];
  const v = VERDICT[c.v];
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Icon size={16} aria-hidden className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="type-body font-medium">{label}</div>
        <div className="type-meta text-muted">{note}</div>
      </div>
      <span className="shrink-0 text-right type-body font-medium">{value}</span>
      <span role="img" aria-label={t(v.label)}
        className={`inline-flex shrink-0 ${v.tone}`}>
        <v.icon size={18} aria-hidden strokeWidth={2.5} />
      </span>
    </li>
  );
}

/** The sender's report card: the big grade with its sentence, then the six
 *  checks with value, note and a verdict mark, so the grade is never a black
 *  box. Unsubscribe and Trash are the detail's own buttons above and below. */
export function GradeCard({ g }: { g: Group }) {
  const [help, setHelp] = useState(false);
  const grade = g.grade;
  if (!grade) return null;
  return (
    <section aria-label={t("grade.card")} className="px-4 pt-4">
      <div className={`flex items-center gap-4 rounded-card p-3 ${
        TONE[grade.letter]}`}>
        <GradeBadge letter={grade.letter} size="lg" />
        <div className="min-w-0 flex-1 text-body">
          <h3 className="type-heading">
            {t("grade.title", { letter: grade.letter,
              pattern: t(`grade.pattern.${grade.pattern}`) })}</h3>
          <p className="type-meta text-muted">
            {t(`grade.line.${grade.pattern}`)}
            {grade.floor && <> {t("grade.floor")}</>}
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-card border border-line">
        {grade.checks.map((c) => <CheckRow key={c.id} c={c} />)}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-x-1 type-meta
        text-muted">
        <span>{t("grade.footnote")}</span>
        <Button variant="plain" size="sm" onClick={() => setHelp(true)}>
          {t("grade.how")}
        </Button>
      </div>
      {help && <GradeHelp onClose={() => setHelp(false)} />}
    </section>
  );
}

const HELP_ROWS: { id: GradeCheck["id"]; good: Record<string, string | number>;
  bad: Record<string, string | number> }[] = [
  { id: "open", good: { n: GRADE_RULES.readOkPct },
    bad: { n: GRADE_RULES.readBadBelowPct } },
  { id: "often", good: { n: GRADE_RULES.oftenOkPerWeek },
    bad: { n: GRADE_RULES.oftenBadPerWeek } },
  { id: "tracking", good: {}, bad: { n: GRADE_RULES.trackBadPct } },
  { id: "unsub", good: {}, bad: { n: GRADE_RULES.bulkMails,
    w: GRADE_RULES.oftenOkPerWeek } },
  { id: "stops", good: {}, bad: {} },
  { id: "size", good: { n: GRADE_RULES.sizeOkKb },
    bad: { n: GRADE_RULES.sizeBadMb } },
];

/** "How grades work": the six checks with their limits, how they add up and
 *  what the grade is not used for. The numbers are the backend's constants. */
export function GradeHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal size="sm" label={t("grade.how")} onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <h2 className="min-w-0 truncate type-heading">{t("grade.how")}</h2>
        <Button variant="plain" className="font-semibold" onClick={onClose}>
          {t("filter.done")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4
        type-body">
        <p>{t("grade.help.intro")}</p>
        <ul className="divide-y divide-line rounded-card border border-line">
          {HELP_ROWS.map((r) => (
            <li key={r.id} className="space-y-0.5 px-3 py-2.5">
              <div className="flex items-center gap-2 font-semibold">
                {(() => {
                  const Icon = CHECK_ICON[r.id];
                  return <Icon size={16} aria-hidden
                    className="shrink-0 text-muted" />;
                })()}
                {t(`grade.check.${r.id}`)}
              </div>
              <div className="flex gap-1.5 type-meta text-muted">
                <Check size={14} aria-hidden strokeWidth={2.5}
                  className="mt-0.5 shrink-0 text-safe-fg" />
                <span><span className="sr-only">{t("grade.v_ok")}: </span>
                  {t(`grade.help.${r.id}_ok`, r.good)}</span>
              </div>
              <div className="flex gap-1.5 type-meta text-muted">
                <X size={14} aria-hidden strokeWidth={2.5}
                  className="mt-0.5 shrink-0 text-review-fg" />
                <span><span className="sr-only">{t("grade.v_bad")}: </span>
                  {t(`grade.help.${r.id}_bad`, r.bad)}</span>
              </div>
            </li>
          ))}
        </ul>
        <p>{t("grade.help.points")}</p>
        <p className="type-meta text-muted">
          {t("grade.help.few", { n: GRADE_RULES.minMails })}</p>
        <p className="type-meta text-muted">{t("grade.help.fair")}</p>
        <p className="type-meta text-muted">{t("grade.help.fixed")}</p>
      </div>
    </Modal>
  );
}

/** Statistics card: the senders spread over A-F and how much of the mail
 *  the D and F senders send, with the way into the Senders list filtered to
 *  them. */
export function GradesCard({ stats, onShow }: {
  stats: GradeStats; onShow?: () => void;
}) {
  const [help, setHelp] = useState(false);
  const label = GRADE_LETTERS.map((l) => `${l} ${stats.counts[l]}`).join(", ");
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="type-meta text-muted">
          {t("n.senders", { n: stats.graded })}</span>
        <Button variant="plain" size="sm" onClick={() => setHelp(true)}>
          {t("grade.how")}
        </Button>
      </div>
      <div role="img" aria-label={`${t("grade.stats.title")}: ${label}`}
        className="flex h-7 gap-0.5 overflow-hidden rounded-control">
        {GRADE_LETTERS.filter((l) => stats.counts[l] > 0).map((l) => (
          <span key={l} aria-hidden style={{ flexGrow: stats.counts[l] }}
            className={`flex min-w-9 items-center justify-center type-caption
              font-bold tabular-nums ${TONE[l]}`}>
            {l} {fmtNum(stats.counts[l])}
          </span>
        ))}
      </div>
      <p className="mt-3 type-meta text-muted">
        {stats.weak > 0
          ? t("grade.stats.weak", { n: stats.weak,
            pct: fmtPct(stats.weakMailPct) })
          : t("grade.stats.none")}
      </p>
      {stats.weak > 0 && onShow && (
        <Button variant="plain" size="sm" className="-ml-3" onClick={onShow}>
          {t("grade.stats.show")}
        </Button>
      )}
      {help && <GradeHelp onClose={() => setHelp(false)} />}
    </>
  );
}
