import { Archive, ArrowDown, Ban, Briefcase, Building2, CalendarCheck,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, KeyRound, LifeBuoy,
  ListChecks, MailOpen, MessagesSquare, MoreHorizontal, Newspaper, Package,
  PanelRight, Reply, Shapes, Shield, ShieldOff, Tag as TagIcon, Trash2, Users,
  type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { fmtSize } from "../api";
import type { Group, Grouping, SmartKind } from "../types";
import { t } from "../i18n";
import { fmtNum, fmtPct } from "../numfmt";
import { Avatar, Button, cap, Checkbox, IconTile, Modal, ShortDate,
  SettingsGroup, SettingsRow, StillMailingBadge, SwipeRow, Tag, PopupSelect,
  isModalOpen, type SwipeAction, type TagTone } from "./ui";

export type SortKey = "count" | "size" | "label" | "last" | "unreadPct"
  | "engagement";

const PAGE_SIZES = [25, 50, 100, 200];
const ALL = 1_000_000;

/** What swiping a phone row does. Every entry is the handler of the button
 *  the same action has elsewhere (the detail's action row, the selection
 *  bar), so a swipe takes the same confirms, protected / pinned guards and
 *  undo. */
export interface GroupSwipe {
  trash: (g: Group) => void;
  read: (g: Group) => void;
  archive: (g: Group) => void;
  /** Starts Select mode with this row ticked. */
  select: (g: Group) => void;
  /** Protect / block act on what the row stands for (an address or a
   *  domain): subject, thread and Smart bucket rows have no such target. */
  canTarget: (g: Group) => boolean;
  protect: (g: Group) => void;
  block: (g: Group) => void;
  unblock: (g: Group) => void;
}

interface Props {
  groups: Group[];
  selected: Set<string>;
  focusedKey: string | null;
  // Group shown in the split pane (selected-row style), and whether the
  // table is squeezed into the list column beside it (drops Type / Last).
  openKey?: string | null;
  compact?: boolean;
  onToggle: (key: string) => void;
  onToggleAll: (checked: boolean, keys: string[]) => void;
  // Select mode (App's "Select" button): checkboxes are shown on every row.
  // Without it they show on row hover / focus and once something is
  // selected (mouse), and only once something is selected on touch.
  selectMode?: boolean;
  // Opens DetailPanel, which is where single-group actions (Trash/Block/
  // Protect) now live - rows themselves are selection + navigation only.
  onOpen: (g: Group) => void;
  blockedKeys?: Map<string, string>;   // group key -> blocking rule id
  sortK: SortKey;
  sortDir: number;
  onSort: (k: SortKey) => void;
  groupLabel: string;
  grouping?: Grouping;   // "thread" rows show a sender / neutral avatar
  resetSignal: string;   // page resets to 1 when this changes (mode/filter)
  // One extra line under a row's own lines (the Smart sender list says why a
  // sender sits in its row). Empty / absent = no line.
  rowNote?: (g: Group) => string;
  // Always the card layout (a list inside the detail panel, which is narrow
  // beside the list at any viewport width); its checkboxes are always shown.
  cards?: boolean;
  // First row of the list (the filter's "Select all N matches" banner): in
  // the table card / the phone card, above the rows. Not a row for j/k.
  banner?: ReactNode;
  // Row swipe on touch screens (card layout only); absent = no swipe.
  swipe?: GroupSwipe;
}

/** Thread / subject groups carry an English summary from the backend
 *  ("2 mails, 1 sender" / "3 senders"); show it in the UI language. Sender
 *  and domain groups carry an address, which passes through untouched. */
const SUB_COUNTS = /^(?:(\d+) mails?, )?(\d+) senders?$/;
export function localizedSub(sub: string): string {
  const m = SUB_COUNTS.exec(sub);
  if (!m) return sub;
  const senders = t("n.senders", { n: Number(m[2]) });
  return m[1] ? `${t("n.mails", { n: Number(m[1]) })}, ${senders}` : senders;
}

// Smart pools have no single sender to take a letter from: each kind gets
// an icon (DESIGN.md Icons) on the same neutral avatar disc as thread rows.
const KIND_ICON: Record<Exclude<SmartKind, "sender">, LucideIcon> = {
  company: Building2, protected: Shield, replied: Reply, orders: Package,
  appointments: CalendarCheck, jobs: Briefcase, support: LifeBuoy,
  accounts: KeyRound, category: TagIcon, newsletter: Newspaper,
  individuals: Users, other: Shapes,
};

/** The row's avatar. A thread's label is its subject, and a subject's
 *  first letter says nothing - so thread rows show their first sender, or a
 *  neutral icon avatar when there is none. A Smart company / bucket row
 *  shows its kind's icon. */
export function RowAvatar({ g, grouping, size = "md" }: {
  g: Group; grouping?: Grouping; size?: "md" | "lg";
}) {
  const disc = size === "lg" ? "size-16" : "size-8";
  const glyph = (I: LucideIcon) =>
    size === "lg" ? <I size={18} /> : <I size={16} />;
  if (grouping === "smart" && g.kind && g.kind !== "sender") {
    return (
      <span aria-hidden className={`inline-flex ${disc} shrink-0 items-center
        justify-center rounded-full bg-chip text-muted`}>
        {glyph(KIND_ICON[g.kind])}
      </span>
    );
  }
  if (grouping !== "thread") {
    return <Avatar name={g.label || g.key} size={size} />;
  }
  const first = g.samples[0];
  return first ? <Avatar name={first} size={size} /> : (
    <span aria-hidden className={`inline-flex ${disc} shrink-0 items-center
      justify-center rounded-full bg-chip text-faint`}>
      {glyph(MessagesSquare)}
    </span>
  );
}

interface PageProps extends Props {
  slice: Group[];
  baseIdx: number;
}

const unreadPct = (g: Group) =>
  g.count ? Math.round((100 * g.unread) / g.count) : 0;

/* One status pill per row: the first thing that applies, in this priority
   (the detail header shows all the rest). The unsubscribe page to confirm is
   only a hint here - the link and "Mark as done" live in the detail. */
function rowPill(g: Group, blocked: boolean): ReactNode {
  const u = g.unsubscribed;
  if (g.still_mailing) return <StillMailingBadge sm={g.still_mailing} />;
  const pill = (tone: TagTone, label: string, title?: string) => (
    <Tag tone={tone} dot className="whitespace-nowrap">
      <span title={title}>{label}</span>
    </Tag>
  );
  if (u?.status === "link") return pill("review", t("unsub.pill_link"));
  if (blocked) return pill("keep", t("Blocked"));
  if (g.new) return pill("new", t("New"), t("new_sender.tip"));
  if (g.ai?.src === "user") {
    return pill("info", t("v.set_by_you", { verdict: cap(t(`v.${g.ai.verdict}`)) }));
  }
  if (g.ai) {
    return pill(VERDICT_PILL[g.ai.verdict] ?? "neutral",
      cap(t(`v.${g.ai.verdict}`)), g.ai.reason);
  }
  if (u?.status === "done") return pill("info", t("Unsubscribed"));
  if (u?.status === "failed") return pill("keep", cap(t("unsub.badge_failed")));
  if (u?.status === "pending") {
    return pill("review", t("unsub.badge_pending", { n: u.n, of: u.of }));
  }
  if (g.replied) return pill("info", cap(t("replied")), t("replied.tip"));
  return null;
}

const VERDICT_PILL: Record<string, TagTone> = {
  delete_safe: "safe", review: "review", keep: "keep",
};

/** Two unbreakable halves: on a narrow row the line breaks after the dot,
 *  never inside "zuletzt 25. Nov. 2025" (which ran into the count column). */
const Stats = ({ g }: { g: Group }) => (
  <>
    <span className="whitespace-nowrap">{fmtPct(unreadPct(g))} {t("unread")} ·</span>
    {" "}
    <span className="whitespace-nowrap">
      {t("row.last")} <ShortDate iso={g.last} />
    </span>
  </>
);

/** The desktop row's one meta line: the sub (address, Smart summary...)
 *  truncates in front, "76% unread · last 6 Nov" stays whole. */
function MetaLine({ g }: { g: Group }) {
  return (
    <div className="flex min-w-0 overflow-hidden type-meta text-muted">
      {g.sub && (
        <>
          <span className="min-w-0 truncate">{localizedSub(g.sub)}</span>
          <span aria-hidden className="mx-1 shrink-0">·</span>
        </>
      )}
      <span className="shrink-0 whitespace-nowrap"><Stats g={g} /></span>
    </div>
  );
}

/* Selected / open row: a lighter panel + (open) the accent edge. Never an
   accent tint - the status pills must keep 4.5:1 on it (index.contrast.test). */
const ROW_ON = "bg-panel2";

/* Desktop: fixed-layout table so column widths never change when the
   grouping mode (and with it the content) changes. */
function DesktopTable({ slice, baseIdx, selected, focusedKey, openKey, compact, onToggle,
  onToggleAll, onOpen, blockedKeys, selectMode, cards, banner,
  sortK, sortDir, onSort, groupLabel, grouping, rowNote
}: PageProps) {
  // Sort indicator, inline after the label: the active column shows an
  // accent arrow that ROTATES between directions; inactive sortable columns
  // reserve the space (no layout shift) and reveal a faint hint on hover.
  const arrow = (k: SortKey, before = false) => (
    <ArrowDown aria-hidden size={14}
      className={`${before ? "mr-1" : "ml-1"} shrink-0 transition-all duration-200 ${
        sortK === k
          ? `text-accent ${sortDir > 0 ? "rotate-180" : ""}`
          : "opacity-0 group-hover/th:opacity-50 group-focus-within/th:opacity-50"}`} />
  );
  const ariaSort = (k: SortKey) =>
    sortK === k ? (sortDir < 0 ? "descending" as const
      : "ascending" as const) : undefined;
  // Header cell with a real <button>; the sorted column reads in body
  // colour, the others stay muted.
  // Right-aligned columns put the arrow BEFORE the label, so the label
  // (not the reserved arrow space) lines up with the values below.
  const sortBtn = (k: SortKey, label: string, title?: string,
                   right = false) => (
    <button type="button" title={title} onClick={() => onSort(k)}
      className={`inline-flex cursor-pointer items-center whitespace-nowrap
        font-semibold hover:text-body ${sortK === k ? "text-body" : ""}`}>
      {right && arrow(k, true)}{label}{!right && arrow(k)}
    </button>
  );
  const allChecked =
    slice.length > 0 && slice.every((g) => selected.has(g.key));
  const showChecks = !!cards || !!selectMode || selected.size > 0;
  // Hidden checkboxes stay in the layout (no shift): the mouse reveals them
  // on hover / focus; on touch they are inert until select mode.
  const hiddenCls = `opacity-0 coarse:pointer-events-none
    focus-within:opacity-100`;
  // (The strip above the sticky header, inside body's top padding, is
  // covered by body::before in index.css.)
  const th = "px-2 py-2 align-bottom type-meta font-semibold";
  const sortableTh = `${th} group/th`;
  // Row click opens the detail, except on things with their own action.
  const rowClick = (g: Group) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (window.getSelection()?.toString()) return;   // drag-selecting text
    if ((e.target as HTMLElement).closest(
      "button, a, input, label, [data-no-open]")) return;
    onOpen(g);
  };
  // Hairlines start after the avatar (inset list), so the first two cells
  // carry none.
  const td = "border-b border-line";
  // table-fixed: column widths come from the header cells, so they are
  // content-independent and identical in every grouping mode.
  return (
    <div className="group/table overflow-clip rounded-card bg-panel">
    <table className="w-full table-fixed border-collapse type-body">
      <thead>
        {/* top: below the sticky phone/tablet top bar (--topbar-h, 0 elsewhere) */}
        <tr className="sticky top-[var(--topbar-h,0px)] z-(--z-sticky) bg-panel text-left text-muted">
          <th className={`${th} w-10`}>
            <Checkbox checked={allChecked} className={`-mx-2 -my-1 ${showChecks
              ? "" : `${hiddenCls} hoverable:group-hover/table:opacity-100`}`}
              aria-label={t("Select all")}
              onChange={(e) => onToggleAll(e.target.checked,
                slice.map((g) => g.key))} />
          </th>
          <th className="w-10" />
          <th className={sortableTh} aria-sort={ariaSort("label")}>
            {sortBtn("label", groupLabel)}
          </th>
          {!compact && <th className={`${th} w-44`} />}
          <th className={`${th} w-32 text-right`}
            aria-sort={ariaSort(sortK === "size" ? "size" : "count")}>
            {/* Stacked like the cells below: Mails over Size. */}
            <span className="group/th inline-flex flex-col items-end">
              {sortBtn("count", t("Mails"), undefined, true)}
              {sortBtn("size", t("Size"), undefined, true)}
            </span>
          </th>
          <th className="w-11" />
        </tr>
      </thead>
      <tbody>
        {banner && (
          <tr><td colSpan={compact ? 5 : 6} className="p-0">{banner}</td></tr>
        )}
        {slice.map((g, i) => {
          const on = g.key === openKey || selected.has(g.key);
          const pill = rowPill(g, !!blockedKeys?.has(g.key));
          return (
          <tr key={g.key} data-gidx={baseIdx + i}
            aria-current={g.key === openKey || undefined}
            onClick={rowClick(g)}
            className={`group/row cursor-pointer hover:bg-panel2
              ${on ? ROW_ON : g.key === focusedKey ? "bg-panel2/60" : ""}
              ${g.key === focusedKey ? "outline outline-1 -outline-offset-1 outline-accent/60" : ""}`}>
            {/* Open row: 2 px accent left edge (§4.11 selected row). */}
            <td className={`px-2 py-2.5 align-middle ${g.key === openKey
              ? "shadow-open-edge" : ""}`}
              {...(showChecks ? { "data-no-open": true } : {})}>
              <Checkbox checked={selected.has(g.key)}
                className={`-mx-2 -my-1 ${showChecks ? "" : `${hiddenCls}
                  hoverable:group-hover/row:opacity-100 ${
                    // the j/k row: what `x` ticks (mouse / keyboard only)
                    g.key === focusedKey ? "hoverable:opacity-100" : ""}`}`}
                aria-label={t("Select {label}", { label: g.label || g.key })}
                onChange={() => onToggle(g.key)} />
            </td>
            <td className="py-2.5 pl-0 pr-2 align-middle">
              <RowAvatar g={g} grouping={grouping} />
            </td>
            <td className={`min-w-0 px-2 py-2.5 ${td}`}>
              {/* Beside the list (compact) the pill joins the name line: a
                  column of its own would leave the meta line no room. */}
              <div className="flex items-center gap-2">
                <button
                  className="min-w-0 cursor-pointer truncate text-left
                    type-body font-medium hover:underline"
                  onClick={() => onOpen(g)}>
                  {g.label}
                </button>
                {compact && <span className="shrink-0">{pill}</span>}
              </div>
              {rowNote?.(g) && (
                <div className="truncate type-meta text-muted"
                  title={rowNote(g)}>{rowNote(g)}</div>
              )}
              <MetaLine g={g} />
            </td>
            {!compact && (
              <td className={`px-2 py-2.5 text-right ${td}`}>{pill}</td>
            )}
            <td className={`whitespace-nowrap px-2 py-2.5 text-right
              tabular-nums ${td}`}>
              <div className="font-semibold">{fmtNum(g.count)}</div>
              <div className="type-meta text-muted">{fmtSize(g.size)}</div>
            </td>
            <td className={`px-1 py-2.5 text-right ${td}`}>
              <Button variant="quiet" size="icon" label={t("View details")}
                className="text-faint" onClick={() => onOpen(g)}>
                <ChevronRight size={18} />
              </Button>
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

/* Mobile: a card list - no table semantics, no horizontal squeeze. The
   round checks only exist in select mode (a tap on a card opens it). */
function MobileCards({ slice, baseIdx, selected, focusedKey, onToggle,
  onOpen, blockedKeys, selectMode, cards, grouping, rowNote, banner, swipe
}: PageProps) {
  const showChecks = !!cards || !!selectMode || selected.size > 0;
  const [moreFor, setMoreFor] = useState<Group | null>(null);
  // Swipe left: Trash (a full swipe) · Block · More; right: Protect · Read.
  const swipeActions = (g: Group) => {
    if (!swipe) return { leading: [], trailing: [] };
    const target = swipe.canTarget(g);
    const blocked = !!blockedKeys?.has(g.key);
    const trailing: SwipeAction[] = [
      { key: "trash", label: t("Trash"), tone: "danger",
        icon: <Trash2 size={18} aria-hidden />,
        onAction: () => swipe.trash(g) },
      ...(target ? [blocked
        ? { key: "unblock", label: t("Unblock"), tone: "info" as const,
          icon: <Ban size={18} aria-hidden />,
          onAction: () => swipe.unblock(g) }
        : { key: "block", label: t("detail.block"), tone: "info" as const,
          icon: <Ban size={18} aria-hidden />,
          onAction: () => swipe.block(g) }] : []),
      { key: "more", label: t("menu.more"), tone: "neutral",
        icon: <MoreHorizontal size={18} aria-hidden />,
        onAction: () => setMoreFor(g) },
    ];
    const leading: SwipeAction[] = [
      ...(target ? [{ key: "protect", tone: "new" as const,
        label: t(g.protected ? "swipe.unprotect" : "btn.protect"),
        ariaLabel: t(g.protected ? "unprotect.tip" : "protect.tip"),
        icon: g.protected ? <ShieldOff size={18} aria-hidden />
          : <Shield size={18} aria-hidden />,
        onAction: () => swipe.protect(g) }] : []),
      ...(g.unread > 0 ? [{ key: "read", tone: "attach" as const,
        label: t("swipe.read"), ariaLabel: t("Mark read"),
        icon: <MailOpen size={18} aria-hidden />,
        onAction: () => swipe.read(g) }] : []),
    ];
    return { leading, trailing };
  };
  const sheetItem = (run: (g: Group) => void) => () => {
    const g = moreFor;
    setMoreFor(null);
    if (g) run(g);
  };
  return (
    <div className="overflow-clip rounded-card bg-panel">
      {banner}
      {slice.map((g, i) => {
        const pill = rowPill(g, !!blockedKeys?.has(g.key));
        return (
        <SwipeRow key={g.key} {...swipeActions(g)} enabled={!showChecks}>
        <div data-gidx={baseIdx + i}
          className={`flex items-stretch
            ${selected.has(g.key) ? ROW_ON
              : g.key === focusedKey ? "bg-panel2/60" : ""}`}>
          {/* The whole left gutter (44 px, full card height) is the
              check's hit area; it never overlaps the open-detail area. */}
          {showChecks && (
            <Checkbox round checked={selected.has(g.key)}
              className="w-11 shrink-0 self-stretch coarse:min-h-0"
              aria-label={t("Select {label}", { label: g.label || g.key })}
              onChange={() => onToggle(g.key)} />
          )}
          {/* Taps anywhere on the card open the detail; the title is the
              real <button>, so keyboard and screen-reader users can too. */}
          <div className={`flex min-w-0 flex-1 cursor-pointer items-center
            gap-3 py-2.5 pr-1 ${showChecks ? "" : "pl-3"}`}
            onClick={() => onOpen(g)}>
            <RowAvatar g={g} grouping={grouping} />
            <div className={`min-w-0 flex-1 pb-2.5 pt-0.5
              ${i < slice.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <button type="button" data-no-open
                    className="block w-full cursor-pointer truncate text-left
                      type-body-mobile"
                    onClick={(e) => { e.stopPropagation(); onOpen(g); }}>
                    {g.label}
                  </button>
                  {rowNote?.(g) && (
                    <div className="type-meta text-muted">{rowNote(g)}</div>
                  )}
                  {/* Phones: the address gets a line of its own (it would
                      truncate to nothing beside the stats); the stats and
                      the pill share the next one, the pill wrapping under. */}
                  {g.sub && (
                    <div className="truncate type-meta text-muted">
                      {localizedSub(g.sub)}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1
                    type-meta text-muted">
                    <span><Stats g={g} /></span>
                    {pill}
                  </div>
                </div>
                <div className="shrink-0 whitespace-nowrap text-right
                  tabular-nums">
                  <div className="font-semibold">{fmtNum(g.count)}</div>
                  <div className="type-meta text-muted">{fmtSize(g.size)}</div>
                </div>
                <ChevronRight aria-hidden size={18}
                  className="shrink-0 text-faint" />
              </div>
            </div>
          </div>
        </div>
        </SwipeRow>
        );
      })}
      {moreFor && swipe && (
        <Modal size="sm" label={moreFor.label || moreFor.key}
          onClose={() => setMoreFor(null)}>
          <div className="flex shrink-0 items-center justify-between px-4
            py-2">
            <span className="min-w-0 truncate type-heading">
              {moreFor.label || moreFor.key}
            </span>
            <Button variant="plain" className="font-semibold"
              onClick={() => setMoreFor(null)}>
              {t("filter.done")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <SettingsGroup>
              <SettingsRow label={t("swipe.open")}
                icon={<IconTile><PanelRight size={16} /></IconTile>}
                onClick={sheetItem(onOpen)} />
              <SettingsRow label={t("select.enter")}
                icon={<IconTile><ListChecks size={16} /></IconTile>}
                onClick={sheetItem(swipe.select)} />
              <SettingsRow label={t("Archive")}
                icon={<IconTile><Archive size={16} /></IconTile>}
                onClick={sheetItem(swipe.archive)} />
            </SettingsGroup>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function GroupTable(props: Props) {
  const { groups, focusedKey, resetSignal } = props;
  const [page, setPage] = useState(0);
  // Focus that sat on a row which then vanished (Trash all removes it) would
  // drop to <body>: remember whether focus was last inside the list and, when
  // the rows change under it, park focus on the list itself.
  const root = useRef<HTMLDivElement>(null);
  const focusInside = useRef(false);
  const focusIdx = useRef(-1);     // absolute index of the row focus was in
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      focusInside.current = !!root.current?.contains(el);
      const row = focusInside.current ? el.closest("[data-gidx]") : null;
      if (row) focusIdx.current = Number(row.getAttribute("data-gidx"));
    };
    document.addEventListener("focusin", onIn);
    return () => document.removeEventListener("focusin", onIn);
  }, []);
  useEffect(() => {
    const a = document.activeElement;
    if (!focusInside.current || (a && a !== document.body) || isModalOpen())
      return;
    // The row that took the removed row's place (the previous one if it was
    // the last); the list itself if there is no visible row to land on.
    const want = Math.min(focusIdx.current, groups.length - 1);
    const rows = want < 0 ? [] : [...root.current!.querySelectorAll(
      `[data-gidx="${want}"]`)] as HTMLElement[];
    // (the table and card twins: only one is laid out; jsdom has no layout)
    const laidOut = document.documentElement.getClientRects().length > 0;
    const row = laidOut ? rows.find((r) => r.getClientRects().length > 0)
      : rows[0];
    (row?.querySelector<HTMLElement>("button") ?? root.current)
      ?.focus({ preventScroll: true });
  }, [groups]);
  const [perPage, setPerPage] = useState(() =>
    Number(localStorage.getItem("pmc_page_size")) || 50);

  const maxPage = Math.max(0, Math.ceil(groups.length / perPage) - 1);

  useEffect(() => { setPage(0); }, [resetSignal]);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [page, maxPage]);
  // Keyboard navigation (j/k in App) follows the focused row across pages.
  useEffect(() => {
    if (!focusedKey) return;
    const idx = groups.findIndex((g) => g.key === focusedKey);
    if (idx >= 0) {
      const p = Math.floor(idx / perPage);
      if (p !== page) setPage(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedKey]);

  const baseIdx = page * perPage;
  const slice = groups.slice(baseIdx, baseIdx + perPage);

  return (
    // Focus falls back here when a dialog's opener row is gone (Modal).
    <div ref={root} data-focus-return tabIndex={-1}
      className="outline-none">
      {!props.cards && (
        <div className="hidden md:block">
          <DesktopTable {...props} slice={slice} baseIdx={baseIdx} />
        </div>
      )}
      <div className={props.cards ? "" : "md:hidden"}>
        <MobileCards {...props} slice={slice} baseIdx={baseIdx} />
      </div>
      {(groups.length > Math.min(perPage, ...PAGE_SIZES)) && (
        <div className="flex flex-wrap items-center justify-center gap-2
          py-3 type-meta text-muted">
          <Button variant="secondary" size="sm"
              aria-label={t("page.first")} title={t("page.first")}
              disabled={page === 0} onClick={() => setPage(0)}>
            <ChevronsLeft size={16} />
          </Button>
          <Button variant="secondary" size="sm"
              aria-label={t("page.prev")} title={t("page.prev")}
              disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={16} />
          </Button>
          <span className="tabular-nums">
            {t("page.of", { p: page + 1, n: maxPage + 1 })}
          </span>
          <Button variant="secondary" size="sm"
              aria-label={t("page.next")} title={t("page.next")}
              disabled={page >= maxPage} onClick={() => setPage(page + 1)}>
            <ChevronRight size={16} />
          </Button>
          <Button variant="secondary" size="sm"
              aria-label={t("page.last")} title={t("page.last")}
              disabled={page >= maxPage} onClick={() => setPage(maxPage)}>
            <ChevronsRight size={16} />
          </Button>
          <PopupSelect<string> up value={String(perPage)}
            onChange={(v) => {
              const n = Number(v);
              setPerPage(n);
              setPage(0);
              localStorage.setItem("pmc_page_size", String(n));
            }}
            options={[
              ...PAGE_SIZES.map((n) => ({ value: String(n),
                label: `${n} ${t("per page")}` })),
              { value: String(ALL), label: t("All") },
            ]} />
        </div>
      )}
    </div>
  );
}
