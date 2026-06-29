/**
 * @fileType library
 * @domain previews
 * @pattern preview-cleanup
 * @ai-summary Cleanup for per-PR preview apps: repair old machines so they
 *   sleep/wake correctly, actively sleep started previews, destroy closed-PR
 *   apps, and garbage-collect apps past TTL. Trap: the per-repo BASE image
 *   (`kp-…-base`) is always exempt — destroying it would invalidate the build
 *   cache and re-cold-build every PR.
 *
 * Repair and sweep per-PR preview apps.
 *
 * Previews accumulate: every open PR (and stale bot PRs never close) keeps a
 * Fly app alive. Even when machines suspend they still cost rootfs storage,
 * and the app count balloons. This sweep enumerates a repo's preview apps,
 * destroys PR apps whose PR is no longer open, and destroys any remaining app
 * whose oldest machine is older than `fly.previews.ttlDays`. For the rest, it
 * updates sleep/wake settings and puts started machines to sleep immediately
 * when `fly.previews.idleSuspend` is enabled.
 *
 * TTL is opt-in: `ttlDays <= 0` (the default) sweeps nothing. The per-repo
 * BASE image (`kp-…-base`) is always skipped — it's the build cache, not a
 * preview.
 */

import { Octokit } from "@octokit/rest";

import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import { logger } from "@dashboard/lib/logger";
import {
  alignPreviewMachineSleep,
  destroyApp,
  listAppsByPrefix,
  listMachines,
  sleepPreviewMachine,
} from "@dashboard/lib/previews/fly-previews";
import {
  resolveFlyPreviewsForRepo,
  resolvePreviewConfigForRepo,
} from "@dashboard/lib/previews/config";
import { repoPreviewPrefix } from "@dashboard/lib/previews/preview-key";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PullRequestOpenResolver = (
  prNumber: number,
) => Promise<boolean | null>;

export interface SweepOptions {
  now?: number;
  /**
   * null means GitHub state is unavailable, so the sweep falls back to TTL.
   * undefined means the sweep should build the default background-token lookup.
   */
  isPullRequestOpen?: PullRequestOpenResolver | null;
}

export interface SweepResult {
  /** Whether a TTL is configured at all (false = nothing to do). */
  enabled: boolean;
  ttlDays: number;
  /** Preview apps inspected (excludes the base image). */
  inspected: number;
  /** App names destroyed because they were past TTL. */
  destroyed: string[];
  /** App names destroyed because the matching GitHub PR is closed. */
  closedPrDestroyed: string[];
  /** Machine refs updated so Fly can sleep them and wake them on request. */
  aligned: string[];
  /** Machine refs already matching the desired sleep/wake config. */
  unchanged: string[];
  /** Machine refs that could not be aligned because they lack services/config. */
  skipped: string[];
  /** Machine refs actively put to sleep during cleanup. */
  slept: string[];
  /** App names that errored during inspection/destroy (best-effort sweep). */
  errored: string[];
}

function normalizeSweepOptions(nowOrOptions?: number | SweepOptions): {
  now: number;
  isPullRequestOpen?: PullRequestOpenResolver | null;
} {
  if (typeof nowOrOptions === "number") {
    return { now: nowOrOptions };
  }
  return {
    now: nowOrOptions?.now ?? Date.now(),
    isPullRequestOpen: nowOrOptions?.isPullRequestOpen,
  };
}

function parsePrNumberFromAppName(
  prefix: string,
  appName: string,
): number | null {
  if (!appName.startsWith(prefix)) return null;
  const suffix = appName.slice(prefix.length);
  const match = /^pr-(\d+)$/.exec(suffix);
  if (!match) return null;
  const prNumber = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(prNumber) && prNumber > 0 ? prNumber : null;
}

