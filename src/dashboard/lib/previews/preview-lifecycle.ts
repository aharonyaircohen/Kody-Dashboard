/**
 * @fileType library
 * @domain previews
 * @pattern lifecycle-orchestration
 *
 * Per-PR preview lifecycle. Tries the warm pool first (claim → swap
 * image → ~3s); falls back to create-fresh (app + IPs + machine + wait
 * → ~40s) if the pool is empty or unreachable.
 *
 * This is the only entrypoint API routes + webhook handlers should call.
 */

import { logger } from "@dashboard/lib/logger";
import {
  allocateSharedIps,
  appExists,
  createApp,
  createMachine,
  destroyApp,
  flyHostname,
  type FlyPreviewConfig,
  listMachines,
  waitForMachineStarted,
} from "@dashboard/lib/previews/fly-previews";
import { type PreviewKey, previewAppName } from "@dashboard/lib/previews/preview-key";
import {
  claimPreviewFromPool,
  releasePreviewToPool,
} from "@dashboard/lib/previews/preview-pool";

export interface CreatePreviewInput extends PreviewKey {
  image: string;
  internalPort?: number;
  env?: Record<string, string>;
  region?: string;
}

export interface PreviewInfo {
  key: PreviewKey;
  appName: string;
  url: string;
  machineId?: string;
  state: "pending" | "starting" | "running" | "unknown";
  region: string;
  source: "pool" | "fresh";
}

/**
 * Create or refresh a preview. Tries the warm pool first; falls back to
 * the create-fresh path. Idempotent — re-creating with the same key
 * destroys the existing app (in the create-fresh path) so a PR sync
 * always gets a clean machine.
 */
export async function createPreview(
  input: CreatePreviewInput,
  cfg: FlyPreviewConfig,
): Promise<PreviewInfo> {
  const key: PreviewKey = { repo: input.repo, pr: input.pr };

  // Pool fast path.
  const claim = await claimPreviewFromPool({
    repo: input.repo,
    pr: input.pr,
    image: input.image,
    internalPort: input.internalPort,
    env: input.env,
  });
  if (claim.ok) {
    logger.info(
      { repo: input.repo, pr: input.pr, app: claim.appName },
      "preview: claimed from warm pool",
    );
    return {
      key,
      appName: claim.appName,
      url: claim.url,
      machineId: claim.machineId,
      state: "running",
      region: input.region ?? cfg.defaultRegion,
      source: "pool",
    };
  }

  // Fallback: create-fresh.
  logger.info(
    { repo: input.repo, pr: input.pr, reason: claim.reason },
    "preview: pool unavailable, creating fresh",
  );
  const appName = previewAppName(key);
  const region = input.region ?? cfg.defaultRegion;

  if (await appExists(appName, cfg)) {
    await destroyApp(appName, cfg);
  }
  await createApp(appName, cfg);
  await allocateSharedIps(appName, cfg);
  const machine = await createMachine(
    {
      appName,
      region,
      image: input.image,
      env: input.env,
      internalPort: input.internalPort ?? 8080,
    },
    cfg,
  );
  await waitForMachineStarted(appName, machine.id, cfg);

  return {
    key,
    appName,
    url: flyHostname(appName),
    machineId: machine.id,
    state: "running",
    region: machine.region,
    source: "fresh",
  };
}

/**
 * Tear down a preview. Asks the pool to reclaim the slot if it can; on
 * failure, destroys the app directly. Idempotent.
 */
export async function destroyPreview(
  key: PreviewKey,
  cfg: FlyPreviewConfig,
): Promise<void> {
  // Pool-aware release first (no-op when pool unreachable).
  await releasePreviewToPool(key.repo, key.pr);
  // Whether the pool reclaimed it or not, ensure the app is gone.
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
    source: "fresh",
  };
}
