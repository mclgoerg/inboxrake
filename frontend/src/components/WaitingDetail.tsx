import { BellOff, Check, Hourglass, MessagesSquare, User, X }
  from "lucide-react";
import { useState, type ReactNode } from "react";
import { nowDate } from "../clock";
import { useCoarsePointer } from "../gestures";
import { t } from "../i18n";
import { LINK_TAP, dayMonth } from "../subscriptions";
import type { WaitingDetail as Detail, WaitingEvent, WaitingItem }
  from "../types";
import { atDateValue, dateValue, remindChoice, remindTimes, tomorrowLabel,
  weekdayName, whenText } from "../waiting";
import { Avatar, Button, Input, LINK_ACCENT, Loading, Notice, Segmented }
  from "./ui";

/** A pane button: icon and label on one line (a `Button` is a plain block). */
const ROW_BTN = "inline-flex min-w-0 items-center justify-center whitespace-nowrap";

type Dot = "past" | "mine" | "now";
const DOT: Record<Dot, string> = {
  past: "border-2 border-line bg-panel",
  mine: "border-2 border-accent bg-accent",
  now: "border-2 border-accent bg-accent",
};

/** One row of the conversation: a dot on the line, the date in bold, then
 *  who said what. */
function Step({ dot, date, children, note }: {
  dot: Dot; date: string; children: ReactNode; note?: ReactNode;
}) {
  return (
    <li className="relative pb-3 pl-6 last:pb-0">
      <span aria-hidden className={`absolute left-0 top-1 size-3 rounded-full
        ${DOT[dot]}`} />
      <div className="type-body">
        <b className="font-semibold">{date}</b>{" · "}{children}
      </div>
      {note && <div className="type-meta text-muted">{note}</div>}
    </li>
  );
}

/** The conversation as the board draws it: what each side wrote, whether
 *  your mail was answered, the mail that is waiting and - while it still
 *  is - "no answer for N days" with what they usually take. Only headers:
 *  dates, names and subjects. */
function Timeline({ item, detail }: { item: WaitingItem; detail: Detail }) {
  const lastOut = detail.timeline.reduce(
    (n, e, i) => e.kind === "out" ? i : n, -1);
  const text = (e: WaitingEvent) => t("waiting.ev_text", {
    who: e.kind === "out" ? t("waiting.you") : e.who || t("waiting.they"),
    subject: e.subject || t("(no subject)") });
  const answeredNote = (e: WaitingEvent) => {
    if (e.kind !== "out" || !e.answered_ts) return undefined;
    const n = Math.max(0, Math.floor((e.answered_ts - e.ts) / 86400));
    return n === 0 ? t("waiting.ev_answered_same")
      : t("waiting.ev_answered", { n });
  };
  return (
    <ol className="relative">
      {/* the line behind the dots */}
      <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px
        bg-line" />
      {detail.timeline.map((e, i) => {
        const last = i === lastOut && item.state !== "answered";
        return (
          <Step key={`${e.ts}:${i}`} date={dayMonth(e.ts)}
            dot={last ? "mine" : "past"}
            note={last ? t("waiting.ev_last", { n: item.recipients })
              : answeredNote(e)}>
            {text(e)}
          </Step>
        );
      })}
      {item.state === "open" && (
        <Step dot="now" date={t("waiting.today")}
          note={<>
            {item.usual_days !== null
              ? t("waiting.ev_usual", { n: item.usual_days, m: item.usual_n })
              : t("waiting.ev_rule", { n: item.limit_days })}
            {detail.newsletters > 0 && (
              <div>{t("waiting.ev_news", { n: detail.newsletters })}</div>
            )}
          </>}>
          {item.days === 0 ? t("waiting.ev_none_today")
            : t("waiting.ev_none", { n: item.days })}
        </Step>
      )}
    </ol>
  );
}

/** "Remind me": Tomorrow 09:00 / the next Monday / In a week / a day of your
 *  own, all 09:00. A set reminder shows as the selected choice and can be
 *  cancelled. */
