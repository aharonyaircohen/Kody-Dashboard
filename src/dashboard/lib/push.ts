/**
 * @fileType utility
 * @domain kody
 * @pattern push-subscriptions-manifest
 * @ai-summary Shared types + parse/serialize for the per-repo push-subscription
 *   manifest. Stored in a single GitHub issue labelled `kody:push-subscriptions`,
 *   same JSON-in-comment-markers pattern as `notifications.ts`. One row per
 *   browser/device — keyed by the endpoint URL (unique per browser+device per
 *   spec). The web-push channel adapter loads this and fans out.
 *
 *   We deliberately don't classify subscriptions as "secrets" — the endpoint
 *   + p256dh/auth keys are the per-device handle GitHub Push uses; they're not
 *   user-secret. Anyone who reads them could send notifications to that
 *   device, so we still gate the manifest behind repo read access (private
 *   repos are private).
 */

export const PUSH_SUBSCRIPTIONS_LABEL = "kody:push-subscriptions";
export const PUSH_MANIFEST_START = "<!-- kody-push-subscriptions-start -->";
export const PUSH_MANIFEST_END = "<!-- kody-push-subscriptions-end -->";
export const PUSH_MANIFEST_ISSUE_TITLE = "Kody Push Subscriptions";

/**
 * One subscribed device. `endpoint` is the unique identity from the browser's
 * `PushSubscription`. `keys` are the encryption keys the browser generated.
 * Everything else is for the operator UI (which devices are subscribed) and
 * for prune-on-failure logic later.
 */
export interface PushSubscriptionRecord {
  /** Browser/OS push service URL — unique per device per browser per origin. */
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** Free-text label set by the client (e.g. "iPhone Safari"). */
  label?: string;
  /** GitHub login of the user who registered this device. Useful for
   *  per-user targeting later; for v1 every rule fires to every device. */
  userLogin?: string;
  /** ISO timestamp of first subscription. */
  createdAt: string;
  /** ISO timestamp of last successful send (or 0 if never). Used to surface
   *  stale devices in the UI. */
  lastSeenAt?: string;
}

export interface PushSubscriptionsManifest {
  version: 1;
  subscriptions: PushSubscriptionRecord[];
}

export const EMPTY_PUSH_MANIFEST: PushSubscriptionsManifest = {
  version: 1,
  subscriptions: [],
};

function isSubscriptionRecord(v: unknown): v is PushSubscriptionRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (typeof r.endpoint !== "string" || r.endpoint.length === 0) return false;
  const k = r.keys as Record<string, unknown> | undefined;
  if (!k || typeof k !== "object") return false;
  if (typeof k.p256dh !== "string" || typeof k.auth !== "string") return false;
  return true;
}

export function parsePushManifestBody(
  body: string | null | undefined,
): PushSubscriptionsManifest {
  if (!body) return { ...EMPTY_PUSH_MANIFEST, subscriptions: [] };
  const start = body.indexOf(PUSH_MANIFEST_START);
  const end = body.indexOf(PUSH_MANIFEST_END);
  if (start === -1 || end === -1 || end < start) {
    return { ...EMPTY_PUSH_MANIFEST, subscriptions: [] };
  }
  const inner = body.slice(start + PUSH_MANIFEST_START.length, end);
  const fenceOpen = inner.indexOf("```");
  const fenceClose = inner.lastIndexOf("```");
  if (fenceOpen === -1 || fenceClose === -1 || fenceClose === fenceOpen) {
    return { ...EMPTY_PUSH_MANIFEST, subscriptions: [] };
  }
  const afterOpen = inner.indexOf("\n", fenceOpen);
  if (afterOpen === -1) return { ...EMPTY_PUSH_MANIFEST, subscriptions: [] };
  const json = inner.slice(afterOpen + 1, fenceClose).trim();
  if (!json) return { ...EMPTY_PUSH_MANIFEST, subscriptions: [] };

  try {
    const parsed = JSON.parse(json) as Partial<PushSubscriptionsManifest>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.subscriptions)) {
      return { ...EMPTY_PUSH_MANIFEST, subscriptions: [] };
    }
    const subs: PushSubscriptionRecord[] = [];
    for (const s of parsed.subscriptions) {
      if (!isSubscriptionRecord(s)) continue;
      subs.push({
        endpoint: s.endpoint,
        keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
        label: typeof s.label === "string" ? s.label : undefined,
        userLogin: typeof s.userLogin === "string" ? s.userLogin : undefined,
        createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
        lastSeenAt: typeof s.lastSeenAt === "string" ? s.lastSeenAt : undefined,
      });
    }
    return { version: 1, subscriptions: subs };
  } catch {
    return { ...EMPTY_PUSH_MANIFEST, subscriptions: [] };
  }
}

export function serializePushManifestBody(
  manifest: PushSubscriptionsManifest,
): string {
  const preamble =
    "> Kody push-subscriptions manifest — the dashboard reads and writes the JSON block below.\n" +
    "> Edited automatically when users enable/disable push notifications.\n\n";
  const json = JSON.stringify(manifest, null, 2);
  return `${preamble}${PUSH_MANIFEST_START}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${PUSH_MANIFEST_END}\n`;
}

/**
 * Convert a base64url-encoded VAPID public key string into the Uint8Array
 * the browser's `pushManager.subscribe({ applicationServerKey })` expects.
 * Used client-side; kept here so the same util can be shared with tests.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
