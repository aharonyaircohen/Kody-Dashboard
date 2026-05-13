/**
 * @fileType library
 * @domain runners
 * @pattern fly-machines-client
 *
 * Thin client for the Fly Machines API — spawn a one-shot machine that
 * runs the kody engine. Used as a parallel runtime to GitHub Actions
 * for the kody-live-fly agent (POC).
 *
 * Reference: https://docs.machines.dev/swagger/index.html
 */

import { logger } from '@dashboard/lib/logger'

const FLY_API_BASE = 'https://api.machines.dev/v1'

const DEFAULT_APP = process.env.FLY_APP_NAME ?? 'kody-runner'
const DEFAULT_IMAGE =
  process.env.FLY_RUNNER_IMAGE ??
  'registry.fly.io/kody-runner:latest'
const DEFAULT_REGION = process.env.FLY_REGION ?? 'fra'

export interface SpawnRunnerInput {
  /** owner/name of the user's repo the engine will clone */
  repo: string
  /** GitHub token with repo + workflow scope (the user's PAT) */
  githubToken: string
  /** kody session id (also taskId) */
  sessionId: string
  /** Dashboard ingest URL with HMAC token appended */
  dashboardUrl?: string
  /** Optional initial chat message (one-shot mode); empty for interactive */
  initMessage?: string
  /** Optional model override (e.g. anthropic/claude-haiku-4-5-20251001) */
  model?: string
  /**
   * JSON blob of secrets the engine reads (mirrors GH Actions
   * `toJSON(secrets)`). For POC: pass at least the model API key.
   */
  allSecrets?: Record<string, string>
  /** Idle exit override (ms) for interactive mode */
  idleExitMs?: number
  /** Hard cap override (ms) for interactive mode */
  hardCapMs?: number
  /**
   * Fly Machines API token. When omitted, falls back to FLY_API_TOKEN /
   * FLY_IO_TOKEN env vars. The user-scoped token (set via /settings) is
   * the preferred source — env is only a server fallback.
   */
  flyToken?: string
}

export interface SpawnRunnerResult {
  machineId: string
  app: string
  region: string
}

function requireFlyToken(explicit?: string): string {
  const token =
    explicit ??
    process.env.FLY_API_TOKEN ??
    process.env.FLY_IO_TOKEN ??
    ''
  if (!token) {
    throw new Error(
      'Fly runner not configured: save a token via Settings → Fly Runner ' +
        '(or set FLY_API_TOKEN in env as a server-side fallback)',
    )
  }
  return token
}

/**
 * Build the env array for the Fly Machine. Keys here match what the
 * kody-runner image's entrypoint.sh expects.
 */
function buildMachineEnv(input: SpawnRunnerInput): Record<string, string> {
  const env: Record<string, string> = {
    REPO: input.repo,
    GITHUB_TOKEN: input.githubToken,
    SESSION_ID: input.sessionId,
  }
  if (input.initMessage) env.INIT_MESSAGE = input.initMessage
  if (input.model) env.MODEL = input.model
  if (input.dashboardUrl) env.DASHBOARD_URL = input.dashboardUrl
  if (input.idleExitMs) env.KODY_IDLE_EXIT_MS = String(input.idleExitMs)
  if (input.hardCapMs) env.KODY_HARD_CAP_MS = String(input.hardCapMs)
  if (input.allSecrets) {
    env.ALL_SECRETS = JSON.stringify(input.allSecrets)
  }
  return env
}

/**
 * POST /apps/{app}/machines — create + start a new Machine that runs the
 * runner image once and exits. The image's ENTRYPOINT is the engine's
 * entrypoint.sh; no command override needed.
 */
export async function spawnRunner(
  input: SpawnRunnerInput,
): Promise<SpawnRunnerResult> {
  const token = requireFlyToken(input.flyToken)
  const app = DEFAULT_APP
  const region = DEFAULT_REGION
  const image = DEFAULT_IMAGE

  // Performance-2x: 2 dedicated CPUs + 4GB RAM. The bottleneck on cold
  // boot is the repo checkout (writes thousands of small files); more
  // CPU + dedicated (not shared) significantly reduces that wall time.
  // Memory headroom also helps Node 22 + Python (LiteLLM) coexist.
  const body = {
    config: {
      image,
      env: buildMachineEnv(input),
      auto_destroy: true,
      restart: { policy: 'no' },
      guest: { cpu_kind: 'performance', cpus: 2, memory_mb: 4096 },
    },
    region,
  }

  const url = `${FLY_API_BASE}/apps/${encodeURIComponent(app)}/machines`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.error(
      { status: res.status, body: text.slice(0, 500), app, sessionId: input.sessionId },
      'fly: spawnRunner failed',
    )
    throw new Error(
      `Fly Machines API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    )
  }

  const data = (await res.json()) as { id?: string; region?: string }
  if (!data.id) {
    throw new Error('Fly Machines API returned no machine id')
  }

  logger.info(
    { machineId: data.id, app, region: data.region ?? region, sessionId: input.sessionId },
    'fly: machine spawned',
  )

  return { machineId: data.id, app, region: data.region ?? region }
}
