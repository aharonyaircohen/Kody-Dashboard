/**
 * @fileType utility
 * @domain kody
 * @pattern api-client
 * @ai-summary Typed API client for Kody dashboard
 */

import type {
  KodyTask,
  Board,
  GitHubCollaborator,
  FileChange,
  TaskDocument,
  TasksResponse,
  BoardsResponse,
  CollaboratorsResponse,
  ActionResponse,
  PRComment,
  WorkflowRun,
} from "./types";

const API_BASE = "/api/kody";

// ============ Auth Headers ============

export function getStoredAuth(): {
  token: string;
  owner: string;
  repo: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const auth = JSON.parse(raw) as {
      token?: string;
      owner?: string;
      repo?: string;
    };
    if (!auth.token || !auth.owner || !auth.repo) return null;
    return { token: auth.token, owner: auth.owner, repo: auth.repo };
  } catch {
    return null;
  }
}

/**
 * Read the user-scoped Fly performance tier. Returns null when unset; the
 * server then falls back to the documented default ("medium" =
 * performance-1x). Sent as the `x-kody-fly-perf` header on start-fly calls.
 */
export function getStoredFlyPerf(): "low" | "medium" | "high" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { flyPerf?: string };
    if (
      parsed.flyPerf === "low" ||
      parsed.flyPerf === "medium" ||
      parsed.flyPerf === "high"
    ) {
      return parsed.flyPerf;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read optional Brain assistant config stored at login. Returns null unless
 * both `url` and `apiKey` are present — partial config is treated as missing.
 */
export function getStoredBrainConfig(): { url: string; apiKey: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      brain?: { url?: string; apiKey?: string };
    };
    const b = parsed.brain;
    if (!b?.url || !b.apiKey) return null;
    return { url: b.url, apiKey: b.apiKey };
  } catch {
    return null;
  }
}

function buildHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const auth = getStoredAuth();
  return {
    "Content-Type": "application/json",
    ...(auth
      ? {
          "x-kody-token": auth.token,
          "x-kody-owner": auth.owner,
          "x-kody-repo": auth.repo,
        }
      : {}),
    ...extra,
  };
}

// ============ Error Types ============

export class RateLimitError extends Error {
  retryAfter: string | null;
  resetTime: string | null;

  constructor(message: string, retryAfter?: string, resetTime?: string) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter ?? null;
    this.resetTime = resetTime ?? null;
  }
}

export class NoTokenError extends Error {
  constructor(message = "GitHub token is not configured. Please log in.") {
    super(message);
    this.name = "NoTokenError";
  }
}

export class SessionExpiredError extends Error {
  constructor(message = "Your session has expired. Please log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

/**
 * Drop stored credentials and bounce to the dashboard root. The root
 * route's AuthGuard then renders the `<RepoManager />` empty-state so the
 * user can re-connect a repo. There is no separate `/login` page anymore.
 *
 * `returnTo` is kept for call-site compatibility but is unused — we always
 * land on `/`, since most callers were only redirecting to clear stale auth.
 */
export function redirectToLogin(_returnTo = "/"): void {
  void _returnTo;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("kody_auth");
    } catch {
      // ignore — SSR or storage disabled
    }
    window.location.href = "/";
  }
}

// ============ Helpers ============

export async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();

  if (res.status === 429) {
    throw new RateLimitError(
      data.message || "Rate limited",
      data.retryAfter ?? undefined,
      data.resetTime ?? undefined,
    );
  }

  if (res.status === 401) {
    // Token-based auth: all 401s mean the user needs to log in again.
    throw new SessionExpiredError(
      data.message || "Your session has expired. Please log in again.",
    );
  }

  if (!res.ok) {
    throw new ApiError(data.error || "Request failed", res.status, data);
  }

  return data as T;
}

// ============ Tasks API ============

