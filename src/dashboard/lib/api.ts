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
import type {
  CompanyIntentInput,
  CompanyIntentRecord,
  CompanyIntentStatus,
} from "./company-intents";
import type {
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
  WorkflowDefinitionRecord,
} from "./workflow-definitions";
import type { ScheduleEvery } from "./ticked/frontmatter";

const API_BASE = "/api/kody";

// ============ Auth Headers ============

export function getStoredAuth(): {
  token: string;
  owner: string;
  repo: string;
  userLogin?: string;
  storeRepoUrl?: string;
  storeRef?: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const auth = JSON.parse(raw) as {
      token?: string;
      owner?: string;
      repo?: string;
      user?: { login?: string };
      storeRepoUrl?: string;
      storeRepo?: string;
      storeRef?: string;
    };
    if (!auth.token || !auth.owner || !auth.repo) return null;
    return {
      token: auth.token,
      owner: auth.owner,
      repo: auth.repo,
      userLogin: auth.user?.login,
      storeRepoUrl:
        auth.storeRepoUrl ??
        (auth.storeRepo ? `https://github.com/${auth.storeRepo}` : undefined),
      storeRef: auth.storeRef,
    };
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

export function getStoredBrainTerminalActivityLimit(): number | "never" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      brainTerminalActivityLimit?: unknown;
    };
    const value = parsed.brainTerminalActivityLimit;
    if (value === "never") return "never";
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

