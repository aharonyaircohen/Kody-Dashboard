import { describe, it, expect } from "vitest";
import { chooseRunner } from "@dashboard/lib/runners/runner-router";
import type { GitHubActionsHealth } from "@dashboard/lib/runners/github-health";

function health(over: Partial<GitHubActionsHealth>): GitHubActionsHealth {
  return {
    healthy: true,
    statusDegraded: false,
    queuedCount: 0,
    queueFull: false,
    reason: "test",
    ...over,
  };
}

describe("chooseRunner", () => {
  it("uses github when healthy, even if Fly is available", () => {
    const d = chooseRunner({
      health: health({ healthy: true }),
      flyAvailable: true,
    });
    expect(d.runner).toBe("github");
    expect(d.reason).toContain("github base");
  });

  it("uses github when healthy and Fly is not available", () => {
    const d = chooseRunner({
      health: health({ healthy: true }),
      flyAvailable: false,
    });
    expect(d.runner).toBe("github");
  });

  it("falls back to Fly when status is degraded and Fly is available", () => {
    const d = chooseRunner({
      health: health({
        healthy: false,
        statusDegraded: true,
        reason: "actions status degraded_performance",
      }),
      flyAvailable: true,
    });
    expect(d.runner).toBe("fly");
    expect(d.reason).toContain("fly fallback");
    expect(d.reason).toContain("degraded_performance");
  });

  it("falls back to Fly when the queue is full and Fly is available", () => {
    const d = chooseRunner({
      health: health({
        healthy: false,
        queueFull: true,
        queuedCount: 25,
        reason: "queue full (25 ≥ 10)",
      }),
      flyAvailable: true,
    });
    expect(d.runner).toBe("fly");
  });

  it("stays on github when unhealthy but Fly is NOT available (nowhere else to go)", () => {
    const d = chooseRunner({
      health: health({ healthy: false, statusDegraded: true }),
      flyAvailable: false,
    });
    expect(d.runner).toBe("github");
    expect(d.reason).toContain("no fly token");
  });
});
