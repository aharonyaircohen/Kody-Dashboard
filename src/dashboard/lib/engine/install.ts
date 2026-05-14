/**
 * @fileType utility
 * @domain kody
 * @pattern engine-install
 * @ai-summary One-shot engine installer for a consumer repo.
 *
 * Pulls the canonical `kody.yml` from the `@kody-ade/kody-engine` npm
 * package (via unpkg), commits it to `.github/workflows/kody.yml` in
 * the target repo, and (best-effort) registers the dashboard webhook so
 * push-based cache invalidation works from day one.
 *
 * Idempotent: re-running on a configured repo syncs the workflow to the
 * latest template and refreshes the webhook subscription.
 *
 * Does NOT set Actions secrets. Dashboard PATs usually lack
 * `repo:secrets:write`, and `KODY_TOKEN` needs a fine-grained PAT the
 * user mints by hand. Returns `nextSteps` so the caller can surface them.
 */
import type { Octokit } from '@octokit/rest'
import { logger } from '@dashboard/lib/logger'
import { ensureWebhook } from '@dashboard/lib/webhooks/register'

export const TEMPLATE_URL =
  'https://unpkg.com/@kody-ade/kody-engine@latest/templates/kody.yml'
export const WORKFLOW_PATH = '.github/workflows/kody.yml'

export interface InstallEngineInput {
  octokit: Octokit
  owner: string
  repo: string
  token: string
  hookUrl: string
  /**
   * Re-commit the template even if the workflow already matches.
   * Default false — when the file is current, no commit happens.
   */
  force?: boolean
}

export type WorkflowAction = 'created' | 'updated' | 'unchanged'

export interface InstallEngineResult {
  ok: true
  workflow: {
    action: WorkflowAction
    path: string
    htmlUrl: string | null
    commitSha: string | null
    templateSource: string
  }
  webhook: {
    ok: boolean
    created?: boolean
    hookId?: number
    error?: string
  }
  nextSteps: string[]
  summary: string
}

export interface InstallEngineFailure {
  ok: false
  error: string
}

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
    if (
      typeof err === 'object' &&
      err &&
      'status' in err &&
      (err as { status: number }).status === 404
    ) {
      return null
    }
    throw err
  }
}

export async function installEngine(
  input: InstallEngineInput,
): Promise<InstallEngineResult | InstallEngineFailure> {
  const { octokit, owner, repo, token, hookUrl, force } = input

  try {
    const template = await fetchTemplate()
    const existing = await readExisting(octokit, owner, repo)

    let workflowAction: WorkflowAction = 'unchanged'
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

    let webhook: InstallEngineResult['webhook']
    try {
      const result = await ensureWebhook({ token, owner, repo, hookUrl })
      webhook = {
        ok: result.ok,
        created: result.created,
        hookId: result.hookId,
        error: result.error,
      }
    } catch (err) {
      webhook = {
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
        webhookOk: webhook.ok,
      },
      'installEngine: installed engine workflow',
    )

    const nextSteps = [
      'Add at least one provider key as an Actions secret. The engine reads any ' +
        '`*_API_KEY` secret automatically via `toJSON(secrets)` — common picks: ' +
        '`MINIMAX_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. ' +
        `Repo settings: https://github.com/${owner}/${repo}/settings/secrets/actions/new`,
      'Recommended: also add `KODY_TOKEN` — a fine-grained PAT with `repo`, ' +
        '`read:org`, and `workflow` scopes. Without it, commits touching ' +
        '`.github/workflows/*` are rejected and PR-body updates degrade. ' +
        'Mint one at https://github.com/settings/personal-access-tokens/new',
      'Pick "Kody Live" (or "Kody Live Fly") in the chat agent dropdown to ' +
        'verify the workflow runs. First dispatch cold-starts in ~30s.',
    ]

    const summary =
      workflowAction === 'created'
        ? `Engine workflow created at ${WORKFLOW_PATH}. Webhook ${webhook.ok ? 'registered' : 'FAILED — ' + (webhook.error ?? 'unknown')}.`
        : workflowAction === 'updated'
          ? `Engine workflow updated to the latest template. Webhook ${webhook.ok ? 'refreshed' : 'FAILED — ' + (webhook.error ?? 'unknown')}.`
          : `Engine workflow already matches the latest template — no commit needed. Webhook ${webhook.ok ? 'refreshed' : 'FAILED — ' + (webhook.error ?? 'unknown')}.`

    return {
      ok: true,
      workflow: {
        action: workflowAction,
        path: WORKFLOW_PATH,
        htmlUrl: workflowHtmlUrl,
        commitSha: workflowCommitSha,
        templateSource: TEMPLATE_URL,
      },
      webhook,
      nextSteps,
      summary,
    }
  } catch (err) {
    logger.warn({ err, owner, repo }, 'installEngine failed')
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'install_engine_failed',
    }
  }
}
