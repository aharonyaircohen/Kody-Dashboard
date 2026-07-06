/**
 * @fileType model
 * @domain kody
 * @pattern engine-mirror
 * @ai-summary The dashboard's mirror of the engine's `Job` — the unified
 * execution unit. A job ASSEMBLES the reusable nouns into one runnable thing:
 *   - capability (public action) · agent/agents (WHO)
 *   - schedule (WHEN)   · target (issue/PR)    · cliArgs · flavor · force
 */

/** Run once now (`@kody`) or on a cron cadence (the tick path). */
export type KodyJobFlavor = "instant" | "scheduled";

/** Mirror of the engine `Job` (kody2/src/implementations/types.ts:457). */
export interface KodyJob {
  /** Public capability slug/action whose intent drives the run. Required. */
  capability?: string;
  /** WHY (inline): free-text intent, e.g. an `@kody` comment body. */
  why?: string;
  /** WHO: an agentIdentity slug. */
  agent?: string;
  /** WHEN: cron expression. Set for scheduled jobs, absent for instant. */
  schedule?: string;
  /** The issue/PR number this job acts on, when applicable. */
  target?: number;
  /** Args passed through to the implementation. */
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

function isValidCapabilitySlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

/**
 * Validate + normalize a composed job at the boundary. A dashboard-created job
 * must reference a capability, declare a known flavor, and carry object cliArgs.
 */
export function validateKodyJob(input: unknown): KodyJob {
  if (!input || typeof input !== "object") {
    throw new InvalidKodyJobError("job must be an object");
  }
  const j = input as Record<string, unknown>;
  if (typeof j.capability !== "string" || j.capability.trim().length === 0) {
    throw new InvalidKodyJobError("job must reference a capability");
  }
  if (!isValidCapabilitySlug(j.capability)) {
    throw new InvalidKodyJobError(
      "job.capability must be a valid capability slug",
    );
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
    capability: j.capability,
    why: typeof j.why === "string" && j.why.length > 0 ? j.why : undefined,
    agent: typeof j.agent === "string" ? j.agent : undefined,
    schedule: typeof j.schedule === "string" ? j.schedule : undefined,
    target: typeof j.target === "number" ? j.target : undefined,
    cliArgs: (j.cliArgs as Record<string, unknown> | undefined) ?? {},
    flavor: j.flavor,
    force: j.force === true,
  };
}

/** The public action the dashboard dispatches. It is always the capability. */
export function resolveJobProfile(job: KodyJob): string | undefined {
  return job.capability;
}

/**
 * Render an INSTANT job as the `@kody` dispatch comment the engine resolves.
 * `why` is appended as free text.
 * Scheduled jobs are not dispatched this way; they persist as capability state.
 */
export function renderInstantJobComment(job: KodyJob): string {
  const verb = resolveJobProfile(job);
  const why = job.why?.trim();
  return `@kody ${verb}${why ? ` ${why}` : ""}`;
}
