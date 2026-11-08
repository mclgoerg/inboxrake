import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useSidebar } from "./components/ui";
import { afterBackSettles } from "./backStack";

export { SIDEBAR_QUERY, SIDEBAR_W, useSidebar } from "./components/ui";

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
  // A dialog that just closed (the unsaved-edits prompt) pops its entry first.
  afterBackSettles(() => {
    if (push) window.location.hash = hash;
    else window.location.replace(hash);
  });
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
  // The URL of the last page state we accepted: where a vetoed change returns.
  const kept = useRef(window.location.hash);
  useEffect(() => {
    const on = () => {
      const next = read();
      if (next !== shown.current && guard?.current
          && !guard.current(next)) {
        // Put the kept page's URL back on top of the history (Back and Forward
        // alike; pushState fires no hashchange).
        window.history.pushState(null, "", kept.current);
        return;
      }
      kept.current = window.location.hash;
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
    kept.current = hashOf(p);
    // A page change takes the open overlays (and their history entries) with
    // it: the hash is written once those are popped (`backStack.ts`).
    if (parseHash(window.location.hash) !== p)
      afterBackSettles(() => { window.location.hash = hashOf(p); });
  }, []);
  return [page, setPage];
}

/** Scroll positions per page (iOS-like). Opening a page - a tool, a settings
 *  section, a tab - starts at the top; Back (browser, in-app, Esc) restores
 *  the position the page you return to had. The scrollers are `body` and
 *  every element tagged `data-scroll-id` (wide Settings, tool panels, lists);
 *  positions live in memory, per page route. */
const SCROLL_BODY = "body";
const RESTORE_MS = 2000;
const USER_SCROLL = ["wheel", "touchstart", "keydown", "pointerdown"];
let restoreNext = false;
let entrySeq = 0;

/** The next route change is a return (Esc / close button), not a fresh
 *  open: restore the position that page had. Browser Back / Forward need no
 *  hint - their history entries are recognised. */
export const restoreScrollOnNext = (): void => { restoreNext = true; };

const scrollers = (): [string, HTMLElement][] => {
  const out: [string, HTMLElement][] = [[SCROLL_BODY, document.body]];
  const seen = new Set<string>();
  document.querySelectorAll<HTMLElement>("[data-scroll-id]").forEach((el) => {
    const id = el.dataset.scrollId!;
    if (seen.has(id)) return;
    seen.add(id);
    out.push([id, el]);
  });
  return out;
};

/** Call with a key that changes whenever the page / section changes. */
export function useScrollPerPage(routeKey: string): void {
  const positions = useRef(new Map<string, Map<string, number>>());
  const current = useRef(routeKey);
  // While a restore is settling (lists load late), clamped scroll events
  // must not overwrite what is being restored.
  const settling = useRef(false);
  useEffect(() => {
    const on = (e: Event) => {
      if (settling.current) return;
      const el = e.target as HTMLElement | null;
      if (!el || !(el instanceof HTMLElement)) return;
      const id = el === document.body ? SCROLL_BODY
        : el.closest<HTMLElement>("[data-scroll-id]") === el
          ? el.dataset.scrollId! : null;
      if (!id) return;
      let m = positions.current.get(current.current);
      if (!m) positions.current.set(current.current, m = new Map());
      m.set(id, el.scrollTop);
    };
    document.addEventListener("scroll", on, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", on, true);
  }, []);
  const first = useRef(true);
  useLayoutEffect(() => {
    // An entry carries a mark once it has been shown; a fresh push has none.
    const st = (window.history.state ?? {}) as { scrollEntry?: number };
    const revisit = st.scrollEntry !== undefined || restoreNext;
    restoreNext = false;
    if (st.scrollEntry === undefined)
      window.history.replaceState({ ...st, scrollEntry: ++entrySeq }, "");
    const was = current.current;
    current.current = routeKey;
    if (first.current) { first.current = false; return; }
    if (was === routeKey) return;
    const want = revisit ? positions.current.get(routeKey) : undefined;
    // Late content (a list that loads after the route change) is too short
    // to scroll yet: keep trying until each scroller can reach its saved
    // position, for at most RESTORE_MS, and give up on the first user scroll.
    const done = new Set<string>();
    const t0 = performance.now();
    settling.current = true;
    let raf = 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      settling.current = false;
      for (const ev of USER_SCROLL)
        document.removeEventListener(ev, stop, true);
    };
    for (const ev of USER_SCROLL)
      document.addEventListener(ev, stop, { capture: true, passive: true });
    const tick = () => {
      const late = performance.now() - t0 > RESTORE_MS;
      for (const [id, el] of scrollers()) {
        if (done.has(id)) continue;
        const target = want?.get(id) ?? 0;
        if (late || el.scrollHeight - el.clientHeight >= target) {
          el.scrollTop = target;
          done.add(id);
        }
      }
      const wanted = [SCROLL_BODY, ...(want?.keys() ?? [])];
      if (late || wanted.every((id) => done.has(id))) stop();
      else raf = requestAnimationFrame(tick);
    };
    tick();
    return stop;
  }, [routeKey]);
}
