// @vitest-environment jsdom
/* Web Push on the page side (push.ts): what this browser can do, the order
 * of a first "turn on" (iOS needs the permission prompt inside the tap), and
 * keeping the browser's subscription and the server in step. */

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const calls: string[] = [];
const h = vi.hoisted(() => ({
  key: "BAUG",                          // base64url of 3 bytes: 04 05 06
  subscribed: [] as unknown[],
  unsub: [] as string[],
  presence: [] as [string, boolean][],
  tested: [] as string[],
  keyFetches: 0,
  failSubscribe: false,
  subscribeError: null as Error | null,
}));
vi.mock("./api", () => ({
  api: {
    pushKey: () => { calls.push("api.key"); h.keyFetches++;
      return Promise.resolve({ key: h.key }); },
    pushSubscribe: (b: unknown) => { calls.push("api.subscribe");
      if (h.failSubscribe) return Promise.reject(new Error("nope"));
      h.subscribed.push(b); return Promise.resolve({ ok: true }); },
    pushUnsubscribe: (e: string) => { calls.push("api.unsubscribe");
      h.unsub.push(e); return Promise.resolve({ ok: true }); },
    pushTest: (e: string) => { h.tested.push(e); return Promise.resolve({ ok: true }); },
    pushPresence: (e: string, v: boolean) => { h.presence.push([e, v]);
      return Promise.resolve(new Response()); },
  },
}));

const END = "https://web.push.example/abc";
let existing: ReturnType<typeof fakeSub> | null;
let registerCalls: string[];
let permission: NotificationPermission;
let requestPermission: () => Promise<NotificationPermission>;

function fakeSub(key = "BAUG", endpoint = END) {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return {
    endpoint,
    options: { applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "P", auth: "A" } }),
    unsubscribe: vi.fn(() => { calls.push("sub.unsubscribe"); return Promise.resolve(true); }),
  };
}

function setUA(ua: string, touch = 0, standalone?: boolean) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: touch, configurable: true });
  Object.defineProperty(navigator, "standalone", { value: standalone, configurable: true });
}
function setCapable(on: boolean) {
  if (on) {
    (window as any).PushManager = class {};
    const N = function () {};
    Object.defineProperty(N, "permission", { get: () => permission });
    (N as any).requestPermission = () => requestPermission();
    (globalThis as any).Notification = N;
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      register: (url: string) => { registerCalls.push(url); return Promise.resolve({}); },
      get ready() {
        calls.push("sw.ready");
        return Promise.resolve({ pushManager: {
          getSubscription: () => Promise.resolve(existing),
          subscribe: (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
            calls.push("pm.subscribe");
            if (h.subscribeError) return Promise.reject(h.subscribeError);
            expect(o.userVisibleOnly).toBe(true);
            expect(Array.from(o.applicationServerKey)).toEqual([4, 5, 6]);
            existing = fakeSub();
            return Promise.resolve(existing);
          } } });
      } } });
  } else {
    delete (window as any).PushManager;
    delete (globalThis as any).Notification;
    delete (navigator as any).serviceWorker;
  }
}
const secure = (on: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value: on, configurable: true });

async function load() {
  vi.resetModules();
  return import("./push");
}

