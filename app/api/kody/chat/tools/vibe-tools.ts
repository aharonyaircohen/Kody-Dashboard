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
import { SWITCH_AGENT_DIRECTIVE } from '@dashboard/lib/chat-ui-actions'

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

/**
 * Engine convention (see kody2/src/branch.ts `deriveBranchName`): flat
 * `<issueNumber>-<slug>` with no type prefix and no slash. The dashboard's
 * branch matcher in `app/api/kody/tasks/route.ts` recognises this shape via
 * `^(\d{3,})-` so issue↔PR linkage works even if the PR body loses its
 * `Closes #N` line. We follow the same convention so vibe branches behave
 * identically to engine-created ones.
 *
 * Earlier versions used `kody/vibe-<n>-<slug>` — that broke in repos with
 * branch-protection rules on `kody/*` (the engine-tester repo is one) and
 * also didn't match the dashboard's branch heuristic, leaving the PR
 * unlinked when the body lacked `Closes #N`.
 */
function buildBranchName(issueNumber: number, slug: string): string {
  return `${issueNumber}-${slug}`
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
        targetAgent: z
          .enum(['kody-live', 'kody-live-fly'])
          .describe(
            "Which runner to hand off to. Pick 'kody-live-fly' when the user " +
              "has a Fly token configured (see the 'Runner availability' block in " +
              "the prompt), otherwise 'kody-live'. The dashboard switches the " +
              "active agent automatically when this tool returns — you do NOT " +
              'need to also call switch_agent.',
          ),
      }),
      execute: async ({ issueNumber, slug, targetAgent }) => {
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
          const branchName = buildBranchName(issueNumber, effectiveSlug)

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
          // The dashboard's stream parser auto-flips the active agent when
          // any tool output matches the SwitchAgentDirective shape. Embedding
          // it here means the model can't skip the hand-off (it kept
          // narrating "handed off" without actually calling switch_agent).
          //
          // `autoKickoff` is the user-message the dashboard will auto-send
          // to the runner immediately after the switch. Without it the
          // runner sits idle (the agent flips, but nothing tells the
          // runner to start), and the draft PR stays empty — exactly the
          // "everything succeeds, PR has no changes" symptom. The vibe
          // primer (server-only, see src/dashboard/lib/vibe/primer.ts)
          // gets prepended to this content automatically by the
          // /interactive/append route, so the runner sees the full
          // follow-up instructions plus this explicit ship signal.
          const agentName =
            targetAgent === 'kody-live-fly' ? 'Kody Live (Fly)' : 'Kody Live'
          const autoKickoff =
            `Implement issue #${issueNumber} now. The plan was approved in the ` +
            'previous chat — do not ask for confirmation again, just read the issue ' +
            'body, make the file edits it describes, commit with a clear message, ' +
            'push to the existing vibe branch, and reply with the commit SHA.'
          const switchDirective = {
            action: SWITCH_AGENT_DIRECTIVE,
            agentId: targetAgent,
            agentName,
            reason: `Vibe execution started — handing off to ${agentName} runner.`,
            autoKickoff,
            // Gate the client-side kickoff useEffect on context matching
            // THIS issue specifically. Without this the kickoff fires
            // the moment context flips to any task scope (typically the
            // previously-viewed issue, because the tasks query hasn't
            // refetched yet), and the runner gets dispatched against
            // the wrong sessionId. Symptom: workflow_dispatch logs show
            // `vibe-<oldIssue>-...` while the PR is on the new branch.
            autoKickoffIssueNumber: issueNumber,
          }

          if (existingPrs.length > 0) {
            const pr = existingPrs[0]
            invalidateIssueCache(issueNumber)
            return {
              ...switchDirective,
              branch: branchName,
              prNumber: pr.number,
              prUrl: pr.html_url,
              reused: branchExisted,
              note:
                (branchExisted && existingPrs.length === 1
                  ? 'Existing branch + draft PR reused. '
                  : 'Existing draft PR found. ') +
                `Auto-handing off to ${agentName} — the dashboard has already flipped the active agent.`,
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
            ...switchDirective,
            branch: branchName,
            prNumber: pr.number,
            prUrl: pr.html_url,
            reused: branchExisted,
            note:
              `Draft PR opened. The dashboard auto-flipped the active agent to ${agentName} — ` +
              'you do NOT need to call switch_agent. Mention the PR URL and the ' +
              "runner you handed off to in your reply, and tell the user the switch " +
              "applies to their NEXT message.",
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
