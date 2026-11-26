/* "Unsubscribe / Trash / Archive / Block in N" of a sender that writes to
 * several accounts: `AcrossAccountsConfirm` plus what a step does here.
 *
 * Opening it reads the page's numbers AGAIN (protection, pins and unsubscribe
 * records may have changed since the page was drawn) and, for a Trash, asks
 * Keep-safe in each account. Then, per ticked account, pinned to it
 * (`?account=`, the selected account is never touched) and one after the
 * other, the ordinary per-account call:
 *
 *   unsubscribe  that account's own unsubscribe of ITS address (its method,
 *                its SMTP settings, its own record and still-mailing check),
 *   trash/archive one move of that address's mails - its own background job
 *                with its own Undo and Activity entry (pinned mails stay),
 *   block        that account's own daily Block rule.
 *
 * The server refuses a protected sender on the bulk paths (`skip_protected`),
 * so a protection that appeared after the confirm opened still holds. Esc is
 * ignored while the steps run. An unticked account is never called. */

import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { accountGuard } from "../accountGuard";
import { api, errorText } from "../api";
import { runPerAccount, type StepOutcome } from "../allAccounts";
import { fmtNum } from "../numfmt";
import { getLang, t } from "../i18n";
import { fmtSize, fmtTs } from "../lib";
import { KEEP_SAFE_MIN } from "../keepsafe";
import { countIn, plan, type Plan, type SameAction } from "../sameSender";
import type { KeepSafeCheck, KeepSafeClass, SameSenderRow, UnsubVia }
  from "../types";
import { openUnsubPage } from "../unsub";
import { stepKey, type Follow } from "../useAcrossRuns";
import { AcrossAccountsConfirm, type ConfirmLine }
  from "./AcrossAccountsConfirm";
import { Button, useToast } from "./ui";

const VIA_TEXT: Record<Exclude<UnsubVia, null>, string> = {
  one_click: "allc.via_one_click", mailto: "allc.via_mailto",
  http: "allc.via_http" };

const WHY_TEXT = { protected: "allc.protected", gone: "allc.gone",
  pinned: "allc.all_pinned", done: "allc.done_already",
  no_link: "allc.no_method", blocked: "allc.already_blocked" } as const;

const VERB: Record<SameAction, string> = {
  unsubscribe: "Unsubscribe", trash: "Move to Trash", archive: "Archive",
  block: "Block" };

/** "2 done · 1 needs you · 1 failed · 1 not run" - only the parts that are
 *  not zero. */
