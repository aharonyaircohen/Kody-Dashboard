/**
 * @fileType library
 * @domain previews
 * @pattern lifecycle-dispatch
 *
 * Per-PR preview lifecycle.
 *
 * Two operations, both cheap and synchronous from the dashboard side:
 *
 *   createPreview  — spawns a builder Fly Machine that handles the full
 *                    pipeline (build + push image + create app + IPs +
 *                    preview machine + exit). The dashboard's only Fly
 *                    interaction is the single spawn call (~1s).
 *
 *   destroyPreview — deletes the per-PR Fly app on PR close. Idempotent.
 *
 * Status lookups (getPreview) hit Fly's API directly using the
 * deterministic per-PR app name. The dashboard never stores preview
 * state of its own.
 */

import { logger } from "@dashboard/lib/logger";
import {
  spawnPreviewBuilder,
  type SpawnBuilderResult,
} from "@dashboard/lib/previews/builder-client";
import {
  appExists,
  destroyApp,
  flyHostname,
  type FlyPreviewConfig,
  listMachines,
} from "@dashboard/lib/previews/fly-previews";
import {
  type PreviewKey,
  previewAppName,
} from "@dashboard/lib/previews/preview-key";
import { loadVaultContextForBuild } from "@dashboard/lib/previews/vault-build-context";

export interface CreatePreviewInput extends PreviewKey {
  ref: string;
  imageTag?: string;
  githubToken?: string;
}

export interface PreviewInfo {
  key: PreviewKey;
  appName: string;
  url: string;
  machineId?: string;
  state: "pending" | "starting" | "running" | "unknown";
  region: string;
  /** Builder machine spawned for this run; useful for debugging logs. */
  builderMachineId?: string;
}

export async function createPreview(
  input: CreatePreviewInput,
  cfg: FlyPreviewConfig,
): Promise<PreviewInfo> {
  const key: PreviewKey = { repo: input.repo, pr: input.pr };
  const appName = previewAppName(key);

  // Build-time secrets + build mode — read once from the target repo's
  // vault. Secrets are baked into .env.production.local during build.
  // Build mode picks the bundled Dockerfile.preview variant ("dev"
  // skips `next build`; "prod" matches Vercel's flow). `input.githubToken`
  // (when set by the webhook handler) reuses the already-resolved
  // background token — same token that resolved the Fly config —
  // avoiding a second GitHub API call and a class of silent-empty bugs.
  const { buildEnv, buildMode } = await loadVaultContextForBuild(
    input.repo,
    input.githubToken,
  );

  let spawned: SpawnBuilderResult;
  try {
    spawned = await spawnPreviewBuilder({
      repo: input.repo,
      pr: input.pr,
      ref: input.ref,
      appName,
      imageTag: input.imageTag,
      flyToken: cfg.token,
      flyOrgSlug: cfg.orgSlug,
      flyRegion: cfg.defaultRegion,
      githubToken: input.githubToken,
      buildEnv,
      buildMode,
    });
  } catch (err) {
    logger.error(
      { err, repo: input.repo, pr: input.pr, ref: input.ref },
      "preview: builder spawn failed",
    );
    throw err;
  }

  // Builder is now running independently. Return the deterministic URL
  // immediately — the URL won't be reachable for ~2-5 min while the
  // builder works, but the dashboard's GET endpoint can probe Fly for
  // current state at any time.
  return {
    key,
    appName,
    url: spawned.expectedUrl,
    state: "pending",
    region: cfg.defaultRegion,
    builderMachineId: spawned.machineId,
  };
}

export async function destroyPreview(
  key: PreviewKey,
  cfg: FlyPreviewConfig,
): Promise<void> {
  await destroyApp(previewAppName(key), cfg);
}

export async function getPreview(
  key: PreviewKey,
  cfg: FlyPreviewConfig,
): Promise<PreviewInfo | null> {
  const appName = previewAppName(key);
  if (!(await appExists(appName, cfg))) return null;

  const machines = await listMachines(appName, cfg);
  const first = machines[0];
  return {
    key,
    appName,
    url: flyHostname(appName),
    machineId: first?.id,
    state:
      first?.state === "started"
        ? "running"
        : first?.state === "starting"
          ? "starting"
          : first
            ? "unknown"
            : "pending",
    region: first?.region ?? cfg.defaultRegion,
  };
}
