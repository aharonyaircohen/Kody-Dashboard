/**
 * @fileType utility
 * @domain kody
 * @pattern mention-push-dispatch
 * @ai-summary Server-only orchestrator for the mention/inbox notification
 *   spine. It owns the *flow* only — normalize the webhook (`buildSourceEvent`),
 *   classify it to a mute-able notification type, resolve who to notify
 *   (`resolveRecipients`, applying each recipient's per-type mute prefs), then
 *   fan out to the channel adapters: the durable inbox (`channels/inbox.deliverInbox`)
 *   and per-recipient web push (`channels/mention-push.deliverMentionPush`). The
 *   "what counts as a mention", "who gets it", "how an entry is written", and
 *   "how a push is sent" all live in those dedicated modules now — this file
 *   just sequences them and never throws so the webhook always ACKs.
 */
import "server-only";
import { setGitHubContext, clearGitHubContext } from "../github-client";
import { resolveVaultGithubToken } from "../vault/bootstrap";
import { readPushManifest } from "../push-server";
import type { PushSubscriptionRecord } from "../push";
import { PUSH_MANIFEST_ISSUE_TITLE } from "../push";
import { logger } from "../logger";
import { buildSourceEvent, type SourceEvent } from "../notifications/source-event";
import {
  resolveRecipients,
  extractMentions,
  type ServerNotificationType,
} from "../notifications/recipients";
import { classifyNotificationType } from "../notifications/notification-types";
import { readNotificationPrefs } from "../notifications/prefs-store";
import { deliverInbox } from "../notifications/channels/inbox";
import { deliverMentionPush } from "../notifications/channels/mention-push";
import { INBOX_FEED_ISSUE_TITLE } from "../inbox/feed";
import { CTO_DECISIONS_ISSUE_TITLE } from "../cto/decisions";
import { CONTROL_TITLE } from "../control-issue";

// `extractMentions` and the recipient policy live in the shared resolver
// (`notifications/recipients.ts`). Re-exported here so existing import sites
// and tests keep working.
export { extractMentions } from "../notifications/recipients";

/**
 * Titles of the dashboard's own bookkeeping issues. These are storage
 * scratchpads (the inbox feed, push-subscription list, CTO decision ledger)
 * or audit trails (the Kody control issue) — every dashboard write edits
 * them, which re-fires an `issues.edited` / `issue_comment.created` webhook
 * whose body is full of `@login` feed entries or `@kody worker-ask`
 * directives. Routing those as mention pushes is a self-feedback loop: the
 * user gets pinged with the raw manifest text. Never notify on them.
 */
const BOOKKEEPING_THREAD_TITLES = new Set<string>([
  INBOX_FEED_ISSUE_TITLE,
  PUSH_MANIFEST_ISSUE_TITLE,
  CTO_DECISIONS_ISSUE_TITLE,
  CONTROL_TITLE,
]);

/**
 * The action gate the mention/inbox spine applies on top of the shared
 * normalizer. Each event type only fires a mention notification on a specific
 * action — a comment must be freshly `created`, a review `submitted`, an
 * issue/PR/discussion `opened`/`edited`. (The rules spine, by contrast, wants
 * `pull_request: closed` — which is why gating lives per-consumer and only the
 * parsing in `buildSourceEvent` is shared.)
 */
function isMentionAction(eventType: string, action: string): boolean {
  switch (eventType) {
    case "issue_comment":
    case "pull_request_review_comment":
    case "commit_comment":
    case "discussion_comment":
      return !action || action === "created";
    case "pull_request_review":
      return !action || action === "submitted";
    case "issues":
    case "pull_request":
    case "discussion":
      return action === "opened" || action === "edited";
    default:
      return false;
  }
}

/**
 * Normalize the webhook and apply the mention spine's action gate + "must have
 * a body" rule. Returns the `SourceEvent` (the shared shape) or null.
 */
function extractEvent(
  eventType: string,
  payload: Record<string, unknown>,
): SourceEvent | null {
  const se = buildSourceEvent(eventType, payload);
  if (!se) return null;
  if (!isMentionAction(se.eventType, se.action)) return null;
  // Issues / PRs / reviews / discussions with no body can't carry a mention.
  // (Comment events historically skipped this check — preserve that: an empty
  // comment body simply yields no mentions downstream.)
  const requiresBody =
    eventType === "issues" ||
    eventType === "pull_request" ||
    eventType === "pull_request_review" ||
    eventType === "discussion";
  if (requiresBody && !se.body) return null;
  return se;
}

/**
 * Build the `login → mutedTypes` map for the recipients who *could* receive
 * this event, so the resolver can drop anyone who muted this notification type.
 * Skips all GitHub reads when the event has no mute-able type. Candidates are
 * the subscriber set for a channel broadcast, or the body's @mentions otherwise
 * — and `readNotificationPrefs` is ETag-cached (a free 304 / cheap 404 for the
 * common "no prefs file" case), so this stays within the hot-path budget.
 */
