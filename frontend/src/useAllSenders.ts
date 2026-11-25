import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AllSendersResp } from "./types";

/** The Sender rows of every account in one list (`GET
 *  /api/accounts/senders`), for the Senders page across accounts.
 *
 *  `enabled`: the page is showing. `follow`: a string that changes when any
 *  account's data did (their `groups_rev`s, from the Overview numbers): the
 *  list is read again then, so a finished scan or a move shows up without a
 *  reload. A read that was overtaken by a newer one is dropped. */
export function useAllSenders(enabled: boolean, follow: string) {
  const [data, setData] = useState<AllSendersResp | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  // what `follow` was when the page last read (null: the page is not showing)
  const seen = useRef<string | null>(null);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await api.accountsSenders();
      if (mine !== seq.current) return;
      setData(r);
      setFailed(false);
    } catch {
      if (mine === seq.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      seq.current++;
      seen.current = null;
      setData(null);
      return;
    }
    const was = seen.current;
    seen.current = follow;
    // the numbers that follow arriving for the first time are no change of
    // the data: the read that opened the page is still the current one
    if (was === "") return;
    void load();
  }, [enabled, follow, load]);

  return { data, failed, reload: load };
}
