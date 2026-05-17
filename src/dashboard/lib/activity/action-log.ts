/**
 * @fileType utility
 * @domain kody
 * @pattern activity-action-log
 * @ai-summary Shared in-memory logger for dashboard-native actions (the
 *   ones that never spawn a GitHub Actions run and so are invisible to
 *   Runs/Feed): task actions, vault writes, push subscribe, etc. Write
 *   paths call `recordAction(...)` as a passive side-effect — it never
 *   affects the action's own execution. A bounded ring buffer per
 *   serverless instance: zero new storage, zero GitHub API budget (so it
 *   can't regress the shared rate limit). Trade-off: entries are
 *   per-instance and lost on redeploy — durable cross-instance history is
 *   a deliberate follow-up, not part of this first cut.
 */

export interface ActionLogEntry {
  id: string;
  /** Coarse verb, e.g. "task.action", "vault.write", "push.subscribe". */
  type: string;
  /** What was acted on, e.g. "#1587", "FLY_API_TOKEN", repo name. */
  target: string;
  /** Who did it — the connected owner/login when known, else "unknown". */
  actor: string;
  /** Repo the action applies to (`owner/name`), when known. */
  repo: string | null;
  /** Optional one-line extra context (the specific sub-action, outcome). */
  detail: string | null;
  /** Server clock, ISO. */
  at: string;
}

const MAX_ENTRIES = 500;
const buffer: ActionLogEntry[] = [];

/**
 * Record a dashboard-native action. Fire-and-forget: never throws, never
 * blocks, never alters the caller's flow.
 */
export function recordAction(input: {
  type: string;
  target: string;
  actor?: string | null;
  repo?: string | null;
  detail?: string | null;
}): void {
  try {
    buffer.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      target: input.target,
      actor: input.actor?.trim() || "unknown",
      repo: input.repo?.trim() || null,
      detail: input.detail?.trim() || null,
      at: new Date().toISOString(),
    });
    if (buffer.length > MAX_ENTRIES) {
      buffer.splice(0, buffer.length - MAX_ENTRIES);
    }
  } catch {
    // A logging failure must never break the action it's observing.
  }
}

/** Newest-first snapshot of the recorded actions on this instance. */
export function getActionLog(): ActionLogEntry[] {
  return [...buffer].reverse();
}
