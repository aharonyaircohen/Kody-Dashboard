import { describe, expect, it } from "vitest";
import {
  STATE_BEGIN,
  STATE_END,
  parseKodyStateComment,
  findKodyStateInComments,
  type KodyTaskState,
} from "@dashboard/lib/kody-state";

const minimalState: KodyTaskState = {
  schemaVersion: 1,
  core: {
    phase: "planning",
    status: "running",
    currentExecutable: "plan",
    lastOutcome: {
      type: "PLAN_STARTED",
      payload: {},
      timestamp: "2026-05-10T14:00:00Z",
    },
    attempts: { plan: 1 },
  },
};

function renderComment(state: KodyTaskState): string {
  return [
    "## kody task state",
    "",
    STATE_BEGIN,
    "",
    "```json",
    JSON.stringify(state, null, 2),
    "```",
    "",
    STATE_END,
  ].join("\n");
}

describe("parseKodyStateComment", () => {
  it("returns null for empty body", () => {
    expect(parseKodyStateComment("")).toBeNull();
  });

  it("returns null for body without state markers", () => {
    expect(parseKodyStateComment("Just a regular comment")).toBeNull();
  });

  it("returns null when only the begin marker is present", () => {
    expect(
      parseKodyStateComment(
        `Some text\n${STATE_BEGIN}\n\`\`\`json\n{}\n\`\`\``,
      ),
    ).toBeNull();
  });

  it("returns null when JSON is not wrapped in ```json fences", () => {
    const body = `${STATE_BEGIN}\n${JSON.stringify(minimalState)}\n${STATE_END}`;
    expect(parseKodyStateComment(body)).toBeNull();
  });

  it("returns null when schema version is missing or wrong", () => {
    const bad = renderComment({ ...minimalState, schemaVersion: 99 as 1 });
    expect(parseKodyStateComment(bad)).toBeNull();
  });

  it("returns null when JSON is malformed", () => {
    const body = [
      STATE_BEGIN,
      "",
      "```json",
      "{ this is not json }",
      "```",
      "",
      STATE_END,
    ].join("\n");
    expect(parseKodyStateComment(body)).toBeNull();
  });

  it("parses a well-formed state comment", () => {
    const body = renderComment(minimalState);
    const parsed = parseKodyStateComment(body);
    expect(parsed?.core.phase).toBe("planning");
    expect(parsed?.core.status).toBe("running");
    expect(parsed?.core.currentExecutable).toBe("plan");
    expect(parsed?.core.attempts).toEqual({ plan: 1 });
  });

  it("uses the LAST STATE_END marker (artifact content can contain literals)", () => {
    // An embedded artifact (e.g. a plan markdown that discusses kody state)
    // can include literal STATE_END strings; the producer guarantees the real
    // close marker is the last occurrence, after the closing ``` fence.
    const body = [
      STATE_BEGIN,
      "",
      "```json",
      JSON.stringify({
        ...minimalState,
        core: {
          ...minimalState.core,
          lastOutcome: {
            type: "PLAN_COMPLETED",
            payload: {
              note: `inside text talks about ${STATE_END} embedded`,
            },
            timestamp: "2026-05-10T14:00:00Z",
          },
        },
      }),
      "```",
      "",
      STATE_END,
    ].join("\n");
    const parsed = parseKodyStateComment(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.core.lastOutcome?.type).toBe("PLAN_COMPLETED");
  });

  it("fills missing core fields with sensible defaults", () => {
    const partial = {
      schemaVersion: 1 as const,
      core: { phase: "idle" as const },
    };
    const body = renderComment(partial as unknown as KodyTaskState);
    const parsed = parseKodyStateComment(body);
    expect(parsed?.core.status).toBe("pending");
    expect(parsed?.core.currentExecutable).toBeNull();
    expect(parsed?.core.lastOutcome).toBeNull();
    expect(parsed?.core.attempts).toEqual({});
  });
});

describe("findKodyStateInComments", () => {
  it("returns null for an empty list", () => {
    expect(findKodyStateInComments([])).toBeNull();
  });

  it("returns null when no comment contains a state block", () => {
    expect(
      findKodyStateInComments([{ body: "random" }, { body: "@kody run" }]),
    ).toBeNull();
  });

  it("returns the state from the only comment containing one", () => {
    const body = renderComment(minimalState);
    const result = findKodyStateInComments([{ body: "random" }, { body }]);
    expect(result?.core.phase).toBe("planning");
  });

  it("prefers the most recent state comment when multiple are present", () => {
    const older = renderComment(minimalState);
    const newer = renderComment({
      ...minimalState,
      core: { ...minimalState.core, phase: "reviewing", status: "succeeded" },
    });
    const result = findKodyStateInComments([
      { body: older },
      { body: "noise" },
      { body: newer },
    ]);
    expect(result?.core.phase).toBe("reviewing");
    expect(result?.core.status).toBe("succeeded");
  });
});
