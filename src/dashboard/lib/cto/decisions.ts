/**
 * @fileType utility
 * @domain kody
 * @pattern cto-decisions-manifest
 * @ai-summary Types + body parse/serialize for the `kody:cto-decisions`
 *   manifest issue. This is the dashboard-owned trust ledger: every
 *   Approve/Reject the operator makes on a CTO recommendation is tallied
 *   here. Kept separate from the engine-owned `.kody/staff/cto.state.json`
 *   so dashboard decisions and engine tick-state never race or co-mingle.
 *
 *   Phase 1 only writes it. Phase 2 (graduation) has each staff member read
 *   `staff[<slug>][<action>].consecutiveApprovals` each tick and flip an
 *   action from "ask" to "auto" once it clears a threshold with zero
 *   rejections. Trust is per-staff: one staff member graduating an action
 *   never grants another staff member autonomy on the same verb.
 *
 *   Serialization mirrors push.ts: a JSON block fenced between two HTML
 *   comment markers in the issue body.
 */

export const CTO_DECISIONS_LABEL = "kody:cto-decisions";
export const CTO_DECISIONS_ISSUE_TITLE = "Kody CTO decisions";
export const CTO_DECISIONS_MANIFEST_VERSION = 1 as const;

/** Keep the decision log bounded — it's a trust signal, not an archive. */
export const CTO_DECISIONS_LOG_MAX = 500;

/**
 * Consecutive clean approvals an action needs before the CTO stops asking
 * and starts auto-acting (Phase 2 graduation). A single reject resets the
 * streak AND de-graduates the action back to "ask" — that's the kill
 * switch: one wrong call returns control to the operator.
 */
export const CTO_GRADUATION_THRESHOLD = 10;

const MANIFEST_START = "<!-- kody-cto-decisions:start -->";
const MANIFEST_END = "<!-- kody-cto-decisions:end -->";

/**
 * `dismiss` is a neutral verdict: it marks the recommendation decided
 * (so backpressure's pending count drops) without touching the
 * approvals/rejections/streak — graduation is not affected either way.
 * Use it to drain stale recommendations the operator no longer wants to
 * act on but doesn't want to penalise the CTO over.
 */
export type CtoDecision = "approve" | "reject" | "dismiss";
export type CtoActionMode = "ask" | "auto";

/**
 * Staff slug a verdict belongs to when none is recorded. Every rec written
 * before the ledger gained a staff dimension was the CTO's, so legacy
 * manifests + log entries migrate under this slug.
 */
export const DEFAULT_STAFF_SLUG = "cto";

export interface StaffActionStats {
  approvals: number;
  rejections: number;
  /** Resets to 0 on any reject. Drives Phase 2 graduation. */
  consecutiveApprovals: number;
  /** Phase 1 is always "ask"; Phase 2 flips trusted actions to "auto". */
  mode: CtoActionMode;
}

/** Back-compat alias — the stats shape is staff-agnostic. */
export type CtoActionStats = StaffActionStats;

export interface CtoDecisionLogEntry {
  /** Slug of the staff member whose recommendation this verdict decided. */
  staff: string;
  taskNumber: number;
  action: string;
  decision: CtoDecision;
  at: string;
  by?: string;
}

export interface CtoDecisionsManifest {
  version: typeof CTO_DECISIONS_MANIFEST_VERSION;
  /**
   * Trust stats nested by staff slug → action verb. Each staff member earns
   * (and loses) autonomy independently — a chatty CTO graduating `execute`
   * never grants QA autonomy on its own `execute`.
   */
  staff: Record<string, Record<string, StaffActionStats>>;
  log: CtoDecisionLogEntry[];
}

export const EMPTY_CTO_DECISIONS_MANIFEST: CtoDecisionsManifest = {
  version: CTO_DECISIONS_MANIFEST_VERSION,
  staff: {},
  log: [],
};

function freshStats(): CtoActionStats {
  return { approvals: 0, rejections: 0, consecutiveApprovals: 0, mode: "ask" };
}

/**
 * Pure: return a new manifest with the decision applied. Never mutates the
 * input (immutability rule). Approve increments approvals +
 * consecutiveApprovals; reject increments rejections and resets the streak;
 * dismiss appends a log entry only (neutral — stats/mode untouched, so the
 * streak survives and graduation isn't gamed by mass-dismissing stale recs).
 */
