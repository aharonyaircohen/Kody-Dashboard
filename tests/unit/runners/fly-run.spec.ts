import { describe, it, expect, vi, beforeEach } from "vitest";

const spawnRunner = vi.fn();
vi.mock("@dashboard/lib/runners/fly", () => ({
  spawnRunner: (...args: unknown[]) => spawnRunner(...args),
}));

import { spawnFlyRunner } from "@dashboard/lib/runners/fly-run";
import type { FlyContext } from "@dashboard/lib/runners/fly-context";

function ctx(over: Partial<FlyContext> = {}): FlyContext {
  return {
    owner: "acme",
    repo: "widgets",
    account: "acme",
    engineModel: undefined,
    githubToken: "ghp_x",
    octokit: {} as FlyContext["octokit"],
    allSecrets: { MINIMAX_API_KEY: "k" },
    flyToken: "fly_tok",
    perfTier: "medium",
    ...over,
  };
}

beforeEach(() => {
  spawnRunner.mockReset();
});

describe("spawnFlyRunner", () => {
  it("spawns a fresh machine with token, secrets, perf tier, and ingest URL", async () => {
    spawnRunner.mockResolvedValue({
      machineId: "m-fresh",
      app: "kody-runner",
      region: "fra",
    });

    const out = await spawnFlyRunner(ctx(), {
      taskId: "s2",
      idleExitMs: 1000,
      hardCapMs: 5000,
      dashboardUrl: "https://dash.test/ingest?token=t",
    });

    expect(out).toEqual({ runner: "fly", machineId: "m-fresh" });
    expect(spawnRunner).toHaveBeenCalledOnce();
    expect(spawnRunner).toHaveBeenCalledWith({
      repo: "acme/widgets",
      githubToken: "ghp_x",
      sessionId: "s2",
      flyToken: "fly_tok",
      perfTier: "medium",
      allSecrets: { MINIMAX_API_KEY: "k" },
      idleExitMs: 1000,
      hardCapMs: 5000,
      dashboardUrl: "https://dash.test/ingest?token=t",
    });
  });

  it("propagates a spawn failure", async () => {
    spawnRunner.mockRejectedValue(new Error("fly api 422"));

    await expect(spawnFlyRunner(ctx(), { taskId: "s3" })).rejects.toThrow(
      "fly api 422",
    );
  });
});