export function getStoredBrainSuspension(): "auto" | "never" {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem("kody_auth");
    if (!raw) return "auto";
    const parsed = JSON.parse(raw) as {
      brainSuspension?: unknown;
      brainTerminalActivityLimit?: unknown;
    };
    if (parsed.brainSuspension === "never") return "never";
    if (parsed.brainSuspension === "auto") return "auto";
    return parsed.brainTerminalActivityLimit === "never" ? "never" : "auto";
  } catch {
    return "auto";
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

interface ApiAuthContext {
  token: string;
  owner: string;
  repo: string;
  userLogin?: string;
}

function buildHeaders(
  extra: Record<string, string> = {},
  authOverride?: ApiAuthContext | null,
): Record<string, string> {
  const auth = authOverride ?? getStoredAuth();
  return {
    "Content-Type": "application/json",
    ...(auth
      ? {
          "x-kody-token": auth.token,
          "x-kody-owner": auth.owner,
          "x-kody-repo": auth.repo,
          ...(auth.userLogin ? { "x-kody-user-login": auth.userLogin } : {}),
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
    throw new ApiError(
      data.message || data.error || "Request failed",
      res.status,
      data,
    );
  }

  return data as T;
}

// ============ Tasks API ============

export const tasksApi = {
  list: async (params?: {
    days?: number;
    includeDetails?: boolean;
    viewMode?:
      | "all"
      | "running"
      | "backlog"
      | "unassigned"
      | "intake"
      | "queue";
  }): Promise<KodyTask[]> => {
    const searchParams = new URLSearchParams();
    if (params?.days) searchParams.set("days", String(params.days));
    if (params?.viewMode) searchParams.set("view", params.viewMode);
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

  closeIssue: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "close-issue",
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
    options?: { approveDrafts?: boolean },
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "approve-pr",
        ...(actorLogin && { actorLogin }),
        ...(options?.approveDrafts !== undefined && {
          approveDrafts: options.approveDrafts,
        }),
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
  createPreview: async (
    prNumber: number,
    ref: string,
  ): Promise<{
    url: string | null;
    state: string;
    builderMachineId?: string;
  }> => {
    const auth = getStoredAuth();
    if (!auth) throw new NoTokenError();
    const res = await fetch(`${API_BASE}/previews`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        repo: `${auth.owner}/${auth.repo}`,
        pr: prNumber,
        ref,
      }),
    });
    return handleResponse(res);
  },
  wakePreview: async (
    prNumber: number,
  ): Promise<{
    url: string | null;
    state: string;
    machineId?: string;
  }> => {
    const auth = getStoredAuth();
    if (!auth) throw new NoTokenError();
    const owner = encodeURIComponent(auth.owner);
    const repo = encodeURIComponent(auth.repo);
    const res = await fetch(
      `${API_BASE}/previews/${owner}/${repo}/${prNumber}`,
      {
        method: "POST",
        headers: buildHeaders(),
      },
    );
    const data = await handleResponse<{
      ok: true;
      preview: { url: string | null; state: string; machineId?: string };
    }>(res);
    return data.preview;
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

// ============ Workflow Definitions API ============

export const workflowDefinitionsApi = {
  list: async (): Promise<WorkflowDefinitionRecord[]> => {
    const res = await fetch(`${API_BASE}/company/workflows`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{
      workflows: WorkflowDefinitionRecord[];
    }>(res);
    return data.workflows;
  },

  get: async (id: string): Promise<WorkflowDefinitionRecord> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}`,
      {
        headers: buildHeaders(),
        cache: "no-store",
      },
    );
    const data = await handleResponse<{
      workflow: WorkflowDefinitionRecord;
    }>(res);
    return data.workflow;
  },

  create: async (
    data: CreateWorkflowDefinitionInput & { actorLogin?: string },
  ): Promise<WorkflowDefinitionRecord> => {
    const res = await fetch(`${API_BASE}/company/workflows`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{
      workflow: WorkflowDefinitionRecord;
    }>(res);
    return payload.workflow;
  },

  update: async (
    id: string,
    data: UpdateWorkflowDefinitionInput & { actorLogin?: string },
  ): Promise<WorkflowDefinitionRecord> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      },
    );
    const payload = await handleResponse<{
      workflow: WorkflowDefinitionRecord;
    }>(res);
    return payload.workflow;
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  run: async (
    id: string,
  ): Promise<{
    ok: boolean;
    workflowId: string;
    ref: string;
    workflow: string;
    action: string;
  }> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}/run`,
      {
        method: "POST",
        headers: buildHeaders(),
      },
    );
    return handleResponse(res);
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
  rerun: async (runId: number): Promise<{ ok: true; runId: number }> => {
    const res = await fetch(`${API_BASE}/ci/rerun`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ runId }),
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

// ============ Capabilities API ============

export interface CapabilitySummary {
  slug: string;
  describe?: string;
  agent?: string | null;
  every?: ScheduleEvery | string | null;
  source?: "local" | "store";
  readOnly?: boolean;
}

export const capabilitiesApi = {
  list: async (): Promise<CapabilitySummary[]> => {
    const res = await fetch(`${API_BASE}/capabilities`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{
      capabilities: CapabilitySummary[];
    }>(res);
    return data.capabilities;
  },

  run: async (
    capability: { slug: string },
    opts?: { force?: boolean },
  ): Promise<{
    workflowId: string;
    ref: string;
    action: string;
    capability: string;
    force: boolean;
  }> => {
    const res = await fetch(
      `${API_BASE}/capabilities/${encodeURIComponent(capability.slug)}/run`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ force: opts?.force ?? true }),
      },
    );
    return handleResponse(res);
  },
};

// ============ Agent API ============

export interface Agent {
  /** Filename without `.md` — stable identity. */
  slug: string;
  title: string;
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /** Runtime resolution source. Local repo agent win over store agent. */
  source?: "local" | "store";
  /** Store-linked agent are visible and dispatchable, but not editable locally. */
  readOnly?: boolean;
}

export const staffApi = {
  list: async (): Promise<Agent[]> => {
    const res = await fetch(`${API_BASE}/agents`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ agent: Agent[] }>(res);
    return data.agent;
  },

  get: async (slug: string): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ agentMember: Agent }>(res);
    return data.agentMember;
  },

  create: async (data: {
    slug?: string;
    title: string;
    body: string;
    actorLogin?: string;
  }): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ agentMember: Agent }>(res);
    return payload.agentMember;
  },

  update: async (
    slug: string,
    data: {
      title?: string;
      body?: string;
      actorLogin?: string;
    },
  ): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ agentMember: Agent }>(res);
    return payload.agentMember;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/agents/${encodeURIComponent(slug)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  /**
   * Send an ad-hoc message to an agent and run it like a one-shot capability.
   * Posts an `@kody agent-ask` directive on the control issue; the engine
   * runs the agentIdentity stateless and replies on that issue. When `actorLogin`
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
      `${API_BASE}/agents/${encodeURIComponent(slug)}/dispatch`,
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
  /** Owning agent-member slugs from `agent:` frontmatter (`["kody"]` default for legacy files). */
  agent: string[];
  /** Git blob sha. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export const contextApi = {
  list: async (): Promise<ContextEntry[]> => {
    const res = await fetch(`${API_BASE}/context`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
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
    agent: string[];
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
      agent?: string[];
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

// ============ Todos API ============
export interface TodoEntry {
  /** Filename without `.json` stable identity. */
  slug: string;
  /** State-repo path, usually `todos/<slug>.json` during migration. */
  path?: string;
  title: string;
  /** Markdown description for the list itself. */
  description: string;
  items: TodoItem[];
  createdAt: string;
  /** Git blob sha. */
  sha: string;
  /** Last commit timestamp affecting file (ISO8601). */
  updatedAt: string;
  /** Convenience link to file on github.com. */
  htmlUrl: string;
  /** List-level metadata from frontmatter. */
  frontmatter?: Record<string, unknown>;
}

