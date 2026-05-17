/**
 * @fileType utility
 * @domain kody
 * @pattern cto-decisions-manifest
 * @ai-summary Types + body parse/serialize for the `kody:cto-decisions`
 *   manifest issue. This is the dashboard-owned trust ledger: every
 *   Approve/Reject the operator makes on a CTO recommendation is tallied
 *   here. Kept separate from the engine-owned `.kody/workers/cto.state.json`
 *   so dashboard decisions and engine tick-state never race or co-mingle.
 *
 *   Phase 1 only writes it. Phase 2 (graduation) has the CTO read
 *   `actions[<action>].consecutiveApprovals` each tick and flip an action
 *   from "ask" to "auto" once it clears a threshold with zero rejections.
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

export type CtoDecision = "approve" | "reject";
export type CtoActionMode = "ask" | "auto";

export interface CtoActionStats {
  approvals: number;
  rejections: number;
  /** Resets to 0 on any reject. Drives Phase 2 graduation. */
  consecutiveApprovals: number;
  /** Phase 1 is always "ask"; Phase 2 flips trusted actions to "auto". */
  mode: CtoActionMode;
}

export interface CtoDecisionLogEntry {
  taskNumber: number;
  action: string;
  decision: CtoDecision;
  at: string;
  by?: string;
}

export interface CtoDecisionsManifest {
  version: typeof CTO_DECISIONS_MANIFEST_VERSION;
  actions: Record<string, CtoActionStats>;
  log: CtoDecisionLogEntry[];
}

export const EMPTY_CTO_DECISIONS_MANIFEST: CtoDecisionsManifest = {
  version: CTO_DECISIONS_MANIFEST_VERSION,
  actions: {},
  log: [],
};

function freshStats(): CtoActionStats {
  return { approvals: 0, rejections: 0, consecutiveApprovals: 0, mode: "ask" };
}

/**
 * Pure: return a new manifest with the decision applied. Never mutates the
 * input (immutability rule). Approve increments approvals +
 * consecutiveApprovals; reject increments rejections and resets the streak.
 */
export function applyDecision(
  manifest: CtoDecisionsManifest,
  entry: Omit<CtoDecisionLogEntry, "at"> & { at?: string },
): CtoDecisionsManifest {
  const prev = manifest.actions[entry.action] ?? freshStats();
  const isApprove = entry.decision === "approve";
  const consecutiveApprovals = isApprove ? prev.consecutiveApprovals + 1 : 0;
  // Graduation is deterministic and lives here (not in the LLM): cross the
  // threshold → "auto"; any reject → back to "ask" (the kill switch).
  const mode: CtoActionMode = !isApprove
    ? "ask"
    : consecutiveApprovals >= CTO_GRADUATION_THRESHOLD
      ? "auto"
      : prev.mode;
  const nextStats: CtoActionStats = {
    approvals: prev.approvals + (isApprove ? 1 : 0),
    rejections: prev.rejections + (isApprove ? 0 : 1),
    consecutiveApprovals,
    mode,
  };
  const logEntry: CtoDecisionLogEntry = {
    taskNumber: entry.taskNumber,
    action: entry.action,
    decision: entry.decision,
    at: entry.at ?? new Date().toISOString(),
    ...(entry.by ? { by: entry.by } : {}),
  };
  return {
    version: CTO_DECISIONS_MANIFEST_VERSION,
    actions: { ...manifest.actions, [entry.action]: nextStats },
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
    const parsed = JSON.parse(json) as Partial<CtoDecisionsManifest>;
    return {
      version: CTO_DECISIONS_MANIFEST_VERSION,
      actions: parsed.actions ?? {},
      log: Array.isArray(parsed.log) ? parsed.log : [],
    };
  } catch {
    return structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
  }
}

export function serializeCtoDecisionsBody(
  manifest: CtoDecisionsManifest,
): string {
  const preamble =
    "> Kody CTO decisions ledger — the dashboard writes the JSON block below\n" +
    "> whenever an operator approves or rejects a CTO recommendation. The CTO\n" +
    "> worker reads it each tick to decide when to stop asking (graduation).\n\n";
  const json = JSON.stringify(manifest, null, 2);
  return `${preamble}${MANIFEST_START}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${MANIFEST_END}\n`;
}
