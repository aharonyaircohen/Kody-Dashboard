/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary One-shot engine installer for a consumer repo.
 *
 * `setup_engine` writes the canonical `kody.yml` workflow into the
 * connected repo at `.github/workflows/kody.yml` and (best-effort)
 * registers the dashboard webhook so cache invalidation works from
 * day one. The workflow file is sourced from unpkg
 * (`@kody-ade/kody-engine`), which keeps the dashboard from carrying a
 * yaml copy and guarantees the file matches what `npx -y -p
 * @kody-ade/kody-engine@latest kody` will actually load.
 *
 * The tool deliberately does NOT set Actions secrets:
 *   - `MINIMAX_API_KEY` / `ANTHROPIC_API_KEY` etc. are user-provided;
 *     dashboard PATs typically don't carry `repo:secrets:write`.
 *   - `KODY_TOKEN` needs a fine-grained PAT the user must mint by hand.
 * The tool's return value spells out the manual follow-up steps so the
 * LLM can relay them to the user.
 */
import { tool } from 'ai'
import { z } from 'zod'
import type { Octokit } from '@octokit/rest'
import { logger } from '@dashboard/lib/logger'
import { ensureWebhook } from '@dashboard/lib/webhooks/register'

interface Ctx {
  octokit: Octokit
  owner: string
  repo: string
  token: string
  hookUrl: string
}

const TEMPLATE_URL =
  'https://unpkg.com/@kody-ade/kody-engine@latest/templates/kody.yml'
const WORKFLOW_PATH = '.github/workflows/kody.yml'

async function fetchTemplate(): Promise<string> {
  const res = await fetch(TEMPLATE_URL, {
    headers: { Accept: 'text/plain, */*' },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(
      `Failed to fetch engine template (${res.status} ${res.statusText}) from ${TEMPLATE_URL}`,
    )
  }
  const body = await res.text()
  if (!body.trim().startsWith('#') && !body.includes('name: kody')) {
    throw new Error(
      `Engine template at ${TEMPLATE_URL} did not look like kody.yml (got ${body.length} chars).`,
    )
  }
  return body
}

async function readExisting(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ sha: string; content: string } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: WORKFLOW_PATH,
    })
    if (Array.isArray(data) || !('content' in data) || !data.content) return null
    return {
      sha: data.sha,
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
    }
  } catch (err: unknown) {
    if (typeof err === 'object' && err && 'status' in err && (err as { status: number }).status === 404) {
      return null
    }
    throw err
  }
}

