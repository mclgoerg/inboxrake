import { type ReactNode, type RefObject, useEffect, useMemo, useState }
  from "react";
import { BellOff, BookmarkPlus, Check, ChevronDown, ChevronRight,
  ListFilter, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, SlidersHorizontal,
  Sparkles, TriangleAlert, UserPlus, X, type LucideIcon } from "lucide-react";
import { t } from "../i18n";
import type { FilterPreset } from "../types";
import { Button, Input, Menu, MenuDivider, MenuGroup, MenuItem, Modal, SectionLabel,
  useMediaQuery } from "./ui";

/** Quick filters of the Filter menu (keys go through App's selectPreset).
 *  `New` / `Still mailing` (keys "still" / "new") follow when they have
 *  senders. */
export const QUICK_FILTERS: { key: string; label: string }[] = [
  { key: "aisafe", label: "AI-safe groups" },
  { key: "unsub_pending", label: "sel.unsub_pending" },
];
/** The three "Inactive for" rows. */
export const INACTIVE_FILTERS: { key: string; label: string }[] = [
  { key: "older6", label: "filter.inactive_6m" },
  { key: "older12", label: "filter.inactive_1y" },
  { key: "older24", label: "filter.inactive_2y" },
];

const QUICK_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  aisafe: { icon: ShieldCheck, tone: "safe" },
  unsub_pending: { icon: BellOff, tone: "info" },
  still: { icon: TriangleAlert, tone: "review" },
  new: { icon: UserPlus, tone: "new" },
};

type Tone = "safe" | "info" | "review" | "new" | "accent" | "muted" | "attach";
/** Icon tile of a row (sheet) and the bare icon colour (menu). */
const TILE: Record<Tone, string> = {
  safe: "bg-safe-bg text-safe-fg", info: "bg-info-bg text-info-fg",
  review: "bg-review-bg text-review-fg", new: "bg-new-bg text-new-fg",
  accent: "bg-accent-tint text-accent", muted: "bg-chip text-muted",
  attach: "bg-attach-bg text-attach-fg",
};
const GLYPH: Record<Tone, string> = {
  safe: "text-safe-fg", info: "text-info-fg", review: "text-review-fg",
  new: "text-new-fg", accent: "text-accent", muted: "text-muted",
  attach: "text-attach-fg",
};

/** The row the filter box currently equals (at most one: the first in menu
 *  order) - a quick / inactive / saved filter; null for a typed filter.
 *  `quick` maps a preset key to its query; `counts` are the New / Still
 *  mailing sender counts (those rows only exist with senders). */
export function activeFilter(filter: string, presets: FilterPreset[],
  quick: (key: string) => string,
  counts: { new: number; still: number }):
  { key: string; label: string } | null {
  if (!filter.trim()) return null;
  const keys = [...QUICK_FILTERS.map((p) => p.key),
    ...(counts.still ? ["still"] : []), ...(counts.new ? ["new"] : []),
    ...INACTIVE_FILTERS.map((p) => p.key)];
  const key = keys.find((k) => quick(k) === filter);
  if (key) return { key, label: rowLabel(key) };
  const p = presets.find((x) => x.query === filter);
  return p ? { key: `saved:${p.id}`, label: p.name } : null;
}

/** Label of a built-in row; the token shows "Inactive 6+ months". */
function rowLabel(key: string): string {
  const inactive = INACTIVE_FILTERS.find((p) => p.key === key);
  if (inactive) {
    return t("filter.inactive_token", { label: t(inactive.label) });
  }
  if (key === "new") return t("filter.new");
  if (key === "still") return t("filter.still");
  return t(QUICK_FILTERS.find((p) => p.key === key)?.label ?? key);
}

/** What the filter box currently equals: a quick filter or a saved filter
 *  (null for anything typed by hand). */
export function activeFilterLabel(filter: string, presets: FilterPreset[],
  quick: (key: string) => string,
  counts: { new: number; still: number }): string | null {
  return activeFilter(filter, presets, quick, counts)?.label ?? null;
}

interface RowsProps {
  filter: string;
  /** Preset key -> filter query (App's presetFilterQuery). */
  quick: (key: string) => string;
  newCount: number;
  stillCount: number;
  presets: FilterPreset[];
  /** Groups of the current grouping a query matches (the row counts). */
  matchCount: (query: string) => number;
  /** Tap = apply, tap the checked row again = clear (App decides). */
  onQuick: (key: string) => void;
  onApply: (p: FilterPreset) => void;
  onEdit: (p: FilterPreset) => void;
  onDelete: (p: FilterPreset) => void;
  onSave: () => void;
  /** Opens the QueryBuilder. */
  onBuild: () => void;
  /** Absent = no AI filter entry; `disabled` = shown but off (demo). */
  onAi?: { disabled?: boolean; hint?: string; run: () => void };
}

