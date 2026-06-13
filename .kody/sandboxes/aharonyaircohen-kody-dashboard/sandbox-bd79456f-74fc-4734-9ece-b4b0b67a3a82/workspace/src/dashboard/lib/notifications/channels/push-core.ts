/**
 * @fileType utility
 * @domain kody
 * @pattern web-push-core
 * @ai-summary SERVER-ONLY low-level Web Push primitive shared by every push
 *   sender. Both the rules-based broadcast (`channels/web-push.ts`) and the
 *   per-recipient mention fan-out (`channels/mention-push.ts`) used to carry
 *   their own copy of "init VAPID, POST to each subscription, prune 404/410".
 *   That duplication is the seam this module removes: `deliverPush` takes a set
 *   of subscriptions and a per-subscription payload, sends, prunes dead
 *   endpoints from the manifest, and returns counts. Best-effort — never throws
 *   (callers decide whether an all-failed send is an error).
 */
import "server-only";
import webpush, {
  type PushSubscription as WebPushSubscription,
  WebPushError,
} from "web-push";
import { setGitHubContext, clearGitHubContext } from "../../github-client";
import { mutatePushManifest } from "../../push-server";
import type { PushSubscriptionRecord } from "../../push";
import { logger } from "../../logger";
import { deriveVapidKeys } from "../../push/vapid-keys";

/** Body shape the service worker expects in `event.data.json()`. */
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  tag?: string;
}

/**
 * Set the VAPID details on the web-push client. Keys are derived from
 * KODY_MASTER_KEY via HKDF (see `vapid-keys.ts`) — no separate VAPID env vars.
 * Returns `false` (instead of throwing) when derivation fails — i.e. the master
 * key isn't set — so a misconfigured server degrades gracefully rather than
 * breaking webhook delivery.
 */
export function ensureVapid(): boolean {
  try {
    const { publicKey, privateKey } = deriveVapidKeys();
    webpush.setVapidDetails("mailto:kody@example.com", publicKey, privateKey);
    return true;
  } catch {
    return false;
  }
}

function toSubscription(r: PushSubscriptionRecord): WebPushSubscription {
  return {
    endpoint: r.endpoint,
    keys: { p256dh: r.keys.p256dh, auth: r.keys.auth },
  };
}

/** 404 Not Found / 410 Gone = the subscription is permanently dead (RFC 8030). */
function isExpired(err: unknown): boolean {
  return (
    err instanceof WebPushError &&
    (err.statusCode === 404 || err.statusCode === 410)
  );
}

export interface DeliverPushResult {
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Send `payload(sub)` to every subscription, then prune any endpoint that came
 * back 404/410. Assumes VAPID is already initialized (call `ensureVapid` first
 * — kept separate because callers differ on what to do when it's missing).
 * Never throws.
 */
export async function deliverPush(opts: {
  subscriptions: PushSubscriptionRecord[];
  payload: (sub: PushSubscriptionRecord) => string;
  github: { owner: string; repo: string; token: string };
  /** Prefix for log event names so call sites stay distinguishable. */
  logLabel: string;
}): Promise<DeliverPushResult> {
  const { subscriptions, payload, github, logLabel } = opts;
  const expired: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(toSubscription(sub), payload(sub));
        sent++;
      } catch (err) {
        failed++;
        if (isExpired(err)) {
          expired.push(sub.endpoint);
        } else {
          logger.warn(
            {
              event: `${logLabel}_send_failed`,
              endpoint: sub.endpoint.slice(0, 60),
              error: err instanceof Error ? err.message : String(err),
            },
            "web-push send failed (non-expiry)",
          );
        }
      }
    }),
  );

  if (expired.length > 0) {
    setGitHubContext(github.owner, github.repo, github.token);
    try {
      await mutatePushManifest((current) => {
        const before = current.subscriptions.length;
        const next = {
          version: 1 as const,
          subscriptions: current.subscriptions.filter(
            (s) => !expired.includes(s.endpoint),
          ),
        };
        if (next.subscriptions.length === before) {
          return { kind: "noop" as const, result: 0 };
        }
        return { next, result: before - next.subscriptions.length };
      });
      logger.info(
        { event: `${logLabel}_pruned`, count: expired.length },
        `Pruned ${expired.length} expired push subscription(s)`,
      );
    } catch (err) {
      logger.warn(
        {
          event: `${logLabel}_prune_failed`,
          error: err instanceof Error ? err.message : String(err),
        },
        "Failed to prune expired subscriptions",
      );
    } finally {
      clearGitHubContext();
    }
  }

  return { sent, failed, pruned: expired.length };
}
