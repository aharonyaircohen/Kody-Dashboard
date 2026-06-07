/**
 * @fileType library
 * @domain previews
 * @pattern lifecycle-dispatch
 * @ai-summary Per-PR / per-branch preview lifecycle — the public API the
 *   webhook handlers and the static-preview switcher call into. Two
 *   operations, both cheap and synchronous from the dashboard's side:
 *   `createPreview` (spawns the builder Fly Machine that handles the entire
 *   build + boot pipeline and returns immediately) and `destroyPreview`
 *   (deletes the per-PR Fly app; idempotent). Status lookups (`getPreview`)
 *   hit Fly's API directly using the deterministic per-PR app name — the
 *   dashboard never stores preview state of its own, so a Vercel restart
 *   loses nothing.
 *
 *   Static-file previews are intentionally excluded from `CreatePreviewInput`
 *   (they skip the builder entirely — see `static-preview.ts`); their status
 *   + teardown flow through the same `getPreview` / `destroyPreview` because
 *   those functions already work for any `PreviewKey`.
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
  type BranchPreviewKey,
  type PreviewKey,
  type PrPreviewKey,
  previewAppName,
} from "@dashboard/lib/previews/preview-key";
import { loadVaultContextForBuild } from "@dashboard/lib/previews/vault-build-context";
import { resolveFlyPreviewsForRepo } from "@dashboard/lib/previews/config";

/**
 * The builder path only handles git-backed previews (PR or branch) — it
 * clones a ref and runs a real `docker build`. Static-file previews skip
 * the builder entirely (see `static-preview.ts`), so they're intentionally
 * excluded from this input type.
 */
export type CreatePreviewInput = (PrPreviewKey | BranchPreviewKey) & {
  ref: string;
  imageTag?: string;
  githubToken?: string;
};

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
  const key: PreviewKey =
    "pr" in input
      ? { repo: input.repo, pr: input.pr }
      : { repo: input.repo, branch: input.branch };
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

  // Per-repo preview machine knobs (size, idle-suspend, health-check) from
  // kody.config.json. Reuses the same githubToken so this adds no extra
  // GitHub round-trip on the hot path. Never throws — falls back to defaults.
  const previews = await resolveFlyPreviewsForRepo(
    input.repo,
    input.githubToken,
  );

  let spawned: SpawnBuilderResult;
  try {
    spawned = await spawnPreviewBuilder({
      repo: input.repo,
      // PR builds get a PR_NUMBER (the builder comments the URL on the PR);
      // branch builds omit it — there's no PR to comment on.
      ...("pr" in input ? { pr: input.pr } : {}),
      ref: input.ref,
      appName,
      imageTag: input.imageTag,
      flyToken: cfg.token,
      flyOrgSlug: cfg.orgSlug,
      flyRegion: cfg.defaultRegion,
      githubToken: input.githubToken,
      buildEnv,
      buildMode,
      previewVmCpus: previews.cpus,
      previewVmMemoryMb: previews.memoryMb,
      previewIdleSuspend: previews.idleSuspend,
      previewHealthCheck: previews.healthCheck,
    });
  } catch (err) {
    logger.error(
      { err, repo: input.repo, appName, ref: input.ref },
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
