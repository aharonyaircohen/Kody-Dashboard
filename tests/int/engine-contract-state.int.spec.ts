/**
 * @fileoverview Integration tests for Engine State Contract
 * @testFramework vitest
 * @domain engine-contract
 *
 * Tests the PipelineStatus schema, label parsing, status comment parsing,
 * and ETag polling helpers.
 */

import { describe, it, expect } from "vitest";
import {
  PipelineStatusSchema,
  StageStatusSchema,
  buildStatusCommentMarker,
  parseStatusCommentMarker,
  extractPipelineData,
  buildStatusComment,
  findStatusCommentId,
  parseAndValidatePipelineStatus,
  isEngineLabel,
  getStateFromLabel,
  buildLabel,
  stateToKanbanColumn,
  LABEL_SUFFIX_TO_STATE,
  STATE_TO_LABEL_SUFFIX,
  getETag,
  buildPollingHeaders,
  isNotModifiedResponse,
  getCommentUpdateStrategy,
  type PipelineStatus,
} from "@dashboard/contracts/state";

import {
  KodyPipelineStatusSchema,
  KodyStageStatusSchema,
  translatePRReviewToAction,
  validateKodyStatusBackwardCompat,
  isKodyLabel,
  getKodyStateFromLabel,
  type PRReviewPayload,
} from "@dashboard/contracts/kody";

