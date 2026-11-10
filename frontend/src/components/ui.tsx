import { AlertCircle, Check, CheckCircle2, ChevronLeft, ChevronRight, ChevronsUpDown, Eye, Info, Minus,
  MousePointerClick, Pin, Plus, Shield, TriangleAlert, X }
  from "lucide-react";
import { createPortal } from "react-dom";
import { createContext, Fragment, useCallback, useContext, useEffect, useId,
  useLayoutEffect, useMemo, useRef, useState, type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject }
  from "react";
import { useLayer } from "../backStack";
import { nowDate } from "../clock";
import { demoHint, useDemo } from "../demoMode";
import { getLang, t } from "../i18n";
import { EDGE_PX, GESTURE_SLOP, prefersReducedMotion, useCoarsePointer,
  useEdgeBack } from "../gestures";
import { engagementTier, fmtDate } from "../lib";
import { decimalToInput, inputToDecimal, isBadDecimal } from "../numfmt";
import type { GroupAi, GroupTrackers, StillMailing } from "../types";

/** One-time consent: what metadata the AI features transmit. */
export async function ensureAiAck(): Promise<boolean> {
  if (localStorage.getItem("pmc_ai_ack") === "1") return true;
  if (await confirmDialog({ title: t("ai.consent_title"),
    body: t("ai.disclaimer"), confirmLabel: t("Continue") })) {
    localStorage.setItem("pmc_ai_ack", "1");
    return true;
  }
  return false;
}

/** Shared look of every text link (an underlined button or anchor). The
 *  colour is inherited; add `text-accent` / `text-muted` where needed. */
export const LINK = "cursor-pointer underline hover:text-body";

/** Link in the accent colour; stays accent on hover. */
export const LINK_ACCENT = "cursor-pointer text-accent underline hover:text-accenth";

export type TagTone = "neutral" | "safe" | "review" | "keep" | "info"
  | "attach" | "new" | "accent" | "category";

const TAG_TONE: Record<TagTone, string> = {
  neutral: "bg-chip text-chiptext",
  safe: "bg-safe-bg text-safe-fg",
  review: "bg-review-bg text-review-fg",
  keep: "bg-keep-bg text-keep-fg",
  info: "bg-info-bg text-info-fg",
  attach: "bg-attach-bg text-attach-fg",
  new: "bg-new-bg text-new-fg",
  accent: "bg-chip text-accent",
  // A sender's category (newsletter, shopping...): outlined and muted, so it
  // reads as a label next to the filled state badges.
  category: "border border-line text-muted",
};

/** The semantic tones render as status pills (fully rounded); neutral,
 *  accent and category stay small rounded badges. */
const PILL_TONES = new Set<TagTone>(["safe", "review", "keep", "info",
  "attach", "new"]);

/** Small badge / status pill (caption layer). `tone` picks a semantic bg/fg
 *  pair; `dot` adds a leading 6 px dot in the tone's colour. */
export function Tag({ children, tone = "neutral", dot = false,
  className = "" }: {
  children: ReactNode; tone?: TagTone; dot?: boolean; className?: string;
}) {
  const pill = PILL_TONES.has(tone);
  return (
    <span className={`${dot ? "inline-flex items-center gap-1.5" : "inline-block"}
      ${pill ? "rounded-full px-2" : "rounded-badge px-1.5"} py-0.5
      type-caption ${TAG_TONE[tone]} ${className}`}>
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full
        bg-current" />}
      {children}
    </span>
  );
}

const VERDICT_TONE: Record<string, TagTone> = {
  delete_safe: "safe",
  review: "review",
  keep: "keep",
};

/** Status labels read in sentence case in every language. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The verdict of a group. One the user set by hand (`src: "user"`, Edit
 *  labels) reads "<verdict> · set by you" in the info tone, so it is told
 *  apart from the AI's at a glance. */
export function AiTag({ ai }: { ai: GroupAi }) {
  if (ai.src === "user") {
    return (
      <Tag tone="info" dot>
        {t("v.set_by_you", { verdict: cap(t(`v.${ai.verdict}`)) })}
      </Tag>
    );
  }
  return (
    <Tag tone={VERDICT_TONE[ai.verdict]}>
      <span title={ai.reason}>{cap(t(`v.${ai.verdict}`))}</span>
    </Tag>
  );
}

/** Open/close state of a small popover under a trigger: closes on an outside
 *  press or Esc, and flips to right-aligned when it would run off the right
 *  edge of the screen. Attach `ref` to the wrapper, `pop` to the popover. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Opens left-aligned under the trigger; flips if that runs off the right
  // edge, and is nudged back when it would then run off the left one.
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) { setAlignRight(false); return; }
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    if (!alignRight && r.right > window.innerWidth - 8) {
      setAlignRight(true);
    } else if (r.left < 8) {
      el.style.transform = `translateX(${8 - r.left}px)`;
    }
  }, [open, alignRight]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !pop.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // preventDefault = "used": App and Modal ignore a handled Esc.
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, alignRight, ref, pop };
}

const POPOVER = `absolute top-full z-(--z-dropdown) mt-1 w-max
  max-w-[min(18rem,calc(100vw-1rem))] rounded-card border border-line
  bg-panel p-3 text-left type-meta shadow-popover`;

/** Compact per-mail rating summary for a group: 🟢n 🟡n 🔴n. A button: tap
 *  (or click) opens a popover spelling out what the counts are - touch
 *  screens have no hover, and the bare emoji don't say what they count. */
export function RatingChips({ ratings }: {
  ratings: { delete_safe: number; review: number; keep: number };
}) {
  const { open, setOpen, alignRight, ref, pop } = usePopover();
  const parts: [string, number, string][] = [
    ["🟢", ratings.delete_safe, "v.delete_safe"],
    ["🟡", ratings.review, "v.review"], ["🔴", ratings.keep, "v.keep"]];
  const shown = parts.filter(([, n]) => n > 0);
  const tip = t("ratings.aria", { parts: shown.map(([, n, k]) =>
    `${n} ${t(k)}`).join(", ") });
  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button type="button" title={tip} aria-label={tip} aria-expanded={open}
        // Rows are tap targets themselves (open the detail view) - this one
        // only explains the counts.
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex min-h-6 cursor-pointer gap-1 rounded px-0.5
          whitespace-nowrap type-caption text-muted hover:bg-chip">
        {shown.map(([icon, n]) => <span key={icon}>{icon}{n}</span>)}
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label={t("ratings.popover_title")}
          onClick={(e) => e.stopPropagation()}
          className={`${POPOVER} ${alignRight ? "right-0" : "left-0"}`}>
          <div className="font-semibold text-body">
            {t("ratings.popover_title")}
          </div>
          <ul className="mt-1 space-y-0.5 text-muted">
            {shown.map(([icon, n, k]) => (
              <li key={icon}>{icon} {n} {t(k)}</li>
            ))}
          </ul>
          <div className="mt-1 text-muted">{t("ratings.popover_hint")}</div>
        </div>
      )}
    </span>
  );
}


/** Shield toggle: protected senders are skipped by bulk deletes and the AI
 *  never rates them delete_safe. Grayscale = not protected. */
export function ProtectButton({ on, onClick, className = "", showLabel }: {
  on: boolean; onClick: () => void; className?: string;
  /** Visible "Protect" / "Protected" text next to the shield, from sm up. */
  showLabel?: boolean;
}) {
  return (
    <button
      title={t(on ? "unprotect.tip" : "protect.tip")}
      aria-label={t(on ? "unprotect.tip" : "protect.tip")}
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-7 items-center gap-1 rounded px-1
        transition-opacity ${on ? "" : "opacity-30 grayscale hover:opacity-70"}
        ${className}`}>
      <Shield size={16} />
      {showLabel && (
        <span className="hidden type-meta sm:inline">
          {t(on ? "btn.protected" : "btn.protect")}
        </span>
      )}
    </button>
  );
}

/** Per-mail "Protect this mail" toggle (a pinned mail is skipped by every
 *  bulk action, rule and AI pick). Unrelated to any PIN code/privacy
 *  feature - the label says "protect", the icon is a drawing pin. */
export function PinButton({ on, onClick, className = "", showLabel }: {
  on: boolean; onClick: () => void; className?: string;
  /** Visible "Protect mail" / "Mail protected" text next to the pin. */
  showLabel?: boolean;
}) {
  const label = t(on ? "pin.unprotect_tip" : "pin.protect_tip");
  return (
    <button title={label} aria-label={label} aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-7 shrink-0 items-center gap-1 rounded px-1
        transition-opacity ${on ? "text-accent"
          : "opacity-40 hover:opacity-80"} ${className}`}>
      <Pin size={16} fill={on ? "currentColor" : "none"} />
      {showLabel && (
        <span className="type-meta">
          {t(on ? "btn.mail_protected" : "btn.mail_protect")}
        </span>
      )}
    </button>
  );
}

/** Compact 3-step engagement meter: one lit bar per tier (low/medium/
 *  high). It is a button: a tap (or click) opens a small popover that names
 *  the score and spells out what it is made of - touch screens have no
 *  hover, and the bars alone don't say what they are. The title tooltip
 *  stays for desktop hover. Neutral accent tint on purpose - the emerald/
 *  amber/rose hues mean delete-safe/review/keep elsewhere. */
export function EngagementMeter({ g, labelled = false }: {
  g: { engagement: number; count: number; unread: number; replied: boolean;
       bulk: boolean; last: string };
  /** A pill that names the tier ("Low engagement") instead of the lone bars;
   *  the tip moves to the tooltip / description, the popover is the same. */
  labelled?: boolean;
}) {
  const { open, setOpen, alignRight, ref, pop } = usePopover();
  const tipId = useId();
  const tier = engagementTier(g.engagement);
  const lit = { low: 1, medium: 2, high: 3 }[tier];
  const readPct = g.count ? Math.round(100 * (1 - g.unread / g.count)) : 0;
  const parts = [
    t("eng.read", { n: readPct }),
    t(g.replied ? "eng.replied" : "eng.never_replied"),
    ...(g.bulk ? [t("eng.bulk")] : []),
    ...(g.last ? [t("eng.last", { year: g.last.slice(0, 4) })] : []),
  ];
  const tierName = t(`eng.${tier}`);
  const tip = t("eng.tip", { score: g.engagement, tier: tierName,
    parts: parts.join(", ") });
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" title={tip} aria-label={labelled ? undefined : tip}
        aria-expanded={open} data-eng={tier}
        aria-describedby={labelled ? tipId : undefined}
        // Rows are tap targets themselves (open the detail view) - this
        // one only explains the score.
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={labelled
          ? `inline-flex min-h-6 cursor-pointer items-center gap-1.5
            rounded-full bg-chip px-2 py-0.5 type-caption text-body
            hover:bg-chiph`
          : `inline-flex min-h-6 min-w-6 cursor-pointer items-end gap-0.5
            rounded px-0.5 pb-1 hover:bg-chip`}>
        <span aria-hidden={labelled || undefined}
          className="inline-flex items-end gap-0.5">
          {[1, 2, 3].map((i) => (
            <span key={i} data-lit={i <= lit ? "true" : "false"}
              style={{ height: `${4 + i * 3}px` }}
              className={`w-1 rounded-sm ${i <= lit ? "bg-accent"
                : labelled ? "bg-faint" : "bg-chip"}`} />
          ))}
        </span>
        {labelled && t(`eng.tag_${tier}`)}
      </button>
      {labelled && <span id={tipId} className="sr-only">{tip}</span>}
      {open && (
        <div ref={pop} role="dialog" onClick={(e) => e.stopPropagation()}
          className={`${POPOVER} ${alignRight ? "right-0" : "left-0"}`}>
          <div className="font-semibold text-body">
            {t("eng.popover_title", { score: g.engagement, tier: tierName })}
          </div>
          <div className="mt-0.5 text-muted">{parts.join(" · ")}</div>
        </div>
      )}
    </span>
  );
}

/** "4 mails since you unsubscribed on 3 Oct" - or, for a row pooling several
 *  senders, how many of them kept mailing. */
