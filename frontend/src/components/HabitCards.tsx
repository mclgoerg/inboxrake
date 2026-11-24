import { Archive, ChevronRight, FolderInput, History, MailOpen,
  Repeat, ScanSearch, Trash2, WandSparkles } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import { habitDate, habitEvidence, habitRuleName, habitTitle } from "../habits";
import type { Habit } from "../types";
import { Avatar, Button, IconTile, Modal, PanelHeader, Spinner,
  useMediaQuery, useOptionalToast, type TagTone } from "./ui";

/** The tile and its tone per action (the board: trash red, move blue, mark
 *  read green). */
const ACTION_TILE: Record<Habit["action"], { tone: TagTone; icon: ReactNode }> = {
  trash: { tone: "keep", icon: <Trash2 size={16} /> },
  archive: { tone: "attach", icon: <Archive size={16} /> },
  move: { tone: "info", icon: <FolderInput size={16} /> },
  mark_read: { tone: "safe", icon: <MailOpen size={16} /> },
};

/** A word-sized building block of the rule sentence. */
function Chip({ children, danger = false }: {
  children: ReactNode; danger?: boolean;
}) {
  return (
    <span className={`inline-block max-w-full rounded-control px-2 py-0.5
      type-body font-medium break-words ${danger ? "bg-review-bg text-review-fg"
      : "bg-chip text-body"}`}>{children}</span>
  );
}

/** The rule a suggestion stands for, in the app's own sentence: "When Deals
 *  Daily then move to Trash if older than 7 days · weekly". */
function HabitSentence({ h }: { h: Habit }) {
  const older = h.older_than_days;
  return (
    <p className="type-body leading-9 text-muted">
      <span>{t("habit.when")} </span>
      <Chip>{h.label}</Chip>
      <span> {t("rule.s_then")} </span>
      <Chip danger={h.action === "trash"}>
        {t(h.action === "move" ? "rule.act_move" : `rule.act_${h.action}`,
          { folder: h.dest_name })}</Chip>
      {older != null && <>{t("rule.ret_pre")}
        <Chip>{t("rule.ret_older", { n: older })}</Chip></>}
      {" "}
      <span className="whitespace-nowrap">
        <span aria-hidden>{"· "}</span>
        <Chip>{t(`sched.${h.schedule}`)}</Chip></span>
    </p>
  );
}

/** What making a rule / hiding a suggestion does, shared by the Rules
 *  section and the phone widget: Make it a rule creates an ordinary rule
 *  (report mode - the server always starts there) through the usual create
 *  call and runs its report once; Not this one hides the sender. */
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

