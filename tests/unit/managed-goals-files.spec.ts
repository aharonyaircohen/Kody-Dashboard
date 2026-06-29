/** @fileoverview Unit tests for managed goal GitHub file helpers. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
  listStateDirectory: vi.fn(),
  deleteStateFile: vi.fn(),
}));

vi.mock("../../src/dashboard/lib/state-repo", () => stateRepo);

import {
  deleteManagedGoalFile,
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

const regularTodo = [
  "---",
  'title: "Regular list"',
  'createdAt: "2026-06-28T00:00:00.000Z"',
  "---",
  "",
  "<!-- kody-todo-items-json",
  JSON.stringify(
    [
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
    null,
    2,
  ),
  "-->",
  "",
].join("\n");

describe("managed goal todo-backed files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes legacy JSON when no todo file exists", async () => {
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/goal-creation-works.md") return null;
        if (path === "goals/instances/goal-creation-works/state.json") {
          return {
            path,
            sha: "goal-sha",
            content: JSON.stringify({ ...baseState, capabilities: null }),
          };
        }
        return null;
      },
    );

    const file = await readManagedGoalFile(
      "goal-creation-works",
      {} as never,
      "test-owner",
      "test-repo",
    );

    expect(file).toMatchObject({
      sha: "goal-sha",
      path: "goals/instances/goal-creation-works/state.json",
      source: "legacy",
    });
    expect(file?.state.capabilities).toEqual(["plan"]);
  });

  it("migrates legacy JSON to a todo file on write", async () => {
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/goal-creation-works.md") return null;
        if (path === "goals/instances/goal-creation-works/state.json") {
          return {
            path,
            sha: "legacy-sha",
            content: JSON.stringify(baseState),
          };
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

    expect(stateRepo.writeStateText).toHaveBeenCalledTimes(1);
    const write = stateRepo.writeStateText.mock.calls[0]![0];
    expect(write).toMatchObject({
      path: "todos/goal-creation-works.md",
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
        if (path === "todos/todo-list-1.md") {
          return { path, sha: "todo-sha", content: regularTodo };
        }
        if (path === "goals/instances/todo-list-1/state.json") {
          return {
            path,
            sha: "legacy-sha",
            content: JSON.stringify(baseState),
          };
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
      path: "todos/todo-list-1.md",
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
        if (path === "todos/todo-list-1.md") {
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
    const existingTodo = [
      "---",
      'title: "goal-creation-works"',
      'createdAt: "2026-06-28T00:00:00.000Z"',
      "managed: true",
      'managedModel: "agentGoal"',
      'state: "active"',
      'type: "improve"',
      'evidence: "[\\"planReady\\"]"',
      'capabilities: "[\\"plan\\"]"',
      'route: "[{\\"stage\\":\\"plan\\",\\"evidence\\":\\"planReady\\",\\"capability\\":\\"plan\\"}]"',
      "---",
      "",
      "Goal creation works.",
      "",
      "<!-- kody-todo-items-json",
      JSON.stringify(
        [
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
        null,
        2,
      ),
      "-->",
      "",
    ].join("\n");
    stateRepo.readStateText.mockImplementation(
      async (_octokit, _owner, _repo, path: string) => {
        if (path === "todos/goal-creation-works.md") {
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
      path: "todos/goal-creation-works.md",
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
});
