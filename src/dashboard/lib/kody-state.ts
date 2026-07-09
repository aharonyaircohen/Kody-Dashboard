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

/** How a job was triggered: an instant `@kody` run vs a scheduled (cron) run. */
export type KodyJobFlavor = "instant" | "scheduled";

export interface KodyAction {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * One job in the task's ledger — the durable record a single engine run leaves
 * behind. Mirrors `HistoryEntry` in kody-engine's src/state.ts. A task IS the
 * ordered list of these entries plus the rolled-up `core` state; each run
 * appends exactly one (a re-run is a NEW entry, never a mutation of a prior one).
 */
export interface KodyHistoryEntry {
  timestamp: string;
  capability: string | null;
  implementation?: string | null;
  action: string;
  note?: string;
  /** Agent member this run executed as, when the capability declares one. */
  agent?: string;
  /** Stable id for this job run (CI run id in Actions, else a stamp). */
  jobId?: string;
  /** Whether this run was an instant (`@kody`) or scheduled (cron) job. */
  flavor?: KodyJobFlavor;
  /** Cadence this scheduled job fired on (the capability's `every`/cron). */
  schedule?: string;
  /** This job's outcome at the time the entry was written. */
  status?: KodyStatus;
  /** Link to the run (GitHub Actions run URL) when available. */
  runUrl?: string;
}

export interface KodyTaskState {
  schemaVersion: 1;
  core: {
    phase: KodyPhase;
    status: KodyStatus;
    currentCapability: string | null;
    lastOutcome: KodyAction | null;
    attempts: Record<string, number>;
    prUrl?: string;
    runUrl?: string;
    /** AgentIdentity the most recent run executed as, when declared. */
    ranAsStaff?: string | null;
  };
  /** Ordered run-history: one job entry per engine run on this issue/PR. */
  history: KodyHistoryEntry[];
}

type RawKodyState = Partial<Omit<KodyTaskState, "core" | "history">> & {
  core?: Partial<KodyTaskState["core"]> & {
    currentImplementation?: unknown;
  };
  history?: unknown;
};

function rawString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeHistoryEntry(raw: unknown): KodyHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const timestamp = rawString(entry.timestamp);
  if (!timestamp) return null;

  return {
    timestamp,
    capability:
      rawString(entry.capability) ?? rawString(entry.implementation) ?? null,
    implementation: rawString(entry.implementation) ?? null,
    action: rawString(entry.action) ?? "",
    note: rawString(entry.note),
    agent: rawString(entry.agent),
    jobId: rawString(entry.jobId),
    flavor:
      entry.flavor === "instant" || entry.flavor === "scheduled"
        ? entry.flavor
        : undefined,
    schedule: rawString(entry.schedule),
    status:
      entry.status === "pending" ||
      entry.status === "running" ||
      entry.status === "succeeded" ||
      entry.status === "failed"
        ? entry.status
        : undefined,
    runUrl: rawString(entry.runUrl),
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
    const parsed = JSON.parse(jsonStr) as RawKodyState;
    if (parsed?.schemaVersion !== 1) return null;
    if (!parsed.core) return null;
    return {
      schemaVersion: 1,
      core: {
        phase: parsed.core.phase ?? "idle",
        status: parsed.core.status ?? "pending",
        currentCapability:
          rawString(parsed.core.currentCapability) ??
          rawString(parsed.core.currentImplementation) ??
          null,
        lastOutcome: parsed.core.lastOutcome ?? null,
        attempts: parsed.core.attempts ?? {},
        prUrl: parsed.core.prUrl,
        runUrl: parsed.core.runUrl,
        ranAsStaff: parsed.core.ranAsStaff ?? null,
      },
      history: Array.isArray(parsed.history)
        ? parsed.history
            .map((entry) => normalizeHistoryEntry(entry))
            .filter((entry): entry is KodyHistoryEntry => entry !== null)
        : [],
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
