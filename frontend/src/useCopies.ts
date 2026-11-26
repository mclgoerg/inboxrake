import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { CopiesResp } from "./types";

/** The exact copies between the accounts (`GET /api/accounts/copies`):
 *  "Same mails in several accounts" on the All accounts page and its Insights
 *  card. Read once when it opens and whenever the account list changes, and
 *  again on `reload` (after a step) - never polled: it reads every account's
 *  index. Read-only, no mail server, selects nothing. */
export function useCopies(names: string[]) {
  const [data, setData] = useState<CopiesResp | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const key = names.join("\u0000");
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await api.accountsCopies();
      if (!alive.current) return;
      setData(r);
      setFailed(false);
    } catch {
      if (alive.current) setFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [key, load]);
  return { data, failed, reload: load };
}
