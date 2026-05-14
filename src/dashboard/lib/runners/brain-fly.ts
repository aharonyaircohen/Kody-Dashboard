/**
 * @fileType library
 * @domain runners
 * @pattern fly-machines-brain
 *
 * Brain-on-Fly provisioner. Creates and manages a per-user, long-running
 * Fly Machine that serves the Brain SSE protocol. Pairs with the kody2
 * `brain-serve` executable (HTTP wrapper around the chat loop).
 *
 * Separate module from runners/fly.ts on purpose:
 *   - fly.ts spawns one-shot, ephemeral machines (auto_destroy=true,
 *     restart=no). It is the wrong shape for a long-running server.
 *   - brain-fly.ts provisions a persistent app + machine with autostop=
 *     "suspend" so it resumes on demand (~1s cold) and idles at near-zero
 *     cost. Shares only the `flyToken` plumbing from runners/fly-context.
 *
 * One Fly app per user. App name = `kody-brain-<owner>` (lowercased,
 * hyphen-safe). The app exposes :443 → :8080 (the brain-serve HTTP port).
 * Auth between dashboard and brain-serve is a 32-byte hex API key
 * generated at provision time and stored on the machine as
 * BRAIN_API_KEY (env). The same key is returned once to the dashboard
 * which writes it into the user's Settings (auth.brain.apiKey).
 *
 * Reference: https://docs.machines.dev/swagger/index.html
 */

import { randomBytes } from 'node:crypto'

import { logger } from '@dashboard/lib/logger'

const FLY_API_BASE = 'https://api.machines.dev/v1'

const DEFAULT_IMAGE =
  process.env.FLY_BRAIN_IMAGE ?? 'registry.fly.io/kody-brain:latest'
const DEFAULT_REGION = process.env.FLY_REGION ?? 'fra'
const ORGANIZATION = process.env.FLY_BRAIN_ORG ?? 'personal'

export type PerfTier = 'low' | 'medium' | 'high'

const PERF_GUEST: Record<PerfTier, {
  cpu_kind: 'shared' | 'performance'
  cpus: number
  memory_mb: number
}> = {
  low: { cpu_kind: 'shared', cpus: 2, memory_mb: 2048 },
  medium: { cpu_kind: 'performance', cpus: 1, memory_mb: 2048 },
  high: { cpu_kind: 'performance', cpus: 2, memory_mb: 4096 },
}

const DEFAULT_PERF_TIER: PerfTier = 'medium'

export interface ProvisionBrainInput {
  flyToken: string
  /** GitHub login the Brain belongs to. Used to derive the app name. */
  owner: string
  /** owner/name of the repo the Brain will clone on boot. */
  repo: string
  /** GitHub token the Brain uses to clone (the user's PAT). */
  githubToken: string
  /** Provider keys etc. (mirrors GH Actions toJSON(secrets)). */
  allSecrets?: Record<string, string>
  /** Optional model override (e.g. anthropic/claude-sonnet-4-6). */
  model?: string
  /** Performance tier — maps to a fixed Fly guest shape. */
  perfTier?: PerfTier
  /** Optional always-on LiteLLM proxy URL. */
  litellmUrl?: string
  /** Default branch to clone. */
  ref?: string
  /** Override the generated app name (tests). */
  appNameOverride?: string
  /** Override the generated API key (tests). */
  apiKeyOverride?: string
}

export interface ProvisionBrainResult {
  /** Fly app name (kody-brain-<owner>). */
  app: string
  /** Public URL the dashboard's Brain proxy points at. */
  url: string
  /** Bearer key — return ONCE to the caller. Never read again. */
  apiKey: string
  /** Created machine id. */
  machineId: string
  /** Fly region. */
  region: string
}

export interface DestroyBrainInput {
  flyToken: string
  owner: string
  appNameOverride?: string
}

export interface BrainStatusInput {
  flyToken: string
  owner: string
  appNameOverride?: string
}

export interface BrainStatusResult {
  app: string
  /** "running" | "suspended" | "stopped" | "off" (= no app/machine yet) */
  state: 'running' | 'suspended' | 'stopped' | 'off'
  url?: string
  machineId?: string
}

