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
import { setGitHubContext, clearGitHubContext } from "../github-client";
import { resolveVaultGithubToken } from "../vault/bootstrap";
import { readPushManifest, mutatePushManifest } from "../push-server";
import type { PushSubscriptionRecord } from "../push";
import { appendInboxFeed, readInboxFeed } from "../inbox/feed-server";
import { feedEntryId, type InboxFeedEntry } from "../inbox/feed";
import { buildSnippet } from "../inbox/types";
import {
  parseCtoAction,
  parseCtoCommand,
  parseCtoStaff,
} from "../cto/recommendation";
import { readCtoDecisions } from "../cto/decisions-server";
import { latestCtoDecisions } from "../cto/decisions";
import { applyCtoBackpressure } from "../cto/backpressure";
import { logger } from "../logger";
import { dashboardThreadUrl, dashboardChannelUrl } from "../thread-link";
import { buildSourceEvent } from "../notifications/source-event";
import { resolveRecipients } from "../notifications/recipients";
import { deriveVapidKeys } from "./vapid-keys";
import { INBOX_FEED_ISSUE_TITLE } from "../inbox/feed";
import { PUSH_MANIFEST_ISSUE_TITLE } from "../push";
import { CTO_DECISIONS_ISSUE_TITLE } from "../cto/decisions";
import { CONTROL_TITLE } from "../control-issue";

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
 * Collapse comment/issue markdown to readable plain prose for an OS
 * notification: drop code fences, blockquote markers, heading hashes, list
 * bullets, bold/italic emphasis, and flatten `[text](url)` links to `text`.
 * Phones render the notification body as plain text, so leaving raw markdown
 * in makes it look like noise (`> **CTO** _auto_ …`).
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

// `extractMentions` and the recipient policy now live in the shared resolver
// (`notifications/recipients.ts`). Re-exported here so existing import sites
// and tests keep working.
export { extractMentions } from "../notifications/recipients";

interface MentionEvent {
  body: string;
  author?: string;
  url?: string;
  title?: string;
  repoFullName: string;
  /** `Issue` / `PullRequest` / `Discussion` / `Commit` — for the inbox feed. */
  threadType: string;
  /**
   * Set when the event is a comment in a messaging *channel* (a `#`-titled
   * Discussion). Channel messages broadcast to every subscribed teammate
   * (not just `@mentions`) and deep-link into the in-app `/messages` view.
   */
  channel?: { number: number; commentId?: number };
}

/**
 * The action filter the mention/inbox spine applies on top of the shared
 * normalizer. Each event type only fires a mention notification on a specific
 * action — a comment must be freshly `created`, a review `submitted`, an
 * issue/PR/discussion `opened` or `edited`. (The rules spine, by contrast,
 * wants `pull_request: closed` — which is exactly why gating lives per-consumer
 * and only the parsing in `buildSourceEvent` is shared.)
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
 * Normalize the webhook (shared `buildSourceEvent`) and apply the mention
 * spine's action gate + "must have a body" rule. Returns the legacy
 * `MentionEvent` shape so the rest of this module is unchanged.
 */
