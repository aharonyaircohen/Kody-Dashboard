/** @fileoverview Unit tests for managed goal GitHub file helpers. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
  listStateDirectory: vi.fn(),
  deleteStateFile: vi.fn(),
}));

const companyStore = vi.hoisted(() => ({
  companyStoreAssetPath: vi.fn(async (_octokit, _kind, ...segments: string[]) =>
    ["goals", ...segments].join("/"),
  ),
  listCompanyStoreDirectorySafe: vi.fn(
    async (
      ..._args: unknown[]
    ): Promise<Array<{ name: string; type: string }>> => [],
  ),
  readCompanyStoreText: vi.fn(
    async (..._args: unknown[]): Promise<string | null> => null,
  ),
}));

vi.mock("../../src/dashboard/lib/state-repo", () => stateRepo);
vi.mock("../../src/dashboard/lib/company-store/assets", () => companyStore);

import {
  deleteManagedGoalFile,
  listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile,
  writeManagedGoalFile,
} from "../../src/dashboard/lib/managed-goals-files";
import type { ManagedGoalState } from "../../src/dashboard/lib/managed-goals";
import { parseTodoFileContent } from "../../src/dashboard/lib/todos/files";

const baseState: ManagedGoalState = {
  version: 1,
  state: "active",
  type: "improve",
  destination: {
    outcome: "Goal creation works.",
    evidence: ["planReady"],
  },
  capabilities: ["plan"],
  route: [
    {
      stage: "plan",
      evidence: "planReady",
      capability: "plan",
    },
  ],
  facts: {},
  blockers: [],
};

const regularTodo = `${JSON.stringify(
  {
    version: 1,
    title: "Regular list",
    description: "",
    createdAt: "2026-06-28T00:00:00.000Z",
    items: [
      {
        id: "item-1",
        title: "Keep this todo",
        body: "",
        assignee: null,
        completed: false,
        createdAt: "2026-06-28T00:00:00.000Z",
        completedAt: null,
      },
    ],
  },
  null,
  2,
)}\n`;

describe("managed goal todo-backed files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    companyStore.companyStoreAssetPath.mockImplementation(
      async (_octokit, _kind, ...segments: string[]) =>
        ["goals", ...segments].join("/"),
    );
    companyStore.listCompanyStoreDirectorySafe.mockResolvedValue([]);
    companyStore.readCompanyStoreText.mockResolvedValue(null);
  });

  it("returns null when no managed goal todo file exists", async () => {
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/goal-creation-works.json") return null;
        return null;
      },
    );

    const file = await readManagedGoalFile(
      "goal-creation-works",
      {} as never,
      "test-owner",
      "test-repo",
    );

    expect(file).toBeNull();
    expect(stateRepo.readStateText).toHaveBeenCalledTimes(1);
  });

  it("writes a managed goal to a JSON todo file", async () => {
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/goal-creation-works.json") return null;
        return null;
      },
    );
    stateRepo.writeStateText.mockResolvedValue({ sha: "new-sha" });

    await writeManagedGoalFile({
      octokit: {} as never,
      owner: "test-owner",
      repo: "test-repo",
      id: "goal-creation-works",
      state: { ...baseState, facts: { planReady: true } },
    });

    expect(stateRepo.writeStateText).toHaveBeenCalledTimes(1);
    const write = stateRepo.writeStateText.mock.calls[0]![0];
    expect(write).toMatchObject({
      path: "todos/goal-creation-works.json",
      sha: undefined,
    });
    const parsed = parseTodoFileContent(
      write.content,
      "goal-creation-works",
      "2026-06-28T00:00:00.000Z",
    );
    expect(parsed.description).toBe("Goal creation works.");
    expect(parsed.frontmatter).toMatchObject({
      managed: true,
      managedModel: "agentGoal",
      state: "active",
      type: "improve",
    });
    expect(parsed.items).toMatchObject([
      {
        id: "planReady",
        completed: true,
        meta: {
          evidence: "planReady",
          stage: "plan",
          capability: "plan",
        },
      },
    ]);
  });

  it("does not treat a regular todo list as a managed goal", async () => {
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/todo-list-1.json") {
          return { path, sha: "todo-sha", content: regularTodo };
        }
        return null;
      },
    );

    const file = await readManagedGoalFile(
      "todo-list-1",
      {} as never,
      "test-owner",
      "test-repo",
    );

    expect(file).toBeNull();
    expect(stateRepo.readStateText).toHaveBeenCalledTimes(1);
  });

  it("does not delete a regular todo list through managed goal deletion", async () => {
    stateRepo.readStateText.mockResolvedValue({
      path: "todos/todo-list-1.json",
      sha: "todo-sha",
      content: regularTodo,
    });

    await deleteManagedGoalFile({
      octokit: {} as never,
      owner: "test-owner",
      repo: "test-repo",
      id: "todo-list-1",
    });

    expect(stateRepo.deleteStateFile).not.toHaveBeenCalled();
  });

  it("does not overwrite a regular todo list when writing a managed goal", async () => {
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/todo-list-1.json") {
          return { path, sha: "todo-sha", content: regularTodo };
        }
        return null;
      },
    );

    await expect(
      writeManagedGoalFile({
        octokit: {} as never,
        owner: "test-owner",
        repo: "test-repo",
        id: "todo-list-1",
        state: baseState,
      }),
    ).rejects.toThrow("Cannot overwrite regular todo list todo-list-1");
    expect(stateRepo.writeStateText).not.toHaveBeenCalled();
  });

  it("keeps user-edited todo item details when runtime updates state", async () => {
    const existingTodo = `${JSON.stringify(
      {
        version: 1,
        title: "goal-creation-works",
        description: "Goal creation works.",
        createdAt: "2026-06-28T00:00:00.000Z",
        managed: true,
        managedModel: "agentGoal",
        state: "active",
        type: "improve",
        evidence: ["planReady"],
        capabilities: ["plan"],
        route: [
          {
            stage: "plan",
            evidence: "planReady",
            capability: "plan",
          },
        ],
        facts: {},
        blockers: [],
        items: [
          {
            id: "planReady",
            title: "Write the plan",
            body: "User edited details.",
            assignee: "aguy",
            completed: false,
            createdAt: "2026-06-28T00:00:00.000Z",
            completedAt: null,
            meta: {
              note: "keep me",
              evidence: "planReady",
              stage: "plan",
              capability: "plan",
            },
          },
        ],
      },
      null,
      2,
    )}\n`;
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/goal-creation-works.json") {
          return { path, sha: "todo-sha", content: existingTodo };
        }
        return null;
      },
    );
    stateRepo.writeStateText.mockResolvedValue({ sha: "new-sha" });

    await writeManagedGoalFile({
      octokit: {} as never,
      owner: "test-owner",
      repo: "test-repo",
      id: "goal-creation-works",
      state: { ...baseState, facts: { planReady: true } },
    });

    const write = stateRepo.writeStateText.mock.calls[0]![0];
    expect(write).toMatchObject({
      path: "todos/goal-creation-works.json",
      sha: "todo-sha",
    });
    const parsed = parseTodoFileContent(
      write.content,
      "goal-creation-works",
      "2026-06-28T00:00:00.000Z",
    );
    expect(parsed.items[0]).toMatchObject({
      id: "planReady",
      title: "Write the plan",
      body: "User edited details.",
      assignee: "aguy",
      completed: true,
      meta: {
        note: "keep me",
        evidence: "planReady",
        stage: "plan",
        capability: "plan",
      },
    });
  });

  it("lists Store goal templates from the current goals/templates layout", async () => {
    companyStore.listCompanyStoreDirectorySafe.mockImplementation(
      async (...args: unknown[]) => {
        const path = String(args[1] ?? "");
        return path === "goals/templates"
          ? [{ name: "prs-stay-mergeable", type: "dir" }]
          : [];
      },
    );
    companyStore.readCompanyStoreText.mockImplementation(
      async (...args: unknown[]) => {
        const path = String(args[1] ?? "");
        return path === "goals/templates/prs-stay-mergeable/state.json"
          ? JSON.stringify({
              version: 1,
              kind: "template",
              state: "inactive",
              type: "maintain",
              scheduleMode: "agentLoop",
              schedule: "15m",
              destination: {
                outcome: "PRs stay mergeable.",
                evidence: ["pr-health-triage"],
              },
              capabilities: ["pr-health-triage"],
              route: [],
              facts: {},
              blockers: [],
            })
          : null;
      },
    );

    const goals = await listCompanyStoreGoalTemplateFiles({} as never);

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      id: "prs-stay-mergeable",
      path: "goals/templates/prs-stay-mergeable/state.json",
      source: "store",
      recordType: "template",
      state: {
        schedule: "15m",
        scheduleMode: "agentLoop",
      },
    });
  });

  it("overlays Store template fields onto runtime goal state", async () => {
    const existingTodo = `${JSON.stringify(
      {
        version: 1,
        title: "prs-stay-mergeable",
        description: "Old copied outcome.",
        createdAt: "2026-06-28T00:00:00.000Z",
        managed: true,
        managedModel: "agentLoop",
        state: "active",
        type: "maintain",
        sourceTemplate: "prs-stay-mergeable",
        schedule: "manual",
        scheduleMode: "agentLoop",
        evidence: ["old-evidence"],
        capabilities: ["old-capability"],
        route: [],
        facts: { "old-evidence": false },
        blockers: [],
        items: [
          {
            id: "old-evidence",
            title: "Old evidence",
            body: "",
            assignee: null,
            completed: false,
            createdAt: "2026-06-28T00:00:00.000Z",
            completedAt: null,
          },
        ],
      },
      null,
      2,
    )}\n`;
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/prs-stay-mergeable.json") {
          return { path, sha: "todo-sha", content: existingTodo };
        }
        return null;
      },
    );
    companyStore.listCompanyStoreDirectorySafe.mockImplementation(
      async (...args: unknown[]) => {
        const path = String(args[1] ?? "");
        return path === "goals/templates"
          ? [{ name: "prs-stay-mergeable", type: "dir" }]
          : [];
      },
    );
    companyStore.readCompanyStoreText.mockImplementation(
      async (...args: unknown[]) => {
        const path = String(args[1] ?? "");
        return path === "goals/templates/prs-stay-mergeable/state.json"
          ? JSON.stringify({
              version: 1,
              kind: "template",
              state: "inactive",
              type: "maintain",
              scheduleMode: "agentLoop",
              schedule: "15m",
              destination: {
                outcome: "Pull requests stay mergeable.",
                evidence: ["pr-health-triage"],
              },
              capabilities: ["pr-health-triage"],
              route: [],
              facts: {},
              blockers: [],
            })
          : null;
      },
    );

    const file = await readManagedGoalFile(
      "prs-stay-mergeable",
      {} as never,
      "test-owner",
      "test-repo",
    );

    expect(file?.state).toMatchObject({
      state: "active",
      sourceTemplate: "prs-stay-mergeable",
      schedule: "15m",
      scheduleMode: "agentLoop",
      destination: {
        outcome: "Pull requests stay mergeable.",
        evidence: ["pr-health-triage"],
      },
      capabilities: ["pr-health-triage"],
    });
  });
});
