/**
 * @fileType utility
 * @domain kody
 * @pattern mention-push-dispatch
 * @ai-summary Server-only helper that turns a GitHub webhook event into
 *   targeted web-push notifications for users `@mentioned` in the body.
 *
 *   Unlike the rules-based fan-out in `web-push.ts` (which sends to every
 *   subscription on the repo), this filters subscriptions by `userLogin`
 *   so each device only pings when its owner is actually mentioned.
 *
 *   Reads the push manifest under a bot token (the webhook receiver has
 *   no per-user auth context). Prunes 404/410 endpoints best-effort so
 *   dead devices don't accumulate.
 */
import "server-only";
import webpush, {
  type PushSubscription as WebPushSubscription,
  WebPushError,
} from "web-push";
import {
  setGitHubContext,
  clearGitHubContext,
} from "../github-client";
import { readPushManifest, mutatePushManifest } from "../push-server";
import type { PushSubscriptionRecord } from "../push";
import { logger } from "../logger";
import { deriveVapidKeys } from "./vapid-keys";

// GitHub login: 1–39 chars, alphanumeric or single hyphens, not starting/
// ending with hyphen. We also bound on word boundaries so emails and
// `user@host` references don't trigger.
const MENTION_RE = /(^|[^A-Za-z0-9_/-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b/g;

export function extractMentions(body: string | null | undefined): string[] {
  if (!body) return [];
  const found = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const login = m[2];
    if (!login) continue;
    // Skip team mentions like `@org/team` — the leading-char class already
    // excludes most of these, but be defensive.
    found.add(login.toLowerCase());
  }
  return [...found];
}

interface MentionEvent {
  body: string;
  author?: string;
  url?: string;
  title?: string;
  repoFullName: string;
}

/**
 * Pull the relevant body, author, and url out of the webhook payload for the
 * event types that can carry @mentions. Returns null for events we don't
 * route.
 */
function extractEvent(
  eventType: string,
  payload: Record<string, unknown>,
): MentionEvent | null {
  const repository = payload.repository as Record<string, unknown> | undefined;
  const repoFullName =
    typeof repository?.full_name === "string" ? repository.full_name : "";
  if (!repoFullName) return null;

  const action = typeof payload.action === "string" ? payload.action : "";

  switch (eventType) {
    case "issue_comment":
    case "pull_request_review_comment":
    case "commit_comment": {
      if (action && action !== "created") return null;
      const comment = payload.comment as Record<string, unknown> | undefined;
      const body = typeof comment?.body === "string" ? comment.body : "";
      const author = (comment?.user as Record<string, unknown> | undefined)
        ?.login;
      const url = typeof comment?.html_url === "string" ? comment.html_url : "";
      const issue = payload.issue as Record<string, unknown> | undefined;
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      const title =
        (typeof issue?.title === "string" && issue.title) ||
        (typeof pr?.title === "string" && pr.title) ||
        "";
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
      };
    }

    case "pull_request_review": {
      if (action && action !== "submitted") return null;
      const review = payload.review as Record<string, unknown> | undefined;
      const body = typeof review?.body === "string" ? review.body : "";
      if (!body) return null;
      const author = (review?.user as Record<string, unknown> | undefined)
        ?.login;
      const url = typeof review?.html_url === "string" ? review.html_url : "";
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      const title = typeof pr?.title === "string" ? pr.title : "";
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
      };
    }

    case "issues": {
      if (action !== "opened" && action !== "edited") return null;
      const issue = payload.issue as Record<string, unknown> | undefined;
      const body = typeof issue?.body === "string" ? issue.body : "";
      if (!body) return null;
      const author = (issue?.user as Record<string, unknown> | undefined)
        ?.login;
      const url = typeof issue?.html_url === "string" ? issue.html_url : "";
      const title = typeof issue?.title === "string" ? issue.title : "";
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
      };
    }

    case "pull_request": {
      if (action !== "opened" && action !== "edited") return null;
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      const body = typeof pr?.body === "string" ? pr.body : "";
      if (!body) return null;
      const author = (pr?.user as Record<string, unknown> | undefined)?.login;
      const url = typeof pr?.html_url === "string" ? pr.html_url : "";
      const title = typeof pr?.title === "string" ? pr.title : "";
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
      };
    }

    // Goal threads in the dashboard are backed by GitHub Discussions, so
    // dashboard chat → Discussions → webhook → mention dispatch.
    case "discussion": {
      if (action !== "created" && action !== "edited") return null;
      const disc = payload.discussion as Record<string, unknown> | undefined;
      const body = typeof disc?.body === "string" ? disc.body : "";
      if (!body) return null;
      const author = (disc?.user as Record<string, unknown> | undefined)?.login;
      const url = typeof disc?.html_url === "string" ? disc.html_url : "";
      const title = typeof disc?.title === "string" ? disc.title : "";
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
      };
    }

    case "discussion_comment": {
      if (action && action !== "created") return null;
      const comment = payload.comment as Record<string, unknown> | undefined;
      const body = typeof comment?.body === "string" ? comment.body : "";
      const author = (comment?.user as Record<string, unknown> | undefined)?.login;
      const url = typeof comment?.html_url === "string" ? comment.html_url : "";
      const disc = payload.discussion as Record<string, unknown> | undefined;
      const title = typeof disc?.title === "string" ? disc.title : "";
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
      };
    }

    default:
      return null;
  }
}

