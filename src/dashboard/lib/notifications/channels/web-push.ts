/**
 * @fileType utility
 * @domain kody
 * @pattern web-push-adapter
 * @ai-summary Web Push channel adapter (SERVER-ONLY). Unlike Slack/Discord/
 *   Telegram — which have a single delivery URL per channel — a `web-push`
 *   channel fans out to every device that has subscribed for this repo.
 *   Subscriptions live in the per-repo push-subscriptions manifest issue.
 *
 *   On 404/410 (subscription expired / device unsubscribed) we prune the
 *   record from the manifest so the next send doesn't pay the same cost.
 *
 *   This file is imported only from `./send.ts` (server) so it can safely
 *   static-import `web-push` and the github-client. Importing it from a
 *   client-side bundle would drag Node built-ins (net/tls) and fail to
 *   compile.
 */
import "server-only";
import webpush, {
  type PushSubscription as WebPushSubscription,
  type SendResult,
  WebPushError,
} from "web-push";
import type { NotificationChannel } from "../../notifications";
import type { SendContext } from "./index";
import { setGitHubContext, clearGitHubContext } from "../../github-client";
import { readPushManifest, mutatePushManifest } from "../../push-server";
import type { PushSubscriptionRecord } from "../../push";
import { logger } from "../../logger";
import { deriveVapidKeys } from "../../push/vapid-keys";

type Channel = Extract<NotificationChannel, { type: "web-push" }>;

// `validateWebPush` lives in web-push-validate.ts (client-safe). This file
// is server-only and intentionally doesn't re-export it.

/** Initialise web-push lazily. The keypair is derived from KODY_MASTER_KEY
 *  via HKDF (see `vapid-keys.ts`) — no separate VAPID env vars. */
function initVapid() {
  const { publicKey, privateKey } = deriveVapidKeys();
  // The subject identifies the application server to the push service.
  // Only used for abuse reporting; a static mailto: is fine.
  const subject = "mailto:kody@example.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/** Body shape the service worker expects in `event.data.json()`. */
interface PushPayload {
  title: string;
  body: string;
  /** Where to navigate when the user taps the notification. */
  url?: string;
  /** Notification icon override (default: /icon-192.png). */
  icon?: string;
  /** Used to coalesce duplicates so a re-fire replaces the previous toast. */
  tag?: string;
}

function buildPayload(ctx: SendContext): PushPayload {
  // The dispatcher already rendered the rule's template into `ctx.text`. For
  // web-push we split into a short title (first line / 80 chars) and the rest
  // as body — this matches how OS notifications display them.
  const trimmed = ctx.text.trim();
  const firstNewline = trimmed.indexOf("\n");
  const title =
    firstNewline === -1
      ? trimmed.slice(0, 80)
      : trimmed.slice(0, firstNewline).slice(0, 80);
  const body =
    firstNewline === -1
      ? ""
      : trimmed.slice(firstNewline + 1, firstNewline + 281);
  return {
    title: title || "Kody",
    body,
    url: ctx.vars.prUrl || ctx.vars.url,
    tag: ctx.vars.repo,
  };
}

function toSubscription(r: PushSubscriptionRecord): WebPushSubscription {
  return {
    endpoint: r.endpoint,
    keys: { p256dh: r.keys.p256dh, auth: r.keys.auth },
  };
}

/**
 * Returns true iff the error means "this subscription is permanently dead"
 * — 404 Not Found and 410 Gone are the documented signals (RFC 8030).
 */
function isExpiredSubscription(err: unknown): boolean {
  if (err instanceof WebPushError) {
    return err.statusCode === 404 || err.statusCode === 410;
  }
  return false;
}

export async function sendWebPush(
  _c: Channel,
  ctx: SendContext,
): Promise<void> {
  const gh = ctx.github;
  if (!gh) {
    throw new Error(
      "web-push channel requires github context — dispatcher must set ctx.github",
    );
  }

  initVapid();

  // Load the subscriptions list under the user's auth context. We set/clear
  // around the read so we don't leak context to whatever runs next.
  setGitHubContext(gh.owner, gh.repo, gh.token);
  let subs: PushSubscriptionRecord[];
  try {
    const { manifest } = await readPushManifest();
    subs = manifest.subscriptions;
  } finally {
    clearGitHubContext();
  }

  if (subs.length === 0) {
    logger.info(
      { event: "web_push_no_subscribers", owner: gh.owner, repo: gh.repo },
      "No push subscribers for repo — nothing to send",
    );
    return;
  }

  const payload = JSON.stringify(buildPayload(ctx));

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(toSubscription(sub), payload).then<{
        sub: PushSubscriptionRecord;
        result: SendResult;
      }>((result) => ({ sub, result })),
    ),
  );

  const expiredEndpoints: string[] = [];
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      sent++;
      continue;
    }
    failed++;
    if (isExpiredSubscription(r.reason)) {
      expiredEndpoints.push(subs[i].endpoint);
    } else {
      logger.warn(
        {
          event: "web_push_send_failed",
          endpoint: subs[i].endpoint.slice(0, 60),
          error:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
        "web-push send failed (non-expiry)",
      );
    }
  }

  // Prune dead endpoints best-effort — never let it bubble up and turn a
  // partially-successful send into a failure.
  if (expiredEndpoints.length > 0) {
    setGitHubContext(gh.owner, gh.repo, gh.token);
    try {
      await mutatePushManifest((current) => {
        const before = current.subscriptions.length;
        const next = {
          version: 1 as const,
          subscriptions: current.subscriptions.filter(
            (s) => !expiredEndpoints.includes(s.endpoint),
          ),
        };
        if (next.subscriptions.length === before) {
          return { kind: "noop" as const, result: 0 };
        }
        return { next, result: before - next.subscriptions.length };
      });
      logger.info(
        {
          event: "web_push_pruned",
          count: expiredEndpoints.length,
        },
        `Pruned ${expiredEndpoints.length} expired push subscription(s)`,
      );
    } catch (err) {
      logger.warn(
        {
          event: "web_push_prune_failed",
          error: err instanceof Error ? err.message : String(err),
        },
        "Failed to prune expired subscriptions",
      );
    } finally {
      clearGitHubContext();
    }
  }

  logger.info(
    {
      event: "web_push_dispatched",
      sent,
      failed,
      pruned: expiredEndpoints.length,
    },
    `web-push: ${sent} sent, ${failed} failed (${expiredEndpoints.length} pruned)`,
  );

  if (sent === 0 && failed > 0) {
    throw new Error(
      `All ${failed} push send(s) failed — see logs for per-endpoint detail`,
    );
  }
}
