/* The unsubscribe sheet: every way to unsubscribe (bulk bar, sender detail,
 * Triage, a failed run's Retry) opens this one sheet. It shows HOW each
 * sender is unsubscribed before anything is sent (one click / a mail from
 * the user's address / a page the user confirms), offers to also move their
 * mails to Trash, and then lists what happened per sender.
 *
 * Nothing here talks to a sender itself: the run is the existing one
 * (`api.unsubscribeBulk` / `api.unsubscribe`: protected + done senders
 * skipped, audit, Still-mailing tracking) and the optional Trash step is the
 * app's existing trash path (`onTrash`: protected / pinned guards, Undo).
 * The sheet is the confirm for both. */

import { Check, ExternalLink, Eye, Send, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import { fmtSize } from "../lib";
import { openUnsubPage } from "../unsub";
import type { Group, Grouping, UnsubPreview, UnsubRunItem, UnsubState,
  UnsubVia } from "../types";
import { Avatar, Button, DIALOG_ARM_MS, Loading, Modal, SettingsGroup,
  SettingsRow, Switch, Tag, useToast } from "./ui";

/** What opens the sheet. `run` = a bulk run somebody else already started
 *  (Triage's single confirm): the sheet only follows it and lists the
 *  outcome. */
export type UnsubRequest =
  | { kind: "bulk"; grouping: Grouping; keys: string[];
      /** Pooled rows left out of the selection before it got here. */
      pooled?: number }
  | { kind: "single"; grouping: Grouping; key: string }
  | { kind: "run"; run: number };

let opener: ((r: UnsubRequest) => void) | null = null;

/** Open the sheet from anywhere (a mail reader's unsubscribe card, ...)
 *  without threading a callback down: the app registers itself with
 *  `useUnsubscribeOpener`. False when no app has mounted the sheet. */
export const openUnsubscribeSheet = (request: UnsubRequest): boolean => {
  if (!opener) return false;
  opener(request);
  return true;
};

/** The app root hands over the function that shows the sheet. */
export function useUnsubscribeOpener(open: (r: UnsubRequest) => void): void {
  useEffect(() => {
    opener = open;
    return () => { if (opener === open) opener = null; };
  }, [open]);
}

type Phase = "loading" | "review" | "running" | "result";

/** One sender's outcome row. `reason` is user-language text (failed only). */
interface Outcome {
  addr: string;
  status: "done" | "link" | "failed";
  via: UnsubVia;
  link: string;
  reason: string;
  /** The user confirmed it by hand ("Mark as done"). */
  marked?: boolean;
}

const METHOD = {
  one_click: { tone: "safe" as const, icon: Zap, label: "unsub.via_one_click",
    note: "unsub.via_one_click_note" },
  mailto: { tone: "info" as const, icon: Send, label: "unsub.via_mailto",
    note: "unsub.via_mailto_note" },
  http: { tone: "review" as const, icon: ExternalLink, label: "unsub.via_http",
    note: "unsub.via_http_note" },
};

/** The chip of a sender BEFORE the run: how it will be unsubscribed. */
function MethodChip({ via }: { via: UnsubVia }) {
  if (!via) {
    return (
      <>
        <Tag>{t("unsub.via_none")}</Tag>
        <span className="type-meta text-muted">{t("unsub.via_none_note")}</span>
      </>
    );
  }
  const m = METHOD[via];
  const Icon = m.icon;
  return (
    <>
      <Tag tone={m.tone}>
        <span className="inline-flex items-center gap-1">
          <Icon size={14} aria-hidden />{t(m.label)}
        </span>
      </Tag>
      <span className="type-meta text-muted">{t(m.note)}</span>
    </>
  );
}

/** The chip of a sender AFTER the run: what happened. */
function OutcomeChip({ o }: { o: Outcome }) {
  if (o.status === "failed") return <Tag tone="keep">{t("unsub.out_failed")}</Tag>;
  if (o.status === "link") {
    return (
      <Tag tone="review">
        <span className="inline-flex items-center gap-1">
          <ExternalLink size={14} aria-hidden />{t("unsub.out_page")}
        </span>
      </Tag>
    );
  }
  return (
    <Tag tone="safe">
      <span className="inline-flex items-center gap-1">
        <Check size={14} aria-hidden />
        {o.marked ? t("unsub.out_marked")
          : o.via === "mailto" ? t("unsub.out_mail") : t("unsub.out_done")}
      </span>
    </Tag>
  );
}

const fromRunItem = (i: UnsubRunItem): Outcome => ({
  addr: i.addr, status: i.status, via: i.via, link: i.link,
  reason: i.status === "failed" ? errorText(i.error) : "" });

/** "2 done · 1 needs you" - only the parts that are not zero. */
export function outcomeTitle(items: { status: Outcome["status"] }[]): string {
  const n = (s: Outcome["status"]) => items.filter((i) => i.status === s).length;
  const parts = [
    n("done") ? t("unsub.res_done", { n: n("done") }) : "",
    n("link") ? t("unsub.res_need", { n: n("link") }) : "",
    n("failed") ? t("unsub.res_failed", { n: n("failed") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("unsub.res_none");
}

export function UnsubscribeSheet({ request, groups, unsub, demo, onTrash,
  onChanged, onRun, onClose }: {
  request: UnsubRequest;
  /** Sender groups (names for a run the sheet did not start itself). */
  groups: Record<string, Group>;
  /** The live unsubscribe job state: how the sheet learns ITS run ended. */
  unsub: UnsubState | undefined;
  demo: boolean;
  /** The app's trash path for these group keys of `grouping` (confirmed by
   *  this sheet). Resolves whether the move was queued. */
  onTrash: (grouping: Grouping, keys: string[]) => Promise<boolean>;
  /** The persisted unsubscribe state changed (refresh the lists). */
  onChanged: () => void;
  /** The id of the bulk run this sheet follows (the app then leaves the
   *  result to the sheet instead of a toast); null when it lets go. */
  onRun: (run: number | null) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>(
    request.kind === "run" ? "running" : "loading");
  const [preview, setPreview] = useState<UnsubPreview | null>(null);
  const [problem, setProblem] = useState("");
  const [alsoTrash, setAlsoTrash] = useState(false);
  const [run, setRun] = useState<number | null>(
    request.kind === "run" ? request.run : null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [trashNote, setTrashNote] = useState("");
  const [note, setNote] = useState("");
  const [busyAddr, setBusyAddr] = useState("");
  // Phone: the sheet's button lands under the finger that opened it.
  const armedAt = useRef(0);
  const finished = useRef(false);
  const live = useRef({ alsoTrash, preview, phase });
  live.current = { alsoTrash, preview, phase };

  // Hand the run to / take it back from the app: while the sheet shows a run
  // the app does not toast its end.
  useEffect(() => {
    onRun(run);
    return () => onRun(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    if (request.kind === "run") return;
    let cancelled = false;
    (async () => {
      try {
        const p = request.kind === "bulk"
          ? await api.unsubscribePreview(request.grouping, request.keys)
          : await api.unsubscribePreview(request.grouping, [request.key], true);
        if (cancelled) return;
        setPreview(p);
        armedAt.current = Date.now();
        setPhase("review");
      } catch (e: any) {
        if (cancelled) return;
        setProblem(t("unsub.load_failed", { msg: e.message ?? String(e) }));
        setPhase("review");
      }
    })();
    return () => { cancelled = true; };
    // The request is fixed for the life of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (addr: string): string =>
    preview?.senders.find((s) => s.addr === addr)?.name
      || groups[addr]?.label || addr;

  // Optional second step, after the unsubscribe: the groups made up only of
  // these senders, minus any sender whose unsubscribe failed or never ran.
  const trashAfter = async (done: Outcome[]) => {
    const { alsoTrash: want, preview: p } = live.current;
    if (!want || !p || request.kind === "run") return;
    const ok = new Set(done.filter((o) => o.status !== "failed")
      .map((o) => o.addr));
    const groupsToTrash = p.trash.groups.filter(
      (g) => g.addrs.every((a) => ok.has(a)));
    if (!groupsToTrash.length) return;
    const n = groupsToTrash.reduce((a, g) => a + g.mails, 0);
    const queued = await onTrash(request.grouping,
      groupsToTrash.map((g) => g.key));
    setTrashNote(queued ? t("unsub.trashed", { n }) : t("unsub.trash_failed"));
  };

  const finish = async (done: Outcome[]) => {
    if (finished.current) return;
    finished.current = true;
    setOutcomes(done);
    setPhase("result");
    onChanged();
    await trashAfter(done);
  };

  // A bulk run's end: its id shows up on a state that is no longer running.
  useEffect(() => {
    if (phase !== "running" || run == null || unsub?.seq !== run
        || unsub.status === "running" || finished.current) return;
    (async () => {
      try {
        const r = await api.unsubscribeResults();
        if (r.run !== run) throw new Error(t("unsub.results_gone"));
        if (unsub.status === "error") setProblem(errorText(unsub.error));
        await finish(r.items.map(fromRunItem));
      } catch (e: any) {
        setProblem(e.message ?? String(e));
        await finish([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run, unsub?.seq, unsub?.status]);

  const start = async () => {
    if (request.kind === "run" || !preview) return;
    setProblem("");
    setPhase("running");
    if (request.kind === "single") {
      const addr = preview.senders[0]?.addr ?? "";
      let o: Outcome;
      try {
        const r = await api.unsubscribe(request.grouping, request.key);
        o = { addr: r.addr, status: r.action, via: r.via ?? null,
          link: r.action === "link" ? r.detail : "", reason: "" };
      } catch (e: any) {
        o = { addr, status: "failed", via: preview.senders[0]?.via ?? null,
          link: "", reason: e.message ?? String(e) };
      }
      await finish([o]);
      return;
    }
    try {
      const r = await api.unsubscribeBulk(request.grouping, request.keys);
      if (!r.queued || r.run == null) {
        // Everything got handled since the preview (another tab, a rule).
        await finish([]);
        return;
      }
      setRun(r.run);
      onChanged();       // fetch the run's state now, not on the next tick
    } catch (e: any) {
      setProblem(e.message ?? String(e));
      armedAt.current = Date.now();
      setPhase("review");
    }
  };

  const close = () => {
    if (live.current.phase === "running" && live.current.alsoTrash
        && request.kind !== "run") {
      toast.show(t("unsub.trash_skipped"));
    }
    onClose();
  };

  const open = (o: Outcome) => setNote(openUnsubPage(o.link, demo));
  const markDone = async (o: Outcome) => {
    setBusyAddr(o.addr);
    try {
      await api.unsubscribeAck(o.addr);
      setOutcomes((cur) => cur.map((x) => x.addr === o.addr
        ? { ...x, status: "done", marked: true, reason: "" } : x));
      onChanged();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? String(e) }));
    }
    setBusyAddr("");
  };

  const senders = preview?.senders ?? [];
  const trash = preview?.trash;
  const skipped = preview
    ? preview.skipped_protected + preview.skipped_done + preview.capped : 0;
  const titleId = "unsub-sheet-title";
  const title = phase === "result" ? outcomeTitle(outcomes)
    : t("unsub.sheet_title");

  const row = (key: string, name: string, addr: string, chips: ReactNode,
      extra?: ReactNode, aside?: ReactNode) => (
    <li key={key} className="flex items-center gap-3 px-4 py-2.5">
      <Avatar name={name || addr} size="md" />
      <div className="min-w-0 flex-1">
        <div className="truncate type-body font-medium">{name || addr}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {chips}
        </div>
        {extra}
      </div>
      {aside}
    </li>
  );

  return (
    <Modal size="sm" labelledBy={titleId} onClose={close}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          {phase === "result" ? <span aria-hidden className="w-12" /> : (
            <Button variant="plain" size="sm" onClick={close}
              className="-ml-2.5">
              {phase === "running" ? t("unsub.hide") : t("Cancel")}
            </Button>
          )}
          <h2 id={titleId}
            className="min-w-0 flex-1 truncate text-center type-heading">
            {title}
          </h2>
          {phase === "result" ? (
            <Button variant="plain" size="sm" onClick={onClose}
              className="-mr-2.5">{t("unsub.done_btn")}</Button>
          ) : <span aria-hidden className="w-12" />}
        </div>

        {phase === "loading" && <Loading label={t("loading…")} />}

        {problem && (
          <p role="alert" className="mb-3 type-body text-danger-fg">{problem}</p>
        )}

        {(phase === "review" || phase === "running") && preview && (
          <>
            <p className="mb-2 px-1 type-meta text-muted">
              {t("unsub.sheet_sub", { n: senders.length })}</p>
            {senders.length > 0 && (
              <SettingsGroup>
                <ul className="divide-y divide-line">
                  {senders.map((s) => row(s.addr, s.name, s.addr,
                    <MethodChip via={s.via} />))}
                </ul>
              </SettingsGroup>
            )}
            {senders.length === 0 && (
              <p className="mb-3 type-body text-muted">
                {t("toast.unsub_nothing")}</p>
            )}
            {trash && trash.mails > 0 && senders.length > 0 && (
              <SettingsGroup footnote={alsoTrash
                ? t("unsub.trash_note") : undefined}>
                <SettingsRow
                  label={t("unsub.also_trash", { n: trash.mails })}
                  sub={t(trash.pinned
                    ? "unsub.also_trash_sub_pinned" : "unsub.also_trash_sub",
                  { size: fmtSize(trash.size), n: trash.pinned })}>
                  <Switch checked={alsoTrash} onChange={setAlsoTrash}
                    disabled={phase === "running"} />
                </SettingsRow>
              </SettingsGroup>
            )}
            <div className="mb-4 space-y-1 px-1 type-meta text-muted">
              {skipped > 0 && <p>{t("unsub.skipped", { n: skipped })}</p>}
              {preview.skipped_no_header > 0 && (
                <p>{t("unsub.skipped_no_header",
                  { n: preview.skipped_no_header })}</p>
              )}
              {request.kind === "bulk" && !!request.pooled && (
                <p>{t("confirm.unsub_pooled_skipped", { n: request.pooled })}</p>
              )}
              {senders.length > 0 && (
                <p className="flex gap-2">
                  <Eye size={14} aria-hidden className="mt-0.5 shrink-0" />
                  <span>{t("unsub.still_note")}</span>
                </p>
              )}
            </div>
          </>
        )}

        {phase === "running" && (
          <Loading className="p-4" label={t("Unsubscribing…")
            + (run != null && unsub?.seq === run && unsub.progress
              ? ` ${unsub.progress}` : "")} />
        )}

        {phase === "review" && senders.length > 0 && (
          <Button className="w-full" onClick={(e) => {
            // A double tap must not confirm unseen (see ConfirmDialog).
            if (e.detail === 0 || Date.now() - armedAt.current >= DIALOG_ARM_MS)
              start();
          }}>
            {alsoTrash ? t("unsub.btn_trash")
              : t("unsub.btn", { n: senders.length })}
          </Button>
        )}

        {phase === "result" && (
          <>
            {outcomes.length > 0 && (
              <SettingsGroup>
                <ul className="divide-y divide-line">
                  {outcomes.map((o) => row(o.addr, nameOf(o.addr), o.addr,
                    <OutcomeChip o={o} />,
                    o.reason ? (
                      <p className="mt-1 type-meta text-danger-fg">{o.reason}</p>
                    ) : undefined,
                    o.status === "link" ? (
                      <div className="flex shrink-0 flex-col items-stretch gap-1">
                        <Button variant="tinted" size="sm"
                          onClick={() => open(o)}
                          className="inline-flex items-center justify-center gap-1.5">
                          <ExternalLink size={14} aria-hidden />
                          {t("unsub.open_page")}
                        </Button>
                        <Button variant="plain" size="sm"
                          disabled={busyAddr === o.addr}
                          onClick={() => markDone(o)}>
                          {t("unsub.mark_done")}
                        </Button>
                      </div>
                    ) : undefined))}
                </ul>
              </SettingsGroup>
            )}
            <div className="space-y-2 px-1 type-meta text-muted">
              {outcomes.some((o) => o.status === "link") && (
                <p>{t("unsub.res_note")}</p>
              )}
              {trashNote && <p role="status">{trashNote}</p>}
              {note && <p role="status">{note}</p>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