export function createSetupEngineTools(ctx: Ctx) {
  const { octokit, owner, repo, token, hookUrl } = ctx
  const repoRef = `${owner}/${repo}`

  return {
    setup_engine: tool({
      description:
        `Install the Kody engine into ${repoRef} so the engine-backed agents ` +
        '(Kody Live, Kody Live Fly, task execution, scheduled jobs) can run. ' +
        'Does three things: (1) downloads the canonical `kody.yml` from the ' +
        '`@kody-ade/kody-engine` npm package via unpkg, (2) commits it to ' +
        '`.github/workflows/kody.yml` (creates or updates if drifted), ' +
        '(3) registers the dashboard webhook on the repo so push-based cache ' +
        'invalidation works. Does NOT set Actions secrets — returns the manual ' +
        'next steps the user must do (mint KODY_TOKEN, add a provider API key). ' +
        'Idempotent: re-running on an already-set-up repo updates the workflow ' +
        'if it has drifted and refreshes the webhook subscription.',
      inputSchema: z.object({
        force: z
          .boolean()
          .optional()
          .describe(
            'Overwrite an existing kody.yml even if it already matches the latest template. ' +
              'Default false — when false and the workflow is already current, the tool reports ' +
              '`already_installed` without making a commit.',
          ),
      }),
      execute: async ({ force }) => {
        try {
          // 1. Pull the canonical template (single source of truth = npm).
          const template = await fetchTemplate()

          // 2. Compare with whatever (if anything) lives in the repo today.
          const existing = await readExisting(octokit, owner, repo)
          let workflowAction: 'created' | 'updated' | 'unchanged' = 'unchanged'
          let workflowCommitSha: string | null = null
          let workflowHtmlUrl: string | null = null

          if (!existing) {
            const { data } = await octokit.rest.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: WORKFLOW_PATH,
              message: 'chore(kody): install engine workflow',
              content: Buffer.from(template, 'utf-8').toString('base64'),
            })
            workflowAction = 'created'
            workflowCommitSha = data.commit.sha ?? null
            workflowHtmlUrl = data.content?.html_url ?? null
          } else if (existing.content === template && !force) {
            workflowAction = 'unchanged'
            workflowHtmlUrl = `https://github.com/${owner}/${repo}/blob/HEAD/${WORKFLOW_PATH}`
          } else {
            const { data } = await octokit.rest.repos.createOrUpdateFileContents({
              owner,
              repo,
              path: WORKFLOW_PATH,
              message: 'chore(kody): sync engine workflow to latest template',
              content: Buffer.from(template, 'utf-8').toString('base64'),
              sha: existing.sha,
            })
            workflowAction = 'updated'
            workflowCommitSha = data.commit.sha ?? null
            workflowHtmlUrl = data.content?.html_url ?? null
          }

          // 3. Register the dashboard webhook (best-effort; not fatal).
          let webhookStatus: {
            ok: boolean
            created?: boolean
            hookId?: number
            error?: string
          }
          try {
            const result = await ensureWebhook({
              token,
              owner,
              repo,
              hookUrl,
            })
            webhookStatus = {
              ok: result.ok,
              created: result.created,
              hookId: result.hookId,
              error: result.error,
            }
          } catch (err) {
            webhookStatus = {
              ok: false,
              error: err instanceof Error ? err.message : 'webhook_register_failed',
            }
          }

          logger.info(
            {
              owner,
              repo,
              workflowAction,
              workflowCommitSha,
              webhookOk: webhookStatus.ok,
            },
            'setup_engine: installed engine workflow',
          )

          const nextSteps = [
            'Add at least one provider key as an Actions secret. The engine reads ' +
              'any `*_API_KEY` secret automatically via `toJSON(secrets)` — common picks: ' +
              '`MINIMAX_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. ' +
              `Repo settings: https://github.com/${owner}/${repo}/settings/secrets/actions/new`,
            'Recommended: also add `KODY_TOKEN` — a fine-grained PAT with `repo`, ' +
              '`read:org`, and `workflow` scopes. Without it, commits that touch ' +
              '`.github/workflows/*` will be rejected and PR-body updates degrade. ' +
              'Mint one at https://github.com/settings/personal-access-tokens/new',
            'Pick "Kody Live" (or "Kody Live Fly") in the chat agent dropdown to ' +
              'verify the workflow runs. First dispatch cold-starts in ~30s.',
          ]

          return {
            ok: true,
            workflow: {
              action: workflowAction,
              path: WORKFLOW_PATH,
              htmlUrl: workflowHtmlUrl,
              commitSha: workflowCommitSha,
              templateSource: TEMPLATE_URL,
            },
            webhook: webhookStatus,
            nextSteps,
            summary:
              workflowAction === 'created'
                ? `Engine workflow created at ${WORKFLOW_PATH}. Webhook ${webhookStatus.ok ? 'registered' : 'FAILED — ' + (webhookStatus.error ?? 'unknown')}. Two manual steps remain before the engine can run — see nextSteps.`
                : workflowAction === 'updated'
                  ? `Engine workflow updated to the latest template. Webhook ${webhookStatus.ok ? 'refreshed' : 'FAILED — ' + (webhookStatus.error ?? 'unknown')}.`
                  : `Engine workflow already matches the latest template — no commit needed. Webhook ${webhookStatus.ok ? 'refreshed' : 'FAILED — ' + (webhookStatus.error ?? 'unknown')}.`,
          }
        } catch (err) {
          logger.warn(
            { err, owner, repo },
            'setup_engine failed',
          )
          return {
            ok: false,
            error: err instanceof Error ? err.message : 'setup_engine_failed',
          }
        }
      },
    }),
  }
}
