/**
 * @fileType utility
 * @domain kody
 * @pattern health-dispatch-recorder
 * @ai-summary In-memory recorder for failed engine dispatches. When the
 *   dashboard asks GitHub to start a kody run (chat trigger, manual dispatch)
 *   and GitHub errors — e.g. the 500 seen during an Actions outage — there is
 *   no run to show in the Activity list, so the failure is invisible. The
 *   trigger route calls `recordDispatchFailure` on a non-2xx; the health probe
 *   reads the recent window. Per-instance + best-effort (a ring buffer, lost
 *   on cold start) — enough to surface "dispatch is failing right now" without
 *   adding a database.
 */
import type { HealthSignal } from "./types";

export interface DispatchFailure {
  at: number; // epoch ms
  status: number; // HTTP status from GitHub
  reason: string; // short message
}

const MAX = 50;
const WINDOW_MS = 15 * 60 * 1000; // only the last 15 min counts as "now"
const ring: DispatchFailure[] = [];

/** Record a failed dispatch. Cheap, never throws. */
export function recordDispatchFailure(status: number, reason: string): void {
  ring.push({ at: Date.now(), status, reason: reason.slice(0, 200) });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

/** Recent failures within the window (newest first). Exported for the probe + tests. */
export function recentDispatchFailures(
  now: number = Date.now(),
): DispatchFailure[] {
  return ring
    .filter((f) => now - f.at <= WINDOW_MS)
    .sort((a, b) => b.at - a.at);
}

/** Test-only reset. */
export function __resetDispatchFailures(): void {
  ring.length = 0;
}

/**
 * Build the dispatch HealthSignal from a recent-failure window. Pure given
 * its input. 1+ recent failures ⇒ degraded (the run may still have been
 * retried); a burst (3+) ⇒ down.
 */
export function buildDispatchSignal(
  recent: readonly DispatchFailure[],
): HealthSignal {
  const base: Pick<HealthSignal, "id" | "label"> = {
    id: "dispatch",
    label: "Run dispatch",
  };
  if (recent.length === 0) {
    return { ...base, level: "ok", detail: "No recent dispatch failures." };
  }
  const newest = recent[0]!;
  const level: HealthSignal["level"] = recent.length >= 3 ? "down" : "degraded";
  return {
    ...base,
    level,
    detail: `${recent.length} dispatch failure${recent.length === 1 ? "" : "s"} in the last 15 min (latest: HTTP ${newest.status} — ${newest.reason}).`,
    at: new Date(newest.at).toISOString(),
  };
}