describe("StageStatus Schema", () => {
  it("should validate a complete stage status", () => {
    const result = StageStatusSchema.safeParse({
      state: "running",
      startedAt: "2025-01-01T00:00:00Z",
      retries: 0,
    });
    expect(result.success).toBe(true);
  });

  it("should validate with optional fields", () => {
    const result = StageStatusSchema.safeParse({
      state: "completed",
      startedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:05:00Z",
      elapsed: 300,
      retries: 1,
      error: "Some error",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid state", () => {
    const result = StageStatusSchema.safeParse({
      state: "invalid",
      retries: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should default retries to 0", () => {
    const result = StageStatusSchema.safeParse({
      state: "pending",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retries).toBe(0);
    }
  });
});

describe("PipelineStatus Schema", () => {
  const validPipelineStatus = {
    taskId: "task-123",
    state: "running",
    startedAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:01:00Z",
    currentStage: "implement",
    stages: {
      plan: { state: "completed", retries: 0 },
      implement: {
        state: "running",
        startedAt: "2025-01-01T00:01:00Z",
        retries: 0,
      },
    },
    triggeredBy: "user-login",
  };

  it("should validate a complete pipeline status", () => {
    const result = PipelineStatusSchema.safeParse(validPipelineStatus);
    expect(result.success).toBe(true);
  });

  it("should validate with optional fields", () => {
    const result = PipelineStatusSchema.safeParse({
      ...validPipelineStatus,
      completedAt: "2025-01-01T00:10:00Z",
      issueNumber: 42,
      runUrl: "https://github.com/org/repo/actions/runs/123",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing required fields", () => {
    const result = PipelineStatusSchema.safeParse({
      taskId: "task-123",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid state", () => {
    const result = PipelineStatusSchema.safeParse({
      ...validPipelineStatus,
      state: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("should preserve extra fields via passthrough", () => {
    const result = PipelineStatusSchema.safeParse({
      ...validPipelineStatus,
      extraField: "should be preserved",
      anotherField: 123,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.extraField).toBe("should be preserved");
      expect(result.data.anotherField).toBe(123);
    }
  });

  it("should accept any stage names", () => {
    const result = PipelineStatusSchema.safeParse({
      ...validPipelineStatus,
      stages: {
        "custom-stage-name": { state: "running", retries: 0 },
        stage123: { state: "completed", retries: 0 },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("Label Mapping", () => {
  const engineName = "kody";

  describe("isEngineLabel", () => {
    it("should return true for valid engine labels", () => {
      expect(isEngineLabel("kody:building", engineName)).toBe(true);
      expect(isEngineLabel("kody:done", engineName)).toBe(true);
      expect(isEngineLabel("kody:failed", engineName)).toBe(true);
      expect(isEngineLabel("kody:paused", engineName)).toBe(true);
      expect(isEngineLabel("kody:timeout", engineName)).toBe(true);
    });

    it("should return false for non-engine labels", () => {
      expect(isEngineLabel("other:building", engineName)).toBe(false);
      expect(isEngineLabel("kody:invalid", engineName)).toBe(false);
      expect(isEngineLabel("bug", engineName)).toBe(false);
      expect(isEngineLabel("enhancement", engineName)).toBe(false);
    });
  });

  describe("getStateFromLabel", () => {
    it("should map building to running", () => {
      expect(getStateFromLabel("kody:building", engineName)).toBe("running");
    });

    it("should map done to completed", () => {
      expect(getStateFromLabel("kody:done", engineName)).toBe("completed");
    });

    it("should map failed to failed", () => {
      expect(getStateFromLabel("kody:failed", engineName)).toBe("failed");
    });

    it("should map paused to paused", () => {
      expect(getStateFromLabel("kody:paused", engineName)).toBe("paused");
    });

    it("should map timeout to timeout", () => {
      expect(getStateFromLabel("kody:timeout", engineName)).toBe("timeout");
    });

    it("should return null for non-engine labels", () => {
      expect(getStateFromLabel("other:building", engineName)).toBeNull();
      expect(getStateFromLabel("kody:invalid", engineName)).toBeNull();
    });
  });

  describe("buildLabel", () => {
    it("should build correct label for each state", () => {
      expect(buildLabel(engineName, "running")).toBe("kody:building");
      expect(buildLabel(engineName, "completed")).toBe("kody:done");
      expect(buildLabel(engineName, "failed")).toBe("kody:failed");
      expect(buildLabel(engineName, "paused")).toBe("kody:paused");
      expect(buildLabel(engineName, "timeout")).toBe("kody:timeout");
    });
  });

  describe("LABEL_SUFFIX_TO_STATE", () => {
    it("should have all expected suffixes", () => {
      expect(LABEL_SUFFIX_TO_STATE.building).toBe("running");
      expect(LABEL_SUFFIX_TO_STATE.done).toBe("completed");
      expect(LABEL_SUFFIX_TO_STATE.failed).toBe("failed");
      expect(LABEL_SUFFIX_TO_STATE.paused).toBe("paused");
      expect(LABEL_SUFFIX_TO_STATE.timeout).toBe("timeout");
    });
  });

  describe("STATE_TO_LABEL_SUFFIX", () => {
    it("should have all expected states", () => {
      expect(STATE_TO_LABEL_SUFFIX.running).toBe("building");
      expect(STATE_TO_LABEL_SUFFIX.completed).toBe("done");
      expect(STATE_TO_LABEL_SUFFIX.failed).toBe("failed");
      expect(STATE_TO_LABEL_SUFFIX.paused).toBe("paused");
      expect(STATE_TO_LABEL_SUFFIX.timeout).toBe("timeout");
    });
  });
});

describe("Kanban Column Mapping", () => {
  it("should map running to building column", () => {
    expect(stateToKanbanColumn("running")).toBe("building");
  });

  it("should map completed to done column", () => {
    expect(stateToKanbanColumn("completed")).toBe("done");
  });

  it("should map failed to failed column", () => {
    expect(stateToKanbanColumn("failed")).toBe("failed");
  });

  it("should map paused to gate-waiting column", () => {
    expect(stateToKanbanColumn("paused")).toBe("gate-waiting");
  });

  it("should map timeout to failed column", () => {
    expect(stateToKanbanColumn("timeout")).toBe("failed");
  });

  it("should map null to open column", () => {
    expect(stateToKanbanColumn(null)).toBe("open");
  });
});

describe("Status Comment Parsing", () => {
  const engineName = "kody";
  const taskId = "task-123";

  describe("buildStatusCommentMarker", () => {
    it("should build correct marker", () => {
      expect(buildStatusCommentMarker(engineName, taskId)).toBe(
        "<!-- kody-status:task-123 -->",
      );
    });
  });

  describe("parseStatusCommentMarker", () => {
    it("should parse valid marker", () => {
      const result = parseStatusCommentMarker("<!-- kody-status:task-123 -->");
      expect(result).toEqual({ engineName: "kody", taskId: "task-123" });
    });

    it("should parse marker with whitespace", () => {
      const result = parseStatusCommentMarker(
        "<!--   kody-status:task-456   -->",
      );
      expect(result).toEqual({ engineName: "kody", taskId: "task-456" });
    });

    it("should return null for non-matching body", () => {
      expect(parseStatusCommentMarker("Hello world")).toBeNull();
    });

    it("should parse markers from any engine (generic parser)", () => {
      // parseStatusCommentMarker is a generic parser - it extracts any marker
      const result = parseStatusCommentMarker("<!-- other-status:task-123 -->");
      expect(result).toEqual({ engineName: "other", taskId: "task-123" });
    });
  });

  describe("extractPipelineData", () => {
    it("should extract JSON from pipeline-data block", () => {
      const body = `<!-- kody-status:task-123 -->

Some text

<!--pipeline-data
{"taskId": "task-123", "state": "running"}
-->`;
      const result = extractPipelineData(body);
      expect(result).toEqual({ taskId: "task-123", state: "running" });
    });

    it("should return null for non-matching body", () => {
      expect(extractPipelineData("No data block here")).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      const body = `<!--pipeline-data
{invalid json}
-->`;
      expect(extractPipelineData(body)).toBeNull();
    });
  });

  describe("buildStatusComment", () => {
    it("should build complete status comment", () => {
      const status: PipelineStatus = {
        taskId: "task-123",
        state: "running",
        startedAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:01:00Z",
        currentStage: "implement",
        stages: {
          plan: { state: "completed", retries: 0 },
          implement: { state: "running", retries: 0 },
        },
        triggeredBy: "user",
      };
      const summary = "Pipeline is running";
      const result = buildStatusComment(engineName, taskId, status, summary);

      expect(result).toContain("<!-- kody-status:task-123 -->");
      expect(result).toContain("Pipeline is running");
      expect(result).toContain("<!--pipeline-data");
      expect(result).toContain('"taskId": "task-123"');
    });
  });
});

describe("Status Comment Discovery", () => {
  const engineName = "kody";
  const taskId = "task-123";

  const comments = [
    { id: 1, body: "Hello world" },
    {
      id: 2,
      body: '<!-- kody-status:task-123 -->\n\nRunning\n\n<!--pipeline-data\n{"taskId": "task-123", "state": "running"}\n-->',
    },
    { id: 3, body: "Another comment" },
  ];

  describe("findStatusCommentId", () => {
    it("should find existing status comment", () => {
      expect(findStatusCommentId(comments, engineName, taskId)).toBe(2);
    });

    it("should return null when not found", () => {
      expect(
        findStatusCommentId(comments, engineName, "nonexistent"),
      ).toBeNull();
    });
  });

  describe("parseAndValidatePipelineStatus", () => {
    it("should parse and validate a valid status comment", () => {
      const body = `<!-- kody-status:task-123 -->

Pipeline is running

<!--pipeline-data
{
  "taskId": "task-123",
  "state": "running",
  "startedAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:01:00Z",
  "currentStage": "implement",
  "stages": {
    "plan": { "state": "completed", "retries": 0 }
  },
  "triggeredBy": "user"
}
-->`;
      const result = parseAndValidatePipelineStatus(body);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.taskId).toBe("task-123");
        expect(result.state).toBe("running");
      }
    });

    it("should return null for invalid JSON", () => {
      const body = `<!-- kody-status:task-123 -->

<!--pipeline-data
{invalid}
-->`;
      expect(parseAndValidatePipelineStatus(body)).toBeNull();
    });

    it("should return null for missing required fields", () => {
      const body = `<!-- kody-status:task-123 -->

<!--pipeline-data
{"taskId": "task-123"}
-->`;
      expect(parseAndValidatePipelineStatus(body)).toBeNull();
    });
  });
});

describe("ETag Polling Helpers", () => {
  describe("getETag", () => {
    it("should extract ETag from response", () => {
      const response = new Response(null, {
        headers: { ETag: '"abc123"' },
      });
      expect(getETag(response)).toBe('"abc123"');
    });

    it("should return null when no ETag", () => {
      const response = new Response(null, { headers: {} });
      expect(getETag(response)).toBeNull();
    });
  });

  describe("buildPollingHeaders", () => {
    it("should build headers with ETag", () => {
      const headers = buildPollingHeaders('"abc123"');
      expect(headers).toEqual({ "If-None-Match": '"abc123"' });
    });

    it("should build empty headers when no ETag", () => {
      const headers = buildPollingHeaders(null);
      expect(headers).toEqual({});
    });

    it("should build empty headers when undefined", () => {
      const headers = buildPollingHeaders(undefined);
      expect(headers).toEqual({});
    });
  });

  describe("isNotModifiedResponse", () => {
    it("should return true for 304 status", () => {
      const response = new Response(null, { status: 304 });
      expect(isNotModifiedResponse(response)).toBe(true);
    });

    it("should return false for 200 status", () => {
      const response = new Response(null, { status: 200 });
      expect(isNotModifiedResponse(response)).toBe(false);
    });
  });
});

describe("Comment Update Strategy", () => {
  const engineName = "kody";
  const taskId = "task-123";

  const comments = [
    { id: 1, body: "Hello" },
    { id: 2, body: "<!-- kody-status:task-123 -->Status" },
  ];

  it("should return update when cached ID exists and comment exists", () => {
    expect(getCommentUpdateStrategy(2, comments, engineName, taskId)).toBe(
      "update",
    );
  });

  it("should return update when cached ID stale but found via scan", () => {
    expect(getCommentUpdateStrategy(999, comments, engineName, taskId)).toBe(
      "update",
    );
  });

  it("should return create when no cached ID and not found via scan", () => {
    expect(
      getCommentUpdateStrategy(null, comments, engineName, "nonexistent"),
    ).toBe("create");
  });

  it("should return create when no comments exist", () => {
    expect(getCommentUpdateStrategy(null, [], engineName, taskId)).toBe(
      "create",
    );
  });
});

describe("Kody Extension", () => {
  describe("KodyStageStatusSchema", () => {
    it("should validate Kody stage status with extensions", () => {
      const result = KodyStageStatusSchema.safeParse({
        state: "completed",
        retries: 0,
        cost: 0.05,
        tokenUsage: { input: 1000, output: 500, cacheRead: 200 },
        feedbackLoops: 2,
        issuesFound: 3,
      });
      expect(result.success).toBe(true);
    });

    it("should validate base fields only", () => {
      const result = KodyStageStatusSchema.safeParse({
        state: "running",
        retries: 0,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("KodyPipelineStatusSchema", () => {
    const validKodyStatus = {
      taskId: "task-123",
      state: "running",
      startedAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:01:00Z",
      currentStage: "implement",
      stages: {
        implement: { state: "running", retries: 0 },
      },
      triggeredBy: "user",
      totalCost: 0.25,
      controlMode: "supervised" as const,
      pipeline: "impl",
      mode: "impl",
      actorHistory: [
        {
          action: "pipeline-triggered",
          actor: "user",
          timestamp: "2025-01-01T00:00:00Z",
        },
      ],
    };

    it("should validate complete Kody status", () => {
      const result = KodyPipelineStatusSchema.safeParse(validKodyStatus);
      expect(result.success).toBe(true);
    });

    it("should validate without optional Kody fields", () => {
      const result = KodyPipelineStatusSchema.safeParse({
        taskId: "task-123",
        state: "running",
        startedAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:01:00Z",
        currentStage: "implement",
        stages: { implement: { state: "running", retries: 0 } },
        triggeredBy: "user",
      });
      expect(result.success).toBe(true);
    });

    it("should preserve extra fields via passthrough", () => {
      const result = KodyPipelineStatusSchema.safeParse({
        ...validKodyStatus,
        customField: "value",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customField).toBe("value");
      }
    });
  });

  describe("isKodyLabel", () => {
    it("should return true for valid Kody labels", () => {
      expect(isKodyLabel("kody:building")).toBe(true);
      expect(isKodyLabel("kody:done")).toBe(true);
      expect(isKodyLabel("kody:failed")).toBe(true);
    });

    it("should return false for invalid labels", () => {
      expect(isKodyLabel("other:building")).toBe(false);
      expect(isKodyLabel("kody:invalid")).toBe(false);
    });
  });

  describe("getKodyStateFromLabel", () => {
    it("should extract state from Kody label", () => {
      expect(getKodyStateFromLabel("kody:building")).toBe("running");
      expect(getKodyStateFromLabel("kody:done")).toBe("completed");
      expect(getKodyStateFromLabel("kody:failed")).toBe("failed");
      expect(getKodyStateFromLabel("kody:paused")).toBe("paused");
      expect(getKodyStateFromLabel("kody:timeout")).toBe("timeout");
    });

    it("should return null for non-Kody labels", () => {
      expect(getKodyStateFromLabel("other:building")).toBeNull();
      expect(getKodyStateFromLabel("kody:invalid")).toBeNull();
    });
  });

  describe("translatePRReviewToAction", () => {
    const createPayload = (
      action: "changes_requested" | "approved",
      body: string | null,
    ) =>
      ({
        action,
        review: {
          id: 1,
          body,
          commit_id: "abc123",
          state: action,
          user: { login: "reviewer" },
        },
        pull_request: {
          id: 1,
          number: 42,
          title: "Fix bug",
          body: null,
          state: "open",
          html_url: "https://github.com/org/repo/pull/42",
          base: { ref: "main", sha: "abc" },
          head: { ref: "feature", sha: "def" },
        },
        repository: {
          id: 1,
          name: "repo",
          full_name: "org/repo",
        },
      }) as PRReviewPayload;

    it("should translate changes_requested with body to rerun action", () => {
      const payload = createPayload(
        "changes_requested",
        "Please fix the tests",
      );
      const result = translatePRReviewToAction(payload);
      expect(result).toEqual({
        action: "rerun",
        feedback: "Please fix the tests",
      });
    });

    it("should return null for approved action", () => {
      const payload = createPayload("approved", "LGTM");
      expect(translatePRReviewToAction(payload)).toBeNull();
    });

    it("should return null for changes_requested without body", () => {
      const payload = createPayload("changes_requested", null);
      expect(translatePRReviewToAction(payload)).toBeNull();
    });

    it("should return null for empty body", () => {
      const payload = createPayload("changes_requested", "   ");
      expect(translatePRReviewToAction(payload)).toBeNull();
    });
  });

  describe("validateKodyStatusBackwardCompat", () => {
    it("should validate status passes both generic and Kody schemas", () => {
      const status = {
        taskId: "task-123",
        state: "running",
        startedAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:01:00Z",
        currentStage: "implement",
        stages: {
          implement: { state: "running", retries: 0 },
        },
        triggeredBy: "user",
      };
      const result = validateKodyStatusBackwardCompat(status);
      expect(result.isGenericValid).toBe(true);
      expect(result.isKodyValid).toBe(true);
    });

    it("should report when status fails generic schema", () => {
      const status = { invalid: "data" };
      const result = validateKodyStatusBackwardCompat(status);
      expect(result.isGenericValid).toBe(false);
      expect(result.genericError).toBeDefined();
    });
  });
});