export function stillMailingText(sm: StillMailing): string {
  // The unsubscribe day in the user's own time zone, like every UI date.
  const d = new Date(sm.since_ts * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const date = fmtDate(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(
    d.getDate())}`, nowDate(), { lang: getLang() });
  return sm.senders > 1
    ? t("still.text_many", { n: sm.n, senders: sm.senders, date })
    : t("still.text", { n: sm.n, date });
}

/** Warning badge for a sender that keeps mailing after a successful
 *  unsubscribe. A button: a tap (or click) opens a popover with the numbers
 *  - touch screens have no hover. Rows clip their overflow and sit mid-line,
 *  so the popover is portalled to <body> and placed against the viewport. */
export function StillMailingBadge({ sm }: { sm: StillMailing }) {
  const { open, setOpen, ref, pop } = usePopover();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const text = stillMailingText(sm);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const trig = ref.current?.getBoundingClientRect();
    const w = pop.current?.offsetWidth ?? 0;
    if (!trig) return;
    setPos({ top: trig.bottom + 4,
      left: Math.max(8, Math.min(trig.left, window.innerWidth - w - 8)) });
  }, [open, ref, pop]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, setOpen]);
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" title={text} aria-expanded={open}
        data-still-mailing
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="cursor-pointer rounded-badge">
        <Tag tone="review" className="inline-flex items-center gap-1
          whitespace-nowrap">
          <TriangleAlert size={14} aria-hidden /> {t("still.badge")}
        </Tag>
      </button>
      {open && createPortal(
        <div ref={pop} role="dialog" onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0,
            visibility: pos ? "visible" : "hidden" }}
          className="z-(--z-dropdown) w-max max-w-[min(18rem,calc(100vw-1rem))]
            rounded-card border border-line bg-panel p-3 text-left type-meta
            shadow-popover">
          <div className="font-semibold text-body">{t("still.title")}</div>
          <div className="mt-0.5 text-muted">{text}</div>
        </div>, document.body)}
    </span>
  );
}

/** Group-row indicator: how many of a group's mails are pinned. */
export function PinBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <Tag tone="accent" className="whitespace-nowrap">
      <span title={t("pin.badge_tip", { n })}
        className="inline-flex items-center gap-0.5">
        <Pin size={14} fill="currentColor" /> {n}
      </span>
    </Tag>
  );
}

/** Group-row indicator: some of the group's checked mails track opens (a
 *  pixel) or clicks (redirect links). A button like the engagement meter: a
 *  tap opens a popover with the share and the tracker hosts - the icon alone
 *  doesn't say what it means, and touch screens have no hover. */
export function TrackerBadge({ g }: { g: { trackers?: GroupTrackers } }) {
  const { open, setOpen, alignRight, ref, pop } = usePopover();
  const tr = g.trackers;
  if (!tr || (tr.pixel <= 0 && tr.click <= 0)) return null;
  const label = t(tr.pixel > 0 && tr.click > 0 ? "tracker.both"
    : tr.pixel > 0 ? "tracker.opens" : "tracker.clicks");
  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button type="button" title={label} aria-label={label}
        aria-expanded={open}
        // Rows are tap targets themselves - this one only explains itself.
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex min-h-6 min-w-6 cursor-pointer items-center
          justify-center gap-0.5 rounded px-0.5 text-muted hover:bg-chip">
        {tr.pixel > 0 && <Eye size={14} aria-hidden />}
        {tr.click > 0 && <MousePointerClick size={14} aria-hidden />}
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={`${POPOVER} ${alignRight ? "right-0" : "left-0"}`}>
          <div className="font-semibold text-body">{label}</div>
          <ul className="mt-1 space-y-0.5 text-muted">
            {tr.pixel > 0 && <li>{t("tracker.pop_pixel",
              { n: tr.pixel, of: tr.checked })}</li>}
            {tr.click > 0 && <li>{t("tracker.pop_click",
              { n: tr.click, of: tr.checked })}</li>}
            {tr.hosts.length > 0 && <li>{t("tracker.pop_hosts",
              { hosts: tr.hosts.join(", ") })}</li>}
          </ul>
          <div className="mt-1 text-muted">{t("tracker.pop_hint")}</div>
        </div>
      )}
    </span>
  );
}

/** The app-wide loading animation (see .pmc-spinner in index.css).
 *  Colored via currentColor - defaults to the accent; pass e.g.
 *  className="text-on-accent" inside primary buttons. */
export function Spinner({ size = "sm", className = "" }: {
  size?: "sm" | "md" | "lg"; className?: string;
}) {
  const s = {
    sm: "size-3.5 [--pmc-thickness:2px]",
    md: "size-6 [--pmc-thickness:2.5px]",
    lg: "size-9 [--pmc-thickness:3px]",
  }[size];
  return (
    <span aria-label={t("loading…")} role="status"
      className={`pmc-spinner inline-block align-middle text-accent
        ${s} ${className}`} />
  );
}

/** Progress bar (theme tokens only). `max` 0 = not known yet: the bar stays
 *  empty. `indeterminate` = running with no done/total to show (sliding
 *  segment; static under reduced motion). `thin` = the 2 px strip used under
 *  the toolbar. */
export function ProgressBar({ value, max, label, className = "", thin = false,
  indeterminate = false }: {
  value: number; max: number; label?: string; className?: string;
  thin?: boolean; indeterminate?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0;
  const known = !indeterminate;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0}
      aria-valuemax={known && max > 0 ? max : undefined}
      aria-valuenow={known && max > 0 ? value : undefined}
      className={`${thin ? "h-0.5" : "h-2"} w-full overflow-hidden
        rounded-full bg-chip ${className}`}>
      {indeterminate
        ? <div className="pmc-indeterminate h-full w-1/3 rounded-full
            bg-accent" />
        : <div className="h-full rounded-full bg-accent transition-[width]
            duration-300" style={{ width: `${pct}%` }} />}
    </div>
  );
}

/** Standard block-level loading state: big spinner + muted label,
 *  centered, with a short fade-in delay. Use this in every panel. */
export function Loading({ label, className = "" }: {
  label?: string; className?: string;
}) {
  return (
    <div className={`pmc-loading flex flex-col items-center justify-center
      gap-3 p-8 type-body text-muted ${className}`}>
      <Spinner size="lg" />
      <span>{label ?? t("loading…")}</span>
    </div>
  );
}

/** Shared disabled look for Button / controls / MenuItem: flat chip fill,
 *  faint text, no opacity (a disabled red button must not read as an alarm). */
const DISABLED = "disabled:cursor-not-allowed disabled:bg-chip disabled:text-faint";

type ButtonVariant = "primary" | "secondary" | "tinted" | "quiet" | "plain"
  | "danger" | "danger-quiet" | "danger-tint";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent enabled:hover:bg-accenth text-on-accent",
  secondary: "bg-chip enabled:hover:bg-chiph text-body",
  // Secondary call to action ("Review", "Done", an active Filter).
  tinted: "bg-accent-tint enabled:hover:bg-accent/22 enabled:hover:text-accenth text-accent",
  quiet: "bg-transparent enabled:hover:bg-chip text-body",
  // No box, accent text / icon (the phone toolbar's Filter, Sort, Select).
  plain: "bg-transparent enabled:hover:bg-chip text-accent disabled:bg-transparent",
  danger: "bg-danger enabled:hover:bg-danger-h text-white",
  "danger-quiet":
    "bg-transparent enabled:hover:bg-keep-bg text-danger-fg",
  // A destructive action that is the panel's one big button, without the
  // alarm of a solid red fill (the sender detail's "Move N mails to Trash").
  "danger-tint": "bg-keep-bg enabled:hover:bg-keep-fg/16 text-danger-fg",
};

// sm: 32 / 36 px visual on touch, the ::after extends the hit area to 44.
const BUTTON_SIZE = {
  md: "min-h-9 coarse:min-h-10 px-3 py-1.5 type-body font-medium",
  sm: `relative min-h-8 coarse:min-h-9 px-2.5 py-1 type-meta font-medium
    after:absolute after:inset-x-0 after:inset-y-0 after:content-['']
    coarse:after:-inset-y-1`,
  icon: `inline-flex size-9 coarse:size-10 items-center justify-center p-0
    type-body`,
};

export type ButtonProps = Omit<ComponentProps<"button">, "title"> & {
  variant?: ButtonVariant;
} & (
  | { size?: "md" | "sm"; title?: string; label?: never }
  // Icon-only buttons must say what they do: rendered as aria-label + title.
  | { size: "icon"; label: string; title?: never }
);

export function Button({ variant = "primary", size = "md", label, title,
  className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      aria-label={size === "icon" ? label : rest["aria-label"]}
      title={size === "icon" ? label : title}
      className={`rounded-control transition-colors enabled:active:translate-y-px
        ${DISABLED} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]}
        ${className}`}>
      {children}
    </button>
  );
}

/* ----------------------- form controls (ONE look) -----------------------
 * Every input/select/textarea in the app uses these - never restyle them
 * locally. They accept all native props incl. ref (React 19). */

const CONTROL = `min-h-9 coarse:min-h-10 rounded-control border border-line
  bg-panel2 px-3 py-1.5 text-left type-body focus:border-accent ${DISABLED}`;

export function Input({ className = "", ...rest }:
  ComponentProps<"input">) {
  return <input className={`${CONTROL} ${className}`} {...rest} />;
}

/** Text input for a non-negative decimal (prices, budgets) in the chosen
 *  number format: shows and accepts "0,5" or "0.5" as the user's format
 *  dictates, while `value` / `onChange` carry the canonical dot string
 *  ("0.5", "" when empty) that forms keep and APIs take. A native
 *  type="number" would use the browser's locale instead of the app's. */
export function DecimalInput({ value, onChange, className = "", ...rest }:
  Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
    value: string; onChange: (canonical: string) => void;
  }) {
  const [text, setText] = useState(() => decimalToInput(value));
  // Re-sync only when the outside value is not what the text already means
  // (so "0," survives while typing).
  useEffect(() => {
    if (inputToDecimal(text) !== value) setText(decimalToInput(value));
  }, [value]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <input className={`${CONTROL} ${className}`} type="text"
    inputMode="decimal" value={text} {...rest}
    aria-invalid={isBadDecimal(value) || undefined}
    onChange={(e) => {
      setText(e.target.value);
      onChange(inputToDecimal(e.target.value));
    }} />;
}

export function Select({ className = "", ...rest }:
  ComponentProps<"select">) {
  return <select className={`${CONTROL} ${className}`} {...rest} />;
}

export function TextArea({ className = "", ...rest }:
  ComponentProps<"textarea">) {
  return (
    <textarea
      className={`${CONTROL} min-h-20 w-full font-mono ${className}`}
      {...rest} />
  );
}

/** Labelled form control (label above, muted). */
export function Field({ label, children }: {
  label: ReactNode; children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block type-meta text-muted">{label}</span>
      {children}
    </label>
  );
}

/* --------------------------- layout primitives --------------------------- */

/** How the next top-level `Modal` presents itself. "slot" (set by
 *  `PageSlot`): inline as a page in the content column - no overlay, not on
 *  the modal stack, no focus trap, no Esc. "page": inside such a page, where
 *  `PanelHeader` has nothing to close. "modal" (default, and inside every
 *  real modal): a dialog; dialogs opened from a page stay real modals. */
type Presentation = "modal" | "slot" | "page" | "tool" | "screen";
const PresentationContext = createContext<Presentation>("modal");
/** Name of the page a full-screen tool goes back to (set by `PageSlot`). */
const ScreenParentContext = createContext<string | null>(null);
/** Whether the next top-level `Modal` owns a history entry (`useLayer`):
 *  false for a tool that IS a route below 1024 px (a deep link, a resize) -
 *  its own route entry is what Back leaves. Reset to true inside every Modal,
 *  so dialogs and readers opened from it stay layers. */
const BackEntryContext = createContext(true);

/** Presents the panels inside as pages filling the content column (`page`)
 *  or as dialogs. The element tree stays the same either way, so a panel
 *  keeps its state when the presentation changes (a window crossing 1024 px). */
export function PageSlot({ page, parent, entry = true, children }: {
  page: boolean;
  /** Below the page width: the name of the page a tool goes back to. Its
   *  header then reads as a full-screen page ("tool"/"screen": back link
   *  + large title) while the panel stays a modal. */
  parent?: string;
  /** Below the page width: the modal owns a history entry that Back pops
   *  (false when the tool is a route - the route entry is its entry). */
  entry?: boolean; children: ReactNode;
}) {
  return (
    <ScreenParentContext.Provider value={parent ?? null}>
      <BackEntryContext.Provider value={entry}>
        <PresentationContext.Provider
          value={page ? "slot" : parent ? "tool" : "modal"}>
          {children}
        </PresentationContext.Provider>
      </BackEntryContext.Provider>
    </ScreenParentContext.Provider>
  );
}

/** True for a panel rendered under a page `PageSlot` (read outside its Modal). */
export const useIsPage = (): boolean =>
  useContext(PresentationContext) === "slot";

/** How many dialogs are open right now (a page is none). */
export const modalCount = (): number => openModals.length;

/** Standard panel/modal header. Three looks, one component: a dialog keeps
 *  the compact head (title + subtitle left, actions, close button right); a
 *  page in the content column (>= 1024) shows the page title + subtitle with
 *  the actions on the right and nothing to close (the sidebar navigates, a
 *  `closeLabel` button stays); a full-screen tool below 1024 gets an iOS
 *  head: back link to its parent page (or `closeLabel`) + the actions as icon
 *  buttons, then the large title and subtitle. */
export function PanelHeader({ title, sub, actions, onClose, closeLabel,
  closeIcon }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode;
  onClose: () => void;
  /** A panel that opens inside another goes BACK instead of closing. */
  closeLabel?: string; closeIcon?: ReactNode;
}) {
  const presentation = useContext(PresentationContext);
  const parent = useContext(ScreenParentContext);
  const subLine = sub != null && sub !== "";
  if (presentation === "screen") {
    // The panels put an icon before their title; the large title has none.
    return (
      <div className="px-4 pt-2 pb-3">
        <div className="-mx-2 flex items-center gap-1">
          <button type="button" onClick={onClose}
            aria-label={closeLabel ? undefined
              : parent ? t("nav.back_to", { page: parent }) : undefined}
            className="inline-flex min-h-11 min-w-11 items-center gap-0.5
              rounded-control px-1 type-body-mobile text-accent
              focus-visible:ring-2 focus-visible:ring-accent">
            {closeIcon ?? <ChevronLeft size={18} aria-hidden />}
            {closeLabel ?? parent ?? t("Close")}
          </button>
          <div className="flex-1" />
          {actions}
        </div>
        <div className="mt-1 type-largetitle [&_svg]:hidden">{title}</div>
        {subLine && <div className="type-body text-muted">{sub}</div>}
      </div>
    );
  }
  const onPage = presentation === "page" && closeLabel === undefined;
  const wide = presentation === "page";
  return (
    <div className={`flex items-center gap-3 border-b border-line px-4
      ${wide ? "py-4" : "py-3"}`}>
      <div className="min-w-0 flex-1">
        <div className={`truncate ${wide ? "type-title2 [&_svg]:hidden"
          : "type-heading"}`}>{title}</div>
        {subLine && (
          <div className="truncate type-meta text-muted">{sub}</div>
        )}
      </div>
      {actions}
      {!onPage && (
        <Button variant="secondary" size="icon"
          label={closeLabel ?? t("Close")} onClick={onClose}>
          {closeIcon ?? <X size={18} />}
        </Button>
      )}
    </div>
  );
}

/** The filter-input row of the main toolbar (row B): the group filter and the
 *  All-mails filter both use it, so switching views never moves anything.
 *  `relative` anchors the QueryBuilder popover. */
export const FILTER_ROW = "relative mb-2 flex flex-wrap items-center gap-2";

/** Standard action row under a panel header. */
export function Toolbar({ children, className = "" }: {
  children: ReactNode; className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 border-b border-line
      px-4 py-2 ${className}`}>
      {children}
    </div>
  );
}

/** Uppercase section label used to group form/panel content. */
export function SectionLabel({ children, className = "" }: {
  children: ReactNode; className?: string;
}) {
  return (
    <div className={`type-section text-muted ${className}`}>
      {children}
    </div>
  );
}

/** Dropdown menu: a trigger button plus a popover - right-aligned by
 * default, flipped to left-aligned when that would run off the left edge
 * of the screen (a trigger that wrapped to the start of a row on a
 * phone). Closes
 * on outside click, Escape, or after any click inside (items just run
 * their onClick). The popover is portalled to <body> (position: fixed), so a
 * card's `overflow` never clips it; it sits above the modal that holds its
 * trigger. */
/** Where a menu popover of `width` goes relative to its trigger wrapper:
 *  right-aligned unless that leaves the left viewport edge (or `forceLeft`),
 *  then a horizontal `shift` that keeps it 8 px inside the viewport on both
 *  sides, so no menu can overflow the page. */
export function placeMenu(wrap: { left: number; right: number }, width: number,
  vw: number, forceLeft = false): { left: boolean; shift: number } {
  const edge = 8;
  const left = forceLeft || wrap.right - width < edge;
  const x = left ? wrap.left : wrap.right - width;
  let shift = 0;
  if (x + width > vw - edge) shift = vw - edge - (x + width);
  if (x + shift < edge) shift = edge - x;
  return { left, shift };
}

