/**
 * @fileType constants
 * @domain kody
 * @pattern constants
 * @ai-summary Constants for Kody dashboard pipeline and configuration
 */

// ============ Pipeline Stages ============

export const SPEC_STAGES = ["taskify", "gap", "clarify"] as const;
export const IMPL_STAGES = [
  "architect",
  "plan-gap",
  "build",
  "commit",
  "review",
  "fix",
  "verify",
  "pr",
] as const;
export const AUTOFIX_STAGE = "autofix" as const;

export type SpecStage = (typeof SPEC_STAGES)[number];
export type ImplStage = (typeof IMPL_STAGES)[number];
export type AllStage = SpecStage | ImplStage | typeof AUTOFIX_STAGE;

export const ALL_STAGES = [
  ...SPEC_STAGES,
  ...IMPL_STAGES,
  AUTOFIX_STAGE,
] as const;

// ============ Kanban Columns ============

export type ColumnId =
  | "open"
  | "building"
  | "review"
  | "failed"
  | "gate-waiting"
  | "retrying"
  | "done";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  color: string;
  order: number;
}

export const COLUMN_DEFS: Record<ColumnId, ColumnDef> = {
  open: { id: "open", label: "Open", color: "gray", order: 0 },
  building: { id: "building", label: "Building", color: "blue", order: 1 },
  review: { id: "review", label: "Review", color: "purple", order: 2 },
  failed: { id: "failed", label: "Failed", color: "red", order: 3 },
  "gate-waiting": {
    id: "gate-waiting",
    label: "Needs Approval",
    color: "yellow",
    order: 4,
  },
  retrying: { id: "retrying", label: "Retrying", color: "orange", order: 5 },
  done: { id: "done", label: "Done", color: "green", order: 6 },
};

// ============ Polling Intervals ============

export const POLLING_INTERVALS = {
  idle: 60_000, // 60s - no running tasks
  board: 30_000, // 30s - has running tasks
  active: 30_000, // 30s - selected task is running (was 15s; Kody stages take minutes)
  backlog: 120_000, // 120s - backlog view, tasks change rarely
} as const;

// ============ Branch Prefixes ============

export const BRANCH_PREFIXES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "chore",
] as const;

// ============ GitHub Configuration ============

export const GITHUB_OWNER = process.env.GITHUB_OWNER?.trim() ?? "";
export const GITHUB_REPO = process.env.GITHUB_REPO?.trim() ?? "";

/**
 * Where "report a Kody bug" issues are filed — the dashboard's OWN public
 * repo, NOT the consumer's connected repo. Hardcoded (not env) to keep the
 * env-var surface tiny; forks point this at their own repo. Any logged-in
 * GitHub user can open an issue on a public repo, so the reporter's own PAT
 * works without them being a collaborator.
 */
export const KODY_REPORT_TARGET = {
  owner: "aharonyaircohen",
  repo: "Kody-Dashboard",
} as const;

/** Components a Kody bug can be attributed to (becomes an `area:*` label). */
export const KODY_BUG_AREAS = [
  "dashboard",
  "engine",
  "chat",
  "runners",
  "other",
] as const;
export type KodyBugArea = (typeof KODY_BUG_AREAS)[number];

/** Severity for a Kody bug (becomes a `severity:*` label). */
export const KODY_BUG_SEVERITIES = ["blocker", "major", "minor"] as const;
export type KodyBugSeverity = (typeof KODY_BUG_SEVERITIES)[number];

/**
 * Read the connected repo from localStorage kody_auth.
 * Falls back to GITHUB_OWNER/GITHUB_REPO env vars if not set.
 */
function getConnectedRepo(): { owner: string; repo: string } {
  if (typeof window === "undefined") {
    return { owner: GITHUB_OWNER, repo: GITHUB_REPO };
  }
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return { owner: GITHUB_OWNER, repo: GITHUB_REPO };
    const auth = JSON.parse(raw) as { owner?: string; repo?: string };
    if (auth.owner && auth.repo) return { owner: auth.owner, repo: auth.repo };
  } catch {
    // ignore
  }
  return { owner: GITHUB_OWNER, repo: GITHUB_REPO };
}

/**
 * Generate a GitHub issue URL from an issue number.
 * Uses the user's connected repo from localStorage, falling back to env defaults.
 */
