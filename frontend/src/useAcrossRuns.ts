import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "./api";
import { t } from "./i18n";
import type { ToastOptions } from "./components/ui";
import type { AllAccountCard } from "./types";

/* What the All accounts page starts and the app has to follow after the page
 * is gone: "Scan all", and the Trash / Archive steps it queued - one job per
 * account - whose end is one toast ("Moved 339 mails to Trash in 3 accounts",
 * "Undo all 3"). Both live here, not in the page: leaving the page changes
 * nothing about a run that is going.
 *
 * Nothing here selects an account. Every call is pinned to its own account
 * (`?account=`); the read that follows the jobs is the same account-free
 * overview the page uses. */

/** How often the numbers are read again while something runs. */
export const POLL_MS = 2000;
/** One account's scan may take this long before Scan all moves on. */
export const SCAN_WAIT_MS = 30 * 60 * 1000;
/** A queued move is followed this long; after that the toast is skipped
 *  (the account's own Undo menu and Activity still have the step). */
export const FOLLOW_MS = 10 * 60 * 1000;
/** The selected account's own "moved N mails" toast stays quiet this long
 *  after the page's toast: its state may reach the app a moment later. */
export const CLAIM_GRACE_MS = 4000;

export interface ScanAllRun {
  /** The account being scanned. */
  account: string;
  done: number;
  total: number;
}

/** The identity an Undo step is found by (the same fields the Undo menu
 *  sends). */
export interface StepIdent { id?: string; ts: number; label: string;
  count: number }

/** One step's identity as a string, like the Undo menu's `undoId`. */
export const stepKey = (u: StepIdent): string =>
  u.id ?? `${u.ts}|${u.count}|${u.label}`;

export type MoveKind = "trash" | "archive";

/** A move the page queued: one job per account. `before` = each account's
 *  newest Undo step when the page started it (so the step the move made is
 *  told from the older ones). */
export interface Follow {
  kind: MoveKind;
  accounts: string[];
  before: Record<string, string | null>;
}

type Toast = (message: string, opts?: ToastOptions) => number;

export function useAcrossRuns({ toast, names, onChanged }: {
  toast: Toast;
  /** The accounts that exist now (a removed one is left out of Scan all). */
  names: string[];
  /** Accounts whose mail changed (a finished move, an Undo): the app reads
   *  them again if one is the selected account. */
  onChanged: (accounts: string[]) => void;
}) {
  const [scanRun, setScanRun] = useState<ScanAllRun | null>(null);
  /** Accounts with a followed move: the app's own "moved N mails" toast for
   *  the selected account stays quiet for these (this run's toast says it). */
  const claimed = useRef(new Set<string>());
  const live = useRef(true);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const namesRef = useRef(names);
  namesRef.current = names;
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  /* ---- Scan all: one account after the other ---- */
  const scanning = useRef(false);
  const scanAll = useCallback(async (accounts: string[]): Promise<void> => {
    if (scanning.current) return;
    scanning.current = true;
    const scanned: string[] = [];
    const failed: string[] = [];
    const busy: string[] = [];
    try {
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        if (!namesRef.current.includes(account)) continue;   // removed
        setScanRun({ account, done: i, total: accounts.length });
        try {
          await api.scan(account);
        } catch (e: any) {
          // 409 = a job of its own is running there: leave that one out
          (/busy/i.test(e?.message ?? "") ? busy : failed).push(account);
          continue;
        }
        const until = Date.now() + SCAN_WAIT_MS;
        let ok = false;
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const r = await api.accountsOverview().catch(() => null);
          const row = r?.accounts.find((a) => a.name === account);
          if (r && !row) break;                  // removed meanwhile
          if (row && row.status !== "scanning") { ok = !row.failed; break; }
        }
        (ok ? scanned : failed).push(account);
      }
    } finally {
      scanning.current = false;
      if (live.current) setScanRun(null);
    }
    if (failed.length) {
      toastRef.current(t("allp.scan_done_failed", { ok: scanned.length,
        n: accounts.length, failed: failed.length, names: failed.join(", ") }),
      { variant: "error" });
    } else if (busy.length) {
      toastRef.current(t("allp.scan_busy", { names: busy.join(", ") }),
        { variant: "info" });
    } else {
      toastRef.current(t("allp.scan_done", { n: scanned.length }),
        { variant: "success" });
    }
    changedRef.current(scanned);
  }, []);

  /* ---- Undo all N ---- */
  const undoAll = useCallback(async (
      steps: { account: string; ident: StepIdent }[]): Promise<void> => {
    let restored = 0;
    const done: string[] = [];
    for (const s of steps) {
      try {
        const r = await api.undo(-1, s.ident, s.account);
        restored += r.restored;
        done.push(s.account);
      } catch (e: any) {
        toastRef.current(t("allp.undo_failed", { account: s.account,
          msg: errorText(e?.message ?? String(e)) }), { variant: "error" });
      }
    }
    if (done.length) {
      toastRef.current(t("allp.undone", { mails: t("n.mails", { n: restored }),
        where: t("allp.accounts_n", { n: done.length }) }),
      { variant: "success" });
      changedRef.current(done);
    }
  }, []);

  /* ---- follow the jobs a move queued ---- */
  const follow = useCallback((g: Follow): void => {
    g.accounts.forEach((a) => claimed.current.add(a));
    const until = Date.now() + FOLLOW_MS;
    const release = () => g.accounts.forEach((a) => claimed.current.delete(a));
    const finish = (rows: AllAccountCard[]) => {
      setTimeout(release, CLAIM_GRACE_MS);
      const made: { account: string; ident: StepIdent }[] = [];
      for (const a of g.accounts) {
        const row = rows.find((r) => r.name === a);
        if (!row) continue;
        if (row.job_failed) {
          toastRef.current(t("allp.step_failed", { account: a,
            msg: errorText(row.job_failed.error) }), { variant: "error" });
          continue;
        }
        const u = row.undo_last;
        if (u && u.count > 0 && stepKey(u) !== g.before[a]) {
          made.push({ account: a, ident: { ts: u.ts, label: u.label,
            count: u.count, ...(u.id ? { id: u.id } : {}) } });
        }
      }
      changedRef.current(g.accounts);
      if (!made.length) {
        if (!g.accounts.some((a) => rows.find((r) => r.name === a)?.job_failed)) {
          toastRef.current(t("allp.nothing_moved"), { variant: "info" });
        }
        return;
      }
      const mails = made.reduce((n, m) => n + m.ident.count, 0);
      toastRef.current(t(g.kind === "trash" ? "allp.moved_trash"
        : "allp.moved_archive", { mails: t("n.mails", { n: mails }),
        where: t("allp.accounts_n", { n: made.length }) }), {
        variant: "success",
        action: { label: t("allp.undo_all", { n: made.length }),
          onClick: () => { void undoAll(made); } } });
    };
    const tick = async () => {
      let rows: AllAccountCard[] | null = null;
      try { rows = (await api.accountsOverview()).accounts; } catch { /* retry */ }
      const mine = rows?.filter((r) => g.accounts.includes(r.name)) ?? [];
      if (rows && mine.every((r) => !r.busy)) { finish(rows); return; }
      if (Date.now() > until) { release(); return; }
      setTimeout(() => { void tick(); }, POLL_MS);
    };
    // the first read comes a moment after the job was queued
    setTimeout(() => { void tick(); }, 0);
  }, [undoAll]);

  return { scanRun, scanAll, follow, undoAll, claimed };
}