export function Menu({ trigger, label, variant, icon, up, triggerClass,
  triggerSize = "md", className = "", align, disabled, triggerProps, scroll,
  children }: {
  trigger: ReactNode;
  /** Disables a `variant` trigger (a busy form). */
  disabled?: boolean;
  /** Long list: the popover scrolls past 24 rem (always at most the room to
   *  the viewport edge). */
  scroll?: boolean;
  /** Extra attributes for a labelled `variant` trigger (`data-bar-field`). */
  triggerProps?: Partial<Record<`data-${string}` | "title", string>>;
  children: ReactNode;
  /** Variant-less trigger: replaces the compact header look (e.g. the
   *  `ActionButton` "More" in the sender detail's action row). With a
   *  `variant`: extra classes on the Button (e.g. `w-full`). */
  triggerClass?: string;
  /** Wrapper classes (e.g. `w-full` for a sidebar-width trigger). */
  className?: string;
  /** Popover edge: "left" pins it to the trigger's left edge; default is
   *  right-aligned, flipped when it would overflow the viewport. */
  align?: "left";
  /** Open upward (a menu on a bottom bar). */
  up?: boolean;
  /** Size of a labelled `variant` trigger (`sm` = a bar button). */
  triggerSize?: "md" | "sm";
} & (
  /** `variant` renders the trigger as a design-system `Button` (a labelled
   *  "Tools ▾" button; with `icon` a square icon button, whose `label` is
   *  then required). Without it: the compact header trigger. */
  | { variant: ButtonVariant; icon: true; label: string }
  | { variant?: ButtonVariant; icon?: false; label?: string }
)) {
  const [open, setOpen] = useState(false);
  // Fixed viewport position of the portalled popover (null until measured).
  const [place, setPlace] = useState<{ top?: number; bottom?: number;
    left: number; maxH?: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // The popover lives in <body>, so no ancestor `overflow` (a rounded card)
  // can clip it. Measure, then place it against the viewport: right-aligned
  // unless that leaves the screen, 8 px clamp, flipped up/down to where the
  // room is, height capped to that room.
  const position = () => {
    const el = pop.current;
    const wr = ref.current?.getBoundingClientRect();
    if (!el || !wr) return;
    const w = el.offsetWidth;
    const h = el.scrollHeight;
    const p = placeMenu(wr, w, window.innerWidth, align === "left");
    const left = (p.left ? wr.left : wr.right - w) + p.shift;
    // 8 px from the viewport edge, 4 px (mt-1) / 8 px (mb-2) off the trigger.
    const roomUp = wr.top - 16, roomDown = window.innerHeight - wr.bottom - 12;
    const goUp = up ? !(h > roomUp && roomDown > roomUp)
      : h > roomDown && roomUp > roomDown;
    const room = goUp ? roomUp : roomDown;
    const maxH = h > room ? Math.max(room, 96) : undefined;
    setPlace(goUp
      ? { bottom: window.innerHeight - wr.top + 8, left, maxH }
      : { top: wr.bottom + 4, left, maxH });
  };
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    position();
    // Scrolled out of view or under a sticky header: close, don't float.
    const onScroll = (e: Event) => {
      if (pop.current?.contains(e.target as Node)) return;
      const wr = ref.current?.getBoundingClientRect();
      const hit = wr && document.elementFromPoint?.(
        (wr.left + wr.right) / 2, (wr.top + wr.bottom) / 2);
      if (wr && (wr.bottom < 0 || wr.top > window.innerHeight
        || (hit && !ref.current?.contains(hit) && !pop.current?.contains(hit)))) {
        setOpen(false);
        return;
      }
      position();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", position);
    };
  }, [open]);
  const focusTrigger = () =>
    ref.current?.querySelector<HTMLElement>(":scope > button")?.focus();
  const items = () => [...(pop.current?.querySelectorAll<HTMLElement>(
    '[role^="menuitem"]:not(:disabled)') ?? [])];
  const close = (back = true) => {
    setOpen(false);
    if (back) focusTrigger();
  };
  // Keyboard users land on the first item.
  // (preventScroll: opening a menu never moves the page.)
  useEffect(() => {
    if (open && place) items()[0]?.focus({ preventScroll: true });
  }, [open, !!place]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !pop.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Stop it here (document, before window): a Modal around the menu
      // must not also close on the same Esc.
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const onMenuKey = (e: ReactKeyboardEvent) => {
    // Tab: focus goes back to the trigger, the browser then moves on from it.
    if (e.key === "Tab") { close(); return; }
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    // Type-ahead: a printable key jumps to the next item starting with it.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      && e.key !== " ") {
      const k = e.key.toLowerCase();
      const at = (j: number) => list[(i + 1 + j) % list.length];
      const hit = list.map((_, j) => at(j)).find(
        (el) => el.textContent?.trim().toLowerCase().startsWith(k));
      if (hit) { e.preventDefault(); hit.focus(); }
      return;
    }
    const to = e.key === "ArrowDown" ? list[(i + 1) % list.length]
      : e.key === "ArrowUp" ? list[(i - 1 + list.length) % list.length]
      : e.key === "Home" ? list[0]
      : e.key === "End" ? list[list.length - 1] : null;
    if (to) { e.preventDefault(); to.focus(); }
  };
  return (
    <div className={`relative ${className}`} ref={ref}
      onKeyDown={(e) => {
        // ArrowDown on the closed trigger opens the menu (the effect above
        // then focuses the first item).
        if (!open && e.key === "ArrowDown"
          && e.target === ref.current?.firstElementChild) {
          e.preventDefault();
          setOpen(true);
        }
      }}>
      {variant && icon ? (
        <Button variant={variant} size="icon" label={label}
          className={triggerClass} disabled={disabled}
          aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen(!open)}>
          {trigger}
        </Button>
      ) : variant ? (
        <Button variant={variant} size={triggerSize} aria-haspopup="menu"
          aria-expanded={open} aria-label={label} disabled={disabled}
          {...triggerProps}
          className={`inline-flex items-center gap-1.5 ${triggerClass ?? ""}`}
          onClick={() => setOpen(!open)}>
          {trigger}
        </Button>
      ) : (
        <button className={triggerClass ?? `flex min-h-8 items-center
          rounded-control border border-line bg-panel2 px-2 type-body
          hover:bg-chip`}
          title={label} aria-label={label} aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}>
          {trigger}
        </button>
      )}
      {open && createPortal(
        <div ref={pop} role="menu" onKeyDown={onMenuKey}
          style={{ position: "fixed", top: place?.top, bottom: place?.bottom,
            left: place?.left ?? 0, opacity: place ? 1 : 0,
            pointerEvents: place ? undefined : "none",
            ...(place?.maxH ? { maxHeight: place.maxH } : {}) }}
          className={`z-(--z-modal) min-w-52
            ${place?.maxH || scroll ? "overflow-y-auto" : ""} ${scroll ? "max-h-96" : ""}
            max-w-[calc(100vw-1rem)] rounded-card border border-line bg-panel
            p-1 shadow-popover`}
          onClick={() => close()}>
          {children}
        </div>, document.body)}
    </div>
  );
}

export function MenuItem({ children, onClick, disabled, active, sub,
  danger }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;    // renders a trailing check, role=menuitemradio
  sub?: ReactNode;     // muted second line (e.g. an account's address)
  danger?: boolean;    // destructive entry (quiet red text)
}) {
  return (
    <button
      role={active === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={active}
      className={`flex w-full items-center gap-2 rounded-control px-3 py-2
        text-left type-body enabled:hover:bg-chip
        disabled:cursor-not-allowed disabled:text-faint
        ${danger ? "text-danger-fg" : "text-body"}`}
      onClick={onClick} disabled={disabled}>
      <span className="min-w-0 flex-1 truncate">
        {children}
        {sub != null && sub !== "" && (
          <span className="block truncate type-meta text-muted">{sub}</span>
        )}
      </span>
      {active && <Check size={16} aria-hidden className="text-accent" />}
    </button>
  );
}

export type PopupOption<T extends string = string> =
  | "divider"
  | { heading: string }
  | { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean;
      /** Overrides the default check (`value === current`): a menu that
       *  holds two settings (sort key + direction) checks one of each. */
      checked?: boolean };

/** A pop-up button instead of a native `<select>`: a quiet filled button
 *  showing `label` + the current value + a chevrons icon, which opens the
 *  app's `Menu` with one item per option and a check on the current one.
 *  Enter / Space / ArrowDown open it, arrows move, Esc closes and returns
 *  focus, a letter jumps to the next item starting with it. Long lists
 *  scroll. Placeholder style: without a `value` the button shows
 *  `placeholder` and `onChange` runs the action directly. The accessible
 *  name is "label value". Native `<Select>` stays in settings forms. */
export function PopupSelect<T extends string>({ value, onChange, options,
  label, name: nameBase, placeholder, valueLabel, disabled, up, align, className = "",
  triggerClass = "", triggerProps }: {
  value?: T | null;
  onChange: (v: T) => void;
  options: PopupOption<T>[];
  /** Caption before the value ("Sort:") and the base of the accessible name. */
  label?: string;
  /** Shown while no option is current (placeholder-style selects). */
  placeholder?: string;
  /** Accessible-name base when there is no visible `label` ("Limit to"). */
  name?: string;
  /** Overrides the shown value text (e.g. "Mails ↓"). */
  valueLabel?: ReactNode;
  disabled?: boolean;
  up?: boolean;
  align?: "left";
  /** Wrapper classes (width / flex). */
  className?: string;
  triggerClass?: string;
  /** Extra attributes for the button (`data-bar-field` in a BulkBar). */
  triggerProps?: Partial<Record<`data-${string}` | "title", string>>;
}) {
  const cur = options.find((o): o is Extract<typeof o, { value: T }> =>
    o !== "divider" && "value" in o && o.value === value);
  // A `{ heading }` option starts a labelled MenuGroup (role=group) that runs
  // to the next heading.
  const groups: { heading?: string; items: PopupOption<T>[] }[] = [];
  for (const o of options) {
    if (o !== "divider" && "heading" in o) groups.push({ heading: o.heading, items: [] });
    else {
      if (!groups.length) groups.push({ items: [] });
      groups[groups.length - 1].items.push(o);
    }
  }
  const hasValue = valueLabel != null || cur != null;
  const shown = valueLabel ?? (cur ? cur.label : placeholder);
  const name = [label ?? nameBase, typeof shown === "string" ? shown : null]
    .filter(Boolean).join(" ") || undefined;
  return (
    <Menu variant="secondary" label={name} up={up} align={align} scroll
      disabled={disabled}
      triggerProps={{ "data-popup-select": "", ...triggerProps }}
      className={className}
      triggerClass={`w-full justify-between ${triggerClass}`}
      trigger={<>
        <span className="min-w-0 flex-1 truncate text-left">
          {label && hasValue && (
            <span className="text-muted">{label} </span>
          )}
          {shown}
        </span>
        <ChevronsUpDown size={14} aria-hidden className="shrink-0 text-muted" />
      </>}>
      <>
        {groups.map((g, gi) => {
          const items = g.items.map((o, i) => o === "divider"
            ? <MenuDivider key={`d${i}`} />
            : "heading" in o ? null
            : (
              <MenuItem key={o.value} disabled={o.disabled}
                active={o.checked ?? (o.value === value)}
                onClick={() => onChange(o.value)}>
                {o.icon ? (
                  <span className="flex items-center gap-2">
                    {o.icon}{o.label}
                  </span>
                ) : o.label}
              </MenuItem>
            ));
          return g.heading
            ? <MenuGroup key={`g${gi}`} label={g.heading}>{items}</MenuGroup>
            : <Fragment key={`g${gi}`}>{items}</Fragment>;
        })}
      </>
    </Menu>
  );
}

/** Hairline between groups of MenuItems. */
export function MenuDivider() {
  return <div role="separator" className="my-1 border-t border-line" />;
}

/** A labelled section of MenuItems. The label is a visual caption of the
 *  group (role=group + aria-label carry it for assistive tech); it is not a
 *  menuitem, so arrow-key navigation skips it. A later group gets a hairline
 *  above it. */
export function MenuGroup({ label, children }: {
  label: string; children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label}
      className="[&:not(:first-child)]:mt-1 [&:not(:first-child)]:border-t
        [&:not(:first-child)]:border-line [&:not(:first-child)]:pt-1">
      {/* stopPropagation: a click on the caption must not close the Menu */}
      <div aria-hidden onClick={(e) => e.stopPropagation()}
        className="px-3 pb-0.5 pt-1.5 type-caption
        font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

/* Non-semantic identity hues (never emerald/amber/rose/sky/orange - those
 * are reserved: delete-safe/review/keep/replied/attachments). */
const ACCOUNT_HUES = [
  "bg-violet-900 text-violet-300",
  "bg-teal-900 text-teal-300",
  "bg-cyan-900 text-cyan-300",
  "bg-lime-900 text-lime-300",
  "bg-indigo-900 text-indigo-300",
  "bg-fuchsia-900 text-fuchsia-300",
];

/** Number of identity hues. */
export const HUE_COUNT = ACCOUNT_HUES.length;

/** Index into the hue list for a name (stable hash). */
export const hueIndex = (name: string): number => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % HUE_COUNT;
};

const hueOf = (name: string): string => ACCOUNT_HUES[hueIndex(name)];

/* Fills for chart hue `i` (donut slices, storage bars, legend dots): the
 * category palette of index.css, one token per hue, softened on dark and
 * deep on light (>= 3:1 against the panel; index.contrast.test.ts). Not tied
 * to the avatar tints above. */
const HUE_FILLS = ["bg-cat-1", "bg-cat-2", "bg-cat-3", "bg-cat-4", "bg-cat-5",
  "bg-cat-6"];

/** Chart fill (storage-bar segment, donut slice, legend dot) in hue `i`. */
export const hueFillAt = (i: number): string => HUE_FILLS[i % HUE_COUNT];

/** Letter avatar identifying one account/sender/domain, tinted by a
 *  stable hash of its name so entries stay visually distinct. `size`
 *  controls the diameter: "sm" (account switcher), "md" (group rows) or "lg"
 *  (the sender detail header) or "xl" (a hero, e.g. the story's loudest sender). */
export function Avatar({ name, size = "sm", className = "" }: {
  name: string; size?: "sm" | "md" | "lg" | "xl"; className?: string;
}) {
  const dims = size === "xl" ? "size-28 type-display"
    : size === "lg" ? "size-16 type-title2"
    : size === "md" ? "size-8 type-meta" : "size-5 type-caption";
  return (
    <span className={`inline-flex ${dims} shrink-0 items-center
      justify-center rounded-full font-semibold uppercase
      ${hueOf(name)} ${className}`}>
      {name.charAt(0)}
    </span>
  );
}

/** Round icon button with its label underneath (the sender detail's action
 *  row: Unsubscribe, Block, Protect, Move...). The label is always visible -
 *  the icon alone never carries the meaning. `label` is the visible caption;
 *  `ariaLabel` may extend it (it must contain the caption). `on` = a toggle
 *  that is currently set (Protect). */
export const ACTION_BTN = `group flex min-w-0 cursor-pointer flex-col
  items-center gap-1 rounded-control px-1 py-1 text-center type-caption text-muted
  enabled:hover:text-body disabled:cursor-not-allowed disabled:text-faint`;

/** The icon disc + caption of an `ActionButton`; also the trigger content of
 *  a `Menu` (pass `ACTION_BTN` as its `triggerClass`). */
export function ActionFace({ icon, label, on = false }: {
  icon: ReactNode; label: string; on?: boolean;
}) {
  return (
    <>
      <span aria-hidden className={`flex size-11 items-center justify-center
        rounded-full text-accent transition-colors group-disabled:text-faint
        ${on ? "bg-accent-tint" : "bg-chip group-enabled:group-hover:bg-chiph"}`}>
        {icon}
      </span>
      <span>{label}</span>
    </>
  );
}

export function ActionButton({ icon, label, ariaLabel, title, on, onClick,
  disabled, className = "" }: {
  icon: ReactNode; label: string; ariaLabel?: string; title?: string;
  on?: boolean; onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return (
    <button type="button" aria-label={ariaLabel} title={title ?? ariaLabel}
      aria-pressed={on} disabled={disabled} onClick={onClick}
      className={`${ACTION_BTN} ${className}`}>
      <ActionFace icon={icon} label={label} on={on} />
    </button>
  );
}

/** Quiet figure tile (label over a bold value): the sender detail's
 *  Mails / Size / Opened row. */
export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-card bg-panel2 px-3 py-2">
      <div className="truncate type-meta text-muted">{label}</div>
      <div className="truncate type-heading">{value}</div>
    </div>
  );
}

