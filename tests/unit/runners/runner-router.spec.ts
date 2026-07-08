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
  it("uses github when healthy, even if a server provider is available", () => {
    const d = chooseRunner({
      health: health({ healthy: true }),
      serverAvailable: true,
    });
    expect(d.runner).toBe("github");
    expect(d.reason).toContain("github base");
  });

  it("uses github when healthy and a server provider is not available", () => {
    const d = chooseRunner({
      health: health({ healthy: true }),
      serverAvailable: false,
    });
    expect(d.runner).toBe("github");
  });

  it("falls back to server when status is degraded and a server provider is available", () => {
    const d = chooseRunner({
      health: health({
        healthy: false,
        statusDegraded: true,
        reason: "actions status degraded_performance",
      }),
      serverAvailable: true,
    });
    expect(d.runner).toBe("server");
    expect(d.reason).toContain("server fallback");
    expect(d.reason).toContain("degraded_performance");
  });

  it("falls back to server when the queue is full and a server provider is available", () => {
    const d = chooseRunner({
      health: health({
        healthy: false,
        queueFull: true,
        queuedCount: 25,
        reason: "queue full (25 ≥ 10)",
      }),
      serverAvailable: true,
    });
    expect(d.runner).toBe("server");
  });

  it("stays on github when unhealthy but a server provider is not available", () => {
    const d = chooseRunner({
      health: health({ healthy: false, statusDegraded: true }),
      serverAvailable: false,
    });
    expect(d.runner).toBe("github");
    expect(d.reason).toContain("no server provider");
  });
});
