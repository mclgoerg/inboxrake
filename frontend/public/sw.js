/* Inboxrake service worker: it exists for Web Push and nothing else.
 *
 * There is deliberately NO fetch handler and no cache: every request goes
 * to the network as if there were no worker, so an old worker can never
 * serve an old UI or break a login. (index.html and this file are served
 * with Cache-Control: no-cache for the same reason.)
 *
 * Every push shows a notification - browsers revoke a subscription that
 * receives pushes without one, so nothing is ever suppressed here; the server
 * does not send to a device that is looking at the app. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};                    // malformed: still show something
  }
  const str = (v, fallback) =>
    typeof v === "string" && v ? v : fallback;
  event.waitUntil(self.registration.showNotification(
    str(data.title, "Inboxrake"), {
      body: str(data.body, ""),
      tag: str(data.tag, "inboxrake"),
      icon: "/icon.svg",
      data: { url: str(data.url, "/") },
    }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll(
      { type: "window", includeUncontrolled: true });
    for (const win of wins) {
      if ("focus" in win) return win.focus();
    }
    return self.clients.openWindow(url);
  })());
});
