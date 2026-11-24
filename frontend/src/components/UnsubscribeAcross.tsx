/* "Unsubscribe in N…" on the Overview of all accounts: the same sender writes
 * to several of the user's accounts, and this confirm unsubscribes in the
 * ticked ones. It is `AcrossAccountsConfirm` plus what a step does here:
 *
 *   per ticked account, pinned to it (`inAccount`) and one after the other:
 *   1. the account's own unsubscribe of ITS address for that sender
 *      (`api.unsubscribe`: recorded and audited in that account, "Still
 *      mailing" tracking follows),
 *   2. only when the box is ticked and the unsubscribe is DONE: that account's
 *      Trash move of the sender's mails (`api.deleteGroups` with exact
 *      addresses: protected senders and pinned mails stay, one Undo step in
 *      that account, behind the keep-safe check of big moves).
 *
 * Nothing here is new server behaviour; unticked accounts are never called. */

import { useEffect, useRef, useState } from "react";
import { accountGuard } from "../accountGuard";
import { api, errorText, inAccount } from "../api";
import { runPerAccount, type StepOutcome } from "../allAccounts";
import { t } from "../i18n";
import { confirmTrash, KEEP_SAFE_MIN } from "../keepsafe";
import type { SameSenderRow, UnsubPreview, UnsubVia } from "../types";
import { openUnsubPage } from "../unsub";
import { AcrossAccountsConfirm, type ConfirmLine }
  from "./AcrossAccountsConfirm";
import { Button } from "./ui";

const VIA_TEXT: Record<Exclude<UnsubVia, null>, string> = {
  one_click: "allc.via_one_click", mailto: "allc.via_mailto",
  http: "allc.via_http" };

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

/** The accounts of a row that "Unsubscribe in N…" can still reach: a
 *  List-Unsubscribe link, not recorded as done. */
export const unsubscribable = (row: SameSenderRow): string[] =>
  row.accounts.filter((a) => a.unsub && a.state !== "done")
    .map((a) => a.account);

