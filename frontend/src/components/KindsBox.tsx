/* "What they send": the box of a sender that sends more than one kind of mail
 * (order confirmations, shipping updates, ads ...), between the arrival strip
 * and the Mails list of the sender pane.
 *
 * One row per kind with its mails, size and how much you open, and what can be
 * done to that kind alone: Show (the Mails list below is narrowed to it, as a
 * chip you can remove), Trash N, and in the menu Archive / Move / Mark as read
 * / Protect these N and "Always trash their <kind>…" (a rule, in Report only).
 * On a phone a row is one button that opens a sheet with the same actions.
 *
 * Nothing here acts on a mail itself: every action is handed to the sender
 * pane, which runs it through the path "Trash selected" and the Action…
 * select already use (confirm, Keep-safe above 20 mails, the background job,
 * Undo, the Activity log). The kinds are worked out on the server from the
 * subjects (backend/mailkinds.py); the box only counts them. */

import { Archive, Briefcase, CalendarCheck, ChevronRight, FileText,
  FolderInput, KeyRound, LifeBuoy, ListChecks, Megaphone, MailOpen,
  MoreHorizontal, Receipt, Shield, Truck, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { t, getLang } from "../i18n";
import { nowDate } from "../clock";
import { hasKinds, kindLabel, kindRows, type KindId, type KindRow }
  from "../kinds";
import { fmtDate, fmtSize } from "../lib";
import { fmtPct } from "../numfmt";
import type { Mail } from "../types";
import { Button, IconTile, Menu, MenuDivider, MenuItem, Modal, type TagTone }
  from "./ui";

/** Icon, tile tone and the matching solid colour of the kind bar. */
const LOOK: Record<KindId, { icon: ReactNode; tone: TagTone; bar: string }> = {
  ads: { icon: <Megaphone size={16} />, tone: "review", bar: "bg-review-fg" },
  orders: { icon: <Receipt size={16} />, tone: "safe", bar: "bg-safe-fg" },
  shipping: { icon: <Truck size={16} />, tone: "info", bar: "bg-info-fg" },
  invoices: { icon: <FileText size={16} />, tone: "new", bar: "bg-new-fg" },
  appointments: { icon: <CalendarCheck size={16} />, tone: "attach",
    bar: "bg-attach-fg" },
  jobs: { icon: <Briefcase size={16} />, tone: "accent", bar: "bg-accent" },
  support: { icon: <LifeBuoy size={16} />, tone: "neutral", bar: "bg-muted" },
  accounts: { icon: <KeyRound size={16} />, tone: "keep",
    bar: "bg-keep-fg" },
};

/** What a row can do. Each gets the row; the sender pane runs it. */
export interface KindActions {
  /** Narrow the Mails list to this kind (the same kind again: back to all). */
  show: (row: KindRow) => void;
  trash: (row: KindRow) => void;
  archive: (row: KindRow) => void;
  move: (row: KindRow) => void;
  markRead: (row: KindRow) => void;
  protect: (row: KindRow) => void;
  /** "Always trash their <kind>…": the sender pane asks, then makes a rule. */
  rule?: (row: KindRow) => void;
}

/** The removable chip next to the Mails heading while a kind is shown. */
export function KindChip({ kind, onClear }: {
  kind: KindId; onClear: () => void;
}) {
  const name = kindLabel(kind);
  return (
    <span data-testid="kind-chip" className="inline-flex min-h-7 coarse:min-h-8 min-w-0
      max-w-full items-center rounded-full bg-accent-tint pl-2.5 type-meta
      font-medium text-accent">
      <span className="min-w-0 truncate">{name}</span>
      <button type="button" aria-label={t("kind.chip_clear", { kind: name })}
        onClick={onClear}
        className="relative flex size-7 coarse:size-8 shrink-0 items-center
          justify-center rounded-full hover:bg-accent-tint after:absolute
          after:-inset-2 after:content-['']">
        <X size={14} aria-hidden />
      </button>
    </span>
  );
}

/** The row's second line: its mails and size, then how much you open - or,
 *  for shipping updates (opening one says little), when the last came. */
function subLine(r: KindRow): string {
  const mails = t("n.mails", { n: r.n });
  const size = fmtSize(r.size);
  if (r.id === "shipping") {
    return t("kind.sub_last", { mails, size,
      date: fmtDate(r.last, nowDate(), { lang: getLang() }) });
  }
  return t("kind.sub_open", { mails, size, pct: fmtPct(r.opened) });
}

/** What can be done to the mails of one kind, once. */
interface Counts {
  /** Mails that a bulk action may move (not protected). */
  movable: number;
  unread: number;
}
const countsOf = (r: KindRow): Counts => ({
  movable: r.mails.filter((m) => !m.pinned).length,
  unread: r.mails.filter((m) => !m.seen).length,
});

export function KindsBox({ mails, shown, actions, busy = false, phone }: {
  /** Every mail of the sender (not narrowed by anything). */
  mails: Mail[];
  /** The kind the Mails list is narrowed to. */
  shown: KindId | null;
  actions: KindActions;
  busy?: boolean;
  phone: boolean;
}) {
  const rows = kindRows(mails);
  const [open, setOpen] = useState<KindId | null>(null);
  if (!hasKinds(rows)) return null;
  const total = mails.length;
  const sheetRow = rows.find((r) => r.id === open) ?? null;

  return (
    <section aria-label={t("kind.title")} data-testid="kinds-box"
      className="mx-4 mt-3 rounded-card border border-line bg-panel px-3 pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 type-heading">{t("kind.title")}</h3>
        <span className="type-meta text-muted">
          {t("kind.meta", { n: rows.length })}</span>
      </div>
      {/* how the sender's mails split; mails of no kind are the gap (the
          widths are data, not a size of the design) */}
      <div aria-hidden className="mt-2 mb-1 flex h-1.5 gap-0.5 overflow-hidden
        rounded-full bg-chip">
        {rows.map((r) => (
          <i key={r.id} className={`block h-full ${LOOK[r.id].bar}`}
            style={{ width: `${(100 * r.n) / total}%` }} />
        ))}
      </div>
      <ul>
        {rows.map((r) => (phone
          ? <PhoneRow key={r.id} row={r} onOpen={() => setOpen(r.id)} />
          : <DesktopRow key={r.id} row={r} shown={shown === r.id}
              actions={actions} busy={busy} />))}
      </ul>
      {phone && sheetRow && (
        <KindSheet row={sheetRow} shown={shown === sheetRow.id}
          actions={actions} busy={busy} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

function Title({ row }: { row: KindRow }) {
  return (
    <>
      <IconTile tone={LOOK[row.id].tone}>{LOOK[row.id].icon}</IconTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate type-body font-medium">
          {kindLabel(row.id)}</span>
        <span className="block type-meta text-muted">{subLine(row)}</span>
      </span>
    </>
  );
}

function DesktopRow({ row, shown, actions, busy }: {
  row: KindRow; shown: boolean; actions: KindActions; busy: boolean;
}) {
  const { movable, unread } = countsOf(row);
  const name = kindLabel(row.id);
  return (
    <li data-testid="kind-row" data-kind={row.id}
      className="flex items-center gap-3 border-t border-line py-2">
      <Title row={row} />
      <Button size="sm" variant="secondary" aria-pressed={shown}
        aria-label={t("kind.show_aria", { kind: name })}
        onClick={() => actions.show(row)}>{t("kind.show")}</Button>
      <Button size="sm" variant="danger-tint" disabled={busy || !movable}
        aria-label={t("kind.trash_aria", {
          mails: t("n.mails", { n: movable }), kind: name })}
        onClick={() => actions.trash(row)}>
        {t("kind.trash", { n: movable })}</Button>
      <Menu variant="secondary" icon label={t("kind.more", { kind: name })}
        trigger={<MoreHorizontal size={16} />}>
        <MenuItem disabled={busy || !movable}
          onClick={() => actions.archive(row)}>
          <Archive size={16} aria-hidden
            className="mr-1 inline align-text-bottom" />
          {t("kind.archive", { n: movable })}
        </MenuItem>
        <MenuItem disabled={busy || !movable}
          onClick={() => actions.move(row)}>
          <FolderInput size={16} aria-hidden
            className="mr-1 inline align-text-bottom" />
          {t("kind.move", { n: movable })}
        </MenuItem>
        <MenuItem disabled={busy || !unread}
          onClick={() => actions.markRead(row)}>
          <MailOpen size={16} aria-hidden
            className="mr-1 inline align-text-bottom" />
          {t("kind.mark_read")}
        </MenuItem>
        <MenuItem disabled={busy || !movable}
          onClick={() => actions.protect(row)}>
          <Shield size={16} aria-hidden
            className="mr-1 inline align-text-bottom" />
          {t("kind.protect", { n: movable })}
        </MenuItem>
        {actions.rule && (
          <>
            <MenuDivider />
            <MenuItem onClick={() => actions.rule!(row)}>
              <ListChecks size={16} aria-hidden
                className="mr-1 inline align-text-bottom" />
              {t("kind.rule", { kind: t(`kind.short_${row.id}`) })}
            </MenuItem>
          </>
        )}
      </Menu>
    </li>
  );
}

/** A phone row is the whole 44 px target; its actions are in the sheet. */
function PhoneRow({ row, onOpen }: { row: KindRow; onOpen: () => void }) {
  return (
    <li data-testid="kind-row" data-kind={row.id}
      className="border-t border-line">
      <button type="button" onClick={onOpen}
        aria-label={t("kind.open_aria", { kind: kindLabel(row.id),
          sub: subLine(row) })}
        className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
        <Title row={row} />
        <ChevronRight size={16} aria-hidden className="shrink-0 text-faint" />
      </button>
    </li>
  );
}

/** The phone's version of the row's buttons and menu: the sheet closes, then
 *  the action starts (its confirm or picker opens over the pane). */
function KindSheet({ row, shown, actions, busy, onClose }: {
  row: KindRow; shown: boolean; actions: KindActions; busy: boolean;
  onClose: () => void;
}) {
  const { movable, unread } = countsOf(row);
  const name = kindLabel(row.id);
  const go = (fn?: (r: KindRow) => void) => () => { onClose(); fn?.(row); };
  const item = (icon: ReactNode, text: string, fn: () => void,
    disabled = false) => (
    <button type="button" disabled={disabled || busy} onClick={fn}
      className="flex min-h-11 w-full items-center gap-3 rounded-control px-3
        text-left type-body text-body enabled:hover:bg-chip
        disabled:cursor-not-allowed disabled:text-faint">
      <span aria-hidden className="shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">{text}</span>
    </button>
  );
  return (
    <Modal size="sm" label={name} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <Title row={row} />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" aria-pressed={shown}
            onClick={go(actions.show)}>{t("kind.show")}</Button>
          <Button variant="danger-tint" className="flex-1"
            disabled={busy || !movable}
            aria-label={t("kind.trash_aria", {
          mails: t("n.mails", { n: movable }), kind: name })}
            onClick={go(actions.trash)}>
            {t("kind.trash", { n: movable })}</Button>
        </div>
        <div className="space-y-0.5 border-t border-line pt-2">
          {item(<Archive size={18} />, t("kind.archive", { n: movable }),
            go(actions.archive), !movable)}
          {item(<FolderInput size={18} />, t("kind.move", { n: movable }),
            go(actions.move), !movable)}
          {item(<MailOpen size={18} />, t("kind.mark_read"),
            go(actions.markRead), !unread)}
          {item(<Shield size={18} />, t("kind.protect", { n: movable }),
            go(actions.protect), !movable)}
          {actions.rule && (
            <div className="border-t border-line pt-0.5">
              {item(<ListChecks size={18} />,
                t("kind.rule", { kind: t(`kind.short_${row.id}`) }),
                go(actions.rule))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
