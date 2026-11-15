import { Briefcase, ChevronDown, FileText, KeyRound, ShieldCheck, Ticket,
  Receipt } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fmtNum } from "../numfmt";
import { getLang, t } from "../i18n";
import { fmtTs } from "../lib";
import type { KeepSafeClass, KeepSafeCheck } from "../types";
import { Button, Checkbox, IconTile, Modal, useArmed, useMediaQuery,
  type TagTone } from "./ui";

/** Icon + tile colour of each class (the Settings rows use the same). */
export const KEEP_SAFE_LOOK: Record<KeepSafeClass,
    { icon: ReactNode; tone: TagTone }> = {
  invoices: { icon: <Receipt size={16} />, tone: "review" },
  bookings: { icon: <Ticket size={16} />, tone: "info" },
  contracts: { icon: <FileText size={16} />, tone: "attach" },
  jobs: { icon: <Briefcase size={16} />, tone: "new" },
  accounts: { icon: <KeyRound size={16} />, tone: "neutral" },
};

/** What the dialog resolves with: the classes still ticked (their mails are
 *  protected before the move). Cancel / Esc / backdrop resolve null. */
export interface KeepSafeAnswer { ticked: KeepSafeClass[] }

/** The confirm of a big move to Trash with the green "look worth keeping"
 *  box: the usual destructive pattern (title = the action, counts as
 *  bullets, danger button with the verb + count) plus the groups the backend
 *  found, each ticked and expandable to its subjects. The button counts only
 *  what really moves, so unticking a group puts its mails back into the
 *  count. */
export function KeepSafeConfirm({ title, bullets, tone = "danger", label, n,
  found, cancelLabel, onResult }: {
  title: string; bullets: (kept: number) => string[]; tone?: "danger" | "primary";
  /** The confirm button's text for this many mails moving. */
  label: (moving: number) => string;
  /** Mails the move would act on (the count the dialog is about). */
  n: number;
  found: KeepSafeCheck;
  /** Cancel's text where declining is not a cancel ("Only block"). */
  cancelLabel?: string;
  onResult: (answer: KeepSafeAnswer | null) => void;
}) {
  const [ticked, setTicked] = useState<Set<KeepSafeClass>>(
    () => new Set(found.classes.map((c) => c.id)));
  const [open, setOpen] = useState<Set<KeepSafeClass>>(() => new Set());
  const phone = useMediaQuery("(max-width: 639px)");
  const armed = useArmed();
  const safe = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // Danger dialogs focus Cancel, the safe choice (as ConfirmDialog does).
  useLayoutEffect(() => { safe.current?.focus(); }, []);
  const total = found.classes.reduce((s, c) => s + c.count, 0);
  const kept = found.classes.reduce(
    (s, c) => s + (ticked.has(c.id) ? c.count : 0), 0);
  const moving = Math.max(0, n - kept);
  const flip = (set: Set<KeepSafeClass>, id: KeepSafeClass) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  const confirmText = label(moving)
    + (phone && kept > 0 ? ` · ${t("keepsafe.btn_keep", { n: kept })}` : "");
  return (
    <Modal size="sm" labelledBy={titleId} describedBy={bodyId}
      onClose={() => onResult(null)}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div id={titleId} className="type-heading">{title}</div>
        <div id={bodyId} className="flex flex-col gap-3 type-body text-muted">
          {bullets(kept).length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {bullets(kept).map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
          <section aria-labelledby={`${bodyId}-box`}
            className="rounded-card border border-safe-fg/40 bg-safe-bg
              max-sm:order-first">
            <div className="flex items-start gap-2 px-3 pb-1 pt-3">
              <ShieldCheck size={18} aria-hidden
                className="mt-0.5 shrink-0 text-safe-fg" />
              <div className="min-w-0">
                <div id={`${bodyId}-box`}
                  className="type-body font-semibold text-body">
                  {t("keepsafe.title", { n: total })}</div>
                <div className="type-meta text-muted">{t("keepsafe.sub")}</div>
              </div>
            </div>
            <ul className="divide-y divide-line">
              {found.classes.map((c) => {
                const look = KEEP_SAFE_LOOK[c.id];
                const isOpen = open.has(c.id);
                const listId = `${bodyId}-${c.id}`;
                const name = t(`keepsafe.class.${c.id}`);
                const senders = c.senders
                  .map((s) => `${s.name} ${fmtNum(s.count)}`).join(", ");
                return (
                  <li key={c.id} className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={ticked.has(c.id)}
                        aria-label={t("keepsafe.keep_group",
                          { name, n: c.count })}
                        onChange={() => setTicked((s) => flip(s, c.id))} />
                      <IconTile tone={look.tone}>{look.icon}</IconTile>
                      <div className="min-w-0 flex-1">
                        <div className="type-body font-medium text-body">
                          {name} · {fmtNum(c.count)}</div>
                        <div className="type-meta text-muted">
                          {t(`keepsafe.hint.${c.id}`)} · {senders}</div>
                      </div>
                      <button type="button" aria-expanded={isOpen}
                        aria-controls={listId}
                        aria-label={t("keepsafe.show_group", { name })}
                        onClick={() => setOpen((s) => flip(s, c.id))}
                        className="grid size-8 shrink-0 place-items-center
                          rounded-control text-muted hover:bg-chip
                          focus-visible:ring-2 focus-visible:ring-accent
                          coarse:size-11">
                        <ChevronDown size={16} aria-hidden
                          className={`transition-transform
                            motion-reduce:transition-none
                            ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                    {isOpen && (
                      <ul id={listId} className="mb-1 ml-9 space-y-1 pl-2
                        type-meta">
                        {c.subjects.map((s, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="min-w-0 flex-1 truncate
                              text-body">
                              {s.subject || t("(no subject)")}</span>
                            <span className="shrink-0 whitespace-nowrap
                              text-muted">
                              {s.sender} · {fmtTs(s.ts, getLang(), false)}
                            </span>
                          </li>
                        ))}
                        {c.count > c.subjects.length && (
                          <li className="text-muted">
                            {t("keepsafe.more",
                              { n: c.count - c.subjects.length })}</li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
      <div className="space-y-2 border-t border-line px-4 py-3 sm:px-5">
        <div className="type-meta text-muted max-sm:hidden">
          {t("keepsafe.footer", { n: fmtNum(n), kept: fmtNum(kept) })}</div>
        <div className="flex items-center justify-end gap-2
          max-sm:flex-col-reverse max-sm:items-stretch">
          <Button ref={safe} variant="secondary" className="max-sm:min-h-11"
            onClick={() => onResult(null)}>{cancelLabel ?? t("Cancel")}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"}
            className="max-sm:min-h-11" disabled={moving === 0}
            onClick={(e) => {
              if (!armed(e.detail === 0)) return;
              onResult({ ticked: found.classes.map((c) => c.id)
                .filter((id) => ticked.has(id)) });
            }}>
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
