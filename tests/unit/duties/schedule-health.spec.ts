/**
 * Unit tests for duty schedule-health interpretation. Pure function, no I/O.
 */
import { describe, it, expect } from "vitest";
import {
  dutyScheduleHealth,
  summarizeDutyHealth,
  type DutyHealthInput,
} from "@dashboard/lib/duties/schedule-health";

const NOW = Date.parse("2026-05-22T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

function duty(over: Partial<DutyHealthInput>): DutyHealthInput {
  return {
    schedule: "1h",
    lastTickAt: ago(30 * MIN),
    nextEligibleAt: ahead(30 * MIN),
    disabled: false,
    updatedAt: ago(10 * HOUR),
    ...over,
  };
}

describe("dutyScheduleHealth", () => {
  it("reports disabled and manual as descriptive (not problems)", () => {
    expect(dutyScheduleHealth(duty({ disabled: true }), NOW)).toBe("disabled");
    expect(dutyScheduleHealth(duty({ schedule: "manual" }), NOW)).toBe("manual");
  });

  it("is ok when the next-eligible time is still in the future", () => {
    expect(dutyScheduleHealth(duty({ nextEligibleAt: ahead(20 * MIN) }), NOW)).toBe(
      "ok",
    );
  });

  it("is ok within the cron grace window after next-eligible passes", () => {
    expect(dutyScheduleHealth(duty({ nextEligibleAt: ago(10 * MIN) }), NOW)).toBe(
      "ok",
    );
  });

  it("flags overdue once next-eligible passed beyond the grace window", () => {
    expect(dutyScheduleHealth(duty({ nextEligibleAt: ago(45 * MIN) }), NOW)).toBe(
      "overdue",
    );
  });

  it("flags never-run for an old scheduled duty with no state file", () => {
    expect(
      dutyScheduleHealth(
        duty({ lastTickAt: null, nextEligibleAt: null, updatedAt: ago(5 * HOUR) }),
        NOW,
      ),
    ).toBe("never");
  });

  it("does not flag a freshly-created duty that hasn't ticked yet", () => {
    expect(
      dutyScheduleHealth(
        duty({ lastTickAt: null, nextEligibleAt: null, updatedAt: ago(2 * MIN) }),
        NOW,
      ),
    ).toBe("ok");
  });

  it("uses the 15m cron cadence when schedule is null (every wake)", () => {
    // 40m old, never ticked, no explicit cadence → past 15m+grace → never.
    expect(
      dutyScheduleHealth(
        duty({ schedule: null, lastTickAt: null, nextEligibleAt: null, updatedAt: ago(40 * MIN) }),
        NOW,
      ),
    ).toBe("never");
  });
});

describe("summarizeDutyHealth", () => {
  it("counts overdue and never-run across a list", () => {
    const list = [
      duty({}), // ok
      duty({ nextEligibleAt: ago(60 * MIN) }), // overdue
      duty({ nextEligibleAt: ago(90 * MIN) }), // overdue
      duty({ lastTickAt: null, nextEligibleAt: null, updatedAt: ago(8 * HOUR) }), // never
      duty({ disabled: true }), // disabled (ignored)
    ];
    expect(summarizeDutyHealth(list, NOW)).toEqual({ overdue: 2, never: 1 });
  });
});
