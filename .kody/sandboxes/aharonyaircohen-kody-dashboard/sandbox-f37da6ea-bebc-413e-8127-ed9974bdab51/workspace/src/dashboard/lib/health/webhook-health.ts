/**
 * @fileType utility
 * @domain kody
 * @pattern health-probe-webhook
 * @ai-summary Probes whether GitHub is successfully delivering webhooks to the
 *   dashboard. If deliveries fail (non-2xx), push-based cache invalidation and
 *   inbox/notification writes silently stop — the dashboard goes stale with no
 *   error anywhere. Reads the repo hook's recent deliveries (1 list + 1
 *   deliveries call, cached 5 min so it never threatens the rate budget) and
 *   summarizes the recent success rate. Pure classifier + thin fetcher.
 */
import type { Octokit } from "@octokit/rest";
import type { HealthSignal } from "./types";

const CACHE_TTL_MS = 5 * 60 * 1000;
const SAMPLE = 20; // last N deliveries to judge

const cache = new Map<string, { signal: HealthSignal; expiresAt: number }>();

interface DeliveryLite {
  status_code?: number;
  status?: string;
}

/**
 * Classify a sample of recent deliveries. Pure — unit-tested.
 *  - no hook            ⇒ degraded: dashboard relies on polling only.
 *  - no deliveries      ⇒ ok: nothing to judge yet.
 *  - all recent failed  ⇒ down.
 *  - some failed        ⇒ degraded.
 *  - all ok             ⇒ ok.
 */
export function classifyDeliveries(
  hookFound: boolean,
  deliveries: readonly DeliveryLite[],
): { level: HealthSignal["level"]; detail: string } {
  if (!hookFound) {
    return {
      level: "degraded",
      detail:
        "No GitHub webhook registered — the dashboard falls back to slower polling.",
    };
  }
  if (deliveries.length === 0) {
    return {
      level: "ok",
      detail: "Webhook registered; no recent deliveries to judge.",
    };
  }
  const failed = deliveries.filter(
    (d) => typeof d.status_code === "number" && d.status_code >= 400,
  ).length;
  const total = deliveries.length;
  if (failed === total) {
    return {
      level: "down",
      detail: `All ${total} recent webhook deliveries failed — push updates aren't reaching the dashboard.`,
    };
  }
  if (failed > 0) {
    return {
      level: "degraded",
      detail: `${failed} of the last ${total} webhook deliveries failed.`,
    };
  }
  return { level: "ok", detail: `Last ${total} webhook deliveries succeeded.` };
}

export async function probeWebhookHealth(
  octokit: Octokit,
  owner: string,
  repo: string,
  dashboardUrlHint?: string,
): Promise<HealthSignal> {
  const base: Pick<HealthSignal, "id" | "label"> = {
    id: "webhook",
    label: "GitHub webhook",
  };
  const key = `${owner}/${repo}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.signal;

  let signal: HealthSignal;
  try {
    const { data: hooks } = await octokit.rest.repos.listWebhooks({
      owner,
      repo,
      per_page: 100,
    });
    // Prefer the hook pointing at our dashboard receiver; else the first active one.
    const hook =
      hooks.find((h) =>
        dashboardUrlHint
          ? (h.config?.url ?? "").includes(dashboardUrlHint)
          : (h.config?.url ?? "").includes("/api/webhooks/github"),
      ) ?? hooks.find((h) => h.active);
    if (!hook) {
      signal = { ...base, ...classifyDeliveries(false, []) };
    } else {
      const { data: deliveries } = await octokit.request(
        "GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries",
        { owner, repo, hook_id: hook.id, per_page: SAMPLE },
      );
      signal = {
        ...base,
        ...classifyDeliveries(true, deliveries as DeliveryLite[]),
        url: hook.config?.url ?? undefined,
      };
    }
  } catch {
    signal = {
      ...base,
      level: "degraded",
      detail: "Could not read webhook delivery history.",
    };
  }

  cache.set(key, { signal, expiresAt: Date.now() + CACHE_TTL_MS });
  return signal;
}

/** Test-only: clear the module-level delivery cache. */
export function __resetWebhookCache(): void {
  cache.clear();
}
