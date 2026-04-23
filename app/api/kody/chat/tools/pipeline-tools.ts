/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Kody pipeline data tools for the kody-direct chat agent.
 *
 * Wraps github-client helpers (which read from module-level GitHub
 * context). The route MUST call setGitHubContext before invoking
 * streamText so these tools see the user's repo + token.
 */
import { tool } from 'ai'
import { z } from 'zod'
import {
  findBranchByIssueNumber,
  findStatusOnBranch,
  fetchWorkflowRuns,
  fetchOpenPRs,
} from '@dashboard/lib/github-client'
import { logger } from '@dashboard/lib/logger'

interface Ctx {
  owner: string
  repo: string
}

export function createPipelineTools(ctx: Ctx) {
  const { owner, repo } = ctx

  return {
    kody_get_pipeline_status: tool({
      description:
        `Read the Kody pipeline status (current stage, started/ended timestamps per ` +
        `stage, overall state) for a task in ${owner}/${repo} by issue number. ` +
        'Returns null if no pipeline run has touched this issue yet.',
      inputSchema: z.object({
        issueNumber: z
          .number()
          .int()
          .positive()
          .describe('The GitHub issue number the pipeline was launched for'),
      }),
      execute: async ({ issueNumber }) => {
        try {
          const branch = await findBranchByIssueNumber(issueNumber)
          if (!branch) return { issueNumber, status: null, branch: null }
          const status = await findStatusOnBranch(branch, issueNumber)
          return { issueNumber, branch, status }
        } catch (err) {
          logger.warn({ err, issueNumber }, 'kody_get_pipeline_status failed')
          return { error: err instanceof Error ? err.message : 'Failed to read pipeline status' }
        }
      },
    }),

    kody_list_workflow_runs: tool({
      description:
        `List recent GitHub Actions workflow runs in ${owner}/${repo}. Use to ` +
        'answer "what just ran" / "did CI pass" questions.',
      inputSchema: z.object({
        perPage: z.number().int().min(1).max(50).optional().default(15),
      }),
      execute: async ({ perPage }) => {
        try {
          const runs = await fetchWorkflowRuns({ perPage })
          return {
            count: runs.length,
            runs: runs.map((r) => ({
              id: r.id,
              displayTitle: r.display_title ?? null,
              status: r.status,
              conclusion: r.conclusion,
              headBranch: r.head_branch ?? null,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
              url: r.html_url,
            })),
          }
        } catch (err) {
          logger.warn({ err, owner, repo }, 'kody_list_workflow_runs failed')
          return { error: err instanceof Error ? err.message : 'Failed to list workflow runs' }
        }
      },
    }),

    kody_list_open_prs: tool({
      description:
        `List open pull requests in ${owner}/${repo} (the dashboard's "in review" lane).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const prs = await fetchOpenPRs()
          return {
            count: prs.length,
            prs: prs.map((pr) => ({
              number: pr.number,
              title: pr.title,
              state: pr.state,
              head: pr.head.ref,
              labels: pr.labels ?? [],
              ciStatus: pr.ciStatus ?? null,
              mergeable: pr.mergeable ?? null,
              url: pr.html_url,
            })),
          }
        } catch (err) {
          logger.warn({ err, owner, repo }, 'kody_list_open_prs failed')
          return { error: err instanceof Error ? err.message : 'Failed to list open PRs' }
        }
      },
    }),
  }
}
