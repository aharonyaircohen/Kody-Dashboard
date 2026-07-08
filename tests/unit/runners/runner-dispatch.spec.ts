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

const SERVER_OK = { runner: "pool" as const, machineId: "m-123" };

describe("dispatchRun", () => {
  it("dispatches to GitHub when healthy and never touches the server provider", async () => {
    const dispatchGitHub = vi.fn(async () => {});
    const runServer = vi.fn(async () => SERVER_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: true }),
      serverAvailable: true,
      dispatchGitHub,
      runServer,
    });

    expect(out.runner).toBe("github");
    expect(dispatchGitHub).toHaveBeenCalledOnce();
    expect(runServer).not.toHaveBeenCalled();
    expect(out.serverResult).toBeUndefined();
  });

  it("proactively routes to server when GitHub is unhealthy and server is available", async () => {
    const dispatchGitHub = vi.fn(async () => {});
    const runServer = vi.fn(async () => SERVER_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: false, statusDegraded: true }),
      serverAvailable: true,
      dispatchGitHub,
      runServer,
    });

    expect(out.runner).toBe("server");
    expect(out.serverResult).toEqual(SERVER_OK);
    expect(dispatchGitHub).not.toHaveBeenCalled();
    expect(runServer).toHaveBeenCalledOnce();
    expect(out.fellBackOnError).toBeUndefined();
  });

  it("stays on GitHub when unhealthy but no server provider is available", async () => {
    const dispatchGitHub = vi.fn(async () => {});
    const runServer = vi.fn(async () => SERVER_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: false, queueFull: true }),
      serverAvailable: false,
      dispatchGitHub,
      runServer,
    });

    expect(out.runner).toBe("github");
    expect(dispatchGitHub).toHaveBeenCalledOnce();
    expect(runServer).not.toHaveBeenCalled();
  });

  it("falls back to server when the GitHub dispatch throws and server is available", async () => {
    const dispatchGitHub = vi.fn(async () => {
      throw new Error("HTTP 500: Failed to run workflow dispatch");
    });
    const runServer = vi.fn(async () => SERVER_OK);

    const out = await dispatchRun({
      checkHealth: async () => health({ healthy: true }),
      serverAvailable: true,
      dispatchGitHub,
      runServer,
    });

    expect(out.runner).toBe("server");
    expect(out.fellBackOnError).toBe(true);
    expect(out.reason).toContain("github dispatch failed");
    expect(out.reason).toContain("HTTP 500");
    expect(dispatchGitHub).toHaveBeenCalledOnce();
    expect(runServer).toHaveBeenCalledOnce();
  });

  it("rethrows when the GitHub dispatch throws and there is no server fallback", async () => {
    const dispatchGitHub = vi.fn(async () => {
      throw new Error("boom");
    });
    const runServer = vi.fn(async () => SERVER_OK);

    await expect(
      dispatchRun({
        checkHealth: async () => health({ healthy: true }),
        serverAvailable: false,
        dispatchGitHub,
        runServer,
      }),
    ).rejects.toThrow("boom");
    expect(runServer).not.toHaveBeenCalled();
  });
});