export interface TodoItem {
  id: string;
  title: string;
  /** Markdown note body for this list item. */
  body: string;
  /** GitHub login responsible for the item, when assigned. */
  assignee: string | null;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  meta?: Record<string, unknown>;
}

export const todosApi = {
  list: async (): Promise<TodoEntry[]> => {
    const res = await fetch(`${API_BASE}/todos`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ todos: TodoEntry[] }>(res);
    return data.todos ?? [];
  },
  get: async (slug: string): Promise<TodoEntry> => {
    const res = await fetch(`${API_BASE}/todos/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ todo: TodoEntry }>(res);
    return data.todo;
  },
  create: async (data: {
    title: string;
    description?: string;
    items?: Array<{
      id?: string;
      title: string;
      body?: string;
      assignee?: string | null;
      completed?: boolean;
      createdAt?: string;
      completedAt?: string | null;
      meta?: Record<string, unknown>;
    }>;
    actorLogin?: string;
  }): Promise<TodoEntry> => {
    const res = await fetch(`${API_BASE}/todos`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ todo: TodoEntry }>(res);
    return payload.todo;
  },
  update: async (
    slug: string,
    data: {
      title?: string;
      description?: string;
      items?: TodoItem[];
      actorLogin?: string;
    },
  ): Promise<TodoEntry> => {
    const res = await fetch(`${API_BASE}/todos/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ todo: TodoEntry }>(res);
    return payload.todo;
  },
  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/todos/${encodeURIComponent(slug)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },
};

// ============ Memory API ============

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryFile {
  /** Filename without `.md` — stable identity. */
  id: string;
  meta: {
    name: string;
    description: string;
    type: MemoryType;
    created: string;
  };
  /** Markdown body after frontmatter. */
  body: string;
  /** Git blob sha. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export const memoryApi = {
  list: async (): Promise<MemoryFile[]> => {
    const res = await fetch(`${API_BASE}/memory`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ memories: MemoryFile[] }>(res);
    return data.memories ?? [];
  },

  get: async (id: string): Promise<MemoryFile> => {
    const res = await fetch(`${API_BASE}/memory/${encodeURIComponent(id)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ memory: MemoryFile }>(res);
    return data.memory;
  },

  create: async (data: {
    id: string;
    name: string;
    description: string;
    type: MemoryType;
    body: string;
    actorLogin?: string;
  }): Promise<MemoryFile> => {
    const res = await fetch(`${API_BASE}/memory`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ memory: MemoryFile }>(res);
    return payload.memory;
  },

  update: async (
    id: string,
    data: {
      name?: string;
      description?: string;
      type?: MemoryType;
      body?: string;
      actorLogin?: string;
    },
  ): Promise<MemoryFile> => {
    const res = await fetch(`${API_BASE}/memory/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ memory: MemoryFile }>(res);
    return payload.memory;
  },

  remove: async (id: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/memory/${encodeURIComponent(id)}${suffix}`,
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
  /** Report family slug — stable identity. */
  slug: string;
  /** State-repo-relative markdown path for the currently shown report. */
  path: string;
  /** Run id when this report came from `reports/<slug>/runs/<run>.md`. */
  runId: string | null;
  /** Available historical runs, newest first. Empty for legacy flat reports. */
  runs: {
    id: string;
    path: string;
    generatedAt: string | null;
    htmlUrl: string;
    size: number;
  }[];
  title: string;
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /** Size in bytes. */
  size: number;
  capabilitySlug: string | null;
  reviewStatus: string | null;
  reviewArea: string | null;
  findingCount: number;
  suggestedActions: import("./report-suggested-actions").ReportSuggestedAction[];
}

