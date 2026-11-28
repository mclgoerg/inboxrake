import { AlarmClock } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import { whenText } from "../snooze";
import { LINK_TAP } from "../subscriptions";
import { useSnooze } from "./snoozeContext";
import { LINK, Notice } from "./ui";

/** One line in a sender's pane while some of their mail is snoozed: "3 mails
 *  snoozed until tomorrow 08:00" with a Back now that returns it all, unread.
 *  After What they send and the waiting line. Nothing is drawn when nothing of
 *  this sender waits (the state's `snoozed` summary carries the counts, so it
 *  asks the server for nothing). */
export function SnoozedLine({ addr }: { addr: string }) {
  const snooze = useSnooze();
  const [busy, setBusy] = useState(false);
  const n = snooze.summary?.mails?.[addr] ?? 0;
  const until = snooze.summary?.until?.[addr];
  if (!n || until == null) return null;
  return (
    <div className="px-4 pt-3" data-testid="snoozed-line">
      <Notice tone="info" icon={<AlarmClock size={16} aria-hidden />}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 flex-1">
            {t("snooze.line", { n, when: whenText(until) })}
          </span>
          <button type="button" disabled={busy}
            className={`${LINK} ${LINK_TAP} font-medium`}
            onClick={async () => {
              setBusy(true);
              try { await snooze.back(addr); } finally { setBusy(false); }
            }}>{t("snooze.back_now")}</button>
        </div>
      </Notice>
    </div>
  );
}
