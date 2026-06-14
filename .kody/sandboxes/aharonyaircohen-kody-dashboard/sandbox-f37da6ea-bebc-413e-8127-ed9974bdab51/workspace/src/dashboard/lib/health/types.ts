/**
 * @fileType utility
 * @domain kody
 * @pattern health-types
 * @ai-summary Shapes for the dashboard Health banner — the "can runs even
 *   start, and are their dependencies healthy?" panel that sits above the
 *   Activity view. Distinct from ActivitySnapshot: that view reports runs
 *   that already happened; Health reports the *upstream* failures (GitHub
 *   Actions outage, a throttled token, a dead model key, failing webhooks)
 *   that stop runs from ever appearing — the silent blockers you can't see
 *   in a run list.
 */

/** Green / amber / red. `down` blocks runs; `degraded` still works but is at risk. */
export type HealthLevel = "ok" | "degraded" | "down";

/** One probed dependency (GitHub Actions, the token, the vault, …). */
export interface HealthSignal {
  /** Stable id, e.g. "github-actions", "token", "model". */
  id: string;
  /** Human label shown in the banner row. */
  label: string;
  level: HealthLevel;
  /** One-line plain-language explanation of the current state. */
  detail: string;
  /** Optional external link for "see more" (status page, run, settings). */
  url?: string;
  /** Optional ISO timestamp this specific signal refers to. */
  at?: string;
}

export interface HealthReport {
  /** Worst level across all signals (down > degraded > ok). */
  level: HealthLevel;
  signals: HealthSignal[];
  /** ISO time the report was computed (server clock). */
  checkedAt: string;
}
