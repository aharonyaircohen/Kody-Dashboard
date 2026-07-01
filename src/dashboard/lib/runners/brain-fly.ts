/**
 * @fileType library
 * @domain runners
 * @pattern fly-machines-brain
 * @ai-summary Persistent per-user Brain app provisioner: auto_destroy=false,
 *   optional autostop="suspend" for near-zero idle (~1s resume). Shares flyToken
 *   plumbing with fly.ts but diverges on lifecycle — brain-fly is NOT one-shot.
 *   Reuses existing machine when image ref unchanged; recreates only on genuine
 *   image tag change to avoid churn loops. App name = kody-brain-<account>
 *   (stable per person, not per repo).
 *
 * Separate module from runners/fly.ts on purpose:
 *   - fly.ts spawns one-shot, ephemeral machines (auto_destroy=true,
 *     restart=no). It is the wrong shape for a long-running server.
 *   - brain-fly.ts provisions a persistent app + machine. By default it uses
 *     autostop="suspend" so it resumes on demand (~1s cold) and idles at
 *     near-zero cost; users can disable that auto-suspend. Shares only the
 *     `flyToken` plumbing from runners/fly-context.
 *
 * One Fly app per user. App name = `kody-brain-<account>` (lowercased,
 * hyphen-safe). The app exposes :443 → :8080 (the brain-serve HTTP port).
 * Auth between dashboard and brain-serve is a 32-byte hex API key
 * generated at provision time and stored on the machine as
 * BRAIN_API_KEY (env). The dashboard uses that key server-side for chat
 * proxying, and returns it only when the user explicitly copies an external
 * Brain login from the Runner page.
 *
 * Reference: https://docs.machines.dev/swagger/index.html
 */

import { createHash, randomBytes } from "node:crypto";

import { logger } from "@dashboard/lib/logger";
import type { EngineRuntimeModelConfig } from "@dashboard/lib/variables/models";

const FLY_API_BASE = "https://api.machines.dev/v1";

// Public GHCR image, NOT registry.fly.io. Each per-user Brain machine runs
// on the CONSUMER's own Fly account (their vault FLY_API_TOKEN), and a
// `registry.fly.io/...` ref is scoped to a single Fly account's private
// registry — the consumer account can't pull it, which is the
// "unsupported image: registry.fly.io/kody-brain:latest" 400. A public
// GHCR tag is pullable by any Fly account. Published from the engine repo
// (kody-engine: runner/Dockerfile.brain) via `pnpm brain:publish`; the
// image is engine-only, so consumer repos stay zero-touch.
export const DEFAULT_IMAGE =
  process.env.FLY_BRAIN_IMAGE ?? "ghcr.io/aharonyaircohen/kody-brain:latest";
const DEFAULT_REGION = process.env.FLY_REGION ?? "fra";
const ORGANIZATION = process.env.FLY_BRAIN_ORG ?? "personal";

export type PerfTier = "low" | "medium" | "high";

const PERF_GUEST: Record<
  PerfTier,
  {
    cpu_kind: "shared" | "performance";
    cpus: number;
    memory_mb: number;
  }
> = {
  low: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
  medium: { cpu_kind: "performance", cpus: 1, memory_mb: 2048 },
  high: { cpu_kind: "performance", cpus: 2, memory_mb: 4096 },
};

const DEFAULT_PERF_TIER: PerfTier = "medium";
const BOOT_CONFIG_HASH_ENV = "KODY_BRAIN_BOOT_CONFIG_HASH";
const RESTART_SENSITIVE_ENV_KEYS = [
  "MODEL",
  "KODY_MODEL_CONFIG",
  "KODY_CMS_DASHBOARD_URL",
  "ALL_SECRETS",
] as const;
const IP_ALLOC_RETRY_DELAYS_MS =
  process.env.NODE_ENV === "test"
    ? [0, 0, 0, 0, 0]
    : [500, 1000, 1500, 2000, 2500];

export class BrainFlyProvisionTransientError extends Error {
  retryAfterSeconds = 3;

  constructor(message: string) {
    super(message);
    this.name = "BrainFlyProvisionTransientError";
  }
}

export function isBrainFlyProvisionTransientError(
  err: unknown,
): err is BrainFlyProvisionTransientError {
  return err instanceof BrainFlyProvisionTransientError;
}

