/**
 * @fileType utility
 * @domain kody
 * @pattern mention-push-adapter
 * @ai-summary SERVER-ONLY per-recipient Web Push adapter. Unlike the
 *   rules-based broadcast (`web-push.ts`, every device on the repo), this only
 *   pings the devices whose owner was an actual recipient of the event, with a
 *   per-recipient payload ("@author mentioned you …", or "@author in #channel").
 *   The low-level send/prune is shared via `push-core.deliverPush`. Best-effort.
 */
import "server-only";
import type { PushSubscriptionRecord } from "../../push";
import { logger } from "../../logger";
import { dashboardThreadUrl, dashboardChannelUrl } from "../../thread-link";
import { deliverPush, ensureVapid } from "./push-core";
import type { SourceEvent } from "../source-event";

/**
 * Collapse comment/issue markdown to readable plain prose for an OS
 * notification: drop code fences, blockquote markers, heading hashes, list
 * bullets, bold/italic emphasis, and flatten `[text](url)` links to `text`.
 */
function plainSnippet(body: string, max = 180): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function buildPayload(mention: string, ev: SourceEvent): string {
  const kind =
    ev.eventType === "issue_comment" ||
    ev.eventType === "pull_request_review_comment"
      ? "commented"
      : ev.eventType === "pull_request_review"
        ? "reviewed"
        : ev.eventType === "issues"
          ? "opened an issue"
          : ev.eventType === "pull_request"
            ? "opened a PR"
            : "mentioned you";
  const who = ev.author ? `@${ev.author}` : "Someone";
  const where = ev.title ? ` on "${ev.title}"` : "";
  const snippet = plainSnippet(ev.body);

  // Channel messages deep-link into the in-app /messages view; issue/PR threads
  // open the dashboard task view; discussions/commits open github.com.
  if (ev.channel) {
    const channelName = ev.title?.replace(/^#/, "") ?? "channel";
    return JSON.stringify({
      title: `${who} in #${channelName}`,
      body: snippet || `New message in #${channelName}`,
      url: dashboardChannelUrl({
        channelNumber: ev.channel.number,
        commentId: ev.channel.commentId,
      }),
      tag: `channel:${ev.channel.number}`,
    });
  }

  const clickUrl = dashboardThreadUrl({
    githubUrl: ev.url,
    threadType: ev.threadType,
  });
  return JSON.stringify({
    title: `${who} mentioned you${where}`,
    body: snippet || `${ev.repoFullName} — ${kind}`,
    url: clickUrl,
    tag: `mention:${mention}:${ev.url ?? ev.repoFullName}`,
  });
}

/**
 * Push to the subscribed devices whose owner is one of `recipients`. No-ops
 * (with a log) when VAPID isn't configured or no subscription matches.
 */
export async function deliverMentionPush(
  ev: SourceEvent,
  recipients: string[],
  subs: PushSubscriptionRecord[],
  ctx: { owner: string; repo: string; token: string },
): Promise<void> {
  if (!ensureVapid()) {
    logger.info(
      { event: "mention_push_no_vapid" },
      "VAPID keys missing — inbox feed written, skipping web-push",
    );
    return;
  }

  const recipientSet = new Set(recipients);
  if (recipientSet.size === 0) return;

  const targets = subs.filter((s) => {
    const login = s.userLogin?.toLowerCase();
    return !!login && recipientSet.has(login);
  });

  if (targets.length === 0) {
    logger.info(
      {
        event: "mention_push_no_targets",
        mentions: [...recipientSet],
        subscriberLogins: subs.map((s) => s.userLogin ?? null),
        totalSubs: subs.length,
        repo: ev.repoFullName,
      },
      "No matching push subscriptions for @mentions",
    );
    return;
  }

  const { sent, failed, pruned } = await deliverPush({
    subscriptions: targets,
    payload: (sub) => buildPayload(sub.userLogin?.toLowerCase() ?? "", ev),
    github: ctx,
    logLabel: "mention_push",
  });

  logger.info(
    {
      event: "mention_push_dispatched",
      mentions: [...recipientSet],
      targets: targets.length,
      sent,
      failed,
      pruned,
      repo: ev.repoFullName,
    },
    `Mention push: ${sent}/${targets.length} sent`,
  );
}
