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
  active: 15_000, // 15s - selected task is running
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

export const GITHUB_OWNER = process.env.GITHUB_OWNER?.trim() ?? "A-Guy-educ";
export const GITHUB_REPO = process.env.GITHUB_REPO?.trim() ?? "A-Guy";

/**
 * Generate a GitHub issue URL from an issue number
 */
export function getGitHubIssueUrl(issueNumber: number): string {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`;
}

/**
 * Generate a GitHub PR URL from a PR number
 */
export function getGitHubPrUrl(prNumber: number): string {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/pull/${prNumber}`;
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
  tasks: 120000, // 2min - reduced API calls while staying fresh
  pipeline: 60000, // 1min - fresh enough for status checks
  boards: 900000, // 15min - labels/milestones rarely change
  prs: 300000, // 5min - PRs don't change that often
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

// ============ Site URLs ============

export const SITE_URLS = {
  dev: process.env.NEXT_PUBLIC_DEV_SITE_URL ?? "https://dev.aguy.co.il",
  prod: process.env.NEXT_PUBLIC_PROD_SITE_URL ?? "https://aguy.co.il",
};

// ============ Branch Names ============

export const DEV_BRANCH = "dev";
export const PROD_BRANCH = "main";

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
