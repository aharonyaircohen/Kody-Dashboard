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
    const auth = JSON.parse(raw) as { token?: string; owner?: string; repo?: string };
    if (!auth.token || !auth.owner || !auth.repo) return null;
    return { token: auth.token, owner: auth.owner, repo: auth.repo };
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
    const parsed = JSON.parse(raw) as { brain?: { url?: string; apiKey?: string } };
    const b = parsed.brain;
    if (!b?.url || !b.apiKey) return null;
    return { url: b.url, apiKey: b.apiKey };
  } catch {
    return null;
  }
}

function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
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
  constructor(
    message = "GitHub token is not configured. Please log in.",
  ) {
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
 * Redirect to the login page.
 */
export function redirectToLogin(returnTo = "/"): void {
  if (typeof window !== "undefined") {
    window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
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
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}`, { headers: buildHeaders() });
    return handleResponse(res);
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

  approveGate: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "approve",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  rejectGate: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "reject",
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
    const comment = context.trim() ? `@kody\n\n${context.trim()}` : "@kody resume";

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

  approve: async (
    task: KodyTask,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    if (!task.associatedPR) {
      throw new Error("No PR associated with this task");
    }
    const res = await fetch(`${API_BASE}/tasks/approve`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        issueNumber: task.issueNumber,
        prNumber: task.associatedPR.number,
        branchName: task.associatedPR.head.ref,
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
    const res = await fetch(`${API_BASE}/prs/files?prNumber=${prNumber}`, { headers: buildHeaders() });
    const data = await handleResponse<{ files: FileChange[] }>(res);
    return data.files;
  },
  // PR CI status is sourced from the bulk tasks list — see usePRCIStatus.
  behind: async (prNumber: number): Promise<number> => {
    const res = await fetch(`${API_BASE}/prs/behind?prNumber=${prNumber}`, { headers: buildHeaders() });
    const data = await handleResponse<{ behindBy: number }>(res);
    return data.behindBy;
  },
  comments: async (prNumber: number): Promise<PRComment[]> => {
    const res = await fetch(`${API_BASE}/prs/comments?prNumber=${prNumber}`, { headers: buildHeaders() });
    const data = await handleResponse<{ comments: PRComment[] }>(res);
    return data.comments;
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
    const res = await fetch(`${API_BASE}/tasks/${taskId}/docs${params}`, { headers: buildHeaders() });
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
    const res = await fetch(`${API_BASE}/collaborators`, { headers: buildHeaders() });
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

// ============ Jobs API ============

/** Per-job cadence tokens; mirrors `ScheduleEvery` in jobs-frontmatter.ts. */
export type JobSchedule =
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

export interface Job {
  /** Filename without `.md` — stable identity. */
  slug: string;
  title: string;
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /**
   * Last commit timestamp of the sibling `<slug>.state.json` (ISO8601),
   * or `null` if the job has never run. The engine writes
   * `<slug>.state.json` on every tick that acts.
   */
  lastTickAt: string | null;
  /**
   * UTC ISO timestamp at which this job will next be eligible to act —
   * read from `data.nextEligibleISO` in the state JSON. `null` if the
   * job has never run, or its body doesn't yet emit the field.
   */
  nextEligibleAt: string | null;
  /**
   * Per-job cadence parsed from frontmatter. `null` = global cron wake
   * (every 15 min). Engine-side gating ships separately.
   */
  schedule: JobSchedule | null;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export const jobsApi = {
  list: async (): Promise<Job[]> => {
    const res = await fetch(`${API_BASE}/jobs`, { headers: buildHeaders() });
    const data = await handleResponse<{ jobs: Job[] }>(res);
    return data.jobs;
  },

  get: async (slug: string): Promise<Job> => {
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ job: Job }>(res);
    return data.job;
  },

  create: async (data: {
    slug?: string;
    title: string;
    body: string;
    schedule?: JobSchedule | null;
    actorLogin?: string;
  }): Promise<Job> => {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ job: Job }>(res);
    return payload.job;
  },

  update: async (
    slug: string,
    data: {
      title?: string;
      body?: string;
      schedule?: JobSchedule | null;
      actorLogin?: string;
    },
  ): Promise<Job> => {
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ job: Job }>(res);
    return payload.job;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(slug)}${suffix}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    await handleResponse<{ success: boolean }>(res);
  },

  /**
   * Manually trigger a single job by posting an `@kody job-tick` comment
   * on the repo's "Kody control" issue. The engine's existing
   * `issue_comment` trigger routes to job-tick. Defaults to `force: true`
   * because the operator clicked "Run now" — they want it to run regardless
   * of the body's cadence guard. Pass `force: false` to respect the guard.
   *
   * Replaces the legacy chat-trigger fake — no `KODY_SESSION_SECRET`
   * required, no fake chat session, no overloaded sessionId.
   */
  run: async (
    job: { slug: string },
    opts?: { force?: boolean },
  ): Promise<{ issueNumber: number; commentId: number; commentUrl: string; force: boolean }> => {
    const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(job.slug)}/run`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ force: opts?.force ?? true }),
    });
    return handleResponse(res);
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

  fetchDiscussion: async (
    id: string,
  ): Promise<GoalDiscussionPayload> => {
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

// ============ Combined API ============

export const kodyApi = {
  tasks: tasksApi,
  prs: prsApi,
  taskDocs: taskDocsApi,
  boards: boardsApi,
  collaborators: collaboratorsApi,
  workflows: workflowsApi,
  ci: ciApi,
  remote: remoteApi,
  jobs: jobsApi,
  reports: reportsApi,
  goals: goalsApi,
  notifications: notificationsApi,
};