export function UnsubscribeAcross({ row, exists, demo, onOpenActivity,
  onChanged, onClose }: {
  row: SameSenderRow;
  /** Is this account still in the workspace? Asked right before its step:
   *  the list may change while the confirm is open. */
  exists: (account: string) => boolean;
  demo: boolean;
  /** Switch to the account and show its Activity (where its Undo is). */
  onOpenActivity: (account: string) => void;
  /** Something was changed: the numbers are fetched again. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [previews, setPreviews] = useState<Record<string, UnsubPreview | string>
    | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const moved = useRef<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [switched] = useState(() => accountGuard());

  // What each account would do, before anything is sent (local, no mail
  // server): the method per address and what the Trash step would move.
  useEffect(() => {
    let live = true;
    const open = row.accounts.filter((a) => a.unsub && a.state !== "done");
    Promise.all(open.map(async (a) => {
      try {
        const p = await inAccount(a.account, () =>
          api.unsubscribePreview("sender", [a.addr], true));
        return [a.account, p] as const;
      } catch (e: any) {
        return [a.account, t("allc.preview_failed",
          { account: a.account, msg: e.message ?? String(e) })] as const;
      }
    })).then((rows) => { if (live) setPreviews(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [row]);

  const lines: ConfirmLine[] = row.accounts.map((a) => {
    const base = { account: a.account, count: t("n.mails", { n: a.mails }) };
    if (!a.unsub) return { ...base, sub: a.addr, blocked: t("allc.no_method") };
    if (a.state === "done") {
      return { ...base, sub: a.addr, blocked: t("allc.done_already") };
    }
    const p = previews?.[a.account];
    if (typeof p === "string") return { ...base, sub: a.addr, blocked: p };
    const via = p?.senders[0]?.via;
    return { ...base,
      sub: `${a.addr} · ${via ? t(VIA_TEXT[via]) : t("allc.no_method")}`,
      extraCount: p?.trash.mails ?? 0 };
  });

  const run = async (accounts: string[], trashing: boolean,
      progress: (account: string, done: number, total: number) => void):
      Promise<StepOutcome[] | null> => {
    const by = Object.fromEntries(row.accounts.map((a) => [a.account, a]));
    const prev = (a: string): UnsubPreview | null => {
      const p = previews?.[a];
      return p && typeof p !== "string" ? p : null;
    };
    // A big move to Trash: the keep-safe check, per account (the sheet's
    // rule). Declined = nothing runs.
    if (trashing) {
      for (const account of accounts) {
        const p = prev(account);
        if (!p?.trash.groups.length || p.trash.mails <= KEEP_SAFE_MIN) continue;
        const verb = t("Move to Trash");
        try {
          const answer = await confirmTrash({ title: `${verb} · ${account}`,
            onlyIfFound: true, account,
            bullets: [t("confirm.b_selected", { n: p.trash.mails }),
              t("confirm.b_space")],
            label: (k) => t("confirm.btn_n", { verb, n: k }),
            n: p.trash.mails,
            scope: { grouping: "sender", keys: p.trash.groups.map((g) => g.key),
              only_addrs: [...new Set(p.trash.groups.flatMap((g) => g.addrs))] } });
          if (!answer.ok) return null;
        } catch (e: any) {
          return [{ account, status: "failed",
            text: t("allc.out_failed", { msg: e.message ?? String(e) }) }];
        }
      }
    }
    let i = 0;
    const outcomes = await runPerAccount(accounts, async (account) => {
      const a = by[account];
      const r = await inAccount(account, () =>
        api.unsubscribe("sender", a.addr));
      const out: StepOutcome = r.action === "link"
        ? { account, status: "link", text: t("allc.out_page"), link: r.detail }
        : { account, status: "done", text: t(r.via === "mailto"
          ? "allc.out_mail" : "allc.out_done") };
      const p = prev(account);
      if (trashing && out.status === "done" && p) {
        if (!p.trash.groups.length) {
          out.text += ` · ${t("allc.trash_none")}`;
        } else {
          try {
            const q = await inAccount(account, () => api.deleteGroups(
              "sender", p.trash.groups.map((g) => g.key), "trash", "", false,
              null, null,
              [...new Set(p.trash.groups.flatMap((g) => g.addrs))]));
            moved.current[account] = q.queued;
            out.text += ` · ${q.queued
              ? t("allc.trashed", { n: q.queued }) : t("allc.trash_none")}`;
          } catch {
            out.text += ` · ${t("allc.trash_failed")}`;
          }
        }
      }
      return out;
    }, {
      exists, switched,
      gone: () => t("allc.out_gone"), away: () => t("allc.out_away"),
      failed: (_a, e) => t("allc.out_failed",
        { msg: errorText((e as Error)?.message ?? String(e)) }),
    }, (account, at) => {
      if (at === "start") progress(account, i, accounts.length);
      else i++;
    });
    return outcomes;
  };

  const markDone = async (o: StepOutcome) => {
    const addr = row.accounts.find((a) => a.account === o.account)?.addr;
    if (!addr) return;
    try {
      await inAccount(o.account, () => api.unsubscribeAck(addr));
      setMarked((m) => new Set(m).add(o.account));
      onChanged();
    } catch { /* the page link stays; the user can try again */ }
  };

  return (
    <AcrossAccountsConfirm
      title={t("allc.title", { name: row.name, n: row.accounts.length })}
      lines={lines} loading={!previews}
      note={t("allc.note")}
      extra={{ label: (n) => t("allc.also_trash", { n }),
        note: t("allc.trash_note") }}
      confirmLabel={(n, mails) => mails != null
        ? t("allc.btn_trash", { n, mails: t("n.mails", { n: mails }) })
        : t("allc.btn", { n })}
      run={run} resultTitle={acrossTitle}
      onFinished={() => onChanged()}
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
            <span className="type-meta text-muted">{t("unsub.out_marked")}</span>
          )}
          {!!moved.current[o.account] && (<>
            <span className="type-meta text-muted">{t("allc.undo_hint")}</span>
            <Button variant="plain" size="sm"
              onClick={() => { onClose(); onOpenActivity(o.account); }}>
              {t("allc.open_activity")}</Button>
          </>)}
        </div>
      )}
      onClose={onClose} />
  );
}
