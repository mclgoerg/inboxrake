/* The Weekly check-in: a guided pass, once a week, through the places that
 * need you.
 *
 * The server says which places have something (GET /api/checkin - the same
 * count as the Overview line, the digest button and the Monday push); the
 * stepper walks through those in a fixed order, one step each, and every step
 * hosts that place's own list and actions (CheckinSteps.tsx). Skip moves on,
 * Back goes back, closing keeps your place until the week is over (this
 * browser, per account); the last card only counts what you did. The window
 * of the new-senders / still-mailing lists is Overview's Last week card's: the
 * last 7 days, or the time since your last visit. */

import { CalendarX, CircleCheck, Hourglass, ShieldAlert, Stethoscope,
  TriangleAlert, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { addDid, clearProgress, type Did, leftActivity, loadProgress,
  minutesText, NO_DID, resumeIndex, saveProgress, SITTING_CAP_MS, summaryParts,
  weekId } from "../checkin";
import { nowMs } from "../clock";
import { t } from "../i18n";
import { windowTerm } from "../overview";
import type { CheckinPlace, CheckinResp, Group, Rule } from "../types";
import { type CheckinActions, type CheckinTarget, StepBody, type StepEnv }
  from "./CheckinSteps";
import { Button, IconTile, Loading, Modal, Notice, PanelHeader,
  type TagTone, useMediaQuery } from "./ui";

/** Icon, tone, title and the line under it, per place. */
const LOOK: Record<CheckinPlace, { icon: ReactNode; tone: TagTone;
  title: string; sub: string }> = {
  new: { icon: <UserPlus size={16} />, tone: "new", title: "checkin.p_new",
    sub: "checkin.s_new" },
  still: { icon: <TriangleAlert size={16} />, tone: "review",
    title: "checkin.p_still", sub: "checkin.s_still" },
  past: { icon: <CalendarX size={16} />, tone: "attach",
    title: "checkin.p_past", sub: "checkin.s_past" },
  waiting: { icon: <Hourglass size={16} />, tone: "review",
    title: "checkin.p_waiting", sub: "checkin.s_waiting" },
  rules: { icon: <Stethoscope size={16} />, tone: "new",
    title: "checkin.p_rules", sub: "checkin.s_rules" },
  junk: { icon: <ShieldAlert size={16} />, tone: "keep",
    title: "checkin.p_junk", sub: "checkin.s_junk" },
};

export interface WeeklyCheckinProps {
  account: string;
  /** The previous visit (ms) when Overview's Last week card shows "since your
   *  last visit"; null = the last 7 days. */
  since: number | null;
  /** The sender groups of this account, live. */
  groups: Record<string, Group>;
  /** Senders that have a Block rule. */
  blockedKeys: ReadonlySet<string>;
  rules: Rule[];
  actions: CheckinActions;
  /** Open another page for a step; the check-in closes and keeps its place. */
  navigate: (to: CheckinTarget) => void;
  onClose: () => void;
}

export function WeeklyCheckin(p: WeeklyCheckinProps) {
  const phone = useMediaQuery("(max-width: 639px)");
  const saved = useMemo(() => loadProgress(p.account, nowMs()), [p.account]);
  const [data, setData] = useState<CheckinResp | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [index, setIndex] = useState(0);
  const [went, setWent] = useState<CheckinPlace[]>(saved?.went ?? []);
  const [did, setDid] = useState<Did>(saved?.did ?? NO_DID);
  const [finished, setFinished] = useState(false);
  // open time: the sittings before this one + this one (a tab left open
  // overnight does not count for hours)
  const spent = useRef(saved?.ms ?? 0);
  const sitting = useRef(nowMs());
  const minutesNow = () => spent.current
    + Math.min(nowMs() - sitting.current, SITTING_CAP_MS);

  const steps: CheckinPlace[] = useMemo(
    () => data?.steps.map((s) => s.id) ?? [], [data]);

  // which places have something, in the window of the Last week card
  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.resolve()
      .then(() => api.checkin(p.since === null ? null : p.since / 1000))
      .then((d) => {
        if (!live) return;
        const ids = d.steps.map((s) => s.id);
        const at = resumeIndex(ids, saved?.at ?? null);
        setData(d);
        setIndex(Math.min(at, Math.max(0, ids.length - 1)));
        // the saved place has nothing left after it: the card is next
        if (ids.length && at >= ids.length) setFinished(true);
      }, () => live && setFailed(true));
    return () => { live = false; };
  }, [tries]);                       // eslint-disable-line react-hooks/exhaustive-deps

  const persist = () => {
    const at = steps[index];
    if (!at || finished) return;
    saveProgress(p.account, { week: weekId(nowMs()), at, went, did,
      ms: minutesNow() });
  };
  // the place follows every step and every confirmed action
  useEffect(persist, [index, went, did, steps, finished]);   // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { persist(); p.onClose(); };
  const finish = () => { setFinished(true); clearProgress(p.account); };
  const last = index >= steps.length - 1;
  const next = () => {
    const at = steps[index];
    setWent((w) => w.includes(at) ? w : [...w, at]);
    if (last) finish(); else setIndex(index + 1);
  };
  const skip = () => { if (last) finish(); else setIndex(index + 1); };

  const env: StepEnv = {
    groups: p.groups, blockedKeys: p.blockedKeys, rules: p.rules, phone,
    window: p.since === null ? "7d" : windowTerm("since", p.since, nowMs()),
    actions: p.actions,
    navigate: (to) => { persist(); p.navigate(to); },
    tally: (more) => setDid((d) => addDid(d, more)),
  };

  const title = data && steps.length && !finished
    ? t("checkin.step_of", { n: index + 1, total: steps.length })
    : t("checkin.title");
  let body: ReactNode;
  let footer: ReactNode = null;
  if (failed) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Notice tone="warn" className="flex-1">{t("checkin.load_failed")}</Notice>
        <Button variant="secondary" onClick={() => setTries((n) => n + 1)}>
          {t("tab.retry")}</Button>
      </div>
    );
  } else if (!data) {
    body = <Loading label={t("loading…")} />;
  } else if (!steps.length) {
    body = (
      <p data-testid="checkin-none" className="type-body text-muted">
        {t("checkin.none")}</p>
    );
    footer = (
      <Button className="max-sm:w-full"
        onClick={() => { clearProgress(p.account); p.onClose(); }}>
        {t("Close")}</Button>
    );
  } else if (finished) {
    const parts = summaryParts(did, went.length);
    const mins = Math.max(1, Math.round(minutesNow() / 60_000));
    body = (
      <section data-testid="checkin-done" aria-label={t("checkin.done_title")}
        className="space-y-3 rounded-card bg-panel2 p-4">
        <div className="flex items-center gap-3">
          <IconTile tone="safe"><CircleCheck size={16} /></IconTile>
          <h3 className="flex-1 type-heading">{t("checkin.done_title")}</h3>
          <span className="type-meta text-muted">
            {t("checkin.done_time", { n: mins })}</span>
        </div>
        <p className="type-body text-muted">
          {parts.length ? `${parts.join(" · ")}.` : t("checkin.sum_nothing")}
          {leftActivity(did) && <> {t("checkin.sum_activity")}</>}
        </p>
      </section>
    );
    footer = (
      <Button className="max-sm:w-full" onClick={p.onClose}>
        {t("Close")}</Button>
    );
  } else {
    const place = steps[index];
    const look = LOOK[place];
    const nextPlace = steps[index + 1];
    body = (<>
      <div className="flex items-center gap-3">
        <IconTile tone={look.tone}>{look.icon}</IconTile>
        <div className="min-w-0">
          <h3 className="type-heading">{t(look.title)}</h3>
          <p className="type-meta text-muted">{t(look.sub)}</p>
        </div>
      </div>
      <div key={place} data-testid={`checkin-step-${place}`}
        className="space-y-3">
        <StepBody place={place} env={env} />
      </div>
    </>);
    footer = (<>
      <Button variant="quiet" disabled={index === 0}
        onClick={() => setIndex(index - 1)}>{t("checkin.back")}</Button>
      <span className="flex-1" />
      <Button variant="secondary" onClick={skip}>{t("checkin.skip")}</Button>
      <Button onClick={next}>
        {last ? t("checkin.finish")
          : phone ? t("checkin.next")
          : t("checkin.next_to", { place: t(LOOK[nextPlace].title) })}
      </Button>
    </>);
  }

  return (
    <Modal onClose={close} size="lg" label={t("checkin.title")}>
      <PanelHeader title={title} onClose={close}
        sub={data && steps.length && !finished
          ? minutesText(data.minutes) : undefined} />
      {data && steps.length > 0 && !finished && (
        <div role="progressbar" aria-valuemin={1} aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          aria-label={t("checkin.progress", { n: index + 1,
            total: steps.length, place: t(LOOK[steps[index]].title) })}
          className="flex gap-1.5 px-4 pt-3 sm:px-5">
          {steps.map((id, i) => (
            <span key={id} aria-hidden data-state={i < index ? "done"
              : i === index ? "now" : "todo"}
              className={`h-1.5 flex-1 rounded-full ${i < index
                ? "bg-safe-fg" : i === index ? "bg-accent" : "bg-chip"}`} />
          ))}
        </div>
      )}
      {/* from sm up a step keeps a floor, so the dialog does not jump in height
          as the person moves between a short list and a long one */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:min-h-96
        sm:p-5">
        {body}
      </div>
      {footer && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3
          sm:px-5">{footer}</div>
      )}
    </Modal>
  );
}
