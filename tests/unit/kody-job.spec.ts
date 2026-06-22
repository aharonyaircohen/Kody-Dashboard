import { describe, expect, it } from "vitest";
import {
  validateKodyJob,
  resolveJobProfile,
  renderInstantJobComment,
  InvalidKodyJobError,
  type KodyJob,
} from "@dashboard/lib/kody-job";

describe("KodyJob duty dispatch boundary", () => {
  it("assembles a duty run with an implementation executable link", () => {
    const job = validateKodyJob({
      executable: "qa-verify", // HOW
      duty: "nightly-qa", // WHY (slug)
      agent: "qa-engineer", // WHO
      schedule: "0 3 * * *", // WHEN
      target: 42,
      cliArgs: { pr: 42 },
      flavor: "scheduled",
    });
    expect(job.executable).toBe("qa-verify");
    expect(job.duty).toBe("nightly-qa");
    expect(job.agent).toBe("qa-engineer");
    expect(job.schedule).toBe("0 3 * * *");
    expect(job.flavor).toBe("scheduled");
  });

  it("requires a duty and rejects executable-only jobs", () => {
    expect(() => validateKodyJob({ flavor: "instant", cliArgs: {} })).toThrow(
      InvalidKodyJobError,
    );
    expect(() =>
      validateKodyJob({ executable: "run", flavor: "instant" }),
    ).toThrow(/duty/);
    expect(validateKodyJob({ duty: "health", flavor: "scheduled" }).duty).toBe(
      "health",
    );
  });

  it('rejects an unknown flavor (engine accepts only "instant" | "scheduled")', () => {
    expect(() => validateKodyJob({ duty: "run", flavor: "whenever" })).toThrow(
      /flavor/,
    );
  });

  it("rejects invalid duty slugs", () => {
    expect(() =>
      validateKodyJob({ duty: "Feature Work", flavor: "instant" }),
    ).toThrow(/duty slug/);
  });

  it("defaults cliArgs to an object and rejects a non-object cliArgs", () => {
    expect(validateKodyJob({ duty: "run", flavor: "instant" }).cliArgs).toEqual(
      {},
    );
    expect(() =>
      validateKodyJob({ duty: "run", flavor: "instant", cliArgs: 5 }),
    ).toThrow(/cliArgs/);
  });

  it("resolves the dispatch profile as the duty, not the executable", () => {
    expect(
      resolveJobProfile({
        executable: "feature",
        duty: "x",
        cliArgs: {},
        flavor: "instant",
      }),
    ).toBe("x");
    expect(
      resolveJobProfile({
        duty: "nightly-qa",
        cliArgs: {},
        flavor: "scheduled",
      }),
    ).toBe("nightly-qa");
  });

  it("renders an instant job as the @kody dispatch comment", () => {
    const job: KodyJob = {
      duty: "research",
      why: "look into the flaky test",
      cliArgs: {},
      flavor: "instant",
    };
    expect(renderInstantJobComment(job)).toBe(
      "@kody research look into the flaky test",
    );
  });
});