/** One list row: icon tile (sheet) / bare icon (menu), name, count, check.
 *  `trailing` sits after the check (a saved filter's edit / delete). */
function Row({ sheet, label, count, on, icon: Icon, tone = "muted", sub,
  accent, chevron, disabled, onClick, trailing, title }: {
  sheet: boolean; label: string; count?: number; on?: boolean;
  icon?: LucideIcon; tone?: Tone; sub?: string; accent?: boolean;
  chevron?: boolean; disabled?: boolean; onClick: () => void;
  trailing?: ReactNode; title?: string;
}) {
  const toggles = on !== undefined;
  return (
    <div className="group/frow flex items-center">
      <button type="button" title={title} disabled={disabled}
        // The sheet is a plain dialog (pressed buttons); the menu's items
        // take part in its arrow-key navigation.
        role={sheet ? undefined : toggles ? "menuitemradio" : "menuitem"}
        aria-checked={!sheet && toggles ? on : undefined}
        aria-pressed={sheet && toggles ? on : undefined}
        className={`flex min-w-0 flex-1 items-center gap-3 px-3 text-left
          type-body disabled:cursor-not-allowed disabled:text-faint
          ${sheet ? "min-h-11 py-2" : "rounded-control py-2 enabled:hover:bg-chip"}
          ${accent ? "enabled:text-accent" : ""}`}
        onClick={onClick}>
        {Icon && (sheet ? (
          <span aria-hidden className={`flex size-8 shrink-0 items-center
            justify-center rounded-control ${disabled ? "bg-chip text-faint"
              : TILE[tone]}`}>
            <Icon size={16} />
          </span>
        ) : (
          <Icon size={16} aria-hidden
            className={`shrink-0 ${disabled ? "text-faint" : GLYPH[tone]}`} />
        ))}
        {!Icon && !sheet && <span aria-hidden className="w-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {sub && <span className="block truncate type-meta text-muted">
            {sub}</span>}
        </span>
        {count !== undefined && (
          <span className="shrink-0 tabular-nums type-meta text-muted">
            {count}</span>
        )}
        {toggles && (
          <span aria-hidden className="flex size-4 shrink-0">
            {on && <Check size={16} className="text-accent" />}
          </span>
        )}
        {chevron && sheet && (
          <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
        )}
      </button>
      {trailing}
    </div>
  );
}

// Edit / delete next to a saved filter: 32 px visual, hit area to 44 on touch.
const ROW_ICON = `relative flex size-8 shrink-0 items-center justify-center
  rounded-control text-muted hover:bg-chip hover:text-body
  after:absolute after:-inset-1 after:content-[''] coarse:size-10`;

/** The rows of the Filter menu (desktop) and of the Filter sheet (phone):
 *  Quick filters, Inactive for, Saved filters, then Build / Describe. Each
 *  filter row carries its match count; the checked row is the one the filter
 *  box equals. */
