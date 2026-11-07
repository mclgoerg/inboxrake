import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "./components/ui";

/** Tools that open as a page beside the sidebar (from 1024 px; below it they
 *  stay modals). */
export type ToolPage = "search" | "triage" | "duplicates" | "attachments"
  | "rules" | "junk" | "trash" | "stats" | "space" | "trackers" | "activity";

export const TOOL_PAGES: readonly ToolPage[] = ["search", "triage",
  "duplicates", "attachments", "rules", "junk", "trash", "stats", "space",
  "trackers", "activity"];

/** Pages of the app shell. */
export type Page = "overview" | "senders" | "all" | "cleanup" | "insights"
  | ToolPage;

export const PAGES: readonly Page[] = ["overview", "senders", "all", "cleanup",
  "insights", ...TOOL_PAGES];
export const isToolPage = (p: Page): p is ToolPage =>
  (TOOL_PAGES as readonly Page[]).includes(p);
/** The phone / tablet tab pages: lists of tools. The sidebar shows the same
 *  items, so from 1024 px these routes fall back to the default page. */
export const TAB_PAGES: readonly Page[] = ["cleanup", "insights"];
export const isTabPage = (p: Page): boolean => TAB_PAGES.includes(p);
/** The tab page (below 1024 px) that lists each tool; Search has none. */
export const TOOL_TAB: Partial<Record<ToolPage, Page>> = {
  triage: "cleanup", duplicates: "cleanup", attachments: "cleanup",
  rules: "cleanup", junk: "cleanup", trash: "cleanup",
  stats: "insights", space: "insights", trackers: "insights",
  activity: "insights",
};
/** The start page for everyone: a fresh load without a route lands here. */
export const DEFAULT_PAGE: Page = "overview";

/** `#/senders` -> "senders"; anything else (empty, unknown) -> null. */
export function parseHash(hash: string): Page | null {
  const name = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return PAGES.find((p) => p === name) ?? null;
}

export const hashOf = (page: Page): string => `#/${page}`;

/** The current page and a setter. The URL hash is the source of truth, so
 *  back/forward and reloads keep the page; no router dependency. An empty or
 *  unknown hash shows `initial` without rewriting the URL. */
export function useNav(initial: Page = DEFAULT_PAGE): [Page, (p: Page) => void] {
  // Frozen at mount: the caller's fallback may follow the page itself (the
  // persisted view), and Back to an empty hash must land on the start page.
  const [fallback] = useState(initial);
  const read = () => parseHash(window.location.hash) ?? fallback;
  const [page, setPageState] = useState<Page>(read);
  useEffect(() => {
    const on = () => setPageState(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The tab pages don't exist from 1024 px: replace their history entry with
  // the start page, so Back never lands on a route that shows nothing of its own.
  const wide = useSidebar();
  useEffect(() => {
    if (!wide || !isTabPage(page)) return;
    window.history.replaceState(window.history.state, "",
      hashOf(DEFAULT_PAGE));
    setPageState(DEFAULT_PAGE);
  }, [wide, page]);
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    if (parseHash(window.location.hash) !== p)
      window.location.hash = hashOf(p);
  }, []);
  return [page, setPage];
}

/** From here the sidebar is the navigation (Tailwind `lg`); below it the
 *  top bar and the bottom tab bar are. */
export const SIDEBAR_QUERY = "(min-width: 1024px)";
export const SIDEBAR_W = 244;

export const useSidebar = () => useMediaQuery(SIDEBAR_QUERY);
