/**
 * @fileType utility
 * @domain kody
 * @pattern canonical-state-reader
 * @ai-summary Parses the canonical kody TaskState JSON embedded in a sentinel-bracketed
 * issue comment. Mirrors the producer schema in kody-engine's src/state.ts (TaskState).
 *
 * The state comment is the SOURCE OF TRUTH for a kody-managed task. Labels and
 * workflow run statuses are projections of it that can drift; this parser reads
 * the canonical JSON so the dashboard never needs to derive status from those.
 */

export const STATE_BEGIN = "<!-- kody:state:v1:begin -->";
export const STATE_END = "<!-- kody:state:v1:end -->";

export type KodyPhase =
  | "idle"
  | "research"
  | "planning"
  | "implementing"
  | "reviewing"
  | "shipped"
  | "failed";

export type KodyStatus = "pending" | "running" | "succeeded" | "failed";

/** How a job was triggered: an instant `@kody` run vs a scheduled (cron) run. */
export type KodyJobFlavor = "instant" | "scheduled";

export interface KodyAction {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * One job in the task's ledger — the durable record a single engine run leaves
 * behind. Mirrors `HistoryEntry` in kody-engine's src/state.ts. A task IS the
 * ordered list of these entries plus the rolled-up `core` state; each run
 * appends exactly one (a re-run is a NEW entry, never a mutation of a prior one).
 */
export interface KodyHistoryEntry {
  timestamp: string;
  executable: string;
  action: string;
  note?: string;
  /** Staff member this run executed as, when the duty declares one. */
  staff?: string;
  /** Stable id for this job run (CI run id in Actions, else a stamp). */
  jobId?: string;
  /** Whether this run was an instant (`@kody`) or scheduled (cron) job. */
  flavor?: KodyJobFlavor;
  /** Cadence this scheduled job fired on (the duty's `every`/cron). */
  schedule?: string;
  /** This job's outcome at the time the entry was written. */
  status?: KodyStatus;
  /** Link to the run (GitHub Actions run URL) when available. */
  runUrl?: string;
}

/**
 * One PLANNED job in the task's run plan — a future engine run the orchestrator
 * has already queued (e.g. a follow-up PR-review executable after the
 * implementation lands). Mirrors the engine's `PlannedJob` shape; the
 * `status` is the engine's own per-job status, not the task's overall status.
 * Used by the Runs tab to show what's queued alongside what's already run.
 */
export interface KodyPlannedJob {
  /** Engine executable name (e.g. "qa-verify", "plan"). */
  executable: string;
  /** Optional human-readable why / intent. */
  why?: string;
  /** Per-job status from the engine (distinct from the task's overall status). */
  status?: "pending" | "running" | "succeeded" | "failed" | "skipped";
  /** Link to the run when the job has been dispatched. */
  runUrl?: string;
  /** Link to the PR this job targets, when known. */
  prUrl?: string;
  /** Wall-clock when this planned job was added to the plan. */
  timestamp?: string;
  /** Stable job id when one has been minted by the engine. */
  jobId?: string;
}

export interface KodyTaskState {
  schemaVersion: 1;
  core: {
    phase: KodyPhase;
    status: KodyStatus;
    currentExecutable: string | null;
    lastOutcome: KodyAction | null;
    attempts: Record<string, number>;
    prUrl?: string;
    runUrl?: string;
    /** Staff persona the most recent run executed as, when declared. */
    ranAsStaff?: string | null;
  };
  /** Ordered run-history: one job entry per engine run on this issue/PR. */
  history: KodyHistoryEntry[];
  /**
   * Planned future jobs the orchestrator has queued (e.g. a follow-up
   * qa-verify after the implementation PR opens). The Runs tab shows
   * these alongside `history` so users can see what's still to come.
   * Absent on legacy state comments (older engines didn't write it) —
   * readers must default to an empty array.
   */
  jobs?: KodyPlannedJob[];
}

/**
 * Extract the canonical TaskState JSON from an issue comment body. Returns null
 * when the comment does not contain a valid state block (legacy comments, the
 * agent's own progress comments, etc.).
 */
export function parseKodyStateComment(body: string): KodyTaskState | null {
  if (!body || !body.includes(STATE_BEGIN)) return null;

  const beginIdx = body.indexOf(STATE_BEGIN);
  const endIdx = body.lastIndexOf(STATE_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) return null;

  const between = body.slice(beginIdx + STATE_BEGIN.length, endIdx).trim();
  const OPEN = "```json";
  const CLOSE = "```";
  if (!between.startsWith(OPEN) || !between.endsWith(CLOSE)) return null;
  const jsonStr = between
    .slice(OPEN.length, between.length - CLOSE.length)
    .trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<KodyTaskState>;
    if (parsed?.schemaVersion !== 1) return null;
    if (!parsed.core) return null;
    return {
      schemaVersion: 1,
      core: {
        phase: parsed.core.phase ?? "idle",
        status: parsed.core.status ?? "pending",
        currentExecutable: parsed.core.currentExecutable ?? null,
        lastOutcome: parsed.core.lastOutcome ?? null,
        attempts: parsed.core.attempts ?? {},
        prUrl: parsed.core.prUrl,
        runUrl: parsed.core.runUrl,
        ranAsStaff: parsed.core.ranAsStaff ?? null,
      },
      history: Array.isArray(parsed.history)
        ? parsed.history.filter(
            (e): e is KodyHistoryEntry =>
              !!e && typeof e.timestamp === "string",
          )
        : [],
      // The engine may or may not have written `jobs`; older comments
      // predate the field. Preserve whatever the producer emitted (or
      // default to `[]` when absent so callers can iterate freely).
      jobs: Array.isArray(parsed.jobs)
        ? parsed.jobs.filter(
            (j): j is KodyPlannedJob => !!j && typeof j.executable === "string",
          )
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Find the kody-owned state comment in a list and return its parsed state.
 *
 * Multiple state comments are not expected, but they DO occur: a re-classify
 * (or a self-dispatch retry) can post a fresh state comment while the engine's
 * canonical comment is edited in place. When that happens the duplicate is
 * usually created *after* the canonical one but is stale, so picking "last in
 * the list" (creation order) returns the wrong, older state — the symptom was
 * a finished task flapping back to "running". We therefore pick the comment
 * with the newest `updated_at` (the engine bumps it on every in-place edit),
 * falling back to `created_at`, then to list position when no timestamps are
 * available (e.g. unit-test fixtures).
 */
export function findKodyStateInComments(
  comments: Array<{ body: string; updated_at?: string; created_at?: string }>,
): KodyTaskState | null {
  let best: { state: KodyTaskState; ts: number; idx: number } | null = null;
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const state = parseKodyStateComment(c.body);
    if (!state) continue;
    const ts = Date.parse(c.updated_at ?? c.created_at ?? "");
    // No usable timestamp → fall back to creation order (later index wins),
    // preserving the previous behaviour for fixtures lacking timestamps.
    const score = Number.isNaN(ts) ? i : ts;
    if (!best || score >= best.ts) best = { state, ts: score, idx: i };
  }
  return best?.state ?? null;
}
