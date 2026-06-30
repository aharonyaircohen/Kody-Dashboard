/**
 * @fileoverview Unit tests for the goals manage endpoint
 * (app/api/kody/goals/[id]/manage/route.ts).
 * @testFramework vitest
 * @domain goals
 *
 * Tests the current state-repo write path used by managed goals.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { STATE_BRANCH } from "@dashboard/lib/state-branch";

const h = vi.hoisted(() => ({
  runScheduledKodyOnRunner: vi.fn(async () => ({
    ok: true,
    runner: "fly",
    machineId: "m-goal",
    ref: "main",
  })),
}));

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
      executables: { default: "run" },
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

vi.mock("@dashboard/lib/runners/kody-runner", () => ({
  runScheduledKodyOnRunner: h.runScheduledKodyOnRunner,
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

function managedGoalTodoContent(overrides: Record<string, unknown> = {}) {
  return [
    "---",
    'title: "capability-migration"',
    'createdAt: "2026-01-01T00:00:00.000Z"',
    "managed: true",
    'managedModel: "agentGoal"',
    "version: 1",
    'state: "active"',
    'type: "improve"',
    'evidence: "[]"',
    'capabilities: "[]"',
    'route: "[]"',
    'facts: "{}"',
    'blockers: "[]"',
    ...Object.entries(overrides).map(
      ([key, value]) => `${key}: ${JSON.stringify(value)}`,
    ),
    "---",
    "",
    "Migrate capability state.",
    "",
    "<!-- kody-todo-items-json",
    "[]",
    "-->",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------

describe("POST /api/kody/goals/[id]/manage", () => {
  it("writes managed state to the configured Kody state repo", async () => {
    const createRefCalls: unknown[] = [];
    const getRefCalls: unknown[] = [];
    let capturedWriteBranch: string | undefined;
    let capturedWritePath: string | undefined;

    const mockOctokit = {
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
          getContent: vi.fn().mockRejectedValue({ status: 404 }),
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
            return Promise.resolve({
              data: { object: { sha: "main-sha-abc" } },
            });
          }),
          createRef: vi.fn().mockImplementation((opts: unknown) => {
            createRefCalls.push(opts);
            return Promise.resolve({ status: 201 });
          }),
        },
        actions: {},
      },
    };

    (mockOctokit as any).repos = mockOctokit.rest.repos;
    (mockOctokit as any).git = mockOctokit.rest.git;
    vi.mocked(getUserOctokit).mockResolvedValue(mockOctokit as any);

    const req = makeManageRequest("capability-migration", true);
    const res = await POST(req, makeParams("capability-migration"));

    expect(res.status).toBe(200);
    expect(getRefCalls).toHaveLength(1);
    expect(createRefCalls).toHaveLength(0);
    expect(capturedWriteBranch).toBe(STATE_BRANCH);
    expect(capturedWritePath).toBe("test-repo/todos/capability-migration.md");

    // The dispatch must pass the goal as the explicit target, not as an issue.
    expect(h.runScheduledKodyOnRunner).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        runRequest: expect.objectContaining({
          target: { type: "goal", id: "capability-migration" },
          intent: "manage",
        }),
      }),
    );
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
                managedGoalTodoContent({
                  startedAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
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
        actions: {},
      },
    };

    (mockOctokit as any).repos = mockOctokit.rest.repos;
    (mockOctokit as any).git = mockOctokit.rest.git;
    vi.mocked(getUserOctokit).mockResolvedValue(mockOctokit as any);

    const req = makeManageRequest("capability-migration", false);
    const res = await POST(req, makeParams("capability-migration"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state?.managed).toBe(false);
    expect(createRefCalls).toHaveLength(0);
    expect(capturedWriteBranch).toBe(STATE_BRANCH);
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
    (mockOctokit as any).git = mockOctokit.rest.git;
    vi.mocked(getUserOctokit).mockResolvedValue(mockOctokit as any);

    const req = makeManageRequest("brand-new-goal", false);
    const res = await POST(req, makeParams("brand-new-goal"));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("goal_not_started");
  });
});
