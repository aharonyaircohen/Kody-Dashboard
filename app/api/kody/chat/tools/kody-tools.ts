/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Kody-pipeline dispatch tools for the kody-direct chat agent.
 *
 * Each tool posts a `@kody <capability>` comment on an existing issue or pull
 * request.
 *
 * These tools DO trigger the pipeline. They must only be called when
 * the user explicitly asks to run a kody command (e.g. "kody fix #45",
 * "have kody review this PR", "rerun fix-ci on the PR"). Each tool's
 * description repeats this gate so the model carries it through.
 *
 * Supported PR-targeted capability actions:
 *   fix         — apply fixes; bare = use PR review body
 *   fix-ci      — fix failing CI on the PR
 *   review      — code review
 *   resolve     — resolve merge conflicts
 *   revert      — revert the PR's merge commit
 *   sync        — merge the PR's base branch into it and push
 *
 * Issue-targeted dispatch (kody_run_issue): posts `@kody <capability>` on an
 * issue so the engine picks it up and executes the work — clone, edit,
 * commit, PR. This is the "execute the plan" handoff: the chat model does
 * research + planning, then on user confirmation calls this tool to hand
 * the plan to the engine for execution.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import {
  invalidateIssueCache,
  invalidatePRCache,
} from "@dashboard/lib/github-client";
import {
  isValidSlug,
  readResolvedCapabilityFile,
} from "@dashboard/lib/capabilities";
import { dashboardTaskUrl } from "@dashboard/lib/thread-link";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

type KodyPrCommand =
  | "fix"
  | "fix-ci"
  | "review"
  | "resolve"
  | "revert"
  | "sync";

interface DispatchResult {
  number: number;
  url: string;
  command: string;
  triggered: boolean;
  note: string;
}

interface DispatchError {
  error: string;
}

async function resolveCapabilityAction(
  ctx: Ctx,
  capabilitySlug: string,
): Promise<{ slug: string; action: string } | DispatchError> {
  const slug = capabilitySlug.trim();
  if (!slug || !isValidSlug(slug)) {
    return {
      error:
        "Refusing to dispatch: capability must be lowercase letters, digits, dashes, or underscores.",
    };
  }
  const capability = await readResolvedCapabilityFile(slug, ctx.octokit);
  if (!capability) {
    return {
      error: `Refusing to dispatch: capability "${slug}" was not found.`,
    };
  }
  return { slug: capability.slug, action: capability.slug };
}

async function dispatchOnPr(
  ctx: Ctx,
  prNumber: number,
  command: KodyPrCommand,
  notes: string | undefined,
): Promise<DispatchResult | DispatchError> {
  const { octokit, owner, repo } = ctx;
  const capabilityAction = await resolveCapabilityAction(ctx, command);
  if ("error" in capabilityAction) return capabilityAction;
  const commentBody = notes?.trim()
    ? `@kody ${capabilityAction.action}\n\n${notes.trim()}`
    : `@kody ${capabilityAction.action}`;

  try {
    const existing = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: prNumber,
    });
    if (!existing.data.pull_request) {
      return {
        error:
          `Refusing to dispatch: #${prNumber} is an issue, not a pull request. ` +
          `\`@kody ${command}\` is a PR-only command.`,
      };
    }

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    });

    // PR list cache + the per-issue comments cache (PRs share the issues
    // comments cache key). Without this, the dashboard can sit on a stale
    // view until TTL expires.
    invalidatePRCache();
    invalidateIssueCache(prNumber);

    logger.info(
      { owner, repo, number: prNumber, capability: capabilityAction.slug },
      "kody-dispatch: posted trigger comment",
    );

    return {
      number: prNumber,
      url: dashboardTaskUrl(prNumber, { owner, repo }),
      command: `@kody ${capabilityAction.action}`,
      triggered: true,
      note: `Posted \`@kody ${capabilityAction.action}\` on PR #${prNumber}. Engine should pick it up shortly.`,
    };
  } catch (err) {
    logger.warn(
      { err, owner, repo, number: prNumber, command },
      "kody-dispatch failed",
    );
    return {
      error:
        err instanceof Error
          ? err.message
          : `Failed to dispatch @kody ${capabilityAction.action}`,
    };
  }
}

async function dispatchOnIssue(
  ctx: Ctx,
  issueNumber: number,
  capability: string,
  notes: string | undefined,
): Promise<DispatchResult | DispatchError> {
  const { octokit, owner, repo } = ctx;
  const capabilityAction = await resolveCapabilityAction(ctx, capability);
  if ("error" in capabilityAction) return capabilityAction;
  const header = `@kody ${capabilityAction.action}`;
  const commentBody = notes?.trim() ? `${header}\n\n${notes.trim()}` : header;

  try {
    const existing = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    if (existing.data.pull_request) {
      return {
        error:
          `Refusing to dispatch: #${issueNumber} is a pull request, not an issue. ` +
          `Use the PR-targeted tools (kody_fix_pr, kody_review_pr, etc.) instead.`,
      };
    }

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: commentBody,
    });

    invalidateIssueCache(issueNumber);

    logger.info(
      { owner, repo, number: issueNumber, capability: capabilityAction.slug },
      "kody-dispatch: posted issue trigger",
    );

    return {
      number: issueNumber,
      url: dashboardTaskUrl(issueNumber, { owner, repo }),
      command: header,
      triggered: true,
      note: `Posted \`${header}\` on issue #${issueNumber}. The engine will pick it up shortly and start executing — clone, edit, commit, open PR.`,
    };
  } catch (err) {
    logger.warn(
      {
        err,
        owner,
        repo,
        number: issueNumber,
        capability: capabilityAction.slug,
      },
      "kody-dispatch (issue) failed",
    );
    return {
      error:
        err instanceof Error
          ? err.message
          : `Failed to dispatch ${header} on issue #${issueNumber}`,
    };
  }
}

