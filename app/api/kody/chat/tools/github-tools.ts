/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary GitHub data tools for the kody-direct chat agent.
 *
 * The factory takes the connected repo (owner/name) and an Octokit
 * already authenticated with the user's token, so every tool call is
 * scoped to the repo the user is logged into and uses their token's
 * permissions. No module-level state.
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { Octokit } from '@octokit/rest'
import { logger } from '@dashboard/lib/logger'

interface Ctx {
  octokit: Octokit
  owner: string
  repo: string
}

const MAX_BODY_CHARS = 8_000
const MAX_FILE_CHARS = 30_000
const MAX_COMMENTS = 20

function clip(s: string | null | undefined, n: number): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}\n\n[... truncated ${s.length - n} chars ...]` : s
}

export function createGitHubTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx

  return {
    github_get_issue: tool({
      description:
        `Fetch a GitHub issue (or PR — they share numbers) from ${owner}/${repo}, ` +
        'including title, body, labels, state, and the most recent comments. Use this ' +
        'when the user references an issue/PR by number.',
      inputSchema: z.object({
        number: z.number().int().positive().describe('The issue or PR number'),
      }),
      execute: async ({ number }) => {
        try {
          const [issue, comments] = await Promise.all([
            octokit.rest.issues.get({ owner, repo, issue_number: number }),
            octokit.rest.issues
              .listComments({ owner, repo, issue_number: number, per_page: MAX_COMMENTS })
              .catch(() => ({ data: [] as Array<{ user: { login: string } | null; body: string | null; created_at: string }> })),
          ])
          return {
            number: issue.data.number,
            title: issue.data.title,
            state: issue.data.state,
            isPullRequest: !!issue.data.pull_request,
            author: issue.data.user?.login ?? null,
            labels: issue.data.labels.map((l) =>
              typeof l === 'string' ? l : l.name ?? '',
            ),
            body: clip(issue.data.body, MAX_BODY_CHARS),
            commentCount: issue.data.comments,
            comments: comments.data.map((c) => ({
              author: c.user?.login ?? null,
              createdAt: c.created_at,
              body: clip(c.body, 2_000),
            })),
            url: issue.data.html_url,
          }
        } catch (err) {
          logger.warn({ err, owner, repo, number }, 'github_get_issue failed')
          return { error: err instanceof Error ? err.message : 'Failed to fetch issue' }
        }
      },
    }),

    github_get_pull_request: tool({
      description:
        `Fetch a pull request from ${owner}/${repo} with metadata, head/base, ` +
        'mergeable status, and the list of changed files (paths + additions/deletions, no diff body).',
      inputSchema: z.object({
        number: z.number().int().positive().describe('The PR number'),
      }),
      execute: async ({ number }) => {
        try {
          const [pr, files] = await Promise.all([
            octokit.rest.pulls.get({ owner, repo, pull_number: number }),
            octokit.rest.pulls
              .listFiles({ owner, repo, pull_number: number, per_page: 50 })
              .catch(() => ({ data: [] as Array<{ filename: string; additions: number; deletions: number; status: string }> })),
          ])
          return {
            number: pr.data.number,
            title: pr.data.title,
            state: pr.data.state,
            draft: pr.data.draft ?? false,
            merged: pr.data.merged,
            mergeable: pr.data.mergeable,
            author: pr.data.user?.login ?? null,
            head: { ref: pr.data.head.ref, sha: pr.data.head.sha },
            base: { ref: pr.data.base.ref },
            body: clip(pr.data.body, MAX_BODY_CHARS),
            changedFiles: files.data.map((f) => ({
              path: f.filename,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
            })),
            url: pr.data.html_url,
          }
        } catch (err) {
          logger.warn({ err, owner, repo, number }, 'github_get_pull_request failed')
          return { error: err instanceof Error ? err.message : 'Failed to fetch PR' }
        }
      },
    }),

    github_get_file: tool({
      description:
        `Read a file from ${owner}/${repo} at a given path and ref (branch, tag, ` +
        'or SHA — defaults to the default branch). Returns decoded text up to 30 KB.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Path to the file in the repo'),
        ref: z
          .string()
          .optional()
          .describe('Branch / tag / commit SHA. Defaults to the repo default branch.'),
      }),
      execute: async ({ path, ref }) => {
        try {
          const res = await octokit.rest.repos.getContent({ owner, repo, path, ref })
          if (Array.isArray(res.data)) {
            return {
              kind: 'directory' as const,
              path,
              entries: res.data.map((e) => ({ name: e.name, type: e.type, size: e.size })),
            }
          }
          if (res.data.type !== 'file') {
            return { error: `Path is a ${res.data.type}, not a file` }
          }
          const content =
            res.data.encoding === 'base64'
              ? Buffer.from(res.data.content, 'base64').toString('utf8')
              : res.data.content
          return {
            kind: 'file' as const,
            path: res.data.path,
            sha: res.data.sha,
            size: res.data.size,
            ref: ref ?? 'default',
            content: clip(content, MAX_FILE_CHARS),
          }
        } catch (err) {
          logger.warn({ err, owner, repo, path, ref }, 'github_get_file failed')
          return { error: err instanceof Error ? err.message : 'Failed to fetch file' }
        }
      },
    }),

    github_search_code: tool({
      description:
        `Search for code in ${owner}/${repo} using GitHub code search. ` +
        'Returns up to 20 matches with file paths and line snippets.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'GitHub code-search query, e.g. "createGitHubTools" or "useCallback path:src/dashboard"',
          ),
      }),
      execute: async ({ query }) => {
        try {
          const scopedQuery = `${query} repo:${owner}/${repo}`
          const res = await octokit.rest.search.code({ q: scopedQuery, per_page: 20 })
          return {
            total: res.data.total_count,
            matches: res.data.items.map((it) => ({
              path: it.path,
              url: it.html_url,
              repository: it.repository.full_name,
            })),
          }
        } catch (err) {
          logger.warn({ err, owner, repo, query }, 'github_search_code failed')
          return { error: err instanceof Error ? err.message : 'Failed to search code' }
        }
      },
    }),

    github_list_issues: tool({
      description:
        `List recent issues in ${owner}/${repo}. Filter by state and labels. ` +
        'Useful for "what bugs are open" / "what tasks are in review".',
      inputSchema: z.object({
        state: z.enum(['open', 'closed', 'all']).optional().default('open'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Comma-separated labels to filter by, e.g. ["bug","kody:done"]'),
        perPage: z.number().int().min(1).max(50).optional().default(20),
      }),
      execute: async ({ state, labels, perPage }) => {
        try {
          const res = await octokit.rest.issues.listForRepo({
            owner,
            repo,
            state,
            labels: labels?.join(','),
            per_page: perPage,
          })
          // listForRepo returns PRs too — leave a flag so the model can filter.
          return {
            count: res.data.length,
            issues: res.data.map((i) => ({
              number: i.number,
              title: i.title,
              state: i.state,
              isPullRequest: !!i.pull_request,
              author: i.user?.login ?? null,
              labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')),
              updatedAt: i.updated_at,
              url: i.html_url,
            })),
          }
        } catch (err) {
          logger.warn({ err, owner, repo }, 'github_list_issues failed')
          return { error: err instanceof Error ? err.message : 'Failed to list issues' }
        }
      },
    }),
  }
}
