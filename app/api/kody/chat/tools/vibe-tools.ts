/**
 * @fileType tool
 * @domain vibe
 * @pattern ai-sdk-tool
 * @ai-summary Vibe-only tools for the kody-direct chat agent.
 *
 *   `vibe_start_execution` creates a draft PR + new branch from the repo's
 *   default branch so Vercel can start cold-building the preview in
 *   parallel with the Kody Live / Fly runner warmup. By the time the
 *   runner finishes editing, Vercel's first build is mostly done — every
 *   subsequent push is a fast delta deploy.
 *
 *   The chat agent calls this AFTER the user picks a runner and BEFORE
 *   `switch_agent`. The runner then pushes onto the branch this tool
 *   created (the follow-up vibe primer expects `taskContext.branch`).
 *
 *   Branch logic itself lives in `@dashboard/lib/branches` (BranchService
 *   + GitHubBranchRepo). This file is pure orchestration: validate input,
 *   delegate to the service, return the chat-agent payload.
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { Octokit } from '@octokit/rest'
import { logger } from '@dashboard/lib/logger'
import { invalidateIssueCache } from '@dashboard/lib/github-client'
import { SWITCH_AGENT_DIRECTIVE } from '@dashboard/lib/chat-ui-actions'
import {
  BranchService,
  GitHubBranchRepo,
  GitHubFileLock,
  ForeignBranchError,
  LockTakenError,
} from '@dashboard/lib/branches'

interface Ctx {
  octokit: Octokit
  owner: string
  repo: string
}

export function createVibeTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx
  const branches = new BranchService(
    new GitHubBranchRepo({ octokit, owner, repo }),
    new GitHubFileLock({ octokit, owner, repo }),
  )

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
          // 1. Get-or-create the branch.
          let created
          try {
            created = await branches.getOrCreate({ issueNumber, slug })
          } catch (err) {
            if (err instanceof ForeignBranchError) {
              return {
                error: err.message,
                code: 'foreign_branch',
                branch: err.branchName,
              }
            }
            if (err instanceof LockTakenError) {
              return {
                error: err.message,
                code: 'session_in_progress',
                key: err.key,
              }
            }
            const message = err instanceof Error ? err.message : String(err)
            return { error: message }
          }

          // 2. If the branch was reused, bring it back in sync with the
          //    default branch before opening a PR on it. Without this, a
          //    branch left over from a prior aborted session (often cut
          //    from main when main was still the default) ends up hundreds
          //    of commits behind dev — the resulting PR shows every drift
          //    commit as a "change" and conflicts with everything.
          if (created.existed) {
            const sync = await branches.syncWithBase(
              created.branchName,
              created.baseRef,
            )
            if (sync.status === 'conflict') {
              return {
                error:
                  `Reused branch '${created.branchName}' has merge conflicts with ` +
                  `'${created.baseRef}': ${sync.message}. Resolve manually or ` +
                  'delete the branch to start fresh.',
              }
            }
            logger.info(
              {
                branchName: created.branchName,
                defaultBranch: created.baseRef,
                syncStatus: sync.status,
              },
              'vibe_start_execution synced reused branch with default',
            )
          }

          // 3. Find-or-create the draft PR.
          const pr = await branches.findOrCreateDraftPR({
            branchName: created.branchName,
            baseRef: created.baseRef,
            title: `Vibe: ${created.issueTitle}`,
            body:
              `Vibe session for #${issueNumber}.\n\n` +
              `The runner will push commits to \`${created.branchName}\` as it ` +
              'implements the plan. Vercel begins cold-building this PR now so ' +
              'the preview is ready by the time the runner finishes.\n\n' +
              `Closes #${issueNumber}`,
          })

          invalidateIssueCache(issueNumber)

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

          const noteSuffix =
            `Auto-handing off to ${agentName} — the dashboard has already flipped the active agent.`
          const note = pr.created
            ? `Draft PR opened. ${noteSuffix} You do NOT need to call switch_agent. ` +
              "Mention the PR URL and the runner you handed off to in your reply, " +
              "and tell the user the switch applies to their NEXT message."
            : (created.existed
                ? 'Existing branch + draft PR reused. '
                : 'Existing draft PR found. ') + noteSuffix

          return {
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
            branch: created.branchName,
            prNumber: pr.number,
            prUrl: pr.url,
            reused: created.existed,
            note,
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
