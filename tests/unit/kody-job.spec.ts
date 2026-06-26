import { describe, expect, it } from "vitest";
import {
  validateKodyJob,
  resolveJobProfile,
  renderInstantJobComment,
  InvalidKodyJobError,
  type KodyJob,
} from "@dashboard/lib/kody-job";

describe("KodyJob capability dispatch boundary", () => {
  it("assembles a capability run", () => {
    const job = validateKodyJob({
      capability: "nightly-qa",
      agent: "qa-engineer", // WHO
      schedule: "0 3 * * *", // WHEN
      target: 42,
      cliArgs: { pr: 42 },
      flavor: "scheduled",
    });
    expect(job.capability).toBe("nightly-qa");
    expect(job.agent).toBe("qa-engineer");
    expect(job.schedule).toBe("0 3 * * *");
    expect(job.flavor).toBe("scheduled");
  });

  it("requires a capability", () => {
    expect(() => validateKodyJob({ flavor: "instant", cliArgs: {} })).toThrow(
      InvalidKodyJobError,
    );
    expect(validateKodyJob({ capability: "health", flavor: "scheduled" }).capability).toBe(
      "health",
    );
  });

  it('rejects an unknown flavor (engine accepts only "instant" | "scheduled")', () => {
    expect(() => validateKodyJob({ capability: "run", flavor: "whenever" })).toThrow(
      /flavor/,
    );
  });

  it("rejects invalid capability slugs", () => {
    expect(() =>
      validateKodyJob({ capability: "Feature Work", flavor: "instant" }),
    ).toThrow(/capability slug/);
  });

  it("defaults cliArgs to an object and rejects a non-object cliArgs", () => {
    expect(validateKodyJob({ capability: "run", flavor: "instant" }).cliArgs).toEqual(
      {},
    );
    expect(() =>
      validateKodyJob({ capability: "run", flavor: "instant", cliArgs: 5 }),
    ).toThrow(/cliArgs/);
  });

  it("resolves the dispatch profile as the capability", () => {
    expect(
      resolveJobProfile({
        capability: "x",
        cliArgs: {},
        flavor: "instant",
      }),
    ).toBe("x");
    expect(
      resolveJobProfile({
        capability: "nightly-qa",
        cliArgs: {},
        flavor: "scheduled",
      }),
    ).toBe("nightly-qa");
  });

  it("renders an instant job as the @kody dispatch comment", () => {
    const job: KodyJob = {
      capability: "research",
      why: "look into the flaky test",
      cliArgs: {},
      flavor: "instant",
    };
    expect(renderInstantJobComment(job)).toBe(
      "@kody research look into the flaky test",
    );
  });
});