function extractEvent(
  eventType: string,
  payload: Record<string, unknown>,
): MentionEvent | null {
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
  return {
    body: se.body,
    author: se.author,
    url: se.url,
    title: se.title,
    repoFullName: se.repoFullName,
    threadType: se.threadType,
    ...(se.channel ? { channel: se.channel } : {}),
  };
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
  return (
    err instanceof WebPushError &&
    (err.statusCode === 404 || err.statusCode === 410)
  );
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
  const snippet = plainSnippet(ev.body);

  // Channel messages deep-link into the in-app /messages view scrolled to
  // the message. Issue and PR threads open the dashboard task view (both
  // share the same number pool on GitHub); discussions/commits have no
  // dashboard deep route so they open github.com.
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
 * Append one inbox-feed entry per mentioned login. Best-effort and isolated:
 * a feed-write failure must not stop the web-push fan-out (or vice-versa), and
 * never throws so the webhook still ACKs. Skips mentions on events with no
 * deep-linkable url (the inbox needs a clickable target).
 */
async function recordInboxFeed(
  owner: string,
  repo: string,
  token: string,
  ev: MentionEvent,
  mentions: string[],
): Promise<void> {
  // Channel messages deep-link into the in-app /messages view; everything
  // else keeps its github.com comment anchor.
  const url = ev.channel
    ? dashboardChannelUrl({
        channelNumber: ev.channel.number,
        commentId: ev.channel.commentId,
      })
    : (ev.url ?? "");
  if (!url) return;
  const sentAt = new Date().toISOString();
  const snippet = buildSnippet(ev.body);
  // Parse the CTO verb from the *raw* body now, while backticks are intact —
  // the snippet collapses them to `[code]` and loses it.
  const ctoAction = parseCtoAction(ev.body ?? "");
  const ctoCommand = parseCtoCommand(ev.body ?? "");
  const ctoStaff = parseCtoStaff(ev.body ?? "");
  const entries: InboxFeedEntry[] = mentions.map((login) => ({
    id: feedEntryId(login, url),
    login,
    source: "mention",
    repoFullName: ev.repoFullName,
    threadType: ev.threadType,
    title: ev.title ?? "",
    snippet,
    author: ev.author,
    url,
    sentAt,
    ...(ctoAction ? { ctoAction } : {}),
    ...(ctoCommand ? { ctoCommand } : {}),
    ...(ctoStaff ? { ctoStaff } : {}),
  }));

  setGitHubContext(owner, repo, token);
  try {
    // Code-enforced cap on pending CTO recommendations. The cto.md staff member is
    // told to stop at 10 but counts by hand each tick and drifts; this gate
    // makes it deterministic at the single write point. Both reads are
    // cached (ETag/304) — no extra GitHub budget on the webhook path.
    let toAppend = entries;
    try {
      const [feed, ledger] = await Promise.all([
        readInboxFeed(),
        readCtoDecisions(),
      ]);
      const { admitted, withheld } = applyCtoBackpressure(
        feed.entries,
        entries,
        latestCtoDecisions(ledger),
      );
      toAppend = admitted;
      if (withheld.length > 0) {
        logger.info(
          {
            event: "cto_backpressure_withheld",
            withheld: withheld.length,
            repo: ev.repoFullName,
          },
          `CTO backpressure: withheld ${withheld.length} recommendation(s) — operator queue full (max 10 pending)`,
        );
      }
    } catch (bpErr) {
      // Fail open on the gate (never on the cap itself going wrong silently
      // dropping real mentions): if the ledger/feed read fails, append as
      // before rather than block delivery.
      logger.warn(
        {
          event: "cto_backpressure_skipped",
          error: bpErr instanceof Error ? bpErr.message : String(bpErr),
          repo: ev.repoFullName,
        },
        "CTO backpressure check failed — appending without gate",
      );
    }

    const added = await appendInboxFeed(toAppend);
    logger.info(
      { event: "inbox_feed_appended", added, mentions, repo: ev.repoFullName },
      `Inbox feed: +${added} entr${added === 1 ? "y" : "ies"}`,
    );
  } catch (err) {
    logger.warn(
      {
        event: "inbox_feed_append_failed",
        error: err instanceof Error ? err.message : String(err),
        repo: ev.repoFullName,
      },
      "Inbox feed append failed — web-push still proceeds",
    );
  } finally {
    clearGitHubContext();
  }
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

    // The dashboard's own manifest issues (inbox feed, push subscriptions,
    // CTO ledger) get edited on every write; that re-fires this webhook with
    // a body full of `@login` feed entries. Notifying on them pings the user
    // with raw manifest text — pure self-feedback noise. Drop them.
    if (BOOKKEEPING_THREAD_TITLES.has(ev.title ?? "")) {
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
    const [owner, repo] = ev.repoFullName.split("/");
    if (!owner || !repo) return;

    // Token comes from the repo's vault, decrypted with KODY_MASTER_KEY (the
    // only secret Vercel holds). The webhook is unauthenticated, so there is
    // no user/env token to use; the encrypted vault blob is world-readable on
    // public repos, so we can bootstrap the token from it.
    const token = await resolveVaultGithubToken(owner, repo);
    if (!token) {
      logger.warn(
        { event: "mention_push_no_token", repo: ev.repoFullName },
        "No vault GITHUB_TOKEN for repo — cannot read push manifest / write inbox feed",
      );
      return;
    }

    // Read the push manifest once. Needed up front for channel broadcasts
    // (the audience IS the subscriber set) and reused for the web-push
    // fan-out below. A read failure must not drop mention inbox entries,
    // so fail open with an empty list.
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

    // Recipients: channel messages broadcast to every subscribed teammate
    // (minus the author); everything else is gated to explicit `@mentions`.
    // The "who" decision lives in the shared resolver — here we only log and
    // bail early.
    const { logins: recipients, isChannelBroadcast } = resolveRecipients(
      ev,
      subs,
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
          "Event body contained no @mentions",
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

    // 1. Durable inbox feed — the source of truth for the dashboard inbox.
    //    Runs regardless of whether web-push is configured so the inbox
    //    surfaces the message even when no device subscribed.
    //    Channel messages are skipped: the recipient already receives the
    //    message itself (in-app + broadcast push), so an inbox mention
    //    entry pointing back at the same message is redundant noise.
    if (!ev.channel) {
      await recordInboxFeed(owner, repo, token, ev, recipients);
    }

    // 2. Best-effort web-push fan-out to subscribed devices.
    if (!initVapid()) {
      logger.info(
        { event: "mention_push_no_vapid" },
        "VAPID keys missing — inbox feed written, skipping web-push",
      );
      return;
    }

    const mentionSet = new Set(recipients);
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
