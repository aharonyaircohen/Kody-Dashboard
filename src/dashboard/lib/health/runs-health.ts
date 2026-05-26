/**
 * @fileType utility
 * @domain kody
 * @pattern health-probe-runs
 * @ai-summary Derives a health signal from the engine's recent kody.yml runs
 *   (the same already-cached workflow-run data the Activity view uses — no
 *   extra GitHub budget). Catches two silent failures the run *list* shows but
 *   nobody watches: a failing streak (the last K runs all failed → something
 *   is broken end-to-end) and silence (no run at all in the expected window →
 *   triggers are being dropped, e.g. during a GitHub Actions outage). Pure.
 */
import type { HealthSignal } from "./types";

/** Minimal run shape this probe needs (subset of ActivityRun). */
export interface RunLite {
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  createdAt: string;
}

const SILENCE_WINDOW_MS = 60 * 60 * 1000; // expect at least one run per hour (15-min schedule)
const STREAK_LEN = 3; // K consecutive failures ⇒ broken

/** A completed run that actually failed (not skipped/cancelled/neutral). */
function isFailure(r: RunLite): boolean {
  return r.status === "completed" && r.conclusion === "failure";
}
function isSuccess(r: RunLite): boolean {
  return r.status === "completed" && r.conclusion === "success";
}

/**
 * Build the runs HealthSignal. Pure — unit-tested.
 *  - no run in the last hour      ⇒ degraded (silence / dropped triggers).
 *  - last K completed all failed  ⇒ down (engine broken end-to-end).
 *  - otherwise                    ⇒ ok.
 */
export function buildRunsSignal(
  runs: readonly RunLite[],
  now: number,
): HealthSignal {
  const base: Pick<HealthSignal, "id" | "label"> = {
    id: "engine-runs",
    label: "Engine runs",
  };

  if (runs.length === 0) {
    return { ...base, level: "degraded", detail: "No engine runs found yet." };
  }

  const newestMs = Math.max(
    ...runs.map((r) => new Date(r.createdAt).getTime()),
  );
  const sinceMin = Math.round((now - newestMs) / 60_000);

  // Failing streak over the most recent completed runs.
  const completed = runs
    .filter((r) => r.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const recent = completed.slice(0, STREAK_LEN);
  if (recent.length >= STREAK_LEN && recent.every(isFailure)) {
    return {
      ...base,
      level: "down",
      detail: `Last ${STREAK_LEN} engine runs all failed — runs aren't completing successfully.`,
      at: new Date(newestMs).toISOString(),
    };
  }

  if (now - newestMs > SILENCE_WINDOW_MS) {
    return {
      ...base,
      level: "degraded",
      detail: `No engine run in ${sinceMin} min (expected one within the hour) — triggers may be dropping.`,
      at: new Date(newestMs).toISOString(),
    };
  }

  const lastSuccess = completed.find(isSuccess);
  return {
    ...base,
    level: "ok",
    detail: lastSuccess
      ? `Last successful run ${Math.round((now - new Date(lastSuccess.createdAt).getTime()) / 60_000)} min ago.`
      : "Engine runs are firing.",
    at: new Date(newestMs).toISOString(),
  };
}
