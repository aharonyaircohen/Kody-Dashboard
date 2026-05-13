/**
 * @fileType tool
 * @domain vibe
 * @pattern ai-sdk-tool
 * @ai-summary Vibe-only tools for the kody-direct chat agent.
 *
 *   `vibe_start_execution` creates a draft PR + new branch from main
 *   so Vercel can start cold-building the preview in parallel with
 *   the Kody Live / Fly runner warmup. By the time the runner finishes
 *   editing, Vercel's first build is mostly done — every subsequent
 *   push is a fast delta deploy.
 *
 *   The chat agent calls this AFTER the user picks a runner and BEFORE
 *   `switch_agent`. The runner then pushes onto the branch this tool
 *   created (the follow-up vibe primer expects `taskContext.branch`).
 *
 *   Collision handling: if the slug-derived branch already exists from
 *   a prior aborted session, we reuse it instead of failing — same for
 *   an existing open draft PR on that branch. This makes the tool
 *   idempotent per (issue, slug) pair.
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { Octokit } from '@octokit/rest'
import { logger } from '@dashboard/lib/logger'
import { invalidateIssueCache } from '@dashboard/lib/github-client'

interface Ctx {
  octokit: Octokit
  owner: string
  repo: string
}

function slugifyTitle(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return cleaned || 'untitled'
}

export function createVibeTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx

  return {
    vibe_start_execution: tool({
      description:
        `VIBE-ONLY. Pre-create a draft PR + branch in ${owner}/${repo} for an ` +
        'issue so Vercel can start cold-building the preview in parallel with ' +
        'the runner warmup. Call this AFTER the user picks a runner (Kody Live ' +
        "or Kody Live (Fly)) and BEFORE `switch_agent`. Returns the branch " +
        'name and PR number. The runner you switch to will push commits onto ' +
        'this branch — do not create a new one. Idempotent: if a branch + draft ' +
        'PR already exist for this (issue, slug), they are reused.',
      inputSchema: z.object({
        issueNumber: z
          .number()
          .int()
          .positive()
          .describe('GitHub issue number this vibe session implements.'),
        slug: z
          .string()
          .max(40)
          .optional()
          .describe(
            'Short kebab-case slug, e.g. "fix-button-color". Derived from the ' +
              'issue title if omitted.',
          ),
      }),
      execute: async ({ issueNumber, slug }) => {
        try {
          // Validate the issue and pick a slug.
          const { data: issue } = await octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber,
          })
          if (issue.pull_request) {
            return {
              error:
                `#${issueNumber} is a pull request, not an issue. ` +
                'vibe_start_execution targets the issue the runner will close.',
            }
          }
          const effectiveSlug = slugifyTitle(slug ?? issue.title)
          const branchName = `kody/vibe-${issueNumber}-${effectiveSlug}`

          // Default branch (usually main).
          const { data: repoData } = await octokit.rest.repos.get({
            owner,
            repo,
          })
          const defaultBranch = repoData.default_branch

          // Try to create the branch from default. Reuse on 422 (already exists).
          let branchExisted = false
          try {
            const { data: baseRef } = await octokit.rest.git.getRef({
              owner,
              repo,
              ref: `heads/${defaultBranch}`,
            })
            const baseSha = baseRef.object.sha
            const { data: baseCommit } = await octokit.rest.git.getCommit({
              owner,
              repo,
              commit_sha: baseSha,
            })
            const { data: emptyCommit } =
              await octokit.rest.git.createCommit({
                owner,
                repo,
                message: `vibe: start session for #${issueNumber}`,
                tree: baseCommit.tree.sha,
                parents: [baseSha],
              })
            await octokit.rest.git.createRef({
              owner,
              repo,
              ref: `refs/heads/${branchName}`,
              sha: emptyCommit.sha,
            })
          } catch (err) {
            const e = err as { status?: number; message?: string }
            if (e.status === 422) {
              branchExisted = true
            } else {
              throw err
            }
          }

          // Look for an existing open PR on this branch (handles reused branch).
          const { data: existingPrs } = await octokit.rest.pulls.list({
            owner,
            repo,
            head: `${owner}:${branchName}`,
            state: 'open',
          })
          if (existingPrs.length > 0) {
            const pr = existingPrs[0]
            invalidateIssueCache(issueNumber)
            return {
              branch: branchName,
              prNumber: pr.number,
              prUrl: pr.html_url,
              reused: branchExisted,
              note:
                branchExisted && existingPrs.length === 1
                  ? 'Existing branch + draft PR reused. Runner can push to it.'
                  : 'Existing draft PR found. Runner can push to its branch.',
            }
          }

          // Open the draft PR. Closes #N makes the issue auto-close on merge.
          const { data: pr } = await octokit.rest.pulls.create({
            owner,
            repo,
            title: `Vibe: ${issue.title}`,
            head: branchName,
            base: defaultBranch,
            draft: true,
            body:
              `Vibe session for #${issueNumber}.\n\n` +
              `The runner will push commits to \`${branchName}\` as it implements ` +
              'the plan. Vercel begins cold-building this PR now so the preview ' +
              'is ready by the time the runner finishes.\n\n' +
              `Closes #${issueNumber}`,
          })
          invalidateIssueCache(issueNumber)
          return {
            branch: branchName,
            prNumber: pr.number,
            prUrl: pr.html_url,
            reused: branchExisted,
            note:
              'Draft PR opened. Mention the PR URL in your reply, then call ' +
              'switch_agent to hand off to the runner. The runner will push ' +
              `commits to ${branchName} (taskContext.branch will be set).`,
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.warn(
            { issueNumber, slug, err: message },
            'vibe_start_execution failed',
          )
          return { error: `Failed to start vibe execution: ${message}` }
        }
      },
    }),
  }
}
