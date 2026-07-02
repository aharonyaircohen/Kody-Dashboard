export type KodyRunTarget =
  | { type: "chat"; id: string }
  | { type: "goal"; id: string }
  | { type: "issue"; id: number }
  | { type: "workflow"; id: string };

export type KodyRunIntent = "continue" | "manage" | "run" | "tick";
export type KodyRunSource = "dashboard" | "github" | "schedule";

export interface KodyRunRequest {
  target: KodyRunTarget;
  intent: KodyRunIntent;
  source: KodyRunSource;
  input?: Record<string, unknown>;
}

export interface KodyStoreTarget {
  storeRepoUrl?: string;
  storeRef?: string;
}

export const SCHEDULED_FANOUT_WORKFLOW_ID = "scheduled-fanout";

export function chatRunRequest(sessionId: string): KodyRunRequest {
  return {
    target: { type: "chat", id: sessionId },
    intent: "continue",
    source: "dashboard",
  };
}

export function issueRunRequest(issueNumber: number): KodyRunRequest {
  return {
    target: { type: "issue", id: issueNumber },
    intent: "run",
    source: "dashboard",
  };
}

export function goalRunRequest(goalId: string): KodyRunRequest {
  return {
    target: { type: "goal", id: goalId },
    intent: "manage",
    source: "dashboard",
  };
}

export function workflowRunRequest(workflowId: string): KodyRunRequest {
  return {
    target: { type: "workflow", id: workflowId },
    intent: "run",
    source: "dashboard",
  };
}

export function scheduledFanoutRunRequest(): KodyRunRequest {
  return {
    target: { type: "workflow", id: SCHEDULED_FANOUT_WORKFLOW_ID },
    intent: "tick",
    source: "dashboard",
  };
}

export function withStoreTarget(
  request: KodyRunRequest,
  target: KodyStoreTarget | null | undefined,
): KodyRunRequest {
  const storeRepoUrl = target?.storeRepoUrl?.trim();
  const storeRef = target?.storeRef?.trim();
  if (!storeRepoUrl && !storeRef) return request;

  return {
    ...request,
    input: {
      ...(request.input ?? {}),
      ...(storeRepoUrl ? { storeRepoUrl } : {}),
      ...(storeRef ? { storeRef } : {}),
    },
  };
}