function FilterRows({ sheet, filter, quick, newCount, stillCount, presets,
  matchCount, onQuick, onApply, onEdit, onDelete, onSave, onBuild, onAi }:
  RowsProps & { sheet: boolean }) {
  const active = !!filter.trim();
  const checked = activeFilter(filter, presets, quick,
    { new: newCount, still: stillCount })?.key;
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of [...QUICK_FILTERS, ...INACTIVE_FILTERS].map((p) => p.key)
      .concat(["new", "still"])) out[k] = matchCount(quick(k));
    for (const p of presets) out[`saved:${p.id}`] = matchCount(p.query);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchCount, presets]);
  const quickRow = (key: string, label: string) => (
    <Row key={key} sheet={sheet} label={label} count={counts[key]}
      on={checked === key} icon={QUICK_ICON[key].icon}
      tone={QUICK_ICON[key].tone} onClick={() => onQuick(key)} />
  );
  const group = (label: string, children: ReactNode, note?: string) => sheet ? (
    <div key={label} role="group" aria-label={label}
      className="mt-4 first:mt-0">
      <SectionLabel className="px-3 pb-1.5">{label}</SectionLabel>
      {/* No overflow clipping: a row's "..." menu must be able to extend
          past the card. */}
      <div className="divide-y divide-line rounded-card bg-panel2">
        {children}</div>
      {note && <p className="px-3 pt-1.5 type-meta text-muted">{note}</p>}
    </div>
  ) : (
    <MenuGroup key={label} label={label}>{children}</MenuGroup>
  );
  return (
    <div className={sheet ? "" : "min-w-64"}>
      {group(t("filter.quick"), <>
        {quickRow("aisafe", t("AI-safe groups"))}
        {quickRow("unsub_pending", t("sel.unsub_pending"))}
        {stillCount > 0 && quickRow("still", t("filter.still"))}
        {newCount > 0 && quickRow("new", t("filter.new"))}
      </>)}
      {group(t("filter.inactive"), <>
        {INACTIVE_FILTERS.map((p) => (
          <Row key={p.key} sheet={sheet} label={t(p.label)}
            count={counts[p.key]} on={checked === p.key}
            onClick={() => onQuick(p.key)} />
        ))}
      </>, sheet ? t("filter.inactive_note") : undefined)}
      {group(t("filter.saved"), <>
        {presets.map((p) => (
          <Row key={p.id} sheet={sheet} label={p.name}
            title={`${p.name}: ${p.query}`}
            count={counts[`saved:${p.id}`]} on={checked === `saved:${p.id}`}
            icon={BookmarkPlus} tone="accent" onClick={() => onApply(p)}
            trailing={sheet ? (
              <Menu variant="quiet" icon up label={t("filter.row_menu",
                { name: p.name })} triggerClass="coarse:size-11"
                trigger={<MoreHorizontal size={16} aria-hidden />}>
                <MenuItem onClick={() => onEdit(p)}>{t("Edit")}</MenuItem>
                <MenuItem danger onClick={() => onDelete(p)}>
                  {t("Delete")}</MenuItem>
              </Menu>
            ) : (
              <span className="flex shrink-0 items-center gap-0.5
                pr-1 opacity-0 group-focus-within/frow:opacity-100
                group-hover/frow:opacity-100 coarse:opacity-100">
                <button role="menuitem" type="button"
                  title={t("saved_filter.edit_tip")}
                  aria-label={`${t("Edit")}: ${p.name}`}
                  className={ROW_ICON} onClick={() => onEdit(p)}>
                  <Pencil size={14} aria-hidden />
                </button>
                <button role="menuitem" type="button" title={t("Delete")}
                  aria-label={`${t("Delete")}: ${p.name}`}
                  className={ROW_ICON} onClick={() => onDelete(p)}>
                  <X size={14} aria-hidden />
                </button>
              </span>
            )} />
        ))}
        <Row sheet={sheet} label={t("filter.save_current")} icon={Plus}
          tone="accent" accent disabled={!active} onClick={onSave} />
      </>)}
      {sheet ? group(t("filter.own"), <>
        <Row sheet label={t("filter.build")} icon={SlidersHorizontal}
          chevron onClick={onBuild} />
        {onAi && (
          <Row sheet label={t("filter.describe")} icon={Sparkles}
            tone="attach" chevron disabled={onAi.disabled} sub={onAi.hint}
            onClick={onAi.run} />
        )}
      </>) : (<>
        <MenuDivider />
        <Row sheet={false} label={t("filter.build")} icon={SlidersHorizontal}
          onClick={onBuild} />
        {onAi && (
          <Row sheet={false} label={t("filter.describe")} icon={Sparkles}
            tone="attach" disabled={onAi.disabled} sub={onAi.hint}
            onClick={onAi.run} />
        )}
      </>)}
    </div>
  );
}

/** The Filter control of the Senders toolbar. From 768 px a Menu, below it a
 *  bottom sheet ("Reset" - "Filter" - "Done") that applies live and stays
 *  open. Same rows in both: tap = apply, tap the checked one again = clear.
 *  The trigger turns `tinted` with a dot while a filter is applied. */
