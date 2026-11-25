import { BellOff, Check, Hourglass, MessageSquareReply, Undo2 }
  from "lucide-react";
import { useState, type ReactNode } from "react";
import { nowDate } from "../clock";
import { useCoarsePointer } from "../gestures";
import { t } from "../i18n";
import { LINK_TAP, dayMonth } from "../subscriptions";
import type { WaitingDetail as Detail, WaitingEvent, WaitingItem }
  from "../types";
import { atDateValue, dateValue, limitDays, nextMonday9,
  remindChoice, tomorrow9, whenText } from "../waiting";
import { Avatar, Button, Input, LINK_ACCENT, Loading, Notice, Segmented }
  from "./ui";

/** A pane button: icon and label on one line (a `Button` is a plain block). */
const ROW_BTN = "inline-flex min-w-0 items-center justify-center whitespace-nowrap";

type Dot = "past" | "mine" | "now";
const DOT: Record<Dot, string> = {
  past: "border-2 border-line bg-panel",
  mine: "border-2 border-accent bg-accent",
  now: "border-2 border-review-fg bg-review-fg",
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
 *  is - "still no answer" with the newsletters they sent since (never an
 *  answer). Only headers: dates, names and subjects. */
function Timeline({ item, detail }: { item: WaitingItem; detail: Detail }) {
  const lastOut = detail.timeline.reduce(
    (n, e, i) => e.kind === "out" ? i : n, -1);
  const text = (e: WaitingEvent) => t("waiting.ev_text", {
    who: e.kind === "out" ? t("waiting.you") : e.who,
    subject: e.subject || t("(no subject)") });
  return (
    <ol className="relative">
      {/* the line behind the dots */}
      <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px
        bg-line" />
      {detail.timeline.map((e, i) => (
        <Step key={`${e.ts}:${i}`} date={dayMonth(e.ts)}
          dot={i === lastOut && item.state !== "answered" ? "mine" : "past"}
          note={i === lastOut && item.state !== "answered"
            ? t("waiting.ev_last", { n: item.recipients }) : undefined}>
          {text(e)}
          {e.kind === "out" && e.answered_ts ? (
            <>{" · "}{t("waiting.ev_answered", { date: dayMonth(e.answered_ts) })}</>
          ) : null}
        </Step>
      ))}
      {item.state === "open" && (
        <Step dot="now" date={t("waiting.today")}>
          {t("waiting.ev_none")}
          {detail.newsletters > 0 && (
            <>{" · "}{t("waiting.ev_news", { n: detail.newsletters,
              name: item.person.name })}</>
          )}
        </Step>
      )}
    </ol>
  );
}

/** "Remind me": Tomorrow / the next Monday / a day of your own, all 09:00. A
 *  set reminder shows as the selected choice and can be cancelled. */
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
  const monday = nextMonday9(now);
  const value = picking ? "pick" : choice;
  return (
    <section aria-label={t("waiting.remind")}
      className="flex flex-col gap-2.5 rounded-card border border-line p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grow whitespace-nowrap type-body font-semibold">
          {t("waiting.remind")}</span>
        <Segmented role="radio" value={value} label={t("waiting.remind")}
          tall={coarse}
          onChange={(v) => {
            if (v === "pick") { setPicking(true); return; }
            setPicking(false);
            onRemind(v === "tomorrow" ? tomorrow9(now) : monday);
          }}
          options={[
            { value: "tomorrow" as const, label: t("waiting.rem_tomorrow") },
            { value: "monday" as const,
              label: whenText(monday, now) },
            { value: "pick" as const, label: t("waiting.rem_pick") }]} />
      </div>
      {picking && (
        <label className="flex flex-wrap items-center gap-2 type-meta
          text-muted">
          {t("waiting.rem_pick_label")}
          <Input type="date" className="w-44" disabled={busy}
            min={dateValue(tomorrow9(now))}
            value={at && choice === "pick" ? dateValue(at)
              : dateValue(tomorrow9(now))}
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
          {t("sub.remind_off_device")}{" "}
          <button type="button" className={`${LINK_ACCENT} ${LINK_TAP}`}
            onClick={onNotifications}>{t("sub.remind_turn_on")}</button>
        </div>
      )}
    </section>
  );
}

/** The pane of one waiting mail (beside the list from 1280 px, a dialog
 *  below): who and what, how long it has waited, the conversation, Remind me
 *  and the actions. Presentational - WaitingPanel owns the data and what the
 *  buttons do. Nothing here sends mail: you reply from your own mail app. */
export function WaitingDetail({ item, detail, failed, threshold, busy,
  notificationsOn, onRemind, onOpen, onNeeded, onNotifications }: {
  item: WaitingItem;
  /** null while it loads */
  detail: Detail | null;
  failed: boolean;
  /** Settings: the days after which a mail counts as waiting. */
  threshold: number;
  busy: boolean;
  notificationsOn: boolean;
  onRemind: (at: number | null) => void;
  onOpen: () => void;
  onNeeded: (needed: boolean) => void;
  onNotifications: () => void;
}) {
  const name = item.person.name;
  const limit = limitDays(item, threshold);
  const notice = item.state === "answered" ? (
    <Notice tone="neutral" icon={<Check size={16} aria-hidden />}>
      {(item.answered_days ?? 0) === 0
        ? t("waiting.notice_answered_same", { name })
        : t("waiting.notice_answered", { name, n: item.answered_days ?? 0 })}
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
        ? t("waiting.notice_usual", { name, n: item.usual_days,
          m: item.usual_n })
        : t("waiting.notice_rule", { n: limit })}
    </Notice>
  );
  return (
    <div className="flex min-h-full flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words type-title2">
            {item.subject || t("(no subject)")}</h2>
          <div className="break-words type-meta text-muted">
            {name} · {item.person.addr}</div>
        </div>
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
          <Button className={`${ROW_BTN} min-w-52 flex-1`} onClick={onOpen}
            disabled={!detail || !detail.sent.folder}>
            <MessageSquareReply size={16} aria-hidden
              className="mr-1.5 shrink-0" />
            <span>{t("waiting.open")}</span>
          </Button>
          {item.state === "needed" ? (
            <Button variant="secondary" className={`${ROW_BTN} min-w-44 flex-1`}
              disabled={busy} onClick={() => onNeeded(false)}>
              <Undo2 size={16} aria-hidden className="mr-1.5 shrink-0" />
              <span>{t("waiting.bring_back")}</span>
            </Button>
          ) : item.state === "open" ? (
            <Button variant="secondary" className={`${ROW_BTN} min-w-44 flex-1`}
              disabled={busy} onClick={() => onNeeded(true)}>
              <Check size={16} aria-hidden className="mr-1.5 shrink-0" />
              <span>{t("waiting.no_need")}</span>
            </Button>
          ) : null}
        </div>
        <p className="type-meta text-muted">{t("waiting.never_sends")}</p>
      </div>
    </div>
  );
}