export interface ProvisionBrainInput {
  flyToken: string;
  /**
   * The authenticated GitHub account the Brain belongs to — derives the app
   * name (`kody-brain-<account>`). MUST be the verified PAT owner, NOT the
   * connected repo's owner, so one stable Brain serves all of a person's
   * repos instead of being pinned to whatever repo was connected at setup.
   */
  account: string;
  /**
   * Optional boot repo (owner/name) cloned at startup as a convenience.
   * Omit for a repo-less Brain — it boots with no work repo and clones each
   * repo on demand per chat message. `model` below still drives which model
   * the Brain runs; this only controls the (optional) boot clone.
   */
  repo?: string;
  /** GitHub token the Brain uses to clone (the user's PAT). */
  githubToken: string;
  /** Provider keys etc. (mirrors GH Actions toJSON(secrets)). */
  allSecrets?: Record<string, string>;
  /** Optional model override (e.g. anthropic/claude-sonnet-4-6). */
  model?: string;
  /** Full model runtime config from Dashboard /models. */
  modelConfig?: EngineRuntimeModelConfig;
  /** Performance tier — maps to a fixed Fly guest shape. */
  perfTier?: PerfTier;
  /** Fly org from the connected repo's Fly config. */
  orgSlug?: string;
  /** Fly region from the connected repo's Fly config. */
  defaultRegion?: string;
  /** Optional saved Brain image ref. Defaults to the public base Brain image. */
  imageRef?: string;
  /** Optional hook that maps a durable saved image to a Fly-pullable runtime ref. */
  resolveRuntimeImageRef?: (input: {
    app: string;
    imageRef: string;
  }) => Promise<string>;
  /** Optional hook that prepares the runtime image before machine creation. */
  prepareRuntimeImage?: (input: {
    app: string;
    sourceImageRef: string;
    runtimeImageRef: string;
  }) => Promise<void>;
  /** Default true. False disables Fly's idle auto-suspend for the Brain app. */
  suspendOnIdle?: boolean;
  /** Default branch to clone. */
  ref?: string;
  /** Dashboard origin used by Brain's Dashboard-backed CMS tools. */
  dashboardUrl?: string;
  /** Override the generated app name (tests). */
  appNameOverride?: string;
  /** Override the generated API key (tests). */
  apiKeyOverride?: string;
}

export interface ProvisionBrainResult {
  /** Fly app name actually used (may be `<name>-2` if the original slug was taken). */
  app: string;
  /** Public URL the dashboard's Brain proxy points at. */
  url: string;
  /** Bearer key — return ONCE to the caller. Never read again. */
  apiKey: string;
  /** Created machine id. */
  machineId: string;
  /** Fly region. */
  region: string;
  /** Fly org the app actually landed in. May differ from the configured
   * `FLY_BRAIN_ORG` default if the token is scoped to a different org. */
  org: string;
  /**
   * If non-null, Fly ended up using a different app name than the caller
   * requested. The UI should surface this so the user knows which slug is
   * actually stored.
   */
  originalName?: string;
}

export interface DestroyBrainInput {
  flyToken: string;
  account: string;
  appNameOverride?: string;
  orgSlug?: string;
  defaultRegion?: string;
}

export interface BrainStatusInput {
  flyToken: string;
  account: string;
  appNameOverride?: string;
  orgSlug?: string;
  defaultRegion?: string;
}

export interface SuspendBrainInput {
  flyToken: string;
  account: string;
  appNameOverride?: string;
  orgSlug?: string;
  defaultRegion?: string;
}

export interface ResumeBrainInput {
  flyToken: string;
  account: string;
  appNameOverride?: string;
  orgSlug?: string;
  defaultRegion?: string;
}

export interface BrainStatusResult {
  app: string;
  /** "running" | "suspended" | "stopped" | "off" (= no app/machine yet) */
  state: "running" | "suspended" | "stopped" | "off";
  url?: string;
  machineId?: string;
  org?: string;
}

/**
 * Poll `<url>/healthz` until it returns 200, or give up after `timeoutMs`.
 *
 * On a fresh provision the machine returns from the Fly API in ~12s but
 * the Node server inside doesn't bind :8080 until the entrypoint finishes
 * the repo clone (~25-40s) and brain-serve initialises the model proxy
 * (~10-20s).
 * Forwarding the chat request before then yields a Fly-edge 503 ("instance
 * refused connection"). On reuse the server is already running and the
 * first poll returns immediately.
 */
export async function waitForBrainHealth(
  url: string,
  timeoutMs = 120_000,
): Promise<void> {
  const start = Date.now();
  const healthUrl = `${url.replace(/\/+$/, "")}/healthz`;
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(healthUrl, {
        // The Fly edge proxy returns quickly when no instance is listening,
        // so a short per-attempt timeout keeps the polling cadence tight.
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `brain-fly: ${healthUrl} not ready after ${Math.round(timeoutMs / 1000)}s (${detail})`,
  );
}

/**
 * Normalize a GitHub account login into a Fly-app-safe slug. Fly app names
 * must match `^[a-z0-9][a-z0-9-]*$` and are globally unique, so we prefix
 * with `kody-brain-` and lowercase the account. Non-alphanumerics become
 * hyphens; multiple hyphens collapse; leading/trailing hyphens stripped.
 */
export function brainAppName(account: string): string {
  const slug = account
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error("brainAppName: account is empty after slugify");
  }
  return `kody-brain-${slug}`;
}

