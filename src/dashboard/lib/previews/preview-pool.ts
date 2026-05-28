/**
 * @fileType library
 * @domain previews
 * @pattern warm-pool-client
 *
 * Dashboard-side client for the preview warm pool. Mirrors the runner
 * pool pattern (runners/pool-client.ts) — separate endpoint, same
 * fall-back-cleanly-when-unavailable contract.
 *
 * The owner (preview-pool-serve) is expected to live on the same Fly
 * machine as the litellm proxy + runner pool owner. It manages N
 * pre-booted, suspended Fly machines per repo running a generic Next.js
 * base image. `claimPreviewFromPool` asks the owner to:
 *   1. Pick a free suspended machine
 *   2. Swap its image config to the PR's just-built image
 *   3. Unfreeze + rename the parent app to the PR-keyed name
 *   4. Return the machine id and public URL
 *
 * Result: time-to-URL drops from ~40s (create-fresh) to ~3s (pool path).
 *
 * Contract: NEVER throws. On any failure (no master key, owner
 * unreachable, empty pool → 503) returns { ok:false } and the caller
 * falls back to the create-fresh path in `preview-lifecycle.ts`. The
 * pool is an accelerator, not a hard dependency.
 */

import { logger } from "@dashboard/lib/logger";
import { derivePoolApiKey } from "@dashboard/lib/runners/pool-keys";

const DEFAULT_POOL_URL = "https://kody-litellm.fly.dev";

function poolBaseUrl(): string {
  return (process.env.FLY_POOL_URL ?? DEFAULT_POOL_URL).replace(/\/+$/, "");
}

export interface PreviewClaimInput {
  /** owner/name */
  repo: string;
  pr: number;
  /** OCI image to swap into the claimed machine. */
  image: string;
  /** Internal port the image listens on (default 8080). */
  internalPort?: number;
  env?: Record<string, string>;
}

export type PreviewClaimOutcome =
  | { ok: true; appName: string; url: string; machineId: string }
  | { ok: false; reason: string };

/**
 * Try to grab a warm preview from the pool. Returns ok:false on any
 * problem so the caller falls back to create-fresh.
 */
export async function claimPreviewFromPool(
  input: PreviewClaimInput,
): Promise<PreviewClaimOutcome> {
  const apiKey = derivePoolApiKey();
  if (!apiKey) return { ok: false, reason: "no master key" };

  const url = `${poolBaseUrl()}/preview-pool/claim`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as {
        appName?: string;
        url?: string;
        machineId?: string;
      };
      if (body.appName && body.url && body.machineId) {
        return {
          ok: true,
          appName: body.appName,
          url: body.url,
          machineId: body.machineId,
        };
      }
      return { ok: false, reason: "preview pool returned incomplete body" };
    }
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    return {
      ok: false,
      reason: body.reason ?? `preview pool HTTP ${res.status}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, url },
      "preview pool claim failed — falling back to create-fresh",
    );
    return { ok: false, reason };
  }
}

/**
 * Tell the pool to return a destroyed-app's slot to the warm pool (so
 * we don't actually destroy the machine — just wipe state and re-suspend).
 * Like claim, never throws.
 */
export async function releasePreviewToPool(
  repo: string,
  pr: number,
): Promise<void> {
  const apiKey = derivePoolApiKey();
  if (!apiKey) return;
  const url = `${poolBaseUrl()}/preview-pool/release`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ repo, pr }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.warn({ err, url }, "preview pool release failed (non-fatal)");
  }
}
