/**
 * @fileoverview Unit tests for the goals manage endpoint
 * (app/api/kody/goals/[id]/manage/route.ts).
 * @testFramework vitest
 * @domain goals
 *
 * Tests the branch-creation-on-missing logic: when the `kody-state` branch
 * does not exist, the endpoint must create it before writing the goal state
 * file. This was the bug reported in issue #79.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "tester" },
  })),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(() => ({
    owner: "test-owner",
    repo: "test-repo",
    token: "ghp_test-token",
  })),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: vi.fn().mockResolvedValue({
    config: {
      agentActions: { default: "run" },
      state: {
        repo: "https://github.com/test-owner/kody-state",
        path: "test-repo",
      },
    },
    sha: null,
  }),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const auth = await import("@dashboard/lib/auth");
const { getUserOctokit } = auth as any;

import { POST } from "../../app/api/kody/goals/[id]/manage/route";

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

function makeManageRequest(goalId: string, managed: boolean) {
  return new NextRequest(`https://dash.test/api/kody/goals/${goalId}/manage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "test-owner",
      "x-kody-repo": "test-repo",
    },
    body: JSON.stringify({ managed, actorLogin: "tester" }),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------

describe("POST /api/kody/goals/[id]/manage", () => {
  it("writes managed state to the configured Kody state repo", async () => {
    const createRefCalls: unknown[] = [];
    const getRefCalls: unknown[] = [];
    let capturedWriteBranch: string | undefined;
    let capturedWritePath: string | undefined;
    let capturedDispatchInputs: unknown;

    const mockOctokit = {
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
          getContent: vi
            .fn()
            .mockRejectedValueOnce({ status: 404 })
            .mockResolvedValueOnce({
              data: { type: "file", sha: "abc123", content: "" },
            }),
          createOrUpdateFileContents: vi
            .fn()
            .mockImplementation((opts: unknown) => {
              capturedWriteBranch = (opts as { branch?: string }).branch;
              capturedWritePath = (opts as { path?: string }).path;
              return Promise.resolve({ status: 200 });
            }),
        },
        git: {
          getRef: vi.fn().mockImplementation((opts: unknown) => {
            getRefCalls.push(opts);
            const ref = (opts as { ref: string }).ref;
            if (ref === "heads/kody-state") {
              return Promise.reject({ status: 404 });
            }
            return Promise.resolve({
              data: { object: { sha: "main-sha-abc" } },
            });
          }),
          createRef: vi.fn().mockImplementation((opts: unknown) => {
            createRefCalls.push(opts);
            return Promise.resolve({ status: 201 });
          }),
        },
        actions: {
          createWorkflowDispatch: vi
            .fn()
            .mockImplementation((opts: unknown) => {
              capturedDispatchInputs = opts;
              return Promise.resolve({ status: 204 });
            }),
        },
      },
    };

    (mockOctokit as any).repos = mockOctokit.rest.repos;
    vi.mocked(getUserOctokit).mockResolvedValue(mockOctokit as any);

    const req = makeManageRequest("agentResponsibility-migration", true);
    const res = await POST(req, makeParams("agentResponsibility-migration"));

    expect(getRefCalls).toHaveLength(0);
    expect(createRefCalls).toHaveLength(0);
    expect(capturedWriteBranch).toBeUndefined();
    expect(capturedWritePath).toBe(
      "test-repo/goals/instances/agentResponsibility-migration/state.json",
    );

    // The dispatch must pass the goal slug as issue_number so the engine can
    // detect it is a goal (not a GitHub issue number) and read goal state.
    expect(capturedDispatchInputs).toEqual({
      owner: "test-owner",
      repo: "test-repo",
      workflow_id: "kody.yml",
      ref: "main",
      inputs: { issue_number: { value: "agentResponsibility-migration" } },
    });
  });

  it("updates existing managed state without a branch override", async () => {
    const createRefCalls: unknown[] = [];
    let capturedWriteBranch: string | undefined;

    const mockOctokit = {
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
          getContent: vi.fn().mockResolvedValue({
            data: {
              type: "file",
              sha: "existing-sha",
              content: Buffer.from(
                JSON.stringify({
                  version: 1,
                  state: "active",
                  startedAt: "2026-01-01T00:00:00Z",
                  updatedAt: "2026-01-01T00:00:00Z",
                }),
              ).toString("base64"),
              encoding: "base64",
            },
          }),
          createOrUpdateFileContents: vi
            .fn()
            .mockImplementation((opts: unknown) => {
              capturedWriteBranch = (opts as { branch?: string }).branch;
              return Promise.resolve({ status: 200 });
            }),
        },
        git: {
          getRef: vi
            .fn()
            .mockResolvedValue({ data: { object: { sha: "existing-sha" } } }),
          createRef: vi.fn().mockImplementation((opts: unknown) => {
            createRefCalls.push(opts);
            return Promise.resolve({ status: 201 });
          }),
        },
        actions: {
          createWorkflowDispatch: vi.fn().mockResolvedValue({ status: 204 }),
        },
      },
    };

    (mockOctokit as any).repos = mockOctokit.rest.repos;
    vi.mocked(getUserOctokit).mockResolvedValue(mockOctokit as any);

    const req = makeManageRequest("agentResponsibility-migration", false);
    const res = await POST(req, makeParams("agentResponsibility-migration"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state?.managed).toBe(false);
    expect(createRefCalls).toHaveLength(0);
    expect(capturedWriteBranch).toBeUndefined();
  });

  it("returns 409 when trying to unmanage a goal that has no prior state", async () => {
    const mockOctokit = {
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
          getContent: vi.fn().mockRejectedValue({ status: 404 }),
          createOrUpdateFileContents: vi.fn(),
        },
        git: {
          getRef: vi.fn().mockRejectedValue({ status: 404 }),
          createRef: vi.fn(),
        },
      },
    };

    (mockOctokit as any).repos = mockOctokit.rest.repos;
    vi.mocked(getUserOctokit).mockResolvedValue(mockOctokit as any);

    const req = makeManageRequest("brand-new-goal", false);
    const res = await POST(req, makeParams("brand-new-goal"));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("goal_not_started");
  });
});