/**
 * Poll `<url>/healthz` until it returns 200, or give up after `timeoutMs`.
 *
 * On a fresh provision the machine returns from the Fly API in ~12s but
 * the Node server inside doesn't bind :8080 until the entrypoint finishes
 * the repo clone (~25-40s) and brain-serve initialises LiteLLM (~10-20s).
 * Forwarding the chat request before then yields a Fly-edge 503 ("instance
 * refused connection"). On reuse the server is already running and the
 * first poll returns immediately.
 */
export async function waitForBrainHealth(
  url: string,
  timeoutMs = 120_000,
): Promise<void> {
  const start = Date.now()
  const healthUrl = `${url.replace(/\/+$/, '')}/healthz`
  let lastErr: unknown = null
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(healthUrl, {
        // The Fly edge proxy returns quickly when no instance is listening,
        // so a short per-attempt timeout keeps the polling cadence tight.
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) return
      lastErr = `status ${res.status}`
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new Error(
    `brain-fly: ${healthUrl} not ready after ${Math.round(timeoutMs / 1000)}s (${detail})`,
  )
}

/**
 * Normalize a GitHub login into a Fly-app-safe slug. Fly app names must
 * match `^[a-z0-9][a-z0-9-]*$` and are globally unique, so we prefix
 * with `kody-brain-` and lowercase the owner. Non-alphanumerics become
 * hyphens; multiple hyphens collapse; leading/trailing hyphens stripped.
 */
export function brainAppName(owner: string): string {
  const slug = owner
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) {
    throw new Error('brainAppName: owner is empty after slugify')
  }
  return `kody-brain-${slug}`
}

function generateApiKey(): string {
  return randomBytes(32).toString('hex')
}

function brainAppUrl(app: string): string {
  return `https://${app}.fly.dev`
}

function buildMachineEnv(input: ProvisionBrainInput, apiKey: string): Record<string, string> {
  const env: Record<string, string> = {
    REPO: input.repo,
    GITHUB_TOKEN: input.githubToken,
    BRAIN_API_KEY: apiKey,
    PORT: '8080',
  }
  if (input.model) env.MODEL = input.model
  if (input.ref) env.REF = input.ref
  if (input.litellmUrl) env.KODY_LITELLM_URL = input.litellmUrl
  if (input.allSecrets) env.ALL_SECRETS = JSON.stringify(input.allSecrets)
  return env
}

interface FlyFetchOpts {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  token: string
  body?: unknown
  /** Treat 404 as a soft miss (resolves to null). */
  allow404?: boolean
}

/**
 * Thin Fly Machines API helper. Centralised so all callers share the
 * same auth + error shape.
 */
export async function flyFetch<T>(
  path: string,
  opts: FlyFetchOpts,
): Promise<T | null> {
  const url = `${FLY_API_BASE}${path}`
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 404 && opts.allow404) return null
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.error(
      { status: res.status, body: text.slice(0, 500), path },
      'brain-fly: Fly API error',
    )
    throw new Error(
      `Fly Machines API ${res.status} on ${path}: ${text.slice(0, 200) || res.statusText}`,
    )
  }
  if (res.status === 204) return null
  // Fly returns 200/202 with an empty body on some mutating calls (e.g.
  // DELETE /apps/{name}). Parsing an empty string as JSON throws — guard
  // by reading text first.
  const raw = await res.text()
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    logger.error(
      { status: res.status, body: raw.slice(0, 500), path },
      'brain-fly: Fly API returned non-JSON body',
    )
    throw new Error(
      `Fly Machines API on ${path}: response was not JSON (status ${res.status})`,
    )
  }
}

interface FlyApp {
  id?: string
  name: string
  status?: string
  organization?: { slug: string }
}

interface FlyMachine {
  id: string
  state?: string
  config?: { image?: string; env?: Record<string, string> }
  region?: string
}

/**
 * Ensure the per-user app exists. Idempotent — if it's already there,
 * return it; otherwise create it. Fly app names are globally unique, so
 * a 409 on create means another user (or stale provision) owns it.
 */
async function ensureApp(flyToken: string, appName: string): Promise<FlyApp> {
  const existing = await flyFetch<FlyApp>(
    `/apps/${encodeURIComponent(appName)}`,
    { token: flyToken, allow404: true },
  )
  if (existing) {
    // Existing apps may already have IPs (or not, on a half-finished
    // provision). allocateIpsIfMissing is idempotent.
    await allocateIpsIfMissing(flyToken, appName)
    return existing
  }
  const created = await flyFetch<FlyApp>('/apps', {
    method: 'POST',
    token: flyToken,
    body: { app_name: appName, org_slug: ORGANIZATION },
  })
  if (!created) throw new Error('brain-fly: create app returned empty')
  await allocateIpsIfMissing(flyToken, appName)
  return created
}

