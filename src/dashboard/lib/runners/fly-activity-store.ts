/**
 * @fileType utility
 * @domain runner
 * @pattern fly-activity-store
 * @ai-summary Persists Fly activity snapshots to .kody/state/fly-activity.json
 *   in the configured Kody state repo (GitHub is the only datastore; no Vercel KV/cron).
 *   Writes are throttled (≥5min interval), pruned to 14-day window, and use
 *   CAS to avoid clobbering. snapshotDue() lets callers skip an expensive Fly
 *   inventory call when a write would be throttled anyway.
 *
 * Modeled on cto/trust-store.ts, but takes an explicit Octokit (rather than the
 * request-context globals) so the same writer works from the activity API
 * route AND the preview webhook.
 *
 * Snapshots are throttled (≥ MIN_INTERVAL) and the window is pruned to
 * WINDOW_MS so the file can't grow without bound.
 */
import "server-only";

import type { Octokit } from "@octokit/rest";

import { logger } from "@dashboard/lib/logger";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";
import {
  EMPTY_ACTIVITY_FILE,
  type ActivitySample,
  type ActivitySnapshot,
  type FlyActivityFile,
} from "./fly-activity";
import type { FlyInventory } from "./fly-inventory";

export const ACTIVITY_FILE_PATH = "state/fly-activity.json";

/** Don't record more often than this — a snapshot per page view would spam. */
const MIN_INTERVAL_MS = 5 * 60_000;
/** Keep ~14 days of history. */
const WINDOW_MS = 14 * 24 * 60_000 * 60;
/** Hard cap on snapshot count regardless of window (belt + suspenders). */
const MAX_SNAPSHOTS = 6000;
const MAX_CAS_RETRIES = 3;

function parse(raw: string): FlyActivityFile {
  try {
    const obj = JSON.parse(raw) as Partial<FlyActivityFile>;
    if (obj && Array.isArray(obj.snapshots)) {
      return { version: 1, snapshots: obj.snapshots };
    }
  } catch {
    // fall through to empty
  }
  return structuredClone(EMPTY_ACTIVITY_FILE);
}

interface ReadResult {
  file: FlyActivityFile;
  sha?: string;
}

async function fetchFile(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ReadResult> {
  try {
    const file = await readStateText(octokit, owner, repo, ACTIVITY_FILE_PATH);
    if (file) return { file: parse(file.content), sha: file.sha };
    return { file: structuredClone(EMPTY_ACTIVITY_FILE) };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return { file: structuredClone(EMPTY_ACTIVITY_FILE) };
    throw err;
  }
}

/** Whether enough time has passed since the last snapshot to record another.
 * Exported so callers (e.g. the webhook) can skip an expensive Fly inventory
 * call when a write would be throttled anyway. */
export function snapshotDue(file: FlyActivityFile, now: number): boolean {
  const last = file.snapshots[file.snapshots.length - 1];
  return !last || now - last.ts >= MIN_INTERVAL_MS;
}

/** Cached-free read of the activity timeline (used by the API route). */
export async function readActivityFile(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<FlyActivityFile> {
  const { file } = await fetchFile(octokit, owner, repo);
  return file;
}

/** Map a live inventory into a storable snapshot — keep only the fields the
 * activity compute needs (drops region/labels, which it re-derives). */
export function snapshotFromInventory(
  inv: FlyInventory,
  now: number,
): ActivitySnapshot {
  const machines: ActivitySample[] = inv.machines.map((m) => ({
    app: m.app,
    machineId: m.machineId,
    state: m.state,
    cpuKind: m.guest?.cpuKind,
    cpus: m.guest?.cpus,
    memoryMb: m.guest?.memoryMb,
  }));
  return { ts: now, machines };
}

function prune(snapshots: ActivitySnapshot[], now: number): ActivitySnapshot[] {
  const cutoff = now - WINDOW_MS;
  const kept = snapshots.filter((s) => s.ts >= cutoff);
  return kept.length > MAX_SNAPSHOTS
    ? kept.slice(kept.length - MAX_SNAPSHOTS)
    : kept;
}

/**
 * Append `snapshot` to the timeline (throttled + pruned + CAS). Returns whether
 * a write actually happened (false = throttled because the last snapshot is
 * recent). Best-effort: callers treat a thrown error as non-fatal.
 */
export async function recordSnapshot(
  octokit: Octokit,
  owner: string,
  repo: string,
  snapshot: ActivitySnapshot,
): Promise<{ recorded: boolean }> {
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const { file, sha } = await fetchFile(octokit, owner, repo);
    if (!snapshotDue(file, snapshot.ts)) {
      return { recorded: false };
    }
    const next: FlyActivityFile = {
      version: 1,
      snapshots: prune([...file.snapshots, snapshot], snapshot.ts),
    };
    try {
      await writeStateText({
        octokit,
        owner,
        repo,
        path: ACTIVITY_FILE_PATH,
        message: "chore(fly): record machine activity snapshot",
        content: JSON.stringify(next),
        sha,
      });
      return { recorded: true };
    } catch (err) {
      if ((err as { status?: number })?.status === 409) continue; // CAS retry
      throw err;
    }
  }
  logger.warn({ owner, repo }, "fly-activity: snapshot write lost CAS race");
  return { recorded: false };
}
