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
  pr: number;
  ref: string;
  /** Per-PR Fly app name (same naming the builder will recreate inside). */
  appName: string;
  imageTag?: string;
  flyToken: string;
  flyOrgSlug: string;
  flyRegion: string;
  githubToken?: string;
}

export interface SpawnBuilderResult {
  machineId: string;
  /** Deterministic public URL — the builder will boot a machine here once
   *  it finishes. Not yet reachable when this function returns. */
  expectedUrl: string;
}

function defaultTagFor(repo: string, ref: string): string {
  return createHash("sha256").update(`${repo}@${ref}`).digest("hex").slice(0, 12);
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
      },
      auto_destroy: true,
      restart: { policy: "no" },
      // The build runs IN this machine (buildah inside the builder
      // image). Memory here is what next build / webpack actually have
      // — Depot remote-builder OOMs are gone. performance-2x / 4GB is
      // the same as the user's "high" runner tier, sized for large
      // Next.js webpack builds (A-Guy etc.).
      guest: { cpu_kind: "performance", cpus: 2, memory_mb: 4096 },
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
