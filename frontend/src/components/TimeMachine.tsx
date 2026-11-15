import { Ban, BellOff, History, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { assistantActorName, entryText, whoLine } from "../activity";
import { api, fmtSize } from "../api";
import { nowDate } from "../clock";
import { t } from "../i18n";
import { fmtNum } from "../numfmt";
import { SESSION_GAP_MIN, atText, dayLabel, defaultBoundary, pointId,
  pointMoment, senderLine, sessionSlice, sessionTitle, timeOf, whenText,
  whereText }
  from "../timemachine";
import type { AuditEntry, Group, RestoreState, Rule, TmListing, TmPreview,
  TmSession, TmStep } from "../types";
import { ACTION_LOOK, FALLBACK_LOOK } from "./actionLook";
import { Button, Checkbox, Loading, Modal, ProgressBar, Tag, confirmDialog,
  hueFillAt, useToast } from "./ui";

/** A folder as the page names it. */
const folderName = (name: string): string =>
  name.toUpperCase() === "INBOX" ? t("Inbox") : name;

/** A step as the audit helpers want it (they only read these fields). */
const asEntry = (s: TmStep): AuditEntry =>
  ({ ...s, account: "", error: s.error ?? "" });

/** "by you · Deals Daily +4" / why it can't come back. */
function secondLine(s: TmStep, rules: Rule[],
    groups?: Record<string, Group>): string {
  const e = asEntry(s);
  const bot = assistantActorName(s.actor);
  const who = bot !== null ? t("audit.by_assistant", { name: bot })
    : whoLine(e, rules);
  let extra = "";
  if (s.status === "cant") {
    extra = s.reason === "emptied" && s.at
      ? t("tm.reason_emptied_at", { time: timeOf(s.at) })
      : t(`tm.reason_${s.reason ?? "untracked"}`);
  } else if (s.action === "unsubscribe") extra = t("tm.unsub_stays");
  else extra = senderLine(s, groups);
  return [who, extra].filter(Boolean).join(" · ");
}

/** The pill of a step above the line. */
function StepPill({ s }: { s: TmStep }) {
  if (s.status === "back")
    return <Tag tone="review"><span className="inline-flex items-center
      gap-1"><RotateCcw size={14} aria-hidden />{t("tm.comes_back")}</span></Tag>;
  if (s.status === "cant")
    return <Tag tone="neutral"><span className="inline-flex items-center
      gap-1"><Ban size={14} aria-hidden />{t("tm.cant")}</span></Tag>;
  return <Tag tone="neutral">{s.status === "undone" ? t("tm.undone")
    : t("tm.stays")}</Tag>;
}

/** One step. A button: choosing it puts the line directly below it, so it
 *  (and every step above) comes back. */
function StepRow({ s, above, rules, groups, onPick, disabled }: {
  s: TmStep; above: boolean; rules: Rule[]; groups?: Record<string, Group>;
  onPick: () => void; disabled: boolean;
}) {
  const look = ACTION_LOOK[s.action] ?? FALLBACK_LOOK;
  const Icon = look.icon;
  const text = entryText(asEntry(s), rules);
  // a bulk unsubscribe is one step (the log has one entry per sender)
  const title = s.action === "unsubscribe" && s.count > 1
    ? t("tm.unsub_many", { n: s.count }) : text.title;
  const dim = s.status === "cant" || (!above && s.status !== "back");
  return (
    <li data-tm-row className={above && s.status === "back"
      ? "bg-accent-tint" : ""}>
      <button type="button" onClick={onPick} disabled={disabled}
        aria-label={`${timeOf(s.ts)} ${title}`}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2
          text-left focus-visible:-outline-offset-2 coarse:min-h-14">
        <span className="hidden w-11 shrink-0 type-meta tabular-nums
          text-muted sm:block">{timeOf(s.ts)}</span>
        <span aria-hidden className={`grid size-9 shrink-0 place-items-center
          rounded-control ${look.tone}`}><Icon size={16} /></span>
        <span className={`min-w-0 flex-1 ${dim ? "opacity-70" : ""}`}>
          <span className="block type-body-mobile font-medium
            md:type-body">{title}</span>
          <span className="block truncate type-meta text-muted">
            <span className="sm:hidden">{timeOf(s.ts)} · </span>
            {secondLine(s, rules, groups)}
          </span>
        </span>
        {/* a phone shows the state by the tint and the second line */}
        {above && <span className="shrink-0 max-sm:sr-only">
          <StepPill s={s} /></span>}
      </button>
    </li>
  );
}

/** The restore point: a slider on the list (drag it, or Up / Down with the
 *  keyboard; a tap on a step moves it too). */
function PointLine({ moment, value, max, text, onMove, onDragStart }: {
  moment: string; value: number; max: number; text: string;
  onMove: (to: number) => void;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const to = e.key === "ArrowUp" ? value - 1
      : e.key === "ArrowDown" ? value + 1
      : e.key === "Home" ? 0 : e.key === "End" ? max : null;
    if (to === null) return;
    e.preventDefault();
    onMove(Math.max(0, Math.min(max, to)));
  };
  return (
    <li data-tm-line className="px-3 py-1.5">
      <div role="slider" tabIndex={0} aria-orientation="vertical"
        aria-label={t("tm.point_label")} aria-valuemin={0} aria-valuemax={max}
        aria-valuenow={value} aria-valuetext={text} onKeyDown={key}
        onPointerDown={onDragStart}
        // touch-none: the drag must not scroll the page on a phone
        className="flex min-h-9 cursor-grab touch-none items-center gap-2
          rounded-control text-accent focus-visible:ring-2
          focus-visible:ring-accent coarse:min-h-11 active:cursor-grabbing">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center
          rounded-full bg-accent text-on-accent">
          <History size={14} /></span>
        <span className="shrink-0 type-meta font-semibold">
          {t("tm.point", { time: moment })}</span>
        <span aria-hidden className="h-0.5 min-w-4 flex-1 bg-accent" />
        <span className="shrink-0 type-meta text-muted max-sm:hidden">
          {t("tm.point_drag")}</span>
      </div>
    </li>
  );
}

/** The sessions of the last 30 days as one bar each; the chosen one is
 *  filled. */
function SessionBars({ sessions, active, onPick, now }: {
  sessions: TmSession[]; active: number; onPick: (i: number) => void;
  now: Date;
}) {
  const max = Math.max(1, ...sessions.map((s) => s.mails));
  // oldest on the left, like a timeline
  const order = sessions.map((s, i) => ({ s, i })).reverse();
  // two sessions on one day are told apart by their time
  const days = new Map<string, number>();
  for (const { s } of order)
    days.set(dayLabel(s.start, now), (days.get(dayLabel(s.start, now)) ?? 0) + 1);
  const caption = (s: TmSession) => (days.get(dayLabel(s.start, now)) ?? 0) > 1
    ? timeOf(s.start) : dayLabel(s.start, now);
  return (
    <ul aria-label={t("tm.bars_label")} className="flex max-w-full items-end
      gap-1.5 overflow-x-auto pb-0.5">
      {order.map(({ s, i }) => (
        <li key={s.first} className="flex shrink-0 flex-col items-center gap-1">
          <button type="button" aria-pressed={i === active}
            onClick={() => onPick(i)}
            aria-label={`${dayLabel(s.start, now)} ${timeOf(s.start)}: `
              + t("tm.bar_label", { n: s.mails })}
            className="flex h-16 w-6 items-end rounded-badge
              focus-visible:ring-2 focus-visible:ring-accent coarse:w-8">
            <span className={`block w-full rounded-badge ${i === active
              ? "bg-accent" : "bg-accent/40"}`}
            // bar height = this session's share of the busiest one
            style={{ height: `${Math.max(10, (100 * s.mails) / max)}%` }} />
          </button>
          <span className={`type-caption ${i === active
            ? "font-semibold text-body" : "text-muted"}`}>
            {caption(s)}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a restore does, as the card and the confirm word it. */
function notesOf(p: TmPreview): { key: string; node: ReactNode;
  icon?: ReactNode }[] {
  const out: { key: string; node: ReactNode; icon?: ReactNode }[] = [];
  // one line per reason: how many can't come back and why
  for (const c of p.cant) {
    const why = c.reason === "emptied" && c.at
      ? t("tm.note_cant_emptied", { time: timeOf(c.at) })
      : t(`tm.note_cant_${c.reason}`);
    out.push({ key: `cant-${c.reason}`, icon: <Ban size={16} aria-hidden />,
      node: <><b>{t("tm.note_cant_head", { n: c.mails })}</b> - {why}</> });
  }
  const unsub = p.stays.find((s) => s.kind === "unsubscribe");
  if (unsub) out.push({ key: "unsub", icon: <BellOff size={16} aria-hidden />,
    node: <><b>{t("tm.note_unsub_head", { n: unsub.n })}</b> {t("tm.note_unsub_tail")}</> });
  const read = p.stays.find((s) => s.kind === "mark_read");
  if (read) out.push({ key: "read", node: t("tm.note_read", { n: read.n }) });
  const kept = p.skipped.protected + p.skipped.pinned;
  if (kept > 0) out.push({ key: "kept", node: t("tm.note_skipped", { n: kept }) });
  if (p.newer_sessions > 0) out.push({ key: "newer",
    node: t("tm.note_newer", { n: p.newer_sessions }) });
  return out;
}

/** "Pause rule “X” - it would move N of them again tonight." with the name
 *  in bold. */
function PauseLabel({ name, n }: { name: string; n: number }) {
  const [before, after] = t("tm.pause_rule", { name: "\u0000", n })
    .split("\u0000");
  return <>{before}<b>{`“${name}”`}</b>{after}</>;
}

/** Pick senders: only these come back. */
function PickSenders({ preview, groups, onClose, onGo }: {
  preview: TmPreview; groups?: Record<string, Group>; onClose: () => void;
  onGo: (addrs: string[]) => void;
}) {
  const [on, setOn] = useState<Set<string>>(
    () => new Set(preview.senders.map((s) => s.addr)));
  const [all, setAll] = useState(false);
  const total = preview.senders.reduce(
    (a, s) => a + (on.has(s.addr) ? s.mails : 0), 0);
  const shown = all ? preview.senders : preview.senders.slice(0, 5);
  const toggle = (addr: string) => setOn((prev) => {
    const next = new Set(prev);
    if (!next.delete(addr)) next.add(addr);
    return next;
  });
  return (
    <Modal size="sm" onClose={onClose} labelledBy="tm-pick-title">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div id="tm-pick-title" className="type-heading">
          {t("tm.pick_head")}</div>
        <p className="mt-1 type-meta text-muted">{t("tm.pick_hint")}</p>
        <ul className="mt-2 divide-y divide-line">
          {shown.map((s, i) => {
            const name = groups?.[s.addr]?.label || s.addr
              || t("tm.unknown_sender");
            return (
              <li key={s.addr} className="flex items-center gap-2 py-0.5">
                <Checkbox checked={on.has(s.addr)} aria-label={name}
                  onChange={() => toggle(s.addr)} />
                <span aria-hidden className={`grid size-6 shrink-0
                  place-items-center rounded-full type-caption font-semibold
                  text-on-accent ${hueFillAt(i)}`}>
                  {name.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 type-meta text-muted">
                  {t("n.mails", { n: s.mails })}</span>
              </li>
            );
          })}
        </ul>
        {preview.senders.length > 5 && (
          <Button variant="quiet" size="sm" className="mt-1"
            aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? t("tm.pick_fewer")
              : t("tm.pick_more", { n: preview.senders.length - 5 })}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t
        border-line px-4 py-3 sm:px-5">
        <Button variant="secondary" size="sm" className="mr-auto"
          onClick={() => setOn(on.size ? new Set()
            : new Set(preview.senders.map((s) => s.addr)))}>
          {on.size ? t("tm.pick_none") : t("tm.pick_every")}
        </Button>
        <Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="primary" disabled={total === 0}
          onClick={() => onGo([...on])}>
          {t("tm.pick_go", { n: total })}
        </Button>
      </div>
    </Modal>
  );
}

/** Activity's Time machine view: the last 30 days as sessions and steps, a
 *  restore point to move, what a restore would do, and the restore. */
export function TimeMachine({ rules, groups, restore, reloadKey, phone,
  onRestoreStarted }: {
  rules: Rule[];
  /** the sender groups, for the names on a step's second line */
  groups?: Record<string, Group>;
  /** the account's restore job (live, from the app state) */
  restore?: RestoreState;
  /** changes when something new was logged behind the page (an undo) */
  reloadKey?: number;
  /** below 1024 px: the page layout with the bottom button */
  phone: boolean;
  /** the job was started (the app refreshes its state) */
  onRestoreStarted?: () => void;
}) {
  const toast = useToast();
  const [listing, setListing] = useState<TmListing | null>(null);
  const [error, setError] = useState("");
  const [sessionIdx, setSessionIdx] = useState(0);
  const [boundary, setBoundary] = useState<number | null>(null);
  const [preview, setPreview] = useState<TmPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pause, setPause] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const running = restore?.status === "running";
  const now = nowDate();

  const load = useCallback(() => {
    // new steps shift the list: the line starts at its default place again
    api.timeMachine().then((l) => { setListing(l); setBoundary(null); setError(""); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => { load(); }, [load, reloadKey, restore?.status]);

  const steps = listing?.steps ?? [];
  const sessions = listing?.sessions ?? [];
  const session = sessions[Math.min(sessionIdx, Math.max(0, sessions.length - 1))];
  const [from, to] = useMemo(
    () => session ? sessionSlice(steps, session) : [0, 0], [steps, session]);
  // the line: how many steps of the whole list are above it
  const g = boundary === null || boundary < from || boundary > to
    ? defaultBoundary(steps, from, to) : boundary;
  const point = pointId(steps, g);
  const moment = pointMoment(steps, g, listing?.now ?? Math.floor(now.getTime() / 1000));

  // The preview of what the line would restore: debounced, only the newest
  // answer counts.
  const seq = useRef(0);
  useEffect(() => {
    if (!listing || !steps.length) { setPreview(null); return; }
    const mine = ++seq.current;
    setPreviewing(true);
    const timer = setTimeout(() => {
      api.timeMachinePreview({ point })
        .then((p) => { if (mine === seq.current) { setPreview(p); setError(""); } })
        .catch((e) => { if (mine === seq.current) setError(String(e.message ?? e)); })
        .finally(() => { if (mine === seq.current) setPreviewing(false); });
    }, 150);
    return () => clearTimeout(timer);
  }, [listing, point, reloadKey]);

  // Dragging the line: its place follows the pointer among the rows (their
  // heights, so the line's own height never makes it flicker).
  const startDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const list = listRef.current;
    if (!list || running) return;
    e.preventDefault();
    const rows = [...list.querySelectorAll<HTMLElement>("[data-tm-row]")];
    const heights = rows.map((r) => r.offsetHeight);
    const top = list.getBoundingClientRect().top
      + (parseFloat(getComputedStyle(list).paddingTop) || 0);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const y = ev.clientY - top;
      let acc = 0;
      let at = 0;
      for (let i = 0; i < heights.length; i++) {
        if (y > acc + heights[i] / 2) at = i + 1;
        acc += heights[i];
      }
      setBoundary(from + Math.max(0, Math.min(to - from, at)));
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const ruleNames = new Map(preview?.rules.map((r) => [r.id, r.name]));
  const ticked = (id: string) => pause[id] ?? true;

  const restoreNow = async (picked?: string[]) => {
    if (starting || running) return;
    setStarting(true);
    setError("");
    try {
      // fresh numbers right before the confirm (the mailbox may have moved)
      const p = await api.timeMachinePreview({ point, senders: picked ?? null });
      if (p.mails === 0) { toast.show(t("tm.nothing")); return; }
      const paused = p.rules.filter((r) => ticked(r.id));
      const when = atText(p.point_ts, now);
      const stay = t("tm.confirm_stay") + (p.cant.length
        ? `; ${t("tm.confirm_cant", { n: p.cant.reduce((a, c) => a + c.mails, 0) })}`
        : "");
      const ok = await confirmDialog({
        title: t("tm.confirm_title", { n: p.mails, at: when }),
        bullets: [
          t("tm.confirm_steps", { n: p.steps,
            where: whereText(p.folders, (_f, name) => folderName(name)) }),
          stay,
          ...paused.map((r) => t("tm.confirm_paused", { name: r.name })),
        ],
        footnote: t("tm.confirm_note"),
        confirmLabel: t("tm.confirm_btn", { n: p.mails }) });
      if (!ok) return;
      await api.timeMachineRestore({ point, top: p.top,
        senders: picked ?? null, pause: paused.map((r) => r.id) });
      onRestoreStarted?.();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally { setStarting(false); }
  };

  if (error && !listing) return (
    <div className="p-4 type-body text-danger-fg" role="alert">{error}</div>);
  if (!listing) return <Loading />;
  if (!steps.length) return (
    <div className="p-6 text-center">
      <History size={18} aria-hidden className="mx-auto text-muted" />
      <div className="mt-2 type-heading">{t("tm.empty")}</div>
      <p className="mt-1 type-body text-muted">
        {t("tm.empty_hint", { days: listing.keep_days })}</p>
    </div>
  );

  const aboveCount = steps.slice(0, g).filter((s) => s.status === "back").length;
  const slice = steps.slice(from, to);
  const dayKey = new Date(session.start * 1000).toDateString();
  const sameDay = sessions.filter(
    (s) => new Date(s.start * 1000).toDateString() === dayKey).length;
  const sub = [t("tm.sessions_day", { n: sameDay }),
    t("tm.steps", { n: session.steps }),
    t("tm.touched", { n: session.mails })].join(" · ");
  const pointText = t("tm.point_value", { time: timeOf(moment), n: aboveCount });
  const notes = preview ? notesOf(preview) : [];
  const nothing = !preview || preview.mails === 0;
  const busy = running || starting;

  const line = (
    <PointLine key="line" moment={timeOf(moment)} value={g - from}
      max={to - from} text={pointText}
      onMove={(v) => setBoundary(from + v)} onDragStart={startDrag} />);
  const rows: ReactNode[] = [];
  slice.forEach((s, i) => {
    const idx = from + i;
    if (idx === g) rows.push(line);
    rows.push(
      <StepRow key={s.id} s={s} above={idx < g} rules={rules} groups={groups}
        disabled={busy} onPick={() => setBoundary(idx + 1)} />);
  });
  if (g >= to) rows.push(line);
  const stepList = (
    <ul ref={listRef} aria-label={t("tm.steps_label")}
      className="divide-y divide-line overflow-hidden rounded-card border
        border-line bg-panel">{rows}</ul>
  );

  const card = (
    <section aria-label={t("tm.preview")} aria-busy={previewing}
      className="flex flex-col gap-3 rounded-card border border-line bg-panel
        p-4">
      {running ? (
        <>
          <div className="type-meta text-muted">{t("tm.restoring")}</div>
          <ProgressBar value={restore?.steps_done ?? 0}
            max={restore?.steps_total ?? 0} label={t("tm.restoring")} />
          <div className="type-body">{t("tm.progress", {
            done: restore?.steps_done ?? 0, total: restore?.steps_total ?? 0,
            n: restore?.moved ?? 0 })}</div>
        </>
      ) : !preview ? <Loading /> : (
        <div className={previewing ? "opacity-60" : ""}>
          <div className="type-meta text-muted">{t("tm.restore_to",
            { when: whenText(preview.point_ts, now) })}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="type-largetitle tabular-nums">
              {fmtNum(preview.mails)}</span>
            <span className="type-body text-muted">
              {t("tm.come_back", { n: preview.mails })}
              {preview.bytes > 0 ? ` · ${fmtSize(preview.bytes)}` : ""}
            </span>
          </div>
          {preview.mails > 0 && (<>
            <div role="img" aria-label={preview.folders.map((f) => t("tm.to_folder",
              { n: f.mails, folder: folderName(f.name) })).join(", ")}
              className="mt-3 flex h-2 overflow-hidden rounded-full bg-chip">
              {preview.folders.map((f, i) => (
                <span key={f.folder} className={i === 0 ? "bg-accent"
                  : hueFillAt(i)} style={{ flex: f.mails }} />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 type-meta
              text-muted">
              {preview.folders.slice(0, 4).map((f, i) => (
                <li key={f.folder} className="inline-flex items-center gap-1">
                  <span aria-hidden className={`size-2 rounded-full ${i === 0
                    ? "bg-accent" : hueFillAt(i)}`} />
                  {t("tm.to_folder", { n: f.mails, folder: folderName(f.name) })}
                </li>
              ))}
              <li>{t("tm.from_senders", { n: preview.senders.length })}</li>
            </ul>
          </>)}
          {notes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3
              type-meta">
              {notes.map((n) => (
                <li key={n.key} className="flex gap-2">
                  {n.icon && <span className="mt-0.5 shrink-0 text-muted">
                    {n.icon}</span>}
                  <span>{n.node}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.rules.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {preview.rules.map((r) => (
                <li key={r.id}>
                  <Checkbox checked={ticked(r.id)} className="type-meta"
                    onChange={(e) => setPause({ ...pause, [r.id]: e.target.checked })}
                    label={<PauseLabel name={ruleNames.get(r.id) ?? r.name}
                      n={r.mails} />} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!phone && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" className="flex-1" disabled={nothing || busy}
            onClick={() => void restoreNow()}>
            <History size={16} aria-hidden className="mr-1.5 inline
              align-text-bottom" />
            {t("tm.restore_btn", { n: preview?.mails ?? 0 })}
          </Button>
          <Button variant="secondary" disabled={nothing || busy}
            onClick={() => setPicking(true)}>{t("tm.pick_btn")}</Button>
        </div>
      )}
    </section>
  );

  const phoneFacts = preview ? [
    preview.cant.length ? t("tm.phone_cant", { n: preview.cant
      .reduce((a, c) => a + c.mails, 0) }) : "",
    preview.stays.some((s) => s.kind === "unsubscribe")
      ? t("tm.phone_unsub", { n: preview.stays.find((s) => s.kind === "unsubscribe")!.n })
      : ""].filter(Boolean).join("; ") : "";

  return (
    <>
      <div data-scroll-id="panel" className="min-h-0 flex-1 overflow-y-auto
        px-3 pb-4 pt-3">
        <div className="mx-auto flex max-w-180 flex-col gap-4 lg:grid
          lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
          <div className="flex min-w-0 flex-col gap-3">
            <section aria-label={t("tm.session")} className="flex flex-col
              gap-3 rounded-card border border-line bg-panel px-4 py-3
              sm:flex-row sm:items-center sm:gap-6">
              <div className="min-w-0 flex-1">
                <div className="type-heading">{sessionTitle(session, now)}</div>
                <div className="type-meta text-muted">{sub}</div>
              </div>
              <SessionBars sessions={sessions}
                active={Math.min(sessionIdx, sessions.length - 1)} now={now}
                onPick={(i) => { setSessionIdx(i); setBoundary(null); }} />
            </section>
            {error && <div role="alert" className="type-meta text-danger-fg">
              {error}</div>}
            {stepList}
            <p className="px-1 type-meta text-muted">
              {phone ? t("tm.phone_hint") : t("tm.session_note", { min: SESSION_GAP_MIN })}
              {phone && phoneFacts ? ` ${phoneFacts}.` : ""}
            </p>
          </div>
          <div className="lg:sticky lg:top-0 lg:self-start">{card}</div>
        </div>
      </div>
      {phone && (
        <div className="flex flex-col gap-1 border-t border-line px-4 pt-3
          max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]
          sm:pb-3">
          <Button variant="primary" className="min-h-12 w-full"
            disabled={nothing || busy} onClick={() => void restoreNow()}>
            <History size={18} aria-hidden className="mr-1.5 inline
              align-text-bottom" />
            {t("tm.restore_btn_phone", { n: preview?.mails ?? 0,
              time: timeOf(moment) })}
          </Button>
          <Button variant="quiet" disabled={nothing || busy}
            onClick={() => setPicking(true)}>{t("tm.pick_btn")}</Button>
        </div>
      )}
      {picking && preview && (
        <PickSenders preview={preview} groups={groups}
          onClose={() => setPicking(false)}
          onGo={(addrs) => { setPicking(false); void restoreNow(addrs); }} />
      )}
    </>
  );
}
