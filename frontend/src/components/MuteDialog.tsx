import { BellOff, Info } from "lucide-react";
import { type ReactNode, useId, useLayoutEffect, useRef, useState }
  from "react";
import { t } from "../i18n";
import type { MutePreview } from "../types";
import { Button, Checkbox, customDialog, Modal, Notice, useArmed } from "./ui";

/** What the Mute dialog resolves with; Cancel / Esc / backdrop resolve null. */
export interface MuteAnswer {
  /** Also archive (or, with no Archive folder, mark read) what is in the Inbox
   *  now: one step with Undo. */
  archiveExisting: boolean;
}

/** One row of the box: the checkbox, what it does, and a line of how. */
function Row({ title, sub, ...box }: {
  title: ReactNode; sub: ReactNode;
  checked: boolean; disabled?: boolean; onChange?: () => void;
}) {
  return (
    <div className="px-3 py-2">
      <Checkbox {...box} onChange={box.onChange ?? (() => {})}
        className="items-start"
        label={<span className="block">
          <span className="block type-body font-medium text-body">{title}</span>
          <span className="block type-meta text-muted">{sub}</span>
        </span>} />
    </div>
  );
}

/** "Mute this conversation": what the rule will do, and the one extra step
 *  (also archive what is there). Nothing is trashed; the box says what is
 *  never touched. */
export function MuteDialog({ preview, onResult }: {
  preview: MutePreview;
  onResult: (answer: MuteAnswer | null) => void;
}) {
  const [existing, setExisting] = useState(false);
  const armed = useArmed();
  const ok = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // not a danger dialog: the primary button has focus (nothing is trashed)
  useLayoutEffect(() => { ok.current?.focus(); }, []);
  const archive = preview.archive;
  // what is left alone now: only the parts that are not zero
  const left = [
    preview.pinned > 0 && t("mute.left_pinned", { n: preview.pinned }),
    preview.protected > 0
      && t("mute.left_protected", { n: preview.protected }),
  ].filter(Boolean).join(", ");
  return (
    <Modal size="sm" labelledBy={titleId} describedBy={bodyId}
      onClose={() => onResult(null)}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div>
          <div id={titleId} className="type-heading">
            {t("mute.title", { label: preview.label })}</div>
          <div className="type-meta text-muted">
            {t("mute.sub", { mails: t("n.mails", { n: preview.mails }),
              people: t("mute.people", { n: preview.people }) })}</div>
        </div>
        <div id={bodyId} className="space-y-3">
          <div className="divide-y divide-line rounded-card border
            border-line bg-panel2">
            <Row checked disabled
              title={t(archive ? "mute.on" : "mute.on_read")}
              sub={t(archive ? "mute.on_sub" : "mute.on_read_sub")} />
            {preview.now > 0 && (
              <Row checked={existing} onChange={() => setExisting(!existing)}
                title={t(archive ? "mute.existing" : "mute.existing_read",
                  { n: preview.now })}
                sub={t(archive ? "mute.existing_sub"
                  : "mute.existing_read_sub")} />
            )}
          </div>
          <Notice icon={<Info size={16} />}>
            <div>{t("mute.note")}</div>
            {left && <div className="mt-1">{t("mute.left", { list: left })}</div>}
          </Notice>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line
        px-4 py-3 sm:px-5">
        <Button variant="secondary"
          onClick={() => onResult(null)}>{t("Cancel")}</Button>
        <Button ref={ok}
          onClick={(e) => {
            if (!armed(e.detail === 0)) return;
            onResult({ archiveExisting: existing && preview.now > 0 });
          }}>
          <BellOff size={16} aria-hidden
            className="mr-1.5 inline align-text-bottom" />
          {t("mute.btn")}
        </Button>
      </div>
    </Modal>
  );
}

/** Opens the dialog for `preview`; resolves the answer, or null on cancel. */
export const askMute = (preview: MutePreview): Promise<MuteAnswer | null> =>
  customDialog<MuteAnswer>((done) => (
    <MuteDialog preview={preview} onResult={done} />));
