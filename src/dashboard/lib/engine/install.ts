/**
 * @fileType utility
 * @domain kody
 * @pattern engine-install
 * @ai-summary One-shot engine installer for a consumer repo.
 *
 * Pulls the canonical `kody.yml` from the `@kody-ade/kody-engine` npm
 * package (via unpkg), commits it to `.github/workflows/kody.yml` in
 * the target repo, (best-effort) writes the user's PAT as the
 * `KODY_TOKEN` Actions secret so the engine has GitHub auth at runtime,
 * and (best-effort) registers the dashboard webhook so push-based cache
 * invalidation works from day one.
 *
 * Idempotent: re-running on a configured repo syncs the workflow to the
 * latest template, refreshes the `KODY_TOKEN` secret, and refreshes the
 * webhook subscription.
 *
 * The `KODY_TOKEN` write needs `repo:secrets:write` on the PAT (a normal
 * `repo`-scoped fine-grained PAT covers this). When it fails we soft-fail
 * and surface a `nextSteps` entry so the user can set the secret manually.
 */
import type { Octokit } from '@octokit/rest'
import sodium from 'libsodium-wrappers'
import { logger } from '@dashboard/lib/logger'
import { ensureWebhook } from '@dashboard/lib/webhooks/register'

export const KODY_TOKEN_SECRET = 'KODY_TOKEN'

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
  kodyTokenSecret: {
    ok: boolean
    name: string
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

async function encryptForRepo(
  value: string,
  base64PublicKey: string,
): Promise<string> {
  await sodium.ready
  const messageBytes = sodium.from_string(value)
  const keyBytes = sodium.from_base64(
    base64PublicKey,
    sodium.base64_variants.ORIGINAL,
  )
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes)
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL)
}

/**
 * Best-effort: encrypt `value` against the repo's Actions public key and
 * upsert it as the `secretName` repo secret. Returns `{ ok: false, error }`
 * on any failure — callers should surface the error in `nextSteps` rather
 * than aborting the install.
 */
async function setRepoActionsSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  secretName: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data: key } = await octokit.rest.actions.getRepoPublicKey({
      owner,
      repo,
    })
    const encrypted_value = await encryptForRepo(value, key.key)
    await octokit.rest.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value,
      key_id: key.key_id,
    })
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'set_repo_secret_failed',
    }
  }
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

    const kodyTokenResult = await setRepoActionsSecret(
      octokit,
      owner,
      repo,
      KODY_TOKEN_SECRET,
      token,
    )
    const kodyTokenSecret: InstallEngineResult['kodyTokenSecret'] =
      kodyTokenResult.ok
        ? { ok: true, name: KODY_TOKEN_SECRET }
        : {
            ok: false,
            name: KODY_TOKEN_SECRET,
            error: kodyTokenResult.error,
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
        kodyTokenSecretOk: kodyTokenSecret.ok,
      },
      'installEngine: installed engine workflow',
    )

    const nextSteps = [
      'Add at least one provider key as an Actions secret. The engine reads any ' +
        '`*_API_KEY` secret automatically via `toJSON(secrets)` — common picks: ' +
        '`MINIMAX_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. ' +
        `Repo settings: https://github.com/${owner}/${repo}/settings/secrets/actions/new`,
      'Pick "Kody Live" (or "Kody Live Fly") in the chat agent dropdown to ' +
        'verify the workflow runs. First dispatch cold-starts in ~30s.',
    ]
    if (!kodyTokenSecret.ok) {
      nextSteps.unshift(
        `Couldn't auto-set the \`${KODY_TOKEN_SECRET}\` Actions secret ` +
          `(${kodyTokenSecret.error ?? 'unknown error'}). The PAT used here ` +
          'likely lacks `repo:secrets:write`. Without it the engine has no ' +
          'GitHub auth at runtime — labels, comments and PR updates will fail. ' +
          'Either re-mint the PAT with secrets write access and re-run /init, ' +
          `or add the secret by hand: ` +
          `https://github.com/${owner}/${repo}/settings/secrets/actions/new`,
      )
    }

    const tokenSummary = kodyTokenSecret.ok
      ? `${KODY_TOKEN_SECRET} secret ${workflowAction === 'created' ? 'set' : 'refreshed'}.`
      : `${KODY_TOKEN_SECRET} secret FAILED — ${kodyTokenSecret.error ?? 'unknown'}.`
    const webhookSummary = webhook.ok
      ? `Webhook ${workflowAction === 'created' ? 'registered' : 'refreshed'}.`
      : `Webhook FAILED — ${webhook.error ?? 'unknown'}.`
    const workflowSummary =
      workflowAction === 'created'
        ? `Engine workflow created at ${WORKFLOW_PATH}.`
        : workflowAction === 'updated'
          ? 'Engine workflow updated to the latest template.'
          : 'Engine workflow already matches the latest template — no commit needed.'
    const summary = `${workflowSummary} ${tokenSummary} ${webhookSummary}`

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
      kodyTokenSecret,
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
