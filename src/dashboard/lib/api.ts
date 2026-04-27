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

  // Retry with context: posts a bare @kody comment. The engine has no `retry`
  // executable — bare @kody routes to classify (issue) or fix (PR). On PRs the
  // trailing context becomes the fix feedback; on issues it's currently dropped.
  retryWithContext: async (
    issueNumber: number,
    context: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const comment = context.trim() ? `@kody\n\n${context.trim()}` : "@kody";

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

// ============ Missions API ============

export interface Mission {
  /** Filename without `.md` — stable identity. */
  slug: string;
  title: string;
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export const missionsApi = {
  list: async (): Promise<Mission[]> => {
    const res = await fetch(`${API_BASE}/missions`, { headers: buildHeaders() });
    const data = await handleResponse<{ missions: Mission[] }>(res);
    return data.missions;
  },

  get: async (slug: string): Promise<Mission> => {
    const res = await fetch(`${API_BASE}/missions/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ mission: Mission }>(res);
    return data.mission;
  },

  create: async (data: {
    slug?: string;
    title: string;
    body: string;
    actorLogin?: string;
  }): Promise<Mission> => {
    const res = await fetch(`${API_BASE}/missions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ mission: Mission }>(res);
    return payload.mission;
  },

  update: async (
    slug: string,
    data: { title?: string; body?: string; actorLogin?: string },
  ): Promise<Mission> => {
    const res = await fetch(`${API_BASE}/missions/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ mission: Mission }>(res);
    return payload.mission;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(`${API_BASE}/missions/${encodeURIComponent(slug)}${suffix}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    await handleResponse<{ success: boolean }>(res);
  },

  run: async (
    mission: { slug: string; title: string; body: string },
  ): Promise<{ sessionId: string; workflowId: string }> => {
    const sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `mission-${mission.slug}-${Date.now()}`;
    const content = `Execute mission \`${mission.slug}\`: ${mission.title}\n\n${mission.body}`;
    const res = await fetch(`${API_BASE}/chat/trigger`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        taskId: sessionId,
        messages: [
          {
            role: "user",
            content,
            timestamp: new Date().toISOString(),
          },
        ],
        dashboardUrl: typeof window !== "undefined" ? window.location.origin : undefined,
      }),
    });
    const data = await handleResponse<{ ok: boolean; taskId: string; workflowId: string }>(res);
    return { sessionId: data.taskId, workflowId: data.workflowId };
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
};

// ============ Combined API ============

export const kodyApi = {
  tasks: tasksApi,
  prs: prsApi,
  taskDocs: taskDocsApi,
  boards: boardsApi,
  collaborators: collaboratorsApi,
  workflows: workflowsApi,
  remote: remoteApi,
  missions: missionsApi,
  goals: goalsApi,
};
