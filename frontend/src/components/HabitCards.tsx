import { Info, ListChecks, Repeat, ScanSearch } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import { habitDate, habitEvidence, habitPlain, habitRuleName, habitStepNote,
  habitTitle } from "../habits";
import type { Habit } from "../types";
import { Avatar, Button, LINK_ACCENT, Modal, PanelHeader, Spinner,
  useOptionalToast } from "./ui";

/** What making a rule / hiding a suggestion does, shared by every place that
 *  offers it: Make it a rule creates an ordinary rule (the server always
 *  starts it in Report only) through the usual create call and runs its
 *  report once; Not this one hides the sender. */
export function useHabitActions(onChanged: () => void) {
  const toast = useOptionalToast();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ id: string; text: string } | null>(null);
  const make = async (h: Habit) => {
    setBusy(h.id);
    setErr(null);
    try {
      const rule = await api.createRule({ name: habitRuleName(h), ...h.rule });
      try {
        await api.runRule(rule.id);
      } catch (e: any) {
        toast?.show(t("err.generic", { msg: errorText(e.message ?? e) }),
          { variant: "error" });
      }
      toast?.show(t("habit.made", { name: rule.name }),
        { variant: "success" });
    } catch (e: any) {
      setErr({ id: h.id, text: t("err.generic", { msg: e.message ?? e }) });
    } finally {
      setBusy("");
      onChanged();
    }
  };
  const dismiss = async (h: Habit) => {
    setBusy(h.id);
    setErr(null);
    try {
      await api.habitDismiss(h.key);
      toast?.show(t("habit.hidden", { sender: h.label }));
    } catch (e: any) {
      setErr({ id: h.id, text: t("err.generic", { msg: e.message ?? e }) });
    } finally {
      setBusy("");
      onChanged();
    }
  };
  return { busy, err, make, dismiss };
}

/** The "would catch" line under the sentence. */
const catchText = (h: Habit): string => h.catch == null
  ? t("habit.catch_none") : t("habit.catch_full", { n: h.catch });

/** The tile in front of the section's title (the Rule checkup's size). */
const Tile = () => (
  <span aria-hidden className="flex size-10 shrink-0 items-center
    justify-center rounded-control bg-chip text-accent">
    <Repeat size={18} />
  </span>
);

/** One suggestion on a wide screen: who, what you did, the rule as the
 *  sentence of a rule card, what it would catch, and the two answers. */
