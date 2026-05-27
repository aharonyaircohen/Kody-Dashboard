/**
 * Regression tests for column derivation — locks in the priority order so a
 * future refactor can't reintroduce the "completed task flips to running"
 * bug. The bug came from a stray workflow run whose display_title contained
 * the issue's `#N` matching the task and overriding `kody:done`. Fix: trust
 * the engine's `kodyState` (phase: shipped) before the active-run override.
 */
import { describe, expect, it } from "vitest";
import { deriveTaskColumn } from "@dashboard/lib/tasks/derive-column";
import type { KodyTaskState } from "@dashboard/lib/kody-state";
import type {
  GitHubIssue,
  GitHubPR,
  KodyPipelineStatus,
  WorkflowRun,
} from "@dashboard/lib/types";

function issue(over: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 1,
    number: 42,
    title: "Test task",
    body: null,
    state: "open",
    labels: [],
    milestone: null,
    assignees: [],
    created_at: "2026-05-20T00:00:00Z",
    updated_at: "2026-05-20T00:00:00Z",
    closed_at: null,
    html_url: "https://github.com/x/y/issues/42",
    ...over,
  };
}

function shippedState(): KodyTaskState {
  return {
    schemaVersion: 1,
    core: {
      phase: "shipped",
      status: "succeeded",
      currentExecutable: null,
      lastOutcome: null,
      attempts: {},
    },
  };
}

function failedState(): KodyTaskState {
  return {
    schemaVersion: 1,
    core: {
      phase: "failed",
      status: "failed",
      currentExecutable: null,
      lastOutcome: null,
      attempts: {},
    },
  };
}

function idleRunningState(): KodyTaskState {
  // Real-world stuck state: classify ran, set status=running, but the task
  // is parked at phase=idle (no working phase started). Backlog item.
  return {
    schemaVersion: 1,
    core: {
      phase: "idle",
      status: "running",
      currentExecutable: "classify",
      lastOutcome: null,
      attempts: { classify: 1 },
    },
  };
}

function activeRun(): WorkflowRun {
  return {
    id: 999,
    status: "in_progress",
    conclusion: null,
    created_at: "2026-05-25T12:00:00Z",
    updated_at: "2026-05-25T12:00:00Z",
    html_url: "https://github.com/x/y/actions/runs/999",
    display_title: "stray match against #42",
  };
}

function completedPipeline(): KodyPipelineStatus {
  return {
    taskId: "x",
    mode: "full",
    pipeline: "spec_execute_verify",
    startedAt: "2026-05-25T10:00:00Z",
    updatedAt: "2026-05-25T10:15:00Z",
    state: "completed",
    currentStage: null,
    stages: {},
    triggeredBy: "test",
  };
}

describe("deriveTaskColumn — engine state wins over stray active run", () => {
  it("shipped engine state stays 'done' even when an active run matched the issue", () => {
    // Regression case: was returning 'building' before the fix.
    const result = deriveTaskColumn({
      issue: issue({ labels: [{ name: "kody:done", color: "" }] }),
      workflowRun: activeRun(),
      kodyState: shippedState(),
      pipelineStatus: completedPipeline(),
    });
    expect(result).toBe("done");
  });

  it("failed engine state stays 'failed' even when an active run matched the issue", () => {
    const result = deriveTaskColumn({
      issue: issue({ labels: [{ name: "kody:failed", color: "" }] }),
      workflowRun: activeRun(),
      kodyState: failedState(),
    });
    expect(result).toBe("failed");
  });
});

describe("deriveTaskColumn — closed issue is terminal", () => {
  it("closed issues always land in 'done' regardless of stale building labels", () => {
    const result = deriveTaskColumn({
      issue: issue({
        state: "closed",
        labels: [{ name: "kody:building", color: "" }],
      }),
    });
    expect(result).toBe("done");
  });
});

describe("deriveTaskColumn — stale pipeline + active run forces 'building'", () => {
  it("when engine state is absent and pipeline JSON is stale but a new run is in flight, move to building", () => {
    // Mirrors @kody fix-ci / @kody sync re-triggering a done task.
    const result = deriveTaskColumn({
      issue: issue({ labels: [{ name: "kody:done", color: "" }] }),
      workflowRun: activeRun(),
      kodyState: null,
      pipelineStatus: completedPipeline(),
    });
    expect(result).toBe("building");
  });
});

describe("deriveTaskColumn — pipeline status drives column when fresh", () => {
  it("running pipeline → 'building'", () => {
    const result = deriveTaskColumn({
      issue: issue(),
      pipelineStatus: { ...completedPipeline(), state: "running" },
    });
    expect(result).toBe("building");
  });

  it("failed pipeline (no active run) → 'failed'", () => {
    const result = deriveTaskColumn({
      issue: issue(),
      pipelineStatus: { ...completedPipeline(), state: "failed" },
    });
    expect(result).toBe("failed");
  });
});

describe("deriveTaskColumn — label fallback when no pipeline data", () => {
  it("kody:building label maps to 'building'", () => {
    const result = deriveTaskColumn({
      issue: issue({ labels: [{ name: "kody:building", color: "" }] }),
    });
    expect(result).toBe("building");
  });

  it("kody:done with no kodyState and no active run stays 'done'", () => {
    const result = deriveTaskColumn({
      issue: issue({ labels: [{ name: "kody:done", color: "" }] }),
    });
    expect(result).toBe("done");
  });

  it("idle+running engine state with no live run → 'open' (no flap to building)", () => {
    // Regression: a backlog issue with a stale `phase:idle, status:running`
    // state comment was returning 'building', and only when that state
    // happened to be read — so the card flapped running↔backlog as the old
    // run slid in/out of the recent-runs window. Idle is not active work.
    const result = deriveTaskColumn({
      issue: issue({ labels: [{ name: "feature", color: "" }] }),
      kodyState: idleRunningState(),
    });
    expect(result).toBe("open");
  });

  it("idle+running engine state WITH a live run still → 'building'", () => {
    // The fall-through must still catch genuinely active work: when a real
    // in_progress run backs the idle state, it belongs in 'building'.
    const result = deriveTaskColumn({
      issue: issue({ labels: [{ name: "feature", color: "" }] }),
      kodyState: idleRunningState(),
      workflowRun: activeRun(),
    });
    expect(result).toBe("building");
  });

  it("open PR with no labels → 'review'", () => {
    const pr: GitHubPR = {
      id: 7,
      number: 7,
      title: "x",
      state: "open",
      head: { ref: "feature/x", sha: "abc" },
      merged_at: null,
      html_url: "https://github.com/x/y/pull/7",
    };
    const result = deriveTaskColumn({
      issue: issue(),
      associatedPR: pr,
    });
    expect(result).toBe("review");
  });
});
