/**
 * @fileType utility
 * @domain kody
 * @pattern duty-trust-ledger
 * @ai-summary The duty-keyed trust ledger — types + pure transforms. This is
 *   the from-scratch replacement for the persona-keyed `kody:cto-decisions`
 *   issue manifest:
 *
 *     - keyed by DUTY slug → action (not persona), so two duties sharing a
 *       persona (e.g. `qa`, `qa-sweep`, `qa-verify` all run as `qa`) earn and
 *       lose autonomy independently;
 *     - stored as a JSON FILE on the `kody-state` branch (see `trust-store.ts`),
 *       never on an issue — issues are runnable tasks only;
 *     - read by BOTH the engine (the gate that lets a trusted duty self-dispatch)
 *       and the dashboard (the /trust page), so this shape is a shared contract.
 *
 *   All transforms are pure + immutable. The engine mirrors the read side; keep
 *   the JSON shape stable across both repos.
 */

/** Path of the single per-repo ledger file on the `kody-state` branch. */
export const TRUST_FILE_PATH = ".kody/state/trust.json";
export const TRUST_MANIFEST_VERSION = 1 as const;

/** Bound the log — it's a recent-activity signal, not an archive. */
export const TRUST_LOG_MAX = 500;

/**
 * Clean approvals a duty's action needs before it stops asking and the engine
 * lets it self-dispatch. A single reject zeroes the streak and de-graduates it.
 */
export const TRUST_GRADUATION_THRESHOLD = 10;

export type TrustMode = "ask" | "auto";
export type TrustDecision = "approve" | "reject" | "dismiss";

export interface TrustActionStats {
  approvals: number;
  rejections: number;
  /** Resets to 0 on any reject. Drives graduation. */
  consecutiveApprovals: number;
  /** "ask" until graduated; "auto" lets the engine dispatch without asking. */
  mode: TrustMode;
}

export interface TrustDecisionLogEntry {
  /** Duty slug whose recommendation this verdict decided. */
  duty: string;
  action: string;
  decision: TrustDecision;
  taskNumber: number;
  at: string;
  by?: string;
}

export interface TrustManifest {
  version: typeof TRUST_MANIFEST_VERSION;
  /** Trust stats nested by duty slug → action verb. */
  duties: Record<string, Record<string, TrustActionStats>>;
  log: TrustDecisionLogEntry[];
}

export const EMPTY_TRUST_MANIFEST: TrustManifest = {
  version: TRUST_MANIFEST_VERSION,
  duties: {},
  log: [],
};

export function freshStats(): TrustActionStats {
  return { approvals: 0, rejections: 0, consecutiveApprovals: 0, mode: "ask" };
}

function withStats(
  manifest: TrustManifest,
  duty: string,
  action: string,
  stats: TrustActionStats,
): TrustManifest {
  return {
    ...manifest,
    duties: {
      ...manifest.duties,
      [duty]: { ...(manifest.duties[duty] ?? {}), [action]: stats },
    },
  };
}

function statsFor(
  manifest: TrustManifest,
  duty: string,
  action: string,
): TrustActionStats {
  return manifest.duties[duty]?.[action] ?? freshStats();
}

/**
 * Pure: apply an Approve/Reject/Dismiss verdict, returning a new manifest.
 * Approve bumps approvals + streak (graduating at the threshold); reject zeroes
 * the streak and de-graduates (kill switch); dismiss is neutral (log only).
 */
