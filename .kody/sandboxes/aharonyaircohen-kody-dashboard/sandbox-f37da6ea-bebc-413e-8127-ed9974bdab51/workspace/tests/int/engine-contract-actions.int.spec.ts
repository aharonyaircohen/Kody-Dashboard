/**
 * @fileoverview Integration tests for Engine Actions Contract
 * @testFramework vitest
 * @domain engine-contract
 *
 * Tests the EngineAction schema, state machine, and comment parsing.
 */

import { describe, it, expect } from "vitest";
import {
  EngineActionSchema,
  parseActionFromComment,
  parseWorkflowDispatch,
  isValidAction,
  getValidActions,
  getInvalidActions,
  describeAction,
  formatActionAsComment,
  type EngineAction,
} from "@dashboard/contracts/actions";

describe("EngineAction Schema", () => {
  describe("run action", () => {
    it("should validate a run action with command", () => {
      const result = EngineActionSchema.safeParse({
        action: "run",
        command: "impl --fresh",
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.action === "run") {
        expect(result.data.action).toBe("run");
        expect(result.data.command).toBe("impl --fresh");
      }
    });

    it("should reject a run action with empty command", () => {
      const result = EngineActionSchema.safeParse({
        action: "run",
        command: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject run action without command", () => {
      const result = EngineActionSchema.safeParse({ action: "run" });
      expect(result.success).toBe(false);
    });

    it("should reject run action with missing command field", () => {
      const result = EngineActionSchema.safeParse({
        action: "run",
        foo: "bar",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("approve action", () => {
    it("should validate an approve action", () => {
      const result = EngineActionSchema.safeParse({ action: "approve" });
      expect(result.success).toBe(true);
    });

    it("should strip extra fields on approve action (Zod behavior)", () => {
      // Zod's discriminatedUnion strips extra fields
      const result = EngineActionSchema.safeParse({
        action: "approve",
        extra: "field",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data as Record<string, unknown>).not.toHaveProperty(
          "extra",
        );
      }
    });
  });

  describe("reject action", () => {
    it("should validate a reject action", () => {
      const result = EngineActionSchema.safeParse({ action: "reject" });
      expect(result.success).toBe(true);
    });
  });

  describe("rerun action", () => {
    it("should validate a rerun action with no args", () => {
      const result = EngineActionSchema.safeParse({ action: "rerun" });
      expect(result.success).toBe(true);
    });

    it("should validate a rerun action with fromStage", () => {
      const result = EngineActionSchema.safeParse({
        action: "rerun",
        fromStage: "implement",
      });
      expect(result.success).toBe(true);
    });

    it("should validate a rerun action with feedback", () => {
      const result = EngineActionSchema.safeParse({
        action: "rerun",
        feedback: "Fix the tests",
      });
      expect(result.success).toBe(true);
    });

    it("should validate a rerun action with both fromStage and feedback", () => {
      const result = EngineActionSchema.safeParse({
        action: "rerun",
        fromStage: "implement",
        feedback: "Fix the tests",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("abort action", () => {
    it("should validate an abort action", () => {
      const result = EngineActionSchema.safeParse({ action: "abort" });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid actions", () => {
    it("should reject unknown action type", () => {
      const result = EngineActionSchema.safeParse({ action: "unknown" });
      expect(result.success).toBe(false);
    });

    it("should reject action with missing action field", () => {
      const result = EngineActionSchema.safeParse({ command: "test" });
      expect(result.success).toBe(false);
    });

    it("should reject null input", () => {
      const result = EngineActionSchema.safeParse(null);
      expect(result.success).toBe(false);
    });
  });
});

describe("State Machine", () => {
  describe("isValidAction", () => {
    it("should allow run when state is none", () => {
      const action: EngineAction = { action: "run", command: "impl" };
      expect(isValidAction("none", action)).toBe(true);
    });

    it("should allow abort when state is running", () => {
      const action: EngineAction = { action: "abort" };
      expect(isValidAction("running", action)).toBe(true);
    });

    it("should reject approve when state is running", () => {
      const action: EngineAction = { action: "approve" };
      expect(isValidAction("running", action)).toBe(false);
    });

    it("should allow approve when state is paused", () => {
      const action: EngineAction = { action: "approve" };
      expect(isValidAction("paused", action)).toBe(true);
    });

    it("should allow reject when state is paused", () => {
      const action: EngineAction = { action: "reject" };
      expect(isValidAction("paused", action)).toBe(true);
    });

    it("should allow abort when state is paused", () => {
      const action: EngineAction = { action: "abort" };
      expect(isValidAction("paused", action)).toBe(true);
    });

    it("should allow rerun when state is failed", () => {
      const action: EngineAction = { action: "rerun" };
      expect(isValidAction("failed", action)).toBe(true);
    });

    it("should allow run when state is failed", () => {
      const action: EngineAction = { action: "run", command: "impl" };
      expect(isValidAction("failed", action)).toBe(true);
    });

    it("should allow rerun when state is timeout", () => {
      const action: EngineAction = { action: "rerun" };
      expect(isValidAction("timeout", action)).toBe(true);
    });

    it("should allow rerun when state is completed", () => {
      const action: EngineAction = { action: "rerun" };
      expect(isValidAction("completed", action)).toBe(true);
    });

    it("should reject approve when state is completed", () => {
      const action: EngineAction = { action: "approve" };
      expect(isValidAction("completed", action)).toBe(false);
    });
  });

  describe("getValidActions", () => {
    it("should return [run] for none state", () => {
      expect(getValidActions("none")).toEqual(["run"]);
    });

    it("should return [abort] for running state", () => {
      expect(getValidActions("running")).toEqual(["abort"]);
    });

    it("should return [approve, reject, abort] for paused state", () => {
      expect(getValidActions("paused")).toEqual(["approve", "reject", "abort"]);
    });

    it("should return [rerun, run] for failed state", () => {
      expect(getValidActions("failed")).toEqual(["rerun", "run"]);
    });
  });

  describe("getInvalidActions", () => {
    it("should return all actions except run for none state", () => {
      const invalid = getInvalidActions("none");
      expect(invalid).not.toContain("run");
      expect(invalid).toContain("approve");
      expect(invalid).toContain("reject");
      expect(invalid).toContain("rerun");
      expect(invalid).toContain("abort");
    });

    it("should return all actions except abort for running state", () => {
      const invalid = getInvalidActions("running");
      expect(invalid).toContain("run");
      expect(invalid).not.toContain("abort");
    });
  });
});

describe("Comment Parsing", () => {
  describe("parseActionFromComment", () => {
    const engineName = "kody";

    it("should parse @kody run command", () => {
      const result = parseActionFromComment(
        "@kody run impl --fresh",
        engineName,
      );
      expect(result).toEqual({ action: "run", command: "impl --fresh" });
    });

    it("should parse @kody run with no args", () => {
      const result = parseActionFromComment("@kody run", engineName);
      expect(result).toEqual({ action: "run", command: "" });
    });

    it("should parse @kody approve", () => {
      const result = parseActionFromComment("@kody approve", engineName);
      expect(result).toEqual({ action: "approve" });
    });

    it("should parse @kody reject", () => {
      const result = parseActionFromComment("@kody reject", engineName);
      expect(result).toEqual({ action: "reject" });
    });

    it("should parse @kody rerun", () => {
      const result = parseActionFromComment("@kody rerun", engineName);
      expect(result).toEqual({ action: "rerun" });
    });

    it("should parse @kody rerun --fromStage implement", () => {
      const result = parseActionFromComment(
        "@kody rerun --fromStage implement",
        engineName,
      );
      expect(result).toEqual({ action: "rerun", fromStage: "implement" });
    });

    it('should parse @kody rerun --feedback "fix this"', () => {
      const result = parseActionFromComment(
        "@kody rerun --feedback fix this issue",
        engineName,
      );
      expect(result).toEqual({ action: "rerun", feedback: "fix this issue" });
    });

    it("should parse @kody abort", () => {
      const result = parseActionFromComment("@kody abort", engineName);
      expect(result).toEqual({ action: "abort" });
    });

    it("should return null for non-matching comment", () => {
      const result = parseActionFromComment("Hello world", engineName);
      expect(result).toBeNull();
    });

    it("should return null for wrong engine name", () => {
      const result = parseActionFromComment("@otherengine run", engineName);
      expect(result).toBeNull();
    });

    it("should be case-insensitive", () => {
      const result = parseActionFromComment("@KODY RUN impl", engineName);
      expect(result).toEqual({ action: "run", command: "impl" });
    });

    it("should handle leading/trailing whitespace", () => {
      const result = parseActionFromComment("  @kody run impl  ", engineName);
      expect(result).toEqual({ action: "run", command: "impl" });
    });
  });

  describe("parseWorkflowDispatch", () => {
    it("should parse workflow_dispatch inputs with command", () => {
      const result = parseWorkflowDispatch({
        issue_number: 42,
        command: "impl --fresh",
      });
      expect(result).toEqual({ action: "run", command: "impl --fresh" });
    });

    it("should parse workflow_dispatch inputs without command", () => {
      const result = parseWorkflowDispatch({ issue_number: 42 });
      expect(result).toEqual({ action: "run", command: "" });
    });

    it("should handle undefined command", () => {
      const result = parseWorkflowDispatch({
        issue_number: 42,
        command: undefined,
      });
      expect(result).toEqual({ action: "run", command: "" });
    });
  });
});

describe("Action Display Helpers", () => {
  describe("describeAction", () => {
    it("should describe run action", () => {
      expect(describeAction({ action: "run", command: "impl" })).toBe(
        "Run: impl",
      );
    });

    it("should describe run action with empty command", () => {
      expect(describeAction({ action: "run", command: "" })).toBe(
        "Run: (no command)",
      );
    });

    it("should describe approve action", () => {
      expect(describeAction({ action: "approve" })).toBe("Approve");
    });

    it("should describe reject action", () => {
      expect(describeAction({ action: "reject" })).toBe("Reject");
    });

    it("should describe rerun action", () => {
      expect(describeAction({ action: "rerun" })).toBe("Rerun");
    });

    it("should describe rerun action with fromStage", () => {
      expect(describeAction({ action: "rerun", fromStage: "implement" })).toBe(
        "Rerun from implement",
      );
    });

    it("should describe abort action", () => {
      expect(describeAction({ action: "abort" })).toBe("Abort");
    });
  });

  describe("formatActionAsComment", () => {
    const engineName = "kody";

    it("should format run action as comment", () => {
      expect(
        formatActionAsComment({ action: "run", command: "impl" }, engineName),
      ).toBe("@kody run impl");
    });

    it("should format approve action as comment", () => {
      expect(formatActionAsComment({ action: "approve" }, engineName)).toBe(
        "@kody approve",
      );
    });

    it("should format reject action as comment", () => {
      expect(formatActionAsComment({ action: "reject" }, engineName)).toBe(
        "@kody reject",
      );
    });

    it("should format rerun action as comment", () => {
      expect(formatActionAsComment({ action: "rerun" }, engineName)).toBe(
        "@kody rerun",
      );
    });

    it("should format rerun action with fromStage as comment", () => {
      expect(
        formatActionAsComment(
          { action: "rerun", fromStage: "implement" },
          engineName,
        ),
      ).toBe("@kody rerun --fromStage implement");
    });

    it("should format rerun action with feedback as comment", () => {
      expect(
        formatActionAsComment(
          { action: "rerun", feedback: "fix tests" },
          engineName,
        ),
      ).toBe("@kody rerun --feedback fix tests");
    });

    it("should format abort action as comment", () => {
      expect(formatActionAsComment({ action: "abort" }, engineName)).toBe(
        "@kody abort",
      );
    });
  });
});
