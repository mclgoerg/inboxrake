import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMediaQuery } from "./components/ui";

/** Tools that open as a page beside the sidebar (from 1024 px; below it they
 *  stay modals). */
export type ToolPage = "search" | "triage" | "duplicates" | "attachments"
  | "rules" | "junk" | "trash" | "stats" | "space" | "trackers" | "activity";

export const TOOL_PAGES: readonly ToolPage[] = ["search", "triage",
  "duplicates", "attachments", "rules", "junk", "trash", "stats", "space",
  "trackers", "activity"];

/** Pages of the app shell. `settings` is a page of its own (not a tool): from
 *  1024 px a section column beside the form, below it an iOS-style root list
 *  that drills down into one section. */
export type Page = "overview" | "senders" | "all" | "cleanup" | "insights"
  | ToolPage | "settings";

export const PAGES: readonly Page[] = ["overview", "senders", "all", "cleanup",
  "insights", ...TOOL_PAGES, "settings"];
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

/** The sections of the Settings page, in the order of its section column. */
export type SettingsSection = "account" | "general" | "notifications"
  | "protected" | "categories" | "filed" | "digest" | "autoscan" | "ai"
  | "signin" | "backup";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = ["account",
  "general", "notifications", "protected", "categories", "filed", "digest",
  "autoscan", "ai", "signin", "backup"];

/** `#/settings/ai` -> { section: "ai" }; `#/settings/account/work` -> the
 *  account section for the account "work" (the name is URI-encoded). A
 *  missing or unknown section is null (the root list on phones). */
export function parseSettingsRoute(hash: string):
  { section: SettingsSection | null; account: string | null } {
  const [page, section, account] = hash.replace(/^#\/?/, "").split("/");
  const s = SETTINGS_SECTIONS.find((x) => x === section);
  if (page !== "settings" || !s) return { section: null, account: null };
  let name: string | null = null;
  try { name = account ? decodeURIComponent(account) : null; } catch { /* keep null */ }
  return { section: s, account: s === "account" ? name : null };
}

export const settingsHash = (section?: SettingsSection | null,
  account?: string | null): string =>
  section ? `#/settings/${section}${section === "account" && account
    ? `/${encodeURIComponent(account)}` : ""}` : "#/settings";

/** The Settings route (section + account) of the URL hash, kept in sync with
 *  back / forward. */
export function useSettingsRoute() {
  const read = () => parseSettingsRoute(window.location.hash);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute((old) => {
      const next = read();
      return old.section === next.section && old.account === next.account
        ? old : next;
    });
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Moves within Settings. Switching sections beside the section column
 *  replaces the history entry (no Back trail per click); drilling into a
 *  section from the phone root list pushes one (Back = the root list). */
export function gotoSettings(section: SettingsSection | null,
  account: string | null = null, push = false): void {
  const hash = settingsHash(section, account);
  if (push) window.location.hash = hash;
  else window.location.replace(hash);
}

/** `#/senders` -> "senders"; anything else (empty, unknown) -> null. */
export function parseHash(hash: string): Page | null {
  const name = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return PAGES.find((p) => p === name) ?? null;
}

export const hashOf = (page: Page): string => `#/${page}`;

/** The current page and a setter. The URL hash is the source of truth, so
 *  back/forward and reloads keep the page; no router dependency. An empty or
 *  unknown hash shows `initial` without rewriting the URL. */
export function useNav(initial: Page = DEFAULT_PAGE,
  /** Asked before a hash change LEAVES the current page (browser Back /
   *  Forward, a typed URL); false keeps the page - the guard then decides
   *  what happens (Settings with unsaved changes) and navigates itself. */
  guard?: RefObject<((to: Page) => boolean) | null>):
  [Page, (p: Page) => void] {
  // Frozen at mount: the caller's fallback may follow the page itself (the
  // persisted view), and Back to an empty hash must land on the start page.
  const [fallback] = useState(initial);
  const read = () => parseHash(window.location.hash) ?? fallback;
  const [page, setPageState] = useState<Page>(read);
  const shown = useRef(page);
  shown.current = page;
  useEffect(() => {
    const on = () => {
      const next = read();
      if (next !== shown.current && guard?.current
          && !guard.current(next)) {
        // Step back onto the page the guard keeps; the hashchange this causes
        // finds the same page and does nothing.
        window.history.go(1);
        return;
      }
      setPageState(next);
    };
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
