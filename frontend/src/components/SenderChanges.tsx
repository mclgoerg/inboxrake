import { RotateCcw, TrendingUp } from "lucide-react";
import type { ReactElement } from "react";
import { t, getLang } from "../i18n";
import { fmtNum } from "../numfmt";
import { fmtTs, type ParsedFilter } from "../lib";
import type { BackRow, Group, GroupBack, GroupLouder, LouderRow,
  SenderChangesResp } from "../types";
import { Avatar, LINK_ACCENT, Notice, Tag } from "./ui";

/* Sender changes (backend/senderchanges.py): who got louder, who came back.
 * The line above the Senders list while is:louder / is:back is active, the
 * line in a sender's arrival strip, and the rows of the Statistics card. */

const DAY = 86400;

/** The months of a silence, as the backend counts them. */
export const monthsOf = (gapDays: number): number =>
  Math.floor(gapDays / 30.44);

/** "7 d" / "90 min" / "3 h": the window of an `in:` term, language-neutral. */
export function windowText(seconds: number): string {
  if (seconds % DAY === 0) return `${seconds / DAY} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${Math.ceil(seconds / 60)} min`;
}

const shortDate = (ts: number): string => fmtTs(ts, getLang(), false);

/** "Northwind News ×4, Chirper ×2.5, ..." (the loudest first, the rest as a
 *  count). */
function names(items: { label: string; mark?: string }[], max = 3): string {
  const head = items.slice(0, max).map((i) => i.mark
    ? `${i.label} ${i.mark}` : i.label).join(", ");
  return items.length > max
    ? `${head} ${t("changes.more", { n: items.length - max })}` : head;
}

/** One line above the Senders list while `is:louder` / `is:back` is in the
 *  filter: why these rows are here. The rows themselves stay as they are -
 *  no new pill, nothing added to a row. `groups` = the rows shown. */
export function ChangesNote({ filter, groups }: {
  filter: ParsedFilter; groups: Group[];
}) {
  const parts: { key: string; icon: ReactElement; text: string }[] = [];
  if (filter.louder) {
    const win = filter.inSeconds !== null && filter.inSeconds < 7 * DAY
      ? windowText(filter.inSeconds) : t("changes.days7");
    const loud = groups.filter((g) => g.louder)
      .sort((a, b) => b.louder!.factor - a.louder!.factor)
      .map((g) => ({ label: g.louder!.label,
        mark: `×${fmtNum(g.louder!.factor, { max: 1 })}` }));
    parts.push({ key: "louder", icon: <TrendingUp size={14} aria-hidden />,
      text: [t("changes.note_louder", { window: win }), names(loud)]
        .filter(Boolean).join(" · ") });
  }
  if (filter.back) {
    const win = filter.inSeconds !== null ? windowText(filter.inSeconds)
      : t("changes.days30");
    const came = groups.filter((g) => g.back)
      .sort((a, b) => b.back!.ts - a.back!.ts)
      .map((g) => ({ label: g.back!.label,
        mark: `(${t("changes.n_months", { n: monthsOf(g.back!.gap_days) })})` }));
    parts.push({ key: "back", icon: <RotateCcw size={14} aria-hidden />,
      text: [t("changes.note_back", { window: win }), names(came)]
        .filter(Boolean).join(" · ") });
  }
  if (!parts.length) return null;
  return (
    <div data-testid="changes-note" className="space-y-1.5">
      {parts.map((p) => (
        <Notice key={p.key} tone="warn" icon={p.icon}>{p.text}</Notice>
      ))}
    </div>
  );
}

/** The extra lines of a sender's arrival strip: its last 7 days against its
 *  usual week, and/or the mail that broke a long silence. Null when it did
 *  neither. */
export function arrivalChangeLines(g: { louder?: GroupLouder; back?: GroupBack }
    ): { id: string; icon: ReactElement; text: string }[] {
  const out: { id: string; icon: ReactElement; text: string }[] = [];
  if (g.louder) {
    out.push({ id: "louder", icon: <TrendingUp size={14} aria-hidden />,
      text: t("changes.strip_louder", { n: g.louder.n }) });
  }
  if (g.back) {
    out.push({ id: "back", icon: <RotateCcw size={14} aria-hidden />,
      text: t("changes.back_desc", { n: g.back.n,
        date: shortDate(g.back.ts), months: monthsOf(g.back.gap_days) }) });
  }
  return out;
}

