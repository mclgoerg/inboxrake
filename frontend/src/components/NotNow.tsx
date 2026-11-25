import { AlarmClock, Calendar, CalendarDays, ChevronRight, Package, Sofa,
  Sunrise, Sunset, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { nowDate } from "../clock";
import { t } from "../i18n";
import { epoch, localInput, menuTime, parseLocalInput, slotLabel,
  slotSentence, snoozeChoices, type SnoozeKey } from "../snooze";
import type { BatchSlot } from "../types";
import { ACTION_BTN, ActionButton, ActionFace, BarButton, BAR_BTN, Button,
  IconTile, Input, Menu, MenuGroup, MenuItem, Modal, Segmented,
  SettingsGroup, SettingsRow, Switch, useMediaQuery } from "./ui";

/* Not now: snooze mail until a time you pick, or let a sender deliver in
 * batches (backend/snooze.py). One control in three places - the sender
 * pane, the mail reader and the selection bars - that is a pop-up menu from
 * 640 px and the bottom sheet of the board on a phone. It only asks WHEN;
 * what is snoozed and the toast / Undo that follow belong to the caller. */

const TIME_ICON: Record<SnoozeKey, LucideIcon> = {
  later: Sunset, tomorrow: Sunrise, weekend: Sofa, nextweek: CalendarDays,
};

/** What the choice acts on: the unread mails of one sender (`unread`), the
 *  ticked mails (`selected`) or the one open mail (`mail`). */
export type NotNowScope = "unread" | "selected" | "mail";

export interface NotNowProps {
  scope: NotNowScope;
  /** How many mails a time choice would snooze. */
  n: number;
  /** The sender's name: the batch section and the sheet name it. */
  who: string;
  /** A time was chosen (epoch seconds from the browser's clock). */
  onSnooze: (until: number) => unknown;
  /** One sender only: the current batch slot (null = none) and how to change
   *  it. Absent: no batch section. */
  batch?: {
    slot: BatchSlot | null;
    onSet: (slot: BatchSlot | "off") => unknown;
  };
  disabled?: boolean;
  /** Where it sits: the sender pane's action row, a selection bar, the
   *  reader's toolbar. */
  look: "action" | "bar" | "reader";
  /** The action row's cell classes. */
  className?: string;
  /** Replaces the button that opens the sheet (the reader's bottom bar), which
   *  is then shown at every width (`forceSheet`). */
  sheetTrigger?: (open: () => void) => ReactNode;
  forceSheet?: boolean;
}

/** One row of the menu: icon, words, and the clock on the right. */
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

/** The bottom sheet of the board: four time tiles, "Deliver in batches",
 *  "Pick a date…". */
function Sheet({ scope, n, who, onPick, onCustom, batch, onClose }: {
  scope: NotNowScope; n: number; who: string;
  onPick: (at: Date) => void; onCustom: () => void;
  batch: NotNowProps["batch"]; onClose: () => void;
}) {
  const now = nowDate();
  const choices = snoozeChoices(now);
  const none = scope === "unread" && n === 0;
  // the choice shows at once; the state catches up with it a tick later
  const [cur, setCur] = useState<BatchSlot | null>(batch?.slot ?? null);
  useEffect(() => setCur(batch?.slot ?? null), [batch?.slot]);
  const [last, setLast] = useState<BatchSlot>(batch?.slot ?? "weekly");
  const setBatch = (s: BatchSlot | "off") => {
    setCur(s === "off" ? null : s);
    if (s !== "off") setLast(s);
    void batch?.onSet(s);
  };
  return (
    <Modal size="sm" label={t("snooze.sheet_title")} onClose={onClose}>
      <div className="flex shrink-0 items-start justify-between px-4 pt-3">
        <div className="min-w-0">
          <div className="type-title2">{t("snooze.sheet_title")}</div>
          <div className="truncate type-meta text-muted">
            {scope === "selected" ? t("snooze.sheet_sub_selected", { n })
              : scope === "mail" ? who
              : t("snooze.sheet_sub", { name: who, n })}
          </div>
        </div>
        <Button variant="plain" className="font-semibold" onClick={onClose}>
          {t("filter.done")}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {none ? (
          <p className="pb-3 type-meta text-muted">{t("snooze.none_unread")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {choices.map((c) => {
              const Icon = TIME_ICON[c.key];
              return (
                <button key={c.key} type="button" onClick={() => onPick(c.at)}
                  className="flex min-h-24 cursor-pointer flex-col items-start
                    gap-2 rounded-card border border-line bg-panel2 p-3
                    text-left enabled:hover:bg-chip">
                  <IconTile tone="info"><Icon size={16} /></IconTile>
                  <span className="min-w-0">
                    <span className="block type-body font-semibold">
                      {t(`snooze.tile_${c.key}`)}</span>
                    <span className="block type-meta tabular-nums text-muted">
                      {menuTime(c.at, now)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <SettingsGroup className="mt-3 mb-0">
          {batch && (
            <>
              <SettingsRow label={t("snooze.sheet_batches")}
                sub={t("snooze.sheet_batches_sub", {
                  slot: slotSentence(cur ?? last, now) })}
                icon={<IconTile tone="accent"><Package size={16} /></IconTile>}>
                <Switch checked={!!cur}
                  onChange={(on) => setBatch(on ? last : "off")} />
              </SettingsRow>
              {cur && (
                <SettingsRow label={t("snooze.sheet_rhythm")} stack>
                  <Segmented<BatchSlot> idPrefix="snooze-slot" fill
                    label={t("snooze.sheet_rhythm")} value={cur}
                    onChange={setBatch}
                    options={[
                      { value: "weekly", label: t("snooze.slot_week") },
                      { value: "daily", label: t("snooze.slot_day") }]} />
                </SettingsRow>
              )}
            </>
          )}
          <SettingsRow label={t("snooze.pick")} onClick={onCustom}
            icon={<IconTile><Calendar size={16} /></IconTile>} />
        </SettingsGroup>
      </div>
    </Modal>
  );
}

/** The sheet on its own, opened by the caller (a swipe on a phone row): the
 *  time tiles, the batch switch, and "Pick a date…" in its own dialog. */
export function NotNowSheet({ scope, n, who, onSnooze, batch, onClose }: {
  scope: NotNowScope; n: number; who: string;
  onSnooze: NotNowProps["onSnooze"]; batch?: NotNowProps["batch"];
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const go = (at: Date) => {
    onClose();
    void onSnooze(epoch(at));
  };
  return picking
    ? <PickDate onPick={go} onClose={() => setPicking(false)} />
    : <Sheet scope={scope} n={n} who={who} batch={batch} onPick={go}
        onCustom={() => setPicking(true)} onClose={onClose} />;
}

export function NotNow({ scope, n, who, onSnooze, batch, disabled, look,
  className = "", sheetTrigger, forceSheet = false }: NotNowProps) {
  const narrow = useMediaQuery("(width < 40rem)");
  const sheetMode = narrow || forceSheet;
  const [sheet, setSheet] = useState(false);
  const [picking, setPicking] = useState(false);
  const none = scope === "unread" && n === 0;
  const go = (at: Date) => {
    setSheet(false);
    setPicking(false);
    void onSnooze(epoch(at));
  };
  const caption = none ? t("snooze.none_unread")
    : scope === "unread" ? t("snooze.menu_unread", { n })
    : scope === "selected" ? t("snooze.menu_selected", { n })
    : t("snooze.menu_mail");
  const picker = picking && (
    <PickDate onPick={go} onClose={() => setPicking(false)} />
  );
  const label = t("snooze.btn");
  if (sheetMode) {
    const open = () => setSheet(true);
    return (
      <>
        {sheetTrigger ? sheetTrigger(open) : look === "bar" ? (
          <BarButton icon={<AlarmClock size={16} aria-hidden />}
            disabled={disabled} onClick={open}>{label}</BarButton>
        ) : look === "reader" ? (
          <Button size="sm" variant="secondary" disabled={disabled}
            className="inline-flex items-center gap-1.5" onClick={open}>
            <AlarmClock size={16} aria-hidden />{label}</Button>
        ) : (
          <ActionButton className={className} disabled={disabled}
            icon={<AlarmClock size={18} />} label={label} onClick={open} />
        )}
        {sheet && (
          <NotNowSheet scope={scope} n={n} who={who} batch={batch}
            onSnooze={onSnooze} onClose={() => setSheet(false)} />
        )}
      </>
    );
  }
  const now = nowDate();
  const body = (<>
        <MenuGroup label={caption}>
          {snoozeChoices(now).map((c) => (
            <MenuItem key={c.key} disabled={none} onClick={() => go(c.at)}>
              <Row icon={TIME_ICON[c.key]} label={t(`snooze.${c.key}`)}
                when={menuTime(c.at, now)} />
            </MenuItem>
          ))}
          <MenuItem disabled={none} onClick={() => setPicking(true)}>
            <Row icon={Calendar} label={t("snooze.pick")} />
          </MenuItem>
        </MenuGroup>
        {batch && (
          <MenuGroup label={t("snooze.every_from", { name: who })}>
            {(["weekly", "daily"] as const).map((slot) => (
              <MenuItem key={slot} active={batch.slot === slot}
                onClick={() => void batch.onSet(
                  batch.slot === slot ? "off" : slot)}>
                <Row icon={Package}
                  label={t(slot === "weekly" ? "snooze.batch_week"
                    : "snooze.batch_day")}
                  when={slotLabel(slot, now)} />
              </MenuItem>
            ))}
            {batch.slot && (
              <MenuItem onClick={() => void batch.onSet("off")}>
                <Row icon={ChevronRight} label={t("snooze.batch_stop")} />
              </MenuItem>
            )}
          </MenuGroup>
        )}
  </>);
  return (
    <>
      {look === "action" ? (
        <div className={`${className} flex justify-center`}>
          <Menu label={label} disabled={disabled} triggerClass={ACTION_BTN}
            trigger={<ActionFace icon={<AlarmClock size={18} />}
              label={label} />}>{body}</Menu>
        </div>
      ) : look === "bar" ? (
        <Menu variant="secondary" up triggerSize="sm" label={label}
          disabled={disabled} triggerClass={`${BAR_BTN}`}
          trigger={<>
            <AlarmClock size={16} aria-hidden />
            <span className="sr-only md:not-sr-only md:ml-1.5">{label}</span>
          </>}>{body}</Menu>
      ) : (
        <Menu variant="secondary" triggerSize="sm" label={label}
          disabled={disabled}
          trigger={<><AlarmClock size={16} aria-hidden />{label}</>}>
          {body}</Menu>
      )}
      {picker}
    </>
  );
}
