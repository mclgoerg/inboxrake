import { useEffect, useRef, type ReactNode } from "react";
import { Lightbulb } from "lucide-react";
import { t } from "../i18n";
import { afterBackSettles } from "../backStack";
import { Button, Modal, useBackLayer, useMediaQuery } from "../components/ui";

const SEEN = "pmc_demo_tip";

/** Whether this browser already got the tip (once per browser). */
export const tipSeen = (): boolean => {
  try { return localStorage.getItem(SEEN) === "1"; } catch { return true; }
};
const markSeen = () => {
  try { localStorage.setItem(SEEN, "1"); } catch { /* private mode: shown again */ }
};

/** `**bold**` spans of a translated string (the strings are the demo's own). */
const rich = (s: string): ReactNode[] => s.split("**").map((part, i) =>
  i % 2 ? <b key={i} className="font-semibold text-body">{part}</b> : part);

function TipBody({ onShow, onClose, wide }: {
  onShow: () => void; onClose: () => void; wide: boolean;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (wide) first.current?.focus(); }, [wide]);
  return (
    <div className="p-4 sm:p-5">
      <h2 className="flex items-center gap-2 type-heading">
        <Lightbulb size={18} aria-hidden className="text-muted" />
        {t("demo.tip.title")}
      </h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 type-body text-muted">
        <li>{rich(t("demo.tip.1"))}</li>
        <li>{rich(t("demo.tip.2"))}</li>
        <li>{rich(t("demo.tip.3"))}</li>
      </ol>
      <div className="mt-4 flex gap-2">
        <Button ref={first} onClick={onShow}>{t("demo.tip.show")}</Button>
        <Button variant="secondary" onClick={onClose}>{t("demo.tip.got")}</Button>
      </div>
    </div>
  );
}

/** "Three things to try": a popover under the demo bar from 1024 px, a bottom
 *  sheet below. Both are overlays Back closes. Any way of closing it counts as
 *  seen; "Things to try" in the bar opens it again. */
export function DemoTip({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const close = () => { markSeen(); onClose(); };
  // The sheet (a Modal) owns its history entry; the popover gets its own.
  useBackLayer(open && wide, close);
  useEffect(() => {
    if (!open || !wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wide]);
  if (!open) return null;
  const show = () => {
    close();
    afterBackSettles(() => { window.location.hash = "#/senders"; });
  };
  if (!wide) {
    return (
      <Modal size="sm" label={t("demo.tip.title")} onClose={close}>
        <TipBody onShow={show} onClose={close} wide={false} />
      </Modal>
    );
  }
  return (
    <div role="dialog" aria-label={t("demo.tip.title")} data-demo-tip
      className="fixed right-4 top-[calc(var(--demo-bar-h)+0.5rem)]
        z-(--z-dropdown) w-84 rounded-card border border-line bg-panel
        shadow-popover">
      <TipBody onShow={show} onClose={close} wide />
    </div>
  );
}
