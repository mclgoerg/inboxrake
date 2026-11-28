import { AlarmClock, Calendar, CalendarClock, CalendarDays, Layers, Sunrise,
  Sunset, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { nowDate } from "../clock";
import { t } from "../i18n";
import { epoch, localInput, menuTime, parseLocalInput, slotLabel,
  snoozeChoices, type SnoozeKey } from "../snooze";
import type { BatchSlot } from "../types";
import { Button, IconTile, Input, MenuGroup, MenuItem, Modal, Popover,
  SettingsGroup, SettingsRow, Switch, useMediaQuery } from "./ui";

/* Not now: snooze mail until a time you pick, or let a sender deliver in
 * batches (backend/snooze.py). It is the LAST item of a menu that exists - the
 * sender pane's More, the reader's ⋯, the selection bars' More (a swipe row's
 * More on a phone) - and opens a small popover beside that menu (menus have no
 * submenus) or, on a phone, a bottom sheet. It only asks WHEN; what is snoozed
 * and the toast / Undo that follow belong to the caller. */

const TIME_ICON: Record<SnoozeKey, LucideIcon> = {
  later: Sunset, tomorrow: Sunrise, monday: CalendarClock, weekend: CalendarDays,
};
const BATCHES: readonly BatchSlot[] = ["daily", "weekly"];

/** What the choice acts on: the unread mails of one sender or group
 *  (`unread`), the ticked mails (`selected`) or the one open mail (`mail`). */
export type NotNowScope = "unread" | "selected" | "mail";

export interface NotNowSpec {
  scope: NotNowScope;
  /** How many mails a time choice would snooze. */
  n: number;
  /** The sender's name: the batch section and the sheet name it. */
  who: string;
  /** A time was chosen (epoch seconds from the browser's clock). */
  onSnooze: (until: number) => unknown;
  /** One sender only: the current batch slot (null = none) and how to change
   *  it. Absent: no batch choices. */
  batch?: {
    slot: BatchSlot | null;
    onSet: (slot: BatchSlot | "off") => unknown;
  };
  disabled?: boolean;
}

/** One row: icon, words, and the clock on the right. */
function Row({ icon: Icon, label, when }: {
  icon: LucideIcon; label: string; when?: string;
}) {
  return (
    <span className="flex w-full items-center gap-3">
      <Icon size={16} aria-hidden className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {when && <span className="shrink-0 type-meta tabular-nums text-muted">
        {when}</span>}
    </span>
  );
}

/** "Pick a date…": a date and time of your own. */
function PickDate({ onPick, onClose }: {
  onPick: (at: Date) => void; onClose: () => void;
}) {
  const now = nowDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const [value, setValue] = useState(localInput(tomorrow));
  const at = parseLocalInput(value);
  const ok = !!at && at.getTime() > nowDate().getTime();
  return (
    <Modal size="sm" label={t("snooze.pick_title")} onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <Button variant="plain" onClick={onClose}>{t("Cancel")}</Button>
        <span className="type-heading">{t("snooze.pick_title")}</span>
        <Button variant="plain" className="font-semibold" disabled={!ok}
          onClick={() => ok && onPick(at!)}>{t("snooze.pick_confirm")}</Button>
      </div>
      <div className="space-y-2 px-4 pb-4">
        <label className="block type-meta text-muted" htmlFor="snooze-at">
          {t("snooze.pick_field")}</label>
        <Input id="snooze-at" type="datetime-local" value={value}
          min={localInput(now)} className="w-full"
          onChange={(e) => setValue(e.target.value)} />
        <p className="type-meta text-muted">{t("snooze.pick_hint")}</p>
      </div>
    </Modal>
  );
}

/** The popover of the board: the times, "Pick a date…", and for one sender
 *  "Every new mail from <name>" with the two batch rhythms. */
function NotNowPopover({ spec, anchor, up, onPick, onCustom, onClose }: {
  spec: NotNowSpec; anchor: RefObject<HTMLElement | null>; up?: boolean;
  onPick: (at: Date) => void; onCustom: () => void; onClose: () => void;
}) {
  const { batch } = spec;
  const now = nowDate();
  const none = spec.scope === "unread" && spec.n === 0;
  return (
    <Popover anchor={anchor} up={up} onClose={onClose}
      label={`${t("snooze.btn")} · ${spec.who}`}>
      {none && (
        <p className="px-3 pb-1 pt-2 type-meta text-muted">
          {t("snooze.none_unread")}</p>
      )}
      <div>
        {snoozeChoices(now).map((c) => (
          <MenuItem key={c.key} disabled={none} onClick={() => onPick(c.at)}>
            <Row icon={TIME_ICON[c.key]} label={t(`snooze.${c.key}`)}
              when={menuTime(c.at, now)} />
          </MenuItem>
        ))}
        <MenuItem disabled={none} onClick={onCustom}>
          <Row icon={Calendar} label={t("snooze.pick")} />
        </MenuItem>
      </div>
      {batch && (
        <MenuGroup label={t("snooze.every_from", { name: spec.who })}>
          {BATCHES.map((slot) => (
            <MenuItem key={slot} active={batch.slot === slot}
              onClick={() => {
                void batch.onSet(batch.slot === slot ? "off" : slot);
                onClose();
              }}>
              <Row icon={Layers}
                label={t(slot === "weekly" ? "snooze.batch_week"
                  : "snooze.batch_day")}
                when={slotLabel(slot, now)} />
            </MenuItem>
          ))}
        </MenuGroup>
      )}
    </Popover>
  );
}

/** The bottom sheet of the board (phones): four time tiles, "Pick a date…",
 *  and for one sender the two batch rows as switches (one rhythm at a time),
 *  then Cancel. */
function Sheet({ spec, onPick, onCustom, onClose }: {
  spec: NotNowSpec;
  onPick: (at: Date) => void; onCustom: () => void; onClose: () => void;
}) {
  const { batch } = spec;
  const now = nowDate();
  const none = spec.scope === "unread" && spec.n === 0;
  // the choice shows at once; the state catches up with it a tick later
  const [cur, setCur] = useState<BatchSlot | null>(batch?.slot ?? null);
  const setBatch = (slot: BatchSlot | "off") => {
    setCur(slot === "off" ? null : slot);
    void batch?.onSet(slot);
  };
  const sub = spec.scope === "selected" ? t("snooze.sheet_sub_selected",
    { n: spec.n }) : spec.scope === "mail" ? "" : t("snooze.sheet_sub",
    { n: spec.n });
  return (
    <Modal size="sm" label={t("snooze.sheet_title", { name: spec.who })}
      onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="pb-3 text-center">
          <div className="type-heading">
            {t("snooze.sheet_title", { name: spec.who })}</div>
          {sub && <div className="type-meta text-muted">{sub}</div>}
        </div>
        {none ? (
          <p className="pb-3 type-meta text-muted">{t("snooze.none_unread")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {snoozeChoices(now).map((c) => {
              const Icon = TIME_ICON[c.key];
              return (
                <button key={c.key} type="button" onClick={() => onPick(c.at)}
                  className="flex min-h-24 cursor-pointer flex-col items-center
                    justify-center gap-1 rounded-card border border-line
                    bg-panel2 p-3 text-center enabled:hover:bg-chip">
                  <Icon size={18} aria-hidden className="text-accent" />
                  <span className="type-body font-semibold">
                    {t(`snooze.tile_${c.key}`)}</span>
                  <span className="type-meta tabular-nums text-muted">
                    {menuTime(c.at, now)}</span>
                </button>
              );
            })}
          </div>
        )}
        <SettingsGroup className="mt-3 mb-0">
          <SettingsRow label={t("snooze.pick")} onClick={onCustom}
            disabled={none}
            icon={<IconTile><Calendar size={16} /></IconTile>} />
          {batch && BATCHES.map((slot) => (
            <SettingsRow key={slot}
              label={t(slot === "weekly" ? "snooze.batch_week"
                : "snooze.batch_day")}
              sub={t("snooze.sheet_batch_sub", { name: spec.who,
                when: slotLabel(slot, now) })}
              icon={<IconTile tone="accent"><Layers size={16} /></IconTile>}>
              <Switch checked={cur === slot} label={t(slot === "weekly"
                ? "snooze.batch_week" : "snooze.batch_day")}
                onChange={(on) => setBatch(on ? slot : "off")} />
            </SettingsRow>
          ))}
        </SettingsGroup>
        <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>
          {t("Cancel")}</Button>
      </div>
    </Modal>
  );
}

/** The sheet on its own, opened by the caller (a phone swipe row's More): the
 *  time tiles, the batch switches, and "Pick a date…" in its own dialog. */
export function NotNowSheet({ onClose, ...spec }: NotNowSpec & {
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const go = (at: Date) => {
    onClose();
    void spec.onSnooze(epoch(at));
  };
  return picking
    ? <PickDate onPick={go} onClose={() => setPicking(false)} />
    : <Sheet spec={spec} onPick={go} onCustom={() => setPicking(true)}
        onClose={onClose} />;
}

/** The "Not now…" entry of a More menu: `item` is its LAST `MenuItem` (a
 *  `PopupSelect` option calls `open` itself), `anchorRef` goes on the element
 *  around the menu's button (the popover opens beside it), `overlay` renders
 *  anywhere - the popover from 640 px, the bottom sheet on a phone, "Pick a
 *  date…" in its own dialog - and is portalled to <body> itself, so a bar with
 *  a blurred background or a scrolling pane around the menu cannot trap its
 *  fixed dialog (it would sit inside the bar, cut off and undimmed). `up`:
 *  the menu sits on a bottom bar and opens upward. */
export function useNotNow(spec: NotNowSpec, up = false): {
  item: ReactNode;
  open: () => void;
  anchorRef: RefObject<HTMLDivElement | null>;
  overlay: ReactNode;
} {
  const narrow = useMediaQuery("(width < 40rem)");
  const anchorRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [picking, setPicking] = useState(false);
  const open = () => setShown(true);
  const close = () => { setShown(false); setPicking(false); };
  const go = (at: Date) => {
    close();
    void spec.onSnooze(epoch(at));
  };
  const item = (
    <MenuItem disabled={spec.disabled} onClick={open}>
      <AlarmClock size={16} aria-hidden
        className="mr-1 inline align-text-bottom" />
      {t("snooze.more_item")}
    </MenuItem>
  );
  const shownNode = !shown ? null : picking
    ? <PickDate onPick={go} onClose={close} />
    : narrow
      ? <Sheet spec={spec} onPick={go} onCustom={() => setPicking(true)}
          onClose={close} />
      : <NotNowPopover spec={spec} anchor={anchorRef} up={up} onPick={go}
          onCustom={() => setPicking(true)} onClose={close} />;
  const overlay = shownNode && createPortal(shownNode, document.body);
  return { item, open, anchorRef, overlay };
}