/**
 * Allocate a shared v4 + dedicated v6 IP for the app if it doesn't have
 * any yet. The Machines REST API does NOT auto-allocate IPs on
 * `POST /apps`, so without this the app's *.fly.dev DNS resolves to
 * nothing and HTTPS requests fail with NXDOMAIN. IP allocation lives on
 * Fly's GraphQL API rather than Machines REST.
 */
export async function allocateIpsIfMissing(
  flyToken: string,
  appName: string,
): Promise<void> {
  // Cheap probe — Machines API exposes /ips on the app. If it returns
  // anything, leave it alone.
  const existing = await flyFetch<unknown[]>(
    `/apps/${encodeURIComponent(appName)}/ips`,
    { token: flyToken, allow404: true },
  )
  if (Array.isArray(existing) && existing.length > 0) return

  const query = `mutation($appId: ID!, $type: IPAddressType!) {
    allocateIpAddress(input: { appId: $appId, type: $type }) {
      ipAddress { id address type }
    }
  }`

  const allocate = async (type: 'shared_v4' | 'v6') => {
    const res = await fetch('https://api.fly.io/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${flyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { appId: appName, type } }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `brain-fly: allocate IP (${type}) failed ${res.status}: ${text.slice(0, 200)}`,
      )
    }
    const body = (await res.json()) as { errors?: Array<{ message: string }> }
    if (body.errors && body.errors.length > 0) {
      throw new Error(
        `brain-fly: allocate IP (${type}) graphql error: ${body.errors[0]!.message}`,
      )
    }
  }

  await allocate('shared_v4')
  await allocate('v6')
  logger.info({ app: appName }, 'brain-fly: IPs allocated (shared v4 + dedicated v6)')
}

async function findExistingMachine(
  flyToken: string,
  appName: string,
): Promise<FlyMachine | null> {
  const list = await flyFetch<FlyMachine[]>(
    `/apps/${encodeURIComponent(appName)}/machines`,
    { token: flyToken, allow404: true },
  )
  if (!list || list.length === 0) return null
  // Prefer non-destroyed machines.
  const live = list.find((m) => m.state !== 'destroyed' && m.state !== 'destroying')
  return live ?? null
}

/**
 * Create a new persistent brain machine in the given app.
 *
 * - `auto_destroy: false` — the machine is NOT one-shot.
 * - `restart: { policy: 'on-failure' }` — recover from crashes.
 * - `services` — Fly's HTTP edge maps :443 → internal :8080 with
 *   auto-stop/start (suspend on idle, resume on next request).
 */
async function createMachine(
  flyToken: string,
  appName: string,
  input: ProvisionBrainInput,
  apiKey: string,
): Promise<FlyMachine> {
  const tier: PerfTier = input.perfTier ?? DEFAULT_PERF_TIER
  const guest = PERF_GUEST[tier]
  const region = DEFAULT_REGION

  const body = {
    name: `brain-${region}`,
    region,
    config: {
      image: DEFAULT_IMAGE,
      env: buildMachineEnv(input, apiKey),
      auto_destroy: false,
      restart: { policy: 'on-failure', max_retries: 3 },
      guest,
      services: [
        {
          // force_https belongs on the plain-HTTP port (it redirects to
          // 443); Fly rejects it on a TLS-handled port. The :443 listener
          // does both TLS termination and HTTP/2 upgrade.
          ports: [
            { port: 443, handlers: ['tls', 'http'] },
            { port: 80, handlers: ['http'], force_https: true },
          ],
          protocol: 'tcp',
          internal_port: 8080,
          autostop: 'suspend',
          autostart: true,
          min_machines_running: 0,
          concurrency: { type: 'requests', soft_limit: 50, hard_limit: 100 },
        },
      ],
      checks: {
        healthz: {
          type: 'http',
          port: 8080,
          method: 'GET',
          path: '/healthz',
          interval: '15s',
          timeout: '5s',
          grace_period: '30s',
        },
      },
    },
  }

  const created = await flyFetch<FlyMachine>(
    `/apps/${encodeURIComponent(appName)}/machines`,
    { method: 'POST', token: flyToken, body },
  )
  if (!created) throw new Error('brain-fly: create machine returned empty')
  return created
}