beforeEach(() => {
  calls.length = 0;
  Object.assign(h, { subscribed: [], unsub: [], presence: [], tested: [],
    keyFetches: 0, failSubscribe: false, subscribeError: null, key: "BAUG" });
  existing = null;
  registerCalls = [];
  permission = "default";
  requestPermission = () => Promise.resolve("granted");
  localStorage.clear();
  secure(true);
  setUA("Mozilla/5.0 (X11; Linux x86_64) Chrome/130", 0, undefined);
  setCapable(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

// ------------------------------------------------------------------ support

test("a capable browser over https is ok", async () => {
  expect((await load()).pushSupport()).toBe("ok");
});

test("plain http is insecure, even where the APIs would exist", async () => {
  secure(false);
  expect((await load()).pushSupport()).toBe("insecure");
});

test.each([
  ["an iPhone browser tab", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", 5, false],
  ["an iPad tab", "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)", 5, undefined],
  ["an iPad that calls itself a Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, undefined],
  ["Safari's own standalone flag", "Mozilla/5.0 (X11)", 0, false],
])("%s without PushManager asks for the Home Screen", async (_n, ua, touch, standalone) => {
  setCapable(false);
  setUA(ua, touch, standalone);
  expect((await load()).pushSupport()).toBe("home_screen");
});

test("a real Mac or desktop without push is simply unsupported", async () => {
  setCapable(false);
  setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0);
  expect((await load()).pushSupport()).toBe("unsupported");
});

test("an installed iOS app without PushManager (before 16.4) is unsupported", async () => {
  setCapable(false);
  setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)", 5, true);
  expect((await load()).pushSupport()).toBe("unsupported");
});

// ----------------------------------------------------- service worker setup

test("the worker is registered in normal builds", async () => {
  (await load()).registerServiceWorker();
  expect(registerCalls).toEqual(["/sw.js"]);
});

test("no worker in a demo build, or over http", async () => {
  vi.stubEnv("VITE_DEMO", "1");
  (await load()).registerServiceWorker();
  vi.unstubAllEnvs();
  secure(false);
  (await load()).registerServiceWorker();
  expect(registerCalls).toEqual([]);
});

test("a failing registration is swallowed", async () => {
  (navigator.serviceWorker as any).register = () => Promise.reject(new Error("x"));
  (await load()).registerServiceWorker();
  await Promise.resolve();
});

// ------------------------------------------------------------------- enable

test("without a cached registration and key, it asks for permission first (fallback)", async () => {
  let answer!: (p: NotificationPermission) => void;
  requestPermission = () => { calls.push("permission");
    return new Promise((r) => { answer = r; }); };
  const push = await load();
  const done = push.enablePush("de");
  expect(calls).toEqual(["permission"]);          // nothing awaited before it
  expect(h.keyFetches).toBe(0);
  answer("granted");
  expect(await done).toBe("granted");
  expect(calls).toEqual(["permission", "api.key", "sw.ready", "pm.subscribe",
    "api.subscribe"]);
  expect(h.subscribed).toEqual([{ endpoint: END,
    keys: { p256dh: "P", auth: "A" }, lang: "de" }]);
  expect(localStorage.getItem("pmc_notify")).toBe("push");
});

async function warm() {
  const push = await load();
  push.registerServiceWorker();
  await push.prefetchPushKey();
  await new Promise((r) => setTimeout(r, 0));      // the ready registration
  calls.length = 0;
  return push;
}

test("with registration and key cached, subscribe is the first call in the tap", async () => {
  requestPermission = () => { calls.push("permission"); return Promise.resolve("granted"); };
  const push = await warm();
  const done = push.enablePush("en");
  expect(calls).toEqual(["pm.subscribe"]);         // synchronously, nothing before
  expect(await done).toBe("granted");
  expect(calls).toEqual(["pm.subscribe", "api.subscribe"]);
  expect(h.keyFetches).toBe(1);
  expect(localStorage.getItem("pmc_notify")).toBe("push");
});

test("a prompt refused through subscribe is denied, other errors rethrow", async () => {
  const push = await warm();
  h.subscribeError = Object.assign(new Error("x"), { name: "NotAllowedError" });
  permission = "denied";
  expect(await push.enablePush("en")).toBe("denied");
  permission = "default";
  expect(await push.enablePush("en")).toBe("denied");   // NotAllowed, not granted
  h.subscribeError = new Error("boom");
  permission = "granted";
  await expect(push.enablePush("en")).rejects.toThrow("boom");
  expect(localStorage.getItem("pmc_notify")).toBeNull();
});

test("a refusal leaves everything as it was", async () => {
  requestPermission = () => Promise.resolve("denied");
  const push = await load();
  expect(await push.enablePush("en")).toBe("denied");
  expect(calls).toEqual([]);
  expect(localStorage.getItem("pmc_notify")).toBeNull();
});

test("a server that refuses the subscription leaves no browser one behind", async () => {
  h.failSubscribe = true;
  const push = await load();
  await expect(push.enablePush("en")).rejects.toThrow("nope");
  expect(existing!.unsubscribe).toHaveBeenCalled();
  expect(localStorage.getItem("pmc_notify")).toBeNull();
});

// ---------------------------------------------------------------- disabling

test("turning off drops the subscription on both sides", async () => {
  const push = await load();
  await push.enablePush("en");
  const sub = existing!;
  await push.disablePush();
  expect(h.unsub).toEqual([END]);
  expect(sub.unsubscribe).toHaveBeenCalled();
  expect(localStorage.getItem("pmc_notify")).toBe("0");
});

test("turning off works with nothing subscribed", async () => {
  const push = await load();
  await push.disablePush();
  expect(localStorage.getItem("pmc_notify")).toBe("0");
});

// --------------------------------------------------------------------- sync

test("at start, push mode re-sends the subscription with the language", async () => {
  localStorage.setItem("pmc_notify", "push");
  permission = "granted";
  existing = fakeSub();
  await (await load()).syncPush("de");
  expect(h.subscribed).toEqual([{ endpoint: END,
    keys: { p256dh: "P", auth: "A" }, lang: "de" }]);
  expect(localStorage.getItem("pmc_notify")).toBe("push");
});

test("push mode without a browser subscription switches itself off", async () => {
  localStorage.setItem("pmc_notify", "push");
  permission = "granted";
  await (await load()).syncPush("en");
  expect(localStorage.getItem("pmc_notify")).toBe("0");
  expect(h.subscribed).toEqual([]);
});

test("push mode whose permission was withdrawn switches itself off", async () => {
  localStorage.setItem("pmc_notify", "push");
  permission = "denied";
  existing = fakeSub();
  await (await load()).syncPush("en");
  expect(localStorage.getItem("pmc_notify")).toBe("0");
});

test("a changed server key means a fresh subscription", async () => {
  localStorage.setItem("pmc_notify", "push");
  permission = "granted";
  const old = fakeSub("AAAA", "https://web.push.example/old");
  existing = old;
  await (await load()).syncPush("en");
  expect(old.unsubscribe).toHaveBeenCalled();
  expect(h.unsub).toEqual(["https://web.push.example/old"]);
  expect(h.subscribed).toEqual([{ endpoint: END,
    keys: { p256dh: "P", auth: "A" }, lang: "en" }]);
});

test("the legacy switch upgrades silently when permission is already granted", async () => {
  localStorage.setItem("pmc_notify", "1");
  permission = "granted";
  await (await load()).syncPush("en");
  expect(h.subscribed).toHaveLength(1);
  expect(localStorage.getItem("pmc_notify")).toBe("push");
});

test("a failed upgrade keeps the legacy switch", async () => {
  localStorage.setItem("pmc_notify", "1");
  permission = "granted";
  h.failSubscribe = true;
  await (await load()).syncPush("en");
  expect(localStorage.getItem("pmc_notify")).toBe("1");
});

test("the legacy switch stays when push is not possible or not allowed", async () => {
  localStorage.setItem("pmc_notify", "1");
  permission = "default";
  await (await load()).syncPush("en");
  setCapable(false);
  await (await load()).syncPush("en");
  expect(localStorage.getItem("pmc_notify")).toBe("1");
  expect(h.subscribed).toEqual([]);
});

test("nothing happens while notifications are off", async () => {
  permission = "granted";
  await (await load()).syncPush("en");
  localStorage.setItem("pmc_notify", "0");
  await (await load()).syncPush("en");
  expect(calls).toEqual([]);
});

test("a server error at start never throws", async () => {
  localStorage.setItem("pmc_notify", "push");
  permission = "granted";
  existing = fakeSub();
  h.failSubscribe = true;
  await expect((await load()).syncPush("en")).resolves.toBeUndefined();
});

// --------------------------------------------------------------------- test

test("the test push names this device's endpoint", async () => {
  existing = fakeSub();
  await (await load()).sendTestPush();
  expect(h.tested).toEqual([END]);
});

test("the test push with no subscription fails", async () => {
  await expect((await load()).sendTestPush()).rejects.toThrow();
});

// ----------------------------------------------------------------- presence

test("presence is only sent in push mode, once the endpoint is known", async () => {
  const push = await load();
  push.sendPresence(true);
  expect(h.presence).toEqual([]);
  await push.enablePush("en");
  h.presence.length = 0;
  push.sendPresence(true);
  push.sendPresence(false);
  expect(h.presence).toEqual([[END, true], [END, false]]);
  localStorage.setItem("pmc_notify", "0");
  push.sendPresence(true);
  expect(h.presence).toHaveLength(2);
});

test("presence follows the page: visible, hidden, shown, and every 25 s", async () => {
  const push = await load();
  await push.enablePush("en");
  h.presence.length = 0;
  vi.useFakeTimers();
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const stop = push.watchPresence();
  expect(h.presence).toEqual([[END, true]]);                // on start
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(h.presence.at(-1)).toEqual([END, false]);
  vi.advanceTimersByTime(25_000);
  expect(h.presence.at(-1)).toEqual([END, false]);          // hidden: no ping
  hidden = false;
  window.dispatchEvent(new Event("pageshow"));
  expect(h.presence.at(-1)).toEqual([END, true]);
  const n = h.presence.length;
  vi.advanceTimersByTime(25_000);
  expect(h.presence).toHaveLength(n + 1);                   // visible: ping
  stop();
  vi.advanceTimersByTime(60_000);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(h.presence).toHaveLength(n + 1);
});