/** Progress ring (SVG, theme tokens): `frac` 0..1 of the accent arc over a
 *  `chip` track, `children` in the centre. Decorative unless `label` is set
 *  (then `role="img"`); pair it with the same figure as visible text. */
export function Ring({ frac, px = 56, label, children }: {
  frac: number; px?: number; label?: string; children?: ReactNode;
}) {
  const R = 50;                       // viewBox 120, stroke 12 -> inner radius 44
  const C = 2 * Math.PI * R;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div role={label ? "img" : undefined} aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative grid shrink-0 place-items-center"
      // a pixel size chosen per use (tile vs card), not a layout token
      style={{ width: px, height: px }}>
      <svg viewBox="0 0 120 120" fill="none" strokeWidth={14}
        className="absolute inset-0 size-full -rotate-90">
        <circle cx="60" cy="60" r={R} className="stroke-chip" />
        {f > 0 && (   // no arc at 0: a round cap would draw a stray dot
          <circle cx="60" cy="60" r={R} strokeLinecap="round"
            className="stroke-accent" strokeDasharray={`${C * f} ${C}`} />
        )}
      </svg>
      {children && <div className="relative type-caption">{children}</div>}
    </div>
  );
}

/** Tiny column chart (sparkline) of `values`, scaled to the largest. Hidden
 *  from assistive tech unless `label` (a text alternative with the numbers)
 *  is set; `dimLast` fades the last bar (a month still running); `sizeClass`
 *  replaces the default 80 x 40 px box, `barClass` the bar rounding. */
export function MiniBars({ values, className = "", label, dimLast = false,
  sizeClass = "h-10 w-20", barClass = "rounded-full" }: {
  values: number[]; className?: string; label?: string; dimLast?: boolean;
  sizeClass?: string; barClass?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div role={label ? "img" : undefined} aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`flex ${sizeClass} items-end gap-px ${className}`}>
      {values.map((v, i) => (
        <div key={i} className={`min-w-px flex-1 ${barClass} bg-accent/70
          ${dimLast && i === values.length - 1 ? "opacity-40" : ""}`}
          style={{ height: `${Math.max(8, (100 * v) / max)}%` }} />
      ))}
    </div>
  );
}

/** Donut chart: one `Hue` slice per entry (`hueFillAt` colours, never the
 *  only signal - callers render a legend with the values), `children` in the
 *  hole. Slices are masked discs, so no raw colours are needed; the hole is a
 *  disc in `holeClass` (the surface the donut sits on, default `bg-panel2`). */
export function Donut({ slices, px = 152, label, holeClass = "bg-panel2",
  restLast = false, hues, children }: {
  slices: number[]; px?: number; label: string; holeClass?: string;
  /** hue per slice (`hueFillAt` index); default: slice number */
  hues?: number[];
  /** The last slice is the folded "Other": neutral (`bg-faint`), no hue. */
  restLast?: boolean;
  children?: ReactNode;
}) {
  const total = slices.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return (
    <div role="img" aria-label={label}
      className="relative grid shrink-0 place-items-center"
      // a pixel size chosen per use, not a layout token
      style={{ width: px, height: px }}>
      {slices.map((v, i) => {
        const from = (360 * at) / total;
        // a hairline gap between slices (the surface shows through)
        const span = Math.max(0, (360 * v) / total - (slices.length > 1 ? 1.5 : 0));
        at += v;
        const mask = `conic-gradient(from ${from}deg, #000 ${span}deg, transparent 0)`;
        return (
          <div key={i}
            className={`absolute inset-0 rounded-full
              ${restLast && i === slices.length - 1 ? "bg-faint"
                : hueFillAt(hues?.[i] ?? i)}`}
            // slice = conic mask over a full disc; colour comes from the class
            style={{ maskImage: mask, WebkitMaskImage: mask }} />
        );
      })}
      {/* hole = 64 % of the disc: a ring width that reads at 120-152 px */}
      <div className={`absolute inset-[18%] rounded-full ${holeClass}`} />
      {/* centre text must fit the hole (64 % wide), so it wraps inside 56 % */}
      <div className="relative grid justify-items-center text-center"
        style={{ maxWidth: "56%" }}>
        {children}
      </div>
    </div>
  );
}

/** Account-switcher-sized avatar - thin wrapper around `Avatar`. */
export function AccountAvatar({ name, size, className = "" }: {
  name: string; size?: "sm" | "md" | "lg"; className?: string;
}) {
  return <Avatar name={name} size={size} className={className} />;
}

/** Non-interactive heading line inside a Menu (e.g. the identity). */
export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-64 truncate border-b border-line px-3 pb-2 pt-1
      type-meta text-muted">
      {children}
    </div>
  );
}

/** "Nothing here" message. Plain children still work; `icon`/`title`/
 *  `hint`/`action` give it the fuller illustrated shape. */
export function EmptyState({ children, icon, title, hint, action }: {
  children?: ReactNode; icon?: ReactNode; title?: ReactNode;
  hint?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-center
      type-body text-muted">
      {icon != null && <span className="text-faint">{icon}</span>}
      {title != null && (
        <div className="type-heading text-body">{title}</div>
      )}
      {children}
      {hint != null && <div className="type-meta">{hint}</div>}
      {action != null && <div className="pt-1">{action}</div>}
    </div>
  );
}

// Open modals, oldest first (module-level: dialogs opened from anywhere).
const openModals: symbol[] = [];

/** True while any Modal (panel or confirm/prompt dialog) is mounted. Global
 *  keyboard shortcuts must stay quiet then. */
export const isModalOpen = (): boolean => openModals.length > 0;

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, '
  + 'textarea, [tabindex]';

/** Tab stops inside `root`, in DOM order. CSS-hidden elements (display:none
 *  parents, `hidden md:block` twins) are skipped wherever the browser lays
 *  out; jsdom has no layout, so there the check is off. */
const tabStops = (root: HTMLElement): HTMLElement[] => {
  const layout = document.documentElement.getClientRects().length > 0;
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) =>
    el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled
    && !el.closest("[hidden]")
    && (!layout || el.getClientRects().length > 0));
};

/** Where Tab may go inside a dialog: its own controls, then the toast stack
 *  (toasts never take focus on their own, but Undo must stay reachable). */
const trapStops = (dialog: HTMLElement): HTMLElement[] => {
  const toasts = document.querySelector<HTMLElement>(".pmc-toasts");
  return [...tabStops(dialog), ...(toasts ? tabStops(toasts) : [])];
};

const MODAL_WIDTH = { sm: "sm:max-w-md", md: "sm:max-w-2xl",
  lg: "sm:max-w-3xl" };   // 448 / 672 / 768 px

/** Hand focus back to what opened a dialog. Not to a <select> on a touch
 *  device: there, focusing a select opens its picker (iOS), so the bulk
 *  bar's Action menu popped open again right after a confirmed action. */
function refocus(el: HTMLElement | null | undefined, scroll = true): void {
  if (!el) return;
  if (el instanceof HTMLSelectElement
      && window.matchMedia?.("(pointer: coarse)").matches) return;
  el.focus?.(scroll ? undefined : { preventScroll: true });
}

/** Swipe-down-to-close for a phone bottom sheet (Pointer Events, touch and
 *  pen). A drag starts on the grabber strip (`[data-sheet-grabber]`) or
 *  anywhere else while nothing under the finger is scrolled down, and never in
 *  a text field or on a mostly horizontal move. The sheet follows the finger,
 *  the backdrop fades with it; release past 25 % of the height or a fast
 *  flick calls `close` (the same path as a backdrop tap / Esc), else it snaps
 *  back. Reduced motion: no following, the threshold alone decides. */
const SHEET_PHONE = "(max-width: 639.98px)";
const SHEET_REDUCED = "(prefers-reduced-motion: reduce)";
const SHEET_SLOP = 8;          // px before a move counts as a drag
const SHEET_FRACTION = 0.25;   // of the sheet height
const SHEET_FLICK = 0.5;       // px/ms

function useSheetSwipe(enabled: boolean, dialog: RefObject<HTMLDivElement | null>,
  backdrop: RefObject<HTMLDivElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const el = dialog.current;
    if (!enabled || !el) return;
    type Gesture = { id: number; x: number; y: number; dragging: boolean;
      samples: { t: number; y: number }[] };
    let g: Gesture | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const reduced = () => !!window.matchMedia?.(SHEET_REDUCED).matches;
    const show = (dy: number, ms: number) => {
      if (reduced()) return;
      el.style.transition = ms ? `transform ${ms}ms ease-out` : "none";
      el.style.transform = dy ? `translateY(${dy}px)` : "";
      if (backdrop.current) {
        backdrop.current.style.transition = ms ? `opacity ${ms}ms ease-out` : "none";
        backdrop.current.style.opacity = String(
          1 - Math.min(1, dy / (el.offsetHeight || 1)));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      g = null;
    };
    // Something between the finger and the sheet is scrolled down: the
    // gesture belongs to that scroller.
    const scrolled = (from: HTMLElement) => {
      for (let n: HTMLElement | null = from; n && n !== el; n = n.parentElement)
        if (n.scrollTop > 0) return true;
      return false;
    };
    const down = (e: PointerEvent) => {
      if (g || e.pointerType === "mouse" || !e.isPrimary) return;
      if (!window.matchMedia?.(SHEET_PHONE).matches) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (!t.closest("[data-sheet-grabber]") && scrolled(t)) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false,
        samples: [{ t: e.timeStamp, y: e.clientY }] };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    };
    const move = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.dragging) {
        if (Math.abs(dy) < SHEET_SLOP && Math.abs(dx) < SHEET_SLOP) return;
        // Up or sideways: not ours (a scroll, a swipe row).
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { stop(); return; }
        g.dragging = true;
      }
      g.samples.push({ t: e.timeStamp, y: e.clientY });
      if (g.samples.length > 6) g.samples.shift();
      show(Math.max(0, dy), 0);
    };
    const up = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const { dragging, samples, y } = g;
      stop();
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - y);
      const first = samples.find((s) => e.timeStamp - s.t <= 100) ?? samples[0];
      const dt = e.timeStamp - first.t;
      const flick = dt > 0 && (e.clientY - first.y) / dt >= SHEET_FLICK;
      if (dy > el.offsetHeight * SHEET_FRACTION || flick) {
        closeRef.current();
        // An onClose that does not unmount (a refused close) must not leave
        // the sheet stuck half off-screen: snap back unless it is gone.
        settle = setTimeout(() => show(0, 200), 250);
      } else show(0, 200);
    };
    const cancel = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const was = g.dragging;
      stop();
      if (was) show(0, 200);
    };
    // The browser claims a vertical touch for scrolling (and pull-to-refresh)
    // unless the first touchmove is cancelled; do that for our own gestures.
    const touch = (e: TouchEvent) => {
      if (!g || !e.cancelable) return;
      const f = e.touches[0];
      if (!f) return;
      const dy = f.clientY - g.y, dx = f.clientX - g.x;
      if (g.dragging || (dy > SHEET_SLOP && dy > Math.abs(dx))) e.preventDefault();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("touchmove", touch, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("touchmove", touch);
      clearTimeout(settle);
      stop();
    };
  }, [enabled, dialog, backdrop]);
}

/** Dialog shell. `sm` (448) is a bottom sheet on phones, `md` (672) /
 *  `lg` (768) are full-screen there. `full` = `lg` at a fixed 88vh; other
 *  modals shrink to their content. `label` / `labelledBy` / `describedBy` name it for AT. */
