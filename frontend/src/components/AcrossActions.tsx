/* The selection actions of the lists across accounts (All accounts): Move to
 * Trash, Archive and Mark as read for ticked Sender rows or ticked mails -
 * through the multi-account confirm (`AcrossAccountsConfirm`).
 *
 * The confirm lists every account the selection reaches with its own
 * checkbox and count; then ONE ordinary per-account call per ticked account,
 * pinned to it (`inAccount`) and one after the other, each a background job
 * with its own Undo and Activity entry on the server. The single-account
 * rules hold per account: a protected sender is left out of a Trash, pinned
 * mails stay (except for Mark as read), a big move to Trash asks the keep-safe
 * question per account. An account that was removed meanwhile is skipped and
 * said so, a view switch stands the rest down, a failed account never stops
 * the others, and an unticked account is never called. */

import { useRef, useState } from "react";
import { accountGuard } from "../accountGuard";
import { api, errorText, inAccount } from "../api";
import { runPerAccount, type StepOutcome } from "../allAccounts";
import { itemsOf, planMails, planSenders, type AcrossAction, type MailStep,
  type SenderStep } from "../acrossLists";
import { t } from "../i18n";
import { confirmTrash, KEEP_SAFE_MIN } from "../keepsafe";
import { mailKey } from "../lib";
import type { AcrossGroup, Mail } from "../types";
import { AcrossAccountsConfirm, type ConfirmLine }
  from "./AcrossAccountsConfirm";
import { acrossTitle } from "./UnsubscribeAcross";
import { Button } from "./ui";

const VERB: Record<AcrossAction, string> = {
  trash: "Move to Trash", archive: "Archive", mark_read: "Mark as read" };
const verbOf = (a: AcrossAction): string => t(VERB[a]);

const OUT: Record<AcrossAction, string> = {
  trash: "alist.out_trash", archive: "alist.out_archive",
  mark_read: "alist.out_read" };

/** The same pieces for a sender step and a mail step: what the confirm's
 *  line says. */
interface Shape { account: string; mails: number; pinned: number;
  /** Mails of senders that are protected (left alone). */
  protectedLeft: number; sub: string }

const lineOf = (s: Shape): ConfirmLine => {
  const base = { account: s.account, mails: s.mails,
    count: t("n.mails", { n: s.mails }) };
  if (s.mails > 0) return { ...base, sub: s.sub };
  return { ...base, sub: s.sub, blocked: s.protectedLeft
    ? t("alist.all_protected") : t("alist.all_pinned") };
};

const sentence = (parts: (string | false)[]): string =>
  parts.filter(Boolean).join(" · ");

/** The part both confirms share: lines, title, note, labels, result. */
function StepsConfirm({ action, shapes, titleMails, exists, onOpenActivity,
  onChanged, onClose, perform, big, problem }: {
  action: AcrossAction;
  shapes: Shape[];
  /** The mails the whole selection would act on (the title). */
  titleMails: number;
  exists: (account: string) => boolean;
  onOpenActivity: (account: string) => void;
  /** The accounts whose step ran (their lists are read again). */
  onChanged: (accounts: string[]) => void;
  onClose: () => void;
  /** The ONE call of an account's step: resolves how many mails it queued. */
  perform: (account: string) => Promise<number>;
  /** A big move to Trash: the keep-safe question of this account. false =
   *  the user declined (nothing runs at all); it may throw. */
  big: (account: string) => Promise<boolean>;
  problem?: string;
}) {
  const [switched] = useState(() => accountGuard());
  const [queued, setQueued] = useState<Record<string, number>>({});
  const [issue, setIssue] = useState("");
  const verb = verbOf(action);
  const lines = shapes.map(lineOf);
  // (an account with nothing to do is listed, but is no account of the step)
  const accounts = shapes.filter((s) => s.mails > 0).length;

  const run = async (names: string[], _extra: boolean,
      progress: (account: string, done: number, total: number) => void):
      Promise<StepOutcome[] | null> => {
    setIssue("");
    if (action === "trash") {
      for (const account of names) {
        const s = shapes.find((x) => x.account === account);
        if (!s || s.mails <= KEEP_SAFE_MIN) continue;
        try {
          if (!await big(account)) return null;
        } catch (e: any) {
          // Nothing ran: back to the review with the problem (a protection
          // that failed to be written must never let the move go ahead).
          setIssue(t("allc.preview_failed", { account,
            msg: errorText(e.message ?? String(e)) }));
          return null;
        }
      }
    }
    let i = 0;
    return runPerAccount(names, async (account) => {
      const n = await perform(account);
      setQueued((q) => ({ ...q, [account]: n }));
      return { account, status: "done" as const, text: n
        ? t(OUT[action], { n }) : t("alist.out_none") };
    }, {
      exists, switched,
      gone: () => t("allc.out_gone"), away: () => t("allc.out_away"),
      failed: (_a, e) => t("allc.out_failed",
        { msg: errorText((e as Error)?.message ?? String(e)) }),
    }, (account, at) => {
      if (at === "start") progress(account, i, names.length);
      else i++;
    });
  };

  return (
    <AcrossAccountsConfirm
      title={t("alist.title", { verb, mails: t("n.mails", { n: titleMails }),
        n: accounts })}
      lines={lines} problem={issue || problem}
      note={t(action === "mark_read" ? "alist.note_read" : "alist.note_move")}
      danger={action !== "mark_read"}
      lineLabel={(account) => t("alist.line", { verb, account })}
      confirmLabel={(_n, _x, mails) => t("confirm.btn_n", { verb, n: mails })}
      run={run} resultTitle={acrossTitle}
      onFinished={(outcomes) => onChanged(outcomes
        .filter((o) => o.status === "done").map((o) => o.account))}
      outcomeExtra={(o) => (queued[o.account] && action !== "mark_read") ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="type-meta text-muted">{t("allc.undo_hint")}</span>
          <Button variant="plain" size="sm"
            onClick={() => { onClose(); onOpenActivity(o.account); }}>
            {t("allc.open_activity")}</Button>
        </div>
      ) : null}
      onClose={onClose} />
  );
}

