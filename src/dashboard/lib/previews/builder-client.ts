/**
 * @fileType library
 * @domain previews
 * @pattern fly-machine-spawn
 * @ai-summary Single fast Fly API call that spawns the per-PR builder
 *   machine and returns its ID + expected URL. The builder does every
 *   subsequent step (clone, build, image push, app create, IP alloc,
 *   preview machine boot) on its own and exits — the dashboard never
 *   polls it. Trap: the returned URL is NOT reachable yet; it is the
 *   deterministic destination the builder will boot once it finishes
 *   (~2-5 min), not a live link. Status callers must re-query Fly.
 *
 * Spawns the per-PR builder Fly Machine and returns immediately.
 *
 * The builder machine handles the ENTIRE preview lifecycle on its
 * own — clone, build, push image, create per-PR app, allocate IPs,
 * boot preview machine, exit. The dashboard never polls it.
 *
 * Result: a single fast Vercel→Fly call (~1s) per webhook fire. No
 * long-running serverless function, no cross-cloud TLS in the hot
 * path. The dashboard checks Fly state on demand via the existing
 * status endpoint (deterministic app name → query Fly Machines API).
 */

import { createHash } from "node:crypto";

import { logger } from "@dashboard/lib/logger";
import { derivePreviewKey } from "@dashboard/lib/preview-token";

const FLY_MACHINES_BASE = "https://api.machines.dev/v1";
const BUILDER_IMAGE =
  process.env.KODY_PREVIEW_BUILDER_IMAGE ??
  "registry.fly.io/kody-preview-builder:latest";
const BUILDER_HOST_APP =
  process.env.KODY_PREVIEW_BUILDER_HOST_APP ?? "kody-preview-builder";

const SPAWN_TIMEOUT_MS = 30_000;
const BUILDER_MAINTENANCE_TIMEOUT_MS = 10_000;
const BUILDER_STALE_MS = 2 * 60 * 60 * 1000;
const BUILDER_START_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_BUILDER_CPUS = 4;
const DEFAULT_BUILDER_MEMORY_MB = 4096;

interface BuilderMachineInfo {
  id?: string;
  state?: string;
  created_at?: string;
  config?: {
    env?: Record<string, string>;
  };
}

export interface SpawnBuilderInput {
  repo: string;
  /** PR number for per-PR builds. Omit for base-image rebuilds. */
  pr?: number;
  /** Branch name for manual branch previews. Omit for PR/base-image builds. */
  branch?: string;
  ref: string;
  /** Per-PR Fly app name (same naming the builder will recreate inside).
   *  For base-image rebuilds, pass the `-base` app name from
   *  `basePreviewAppName(repo)`; the builder detects the suffix. */
  appName: string;
  imageTag?: string;
  flyToken: string;
  flyOrgSlug: string;
  flyRegion: string;
  githubToken?: string;
  /** Build-time secrets baked into the image as .env.production.local. */
  buildEnv?: Record<string, string>;
  /** "dev" or "prod" — picks bundled Dockerfile.preview variant. */
  buildMode?: "dev" | "prod";
  /** Per-PR preview machine sizing + lifecycle knobs, resolved from the
   * repo's kody.config.json (`fly.previews`). Passed to the builder as env so
   * the machine it boots uses these instead of the builder's hardcoded
   * fallback. Omit any field to let the builder apply its own default. */
  previewVmCpus?: number;
  previewVmMemoryMb?: number;
  previewIdleSuspend?: boolean;
  previewHealthCheck?: boolean;
  /** Temporary machine that runs clone + flyctl orchestration. */
  builderCpus?: number;
  builderMemoryMb?: number;
}

export interface SpawnBuilderResult {
  machineId: string;
  /** Deterministic public URL — the builder will boot a machine here once
   *  it finishes. Not yet reachable when this function returns. */
  expectedUrl: string;
}

export interface PreviewBuilderStatus {
  state: "building" | "failed";
  machineId?: string;
  machineState?: string;
  createdAt?: string;
}

function defaultTagFor(repo: string, ref: string): string {
  return createHash("sha256")
    .update(`${repo}@${ref}`)
    .digest("hex")
    .slice(0, 12);
}

function builderAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function builderMachinesUrl(machineId?: string): string {
  const base = `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(BUILDER_HOST_APP)}/machines`;
  return machineId
    ? `${base}/${encodeURIComponent(machineId)}?force=true`
    : base;
}

function isDestroyableBuilderState(state?: string): boolean {
  return state !== "destroyed" && state !== "destroying";
}

