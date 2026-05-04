/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Kody-pipeline dispatch tools for the kody-direct chat agent.
 *
 * Each tool posts a `@kody <executable>` comment on an existing pull
 * request. The Kody engine picks up the comment and runs the matching
 * executable — same path the user would take by typing the comment
 * themselves. Mirrors the bug-tools / release-tools shape.
 *
 * These tools DO trigger the pipeline. They must only be called when
 * the user explicitly asks to run a kody command (e.g. "kody fix #45",
 * "have kody review this PR", "rerun fix-ci on the PR"). Each tool's
 * description repeats this gate so the model carries it through.
 *
 * Supported commands (PR-targeted, see kody2/src/executables/):
 *   fix         — apply fixes; bare = use PR review body
 *   fix-ci      — fix failing CI on the PR
 *   review      — code review
 *   resolve     — resolve merge conflicts
 *   revert      — revert the PR's merge commit
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { Octokit } from '@octokit/rest'
import { logger } from '@dashboard/lib/logger'
import {
  invalidateIssueCache,
  invalidatePRCache,
} from '@dashboard/lib/github-client'

interface Ctx {
  octokit: Octokit
  owner: string
  repo: string
}

type KodyPrCommand = 'fix' | 'fix-ci' | 'review' | 'resolve' | 'revert'

interface DispatchResult {
  number: number
  url: string
  command: string
  triggered: boolean
  note: string
}

interface DispatchError {
  error: string
}

async function dispatchOnPr(
  ctx: Ctx,
  prNumber: number,
  command: KodyPrCommand,
  notes: string | undefined,
): Promise<DispatchResult | DispatchError> {
  const { octokit, owner, repo } = ctx
  const commentBody = notes?.trim()
    ? `@kody ${command}\n\n${notes.trim()}`
    : `@kody ${command}`

  try {
    const existing = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: prNumber,
    })
    if (!existing.data.pull_request) {
      return {
        error:
          `Refusing to dispatch: #${prNumber} is an issue, not a pull request. ` +
          `\`@kody ${command}\` is a PR-only command.`,
      }
    }

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    })

    // PR list cache + the per-issue comments cache (PRs share the issues
    // comments cache key). Without this, the dashboard can sit on a stale
    // view until TTL expires.
    invalidatePRCache()
    invalidateIssueCache(prNumber)

    logger.info(
      { owner, repo, number: prNumber, command },
      'kody-dispatch: posted trigger comment',
    )

    return {
      number: prNumber,
      url: existing.data.html_url,
      command: `@kody ${command}`,
      triggered: true,
      note: `Posted \`@kody ${command}\` on PR #${prNumber}. Engine should pick it up shortly.`,
    }
  } catch (err) {
    logger.warn(
      { err, owner, repo, number: prNumber, command },
      'kody-dispatch failed',
    )
    return {
      error: err instanceof Error ? err.message : `Failed to dispatch @kody ${command}`,
    }
  }
}

const PR_NUMBER_SCHEMA = z
  .number()
  .int()
  .positive()
  .describe('The pull request number to dispatch on.')

const NOTES_SCHEMA = z
  .string()
  .max(8_000)
  .optional()
  .describe(
    'Optional extra context appended below the `@kody` line in the same ' +
      'comment (e.g. specific feedback, focus areas, hints). Plain markdown.',
  )

export function createKodyTools(ctx: Ctx) {
  const { owner, repo } = ctx

  return {
    kody_fix_pr: tool({
      description:
        `Post \`@kody fix\` as a comment on a PR in ${owner}/${repo} to ask Kody ` +
        'to apply fixes (uses the PR review body when no extra notes are given). ' +
        'DOES auto-trigger the Kody pipeline. Only call when the user explicitly ' +
        'asks ("kody, fix this PR", "have kody fix #45", "tell kody to apply the ' +
        'review feedback"). If intent is ambiguous, confirm with the user before ' +
        'calling.',
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) => dispatchOnPr(ctx, prNumber, 'fix', notes),
    }),

    kody_fix_ci_pr: tool({
      description:
        `Post \`@kody fix-ci\` on a PR in ${owner}/${repo} to ask Kody to fix ` +
        'failing CI on that PR. DOES auto-trigger the Kody pipeline. Only call ' +
        'when the user explicitly asks ("kody, fix the CI on this PR", "rerun ' +
        'fix-ci on #45"). If intent is ambiguous, confirm before calling.',
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, 'fix-ci', notes),
    }),

    kody_review_pr: tool({
      description:
        `Post \`@kody review\` on a PR in ${owner}/${repo} to ask Kody to run a ` +
        'code review. DOES auto-trigger the Kody pipeline (the engine writes its ' +
        'review to the PR). Only call when the user explicitly asks ("kody, ' +
        'review this PR", "have kody look at #45"). If the user only wants YOUR ' +
        'opinion in chat, do NOT call this — read the PR with github_get_pull_request ' +
        'and answer in chat instead.',
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, 'review', notes),
    }),

    kody_resolve_pr: tool({
      description:
        `Post \`@kody resolve\` on a PR in ${owner}/${repo} to ask Kody to resolve ` +
        'merge conflicts on that PR. DOES auto-trigger the Kody pipeline. Only ' +
        'call when the user explicitly asks ("kody, resolve conflicts on #45", ' +
        '"have kody fix the merge conflicts"). Note: this is "resolve merge ' +
        'conflicts", NOT "close the issue" — for closing an issue use ' +
        'github_close_issue instead.',
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, 'resolve', notes),
    }),

    kody_revert_pr: tool({
      description:
        `Post \`@kody revert\` on a PR in ${owner}/${repo} to ask Kody to revert ` +
        'the PR\'s merge. DESTRUCTIVE — DOES auto-trigger the Kody pipeline and ' +
        'rewrites history on a follow-up branch. Only call when the user ' +
        'explicitly and unambiguously asks ("kody, revert PR #45", "undo that ' +
        'merge"). When in doubt, confirm with the user before calling.',
      inputSchema: z.object({
        prNumber: PR_NUMBER_SCHEMA,
        notes: NOTES_SCHEMA,
      }),
      execute: ({ prNumber, notes }) =>
        dispatchOnPr(ctx, prNumber, 'revert', notes),
    }),
  }
}