export function applyTrustDecision(
  manifest: TrustManifest,
  entry: {
    duty: string;
    action: string;
    decision: TrustDecision;
    taskNumber: number;
    at?: string;
    by?: string;
  },
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, entry.duty, entry.action);
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
  const next = withStats(manifest, entry.duty, entry.action, {
    approvals: prev.approvals + (isApprove ? 1 : 0),
    rejections: prev.rejections + (isReject ? 1 : 0),
    consecutiveApprovals,
    mode,
  });
  const logEntry: TrustDecisionLogEntry = {
    duty: entry.duty,
    action: entry.action,
    decision: entry.decision,
    taskNumber: entry.taskNumber,
    at: entry.at ?? new Date().toISOString(),
    ...(entry.by ? { by: entry.by } : {}),
  };
  return { ...next, log: [...manifest.log, logEntry].slice(-TRUST_LOG_MAX) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator overrides (the /trust page buttons) — pure, monotonic where stated
// ─────────────────────────────────────────────────────────────────────────────

export const TRUST_OPS = ["reset", "graduate", "degrade"] as const;
export type TrustOp = (typeof TRUST_OPS)[number];

/** Wipe a duty's action trust back to zero / "ask". */
export function resetAction(
  manifest: TrustManifest,
  duty: string,
  action: string,
): TrustManifest {
  return withStats(manifest, duty, action, freshStats());
}

/**
 * Instant grant — force "auto" now. Lifts the streak to the threshold so the
 * engine (which gates on `consecutiveApprovals`) agrees. Totals preserved.
 */
export function graduateAction(
  manifest: TrustManifest,
  duty: string,
  action: string,
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, duty, action);
  return withStats(manifest, duty, action, {
    ...prev,
    mode: "auto",
    consecutiveApprovals: Math.max(prev.consecutiveApprovals, threshold),
  });
}

/** Manual kill switch — back to "ask" and zero the streak. Totals preserved. */
export function degradeAction(
  manifest: TrustManifest,
  duty: string,
  action: string,
): TrustManifest {
  const prev = statsFor(manifest, duty, action);
  return withStats(manifest, duty, action, {
    ...prev,
    mode: "ask",
    consecutiveApprovals: 0,
  });
}

export function applyTrustOp(
  manifest: TrustManifest,
  op: TrustOp,
  duty: string,
  action: string,
): TrustManifest {
  switch (op) {
    case "reset":
      return resetAction(manifest, duty, action);
    case "graduate":
      return graduateAction(manifest, duty, action);
    case "degrade":
      return degradeAction(manifest, duty, action);
  }
}

/** True when the engine may let this duty self-dispatch the action. */
export function isGraduated(
  manifest: TrustManifest,
  duty: string,
  action: string,
): boolean {
  return manifest.duties[duty]?.[action]?.mode === "auto";
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
// View model for the /trust page — grouped by duty
// ─────────────────────────────────────────────────────────────────────────────

export interface TrustActionView extends TrustActionStats {
  action: string;
  /** Clean approvals still needed to graduate (0 once "auto"). */
  remaining: number;
  /** 0..1 streak progress toward the threshold. */
  progress: number;
}

export interface TrustDutyView {
  duty: string;
  /** Persona the duty runs as (from the duty roster), or null if unknown. */
  staff: string | null;
  actions: TrustActionView[];
  hasAuto: boolean;
}

/** Pair of `(duty slug, persona it runs as)` — the only roster fields needed. */
export interface DutyStaffLink {
  slug: string;
  staff: string | null;
}

function toActionView(
  action: string,
  stats: TrustActionStats,
  threshold: number,
): TrustActionView {
  const remaining =
    stats.mode === "auto"
      ? 0
      : Math.max(0, threshold - stats.consecutiveApprovals);
  const progress =
    threshold <= 0 ? 1 : Math.min(1, stats.consecutiveApprovals / threshold);
  return { action, ...stats, remaining, progress };
}

/**
 * Project the manifest + duty roster into per-duty view rows: every duty with
 * trust recorded OR present in the roster, with its actions (auto-first, then
 * alpha) and the persona it runs as. Pure + deterministic.
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
    const actionMap = manifest.duties[duty] ?? {};
    const actions = Object.entries(actionMap)
      .map(([action, stats]) => toActionView(action, stats, threshold))
      .sort((a, b) => {
        if (a.mode !== b.mode) return a.mode === "auto" ? -1 : 1;
        return a.action.localeCompare(b.action);
      });
    return {
      duty,
      staff: staffByDuty.get(duty) ?? null,
      actions,
      hasAuto: actions.some((a) => a.mode === "auto"),
    };
  });

  return views.sort((a, b) => {
    if (a.actions.length !== b.actions.length) {
      return b.actions.length - a.actions.length;
    }
    return a.duty.localeCompare(b.duty);
  });
}
