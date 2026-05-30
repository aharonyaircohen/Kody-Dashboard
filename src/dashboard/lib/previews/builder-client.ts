/**
 * @fileType library
 * @domain previews
 * @pattern fly-machine-spawn
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

const FLY_MACHINES_BASE = "https://api.machines.dev/v1";
const BUILDER_IMAGE =
  process.env.KODY_PREVIEW_BUILDER_IMAGE ??
  "registry.fly.io/kody-preview-builder:latest";
const BUILDER_HOST_APP =
  process.env.KODY_PREVIEW_BUILDER_HOST_APP ?? "kody-preview-builder";

const SPAWN_TIMEOUT_MS = 30_000;

export interface SpawnBuilderInput {
  repo: string;
  /** PR number for per-PR builds. Omit for base-image rebuilds. */
  pr?: number;
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
}

export interface SpawnBuilderResult {
  machineId: string;
  /** Deterministic public URL — the builder will boot a machine here once
   *  it finishes. Not yet reachable when this function returns. */
  expectedUrl: string;
}

function defaultTagFor(repo: string, ref: string): string {
  return createHash("sha256")
    .update(`${repo}@${ref}`)
    .digest("hex")
    .slice(0, 12);
}

export async function spawnPreviewBuilder(
  input: SpawnBuilderInput,
): Promise<SpawnBuilderResult> {
  const tag = input.imageTag ?? defaultTagFor(input.repo, input.ref);
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
        ...(input.githubToken ? { GITHUB_TOKEN: input.githubToken } : {}),
        // When set, the builder probes GHCR for a per-repo base image
        // (kp-<hash>-base:latest) and inherits from it via Docker FROM.
        // Drops a typical PR build from ~13 min cold to ~3 min.
        ...(process.env.KODY_PREVIEW_GHCR_OWNER
          ? { MIRROR_TO_GHCR_OWNER: process.env.KODY_PREVIEW_GHCR_OWNER }
          : {}),
        ...(input.buildMode
          ? { PREVIEW_BUILD_MODE: input.buildMode }
          : {}),
        // Build env passed as a single JSON blob so name collisions
        // with builder control vars are impossible.
        ...(input.buildEnv && Object.keys(input.buildEnv).length > 0
          ? { BUILD_ENV_JSON: JSON.stringify(input.buildEnv) }
          : {}),
      },
      auto_destroy: true,
      restart: { policy: "no" },
      // This machine only orchestrates: clones, calls flyctl, manages
      // app/IP/preview-machine on Fly's API. The actual `docker build`
      // happens on the org's traditional remote builder app
      // (fly-builder-<org>) — that's where memory + CPU matter. Keep
      // this orchestrator small.
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 1024 },
    },
    region: input.flyRegion,
  };

  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(BUILDER_HOST_APP)}/machines`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.flyToken}`,
        "Content-Type": "application/json",
      },
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
    expectedUrl: `https://${input.appName}.fly.dev`,
  };
}