const PR_NUMBER_SCHEMA = z
  .number()
  .int()
  .positive()
  .describe("The pull request number to dispatch on.");

const ISSUE_NUMBER_SCHEMA = z
  .number()
  .int()
  .positive()
  .describe("The GitHub issue number to dispatch on.");

const CAPABILITY_SCHEMA = z
  .string()
  .max(64)
  .optional()
  .describe(
    "Which Kody capability to run. Defaults to `classify`. The capability folder must exist under `capabilities/<slug>/` in the state repo.",
  );

const NOTES_SCHEMA = z
  .string()
  .max(8_000)
  .optional()
  .describe(
    "Optional extra context appended below the `@kody` line in the same " +
      "comment (e.g. specific feedback, focus areas, hints). Plain markdown.",
  );

export function createKodyTools(ctx: Ctx) {
  const { owner, repo } = ctx;

  return {
    kody_fix_pr: tool({
      description:
        `Post \`@kody fix\` as a comment on a PR in ${owner}/${repo} to ask Kody ` +
        "to apply fixes (uses the PR review body when no extra notes are given). " +
        "DOES auto-trigger the Kody pipeline. Only call when the user explicitly " +
        'asks ("kody, fix this PR", "have kody fix #45", "tell kody to apply the ' +
        'review feedback"). If intent is ambiguous, confirm with the user before ' +
        "calling.",
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, "fix", notes),
    }),

    kody_fix_ci_pr: tool({
      description:
        `Post \`@kody fix-ci\` on a PR in ${owner}/${repo} to ask Kody to fix ` +
        "failing CI on that PR. DOES auto-trigger the Kody pipeline. Only call " +
        'when the user explicitly asks ("kody, fix the CI on this PR", "rerun ' +
        'fix-ci on #45"). If intent is ambiguous, confirm before calling.',
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, "fix-ci", notes),
    }),

    kody_review_pr: tool({
      description:
        `Post \`@kody review\` on a PR in ${owner}/${repo} to ask Kody to run a ` +
        "code review. DOES auto-trigger the Kody pipeline (the engine writes its " +
        'review to the PR). Only call when the user explicitly asks ("kody, ' +
        'review this PR", "have kody look at #45"). If the user only wants YOUR ' +
        "opinion in chat, do NOT call this — read the PR with github_get_pull_request " +
        "and answer in chat instead.",
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, "review", notes),
    }),

    kody_resolve_pr: tool({
      description:
        `Post \`@kody resolve\` on a PR in ${owner}/${repo} to ask Kody to resolve ` +
        "merge conflicts on that PR. DOES auto-trigger the Kody pipeline. Only " +
        'call when the user explicitly asks ("kody, resolve conflicts on #45", ' +
        '"have kody fix the merge conflicts"). Note: this is "resolve merge ' +
        'conflicts", NOT "close the issue" — for closing an issue use ' +
        "github_close_issue instead.",
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, "resolve", notes),
    }),

    kody_revert_pr: tool({
      description:
        `Post \`@kody revert\` on a PR in ${owner}/${repo} to ask Kody to revert ` +
        "the PR's merge. DESTRUCTIVE — DOES auto-trigger the Kody pipeline and " +
        "rewrites history on a follow-up branch. Only call when the user " +
        'explicitly and unambiguously asks ("kody, revert PR #45", "undo that ' +
        'merge"). When in doubt, confirm with the user before calling.',
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, "revert", notes),
    }),

    kody_sync_pr: tool({
      description:
        `Post \`@kody sync\` on a PR in ${owner}/${repo} to merge the PR's base ` +
        "branch into it and push. Use when the PR is behind base and the user " +
        'asks to "sync this PR", "update from main/base", or fix "branch is out ' +
        'of date" warnings. DOES auto-trigger the Kody pipeline (no agent — ' +
        "just a merge + push). Safe to call on multiple PRs in a batch when " +
        "the user asks.",
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, "sync", notes),
    }),

    kody_run_issue: tool({
      description:
        `EXECUTE a plan on an issue in ${owner}/${repo}. Posts ` +
        "`@kody <capability>` (default: `classify`) as a comment on the issue. " +
        "The Kody engine in GitHub Actions then clones the repo, edits " +
        "files, commits, and opens a PR for that issue. THIS IS THE ONLY " +
        "way to actually execute code work from this chat — you do not " +
        "edit code yourself. " +
        'CALL when the user asks to "execute", "run", "ship", "build", ' +
        '"do it", "kody, do this", "go", "yes", or otherwise confirms ' +
        "execution after a plan was discussed. " +
        "DO NOT narrate this call without making it — if you tell the " +
        'user "I posted @kody run" you MUST have actually called this ' +
        "tool in the same turn. Use `notes` to pass the plan inline.",
      inputSchema: z.object({
        issueNumber: ISSUE_NUMBER_SCHEMA,
        capability: CAPABILITY_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ issueNumber, capability, notes }) =>
        dispatchOnIssue(ctx, issueNumber, capability ?? "classify", notes),
    }),
  };
}
