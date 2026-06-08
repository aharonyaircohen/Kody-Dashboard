/**
 * @fileType util
 * @domain kody
 * @pattern duty-dispatch-comment
 * @ai-summary Build the `@kody duty-tick --duty <slug> [--force]` comment body
 *   that the dashboard posts to the control issue to manually fire a duty.
 *   The engine's `issue_comment` trigger fires kody.yml; the dispatcher
 *   routes to the `duty-tick` executable (renamed from `job-tick` in
 *   kody2 main) and reads `--duty <slug>` (renamed from `--job`).
 *
 *   This module owns the literal text — both the API route
 *   (`app/api/kody/duties/[slug]/run/route.ts`) and the chat
 *   `run_duty` tool (`app/api/kody/chat/tools/duty-admin-tools.ts`)
 *   use it, so a rename in the engine only needs to land here.
 */

export interface DutyRunCommentOptions {
  slug: string;
  /** When true, appends `--force` so the engine bypasses the cadence guard. */
  force?: boolean;
}

export function buildDutyRunCommentBody({
  slug,
  force = true,
}: DutyRunCommentOptions): string {
  // Keep the literal text in sync with the engine's duty-tick parser.
  // The dispatcher routes this exact subcommand — renaming either token
  // silently breaks manual runs until callers re-discover the new shape.
  return force
    ? `@kody duty-tick --duty ${slug} --force`
    : `@kody duty-tick --duty ${slug}`;
}
