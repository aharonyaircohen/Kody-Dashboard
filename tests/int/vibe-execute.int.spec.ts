/**
 * @fileoverview Integration tests for POST /api/kody/vibe/execute — the
 * endpoint that puts a runner on an issue. It tries the warm pool first and
 * falls back to spawning a fresh Fly Machine on any miss.
 * @testFramework vitest
 * @domain vibe
 *
 * The thing under test is the DECISION logic, not the infra: pool-hit →
 * `runner: "pool"`, pool-miss → spawn → `runner: "fly"`, spawn error → 500,
 * bad input → 400, missing auth → 401. The pool client, the Fly spawn, and
 * the vault-backed Fly context are all module-mocked, so nothing real boots —
 * exactly per the brief ("don't care if it actually creates servers"). The
 * pool being an accelerator and never a hard dependency is the load-bearing
 * invariant here.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mock the three external boundaries the route reaches for ────────────────
const claimFromPool = vi.fn();
const spawnRunner = vi.fn();
const resolveFlyContext = vi.fn();

vi.mock("@dashboard/lib/runners/pool-client", () => ({
  claimFromPool: (...args: unknown[]) => claimFromPool(...args),
}));
vi.mock("@dashboard/lib/runners/fly", () => ({
  spawnRunner: (...args: unknown[]) => spawnRunner(...args),
}));
vi.mock("@dashboard/lib/runners/fly-context", () => ({
  resolveFlyContext: (...args: unknown[]) => resolveFlyContext(...args),
}));

// Import AFTER the mocks are registered.
import { POST as vibeExecutePOST } from "../../app/api/kody/vibe/execute/route";

const AUTH_HEADERS = {
  "content-type": "application/json",
  "x-kody-token": "ghp_test",
  "x-kody-owner": "acme",
  "x-kody-repo": "widgets",
};

function makeRequest(
  body: unknown,
  headers: Record<string, string> = AUTH_HEADERS,
): NextRequest {
  return new NextRequest("https://dash.test/api/kody/vibe/execute", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** A Fly context whose octokit.repos.get reports the repo's default branch. */
function okContext(defaultBranch = "main") {
  return {
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      githubToken: "ghp_test",
      octokit: {
        repos: { get: vi.fn().mockResolvedValue({ data: { default_branch: defaultBranch } }) },
      },
      allSecrets: {},
      flyToken: "fly_test",
      perfTier: "shared-1x",
      litellmUrl: "https://kody-litellm.fly.dev",
    },
  };
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "vibe-execute-test-secret";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/kody/vibe/execute", () => {
  it("returns 401 when no auth header and no env token is present", async () => {
    const prev = process.env.KODY_BOT_TOKEN;
    delete process.env.KODY_BOT_TOKEN;
    const req = new NextRequest("https://dash.test/api/kody/vibe/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueNumber: 1 }),
    });
    const res = await vibeExecutePOST(req);
    expect(res.status).toBe(401);
    if (prev) process.env.KODY_BOT_TOKEN = prev;
  });

  it("returns 400 when issueNumber is missing or non-positive", async () => {
    resolveFlyContext.mockResolvedValue(okContext());
    for (const bad of [{}, { issueNumber: 0 }, { issueNumber: -3 }, { issueNumber: "x" }]) {
      const res = await vibeExecutePOST(makeRequest(bad));
      expect(res.status).toBe(400);
    }
    // Bailed on validation — never reached the pool or a spawn.
    expect(claimFromPool).not.toHaveBeenCalled();
    expect(spawnRunner).not.toHaveBeenCalled();
  });

  it("claims a warm-pool machine when available and reports runner=pool", async () => {
    resolveFlyContext.mockResolvedValue(okContext());
    claimFromPool.mockResolvedValue({ ok: true, machineId: "pool-machine-1" });

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 42 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      ok: true,
      issueNumber: 42,
      runner: "pool",
      machineId: "pool-machine-1",
    });
    expect(String(data.sessionId)).toMatch(/^vibe-issue-42-\d+$/);
    // Pool hit ⇒ we must NOT have paid for a fresh spawn.
    expect(spawnRunner).not.toHaveBeenCalled();
  });

  it("falls back to a fresh Fly spawn on pool miss and reports runner=fly", async () => {
    resolveFlyContext.mockResolvedValue(okContext());
    claimFromPool.mockResolvedValue({ ok: false, reason: "empty-pool" });
    spawnRunner.mockResolvedValue({ machineId: "fresh-machine-9", region: "iad" });

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      ok: true,
      issueNumber: 7,
      runner: "fly",
      machineId: "fresh-machine-9",
    });
    expect(claimFromPool).toHaveBeenCalledTimes(1);
    expect(spawnRunner).toHaveBeenCalledTimes(1);
  });

  it("passes the repo's actual default branch as the spawn ref (not a hardcoded main)", async () => {
    resolveFlyContext.mockResolvedValue(okContext("develop"));
    claimFromPool.mockResolvedValue({ ok: false, reason: "miss" });
    spawnRunner.mockResolvedValue({ machineId: "m", region: "iad" });

    await vibeExecutePOST(makeRequest({ issueNumber: 7 }));

    expect(claimFromPool).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "develop", repo: "acme/widgets" }),
    );
    expect(spawnRunner).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "develop", repo: "acme/widgets", issueNumber: 7 }),
    );
  });

  it("returns 500 when the fallback spawn throws (surfaces the real error)", async () => {
    resolveFlyContext.mockResolvedValue(okContext());
    claimFromPool.mockResolvedValue({ ok: false, reason: "miss" });
    spawnRunner.mockRejectedValue(new Error("Fly capacity exhausted"));

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(String(data.error)).toMatch(/Fly capacity exhausted/);
  });

  it("propagates the Fly-context error status when the vault/token isn't configured", async () => {
    resolveFlyContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: "FLY_API_TOKEN not configured for this repo",
    });

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error)).toMatch(/FLY_API_TOKEN/);
    expect(claimFromPool).not.toHaveBeenCalled();
  });
});
