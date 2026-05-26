import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the two collaborators the helper orchestrates.
const claimFromPool = vi.fn();
const spawnRunner = vi.fn();
vi.mock("@dashboard/lib/runners/pool-client", () => ({
  claimFromPool: (...args: unknown[]) => claimFromPool(...args),
}));
vi.mock("@dashboard/lib/runners/fly", () => ({
  spawnRunner: (...args: unknown[]) => spawnRunner(...args),
}));

import { claimOrSpawnFly } from "@dashboard/lib/runners/fly-run";
import type { FlyContext } from "@dashboard/lib/runners/fly-context";

function ctx(over: Partial<FlyContext> = {}): FlyContext {
  return {
    owner: "acme",
    repo: "widgets",
    account: "acme",
    engineModel: undefined,
    githubToken: "ghp_x",
    // octokit is unused by claimOrSpawnFly itself.
    octokit: {} as FlyContext["octokit"],
    allSecrets: { MINIMAX_API_KEY: "k" },
    flyToken: "fly_tok",
    perfTier: "medium",
    litellmUrl: "https://litellm.test",
    ...over,
  };
}

beforeEach(() => {
  claimFromPool.mockReset();
  spawnRunner.mockReset();
});

describe("claimOrSpawnFly", () => {
  it("returns the warm-pool machine when the claim succeeds (no spawn)", async () => {
    claimFromPool.mockResolvedValue({ ok: true, machineId: "m-pool" });

    const out = await claimOrSpawnFly(ctx(), { taskId: "s1" });

    expect(out).toEqual({ runner: "pool", machineId: "m-pool" });
    expect(claimFromPool).toHaveBeenCalledOnce();
    expect(spawnRunner).not.toHaveBeenCalled();
    // Claim carries the job identity but no secrets.
    expect(claimFromPool).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "s1",
        repo: "acme/widgets",
        mode: "interactive",
        sessionId: "s1",
      }),
    );
  });

  it("spawns a fresh machine on a pool miss, forwarding token + secrets + perf tier", async () => {
    claimFromPool.mockResolvedValue({ ok: false, reason: "empty pool" });
    spawnRunner.mockResolvedValue({
      machineId: "m-fresh",
      app: "kody-runner",
      region: "fra",
    });

    const out = await claimOrSpawnFly(ctx(), {
      taskId: "s2",
      idleExitMs: 1000,
      hardCapMs: 5000,
      dashboardUrl: "https://dash.test/ingest?token=t",
    });

    expect(out).toEqual({ runner: "fly", machineId: "m-fresh" });
    expect(spawnRunner).toHaveBeenCalledOnce();
    expect(spawnRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "acme/widgets",
        githubToken: "ghp_x",
        sessionId: "s2",
        flyToken: "fly_tok",
        perfTier: "medium",
        allSecrets: { MINIMAX_API_KEY: "k" },
        litellmUrl: "https://litellm.test",
        idleExitMs: 1000,
        hardCapMs: 5000,
        dashboardUrl: "https://dash.test/ingest?token=t",
      }),
    );
  });

  it("propagates a spawn failure (caller surfaces the error)", async () => {
    claimFromPool.mockResolvedValue({ ok: false, reason: "miss" });
    spawnRunner.mockRejectedValue(new Error("fly api 422"));

    await expect(claimOrSpawnFly(ctx(), { taskId: "s3" })).rejects.toThrow(
      "fly api 422",
    );
  });
});
