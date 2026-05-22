/**
 * @fileType utility
 * @domain kody
 * @pattern worker-mention-dispatch
 * @ai-summary Server-only sibling of `dispatchMentionPushes`. Turns any
 *   GitHub-backed comment that @mentions a worker persona into a one-shot
 *   `worker-ask` tick — so `@cto` works the same in messages, goals,
 *   tasks, previews, PR/issue comments, and reviews, from one place. The
 *   worker's reply is posted back into the exact thread it was mentioned
 *   in. Never throws; logs and swallows so the webhook still ACKs.
 *
 *   Why server-side (not per-surface client wiring): every listed surface
 *   is a GitHub comment under the hood and already flows through this
 *   webhook, so one hook covers them all and stays consistent for every
 *   newly-connected repo with zero setup.
 */
import "server-only";
import { Octokit } from "@octokit/rest";
import { setGitHubContext, clearGitHubContext } from "../github-client";
import { listWorkerFiles } from "../workers-files";
import {
  dispatchWorkerAsk,
  type WorkerAskReply,
} from "../control-issue";
import { extractWorkerMentions } from "../mentions/worker-mentions";
import { logger } from "../logger";

interface WorkerDispatchEvent {
  repoFullName: string;
  body: string;
  author?: string;
  /** True when the comment was authored by a bot/app — skip to avoid loops. */
  authorIsBot: boolean;
  /** Where the worker should post its reply. */
  reply: WorkerAskReply;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : undefined;
}

function userOf(v: unknown): { login?: string; isBot: boolean } {
  const u = asRecord(asRecord(v)?.user);
  const login = typeof u?.login === "string" ? u.login : undefined;
  const isBot = u?.type === "Bot";
  return { login, isBot };
}

/**
 * Extract the body + reply target for every webhook event type that can
 * carry an @worker mention. `issue:<n>` covers PRs too (the issues comment
 * API serves both). `commit_comment` is intentionally unsupported — there
 * is no clean single-thread reply target for it.
 */
function extractEvent(
  eventType: string,
  payload: Record<string, unknown>,
): WorkerDispatchEvent | null {
  const repoFullName =
    typeof asRecord(payload.repository)?.full_name === "string"
      ? (asRecord(payload.repository)!.full_name as string)
      : "";
  if (!repoFullName) return null;
  const action = typeof payload.action === "string" ? payload.action : "";

  const issue = asRecord(payload.issue);
  const pr = asRecord(payload.pull_request);
  const comment = asRecord(payload.comment);
  const review = asRecord(payload.review);
  const disc = asRecord(payload.discussion);

  switch (eventType) {
    case "issue_comment": {
      if (action && action !== "created") return null;
      const n = issue?.number;
      if (typeof n !== "number") return null;
      const { login, isBot } = userOf(comment);
      return {
        repoFullName,
        body: typeof comment?.body === "string" ? comment.body : "",
        author: login,
        authorIsBot: isBot,
        reply: { kind: "issue", number: n },
      };
    }
    case "pull_request_review_comment": {
      if (action && action !== "created") return null;
      const n = pr?.number;
      if (typeof n !== "number") return null;
      const { login, isBot } = userOf(comment);
      return {
        repoFullName,
        body: typeof comment?.body === "string" ? comment.body : "",
        author: login,
        authorIsBot: isBot,
        reply: { kind: "issue", number: n },
      };
    }
    case "pull_request_review": {
      if (action && action !== "submitted") return null;
      const n = pr?.number;
      if (typeof n !== "number") return null;
      const { login, isBot } = userOf(review);
      return {
        repoFullName,
        body: typeof review?.body === "string" ? review.body : "",
        author: login,
        authorIsBot: isBot,
        reply: { kind: "issue", number: n },
      };
    }
    case "issues": {
      if (action !== "opened" && action !== "edited") return null;
      const n = issue?.number;
      if (typeof n !== "number") return null;
      const { login, isBot } = userOf(issue);
      return {
        repoFullName,
        body: typeof issue?.body === "string" ? issue.body : "",
        author: login,
        authorIsBot: isBot,
        reply: { kind: "issue", number: n },
      };
    }
    case "pull_request": {
      if (action !== "opened" && action !== "edited") return null;
      const n = pr?.number;
      if (typeof n !== "number") return null;
      const { login, isBot } = userOf(pr);
      return {
        repoFullName,
        body: typeof pr?.body === "string" ? pr.body : "",
        author: login,
        authorIsBot: isBot,
        reply: { kind: "issue", number: n },
      };
    }
    case "discussion": {
      if (action !== "created" && action !== "edited") return null;
      const n = disc?.number;
      if (typeof n !== "number") return null;
      const { login, isBot } = userOf(disc);
      return {
        repoFullName,
        body: typeof disc?.body === "string" ? disc.body : "",
        author: login,
        authorIsBot: isBot,
        reply: { kind: "discussion", number: n },
      };
    }
    case "discussion_comment": {
      if (action && action !== "created") return null;
      const n = disc?.number;
      if (typeof n !== "number") return null;
      const { login, isBot } = userOf(comment);
      return {
        repoFullName,
        body: typeof comment?.body === "string" ? comment.body : "",
        author: login,
        authorIsBot: isBot,
        reply: { kind: "discussion", number: n },
      };
    }
    default:
      return null;
  }
}

