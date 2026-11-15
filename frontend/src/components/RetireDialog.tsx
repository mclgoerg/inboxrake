import { useId, useRef, useState } from "react";
import { api } from "../api";
import { junkCount } from "../addresses";
import { t } from "../i18n";
import type { AddressRetired, AddressRow } from "../types";
import { CopyButton } from "./AssistantsSettings";
import { Button, Checkbox, DIALOG_ARM_MS, Modal, Notice } from "./ui";

/** "Retire this alias": what it does (switch off at the alias service, mail
 *  already here stays), the two optional extras, then - once done - what was
 *  made (the new alias, with Copy) and what was moved. Nothing happens until
 *  the danger button; a double tap on a phone is ignored for a moment (like
 *  every confirm). */
export function RetireDialog({ row, onClose, onDone }: {
  row: AddressRow; onClose: () => void; onDone: () => void;
}) {
  const titleId = useId();
  const name = row.given_to?.name ?? "";
  const moveN = junkCount(row);
  const [makeNew, setMakeNew] = useState(true);
  const [toJunk, setToJunk] = useState(moveN > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AddressRetired | null>(null);
  const opened = useRef(Date.now());

  const go = async (e: React.MouseEvent) => {
    if (e.detail !== 0 && Date.now() - opened.current < DIALOG_ARM_MS) return;
    setBusy(true);
    setError("");
    try {
      setResult(await api.retireAddress(row.address, makeNew,
        toJunk && moveN > 0));
      onDone();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
    setBusy(false);
  };

  if (result) {
    return (
      <Modal size="sm" labelledBy={titleId} onClose={onClose}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          <div id={titleId} className="type-heading">
            {t("addr.retired_title", { address: row.address })}
          </div>
          <p className="type-body text-muted">{t("addr.retired_body")}</p>
          {result.new_alias && (
            <div className="rounded-card border border-line p-3">
              <div className="type-meta text-muted">
                {t("addr.new_alias", { name })}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="min-w-0 flex-1 break-all font-mono
                  type-body">{result.new_alias}</span>
                <CopyButton labelled text={result.new_alias}
                  name={t("Copy")} />
              </div>
              <div className="mt-1 type-meta text-muted">
                {t("addr.new_alias_hint", { name })}
              </div>
            </div>
          )}
          {result.new_alias_error && (
            <Notice tone="warn">{t("addr.new_alias_failed")}</Notice>
          )}
          {result.junk && (
            <p className="type-body text-muted">
              {t("addr.junk_done", { n: result.junk.queued })}
              {result.junk.skipped_protected + result.junk.skipped_pinned > 0
                && <> {t("addr.junk_skipped", {
                  n: result.junk.skipped_protected
                    + result.junk.skipped_pinned })}</>}
            </p>
          )}
          {result.junk_error && (
            <Notice tone="warn">{t("addr.junk_failed")}</Notice>
          )}
        </div>
        <div className="flex justify-end border-t border-line px-4 py-3
          sm:px-5">
          <Button autoFocus onClick={onClose}>{t("menu.done")}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal size="sm" labelledBy={titleId} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div id={titleId} className="type-heading">
          {t("addr.retire_title", { address: row.address })}
        </div>
        <ul className="list-disc space-y-1 pl-5 type-body text-muted">
          <li>{t("addr.retire_b1", { name })}</li>
          <li>{t("addr.retire_b2")}</li>
        </ul>
        <div className="space-y-1 rounded-card border border-line px-3 py-2">
          <Checkbox checked={makeNew} disabled={busy}
            onChange={(e) => setMakeNew(e.target.checked)}
            label={<>
              <span className="block">{t("addr.retire_new", { name })}</span>
              <span className="block type-meta text-muted">
                {t("addr.retire_new_sub")}
              </span>
            </>} />
          {moveN > 0 && (
            <Checkbox checked={toJunk} disabled={busy}
              onChange={(e) => setToJunk(e.target.checked)}
              label={t("addr.retire_junk", { n: moveN })} />
          )}
        </div>
        {error && (
          <div role="alert" className="type-meta text-danger-fg">{error}</div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line
        px-4 py-3 sm:px-5">
        <Button variant="secondary" autoFocus disabled={busy}
          onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="danger" disabled={busy} onClick={go}>
          {t("addr.retire_btn")}
        </Button>
      </div>
    </Modal>
  );
}
