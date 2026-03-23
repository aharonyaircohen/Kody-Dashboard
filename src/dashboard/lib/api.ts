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
    message = "GitHub token is not configured. Set KODY_BOT_TOKEN or GITHUB_TOKEN in environment variables.",
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
 * Redirect to GitHub OAuth login when session expires.
 * Call this in mutation onError handlers to handle expired credentials.
 * @param returnTo - Optional path to return to after login (defaults to /)
 */
export function redirectToLogin(returnTo = "/"): void {
  const encoded = encodeURIComponent(returnTo);
  window.location.href = `/api/oauth/github?returnTo=${encoded}`;
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
    // Distinguish server token config errors from user session auth errors.
    // The tasks route returns { error: 'no_token' } when KODY_BOT_TOKEN/GITHUB_TOKEN is missing.
    // The auth middleware returns { message: 'Not authenticated...' } for expired sessions.
    if (data.error === "no_token") {
      throw new NoTokenError(data.message);
    }
    // Session expired — throw SessionExpiredError so the UI can show a login prompt.
    // Do NOT redirect here — that causes infinite redirect loops.
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
    const res = await fetch(url);
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
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}`);
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
  }): Promise<KodyTask> => {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "comment",
        comment,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  // Retry with context: posts comment with @kody retry then triggers execution
  retryWithContext: async (
    issueNumber: number,
    context: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    // First post comment with retry command and context
    const comment = context.trim()
      ? `@kody retry\n\n${context.trim()}`
      : "@kody retry";

    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prNumber: task.associatedPR.number,
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "remove-label",
        label: "kody:queued",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },
};

// ============ PRs API ============

export const prsApi = {
  files: async (prNumber: number): Promise<FileChange[]> => {
    const res = await fetch(`${API_BASE}/prs/files?prNumber=${prNumber}`);
    const data = await handleResponse<{ files: FileChange[] }>(res);
    return data.files;
  },
  ciStatus: async (
    prNumber: number,
  ): Promise<{
    ciStatus: "pending" | "success" | "failure" | "running";
    mergeable: boolean;
    hasConflicts: boolean;
  }> => {
    const res = await fetch(`${API_BASE}/prs/status?prNumber=${prNumber}`);
    return handleResponse(res);
  },
  comments: async (prNumber: number): Promise<PRComment[]> => {
    const res = await fetch(`${API_BASE}/prs/comments?prNumber=${prNumber}`);
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
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch(`${API_BASE}/tasks/${taskId}/docs${params}`);
    const data = await handleResponse<{ documents: TaskDocument[] }>(res);
    return data.documents;
  },
};

// ============ Boards API ============

export const boardsApi = {
  list: async (): Promise<Board[]> => {
    const res = await fetch(`${API_BASE}/boards`);
    const data = await handleResponse<BoardsResponse>(res);
    return data.boards;
  },
};

// ============ Collaborators API ============

export const collaboratorsApi = {
  list: async (): Promise<GitHubCollaborator[]> => {
    const res = await fetch(`${API_BASE}/collaborators`);
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
    const res = await fetch(url);
    const data = await handleResponse<{ runs: WorkflowRun[] }>(res);
    return data.runs;
  },
};

// ============ Publish API ============

export const publishApi = {
  publish: async (actorLogin?: string): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(actorLogin && { actorLogin }) }),
    });
    return handleResponse(res);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorLogin, action, payload }),
    });
    return handleResponse<RemoteExecResult>(res);
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
  publish: publishApi.publish,
  remote: remoteApi,
};
