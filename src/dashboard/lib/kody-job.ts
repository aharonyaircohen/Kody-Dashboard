/**
 * @fileType model
 * @domain kody
 * @pattern engine-mirror
 * @ai-summary The dashboard's mirror of the engine's `Job` — the unified
 * execution unit. A job ASSEMBLES the reusable nouns into one runnable thing:
 *   - executable (HOW)  · duty (WHY, by slug)  · persona/staff (WHO)
 *   - schedule (WHEN)   · target (issue/PR)    · cliArgs · flavor · force
 *
 * This type is a verbatim mirror of `Job` in the kody engine — keep them in
 * lockstep. Source of truth:
 *   kody2/src/executables/types.ts:457-479  (Job interface)
 *   kody2/src/job.ts:46-74                   (validateJob boundary rules)
 *   kody2/src/job.ts:153-192                 (mintInstantJob / mintScheduledJob)
 *
 * The engine validates that a job names at least one of `executable` or `duty`,
 * has a known `flavor`, and carries an object `cliArgs` (defaulting to `{}`).
 * `validateKodyJob` below reproduces those exact rules so the composer can't
 * build a job the engine would reject.
 */

/** Run once now (`@kody`) or on a cron cadence (the tick path). */
export type KodyJobFlavor = "instant" | "scheduled";

/** Mirror of the engine `Job` (kody2/src/executables/types.ts:457). */
export interface KodyJob {
  /** HOW: executable (profile) name to run. Omitted for agent-only intent. */
  executable?: string;
  /** WHY (referenced): a duty slug whose intent drives the run. */
  duty?: string;
  /** WHY (inline): free-text intent, e.g. an `@kody` comment body. */
  why?: string;
  /** WHO: a staff persona slug. */
  persona?: string;
  /** WHEN: cron expression. Set for scheduled jobs, absent for instant. */
  schedule?: string;
  /** The issue/PR number this job acts on, when applicable. */
  target?: number;
  /** Args passed through to the executable. */
  cliArgs: Record<string, unknown>;
  /** Run once now ("instant") or on the schedule ("scheduled"). */
  flavor: KodyJobFlavor;
  /** Manual force-run (bypass cadence) for a scheduled job. */
  force?: boolean;
}

/** Thrown when a composed job fails the engine's boundary rules. */
export class InvalidKodyJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKodyJobError";
  }
}

/**
 * Validate + normalize a composed job at the boundary — a faithful port of the
 * engine's `validateJob` (kody2/src/job.ts:46). A job must reference an
 * executable OR a duty, declare a known flavor, and (if present) carry an
 * object `cliArgs`; unknown/empty optionals collapse to `undefined`/`{}`.
 */
export function validateKodyJob(input: unknown): KodyJob {
  if (!input || typeof input !== "object") {
    throw new InvalidKodyJobError("job must be an object");
  }
  const j = input as Record<string, unknown>;
  if (typeof j.executable !== "string" && typeof j.duty !== "string") {
    throw new InvalidKodyJobError("job must reference an executable or a duty");
  }
  if (j.flavor !== "instant" && j.flavor !== "scheduled") {
    throw new InvalidKodyJobError(
      `job.flavor must be "instant" or "scheduled" (got ${String(j.flavor)})`,
    );
  }
  if (
    j.cliArgs !== undefined &&
    (typeof j.cliArgs !== "object" || j.cliArgs === null)
  ) {
    throw new InvalidKodyJobError("job.cliArgs must be an object when present");
  }
  return {
    executable: typeof j.executable === "string" ? j.executable : undefined,
    duty: typeof j.duty === "string" ? j.duty : undefined,
    why: typeof j.why === "string" && j.why.length > 0 ? j.why : undefined,
    persona: typeof j.persona === "string" ? j.persona : undefined,
    schedule: typeof j.schedule === "string" ? j.schedule : undefined,
    target: typeof j.target === "number" ? j.target : undefined,
    cliArgs: (j.cliArgs as Record<string, unknown> | undefined) ?? {},
    flavor: j.flavor,
    force: j.force === true,
  };
}

/** The executable the engine actually runs: `executable ?? duty` (job.ts:106). */
export function resolveJobProfile(job: KodyJob): string | undefined {
  return job.executable ?? job.duty;
}

/**
 * Render an INSTANT job as the `@kody` dispatch comment the engine resolves —
 * the same path the executable "Run" button and chat tools use. `why` is
 * appended as free text (the engine surfaces it as the operator request).
 * Scheduled jobs are not dispatched this way; they persist as a duty file.
 */
export function renderInstantJobComment(job: KodyJob): string {
  const verb = resolveJobProfile(job);
  const why = job.why?.trim();
  return `@kody ${verb}${why ? ` ${why}` : ""}`;
}
