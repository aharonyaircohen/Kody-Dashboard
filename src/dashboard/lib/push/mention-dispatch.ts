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
import { readPushManifest, mutatePushManifest } from "../push-server";
import type { PushSubscriptionRecord } from "../push";
import { appendInboxFeed, readInboxFeed } from "../inbox/feed-server";
import { feedEntryId, type InboxFeedEntry } from "../inbox/feed";
import { buildSnippet } from "../inbox/types";
import { parseCtoAction, parseCtoCommand } from "../cto/recommendation";
import { readCtoDecisions } from "../cto/decisions-server";
import { latestCtoDecisions } from "../cto/decisions";
import { applyCtoBackpressure } from "../cto/backpressure";
import { logger } from "../logger";
import { dashboardThreadUrl, dashboardChannelUrl } from "../thread-link";
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
  /** `Issue` / `PullRequest` / `Discussion` / `Commit` — for the inbox feed. */
  threadType: string;
  /**
   * Set when the event is a comment in a messaging *channel* (a `#`-titled
   * Discussion). Channel messages broadcast to every subscribed teammate
   * (not just `@mentions`) and deep-link into the in-app `/messages` view.
   */
  channel?: { number: number; commentId?: number };
}

/** Channels are Discussions whose title starts with this marker. */
const CHANNEL_TITLE_PREFIX = "#";

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
      const threadType =
        eventType === "commit_comment"
          ? "Commit"
          : eventType === "pull_request_review_comment" || issue?.pull_request
            ? "PullRequest"
            : "Issue";
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
        threadType,
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
        threadType: "PullRequest",
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
        threadType: "Issue",
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
        threadType: "PullRequest",
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
        threadType: "Discussion",
      };
    }

    case "discussion_comment": {
      if (action && action !== "created") return null;
      const comment = payload.comment as Record<string, unknown> | undefined;
      const body = typeof comment?.body === "string" ? comment.body : "";
      const author = (comment?.user as Record<string, unknown> | undefined)
        ?.login;
      const url = typeof comment?.html_url === "string" ? comment.html_url : "";
      const disc = payload.discussion as Record<string, unknown> | undefined;
      const title = typeof disc?.title === "string" ? disc.title : "";
      // A `#`-titled discussion is a messaging channel — every comment is a
      // team message that broadcasts to all subscribers and deep-links into
      // the in-app channel view.
      const isChannel = title.startsWith(CHANNEL_TITLE_PREFIX);
      const discNumber =
        typeof disc?.number === "number" ? disc.number : undefined;
      const commentId =
        typeof comment?.id === "number" ? comment.id : undefined;
      return {
        body,
        author: typeof author === "string" ? author : undefined,
        url,
        title,
        repoFullName,
        threadType: "Discussion",
        ...(isChannel && discNumber !== undefined
          ? { channel: { number: discNumber, commentId } }
          : {}),
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

    const token =
      process.env.KODY_BOT_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_PAT;
    if (!token) {
      logger.warn(
        { event: "mention_push_no_token" },
        "No bot token — cannot read push manifest / write inbox feed",
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
    // (minus the author — you don't get pinged for your own message);
    // everything else stays gated to explicit `@mentions`.
    let recipients: string[];
    if (ev.channel) {
      const authorLc = ev.author?.toLowerCase();
      const mentionedLc = new Set(extractMentions(ev.body));
      // Per-subscription preference: `off` opts out entirely, `mentions`
      // only fires when @mentioned, `all`/undefined gets every message.
      const wantsChannel = (s: PushSubscriptionRecord): boolean => {
        const login = s.userLogin?.toLowerCase();
        if (!login || login === authorLc) return false;
        if (s.channelNotify === "off") return false;
        if (s.channelNotify === "mentions") return mentionedLc.has(login);
        return true;
      };
      recipients = [
        ...new Set(
          subs
            .filter(wantsChannel)
            .map((s) => s.userLogin!.toLowerCase()),
        ),
      ];
      logger.info(
        {
          event: "channel_broadcast_recipients",
          channel: ev.channel.number,
          recipients,
          repo: ev.repoFullName,
        },
        `Channel #${ev.channel.number} broadcast → ${recipients.length} subscriber(s)`,
      );
      if (recipients.length === 0) return;
    } else {
      recipients = extractMentions(ev.body);
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