export function Modal({ children, onClose, full = false, size, label,
  labelledBy, describedBy, edgeBack = false, backLayer = true }: {
  children: ReactNode; onClose: () => void; full?: boolean;
  size?: "sm" | "md" | "lg"; label?: string;
  labelledBy?: string; describedBy?: string;
  /** The open modal owns a history entry, so Back closes it (`useLayer`;
   *  not a tool page, which is a route). False for one that is not opened by
   *  the user (the first-run wizard is the whole screen). */
  backLayer?: boolean;
  /** A full-screen page with a back target (a tool page always is): in an
   *  installed app a drag from the left edge calls `onClose` (`useEdgeBack`). */
  edgeBack?: boolean;
}) {
  const sz = size ?? (full ? "lg" : "md");
  const presentation = useContext(PresentationContext);
  const slot = presentation === "slot";
  const tool = presentation === "tool";
  const id = useRef(Symbol("modal")).current;
  const dialog = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const sheet = sz === "sm" && !slot;
  useSheetSwipe(sheet, dialog, backdrop, onClose);
  // Whatever had focus when the modal opened (read during the first render,
  // before an autoFocus child can take it): focus returns there on close.
  const opener = useRef<Element | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = document.activeElement;
  // The listener calls the latest onClose; the effect itself depends on
  // [id] only, so a parent re-render (inline onClose) never re-registers
  // the modal and reshuffles the stack.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Back closes the modal on top (a page has no overlay to close).
  const entry = useContext(BackEntryContext);
  useLayer(!slot && backLayer && entry, () => closeRef.current());
  // Edge swipe back, only for the modal on top (a confirm over it wins).
  useEdgeBack(dialog, () => closeRef.current(),
    !slot && sz !== "sm" && (tool || edgeBack),
    () => openModals[openModals.length - 1] === id);
  // Layout effect: the stack is current as soon as the modal is in the DOM,
  // before any key event can arrive.
  useLayoutEffect(() => {
    if (slot) return;   // a page: not on the stack, no Esc, no focus trap
    openModals.push(id);
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost modal reacts, so Esc on a confirm that sits over
      // a panel closes the confirm and leaves the panel open.
      if (openModals[openModals.length - 1] !== id) return;
      // preventDefault marks the Esc as used: another window listener (App's
      // pane Esc) runs after the re-render and must not act on it too. A
      // popover that already handled it (defaultPrevented) leaves us alone.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        closeRef.current();
      }
      // Focus trap: Tab wraps inside the dialog and never reaches the page
      // behind it.
      if (e.key === "Tab" && dialog.current) {
        const stops = trapStops(dialog.current);
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const edge = e.shiftKey ? at <= 0 : at === stops.length - 1;
        if (!stops.length || at < 0 || edge) {
          e.preventDefault();
          (stops.length ? stops[e.shiftKey ? stops.length - 1 : 0]
            : dialog.current).focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
    };
  }, [id, slot]);
  useEffect(() => {
    if (slot) return;   // pages keep focus where the user is (the sidebar)
    const d = dialog.current;
    // Children that asked for focus (autoFocus, ConfirmDialog) already have
    // it; otherwise start on the dialog itself so Tab goes to its first
    // control and a screen reader announces the dialog.
    if (d && !d.contains(document.activeElement)) d.focus();
    const back = opener.current as HTMLElement | null;
    // The opener can be gone by close time (Trash all unmounts its row):
    // fall back to the list it sat in, so focus never drops to <body>.
    const home = back?.closest<HTMLElement>("[data-focus-return]") ?? null;
    return () => {
      const to = back?.isConnected ? back
        : home?.isConnected ? home
        : document.querySelector<HTMLElement>("[data-focus-return]");
      // The fallback is the whole list: focusing it must not scroll the
      // page to its top (an Undo picked from the menu, whose item is gone).
      refocus(to, to === back);
    };
  }, [slot]);
  const shape = sz === "sm"
    ? `max-h-[88dvh] rounded-t-dialog border-t max-sm:pb-[env(safe-area-inset-bottom)]
       sm:rounded-dialog`
    : full
      ? "h-dvh sm:h-[88vh]"
      : "h-dvh sm:h-auto sm:max-h-[88vh]";
  // Content-sized modals scroll in an inner box, so on a phone the safe-area
  // padding of the dialog stays put (a scrolling dialog would carry it away).
  // iPhone (viewport-fit=cover): full-screen modals keep their header below
  // the status bar.
  const scrolls = (sz !== "sm" || slot) && !full;
  // Full panels place their own footers above the home indicator.
  const inset = sz === "sm" ? "" : " max-sm:pt-[env(safe-area-inset-top)]"
    + (scrolls ? " max-sm:pb-[env(safe-area-inset-bottom)]" : "");
  // One element tree for both presentations (only classes and attributes
  // differ), so the panel inside keeps its state when `slot` flips.
  return (
    <div
      className={slot ? "contents" : `fixed inset-0 z-(--z-modal) flex
        justify-center p-0 sm:p-6
        ${sz === "sm" ? "items-end sm:items-center" : "items-center"}`}
      onClick={slot ? undefined
        : (e) => e.target === e.currentTarget && onClose()}>
      {/* The scrim is its own layer so a swipe can fade it without the
          sheet. Not in the page presentation (no overlay there). */}
      {slot ? null : <div ref={backdrop} aria-hidden
        className="pointer-events-none absolute inset-0 bg-overlay backdrop-blur-sm" />}
      <div ref={dialog} tabIndex={slot ? undefined : -1}
        role={slot ? "region" : "dialog"}
        aria-modal={slot ? undefined : true}
        aria-label={label}
        aria-labelledby={labelledBy} aria-describedby={describedBy}
        data-size={sz}
        className={slot
          // A page: fills the content column, scrolls inside like a `full`
          // panel.
          ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden"
          : `relative flex w-full flex-col overflow-hidden border-line bg-panel outline-none
        sm:rounded-dialog sm:border ${MODAL_WIDTH[sz]} ${shape}${inset}`}>
        {/* Grabber: phones only (the sheet presentation); also the drag
            handle, with a bigger touch area than it looks. */}
        {sheet && <div aria-hidden data-sheet-grabber
          className="flex h-6 shrink-0 touch-none justify-center pt-2 sm:hidden">
          <span className="h-1.25 w-9 rounded-full bg-faint/70" />
        </div>}
        {/* Always rendered (`contents` when not scrolling): `full` can flip
            while open, and a changing tree would remount the content. */}
        <div data-scroll-id={scrolls && slot ? "page" : undefined}
          className={scrolls ? (slot ? "flex min-h-0 flex-1 flex-col overflow-y-auto"
          : `flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-initial`)
          : "contents"}>
          {/* Children see "page" on a page (PanelHeader drops its close
              button) and "modal" in a dialog, so a dialog opened from a page
              is a real modal again. */}
          <PresentationContext.Provider
            value={slot ? "page" : tool ? "screen" : "modal"}>
            <BackEntryContext.Provider value={true}>
              <PageScopeContext.Provider value={slot}>
                {children}
              </PageScopeContext.Provider>
            </BackEntryContext.Provider>
          </PresentationContext.Provider>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- checkbox, chips, notice ------------------------ */

/** The one checkbox. The <label> is the hit area (32 px, 44 px on touch);
 *  the box itself is 18 px in the accent colour. Without `label` text give
 *  it an `aria-label`. All native input props are forwarded. */
export function Checkbox({ label, className = "", round = false, ...rest }:
  Omit<ComponentProps<"input">, "type"> & {
    label?: ReactNode;
    /** Round check (iOS select mode) instead of the native box. */
    round?: boolean;
  }) {
  return (
    <label className={`group/ck relative inline-flex min-h-8 min-w-8
      coarse:min-h-11 coarse:min-w-11 cursor-pointer items-center gap-2
      type-body ${label != null ? "justify-start" : "shrink-0 justify-center"}
      ${rest.disabled ? "cursor-not-allowed text-faint" : ""}
      ${className}`}>
      {round ? (
        <>
          <input type="checkbox" className="peer sr-only" {...rest} />
          {/* has-checked: the sibling input's state styles the disc */}
          <span aria-hidden className="grid size-5.5 shrink-0 place-items-center
            rounded-full border-2 border-muted text-on-accent
            group-has-checked/ck:border-accent group-has-checked/ck:bg-accent
            peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2
            peer-focus-visible:outline-accent">
            <Check size={14} strokeWidth={3}
              className="opacity-0 group-has-checked/ck:opacity-100" />
          </span>
        </>
      ) : (
        <input type="checkbox"
          className="size-4.5 shrink-0 cursor-[inherit] accent-accent"
          {...rest} />
      )}
      {label != null && <span className="min-w-0">{label}</span>}
    </label>
  );
}

/** Toggle chip (quick filters / presets). On = accent border + check. */
export function Chip({ on = false, children, className = "", ...rest }:
  Omit<ComponentProps<"button">, "type"> & { on?: boolean }) {
  return (
    <button type="button" aria-pressed={on} {...rest}
      className={`inline-flex min-h-8 coarse:min-h-9 items-center gap-1.5
        whitespace-nowrap rounded-full border px-3 type-meta transition-colors
        enabled:active:translate-y-px disabled:cursor-not-allowed
        disabled:border-line disabled:bg-chip disabled:text-faint
        ${on ? "border-accent bg-chiph text-body"
          : "border-line bg-panel2 text-muted enabled:hover:bg-chip"}
        ${className}`}>
      {on && <Check size={14} aria-hidden />}
      {children}
    </button>
  );
}

/** Segmented control for mutually exclusive views (tablist), iOS look: a
 *  tinted track, the selected segment a raised pill (`segment-on` + small
 *  shadow, semibold), no accent ring, no dividers. `fill` makes
 *  the row full-width, segments sized to their content (`flex-auto`).
 *  `equal` gives every segment the width of the widest one (a short label
 *  next to a long one no longer looks small). */
export function Segmented<T extends string>({ value, onChange, options,
  label, fill = false, tall = false, equal = false, className = "",
  idPrefix, role = "tab" }: {
  value: T | null;
  onChange: (v: T) => void;
  /** `disabled` greys one segment out (a state the user cannot pick yet). */
  options: { value: T; label: ReactNode; disabled?: boolean;
    /** id of text that explains the option (why it is disabled). */
    describedBy?: string }[];
  label: string;
  fill?: boolean;
  /** 44 px tall segments (phone sheets with big touch targets). */
  tall?: boolean;
  /** Equal-width segments (grid columns of 1fr). */
  equal?: boolean;
  className?: string;
  /** Wires the tabs to a panel: tab ids `${idPrefix}-tab-${value}`, and the
   *  selected one gets `aria-controls="${idPrefix}-panel"` (render the panel
   *  with `tabPanelProps(idPrefix, value)`). */
  idPrefix?: string;
  /** `radio`: a choice (radiogroup, `aria-checked`) rather than tabs that
   *  switch a panel - e.g. a mode switch on a card. */
  role?: "tab" | "radio";
}) {
  const radio = role === "radio";
  // Roving tabindex: Tab enters on the selected segment, Left/Right/Home/End
  // move FOCUS only; Enter/Space (a native click) activates. Selection must
  // not follow focus: a change can have side effects (clears a selection).
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>(
      '[role="tab"], [role="radio"]')];
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const to = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length]
      : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === "Home" ? tabs[0]
      : e.key === "End" ? tabs[tabs.length - 1] : null;
    if (to) { e.preventDefault(); to.focus(); }
  };
  const tabStop = options.some((o) => o.value === value) ? value
    : options[0]?.value;
  return (
    <div role={radio ? "radiogroup" : "tablist"} aria-label={label}
      onKeyDown={onKey}
      className={`${equal ? "inline-grid grid-flow-col auto-cols-fr"
        : "inline-flex items-stretch"} gap-0.5 rounded-control bg-chip p-0.5
        ${fill ? "w-full" : ""} ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role={radio ? "radio" : "tab"}
            aria-selected={radio ? undefined : on}
            aria-checked={radio ? on : undefined}
            id={idPrefix && `${idPrefix}-tab-${o.value}`}
            aria-controls={idPrefix && on && !radio
              ? `${idPrefix}-panel` : undefined}
            tabIndex={o.value === tabStop ? 0 : -1}
            disabled={o.disabled} aria-describedby={o.describedBy}
            onClick={() => onChange(o.value)}
            className={`${tall ? "min-h-11 coarse:min-h-11"
              : "min-h-9 coarse:min-h-10"} min-w-0 whitespace-nowrap
              px-1.5 transition-colors type-meta md:type-body md:px-2 lg:px-3
              focus-visible:-outline-offset-2 enabled:active:translate-y-px
              rounded-badge disabled:cursor-not-allowed disabled:opacity-50
              ${fill && !equal ? "flex-auto" : ""}
              ${on ? "bg-segment-on font-semibold text-body shadow-segment"
                : "text-muted hover:text-body"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Props for the one panel a `Segmented idPrefix={…}` controls. */
export const tabPanelProps = (idPrefix: string, value: string) => ({
  role: "tabpanel" as const, id: `${idPrefix}-panel`,
  "aria-labelledby": `${idPrefix}-tab-${value}`,
});

/** Live `matchMedia` flag (false where matchMedia doesn't exist, e.g.
 *  jsdom: components then render their wide layout). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window.matchMedia === "function"
    && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** True for content that sits on a page (a tool page, the split pane), false
 *  inside an overlay (every `Modal`; its children reset it). */
const PageScopeContext = createContext(false);

/** Marks its content as part of a page: readers inside it are not overlays,
 *  so they own no history entry (`useBackLayer`). */
export function PageScope({ children }: { children: ReactNode }) {
  return <PageScopeContext.Provider value={true}>
    {children}</PageScopeContext.Provider>;
}

/** An in-panel reader (a mail, a thread) that Back closes (V8): while
 *  `active` inside an overlay it owns one history entry, so browser Back,
 *  Safari's back swipe, Android's system Back and the installed app's edge
 *  swipe call `close` and land on what is underneath; closing it any other way
 *  pops the entry again. On a page (`PageScope`) nothing changes. `Modal`
 *  does this for itself, at every width. See `backStack.ts`. */
export function useBackLayer(active: boolean, close: () => void): void {
  const onPage = useContext(PageScopeContext);
  useLayer(active && !onPage, close);
}

/** Dismissible inline notice (replaces the one-off banners). `tone="danger"`
 *  is the same red pair as the error toast (`keep`): a warning about
 *  something irreversible (e.g. deleting mail on the server for good). */
const NOTICE_TONE = {
  neutral: "bg-panel2 text-body",
  danger: "bg-keep-bg text-keep-fg",
  warn: "bg-review-bg text-review-fg",
};

/** `role` "alert" (and an `id` for `aria-describedby`) for an error that
 *  belongs to a form field and must be announced when it appears. */
export function Notice({ children, icon, onClose, tone = "neutral",
  className = "", role = "status", id }: {
  children: ReactNode; icon?: ReactNode; onClose?: () => void;
  tone?: "neutral" | "danger" | "warn";
  className?: string; role?: "status" | "alert"; id?: string;
}) {
  return (
    <div role={role} id={id} className={`flex items-start gap-2 rounded-card
      px-3 py-2 type-meta ${NOTICE_TONE[tone]} ${className}`}>
      {icon != null && <span className={`mt-0.5 shrink-0 ${tone === "danger"
        ? "text-keep-fg" : tone === "warn" ? "text-review-fg"
        : "text-muted"}`}>{icon}</span>}
      <div className="min-w-0 flex-1 py-0.5">{children}</div>
      {onClose && (
        <Button variant="quiet" size="icon" label={t("Dismiss")}
          className="-my-1.5 -mr-2" onClick={onClose}>
          <X size={18} />
        </Button>
      )}
    </div>
  );
}

/** The "not available in the demo" reason, visible (not just a tooltip, which
 *  touch screens lack). Renders nothing outside demo mode. */
export function DemoHint({ className = "" }: { className?: string }) {
  if (!useDemo()) return null;
  return <p className={`type-meta text-muted ${className}`}>{demoHint()}</p>;
}

/** Disables a group of controls in demo mode. Outside the demo it renders
 *  just its children - no wrapper, so the DOM and a11y tree stay as before. */
export function DemoFieldset({ children }: { children: ReactNode }) {
  if (!useDemo()) return <>{children}</>;
  return <fieldset disabled className="contents">{children}</fieldset>;
}

/* --------------------------------- toasts --------------------------------- */

export type ToastVariant = "info" | "success" | "error";
export type ToastOptions = {
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
  /** A second button next to `action` (e.g. Undo + Protect sender). */
  action2?: { label: string; onClick: () => void };
  /** ms before auto-dismiss; 0 = stay until closed. Default 8000, and
   *  errors stay by default. */
  duration?: number;
};
type ToastItem = ToastOptions & { id: number; message: ReactNode };

const TOAST_MS = 8000;
const TOAST_STYLE: Record<ToastVariant, string> = {
  info: "border-line bg-panel2 text-body",
  // Toasts float over the list: opaque panel base, the translucent tint
  // layered on top as a flat gradient (a `*-bg` alone lets the page show through).
  success: "border-transparent bg-panel bg-linear-to-b from-safe-bg to-safe-bg text-safe-fg",
  error: "border-transparent bg-panel bg-linear-to-b from-keep-bg to-keep-bg text-keep-fg",
};

type ToastApi = {
  show: (message: ReactNode, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
};
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider>");
  return api;
}

/** `useToast` for components that also render outside a provider (tests). */
export function useOptionalToast(): ToastApi | null {
  return useContext(ToastContext);
}

const TOAST_ICON = { info: Info, success: CheckCircle2, error: AlertCircle };

// `dismiss` is stable and the timer depends only on [ms, id, dismiss], so a
// re-render (another toast arriving, parent updates) never restarts it.
function ToastView({ toast, dismiss }: {
  toast: ToastItem; dismiss: (id: number) => void;
}) {
  const { variant = "info", action, action2, duration, id } = toast;
  const ms = duration ?? (variant === "error" ? 0 : TOAST_MS);
  const box = useRef<HTMLDivElement>(null);
  // The toast is about to unmount: if the user had focused one of its
  // buttons, hand focus to the open dialog instead of dropping it on <body>.
  const handBack = () => {
    if (!box.current?.contains(document.activeElement)) return;
    const dlgs = document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]');
    dlgs[dlgs.length - 1]?.focus();
  };
  const onDismiss = () => { handBack(); dismiss(id); };
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(() => dismiss(id), ms);
    return () => clearTimeout(timer);
  }, [ms, id, dismiss]);
  const Icon = TOAST_ICON[variant];
  return (
    <div ref={box} data-variant={variant}
      role={variant === "error" ? "alert" : undefined}
      className={`pointer-events-auto flex
      w-full max-w-120 items-center gap-2 rounded-card border py-1.5 pl-3
      pr-1.5 shadow-bar type-body ${TOAST_STYLE[variant]}`}>
      <Icon size={16} aria-hidden className={`shrink-0 ${variant === "error"
        ? "text-danger-fg" : ""}`} />
      <div className="min-w-0 flex-1 py-1">{toast.message}</div>
      {[action, action2].map((a) => a && (
        <Button key={a.label} variant="quiet" size="sm"
          className="shrink-0 !text-inherit"
          onClick={() => { a.onClick(); onDismiss(); }}>
          {a.label}
        </Button>
      ))}
      <Button variant="quiet" size="icon" label={t("Dismiss")}
        className="shrink-0 !text-inherit" onClick={onDismiss}>
        <X size={18} />
      </Button>
    </div>
  );
}

