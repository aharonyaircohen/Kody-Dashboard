/**
 * @fileType utility
 * @domain kody
 * @pattern agentResponsibility-trust-ledger
 * @ai-summary The agentResponsibility-keyed trust ledger — types + pure transforms. Trust is
 *   tracked **per agentResponsibility** (whole-agentResponsibility, not per action): one mode + streak per
 *   agentResponsibility slug. Two agentResponsibilities sharing an agentIdentity earn autonomy independently.
 *
 *     - keyed by AGENT_RESPONSIBILITY slug → stats (mode/approvals/rejections/streak);
 *     - stored as a JSON file in the configured Kody state repo (see `trust-store.ts`),
 *       never on an issue;
 *     - read by BOTH the engine (the gate that lets a trusted agentResponsibility self-dispatch)
 *       and the dashboard (the /trust page), so this shape is a shared contract.
 *
 *   All transforms are pure + immutable. Keep the JSON shape stable across repos.
 */

/** Path of the single per-repo ledger file in the configured Kody state repo. */
export const TRUST_FILE_PATH = "state/trust.json";
export const TRUST_MANIFEST_VERSION = 1 as const;

/** Bound the log — it's a recent-activity signal, not an archive. */
export const TRUST_LOG_MAX = 500;

/**
 * Clean approvals a agentResponsibility needs before it stops asking and the engine lets it
 * self-dispatch. A single reject zeroes the streak and de-graduates it.
 */
export const TRUST_GRADUATION_THRESHOLD = 10;

export type TrustMode = "ask" | "auto";
export type TrustDecision = "approve" | "reject" | "dismiss";

/** Whole-agentResponsibility trust stats. */
export interface TrustAgentResponsibilityStats {
  approvals: number;
  rejections: number;
  /** Resets to 0 on any reject. Drives graduation. */
  consecutiveApprovals: number;
  /** "ask" until graduated; "auto" lets the engine run the agentResponsibility without asking. */
  mode: TrustMode;
}

export interface TrustDecisionLogEntry {
  /** AgentResponsibility slug whose recommendation this verdict decided. */
  agentResponsibility: string;
  /** Action verb of the rec — kept for display only; trust is keyed per agentResponsibility. */
  action?: string;
  decision: TrustDecision;
  taskNumber: number;
  at: string;
  by?: string;
}

export interface TrustManifest {
  version: typeof TRUST_MANIFEST_VERSION;
  /** Trust stats keyed by agentResponsibility slug. */
  agentResponsibilities: Record<string, TrustAgentResponsibilityStats>;
  log: TrustDecisionLogEntry[];
}

export interface TrustLatestDecision {
  decision: TrustDecision;
  at: string;
}

export const EMPTY_TRUST_MANIFEST: TrustManifest = {
  version: TRUST_MANIFEST_VERSION,
  agentResponsibilities: {},
  log: [],
};

export function freshStats(): TrustAgentResponsibilityStats {
  return { approvals: 0, rejections: 0, consecutiveApprovals: 0, mode: "ask" };
}

function withStats(
  manifest: TrustManifest,
  agentResponsibility: string,
  stats: TrustAgentResponsibilityStats,
): TrustManifest {
  return {
    ...manifest,
    agentResponsibilities: {
      ...manifest.agentResponsibilities,
      [agentResponsibility]: stats,
    },
  };
}

export function statsFor(
  manifest: TrustManifest,
  agentResponsibility: string,
): TrustAgentResponsibilityStats {
  return manifest.agentResponsibilities[agentResponsibility] ?? freshStats();
}

/**
 * Pure: apply an Approve/Reject/Dismiss verdict to a agentResponsibility, returning a new
 * manifest. Approve bumps the streak (graduating at the threshold); reject
 * zeroes it and de-graduates (kill switch); dismiss is neutral (log only).
 */
export function applyTrustDecision(
  manifest: TrustManifest,
  entry: {
    agentResponsibility: string;
    decision: TrustDecision;
    taskNumber: number;
    action?: string;
    at?: string;
    by?: string;
  },
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, entry.agentResponsibility);
  const isApprove = entry.decision === "approve";
  const isReject = entry.decision === "reject";
  const consecutiveApprovals = isApprove
    ? prev.consecutiveApprovals + 1
    : isReject
      ? 0
      : prev.consecutiveApprovals;
  const mode: TrustMode = isReject
    ? "ask"
    : isApprove && consecutiveApprovals >= threshold
      ? "auto"
      : prev.mode;
  const next = withStats(manifest, entry.agentResponsibility, {
    approvals: prev.approvals + (isApprove ? 1 : 0),
    rejections: prev.rejections + (isReject ? 1 : 0),
    consecutiveApprovals,
    mode,
  });
  const logEntry: TrustDecisionLogEntry = {
    agentResponsibility: entry.agentResponsibility,
    decision: entry.decision,
    taskNumber: entry.taskNumber,
    at: entry.at ?? new Date().toISOString(),
    ...(entry.action ? { action: entry.action } : {}),
    ...(entry.by ? { by: entry.by } : {}),
  };
  return { ...next, log: [...manifest.log, logEntry].slice(-TRUST_LOG_MAX) };
}

export function trustDecisionKey(
  agentResponsibility: string,
  taskNumber: number,
  action: string,
): string {
  return `${agentResponsibility}:${taskNumber}:${action}`;
}

