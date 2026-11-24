/* The multi-account confirm: ONE dialog for an action that touches the same
 * thing in several accounts. It lists every account with its own checkbox,
 * what happens there and how many mails it covers, then runs one step per
 * ticked account - the ordinary per-account calls, each with its own Undo and
 * Activity entry - and lists what became of each.
 *
 * Generic on purpose (the lists across accounts use it for their selection
 * actions too): the dialog knows the lines, an optional extra checkbox (the
 * optional Trash step), the wording and a `run` function; what a step does is
 * the caller's. Nothing runs for an unticked account, and a step that fails
 * does not stop the others (`runPerAccount`). */

import { Check, ExternalLink, Info, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import type { StepOutcome } from "../allAccounts";
import { Avatar, Button, Checkbox, DIALOG_ARM_MS, Loading, Modal,
  Tag } from "./ui";

/** One account's line in the confirm. `blocked` = why it cannot be ticked
 *  (no unsubscribe link there, already done): it stays listed, unticked. */
export interface ConfirmLine {
  account: string;
  /** Under the name: what happens there ("deals@… · one-click"). */
  sub: string;
  /** Right side: how much it covers ("210 mails"). */
  count: string;
  blocked?: string;
  /** Mails the optional extra step would move in this account. */
  extraCount?: number;
}

export interface AcrossAccountsConfirmProps {
  title: string;
  lines: ConfirmLine[];
  /** The gray note under the list. */
  note: string;
  /** The optional extra step ("Also move the N mails to Trash"), unticked by
   *  default; `n` is how many mails the TICKED accounts would move. Its
   *  confirm is the danger kind while it is ticked. */
  extra?: { label: (n: number) => string; note: string };
  /** The confirm button's text for this many accounts (and extra mails). */
  confirmLabel: (accounts: number, extraMails: number | null) => string;
  /** Run the steps for the ticked accounts. `progress` reports the account
   *  being worked on. Null = nothing ran (a check the user declined): the
   *  dialog stays as it is. */
  run: (accounts: string[], extra: boolean,
    progress: (account: string, done: number, total: number) => void)
    => Promise<StepOutcome[] | null>;
  /** The title of the result ("2 done · 1 needs you"). */
  resultTitle: (outcomes: StepOutcome[]) => string;
  /** Under one result row: buttons / notes the caller adds (Open page,
   *  Open Activity ...). */
  outcomeExtra?: (o: StepOutcome) => ReactNode;
  /** A problem to show above the list (a preview that failed). */
  problem?: string;
  loading?: boolean;
  onFinished?: (outcomes: StepOutcome[]) => void;
  onClose: () => void;
}

type Phase = "review" | "running" | "result";

const TONE = { done: "safe", link: "review", failed: "keep",
  skipped: "neutral" } as const;

export function AcrossAccountsConfirm({ title, lines, note, extra, confirmLabel,
  run, resultTitle, outcomeExtra, problem, loading, onFinished, onClose }:
  AcrossAccountsConfirmProps) {
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(lines.filter((l) => !l.blocked).map((l) => l.account)));
  const [alsoExtra, setAlsoExtra] = useState(false);
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
  // The lines arrive after the previews: tick what can be ticked, once.
  const seeded = useRef(lines.length > 0);
  useEffect(() => {
    if (seeded.current || !lines.length) return;
    seeded.current = true;
    setTicked(new Set(lines.filter((l) => !l.blocked).map((l) => l.account)));
    armedAt.current = Date.now();
  }, [lines]);

  const chosen = lines.filter((l) => ticked.has(l.account) && !l.blocked);
  const extraMails = chosen.reduce((n, l) => n + (l.extraCount ?? 0), 0);
  const showExtra = !!extra && lines.some((l) => (l.extraCount ?? 0) > 0);
  const trashing = showExtra && alsoExtra && extraMails > 0;

  const start = async () => {
    if (!chosen.length) return;
    setPhase("running");
    const names = chosen.map((l) => l.account);
    const done = await run(names, trashing, (account, d, total) => {
      if (alive.current) setAt({ account, done: d, total });
    });
    if (!alive.current) return;
    if (!done) { setPhase("review"); armedAt.current = Date.now(); return; }
    setOutcomes(done);
    setPhase("result");
    onFinished?.(done);
  };

  const result = phase === "result";
  return (
    <Modal size="sm" labelledBy={titleId} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <h2 id={titleId} className="type-heading">
          {result ? resultTitle(outcomes) : title}
        </h2>

        {problem && (
          <p role="alert" className="type-body text-danger-fg">{problem}</p>
        )}
        {loading && <Loading label={t("loading…")} />}

        {!result && !loading && (
          <ul className="divide-y divide-line overflow-hidden rounded-card
            border border-line">
            {lines.map((l) => (
              <li key={l.account}>
                <Checkbox className="w-full gap-3 px-3 py-2.5"
                  aria-label={t("allc.account", { account: l.account })}
                  disabled={!!l.blocked || phase === "running"}
                  checked={ticked.has(l.account) && !l.blocked}
                  onChange={(e) => {
                    const next = new Set(ticked);
                    if (e.target.checked) next.add(l.account);
                    else next.delete(l.account);
                    setTicked(next);
                  }}
                  label={
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={l.account} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate type-body
                          font-medium">{l.account}</span>
                        <span className="block break-words type-meta
                          text-muted">{l.blocked ?? l.sub}</span>
                      </span>
                      <span className="shrink-0 type-meta tabular-nums
                        text-muted">{l.count}</span>
                    </span>} />
              </li>
            ))}
          </ul>
        )}

        {!result && !loading && showExtra && (
          <Checkbox checked={alsoExtra} disabled={phase === "running"}
            onChange={(e) => setAlsoExtra(e.target.checked)}
            label={extra!.label(extraMails)} />
        )}
        {!result && !loading && trashing && (
          <p className="type-meta text-muted">{extra!.note}</p>
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
          <Button variant={trashing ? "danger" : "primary"}
            disabled={loading || phase === "running" || !chosen.length}
            onClick={(e) => {
              // A double tap must not confirm unseen (see ConfirmDialog).
              if (e.detail === 0
                  || Date.now() - armedAt.current >= DIALOG_ARM_MS) void start();
            }}>
            {confirmLabel(chosen.length, trashing ? extraMails : null)}
          </Button>
        </>)}
      </div>
    </Modal>
  );
}
