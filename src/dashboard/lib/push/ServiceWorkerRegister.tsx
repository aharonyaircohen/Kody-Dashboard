"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern service-worker-bootstrap
 * @ai-summary Registers `/sw.js` on first load. Mounted once via
 *   KodyProviders. No-ops when the browser doesn't support service agents
 *   (older Safari, some embedded webviews) or when running over `http://`
 *   on a non-localhost origin (push requires a secure origin).
 *
 *   This component renders nothing — it just runs the registration side
 *   effect on mount. We don't expose a context because the SW registration
 *   is global and the push subscription flow (`usePushSubscription`) reads
 *   `navigator.serviceWorker.ready` directly.
 */
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Push API requires a secure context (https or localhost). Skip on
    // plain-http preview deploys so we don't spam the console with errors.
    if (
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      return;
    }

    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (cancelled) return;
        if (
          !registration ||
          typeof registration.addEventListener !== "function"
        )
          return;
        // Auto-pick up SW updates: when a new SW is found, install it and
        // let it activate on the next navigation. We don't force-reload —
        // the user-visible UI doesn't change so a silent swap is fine.
        registration.addEventListener("updatefound", () => {
          const sw = registration.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            // No action; logging would just be noise.
          });
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // Don't surface as a toast — many users won't enable push.
        console.warn("[Kody] Service worker registration failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