function initVapid(): boolean {
  try {
    const { publicKey, privateKey } = deriveVapidKeys();
    webpush.setVapidDetails("mailto:kody@example.com", publicKey, privateKey);
    return true;
  } catch {
    // Derivation only fails if KODY_MASTER_KEY isn't set — same hard
    // dependency the vault has. Skip silently so a misconfigured server
    // can't break webhook delivery.
    return false;
  }
}

function toSubscription(r: PushSubscriptionRecord): WebPushSubscription {
  return {
    endpoint: r.endpoint,
    keys: { p256dh: r.keys.p256dh, auth: r.keys.auth },
  };
}

function isExpired(err: unknown): boolean {
  return err instanceof WebPushError &&
    (err.statusCode === 404 || err.statusCode === 410);
}

function buildPayload(
  mention: string,
  ev: MentionEvent,
  eventType: string,
): string {
  const kind =
    eventType === "issue_comment" || eventType === "pull_request_review_comment"
      ? "commented"
      : eventType === "pull_request_review"
        ? "reviewed"
        : eventType === "issues"
          ? "opened an issue"
          : eventType === "pull_request"
            ? "opened a PR"
            : "mentioned you";
  const who = ev.author ? `@${ev.author}` : "Someone";
  const where = ev.title ? ` on "${ev.title}"` : "";

  // The body is what the user actually sees — so put the comment snippet
  // first (that's the distinguishing content), then the repo/title context
  // on the second line. Earlier we only showed the issue title, which made
  // every notification on the same issue look identical.
  const snippet = ev.body
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return JSON.stringify({
    title: `${who} mentioned you${where}`,
    body: snippet || `${ev.repoFullName} — ${kind}`,
    url: ev.url,
    tag: `mention:${mention}:${ev.url ?? ev.repoFullName}`,
  });
}

/**
 * Entry point — call from the webhook receiver. Never throws; logs and swallows
 * errors so a misconfigured push setup can't break GitHub delivery.
 */
export async function dispatchMentionPushes(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const ev = extractEvent(eventType, payload);
    if (!ev) {
      logger.info(
        { event: "mention_push_skip_event_shape", eventType },
        "Event type/action not routable for mention push",
      );
      return;
    }
    const mentions = extractMentions(ev.body);
    if (mentions.length === 0) {
      logger.info(
        {
          event: "mention_push_no_mentions",
          eventType,
          repo: ev.repoFullName,
          bodyPreview: ev.body.slice(0, 80),
        },
        "Event body contained no @mentions",
      );
      return;
    }
    logger.info(
      {
        event: "mention_push_mentions_found",
        eventType,
        mentions,
        repo: ev.repoFullName,
      },
      `Found ${mentions.length} @mention(s)`,
    );

    const [owner, repo] = ev.repoFullName.split("/");
    if (!owner || !repo) return;

    if (!initVapid()) {
      logger.info(
        { event: "mention_push_no_vapid" },
        "VAPID keys missing — skipping mention push dispatch",
      );
      return;
    }

    const token =
      process.env.KODY_BOT_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_PAT;
    if (!token) {
      logger.warn(
        { event: "mention_push_no_token" },
        "No bot token — cannot read push manifest for mention dispatch",
      );
      return;
    }

    setGitHubContext(owner, repo, token);
    let subs: PushSubscriptionRecord[];
    try {
      const { manifest } = await readPushManifest();
      subs = manifest.subscriptions;
    } finally {
      clearGitHubContext();
    }

    // Note: we used to drop the author from the mention set so people
    // didn't ping themselves when typing `@me` in their own comment. The
    // user pointed out that's a footgun — if someone @s themselves it's
    // almost always intentional (a reminder, a self-cc), so respect it.
    const mentionSet = new Set(mentions);
    if (mentionSet.size === 0) return;

    const targets = subs.filter((s) => {
      const login = s.userLogin?.toLowerCase();
      return !!login && mentionSet.has(login);
    });

    if (targets.length === 0) {
      logger.info(
        {
          event: "mention_push_no_targets",
          mentions: [...mentionSet],
          subscriberLogins: subs.map((s) => s.userLogin ?? null),
          totalSubs: subs.length,
          repo: ev.repoFullName,
        },
        "No matching push subscriptions for @mentions",
      );
      return;
    }

    const expired: string[] = [];
    let sent = 0;
    let failed = 0;
    await Promise.allSettled(
      targets.map(async (sub) => {
        const login = sub.userLogin?.toLowerCase() ?? "";
        const body = buildPayload(login, ev, eventType);
        try {
          await webpush.sendNotification(toSubscription(sub), body);
          sent++;
        } catch (err) {
          failed++;
          if (isExpired(err)) {
            expired.push(sub.endpoint);
          } else {
            logger.warn(
              {
                event: "mention_push_send_failed",
                endpoint: sub.endpoint.slice(0, 60),
                error: err instanceof Error ? err.message : String(err),
              },
              "Mention push send failed",
            );
          }
        }
      }),
    );

    if (expired.length > 0) {
      setGitHubContext(owner, repo, token);
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
      } catch (err) {
        logger.warn(
          {
            event: "mention_push_prune_failed",
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to prune expired subscriptions after mention dispatch",
        );
      } finally {
        clearGitHubContext();
      }
    }

    logger.info(
      {
        event: "mention_push_dispatched",
        mentions: [...mentionSet],
        targets: targets.length,
        sent,
        failed,
        pruned: expired.length,
        repo: ev.repoFullName,
      },
      `Mention push: ${sent}/${targets.length} sent`,
    );
  } catch (err) {
    logger.error(
      {
        event: "mention_push_crashed",
        error: err instanceof Error ? err.message : String(err),
      },
      "dispatchMentionPushes threw — swallowing so webhook still ACKs",
    );
  }
}
