/**
 * @fileType utility
 * @domain kody
 * @pattern company-activity-record
 * @ai-summary Shape + JSONL parser for the engine-authored Company Activity
 *   log (`activity/<date>.jsonl` in the configured Kody state repo). Each line is one named, attributed
 *   action the engine performed — who (agent), what (agentResponsibility), why (trigger),
 *   and the result. The dashboard reads these into the Activity → Auto feed;
 *   it does NOT derive activity from commits/PRs (those carry no agent/agentResponsibility).
 *   Mirrors the record written by kody2 `appendCompanyActivity`.
 */

export interface CompanyActivityRecord {
  ts: string;
  /** Plain-English action, e.g. "Ran agentResponsibility: Verify changelog". */
  action: string;
  agentResponsibility: string;
  agentResponsibilityTitle: string | null;
  /** Agent (agentIdentity) slug that ran it. */
  agent: string | null;
  staffTitle: string | null;
  trigger: "schedule" | "manual" | "event";
  outcome: "completed" | "failed" | "unknown";
  /** Structured failure kind from the engine agent (e.g. "stalled",
   *  "out_of_turns", "model_error"). Null on success / older records. */
  outcomeKind: string | null;
  /** Short human-readable failure message. Null on success / older records. */
  reason: string | null;
  durationMs: number | null;
  runUrl: string | null;
}

const TRIGGERS = new Set(["schedule", "manual", "event"]);
const OUTCOMES = new Set(["completed", "failed", "unknown"]);

function coerce(raw: unknown): CompanyActivityRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ts !== "string" || typeof r.agentResponsibility !== "string")
    return null;
  return {
    ts: r.ts,
    action:
      typeof r.action === "string"
        ? r.action
        : `Ran agentResponsibility: ${r.agentResponsibility}`,
    agentResponsibility: r.agentResponsibility,
    agentResponsibilityTitle:
      typeof r.agentResponsibilityTitle === "string"
        ? r.agentResponsibilityTitle
        : null,
    agent: typeof r.agent === "string" ? r.agent : null,
    staffTitle: typeof r.staffTitle === "string" ? r.staffTitle : null,
    trigger:
      typeof r.trigger === "string" && TRIGGERS.has(r.trigger)
        ? (r.trigger as CompanyActivityRecord["trigger"])
        : "event",
    outcome:
      typeof r.outcome === "string" && OUTCOMES.has(r.outcome)
        ? (r.outcome as CompanyActivityRecord["outcome"])
        : "unknown",
    outcomeKind: typeof r.outcomeKind === "string" ? r.outcomeKind : null,
    reason: typeof r.reason === "string" ? r.reason : null,
    durationMs: typeof r.durationMs === "number" ? r.durationMs : null,
    runUrl: typeof r.runUrl === "string" ? r.runUrl : null,
  };
}

/** Parse one `.jsonl` file's text into records, skipping malformed lines. */
export function parseActivityJsonl(text: string): CompanyActivityRecord[] {
  const out: CompanyActivityRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = coerce(JSON.parse(trimmed));
      if (rec) out.push(rec);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/** Newest-first across a set of parsed records. */
export function sortActivityNewestFirst(
  records: CompanyActivityRecord[],
): CompanyActivityRecord[] {
  return [...records].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

/** Latest engine activity record per agentResponsibility slug. */
export function latestActivityByAgentResponsibility(
  records: CompanyActivityRecord[],
): Map<string, CompanyActivityRecord> {
  const latest = new Map<string, CompanyActivityRecord>();
  for (const rec of sortActivityNewestFirst(records)) {
    if (!latest.has(rec.agentResponsibility))
      latest.set(rec.agentResponsibility, rec);
  }
  return latest;
}
