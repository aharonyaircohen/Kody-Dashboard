/**
 * @fileoverview Route-level coverage for the GitHub→Fly fallback wired into
 * POST /api/kody/chat/interactive/start.
 * @testFramework vitest
 * @domain runners
 *
 * The pure decision logic is unit-tested in runner-dispatch.spec.ts; this
 * proves the ROUTE wires the probe + Fly context + orchestrator together:
 *   - proactive: GitHub Actions unhealthy + Fly available → runs on Fly,
 *     never dispatches the workflow;
 *   - reactive: GitHub healthy but the dispatch call throws + Fly available →
 *     falls back to Fly with fellBackOnError;
 *   - no Fly token → stays on GitHub (dispatches) even when unhealthy.
 *
 * Collaborators (health probe, Fly context, claim/spawn) are mocked at their
 * module seams so the test is deterministic — the real glue under test is the
 * route handler + the dispatchRun orchestrator.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import nock from "nock";
import { NextRequest } from "next/server";

// ── Mock collaborators ───────────────────────────────────────────────────────
const checkGitHubActionsHealth = vi.fn();
const resolveFlyContext = vi.fn();
const claimOrSpawnFly = vi.fn();

vi.mock("@dashboard/lib/runners/github-health", () => ({
  checkGitHubActionsHealth: (...a: unknown[]) => checkGitHubActionsHealth(...a),
  DEFAULT_QUEUE_THRESHOLD: 10,
}));
vi.mock("@dashboard/lib/runners/fly-context", () => ({
  resolveFlyContext: (...a: unknown[]) => resolveFlyContext(...a),
}));
vi.mock("@dashboard/lib/runners/fly-run", () => ({
  claimOrSpawnFly: (...a: unknown[]) => claimOrSpawnFly(...a),
}));

import { POST as startPOST } from "../../app/api/kody/chat/interactive/start/route";

const GITHUB_API = "https://api.github.com";
const REAL_FETCH = globalThis.fetch;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/interactive/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
    body: JSON.stringify(body),
  });
}

/** Mock the session-meta write (GET 404 → PUT 201). */
function nockSessionWrite(sessionId: string): void {
  nock(GITHUB_API)
    .get(
      new RegExp(
        `/repos/acme/widgets/contents/\\.kody.*sessions.*${sessionId}\\.jsonl`,
      ),
    )
    .query(true)
    .reply(404)
    .put(
      new RegExp(
        `/repos/acme/widgets/contents/\\.kody.*sessions.*${sessionId}\\.jsonl`,
      ),
    )
    .reply(201, { content: { sha: "newsha" } });
}

const flyContext = {
  owner: "acme",
  repo: "widgets",
  account: "acme",
  engineModel: undefined,
  githubToken: "ghp_test",
  octokit: {},
  allSecrets: {},
  flyToken: "fly_tok",
  perfTier: undefined,
  litellmUrl: undefined,
};

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "fly-fallback-test-secret";
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  globalThis.fetch = REAL_FETCH;
});

afterEach(() => {
  nock.cleanAll();
  checkGitHubActionsHealth.mockReset();
  resolveFlyContext.mockReset();
  claimOrSpawnFly.mockReset();
});

describe("POST /interactive/start — GitHub→Fly fallback", () => {
  it("proactively runs on Fly when GitHub Actions is degraded (no workflow dispatch)", async () => {
    nockSessionWrite("sess-proactive");
    checkGitHubActionsHealth.mockResolvedValue({
      healthy: false,
      statusDegraded: true,
      queuedCount: 0,
      queueFull: false,
      reason: "actions status degraded_performance",
    });
    resolveFlyContext.mockResolvedValue({ ok: true, context: flyContext });
    claimOrSpawnFly.mockResolvedValue({ runner: "pool", machineId: "m-warm" });

    const res = await startPOST(makeRequest({ taskId: "sess-proactive" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.runner).toBe("fly");
    expect(json.machineId).toBe("m-warm");
    expect(claimOrSpawnFly).toHaveBeenCalledOnce();
    expect(json.target.workflow).toBe("fly");
    // No nock for the dispatch endpoint — if the route had tried to dispatch,
    // disableNetConnect would have thrown and failed the test.
  });

  it("reactively falls back to Fly when the workflow dispatch throws", async () => {
    nockSessionWrite("sess-reactive");
    checkGitHubActionsHealth.mockResolvedValue({
      healthy: true,
      statusDegraded: false,
      queuedCount: 1,
      queueFull: false,
      reason: "healthy",
    });
    resolveFlyContext.mockResolvedValue({ ok: true, context: flyContext });
    claimOrSpawnFly.mockResolvedValue({ runner: "fly", machineId: "m-fresh" });
    // GitHub healthy → route attempts the dispatch; make it 500.
    nock(GITHUB_API)
      .post(/\/repos\/acme\/widgets\/actions\/workflows\/kody\.yml\/dispatches/)
      .reply(500, { message: "Failed to run workflow dispatch" });

    const res = await startPOST(makeRequest({ taskId: "sess-reactive" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.runner).toBe("fly");
    expect(json.fellBackOnError).toBe(true);
    expect(json.machineId).toBe("m-fresh");
    expect(claimOrSpawnFly).toHaveBeenCalledOnce();
  });

  it("stays on GitHub when unhealthy but no Fly token is configured", async () => {
    nockSessionWrite("sess-nofly");
    checkGitHubActionsHealth.mockResolvedValue({
      healthy: false,
      statusDegraded: true,
      queuedCount: 0,
      queueFull: false,
      reason: "actions status major_outage",
    });
    // Fly context resolves but without a token → flyAvailable false.
    resolveFlyContext.mockResolvedValue({
      ok: true,
      context: { ...flyContext, flyToken: undefined },
    });
    const dispatch = nock(GITHUB_API)
      .post(/\/repos\/acme\/widgets\/actions\/workflows\/kody\.yml\/dispatches/)
      .reply(204);

    const res = await startPOST(makeRequest({ taskId: "sess-nofly" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.runner).toBe("github");
    expect(claimOrSpawnFly).not.toHaveBeenCalled();
    expect(dispatch.isDone()).toBe(true);
  });
});
