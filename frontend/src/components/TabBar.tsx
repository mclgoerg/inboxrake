import { BarChart3, LayoutDashboard, Users, Wand2 } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { hashOf, type Page } from "../nav";
import { t } from "../i18n";
import { useBulkBarHeight } from "./ui";

const TABS: { page: Page; icon: ReactNode; label: string }[] = [
  { page: "overview", icon: <LayoutDashboard size={18} aria-hidden />,
    label: "nav.overview" },
  { page: "senders", icon: <Users size={18} aria-hidden />,
    label: "nav.senders" },
  { page: "cleanup", icon: <Wand2 size={18} aria-hidden />,
    label: "tools.group_cleanup" },
  { page: "insights", icon: <BarChart3 size={18} aria-hidden />,
    label: "tools.group_insights" },
];

/** The bottom tab bar below 1024 px (iOS pattern): translucent, safe-area
 *  padded, 44 px targets. Publishes its height as `--tabbar-h` (page padding,
 *  toasts). Mount it only while it is visible - the app unmounts it while
 *  something is selected and the selection bar takes the bottom. "All mail"
 *  is a segment of the Senders page, so it keeps the Senders tab current. */
export function TabBar({ page, onPage }: {
  page: Page; onPage: (p: Page) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useBulkBarHeight(ref, true, "--tabbar-h");
  const current = page === "all" ? "senders" : page;
  return (
    <nav ref={ref} aria-label={t("nav.label")}
      className="pmc-tabbar fixed inset-x-0 bottom-0 z-(--z-bulkbar) flex
        border-t bar-glass px-2 pt-1"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.25rem)" }}>
      {TABS.map((tab) => (
        <a key={tab.page} href={hashOf(tab.page)}
          aria-current={current === tab.page ? "page" : undefined}
          className={`flex min-h-11 flex-1 flex-col items-center justify-center
            gap-0.5 rounded-control type-caption font-medium transition-colors
            ${current === tab.page ? "text-accent" : "text-muted"}`}
          onClick={(e) => {
            // Plain taps go through the app (selection / detail reset).
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onPage(tab.page);
          }}>
          {tab.icon}
          {t(tab.label)}
        </a>
      ))}
    </nav>
  );
}