/** Publishes the height of a fixed bottom bar as a CSS variable while
 *  `active` (`--bulkbar-h` for the selection bar, `--tabbar-h` for the phone
 *  tab bar, `--topbar-h` for the sticky phone top bar), so the toast stack (`.pmc-toasts`) and the page padding clear
 *  it. */
export function useBulkBarHeight(ref: RefObject<HTMLElement | null>,
    active: boolean, prop: "--bulkbar-h" | "--tabbar-h" | "--topbar-h" = "--bulkbar-h") {
  useEffect(() => {
    const root = document.documentElement.style;
    const el = ref.current;
    if (!active || !el) return;
    const sync = () => root.setProperty(prop, `${el.offsetHeight}px`);
    sync();
    // The phone tab bar steps aside (CSS) while a selection bar is up.
    if (prop === "--bulkbar-h") document.documentElement.dataset.bulkbar = "";
    const ro = typeof ResizeObserver === "undefined"
      ? null : new ResizeObserver(sync);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.removeProperty(prop);
      if (prop === "--bulkbar-h") delete document.documentElement.dataset.bulkbar;
    };
  }, [ref, active, prop]);
}

/** One button of the selection capsule: icon-only below md (>= 44 px wide on
 *  touch, the label stays as the accessible name), icon + text from md. */
export function BarButton({ icon, children, variant = "secondary", className = "",
  ...rest }: Omit<ComponentProps<"button">, "title"> & {
  icon: ReactNode; variant?: ButtonVariant; title?: string;
}) {
  return (
    <Button variant={variant} size="sm" {...rest}
      className={`${BAR_BTN} ${className}`}>
      {icon}
      <span className="sr-only md:not-sr-only md:ml-1.5">{children}</span>
    </Button>
  );
}

/** Shared by the capsule's buttons (see `BarButton`). */
export const BAR_BTN = `inline-flex shrink-0 items-center justify-center
  rounded-full max-md:min-w-10 max-md:px-0 coarse:max-md:min-w-11`;

/** The floating selection bar, shared by the group list and All mails.
 *  >= md a centred capsule (translucent `bar-glass`, `rounded-full` while it fits one row)
 *  inside the page's `max-w-6xl` width: `summary`, Clear, the active
 *  limiter `token`, `actions`, `primary` (the destructive button). Below md
 *  a full-width bar (summary + Clear + token, then actions + primary) above
 *  the safe area. A caller swaps `actions` for a picker/editor with its own
 *  Cancel/Done and says so in `swap` ("move" | "limit"): the bar then moves
 *  focus into it (its `data-bar-field`; on a touch device its
 *  `data-bar-cancel`, since focusing a select opens the picker there) and
 *  back to `data-bar-move` / the More menu when it closes. The "limit"
 *  editor gets a full-width row on phones. Publishes its height as
 *  `--bulkbar-h` (page padding, toasts). Mount it only while something is
 *  selected. */