function HabitCard({ h, first, busy, error, focus, onMake, onDismiss }: {
  h: Habit; first: boolean; busy: boolean; error?: string; focus: boolean;
  onMake: () => void; onDismiss: () => void;
}) {
  const tile = ACTION_TILE[h.action];
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.scrollIntoView?.({ block: "center" });
    ref.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <section ref={ref} tabIndex={-1} aria-label={habitTitle(h)}
      data-habit={h.id}
      className={`rounded-card border bg-panel2 p-3 sm:p-4 ${first || focus
        ? "border-accent" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <Avatar name={h.label} size="md" />
        <div className="min-w-0 flex-1">
          <div className="type-body font-semibold">{habitTitle(h)}</div>
          <div className="type-meta text-muted">{habitEvidence(h)}</div>
        </div>
        <IconTile tone={tile.tone}>{tile.icon}</IconTile>
      </div>
      <div className="mt-2"><HabitSentence h={h} /></div>
      {error && (
        <div role="alert" className="mt-1 type-meta text-danger-fg">{error}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 basis-full items-center gap-1.5 type-meta
          text-muted sm:flex-1 sm:basis-48">
          <ScanSearch size={14} aria-hidden className="shrink-0" />
          <span className="min-w-0">{catchText(h)}</span>
        </span>
        <Button variant="secondary" size="sm"
          className="max-sm:flex-1 coarse:min-h-11"
          disabled={busy} onClick={onDismiss}>{t("habit.not_this")}</Button>
        <Button variant={first ? "primary" : "tinted"} size="sm"
          className="max-sm:flex-1 coarse:min-h-11" disabled={busy}
          onClick={onMake}>
          {busy ? <Spinner /> : <>
            <WandSparkles size={14} aria-hidden
              className="mr-1 inline align-text-bottom" />
            {t("habit.make")}</>}
        </Button>
      </div>
    </section>
  );
}

/** "Why these?": the steps each suggestion is based on, one timeline per
 *  suggestion, and what is never suggested - nothing is a black box. */
function HabitWhy({ habits, onClose }: { habits: Habit[]; onClose: () => void }) {
  return (
    <Modal onClose={onClose} label={t("habit.why")}>
      <PanelHeader title={t("habit.why")} sub={t("habit.why_sub")}
        onClose={onClose} />
      <div className="space-y-5 p-4 sm:p-5">
        {habits.map((h) => (
          <section key={h.id} aria-label={t("habit.why_sender",
            { sender: h.label })}>
            <h3 className="mb-2 flex items-center gap-2 type-body
              font-semibold">
              <IconTile tone="neutral"><History size={14} /></IconTile>
              {t("habit.why_sender", { sender: h.label })}
            </h3>
            <ol className="ml-3 space-y-2 border-l border-line">
              {h.steps.map((s, i) => (
                <li key={`${s.ts}-${i}`} className="relative pl-4 type-body">
                  <span aria-hidden className={`absolute left-0 top-2 size-2.5
                    -translate-x-1/2 rounded-full border ${i === h.steps.length - 1
                    ? "border-accent bg-accent" : "border-faint bg-panel"}`} />
                  <b className="font-semibold">{habitDate(s.ts)}</b>
                  {" · "}{t(`habit.step_${h.action}`,
                    { n: s.n, folder: h.dest_name })}
                  {s.unread >= s.n && s.n > 0
                    ? ` · ${t("habit.all_unread")}` : ""}
                </li>
              ))}
            </ol>
          </section>
        ))}
        <p className="type-meta text-muted">
          {habits.some((h) => h.older_than_days != null)
            ? `${t("habit.why_age")} ` : ""}{t("habit.why_rest")}</p>
      </div>
    </Modal>
  );
}

/** The Rules page's "You keep doing this" section: a header with Why these?,
 *  then one card per suggestion (the first one accent-outlined). */
export function HabitSection({ habits, account, focusId, onChanged }: {
  habits: Habit[]; account: string; focusId?: string;
  onChanged: () => void;
}) {
  const { busy, err, make, dismiss } = useHabitActions(onChanged);
  const [why, setWhy] = useState(false);
  if (!habits.length) return null;
  return (
    <section aria-label={t("habit.title")} className="space-y-3">
      <div className="flex items-center gap-3">
        <IconTile tone="accent"><Repeat size={16} /></IconTile>
        <div className="min-w-0 flex-1">
          <h2 className="type-heading">{t("habit.title")}</h2>
          <p className="type-meta text-muted">
            {t("habit.sub", { account })}</p>
        </div>
        <Button variant="plain" size="sm" className="shrink-0 coarse:min-h-11"
          onClick={() => setWhy(true)}>{t("habit.why")}</Button>
      </div>
      <div className="space-y-3">
        {habits.map((h, i) => (
          <HabitCard key={h.id} h={h} first={i === 0} busy={busy === h.id}
            focus={focusId === h.id}
            error={err?.id === h.id ? err.text : undefined}
            onMake={() => make(h)} onDismiss={() => dismiss(h)} />
        ))}
      </div>
      {why && <HabitWhy habits={habits} onClose={() => setWhy(false)} />}
    </section>
  );
}

/** The phone Overview's widget: the first suggestion with both buttons, the
 *  others as rows that open the Rules page at that card. */
export function HabitWidget({ habits, onOpen, onChanged, className = "" }: {
  habits: Habit[]; onOpen: (id: string) => void; onChanged: () => void;
  className?: string;
}) {
  const phone = useMediaQuery("(max-width: 767px)");
  const { busy, err, make, dismiss } = useHabitActions(onChanged);
  if (!phone || !habits.length) return null;
  return (
    <section aria-label={t("habit.title")}
      className={`rounded-card bg-panel p-4 ${className}`}>
      <h2 className="flex items-center gap-2 type-meta font-medium text-muted">
        <Repeat size={14} aria-hidden />
        <span className="flex-1">{t("habit.title")}</span>
        <span className="tabular-nums">{habits.length}</span>
      </h2>
      <ul className="mt-1">
        {habits.map((h, i) => (
          <li key={h.id} data-habit-row={h.id}
            className={`flex gap-3 py-3 ${i ? "border-t border-line" : ""}`}>
            <Avatar name={h.label} size="md" />
            <div className="min-w-0 flex-1">
              <div className="type-body-mobile font-semibold">
                {habitTitle(h)}</div>
              <div className="type-meta text-muted">
                {habitEvidence(h).split(" · ")[0]}</div>
              {i === 0 && (
                <div className="mt-2 flex gap-2">
                  <Button className="min-w-0 flex-1 coarse:min-h-11"
                    disabled={busy === h.id} onClick={() => make(h)}>
                    {busy === h.id ? <Spinner /> : t("habit.make")}</Button>
                  <Button variant="secondary" className="coarse:min-h-11"
                    disabled={busy === h.id} onClick={() => dismiss(h)}>
                    {t("habit.not_this")}</Button>
                </div>
              )}
              {i === 0 && err?.id === h.id && (
                <div role="alert" className="mt-1 type-meta text-danger-fg">
                  {err.text}</div>
              )}
            </div>
            {i > 0 && (
              <button type="button" aria-label={habitTitle(h)}
                onClick={() => onOpen(h.id)}
                className="-mr-2 flex size-11 shrink-0 items-center
                  justify-center rounded-control text-faint">
                <ChevronRight size={18} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