export function latestTrustDecisions(
  manifest: TrustManifest,
): Record<string, TrustLatestDecision> {
  const out: Record<string, TrustLatestDecision> = {};
  for (const e of manifest.log) {
    if (!e.action) continue;
    out[trustDecisionKey(e.agentResponsibility, e.taskNumber, e.action)] = {
      decision: e.decision,
      at: e.at,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator overrides (the /trust page buttons) — pure
// ─────────────────────────────────────────────────────────────────────────────

export const TRUST_OPS = ["reset", "graduate", "degrade"] as const;
export type TrustOp = (typeof TRUST_OPS)[number];

/** Wipe a agentResponsibility's trust back to zero / "ask". */
export function resetAgentResponsibility(
  manifest: TrustManifest,
  agentResponsibility: string,
): TrustManifest {
  return withStats(manifest, agentResponsibility, freshStats());
}

/**
 * Instant grant — force a agentResponsibility to "auto" now. Lifts the streak to the threshold
 * so the engine (which gates on `consecutiveApprovals`) agrees. Totals kept.
 */
export function graduateAgentResponsibility(
  manifest: TrustManifest,
  agentResponsibility: string,
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, agentResponsibility);
  return withStats(manifest, agentResponsibility, {
    ...prev,
    mode: "auto",
    consecutiveApprovals: Math.max(prev.consecutiveApprovals, threshold),
  });
}

/** Manual kill switch — back to "ask", streak zeroed. Totals kept. */
export function degradeAgentResponsibility(
  manifest: TrustManifest,
  agentResponsibility: string,
): TrustManifest {
  const prev = statsFor(manifest, agentResponsibility);
  return withStats(manifest, agentResponsibility, {
    ...prev,
    mode: "ask",
    consecutiveApprovals: 0,
  });
}

export function applyTrustOp(
  manifest: TrustManifest,
  op: TrustOp,
  agentResponsibility: string,
): TrustManifest {
  switch (op) {
    case "reset":
      return resetAgentResponsibility(manifest, agentResponsibility);
    case "graduate":
      return graduateAgentResponsibility(manifest, agentResponsibility);
    case "degrade":
      return degradeAgentResponsibility(manifest, agentResponsibility);
  }
}

/** True when the engine may let this agentResponsibility self-dispatch. */
export function isGraduated(
  manifest: TrustManifest,
  agentResponsibility: string,
): boolean {
  return manifest.agentResponsibilities[agentResponsibility]?.mode === "auto";
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse / serialize — plain JSON file (no issue-body sentinels)
// ─────────────────────────────────────────────────────────────────────────────

export function parseTrustManifest(
  raw: string | null | undefined,
): TrustManifest {
  if (!raw) return structuredClone(EMPTY_TRUST_MANIFEST);
  try {
    const parsed = JSON.parse(raw) as Partial<TrustManifest>;
    return {
      version: TRUST_MANIFEST_VERSION,
      agentResponsibilities:
        parsed.agentResponsibilities &&
        typeof parsed.agentResponsibilities === "object"
          ? parsed.agentResponsibilities
          : {},
      log: Array.isArray(parsed.log) ? parsed.log : [],
    };
  } catch {
    return structuredClone(EMPTY_TRUST_MANIFEST);
  }
}

export function serializeTrustManifest(manifest: TrustManifest): string {
  return JSON.stringify(manifest, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// View model for the /trust page — one row per agentResponsibility
// ─────────────────────────────────────────────────────────────────────────────

export interface TrustAgentResponsibilityView extends TrustAgentResponsibilityStats {
  agentResponsibility: string;
  /** AgentIdentity the agentResponsibility runs as (from the roster), or null if unknown. */
  agent: string | null;
  /** Clean approvals still needed to graduate (0 once "auto"). */
  remaining: number;
  /** 0..1 streak progress toward the threshold. */
  progress: number;
  /** True once any verdict has been recorded for this agentResponsibility. */
  hasHistory: boolean;
}

/** Pair of `(agentResponsibility slug, agentIdentity it runs as)` — the only roster fields needed. */
export interface AgentResponsibilityStaffLink {
  slug: string;
  agent: string | null;
}

/**
 * Project the manifest + agentResponsibility roster into one view row per agentResponsibility: EVERY agentResponsibility in
 * the roster appears (so its Auto toggle is always available, even with zero
 * history), plus any agentResponsibility with recorded trust. Pure + deterministic.
 */
export function summarizeTrust(
  manifest: TrustManifest,
  agentResponsibilities: readonly AgentResponsibilityStaffLink[],
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustAgentResponsibilityView[] {
  const staffByAgentResponsibility = new Map<string, string | null>();
  for (const d of agentResponsibilities)
    staffByAgentResponsibility.set(d.slug, d.agent);

  const slugs = new Set<string>([
    ...Object.keys(manifest.agentResponsibilities),
    ...staffByAgentResponsibility.keys(),
  ]);

  const views: TrustAgentResponsibilityView[] = [...slugs].map(
    (agentResponsibility) => {
      const stats = manifest.agentResponsibilities[agentResponsibility];
      const s = stats ?? freshStats();
      const remaining =
        s.mode === "auto" ? 0 : Math.max(0, threshold - s.consecutiveApprovals);
      const progress =
        threshold <= 0 ? 1 : Math.min(1, s.consecutiveApprovals / threshold);
      return {
        agentResponsibility,
        agent: staffByAgentResponsibility.get(agentResponsibility) ?? null,
        ...s,
        remaining,
        progress,
        hasHistory: !!stats,
      };
    },
  );

  // Auto agentResponsibilities first, then those with history, then alpha.
  return views.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "auto" ? -1 : 1;
    if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1;
    return a.agentResponsibility.localeCompare(b.agentResponsibility);
  });
}