export const tasksApi = {
  list: async (params?: {
    days?: number;
    includeDetails?: boolean;
  }): Promise<KodyTask[]> => {
    const searchParams = new URLSearchParams();
    if (params?.days) searchParams.set("days", String(params.days));
    if (params?.includeDetails === false)
      searchParams.set("includeDetails", "false");

    const url = `${API_BASE}/tasks${searchParams.toString() ? `?${searchParams}` : ""}`;
    const res = await fetch(url, { headers: buildHeaders() });
    const data = await handleResponse<TasksResponse>(res);
    return data.tasks;
  },

  get: async (
    issueNumber: number,
  ): Promise<{
    task: KodyTask;
    assignees: Array<{ login: string; avatar_url: string }>;
    comments: unknown[];
  }> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },

  /**
   * Lightweight fetch for closed issues filtered by a goal label.
   * Used by the per-goal "Show closed" toggle in GoalGroupedView.
   * Returns minimally-shaped KodyTask[] (column='done', state='closed') —
   * no pipeline derivation, no workflow run matching, no PR linkage.
   */
  listClosedForGoal: async (goalId: string): Promise<KodyTask[]> => {
    const res = await fetch(
      `${API_BASE}/tasks/closed?goal=${encodeURIComponent(goalId)}`,
      { headers: buildHeaders() },
    );
    const data = await handleResponse<TasksResponse>(res);
    return data.tasks;
  },

  create: async (data: {
    title: string;
    body: string;
    mode: string;
    labels?: string[];
    assignees?: string[];
    attachments?: Array<{ name: string; content: string }>;
    actorLogin?: string;
    /**
     * When false, the server skips the @kody auto-comment so the issue is
     * created without kicking off the Kody pipeline. Defaults to true
     * server-side.
     */
    autoTrigger?: boolean;
  }): Promise<KodyTask> => {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  update: async (
    issueNumber: number,
    data: {
      title?: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
      actorLogin?: string;
    },
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "update",
        title: data.title,
        body: data.body,
        labels: data.labels,
        assignees: data.assignees,
        ...(data.actorLogin && { actorLogin: data.actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  execute: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "execute",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  rerun: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "rerun",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  close: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "close",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  closePR: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "close-pr",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  reset: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "reset",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  reopen: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "reopen",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  abort: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "abort",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  approveUI: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "approve-ui",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  approvePR: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "approve-pr",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  reportIssue: async (
    issueNumber: number,
    notes: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "report-issue",
        comment: notes,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  comment: async (
    issueNumber: number,
    comment: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "comment",
        comment,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  // Retry with context: empty context posts `@kody resume` (preserves state,
  // continues from the last completed step). Non-empty context posts a bare
  // `@kody` followed by the context — that routes to classify on issues
  // (full restart from scratch) or fix on PRs (context = fix feedback).
  retryWithContext: async (
    issueNumber: number,
    context: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const comment = context.trim()
      ? `@kody\n\n${context.trim()}`
      : "@kody resume";

    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "comment",
        comment,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  fixRequest: async (
    issueNumber: number,
    fixDescription: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "fix",
        comment: fixDescription,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  approveReview: async (
    task: KodyTask,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    if (!task.associatedPR) {
      throw new Error("No PR associated with this task");
    }
    const res = await fetch(`${API_BASE}/tasks/approve-review`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        prNumber: task.associatedPR.number,
        issueNumber: task.issueNumber,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  assign: async (
    issueNumber: number,
    assignees: string[],
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "assign",
        assignees,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  unassign: async (
    issueNumber: number,
    assignees: string[],
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "unassign",
        assignees,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  addToQueue: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "add-label",
        label: "kody:queued",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  removeFromQueue: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "remove-label",
        label: "kody:queued",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  addLabel: async (
    issueNumber: number,
    label: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "add-label",
        label,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  removeLabel: async (
    issueNumber: number,
    label: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "remove-label",
        label,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },
};

// ============ PRs API ============

export const prsApi = {
  files: async (prNumber: number): Promise<FileChange[]> => {
    const res = await fetch(`${API_BASE}/prs/files?prNumber=${prNumber}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ files: FileChange[] }>(res);
    return data.files;
  },
  // PR CI status is sourced from the bulk tasks list — see usePRCIStatus.
  behind: async (prNumber: number): Promise<number> => {
    const res = await fetch(`${API_BASE}/prs/behind?prNumber=${prNumber}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ behindBy: number }>(res);
    return data.behindBy;
  },
  comments: async (prNumber: number): Promise<PRComment[]> => {
    const res = await fetch(`${API_BASE}/prs/comments?prNumber=${prNumber}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ comments: PRComment[] }>(res);
    return data.comments;
  },
  // Resolves a PR's preview URL on-demand (so the pane doesn't wait for the
  // background tasks poll). Fly-first when `pr` is given and the repo builds
  // previews on Fly; otherwise the server falls back to the Vercel deployment
  // for `sha`.
  preview: async (sha: string, pr?: number): Promise<string | null> => {
    const qs = pr ? `?sha=${sha}&pr=${pr}` : `?sha=${sha}`;
    const res = await fetch(`${API_BASE}/prs/preview${qs}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ previewUrl: string | null }>(res);
    return data.previewUrl;
  },
  postComment: async (
    prNumber: number,
    body: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/prs/comments`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        prNumber,
        body,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },
};
// ============ Task Documents API ============

export const taskDocsApi = {
  list: async (taskId: string, branch?: string): Promise<TaskDocument[]> => {
    const params = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    const res = await fetch(`${API_BASE}/tasks/${taskId}/docs${params}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ documents: TaskDocument[] }>(res);
    return data.documents;
  },
};

// ============ Boards API ============

export const boardsApi = {
  list: async (): Promise<Board[]> => {
    const res = await fetch(`${API_BASE}/boards`, { headers: buildHeaders() });
    const data = await handleResponse<BoardsResponse>(res);
    return data.boards;
  },
};

// ============ Collaborators API ============

export const collaboratorsApi = {
  list: async (): Promise<GitHubCollaborator[]> => {
    const res = await fetch(`${API_BASE}/collaborators`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<CollaboratorsResponse>(res);
    return data.collaborators;
  },
};

// ============ Workflows API ============

export const workflowsApi = {
  list: async (params?: { status?: string }): Promise<WorkflowRun[]> => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    const url = `${API_BASE}/workflows${searchParams.toString() ? `?${searchParams}` : ""}`;
    const res = await fetch(url, { headers: buildHeaders() });
    const data = await handleResponse<{ runs: WorkflowRun[] }>(res);
    return data.runs;
  },
};

// ============ Default-branch CI API ============

export interface DefaultBranchCI {
  state: "success" | "failure" | "pending" | "unknown";
  branch: string;
  sha?: string;
  latestRun?: {
    id: number;
    name: string;
    status: "queued" | "in_progress" | "completed";
    conclusion: string | null;
    html_url: string;
    updated_at: string;
  };
  failingRuns: Array<{
    id: number;
    name: string;
    conclusion: string;
    html_url: string;
    updated_at: string;
  }>;
  fetchedAt: string;
}

export const ciApi = {
  main: async (): Promise<DefaultBranchCI> => {
    const res = await fetch(`${API_BASE}/ci/main`, { headers: buildHeaders() });
    return handleResponse<DefaultBranchCI>(res);
  },
};

// ============ Remote Dev API ============

export interface RemoteExecPayload {
  command?: string;
  path?: string;
  content?: string;
  cwd?: string;
}

export interface RemoteExecResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  content?: string;
  entries?: Array<{ name: string; type: string; size?: number }>;
  truncated?: boolean;
  success?: boolean;
  error?: string;
}

export interface RemoteStatus {
  configured: boolean;
  online: boolean;
  funnelUrl?: string;
}

type RemoteAction = "exec" | "read" | "write" | "ls";

export const remoteApi = {
  /**
   * Check if the remote dev agent is online for the given user.
   */
  status: async (actorLogin: string): Promise<RemoteStatus> => {
    const res = await fetch(
      `${API_BASE}/remote/status?actorLogin=${encodeURIComponent(actorLogin)}`,
      { headers: buildHeaders() },
    );
    // The API returns { configured: false } for non-configured users (200 OK)
    return handleResponse<RemoteStatus>(res);
  },

  /**
   * Execute an action on the remote dev agent.
   */
  exec: async (
    actorLogin: string,
    action: RemoteAction,
    payload: RemoteExecPayload,
  ): Promise<RemoteExecResult> => {
    const res = await fetch(`${API_BASE}/remote/exec`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ actorLogin, action, payload }),
    });
    return handleResponse<RemoteExecResult>(res);
  },
};

// ============ Duties API ============

/** Per-duty cadence tokens; mirrors `ScheduleEvery` in duties-frontmatter.ts. */
export type DutySchedule =
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "6h"
  | "12h"
  | "1d"
  | "3d"
  | "7d"
  /** Sentinel: scheduler never auto-fires; only the dashboard "Run now" button executes it. */
  | "manual";

export interface Duty {
  /** Filename without `.md` — stable identity. */
  slug: string;
  title: string;
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /**
   * Last commit timestamp of the sibling `<slug>.state.json` (ISO8601),
   * or `null` if the duty has never run. The engine writes
   * `<slug>.state.json` on every tick that acts.
   */
  lastTickAt: string | null;
  /**
   * UTC ISO timestamp at which this duty will next be eligible to act —
   * read from `data.nextEligibleISO` in the state JSON. `null` if the
   * duty has never run, or its body doesn't yet emit the field.
   */
  nextEligibleAt: string | null;
  /**
   * Coarse result of the most recent tick — `data.lastOutcome` in the state
   * JSON, stamped by the engine from the agent result. `null` when never run
   * or on an engine that predates the field.
   */
  lastOutcome: "completed" | "failed" | null;
  /** Wall-clock of the most recent tick (ms) — `data.lastDurationMs`, or null. */
  lastDurationMs: number | null;
  /**
   * Per-duty cadence parsed from frontmatter. `null` = global cron wake
   * (every 15 min). Engine-side gating ships separately.
   */
  schedule: DutySchedule | null;
  /**
   * Mirrors `disabled: true` in the frontmatter. When `true` the engine
   * scheduler skips this duty; manual "Run now" still fires.
   */
  disabled: boolean;
  /**
   * Slug of the staff member (persona) that executes this duty, from the
   * `staff:` frontmatter. The duty owns the schedule; the staff member is
   * *who* the engine tick runs as. `null` = no staff assigned — the engine
   * scheduler skips such duties (every duty must name an executor).
   */
  staff: string | null;
  /**
   * GitHub logins this duty's output should `@`-mention, parsed from the
   * `mentions:` frontmatter (comma-separated, no `@`). Empty array when the
   * key is absent.
   */
  mentions: string[];
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /**
   * True when this row is a folder-duty (`.kody/duties/<slug>/profile.json`)
   * rather than a markdown duty. The list routes its edit to the full folder
   * editor (`/executables/<slug>`) instead of the markdown dialog.
   */
  folder?: boolean;
}

export const dutiesApi = {
  list: async (): Promise<Duty[]> => {
    const res = await fetch(`${API_BASE}/duties`, { headers: buildHeaders() });
    const data = await handleResponse<{ duties: Duty[] }>(res);
    return data.duties;
  },

  get: async (slug: string): Promise<Duty> => {
    const res = await fetch(`${API_BASE}/duties/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ duty: Duty }>(res);
    return data.duty;
  },

  create: async (data: {
    slug?: string;
    title: string;
    body: string;
    schedule?: DutySchedule | null;
    disabled?: boolean;
    staff?: string | null;
    mentions?: string[];
    actorLogin?: string;
  }): Promise<Duty> => {
    const res = await fetch(`${API_BASE}/duties`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ duty: Duty }>(res);
    return payload.duty;
  },

  update: async (
    slug: string,
    data: {
      title?: string;
      body?: string;
      schedule?: DutySchedule | null;
      disabled?: boolean;
      staff?: string | null;
      mentions?: string[];
      actorLogin?: string;
    },
  ): Promise<Duty> => {
    const res = await fetch(`${API_BASE}/duties/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ duty: Duty }>(res);
    return payload.duty;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/duties/${encodeURIComponent(slug)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  /**
   * Manually trigger a single duty by posting an `@kody job-tick` comment
   * on the repo's "Kody control" issue. The engine's existing
   * `issue_comment` trigger routes to job-tick. Defaults to `force: true`
   * because the operator clicked "Run now" — they want it to run regardless
   * of the body's cadence guard. Pass `force: false` to respect the guard.
   *
   * Replaces the legacy chat-trigger fake — no `KODY_MASTER_KEY` HMAC
   * required, no fake chat session, no overloaded sessionId.
   */
  run: async (
    duty: { slug: string },
    opts?: { force?: boolean },
  ): Promise<{
    issueNumber: number;
    commentId: number;
    commentUrl: string;
    force: boolean;
  }> => {
    const res = await fetch(
      `${API_BASE}/duties/${encodeURIComponent(duty.slug)}/run`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ force: opts?.force ?? true }),
      },
    );
    return handleResponse(res);
  },
};

// ============ Staff API ============

export interface Staff {
  /** Filename without `.md` — stable identity. */
  slug: string;
  title: string;
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export const staffApi = {
  list: async (): Promise<Staff[]> => {
    const res = await fetch(`${API_BASE}/staff`, { headers: buildHeaders() });
    const data = await handleResponse<{ staff: Staff[] }>(res);
    return data.staff;
  },

  get: async (slug: string): Promise<Staff> => {
    const res = await fetch(`${API_BASE}/staff/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ staffMember: Staff }>(res);
    return data.staffMember;
  },

  create: async (data: {
    slug?: string;
    title: string;
    body: string;
    actorLogin?: string;
  }): Promise<Staff> => {
    const res = await fetch(`${API_BASE}/staff`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ staffMember: Staff }>(res);
    return payload.staffMember;
  },

  update: async (
    slug: string,
    data: {
      title?: string;
      body?: string;
      actorLogin?: string;
    },
  ): Promise<Staff> => {
    const res = await fetch(`${API_BASE}/staff/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ staffMember: Staff }>(res);
    return payload.staffMember;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/staff/${encodeURIComponent(slug)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  /**
   * Send an ad-hoc message to a staff member and run it like a one-shot duty.
   * Posts an `@kody worker-ask` directive on the control issue; the engine
   * runs the persona stateless and replies on that issue. When `actorLogin`
   * is set, the reply @-mentions the requester so it lands in their inbox.
   */
  dispatch: async (
    slug: string,
    data: { message: string; actorLogin?: string },
  ): Promise<{
    issueNumber: number;
    commentId: number;
    commentUrl: string;
  }> => {
    const res = await fetch(
      `${API_BASE}/staff/${encodeURIComponent(slug)}/dispatch`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      },
    );
    return handleResponse(res);
  },
};

// ============ Context API ============

export interface ContextEntry {
  /** Filename without `.md` — stable identity, also the entry heading. */
  slug: string;
  /** Entry markdown (frontmatter-free). */
  body: string;
  /** Owning staff-member slugs from `staff:` frontmatter (`["kody"]` default for legacy files). */
  staff: string[];
  /** Git blob sha. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export const contextApi = {
  list: async (): Promise<ContextEntry[]> => {
    const res = await fetch(`${API_BASE}/context`, { headers: buildHeaders() });
    const data = await handleResponse<{ entries: ContextEntry[] }>(res);
    return data.entries ?? [];
  },

  get: async (slug: string): Promise<ContextEntry> => {
    const res = await fetch(`${API_BASE}/context/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ entry: ContextEntry }>(res);
    return data.entry;
  },

  create: async (data: {
    slug: string;
    body: string;
    staff: string[];
    actorLogin?: string;
  }): Promise<ContextEntry> => {
    const res = await fetch(`${API_BASE}/context`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ entry: ContextEntry }>(res);
    return payload.entry;
  },

  update: async (
    slug: string,
    data: {
      body?: string;
      staff?: string[];
      actorLogin?: string;
    },
  ): Promise<ContextEntry> => {
    const res = await fetch(`${API_BASE}/context/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ entry: ContextEntry }>(res);
    return payload.entry;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/context/${encodeURIComponent(slug)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },
};

// ============ Reports API ============

export interface Report {
  /** Filename without `.md` — stable identity. */
  slug: string;
  title: string;
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /** Size in bytes. */
  size: number;
}

export const reportsApi = {
  list: async (): Promise<Report[]> => {
    const res = await fetch(`${API_BASE}/reports`, { headers: buildHeaders() });
    const data = await handleResponse<{ reports: Report[] }>(res);
    return data.reports;
  },

  get: async (slug: string): Promise<Report> => {
    const res = await fetch(`${API_BASE}/reports/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ report: Report }>(res);
    return data.report;
  },
};

// ============ Goals API ============

export interface Goal {
  id: string;
  name: string;
  description?: string;
  dueDate?: string;
  /** GitHub login of the single accountable owner. Optional. */
  assignee?: string;
  createdAt: string;
  updatedAt?: string;
  discussionId?: string;
  discussionNumber?: number;
  /**
   * @deprecated Umbrella-era field (engine ≤ 0.4.38). Stacked-PR engines
   * don't write this; the goals API stopped hydrating it in 0.4.39.
   */
  goalIssueNumber?: number;
  /** @deprecated Umbrella-era field (engine ≤ 0.4.38). See goalIssueNumber. */
  goalPrUrl?: string;
}

export interface GoalDiscussionAuthor {
  login: string;
  avatarUrl?: string;
}

export interface GoalDiscussionComment {
  id: string;
  databaseId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  author: GoalDiscussionAuthor | null;
}

/**
 * Reasons the discussion thread is unavailable. Used by the UI to render
 * the appropriate badge / tooltip.
 */
export type DiscussionDisabledReason =
  | "discussions_disabled"
  | "category_missing"
  | "provision_failed";

export type GoalDiscussionPayload =
  | {
      enabled: true;
      discussion: { id: string; number: number; url: string };
      comments: GoalDiscussionComment[];
    }
  | {
      enabled: false;
      reason: DiscussionDisabledReason;
      message?: string;
      comments: never[];
    };

export interface GoalsListResponse {
  goals: Goal[];
  capabilities?: { discussionsEnabled: boolean };
}

export const goalsApi = {
  list: async (): Promise<Goal[]> => {
    const res = await fetch(`${API_BASE}/goals`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ goals: Goal[] }>(res);
    return data.goals;
  },

  /**
   * List goals along with capability flags (e.g. whether the repo has
   * Discussions enabled). The dashboard uses the capability to decide
   * whether to render the discussion thread or the "off" badge.
   */
  listWithCapabilities: async (): Promise<GoalsListResponse> => {
    const res = await fetch(`${API_BASE}/goals`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    return handleResponse<GoalsListResponse>(res);
  },

  fetchDiscussion: async (id: string): Promise<GoalDiscussionPayload> => {
    const res = await fetch(
      `${API_BASE}/goals/${encodeURIComponent(id)}/discussion`,
      {
        headers: buildHeaders(),
        cache: "no-store",
      },
    );
    return handleResponse<GoalDiscussionPayload>(res);
  },

  postDiscussionComment: async (
    id: string,
    body: string,
    actorLogin?: string,
  ): Promise<GoalDiscussionComment> => {
    const res = await fetch(
      `${API_BASE}/goals/${encodeURIComponent(id)}/discussion`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          body,
          ...(actorLogin && { actorLogin }),
        }),
      },
    );
    const payload = await handleResponse<{ comment: GoalDiscussionComment }>(
      res,
    );
    return payload.comment;
  },

  create: async (data: {
    name: string;
    description?: string;
    dueDate?: string;
    assignee?: string;
    actorLogin?: string;
  }): Promise<Goal> => {
    const res = await fetch(`${API_BASE}/goals`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ goal: Goal }>(res);
    return payload.goal;
  },

  update: async (
    id: string,
    data: {
      name?: string;
      description?: string | null;
      dueDate?: string | null;
      assignee?: string | null;
      actorLogin?: string;
    },
  ): Promise<Goal> => {
    const res = await fetch(`${API_BASE}/goals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ goal: Goal }>(res);
    return payload.goal;
  },

  remove: async (id: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/goals/${encodeURIComponent(id)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  reorder: async (
    orderedIds: string[],
    actorLogin?: string,
  ): Promise<Goal[]> => {
    const res = await fetch(`${API_BASE}/goals/reorder`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        orderedIds,
        ...(actorLogin && { actorLogin }),
      }),
    });
    const payload = await handleResponse<{ goals: Goal[] }>(res);
    return payload.goals;
  },

  /** Fetch the goal's runtime state file. Returns null when not started. */
  getState: async (
    id: string,
  ): Promise<import("./goal-state").GoalRunState | null> => {
    const res = await fetch(
      `${API_BASE}/goals/${encodeURIComponent(id)}/state`,
      { headers: buildHeaders(), cache: "no-store" },
    );
    const payload = await handleResponse<{
      state: import("./goal-state").GoalRunState | null;
    }>(res);
    return payload.state;
  },

  /** Set the goal's runtime state. Engine-only writes (state="done") are rejected by the API. */
  setState: async (
    id: string,
    body: {
      state: "active" | "paused";
      pausedReason?: string;
      actorLogin?: string;
    },
  ): Promise<import("./goal-state").GoalRunState> => {
    const res = await fetch(
      `${API_BASE}/goals/${encodeURIComponent(id)}/state`,
      {
        method: "PUT",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      },
    );
    const payload = await handleResponse<{
      state: import("./goal-state").GoalRunState;
    }>(res);
    return payload.state;
  },

  /**
   * Toggle "let Kody manage this goal end-to-end". Enabling on a
   * never-started goal also seeds an active state + dispatches the engine.
   */
  manage: async (
    id: string,
    body: { managed: boolean; actorLogin?: string },
  ): Promise<import("./goal-state").GoalRunState> => {
    const res = await fetch(
      `${API_BASE}/goals/${encodeURIComponent(id)}/manage`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      },
    );
    const payload = await handleResponse<{
      state: import("./goal-state").GoalRunState;
    }>(res);
    return payload.state;
  },

  /**
   * Approve the manual merge of a parked goal (state="awaiting-merge").
   * Flips it back to active + arms the engine's one-shot finalize.
   */
  merge: async (
    id: string,
    body: { actorLogin?: string } = {},
  ): Promise<import("./goal-state").GoalRunState> => {
    const res = await fetch(
      `${API_BASE}/goals/${encodeURIComponent(id)}/merge`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      },
    );
    const payload = await handleResponse<{
      state: import("./goal-state").GoalRunState;
    }>(res);
    return payload.state;
  },
};

// ============ Notifications API ============

import type {
  NotificationRule,
  NotificationEvent,
  NotificationChannel,
} from "./notifications";

export interface NotificationsListResponse {
  rules: NotificationRule[];
  manifest: { issueNumber: number | null };
}

export const notificationsApi = {
  list: async (): Promise<NotificationRule[]> => {
    const res = await fetch(`${API_BASE}/notifications`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<NotificationsListResponse>(res);
    return data.rules;
  },

  create: async (input: {
    name: string;
    enabled?: boolean;
    event: NotificationEvent;
    channel: NotificationChannel;
    template?: string;
    actorLogin?: string;
  }): Promise<NotificationRule> => {
    const res = await fetch(`${API_BASE}/notifications`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    const data = await handleResponse<{ rule: NotificationRule }>(res);
    return data.rule;
  },

  update: async (
    id: string,
    input: {
      name?: string;
      enabled?: boolean;
      event?: NotificationEvent;
      channel?: NotificationChannel;
      template?: string | null;
      actorLogin?: string;
    },
  ): Promise<NotificationRule> => {
    const res = await fetch(
      `${API_BASE}/notifications/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(input),
      },
    );
    const data = await handleResponse<{ rule: NotificationRule }>(res);
    return data.rule;
  },

  remove: async (id: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/notifications/${encodeURIComponent(id)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ ok: true }>(res);
  },

  test: async (input: {
    channel: NotificationChannel;
    text: string;
    actorLogin?: string;
  }): Promise<{ ok: true }> => {
    const res = await fetch(`${API_BASE}/notifications/test`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    return handleResponse<{ ok: true }>(res);
  },
};

// ============ Changelog API ============

export interface ChangelogPayload {
  content: string;
  htmlUrl: string | null;
}

export const changelogApi = {
  get: async (): Promise<ChangelogPayload> => {
    const res = await fetch(`${API_BASE}/changelog`, {
      headers: buildHeaders(),
    });
    return handleResponse<ChangelogPayload>(res);
  },
};

// ============ Vibe API ============

/**
 * Vibe-specific endpoints. Distinct from tasksApi.execute (which posts
 * `@kody` and runs full orchestration on GitHub Actions). Vibe execution
 * spawns a Fly Machine directly into agent mode against the issue,
 * skipping classify/plan/review.
 */
export const vibeApi = {
  execute: async (
    issueNumber: number,
  ): Promise<{
    ok: true;
    issueNumber: number;
    runner: "fly";
    machineId: string;
    sessionId: string;
  }> => {
    const flyPerf = getStoredFlyPerf();
    const headers = buildHeaders(flyPerf ? { "x-kody-fly-perf": flyPerf } : {});
    const res = await fetch(`${API_BASE}/vibe/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ issueNumber }),
    });
    return handleResponse(res);
  },
};

// ============ CTO API ============

/**
 * One-tap operator verdict on a CTO recommendation surfaced in the inbox.
 * `approve` runs the recommended action for dispatchable verbs
 * (`execute`/`fix`); non-dispatchable verbs are recorded only. Both
 * verdicts are tallied in the `kody:cto-decisions` ledger that drives
 * graduation.
 */
export const ctoApi = {
  decide: async (input: {
    /** Emitting staff slug; scopes the trust ledger per staff (default "cto"). */
    staff?: string;
    /** Emitting duty slug — the trust key (falls back to staff server-side). */
    duty?: string;
    taskNumber: number;
    action?: import("./cto/recommendation").CtoAction;
    decision: "approve" | "reject" | "dismiss";
    actorLogin?: string;
    /** The exact `@kody …` command from the staff member's `kody-cmd` line. */
    command?: string;
  }): Promise<{
    ok: true;
    executed: boolean;
    staff: string;
    action: string;
    decision: "approve" | "reject" | "dismiss";
    stats: {
      approvals: number;
      rejections: number;
      consecutiveApprovals: number;
      mode: "ask" | "auto";
    } | null;
  }> => {
    const res = await fetch(`${API_BASE}/cto/decision`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    return handleResponse(res);
  },

  /**
   * Latest verdict per `${staff}:${taskNumber}:${action}` from the trust
   * ledger, carrying the timestamp it was recorded so the inbox can scope the
   * badge to recs that pre-date the decision (a dismiss on yesterday's
   * `sync` rec must not silently dismiss today's fresh one). Used by
   * `verdictFor(staff, taskNumber, action, sinceIso)`.
   */
  decisions: async (): Promise<{
    decided: Record<
      string,
      { decision: "approve" | "reject" | "dismiss"; at: string }
    >;
  }> => {
    const res = await fetch(`${API_BASE}/cto/decision`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },

  /**
   * Full per-DUTY trust stats + recent decision log, for the /trust page.
   * `duties[<slug>]` holds one whole-duty stats block (no action dimension).
   */
  trust: async (): Promise<{
    duties: Record<
      string,
      {
        approvals: number;
        rejections: number;
        consecutiveApprovals: number;
        mode: "ask" | "auto";
      }
    >;
    log: import("./cto/trust-state").TrustDecisionLogEntry[];
  }> => {
    const res = await fetch(`${API_BASE}/cto/trust`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },

  /**
   * Apply one operator override to a duty's autonomy (whole duty):
   * `reset` (wipe), `graduate` (force auto now), `degrade` (force ask).
   * Never posts an `@kody` command — it only rewrites trust state.
   */
  setTrust: async (input: {
    duty: string;
    op: import("./cto/trust-state").TrustOp;
    actorLogin?: string;
  }): Promise<{
    ok: true;
    duty: string;
    op: import("./cto/trust-state").TrustOp;
    stats: {
      approvals: number;
      rejections: number;
      consecutiveApprovals: number;
      mode: "ask" | "auto";
    } | null;
  }> => {
    const res = await fetch(`${API_BASE}/cto/trust`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    return handleResponse(res);
  },
};

// ============ Activity API ============

/** Engine run health for the connected repo (read-only). */
export const activityApi = {
  get: async (): Promise<import("./activity/types").ActivitySnapshot> => {
    const res = await fetch(`${API_BASE}/activity`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /** Engine + chat event feed. Load-on-demand only — never polled. */
  feed: async (): Promise<import("./activity/feed").FeedSnapshot> => {
    const res = await fetch(`${API_BASE}/activity/feed`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /** Dashboard-native action log (in-memory; free to poll). */
  log: async (): Promise<{
    entries: import("./activity/action-log").ActionLogEntry[];
    total: number;
    computedAt: string;
  }> => {
    const res = await fetch(`${API_BASE}/activity/log`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /** Company activity — engine-authored, attributed actions (duty runs). */
  autonomous: async (): Promise<{
    records: import("./activity/company").CompanyActivityRecord[];
    total: number;
    computedAt?: string;
  }> => {
    const res = await fetch(`${API_BASE}/activity/autonomous`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /**
   * Upstream health — "can runs even start, and are their dependencies
   * healthy?" (GitHub Actions status, token rate-limit, webhook, vault,
   * model key, recent runs, dispatch failures). Cheap to poll.
   */
  health: async (): Promise<import("./health/types").HealthReport> => {
    const res = await fetch(`${API_BASE}/health`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
};

// ============ Messaging channels (team chat over Discussions) ============

export interface MessageChannel {
  number: number;
  id: string;
  name: string;
  url: string;
  commentsCount: number;
  updatedAt: string;
  author: GoalDiscussionAuthor | null;
}

export type MessageChannelsPayload =
  | { enabled: true; channels: MessageChannel[] }
  | {
      enabled: false;
      reason: DiscussionDisabledReason;
      message?: string;
      channels: never[];
    };

export interface MessageThreadPayload {
  channel: { number: number; id: string; name: string; url: string };
  comments: GoalDiscussionComment[];
}

export const messagesApi = {
  listChannels: async (): Promise<MessageChannelsPayload> => {
    const res = await fetch(`${API_BASE}/messages`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    return handleResponse<MessageChannelsPayload>(res);
  },

  createChannel: async (data: {
    name: string;
    topic?: string;
    actorLogin?: string;
  }): Promise<MessageChannel> => {
    const res = await fetch(`${API_BASE}/messages`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ channel: MessageChannel }>(res);
    return payload.channel;
  },

  fetchThread: async (channelNumber: number): Promise<MessageThreadPayload> => {
    const res = await fetch(`${API_BASE}/messages/${channelNumber}`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    return handleResponse<MessageThreadPayload>(res);
  },

  postMessage: async (
    channelNumber: number,
    body: string,
    actorLogin?: string,
  ): Promise<GoalDiscussionComment> => {
    const res = await fetch(`${API_BASE}/messages/${channelNumber}`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ body, ...(actorLogin && { actorLogin }) }),
    });
    const payload = await handleResponse<{ comment: GoalDiscussionComment }>(
      res,
    );
    return payload.comment;
  },

  deleteChannel: async (channelNumber: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/messages/${channelNumber}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    await handleResponse<{ ok: true }>(res);
  },
};

// ============ Kody bug reports (filed into the dashboard's own repo) ============

export interface KodyBugReportInput {
  title: string;
  area: string;
  severity: string;
  whatHappened: string;
  steps?: string;
  expected?: string;
  where?: string;
  reporterLogin?: string;
  diagnostics?: Record<string, string | undefined>;
}

export interface KodyBugReportResult {
  success: boolean;
  issue: { number: number; title: string; html_url: string };
}

export const kodyBugsApi = {
  report: async (data: KodyBugReportInput): Promise<KodyBugReportResult> => {
    const res = await fetch(`${API_BASE}/report-kody-bug`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
};

// ============ Company import/export API ============

import type {
  CompanyBundle,
  CompanyImportMode,
  CompanyImportResult,
} from "./company/types";

export const companyApi = {
  /** Export the connected repo's staff/duties/prompts/instructions bundle. */
  export: async (): Promise<CompanyBundle> => {
    const res = await fetch(`${API_BASE}/company`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ bundle: CompanyBundle }>(res);
    return data.bundle;
  },

  /** Apply an uploaded bundle to the connected repo. */
  import: async (
    bundle: CompanyBundle,
    mode: CompanyImportMode,
    actorLogin?: string,
  ): Promise<CompanyImportResult> => {
    const res = await fetch(`${API_BASE}/company`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ bundle, mode, ...(actorLogin && { actorLogin }) }),
    });
    const data = await handleResponse<{ result: CompanyImportResult }>(res);
    return data.result;
  },

  /** The operator list (`github.operators`) — who recommendation duties
   * @-mention so their comments land in the inbox. */
  operators: {
    get: async (): Promise<string[]> => {
      const res = await fetch(`${API_BASE}/company/operators`, {
        headers: buildHeaders(),
        cache: "no-store",
      });
      const data = await handleResponse<{ operators: string[] }>(res);
      return data.operators;
    },
    set: async (
      operators: string[],
      actorLogin?: string,
    ): Promise<string[]> => {
      const res = await fetch(`${API_BASE}/company/operators`, {
        method: "PUT",
        headers: buildHeaders(),
        body: JSON.stringify({ operators, ...(actorLogin && { actorLogin }) }),
      });
      const data = await handleResponse<{ operators: string[] }>(res);
      return data.operators;
    },
  },

  /** Repo-wide engine config fields that don't have their own page:
   * quality commands, comment aliases, the `@kody` access gate, and the
   * default branch. */
  config: {
    get: async (): Promise<EngineEditableConfig> => {
      const res = await fetch(`${API_BASE}/company/config`, {
        headers: buildHeaders(),
        cache: "no-store",
      });
      return handleResponse<EngineEditableConfig>(res);
    },
    patch: async (
      patch: Partial<EngineEditableConfig>,
      actorLogin?: string,
    ): Promise<EngineEditableConfig> => {
      const res = await fetch(`${API_BASE}/company/config`, {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify({ ...patch, ...(actorLogin && { actorLogin }) }),
      });
      return handleResponse<EngineEditableConfig>(res);
    },
  },
};

/** The dashboard-editable slice of kody.config.json (see /company/config).
 * `perExecutable` (model routing) is edited on /models, the rest on /company. */
export interface EngineEditableConfig {
  quality: {
    typecheck?: string;
    lint?: string;
    format?: string;
    testUnit?: string;
  };
  aliases: Record<string, string>;
  allowedAssociations: string[];
  defaultBranch: string;
  perExecutable: Record<string, string>;
}

// ============ Jobs API ============

import type { KodyJob } from "./kody-job";

export const jobsApi = {
  /**
   * Run an INSTANT job — assembles to an `@kody <executable> [why]` dispatch on
   * the job's target issue/PR. Scheduled jobs persist as a duty instead (see
   * `dutiesApi.create`), so this only accepts `flavor: "instant"`.
   */
  run: async (
    job: KodyJob,
    actorLogin?: string,
  ): Promise<{ success: boolean; commentUrl: string; dispatch: string }> => {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ ...job, actorLogin }),
    });
    return handleResponse(res);
  },
};

// ============ Combined API ============

export const kodyApi = {
  jobs: jobsApi,
  tasks: tasksApi,
  prs: prsApi,
  taskDocs: taskDocsApi,
  boards: boardsApi,
  collaborators: collaboratorsApi,
  workflows: workflowsApi,
  ci: ciApi,
  remote: remoteApi,
  duties: dutiesApi,
  staff: staffApi,
  context: contextApi,
  company: companyApi,
  reports: reportsApi,
  goals: goalsApi,
  messages: messagesApi,
  notifications: notificationsApi,
  changelog: changelogApi,
  vibe: vibeApi,
  cto: ctoApi,
  activity: activityApi,
  kodyBugs: kodyBugsApi,
};
