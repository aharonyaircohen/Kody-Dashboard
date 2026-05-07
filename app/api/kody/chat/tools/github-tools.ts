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
import { invalidateIssueCache } from '@dashboard/lib/github-client'

interface Ctx {
  octokit: Octokit
  owner: string
  repo: string
}

const MAX_BODY_CHARS = 8_000
const MAX_FILE_CHARS = 30_000
const MAX_COMMENTS = 20
// Per-file and total diff caps for github_get_pull_request — diffs are
// the most useful signal for diagnosing what a previous Kody run shipped,
// but full multi-file patches blow up context fast. Clip aggressively.
const MAX_PATCH_CHARS_PER_FILE = 4_000
const MAX_PATCH_CHARS_TOTAL = 30_000

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
        'mergeable status, and the list of changed files (paths + additions/deletions). ' +
        'Set includeDiff=true to also return each file\'s patch (clipped per-file and ' +
        'in total). Use the diff to audit what a previous Kody run actually shipped — ' +
        'compare it against the issue\'s claims to find gaps.',
      inputSchema: z.object({
        number: z.number().int().positive().describe('The PR number'),
        includeDiff: z
          .boolean()
          .optional()
          .describe(
            'When true, attach `patch` (the unified-diff text) to each changed file. ' +
              'Default false to keep responses small.',
          ),
      }),
      execute: async ({ number, includeDiff }) => {
        try {
          const [pr, files] = await Promise.all([
            octokit.rest.pulls.get({ owner, repo, pull_number: number }),
            octokit.rest.pulls
              .listFiles({ owner, repo, pull_number: number, per_page: 50 })
              .catch(
                () =>
                  ({
                    data: [] as Array<{
                      filename: string
                      additions: number
                      deletions: number
                      status: string
                      patch?: string
                    }>,
                  }) as { data: Array<{ filename: string; additions: number; deletions: number; status: string; patch?: string }> },
              ),
          ])
          let patchBudget = MAX_PATCH_CHARS_TOTAL
          let patchTruncated = false
          const changedFiles = files.data.map((f) => {
            const base = {
              path: f.filename,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
            }
            if (!includeDiff) return base
            const raw = f.patch ?? ''
            if (!raw) return { ...base, patch: '' }
            const clippedPerFile =
              raw.length > MAX_PATCH_CHARS_PER_FILE
                ? `${raw.slice(0, MAX_PATCH_CHARS_PER_FILE)}\n[... per-file truncated ${raw.length - MAX_PATCH_CHARS_PER_FILE} chars ...]`
                : raw
            if (patchBudget <= 0) {
              patchTruncated = true
              return { ...base, patch: '[... omitted: total diff budget exhausted ...]' }
            }
            const taken =
              clippedPerFile.length > patchBudget
                ? `${clippedPerFile.slice(0, patchBudget)}\n[... total diff budget exhausted ...]`
                : clippedPerFile
            patchBudget -= taken.length
            if (taken.length < clippedPerFile.length) patchTruncated = true
            return { ...base, patch: taken }
          })
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
            changedFiles,
            ...(includeDiff ? { diffTruncated: patchTruncated } : {}),
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
        'Returns up to 20 matches with file path, snippet fragments, and the ' +
        'line numbers where each match starts. Prefer this over reading whole ' +
        'files when looking for symbol definitions or usage sites.',
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
          // text-match preview gives us `text_matches[]` with `fragment` (the
          // snippet) and `matches[].indices` (offsets within fragment). We
          // convert offsets to a 1-based line number relative to the fragment
          // so the model can cite locations without re-reading the file.
          const res = await octokit.rest.search.code({
            q: scopedQuery,
            per_page: 20,
            mediaType: { format: 'text-match' },
          })
          type TextMatch = {
            fragment?: string
            matches?: Array<{ indices?: [number, number] }>
          }
          type Hit = {
            path: string
            url: string
            snippet: string
            lineInFragment: number | null
          }
          const matches: Hit[] = res.data.items.flatMap<Hit>((it) => {
            const item = it as typeof it & { text_matches?: TextMatch[] }
            const tms = item.text_matches ?? []
            if (tms.length === 0) {
              const empty: Hit = {
                path: it.path,
                url: it.html_url,
                snippet: '',
                lineInFragment: null,
              }
              return [empty]
            }
            return tms.map<Hit>((tm) => {
              const fragment = tm.fragment ?? ''
              const firstIdx = tm.matches?.[0]?.indices?.[0] ?? 0
              const lineInFragment = (fragment.slice(0, firstIdx).match(/\n/g)?.length ?? 0) + 1
              return {
                path: it.path,
                url: it.html_url,
                snippet: clip(fragment, 600),
                lineInFragment,
              }
            })
          })
          return {
            total: res.data.total_count,
            matches,
          }
        } catch (err) {
          logger.warn({ err, owner, repo, query }, 'github_search_code failed')
          return { error: err instanceof Error ? err.message : 'Failed to search code' }
        }
      },
    }),

    github_blame: tool({
      description:
        `Show the last commit that modified each line of a file in ${owner}/${repo}. ` +
        'Use this to answer "why was this written / when did this change / who owns this" ' +
        'without reading 20 commits. Returns ranges of contiguous lines that share the ' +
        'same authoring commit, each with sha, author, date, and message summary. ' +
        'Optionally restrict to a line range to keep responses small.',
      inputSchema: z.object({
        path: z.string().min(1).describe('Path to the file in the repo'),
        ref: z
          .string()
          .optional()
          .describe('Branch / tag / commit SHA. Defaults to the repo default branch.'),
        startLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('First line to include (1-based). When set, only ranges overlapping [startLine, endLine] are returned.'),
        endLine: z.number().int().positive().optional().describe('Last line to include (1-based, inclusive).'),
      }),
      execute: async ({ path, ref, startLine, endLine }) => {
        try {
          // GraphQL blame: ref → target → blame(path) → ranges[].commit.
          // One round-trip, returns one entry per contiguous run of lines
          // sharing the same commit, which is exactly what the model wants.
          const query = `
            query Blame($owner: String!, $repo: String!, $ref: String!, $path: String!) {
              repository(owner: $owner, name: $repo) {
                ref: object(expression: $ref) {
                  ... on Commit {
                    blame(path: $path) {
                      ranges {
                        startingLine
                        endingLine
                        commit {
                          oid
                          messageHeadline
                          committedDate
                          author { name email user { login } }
                        }
                      }
                    }
                  }
                }
              }
            }
          `
          type BlameRange = {
            startingLine: number
            endingLine: number
            commit: {
              oid: string
              messageHeadline: string
              committedDate: string
              author: { name: string | null; email: string | null; user: { login: string } | null } | null
            }
          }
          const result = (await octokit.graphql(query, {
            owner,
            repo,
            ref: ref ?? 'HEAD',
            path,
          })) as {
            repository: {
              ref: { blame: { ranges: BlameRange[] } } | null
            }
          }
          const ranges = result.repository.ref?.blame.ranges ?? []
          const filtered =
            startLine != null || endLine != null
              ? ranges.filter((r) => {
                  const s = startLine ?? 1
                  const e = endLine ?? Number.MAX_SAFE_INTEGER
                  return r.endingLine >= s && r.startingLine <= e
                })
              : ranges
          return {
            path,
            ref: ref ?? 'default',
            ranges: filtered.map((r) => ({
              startLine: r.startingLine,
              endLine: r.endingLine,
              sha: r.commit.oid.slice(0, 8),
              date: r.commit.committedDate,
              author: r.commit.author?.user?.login ?? r.commit.author?.name ?? null,
              message: r.commit.messageHeadline,
            })),
          }
        } catch (err) {
          logger.warn({ err, owner, repo, path, ref }, 'github_blame failed')
          return { error: err instanceof Error ? err.message : 'Failed to blame file' }
        }
      },
    }),

    github_commits_for_path: tool({
      description:
        `List recent commits in ${owner}/${repo} that touched a given path. ` +
        'Cheaper than blame when the user just wants "what changed in this file lately" — ' +
        'returns up to 20 commits with sha, author, date, and message.',
      inputSchema: z.object({
        path: z.string().min(1).describe('File or directory path in the repo'),
        ref: z
          .string()
          .optional()
          .describe('Branch / tag / SHA to start from. Defaults to default branch.'),
        perPage: z.number().int().min(1).max(50).optional().default(20),
      }),
      execute: async ({ path, ref, perPage }) => {
        try {
          const res = await octokit.rest.repos.listCommits({
            owner,
            repo,
            path,
            sha: ref,
            per_page: perPage,
          })
          return {
            count: res.data.length,
            commits: res.data.map((c) => ({
              sha: c.sha.slice(0, 8),
              date: c.commit.author?.date ?? c.commit.committer?.date ?? null,
              author: c.author?.login ?? c.commit.author?.name ?? null,
              message: c.commit.message.split('\n')[0] ?? '',
              url: c.html_url,
            })),
          }
        } catch (err) {
          logger.warn({ err, owner, repo, path }, 'github_commits_for_path failed')
          return { error: err instanceof Error ? err.message : 'Failed to list commits' }
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

    github_close_issue: tool({
      description:
        `Close an issue in ${owner}/${repo}. Use only when the user explicitly asks ` +
        'to close/resolve an issue, or after they confirm a fix is verified. ' +
        'Optionally post a closing comment and set the close reason ' +
        '("completed" for fixed/done, "not_planned" for wont-fix/duplicate). ' +
        'Do NOT call this on pull requests — use the GitHub UI for PRs.',
      inputSchema: z.object({
        number: z.number().int().positive().describe('The issue number to close'),
        comment: z
          .string()
          .max(8_000)
          .optional()
          .describe('Optional closing comment posted before the state change.'),
        reason: z
          .enum(['completed', 'not_planned'])
          .optional()
          .default('completed')
          .describe('GitHub close reason. "completed" = done/fixed, "not_planned" = wont-fix.'),
      }),
      execute: async ({ number, comment, reason }) => {
        try {
          const existing = await octokit.rest.issues.get({
            owner,
            repo,
            issue_number: number,
          })
          if (existing.data.pull_request) {
            return {
              error:
                'Refusing to close: #' +
                number +
                ' is a pull request, not an issue. Close PRs via the GitHub UI.',
            }
          }
          if (existing.data.state === 'closed') {
            return {
              ok: true,
              alreadyClosed: true,
              number,
              url: existing.data.html_url,
            }
          }

          if (comment && comment.trim().length > 0) {
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: number,
              body: comment,
            })
          }

          const res = await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: number,
            state: 'closed',
            state_reason: reason,
          })

          invalidateIssueCache(number)

          return {
            ok: true,
            number: res.data.number,
            state: res.data.state,
            stateReason: res.data.state_reason ?? reason,
            url: res.data.html_url,
            commented: !!(comment && comment.trim().length > 0),
          }
        } catch (err) {
          logger.warn({ err, owner, repo, number }, 'github_close_issue failed')
          return {
            error: err instanceof Error ? err.message : 'Failed to close issue',
          }
        }
      },
    }),
  }
}