export function FilterMenu(props: RowsProps & { onClear: () => void }) {
  const { filter, onClear, onEdit, onBuild, onAi } = props;
  const phone = useMediaQuery("(width < 48rem)");
  const [open, setOpen] = useState(false);
  const active = !!filter.trim();
  const label = t("filter.menu");
  const variant = active ? "tinted" : "secondary";
  if (phone) {
    // The sheet closes before anything that opens over / behind it.
    const leave = <A extends unknown[]>(f: (...a: A) => void) =>
      (...a: A) => { setOpen(false); f(...a); };
    return (<>
      <Button variant="plain" size="icon"
        label={label} aria-haspopup="dialog" aria-expanded={open}
        className="coarse:size-11" onClick={() => setOpen(true)}>
        {/* The tint circle is smaller than the 44 px hit area (board 10). */}
        <span data-testid="filter-circle" className={`relative flex size-9
          items-center justify-center rounded-full
          ${active ? "bg-accent-tint" : ""}`}>
          <ListFilter size={18} aria-hidden />
          {active && <span aria-hidden data-testid="filter-dot"
            className="absolute right-1 top-1 size-2 rounded-full
              bg-accent" />}
        </span>
      </Button>
      {open && (
        <Modal size="sm" label={label} onClose={() => setOpen(false)}>
          <div className="flex shrink-0 items-center justify-between px-4
            py-2">
            <Button variant="plain" disabled={!active} onClick={onClear}>
              {t("filter.reset")}
            </Button>
            <span className="type-heading">{label}</span>
            <Button variant="plain" className="font-semibold"
              onClick={() => setOpen(false)}>
              {t("filter.done")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <FilterRows sheet {...props} onEdit={leave(onEdit)}
              onBuild={leave(onBuild)}
              onAi={onAi && { ...onAi, run: leave(onAi.run) }} />
          </div>
        </Modal>
      )}
    </>);
  }
  return (
    <Menu variant={variant} label={label}
      trigger={<>
        <ListFilter size={16} aria-hidden />
        {label}
        {active && <span aria-hidden data-testid="filter-dot"
          className="size-1.5 rounded-full bg-accent" />}
        <ChevronDown size={16} aria-hidden className="text-muted" />
      </>}>
      <FilterRows sheet={false} {...props} />
    </Menu>
  );
}

/** The removable token inside the filter field: names the quick / inactive /
 *  saved filter the box equals. Tapping the name turns it back into the
 *  editable text (`onEdit`); the x clears the filter. */
export function FilterToken({ label, onRemove, onEdit }: {
  label: string; onRemove: () => void; onEdit?: () => void;
}) {
  return (
    <span data-testid="filter-token" className="inline-flex min-h-7
      min-w-0 max-w-full items-center rounded-full bg-accent-tint pl-1
      type-meta font-medium text-accent">
      <button type="button" aria-label={t("filter.edit_token", { name: label })}
        className="min-w-0 truncate rounded-full px-2 py-1 coarse:py-1.5"
        onClick={onEdit}>
        {label}
      </button>
      <button type="button" aria-label={t("filter.remove", { name: label })}
        className="relative flex size-7 shrink-0 items-center justify-center
          rounded-full hover:bg-accent-tint after:absolute after:-inset-2
          after:content-['']"
        onClick={onRemove}>
        <X size={14} aria-hidden />
      </button>
    </span>
  );
}

/** The search field of the Senders toolbar: a borderless fill with a leading
 *  magnifier, the filter text (or, while the box equals a quick / inactive /
 *  saved filter, its token) and `builder` (the QueryBuilder's trigger) as the
 *  trailing control. */
export function FilterField({ value, onChange, token, inputRef, builder }: {
  value: string;
  onChange: (v: string) => void;
  /** Label of the quick / saved filter the value equals. */
  token: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  builder: ReactNode;
}) {
  // The token stands in for the raw text until it is tapped (or the field is
  // focused any other way, e.g. the "/" shortcut); leaving the field puts it
  // back.
  const [editing, setEditing] = useState(false);
  const tokenShown = !!token && !editing;
  const edit = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  // A cleared / replaced filter ends the edit state with it.
  useEffect(() => { if (!token) setEditing(false); }, [token]);
  return (
    // has-[...]: the ring belongs to the whole field, not to the bare input.
    <div className="flex min-h-9 min-w-0 items-center gap-1 rounded-control
      bg-panel2 pl-3 pr-1 coarse:min-h-10
      has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline
      has-[input:focus-visible]:outline-accent">
      <Search size={16} aria-hidden className="shrink-0 text-muted" />
      {tokenShown && (
        <FilterToken label={token!} onEdit={edit}
          onRemove={() => onChange("")} />
      )}
      {/* Behind the token the input stays in the DOM (sr-only), so focusing
          it from anywhere still works and brings the text back. */}
      <Input ref={inputRef} tabIndex={tokenShown ? -1 : undefined}
        className={`min-w-0 flex-1 !border-0 pl-1 pr-1
          focus-visible:outline-0 ${tokenShown ? "sr-only" : ""}`}
        placeholder={t("filter.placeholder")}
        title={t("filter.syntax_hint")}
        value={value}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e) => onChange(e.target.value)} />
      {!!value && !tokenShown && (
        <Button variant="quiet" size="icon" label={t("Clear filter")}
          className="text-muted hover:text-body"
          onClick={() => { onChange(""); inputRef.current?.focus(); }}>
          <X size={16} />
        </Button>
      )}
      <span className="ml-auto flex shrink-0">{builder}</span>
    </div>
  );
}
