/**
 * @fileType library
 * @domain previews
 * @pattern lifecycle-orchestration
 *
 * Per-PR preview lifecycle. Two phases:
 *
 *   build  — call the kody-preview-builder Fly service, which clones
 *            the repo + ref and produces an image in the Fly registry.
 *            The dashboard never runs Docker itself.
 *
 *   deploy — try the warm pool fast path (claim suspended machine →
 *            swap image → ~3s); otherwise create-fresh (app + IPs +
 *            machine + wait → ~40s).
 *
 * Build is a hard dependency (no image → nothing to boot). Pool is
 * a soft accelerator (fall back to create-fresh on any miss).
 *
 * This is the only entrypoint API routes + webhook handlers should call.
 */

import { logger } from "@dashboard/lib/logger";
import { buildPreviewImage } from "@dashboard/lib/previews/builder-client";
import {
  allocateSharedIps,
  appExists,
  createApp,
  createMachine,
  destroyApp,
  destroyMachine,
  flyHostname,
  type FlyPreviewConfig,
  listMachines,
  waitForMachineStarted,
} from "@dashboard/lib/previews/fly-previews";
import {
  type PreviewKey,
  previewAppName,
} from "@dashboard/lib/previews/preview-key";
import {
  claimPreviewFromPool,
  releasePreviewToPool,
} from "@dashboard/lib/previews/preview-pool";

export interface CreatePreviewInput extends PreviewKey {
  /** Git ref (branch or sha) the builder will check out. */
  ref: string;
  /** Optional pre-built image; when set, skip the builder. */
  image?: string;
  /** Optional GitHub token for cloning private repos in the builder. */
  githubToken?: string;
  internalPort?: number;
  env?: Record<string, string>;
  region?: string;
}

export interface PreviewInfo {
  key: PreviewKey;
  appName: string;
  url: string;
  /** Image the running machine was booted from. Null in GET when unknown. */
  image: string | null;
  machineId?: string;
  state: "pending" | "starting" | "running" | "unknown";
  region: string;
  source: "pool" | "fresh";
  buildMs?: number;
}

/**
 * Create or refresh a preview. Builds the image first (unless one was
 * supplied), then deploys via pool fast path or create-fresh.
 *
 * Idempotent: re-creating with the same key destroys the existing app
 * (in the create-fresh path) so a PR sync always gets a clean machine.
 */
export async function createPreview(
  input: CreatePreviewInput,
  cfg: FlyPreviewConfig,
): Promise<PreviewInfo> {
  const key: PreviewKey = { repo: input.repo, pr: input.pr };
  const appName = previewAppName(key);
  const region = input.region ?? cfg.defaultRegion;

  // 1. Build + Fly-side setup, in parallel.
  //
  // The build runs on Fly's remote builder for ~100s. While that's
  // happening, the slow Fly-side prep (createApp + shared IPs) can run
  // on this side at the same time — both need to be done before
  // createMachine, but they don't depend on each other. Running them
  // sequentially burned ~5s of dead time per cold preview.
  //
  // Why this is safe: the builder pushes its image into <appName>'s
  // registry namespace and only requires the app to exist by the time
  // its `flyctl deploy --build-only --push` runs. createApp completes
  // in ~2-3s and runs first inside the prep promise, well before
  // builder spawn + clone + build complete.
  let image = input.image;
  let buildMs: number | undefined;

  const flyPrep = (async () => {
    if (!(await appExists(appName, cfg))) await createApp(appName, cfg);
    // Allocate now — saves another sequential step after the build.
    // GraphQL ignores re-allocation when the IP already exists, so this
    // is safe across PR-sync rebuilds.
    await allocateSharedIps(appName, cfg);
  })();

  if (!image) {
    const [, built] = await Promise.all([
      flyPrep,
      buildPreviewImage({
        repo: input.repo,
        ref: input.ref,
        appName,
        flyToken: cfg.token,
        githubToken: input.githubToken,
      }),
    ]);
    image = built.image;
    buildMs = built.durationMs;
    logger.info(
      { repo: input.repo, pr: input.pr, image, buildMs },
      "preview: image built",
    );
  } else {
    // Caller supplied a pre-built image — still run prep so the deploy
    // phase below doesn't have to.
    await flyPrep;
  }

  // 2. Deploy — pool fast path.
  const claim = await claimPreviewFromPool({
    repo: input.repo,
    pr: input.pr,
    image,
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
      image,
      machineId: claim.machineId,
      state: "running",
      region,
      source: "pool",
      buildMs,
    };
  }

  // 3. Deploy — create-fresh fallback.
  logger.info(
    { repo: input.repo, pr: input.pr, reason: claim.reason },
    "preview: pool unavailable, creating fresh",
  );

  // Wipe any prior machine for this key so the new image gets a clean boot.
  // App + IPs are already in place from flyPrep above; only stale machines
  // (from a PR-sync rebuild) need to be cleared before createMachine.
  const existing = await listMachines(appName, cfg);
  await Promise.all(
    existing.map((m) => destroyMachine(appName, m.id, cfg).catch(() => {})),
  );
  const machine = await createMachine(
    {
      appName,
      region,
      image,
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
    image,
    machineId: machine.id,
    state: "running",
    region: machine.region,
    source: "fresh",
    buildMs,
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
  await releasePreviewToPool(key.repo, key.pr);
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
    image: null,
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