export function BulkBar({ summary, onClear, token, actions, primary, swap }: {
  summary: ReactNode; onClear: () => void; token?: ReactNode;
  actions: ReactNode; primary: ReactNode; swap?: "move" | "limit" | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBulkBarHeight(ref, true);
  // A stadium (`rounded-full`) only while the capsule is ONE row: wrapped
  // onto two rows it would look like a fat pill, so it keeps card corners.
  const capsule = useRef<HTMLDivElement>(null);
  const [oneRow, setOneRow] = useState(true);
  useEffect(() => {
    const el = capsule.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // 70 px: one row is ~52 px (36 px buttons + padding), two rows ~94 px.
    const sync = () => setOneRow(el.offsetHeight < 70);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const prev = useRef<"move" | "limit" | null>(null);
  useEffect(() => {
    const was = prev.current, now = swap ?? null;
    prev.current = now;
    const bar = ref.current;
    if (!bar || was === now) return;
    const pick = (sel: string) => bar.querySelector<HTMLElement>(sel);
    if (now) {
      const coarse = window.matchMedia?.("(pointer: coarse)").matches;
      pick(coarse ? "[data-bar-cancel]" : "[data-bar-field]")?.focus();
    } else {
      (was === "move" ? pick("[data-bar-move]")
        : pick('[aria-haspopup="menu"]'))?.focus();
    }
  }, [swap]);
  return (
    <div ref={ref} role="region" aria-label={t("bar.label")}
      className="pointer-events-none fixed inset-x-0 bottom-0 lg:left-61
        z-(--z-bulkbar) px-2 md:px-5"
      style={{ paddingBottom:
        "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
      <div ref={capsule} className={`pointer-events-auto mx-auto flex w-fit
        max-w-6xl flex-col gap-1.5 rounded-card border bar-glass px-3 py-2
        shadow-bar max-md:w-full md:flex-row md:flex-wrap md:items-center
        md:justify-center md:gap-x-2 md:px-4 xl:max-w-360
        ${oneRow ? "md:rounded-full" : ""}`}>
        <div className="flex min-w-0 items-center gap-2 md:contents">
          <span className="min-w-0 flex-1 truncate type-meta text-muted
            md:flex-none md:whitespace-nowrap">{summary}</span>
          <BarButton variant="quiet" icon={<X size={16} aria-hidden />}
            onClick={onClear}>{t("bar.clear")}</BarButton>
          {token}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:flex-nowrap
          md:gap-2">
          <div className={`flex min-w-0 flex-1 items-center gap-1.5
            md:flex-none md:gap-2
            ${swap === "limit" ? "max-md:basis-full" : ""}`}>{actions}</div>
          <div className="shrink-0 max-md:ml-auto">{primary}</div>
        </div>
      </div>
    </div>
  );
}

/** Mount once at the app root; `useToast()` anywhere below. Toasts stack
 *  bottom-centre above the bulk bar (`--bulkbar-h`) and the safe area, and
 *  above modals (index.css `.pmc-toasts` for the offsets); they never take focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) =>
    setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((message: ReactNode, opts: ToastOptions = {}) => {
    const id = nextId.current++;
    setItems((xs) => [...xs, { ...opts, id, message }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pmc-toasts pointer-events-none fixed
        inset-x-0 z-(--z-toast) flex flex-col items-center gap-2 px-3">
        {items.map((x) => (
          <ToastView key={x.id} toast={x} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* -------------------------- confirm / prompt dialogs ----------------------- */

export type ConfirmOptions = {
  title: string; body?: ReactNode; bullets?: ReactNode[];
  confirmLabel: string; tone?: "danger" | "primary";
  /** Replaces "Cancel" where declining isn't a cancel (e.g. "Only block"). */
  cancelLabel?: string;
};
/** A confirm with a second, equal-weight way forward (see choiceDialog):
 *  Cancel / Esc still do nothing. */
export type ChoiceOptions = ConfirmOptions & { altLabel: string };
export type PromptOptions = {
  title: string; label: string; initial?: string; confirmLabel?: string;
  /** Return an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
};

/** Confirm/submit is ignored this long after a dialog opens. On a phone the
 *  sheet's confirm button lands under the trigger, so the second tap of a
 *  double-tap would otherwise confirm a destructive action unseen. Keyboard
 *  activations (a click with `detail === 0`: Enter / Space) are exempt -
 *  nobody double-taps with a keyboard, and typing a name then Enter must
 *  not be swallowed. */
export const DIALOG_ARM_MS = 500;
const useArmed = () => {
  const openedAt = useRef(Date.now());
  return (viaKeyboard = false) =>
    viaKeyboard || Date.now() - openedAt.current >= DIALOG_ARM_MS;
};

/** Confirm sheet. Danger dialogs focus Cancel, the safe choice. */
export function ConfirmDialog({ title, body, bullets, confirmLabel,
  cancelLabel, altLabel, tone = "primary", onResult, onAlt }: ConfirmOptions & {
  altLabel?: string;
  onResult: (ok: boolean) => void;
  onAlt?: () => void;
}) {
  const safe = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const armed = useArmed();
  const titleId = useId();
  const bodyId = useId();
  const hasBody = body != null || (bullets?.length ?? 0) > 0;
  // Layout effect: the dialog is focused in the same commit that inserts it,
  // so nothing that reacts to its appearance (a fast Enter, findBy*, a
  // MutationObserver) can see another element focused - for a danger dialog
  // that is the safety property "Cancel has focus".
  useLayoutEffect(() => {
    (tone === "danger" ? safe : ok).current?.focus();
  }, [tone]);
  return (
    <Modal size="sm" labelledBy={titleId}
      describedBy={hasBody ? bodyId : undefined}
      onClose={() => onResult(false)}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div id={titleId} className="type-heading">{title}</div>
        {hasBody && (
          <div id={bodyId} className="space-y-3 type-body text-muted">
            {body != null && <div>{body}</div>}
            {bullets && bullets.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line
        px-4 py-3 sm:px-5">
        <Button ref={safe} variant="secondary"
          onClick={() => onResult(false)}>{cancelLabel ?? t("Cancel")}</Button>
        {altLabel && (
          <Button variant="secondary"
            onClick={(e) => { if (armed(e.detail === 0)) onAlt?.(); }}>
            {altLabel}
          </Button>
        )}
        <Button ref={ok} variant={tone === "danger" ? "danger" : "primary"}
          onClick={(e) => { if (armed(e.detail === 0)) onResult(true); }}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/** Single-field prompt. Submit stays enabled: with an invalid value it shows
 *  the `validate` message instead of closing (also for the initial value,
 *  and when Enter is pressed). */
export function PromptDialog({ title, label, initial = "", confirmLabel,
  validate, onResult }: PromptOptions & {
  onResult: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const armed = useArmed();
  // How the submit was triggered: Enter in the field makes the browser click
  // the submit button with `detail === 0`; a tap/click has `detail >= 1`.
  const viaKeyboard = useRef(true);
  const titleId = useId();
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const error = validate?.(value) ?? null;
  return (
    <Modal size="sm" labelledBy={titleId} onClose={() => onResult(null)}>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => {
        e.preventDefault();
        const kb = viaKeyboard.current;
        viaKeyboard.current = true;
        if (!armed(kb)) return;
        if (error) setTouched(true); else onResult(value);
      }}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          <div id={titleId} className="type-heading">{title}</div>
          <Field label={label}>
            <Input ref={input} value={value} className="w-full"
              aria-invalid={touched && !!error}
              onChange={(e) => { setValue(e.target.value); setTouched(true); }} />
          </Field>
          {touched && error && (
            <div role="alert" className="type-meta text-danger-fg">{error}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3
          sm:px-5">
          <Button type="button" variant="secondary"
            onClick={() => onResult(null)}>{t("Cancel")}</Button>
          <Button type="submit"
            onClick={(e) => { viaKeyboard.current = e.detail === 0; }}>
            {confirmLabel ?? t("OK")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type DialogRequest = { id?: number } & (
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "choice"; opts: ChoiceOptions;
      resolve: (v: "confirm" | "alt" | null) => void }
  | { kind: "prompt"; opts: PromptOptions;
      resolve: (v: string | null) => void });

// The mounted DialogProvider's queue push; the functions below are plain
// module exports so non-component code (mailActions, handlers) can await them.
let pushDialog: ((r: DialogRequest) => void) | null = null;
let nextDialogId = 1;

const needProvider = () =>
  Promise.reject(new Error("confirmDialog/promptDialog need a <DialogProvider>"));

/** Resolves true on confirm; false on Cancel, Esc or backdrop. */
export const confirmDialog = (opts: ConfirmOptions): Promise<boolean> =>
  pushDialog
    ? new Promise((resolve) => pushDialog!({ kind: "confirm", opts, resolve }))
    : needProvider();

/** Like confirmDialog with a second forward button: resolves "confirm" (the
 *  primary one), "alt", or null on Cancel / Esc / backdrop. */
export const choiceDialog = (opts: ChoiceOptions):
  Promise<"confirm" | "alt" | null> =>
  pushDialog
    ? new Promise((resolve) => pushDialog!({ kind: "choice", opts, resolve }))
    : needProvider();

/** Resolves the entered text, or null when cancelled. */
export const promptDialog = (opts: PromptOptions): Promise<string | null> =>
  pushDialog
    ? new Promise((resolve) => pushDialog!({ kind: "prompt", opts, resolve }))
    : needProvider();

const cancelRequest = (r: DialogRequest) =>
  r.kind === "confirm" ? r.resolve(false) : r.resolve(null);   // choice: null

/** Mount once at the app root (main.tsx). Dialogs queue if several are
 *  requested; pending ones settle as cancelled on unmount, and focus goes
 *  back to where it was when a dialog closes. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const live = useRef<DialogRequest[]>([]);
  live.current = queue;
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const push = (r: DialogRequest) => {
      // Remember the opener now, before the dialog's autofocus moves focus.
      if (!live.current.length) {
        opener.current = document.activeElement as HTMLElement | null;
      }
      setQueue((q) => [...q, { ...r, id: nextDialogId++ }]);
    };
    pushDialog = push;
    return () => {
      if (pushDialog === push) pushDialog = null;
      live.current.forEach(cancelRequest);
    };
  }, []);
  const cur = queue[0];
  const hadCur = useRef(false);
  useEffect(() => {
    if (!cur && hadCur.current) {
      refocus(opener.current);
      opener.current = null;
    }
    hadCur.current = !!cur;
  }, [cur]);
  const done = (r: DialogRequest, fn: () => void) => {
    fn();
    setQueue((q) => q.filter((x) => x.id !== r.id));
  };
  return (
    <>
      {children}
      {cur?.kind === "confirm" && (
        <ConfirmDialog key={cur.id} {...cur.opts}
          onResult={(ok) => done(cur, () => cur.resolve(ok))} />
      )}
      {cur?.kind === "choice" && (
        <ConfirmDialog key={cur.id} {...cur.opts}
          onResult={(ok) => done(cur, () => cur.resolve(ok ? "confirm" : null))}
          onAlt={() => done(cur, () => cur.resolve("alt"))} />
      )}
      {cur?.kind === "prompt" && (
        <PromptDialog key={cur.id} {...cur.opts}
          onResult={(v) => done(cur, () => cur.resolve(v))} />
      )}
    </>
  );
}

/** A date in its short locale form (see fmtDate), optionally with the time;
 *  the full ISO string is the `title` and the `<time>` value. Never wraps.
 *  Empty input renders nothing. */
export function ShortDate({ iso, className = "", time = false }: {
  iso: string; className?: string; time?: boolean;
}) {
  if (!iso) return null;
  const short = fmtDate(iso, nowDate(), { lang: getLang(), time });
  const cls = `whitespace-nowrap ${className}`;
  if (short === iso) return <span className={cls}>{iso}</span>;
  return <time dateTime={iso} title={iso} className={cls}>{short}</time>;
}

/* --------------------------------- mail row -------------------------------- */

/** The two-line per-mail row: `[checkbox] [unread dot] subject … trailing`,
 *  then the meta line: `dateIso` as a `<ShortDate>` (full date in the
 *  tooltip; `dateTime` adds the time) followed by `meta` (folder · sender ·
 *  size). Every point of the row is a target: the gutter toggles, the body
 *  opens, `trailing` buttons (pin) fill the full row height. Clicking the text area
 *  calls `onOpen`; the checkbox and `trailing` (pin, badge) are their own
 *  targets, so `meta` must not contain interactive elements. Omit `onToggle`
 *  for rows without selection. */
export function MailRow({ checked = false, onToggle, unread = false, subject,
  meta, dateIso, dateTime = false, trailing, onOpen, selected = false,
  pinned = false, selectLabel, spread = false }: {
  checked?: boolean; onToggle?: () => void; unread?: boolean;
  subject: ReactNode; meta?: ReactNode; dateIso?: string; dateTime?: boolean;
  trailing?: ReactNode;
  onOpen?: () => void; selected?: boolean; pinned?: boolean;
  selectLabel?: string;
  /** Tablet widths (640-1023 px): date and meta at the right edge on the
   *  subject's line instead of a second line under it. */
  spread?: boolean;
}) {
  const text = (
    <span className={spread ? "block sm:max-lg:flex sm:max-lg:items-center sm:max-lg:gap-4" : "contents"}>
      <span className={`flex min-w-0 items-center gap-1.5 ${spread
        ? "sm:max-lg:flex-1" : ""}`}>
        {unread && (
          <>
            <span aria-hidden className="inline-block size-2 shrink-0
              rounded-full bg-accent" />
            <span className="sr-only">{t("unread")}</span>
          </>
        )}
        <span className={`truncate type-body-mobile md:type-body
          group-hover:underline ${unread
          ? "font-semibold md:font-semibold"
          : "font-medium md:font-medium"}`}>{subject}</span>
      </span>
      {(!!dateIso || (meta != null && meta !== "")) && (
        <span className={`mt-0.5 flex min-w-0 items-center gap-1.5 type-meta
          text-muted ${spread ? "sm:max-lg:mt-0 sm:max-lg:shrink-0" : ""}`}>
          {!!dateIso && <ShortDate iso={dateIso} time={dateTime} />}
          {!!dateIso && meta != null && meta !== "" && (
            <span aria-hidden>·</span>
          )}
          {typeof meta === "string"
            ? <span className="min-w-0 truncate">{meta}</span> : meta}
        </span>
      )}
    </span>
  );
  return (
    <div data-pinned={pinned ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      className={`flex items-stretch border-b border-l-2 border-b-line/60
        px-3 py-3 md:px-2 md:py-2.5 ${selected
          ? "border-l-accent bg-panel2"
          : pinned ? "border-l-accent bg-panel" : "border-l-transparent"}`}>
      {/* The negative margins + padding below stretch each target to the
          row's edges, so there are no dead strips between them. */}
      {onToggle && (
        <Checkbox round checked={checked} onChange={onToggle}
          className="-my-3 -ml-3 min-w-14 self-stretch pl-3 md:-my-2.5
            md:-ml-2 md:min-w-13 md:pl-2"
          aria-label={selectLabel ?? t("Select mail")} />
      )}
      {onOpen ? (
        <button type="button" onClick={onOpen}
          className={`group -my-3 min-w-0 flex-1 cursor-pointer self-stretch
            px-1 py-3 text-left md:-my-2.5 md:py-2.5 ${trailing == null
            ? "-mr-3 pr-4 md:-mr-2 md:pr-3" : ""}`}>
          {text}
        </button>
      ) : <div className="min-w-0 flex-1 px-1">{text}</div>}
      {trailing != null && (
        // Taps on a badge (anything but a button) open the mail too, so the
        // badge area isn't a dead zone; the open button stays the one
        // keyboard / screen-reader target.
        <div onClick={onOpen && ((e) => {
          if (!(e.target as Element).closest("button")) onOpen();
        })}
          className="-my-3 -mr-3 flex shrink-0 items-stretch gap-1
          self-stretch md:-my-2.5 md:-mr-2 [&>*:not(button)]:mr-3
          [&>*:not(button)]:self-center md:[&>*:not(button)]:mr-2">
          {trailing}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ swipe actions ----------------------------- */

export type SwipeTone = "danger" | "info" | "new" | "attach" | "neutral";

/** One button behind a swiped row (`SwipeRow`). */
export interface SwipeAction {
  key: string;
  /** The caption under the icon. */
  label: string;
  /** The button's accessible name when it is longer than the caption. */
  ariaLabel?: string;
  icon: ReactNode;
  tone: SwipeTone;
  onAction: () => void;
}

// Solid fills: the semantic foreground with the on-accent text, which flips
// with the theme exactly like it does on the accent (near-black on the light
// dark-theme hues, white on the dark light-theme ones).
const SWIPE_TONE: Record<SwipeTone, string> = {
  danger: "bg-danger text-white",
  info: "bg-info-fg text-on-accent",
  new: "bg-new-fg text-on-accent",
  attach: "bg-attach-fg text-on-accent",
  neutral: "bg-chiph text-chiptext",
};

const SWIPE_ACTION_W = 72;       // px per revealed button (>= 44 touch target)
const SWIPE_SLOP = 10;           // px before the direction is decided
const SWIPE_COMMIT_EXTRA = 56;   // px past the buttons that make a full swipe
const SWIPE_COMMIT_FRACTION = 0.65;   // ... or this share of the row width
const SWIPE_FLICK = 0.5;         // px/ms

// One open row at a time; a touch anywhere else (or a scroll) closes it.
type OpenSwipe = { el: HTMLElement; close: () => void };
let openSwipe: OpenSwipe | null = null;
// The touch that closes an open row is not a tap on what it landed on (iOS
// Mail): the click that follows it, on that same spot, is swallowed before
// React sees it.
let swipeTouched: Node | null = null;
const swipeSwallowClick = (e: Event) => {
  const to = swipeTouched, at = e.target as Node;
  swipeTouched = null;
  if (to && (to.contains(at) || at.contains(to))) {
    e.stopPropagation();
    e.preventDefault();
  }
};
const swipeOutside = (e: Event) => {
  if (!openSwipe || openSwipe.el.contains(e.target as Node)) return;
  openSwipe.close();
  swipeTouched = e.target as Node;
  document.addEventListener("click", swipeSwallowClick,
    { capture: true, once: true });
  // (a touch that never clicks - a scroll - must not arm the next tap). The
  // document is captured: the timer can outlive a test environment's global.
  const doc = document;
  setTimeout(() => {
    doc.removeEventListener("click", swipeSwallowClick, { capture: true });
    swipeTouched = null;
  }, 600);
};
const swipeScroll = () => openSwipe?.close();
function markSwipeOpen(row: OpenSwipe) {
  const prev = openSwipe;
  openSwipe = row;
  if (prev && prev !== row) prev.close();
  else if (!prev) {
    document.addEventListener("pointerdown", swipeOutside, true);
    document.addEventListener("scroll", swipeScroll, true);
  }
}
function markSwipeClosed(row: OpenSwipe) {
  if (openSwipe !== row) return;
  openSwipe = null;
  document.removeEventListener("pointerdown", swipeOutside, true);
  document.removeEventListener("scroll", swipeScroll, true);
}

/** A row that reveals buttons when swiped sideways (touch and pen only, never
 *  a mouse; the rows' own buttons stay the way to do the same on a desktop).
 *  Swipe left shows `trailing`, swipe right `leading`; the FIRST action of a
 *  list sits at the outer edge and is what a full swipe runs. Every
 *  `onAction` must be the handler the row's button already has: a swipe never
 *  skips a confirm, a guard or the undo. Vertical scroll wins unless the move
 *  is clearly horizontal; one row is open at a time; a tap elsewhere or a
 *  scroll closes it; a tap on the open row only closes it. `enabled` off (a
 *  Select mode) switches the gesture off. A drag from the left 20 px is left
 *  to the edge swipe back. Reduced motion: the row does not follow the
 *  finger, the distance alone decides. `className` is the row's background
 *  (it must be opaque: it covers the buttons). */
export function SwipeRow({ leading = [], trailing = [], enabled = true,
  className = "bg-panel", children }: {
  leading?: SwipeAction[]; trailing?: SwipeAction[]; enabled?: boolean;
  className?: string; children: ReactNode;
}) {
  const coarse = useCoarsePointer();
  const live = enabled && coarse && (leading.length > 0 || trailing.length > 0);
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"leading" | "trailing" | null>(null);
  const sideRef = useRef(side);
  sideRef.current = side;
  // x: where the row is now; rest: the side it stays open on
  const pos = useRef({ x: 0, rest: null as "leading" | "trailing" | null,
    swallow: false });
  const ctl = useRef<{ close: () => void } | null>(null);
  const actions = useRef({ leading, trailing });
  actions.current = { leading, trailing };

  useEffect(() => {
    const el = body.current, root = wrap.current;
    if (!live || !el || !root) return;
    type Gesture = { id: number; x: number; y: number; base: number;
      last: number; dragging: boolean; samples: { t: number; x: number }[] };
    let g: Gesture | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const reveal = (s: "leading" | "trailing") =>
      actions.current[s].length * SWIPE_ACTION_W;
    const show = (x: number, ms: number) => {
      pos.current.x = x;
      el.style.transition = ms ? `transform ${ms}ms ease-out` : "none";
      el.style.transform = x ? `translateX(${x}px)` : "";
      if (under.current) {
        under.current.style.transition = ms ? `width ${ms}ms ease-out` : "none";
        under.current.style.width = `${Math.abs(x)}px`;
      }
    };
    const anim = () => (prefersReducedMotion() ? 0 : 200);
    const row: OpenSwipe = { el: root, close: () => close() };
    function close() {
      pos.current.rest = null;
      markSwipeClosed(row);
      show(0, anim());
      clearTimeout(settle);
      // The buttons leave the DOM once the row has covered them again.
      settle = setTimeout(() => { if (!pos.current.rest && !g) setSide(null); },
        anim() ? 220 : 0);
    }
    const open = (s: "leading" | "trailing") => {
      pos.current.rest = s;
      setSide(s);
      show((s === "leading" ? 1 : -1) * reveal(s), anim());
      markSwipeOpen(row);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      g = null;
    };
    const down = (e: PointerEvent) => {
      if (g || e.pointerType === "mouse" || !e.isPrimary) return;
      if (e.clientX <= EDGE_PX) return;   // the edge is swipe back's
      if ((e.target as HTMLElement).closest(
        "input, textarea, select, [data-no-swipe]")) return;
      pos.current.swallow = false;
      clearTimeout(settle);
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, base: pos.current.x,
        last: pos.current.x, dragging: false,
        samples: [{ t: e.timeStamp, x: e.clientX }] };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    };
    function move(e: PointerEvent) {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_SLOP) return;
        // Vertical scroll wins unless the move is clearly horizontal.
        if (Math.abs(dx) < 1.5 * Math.abs(dy)) { stop(); return; }
        g.dragging = true;
      }
      const w = root!.offsetWidth;
      const lo = actions.current.trailing.length ? -w : 0;
      const hi = actions.current.leading.length ? w : 0;
      const x = Math.min(hi, Math.max(lo, g.base + dx));
      g.last = x;
      g.samples.push({ t: e.timeStamp, x: e.clientX });
      if (g.samples.length > 6) g.samples.shift();
      const s = x < 0 ? "trailing" : x > 0 ? "leading" : sideRef.current;
      if (s && s !== sideRef.current) { sideRef.current = s; setSide(s); }
      if (!prefersReducedMotion()) show(x, 0);
    }
    function up(e: PointerEvent) {
      if (!g || e.pointerId !== g.id) return;
      const { dragging, last, samples } = g;
      stop();
      if (!dragging) return;
      pos.current.swallow = true;
      setTimeout(() => { pos.current.swallow = false; }, 350);
      const s = last < 0 ? "trailing" : "leading";
      const r = reveal(s), abs = Math.abs(last);
      if (!last || !r) { close(); return; }
      if (abs >= Math.max(r + SWIPE_COMMIT_EXTRA,
        root!.offsetWidth * SWIPE_COMMIT_FRACTION)) {
        // A full swipe: the first button's action, through its own handler.
        const first = actions.current[s][0];
        close();
        first?.onAction();
        return;
      }
      const from = samples.find((p) => e.timeStamp - p.t <= 100) ?? samples[0];
      const dt = e.timeStamp - from.t;
      const v = dt > 0 ? (e.clientX - from.x) / dt : 0;
      const outward = s === "trailing" ? -v : v;
      if (outward >= SWIPE_FLICK || (abs > r * 0.5 && outward > -SWIPE_FLICK))
        open(s); else close();
    }
    function cancel(e: PointerEvent) {
      if (!g || e.pointerId !== g.id) return;
      const was = g.dragging;
      stop();
      if (!was) return;
      if (pos.current.rest) open(pos.current.rest); else close();
    }
    ctl.current = { close };
    el.addEventListener("pointerdown", down);
    return () => {
      el.removeEventListener("pointerdown", down);
      clearTimeout(settle);
      stop();
      markSwipeClosed(row);
      ctl.current = null;
      // Switched off (Select mode) or gone: back to rest at once.
      pos.current = { x: 0, rest: null, swallow: false };
      el.style.transition = "";
      el.style.transform = "";
      setSide(null);
    };
  }, [live]);

  return (
    <div ref={wrap} data-swipe-row
      className={`relative ${live ? "overflow-x-clip" : ""}`}>
      {live && side && (
        <div ref={under}
          className={`absolute inset-y-0 flex ${side === "trailing"
            ? "right-0 flex-row-reverse" : "left-0"}`}
          style={{ width: Math.abs(pos.current.x) }}>
          {(side === "trailing" ? trailing : leading).map((a, i) => (
            <button key={a.key} type="button" aria-label={a.ariaLabel}
              onClick={() => { ctl.current?.close(); a.onAction(); }}
              className={`flex flex-col items-center justify-center gap-1
                type-caption ${i === 0 ? "min-w-18 flex-1" : "w-18 shrink-0"}
                ${SWIPE_TONE[a.tone]}`}>
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={body} data-swipe-body
        // A tap on an open row only closes it; the click that ends a drag is
        // not a tap on what is under the finger.
        onClickCapture={(e) => {
          if (pos.current.swallow || pos.current.rest) {
            pos.current.swallow = false;
            e.stopPropagation();
            e.preventDefault();
            ctl.current?.close();
          }
        }}
        className={`relative ${className} ${live
          ? "touch-pan-y touch-pinch-zoom" : ""}`}>
        {children}
      </div>
    </div>
  );
}

/** What the user picked: `system` (default, nothing stored) follows
 *  `prefers-color-scheme` live. `pmc_theme` keeps "dark" / "light". */
export type Appearance = "system" | "light" | "dark";

const APPEARANCE_EVENT = "pmc-appearance";
// Page background per effective theme (= `surface` in index.css): the
// browser chrome colour of `meta[name=theme-color]`.
const THEME_COLOR = { dark: "#181716", light: "#faf9f7" };

export const getAppearance = (): Appearance => {
  const v = localStorage.getItem("pmc_theme");
  return v === "dark" || v === "light" ? v : "system";
};

const systemTheme = (): "dark" | "light" =>
  window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light" : "dark";

/** Sets `data-theme` and the browser-chrome metas to the effective theme
 *  (index.html does the same before first paint). */
function paintTheme(): void {
  const a = getAppearance();
  const theme = a === "system" ? systemTheme() : a;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
  // "black"/"default", never "black-translucent": the iOS status bar stays
  // opaque (see index.html).
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute("content", theme === "dark" ? "black" : "default");
}

export const applyTheme = (a: Appearance): void => {
  if (a === "system") localStorage.removeItem("pmc_theme");
  else localStorage.setItem("pmc_theme", a);
  paintTheme();
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
};

/** The theme actually shown (never "system"). */
export const currentTheme = (): "dark" | "light" =>
  (document.documentElement.dataset.theme as "dark" | "light") || "dark";

/** Re-paints when the OS scheme flips while "System" is chosen. Call once at
 *  start-up; returns the unsubscribe. */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  if (!mq) return () => {};
  const on = () => { if (getAppearance() === "system") paintTheme(); };
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}

/** The chosen appearance, kept in sync across every control showing it. */
export function useAppearance(): [Appearance, (a: Appearance) => void] {
  const [a, setA] = useState(getAppearance);
  useEffect(() => {
    const on = () => setA(getAppearance());
    window.addEventListener(APPEARANCE_EVENT, on);
    return () => window.removeEventListener(APPEARANCE_EVENT, on);
  }, []);
  return [a, applyTheme];
}

/** System | Light | Dark as three mini-window thumbnails to tap (Settings >
 *  General): a radio group, arrows move the choice, the picked one has the
 *  accent border. The pictures are fixed (`.appearance-thumb-*` in index.css),
 *  they show the theme, not the one currently applied. */
export function AppearanceControl({ className = "" }: { className?: string }) {
  const [a, set] = useAppearance();
  const values = ["system", "light", "dark"] as const;
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = values[(values.indexOf(a) + d + values.length) % values.length];
    set(next);
    e.currentTarget.querySelector<HTMLElement>(
      `[data-appearance="${next}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={t("Appearance")} onKeyDown={onKey}
      className={`flex gap-2 ${className}`}>
      {values.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={a === v}
          data-appearance={v} tabIndex={a === v ? 0 : -1}
          onClick={() => set(v)}
          className="group flex min-w-0 cursor-pointer flex-col items-center
            gap-1 rounded-card p-1 coarse:min-w-11">
          <span aria-hidden className={`appearance-thumb appearance-thumb-${v}
            h-12 w-18 rounded-control border transition-colors
            ${a === v ? "border-accent ring-2 ring-accent" : "border-line"}`} />
          <span className={`type-meta ${a === v ? "font-semibold text-accent"
            : "text-muted group-hover:text-body"}`}>
            {t(`appearance.${v}`)}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------- settings: grouped rows and controls ------------------ */

/** Lets a control inside a `SettingsRow` take its accessible name and
 *  description from the row's visible label / sub text. */
const RowContext = createContext<{ labelId: string; descId?: string } | null>(
  null);

/** An inset rounded list of settings rows (iOS grouped list) with an optional
 *  caption above and a footnote below. Rows are `SettingsRow`s separated by
 *  hairlines; `padded` is for free-form content (a form, a table) that is not
 *  made of rows. */
export function SettingsGroup({ header, footnote, padded = false,
  radioGroup = false, className = "", children }: {
  header?: ReactNode; footnote?: ReactNode; padded?: boolean;
  /** The rows are `RadioRow`s of one choice: the group is a radio group. */
  radioGroup?: boolean;
  className?: string; children: ReactNode;
}) {
  const id = useId();
  return (
    <div role={radioGroup ? "radiogroup" : "group"}
      aria-labelledby={header ? `${id}-h` : undefined}
      className={`mb-6 ${className}`}>
      {header && (
        <h3 id={`${id}-h`} className="mb-1.5 px-3 type-meta font-medium
          text-muted">{header}</h3>
      )}
      <div className={`rounded-card border border-line bg-panel
        ${padded ? "p-4" : "divide-y divide-line overflow-hidden"}`}>
        {children}
      </div>
      {footnote && (
        <p className="mt-1.5 px-3 type-meta text-muted">{footnote}</p>
      )}
    </div>
  );
}

/** Colour tile behind a row icon (the root list of Settings). */
export function IconTile({ tone = "neutral", children }: {
  tone?: TagTone; children: ReactNode;
}) {
  return (
    <span aria-hidden className={`flex size-7 shrink-0 items-center
      justify-center rounded-control ${TAG_TONE[tone]}`}>
      {children}
    </span>
  );
}

/** One row of a `SettingsGroup`: label (+ muted sub text) on the left, the
 *  control or value on the right. With `onClick` the whole row is a button
 *  with a trailing chevron (drill-down; `value` shows before it; a plain row
 *  shows `value` as muted text before its control). `stack`
 *  puts the children under the label at full width (an input, a text area).
 *  `danger` makes it a destructive text row. Switch / Stepper inside take
 *  their name from the label. */
export function SettingsRow({ label, sub, icon, value, onClick, danger = false,
  stack = false, disabled, current, expanded, children }: {
  label: ReactNode; sub?: ReactNode; icon?: ReactNode; value?: ReactNode;
  onClick?: () => void; danger?: boolean; stack?: boolean;
  disabled?: boolean;
  /** The row of the page that is open (`aria-current`). */
  current?: boolean;
  /** A disclosure row: reports `aria-expanded` and turns its chevron down. */
  expanded?: boolean; children?: ReactNode;
}) {
  const id = useId();
  const ctx = { labelId: `${id}-l`, descId: sub ? `${id}-d` : undefined };
  const hasValue = value != null && value !== "";
  // The icon is decoration: an avatar's letter must not lead the row's name.
  const iconEl = icon && <span aria-hidden className="contents">{icon}</span>;
  const text = (
    <span className="min-w-0 flex-1">
      <span id={ctx.labelId} className={`block type-body
        ${danger ? "text-danger-fg" : ""}`}>{label}</span>
      {sub && (
        <span id={ctx.descId} className="block type-meta text-muted">
          {sub}
        </span>
      )}
    </span>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled}
        aria-current={current ? "page" : undefined}
        aria-expanded={expanded}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5
          text-left transition-colors enabled:hover:bg-panel2
          disabled:cursor-not-allowed disabled:text-faint">
        {iconEl}
        {text}
        {value != null && value !== "" && (
          <span className="min-w-0 max-w-1/2 truncate type-body
            text-muted">{value}</span>
        )}
        {children}
        <ChevronRight size={16} aria-hidden className={`shrink-0 text-faint
          ${expanded ? "rotate-90" : ""}`} />
      </button>
    );
  }
  return (
    <RowContext.Provider value={ctx}>
      <div role={hasValue ? "group" : undefined}
        aria-labelledby={hasValue ? ctx.labelId : undefined}
        aria-describedby={hasValue ? `${id}-v` : undefined}
        className={`flex gap-3 px-4 py-2.5 ${stack ? "flex-col"
        : "min-h-12 items-center"}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {iconEl}
          {text}
        </div>
        {hasValue && (
          <span id={`${id}-v`} className="min-w-0 max-w-1/2 truncate
            type-body text-muted">{value}</span>
        )}
        {children != null && (
          <div className={stack ? "min-w-0" : "min-w-0 shrink-0"}>
            {children}
          </div>
        )}
      </div>
    </RowContext.Provider>
  );
}

/** On / off switch (`role="switch"`). The visible track is 28 px high, the
 *  button around it 44 px. Named by `label`, else by the `SettingsRow` it
 *  sits in. `onChange` gets the new state. */
export function Switch({ checked, onChange, label, disabled = false,
  className = "", ...rest }: {
  checked: boolean; onChange: (on: boolean) => void; label?: string;
  disabled?: boolean; className?: string;
} & Omit<ComponentProps<"button">, "onChange" | "role" | "type"
  | "aria-checked">) {
  const row = useContext(RowContext);
  return (
    <button type="button" role="switch" aria-checked={checked}
      aria-label={label} disabled={disabled}
      aria-labelledby={label ? undefined : row?.labelId}
      aria-describedby={row?.descId}
      onClick={() => onChange(!checked)} {...rest}
      className={`group inline-flex min-h-11 min-w-11 cursor-pointer
        items-center justify-center disabled:cursor-not-allowed ${className}`}>
      <span aria-hidden className={`relative block h-7 w-12 rounded-full
        transition-colors motion-reduce:transition-none
        ${disabled ? "bg-chip" : checked ? "bg-safe-fg" : "bg-chiph"}`}>
        <span className={`absolute left-0.5 top-0.5 size-6 rounded-full
          shadow-segment transition-transform motion-reduce:transition-none
          ${disabled ? "bg-faint" : "bg-knob"}
          ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

/** Number stepper: [−] value unit [+]. The value is a spin button (Up / Down /
 *  Right / Left step, PageUp / PageDown step by 10, Home / End jump to min /
 *  max); the buttons are for pointers and stay out of the tab order. `format`
 *  turns the value into its (translated, pluralised) text, e.g. "7 days".
 *  Named by `label`,
 *  else by the `SettingsRow` it sits in. */
export function Stepper({ value, onChange, min, max, step = 1, format, label,
  disabled = false }: {
  value: number; onChange: (v: number) => void; min: number; max: number;
  step?: number; format?: (v: number) => string; label?: string;
  disabled?: boolean;
}) {
  const row = useContext(RowContext);
  const to = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const text = format ? format(value) : String(value);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = e.key === "ArrowUp" || e.key === "ArrowRight" ? value + step
      : e.key === "ArrowDown" || e.key === "ArrowLeft" ? value - step
      : e.key === "PageUp" ? value + 10 * step
      : e.key === "PageDown" ? value - 10 * step
      : e.key === "Home" ? min : e.key === "End" ? max : null;
    if (next === null) return;
    e.preventDefault();
    to(next);
  };
  const btn = `inline-flex min-h-9 min-w-9 items-center justify-center
    rounded-control text-muted transition-colors coarse:min-h-11
    coarse:min-w-11 enabled:hover:bg-chiph enabled:hover:text-body
    disabled:cursor-not-allowed disabled:text-faint`;
  return (
    <div className="inline-flex items-center rounded-control bg-chip">
      <button type="button" tabIndex={-1} className={btn}
        aria-label={t("stepper.decrease")} disabled={disabled || value <= min}
        onClick={() => to(value - step)}>
        <Minus size={16} aria-hidden />
      </button>
      <div role="spinbutton" tabIndex={disabled ? -1 : 0} aria-label={label}
        aria-labelledby={label ? undefined : row?.labelId}
        aria-describedby={row?.descId} aria-valuenow={value}
        aria-valuemin={min} aria-valuemax={max} aria-valuetext={text}
        aria-disabled={disabled || undefined} onKeyDown={onKey}
        className="min-w-16 select-none rounded-control px-2 text-center
          type-body tabular-nums">
        {text}
      </div>
      <button type="button" tabIndex={-1} className={btn}
        aria-label={t("stepper.increase")} disabled={disabled || value >= max}
        onClick={() => to(value + step)}>
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
}

/** One choice of a list of exclusive options, as a `SettingsGroup` row: the
 *  whole row is a `role="radio"` button with a check on the chosen one.
 *  Rows of one group form a radio group (the group's header names it): one
 *  tab stop (the chosen row), Up / Down / Left / Right move to and choose
 *  the neighbouring enabled row. */
export function RadioRow({ label, sub, checked, onSelect, disabled = false }: {
  label: ReactNode; sub?: ReactNode; checked: boolean;
  onSelect: () => void; disabled?: boolean;
}) {
  const id = useId();
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    const rows = [...(e.currentTarget.closest("[role=radiogroup],[role=group]")
      ?.querySelectorAll<HTMLButtonElement>("[role=radio]:not(:disabled)")
      ?? [])];
    const next = rows[rows.indexOf(e.currentTarget) + dir];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.click();
  };
  return (
    <button type="button" role="radio" aria-checked={checked}
      aria-labelledby={`${id}-l`} aria-describedby={sub ? `${id}-d` : undefined}
      tabIndex={checked ? 0 : -1} disabled={disabled} onClick={onSelect}
      onKeyDown={onKey}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5
        text-left transition-colors enabled:hover:bg-panel2
        disabled:cursor-not-allowed disabled:text-faint">
      <span className="min-w-0 flex-1">
        <span id={`${id}-l`} className="block type-body">{label}</span>
        {sub && (
          <span id={`${id}-d`} className="block type-meta text-muted">
            {sub}
          </span>
        )}
      </span>
      {checked && <Check size={18} aria-hidden className="shrink-0
        text-accent" />}
    </button>
  );
}
