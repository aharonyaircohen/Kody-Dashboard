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
import type { NotificationChannel } from "../../notifications";
import type { SendContext } from "./index";
import { setGitHubContext, clearGitHubContext } from "../../github-client";
import { readPushManifest } from "../../push-server";
import { logger } from "../../logger";
import {
  deliverPush,
  ensureVapid,
  type PushPayload,
} from "./push-core";

type Channel = Extract<NotificationChannel, { type: "web-push" }>;

// `validateWebPush` lives in web-push-validate.ts (client-safe). This file
// is server-only and intentionally doesn't re-export it.

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
  const url = ctx.vars.prUrl || ctx.vars.url;
  return {
    title: title || "Kody",
    body,
    url,
    // Per-thread tag: a specific PR/issue URL collapses repeated activity on
    // that thread into one notification, while different threads stay
    // separate and individually tappable. Falls back to repo only when the
    // rule has no URL var (rare — keeps a sane key rather than undefined).
    tag: url || ctx.vars.repo,
  };
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

  // Unlike the mention spine (which degrades gracefully), a configured rule
  // failing to init VAPID is a real misconfig — surface it as an error.
  if (!ensureVapid()) {
    throw new Error("web-push: VAPID keys unavailable (KODY_MASTER_KEY unset?)");
  }

  // Load the subscriptions list under the user's auth context. We set/clear
  // around the read so we don't leak context to whatever runs next.
  setGitHubContext(gh.owner, gh.repo, gh.token);
  let subs;
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

  // A rules broadcast sends the same payload to every device; the per-device
  // send + 404/410 prune is the shared `deliverPush` primitive.
  const payload = JSON.stringify(buildPayload(ctx));
  const { sent, failed, pruned } = await deliverPush({
    subscriptions: subs,
    payload: () => payload,
    github: gh,
    logLabel: "web_push",
  });

  logger.info(
    { event: "web_push_dispatched", sent, failed, pruned },
    `web-push: ${sent} sent, ${failed} failed (${pruned} pruned)`,
  );

  if (sent === 0 && failed > 0) {
    throw new Error(
      `All ${failed} push send(s) failed — see logs for per-endpoint detail`,
    );
  }
}
