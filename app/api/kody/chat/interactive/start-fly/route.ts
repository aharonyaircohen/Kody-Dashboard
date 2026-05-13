/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern interactive-session-start-fly
 *
 * POST /api/kody/chat/interactive/start-fly
 *
 * Same shape as /interactive/start, but instead of dispatching the
 * `kody.yml` workflow on GitHub Actions, spawns a Fly Machine that runs
 * the same engine image. Used by the `kody-live-fly` agent.
 *
 * The session JSONL lives in the same place (.kody/sessions/{id}.jsonl)
 * so the existing append + event-stream paths work unchanged — only the
 * runtime moves.
 *
 * Body: see /interactive/start (taskId, idleExitMs, hardCapMs).
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from '@dashboard/lib/auth'
import { logger } from '@dashboard/lib/logger'
import {
  buildMetaLine,
  writeSessionMeta,
} from '@dashboard/lib/interactive-session'
import { mintSessionToken } from '@dashboard/lib/chat-token'
import { spawnRunner } from '@dashboard/lib/runners/fly'
import { readVault } from '@dashboard/lib/vault/store'
import type { Octokit } from '@octokit/rest'

export const runtime = 'nodejs'

function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const override = (process.env.KODY_CHAT_WORKFLOW_REPO ?? '').trim()
  if (override && override.includes('/')) {
    const [owner, repo] = override.split('/').map((s) => s.trim())
    if (owner && repo) return { owner, repo }
  }
  const headerAuth = getRequestAuth(req)
  if (headerAuth) return { owner: headerAuth.owner, repo: headerAuth.repo }
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>
  return {
    owner: (GITHUB_OWNER ?? 'aharonyaircohen').trim(),
    repo: (GITHUB_REPO ?? 'Kody-Dashboard').trim(),
  }
}

/**
 * Builds the ALL_SECRETS blob the engine reads at runtime by decrypting
 * the per-repo secrets vault (.kody/secrets.enc). This mirrors what
 * `toJSON(secrets)` returns on GH Actions — model API keys (and anything
 * else the user has saved at /secrets) flow through unchanged.
 *
 * Returns {} when the vault is missing, empty, or unreadable. The engine
 * will then fail its own auth check downstream; do NOT fall back to env
 * vars or pick a model here — model selection lives in the dashboard,
 * not in this route.
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
    logger.warn({ err, owner, repo }, 'interactive-fly: vault read failed')
    return {}
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  let body: {
    taskId?: string
    idleExitMs?: number
    hardCapMs?: number
    /**
     * Base URL the runner POSTs chat events to. The route appends an inline
     * HMAC token so the ingest endpoint can authenticate the Fly machine
     * (its IP isn't in GitHub's CIDR list). Optional — when absent the
     * runner falls back to git-polling the session JSONL.
     */
    dashboardUrl?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { taskId, idleExitMs, hardCapMs, dashboardUrl } = body
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  }

  const { owner, repo } = getEngineRepo(req)
  const octokit = await getUserOctokit(req)
  const headerAuth = getRequestAuth(req)
  const githubToken =
    headerAuth?.token ??
    process.env.KODY_BOT_TOKEN ??
    process.env.GITHUB_TOKEN ??
    ''

  if (!octokit || !githubToken) {
    return NextResponse.json(
      { error: 'No GitHub token available' },
      { status: 503 },
    )
  }

  try {
    logger.info(
      { taskId, owner, repo, idleExitMs, hardCapMs },
      'interactive-fly: starting session',
    )

    // Same meta-line write as the Actions path — the engine relies on it
    // to recognize interactive mode regardless of which runtime it boots in.
    const meta = buildMetaLine({ idleExitMs, hardCapMs })
    await writeSessionMeta(octokit, owner, repo, taskId, meta)

    // dashboardUrl + inline HMAC token so the runner can push events
    // straight to /api/kody/events/ingest. The Fly machine's source IP
    // isn't in GitHub Actions's CIDR list, so the token is the only way
    // it gets past the ingest auth gate.
    let ingestUrl: string | undefined
    if (dashboardUrl) {
      const token = mintSessionToken(taskId)
      const joiner = dashboardUrl.includes('?') ? '&' : '?'
      ingestUrl = `${dashboardUrl}${joiner}sessionId=${encodeURIComponent(
        taskId,
      )}&token=${token}`
    }

    // Model selection happens entirely on the engine side using the
    // secrets the vault provides. No hardcoded fallbacks here.
    const allSecrets = await buildAllSecretsFromVault(octokit, owner, repo)

    // Fly Machines API token is a PROJECT credential — pulled from the
    // same repo vault as the model keys, not from the browser. The
    // engine machine doesn't need the token itself, so strip it from
    // ALL_SECRETS before passing the rest through.
    const flyToken = allSecrets.FLY_API_TOKEN
    if (flyToken) delete allSecrets.FLY_API_TOKEN

    // Optional perf tier from Settings → Fly Runner. Defaults to "medium"
    // (performance-1x) on the runner side when missing or unrecognized.
    const rawPerf = req.headers.get('x-kody-fly-perf')
    const perfTier =
      rawPerf === 'low' || rawPerf === 'medium' || rawPerf === 'high'
        ? rawPerf
        : undefined
    // Optional always-on LiteLLM proxy. Default points at the kody-litellm
    // Fly app over the private 6PN network; set FLY_LITELLM_URL="" to
    // disable and fall back to per-session pre-warm.
    const litellmUrl =
      process.env.FLY_LITELLM_URL ?? 'http://kody-litellm.internal:4000'

    const { machineId, region } = await spawnRunner({
      repo: `${owner}/${repo}`,
      githubToken,
      sessionId: taskId,
      dashboardUrl: ingestUrl,
      idleExitMs,
      hardCapMs,
      allSecrets,
      flyToken,
      perfTier,
      litellmUrl: litellmUrl || undefined,
    })

    logger.info(
      { taskId, machineId, region, owner, repo },
      'interactive-fly: machine spawned',
    )

    return NextResponse.json({
      ok: true,
      taskId,
      mode: 'interactive',
      runner: 'fly',
      machineId,
      target: { owner, repo, branch: 'main', workflow: 'fly' },
    })
  } catch (err) {
    logger.error({ err, taskId }, 'interactive-fly: start failed')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Start failed' },
      { status: 500 },
    )
  }
}
