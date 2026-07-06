/**
 * @fileType utility
 * @domain kody
 * @pattern agent-mention-dispatch
 * @ai-summary Server-only sibling of `dispatchMentionPushes`. Turns any
 *   GitHub-backed comment that @mentions an agentIdentity into a one-shot
 *   `agent-ask` tick — so `@cto` works the same in messages, goals,
 *   tasks, previews, PR/issue comments, and reviews, from one place. The
 *   agent's reply is posted back into the exact thread it was
 *   mentioned in. Never throws; logs and swallows so the webhook still ACKs.
 *   (`agent-ask` is the unchanged engine implementation name; the dashboard
 *   feature noun is "agent".)
 *
 *   Why server-side (not per-surface client wiring): every listed surface
 *   is a GitHub comment under the hood and already flows through this
 *   webhook, so one hook covers them all and stays consistent for every
 *   newly-connected repo with zero setup.
 */
import "server-only";
import { Octokit } from "@octokit/rest";
import { setGitHubContext, clearGitHubContext } from "../github-client";
import { listAgentFiles } from "../agent-files";
import { dispatchAgentAsk, type WorkerAskReply } from "../control-issue";
import { extractStaffMentions } from "../mentions/agent-mentions";
import { buildSourceEvent } from "../notifications/source-event";
import { resolveBackgroundToken } from "../auth/background-token";
import { logger } from "../logger";

interface StaffDispatchEvent {
  repoFullName: string;
  body: string;
  author?: string;
  /** True when the comment was authored by a bot/app — skip to avoid loops. */
  authorIsBot: boolean;
  /** Where the agent should post its reply. */
  reply: WorkerAskReply;
}

/**
 * The action gate the agent spine applies on top of the shared normalizer:
 * a comment must be freshly `created`, a review `submitted`, an
 * issue/PR/discussion `opened`/`edited`. (Same shape as the mention spine —
 * both want "human just said something" — but kept local so the two can
 * diverge without surprising each other.)
 */
function isStaffAction(eventType: string, action: string): boolean {
  switch (eventType) {
    case "issue_comment":
    case "pull_request_review_comment":
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
 * Extract the body + reply target for every webhook event type that can carry
 * an @agent mention, via the shared `buildSourceEvent` normalizer. Discussions
 * reply in-discussion; everything else replies on the issue/PR thread (the
 * issues comment API serves PRs too). `commit_comment` is intentionally
 * unsupported — it has no single-thread reply target, and the normalizer
 * leaves its `number` undefined, so it falls out here.
 */
function extractEvent(
  eventType: string,
  payload: Record<string, unknown>,
): StaffDispatchEvent | null {
  const se = buildSourceEvent(eventType, payload);
  if (!se) return null;
  if (!isStaffAction(se.eventType, se.action)) return null;
  if (se.number === undefined) return null;
  const reply: WorkerAskReply =
    se.threadType === "Discussion"
      ? { kind: "discussion", number: se.number }
      : { kind: "issue", number: se.number };
  return {
    repoFullName: se.repoFullName,
    body: se.body,
    author: se.author,
    authorIsBot: se.authorIsBot,
    reply,
  };
}

/**
 * Entry point — call fire-and-forget from the webhook receiver alongside
 * `dispatchMentionPushes`.
 */
export async function dispatchAgentMentions(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const ev = extractEvent(eventType, payload);
    if (!ev || !ev.body) return;

    // Loop guard: the agent posts its reply as a comment in the same
    // thread. Skip bot/app authors and any body still carrying the
    // agent-ask directive so a reply can never re-trigger a run.
    if (ev.authorIsBot) return;
    if (/@kody\s+agent-ask\b/i.test(ev.body)) return;

    const [owner, repo] = ev.repoFullName.split("/");
    if (!owner || !repo) return;

    // App installation token (preferred) or vault GITHUB_TOKEN fallback.
    // Never a shared human PAT — see notifications-dispatch for the
    // rate-limit rationale: webhooks fire constantly and would flag the
    // account.
    const bg = await resolveBackgroundToken(owner, repo);
    if (!bg) {
      logger.warn(
        { event: "agent_mention_no_token", repo: ev.repoFullName },
        "No App install or vault GITHUB_TOKEN for repo — cannot resolve agent / dispatch agent-ask",
      );
      return;
    }
    const token = bg.token;

    // Resolve this repo's agent roster (state-repo `agents/`), so a
    // newly-connected repo works with zero setup.
    let slugs: string[] = [];
    setGitHubContext(owner, repo, token);
    try {
      slugs = (await listAgentFiles()).map((w) => w.slug);
    } catch (err) {
      logger.warn(
        {
          event: "agent_mention_roster_failed",
          error: err instanceof Error ? err.message : String(err),
          repo: ev.repoFullName,
        },
        "Agent roster read failed — skipping agent dispatch",
      );
      return;
    } finally {
      clearGitHubContext();
    }
    if (slugs.length === 0) return;

    const targeted = extractStaffMentions(ev.body, slugs);
    if (targeted.length === 0) return;

    const octokit = new Octokit({ auth: token });
    for (const slug of targeted) {
      try {
        const res = await dispatchAgentAsk(octokit, owner, repo, {
          slug,
          message: ev.body,
          reply: ev.reply,
        });
        logger.info(
          {
            event: "agent_mention_dispatched",
            slug,
            repo: ev.repoFullName,
            replyKind: ev.reply.kind,
            replyNumber: ev.reply.number,
            commentUrl: res.commentUrl,
          },
          `agent-ask dispatched: @${slug}`,
        );
      } catch (err) {
        logger.warn(
          {
            event: "agent_mention_dispatch_failed",
            slug,
            error: err instanceof Error ? err.message : String(err),
            repo: ev.repoFullName,
          },
          `agent-ask dispatch failed: @${slug}`,
        );
      }
    }
  } catch (err) {
    logger.error(
      {
        event: "agent_mention_crashed",
        error: err instanceof Error ? err.message : String(err),
      },
      "dispatchAgentMentions threw — swallowing so webhook still ACKs",
    );
  }
}
