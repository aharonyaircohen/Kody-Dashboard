/**
 * @fileType library
 * @domain previews
 * @pattern ttl-sweep
 * @ai-summary Destroy per-PR preview apps that have outlived their TTL.
 *   Previews accumulate: every open PR (and stale bot PRs never close)
 *   keeps a Fly app alive; even when machines suspend they still cost
 *   rootfs storage, and the app count balloons. This sweep enumerates a
 *   repo's preview apps and destroys any whose oldest machine is older
 *   than `fly.previews.ttlDays`.
 *
 *   Opt-in: `ttlDays <= 0` (the default) sweeps nothing. The per-repo BASE
 *   image (`kp-…-base`) is ALWAYS skipped — it's the build cache, not a
 *   preview. Best-effort: a failure on one app is logged and recorded in
 *   `errored` but never aborts the rest, and `now` is injectable for
 *   tests.
 */

import { logger } from "@dashboard/lib/logger";
import {
  destroyApp,
  listAppsByPrefix,
  listMachines,
} from "@dashboard/lib/previews/fly-previews";
import {
  resolveFlyPreviewsForRepo,
  resolvePreviewConfigForRepo,
} from "@dashboard/lib/previews/config";
import { repoPreviewPrefix } from "@dashboard/lib/previews/preview-key";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SweepResult {
  /** Whether a TTL is configured at all (false = nothing to do). */
  enabled: boolean;
  ttlDays: number;
  /** Preview apps inspected (excludes the base image). */
  inspected: number;
  /** App names destroyed because they were past TTL. */
  destroyed: string[];
  /** App names that errored during inspection/destroy (best-effort sweep). */
  errored: string[];
}

/**
 * Sweep one repo's expired preview apps. Best-effort: a failure on one app is
 * logged and recorded in `errored` but never aborts the rest. `now` is
 * injectable for tests; defaults to the current time.
 */
export async function sweepExpiredPreviews(
  repo: string,
  now: number = Date.now(),
): Promise<SweepResult> {
  const previews = await resolveFlyPreviewsForRepo(repo);
  const ttlDays = previews.ttlDays;
  if (!ttlDays || ttlDays <= 0) {
    return {
      enabled: false,
      ttlDays: 0,
      inspected: 0,
      destroyed: [],
      errored: [],
    };
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    return { enabled: true, ttlDays, inspected: 0, destroyed: [], errored: [] };
  }
  const cfg = await resolvePreviewConfigForRepo(owner, name);
  if (!cfg) {
    logger.warn(
      { repo },
      "preview-sweep: no Fly config (token missing) — skipping",
    );
    return { enabled: true, ttlDays, inspected: 0, destroyed: [], errored: [] };
  }

  const prefix = repoPreviewPrefix(repo);
  const apps = (await listAppsByPrefix(prefix, cfg)).filter(
    (name) => !name.endsWith("-base"),
  );

  const cutoffMs = ttlDays * MS_PER_DAY;
  const destroyed: string[] = [];
  const errored: string[] = [];

  for (const appName of apps) {
    try {
      const machines = await listMachines(appName, cfg);
      // Oldest machine's creation time = the app's effective age. No machines
      // (a half-torn-down app) → treat as sweepable so it doesn't linger.
      const createdTimes = machines
        .map((m) => (m.createdAt ? Date.parse(m.createdAt) : NaN))
        .filter((t) => Number.isFinite(t));
      const oldest = createdTimes.length > 0 ? Math.min(...createdTimes) : 0;
      const ageMs = now - oldest;
      if (ageMs > cutoffMs) {
        await destroyApp(appName, cfg);
        destroyed.push(appName);
      }
    } catch (err) {
      logger.warn(
        { err, repo, appName },
        "preview-sweep: app inspect/destroy failed",
      );
      errored.push(appName);
    }
  }

  logger.info(
    { repo, ttlDays, inspected: apps.length, destroyed: destroyed.length },
    "preview-sweep: complete",
  );
  return {
    enabled: true,
    ttlDays,
    inspected: apps.length,
    destroyed,
    errored,
  };
}