/** Ticked Sender rows: Trash / Archive / Mark as read in the accounts they
 *  exist in. */
export function AcrossSendersConfirm({ rows, action, order, exists,
  onOpenActivity, onChanged, onClose }: {
  rows: AcrossGroup[];
  action: AcrossAction;
  /** The accounts' own order. */
  order: string[];
  exists: (account: string) => boolean;
  onOpenActivity: (account: string) => void;
  onChanged: (accounts: string[]) => void;
  onClose: () => void;
}) {
  const steps = planSenders(rows, action, order);
  const by = Object.fromEntries(steps.map((s) => [s.account, s])) as
    Record<string, SenderStep>;
  const shapes: Shape[] = steps.map((s) => ({
    account: s.account, mails: s.mails, pinned: s.pinned,
    protectedLeft: s.protectedSkipped,
    sub: sentence([t("n.senders", { n: s.keys.length + s.protectedSkipped }),
      s.pinned > 0 && t("alist.pinned_stay", { n: s.pinned }),
      s.protectedSkipped > 0
        && t("alist.protected_left", { n: s.protectedSkipped })]) }));
  return (
    <StepsConfirm action={action} shapes={shapes} exists={exists}
      titleMails={steps.reduce((n, s) => n + s.mails, 0)}
      onOpenActivity={onOpenActivity} onChanged={onChanged} onClose={onClose}
      perform={async (account) => {
        const s = by[account];
        if (!s?.keys.length) return 0;
        const r = await inAccount(account, () => api.deleteGroups(
          "sender", s.keys, action, "", false, null, null));
        return r.queued;
      }}
      big={async (account) => {
        const s = by[account];
        const answer = await confirmTrash({ title: `${verbOf(action)} · ${account}`,
          onlyIfFound: true, account,
          bullets: [t("confirm.b_selected", { n: s.mails }),
            t("confirm.b_space")],
          label: (k) => t("confirm.btn_n", { verb: verbOf(action), n: k }),
          n: s.mails,
          scope: { grouping: "sender", keys: s.keys } });
        return answer.ok;
      }} />
  );
}

/** Ticked mails: the same, per account, on the exact (folder, uid) of each. */
export function AcrossMailsConfirm({ mails, action, order, exists,
  onOpenActivity, onChanged, onClose }: {
  mails: Mail[];
  action: AcrossAction;
  order: string[];
  exists: (account: string) => boolean;
  onOpenActivity: (account: string) => void;
  /** The mails that were acted on (their accounts' step ran). */
  onChanged: (acted: Mail[]) => void;
  onClose: () => void;
}) {
  const steps = planMails(mails, action, order);
  const by = Object.fromEntries(steps.map((s) => [s.account, s])) as
    Record<string, MailStep>;
  // the mails the keep-safe box protected stay (per account)
  const kept = useRef<Record<string, Set<string>>>({});
  const shapes: Shape[] = steps.map((s) => ({
    account: s.account, mails: s.acting.length, pinned: s.pinned,
    protectedLeft: 0,
    sub: sentence([
      s.acting.length === 1 && !s.pinned
        ? s.acting[0].subject || t("(no subject)")
        : t("n.mails", { n: s.acting.length + s.pinned }),
      s.pinned > 0 && t("alist.pinned_stay", { n: s.pinned })]) }));
  return (
    <StepsConfirm action={action} shapes={shapes} exists={exists}
      titleMails={steps.reduce((n, s) => n + s.acting.length, 0)}
      onOpenActivity={onOpenActivity} onClose={onClose}
      onChanged={(accounts) => onChanged(accounts.flatMap((a) =>
        (by[a]?.acting ?? []).filter((m) => !kept.current[a]?.has(mailKey(m)))))}
      perform={async (account) => {
        const s = by[account];
        const go = s.acting.filter((m) => !kept.current[account]?.has(mailKey(m)));
        if (!go.length) return 0;
        const r = await inAccount(account, () => api.deleteMessages(
          itemsOf(go), action, "", false));
        return r.queued;
      }}
      big={async (account) => {
        const s = by[account];
        const answer = await confirmTrash({ title: `${verbOf(action)} · ${account}`,
          onlyIfFound: true, account,
          bullets: [t("confirm.b_selected", { n: s.acting.length }),
            t("confirm.b_space")],
          label: (k) => t("confirm.btn_n", { verb: verbOf(action), n: k }),
          n: s.acting.length, scope: { items: itemsOf(s.acting) } });
        if (!answer.ok) return false;
        // mails the box just protected are not moved
        kept.current[account] = new Set(answer.pinned.map(([folder, uid]) =>
          mailKey({ folder, uid, account })));
        return true;
      }} />
  );
}