/**
 * Provision a Brain for the given user. Idempotent at the app level
 * (re-uses an existing kody-brain-<owner> app) but NOT at the machine
 * level — if a machine already exists, we leave it and reuse it rather
 * than minting a fresh API key. The caller should `destroy` first when
 * they want to rotate.
 */
export async function provisionBrain(
  input: ProvisionBrainInput,
): Promise<ProvisionBrainResult> {
  if (!input.flyToken?.trim()) {
    throw new Error(
      'brain-fly: flyToken required (set FLY_API_TOKEN in the repo secrets vault)',
    )
  }
  const app = input.appNameOverride ?? brainAppName(input.owner)
  const url = brainAppUrl(app)

  await ensureApp(input.flyToken, app)

  const existing = await findExistingMachine(input.flyToken, app)
  if (existing) {
    const existingKey = existing.config?.env?.BRAIN_API_KEY ?? ''
    if (!existingKey) {
      throw new Error(
        `brain-fly: app ${app} has a machine without BRAIN_API_KEY env — destroy first, then re-provision`,
      )
    }
    logger.info({ app, machineId: existing.id }, 'brain-fly: reusing existing machine')
    return {
      app,
      url,
      apiKey: existingKey,
      machineId: existing.id,
      region: existing.region ?? DEFAULT_REGION,
    }
  }

  const apiKey = input.apiKeyOverride ?? generateApiKey()
  const machine = await createMachine(input.flyToken, app, input, apiKey)

  logger.info(
    { app, machineId: machine.id, region: machine.region ?? DEFAULT_REGION },
    'brain-fly: machine provisioned',
  )

  return {
    app,
    url,
    apiKey,
    machineId: machine.id,
    region: machine.region ?? DEFAULT_REGION,
  }
}

/**
 * Destroy the per-user Brain. Removes the machine(s) and the app. Safe
 * to call when nothing exists (returns silently).
 */
export async function destroyBrain(input: DestroyBrainInput): Promise<void> {
  if (!input.flyToken?.trim()) {
    throw new Error('brain-fly: flyToken required')
  }
  const app = input.appNameOverride ?? brainAppName(input.owner)

  const existing = await flyFetch<FlyApp>(
    `/apps/${encodeURIComponent(app)}`,
    { token: input.flyToken, allow404: true },
  )
  if (!existing) {
    logger.info({ app }, 'brain-fly: destroy — app already absent')
    return
  }

  // Deleting the app removes all machines under it. Pass `force=true` to
  // skip the "drain in-flight requests" wait — brain machines don't carry
  // critical state beyond the session JSONLs on the volume.
  await flyFetch<unknown>(
    `/apps/${encodeURIComponent(app)}?force=true`,
    { method: 'DELETE', token: input.flyToken, allow404: true },
  )
  logger.info({ app }, 'brain-fly: app destroyed')
}

/**
 * Read the current state of the per-user Brain. Returns `state: 'off'`
 * when no app exists yet (provision has never run for this user).
 */
export async function brainStatus(
  input: BrainStatusInput,
): Promise<BrainStatusResult> {
  if (!input.flyToken?.trim()) {
    throw new Error('brain-fly: flyToken required')
  }
  const app = input.appNameOverride ?? brainAppName(input.owner)

  const existing = await flyFetch<FlyApp>(
    `/apps/${encodeURIComponent(app)}`,
    { token: input.flyToken, allow404: true },
  )
  if (!existing) {
    return { app, state: 'off' }
  }

  const machine = await findExistingMachine(input.flyToken, app)
  if (!machine) {
    return { app, state: 'off', url: brainAppUrl(app) }
  }

  // Fly machine states we care about: started/starting/created/replacing
  // are all "the machine is or is about to be live" → running. Suspended
  // is its own bucket (idle, resumes on next request). Everything else
  // (stopped, stopping, destroying) renders as stopped.
  const state: BrainStatusResult['state'] =
    machine.state === 'started' ||
    machine.state === 'starting' ||
    machine.state === 'created' ||
    machine.state === 'replacing'
      ? 'running'
      : machine.state === 'suspended' || machine.state === 'suspending'
        ? 'suspended'
        : 'stopped'

  return {
    app,
    state,
    url: brainAppUrl(app),
    machineId: machine.id,
  }
}
