/**
 * @fileType library
 * @domain runners
 * @pattern warm-pool-client
 * @ai-summary Warm pool accelerator: claimFromPool NEVER throws — returns
 *   {ok:false} on any failure so the caller always falls back to spawnRunner.
 *   Secrets never cross the wire; the pool resolves them from the repo vault
 *   server-side. 20s timeout prevents a slow pool from stalling the request.
 *
 * Auth: Bearer the derived POOL_API_KEY (see pool-keys.ts) — never stored or
 * transmitted; both sides derive it from KODY_MASTER_KEY.
 *
 * Design contract: claimFromPool NEVER throws. On any failure (no master key,
 * missing FLY_POOL_URL, pool unreachable, empty pool → 503) it returns
 * { ok: false }, and the caller falls back to the existing create-fresh
 * `spawnRunner`. The pool is an accelerator, not a hard dependency.
 */
import { logger } from "@dashboard/lib/logger";
import { derivePoolApiKey } from "@dashboard/lib/runners/pool-keys";

function poolBaseUrl(): string | null {
  const raw = process.env.FLY_POOL_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * Slim claim request — carries NO secrets. The pool owner resolves the repo's
 * Fly token + provider keys from that repo's vault and uses the operator
 * GitHub token to clone, so secrets reach the runner via the vault, never over
 * the wire (matches the dashboard's repo-scoped model).
 */
export interface PoolJob {
  jobId: string;
  /** owner/name */
  repo: string;
  /** "issue" (one-shot run, default) | "interactive" (long-lived chat runner). */
  mode?: "issue" | "interactive";
  /** Required for issue mode. */
  issueNumber?: number;
  /** Required for interactive mode (the chat session id). */
  sessionId?: string;
  idleExitMs?: number;
  hardCapMs?: number;
  ref?: string;
  model?: string;
  /**
   * Thinking level for the chat runner (off|low|medium|high). Forwarded
   * to the engine via the REASONING_EFFORT env var on the claimed
   * machine. Pool-side support depends on the pool server version;
   * unknown values are ignored, matching the kody.yml workflow's
   * behavior for unknown inputs.
   */
  reasoningEffort?: string;
  /** Event-ingest URL (interactive runner streams chat events here). */
  dashboardUrl?: string;
}

export type ClaimOutcome =
  | { ok: true; machineId: string }
  | { ok: false; reason: string };

/**
 * Try to claim a warm machine for an agent (issue) job. Returns ok:false on
 * any problem so the caller can fall back to create-fresh. Bounded by a short
 * timeout — a slow pool must not stall the execute request.
 */
export async function claimFromPool(job: PoolJob): Promise<ClaimOutcome> {
  const apiKey = derivePoolApiKey();
  if (!apiKey) return { ok: false, reason: "no master key" };
  const baseUrl = poolBaseUrl();
  if (!baseUrl) return { ok: false, reason: "pool url not configured" };

  const url = `${baseUrl}/pool/claim`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as {
        machineId?: string;
      };
      if (body.machineId) return { ok: true, machineId: body.machineId };
      return { ok: false, reason: "pool returned no machineId" };
    }
    // 503 = pool empty/unhealthy (expected; fall back). Others are unexpected.
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    return { ok: false, reason: body.reason ?? `pool HTTP ${res.status}` };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, url },
      "pool claim failed — falling back to create-fresh",
    );
    return { ok: false, reason };
  }
}

export interface PoolStatus {
  min: number;
  free: number;
  booting: number;
  claimsInFlight: number;
  total: number;
}

/**
 * Read-only pool counts for one repo (pools are per-repo). null when
 * unreachable/unconfigured or the repo has no pool yet.
 */
export async function fetchPoolStatus(
  owner: string,
  repo: string,
): Promise<PoolStatus | null> {
  const apiKey = derivePoolApiKey();
  if (!apiKey || !owner || !repo) return null;
  const baseUrl = poolBaseUrl();
  if (!baseUrl) return null;
  try {
    const url = `${baseUrl}/pool/status?repo=${encodeURIComponent(`${owner}/${repo}`)}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { status: PoolStatus | null };
    return body.status ?? null;
  } catch {
    return null;
  }
}
