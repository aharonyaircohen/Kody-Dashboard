/**
 * @fileType utility
 * @domain kody
 * @pattern duty-trust-ledger
 * @ai-summary The duty-keyed trust ledger — types + pure transforms. Trust is
 *   tracked **per duty** (whole-duty, not per action): one mode + streak per
 *   duty slug. Two duties sharing a persona earn autonomy independently.
 *
 *     - keyed by DUTY slug → stats (mode/approvals/rejections/streak);
 *     - stored as a JSON FILE on the `kody-state` branch (see `trust-store.ts`),
 *       never on an issue;
 *     - read by BOTH the engine (the gate that lets a trusted duty self-dispatch)
 *       and the dashboard (the /trust page), so this shape is a shared contract.
 *
 *   All transforms are pure + immutable. Keep the JSON shape stable across repos.
 */

/** Path of the single per-repo ledger file on the `kody-state` branch. */
export const TRUST_FILE_PATH = ".kody/state/trust.json";
export const TRUST_MANIFEST_VERSION = 1 as const;

/** Bound the log — it's a recent-activity signal, not an archive. */
export const TRUST_LOG_MAX = 500;

/**
 * Clean approvals a duty needs before it stops asking and the engine lets it
 * self-dispatch. A single reject zeroes the streak and de-graduates it.
 */
export const TRUST_GRADUATION_THRESHOLD = 10;

export type TrustMode = "ask" | "auto";
export type TrustDecision = "approve" | "reject" | "dismiss";

/** Whole-duty trust stats. */
export interface TrustDutyStats {
  approvals: number;
  rejections: number;
  /** Resets to 0 on any reject. Drives graduation. */
  consecutiveApprovals: number;
  /** "ask" until graduated; "auto" lets the engine run the duty without asking. */
  mode: TrustMode;
}

export interface TrustDecisionLogEntry {
  /** Duty slug whose recommendation this verdict decided. */
  duty: string;
  /** Action verb of the rec — kept for display only; trust is keyed per duty. */
  action?: string;
  decision: TrustDecision;
  taskNumber: number;
  at: string;
  by?: string;
}

export interface TrustManifest {
  version: typeof TRUST_MANIFEST_VERSION;
  /** Trust stats keyed by duty slug. */
  duties: Record<string, TrustDutyStats>;
  log: TrustDecisionLogEntry[];
}

export const EMPTY_TRUST_MANIFEST: TrustManifest = {
  version: TRUST_MANIFEST_VERSION,
  duties: {},
  log: [],
};

export function freshStats(): TrustDutyStats {
  return { approvals: 0, rejections: 0, consecutiveApprovals: 0, mode: "ask" };
}

function withStats(
  manifest: TrustManifest,
  duty: string,
  stats: TrustDutyStats,
): TrustManifest {
  return { ...manifest, duties: { ...manifest.duties, [duty]: stats } };
}

export function statsFor(
  manifest: TrustManifest,
  duty: string,
): TrustDutyStats {
  return manifest.duties[duty] ?? freshStats();
}

/**
 * Pure: apply an Approve/Reject/Dismiss verdict to a duty, returning a new
 * manifest. Approve bumps the streak (graduating at the threshold); reject
 * zeroes it and de-graduates (kill switch); dismiss is neutral (log only).
 */
