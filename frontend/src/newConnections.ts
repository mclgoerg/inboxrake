import { useEffect, useRef } from "react";
import { api } from "./api";
import type { AssistantToken } from "./types";

/** How often the open page looks for a hosted app that just connected. */
export const CONNECTION_POLL_MS = 30_000;

/** A hosted app's connection that appears while the page is open (the server
 *  alerts by Web Push and email; this is the in-app part). Looks at the list
 *  when it starts, then every 30 s while the page is in view and when it comes
 *  back into view; the connections already there at the start are not new.
 *  Only runs while `enabled` (OAuth on, signed in), so nothing asks otherwise. */
export function useNewConnections(enabled: boolean,
    onNew: (grant: AssistantToken) => void): void {
  const handler = useRef(onNew);
  handler.current = onNew;
  useEffect(() => {
    if (!enabled) return;
    let seen: Set<string> | null = null;
    let live = true;
    const look = async () => {
      if (document.hidden) return;
      let list: AssistantToken[];
      try { list = (await api.assistantTokens()).tokens; } catch { return; }
      if (!live) return;
      const grants = list.filter((tk) => tk.kind === "oauth");
      const first = seen === null;
      const known: Set<string> = seen ?? new Set();
      for (const g of grants) {
        if (!known.has(g.id) && !first) handler.current(g);
        known.add(g.id);
      }
      seen = known;
    };
    void look();
    const timer = setInterval(() => void look(), CONNECTION_POLL_MS);
    document.addEventListener("visibilitychange", look);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", look);
    };
  }, [enabled]);
}
