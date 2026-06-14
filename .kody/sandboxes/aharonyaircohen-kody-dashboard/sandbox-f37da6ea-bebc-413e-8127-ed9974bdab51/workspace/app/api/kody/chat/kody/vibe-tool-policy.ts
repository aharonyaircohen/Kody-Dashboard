/**
 * @fileType policy
 * @domain vibe
 * @ai-summary Pure tool-availability policy for the kody-direct chat agent.
 *
 *   Centralises which tools the model may call in vibe mode vs normal mode,
 *   so the rules are unit-testable instead of buried inline in the route.
 *
 *   Two rules:
 *   1. Vibe mode strips the `@kody` dispatch tools — in vibe the chat drives
 *      the runner directly, it never posts `@kody ...` comments.
 *   2. Vibe mode, WHEN ALREADY SCOPED TO A TASK, also strips the issue-
 *      creation tools. The issue already exists; letting the model call
 *      `create_*` here files a DUPLICATE issue (observed in the two-turn
 *      flow: create issue in turn 1, then on "approve" in turn 2 the model
 *      creates a second issue and runs that). With creation removed, the only
 *      way forward is `vibe_start_execution` on the current issue — exactly
 *      what we want.
 *   Outside vibe, `vibe_start_execution` is removed (it's a vibe-only trick).
 */

/** `@kody ...` dispatch tools — never available in vibe mode. */
export const VIBE_DISPATCH_TOOLS: readonly string[] = [
  "kody_run_issue",
  "kody_fix_pr",
  "kody_fix_ci_pr",
  "kody_review_pr",
  "kody_resolve_pr",
  "kody_revert_pr",
  "kody_sync_pr",
  "request_release",
];

/**
 * Issue-creation tools — available in vibe ONLY when no task is selected yet
 * (the fresh flow that files the first issue). Once a task is scoped, these
 * are removed so the model can't file a duplicate.
 */
export const VIBE_CREATE_TOOLS: readonly string[] = [
  "create_feature",
  "create_enhancement",
  "create_refactor",
  "create_documentation",
  "create_chore",
  "report_bug",
  "create_task",
];

/**
 * Returns a new tool map with the vibe policy applied. Pure — does not mutate
 * the input.
 */
export function applyVibeToolPolicy<T extends Record<string, unknown>>(
  tools: T,
  opts: { vibeMode: boolean; hasCurrentTask: boolean },
): T {
  const next: Record<string, unknown> = { ...tools };
  if (opts.vibeMode) {
    for (const name of VIBE_DISPATCH_TOOLS) delete next[name];
    // Already scoped to an issue → it exists; calling create_* here would
    // file a DUPLICATE. Remove creation so the only path forward is
    // vibe_start_execution on the current issue.
    if (opts.hasCurrentTask) {
      for (const name of VIBE_CREATE_TOOLS) delete next[name];
    }
  } else {
    delete next.vibe_start_execution;
  }
  return next as T;
}
