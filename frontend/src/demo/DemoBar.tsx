import { useLayoutEffect } from "react";
import { ArrowRight, FlaskConical, Lightbulb, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import { confirmDialog } from "../components/ui";

export const INSTALL_URL = "https://inboxrake.com/docs/install/";

/* A control that stays one bar tall to hit (30 px on phones), whatever it
 * looks like: the pseudo-element grows the touch area, not the pill. */
const HIT = "relative after:absolute after:-inset-1 after:content-['']";

/** The strip above the app and its sidebar while it runs on the in-browser
 *  backend. Fixed at the top; `html[data-demo]` (index.css) moves the body and
 *  the sidebar below it (`--demo-bar-h`), so nothing sits behind it. */
export function DemoBar({ onReset, onTips, onAsk }: {
  onReset: () => void; onTips: () => void;
  /** Reset is about to ask: whatever else is open closes first. */
  onAsk: () => void;
}) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.demo = "";
    return () => { delete root.dataset.demo; };
  }, []);
  const reset = async () => {
    onAsk();
    if (await confirmDialog({
      title: t("demo.reset.title"), body: t("demo.reset.body"),
      confirmLabel: t("demo.reset") })) onReset();
  };
  return (
    <div data-demo-bar className="fixed inset-x-0 top-0 z-(--z-dropdown)
      bg-surface">
      <div className="flex h-(--demo-bar-h) items-center gap-2.5 bg-accent-tint
        px-3 pt-[env(safe-area-inset-top)] type-meta font-semibold text-accent
        sm:gap-3 sm:px-4">
        <span className="inline-flex h-5 shrink-0 items-center gap-1
          rounded-full bg-accent px-2.5 text-on-accent sm:h-6">
          <FlaskConical size={14} aria-hidden />{t("demo.bar.pill")}
        </span>
        <span className="min-w-0 truncate font-medium text-body">
          <span className="max-sm:hidden">{t("demo.bar.text")}</span>
          <span className="sm:hidden">{t("demo.bar.text_short")}</span>
        </span>
        <span className="flex-1" />
        {/* Icon-only on phones (the word stays for screen readers). */}
        <button type="button" onClick={onTips} data-demo-try
          className={`${HIT} inline-flex cursor-pointer items-center gap-1.5
            rounded-full px-1 hover:text-accenth max-sm:after:-inset-x-2.5 max-sm:after:-inset-y-4`}>
          <Lightbulb size={14} aria-hidden />
          <span className="max-sm:sr-only">{t("demo.bar.try")}</span>
        </button>
        {/* Icon-only on phones, where the German word would squeeze the note. */}
        <button type="button" onClick={reset} aria-label={t("demo.reset")}
          className={`${HIT} inline-flex h-5.5 shrink-0 cursor-pointer
            items-center gap-1.5 rounded-full px-3 max-sm:px-2 ring-1 ring-inset
            ring-accent hover:bg-accent-tint max-sm:after:-inset-x-2 max-sm:after:-inset-y-4 sm:h-6.5`}>
          <RotateCcw size={14} aria-hidden />
          <span className="max-sm:sr-only">{t("demo.bar.reset")}</span>
        </button>
        <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer"
          className={`${HIT} inline-flex shrink-0 items-center gap-1 text-body
            hover:text-accent max-sm:hidden`}>
          {t("demo.bar.install")}<ArrowRight size={14} aria-hidden />
        </a>
      </div>
    </div>
  );
}
