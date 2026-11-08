import {
  ArrowLeft, ArrowRight, ArrowUp, BellOff, Check, Layers, ShieldCheck, Trash2,
  Undo2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtSize } from "../api";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import {
  buildDeck, can, dragDecision, planOf, summarize, type Decision,
  type TriagePlan,
} from "../triage";
import type { Group, Grouping } from "../types";
import { localizedSub } from "./GroupTable";
import {
  AiTag, Avatar, Button, confirmDialog, EngagementMeter, modalCount, Modal,
  PanelHeader, ProgressBar, SectionLabel, ShortDate, StillMailingBadge, Tag,
  useIsPage,
  useMediaQuery,
} from "./ui";

const EXIT_MS = 180;
const REDUCED = "(prefers-reduced-motion: reduce)";

const unreadPct = (g: Group) =>
  g.count ? Math.round((100 * g.unread) / g.count) : 0;

/** What the stamp over a dragged card says. */
const STAMP: Record<Exclude<Decision, "protect">, string> = {
  trash: "text-danger-fg", keep: "text-safe-fg", unsub: "text-accent",
};

type Intent = Exclude<Decision, "protect">;

function Card({ g, grouping, reduced, onCommit, onIntent }: {
  g: Group; grouping: Grouping; reduced: boolean;
  onCommit: (d: Decision) => void;
  /** The direction the card is being dragged towards (null at rest). */
  onIntent: (i: Intent | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; at: number; id: number } | null>(null);
  // Every pointer currently down. A second finger voids the whole gesture
  // (its coordinates would be compared against the other finger's start)
  // until all of them are up again.
  const down_ = useRef(new Set<number>());
  const voided = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [leaving, setLeaving] = useState<{ dx: number; dy: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const allowed = (d: Decision) => can(d, g, grouping);

  const down = (e: React.PointerEvent) => {
    if (leaving || (e.button ?? 0) !== 0) return;
    if ((e.target as HTMLElement).closest("button, a")) return;
    down_.current.add(e.pointerId);
    if (down_.current.size > 1) {
      voided.current = true;
      start.current = null;
      setDrag(null);
      return;
    }
    start.current = { x: e.clientX, y: e.clientY, at: Date.now(),
      id: e.pointerId };
    el.current?.setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current || e.pointerId !== start.current.id) return;
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y });
  };
  const release = (e: React.PointerEvent) => {
    down_.current.delete(e.pointerId);
    if (!down_.current.size) voided.current = false;
  };
  const up = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || e.pointerId !== s.id || voided.current) { release(e); return; }
    start.current = null;
    release(e);
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const width = el.current?.offsetWidth || 300;
    const d = dragDecision(dx, dy, width, Date.now() - s.at, allowed);
    setDrag(null);
    if (!d) return;
    if (reduced) { onCommit(d); return; }
    // Fly out along the dominant axis, then hand the decision on.
    setLeaving(d === "unsub" ? { dx: 0, dy: -width * 2 }
      : { dx: (d === "trash" ? -1 : 1) * width * 2, dy: 0 });
    timer.current = setTimeout(() => onCommit(d), EXIT_MS);
  };
  const cancel = (e: React.PointerEvent) => {
    start.current = null;
    setDrag(null);
    release(e);
  };

  const pos = leaving ?? drag;
  const intent: Intent | null = !pos ? null
    : Math.abs(pos.dx) >= Math.abs(pos.dy)
      ? (pos.dx < 0 ? "trash" : pos.dx > 0 ? "keep" : null)
      : (pos.dy < 0 ? "unsub" : null);
  const progress = pos ? Math.min(1, Math.max(Math.abs(pos.dx),
    Math.abs(pos.dy)) / ((el.current?.offsetWidth || 300) * 0.3)) : 0;
  const shown = intent && allowed(intent) ? intent : null;
  useEffect(() => { onIntent(shown); }, [shown, onIntent]);
  useEffect(() => () => onIntent(null), [onIntent]);
  const style = pos ? {
    transform: `translate(${pos.dx}px, ${pos.dy}px) rotate(${pos.dx / 25}deg)`,
    transition: leaving ? `transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms`
      : "none",
    opacity: leaving ? 0 : 1,
  } : {
    transition: reduced ? "none" : "transform 150ms ease-out",
  };

  return (
    <div ref={el} data-testid="triage-card" style={style}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={cancel}
      className="relative w-full touch-none select-none rounded-card
        border border-line bg-panel2 p-4 shadow-popover sm:p-5">
      {intent && allowed(intent) && (
        <div aria-hidden style={{ opacity: progress }}
          className={`absolute -top-3 rounded-badge border-2 border-current bg-panel2 px-2
            py-0.5 type-heading uppercase ${STAMP[intent]}
            ${intent === "keep" ? "left-3" : "right-3"}`}>
          {t(`triage.${intent}`)}
        </div>
      )}
      <div className="flex items-start gap-3">
        <Avatar name={g.label || g.key} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="min-w-0 truncate type-heading">{g.label}</h2>
            {g.protected && (
              <ShieldCheck size={16} aria-label={t("triage.protected_label")}
                className="shrink-0 text-accent" />
            )}
          </div>
          {g.sub && (
            <div className="truncate type-meta text-muted">
              {localizedSub(g.sub)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          [g.count, t("triage.mails")],
          [fmtSize(g.size), t("triage.size")],
          [`${unreadPct(g)}%`, t("unread")],
        ].map(([v, label]) => (
          <div key={label} className="min-w-0 rounded-card bg-chip px-2 py-2">
            <div className="truncate type-heading tabular-nums">{v}</div>
            <div className="truncate type-meta text-muted">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <EngagementMeter g={g} />
        {g.still_mailing && <StillMailingBadge sm={g.still_mailing} />}
        {g.ai && <AiTag ai={g.ai} />}
        {g.unsubscribed?.status === "done" && (
          <Tag tone="safe" className="whitespace-nowrap">
            ✓ {t("Unsubscribed")}
          </Tag>
        )}
        {g.new && <Tag tone="new">🆕 {t("New")}</Tag>}
        {g.tags.slice(0, 3).map((x) => <Tag key={x}>{x}</Tag>)}
        <span className="ml-auto type-meta text-muted">
          <ShortDate iso={g.last} />
        </span>
      </div>
      {g.samples.length > 0 && (
        <ul aria-label={t("triage.latest")}
          className="mt-3 space-y-1 border-t border-line pt-3">
          {g.samples.slice(0, 3).map((s, i) => (
            <li key={i} className="truncate type-meta text-muted">{s}</li>
          ))}
        </ul>
      )}
      {g.protected && (
        <div className="mt-3 type-meta text-accent">
          {t("triage.protected_kept")}
        </div>
      )}
    </div>
  );
}

/** Round button colours per decision (disabled falls back to the chip grey). */
const DECISION_BTN: {
  d: Decision; icon: typeof Trash2; key: string; tone: string;
}[] = [
  { d: "trash", icon: Trash2, key: "triage.trash", tone: "bg-keep-bg text-keep-fg" },
  { d: "unsub", icon: BellOff, key: "triage.unsub", tone: "bg-info-bg text-info-fg" },
  { d: "protect", icon: ShieldCheck, key: "triage.protect", tone: "bg-chip text-body" },
  { d: "keep", icon: Check, key: "triage.keep", tone: "bg-safe-bg text-safe-fg" },
];

/** The direction hints beside the deck (a decision the card does not allow
 *  is not offered, as with the buttons and the swipe). */
const HINTS: { d: Intent; icon: typeof ArrowUp; tone: string; pos: string }[] = [
  { d: "trash", icon: ArrowLeft, tone: "bg-keep-bg text-keep-fg",
    pos: "left-3 top-1/2 -translate-y-1/2" },
  { d: "keep", icon: ArrowRight, tone: "bg-safe-bg text-safe-fg",
    pos: "right-3 top-1/2 -translate-y-1/2" },
  { d: "unsub", icon: ArrowUp, tone: "bg-info-bg text-info-fg",
    pos: "left-1/2 top-3 -translate-x-1/2" },
];

/** One group per card: Trash / Keep / Unsubscribe / Protect. Decisions only
 *  accumulate here; `onApply` (the parent's single confirm + the existing
 *  protect / unsubscribe / trash paths) is the only thing that acts. */
export function TriagePanel({ groups, grouping, onApply, onClose }: {
  groups: Group[]; grouping: Grouping;
  /** Resolves true when applied (the panel then closes itself). */
  onApply: (plan: TriagePlan) => Promise<boolean>;
  onClose: () => void;
}) {
  // The deck is fixed when the panel opens; a refresh behind it never
  // reshuffles the cards.
  const [deck] = useState(() => buildDeck(groups));
  const byKey = useMemo(
    () => Object.fromEntries(deck.map((g) => [g.key, g])), [deck]);
  const [idx, setIdx] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [history, setHistory] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const isPage = useIsPage();
  const reduced = useMediaQuery(REDUCED);

  const finished = idx >= deck.length;
  const summaryOpen = review || finished;
  const g = deck[idx];
  const sum = summarize(decisions, byKey);
  const plan = planOf(decisions, deck, grouping);

  const decide = (d: Decision) => {
    if (!g || summaryOpen || !can(d, g, grouping)) return;
    setDecisions((m) => ({ ...m, [g.key]: d }));
    setHistory((h) => [...h.filter((k) => k !== g.key), g.key]);
    setIdx(idx + 1);
  };
  const undo = () => {
    const key = history[history.length - 1];
    if (key === undefined) return;
    setHistory(history.slice(0, -1));
    setDecisions(({ [key]: _gone, ...rest }) => rest);
    setIdx(deck.findIndex((x) => x.key === key));
    setReview(false);
  };
  // Set while the discard prompt is up: it is a dialog on top of this one,
  // and the arrow keys must not decide cards behind it.
  const prompting = useRef(false);
  const close = async () => {
    if (busy || prompting.current) return;
    if (sum.actions > 0) {
      prompting.current = true;
      const ok = await confirmDialog({
        title: t("triage.discard_title", { n: sum.actions }),
        body: t("triage.discard_body"), tone: "danger",
        confirmLabel: t("triage.discard") });
      prompting.current = false;
      if (!ok) return;
    }
    onClose();
  };
  const apply = async () => {
    setBusy(true);
    try { if (await onApply(plan)) onClose(); }
    finally { setBusy(false); }
  };

  // Keys act on the window (the dialog itself holds focus, not a field).
  const handler = useRef<(e: KeyboardEvent) => void>(undefined);
  handler.current = (e) => {
    if (e.defaultPrevented || summaryOpen || busy || prompting.current
        || e.ctrlKey || e.metaKey
        || e.altKey) return;
    // Not for a dialog opened over this panel (its own Modal is the one
    // entry on the stack unless it is a page), nor for a text field.
    if (modalCount() > (isPage ? 0 : 1)) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest?.('input, select, textarea, [contenteditable]'
      + ':not([contenteditable="false"])')) return;
    const map: Record<string, Decision | "undo"> = {
      ArrowLeft: "trash", ArrowRight: "keep", ArrowUp: "unsub",
      Backspace: "undo",
    };
    const act = map[e.key];
    if (!act) return;
    e.preventDefault();
    if (act === "undo") undo(); else decide(act);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => handler.current?.(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const parts = [
    sum.trash.groups > 0 && t("triage.s_trash",
      { n: sum.trash.groups, size: fmtSize(sum.trash.size) }),
    sum.unsub > 0 && t("triage.s_unsub", { n: sum.unsub }),
    sum.protect > 0 && t("triage.s_protect", { n: sum.protect }),
  ].filter(Boolean);
  const line = parts.length ? parts.join(" · ") : t("triage.nothing_yet");

  /** Decision counts as chips (decorative: the status line says it in words). */
  const tally = (<>
          <Tag tone={sum.trash.groups ? "keep" : "neutral"}>
            <Trash2 size={14} className="mr-1 inline align-text-bottom" />
            {fmtNum(sum.trash.groups)}
          </Tag>
          <Tag tone={sum.keep ? "safe" : "neutral"}>
            <Check size={14} className="mr-1 inline align-text-bottom" />
            {fmtNum(sum.keep)}
          </Tag>
          <Tag tone={sum.unsub ? "info" : "neutral"}>
            <BellOff size={14} className="mr-1 inline align-text-bottom" />
            {fmtNum(sum.unsub)}
          </Tag>
          <Tag tone="neutral">
            <ShieldCheck size={14} className="mr-1 inline align-text-bottom" />
            {fmtNum(sum.protect)}
          </Tag>
  </>);

  return (
    <Modal full label={t("triage.title")} onClose={close}>
      <PanelHeader title={<><Layers size={18} aria-hidden
        className="mr-1.5 inline align-text-bottom" />{t("triage.title")}</>}
        sub={summaryOpen ? t("triage.summary_title")
          : t("triage.progress", { n: idx + 1, total: deck.length })}
        actions={!summaryOpen && (<>
          <span aria-hidden className="mr-2 hidden items-center gap-1.5 lg:flex">
            {tally}
          </span>
          <Button variant={sum.actions > 0 ? "primary" : "secondary"} size="sm"
            onClick={() => setReview(true)}>
            {sum.actions > 0 ? t("triage.apply_decisions", { n: sum.actions })
              : t("triage.done")}
          </Button>
        </>)}
        onClose={close} />
      <ProgressBar thin value={idx} max={deck.length} />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line
        px-4 py-2 max-lg:border-b lg:sr-only">
        <span role="status" className="sr-only">{line}</span>
        <span aria-hidden className="contents lg:hidden">{tally}</span>
      </div>
      {summaryOpen ? (
        <div data-scroll-id="panel" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <SectionLabel>{t("triage.summary_title")}</SectionLabel>
          {sum.actions === 0 ? (
            <p className="type-body text-muted">{t("triage.nothing_to_apply")}</p>
          ) : (
            <ul className="space-y-2 type-body">
              {plan.trash.length > 0 && (
                <li><Trash2 size={16} aria-hidden
                  className="mr-1.5 inline align-text-bottom" />
                  {t("triage.s_trash_mails", { n: sum.trash.groups,
                    mails: sum.trash.mails, size: fmtSize(sum.trash.size) })}
                </li>
              )}
              {plan.unsub.length > 0 && (
                <li><X size={16} aria-hidden
                  className="mr-1.5 inline align-text-bottom" />
                  {t("triage.s_unsub_long", { n: plan.unsub.length })}</li>
              )}
              {plan.protect.length > 0 && (
                <li><ShieldCheck size={16} aria-hidden
                  className="mr-1.5 inline align-text-bottom" />
                  {t("triage.s_protect_long", { n: plan.protect.length })}</li>
              )}
            </ul>
          )}
          <p className="type-meta text-muted">
            {sum.keep > 0 && t("triage.kept_note", { n: sum.keep })}
            {!finished && " " + t("triage.unseen_note",
              { n: deck.length - idx })}
          </p>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col items-center
          justify-center gap-3 overflow-hidden p-4">
          <div className="relative mb-16 w-full max-w-md">
            {/* The deck: the next two cards peek out from under this one. */}
            {[2, 1].filter((n) => idx + n < deck.length).map((n) => (
              <div key={n} aria-hidden
                className="pointer-events-none absolute inset-0 rounded-card
                  border border-line bg-chiph shadow-popover"
                style={{ transform: `translateY(${n * 30}px) scale(${1 - n * 0.05})`,
                  opacity: 1 - n * 0.25 }} />
            ))}
            <Card key={g.key} g={g} grouping={grouping} reduced={reduced}
              onCommit={decide} onIntent={setIntent} />
          </div>
          <p className="mt-4 max-w-sm text-center type-meta text-muted">
            {t("triage.hint")}
          </p>
          {/* Direction hints (not on phones: the stamp on the card is enough). */}
          {HINTS.filter(({ d }) => can(d, g, grouping)).map(
            ({ d, icon: Icon, tone, pos }) => (
              <span key={d} aria-hidden
                className={`pointer-events-none absolute hidden rounded-full px-3
                  py-1.5 type-meta font-medium sm:block ${tone} ${pos}
                  ${intent === d ? "ring-2 ring-current" : ""}`}>
                <Icon size={14} className="mr-1 inline align-text-bottom" />
                {t(`triage.${d}`)}
              </span>
            ))}
        </div>
      )}
      <div className="border-t border-line px-4 py-3 sm:px-5
        max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {summaryOpen ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy || !deck.length}
              onClick={() => {
                // At the end: reopen the last card, keeping its decision.
                if (finished) setIdx(deck.length - 1);
                setReview(false);
              }}>
              {t("triage.back")}
            </Button>
            <Button disabled={busy || sum.actions === 0} onClick={apply}>
              {t("triage.apply")}
            </Button>
          </div>
        ) : (
          <div className="flex items-start justify-center gap-3 sm:gap-5">
            <button type="button" aria-label={t("triage.undo")}
              disabled={!history.length} onClick={undo}
              className="group mt-1.5 flex min-w-0 cursor-pointer flex-col
                items-center gap-1 disabled:cursor-not-allowed">
              <span className="flex size-11 items-center justify-center
                rounded-full bg-chip text-body transition-transform
                group-enabled:group-active:scale-95 group-disabled:text-faint">
                <Undo2 size={18} aria-hidden />
              </span>
              <span aria-hidden className="type-caption text-muted">
                {t("triage.undo_short")}
              </span>
            </button>
            {DECISION_BTN.map(({ d, icon: Icon, key, tone }) => (
              <button key={d} type="button" disabled={!can(d, g, grouping)}
                title={d === "trash" && g.protected
                  ? t("triage.protected_kept") : undefined}
                onClick={() => decide(d)}
                className="group flex min-w-0 cursor-pointer flex-col
                  items-center gap-1 disabled:cursor-not-allowed">
                <span className={`flex size-14 items-center justify-center
                  rounded-full transition-transform group-enabled:group-active:scale-95
                  sm:size-16 ${tone} group-disabled:bg-chip
                  group-disabled:text-faint`}>
                  <Icon size={18} aria-hidden />
                </span>
                <span className="type-caption text-muted">{t(key)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
