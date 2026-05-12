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
import { spawnRunner } from '@dashboard/lib/runners/fly'

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
 * Builds the ALL_SECRETS blob the engine reads at runtime. On GH Actions
 * this comes from `toJSON(secrets)`. Here we pass through any *_API_KEY
 * env var the dashboard knows about. POC scope — full vault wiring later.
 */
function buildAllSecrets(): Record<string, string> {
  const passthroughKeys = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'MINIMAX_API_KEY',
    'KODY_TOKEN',
  ]
  const out: Record<string, string> = {}
  for (const key of passthroughKeys) {
    const v = process.env[key]
    if (v) out[key] = v
  }
  return out
}

/**
 * Decide which model to ask LiteLLM to start with. The engine's built-in
 * default is `minimax/MiniMax-M2.7-highspeed` — if that key isn't in the
 * dashboard env, LiteLLM will hang for ~60s trying to authenticate and
 * then fail. So pick a model whose key we actually have.
 *
 * Order of preference matches the engine's own ranking (cheapest/fastest
 * proven model first) — Gemini Flash is the cheapest viable option for
 * chat-style usage.
 */
function pickFallbackModel(): string | undefined {
  if (process.env.MINIMAX_API_KEY) return undefined // engine default works
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic/claude-haiku-4-5-20251001'
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return 'gemini/gemini-2.5-flash'
  }
  if (process.env.OPENAI_API_KEY) return 'openai/gpt-4o-mini'
  return undefined
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  let body: {
    taskId?: string
    idleExitMs?: number
    hardCapMs?: number
    // Accepted for forward compatibility — currently ignored, matching
    // /interactive/start. See that route's comment about Vercel's
    // per-instance in-memory bus and why polling is more reliable.
    dashboardUrl?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { taskId, idleExitMs, hardCapMs } = body
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

    // dashboardUrl intentionally omitted — same reason as
    // /interactive/start. The runner polls the session JSONL instead;
    // events arrive via the file-stream poller.
    const model = pickFallbackModel()
    const { machineId, region } = await spawnRunner({
      repo: `${owner}/${repo}`,
      githubToken,
      sessionId: taskId,
      idleExitMs,
      hardCapMs,
      model,
      allSecrets: buildAllSecrets(),
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
