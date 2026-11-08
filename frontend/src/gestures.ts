/* Touch gestures of the phone shell (V5): the shared constants, and the
   edge swipe back. Row swipes live in `SwipeRow` (components/ui.tsx), pull to
   scan in `PullToScan`. Every gesture is a shortcut: the button path it
   mirrors stays, and a gesture only ever calls the handler of that button
   (confirms, guards and undo included). */

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

/** Px a finger must travel before a move counts as a gesture. */
export const GESTURE_SLOP = 8;
/** The left strip that starts an edge swipe back (px). Row swipes ignore it. */
export const EDGE_PX = 20;

const REDUCED = "(prefers-reduced-motion: reduce)";
export const prefersReducedMotion = (): boolean =>
  !!window.matchMedia?.(REDUCED).matches;

/** Running as an installed app (home-screen web app): there is no browser
 *  chrome, so nothing but us answers an edge swipe. In a browser tab Safari's
 *  own back gesture walks the history and must not be doubled. */
export const isStandalone = (): boolean =>
  !!window.matchMedia?.("(display-mode: standalone)").matches
  || (navigator as { standalone?: boolean }).standalone === true;

/** True on a touch screen (the primary pointer is coarse). One shared
 *  listener however many rows ask (a list can hold a thousand `SwipeRow`s). */
const COARSE = "(pointer: coarse)";
const coarseSubs = new Set<() => void>();
let coarseQuery: MediaQueryList | null = null;
const onCoarse = () => coarseSubs.forEach((f) => f());
function subscribeCoarse(f: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  if (!coarseSubs.size) {
    coarseQuery = window.matchMedia(COARSE);
    coarseQuery.addEventListener("change", onCoarse);
  }
  coarseSubs.add(f);
  return () => {
    coarseSubs.delete(f);
    if (!coarseSubs.size) {
      coarseQuery?.removeEventListener("change", onCoarse);
      coarseQuery = null;
    }
  };
}
const coarseNow = () => typeof window.matchMedia === "function"
  && window.matchMedia(COARSE).matches;
export const useCoarsePointer = (): boolean =>
  useSyncExternalStore(subscribeCoarse, coarseNow, () => false);

/* ------------------------------ edge swipe back --------------------------- */

interface EdgeEntry {
  el: RefObject<HTMLElement | null>;
  back: () => void;
  active: () => boolean;
}

/** Pages that can be swiped away, oldest first: the last one is on top. */
const edgeStack: EdgeEntry[] = [];

const EDGE_FRACTION = 0.35;   // of the page width
const EDGE_FLICK = 0.5;       // px/ms

let edgeGesture: { id: number; x: number; y: number; dragging: boolean;
  entry: EdgeEntry; samples: { t: number; x: number }[] } | null = null;
let edgeSettle: ReturnType<typeof setTimeout> | undefined;

function edgeShow(el: HTMLElement, dx: number, ms: number) {
  if (prefersReducedMotion()) return;
  el.style.transition = ms ? `transform ${ms}ms ease-out` : "none";
  el.style.transform = dx ? `translateX(${dx}px)` : "";
}

function edgeStop() {
  window.removeEventListener("pointermove", edgeMove);
  window.removeEventListener("pointerup", edgeUp);
  window.removeEventListener("pointercancel", edgeCancel);
  edgeGesture = null;
}

function edgeDown(e: PointerEvent) {
  if (edgeGesture || e.pointerType === "mouse" || !e.isPrimary) return;
  if (e.clientX > EDGE_PX || !isStandalone()) return;
  const entry = edgeStack[edgeStack.length - 1];
  // Only the page on top, and only while nothing (a confirm, a menu) covers
  // it: a swipe must never act on what the user cannot see.
  if (!entry || !entry.active() || !entry.el.current) return;
  edgeGesture = { id: e.pointerId, x: e.clientX, y: e.clientY,
    dragging: false, entry, samples: [{ t: e.timeStamp, x: e.clientX }] };
  window.addEventListener("pointermove", edgeMove);
  window.addEventListener("pointerup", edgeUp);
  window.addEventListener("pointercancel", edgeCancel);
}

