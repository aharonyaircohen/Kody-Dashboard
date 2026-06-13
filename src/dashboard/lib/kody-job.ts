/**
 * @fileType model
 * @domain kody
 * @pattern engine-mirror
 * @ai-summary The dashboard's mirror of the engine's `Job` — the unified
 * execution unit. A job ASSEMBLES the reusable nouns into one runnable thing:
 *   - duty (public action/WHY) · executable (HOW) · persona/staff (WHO)
 *   - schedule (WHEN)   · target (issue/PR)    · cliArgs · flavor · force
 *
 * Kody now dispatches duties only. An executable can still be linked as the
 * implementation, but it cannot be the public run target by itself.
 */

/** Run once now (`@kody`) or on a cron cadence (the tick path). */
export type KodyJobFlavor = "instant" | "scheduled";

/** Mirror of the engine `Job` (kody2/src/executables/types.ts:457). */
export interface KodyJob {
  /** HOW: implementation executable linked by the duty. Not a run target. */
  executable?: string;
  /** Public duty slug/action whose intent drives the run. Required. */
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

function isValidDutySlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

/**
 * Validate + normalize a composed job at the boundary. A dashboard-created job
 * must reference a duty, declare a known flavor, and carry object cliArgs.
 */
export function validateKodyJob(input: unknown): KodyJob {
  if (!input || typeof input !== "object") {
    throw new InvalidKodyJobError("job must be an object");
  }
  const j = input as Record<string, unknown>;
  if (typeof j.duty !== "string" || j.duty.trim().length === 0) {
    throw new InvalidKodyJobError("job must reference a duty");
  }
  if (!isValidDutySlug(j.duty)) {
    throw new InvalidKodyJobError("job.duty must be a valid duty slug");
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
    duty: j.duty,
    why: typeof j.why === "string" && j.why.length > 0 ? j.why : undefined,
    persona: typeof j.persona === "string" ? j.persona : undefined,
    schedule: typeof j.schedule === "string" ? j.schedule : undefined,
    target: typeof j.target === "number" ? j.target : undefined,
    cliArgs: (j.cliArgs as Record<string, unknown> | undefined) ?? {},
    flavor: j.flavor,
    force: j.force === true,
  };
}

/** The public action the dashboard dispatches. It is always the duty. */
export function resolveJobProfile(job: KodyJob): string | undefined {
  return job.duty;
}

/**
 * Render an INSTANT job as the `@kody` dispatch comment the engine resolves.
 * `why` is appended as free text.
 * Scheduled jobs are not dispatched this way; they persist as a duty folder.
 */
export function renderInstantJobComment(job: KodyJob): string {
  const verb = resolveJobProfile(job);
  const why = job.why?.trim();
  return `@kody ${verb}${why ? ` ${why}` : ""}`;
}
