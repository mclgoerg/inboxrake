/* The multi-account confirm: ONE dialog for an action that touches the same
 * thing in several accounts. It lists every account with its own checkbox,
 * what happens there and how many mails it covers, then runs one step per
 * ticked account - the ordinary per-account calls, each with its own Undo and
 * Activity entry - and lists what became of each.
 *
 * Generic on purpose: the dialog knows the lines (each may carry an extra
 * block - the Keep-safe result), the wording and a `run` function; what a step
 * does is the caller's. Nothing runs for an unticked account, a line that is
 * `blocked` cannot be ticked, and a step that fails does not stop the others
 * (`runPerAccount`). While the steps run, Esc / the backdrop / Back do nothing
 * (Cancel is off, too): the run is never left half-seen. */

import { Check, ExternalLink, Info, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import type { StepOutcome } from "../allAccounts";
import { Avatar, Button, Checkbox, DIALOG_ARM_MS, Loading, Modal,
  Tag } from "./ui";

/** One account's line in the confirm. `blocked` = why it cannot be ticked
 *  (protected, nothing to move, done already): it stays listed, unticked. */
export interface ConfirmLine {
  account: string;
  /** Under the name: what happens there ("deals@… · one-click"). */
  sub: string;
  /** Right side: how much it covers ("210 mails · 5.1 MB"). */
  count: string;
  blocked?: string;
  /** The mails this account's step covers, as a number (the confirm button
   *  names the sum over the ticked accounts). */
  mails?: number;
  /** Mails of this line that stay anyway (Keep-safe): taken off the button's
   *  count, shown by `extra`. */
  keep?: number;
  /** Under the sub line: the Keep-safe result of this account. */
  extra?: ReactNode;
}

export interface AcrossAccountsConfirmProps {
  title: string;
  lines: ConfirmLine[];
  /** The gray note under the list. */
  note: string;
  /** The accessible name of an account's checkbox. */
  lineLabel: (account: string) => string;
  /** A destructive step (a move to Trash): the confirm is the danger kind. */
  danger?: boolean;
  /** The confirm button's text for this many ticked accounts; `mails` = the
   *  sum of the ticked lines' own `mails` minus what stays (`keep`). */
  confirmLabel: (accounts: number, mails: number) => string;
  /** Run the steps for the ticked accounts. `progress` reports the account
   *  being worked on. Null = nothing ran (a check failed or was declined): the
   *  dialog stays as it is. */
  run: (accounts: string[],
    progress: (account: string, done: number, total: number) => void)
    => Promise<StepOutcome[] | null>;
  /** The title of the result ("2 done · 1 needs you"). */
  resultTitle: (outcomes: StepOutcome[]) => string;
  /** Under one result row: buttons / notes the caller adds (Open page ...). */
  outcomeExtra?: (o: StepOutcome) => ReactNode;
  /** A problem to show above the list (a check that failed). */
  problem?: string;
  loading?: boolean;
  /** Called once the steps ran. True = every step went through and nothing
   *  needs a look: the dialog closes by itself (the caller's toast says the
   *  rest); false / absent = the result list stays until Done. */
  onFinished?: (outcomes: StepOutcome[]) => boolean | void;
  onClose: () => void;
}

type Phase = "review" | "running" | "result";

const TONE = { done: "safe", link: "review", failed: "keep",
  skipped: "neutral" } as const;

export function AcrossAccountsConfirm({ title, lines, note, danger,
  lineLabel, confirmLabel, run, resultTitle, outcomeExtra, problem, loading,
  onFinished, onClose }: AcrossAccountsConfirmProps) {
  // What the user took OUT: every line that can be ticked is ticked until
  // then (no "seed" step - the lines arrive after the fresh read, and an
  // unticked-by-default flash would be a tick that is not there yet).
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("review");
  const [at, setAt] = useState({ account: "", done: 0, total: 0 });
  const [outcomes, setOutcomes] = useState<StepOutcome[]>([]);
  const titleId = useId();
  const armedAt = useRef(Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // The confirm is armed from the moment its lines are on screen.
  useEffect(() => { armedAt.current = Date.now(); }, [loading]);

  const isOn = (l: ConfirmLine) => !l.blocked && !unticked.has(l.account);
  const chosen = lines.filter(isOn);
  const stepMails = chosen.reduce(
    (n, l) => n + Math.max(0, (l.mails ?? 0) - (l.keep ?? 0)), 0);

  const start = async () => {
    if (!chosen.length || phase !== "review") return;
    setPhase("running");
    const done = await run(chosen.map((l) => l.account), (account, d, total) => {
      if (alive.current) setAt({ account, done: d, total });
    });
    if (!alive.current) return;
    if (!done) { setPhase("review"); armedAt.current = Date.now(); return; }
    setOutcomes(done);
    if (onFinished?.(done) === true) { onClose(); return; }
    setPhase("result");
  };

  const result = phase === "result";
  // While the steps run, Esc / the backdrop / Back / a swipe do nothing (the
  // Cancel button is off, too): the run is not abandoned halfway - it ends in
  // the result list or the toast, where each account's outcome and Undo are.
  const close = () => { if (phase !== "running") onClose(); };
  return (
    <Modal size="sm" labelledBy={titleId} onClose={close}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <h2 id={titleId} className="type-heading">
          {result ? resultTitle(outcomes) : title}
        </h2>

        {problem && (
          <p role="alert" className="type-body text-danger-fg">{problem}</p>
        )}
        {loading && <Loading />}

        {!result && !loading && (
          <ul className="divide-y divide-line overflow-hidden rounded-card
            border border-line">
            {lines.map((l) => (
              <li key={l.account}>
                <Checkbox className="w-full items-start gap-3 px-3 py-2.5"
                  aria-label={lineLabel(l.account)}
                  disabled={!!l.blocked || phase === "running"}
                  checked={isOn(l)}
                  onChange={(e) => {
                    const next = new Set(unticked);
                    if (e.target.checked) next.delete(l.account);
                    else next.add(l.account);
                    setUnticked(next);
                  }}
                  label={
                    <span className="flex min-w-0 flex-wrap items-center
                      gap-x-3 gap-y-0.5">
                      <Avatar name={l.account} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate type-body
                          font-medium">{l.account}</span>
                        <span className="block break-words type-meta
                          text-muted">{l.blocked ?? l.sub}</span>
                      </span>
                      {/* on a phone the count sits on a line of its own, so
                          an address keeps the whole width */}
                      <span className="shrink-0 type-meta tabular-nums
                        text-muted max-sm:order-last max-sm:w-full
                        max-sm:pl-11">{l.count}</span>
                    </span>} />
                {l.extra && (
                  // under the checkbox row, not inside its <label>: a tap on
                  // "Show" must not flip the tick
                  <div className="px-3 pb-2.5 pl-14 type-meta">{l.extra}</div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!result && !loading && (
          <div className="flex items-start gap-2 rounded-card bg-panel2 px-3
            py-2 type-meta text-muted">
            <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span>{note}</span>
          </div>
        )}

        {phase === "running" && (
          <Loading label={t("allc.running", { account: at.account,
            done: at.done, total: at.total })} />
        )}

        {result && (
          <ul className="divide-y divide-line overflow-hidden rounded-card
            border border-line">
            {outcomes.map((o) => (
              <li key={o.account} className="flex items-start gap-3 px-3
                py-2.5">
                <Avatar name={o.account} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate type-body font-medium">
                      {o.account}</span>
                    <Tag tone={TONE[o.status]}>
                      <span className="inline-flex items-center gap-1">
                        {o.status === "done"
                          ? <Check size={14} aria-hidden />
                          : o.status === "link"
                            ? <ExternalLink size={14} aria-hidden />
                            : <TriangleAlert size={14} aria-hidden />}
                        {t(`allc.status_${o.status}`)}
                      </span>
                    </Tag>
                  </div>
                  <p className={`mt-0.5 type-meta ${o.status === "failed"
                    ? "text-danger-fg" : "text-muted"}`}>{o.text}</p>
                  {outcomeExtra?.(o)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-line
        px-4 py-3 sm:px-5">
        {result ? (
          <Button onClick={onClose}>{t("unsub.done_btn")}</Button>
        ) : (<>
          <Button variant="secondary" onClick={onClose}
            disabled={phase === "running"}>{t("Cancel")}</Button>
          <Button variant={danger ? "danger" : "primary"}
            disabled={loading || phase === "running" || !chosen.length}
            onClick={(e) => {
              // A double tap must not confirm unseen (see ConfirmDialog).
              if (e.detail === 0
                  || Date.now() - armedAt.current >= DIALOG_ARM_MS) void start();
            }}>
            {confirmLabel(chosen.length, stepMails)}
          </Button>
        </>)}
      </div>
    </Modal>
  );
}
