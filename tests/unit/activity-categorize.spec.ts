/**
 * Tests for the pure run categorizer — the honest "what kind of engine
 * activity is this" bucketing (scheduled jobs/workers vs @kody command vs
 * Run-now dispatch vs manual). Subcommand-level (fix/fix-ci/ui-review) is
 * deliberately NOT inferred here — see categorize.ts.
 */
import { describe, expect, it } from "vitest";
import { categorizeRun } from "@dashboard/lib/activity/categorize";

describe("categorizeRun", () => {
  it("schedule → scheduled (job/worker ticks)", () => {
    expect(categorizeRun("schedule", "kody")).toBe("scheduled");
  });

  it("workflow_dispatch → manual", () => {
    expect(categorizeRun("workflow_dispatch", "anything")).toBe("manual");
  });

  it("issue_comment on the Kody control issue → dispatch (Run now)", () => {
    expect(categorizeRun("issue_comment", "Kody control")).toBe("dispatch");
  });

  it("issue_comment on a real issue → command (@kody …)", () => {
    expect(categorizeRun("issue_comment", "[P2] Fix the thing")).toBe(
      "command",
    );
  });

  it("unknown / push / empty → other", () => {
    expect(categorizeRun("push", "x")).toBe("other");
    expect(categorizeRun(undefined, undefined)).toBe("other");
    expect(categorizeRun("", "")).toBe("other");
  });
});