export function getGitHubIssueUrl(issueNumber: number): string {
  const { owner, repo } = getConnectedRepo();
  return `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
}

/**
 * Generate a GitHub PR URL from a PR number.
 * Uses the user's connected repo from localStorage, falling back to env defaults.
 */
export function getGitHubPrUrl(prNumber: number): string {
  const { owner, repo } = getConnectedRepo();
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

export const WORKFLOW_ID = "kody.yml";

// ============ Task ID ============

export const TASK_ID_REGEX = /^[0-9]{6}-[a-zA-Z0-9-]+$/;

// ============ Status Icons ============

export const STAGE_ICONS = {
  completed: "✅",
  failed: "❌",
  running: "🔄",
  pending: "⏳",
  skipped: "⚪",
  "gate-waiting": "🚫",
  paused: "⏸️",
  timeout: "⏰",
} as const;

// ============ Cache TTL ============

export const BRANCH_CACHE_TTL = 600000; // 10min - branches rarely change

export const CACHE_TTL = {
  // ETag/304 revalidation kicks in after the TTL — these windows just gate the
  // optimistic "definitely fresh" path. Issue/workflow data lags a few minutes
  // is fine because state changes that matter (task moves, PR opens, comments)
  // already invalidate explicitly via invalidateIssueCache / invalidatePRCache.
  tasks: 300000, // 5min - issues/comments listings; ETag handles freshness
  pipeline: 180000, // 3min - workflow runs + pipeline JSON; multi-minute stages
  boards: 900000, // 15min - labels/milestones rarely change
  // 30s (was 5min). Cross-instance invalidation isn't wired (in-memory
  // cache only invalidates on the receiving serverless instance), so the
  // worst-case staleness window other instances see equals this TTL.
  // A user opening an issue moments after a PR is created/linked needs
  // to see the link without a 5-minute wait. Proper fix: swap to
  // unstable_cache + revalidateTag — tracked as a follow-up in CLAUDE.md.
  prs: 30000,
} as const;

// ============ Emoji List ============

export const EMOJI_LIST = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "🤣",
  "😂",
  "🙂",
  "🙃",
  "😉",
  "😊",
  "😇",
  "🥰",
  "😍",
  "🤩",
  "😘",
  "😗",
  "😚",
  "😙",
  "🥲",
  "😋",
  "😛",
  "😜",
  "🤪",
  "😝",
  "🤑",
  "🤗",
  "🤭",
  "🤫",
  "🤔",
  "🤐",
  "🤨",
  "😐",
  "😑",
  "😶",
  "😏",
  "😒",
  "🙄",
  "😬",
  "😮‍💨",
  "🤥",
  "😌",
  "😔",
  "😪",
  "🤤",
  "😴",
  "😷",
  "👍",
  "👎",
  "👌",
  "✌️",
  "🤞",
  "🤟",
  "🤘",
  "🤙",
  "👈",
  "👉",
  "👆",
  "👇",
  "☝️",
  "👋",
  "🤚",
  "🖐️",
  "✋",
  "🖖",
  "👏",
  "🙌",
  "🤲",
  "🤝",
  "🙏",
  "✍️",
  "❤️",
  "🧡",
  "💛",
  "💚",
  "💙",
  "💜",
  "🖤",
  "🤍",
  "💔",
  "❣️",
  "💕",
  "💞",
  "💓",
  "💗",
  "💖",
  "💘",
  "🚀",
  "⭐",
  "🌟",
  "✨",
  "💫",
  "🔥",
  "💥",
  "💯",
  "✅",
  "❌",
  "⚠️",
  "❓",
  "❗",
  "💡",
  "🔔",
  "🎉",
] as const;

// ============ Risk Level Colors ============

export const RISK_COLORS = {
  low: "green",
  medium: "yellow",
  high: "red",
} as const;

// ============ Task Type Prefixes ============

export const TASK_TYPE_PREFIX: Record<string, string> = {
  implement_feature: "feat",
  fix_bug: "fix",
  refactor: "refactor",
  docs: "docs",
  ops: "chore",
  research: "chore",
  spec_only: "feat",
};

// ============ Branch Names ============

export const DEV_BRANCH = "dev";
export const PROD_BRANCH = "main";

// ============ Kody Lifecycle & Flow Labels ============

/** Lifecycle phases set by the engine on issues/PRs. Mutex — one at a time. */
export const KODY_PHASES = [
  "classifying",
  "researching",
  "planning",
  "running",
  "fixing",
  "resolving",
  "reviewing",
  "syncing",
  "orchestrating",
  "done",
  "failed",
] as const;
export type KodyPhase = (typeof KODY_PHASES)[number];

/** Flow types set by classify/orchestrator — persistent metadata on the issue. */
export const KODY_FLOWS = ["feature", "bug", "spec", "chore"] as const;
export type KodyFlow = (typeof KODY_FLOWS)[number];

const KODY_PHASE_SET = new Set<string>(KODY_PHASES);
const KODY_FLOW_SET = new Set<string>(KODY_FLOWS);

/** Extract the active kody:* phase from a label list, or null if none set. */
export function parseKodyPhase(labels: string[]): KodyPhase | null {
  for (const l of labels) {
    if (!l.startsWith("kody:")) continue;
    const suffix = l.slice("kody:".length);
    if (KODY_PHASE_SET.has(suffix)) return suffix as KodyPhase;
  }
  return null;
}

/** Extract the flow type from a label list, or null if none set. */
export function parseKodyFlow(labels: string[]): KodyFlow | null {
  for (const l of labels) {
    if (!l.startsWith("kody-flow:")) continue;
    const suffix = l.slice("kody-flow:".length);
    if (KODY_FLOW_SET.has(suffix)) return suffix as KodyFlow;
  }
  return null;
}

// ============ Priority Labels ============

export const PRIORITY_LEVELS = ["P0", "P1", "P2", "P3"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const PRIORITY_META: Record<
  PriorityLevel,
  { label: string; description: string; badge: string; colorClass: string }
> = {
  P0: {
    label: "Critical",
    description: "System down, data loss, security breach",
    badge: "🔴",
    colorClass: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  P1: {
    label: "High",
    description: "Major feature broken, no workaround",
    badge: "🟠",
    colorClass: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  P2: {
    label: "Medium",
    description: "Feature impaired but workaround exists",
    badge: "🟡",
    colorClass: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  P3: {
    label: "Low",
    description: "Minor issue, cosmetic, nice-to-have",
    badge: "🟢",
    colorClass: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  },
};

/** Convert a priority label string like "priority:P1" to a PriorityLevel, or undefined */
export function parsePriorityLabel(label: string): PriorityLevel | undefined {
  if (!label.startsWith("priority:")) return undefined;
  const level = label.replace("priority:", "") as PriorityLevel;
  return PRIORITY_LEVELS.includes(level) ? level : undefined;
}

/** Get the priority level for a task from its labels, or undefined if no priority set */
export function getTaskPriority(labels: string[]): PriorityLevel | undefined {
  for (const label of labels) {
    const p = parsePriorityLabel(label);
    if (p) return p;
  }
  return undefined;
}

/** Numeric rank for sorting (lower = higher priority). Unset = 99 */
export const PRIORITY_RANK: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

// ============ Internal (non-task) issues ============

/**
 * Umbrella label stamped on every dashboard-infrastructure issue (manifest
 * stores, the Run-now control audit trail) at creation time. Excluding this
 * one label keeps *future* internal issue types out of the task list without
 * touching the exclude site again.
 */
export const INTERNAL_ISSUE_LABEL = "kody:internal";

/**
 * Every label that marks an issue as dashboard infrastructure rather than a
 * real task. The umbrella label covers anything created after this change;
 * the specific legacy labels are kept so issues created *before* it (which
 * never got `kody:internal`) are still filtered without a backfill. Single
 * source of truth — readers (task list, activity feed) exclude this set.
 */
export const INTERNAL_ISSUE_LABELS = [
  INTERNAL_ISSUE_LABEL,
  "kody:control",
  "kody:inbox-feed",
  "kody:cto-decisions",
  "kody:goals-manifest",
  "kody:push-subscriptions",
  "kody:audit-log",
] as const;

export const HIDDEN_TASK_LABEL = "kody:hidden";

export const TASK_LIST_EXCLUDED_LABELS = [
  ...INTERNAL_ISSUE_LABELS,
  HIDDEN_TASK_LABEL,
] as const;

/**
 * Discovery label for the durable audit-log manifest issue (the "who did
 * what" trail surfaced on the Activity → Log tab). Stored in an issue body
 * as a bounded ring via the shared manifest-store CAS, written with the
 * acting user's own PAT so it draws on their personal rate budget.
 */
export const AUDIT_LOG_LABEL = "kody:audit-log";
export const AUDIT_LOG_ISSUE_TITLE = "Kody Audit Log (do not edit)";
