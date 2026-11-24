import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { rememberVisit, visitMarks } from "./allAccounts";
import type { AllAccountsResp } from "./types";

/** How often the numbers are read again while a scan runs. */
export const POLL_MS = 2000;
/** One account's scan may take this long before Scan all moves on. */
export const SCAN_WAIT_MS = 30 * 60 * 1000;

export interface ScanAllRun {
  /** The account being scanned. */
  account: string;
  done: number;
  total: number;
}

export interface ScanAllResult {
  scanned: string[];
  failed: string[];
  busy: string[];
}

/** The data behind the Overview of all accounts (`GET
 *  /api/accounts/overview`) and its one action, Scan all.
 *
 *  `enabled`: All accounts is the selected scope - the numbers are fetched
 *  (the sidebar counts use them too), kept fresh while any account scans, and
 *  read again when the account list changes (`names`). `overviewOpen`: the
 *  Overview page is showing them - opening it fixes the moment each account's
 *  "+N new" counts from, leaving it counts as a visit of every account.
 *
 *  Scan all runs here, not in the page: it goes on when the user leaves the
 *  Overview. One account after the other (the scans are mail-server work,
 *  never started side by side), each waited for by the numbers' own status;
 *  one that cannot start (busy) or fails does not stop the rest. */
export function useAllAccounts(enabled: boolean, overviewOpen: boolean,
    names: string[]) {
  const [data, setData] = useState<AllAccountsResp | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState<ScanAllRun | null>(null);
  const marks = useRef<Record<string, number>>({});
  const key = names.join("\u0000");
  const live = useRef(enabled);
  live.current = enabled;

  const load = useCallback(async (): Promise<AllAccountsResp | null> => {
    try {
      const r = await api.accountsOverview(marks.current);
      if (!live.current) return null;
      setData(r);
      setFailed(false);
      return r;
    } catch {
      if (live.current) setFailed(true);
      return null;
    }
  }, []);

  // Open: remember what each account's "+N new" counts from; leave: that was
  // a visit of every account in it.
  useEffect(() => {
    if (!enabled || !overviewOpen) return;
    marks.current = visitMarks(names);
    const leave = () => rememberVisit(names, marks.current);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, overviewOpen, key]);

  useEffect(() => {
    if (!enabled) { setData(null); return; }
    if (!overviewOpen) marks.current = {};
    void load();
  }, [enabled, key, load, overviewOpen]);

  const scanning = data?.accounts.some((a) => a.status === "scanning") ?? false;
  useEffect(() => {
    if (!enabled || !scanning) return;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, scanning, load]);

  const scanAll = useCallback(async (
      accounts: string[]): Promise<ScanAllResult> => {
    const result: ScanAllResult = { scanned: [], failed: [], busy: [] };
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      setRun({ account, done: i, total: accounts.length });
      try {
        await api.scan(account);
      } catch (e: any) {
        // 409 = a job of its own is running there: leave that one out
        (e?.message === "busy" || /busy/i.test(e?.message ?? "")
          ? result.busy : result.failed).push(account);
        continue;
      }
      const until = Date.now() + SCAN_WAIT_MS;
      let ok = false;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const r = await api.accountsOverview(marks.current).catch(() => null);
        const row = r?.accounts.find((a) => a.name === account);
        if (r && live.current) setData(r);
        if (!row) break;                       // removed meanwhile
        if (row.status !== "scanning") { ok = !row.failed; break; }
      }
      (ok ? result.scanned : result.failed).push(account);
    }
    setRun(null);
    await load();
    return result;
  }, [load]);

  return { data, failed, run, reload: load, scanAll };
}