function Remind({ item, busy, notificationsOn, onRemind, onNotifications }: {
  item: WaitingItem;
  busy: boolean;
  notificationsOn: boolean;
  onRemind: (at: number | null) => void;
  onNotifications: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const coarse = useCoarsePointer();
  const now = nowDate();
  const at = item.reminder?.at ?? null;
  const choice = at === null ? null : remindChoice(at, now);
  const times = remindTimes(now);
  const value = picking ? "pick" : choice;
  const options = [
    { value: "tomorrow" as const, label: tomorrowLabel(times.tomorrow) },
    ...(times.monday !== null ? [{ value: "monday" as const,
      label: weekdayName(times.monday) }] : []),
    { value: "week" as const, label: t("waiting.rem_week") },
    { value: "pick" as const, label: t("waiting.rem_pick") }];
  return (
    <section aria-label={t("waiting.remind")}
      className="flex flex-col gap-2.5 rounded-card border border-line p-3">
      <span className="type-body font-semibold">{t("waiting.remind")}</span>
      <Segmented role="radio" value={value} label={t("waiting.remind")}
        tall={coarse} fill className="flex-wrap"
        onChange={(v) => {
          if (v === "pick") { setPicking(true); return; }
          setPicking(false);
          onRemind(v === "tomorrow" ? times.tomorrow
            : v === "monday" ? times.monday! : times.week);
        }}
        options={options} />
      {picking && (
        <label className="flex flex-wrap items-center gap-2 type-meta
          text-muted">
          {t("waiting.rem_pick_label")}
          <Input type="date" className="w-44" disabled={busy}
            min={dateValue(times.tomorrow)}
            value={at && choice === "pick" ? dateValue(at)
              : dateValue(times.tomorrow)}
            onChange={(e) => {
              const picked = atDateValue(e.target.value);
              if (picked !== null) { setPicking(false); onRemind(picked); }
            }} />
        </label>
      )}
      {at !== null ? (
        <div className="flex flex-wrap items-center gap-x-2 type-meta
          text-muted">
          <span>{t("waiting.rem_set", { when: whenText(at, now) })}</span>
          <button type="button" disabled={busy}
            className={`${LINK_ACCENT} ${LINK_TAP}`}
            onClick={() => { setPicking(false); onRemind(null); }}>
            {t("waiting.rem_cancel")}</button>
        </div>
      ) : (
        <div className="type-meta text-muted">{t("waiting.rem_hint")}</div>
      )}
      {at !== null && !notificationsOn && (
        <div className="type-meta text-muted">
          {t("waiting.rem_off_device")}{" "}
          <button type="button" className={`${LINK_ACCENT} ${LINK_TAP}`}
            onClick={onNotifications}>{t("waiting.rem_turn_on")}</button>
        </div>
      )}
    </section>
  );
}

/** The pane of one waiting mail (beside the list from 1280 px, a dialog
 *  below): who and what, how long it has waited, the conversation, Remind me
 *  and the actions. Presentational - WaitingPanel owns the data and what the
 *  buttons do. Nothing here sends mail: you reply from your own mail app. */
export function WaitingDetail({ item, detail, failed, busy, notificationsOn,
  hasSender, onClose, onRemind, onOpen, onOpenSender, onNeeded,
  onNotifications }: {
  item: WaitingItem;
  /** null while it loads */
  detail: Detail | null;
  failed: boolean;
  busy: boolean;
  notificationsOn: boolean;
  /** The person has a sender page in this mailbox (mail from them was
   *  scanned): Open sender works. */
  hasSender: boolean;
  /** The pane's own close (the wide layout only). */
  onClose?: () => void;
  onRemind: (at: number | null) => void;
  onOpen: () => void;
  onOpenSender: () => void;
  onNeeded: (needed: boolean) => void;
  onNotifications: () => void;
}) {
  const notice = item.state === "answered" ? (
    <Notice tone="neutral" icon={<Check size={16} aria-hidden />}>
      {(item.answered_days ?? 0) === 0
        ? t("waiting.notice_answered_same")
        : t("waiting.notice_answered", { n: item.answered_days ?? 0 })}
    </Notice>
  ) : item.state === "needed" ? (
    <Notice tone="neutral" icon={<BellOff size={16} aria-hidden />}>
      {t("waiting.notice_needed")}
    </Notice>
  ) : (
    <Notice tone={item.overdue ? "warn" : "neutral"}
      icon={<Hourglass size={16} aria-hidden />}>
      <b>{t(item.days === 0 ? "waiting.notice_today" : "waiting.notice_head",
        { n: item.days })}</b>{" "}
      {item.usual_days !== null
        ? t("waiting.notice_usual", { n: item.usual_days, m: item.usual_n })
        : t("waiting.notice_rule", { n: item.limit_days })}
    </Notice>
  );
  return (
    <div className="flex min-h-full flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={item.person.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words type-title2">
            {item.subject || t("(no subject)")}</h2>
          <div className="break-words type-meta text-muted">
            {item.person.addr}</div>
        </div>
        {onClose && (
          <Button variant="quiet" size="icon" label={t("Close")}
            onClick={onClose}><X size={18} /></Button>
        )}
      </div>

      {notice}

      <section aria-label={t("waiting.conversation")}>
        <div className="mb-2 type-section">{t("waiting.conversation")}</div>
        {detail ? <Timeline item={item} detail={detail} />
          : failed ? <p className="type-meta text-muted">
            {t("waiting.load_failed")}</p>
          : <Loading />}
      </section>

      {item.state === "open" && (
        <Remind item={item} busy={busy} notificationsOn={notificationsOn}
          onRemind={onRemind} onNotifications={onNotifications} />
      )}

      <div className="mt-auto flex flex-col gap-2">
        {/* side by side when the pane is wide enough, else one under the other */}
        <div className="flex flex-wrap gap-2">
          <Button className={`${ROW_BTN} min-w-40 flex-1`} onClick={onOpen}
            disabled={!detail || !detail.sent.folder}>
            <MessagesSquare size={16} aria-hidden
              className="mr-1.5 shrink-0" />
            <span>{t("waiting.open")}</span>
          </Button>
          {item.state === "needed" ? (
            <Button variant="secondary" className={`${ROW_BTN} min-w-40 flex-1`}
              disabled={busy} onClick={() => onNeeded(false)}>
              <Check size={16} aria-hidden className="mr-1.5 shrink-0" />
              <span>{t("waiting.bring_back")}</span>
            </Button>
          ) : item.state === "open" ? (
            <Button variant="secondary" className={`${ROW_BTN} min-w-40 flex-1`}
              disabled={busy} onClick={() => onNeeded(true)}>
              <Check size={16} aria-hidden className="mr-1.5 shrink-0" />
              <span>{t("waiting.no_need")}</span>
            </Button>
          ) : null}
        </div>
        <Button variant="quiet" className={ROW_BTN} onClick={onOpenSender}
          disabled={!hasSender}>
          <User size={16} aria-hidden className="mr-1.5 shrink-0" />
          <span>{t("waiting.open_sender")}</span>
        </Button>
        {!hasSender && (
          <p className="text-center type-meta text-muted">
            {t("waiting.no_sender")}</p>
        )}
        <p className="text-center type-meta text-muted">
          {t("waiting.never_sends")}</p>
      </div>
    </div>
  );
}
