/**
 * @fileType utility
 * @domain kody
 * @pattern company-activity-record
 * @ai-summary Shape + JSONL parser for the engine-authored Company Activity
 *   log (`.kody/activity/<date>.jsonl`). Each line is one named, attributed
 *   action the engine performed — who (staff), what (duty), why (trigger),
 *   and the result. The dashboard reads these into the Activity → Auto feed;
 *   it does NOT derive activity from commits/PRs (those carry no staff/duty).
 *   Mirrors the record written by kody2 `appendCompanyActivity`.
 */

export interface CompanyActivityRecord {
  ts: string;
  /** Plain-English action, e.g. "Ran duty: Verify changelog". */
  action: string;
  duty: string;
  dutyTitle: string | null;
  /** Staff (persona) slug that ran it. */
  staff: string | null;
  staffTitle: string | null;
  trigger: "schedule" | "manual" | "event";
  outcome: "completed" | "failed" | "unknown";
  durationMs: number | null;
  runUrl: string | null;
}

const TRIGGERS = new Set(["schedule", "manual", "event"]);
const OUTCOMES = new Set(["completed", "failed", "unknown"]);

function coerce(raw: unknown): CompanyActivityRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ts !== "string" || typeof r.duty !== "string") return null;
  return {
    ts: r.ts,
    action: typeof r.action === "string" ? r.action : `Ran duty: ${r.duty}`,
    duty: r.duty,
    dutyTitle: typeof r.dutyTitle === "string" ? r.dutyTitle : null,
    staff: typeof r.staff === "string" ? r.staff : null,
    staffTitle: typeof r.staffTitle === "string" ? r.staffTitle : null,
    trigger:
      typeof r.trigger === "string" && TRIGGERS.has(r.trigger)
        ? (r.trigger as CompanyActivityRecord["trigger"])
        : "event",
    outcome:
      typeof r.outcome === "string" && OUTCOMES.has(r.outcome)
        ? (r.outcome as CompanyActivityRecord["outcome"])
        : "unknown",
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
