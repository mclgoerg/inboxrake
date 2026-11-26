import { Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { LINK_TAP, dayMonth } from "../subscriptions";
import type { WaitingSender } from "../types";
import { LINK_ACCENT, Notice } from "./ui";

/** One line in a sender's pane while you wait on them: "You're waiting for
 *  their reply since 16 Nov · usually 3 days" with a Show that opens that mail
 *  on the Waiting for a reply page. Nothing is drawn while there is nothing
 *  to wait on (or the account does not watch its sent mail), and nothing is
 *  asked of the server unless `enabled` (the pane of a single sender). */
export function WaitingLine({ addr, enabled, onShow }: {
  addr: string;
  enabled: boolean;
  onShow: (id: string) => void;
}) {
  const [got, setGot] = useState<{ addr: string; w: WaitingSender | null }
    | null>(null);
  useEffect(() => {
    if (!enabled || !addr) return;
    let live = true;
    Promise.resolve().then(() => api.waitingSender(addr))
      .then((r) => live && setGot({ addr, w: r.waiting }),
        () => live && setGot(null));
    return () => { live = false; };
  }, [addr, enabled]);
  const w = enabled && got && got.addr === addr ? got.w : null;
  if (!w) return null;
  return (
    <div className="px-4 pt-3" data-testid="waiting-line">
      <Notice tone="warn" icon={<Hourglass size={16} aria-hidden />}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 flex-1">
            {w.usual_days !== null
              ? t("waiting.line_usual", { date: dayMonth(w.ts),
                n: w.usual_days })
              : t("waiting.line", { date: dayMonth(w.ts) })}
          </span>
          <button type="button" className={`${LINK_ACCENT} ${LINK_TAP}`}
            onClick={() => onShow(w.id)}>{t("waiting.show")}</button>
        </div>
      </Notice>
    </div>
  );
}
