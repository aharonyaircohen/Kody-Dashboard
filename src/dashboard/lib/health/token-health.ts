/**
 * @fileType utility
 * @domain kody
 * @pattern health-probe-token
 * @ai-summary Probes the GitHub token's rate-limit standing. This is the
 *   signal that would have caught the kodyade incident: a valid token whose
 *   core limit was forced down to 60/hr by abuse detection (the normal
 *   authenticated limit is 5,000). The /rate_limit endpoint is FREE — it does
 *   not consume the core budget — so this probe is safe to poll. A limit far
 *   below 5,000 means the account is flagged; a near-zero remaining means the
 *   window is exhausted.
 */
import type { HealthSignal } from "./types";

const RATE_LIMIT_URL = "https://api.github.com/rate_limit";
/** GitHub's standard authenticated core limit. Below this ⇒ flagged/anonymous. */
const HEALTHY_LIMIT = 5_000;
/** Warn when fewer than this many core requests remain in the window. */
const LOW_REMAINING = 200;

export interface CoreRateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Classify a core rate-limit reading. Pure — unit-tested.
 *  - limit < 5,000  ⇒ down: token flagged or treated as unauthenticated.
 *  - remaining 0    ⇒ down: window exhausted, calls are failing now.
 *  - remaining low  ⇒ degraded: about to run out.
 *  - otherwise      ⇒ ok.
 */
export function classifyRateLimit(core: CoreRateLimit): {
  level: HealthSignal["level"];
  detail: string;
} {
  const resetIso = new Date(core.reset * 1000).toISOString();
  if (core.limit < HEALTHY_LIMIT) {
    return {
      level: "down",
      detail:
        `Token limited to ${core.limit}/hr (normal is ${HEALTHY_LIMIT}). ` +
        "The account is flagged by GitHub abuse detection — switch tokens and contact GitHub Support.",
    };
  }
  if (core.remaining <= 0) {
    return {
      level: "down",
      detail: `Rate limit exhausted (0 of ${core.limit} left). Resets at ${resetIso}.`,
    };
  }
  if (core.remaining < LOW_REMAINING) {
    return {
      level: "degraded",
      detail: `Rate limit low: ${core.remaining} of ${core.limit} left. Resets at ${resetIso}.`,
    };
  }
  return {
    level: "ok",
    detail: `Token healthy: ${core.remaining} of ${core.limit} requests left this hour.`,
  };
}

export async function probeTokenHealth(
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthSignal> {
  const base: Pick<HealthSignal, "id" | "label"> = {
    id: "token",
    label: "GitHub token",
  };
  if (!token) {
    return {
      ...base,
      level: "down",
      detail: "No GitHub token available — reads and writes will fail.",
    };
  }
  try {
    const res = await fetchImpl(RATE_LIMIT_URL, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { resources?: { core?: CoreRateLimit } };
    const core = body.resources?.core;
    if (!core) throw new Error("no core resource");
    const mapped = classifyRateLimit(core);
    return { ...base, level: mapped.level, detail: mapped.detail, at: new Date(core.reset * 1000).toISOString() };
  } catch {
    return {
      ...base,
      level: "degraded",
      detail: "Could not read the token's rate-limit standing.",
    };
  }
}