export function applyTrustDecision(
  manifest: TrustManifest,
  entry: {
    duty: string;
    decision: TrustDecision;
    taskNumber: number;
    action?: string;
    at?: string;
    by?: string;
  },
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, entry.duty);
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
  const next = withStats(manifest, entry.duty, {
    approvals: prev.approvals + (isApprove ? 1 : 0),
    rejections: prev.rejections + (isReject ? 1 : 0),
    consecutiveApprovals,
    mode,
  });
  const logEntry: TrustDecisionLogEntry = {
    duty: entry.duty,
    decision: entry.decision,
    taskNumber: entry.taskNumber,
    at: entry.at ?? new Date().toISOString(),
    ...(entry.action ? { action: entry.action } : {}),
    ...(entry.by ? { by: entry.by } : {}),
  };
  return { ...next, log: [...manifest.log, logEntry].slice(-TRUST_LOG_MAX) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator overrides (the /trust page buttons) — pure
// ─────────────────────────────────────────────────────────────────────────────

export const TRUST_OPS = ["reset", "graduate", "degrade"] as const;
export type TrustOp = (typeof TRUST_OPS)[number];

/** Wipe a duty's trust back to zero / "ask". */
export function resetDuty(
  manifest: TrustManifest,
  duty: string,
): TrustManifest {
  return withStats(manifest, duty, freshStats());
}

/**
 * Instant grant — force a duty to "auto" now. Lifts the streak to the threshold
 * so the engine (which gates on `consecutiveApprovals`) agrees. Totals kept.
 */
export function graduateDuty(
  manifest: TrustManifest,
  duty: string,
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, duty);
  return withStats(manifest, duty, {
    ...prev,
    mode: "auto",
    consecutiveApprovals: Math.max(prev.consecutiveApprovals, threshold),
  });
}

/** Manual kill switch — back to "ask", streak zeroed. Totals kept. */
export function degradeDuty(
  manifest: TrustManifest,
  duty: string,
): TrustManifest {
  const prev = statsFor(manifest, duty);
  return withStats(manifest, duty, {
    ...prev,
    mode: "ask",
    consecutiveApprovals: 0,
  });
}

export function applyTrustOp(
  manifest: TrustManifest,
  op: TrustOp,
  duty: string,
): TrustManifest {
  switch (op) {
    case "reset":
      return resetDuty(manifest, duty);
    case "graduate":
      return graduateDuty(manifest, duty);
    case "degrade":
      return degradeDuty(manifest, duty);
  }
}

/** True when the engine may let this duty self-dispatch. */
export function isGraduated(manifest: TrustManifest, duty: string): boolean {
  return manifest.duties[duty]?.mode === "auto";
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
      duties:
        parsed.duties && typeof parsed.duties === "object" ? parsed.duties : {},
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
// View model for the /trust page — one row per duty
// ─────────────────────────────────────────────────────────────────────────────

export interface TrustDutyView extends TrustDutyStats {
  duty: string;
  /** Persona the duty runs as (from the roster), or null if unknown. */
  staff: string | null;
  /** Clean approvals still needed to graduate (0 once "auto"). */
  remaining: number;
  /** 0..1 streak progress toward the threshold. */
  progress: number;
  /** True once any verdict has been recorded for this duty. */
  hasHistory: boolean;
}

/** Pair of `(duty slug, persona it runs as)` — the only roster fields needed. */
export interface DutyStaffLink {
  slug: string;
  staff: string | null;
}

/**
 * Project the manifest + duty roster into one view row per duty: EVERY duty in
 * the roster appears (so its Auto toggle is always available, even with zero
 * history), plus any duty with recorded trust. Pure + deterministic.
 */
export function summarizeTrust(
  manifest: TrustManifest,
  duties: readonly DutyStaffLink[],
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustDutyView[] {
  const staffByDuty = new Map<string, string | null>();
  for (const d of duties) staffByDuty.set(d.slug, d.staff);

  const slugs = new Set<string>([
    ...Object.keys(manifest.duties),
    ...staffByDuty.keys(),
  ]);

  const views: TrustDutyView[] = [...slugs].map((duty) => {
    const stats = manifest.duties[duty];
    const s = stats ?? freshStats();
    const remaining =
      s.mode === "auto" ? 0 : Math.max(0, threshold - s.consecutiveApprovals);
    const progress =
      threshold <= 0 ? 1 : Math.min(1, s.consecutiveApprovals / threshold);
    return {
      duty,
      staff: staffByDuty.get(duty) ?? null,
      ...s,
      remaining,
      progress,
      hasHistory: !!stats,
    };
  });

  // Auto duties first, then those with history, then alpha.
  return views.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "auto" ? -1 : 1;
    if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1;
    return a.duty.localeCompare(b.duty);
  });
}
