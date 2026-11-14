/* Web Push (backend/webpush.py): notifications that arrive with the app
 * closed - on an iPhone too, where a backgrounded page is frozen within
 * seconds and can notify nobody.
 *
 * `pmc_notify` (localStorage, per browser): "0" off, "push" Web Push, "1" the
 * older page-side Notification (App.tsx), kept for a browser that has
 * Notification but no PushManager.
 *
 * On iOS the permission prompt must start inside the tap, and awaiting
 * anything first can consume the gesture (NotAllowedError). The registration
 * (cached at start) and the server key (prefetched when the section opens)
 * are therefore kept in plain variables, so `enablePush` can make
 * `pushManager.subscribe()` - which shows the prompt itself while permission
 * is "default" - its very first await. Only if either is not cached yet does
 * it fall back to requestPermission() first, then fetch what is missing. */

import { api } from "./api";

export const NOTIFY_KEY = "pmc_notify";
export type PushSupport = "ok" | "home_screen" | "insecure" | "unsupported";

export const pushMode = (): boolean =>
  localStorage.getItem(NOTIFY_KEY) === "push";

/** Whether this browser can do Web Push, and if not, why - the settings row
 *  tells the person what to do about it. */
export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return "insecure";
  if ("serviceWorker" in navigator && "PushManager" in window
      && typeof Notification !== "undefined") return "ok";
  // iOS / iPadOS only get PushManager for an app on the Home Screen
  // (16.4+); in a Safari tab there is none, and neither is Notification.
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return "unsupported";
  const ios = nav.standalone === false
    || /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios ? "home_screen" : "unsupported";
}

/** Register the (tiny) service worker as early as possible: a push needs one,
 *  and a first tap on "turn on" must not wait for it. Never in the demo. */
export function registerServiceWorker(): void {
  if (import.meta.env.VITE_DEMO === "1") return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
  void navigator.serviceWorker.ready.then((r) => { readyReg = r; },
    () => {});
}

let readyReg: ServiceWorkerRegistration | null = null;
let keyValue = "";

const b64u = (buf: ArrayBuffer | null | undefined): string => {
  if (!buf) return "";
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const keyBytes = (key: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

let keyPromise: Promise<string> | null = null;

/** Fetch the server's key ahead of the tap (when the section opens). */
export function prefetchPushKey(): Promise<string> {
  keyPromise ??= api.pushKey().then((r) => { keyValue = r.key; return r.key; }, (e) => {
    keyPromise = null;                  // try again at the tap
    throw e;
  });
  return keyPromise;
}

// The endpoint of this browser's subscription, for presence (which must not
// wait for a lookup when the page is being hidden).
let endpoint = "";

async function subscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function subscribe(key: string): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: keyBytes(key) });
}

async function register(sub: PushSubscription, lang: string): Promise<void> {
  const j = sub.toJSON();
  await api.pushSubscribe({
    endpoint: sub.endpoint,
    keys: { p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "" }, lang });
  endpoint = sub.endpoint;
}

/** Turn notifications on for this device. "denied" when the person said no
 *  (or it is blocked); anything else that goes wrong throws. */
export async function enablePush(lang: string): Promise<"granted" | "denied"> {
  let sub: PushSubscription;
  if (readyReg && keyValue) {
    // nothing awaited before this: the tap's gesture is still alive
    try {
      sub = await readyReg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: keyBytes(keyValue) });
    } catch (e) {
      if (Notification.permission === "denied"
          || ((e as Error).name === "NotAllowedError"
            && Notification.permission !== "granted")) return "denied";
      throw e;
    }
  } else {
    const perm = await Notification.requestPermission();   // FIRST: see above
    if (perm !== "granted") return "denied";
    sub = await subscribe(await prefetchPushKey());
  }
  try {
    await register(sub, lang);
  } catch (e) {
    await sub.unsubscribe().catch(() => {});   // don't keep a half-made one
    throw e;
  }
  localStorage.setItem(NOTIFY_KEY, "push");
  sendPresence(!document.hidden);
  return "granted";
}

/** Turn notifications off for this device (also best effort on logout). */
export async function disablePush(): Promise<void> {
  localStorage.setItem(NOTIFY_KEY, "0");
  const had = endpoint;
  endpoint = "";
  try {
    const sub = await subscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    } else if (had) {
      await api.pushUnsubscribe(had).catch(() => {});
    }
  } catch { /* nothing more to undo */ }
}

/** App start: keep what the browser holds and what the server knows in step.
 *  Never throws. */
export async function syncPush(lang: string): Promise<void> {
  try {
    const mode = localStorage.getItem(NOTIFY_KEY);
    if (mode !== "push" && mode !== "1") return;
    if (pushSupport() !== "ok" || Notification.permission !== "granted") {
      if (mode === "push") localStorage.setItem(NOTIFY_KEY, "0");
      return;
    }
    let sub = await subscription();
    if (mode === "push" && !sub) {         // the browser dropped it
      localStorage.setItem(NOTIFY_KEY, "0");
      return;
    }
    const key = await prefetchPushKey();
    if (sub && b64u(sub.options?.applicationServerKey) !== key) {
      // The server's key changed (a new data folder): subscribe afresh.
      const old = sub.endpoint;
      await sub.unsubscribe();
      await api.pushUnsubscribe(old).catch(() => {});
      sub = null;
    }
    sub ??= await subscribe(key);
    await register(sub, lang);
    if (mode === "1") localStorage.setItem(NOTIFY_KEY, "push");   // upgraded
    sendPresence(!document.hidden);
  } catch {
    /* legacy mode stays as it was; push mode retries at the next start */
  }
}

/** The test notification for this device. */
export async function sendTestPush(): Promise<void> {
  const sub = await subscription();
  if (!sub) throw new Error("no subscription");
  await api.pushTest(sub.endpoint);
}

/** Tell the server whether this device is looking at the app (it sends no
 *  push then). Push mode only; `keepalive` lets "hidden" leave a page that is
 *  being frozen. */
export function sendPresence(visible: boolean): void {
  if (!pushMode() || !endpoint) return;
  void api.pushPresence(endpoint, visible).catch(() => {});
}

/** Keep the server's picture of "looking at the app" fresh while the page
 *  lives. Returns the cleanup. */
export function watchPresence(): () => void {
  const onVisibility = () => sendPresence(!document.hidden);
  const onShow = () => { if (!document.hidden) sendPresence(true); };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onShow);
  const timer = window.setInterval(() => {
    if (!document.hidden) sendPresence(true);
  }, 25_000);
  sendPresence(!document.hidden);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onShow);
    window.clearInterval(timer);
  };
}