/**
 * Entry point — call fire-and-forget from the webhook receiver alongside
 * `dispatchMentionPushes`.
 */
export async function dispatchWorkerMentions(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const ev = extractEvent(eventType, payload);
    if (!ev || !ev.body) return;

    // Loop guard: the worker posts its reply as a comment in the same
    // thread. Skip bot/app authors and any body still carrying the
    // worker-ask directive so a reply can never re-trigger a run.
    if (ev.authorIsBot) return;
    if (/@kody\s+worker-ask\b/i.test(ev.body)) return;

    const [owner, repo] = ev.repoFullName.split("/");
    if (!owner || !repo) return;

    const token =
      process.env.KODY_BOT_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_PAT;
    if (!token) {
      logger.warn(
        { event: "worker_mention_no_token" },
        "No bot token — cannot resolve workers / dispatch worker-ask",
      );
      return;
    }

    // Resolve this repo's worker roster (per-repo `.kody/workers/`), so a
    // newly-connected repo works with zero setup.
    let slugs: string[] = [];
    setGitHubContext(owner, repo, token);
    try {
      slugs = (await listWorkerFiles()).map((w) => w.slug);
    } catch (err) {
      logger.warn(
        {
          event: "worker_mention_roster_failed",
          error: err instanceof Error ? err.message : String(err),
          repo: ev.repoFullName,
        },
        "Worker roster read failed — skipping worker dispatch",
      );
      return;
    } finally {
      clearGitHubContext();
    }
    if (slugs.length === 0) return;

    const targeted = extractWorkerMentions(ev.body, slugs);
    if (targeted.length === 0) return;

    const octokit = new Octokit({ auth: token });
    for (const slug of targeted) {
      try {
        const res = await dispatchWorkerAsk(octokit, owner, repo, {
          slug,
          message: ev.body,
          reply: ev.reply,
        });
        logger.info(
          {
            event: "worker_mention_dispatched",
            slug,
            repo: ev.repoFullName,
            replyKind: ev.reply.kind,
            replyNumber: ev.reply.number,
            commentUrl: res.commentUrl,
          },
          `worker-ask dispatched: @${slug}`,
        );
      } catch (err) {
        logger.warn(
          {
            event: "worker_mention_dispatch_failed",
            slug,
            error: err instanceof Error ? err.message : String(err),
            repo: ev.repoFullName,
          },
          `worker-ask dispatch failed: @${slug}`,
        );
      }
    }
  } catch (err) {
    logger.error(
      {
        event: "worker_mention_crashed",
        error: err instanceof Error ? err.message : String(err),
      },
      "dispatchWorkerMentions threw — swallowing so webhook still ACKs",
    );
  }
}
