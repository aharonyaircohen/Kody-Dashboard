/**
 * @fileoverview Integration tests for POST /api/kody/vibe/execute — the
 * endpoint that puts a runner on an issue by spawning a fresh Fly Machine.
 * @testFramework vitest
 * @domain vibe
 *
 * The thing under test is the route glue, not the infra: valid input → fresh
 * Fly spawn, spawn error → 500, bad input → 400, missing auth → 401. The Fly
 * spawn and vault-backed Fly context are module-mocked, so nothing real boots.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mock the three external boundaries the route reaches for ────────────────
const spawnRunner = vi.fn();
const resolveFlyContext = vi.fn();

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
        repos: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { default_branch: defaultBranch } }),
        },
      },
      allSecrets: {},
      flyToken: "fly_test",
      perfTier: "shared-1x",
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
    for (const bad of [
      {},
      { issueNumber: 0 },
      { issueNumber: -3 },
      { issueNumber: "x" },
    ]) {
      const res = await vibeExecutePOST(makeRequest(bad));
      expect(res.status).toBe(400);
    }
    // Bailed on validation — never reached a spawn.
    expect(spawnRunner).not.toHaveBeenCalled();
  });

  it("spawns a fresh Fly machine and reports runner=fly", async () => {
    resolveFlyContext.mockResolvedValue(okContext());
    spawnRunner.mockResolvedValue({
      machineId: "fresh-machine-9",
      region: "iad",
    });

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      ok: true,
      issueNumber: 7,
      runner: "fly",
      machineId: "fresh-machine-9",
    });
    expect(spawnRunner).toHaveBeenCalledTimes(1);
  });

  it("passes the repo's actual default branch as the spawn ref (not a hardcoded main)", async () => {
    resolveFlyContext.mockResolvedValue(okContext("develop"));
    spawnRunner.mockResolvedValue({ machineId: "m", region: "iad" });

    await vibeExecutePOST(makeRequest({ issueNumber: 7 }));

    expect(spawnRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "develop",
        repo: "acme/widgets",
        issueNumber: 7,
      }),
    );
  });

  it("tolerates a hung/failing default-branch lookup — still spawns with ref undefined", async () => {
    // The lookup is bounded by an abort signal; on timeout octokit.repos.get
    // rejects. The route must NOT propagate that — it logs and lets the runner
    // fall back to main (ref undefined), so a slow GitHub can't kill the spawn.
    const ctx = okContext();
    ctx.context.octokit.repos.get = vi
      .fn()
      .mockRejectedValue(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
    );
    resolveFlyContext.mockResolvedValue(ctx);
    spawnRunner.mockResolvedValue({ machineId: "m", region: "iad" });

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, runner: "fly" });
    // ref omitted (undefined) → runner uses its hardcoded-main fallback.
    expect(spawnRunner).toHaveBeenCalledWith(
      expect.objectContaining({ ref: undefined }),
    );
  });

  it("returns 500 when the fallback spawn throws (surfaces the real error)", async () => {
    resolveFlyContext.mockResolvedValue(okContext());
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
  });
});
