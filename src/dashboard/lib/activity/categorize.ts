/**
 * @fileType utility
 * @domain kody
 * @pattern activity-categorize
 * @ai-summary Pure: bucket an engine run into a coarse category from the
 *   trigger event + title. This is the honest ceiling of what the
 *   workflow-run payload supports — it does NOT carry the `@kody`
 *   subcommand (fix / fix-ci / ui-review / sync / resume), which lives in
 *   the triggering comment body. Per-action tracking needs the engine to
 *   stamp the action into the run; reverse-engineering it here would mean
 *   repo-wide comment scanning (breaks the rate-limit rules). So we stop
 *   at category, deliberately.
 */

export type ActivityCategory =
  | "scheduled" // job-scheduler / memorize fan-out (event=schedule)
  | "dispatch" // manual duty/staff "Run now" via the kody:control issue
  | "command" // a user @kody command on a real issue/PR (event=issue_comment)
  | "manual" // workflow_dispatch
  | "other"; // push, etc.

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  scheduled: "Scheduled (duties/staff)",
  dispatch: "Duty/staff dispatch",
  command: "@kody command",
  manual: "Manual dispatch",
  other: "Other",
};

/**
 * `event` is the GitHub trigger; `title` is the run's display title (the
 * kody:control issue is titled "Kody control", which is how a Run-now
 * dispatch is told apart from an organic @kody command — both arrive as
 * issue_comment).
 */
export function categorizeRun(
  event: string | undefined,
  title: string | undefined,
): ActivityCategory {
  const ev = (event ?? "").toLowerCase();
  if (ev === "schedule") return "scheduled";
  if (ev === "workflow_dispatch") return "manual";
  if (ev === "issue_comment") {
    return /kody control/i.test(title ?? "") ? "dispatch" : "command";
  }
  if (ev === "" || ev === "unknown") return "other";
  return "other";
}
