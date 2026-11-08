/* Back closes the top-most overlay (V8). Below 1024 px every full-screen
   modal, bottom sheet and in-panel reader (a mail, a thread) is a LAYER: it
   owns one browser history entry for as long as it is open, so browser Back,
   Safari's back swipe, Android's system Back and the installed app's edge swipe
   all close exactly the top-most layer and land on the page underneath.

   The entries carry the same URL as the page below them (pushState fires no
   hashchange, so `useNav` never sees them). The module keeps two lists:
   `layers` (what is open, in the order it opened) and `entries` (what we have
   pushed). `reconcile()` makes the history match the layers - it pushes, swaps
   (replaceState) or pops (history.go) - so a layer closing for any reason (its
   own back link, Esc, swipe down, an action) pops its entry and Back never
   leaves a stale one or takes a double step. A pop is asynchronous: anything
   that must write history afterwards queues behind it (`afterBackSettles`). */

import { useLayoutEffect, useRef } from "react";

const MARK = "irkLayer";

interface Layer { key: string; close: () => void }

// Keys are unique per page load: the entries of an earlier load (a reload
// keeps the history) must never match a layer of this one.
const LOAD = Math.random().toString(36).slice(2, 8);

const layers: Layer[] = [];
let entries: string[] = [];
let seq = 0;
let busy = false;                // a history.go() of ours is on its way
let awaiting = false;            // a hash write of ours has not been announced yet
let watchdog: ReturnType<typeof setTimeout> | undefined;
let echoTimer: ReturnType<typeof setTimeout> | undefined;
let queued: (() => void)[] = [];
let scheduled = false;

const stateKey = (s: unknown): string | undefined =>
  (s as Record<string, string> | null)?.[MARK];

const WATCHDOG_MS = 1000;
/** Longest wait for the echo of a hash write that changed nothing. */
const ECHO_MS = 150;

/** Brings the history in line with `layers`, then runs what waited for it. */
function reconcile(): void {
  if (busy) return;
  // Writes that waited for a pop go first; they may wait for their echo.
  while (queued.length && !busy) queued.shift()!();
  // A write's echo still on its way: the history is not settled yet.
  if (busy || awaiting) return;
  let k = 0;
  while (k < entries.length && k < layers.length
    && entries[k] === layers[k].key) k++;
  const extra = entries.length - k;
  if (extra === 1 && layers.length > k) {
    // One layer replaced another in the same tick (Stats -> Wrapped): reuse
    // the entry instead of a back + push.
    window.history.replaceState({ [MARK]: layers[k].key }, "");
    entries[k] = layers[k].key;
  } else if (extra > 0) {
    busy = true;
    // No popstate (the history was shortened under us): resync, don't hang.
    watchdog = setTimeout(() => {
      watchdog = undefined;
      busy = false;
      const at = entries.indexOf(stateKey(window.history.state) ?? "");
      entries = entries.slice(0, at + 1);
      reconcile();
    }, WATCHDOG_MS);
    window.history.go(-extra);
    return;
  }
  for (let i = entries.length; i < layers.length; i++) {
    window.history.pushState({ [MARK]: layers[i].key }, "");
    entries.push(layers[i].key);
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // One commit opens and closes layers in several effects: settle once after.
  queueMicrotask(() => { scheduled = false; reconcile(); });
}

/** Steps back off an entry that belongs to no open layer (Forward onto a
 *  layer that already closed, a leftover of an earlier page load): the stack
 *  and the history agree again, and nothing is closed or re-run. */
function stepOff(): void {
  busy = true;
  watchdog = setTimeout(() => { watchdog = undefined; busy = false; reconcile(); },
    WATCHDOG_MS);
  window.history.back();
}

function onPop(e: PopStateEvent): void {
  clearTimeout(watchdog);
  watchdog = undefined;
  busy = false;
  // The echo of a hash write (state null: a fragment navigation, no Back).
  clearTimeout(echoTimer);
  awaiting = false;
  const landed = stateKey(e.state);
  if (landed && !entries.includes(landed)) { stepOff(); return; }
  const depth = landed ? entries.indexOf(landed) + 1 : 0;
  const gone = entries.slice(depth).reverse();
  entries = entries.slice(0, depth);
  // Our own pop already took its layers out of the list; whatever is still
  // listed was closed by the user's Back: tell its owner (top-most first).
  const closing = gone.map((key) => layers.find((l) => l.key === key))
    .filter((l): l is Layer => !!l);
  closing.forEach((l) => l.close());
  // An owner that refuses (a discard prompt, a save in flight) keeps its layer:
  // after the close had its chance, put the entry back.
  if (closing.length) setTimeout(reconcile, 0);
  else reconcile();
}

/** Opens a layer: one history entry until the returned function is called.
 *  `close` is what Back does (the owner's own close path). */
export function registerBackLayer(close: () => void): () => void {
  const layer: Layer = { key: `${LOAD}.${++seq}`, close };
  layers.push(layer);
  schedule();
  return () => {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    schedule();
  };
}

/** A hash write (or a history.back()) is announced by a `popstate` - browsers
 *  fire one for a fragment navigation too, state null - and takes effect after
 *  the script that made it. An entry pushed before that would land under the
 *  new page and be closed by the echo, so pushes and pops wait for it. */
function awaitEcho(): void {
  awaiting = true;
  clearTimeout(echoTimer);
  // A write that changed nothing is never announced.
  echoTimer = setTimeout(() => { awaiting = false; reconcile(); }, ECHO_MS);
}

/** Runs `go` (a hash write: a page change; a history.back() out of a Settings
 *  section) once the history is clear of layer entries. A page change takes
 *  every layer with it, so their entries are popped first; writing on top of
 *  them would bury them under the new page. Layers opening in the same breath
 *  get their entries after the write has landed. */
export function afterBackSettles(go: () => void): void {
  layers.length = 0;
  reconcile();
  const run = () => { go(); awaitEcho(); };
  if (busy) queued.push(run);
  else run();
}

/** Forgets every layer and entry (tests; the history itself is not touched). */
export function resetBackStack(): void {
  layers.length = 0;
  entries = [];
  queued = [];
  busy = false;
  awaiting = false;
  scheduled = false;
  clearTimeout(watchdog);
  clearTimeout(echoTimer);
  watchdog = undefined;
}

/** Stops listening (tests that load a second copy of the module). */
export function disposeBackStack(): void {
  window.removeEventListener("popstate", onPop);
}

/** True while a pop of ours is on its way (tests await it). */
export const backStackBusy = (): boolean => busy || awaiting;

/** A layer while `active`: Back calls `close`. The caller decides `active`
 *  (`useBackLayer` in ui.tsx: below 1024 px, a real overlay). */
export function useLayer(active: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useLayoutEffect(() => {
    if (!active) return;
    return registerBackLayer(() => latest.current());
  }, [active]);
}

// From the first load: leftovers of an earlier load (the history survives a
// reload, our layers do not) are stepped off one by one until none is current.
if (typeof window !== "undefined") {
  window.addEventListener("popstate", onPop);
  if (stateKey(window.history.state)) stepOff();
}
