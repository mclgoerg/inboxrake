import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { visitMarks } from "./allAccounts";
import { POLL_MS } from "./useAcrossRuns";
import type { AllAccountsResp } from "./types";

/** The numbers behind the All accounts page and its Insights card (`GET
 *  /api/accounts/overview`): read when it opens and whenever the account list
 *  changes, and - with `poll` - again every couple of seconds while any account
 *  scans or runs a move (the page; the Insights card reads once: each read
 *  rebuilds the sender join and takes every account's lock). Read-only - it selects nothing and writes nothing.
 *
 *  "+N new" counts from each account's remembered visit (its own Overview's
 *  record, only READ here: looking at this page is no visit of an account),
 *  fixed when the page opens. */
export function useAllAccounts(names: string[], poll = true) {
  const [data, setData] = useState<AllAccountsResp | null>(null);
  const [failed, setFailed] = useState(false);
  const marks = useRef<Record<string, number>>({});
  const key = names.join("\u0000");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async (): Promise<AllAccountsResp | null> => {
    try {
      const r = await api.accountsOverview(marks.current);
      if (!alive.current) return null;
      setData(r);
      setFailed(false);
      return r;
    } catch {
      if (alive.current) setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    marks.current = visitMarks(names);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);

  const busy = data?.accounts.some(
    (a) => a.status === "scanning" || a.busy) ?? false;
  useEffect(() => {
    if (!busy || !poll) return;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, poll, load]);

  return { data, failed, reload: load };
}