function HabitCard({ h, first, busy, error, focus, sentence, onMake,
  onDismiss }: {
  h: Habit; first: boolean; busy: boolean; error?: string; focus: boolean;
  sentence: ReactNode; onMake: () => void; onDismiss: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.scrollIntoView?.({ block: "center" });
    ref.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <section ref={ref} tabIndex={-1} aria-label={habitTitle(h)}
      data-habit={h.id}
      className={`rounded-card border bg-panel p-3 sm:p-4 ${first || focus
        ? "border-accent" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <Avatar name={h.label} size="md" />
        <div className="min-w-0 flex-1">
          <div className="type-body font-semibold">{habitTitle(h)}</div>
          <div className="type-meta text-muted">{habitEvidence(h)}</div>
        </div>
      </div>
      {sentence}
      {error && (
        <div role="alert" className="mt-1 type-meta text-danger-fg">{error}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 basis-full items-center gap-1.5 type-meta
          text-muted sm:flex-1 sm:basis-48">
          <ScanSearch size={14} aria-hidden className="shrink-0" />
          <span className="min-w-0">{catchText(h)}</span>
        </span>
        <Button variant="plain" size="sm" className="coarse:min-h-11"
          disabled={busy} onClick={onDismiss}>{t("habit.not_this")}</Button>
        <Button size="sm" className="coarse:min-h-11" disabled={busy}
          onClick={onMake}>
          {busy ? <Spinner /> : <>
            <ListChecks size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
            {t("habit.make")}</>}
        </Button>
      </div>
    </section>
  );
}

/** One suggestion on a phone: the title, the rule in plain words with what
 *  it would catch, and the two answers as big buttons. */
function HabitPhoneBlock({ h, busy, error, focus, onMake, onDismiss }: {
  h: Habit; busy: boolean; error?: string; focus: boolean;
  onMake: () => void; onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.scrollIntoView?.({ block: "center" });
    ref.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <div ref={ref} tabIndex={-1} data-habit={h.id}
      className={`space-y-2 rounded-control py-3 first:pt-1 ${focus
        ? "ring-1 ring-accent" : ""}`}>
      <div className="type-body-mobile font-semibold">{habitTitle(h)}</div>
      <div className="type-meta text-muted">{habitPlain(h)}</div>
      {error && (
        <div role="alert" className="type-meta text-danger-fg">{error}</div>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" className="min-w-0 flex-1 coarse:min-h-11"
          disabled={busy} onClick={onDismiss}>{t("habit.not_this")}</Button>
        <Button className="min-w-0 flex-1 coarse:min-h-11" disabled={busy}
          onClick={onMake}>
          {busy ? <Spinner /> : t("habit.make")}</Button>
      </div>
    </div>
  );
}

/** "Why these?": every step each suggestion is based on, with its date, and
 *  what never counts - nothing is a black box. With one suggestion it is
 *  that one's "Why <sender>?". */
function HabitWhy({ habits, onClose }: { habits: Habit[]; onClose: () => void }) {
  const one = habits.length === 1 ? habits[0] : null;
  const title = one ? t("habit.why_sender", { sender: one.label })
    : t("habit.why");
  return (
    <Modal onClose={onClose} label={title}>
      <PanelHeader title={title} sub={t("habit.why_sub")} onClose={onClose} />
      <div className="space-y-4 p-4 sm:p-5">
        {habits.map((h) => (
          <section key={h.id} aria-label={t("habit.why_sender",
            { sender: h.label })}>
            {!one && (
              <h3 className="mb-2 type-body font-semibold">
                {t("habit.why_sender", { sender: h.label })}</h3>
            )}
            <ol className="divide-y divide-line rounded-card border
              border-line">
              {h.steps.map((s, i) => (
                <li key={`${s.ts}-${i}`} data-testid="habit-step"
                  className="flex items-center gap-3 px-3 py-2 type-body">
                  <b className="w-14 shrink-0 font-semibold">
                    {habitDate(s.ts)}</b>
                  <span className="min-w-0 flex-1">{t(`habit.step_${h.action}`,
                    { n: s.n, folder: h.dest_name })}</span>
                  <span className="shrink-0 type-meta text-muted">
                    {habitStepNote(h, s)}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
        <p className="flex items-start gap-2 rounded-card bg-chip p-3 type-meta
          text-muted">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {t("habit.why_rest")}
            {habits.some((h) => h.older_than_days != null)
              ? ` ${t("habit.why_age")}` : ""}</span>
        </p>
      </div>
    </Modal>
  );
}

/** The Rules page's "You keep doing this" card, after the Rule checkup and
 *  before the rules: a header with Why these?, then one suggestion each (the
 *  first accent-outlined). On a phone one box with each suggestion in plain
 *  words. `renderSentence` draws the rule the way the rule cards do. */
export function HabitSection({ habits, phone, focusId, renderSentence,
  onChanged }: {
  habits: Habit[]; phone: boolean; focusId?: string;
  renderSentence: (h: Habit) => ReactNode;
  onChanged: () => void;
}) {
  const { busy, err, make, dismiss } = useHabitActions(onChanged);
  const [why, setWhy] = useState(false);
  if (!habits.length) return null;
  const title = t("habit.title");
  const sub = t("habit.sub");
  return (
    <section aria-label={title} data-testid="habit-card"
      className="rounded-card border border-line bg-panel2 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <Tile />
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="type-body font-medium">
            {phone ? title : t("habit.title_n", { n: habits.length })}</h3>
          {!phone && <div className="type-meta text-muted">{sub}</div>}
        </div>
        <button type="button" className={`${LINK_ACCENT} type-meta
          coarse:min-h-11`} onClick={() => setWhy(true)}>
          {t("habit.why")}</button>
      </div>
      {phone ? (
        <div className="divide-y divide-line">
          {habits.map((h) => (
            <HabitPhoneBlock key={h.id} h={h} busy={busy === h.id}
              focus={focusId === h.id}
              error={err?.id === h.id ? err.text : undefined}
              onMake={() => make(h)} onDismiss={() => dismiss(h)} />
          ))}
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {habits.map((h, i) => (
            <HabitCard key={h.id} h={h} first={i === 0} busy={busy === h.id}
              focus={focusId === h.id} sentence={renderSentence(h)}
              error={err?.id === h.id ? err.text : undefined}
              onMake={() => make(h)} onDismiss={() => dismiss(h)} />
          ))}
        </div>
      )}
      {why && <HabitWhy habits={habits} onClose={() => setWhy(false)} />}
    </section>
  );
}