async function loadMutedTypes(
  ev: SourceEvent,
  subs: PushSubscriptionRecord[],
  notificationType: ServerNotificationType | null,
  ctx: { owner: string; repo: string; token: string },
): Promise<Map<string, ServerNotificationType[]> | undefined> {
  if (!notificationType) return undefined;
  const candidates = ev.channel
    ? [
        ...new Set(
          subs
            .map((s) => s.userLogin?.toLowerCase())
            .filter((l): l is string => !!l),
        ),
      ]
    : extractMentions(ev.body);
  if (candidates.length === 0) return undefined;

  const muted = new Map<string, ServerNotificationType[]>();
  setGitHubContext(ctx.owner, ctx.repo, ctx.token);
  try {
    await Promise.all(
      candidates.map(async (login) => {
        const prefs = await readNotificationPrefs(login, ctx.token);
        if (prefs.mutedTypes.length > 0) muted.set(login, prefs.mutedTypes);
      }),
    );
  } catch (err) {
    // Fail open — a prefs read failure must never suppress a real notification.
    logger.warn(
      {
        event: "mention_push_prefs_read_failed",
        error: err instanceof Error ? err.message : String(err),
        repo: ev.repoFullName,
      },
      "Notification prefs read failed — delivering without per-type mute",
    );
  } finally {
    clearGitHubContext();
  }
  return muted;
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

    // The dashboard's own manifest issues get edited on every write; that
    // re-fires this webhook with a body full of `@login` feed entries.
    // Notifying on them pings the user with raw manifest text — drop them.
    if (BOOKKEEPING_THREAD_TITLES.has(ev.title)) {
      logger.info(
        {
          event: "mention_push_skip_bookkeeping",
          eventType,
          title: ev.title,
          repo: ev.repoFullName,
        },
        "Skipped mention push on dashboard bookkeeping manifest issue",
      );
      return;
    }

    const { owner, repo } = ev;
    if (!owner || !repo) return;

    // Token comes from the repo's vault, decrypted with KODY_MASTER_KEY. The
    // webhook is unauthenticated, so there is no user/env token to use; the
    // encrypted vault blob is world-readable on public repos, so we can
    // bootstrap the token from it.
    const token = await resolveVaultGithubToken(owner, repo);
    if (!token) {
      logger.warn(
        { event: "mention_push_no_token", repo: ev.repoFullName },
        "No vault GITHUB_TOKEN for repo — cannot read push manifest / write inbox feed",
      );
      return;
    }
    const ctx = { owner, repo, token };

    // Read the push manifest once: channel broadcasts use it as the audience,
    // and the push fan-out reuses it. A read failure must not drop inbox
    // entries, so fail open with an empty list.
    setGitHubContext(owner, repo, token);
    let subs: PushSubscriptionRecord[] = [];
    try {
      const { manifest } = await readPushManifest();
      subs = manifest.subscriptions;
    } catch (err) {
      logger.warn(
        {
          event: "mention_push_manifest_read_failed",
          error: err instanceof Error ? err.message : String(err),
          repo: ev.repoFullName,
        },
        "Push manifest read failed — proceeding with empty subscriber set",
      );
    } finally {
      clearGitHubContext();
    }

    // Per-type mute: classify the event, then look up muted types for the
    // candidate recipients so the resolver can drop anyone who muted it. Both
    // are skipped entirely when the event has no mute-able type.
    const notificationType = classifyNotificationType(ev);
    const mutedTypesByLogin = await loadMutedTypes(
      ev,
      subs,
      notificationType,
      ctx,
    );

    // Who to notify — the single resolver owns the decision (mention scrape,
    // channel broadcast, and per-type mute); we only log/bail.
    const { logins: recipients, isChannelBroadcast } = resolveRecipients(
      ev,
      subs,
      { notificationType, mutedTypesByLogin },
    );
    if (isChannelBroadcast) {
      logger.info(
        {
          event: "channel_broadcast_recipients",
          channel: ev.channel?.number,
          recipients,
          repo: ev.repoFullName,
        },
        `Channel #${ev.channel?.number} broadcast → ${recipients.length} subscriber(s)`,
      );
      if (recipients.length === 0) return;
    } else {
      if (recipients.length === 0) {
        logger.info(
          {
            event: "mention_push_no_mentions",
            eventType,
            repo: ev.repoFullName,
            bodyPreview: ev.body.slice(0, 80),
          },
          "Event body contained no @mentions (or all recipients muted this type)",
        );
        return;
      }
      logger.info(
        {
          event: "mention_push_mentions_found",
          eventType,
          mentions: recipients,
          repo: ev.repoFullName,
        },
        `Found ${recipients.length} @mention(s)`,
      );
    }

    // Durable inbox feed — the source of truth for the dashboard inbox. Runs
    // regardless of whether web-push is configured. Channel messages skip it:
    // the recipient already gets the message itself (in-app + broadcast push),
    // so an inbox entry pointing back at the same message is redundant noise.
    if (!ev.channel) {
      await deliverInbox(ev, recipients, ctx);
    }

    // Best-effort per-recipient web-push fan-out.
    await deliverMentionPush(ev, recipients, subs, ctx);
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