function isStaleBuilder(machine: BuilderMachineInfo, now: number): boolean {
  const age = builderAgeMs(machine, now);
  return age !== null && age > BUILDER_STALE_MS;
}

function builderAgeMs(
  machine: BuilderMachineInfo,
  now: number,
): number | null {
  if (!machine.created_at) return null;
  const created = Date.parse(machine.created_at);
  return Number.isFinite(created) ? now - created : null;
}

function shouldDestroyBuilder(
  machine: BuilderMachineInfo,
  targetAppName: string,
  now: number,
): boolean {
  if (!machine.id || !isDestroyableBuilderState(machine.state)) return false;
  const samePreview = machine.config?.env?.APP_NAME === targetAppName;
  return samePreview
    ? !isReusableBuilder(machine, now)
    : isStaleBuilder(machine, now);
}

function isRunnableBuilderState(state?: string): boolean {
  return state === "started" || state === "starting";
}

function isFreshCreatedBuilder(
  machine: BuilderMachineInfo,
  now: number,
): boolean {
  if (machine.state !== "created") return false;
  const age = builderAgeMs(machine, now);
  return age !== null && age <= BUILDER_START_GRACE_MS;
}

function isReusableBuilder(machine: BuilderMachineInfo, now: number): boolean {
  return (
    Boolean(machine.id) &&
    (isRunnableBuilderState(machine.state) ||
      isFreshCreatedBuilder(machine, now))
  );
}

function reusableFirst(
  now: number,
): (a: BuilderMachineInfo, b: BuilderMachineInfo) => number {
  return (a, b) => {
    const aRank = isRunnableBuilderState(a.state) ? 0 : 1;
    const bRank = isRunnableBuilderState(b.state) ? 0 : 1;
    return aRank - bRank || newestFirst(a, b);
  };
}

function newestFirst(a: BuilderMachineInfo, b: BuilderMachineInfo): number {
  const aTime = a.created_at ? Date.parse(a.created_at) : 0;
  const bTime = b.created_at ? Date.parse(b.created_at) : 0;
  return bTime - aTime;
}

