/*
 * Kody Dashboard service worker.
 *
 * Two jobs:
 *   1. Handle `push` events: parse the JSON payload our web-push channel
 *      adapter sent and show a system notification.
 *   2. Handle `notificationclick`: focus an existing dashboard tab if one is
 *      open (preferring the same URL), otherwise open a new one.
 *
 * Deliberately framework-free — this file is served as a static asset and
 * runs in the SW global scope (no DOM, no Next.js).
 */

/* eslint-disable no-restricted-globals */

const DEFAULT_ICON = "/icon-192.png";
const DEFAULT_BADGE = "/icon-192.png";

self.addEventListener("install", () => {
  // Skip waiting so the first install activates immediately. Subsequent
  // updates still wait — the page must call `skipWaiting` if it wants an
  // instant swap.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all clients so the very first navigation under the new SW gets
  // controlled without needing a reload. Otherwise subscribe() may run
  // before the SW controls the page.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Some push services send raw text — keep a sane fallback.
    data = { title: "Kody", body: event.data ? event.data.text() : "" };
  }

  const title = (data && data.title) || "Kody";
  const body = (data && data.body) || "";
  const icon = (data && data.icon) || DEFAULT_ICON;
  const tag = data && data.tag;
  const url = (data && data.url) || "/";

  const options = {
    body,
    icon,
    badge: DEFAULT_BADGE,
    tag,
    // `data` is the only way to carry state into the notificationclick
    // handler — it isn't accessible from `notification.body` etc.
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer focusing an existing tab — if one matches the target URL,
      // use it as-is; otherwise navigate the first one we find.
      for (const client of allClients) {
        if (client.url === targetUrl) {
          return client.focus();
        }
      }
      if (allClients.length > 0 && "navigate" in allClients[0]) {
        await allClients[0].navigate(targetUrl).catch(() => {});
        return allClients[0].focus();
      }
      return self.clients.openWindow(targetUrl);
    })(),
  );
});
