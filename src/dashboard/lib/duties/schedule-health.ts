/**
 * @fileType utility
 * @domain kody
 * @pattern duty-schedule-health
 * @ai-summary Pure interpretation of a duty's committed schedule state into
 *   a coarse health signal. The Duties page already shows raw "last run" /
 *   "next run" timestamps; this turns them into an actionable status —
 *   "overdue" (a scheduled duty whose next-eligible time passed well beyond
 *   the cron window), "never" (scheduled, old enough to have run, but no run
 *   proof is visible), or "skipped" (scheduled with no runner). No GitHub calls
 *   — operates on fields already present on every TickFile/duty.
 */
import { scheduleEveryToMs, type ScheduleEvery } from "../ticked/frontmatter";

export type DutyHealth =
  | "ok"
  | "overdue"
  | "never"
  | "manual"
  | "disabled"
  | "skipped";

export interface DutyHealthInput {
  /** Cadence; `null` = "every cron wake" (the engine's 15-minute cron). */
  schedule: ScheduleEvery | null;
  /** Last visible run proof, or null when none is visible. */
  lastTickAt: string | null;
  /** `data.nextEligibleISO` from the state file, or null. */
  nextEligibleAt: string | null;
  /** `disabled: true` in the duty profile; scheduler skips it. */
  disabled: boolean;
  /** Missing runner means the engine scheduler skips this duty. */
  runner?: string | null;
  /** Last commit time of the duty body/profile (proxy for "how long it's existed"). */
  updatedAt?: string | null;
}

/** The 15-minute cron plus jitter — don't cry "overdue" within one wake. */
const OVERDUE_GRACE_MS = 20 * 60 * 1000;
/** Cron cadence used when a duty declares no explicit `every`. */
const DEFAULT_CADENCE_MS = 15 * 60 * 1000;

/**
 * Coarse health for a scheduled duty. `disabled`/`manual` are descriptive,
 * not problems; `overdue`/`never` are the actionable ones.
 */
export function dutyScheduleHealth(
  d: DutyHealthInput,
  now: number,
): DutyHealth {
  if (d.disabled) return "disabled";
  if (d.schedule === "manual") return "manual";
  if (d.runner === null || d.runner === "") return "skipped";

  const cadenceMs = d.schedule
    ? scheduleEveryToMs(d.schedule)
    : DEFAULT_CADENCE_MS;

  if (!d.lastTickAt) {
    // No run proof. Only flag once it's existed long enough that it really
    // should have ticked — a freshly-created duty isn't sick.
    const created = d.updatedAt ? new Date(d.updatedAt).getTime() : now;
    if (Number.isNaN(created)) return "ok";
    return now - created > cadenceMs + OVERDUE_GRACE_MS ? "never" : "ok";
  }

  if (d.nextEligibleAt) {
    const due = new Date(d.nextEligibleAt).getTime();
    if (!Number.isNaN(due) && now - due > OVERDUE_GRACE_MS) return "overdue";
  }
  return "ok";
}

export interface DutyHealthSummary {
  overdue: number;
  never: number;
  skipped: number;
}

/** Roll up the actionable states across a list of duties. */
export function summarizeDutyHealth(
  duties: DutyHealthInput[],
  now: number,
): DutyHealthSummary {
  let overdue = 0;
  let never = 0;
  let skipped = 0;
  for (const d of duties) {
    const h = dutyScheduleHealth(d, now);
    if (h === "overdue") overdue += 1;
    else if (h === "never") never += 1;
    else if (h === "skipped") skipped += 1;
  }
  return { overdue, never, skipped };
}