async function createPullRequestOpenResolver(
  owner: string,
  repo: string,
): Promise<PullRequestOpenResolver | null> {
  const bg = await resolveBackgroundToken(owner, repo);
  if (!bg) {
    logger.warn(
      { owner, repo },
      "preview-sweep: no GitHub background token — closed-PR cleanup disabled",
    );
    return null;
  }

  const octokit = new Octokit({ auth: bg.token });
  try {
    const pulls = (await octokit.paginate(octokit.rest.pulls.list, {
      owner,
      repo,
      state: "open",
      per_page: 100,
    })) as Array<{ number?: number }>;
    const openPrs = new Set(
      pulls
        .map((pull) => pull.number)
        .filter((n): n is number => typeof n === "number"),
    );
    return async (prNumber: number) => openPrs.has(prNumber);
  } catch (err) {
    logger.warn(
      { err, owner, repo },
      "preview-sweep: open PR lookup failed — closed-PR cleanup disabled",
    );
    return null;
  }
}

/**
 * Clean one repo's preview apps. Best-effort: a failure on one app is logged
 * and recorded in `errored` but never aborts the rest. `now` is injectable for
 * tests; defaults to the current time.
 */
export async function sweepExpiredPreviews(
  repo: string,
  nowOrOptions: number | SweepOptions = Date.now(),
): Promise<SweepResult> {
  const { now, isPullRequestOpen: optionPullRequestOpen } =
    normalizeSweepOptions(nowOrOptions);
  const previews = await resolveFlyPreviewsForRepo(repo);
  const ttlDays = previews.ttlDays;
  if (!ttlDays || ttlDays <= 0) {
    return {
      enabled: false,
      ttlDays: 0,
      inspected: 0,
      destroyed: [],
      closedPrDestroyed: [],
      aligned: [],
      unchanged: [],
      skipped: [],
      slept: [],
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
      closedPrDestroyed: [],
      aligned: [],
      unchanged: [],
      skipped: [],
      slept: [],
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
      closedPrDestroyed: [],
      aligned: [],
      unchanged: [],
      skipped: [],
      slept: [],
      errored: [],
    };
  }

  const prefix = repoPreviewPrefix(repo);
  const apps = (await listAppsByPrefix(prefix, cfg)).filter(
    (name) => !name.endsWith("-base"),
  );
  const prApps = new Map<string, number>();
  for (const appName of apps) {
    const prNumber = parsePrNumberFromAppName(prefix, appName);
    if (prNumber) prApps.set(appName, prNumber);
  }
  const isPullRequestOpen =
    optionPullRequestOpen !== undefined
      ? optionPullRequestOpen
      : prApps.size > 0
        ? await createPullRequestOpenResolver(owner, name)
        : null;

  const cutoffMs = ttlDays * MS_PER_DAY;
  const destroyed: string[] = [];
  const closedPrDestroyed: string[] = [];
  const aligned: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  const slept: string[] = [];
  const errored: string[] = [];

  for (const appName of apps) {
    try {
      const prNumber = prApps.get(appName);
      if (prNumber && isPullRequestOpen) {
        const isOpen = await isPullRequestOpen(prNumber);
        if (isOpen === false) {
          await destroyApp(appName, cfg);
          destroyed.push(appName);
          closedPrDestroyed.push(appName);
          continue;
        }
      }

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
        const memoryMb = machine.guest?.memoryMb ?? previews.memoryMb;
        const result = await alignPreviewMachineSleep(
          appName,
          machine.id,
          cfg,
          {
            idleSuspend: previews.idleSuspend,
            healthCheck: previews.healthCheck,
            memoryMb,
          },
        );
        if (result.changed) {
          aligned.push(ref);
        } else if (result.skipped) {
          skipped.push(ref);
          continue;
        } else {
          unchanged.push(ref);
        }
        if (previews.idleSuspend) {
          const sleep = await sleepPreviewMachine(appName, machine.id, cfg, {
            state: machine.state,
            memoryMb,
          });
          if (sleep.slept) slept.push(ref);
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
      closedPrDestroyed: closedPrDestroyed.length,
      aligned: aligned.length,
      slept: slept.length,
    },
    "preview-sweep: complete",
  );
  return {
    enabled: true,
    ttlDays,
    inspected: apps.length,
    destroyed,
    closedPrDestroyed,
    aligned,
    unchanged,
    skipped,
    slept,
    errored,
  };
}
