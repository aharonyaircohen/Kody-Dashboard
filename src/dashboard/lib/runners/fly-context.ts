/**
 * @fileType library
 * @domain runners
 * @pattern fly-spawn-context
 *
 * Shared "Fly Machine spawn context" builder used by every route that
 * spawns a runner machine. Pulls together the bits that every spawner
 * needs: auth, repo, secrets vault, Fly token, perf tier, LiteLLM URL.
 *
 * Routes stay thin — they call resolveFlyContext, then spawnRunner with
 * mode-specific bits (chat-mode adds session meta + ingest URL; vibe
 * mode adds an issue number).
 */

import type { NextRequest } from 'next/server'
import type { Octokit } from '@octokit/rest'

import { getRequestAuth, getUserOctokit } from '@dashboard/lib/auth'
import { logger } from '@dashboard/lib/logger'
import { readVault } from '@dashboard/lib/vault/store'
import type { PerfTier } from './fly'

/**
 * Resolved Fly spawn context. Pass straight through to spawnRunner —
 * the fields are named to match SpawnRunnerInput.
 */
export interface FlyContext {
  owner: string
  repo: string
  githubToken: string
  octokit: Octokit
  /** Secrets the engine reads at runtime; FLY_API_TOKEN is already extracted. */
  allSecrets: Record<string, string>
  flyToken: string | undefined
  perfTier: PerfTier | undefined
  litellmUrl: string | undefined
}

/**
 * Result type for resolveFlyContext. The error case carries enough info
 * for the route to build a NextResponse without leaking helper internals.
 */
export type FlyContextResult =
  | { ok: true; context: FlyContext }
  | { ok: false; error: string; status: number }

/**
 * Decrypt the per-repo secrets vault and flatten it into the env shape
 * the engine expects (mirrors what `toJSON(secrets)` returns on GH
 * Actions). Returns {} when the vault is missing, empty, or unreadable —
 * the engine will surface its own auth error downstream.
 */
async function buildAllSecretsFromVault(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<Record<string, string>> {
  try {
    const { doc } = await readVault(octokit, owner, repo)
    const out: Record<string, string> = {}
    for (const [name, entry] of Object.entries(doc.secrets)) {
      if (entry?.value) out[name] = entry.value
    }
    return out
  } catch (err) {
    logger.warn({ err, owner, repo }, 'fly-context: vault read failed')
    return {}
  }
}

/**
 * Build a Fly spawn context from the incoming request. Reads:
 *   - x-kody-token / x-kody-owner / x-kody-repo headers (header auth)
 *   - per-repo secrets vault (model keys + FLY_API_TOKEN)
 *   - x-kody-fly-perf header (perf tier, optional)
 *   - FLY_LITELLM_URL env (always-on litellm proxy URL, optional)
 *
 * Errors flow back as {ok:false} so the caller decides how to respond.
 * Pass `repoOverride` to operate on a repo other than the one in
 * header auth (chat uses this for KODY_CHAT_WORKFLOW_REPO).
 */
export async function resolveFlyContext(
  req: NextRequest,
  opts?: { repoOverride?: { owner: string; repo: string } },
): Promise<FlyContextResult> {
  const headerAuth = getRequestAuth(req)
  const octokit = await getUserOctokit(req)
  const githubToken =
    headerAuth?.token ??
    process.env.KODY_BOT_TOKEN ??
    process.env.GITHUB_TOKEN ??
    ''

  if (!octokit || !githubToken) {
    return {
      ok: false,
      error: 'No GitHub token available',
      status: 503,
    }
  }

  // Default to the connected repo (where issues + workflows live). Chat
  // routes can override to point at the engine repo when configured.
  const owner = opts?.repoOverride?.owner ?? headerAuth?.owner ?? ''
  const repo = opts?.repoOverride?.repo ?? headerAuth?.repo ?? ''
  if (!owner || !repo) {
    return {
      ok: false,
      error: 'Repo not resolved (missing x-kody-owner/x-kody-repo headers)',
      status: 400,
    }
  }

  const allSecrets = await buildAllSecretsFromVault(octokit, owner, repo)

  // Fly Machines API token is a PROJECT credential pulled from the same
  // vault as the model keys. The spawned engine doesn't need it, so
  // strip it from ALL_SECRETS and surface separately for spawnRunner.
  const flyToken = allSecrets.FLY_API_TOKEN
  if (flyToken) delete allSecrets.FLY_API_TOKEN

  const rawPerf = req.headers.get('x-kody-fly-perf')
  const perfTier: PerfTier | undefined =
    rawPerf === 'low' || rawPerf === 'medium' || rawPerf === 'high'
      ? rawPerf
      : undefined

  // Default to the always-on kody-litellm Fly app over the private 6PN
  // network. Set FLY_LITELLM_URL="" to disable and fall back to the
  // per-session pre-warm path.
  const litellmRaw =
    process.env.FLY_LITELLM_URL ?? 'http://kody-litellm.internal:4000'

  return {
    ok: true,
    context: {
      owner,
      repo,
      githubToken,
      octokit,
      allSecrets,
      flyToken,
      perfTier,
      litellmUrl: litellmRaw || undefined,
    },
  }
}