function edgeMove(e: PointerEvent) {
  const g = edgeGesture;
  if (!g || e.pointerId !== g.id) return;
  const dx = e.clientX - g.x, dy = e.clientY - g.y;
  if (!g.dragging) {
    if (Math.abs(dx) < GESTURE_SLOP && Math.abs(dy) < GESTURE_SLOP) return;
    // Backwards or mostly vertical: a scroll, not ours.
    if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) { edgeStop(); return; }
    g.dragging = true;
  }
  g.samples.push({ t: e.timeStamp, x: e.clientX });
  if (g.samples.length > 6) g.samples.shift();
  const el = g.entry.el.current;
  if (el) edgeShow(el, Math.max(0, dx), 0);
}

function edgeUp(e: PointerEvent) {
  const g = edgeGesture;
  if (!g || e.pointerId !== g.id) return;
  edgeStop();
  if (!g.dragging) return;
  const el = g.entry.el.current;
  const dx = Math.max(0, e.clientX - g.x);
  const first = g.samples.find((s) => e.timeStamp - s.t <= 100) ?? g.samples[0];
  const dt = e.timeStamp - first.t;
  const flick = dt > 0 && (e.clientX - first.x) / dt >= EDGE_FLICK;
  const width = el?.offsetWidth || window.innerWidth;
  if (dx > width * EDGE_FRACTION || flick) {
    g.entry.back();
    // A back that does not unmount the page (a refused close) must not leave
    // it stuck half off-screen.
    clearTimeout(edgeSettle);
    edgeSettle = setTimeout(() => { if (el?.isConnected) edgeShow(el, 0, 200); },
      250);
  } else if (el) edgeShow(el, 0, 200);
}

function edgeCancel(e: PointerEvent) {
  const g = edgeGesture;
  if (!g || e.pointerId !== g.id) return;
  const was = g.dragging;
  edgeStop();
  const el = g.entry.el.current;
  if (was && el) edgeShow(el, 0, 200);
}

/** The browser claims a horizontal touch near the edge unless the first
 *  touchmove is cancelled: do that for our own gesture. */
function edgeTouch(e: TouchEvent) {
  const g = edgeGesture;
  const f = e.touches[0];
  if (!g || !f || !e.cancelable) return;
  const dx = f.clientX - g.x, dy = f.clientY - g.y;
  if (g.dragging || (dx > GESTURE_SLOP && dx > Math.abs(dy))) e.preventDefault();
}

const edgeAttach = () => {
  document.addEventListener("pointerdown", edgeDown, true);
  document.addEventListener("touchmove", edgeTouch, { passive: false });
};
const edgeDetach = () => {
  document.removeEventListener("pointerdown", edgeDown, true);
  document.removeEventListener("touchmove", edgeTouch);
  edgeStop();
};

/** Makes a full-screen page swipe-back-able: a drag from the left edge (20 px)
 *  slides `el` away with the finger and, past a third of the width or a
 *  flick, calls `back` - the handler of the page's own back link, so a
 *  swipe takes exactly the path a tap does. Only while running as an
 *  installed app (`isStandalone`; browsers have their own back gesture), only
 *  for the page on top and only while `active()` holds (nothing covers it).
 *  Reduced motion: the page does not follow, the distance alone decides. */
export function useEdgeBack(el: RefObject<HTMLElement | null>,
    back: () => void, enabled = true, active: () => boolean = () => true) {
  const latest = useRef({ back, active });
  latest.current = { back, active };
  useEffect(() => {
    if (!enabled) return;
    const entry: EdgeEntry = { el, back: () => latest.current.back(),
      active: () => latest.current.active() };
    if (!edgeStack.length) edgeAttach();
    edgeStack.push(entry);
    return () => {
      edgeStack.splice(edgeStack.indexOf(entry), 1);
      if (edgeGesture?.entry === entry) edgeStop();
      if (!edgeStack.length) edgeDetach();
    };
  }, [enabled, el]);
}
