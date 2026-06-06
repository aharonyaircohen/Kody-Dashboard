import { describe, expect, it } from "vitest";
import {
  validateKodyJob,
  resolveJobProfile,
  renderInstantJobComment,
  InvalidKodyJobError,
  type KodyJob,
} from "@dashboard/lib/kody-job";

/**
 * These tests pin the dashboard Job mirror to the engine's `Job` contract
 * (kody2/src/executables/types.ts:457 + kody2/src/job.ts:46). If the engine
 * changes the shape or the validation rules, these break — that's the point.
 */
describe("KodyJob mirrors the engine Job", () => {
  it("assembles the four axes: executable(how) + duty(why) + persona(who) + schedule(when)", () => {
    const job = validateKodyJob({
      executable: "qa-verify", // HOW
      duty: "nightly-qa", // WHY (slug)
      persona: "qa-engineer", // WHO
      schedule: "0 3 * * *", // WHEN
      target: 42,
      cliArgs: { pr: 42 },
      flavor: "scheduled",
    });
    expect(job.executable).toBe("qa-verify");
    expect(job.duty).toBe("nightly-qa");
    expect(job.persona).toBe("qa-engineer");
    expect(job.schedule).toBe("0 3 * * *");
    expect(job.flavor).toBe("scheduled");
  });

  it("requires an executable OR a duty (engine: validateJob)", () => {
    expect(() => validateKodyJob({ flavor: "instant", cliArgs: {} })).toThrow(
      InvalidKodyJobError,
    );
    // either one alone is valid
    expect(
      validateKodyJob({ executable: "run", flavor: "instant" }).executable,
    ).toBe("run");
    expect(validateKodyJob({ duty: "health", flavor: "scheduled" }).duty).toBe(
      "health",
    );
  });

  it('rejects an unknown flavor (engine accepts only "instant" | "scheduled")', () => {
    expect(() =>
      validateKodyJob({ executable: "run", flavor: "whenever" }),
    ).toThrow(/flavor/);
  });

  it("defaults cliArgs to an object and rejects a non-object cliArgs", () => {
    expect(
      validateKodyJob({ executable: "run", flavor: "instant" }).cliArgs,
    ).toEqual({});
    expect(() =>
      validateKodyJob({ executable: "run", flavor: "instant", cliArgs: 5 }),
    ).toThrow(/cliArgs/);
  });

  it("resolves the run profile as executable ?? duty (engine: job.ts)", () => {
    expect(
      resolveJobProfile({
        executable: "feature",
        duty: "x",
        cliArgs: {},
        flavor: "instant",
      }),
    ).toBe("feature");
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
      executable: "research",
      why: "look into the flaky test",
      cliArgs: {},
      flavor: "instant",
    };
    expect(renderInstantJobComment(job)).toBe(
      "@kody research look into the flaky test",
    );
  });
});
