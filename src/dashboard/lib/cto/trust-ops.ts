/**
 * @fileType utility
 * @domain kody
 * @pattern cto-trust-management
 * @ai-summary Pure management operations over the `kody:cto-decisions` trust
 *   ledger — the operator-facing counterpart to `applyDecision`.
 *
 *   `applyDecision` mutates trust as a *side effect* of an Approve/Reject on a
 *   single recommendation. These ops are *direct* operator overrides of a
 *   staff member's autonomy for a given action, surfaced on the /trust page:
 *
 *     - `reset`    → wipe the action's stats back to zero ("ask", streak 0).
 *     - `graduate` → force "auto" now (sets the streak to the threshold so the
 *                    engine, which graduates off `consecutiveApprovals`, agrees).
 *     - `degrade`  → force "ask" and zero the streak (the manual kill switch).
 *
 *   All functions are pure and immutable (never touch the input) — the same
 *   contract as `applyDecision`, so the CAS mutator can compose them safely.
 *   Management ops deliberately do NOT append to the decision `log`: the log is
 *   a trust *signal* (real Approve/Reject verdicts), not an audit of operator
 *   overrides — those are recorded out-of-band via `recordAudit`.
 */
import {
  CTO_GRADUATION_THRESHOLD,
  type CtoActionMode,
  type CtoDecisionsManifest,
  type StaffActionStats,
} from "./decisions";

/** The three direct trust overrides an operator can apply to an action. */
export const TRUST_OPS = ["reset", "graduate", "degrade"] as const;
export type TrustOp = (typeof TRUST_OPS)[number];

function freshStats(): StaffActionStats {
  return { approvals: 0, rejections: 0, consecutiveApprovals: 0, mode: "ask" };
}

/** Immutably write one staff member's action stats, returning a new manifest. */
function withStats(
  manifest: CtoDecisionsManifest,
  staff: string,
  action: string,
  stats: StaffActionStats,
): CtoDecisionsManifest {
  return {
    ...manifest,
    staff: {
      ...manifest.staff,
      [staff]: { ...(manifest.staff[staff] ?? {}), [action]: stats },
    },
  };
}

/** Current stats for `(staff, action)`, or a fresh zeroed block. */
function statsFor(
  manifest: CtoDecisionsManifest,
  staff: string,
  action: string,
): StaffActionStats {
  return manifest.staff[staff]?.[action] ?? freshStats();
}

/** Wipe an action's trust back to zero (approvals, rejections, streak → "ask"). */
export function resetAction(
  manifest: CtoDecisionsManifest,
  staff: string,
  action: string,
): CtoDecisionsManifest {
  return withStats(manifest, staff, action, freshStats());
}

/**
 * Force an action to "auto" now. The engine graduates off
 * `consecutiveApprovals >= threshold`, so we lift the streak to the threshold
 * too — otherwise the next engine tick would read a sub-threshold streak and
 * flip it straight back to "ask". Approval/rejection totals are preserved.
 */
export function graduateAction(
  manifest: CtoDecisionsManifest,
  staff: string,
  action: string,
  threshold: number = CTO_GRADUATION_THRESHOLD,
): CtoDecisionsManifest {
  const prev = statsFor(manifest, staff, action);
  return withStats(manifest, staff, action, {
    ...prev,
    mode: "auto",
    consecutiveApprovals: Math.max(prev.consecutiveApprovals, threshold),
  });
}

/**
 * Force an action back to "ask" and zero its streak — the manual kill switch.
 * Totals are preserved (we're revoking autonomy, not erasing history); zeroing
 * the streak stops the engine from immediately re-graduating it.
 */
export function degradeAction(
  manifest: CtoDecisionsManifest,
  staff: string,
  action: string,
): CtoDecisionsManifest {
  const prev = statsFor(manifest, staff, action);
  return withStats(manifest, staff, action, {
    ...prev,
    mode: "ask",
    consecutiveApprovals: 0,
  });
}

/** Apply any `TrustOp` by name (the API route's single dispatch point). */
export function applyTrustOp(
  manifest: CtoDecisionsManifest,
  op: TrustOp,
  staff: string,
  action: string,
): CtoDecisionsManifest {
  switch (op) {
    case "reset":
      return resetAction(manifest, staff, action);
    case "graduate":
      return graduateAction(manifest, staff, action);
    case "degrade":
      return degradeAction(manifest, staff, action);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// View model — pure projection for the /trust page
// ─────────────────────────────────────────────────────────────────────────────

export interface TrustActionView {
  action: string;
  approvals: number;
  rejections: number;
  consecutiveApprovals: number;
  mode: CtoActionMode;
  /** Clean approvals still needed to graduate (0 once "auto" or at threshold). */
  remaining: number;
  /** 0..1 progress of the current streak toward the graduation threshold. */
  progress: number;
}

export interface TrustStaffView {
  staff: string;
  /** Duty slugs that run as this staff persona (the triggers that earn trust). */
  duties: string[];
  actions: TrustActionView[];
  /** True when at least one action has graduated to "auto". */
  hasAuto: boolean;
}

/** Pair of `(duty slug, the staff it runs as)` — the only duty fields we need. */
export interface DutyStaffLink {
  slug: string;
  staff: string | null;
}

function toActionView(
  action: string,
  stats: StaffActionStats,
  threshold: number,
): TrustActionView {
  const remaining =
    stats.mode === "auto"
      ? 0
      : Math.max(0, threshold - stats.consecutiveApprovals);
  const progress =
    threshold <= 0 ? 1 : Math.min(1, stats.consecutiveApprovals / threshold);
  return {
    action,
    approvals: stats.approvals,
    rejections: stats.rejections,
    consecutiveApprovals: stats.consecutiveApprovals,
    mode: stats.mode,
    remaining,
    progress,
  };
}

/**
 * Project the raw manifest + duty roster into a per-staff view: every staff
 * member that has trust recorded OR is named by a duty, with its actions
 * (auto-first, then alpha) and the duties that run as it. Pure + deterministic
 * so the page renders the same on every device and the projection is testable.
 */
export function summarizeTrust(
  manifest: CtoDecisionsManifest,
  duties: readonly DutyStaffLink[],
  threshold: number = CTO_GRADUATION_THRESHOLD,
): TrustStaffView[] {
  const dutiesByStaff = new Map<string, string[]>();
  for (const d of duties) {
    if (!d.staff) continue;
    const list = dutiesByStaff.get(d.staff) ?? [];
    list.push(d.slug);
    dutiesByStaff.set(d.staff, list);
  }

  const slugs = new Set<string>([
    ...Object.keys(manifest.staff),
    ...dutiesByStaff.keys(),
  ]);

  const views: TrustStaffView[] = [...slugs].map((staff) => {
    const actionMap = manifest.staff[staff] ?? {};
    const actions = Object.entries(actionMap)
      .map(([action, stats]) => toActionView(action, stats, threshold))
      .sort((a, b) => {
        // Graduated (auto) actions float to the top; then by name.
        if (a.mode !== b.mode) return a.mode === "auto" ? -1 : 1;
        return a.action.localeCompare(b.action);
      });
    return {
      staff,
      duties: (dutiesByStaff.get(staff) ?? []).sort((a, b) =>
        a.localeCompare(b),
      ),
      actions,
      hasAuto: actions.some((a) => a.mode === "auto"),
    };
  });

  // Staff with recorded trust first (more actions → higher), then alpha.
  return views.sort((a, b) => {
    if (a.actions.length !== b.actions.length) {
      return b.actions.length - a.actions.length;
    }
    return a.staff.localeCompare(b.staff);
  });
}