export async function getPreviewBuilderStatus(
  appName: string,
  token: string,
): Promise<PreviewBuilderStatus | null> {
  try {
    const res = await fetch(builderMachinesUrl(), {
      method: "GET",
      headers: builderAuthHeaders(token),
      signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const machines = ((await res.json()) as BuilderMachineInfo[])
      .filter((m) => m.config?.env?.APP_NAME === appName)
      .sort(newestFirst);
    const latest = machines[0];
    if (!latest) return null;
    const now = Date.now();

    return {
      state: isReusableBuilder(latest, now) ? "building" : "failed",
      machineId: latest.id,
      machineState: latest.state,
      createdAt: latest.created_at,
    };
  } catch (err) {
    logger.warn({ err, appName }, "previews.builder: status lookup failed");
    return null;
  }
}

async function destroyBuilderMachine(
  machineId: string,
  token: string,
): Promise<void> {
  const res = await fetch(builderMachinesUrl(machineId), {
    method: "DELETE",
    headers: builderAuthHeaders(token),
    signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `destroy builder ${machineId} failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
}

async function pruneBuilderMachines(
  token: string,
  targetAppName: string,
): Promise<BuilderMachineInfo | null> {
  try {
    const res = await fetch(builderMachinesUrl(), {
      method: "GET",
      headers: builderAuthHeaders(token),
      signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const machines = (await res.json()) as BuilderMachineInfo[];
    const now = Date.now();
    const reusable =
      machines
        .filter(
          (m) =>
            m.id &&
            m.config?.env?.APP_NAME === targetAppName &&
            isReusableBuilder(m, now),
        )
        .sort(reusableFirst(now))[0] ?? null;
    const doomed = machines.filter((m) => {
      if (reusable?.id === m.id) return false;
      return shouldDestroyBuilder(m, targetAppName, now);
    });
    await Promise.all(
      doomed.map((m) =>
        destroyBuilderMachine(m.id!, token).catch((err) =>
          logger.warn(
            { err, machineId: m.id, targetAppName },
            "previews.builder: stale builder destroy failed",
          ),
        ),
      ),
    );
    return reusable;
  } catch (err) {
    logger.warn(
      { err, targetAppName },
      "previews.builder: stale builder scan failed",
    );
    return null;
  }
}

export async function spawnPreviewBuilder(
  input: SpawnBuilderInput,
): Promise<SpawnBuilderResult> {
  const tag = input.imageTag ?? defaultTagFor(input.repo, input.ref);
  const expectedUrl = `https://${input.appName}.fly.dev`;
  const existing = await pruneBuilderMachines(input.flyToken, input.appName);
  if (existing?.id) {
    logger.info(
      {
        repo: input.repo,
        pr: input.pr,
        ref: input.ref,
        machineId: existing.id,
      },
      "previews.builder: active builder already running; reusing",
    );
    return {
      machineId: existing.id,
      expectedUrl,
    };
  }

  const body = {
    config: {
      image: BUILDER_IMAGE,
      env: {
        REPO: input.repo,
        REF: input.ref,
        APP_NAME: input.appName,
        IMAGE_TAG: tag,
        FLY_API_TOKEN: input.flyToken,
        FLY_ORG_SLUG: input.flyOrgSlug,
        FLY_REGION: input.flyRegion,
        // Derived preview-verify key — HKDF of KODY_MASTER_KEY with info
        // "kody-preview:v1". The raw master key never leaves the dashboard.
        // The builder threads this to the preview machine as a runtime env,
        // where the doorman reads it to verify access tickets.
        KODY_PREVIEW_VERIFY_KEY: derivePreviewKey().toString("hex"),
        // Machine identity — repo and pr are passed so the doorman can bind
        // tickets to this specific machine and reject tickets meant for a
        // different repo/pr/branch even if they present a valid HMAC.
        KODY_REPO_CONTEXT: input.repo,
        ...("pr" in input ? { KODY_PR: String(input.pr) } : {}),
        ...("branch" in input ? { KODY_BRANCH: input.branch } : {}),
        ...(input.githubToken ? { GITHUB_TOKEN: input.githubToken } : {}),
        // When set, the builder posts (or updates) one idempotent
        // comment on the PR with the preview URL. Omitted on base
        // rebuilds — there's no PR to comment on.
        ...(typeof input.pr === "number"
          ? { PR_NUMBER: String(input.pr) }
          : {}),
        // When set, the builder probes GHCR for a per-repo base image
        // (kp-<hash>-base:latest) and inherits from it via Docker FROM.
        // Drops a typical PR build from ~13 min cold to ~3 min.
        ...(process.env.KODY_PREVIEW_GHCR_OWNER
          ? { MIRROR_TO_GHCR_OWNER: process.env.KODY_PREVIEW_GHCR_OWNER }
          : {}),
        ...(input.buildMode ? { PREVIEW_BUILD_MODE: input.buildMode } : {}),
        // Preview machine knobs (from kody.config.json fly.previews). The
        // builder reads these to size + configure the machine it boots,
        // instead of its own hardcoded fallback.
        ...(typeof input.previewVmCpus === "number"
          ? { PREVIEW_VM_CPUS: String(input.previewVmCpus) }
          : {}),
        ...(typeof input.previewVmMemoryMb === "number"
          ? { PREVIEW_VM_MEMORY_MB: String(input.previewVmMemoryMb) }
          : {}),
        ...(typeof input.previewIdleSuspend === "boolean"
          ? { PREVIEW_IDLE_SUSPEND: input.previewIdleSuspend ? "1" : "0" }
          : {}),
        ...(typeof input.previewHealthCheck === "boolean"
          ? { PREVIEW_HEALTHCHECK: input.previewHealthCheck ? "1" : "0" }
          : {}),
        // Build env passed as a single JSON blob so name collisions
        // with builder control vars are impossible.
        ...(input.buildEnv && Object.keys(input.buildEnv).length > 0
          ? { BUILD_ENV_JSON: JSON.stringify(input.buildEnv) }
          : {}),
      },
      auto_destroy: true,
      restart: { policy: "no" },
      // This machine orchestrates clone/install/flyctl work. Docker still
      // runs on Fly's remote builder, but large repos need more room here.
      guest: {
        cpu_kind: "shared",
        cpus: input.builderCpus ?? DEFAULT_BUILDER_CPUS,
        memory_mb: input.builderMemoryMb ?? DEFAULT_BUILDER_MEMORY_MB,
      },
    },
    region: input.flyRegion,
  };

  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(BUILDER_HOST_APP)}/machines`,
    {
      method: "POST",
      headers: builderAuthHeaders(input.flyToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SPAWN_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `builder machine spawn failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`,
    );
  }
  const created = (await res.json()) as { id: string };

  logger.info(
    { repo: input.repo, pr: input.pr, ref: input.ref, machineId: created.id },
    "previews.builder: machine spawned (fire-and-forget)",
  );

  return {
    machineId: created.id,
    expectedUrl,
  };
}
