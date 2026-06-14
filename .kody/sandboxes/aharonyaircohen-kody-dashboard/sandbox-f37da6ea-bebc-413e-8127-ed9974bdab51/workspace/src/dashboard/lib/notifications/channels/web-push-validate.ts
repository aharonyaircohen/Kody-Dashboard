/**
 * @fileType utility
 * @domain kody
 * @pattern web-push-validate-clientsafe
 * @ai-summary Client-safe validator for the `web-push` channel. Lives in its
 *   own file (separate from `web-push.ts`) so the client-bundle import of
 *   `validateChannel` doesn't transitively pull in the `web-push` package
 *   (which depends on Node built-ins).
 */
import type { NotificationChannel } from "../../notifications";

type Channel = Extract<NotificationChannel, { type: "web-push" }>;

export function validateWebPush(_c: Channel): string | null {
  // We can't check env vars here — this runs client-side too — so the
  // validator only confirms the channel shape. The actual VAPID-keys check
  // happens server-side at send time and surfaces via the dashboard's
  // "not-configured" state in PushToggle.
  return null;
}