export function acrossTitle(items: { status: StepOutcome["status"] }[]): string {
  const n = (s: StepOutcome["status"]) =>
    items.filter((i) => i.status === s).length;
  const parts = [
    n("done") ? t("unsub.res_done", { n: n("done") }) : "",
    n("link") ? t("unsub.res_need", { n: n("link") }) : "",
    n("failed") ? t("unsub.res_failed", { n: n("failed") }) : "",
    n("skipped") ? t("allc.res_skipped", { n: n("skipped") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("unsub.res_none");
}

/** The Keep-safe result of one account under its line: "6 look worth keeping
 *  - they stay", with a Show that lists them. */
function KeepSafeLine({ found }: { found: KeepSafeCheck | "failed" }) {
  const [open, setOpen] = useState(false);
  if (found === "failed") {
    return <span className="text-muted">{t("keepsafe.check_failed")}</span>;
  }
  return (
    <div>
      <span className="inline-flex flex-wrap items-center gap-x-1.5 text-safe-fg">
        <ShieldCheck size={14} aria-hidden className="shrink-0" />
        <span>{t("allc.keep_line", { n: found.kept })}</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden>·</span>
          <button type="button" aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-8 items-center gap-0.5 underline
              coarse:min-h-11">
            {t(open ? "allc.keep_hide" : "allc.keep_show")}
            <ChevronDown size={14} aria-hidden className={open
              ? "rotate-180" : ""} />
          </button>
        </span>
      </span>
      {open && (
        <ul className="mt-1 space-y-1 pl-5 text-muted">
          {found.classes.map((c) => c.subjects.map((s, i) => (
            <li key={`${c.id}${i}`} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate text-body">
                {s.subject || t("(no subject)")}</span>
              <span className="shrink-0 whitespace-nowrap">
                {fmtTs(s.ts, getLang(), false)}</span>
            </li>
          )))}
          {found.classes.some((c) => c.count > c.subjects.length) && (
            <li>{t("keepsafe.more", { n: found.classes.reduce(
              (n, c) => n + c.count - c.subjects.length, 0) })}</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function SameSenderConfirm({ row, action, exists, demo, onFollow,
  onClaim, onChanged, onClose }: {
  row: SameSenderRow;
  action: SameAction;
  /** Is this account still in the workspace? Asked right before its step:
   *  the list may change while the confirm is open. */
  exists: (account: string) => boolean;
  demo: boolean;
  /** A Trash / Archive was queued in these accounts: the app follows the
   *  jobs and shows ONE toast with "Undo all N". */
  onFollow: (follow: Follow) => void;
  /** The moves are about to start in these accounts (`on`), or did not
   *  start: the app keeps the selected account's own "moved" toast quiet
   *  meanwhile - asked BEFORE the first step, so it never speaks twice. */
  onClaim: (accounts: string[], on: boolean) => void;
  /** Something was changed: the page reads its numbers again. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  // undefined = not read yet, null = read, the sender is not in several
  // accounts any more
  const [fresh, setFresh] = useState<SameSenderRow | null | undefined>();
  const [keep, setKeep] = useState<Record<string, KeepSafeCheck | "failed">>({});
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [switched] = useState(() => accountGuard());
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const rules = useRef<Record<string, string>>({});
  const queued = useRef<Record<string, number>>({});

  // Read again what the page showed (a protection or a pin that appeared
  // since is honoured), then - for a Trash - ask Keep-safe per account.
  useEffect(() => {
    let live = true;
    (async () => {
      let again: SameSenderRow | null;
      try {
        const r = await api.accountsOverview();
        again = r.same_sender.find((x) => x.key === row.key) ?? null;
      } catch (e: any) {
        if (live) {
          setProblem(t("allc.read_failed",
            { msg: errorText(e?.message ?? String(e)) }));
          setLoading(false);
        }
        return;
      }
      const lines = plan(row, action, again);
      const found: Record<string, KeepSafeCheck | "failed"> = {};
      if (action === "trash") {
        await Promise.all(lines.filter((l) => !l.blocked
            && l.mails > KEEP_SAFE_MIN).map(async (l) => {
          try {
            const k = await api.keepSafeCheck({ grouping: "sender",
              keys: [l.addr] }, l.account);
            if (!Array.isArray(k.classes)) found[l.account] = "failed";
            else if (k.classes.length) found[l.account] = k;
          } catch { found[l.account] = "failed"; }
        }));
      }
      if (!live) return;
      setFresh(again);
      setKeep(found);
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.key, action]);

  const plans: Plan[] = fresh === undefined ? [] : plan(row, action, fresh);
  const lines: ConfirmLine[] = plans.map((p) => {
    const size = fmtSize(p.size);
    const k = keep[p.account];
    const base = { account: p.account,
      count: `${t("n.mails", { n: p.mails })} · ${size}`, mails: p.mails };
    if (p.blocked) {
      return { ...base, sub: p.addr, blocked: t(WHY_TEXT[p.blocked]) };
    }
    const parts: Record<SameAction, string> = {
      unsubscribe: `${p.addr} · ${p.via ? t(VIA_TEXT[p.via])
        : t("allc.no_method")}`,
      trash: [p.addr, p.pinned > 0 && t("allc.pinned_stay", { n: p.pinned })]
        .filter(Boolean).join(" · "),
      archive: [p.addr, p.pinned > 0 && t("allc.pinned_stay", { n: p.pinned })]
        .filter(Boolean).join(" · "),
      block: `${p.addr} · ${t("allc.block_sub")}` };
    return { ...base, sub: parts[action],
      ...(k ? { extra: <KeepSafeLine found={k} />,
        keep: k === "failed" ? 0 : k.kept } : {}) };
  });

  // (until the fresh read is in, the title names what the page showed)
  const n = loading ? countIn(row, action) : lines.filter((l) => !l.blocked).length;
  const verb = t(VERB[action]);

  const run = async (accounts: string[],
      progress: (account: string, done: number, total: number) => void):
      Promise<StepOutcome[] | null> => {
    setProblem("");
    const by = Object.fromEntries(plans.map((p) => [p.account, p]));
    const moveKind = action === "trash" || action === "archive" ? action : null;
    let before: Record<string, string | null> = {};
    if (moveKind) {
      // Nothing is moved before every account's protection is in place: a pin
      // that fails sends the whole confirm back to review, with the problem.
      if (action === "trash") {
        for (const account of accounts) {
          const k = keep[account];
          if (!k || k === "failed") continue;
          try {
            await api.keepSafePin({ grouping: "sender", keys: [by[account].addr] },
              k.classes.map((c) => c.id as KeepSafeClass), account);
          } catch (e: any) {
            setProblem(t("allc.pin_failed", { account,
              msg: errorText(e?.message ?? String(e)) }));
            return null;
          }
        }
      }
      // each account's newest Undo step BEFORE the move: the step the move
      // makes is told from the older ones by it
      try {
        const r = await api.accountsOverview();
        before = Object.fromEntries(r.accounts.map((a) => [a.name,
          a.undo_last ? stepKey(a.undo_last) : null]));
      } catch (e: any) {
        setProblem(t("allc.read_failed",
          { msg: errorText(e?.message ?? String(e)) }));
        return null;
      }
    }
    if (moveKind) onClaim(accounts, true);
    let i = 0;
    const outcomes = await runPerAccount(accounts, async (account) => {
      const p = by[account];
      if (action === "unsubscribe") {
        const r = await api.unsubscribe("sender", p.addr, true, account);
        return r.action === "link"
          ? { account, status: "link" as const, text: t("allc.out_page"),
            link: r.detail }
          : { account, status: "done" as const, text: t(r.via === "mailto"
            ? "allc.out_mail" : "allc.out_done") };
      }
      if (action === "block") {
        const r = await api.block("sender", p.addr, row.name, false, account);
        rules.current[account] = r.rule.id;
        return { account, status: "done" as const, text: t("allc.out_blocked") };
      }
      const r = await api.deleteGroups("sender", [p.addr], action, "", false,
        null, null, null, true, account);
      queued.current[account] = r.queued;
      return { account, status: "done" as const, text: r.queued
        ? t(action === "trash" ? "allc.out_trash" : "allc.out_archive",
          { n: r.queued }) : t("allc.out_none") };
    }, {
      exists, switched,
      gone: () => t("allc.out_gone"), away: () => t("allc.out_away"),
      failed: (_a, e) => t("allc.out_failed",
        { msg: errorText((e as Error)?.message ?? String(e)) }),
    }, (account, at) => {
      if (at === "start") progress(account, i, accounts.length);
      else i++;
    });
    if (moveKind) {
      const went = outcomes.filter((o) => o.status === "done"
        && (queued.current[o.account] ?? 0) > 0).map((o) => o.account);
      if (went.length) onFollow({ kind: moveKind, accounts: went, before });
      // the ones that never queued a move have nothing to announce
      onClaim(accounts.filter((a) => !went.includes(a)), false);
    }
    return outcomes;
  };

  const finished = (outcomes: StepOutcome[]): boolean => {
    const ok = outcomes.filter((o) => o.status === "done");
    onChanged();
    if (action === "block" && ok.length) {
      const made = ok.map((o) => ({ account: o.account,
        id: rules.current[o.account] })).filter((r) => r.id);
      toast.show(t("allc.toast_blocked", { name: row.name,
        where: t("allp.accounts_n", { n: ok.length }) }), {
        variant: "success",
        action: { label: t("allp.undo_all", { n: made.length }),
          onClick: () => {
            void Promise.all(made.map((r) => api.deleteRule(r.id)))
              .then(() => toast.show(t("allc.toast_unblocked",
                { name: row.name,
                  where: t("allp.accounts_n", { n: made.length }) }),
              { variant: "success" }),
              (e: any) => toast.show(t("err.generic",
                { msg: errorText(e?.message ?? String(e)) }),
              { variant: "error" }));
          } } });
    }
    if (action === "unsubscribe" && ok.length === outcomes.length) {
      toast.show(t("allc.toast_unsub", { name: row.name,
        where: t("allp.accounts_n", { n: ok.length }) }),
      { variant: "success" });
    }
    // everything went through (and nothing needs the user): the toast says
    // the rest, the dialog closes; else the result list stays
    return outcomes.every((o) => o.status === "done");
  };

  const markDone = async (o: StepOutcome) => {
    const addr = row.accounts.find((a) => a.account === o.account)?.addr;
    if (!addr) return;
    try {
      await api.unsubscribeAck(addr, true, o.account);
      setMarked((m) => new Set(m).add(o.account));
      onChanged();
    } catch { /* the page link stays; the user can try again */ }
  };

  const titleKey = { unsubscribe: "allp.t_unsub", trash: "allp.t_trash",
    archive: "allp.t_archive", block: "allp.t_block" }[action];
  const noteKey = { unsubscribe: "allc.note_unsub", trash: "allc.note_move",
    archive: "allc.note_move", block: "allc.note_block" }[action];
  return (
    <AcrossAccountsConfirm
      title={t(titleKey, { name: row.name,
        where: t("allp.accounts_n", { n }) })}
      lines={lines} problem={problem} loading={loading}
      note={t(noteKey)} danger={action === "trash"}
      lineLabel={(account) => t("allc.line", { verb, account })}
      confirmLabel={(k, mails) => {
        const key = { unsubscribe: "allp.b_unsub", trash: "allp.b_trash",
          archive: "allp.b_archive", block: "allp.b_block" }[action];
        return t(key, { where: t("allp.accounts_n", { n: k }),
          mails: fmtNum(mails) });
      }}
      run={run} resultTitle={acrossTitle} onFinished={finished}
      outcomeExtra={(o) => (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {o.status === "link" && o.link && !marked.has(o.account) && (<>
            <Button variant="tinted" size="sm"
              onClick={() => setNote(openUnsubPage(o.link!, demo))}>
              {t("unsub.open_page")}</Button>
            <Button variant="plain" size="sm" onClick={() => markDone(o)}>
              {t("unsub.mark_done")}</Button>
          </>)}
          {note && o.status === "link" && (
            <span role="status" className="type-meta text-muted">{note}</span>
          )}
          {marked.has(o.account) && (
            <span className="inline-flex items-center gap-1 type-meta
              text-muted"><Check size={14} aria-hidden />
              {t("unsub.out_marked")}</span>
          )}
        </div>
      )}
      onClose={onClose} />
  );
}