/** The text under a row of the Statistics card. */
function louderText(r: LouderRow, nowS: number): string {
  if (r.end >= nowS - 3600) {
    return t("changes.louder_now", { n: r.n, usual: fmtNum(r.usual) });
  }
  return t("changes.louder_then", { n: r.n, usual: fmtNum(r.usual),
    days: Math.round((r.end - r.start) / DAY), date: shortDate(r.end) });
}

function Row({ label, line, factor, action, onAction }: {
  label: string; line: string; factor?: number;
  action: string; onAction: () => void;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-line/60 py-2
      first:border-t-0">
      <Avatar name={label} size="md" />
      <div className="min-w-0 flex-1">
        <div className="type-body font-semibold">
          <span className="break-words">{label}</span>
          {factor !== undefined && (
            <Tag tone="review" className="ml-2 align-middle">
              ×{fmtNum(factor, { max: 1 })}</Tag>
          )}
        </div>
        <div className="type-meta text-muted">{line}</div>
      </div>
      <button type="button" onClick={onAction}
        className={`${LINK_ACCENT} shrink-0 type-meta coarse:min-h-11`}>
        {action}</button>
    </li>
  );
}

function Heading({ icon, children }: { icon: ReactElement; children: string }) {
  return (
    <h4 className="mb-1 flex items-center gap-1.5 type-meta font-semibold
      uppercase tracking-wide text-muted">
      {icon}{children}
    </h4>
  );
}

/** The rows of the Statistics card "Changes in the last 30 days". `named`
 *  (sender keys) are the senders "What stands out" already speaks of; they
 *  are left out. Returns null when nothing is left: no change, no card.
 *  Each row offers the fitting action - Unsubscribe… (an unsubscribe is
 *  open), Block… (came back), else Show mails; protected senders only get
 *  Show mails. */
export function ChangesRows({ data, named, nowS, blocked, onUnsubscribe,
  onBlock, onShowMails }: {
  data: SenderChangesResp; named: ReadonlySet<string>; nowS: number;
  /** keys with a block rule already */
  blocked: ReadonlySet<string>;
  onUnsubscribe?: (key: string) => void;
  onBlock?: (key: string) => void;
  onShowMails?: (key: string) => void;
}) {
  const louder = data.louder.filter((r) => !named.has(r.key));
  const back = data.back.filter((r) => !named.has(r.key));
  if (!louder.length && !back.length) return null;
  const show = (r: { key: string }) => () => onShowMails?.(r.key);
  const louderAct = (r: LouderRow) => !r.protected && r.unsub && onUnsubscribe
    ? { label: t("rhythm.unsub"), go: () => onUnsubscribe(r.key) }
    : { label: t("changes.show_mails"), go: show(r) };
  const backAct = (r: BackRow) => !r.protected && !blocked.has(r.key) && onBlock
    ? { label: t("changes.block"), go: () => onBlock(r.key) }
    : { label: t("changes.show_mails"), go: show(r) };
  return (
    <>
      {louder.length > 0 && (
        <section aria-label={t("changes.got_louder")}>
          <Heading icon={<TrendingUp size={14} aria-hidden />}>
            {t("changes.got_louder")}</Heading>
          <ul>
            {louder.map((r) => {
              const a = louderAct(r);
              return <Row key={r.key} label={r.label} factor={r.factor}
                line={louderText(r, nowS)} action={a.label} onAction={a.go} />;
            })}
          </ul>
        </section>
      )}
      {back.length > 0 && (
        <section aria-label={t("changes.came_back")}
          className={louder.length > 0 ? "mt-3" : ""}>
          <Heading icon={<RotateCcw size={14} aria-hidden />}>
            {t("changes.came_back")}</Heading>
          <ul>
            {back.map((r) => {
              const a = backAct(r);
              return <Row key={r.key} label={r.label}
                line={t("changes.back_desc", { n: r.n, date: shortDate(r.ts),
                  months: monthsOf(r.gap_days) })}
                action={a.label} onAction={a.go} />;
            })}
          </ul>
        </section>
      )}
      <p className="mt-3 border-t border-line/60 pt-2 type-meta text-muted">
        {t("changes.left_out")}</p>
    </>
  );
}
