import { Info, ListChecks } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import type { FolderCheck, YourFolderRow } from "../types";
import { anyActive, ruleSentences, whyText } from "../yourFolders";
import { Button, Checkbox, Loading, Modal, Notice, RadioRow, SettingsGroup,
  useArmed } from "./ui";

/** What the merge dialog resolves with: the target, the live numbers the
 *  merge is bound to, the rules it named and whether to delete the emptied
 *  folder after. Cancel / Esc / backdrop resolve null. */
export interface MergeAnswer {
  target: string;
  check: FolderCheck;
  deleteAfter: boolean;
}

/** "Merge “X” into…": pick the folder, read what happens, then Move N mails.
 *  The count, the rules and the refusals are the server's, asked again for
 *  every folder picked (a look-alike is suggested, never chosen for you). */
export function FolderMerge({ row, targets, account, onResult }: {
  row: YourFolderRow;
  /** the folders it may go into (`mergeTargets`) */
  targets: YourFolderRow[];
  account: string;
  onResult: (answer: MergeAnswer | null) => void;
}) {
  const [chosen, setChosen] = useState<string>(
    targets.find((r) => r.raw === row.twin)?.raw ?? targets[0]?.raw ?? "");
  const [chk, setChk] = useState<FolderCheck | null>(null);
  const [error, setError] = useState("");
  const [del, setDel] = useState(false);
  const armed = useArmed();
  const safe = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useLayoutEffect(() => { safe.current?.focus(); }, []);

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    setChk(null);
    setError("");
    api.folderCheck({ op: "merge", folder: row.raw, target: chosen }, account)
      .then((c) => { if (live) setChk(c); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [chosen, row.raw, account]);

  const target = targets.find((r) => r.raw === chosen);
  const n = chk?.count ?? 0;
  const rules = chk?.rules ?? [];
  const canDelete = chk ? chk.can_delete ?? null : "children";
  const deleteNow = del && canDelete === null;
  const sub = (r: YourFolderRow) => {
    const base = r.mails !== null ? t("n.mails", { n: r.mails })
      : t("yf.chip.off");
    return r.raw === row.twin
      ? t("yf.merge_suggested", { mails: base }) : base;
  };
  const go = (e: { detail: number }) => {
    if (!chk || !chosen || n === 0 || !armed(e.detail === 0)) return;
    onResult({ target: chosen, check: chk, deleteAfter: deleteNow });
  };
  return (
    <Modal size="sm" labelledBy={titleId} onClose={() => onResult(null)}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div id={titleId} className="type-heading">
          {t("yf.merge_title", { name: row.name })}</div>
        <SettingsGroup header={t("yf.merge_pick")} radioGroup>
          <div className="max-h-72 divide-y divide-line overflow-y-auto">
            {targets.map((r) => (
              <RadioRow key={r.raw} label={r.name} sub={sub(r)}
                checked={r.raw === chosen}
                onSelect={() => { setChosen(r.raw); setDel(false); }} />
            ))}
          </div>
        </SettingsGroup>
        {error ? (
          <Notice tone="danger" role="alert">{error}</Notice>
        ) : !chk ? (
          <Loading />
        ) : (
          <>
            <Notice icon={<Info size={16} aria-hidden />}>
              {n === 0 ? t("yf.merge_none")
                : t("yf.merge_note", { n, target: target?.name ?? chosen,
                  name: row.name })}
            </Notice>
            {(chk.pinned ?? 0) + (chk.protected ?? 0) > 0 && n > 0 && (
              <Notice icon={<Info size={16} aria-hidden />}>
                {t("yf.merge_held", { p: chk.pinned ?? 0,
                  q: chk.protected ?? 0 })}
              </Notice>
            )}
            {rules.length > 0 && (
              <Notice tone="warn" icon={<ListChecks size={16} aria-hidden />}>
                <ul className="space-y-1">
                  {ruleSentences(rules, target?.name ?? chosen).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                {anyActive(rules) && (
                  <p className="mt-1">{t("yf.rules_tail")}</p>
                )}
              </Notice>
            )}
            <div>
              <Checkbox checked={deleteNow} disabled={canDelete !== null}
                label={t("yf.merge_delete", { name: row.name })}
                onChange={(e) => setDel(e.target.checked)} />
              {canDelete !== null && (
                <p className="ml-7 type-meta text-muted">
                  {whyText(canDelete)}</p>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line
        px-4 py-3 max-sm:flex-col-reverse max-sm:items-stretch sm:px-5">
        <Button ref={safe} variant="secondary" className="max-sm:min-h-11"
          onClick={() => onResult(null)}>{t("Cancel")}</Button>
        <Button variant="primary" className="max-sm:min-h-11"
          disabled={!chk || n === 0} onClick={go}>
          {t("yf.merge_btn", { n })}
        </Button>
      </div>
    </Modal>
  );
}
