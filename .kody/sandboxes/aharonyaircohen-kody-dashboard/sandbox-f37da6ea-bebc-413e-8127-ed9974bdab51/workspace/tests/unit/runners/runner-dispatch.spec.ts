import { describe, it, expect, vi } from "vitest";
import { dispatchRun } from "@dashboard/lib/runners/runner-dispatch";
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

const FLY_OK = { runner: "pool" as const, machineId: "m-123" };

describe("dispatchRun", () => {
  it("dispatches to GitHub when healthy and never touches Fly", async () => {
    const dispatchGitHub = vi.fn(async () => {});
    const runFly = vi.fn(async () => FLY_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: true }),
      flyAvailable: true,
      dispatchGitHub,
      runFly,
    });

    expect(out.runner).toBe("github");
    expect(dispatchGitHub).toHaveBeenCalledOnce();
    expect(runFly).not.toHaveBeenCalled();
    expect(out.flyResult).toBeUndefined();
  });

  it("proactively routes to Fly when GitHub is unhealthy and Fly is available", async () => {
    const dispatchGitHub = vi.fn(async () => {});
    const runFly = vi.fn(async () => FLY_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: false, statusDegraded: true }),
      flyAvailable: true,
      dispatchGitHub,
      runFly,
    });

    expect(out.runner).toBe("fly");
    expect(out.flyResult).toEqual(FLY_OK);
    expect(dispatchGitHub).not.toHaveBeenCalled();
    expect(runFly).toHaveBeenCalledOnce();
    expect(out.fellBackOnError).toBeUndefined();
  });

  it("stays on GitHub when unhealthy but no Fly available", async () => {
    const dispatchGitHub = vi.fn(async () => {});
    const runFly = vi.fn(async () => FLY_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: false, queueFull: true }),
      flyAvailable: false,
      dispatchGitHub,
      runFly,
    });

    expect(out.runner).toBe("github");
    expect(dispatchGitHub).toHaveBeenCalledOnce();
    expect(runFly).not.toHaveBeenCalled();
  });

  it("falls back to Fly when the GitHub dispatch THROWS and Fly is available", async () => {
    const dispatchGitHub = vi.fn(async () => {
      throw new Error("HTTP 500: Failed to run workflow dispatch");
    });
    const runFly = vi.fn(async () => FLY_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: true }),
      flyAvailable: true,
      dispatchGitHub,
      runFly,
    });

    expect(out.runner).toBe("fly");
    expect(out.fellBackOnError).toBe(true);
    expect(out.reason).toContain("github dispatch failed");
    expect(out.reason).toContain("HTTP 500");
    expect(dispatchGitHub).toHaveBeenCalledOnce();
    expect(runFly).toHaveBeenCalledOnce();
  });

  it("rethrows when the GitHub dispatch throws and there is no Fly fallback", async () => {
    const dispatchGitHub = vi.fn(async () => {
      throw new Error("boom");
    });
    const runFly = vi.fn(async () => FLY_OK);

    await expect(
      dispatchRun({
        checkHealth: async () => health({ healthy: true }),
        flyAvailable: false,
        dispatchGitHub,
        runFly,
      }),
    ).rejects.toThrow("boom");
    expect(runFly).not.toHaveBeenCalled();
  });
});