export function applyDecision(
  manifest: CtoDecisionsManifest,
  entry: Omit<CtoDecisionLogEntry, "at" | "staff"> & {
    at?: string;
    /** Emitting staff slug; legacy callers omit it → DEFAULT_STAFF_SLUG. */
    staff?: string;
  },
): CtoDecisionsManifest {
  const staff = entry.staff ?? DEFAULT_STAFF_SLUG;
  const prevStaff = manifest.staff[staff] ?? {};
  const prev = prevStaff[entry.action] ?? freshStats();
  const isApprove = entry.decision === "approve";
  const isReject = entry.decision === "reject";
  // Dismiss is a no-op against stats: keep the prior streak/mode and only log it.
  const consecutiveApprovals = isApprove
    ? prev.consecutiveApprovals + 1
    : isReject
      ? 0
      : prev.consecutiveApprovals;
  // Graduation is deterministic and lives here (not in the LLM): cross the
  // threshold on approve → "auto"; any reject → back to "ask" (the kill
  // switch); dismiss → mode unchanged.
  const mode: CtoActionMode = isReject
    ? "ask"
    : isApprove && consecutiveApprovals >= CTO_GRADUATION_THRESHOLD
      ? "auto"
      : prev.mode;
  const nextStats: StaffActionStats = {
    approvals: prev.approvals + (isApprove ? 1 : 0),
    rejections: prev.rejections + (isReject ? 1 : 0),
    consecutiveApprovals,
    mode,
  };
  const logEntry: CtoDecisionLogEntry = {
    staff,
    taskNumber: entry.taskNumber,
    action: entry.action,
    decision: entry.decision,
    at: entry.at ?? new Date().toISOString(),
    ...(entry.by ? { by: entry.by } : {}),
  };
  return {
    version: CTO_DECISIONS_MANIFEST_VERSION,
    staff: {
      ...manifest.staff,
      [staff]: { ...prevStaff, [entry.action]: nextStats },
    },
    log: [...manifest.log, logEntry].slice(-CTO_DECISIONS_LOG_MAX),
  };
}

export function parseCtoDecisionsBody(
  body: string | null | undefined,
): CtoDecisionsManifest {
  if (!body) return structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
  const start = body.indexOf(MANIFEST_START);
  const end = body.indexOf(MANIFEST_END);
  if (start === -1 || end === -1 || end < start) {
    return structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
  }
  const inner = body.slice(start + MANIFEST_START.length, end);
  const fenceOpen = inner.indexOf("```");
  const fenceClose = inner.lastIndexOf("```");
  if (fenceOpen === -1 || fenceClose === -1 || fenceClose === fenceOpen) {
    return structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
  }
  const afterOpen = inner.indexOf("\n", fenceOpen);
  if (afterOpen === -1) return structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
  const json = inner.slice(afterOpen + 1, fenceClose).trim();
  if (!json) return structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);

  try {
    const parsed = JSON.parse(json) as Partial<CtoDecisionsManifest> & {
      /** Legacy pre-staff shape: a flat action→stats map (all CTO's). */
      actions?: Record<string, StaffActionStats>;
    };
    // Migrate the legacy flat `actions` map under the CTO slug; a current
    // manifest already carries the nested `staff` map and wins.
    const staff =
      parsed.staff && typeof parsed.staff === "object"
        ? parsed.staff
        : parsed.actions && typeof parsed.actions === "object"
          ? { [DEFAULT_STAFF_SLUG]: parsed.actions }
          : {};
    // Legacy log entries predate the `staff` field — stamp them as the CTO's.
    const log = Array.isArray(parsed.log)
      ? parsed.log.map((e) => ({ ...e, staff: e.staff ?? DEFAULT_STAFF_SLUG }))
      : [];
    return { version: CTO_DECISIONS_MANIFEST_VERSION, staff, log };
  } catch {
    return structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
  }
}

/**
 * Stable key for "has this staff member's task+action been decided" lookups.
 * Scoped by staff so a CTO and a QA rec on the *same* task+action don't share
 * a verdict slot.
 */
export function staffDecisionKey(
  staff: string,
  taskNumber: number,
  action: string,
): string {
  return `${staff}:${taskNumber}:${action}`;
}

/**
 * Latest verdict per `(taskNumber, action)` with the timestamp it was
 * recorded. Callers compare `at` against the inbox entry's `sentAt` to
 * decide whether the verdict applies to *that* rec or only to an earlier
 * one — a dismiss on yesterday's sync rec must not silently mark today's
 * fresh sync rec as decided. Later log entries win.
 */
export interface CtoLatestDecision {
  decision: CtoDecision;
  /** ISO timestamp of the decision (from the log entry). */
  at: string;
}

export function latestCtoDecisions(
  manifest: CtoDecisionsManifest,
): Record<string, CtoLatestDecision> {
  const out: Record<string, CtoLatestDecision> = {};
  for (const e of manifest.log) {
    out[
      staffDecisionKey(e.staff ?? DEFAULT_STAFF_SLUG, e.taskNumber, e.action)
    ] = {
      decision: e.decision,
      at: e.at,
    };
  }
  return out;
}

export function serializeCtoDecisionsBody(
  manifest: CtoDecisionsManifest,
): string {
  const preamble =
    "> Kody staff decisions ledger — the dashboard writes the JSON block below\n" +
    "> whenever an operator approves or rejects a staff recommendation. Trust is\n" +
    "> tracked per staff slug (`staff.<slug>.<action>`); each staff member reads\n" +
    "> its own slice each tick to decide when to stop asking (graduation).\n\n";
  const json = JSON.stringify(manifest, null, 2);
  return `${preamble}${MANIFEST_START}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${MANIFEST_END}\n`;
}
