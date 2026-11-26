import { Info, Scissors } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtSize } from "../api";
import { t } from "../i18n";
import type { RemoveCheck, RemoveFile } from "../types";
import { KIND } from "./attKinds";
import { Button, Checkbox, Modal, Notice, Spinner, useArmed }
  from "./ui";

/** What the confirm resolves with: the positions (in the asked files) still
 *  ticked and whether the .zip was asked for. */
export interface RemoveAnswer { ticked: number[]; zip: boolean }

/** "5 files" / "3 mails": the two counts the title and the toast name. */
export const nFiles = (n: number) => t("rmf.n_files", { n });
export const nMails = (n: number) => t("rmf.n_mails", { n });

/** The sender line of a file: the first sender, "+N" for others. */
const whoOf = (mails: RemoveFile["mails"]): string => {
  const senders = [...new Set(mails.map((m) => m.addr))];
  return senders[0] + (senders.length > 1 ? ` +${senders.length - 1}` : "");
};

/** The confirm of "Keep the mails, remove the files": the files to take out,
 *  each ticked (the ones in mails Keep-safe covers start unticked, with the
 *  reason), the optional .zip first, what stays, and the verb + count button
 *  in the danger tone like every destructive confirm. `run` does the work
 *  (the download, the job): the dialog shows it working and keeps itself
 *  open with the error when it fails. */
export function RemoveFilesConfirm({ files, check, run, onResult }: {
  files: RemoveFile[]; check: RemoveCheck;
  run: (answer: RemoveAnswer) => Promise<void>;
  onResult: (answer: RemoveAnswer | null) => void;
}) {
  const zipFits = check.zip.bytes <= check.zip.cap;
  const [ticked, setTicked] = useState<Set<number>>(() => new Set(
    check.files.map((f, i) => (f.mails > 0 && f.safe === 0 ? i : -1))
      .filter((i) => i >= 0)));
  const [zip, setZip] = useState(zipFits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const armed = useArmed();
  const safe = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // Danger dialogs focus Cancel, the safe choice (as ConfirmDialog does).
  useLayoutEffect(() => { safe.current?.focus(); }, []);

  const flip = (i: number) => setTicked((s) => {
    const next = new Set(s);
    if (!next.delete(i)) next.add(i);
    return next;
  });
  const chosen = useMemo(() => check.mails.filter(
    (m) => !m.skip && m.files.some((i) => ticked.has(i))), [check, ticked]);
  const freed = chosen.reduce((n, m) => n + m.files.filter((i) => ticked.has(i))
    .reduce((s, i) => s + check.files[i].size, 0), 0);
  const zipBytes = [...ticked].reduce((n, i) => n + check.files[i].size, 0);
  // the mails that stay as they are, by reason (only those holding a file
  // that is ticked)
  const left = useMemo(() => {
    const by = new Map<string, number>();
    for (const m of check.mails)
      if (m.skip && m.files.some((i) => ticked.has(i)))
        by.set(m.skip, (by.get(m.skip) ?? 0) + 1);
    return [...by];
  }, [check, ticked]);
  const go = async () => {
    const answer = { ticked: [...ticked].sort((a, b) => a - b),
      zip: zip && zipFits };
    setBusy(true);
    setError("");
    try {
      await run(answer);
      onResult(answer);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };
  return (
    <Modal size="sm" labelledBy={titleId} describedBy={bodyId}
      onClose={() => { if (!busy) onResult(null); }}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div>
          <div id={titleId} className="type-heading">
            {t("rmf.title", { files: nFiles(ticked.size),
              mails: nMails(chosen.length) })}
          </div>
          <div className="type-meta text-muted">
            {t("rmf.sub", { size: fmtSize(freed) })}
          </div>
        </div>
        <div id={bodyId} className="flex flex-col gap-3 type-body text-muted">
          <ul className="divide-y divide-line rounded-card border border-line
            bg-panel">
            {files.map((f, i) => {
              const c = check.files[i];
              const k = KIND[f.kind];
              const off = c.mails === 0;
              return (
                <li key={`${f.name}\0${f.size}`}
                  className="flex items-start gap-3 px-3 py-2">
                  <span className="mt-1.5">
                    <Checkbox checked={ticked.has(i)} disabled={off || busy}
                      aria-label={t("atts.select_file", { name: f.name })}
                      onChange={() => flip(i)} />
                  </span>
                  <span aria-hidden className={`grid size-9 shrink-0
                    place-items-center rounded-control ${k.tile}`}>{k.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate type-body font-medium
                      text-body">{f.name}</span>
                    <span className="block type-meta text-muted">
                      {t("rmf.file_sub", { size: fmtSize(f.size),
                        n: c.mails || f.mails.length, who: whoOf(f.mails) })}
                    </span>
                    {c.safe > 0 && (
                      <span className="block type-meta text-review-fg">
                        {t("rmf.safe", { n: c.safe, what: c.classes.map(
                          (id) => t(`keepsafe.class.${id}`)).join(", ") })}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <Checkbox checked={zip && zipFits && ticked.size > 0}
            disabled={!zipFits || busy || ticked.size === 0}
            className="type-body text-body"
            label={zipFits ? t("rmf.zip", { size: fmtSize(zipBytes) })
              : t("rmf.zip_big", { size: fmtSize(check.zip.cap) })}
            onChange={() => setZip(!zip)} />
          <p className="type-meta text-muted">{t("rmf.safe_note")}</p>
          {left.map(([why, n]) => (
            <p key={why} className="type-meta text-muted">
              {t("rmf.skipped", { n, why: t(`rmf.why.${why}`) })}
            </p>
          ))}
          <Notice icon={<Info size={16} aria-hidden />}>
            {t("rmf.explain")}
          </Notice>
          {error && <Notice tone="danger" role="alert">{error}</Notice>}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line
        px-4 py-3 max-sm:flex-col-reverse max-sm:items-stretch sm:px-5">
        <Button ref={safe} variant="secondary" className="max-sm:min-h-11"
          disabled={busy} onClick={() => onResult(null)}>{t("Cancel")}</Button>
        <Button variant="danger" className="inline-flex items-center
          justify-center gap-1.5 max-sm:min-h-11"
          disabled={busy || chosen.length === 0}
          onClick={(e) => { if (armed(e.detail === 0)) void go(); }}>
          {busy ? <Spinner /> : <Scissors size={16} aria-hidden />}
          {busy ? t("rmf.working") : t("rmf.go", { n: ticked.size })}
        </Button>
      </div>
    </Modal>
  );
}

/** "Some of these mails are protected": the action stops and names them
 *  (pinned mails, protected senders) - untick or unpin first. */
export function RemoveBlocked({ check, onClose }: {
  check: RemoveCheck; onClose: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const ok = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { ok.current?.focus(); }, []);
  return (
    <Modal size="sm" labelledBy={titleId} describedBy={bodyId}
      onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div id={titleId} className="type-heading">{t("rmf.blocked_title")}</div>
        <div id={bodyId} className="space-y-3 type-body text-muted">
          <p>{t("rmf.blocked_body")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {check.blocked.map((b) => (
              <li key={`${b.folder}\0${b.uid}`} className="break-words">
                {t("rmf.blocked_item", {
                  subject: b.subject || t("(no subject)"), who: b.addr,
                  why: t(`rmf.blocked_why.${b.why}`) })}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex justify-end border-t border-line px-4 py-3 sm:px-5">
        <Button ref={ok} variant="primary" className="max-sm:min-h-11
          max-sm:w-full" onClick={onClose}>{t("rmf.close")}</Button>
      </div>
    </Modal>
  );
}
