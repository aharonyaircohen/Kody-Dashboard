import { describe, expect, it } from "vitest";

import { parseAgencyBoundaryEvalsFromText } from "../../src/dashboard/lib/activity/run-logs";

describe("run log agency boundary parsing", () => {
  it("extracts agency boundary eval markers from GitHub log text", () => {
    const text = [
      "2026-07-03T17:58:00Z setup",
      'run KODY_AGENCY_BOUNDARY_EVAL={"version":1,"status":"pass","capability":"ai-agency-health-matrix","capabilityKind":"observe","findings":[{"rule":"observe-does-not-act","status":"pass","message":"observe capability reported facts without action output","evidence":{"resultCount":0}}]}',
    ].join("\n");

    expect(parseAgencyBoundaryEvalsFromText(text)).toEqual([
      {
        version: 1,
        status: "pass",
        capability: "ai-agency-health-matrix",
        capabilityKind: "observe",
        findings: [
          {
            rule: "observe-does-not-act",
            status: "pass",
            message: "observe capability reported facts without action output",
            evidence: { resultCount: 0 },
          },
        ],
      },
    ]);
  });
});
