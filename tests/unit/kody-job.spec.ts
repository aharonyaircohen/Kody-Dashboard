import { describe, expect, it } from "vitest";
import {
  validateKodyJob,
  resolveJobProfile,
  renderInstantJobComment,
  InvalidKodyJobError,
  type KodyJob,
} from "@dashboard/lib/kody-job";

describe("KodyJob agentResponsibility dispatch boundary", () => {
  it("assembles a agentResponsibility run with an implementation agentAction link", () => {
    const job = validateKodyJob({
      agentAction: "qa-verify", // HOW
      agentResponsibility: "nightly-qa", // WHY (slug)
      agent: "qa-engineer", // WHO
      schedule: "0 3 * * *", // WHEN
      target: 42,
      cliArgs: { pr: 42 },
      flavor: "scheduled",
    });
    expect(job.agentAction).toBe("qa-verify");
    expect(job.agentResponsibility).toBe("nightly-qa");
    expect(job.agent).toBe("qa-engineer");
    expect(job.schedule).toBe("0 3 * * *");
    expect(job.flavor).toBe("scheduled");
  });

  it("requires a agentResponsibility and rejects agentAction-only jobs", () => {
    expect(() => validateKodyJob({ flavor: "instant", cliArgs: {} })).toThrow(
      InvalidKodyJobError,
    );
    expect(() =>
      validateKodyJob({ agentAction: "run", flavor: "instant" }),
    ).toThrow(/agentResponsibility/);
    expect(
      validateKodyJob({ agentResponsibility: "health", flavor: "scheduled" })
        .agentResponsibility,
    ).toBe("health");
  });

  it('rejects an unknown flavor (engine accepts only "instant" | "scheduled")', () => {
    expect(() =>
      validateKodyJob({ agentResponsibility: "run", flavor: "whenever" }),
    ).toThrow(/flavor/);
  });

  it("rejects invalid agentResponsibility slugs", () => {
    expect(() =>
      validateKodyJob({
        agentResponsibility: "Feature Work",
        flavor: "instant",
      }),
    ).toThrow(/agentResponsibility slug/);
  });

  it("defaults cliArgs to an object and rejects a non-object cliArgs", () => {
    expect(
      validateKodyJob({ agentResponsibility: "run", flavor: "instant" })
        .cliArgs,
    ).toEqual({});
    expect(() =>
      validateKodyJob({
        agentResponsibility: "run",
        flavor: "instant",
        cliArgs: 5,
      }),
    ).toThrow(/cliArgs/);
  });

  it("resolves the dispatch profile as the agentResponsibility, not the agentAction", () => {
    expect(
      resolveJobProfile({
        agentAction: "feature",
        agentResponsibility: "x",
        cliArgs: {},
        flavor: "instant",
      }),
    ).toBe("x");
    expect(
      resolveJobProfile({
        agentResponsibility: "nightly-qa",
        cliArgs: {},
        flavor: "scheduled",
      }),
    ).toBe("nightly-qa");
  });

  it("renders an instant job as the @kody dispatch comment", () => {
    const job: KodyJob = {
      agentResponsibility: "research",
      why: "look into the flaky test",
      cliArgs: {},
      flavor: "instant",
    };
    expect(renderInstantJobComment(job)).toBe(
      "@kody research look into the flaky test",
    );
  });
});
