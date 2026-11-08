import { useEffect, useRef, useState } from "react";
import { GESTURE_SLOP, prefersReducedMotion } from "../gestures";
import { t } from "../i18n";
import { isModalOpen, Ring } from "./ui";

const THRESHOLD = 72;    // px of pull that arms the scan
const MAX_PULL = 120;    // the indicator never travels further than this
const RESISTANCE = 0.5;  // the finger moves twice as far as the indicator

/** Pull to scan: a vertical drag down from the very top of the page (the
 *  scroll container is `body`) shows a progress ring that fills as the pull
 *  nears the threshold; releasing past it calls `onPull` - the handler of the
 *  Scan button, so busy states and feedback are the button's. Touch events
 *  (a scroll can only be stopped from a non-passive touchmove). Not while a
 *  dialog is open, when the gesture is sideways (a swipe row), or when it
 *  started below the top of the page. Reduced motion: the indicator does not
 *  slide, and the ring shows the same progress. Renders only the indicator. */
export function PullToScan({ enabled, onPull }: {
  enabled: boolean; onPull: () => void;
}) {
  const [pull, setPull] = useState(0);
  const latest = useRef({ enabled, onPull });
  latest.current = { enabled, onPull };

  useEffect(() => {
    if (!enabled) { setPull(0); return; }
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let dist = 0;
    const reset = () => { start = null; pulling = false; dist = 0; setPull(0); };
    const onStart = (e: TouchEvent) => {
      reset();
      if (e.touches.length !== 1 || isModalOpen()) return;
      if (document.body.scrollTop > 0) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1 || isModalOpen()) { reset(); return; }
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!pulling) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < GESTURE_SLOP) return;
        // Up, sideways or into the page: a scroll or a row swipe, not ours.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || document.body.scrollTop > 0) {
          start = null;
          return;
        }
        pulling = true;
      }
      // Without this the browser scrolls / rubber-bands under the finger.
      if (e.cancelable) e.preventDefault();
      dist = Math.min(MAX_PULL, dy * RESISTANCE);
      setPull(dist);
    };
    const onEnd = () => {
      const fire = pulling && dist >= THRESHOLD * RESISTANCE;
      reset();
      if (fire && latest.current.enabled) latest.current.onPull();
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", reset);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, [enabled]);

  if (pull <= 0) return null;
  const frac = Math.min(1, pull / (THRESHOLD * RESISTANCE));
  const armed = frac >= 1;
  return (
    <div aria-hidden data-pull-to-scan
      className="pointer-events-none fixed inset-x-0 z-(--z-bulkbar) flex
        flex-col items-center gap-1"
      // below the phone top bar, which publishes its height (0 elsewhere)
      style={{ top: "calc(env(safe-area-inset-top) + 8px + var(--topbar-h, 0px))",
        opacity: frac,
        transform: prefersReducedMotion() ? undefined
          : `translateY(${pull - 24}px)` }}>
      <div className="rounded-full border border-line bg-panel p-1 shadow-popover">
        <Ring frac={frac} px={32} />
      </div>
      <span className="rounded-full bg-panel px-2 py-0.5 type-meta text-muted">
        {t(armed ? "pull.release" : "pull.hint")}
      </span>
    </div>
  );
}
