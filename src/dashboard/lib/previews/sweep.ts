/**
 * @fileType library
 * @domain previews
 * @pattern ttl-sweep
 * @ai-summary TTL-based garbage collection for per-PR preview apps —
 *   every open (and stale-bot) PR keeps a Fly app alive, and even
 *   suspended machines cost rootfs storage. Trap: TTL is opt-in via
 *   `fly.previews.ttlDays` (≤ 0 = no-op), and the per-repo BASE image
 *   (`kp-…-base`) is always exempt — destroying it would invalidate the
 *   build cache and re-cold-build every PR.
 *
 * Destroy per-PR preview apps that have outlived their TTL.
 *
 * Previews accumulate: every open PR (and stale bot PRs never close) keeps a
 * Fly app alive. Even when machines suspend they still cost rootfs storage,
 * and the app count balloons. This sweep enumerates a repo's preview apps and
 * destroys any whose oldest machine is older than `fly.previews.ttlDays`.
 *
 * TTL is opt-in: `ttlDays <= 0` (the default) sweeps nothing. The per-repo
 * BASE image (`kp-…-base`) is always skipped — it's the build cache, not a
 * preview.
 */

import { logger } from "@dashboard/lib/logger";
import {
  alignPreviewMachineSleep,
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
  /** Machine refs updated so Fly can sleep them and wake them on request. */
  aligned: string[];
  /** Machine refs already matching the desired sleep/wake config. */
  unchanged: string[];
  /** Machine refs that could not be aligned because they lack services/config. */
  skipped: string[];
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
      aligned: [],
      unchanged: [],
      skipped: [],
      errored: [],
    };
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    return {
      enabled: true,
      ttlDays,
      inspected: 0,
      destroyed: [],
      aligned: [],
      unchanged: [],
      skipped: [],
      errored: [],
    };
  }
  const cfg = await resolvePreviewConfigForRepo(owner, name);
  if (!cfg) {
    logger.warn(
      { repo },
      "preview-sweep: no Fly config (token missing) — skipping",
    );
    return {
      enabled: true,
      ttlDays,
      inspected: 0,
      destroyed: [],
      aligned: [],
      unchanged: [],
      skipped: [],
      errored: [],
    };
  }

  const prefix = repoPreviewPrefix(repo);
  const apps = (await listAppsByPrefix(prefix, cfg)).filter(
    (name) => !name.endsWith("-base"),
  );

  const cutoffMs = ttlDays * MS_PER_DAY;
  const destroyed: string[] = [];
  const aligned: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
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
        continue;
      }

      for (const machine of machines) {
        const ref = `${appName}/${machine.id}`;
        const result = await alignPreviewMachineSleep(appName, machine.id, cfg, {
          idleSuspend: previews.idleSuspend,
          healthCheck: previews.healthCheck,
          memoryMb: machine.guest?.memoryMb ?? previews.memoryMb,
        });
        if (result.changed) {
          aligned.push(ref);
        } else if (result.skipped) {
          skipped.push(ref);
        } else {
          unchanged.push(ref);
        }
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
    {
      repo,
      ttlDays,
      inspected: apps.length,
      destroyed: destroyed.length,
      aligned: aligned.length,
    },
    "preview-sweep: complete",
  );
  return {
    enabled: true,
    ttlDays,
    inspected: apps.length,
    destroyed,
    aligned,
    unchanged,
    skipped,
    errored,
  };
}
