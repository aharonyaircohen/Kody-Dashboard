/**
 * @fileType utility
 * @domain kody
 * @pattern health-probe-github-status
 * @ai-summary Probes GitHub's own status page (githubstatus.com) for the
 *   Actions component. This is the signal that caught the real outage: when
 *   GitHub Actions is degraded/down, dispatches 500 and event triggers are
 *   dropped — runs never appear, with nothing on our side to fix. Fetches the
 *   public Statuspage JSON (no auth, no GitHub API budget) and caches 60s.
 */
import type { HealthSignal } from "./types";

const COMPONENTS_URL = "https://www.githubstatus.com/api/v2/components.json";
const CACHE_TTL_MS = 60_000;

interface StatuspageComponent {
  name?: string;
  status?: string;
}

let cache: { signal: HealthSignal; expiresAt: number } | null = null;

/**
 * Map a Statuspage component status string to our HealthLevel + message.
 * Pure — unit-tested against the documented status vocabulary.
 */
export function mapActionsComponentStatus(status: string | undefined): {
  level: HealthSignal["level"];
  detail: string;
} {
  switch (status) {
    case "operational":
      return { level: "ok", detail: "GitHub Actions is operational." };
    case "degraded_performance":
      return {
        level: "degraded",
        detail:
          "GitHub Actions is degraded — runs may start slowly or intermittently.",
      };
    case "partial_outage":
      return {
        level: "down",
        detail: "GitHub Actions has a partial outage — some runs won't start.",
      };
    case "major_outage":
      return {
        level: "down",
        detail: "GitHub Actions is down — new runs cannot start.",
      };
    case "under_maintenance":
      return {
        level: "degraded",
        detail: "GitHub Actions is under maintenance.",
      };
    default:
      // Unknown/missing status: don't cry wolf, but say we couldn't confirm.
      return {
        level: "ok",
        detail: "GitHub Actions status unknown (could not read status page).",
      };
  }
}

/** Find the "Actions" component in the Statuspage payload (case-insensitive). */
export function findActionsComponent(
  components: readonly StatuspageComponent[],
): StatuspageComponent | undefined {
  return components.find((c) => (c.name ?? "").toLowerCase() === "actions");
}

export async function probeGitHubActionsStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<HealthSignal> {
  if (cache && cache.expiresAt > Date.now()) return cache.signal;

  let signal: HealthSignal;
  try {
    const res = await fetchImpl(COMPONENTS_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { components?: StatuspageComponent[] };
    const actions = findActionsComponent(body.components ?? []);
    const mapped = mapActionsComponentStatus(actions?.status);
    signal = {
      id: "github-actions",
      label: "GitHub Actions",
      level: mapped.level,
      detail: mapped.detail,
      url: "https://www.githubstatus.com",
    };
  } catch {
    // Status page unreachable: treat as ok (don't manufacture an outage),
    // but note we couldn't confirm.
    signal = {
      id: "github-actions",
      label: "GitHub Actions",
      level: "ok",
      detail: "Could not reach GitHub's status page — assuming operational.",
      url: "https://www.githubstatus.com",
    };
  }

  cache = { signal, expiresAt: Date.now() + CACHE_TTL_MS };
  return signal;
}

/** Test-only: clear the module-level status cache. */
export function __resetGitHubStatusCache(): void {
  cache = null;
}
