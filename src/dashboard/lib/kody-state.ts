/**
 * @fileType utility
 * @domain kody
 * @pattern canonical-state-reader
 * @ai-summary Parses the canonical kody TaskState JSON embedded in a sentinel-bracketed
 * issue comment. Mirrors the producer schema in kody-engine's src/state.ts (TaskState).
 *
 * The state comment is the SOURCE OF TRUTH for a kody-managed task. Labels and
 * workflow run statuses are projections of it that can drift; this parser reads
 * the canonical JSON so the dashboard never needs to derive status from those.
 */

export const STATE_BEGIN = "<!-- kody:state:v1:begin -->";
export const STATE_END = "<!-- kody:state:v1:end -->";

export type KodyPhase =
  | "idle"
  | "research"
  | "planning"
  | "implementing"
  | "reviewing"
  | "shipped"
  | "failed";

export type KodyStatus = "pending" | "running" | "succeeded" | "failed";

export interface KodyAction {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface KodyTaskState {
  schemaVersion: 1;
  core: {
    phase: KodyPhase;
    status: KodyStatus;
    currentExecutable: string | null;
    lastOutcome: KodyAction | null;
    attempts: Record<string, number>;
    prUrl?: string;
    runUrl?: string;
  };
}

/**
 * Extract the canonical TaskState JSON from an issue comment body. Returns null
 * when the comment does not contain a valid state block (legacy comments, the
 * agent's own progress comments, etc.).
 */
export function parseKodyStateComment(body: string): KodyTaskState | null {
  if (!body || !body.includes(STATE_BEGIN)) return null;

  const beginIdx = body.indexOf(STATE_BEGIN);
  const endIdx = body.lastIndexOf(STATE_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) return null;

  const between = body.slice(beginIdx + STATE_BEGIN.length, endIdx).trim();
  const OPEN = "```json";
  const CLOSE = "```";
  if (!between.startsWith(OPEN) || !between.endsWith(CLOSE)) return null;
  const jsonStr = between
    .slice(OPEN.length, between.length - CLOSE.length)
    .trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<KodyTaskState>;
    if (parsed?.schemaVersion !== 1) return null;
    if (!parsed.core) return null;
    return {
      schemaVersion: 1,
      core: {
        phase: parsed.core.phase ?? "idle",
        status: parsed.core.status ?? "pending",
        currentExecutable: parsed.core.currentExecutable ?? null,
        lastOutcome: parsed.core.lastOutcome ?? null,
        attempts: parsed.core.attempts ?? {},
        prUrl: parsed.core.prUrl,
        runUrl: parsed.core.runUrl,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Find the kody-owned state comment in a list and return its parsed state.
 *
 * Multiple state comments are not expected, but they DO occur: a re-classify
 * (or a self-dispatch retry) can post a fresh state comment while the engine's
 * canonical comment is edited in place. When that happens the duplicate is
 * usually created *after* the canonical one but is stale, so picking "last in
 * the list" (creation order) returns the wrong, older state — the symptom was
 * a finished task flapping back to "running". We therefore pick the comment
 * with the newest `updated_at` (the engine bumps it on every in-place edit),
 * falling back to `created_at`, then to list position when no timestamps are
 * available (e.g. unit-test fixtures).
 */
export function findKodyStateInComments(
  comments: Array<{ body: string; updated_at?: string; created_at?: string }>,
): KodyTaskState | null {
  let best: { state: KodyTaskState; ts: number; idx: number } | null = null;
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const state = parseKodyStateComment(c.body);
    if (!state) continue;
    const ts = Date.parse(c.updated_at ?? c.created_at ?? "");
    // No usable timestamp → fall back to creation order (later index wins),
    // preserving the previous behaviour for fixtures lacking timestamps.
    const score = Number.isNaN(ts) ? i : ts;
    if (!best || score >= best.ts) best = { state, ts: score, idx: i };
  }
  return best?.state ?? null;
}