export const reportsApi = {
  list: async (): Promise<Report[]> => {
    const res = await fetch(`${API_BASE}/reports`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ reports: Report[] }>(res);
    return data.reports;
  },

  get: async (slug: string, runId?: string | null): Promise<Report> => {
    const suffix = runId
      ? `?${new URLSearchParams({ run: runId }).toString()}`
      : "";
    const res = await fetch(
      `${API_BASE}/reports/${encodeURIComponent(slug)}${suffix}`,
      {
        headers: buildHeaders(),
      },
    );
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

import type {
  CreateManagedGoalInput,
  ManagedGoalRecord,
} from "./managed-goals";

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
  listManaged: async (): Promise<ManagedGoalRecord[]> => {
    const res = await fetch(`${API_BASE}/goals/managed`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const payload = await handleResponse<{ goals: ManagedGoalRecord[] }>(res);
    return payload.goals;
  },
  createManaged: async (
    data: CreateManagedGoalInput & { actorLogin?: string },
  ): Promise<ManagedGoalRecord> => {
    const res = await fetch(`${API_BASE}/goals/managed`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ goal: ManagedGoalRecord }>(res);
    return payload.goal;
  },

  updateManaged: async (
    id: string,
    data: import("./managed-goals").UpdateManagedGoalInput,
  ): Promise<ManagedGoalRecord> => {
    const res = await fetch(
      `${API_BASE}/goals/managed/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      },
    );
    const payload = await handleResponse<{ goal: ManagedGoalRecord }>(res);
    return payload.goal;
  },

  removeManaged: async (id: string): Promise<void> => {
    const res = await fetch(
      `${API_BASE}/goals/managed/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  runManaged: async (
    id: string,
  ): Promise<{
    ok: true;
    workflowId: string;
    ref: string;
    goal: ManagedGoalRecord;
  }> => {
    const res = await fetch(
      `${API_BASE}/goals/managed/${encodeURIComponent(id)}/run`,
      {
        method: "POST",
        headers: buildHeaders(),
      },
    );
    return handleResponse(res);
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
  get: async (auth?: ApiAuthContext | null): Promise<ChangelogPayload> => {
    const res = await fetch(`${API_BASE}/changelog`, {
      headers: buildHeaders({}, auth),
    });
    return handleResponse<ChangelogPayload>(res);
  },
};

// ============ Docs API ============

export interface DocManifestEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  htmlUrl: string | null;
}

export interface DocsManifestPayload {
  files: DocManifestEntry[];
}

export interface DocFilePayload {
  name: string;
  path: string;
  content: string;
  htmlUrl: string | null;
}

export const docsApi = {
  list: async (): Promise<DocsManifestPayload> => {
    const res = await fetch(`${API_BASE}/docs`, {
      headers: buildHeaders(),
    });
    return handleResponse<DocsManifestPayload>(res);
  },
  get: async (path: string): Promise<DocFilePayload> => {
    const res = await fetch(
      `${API_BASE}/docs?path=${encodeURIComponent(path)}`,
      {
        headers: buildHeaders(),
      },
    );
    return handleResponse<DocFilePayload>(res);
  },
  create: async (input: {
    path: string;
    content: string;
  }): Promise<DocFilePayload> => {
    const res = await fetch(`${API_BASE}/docs`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    return handleResponse<DocFilePayload>(res);
  },
  update: async (
    path: string,
    input: { content?: string; newPath?: string },
  ): Promise<DocFilePayload> => {
    const res = await fetch(
      `${API_BASE}/docs?path=${encodeURIComponent(path)}`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(input),
      },
    );
    return handleResponse<DocFilePayload>(res);
  },
  remove: async (path: string): Promise<void> => {
    const res = await fetch(
      `${API_BASE}/docs?path=${encodeURIComponent(path)}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean; path: string }>(res);
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
 * (`execute`/`fix`); non-dispatchable verbs are recorded only. Verdicts are
 * tallied in the capability trust ledger that drives graduation.
 */
export const ctoApi = {
  decide: async (input: {
    /** Emitting agent slug; kept for display and legacy entries. */
    agent?: string;
    /** Emitting capability slug — the trust key (falls back to agent server-side). */
    capability?: string;
    taskNumber: number;
    action?: import("./cto/recommendation").CtoAction;
    decision: "approve" | "reject" | "dismiss";
    actorLogin?: string;
    /** The exact `@kody …` command from the agent's `kody-cmd` line. */
    command?: string;
  }): Promise<{
    ok: true;
    executed: boolean;
    agent: string;
    capability: string;
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
   * Latest verdict per `${capability}:${taskNumber}:${action}` from the trust
   * ledger, carrying the timestamp it was recorded so the inbox can scope the
   * badge to recs that pre-date the decision (a dismiss on yesterday's
   * `sync` rec must not silently dismiss today's fresh one). Used by
   * `verdictFor(capability, taskNumber, action, sinceIso)`.
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
   * Full per-capability trust stats + recent decision log, for the /trust page.
   * `capabilities[<slug>]` holds one whole-capability stats block (no action dimension).
   */
  trust: async (): Promise<{
    capabilities: Record<
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
   * Apply one operator override to a capability's autonomy (whole capability):
   * `reset` (wipe), `graduate` (force auto now), `degrade` (force ask).
   * Never posts an `@kody` command — it only rewrites trust state.
   */
  setTrust: async (input: {
    capability: string;
    op: import("./cto/trust-state").TrustOp;
    actorLogin?: string;
  }): Promise<{
    ok: true;
    capability: string;
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
  /** Kody run timelines loaded from GitHub Actions artifacts. */
  runLogs: async (): Promise<
    import("./activity/run-logs").KodyRunLogsSnapshot
  > => {
    const res = await fetch(`${API_BASE}/activity/run-logs`, {
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
  /** Company activity — engine-authored, attributed actions (capability runs). */
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
  /** Export the connected repo's agent/capabilities/prompts/instructions bundle. */
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

  /** The operator list (`github.operators`) — who recommendation capabilities
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

/** The dashboard-editable slice of kody.config.json (see /engine).
 * `perExecutable` (model routing) is edited on /models, the rest here. */
export interface EngineEditableConfig {
  quality: {
    typecheck?: string;
    lint?: string;
    format?: string;
    testUnit?: string;
  };
  aliases: Record<string, string>;
  allowedAssociations: string[];
  activeAgents?: string[];
  activeCapabilities?: string[];
  activeCommands?: string[];
  activeGoals?: Array<
    | string
    | {
        template: string;
        every?: string;
        idPrefix?: string;
        facts?: Record<string, unknown>;
      }
  >;
  activeWorkflows?: string[];
  state: {
    repo?: string;
    path?: string;
  } | null;
  defaultBranch: string;
  perExecutable: Record<string, string>;
  /** Thinking level for the engine (off|low|medium|high). Null = unset.
   * Loose string here — the route validates the canonical vocabulary
   * via Zod, so the client only needs the string channel. */
  reasoningEffort: string | null;
}

// ============ Jobs API ============

import type { KodyJob } from "./kody-job";

export const jobsApi = {
  /**
   * Run an INSTANT job — assembles to an `@kody <executable> [why]` dispatch on
   * the job's target issue/PR. Scheduled jobs persist as a capability instead (see
   * `capabilitiesApi.create`), so this only accepts `flavor: "instant"`.
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

// ============ Company Intents API ============

export const companyIntentsApi = {
  list: async (): Promise<CompanyIntentRecord[]> => {
    const res = await fetch(`${API_BASE}/company/intents`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const payload = await handleResponse<{ intents: CompanyIntentRecord[] }>(
      res,
    );
    return payload.intents;
  },
  create: async (
    data: CompanyIntentInput & { actorLogin?: string },
  ): Promise<CompanyIntentRecord> => {
    const res = await fetch(`${API_BASE}/company/intents`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ intent: CompanyIntentRecord }>(res);
    return payload.intent;
  },
  update: async (
    id: string,
    data: Partial<CompanyIntentInput> & {
      status?: CompanyIntentStatus;
      actorLogin?: string;
    },
  ): Promise<CompanyIntentRecord> => {
    const res = await fetch(
      `${API_BASE}/company/intents/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      },
    );
    const payload = await handleResponse<{ intent: CompanyIntentRecord }>(res);
    return payload.intent;
  },
  run: async (
    id: string,
    actorLogin?: string,
  ): Promise<{
    ok: true;
    workflowId: string;
    ref: string;
    action: string;
    intentId: string;
  }> => {
    const res = await fetch(
      `${API_BASE}/company/intents/${encodeURIComponent(id)}/run`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ ...(actorLogin ? { actorLogin } : {}) }),
      },
    );
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
  workflowDefinitions: workflowDefinitionsApi,
  ci: ciApi,
  remote: remoteApi,
  capabilities: capabilitiesApi,
  agent: staffApi,
  context: contextApi,
  todos: todosApi,
  memory: memoryApi,
  company: companyApi,
  companyIntents: companyIntentsApi,
  reports: reportsApi,
  goals: goalsApi,
  messages: messagesApi,
  notifications: notificationsApi,
  changelog: changelogApi,
  docs: docsApi,
  vibe: vibeApi,
  cto: ctoApi,
  activity: activityApi,
  kodyBugs: kodyBugsApi,
};
