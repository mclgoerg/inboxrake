import { BellPlus, BellRing, CalendarPlus, Ghost, Pin, PinOff,
  Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { nowDate } from "../clock";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import { amountText, cadenceSentence, dayMonth, fmtMoney, monthShort,
  monthYear } from "../subscriptions";
import type { Subscription } from "../types";
import { Avatar, Button, LINK_ACCENT, Notice } from "./ui";

/** A pane button: icon and label on one line (a `Button` is a plain block). */
const ROW_BTN = "inline-flex min-w-0 items-center justify-center text-center";

/** The pane of one subscription (beside the list from 1280 px, a dialog
 *  below): amount, receipts and total, the receipt rhythm, the "looks
 *  unused" notice, the latest receipts and the actions. Presentational -
 *  SubscriptionsPanel owns the data and what the buttons do. */
export function SubscriptionDetail({ s, notificationsOn, busy, onRemind,
  onIcs, onKeep, onHide, onOpenReceipt, onFindAmounts, onNotifications }: {
  s: Subscription;
  /** This device gets reminders (Web Push or browser notifications). */
  notificationsOn: boolean;
  busy: boolean;
  onRemind: () => void;
  onIcs: () => void;
  onKeep: () => void;
  onHide: () => void;
  onOpenReceipt: (index: number) => void;
  /** Offers the opt-in (amounts from the receipt text); absent when it is on. */
  onFindAmounts?: () => void;
  onNotifications: () => void;
}) {
  const per = s.cadence === "monthly" ? "sub.per_month" : "sub.per_year";
  const price = amountText(s);
  return (
    <div className="flex min-h-full flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={s.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate type-title2">{s.name}</h2>
          <div className="break-words type-meta text-muted">
            {s.addr ? `${s.addr} · ` : ""}{cadenceSentence(s)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Figure value={price ?? "—"}
          label={price === null ? (
            <>
              {t("sub.not_in_subject")}
              {onFindAmounts && (<>
                {" · "}
                <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
                  onClick={onFindAmounts}>{t("sub.find_amounts_short")}</button>
              </>)}
            </>
          ) : t(per, { from: t(s.amount_source === "receipt"
            ? "sub.from_receipt" : "sub.from_subject") })} />
        <Figure value={fmtNum(s.receipts)}
          label={t("sub.receipts_so_far", { n: s.receipts })} />
        {s.total !== null && (
          <Figure
            value={`${s.total_estimated ? t("sub.about") + " " : ""}${
              fmtMoney(s.total, s.currency, { whole: true })}`}
            label={t("sub.since", { date: monthYear(s.since) })} />
        )}
      </div>

      <Rhythm s={s} />

      {!s.use.in_use && (
        <Notice tone="warn" icon={<Ghost size={16} aria-hidden />}>
          <b>{t("sub.unused_title")}</b>{" "}{unusedText(s)}
        </Notice>
      )}

      <section aria-label={t("sub.latest")}>
        <div className="mb-1 type-section">{t("sub.latest")}</div>
        <ul className="overflow-hidden rounded-card border border-line">
          {s.latest.map((r, i) => (
            <li key={`${r.folder}:${r.uid}`}
              className="border-b border-line last:border-0">
              <button type="button" onClick={() => onOpenReceipt(i)}
                className="flex w-full min-w-0 cursor-pointer items-center
                  gap-2 px-3 py-2 text-left hover:bg-panel2 coarse:min-h-11">
                <span aria-hidden className="inline-flex size-6 shrink-0
                  items-center justify-center rounded-badge bg-chip
                  text-muted"><Receipt size={14} /></span>
                <span className="min-w-0 flex-1 truncate type-body">
                  {r.subject || t("(no subject)")}</span>
                <span className="shrink-0 type-meta text-muted">
                  {dayMonth(r.ts)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex gap-2">
          <Button className={`${ROW_BTN} flex-1`} aria-pressed={s.reminder}
            variant={s.reminder ? "secondary" : "primary"}
            disabled={busy} onClick={onRemind}>
            {s.reminder
              ? <BellRing size={16} aria-hidden className="mr-1.5 shrink-0" />
              : <BellPlus size={16} aria-hidden className="mr-1.5 shrink-0" />}
            <span>{t(s.reminder ? "sub.remind_on" : "sub.remind")}</span>
          </Button>
          <Button variant="secondary" onClick={onIcs} className={ROW_BTN}
            aria-label={t("sub.ics_label")}>
            <CalendarPlus size={16} aria-hidden className="mr-1.5 shrink-0" />
            {t("sub.ics")}
          </Button>
        </div>
        {s.reminder && !notificationsOn && (
          <div className="type-meta text-muted">
            {t("sub.remind_off_device")}{" "}
            <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
              onClick={onNotifications}>{t("sub.remind_turn_on")}</button>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className={`${ROW_BTN} flex-1`}
            aria-pressed={s.kept} disabled={busy} onClick={onKeep}>
            {s.kept
              ? <PinOff size={16} aria-hidden className="mr-1.5 shrink-0" />
              : <Pin size={16} aria-hidden className="mr-1.5 shrink-0" />}
            <span>{t(s.kept ? "sub.kept" : "sub.keep")}</span>
          </Button>
          <Button variant="secondary" className={`${ROW_BTN} flex-1`}
            disabled={busy} onClick={onHide}>
            <span>{t(s.hidden ? "sub.bring_back" : "sub.not_sub")}</span>
          </Button>
        </div>
        <p className="type-meta text-muted">
          {t("sub.cant_cancel")}{" "}
          <button type="button" className={`${LINK_ACCENT} coarse:min-h-11`}
            onClick={() => onOpenReceipt(0)}>{t("sub.open_latest")}</button>
          {t("sub.cant_cancel_post")}
        </p>
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="type-title2 tabular-nums">{value}</div>
      <div className="type-meta text-muted">{label}</div>
    </div>
  );
}

/** One square per month (per year) since the run began: a receipt came
 *  (filled) or not (dim); the next expected one is outlined. */
function Rhythm({ s }: { s: Subscription }) {
  const yearly = s.cadence === "yearly";
  const start = yearly
    ? String(new Date(s.slots_from * 1000).getFullYear())
    : monthYear(s.slots_from);
  const mid = s.slots.length >= 6 && !yearly
    ? monthShort(s.last, nowDate()) : "";
  const next = dayMonth(s.next);
  return (
    <div>
      <div role="img" className="flex items-center gap-1"
        aria-label={t("sub.rhythm_label", { n: s.receipts, next })}>
        {s.slots.map((on, i) => (
          // 3 px corners: a token radius (6) would turn a 12 px square round
          <i key={i} aria-hidden className={`aspect-square min-w-0 max-w-4
            flex-1 rounded-[3px] ${on ? "bg-accent" : "bg-chip"}`} />
        ))}
        <i aria-hidden className="aspect-square min-w-0 max-w-4 flex-1
          rounded-[3px] border-2 border-accent" />
      </div>
      <div aria-hidden className="mt-1 flex justify-between gap-2 type-meta
        text-muted">
        <span>{start}</span>
        <span>{mid}</span>
        <span>{t("sub.next_label", { date: next })}</span>
      </div>
    </div>
  );
}

/** The two sentences under "Looks unused.": what the latest sign of use
 *  was, and how many of their other mails came since without being opened. */
export function unusedText(s: Subscription): string {
  const u = s.use;
  const name = s.name;
  const n = u.others ?? 0;
  const first = u.state === "never" ? t("sub.unused_never", { name })
    : t(u.since === "signin" ? "sub.unused_signin" : "sub.unused_read",
      { name, date: dayMonth(u.ts) });
  if (!n) return first;
  const then = t(u.state === "never" ? "sub.unused_of" : "sub.unused_since",
    { n, read: 0 });
  return `${first} ${then}`;
}
