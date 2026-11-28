/* Mail past its date: the sheet behind the Overview's Next steps line.
 *
 * One row per reason (sign-in codes, parcel updates of parcels that have
 * arrived, reminders of things that are over, offers that have ended, and -
 * at the end - the automatic mail: out-of-office replies, delivery failures,
 * read receipts and calendar answers) with a tick - "Offers that have ended"
 * and the read receipts / calendar answers start unticked, the server says
 * so. The
 * receipts / invoices / bookings of the same orders and appointments are
 * never listed ("Kept"); pinned mail and protected senders are not either
 * (backend/pastdate.py).
 *
 * Nothing here moves a mail itself: "Move N to Trash…" fetches the ticked
 * mails and hands them to the app's per-mail Trash step - the same confirm as
 * All mail's "Trash selected" (with the Keep-safe box on a big move), the
 * same background job, Undo and Activity entry. */

import { CalendarX, KeyRound, MailCheck, MailX, ShieldCheck, TimerOff, Truck,
  Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { accountGuard } from "../accountGuard";
import { api } from "../api";
import { t } from "../i18n";
import { fmtSize } from "../lib";
import { confirmTrashItems } from "../mailActions";
import type { ExpiredReasonId, ExpiredResp } from "../types";
import { Button, Checkbox, IconTile, LINK_ACCENT, Modal, PanelHeader,
  SettingsGroup, type TagTone, useMediaQuery, useToast } from "./ui";

/** Reasons in the order the sheet shows them: icon, tone, locale key. */
const LOOK: Record<ExpiredReasonId,
    { icon: ReactNode; tone: TagTone; key: string }> = {
  codes: { icon: <KeyRound size={16} />, tone: "info", key: "past.codes" },
  parcels: { icon: <Truck size={16} />, tone: "review", key: "past.parcels" },
  events: { icon: <CalendarX size={16} />, tone: "attach",
    key: "past.events" },
  offers: { icon: <TimerOff size={16} />, tone: "neutral",
    key: "past.offers" },
  ooo: { icon: <Undo2 size={16} />, tone: "new", key: "past.ooo" },
  bounces: { icon: <MailX size={16} />, tone: "keep", key: "past.bounces" },
  answers: { icon: <MailCheck size={16} />, tone: "safe",
    key: "past.answers" },
};

export function ExpiredSheet({ data, onClose, onOpenAllMail, onShowKept,
  onMoved }: {
  data: ExpiredResp;
  onClose: () => void;
  /** Open All mail with `is:expired` (every reason, ticked or not). */
  onOpenAllMail: () => void;
  /** Open All mail narrowed to the kept receipts. */
  onShowKept: () => void;
  /** The mails are on their way to Trash (a background job). */
  onMoved: () => void;
}) {
  const toast = useToast();
  const phone = useMediaQuery("(max-width: 767px)");
  // a reason this build has no row for (a newer server) is left out
  const reasons = data.reasons.filter((r) => r.mails > 0 && LOOK[r.id]);
  // everything the server suggests is ticked; the user's own choices win
  const [off, setOff] = useState<Set<string>>(
    () => new Set(reasons.filter((r) => !r.ticked).map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  const chosen = reasons.filter((r) => !off.has(r.id));
  const n = chosen.reduce((sum, r) => sum + r.mails, 0);
  const toggle = (id: string) => setOff((s) => {
    const next = new Set(s);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const move = async () => {
    if (!chosen.length || busy) return;
    const switched = accountGuard();
    setBusy(true);
    try {
      // fresh from the server: a mail pinned since the sheet opened is gone
      const { items } = await api.expiredMails(chosen.map((r) => r.id));
      if (switched()) return;
      if (!items.length) {
        toast.show(t("past.nothing"));
        return;
      }
      // the usual confirm (verb + count, danger tone, the Keep-safe box on a
      // big move): the mails kept safe are protected and left out
      const go = await confirmTrashItems(items);
      if (!go || switched()) return;
      if (!go.length) {
        toast.show(t("toast.all_pinned"));
        return;
      }
      await api.deleteMessages(go, "trash");
      toast.show(t("note.background", { verb: t("Move to Trash") }),
        { duration: 3000 });
      onMoved();
      onClose();
    } catch (e: any) {
      toast.show(t("err.generic", { msg: e?.message ?? String(e) }),
        { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const keptText = t(phone ? "past.kept_short" : "past.kept", { n: data.kept });
  const moveLabel = t("past.move", { n });
  return (
    <Modal onClose={onClose} size="md" label={t("past.title")}>
      <PanelHeader title={t("past.title")} onClose={onClose}
        sub={t("qw.card_meta", { mails: data.mails,
          size: fmtSize(data.size) })} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {/* wide: the one line with the automatic-mail phrase in it; phones:
            today's line, and the phrase on a line of its own */}
        <p className="type-meta text-muted">
          {t(phone ? "past.lead" : "past.lead_auto")}</p>
        {phone && (
          <p className="type-meta text-muted">{t("past.lead_headers")}</p>
        )}
        <SettingsGroup className="mb-0">
          <ul className="divide-y divide-line">
            {reasons.map((r) => {
              const look = LOOK[r.id];
              const title = t(look.key);
              return (
                <li key={r.id} data-testid="past-reason">
                  {/* phones: the round tick of the Next steps rows (the whole
                      row is the 44 px target) */}
                  <Checkbox round={phone} aria-label={title}
                    checked={!off.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="w-full gap-3 px-3 py-2.5 coarse:min-h-14"
                    label={
                      <span className="flex items-center gap-3">
                        <IconTile tone={look.tone}>{look.icon}</IconTile>
                        <span className="min-w-0 flex-1">
                          <span className="block type-body font-medium">
                            {title}</span>
                          {!phone && (
                            <span className="block type-meta text-muted">
                              {t(`${look.key}_ex`)}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block type-body font-medium">
                            {r.mails}</span>
                          {!phone && (
                            <span className="block type-meta text-muted">
                              {fmtSize(r.size)}</span>
                          )}
                        </span>
                      </span>
                    } />
                </li>
              );
            })}
          </ul>
        </SettingsGroup>
        {data.kept > 0 && (
          <div data-testid="past-kept" className="flex items-start gap-2
            rounded-card bg-safe-bg px-3 py-2 type-meta text-safe-fg">
            <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 py-0.5">
              {!phone && <b>{t("past.kept_lead")} </b>}
              {keptText}{" "}
              {/* its own line where it is a 44 px target, so a wrapped text
                  keeps its line height */}
              <button type="button" onClick={onShowKept}
                className={`${LINK_ACCENT} coarse:block coarse:min-h-11
                  coarse:text-left`}>
                {t("past.kept_show")}</button>
            </span>
          </div>
        )}
        {phone && (
          <div className="space-y-2 pt-1">
            <Button className="w-full" disabled={!n || busy} onClick={move}>
              {moveLabel}</Button>
            <p className="text-center type-meta text-muted">
              {t("past.undo_note")}{" "}
              <button type="button" onClick={onOpenAllMail}
                className={`${LINK_ACCENT} coarse:block coarse:min-h-11
                  coarse:w-full`}>
                {t("past.open_all")}</button>
            </p>
          </div>
        )}
      </div>
      {!phone && (
        <div className="flex items-center gap-3 border-t border-line px-5
          py-3">
          <button type="button" onClick={onOpenAllMail}
            className={LINK_ACCENT}>{t("past.open_all")}</button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!n || busy} onClick={move}>{moveLabel}</Button>
        </div>
      )}
    </Modal>
  );
}
