/* "Trash selected" over the hits of Search: All accounts - the same confirm as
 * "Trash in N" of the All accounts page. Each account the selection reaches is
 * listed with its own tick and count (and its Keep-safe result for a big
 * move); then ONE move per ticked account, pinned to it (`?account=`, the
 * selected account is never the one that decides), one after the other, each
 * its own job with its own Undo and Activity entry. The app follows the jobs
 * for ONE toast ("Undo all N").
 *
 * Pinned mails and mails of protected senders are taken out of the selection
 * before anything runs (the server refuses them anyway); an account with
 * nothing left is listed, unticked. A failing account never stops the others,
 * an unticked one is never called, Esc is ignored while the steps run. */

import { useEffect, useRef, useState } from "react";
import { accountGuard } from "../accountGuard";
import { api, errorText } from "../api";
import { runPerAccount, type StepOutcome } from "../allAccounts";
import { t } from "../i18n";
import { KEEP_SAFE_MIN } from "../keepsafe";
import { mailKey } from "../lib";
import type { KeepSafeCheck, KeepSafeClass, Mail } from "../types";
import type { Follow } from "../useAcrossRuns";
import { AcrossAccountsConfirm, type ConfirmLine }
  from "./AcrossAccountsConfirm";
import { acrossTitle, KeepSafeLine } from "./SameSenderConfirm";

const items = (ms: Mail[]) => ms.map((m) => [m.folder, m.uid] as [string, number]);

/** The mails of each account the selection reaches, in the accounts' own
 *  order: `acting` may move, `stay` is pinned or from a protected sender. */
export function planAcross(mails: Mail[], order: string[]):
    { account: string; acting: Mail[]; stay: number }[] {
  const by = new Map<string, Mail[]>();
  for (const m of mails) {
    if (!m.account) continue;
    by.set(m.account, [...(by.get(m.account) ?? []), m]);
  }
  return order.filter((a) => by.has(a)).map((account) => {
    const mine = by.get(account)!;
    const acting = mine.filter((m) => !m.pinned && !m.protected);
    return { account, acting, stay: mine.length - acting.length };
  });
}

export function SearchTrashConfirm({ mails, order, exists, onFollow, onClaim,
  onActed, onClose }: {
  /** The ticked hits as they were drawn. */
  mails: Mail[];
  /** The accounts' own order. */
  order: string[];
  exists: (account: string) => boolean;
  onFollow: (follow: Follow) => void;
  onClaim: (accounts: string[], on: boolean) => void;
  /** The mails whose account's move was queued (they leave the results). */
  onActed: (done: Mail[]) => void;
  onClose: () => void;
}) {
  const plans = planAcross(mails, order);
  const [keep, setKeep] = useState<Record<string, KeepSafeCheck | "failed">>({});
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [switched] = useState(() => accountGuard());
  const jobs = useRef<Record<string, string>>({});
  const moved = useRef<Record<string, Mail[]>>({});

  // Keep-safe, per account, for a big move (the single-account rule).
  useEffect(() => {
    let live = true;
    (async () => {
      const found: Record<string, KeepSafeCheck | "failed"> = {};
      await Promise.all(plans.filter((p) => p.acting.length > KEEP_SAFE_MIN)
        .map(async (p) => {
          try {
            const k = await api.keepSafeCheck({ items: items(p.acting) },
              p.account);
            if (!Array.isArray(k.classes)) found[p.account] = "failed";
            else if (k.classes.length) found[p.account] = k;
          } catch { found[p.account] = "failed"; }
        }));
      if (live) { setKeep(found); setLoading(false); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines: ConfirmLine[] = plans.map((p) => {
    const k = keep[p.account];
    const base = { account: p.account, mails: p.acting.length,
      count: t("n.mails", { n: p.acting.length }) };
    if (!p.acting.length) {
      return { ...base, sub: "", blocked: t("allp.s_all_stay") };
    }
    const sub = p.acting.length === 1 && !p.stay
      ? p.acting[0].subject || t("(no subject)")
      : p.stay ? t("allp.s_stay", { n: p.stay }) : "";
    return { ...base, sub,
      ...(k ? { extra: <KeepSafeLine found={k} />,
        keep: k === "failed" ? 0 : k.kept } : {}) };
  });
  const live = lines.filter((l) => !l.blocked);
  const n = loading ? plans.length : live.length;
  const total = live.reduce((x, l) => x + (l.mails ?? 0), 0);

  const run = async (accounts: string[],
      progress: (account: string, done: number, total: number) => void):
      Promise<StepOutcome[] | null> => {
    setProblem("");
    const by = Object.fromEntries(plans.map((p) => [p.account, p.acting]));
    // what Keep-safe held back stays: protected before anything moves, and a
    // protection that fails sends the whole confirm back to review
    const goes: Record<string, Mail[]> = {};
    for (const account of accounts) {
      let acting = by[account];
      const k = keep[account];
      if (k && k !== "failed") {
        try {
          const r = await api.keepSafePin({ items: items(acting) },
            k.classes.map((c) => c.id as KeepSafeClass), account);
          const gone = new Set(r.items.map(([folder, uid]) =>
            mailKey({ folder, uid, account })));
          acting = acting.filter((m) => !gone.has(mailKey(m)));
        } catch (e: any) {
          setProblem(t("allc.pin_failed", { account,
            msg: errorText(e?.message ?? String(e)) }));
          return null;
        }
      }
      goes[account] = acting;
    }
    onClaim(accounts, true);
    let i = 0;
    const outcomes = await runPerAccount(accounts, async (account) => {
      const go = goes[account];
      if (!go.length) {
        return { account, status: "done" as const, text: t("allc.out_none") };
      }
      const r = await api.deleteMessages(items(go), "trash", "", false, account);
      if (r.job) jobs.current[account] = r.job;
      moved.current[account] = go;
      return { account, status: "done" as const, text: r.queued
        ? t("allc.out_trash", { n: r.queued }) : t("allc.out_none") };
    }, {
      exists, switched,
      gone: () => t("allc.out_gone"), away: () => t("allc.out_away"),
      failed: (_a, e) => t("allc.out_failed",
        { msg: errorText((e as Error)?.message ?? String(e)) }),
    }, (account, at) => {
      if (at === "start") progress(account, i, accounts.length);
      else i++;
    });
    const went = outcomes.filter((o) => o.status === "done"
      && jobs.current[o.account]).map((o) => o.account);
    if (went.length) {
      onFollow({ kind: "trash", steps: went.map((account) => ({
        account, job: jobs.current[account] })) });
    }
    onClaim(accounts.filter((a) => !went.includes(a)), false);
    const done = outcomes.filter((o) => o.status === "done")
      .flatMap((o) => moved.current[o.account] ?? []);
    if (done.length) onActed(done);
    return outcomes;
  };

  return (
    <AcrossAccountsConfirm
      title={t("allp.s_title", { mails: t("n.mails", { n: loading
        ? mails.length : total }), where: t("allp.accounts_n", { n }) })}
      lines={lines} problem={problem} loading={loading}
      note={t("allc.note_move")} danger
      lineLabel={(account) => t("allc.line",
        { verb: t("Move to Trash"), account })}
      confirmLabel={(k, count) => t("allp.b_trash", {
        where: t("allp.accounts_n", { n: k }),
        mails: t("n.mails", { n: count }) })}
      run={run} resultTitle={acrossTitle}
      onFinished={(outcomes) => outcomes.every((o) => o.status === "done")}
      onClose={onClose} />
  );
}