function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Compare two Fly image refs by repository+tag, ignoring the `@sha256:...`
 * digest Fly appends when it resolves a moving tag like `:latest`. A
 * freshly-created machine reports `ghcr.io/...:latest@sha256:abc`, so a
 * naive string compare against the configured `ghcr.io/...:latest` would
 * never match — and provisionBrain would destroy+recreate the machine on
 * EVERY call (an infinite churn loop). Stripping the digest makes the
 * comparison stable while still catching a genuine ref change (e.g. the
 * `registry.fly.io/...` → `ghcr.io/...` migration).
 */
export function sameImageRepoTag(a: string, b: string): boolean {
  const repoTag = (ref: string): string => {
    const at = ref.indexOf("@");
    return at === -1 ? ref : ref.slice(0, at);
  };
  return repoTag(a) === repoTag(b);
}

function brainAppUrl(app: string): string {
  return `https://${app}.fly.dev`;
}

function brainOrgSlug(input: { orgSlug?: string }): string {
  return input.orgSlug?.trim() || ORGANIZATION;
}

function brainRegion(input: { defaultRegion?: string }): string {
  return input.defaultRegion?.trim() || DEFAULT_REGION;
}

function buildMachineEnv(
  input: ProvisionBrainInput,
  apiKey: string,
): Record<string, string> {
  const env: Record<string, string> = {
    GITHUB_TOKEN: input.githubToken,
    BRAIN_API_KEY: apiKey,
    PORT: "8080",
  };
  // Optional boot repo — omitted for a repo-less Brain.
  if (input.repo) env.REPO = input.repo;
  if (input.model) env.MODEL = input.model;
  if (input.modelConfig)
    env.KODY_MODEL_CONFIG = JSON.stringify(input.modelConfig);
  if (input.ref) env.REF = input.ref;
  if (input.dashboardUrl?.trim()) {
    env.KODY_CMS_DASHBOARD_URL = input.dashboardUrl.trim();
  }
  if (input.allSecrets) env.ALL_SECRETS = JSON.stringify(input.allSecrets);
  const bootHash = bootConfigHash(env);
  if (bootHash) env[BOOT_CONFIG_HASH_ENV] = bootHash;
  return env;
}

