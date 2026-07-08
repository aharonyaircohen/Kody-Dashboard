/**
 * @fileType utility
 * @domain chat-plugin-vibe
 * @pattern pure-request-shaping
 * @ai-summary Vibe request-body decoration (Step 5c). Every backend the chat
 *   can talk to carries the same two vibe fields when the host runs in vibe
 *   mode: `vibeMode: true` (flips the server system prompt to "you ARE the
 *   executor" and strips the @kody dispatch tools) and, when a task scope is
 *   resolved, a minimal `taskContext` (`issueNumber` + optional
 *   `prNumber`/`branch` from the associated PR) so the server binds the
 *   runner hand-off to the right issue/branch. Before Step 5c this shaping
 *   was inlined four times in KodyChat's sendText (kody-direct body, live
 *   /start, live /append, engine /trigger); these helpers are the single
 *   source of that wire shape. Pure — no React, no host imports.
 */

/**
 * Minimal structural slice of a task the vibe turn needs. `KodyTask`
 * (lib/types.ts) satisfies this; the plugin never imports host types.
 */
export interface VibeTaskScope {
  issueNumber: number;
  associatedPR?: {
    number: number;
    head: { ref: string };
  } | null;
}

/** Wire shape of the per-turn vibe task context. */
export interface VibeLiveTaskContext {
  issueNumber: number;
  prNumber?: number;
  branch?: string;
}

/**
 * Derive the vibe `taskContext` from a resolved task scope. Undefined when
 * not in vibe mode or when no task is selected — the field is then omitted
 * from the request body entirely (same as the pre-extraction inline spreads).
 */
export function vibeLiveTaskContext(
  vibeMode: boolean | undefined,
  task: VibeTaskScope | null | undefined,
): VibeLiveTaskContext | undefined {
  if (!vibeMode || !task) return undefined;
  return {
    issueNumber: task.issueNumber,
    ...(task.associatedPR
      ? {
          prNumber: task.associatedPR.number,
          branch: task.associatedPR.head.ref,
        }
      : {}),
  };
}

/**
 * Fields a vibe turn adds to a request body. Spread into the body:
 * `...vibeTurnFields(vibeMode, taskContext)`. Empty object (no keys at all)
 * outside vibe mode; `taskContext` key only when a context is provided —
 * byte-identical JSON to the previous inline conditionals.
 */
export function vibeTurnFields(
  vibeMode: boolean | undefined,
  taskContext?: VibeLiveTaskContext,
): { vibeMode?: true; taskContext?: VibeLiveTaskContext } {
  if (!vibeMode) return {};
  return {
    vibeMode: true,
    ...(taskContext ? { taskContext } : {}),
  };
}
