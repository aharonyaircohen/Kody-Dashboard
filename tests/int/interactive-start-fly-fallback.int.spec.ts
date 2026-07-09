/**
 * @fileoverview Route-level coverage for the GitHub-to-server fallback wired into
 * POST /api/kody/chat/interactive/start.
 * @testFramework vitest
 * @domain runners
 *
 * The pure decision logic is unit-tested in runner-dispatch.spec.ts; this
 * proves the ROUTE wires the probe + server context + orchestrator together:
 *   - proactive: GitHub Actions unhealthy + server available → runs on server,
 *     never dispatches the workflow;
 *   - reactive: GitHub healthy but the dispatch call throws + server available
 *     → falls back to server with fellBackOnError;
 *   - no server provider → stays on GitHub (dispatches) even when unhealthy.
 *
 * Collaborators (health probe, server context, claim/spawn) are mocked at their
 * module seams so the test is deterministic — the real glue under test is the
 * route handler + the dispatchRun orchestrator.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import nock from "nock";
import { NextRequest } from "next/server";
import { STATE_BRANCH } from "@dashboard/lib/state-branch";

// ── Mock collaborators ───────────────────────────────────────────────────────
const checkGitHubActionsHealth = vi.fn();
const resolveServerContext = vi.fn();
const isServerProviderAvailable = vi.fn();
const claimOrRunServer = vi.fn();

vi.mock("@dashboard/lib/runners/github-health", () => ({
  checkGitHubActionsHealth: (...a: unknown[]) => checkGitHubActionsHealth(...a),
  DEFAULT_QUEUE_THRESHOLD: 10,
}));
vi.mock("@dashboard/lib/runners/server-run", () => ({
  resolveServerContext: (...a: unknown[]) => resolveServerContext(...a),
  isServerProviderAvailable: (...a: unknown[]) =>
    isServerProviderAvailable(...a),
  claimOrRunServer: (...a: unknown[]) => claimOrRunServer(...a),
}));

import { POST as startPOST } from "../../app/api/kody/chat/interactive/start/route";

const GITHUB_API = "https://api.github.com";
const REAL_FETCH = globalThis.fetch;

function mockRepoConfig404(): void {
  nock(GITHUB_API)
    .get("/repos/acme/widgets/contents/kody.config.json")
    .reply(404);
}

function sessionPath(sessionId: string): string {
  return `/repos/acme/kody-state/contents/widgets%2Fsessions%2F${sessionId}.jsonl`;
}

function mockStateBranch(): void {
  nock(GITHUB_API)
    .get(`/repos/acme/kody-state/git/ref/heads%2F${STATE_BRANCH}`)
    .reply(200, { object: { sha: "state-sha" } });
}

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
    .get(sessionPath(sessionId))
    .query({ ref: STATE_BRANCH })
    .reply(404);
  mockStateBranch();
  nock(GITHUB_API)
    .put(sessionPath(sessionId))
    .reply(201, { content: { sha: "newsha" } });
}

const serverContext = {
  owner: "acme",
  repo: "widgets",
  account: "acme",
  engineModel: undefined,
  githubToken: "ghp_test",
  octokit: {},
  allSecrets: {},
  perfTier: undefined,
};

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "fly-fallback-test-secret";
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  globalThis.fetch = REAL_FETCH;
});

beforeEach(() => {
  mockRepoConfig404();
});

afterEach(() => {
  nock.cleanAll();
  checkGitHubActionsHealth.mockReset();
  resolveServerContext.mockReset();
  isServerProviderAvailable.mockReset();
  claimOrRunServer.mockReset();
});

describe("POST /interactive/start — GitHub-to-server fallback", () => {
  it("proactively runs on server when GitHub Actions is degraded (no workflow dispatch)", async () => {
    nockSessionWrite("sess-proactive");
    checkGitHubActionsHealth.mockResolvedValue({
      healthy: false,
      statusDegraded: true,
      queuedCount: 0,
      queueFull: false,
      reason: "actions status degraded_performance",
    });
    resolveServerContext.mockResolvedValue({
      ok: true,
      context: serverContext,
    });
    isServerProviderAvailable.mockReturnValue(true);
    claimOrRunServer.mockResolvedValue({ runner: "pool", machineId: "m-warm" });

    const res = await startPOST(makeRequest({ taskId: "sess-proactive" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.runner).toBe("server");
    expect(json.machineId).toBe("m-warm");
    expect(claimOrRunServer).toHaveBeenCalledOnce();
    expect(json.target.workflow).toBe("server");
    // No nock for the dispatch endpoint — if the route had tried to dispatch,
    // disableNetConnect would have thrown and failed the test.
  });

  it("reactively falls back to server when the workflow dispatch throws", async () => {
    nockSessionWrite("sess-reactive");
    checkGitHubActionsHealth.mockResolvedValue({
      healthy: true,
      statusDegraded: false,
      queuedCount: 1,
      queueFull: false,
      reason: "healthy",
    });
    resolveServerContext.mockResolvedValue({
      ok: true,
      context: serverContext,
    });
    isServerProviderAvailable.mockReturnValue(true);
    claimOrRunServer.mockResolvedValue({ runner: "fly", machineId: "m-fresh" });
    // GitHub healthy → route attempts the dispatch; make it 500.
    nock(GITHUB_API)
      .post(/\/repos\/acme\/widgets\/actions\/workflows\/kody\.yml\/dispatches/)
      .reply(500, { message: "Failed to run workflow dispatch" });

    const res = await startPOST(makeRequest({ taskId: "sess-reactive" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.runner).toBe("server");
    expect(json.fellBackOnError).toBe(true);
    expect(json.machineId).toBe("m-fresh");
    expect(claimOrRunServer).toHaveBeenCalledOnce();
  });

  it("stays on GitHub when unhealthy but no server provider is available", async () => {
    nockSessionWrite("sess-nofly");
    checkGitHubActionsHealth.mockResolvedValue({
      healthy: false,
      statusDegraded: true,
      queuedCount: 0,
      queueFull: false,
      reason: "actions status major_outage",
    });
    resolveServerContext.mockResolvedValue({
      ok: true,
      context: serverContext,
    });
    isServerProviderAvailable.mockReturnValue(false);
    const dispatch = nock(GITHUB_API)
      .post(/\/repos\/acme\/widgets\/actions\/workflows\/kody\.yml\/dispatches/)
      .reply(204);

    const res = await startPOST(makeRequest({ taskId: "sess-nofly" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.runner).toBe("github");
    expect(claimOrRunServer).not.toHaveBeenCalled();
    expect(dispatch.isDone()).toBe(true);
  });
});
