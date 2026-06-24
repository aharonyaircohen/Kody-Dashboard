"use client";
/**
 * @fileType utility
 * @domain kody
 * @pattern notification-prefs-sync
 * @ai-summary Fire-and-forget client → server sync of the user's muted
 *   notification types. The webhook spine reads the per-user prefs file
 *   (`notifications/preferences/<login>.json` in the configured Kody state repo) to drop muted recipients
 *   *before* an entry is ever written to the inbox/push — so persisting a mute
 *   here is what actually stops future notifications, not just the in-app cache.
 *   Best-effort: failures are non-blocking; the next toggle (or a reload of the
 *   settings page) re-syncs.
 */
import { getStoredAuth } from "../api";
import type { NotificationType } from "./types";

/** POST the full muted-types list to the server prefs file. */
export function syncMutedTypes(mutedTypes: NotificationType[]): void {
  const auth = getStoredAuth();
  if (!auth) return;
  void fetch("/api/notifications/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kody-token": auth.token,
      "x-kody-owner": auth.owner,
      "x-kody-repo": auth.repo,
    },
    body: JSON.stringify({ mutedTypes }),
  }).catch(() => {
    /* best-effort */
  });
}