function bootConfigHash(env: Record<string, string>): string | undefined {
  const entries = RESTART_SENSITIVE_ENV_KEYS.flatMap((key) =>
    key in env ? [[key, env[key]] as const] : [],
  );
  if (entries.length === 0) return undefined;
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

interface FlyFetchOpts {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  token: string;
  body?: unknown;
  /** Treat 404 as a soft miss (resolves to null). */
  allow404?: boolean;
}

/**
 * Thin Fly Machines API helper. Centralised so all callers share the
 * same auth + error shape.
 */
export async function flyFetch<T>(
  path: string,
  opts: FlyFetchOpts,
): Promise<T | null> {
  const url = `${FLY_API_BASE}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: text.slice(0, 500), path },
      "brain-fly: Fly API error",
    );
    const error = new Error(
      `Fly Machines API ${res.status} on ${path}: ${text.slice(0, 200) || res.statusText}`,
    ) as Error & { status?: number; body?: string; path?: string };
    error.status = res.status;
    error.body = text;
    error.path = path;
    throw error;
  }
  if (res.status === 204) return null;
  // Fly returns 200/202 with an empty body on some mutating calls (e.g.
  // DELETE /apps/{name}). Parsing an empty string as JSON throws — guard
  // by reading text first.
  const raw = await res.text();
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.error(
      { status: res.status, body: raw.slice(0, 500), path },
      "brain-fly: Fly API returned non-JSON body",
    );
    throw new Error(
      `Fly Machines API on ${path}: response was not JSON (status ${res.status})`,
    );
  }
}

interface FlyApp {
  id?: string;
  name: string;
  status?: string;
  organization?: { slug: string };
}

type BrainAutostop = false | "suspend";

interface BrainMachineServiceConfig {
  autostop?: BrainAutostop | true;
  autostart?: boolean;
  min_machines_running?: number;
  [key: string]: unknown;
}

interface BrainMachineConfig {
  image?: string;
  env?: Record<string, string>;
  services?: BrainMachineServiceConfig[];
  [key: string]: unknown;
}

interface FlyMachine {
  id: string;
  state?: string;
  config?: BrainMachineConfig;
  region?: string;
}

/**
 * Ensure the per-user app exists. Idempotent — if it's already there,
 * return it; otherwise create it. Single try: the slug is whatever the
 * caller passed (default `kody-brain-<login>` from `brainAppName`, or
 * a custom name from the UI / storage record). If the slug is taken
 * globally, Fly returns 409/422 and the error propagates verbatim —
 * the user picks a different name in the UI. No auto-rename, no
 * multi-org iteration, no retry loop.
 */
async function ensureApp(
  flyToken: string,
  appName: string,
  orgSlug: string,
): Promise<FlyApp> {
  // Probe: does the app already exist? 404 and 403 (orphan: another
  // account owns the slug) both mean "create it". Anything else (real
  // auth failure, etc.) is fatal.
  let existing: FlyApp | null = null;
  try {
    existing = await flyFetch<FlyApp>(`/apps/${encodeURIComponent(appName)}`, {
      token: flyToken,
      allow404: true,
    });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 403) throw err;
  }
  if (existing) {
    const name = existing.name ?? appName;
    await allocateIpsIfMissing(flyToken, name);
    return { ...existing, name };
  }

  // Create. The POST /apps response omits the name field — track it
  // locally so callers (and IP allocation) can use it. If Fly rejects
  // (409/422 = name taken, 403 = no write scope, etc.), the error
  // surfaces verbatim for the user to act on.
  const created = await flyFetch<FlyApp>("/apps", {
    method: "POST",
    token: flyToken,
    body: { app_name: appName, org_slug: orgSlug },
  });
  if (!created) {
    throw new Error("brain-fly: create app returned empty");
  }
  const name = created.name ?? appName;
  await allocateIpsIfMissing(flyToken, name);
  return { ...created, name };
}

/**
 * List the Fly orgs the given token can see. Used by the Runner page to
 * surface a "your token is scoped to X, dashboard is creating under Y"
 * warning when the two don't match — the root cause of the 403 a user
 * hits when their app lives in an org their token can't reach. Returns
 * the org slugs only; other fields (name, type) are intentionally
 * dropped to keep the response shape minimal.
 *
 * Note: the Machines REST API (`api.machines.dev/v1`) does NOT expose an
 * orgs endpoint — `/orgs` returns 404 there. Orgs live on Fly's GraphQL
 * API (`api.fly.io/graphql`), same surface the existing
 * `allocateIpsIfMissing` already calls.
 */

/**

 * Allocate a shared v4 + dedicated v6 IP for the app if it doesn't have
 * any yet. The Machines REST API does NOT auto-allocate IPs on
 * `POST /apps`, so without this the app's *.fly.dev DNS resolves to
 * nothing and HTTPS requests fail with NXDOMAIN. IP allocation lives on
 * Fly's GraphQL API rather than Machines REST.
 *
 * Fly's GraphQL `allocateIpAddress` mutation expects the app's
 * **name** (slug) in `appId`, not the UUID the REST API returns as
 * `id`. Passing the UUID gives `Could not find App`. There's also a
 * small propagation delay after `POST /apps` before the new app is
 * visible to the GraphQL API — we retry briefly on the two error
 * shapes Fly uses for the not-yet-visible state.
 */
export async function allocateIpsIfMissing(
  flyToken: string,
  appName: string,
): Promise<void> {
  // Cheap probe — Machines API exposes /ips on the app. If it returns
  // anything, leave it alone.
  const readIps = () =>
    flyFetch<unknown[]>(`/apps/${encodeURIComponent(appName)}/ips`, {
      token: flyToken,
      allow404: true,
    });
  const hasAnyIp = (ips: unknown[] | null): ips is unknown[] =>
    Array.isArray(ips) && ips.length > 0;

  const existing = await readIps();
  if (hasAnyIp(existing)) return;

  const query = `mutation($appId: ID!, $type: IPAddressType!) {
    allocateIpAddress(input: { appId: $appId, type: $type }) {
      ipAddress { id address type }
    }
  }`;

  const allocate = async (
    type: "shared_v4" | "v6",
    opts: { continueOnTransientWithUsableIp?: boolean } = {},
  ): Promise<boolean> => {
    // POST /apps returns immediately but the new app takes a moment to
    // show up in the GraphQL index. Fly expresses the not-yet-visible
    // state as one of two error shapes:
    //   - `Could not find App` with code NOT_FOUND
    //   - `Variable $appId of type ID! was provided invalid value` (the
    //     ID type-validator rejects the value before the lookup runs)
    // Fly also sometimes returns transient GraphQL 5xx / SERVER_ERROR for
    // IP allocation. Those are control-plane failures, not a user
    // misconfiguration. Retry them, and if an earlier allocation already
    // produced a usable public IP, let provisioning continue.
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch("https://api.fly.io/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${flyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { appId: appName, type },
        }),
      });
      const raw = await res.text().catch(() => "");
      let body: {
        errors?: Array<{ message: string; extensions?: { code?: string } }>;
      } = {};
      try {
        body = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      const errors = body.errors ?? [];
      if (errors.length === 0) {
        if (res.ok) return true; // success (or no-op — `ipAddress: null` is valid)
      }
      const statusTransient =
        res.status === 500 ||
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504;
      const transient =
        statusTransient ||
        errors.some(
          (e) =>
            e.extensions?.code === "NOT_FOUND" ||
            e.extensions?.code === "SERVER_ERROR" ||
            /could not find app/i.test(e.message),
        ) ||
        errors.some((e) =>
          /variable \$appId of type id! was provided invalid/i.test(e.message),
        );
      if (!transient) {
        throw new Error(
          errors[0]?.message
            ? `brain-fly: allocate IP (${type}) graphql error: ${errors[0].message}`
            : `brain-fly: allocate IP (${type}) failed ${res.status}: ${raw.slice(0, 200)}`,
        );
      }

      const detail =
        errors[0]?.message ??
        `Fly GraphQL status ${res.status}: ${raw.slice(0, 200)}`;
      lastErr = new Error(detail);
      const afterPartial = await readIps();
      if (hasAnyIp(afterPartial) || opts.continueOnTransientWithUsableIp) {
        logger.warn(
          {
            app: appName,
            type,
            attempt: attempt + 1,
            err: detail,
            observedIp: hasAnyIp(afterPartial),
            priorAllocationSucceeded:
              opts.continueOnTransientWithUsableIp === true,
          },
          "brain-fly: continuing after transient IP allocation error because a usable IP was already reconciled",
        );
        return false;
      }
      const delay = IP_ALLOC_RETRY_DELAYS_MS[attempt] ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    throw new BrainFlyProvisionTransientError(
      `brain-fly: allocate IP (${type}) — app ${appName} not visible to GraphQL after 5 attempts: ${
        lastErr?.message ?? "unknown"
      }`,
    );
  };

  const sharedV4 = await allocate("shared_v4");
  const v6 = await allocate("v6", {
    continueOnTransientWithUsableIp: sharedV4,
  });
  logger.info(
    { app: appName, sharedV4, v6 },
    "brain-fly: IP allocation reconciled",
  );
}

async function findExistingMachine(
  flyToken: string,
  appName: string,
): Promise<FlyMachine | null> {
  const list = await flyFetch<FlyMachine[]>(
    `/apps/${encodeURIComponent(appName)}/machines`,
    { token: flyToken, allow404: true },
  );
  if (!list || list.length === 0) return null;
  // Prefer non-destroyed machines.
  const live = list.find(
    (m) => m.state !== "destroyed" && m.state !== "destroying",
  );
  return live ?? null;
}

/**
 * Destroy a single machine (not the whole app). `force=true` skips the
 * graceful drain and works on suspended/stopped machines. Used to replace
 * a machine that's pinned to a stale image ref. Soft-ignores a 404 so a
 * concurrent teardown doesn't throw.
 */
async function destroyMachine(
  flyToken: string,
  appName: string,
  machineId: string,
): Promise<void> {
  await flyFetch<unknown>(
    `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(
      machineId,
    )}?force=true`,
    { method: "DELETE", token: flyToken, allow404: true },
  );
}

function brainAutostop(input: ProvisionBrainInput): BrainAutostop {
  return input.suspendOnIdle === false ? false : "suspend";
}

function isBrainMachineRunning(machine: FlyMachine): boolean {
  return (
    machine.state === "started" ||
    machine.state === "starting" ||
    machine.state === "created" ||
    machine.state === "replacing"
  );
}

function brainImageRef(input: ProvisionBrainInput): string {
  return input.imageRef?.trim() || DEFAULT_IMAGE;
}

function alignBrainSuspensionConfig(
  config: BrainMachineConfig | undefined,
  input: ProvisionBrainInput,
): { changed: boolean; config?: BrainMachineConfig } {
  if (!config?.services?.length) return { changed: false };
  const targetAutostop = brainAutostop(input);
  let changed = false;
  const services = config.services.map((service) => {
    const next = { ...service };
    if (next.autostop !== targetAutostop) {
      next.autostop = targetAutostop;
      changed = true;
    }
    if (next.autostart !== true) {
      next.autostart = true;
      changed = true;
    }
    if (next.min_machines_running !== 0) {
      next.min_machines_running = 0;
      changed = true;
    }
    return next;
  });
  return changed ? { changed, config: { ...config, services } } : { changed };
}

function alignBrainEnvConfig(
  config: BrainMachineConfig | undefined,
  input: ProvisionBrainInput,
): { changed: boolean; config?: BrainMachineConfig } {
  if (!config) return { changed: false };
  const env = { ...(config.env ?? {}) };
  let changed = false;
  const setOrDelete = (key: string, value: string | undefined) => {
    if (value === undefined) {
      if (key in env) {
        delete env[key];
        changed = true;
      }
      return;
    }
    if (env[key] !== value) {
      env[key] = value;
      changed = true;
    }
  };

  setOrDelete("MODEL", input.model?.trim() || undefined);
  setOrDelete(
    "KODY_MODEL_CONFIG",
    input.modelConfig ? JSON.stringify(input.modelConfig) : undefined,
  );
  setOrDelete(
    "KODY_CMS_DASHBOARD_URL",
    input.dashboardUrl?.trim() || undefined,
  );

  return changed ? { changed: true, config: { ...config, env } } : { changed };
}

function restartSensitiveEnvChanges(
  env: Record<string, string> | undefined,
  input: ProvisionBrainInput,
  apiKey: string,
): string[] {
  const existing = env ?? {};
  const expected = buildMachineEnv(input, apiKey);
  const changed: string[] = [];

  for (const key of RESTART_SENSITIVE_ENV_KEYS) {
    const next = expected[key];
    if (next === undefined) {
      if (key in existing) changed.push(key);
      continue;
    }
    if (existing[key] !== next) changed.push(key);
  }
  if (existing[BOOT_CONFIG_HASH_ENV] !== expected[BOOT_CONFIG_HASH_ENV]) {
    changed.push(BOOT_CONFIG_HASH_ENV);
  }

  return changed;
}

function alignBrainMachineConfig(
  config: BrainMachineConfig | undefined,
  input: ProvisionBrainInput,
): { changed: boolean; config?: BrainMachineConfig } {
  let next = config;
  let changed = false;

  const suspension = alignBrainSuspensionConfig(next, input);
  if (suspension.changed && suspension.config) {
    next = suspension.config;
    changed = true;
  }

  const env = alignBrainEnvConfig(next, input);
  if (env.changed && env.config) {
    next = env.config;
    changed = true;
  }

  return changed && next ? { changed: true, config: next } : { changed: false };
}

async function updateMachineConfig(
  flyToken: string,
  appName: string,
  machineId: string,
  config: BrainMachineConfig,
): Promise<void> {
  await flyFetch<FlyMachine>(
    `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(
      machineId,
    )}`,
    { method: "POST", token: flyToken, body: { config } },
  );
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
  const tier: PerfTier = input.perfTier ?? DEFAULT_PERF_TIER;
  const guest = PERF_GUEST[tier];
  const region = brainRegion(input);
  const image = brainImageRef(input);

  const body = {
    name: `brain-${region}`,
    region,
    config: {
      image,
      env: buildMachineEnv(input, apiKey),
      auto_destroy: false,
      restart: { policy: "on-failure", max_retries: 3 },
      guest,
      services: [
        {
          // force_https belongs on the plain-HTTP port (it redirects to
          // 443); Fly rejects it on a TLS-handled port. The :443 listener
          // does both TLS termination and HTTP/2 upgrade.
          ports: [
            { port: 443, handlers: ["tls", "http"] },
            { port: 80, handlers: ["http"], force_https: true },
          ],
          protocol: "tcp",
          internal_port: 8080,
          autostop: brainAutostop(input),
          autostart: true,
          min_machines_running: 0,
          concurrency: { type: "requests", soft_limit: 50, hard_limit: 100 },
        },
      ],
      checks: {
        healthz: {
          type: "http",
          port: 8080,
          method: "GET",
          path: "/healthz",
          interval: "15s",
          // The first chat message clones the repo (a big checkout can pin
          // the machine for ~40s) right after boot. A short grace/timeout
          // made /healthz miss during that window, so Fly marked the machine
          // unhealthy and DROPPED the in-flight chat connection — the user
          // saw an error instead of just waiting for the reply. Give boot +
          // first-clone a wide grace and a generous per-check timeout so the
          // single chat connection survives the warm-up and streams the
          // reply once it's ready.
          timeout: "10s",
          grace_period: "120s",
        },
      },
    },
  };

  const created = await flyFetch<FlyMachine>(
    `/apps/${encodeURIComponent(appName)}/machines`,
    { method: "POST", token: flyToken, body },
  );
  if (!created) throw new Error("brain-fly: create machine returned empty");
  return created;
}

/**
 * Provision a Brain for the given user. Idempotent at the app level
 * (re-uses an existing kody-brain-<account> app) but NOT at the machine
 * level — if a machine already exists, we leave it and reuse it rather
 * than minting a fresh API key. The caller should `destroy` first when
 * they want to rotate.
 */
export async function provisionBrain(
  input: ProvisionBrainInput,
): Promise<ProvisionBrainResult> {
  if (!input.flyToken?.trim()) {
    throw new Error(
      "brain-fly: flyToken required (set FLY_API_TOKEN in the repo secrets vault)",
    );
  }
  const requested = input.appNameOverride ?? brainAppName(input.account);
  const orgSlug = brainOrgSlug(input);
  const defaultRegion = brainRegion(input);
  const flyApp = await ensureApp(input.flyToken, requested, orgSlug);
  const app = flyApp.name;
  const url = brainAppUrl(app);
  const originalName = app !== requested ? requested : undefined;
  const requestedImage = brainImageRef(input);
  const image = input.resolveRuntimeImageRef
    ? await input.resolveRuntimeImageRef({ app, imageRef: requestedImage })
    : requestedImage;
  const machineInput =
    image === requestedImage ? input : { ...input, imageRef: image };
  const prepareRuntimeImage = () =>
    input.prepareRuntimeImage?.({
      app,
      sourceImageRef: requestedImage,
      runtimeImageRef: image,
    });

  const existing = await findExistingMachine(input.flyToken, app);
  if (existing) {
    const existingImage = existing.config?.image ?? "";
    // Heal machines pinned to a stale image ref. A machine created before
    // an image-ref change (the `registry.fly.io/...` → public
    // `ghcr.io/...` migration) is frozen on the old, now-unreachable ref
    // and never boots — chat against it 500s forever because reuse keeps
    // serving the dead machine. Recreate it on the current image instead.
    // We preserve its BRAIN_API_KEY so any key the dashboard already
    // handed a caller stays valid. Guard on `existingImage` being set so a
    // machine that doesn't report an image falls through to plain reuse.
    if (existingImage && !sameImageRepoTag(existingImage, image)) {
      logger.info(
        {
          app,
          machineId: existing.id,
          from: existingImage,
          to: image,
        },
        "brain-fly: recreating machine — image ref changed",
      );
      await destroyMachine(input.flyToken, app, existing.id);
      const apiKey =
        existing.config?.env?.BRAIN_API_KEY ||
        input.apiKeyOverride ||
        generateApiKey();
      await prepareRuntimeImage();
      const machine = await createMachine(
        input.flyToken,
        app,
        machineInput,
        apiKey,
      );
      return {
        app,
        url,
        apiKey,
        machineId: machine.id,
        region: machine.region ?? defaultRegion,
        org: flyApp.organization?.slug ?? orgSlug,
        ...(originalName ? { originalName } : {}),
      };
    }

    const existingKey = existing.config?.env?.BRAIN_API_KEY ?? "";
    if (!existingKey) {
      throw new Error(
        `brain-fly: app ${app} has a machine without BRAIN_API_KEY env — destroy first, then re-provision`,
      );
    }
    const envChanges = restartSensitiveEnvChanges(
      existing.config?.env,
      machineInput,
      existingKey,
    );
    if (envChanges.length > 0) {
      logger.info(
        {
          app,
          machineId: existing.id,
          keys: envChanges,
        },
        "brain-fly: recreating machine — boot env changed",
      );
      await destroyMachine(input.flyToken, app, existing.id);
      const machine = await createMachine(
        input.flyToken,
        app,
        machineInput,
        existingKey,
      );
      return {
        app,
        url,
        apiKey: existingKey,
        machineId: machine.id,
        region: machine.region ?? defaultRegion,
        org: flyApp.organization?.slug ?? orgSlug,
        ...(originalName ? { originalName } : {}),
      };
    }
    const alignedConfig = alignBrainMachineConfig(
      existing.config,
      machineInput,
    );
    if (alignedConfig.changed && alignedConfig.config) {
      await updateMachineConfig(
        input.flyToken,
        app,
        existing.id,
        alignedConfig.config,
      );
      logger.info(
        {
          app,
          machineId: existing.id,
          autostop: brainAutostop(input),
        },
        "brain-fly: updated machine config",
      );
    }
    if (
      machineInput.suspendOnIdle === false &&
      !isBrainMachineRunning(existing)
    ) {
      await waitForBrainHealth(url, 60_000);
      logger.info(
        {
          app,
          machineId: existing.id,
        },
        "brain-fly: woke reused machine after disabling suspension",
      );
    }
    logger.info(
      { app, machineId: existing.id },
      "brain-fly: reusing existing machine",
    );
    return {
      app,
      url,
      apiKey: existingKey,
      machineId: existing.id,
      region: existing.region ?? defaultRegion,
      org: flyApp.organization?.slug ?? orgSlug,
      ...(originalName ? { originalName } : {}),
    };
  }

  const apiKey = input.apiKeyOverride ?? generateApiKey();
  await prepareRuntimeImage();
  const machine = await createMachine(
    input.flyToken,
    app,
    machineInput,
    apiKey,
  );

  logger.info(
    { app, machineId: machine.id, region: machine.region ?? defaultRegion },
    "brain-fly: machine provisioned",
  );

  return {
    app,
    url,
    apiKey,
    machineId: machine.id,
    region: machine.region ?? defaultRegion,
    org: flyApp.organization?.slug ?? orgSlug,
    ...(originalName ? { originalName } : {}),
  };
}

/**
 * Destroy the per-user Brain. Removes the machine(s) and the app. Safe
 * to call when nothing exists (returns silently).
 */
export async function destroyBrain(input: DestroyBrainInput): Promise<void> {
  if (!input.flyToken?.trim()) {
    throw new Error("brain-fly: flyToken required");
  }
  const app = input.appNameOverride ?? brainAppName(input.account);

  const existing = await flyFetch<FlyApp>(`/apps/${encodeURIComponent(app)}`, {
    token: input.flyToken,
    allow404: true,
  });
  if (!existing) {
    logger.info({ app }, "brain-fly: destroy — app already absent");
    return;
  }

  // Deleting the app removes all machines under it. Pass `force=true` to
  // skip the "drain in-flight requests" wait — brain machines don't carry
  // critical state beyond the session JSONLs on the volume.
  await flyFetch<unknown>(`/apps/${encodeURIComponent(app)}?force=true`, {
    method: "DELETE",
    token: input.flyToken,
    allow404: true,
  });
  logger.info({ app }, "brain-fly: app destroyed");
}

/**
 * Suspend the per-user Brain machine. Snapshot-pauses it (instant, near-zero
 * cost, ~1s resume). No-op if no app/machine exists or it's already suspended.
 *
 * Mirrors the autostop behaviour Fly does on idle, but user-initiated — for
 * when someone wants to guarantee no compute is running right now.
 */
export async function suspendBrain(input: SuspendBrainInput): Promise<void> {
  if (!input.flyToken?.trim()) {
    throw new Error("brain-fly: flyToken required");
  }
  const app = input.appNameOverride ?? brainAppName(input.account);

  const machine = await findExistingMachine(input.flyToken, app);
  if (!machine) {
    logger.info({ app }, "brain-fly: suspend — no machine to suspend");
    return;
  }
  if (machine.state === "suspended" || machine.state === "suspending") {
    logger.info({ app, machineId: machine.id }, "brain-fly: already suspended");
    return;
  }

  await flyFetch<unknown>(
    `/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machine.id)}/suspend`,
    { method: "POST", token: input.flyToken },
  );
  logger.info({ app, machineId: machine.id }, "brain-fly: machine suspended");
}

/**
 * Resume (wake) the per-user Brain machine.
 *
 * Implementation: hit the machine through Fly's edge proxy (`/healthz`) and
 * let `autostart: true` on the service definition restore it. This is the
 * Fly-documented pattern and works for BOTH `suspended` and `stopped`
 * machines.
 *
 * We avoid `POST /machines/{id}/start` because Fly returns
 * `500 internal: process not found` against suspended machines whose snapshot
 * metadata hasn't fully synced yet — the edge-proxy path doesn't have that
 * race. waitForBrainHealth polls until `/healthz` returns 200.
 */
export async function resumeBrain(input: ResumeBrainInput): Promise<void> {
  if (!input.flyToken?.trim()) {
    throw new Error("brain-fly: flyToken required");
  }
  const app = input.appNameOverride ?? brainAppName(input.account);

  const machine = await findExistingMachine(input.flyToken, app);
  if (!machine) {
    logger.info({ app }, "brain-fly: resume — no machine to resume");
    return;
  }
  if (machine.state === "started" || machine.state === "starting") {
    logger.info({ app, machineId: machine.id }, "brain-fly: already running");
    return;
  }

  await waitForBrainHealth(brainAppUrl(app), 60_000);
  logger.info(
    { app, machineId: machine.id },
    "brain-fly: machine resumed via edge proxy",
  );
}

/**
 * Read the current state of the per-user Brain. Returns `state: 'off'`
 * when no app exists yet (provision has never run for this user).
 */
export async function brainStatus(
  input: BrainStatusInput,
): Promise<BrainStatusResult> {
  if (!input.flyToken?.trim()) {
    throw new Error("brain-fly: flyToken required");
  }
  const app = input.appNameOverride ?? brainAppName(input.account);
  const orgSlug = brainOrgSlug(input);

  const existing = await flyFetch<FlyApp>(`/apps/${encodeURIComponent(app)}`, {
    token: input.flyToken,
    allow404: true,
  });
  if (!existing) {
    return { app, state: "off", org: orgSlug };
  }

  const machine = await findExistingMachine(input.flyToken, app);
  if (!machine) {
    return {
      app,
      state: "off",
      url: brainAppUrl(app),
      org: existing.organization?.slug ?? orgSlug,
    };
  }

  // Fly machine states we care about: started/starting/created/replacing
  // are all "the machine is or is about to be live" → running. Suspended
  // is its own bucket (idle, resumes on next request). Everything else
  // (stopped, stopping, destroying) renders as stopped.
  const state: BrainStatusResult["state"] =
    machine.state === "started" ||
    machine.state === "starting" ||
    machine.state === "created" ||
    machine.state === "replacing"
      ? "running"
      : machine.state === "suspended" || machine.state === "suspending"
        ? "suspended"
        : "stopped";

  return {
    app,
    state,
    url: brainAppUrl(app),
    machineId: machine.id,
    org: existing.organization?.slug ?? orgSlug,
  };
}
