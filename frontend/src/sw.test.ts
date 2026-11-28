// @vitest-environment node
/* The service worker's notification tap (public/sw.js): with the app open the
 * worker hands the notification's link to that window and focuses it - the
 * app follows the link by its hash, no reload (push.ts followPushLink) - so
 * "Tap to start" does something while the app sits in the background. With no
 * window it opens one on the link. */

import { expect, test, vi } from "vitest";
import SRC from "../public/sw.js?raw";

/** sw.js run against a fake `self`: its listeners, and what the clients do. */
function boot(windows: { focus?: () => Promise<unknown>;
  postMessage?: (m: unknown) => void }[]) {
  const handlers: Record<string, (e: any) => void> = {};
  const order: string[] = [];
  const clients = {
    claim: vi.fn(),
    matchAll: vi.fn(() => Promise.resolve(windows)),
    openWindow: vi.fn((url: string) => { order.push(`open ${url}`);
      return Promise.resolve({}); },
    ),
  };
  const self = {
    addEventListener: (type: string, fn: (e: any) => void) => {
      handlers[type] = fn;
    },
    skipWaiting: vi.fn(), clients, registration: { showNotification: vi.fn() },
  };
  new Function("self", SRC)(self);
  const tap = async (data: unknown) => {
    let done: Promise<unknown> = Promise.resolve();
    const closed = vi.fn();
    handlers.notificationclick({ notification: { close: closed, data },
      waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    return closed;
  };
  return { tap, clients, order };
}

test("an open window gets the link, then the focus; nothing is opened",
  async () => {
  const order: string[] = [];
  const win = { postMessage: vi.fn((m: unknown) => { order.push("post"); void m; }),
    focus: vi.fn(() => { order.push("focus"); return Promise.resolve(); }) };
  const sw = boot([win]);
  const closed = await sw.tap({ url: "/#/overview/check-in?account=work" });
  expect(win.postMessage).toHaveBeenCalledWith({ type: "open",
    url: "/#/overview/check-in?account=work" });
  expect(win.focus).toHaveBeenCalledTimes(1);
  expect(order).toEqual(["post", "focus"]);
  expect(sw.clients.openWindow).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalled();
});

test("every kind of notification is handed over the same way", async () => {
  const win = { postMessage: vi.fn(), focus: vi.fn(() => Promise.resolve()) };
  const sw = boot([win]);
  for (const url of ["/#/waiting", "/#/subscriptions", "/"]) {
    await sw.tap({ url });
    expect(win.postMessage).toHaveBeenLastCalledWith({ type: "open", url });
  }
  await sw.tap(undefined);                       // no data at all: the root
  expect(win.postMessage).toHaveBeenLastCalledWith({ type: "open", url: "/" });
});

test("no window open: one is opened on the link", async () => {
  const sw = boot([]);
  await sw.tap({ url: "/#/overview/check-in?account=work" });
  expect(sw.clients.openWindow).toHaveBeenCalledWith(
    "/#/overview/check-in?account=work");
});

test("a window that cannot be focused is skipped", async () => {
  const good = { postMessage: vi.fn(), focus: vi.fn(() => Promise.resolve()) };
  const sw = boot([{}, good]);
  await sw.tap({ url: "/#/waiting" });
  expect(good.postMessage).toHaveBeenCalledTimes(1);
});
