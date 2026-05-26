/**
 * @fileType utility
 * @domain runners
 * @pattern actions-health-probe
 * @ai-summary Decides whether GitHub Actions is healthy enough to take a job.
 *   Two signals: (1) GitHub's public status page lists the "Actions" component
 *   as operational, and (2) the kody.yml run queue isn't backed up past a
 *   threshold. BOTH probes fail OPEN (assume healthy) so a status-page hiccup
 *   or a transient list error never wrongly diverts every job to Fly. The
 *   status result is cached 30s (shared across requests) so we don't hammer
 *   the status endpoint on every dispatch.
 */
import { logger } from "@dashboard/lib/logger";

const STATUS_URL = "https://www.githubstatus.com/api/v2/components.json";
const STATUS_CACHE_TTL_MS = 30_000;

/** Default queue depth at which we consider GitHub Actions "full". */
export const DEFAULT_QUEUE_THRESHOLD = 10;

export interface GitHubActionsHealth {
  /** True when GitHub Actions is operational AND the queue isn't full. */
  healthy: boolean;
  /** GitHub's status page reports the Actions component as not operational. */
  statusDegraded: boolean;
  /** Number of queued kody.yml runs (0 if the count couldn't be read). */
  queuedCount: number;
  /** queuedCount >= threshold. */
  queueFull: boolean;
  /** Human-readable summary for logs / API responses. */
  reason: string;
}

interface StatusProbe {
  degraded: boolean;
  label: string;
}

let statusCache: { probe: StatusProbe; expiresAt: number } | null = null;

/** Test seam: clear the shared 30s status cache between tests. */
export function _resetActionsHealthCacheForTests(): void {
  statusCache = null;
}

/**
 * Probe GitHub's status page for the "Actions" component. Fails open
 * (degraded:false) on any HTTP/parse error — a status-page outage must not
 * divert real traffic. Only a successful "operational" or explicit non-
 * operational result is cached; fail-open results are not, so we retry soon.
 */
export async function probeActionsStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<StatusProbe> {
  if (statusCache && statusCache.expiresAt > Date.now())
    return statusCache.probe;
  try {
    const res = await fetchImpl(STATUS_URL, {
      headers: { "User-Agent": "kody-dashboard" },
    });
    if (!res.ok) return { degraded: false, label: `http_${res.status}` };
    const body = (await res.json()) as {
      components?: Array<{ name?: string; status?: string }>;
    };
    const actions = (body.components ?? []).find(
      (c) => (c.name ?? "").trim().toLowerCase() === "actions",
    );
    const label = actions?.status ?? "unknown";
    const degraded = !!actions && label !== "operational";
    const probe = { degraded, label };
    statusCache = { probe, expiresAt: Date.now() + STATUS_CACHE_TTL_MS };
    return probe;
  } catch (err) {
    logger.warn(
      {
        event: "actions_status_probe_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      "GitHub status probe failed — assuming operational",
    );
    return { degraded: false, label: "probe_error" };
  }
}

/**
 * Combine the status probe and the queued-run count into a single health
 * verdict. `countQueuedRuns` is injected (the route wraps a workflow-runs
 * list call) so this is testable without network.
 */
export async function checkGitHubActionsHealth(deps: {
  countQueuedRuns: () => Promise<number>;
  fetchImpl?: typeof fetch;
  queueThreshold?: number;
}): Promise<GitHubActionsHealth> {
  const threshold = deps.queueThreshold ?? DEFAULT_QUEUE_THRESHOLD;
  const [status, queuedCount] = await Promise.all([
    probeActionsStatus(deps.fetchImpl ?? fetch),
    safeCount(deps.countQueuedRuns),
  ]);

  const queueFull = queuedCount >= threshold;
  const healthy = !status.degraded && !queueFull;
  const reason = status.degraded
    ? `actions status ${status.label}`
    : queueFull
      ? `queue full (${queuedCount} ≥ ${threshold})`
      : `healthy (status ${status.label}, ${queuedCount} queued)`;

  return {
    healthy,
    statusDegraded: status.degraded,
    queuedCount,
    queueFull,
    reason,
  };
}

/**
 * Count queued runs, failing open to 0 (treat as "not full"). A failed count
 * is ambiguous — we let the status probe be the authority on outages and
 * don't divert to Fly just because one list call hiccuped.
 */
async function safeCount(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    logger.warn(
      {
        event: "queued_runs_count_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      "Queued-runs count failed — treating as 0",
    );
    return 0;
  }
}
