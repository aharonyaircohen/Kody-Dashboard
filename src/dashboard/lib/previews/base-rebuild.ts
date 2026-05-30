/**
 * @fileType library
 * @domain previews
 * @pattern base-image-refresh
 *
 * Auto-rebuild the per-repo GHCR base image on every push to the
 * default branch. The base image holds the heavy `pnpm install` +
 * `next build` cache for the current main; per-PR builds `FROM` it
 * and skip those steps, cutting a cold PR build from ~13 min to ~3.
 *
 * Without auto-rebuild the base goes stale (deps update on main,
 * source diverges) and PR `FROM` falls back to a slow full build.
 *
 * Same builder code path as a per-PR build — only the app name is
 * different (`...-base` suffix). The builder detects that suffix
 * (`isBaseBuild`) and mirrors the resulting image to GHCR as
 * `kp-<owner>-<repo>-base:latest`. From there every subsequent PR's
 * `FROM ${BASE_IMAGE}` inherits the freshly-built layers.
 *
 * Per-repo in-process debounce keeps back-to-back pushes from
 * queuing parallel base builds. Cross-instance debounce isn't
 * needed: a second base build from a different Vercel instance
 * just overwrites the GHCR `:latest` tag idempotently.
 */

import { logger } from "@dashboard/lib/logger";
import { spawnPreviewBuilder } from "@dashboard/lib/previews/builder-client";
import { type FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import { basePreviewAppName } from "@dashboard/lib/previews/preview-key";
import { loadVaultContextForBuild } from "@dashboard/lib/previews/vault-build-context";

/**
 * Per-repo debounce window. A second push within this window is
 * dropped silently — the base build already in flight will pick up
 * whichever commit is at HEAD when its `git clone` runs.
 */
const DEBOUNCE_MS = 10 * 60 * 1000;

const lastBuildStartedAt = new Map<string, number>();

function debounced(repo: string): boolean {
  const now = Date.now();
  const prev = lastBuildStartedAt.get(repo) ?? 0;
  if (now - prev < DEBOUNCE_MS) return true;
  lastBuildStartedAt.set(repo, now);
  return false;
}

export interface RebuildBaseInput {
  /** owner/name */
  repo: string;
  /** Head SHA of the default-branch push (or branch ref) to build from. */
  ref: string;
  /** Fly config resolved from the target repo's vault. */
  cfg: FlyPreviewConfig;
  /** GitHub token for the clone — App installation token preferred. */
  githubToken?: string;
}

export async function rebuildBaseImage(input: RebuildBaseInput): Promise<void> {
  if (debounced(input.repo)) {
    logger.info(
      { repo: input.repo },
      "previews.base-rebuild: debounced (recent build in flight)",
    );
    return;
  }

  const appName = basePreviewAppName(input.repo);
  const { buildEnv, buildMode } = await loadVaultContextForBuild(input.repo);

  try {
    const spawned = await spawnPreviewBuilder({
      repo: input.repo,
      ref: input.ref,
      appName,
      flyToken: input.cfg.token,
      flyOrgSlug: input.cfg.orgSlug,
      flyRegion: input.cfg.defaultRegion,
      githubToken: input.githubToken,
      buildEnv,
      buildMode,
    });
    logger.info(
      {
        repo: input.repo,
        ref: input.ref,
        appName,
        builderMachineId: spawned.machineId,
      },
      "previews.base-rebuild: builder dispatched",
    );
  } catch (err) {
    // Failures clear the debounce slot so the next push can retry.
    lastBuildStartedAt.delete(input.repo);
    logger.warn(
      { err, repo: input.repo, ref: input.ref },
      "previews.base-rebuild: spawn failed (non-fatal)",
    );
  }
}
