/**
 * @fileType policy
 * @domain kody
 * @ai-summary Pure tool-availability policy for the kody-direct chat agent.
 *
 * Kody chat is issue-first. It can research, plan, and file issues, but it
 * must not start implementation itself by dispatching the pipeline, starting a
 * Vibe runner, or writing files through remote-dev tools.
 */

/** `@kody ...` dispatch tools — never available to Kody chat. */
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

/** Implementation-start/write tools — never available to Kody chat. */
export const KODY_CHAT_IMPLEMENTATION_TOOLS: readonly string[] = [
  ...VIBE_DISPATCH_TOOLS,
  "remote_exec",
  "remote_write",
];

/**
 * Issue-creation tools — available in vibe ONLY when no task is selected yet
 * (fresh flow files the first issue). Once a task is scoped, they are removed
 * so the model can't file a duplicate.
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

/** Returns a new tool map with Kody chat execution boundaries applied. */
export function applyVibeToolPolicy<T extends Record<string, unknown>>(
  tools: T,
  opts: { vibeMode: boolean; hasCurrentTask: boolean },
): T {
  const next: Record<string, unknown> = { ...tools };

  for (const name of KODY_CHAT_IMPLEMENTATION_TOOLS) {
    delete next[name];
  }

  // Already scoped to an issue: it exists. The chat can help refine that issue,
  // not create a duplicate or start implementation.
  if (opts.vibeMode && opts.hasCurrentTask) {
    for (const name of VIBE_CREATE_TOOLS) delete next[name];
  }

  return next as T;
}
