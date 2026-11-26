/* "Review…" of one pair in "Same mails in several accounts": the exact copies
 * (same Message-ID and size) two accounts hold, and which of them keeps them.
 *
 *  - keep them in B, trash the copies in A (or the other way round): ONE step
 *    in the account that gives them up - the ordinary move to Trash, its own
 *    Undo and Activity entry - worked out AGAIN on the server from both
 *    accounts as they are now (what this dialog shows is not trusted); the
 *    account that keeps them is never touched. Pinned mails and mails of
 *    protected senders are taken out of the count before it runs;
 *  - just show them: All mail, filtered to those mails, in the account.
 *
 * The numbers are read again when the dialog opens. Esc is ignored while the
 * step runs. */

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import { fmtSize } from "../lib";
import type { CopiesPair } from "../types";
import type { Follow } from "../useAcrossRuns";
import { Button, DIALOG_ARM_MS, Loading, Modal, RadioRow } from "./ui";

type Choice = "drop_a" | "drop_b" | "show";

export function CopiesReview({ pair, exists, onFollow, onClaim, onShow,
  onChanged, onClose }: {
  pair: CopiesPair;
  /** Is this account still in the workspace? Asked right before the step. */
  exists: (account: string) => boolean;
  /** The move was queued: the app follows the job for ONE toast with Undo. */
  onFollow: (follow: Follow) => void;
  /** Quiet / restore the selected account's own "moved" toast around it. */
  onClaim: (accounts: string[], on: boolean) => void;
  /** "Just show them": All mail in `account`, filtered to its copies of what
   *  `other` holds. */
  onShow: (account: string, other: string) => void;
  /** Something changed: the page reads the copies again. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const { a, b } = pair;
  // undefined = not read yet, null = read, nothing left between these two
  const [fresh, setFresh] = useState<CopiesPair | null | undefined>();
  const [choice, setChoice] = useState<Choice>("drop_a");
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState("");
  const titleId = useId();
  const armedAt = useRef(Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Read again what the page showed (a pin, a protection or a copy made
  // since is honoured by the counts here and by the step itself).
  useEffect(() => {
    let live = true;
    api.accountsCopies()
      .then((r) => {
        if (!live) return;
        setFresh(r.pairs.find((p) => p.a === a && p.b === b) ?? null);
        armedAt.current = Date.now();
      })
      .catch((e: any) => {
        if (!live) return;
        setProblem(t("allc.read_failed",
          { msg: errorText(e?.message ?? String(e)) }));
        setFresh(null);
      });
    return () => { live = false; };
  }, [a, b]);

  const p = fresh ?? undefined;
  const dropped = (c: Choice) => c === "drop_a" ? a : c === "drop_b" ? b : "";
  const side = (c: Choice) => p ? (c === "drop_a" ? p.in_a : p.in_b) : null;
  const nTrash = choice === "show" ? 0 : side(choice)?.trash ?? 0;
  const held = choice === "show" ? 0 : side(choice)?.held ?? 0;

  const go = async () => {
    if (choice === "show") {
      onClose();
      onShow(a, b);
      return;
    }
    const drop = dropped(choice);
    const keep = drop === a ? b : a;
    if (!exists(keep) || !exists(drop)) {
      setProblem(t("allc.out_gone"));
      return;
    }
    setRunning(true);
    setProblem("");
    onClaim([drop], true);
    try {
      const r = await api.trashCopies(keep, drop);
      if (r.job) onFollow({ kind: "trash", steps: [{ account: drop, job: r.job }] });
      else onClaim([drop], false);
      onChanged();
      if (alive.current) onClose();
    } catch (e: any) {
      onClaim([drop], false);
      if (alive.current) {
        setRunning(false);
        setProblem(errorText(e?.message ?? String(e)));
      }
      onChanged();
    }
  };

  const close = () => { if (!running) onClose(); };
  const loading = fresh === undefined;
  return (
    <Modal size="sm" labelledBy={titleId} onClose={close}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div>
          <h2 id={titleId} className="type-heading">
            {t("allp.copies_title", { n: p?.mails ?? pair.mails, a, b })}
          </h2>
          <p className="type-meta text-muted">
            {t("allp.copies_sub", { a, b })}
          </p>
        </div>
        {problem && (
          <p role="alert" className="type-body text-danger-fg">{problem}</p>
        )}
        {loading && <Loading />}
        {!loading && !p && !problem && (
          <p className="type-body text-muted">{t("allp.copies_none")}</p>
        )}
        {p && (<>
          <div role="radiogroup" aria-label={t("allp.copies_choice")}
            className="divide-y divide-line overflow-hidden rounded-card
              border border-line">
            <RadioRow checked={choice === "drop_a"} disabled={running}
              onSelect={() => setChoice("drop_a")}
              label={t("allp.copies_keep_in", { keep: b, drop: a })}
              sub={t("allp.copies_frees", { account: a,
                size: fmtSize(p.in_a.size), other: b })} />
            <RadioRow checked={choice === "drop_b"} disabled={running}
              onSelect={() => setChoice("drop_b")}
              label={t("allp.copies_keep_in", { keep: a, drop: b })}
              sub={t("allp.copies_frees_only", { account: b,
                size: fmtSize(p.in_b.size) })} />
            <RadioRow checked={choice === "show"} disabled={running}
              onSelect={() => setChoice("show")}
              label={t("allp.copies_show")}
              sub={t("allp.copies_show_sub")} />
          </div>
          <div className="flex items-start gap-2 rounded-card bg-panel2 px-3
            py-2 type-meta text-muted">
            <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {choice === "show" ? t("allp.copies_show_note", { a, b })
                : t(held > 0 ? "allp.copies_note" : "allp.copies_note_none",
                  { account: dropped(choice), n: p.mails, held })}
            </span>
          </div>
        </>)}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line
        px-4 py-3 sm:px-5">
        <Button variant="secondary" onClick={onClose} disabled={running}>
          {t("Cancel")}</Button>
        <Button variant={choice === "show" ? "primary" : "danger"}
          disabled={!p || running || (choice !== "show" && nTrash === 0)}
          onClick={(e) => {
            // A double tap must not confirm unseen (see ConfirmDialog).
            if (e.detail === 0
                || Date.now() - armedAt.current >= DIALOG_ARM_MS) void go();
          }}>
          {choice === "show" ? t("allp.copies_show_btn")
            : t("allp.copies_trash_btn", { n: nTrash,
              account: dropped(choice) })}
        </Button>
      </div>
    </Modal>
  );
}
