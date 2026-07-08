/**
 * @fileoverview Integration tests for POST /api/kody/vibe/execute — the
 * endpoint that puts a runner on an issue through the installed server
 * provider.
 * @testFramework vitest
 * @domain vibe
 *
 * The thing under test is the route logic, not the infra: provider returns
 * `runner: "pool"` or `runner: "fly"`, provider error → 500, bad input → 400,
 * missing auth → 401. The server provider boundary is module-mocked, so
 * nothing real boots.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const resolveServerContext = vi.fn();
const claimOrRunServer = vi.fn();

vi.mock("@dashboard/lib/runners/server-run", () => ({
  resolveServerContext: (...args: unknown[]) => resolveServerContext(...args),
  claimOrRunServer: (...args: unknown[]) => claimOrRunServer(...args),
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

/** A server context whose octokit.repos.get reports the repo's default branch. */
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
    resolveServerContext.mockResolvedValue(okContext());
    for (const bad of [
      {},
      { issueNumber: 0 },
      { issueNumber: -3 },
      { issueNumber: "x" },
    ]) {
      const res = await vibeExecutePOST(makeRequest(bad));
      expect(res.status).toBe(400);
    }
    // Bailed on validation — never reached the server provider.
    expect(claimOrRunServer).not.toHaveBeenCalled();
  });

  it("claims a warm-pool machine when available and reports runner=pool", async () => {
    resolveServerContext.mockResolvedValue(okContext());
    claimOrRunServer.mockResolvedValue({
      runner: "pool",
      machineId: "pool-machine-1",
    });

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
    expect(claimOrRunServer).toHaveBeenCalledTimes(1);
  });

  it("reports runner=fly when the installed provider starts a fresh machine", async () => {
    resolveServerContext.mockResolvedValue(okContext());
    claimOrRunServer.mockResolvedValue({
      runner: "fly",
      machineId: "fresh-machine-9",
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
    expect(claimOrRunServer).toHaveBeenCalledTimes(1);
  });

  it("passes the repo's actual default branch as the provider ref (not a hardcoded main)", async () => {
    const ctx = okContext("develop");
    resolveServerContext.mockResolvedValue(ctx);
    claimOrRunServer.mockResolvedValue({ runner: "fly", machineId: "m" });

    await vibeExecutePOST(makeRequest({ issueNumber: 7 }));

    expect(claimOrRunServer).toHaveBeenCalledWith(
      ctx.context,
      expect.objectContaining({
        ref: "develop",
        runRequest: expect.objectContaining({
          target: { type: "issue", id: 7 },
          intent: "run",
          source: "dashboard",
        }),
      }),
    );
  });

  it("tolerates a hung/failing default-branch lookup — still spawns with ref undefined", async () => {
    // The lookup is bounded by an abort signal; on timeout octokit.repos.get
    // rejects. The route must NOT propagate that — it logs and lets the server
    // provider use its default ref, so a slow GitHub can't kill the run.
    const ctx = okContext();
    ctx.context.octokit.repos.get = vi
      .fn()
      .mockRejectedValue(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      );
    resolveServerContext.mockResolvedValue(ctx);
    claimOrRunServer.mockResolvedValue({ runner: "fly", machineId: "m" });

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, runner: "fly" });
    // ref omitted (undefined) -> provider uses its own fallback.
    expect(claimOrRunServer).toHaveBeenCalledWith(
      ctx.context,
      expect.objectContaining({ ref: undefined }),
    );
  });

  it("returns 500 when the server provider throws (surfaces the real error)", async () => {
    resolveServerContext.mockResolvedValue(okContext());
    claimOrRunServer.mockRejectedValue(new Error("Fly capacity exhausted"));

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(String(data.error)).toMatch(/Fly capacity exhausted/);
  });

  it("propagates the server-context error status when the provider is not configured", async () => {
    resolveServerContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: "server provider not configured for this repo",
    });

    const res = await vibeExecutePOST(makeRequest({ issueNumber: 7 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error)).toMatch(/server provider/);
    expect(claimOrRunServer).not.toHaveBeenCalled();
  });
});
