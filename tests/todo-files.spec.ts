import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  githubClient: {
    getOctokit: vi.fn(() => ({})),
    getOwner: vi.fn(() => "acme"),
    getRepo: vi.fn(() => "widgets"),
  },
  stateRepo: {
    deleteStateFile: vi.fn(),
    listStateDirectory: vi.fn(),
    readStateText: vi.fn(),
    resolveStateRepo: vi.fn(),
    stateRepoPath: vi.fn(),
    writeStateText: vi.fn(),
  },
}));

vi.mock("@dashboard/lib/github-client", () => mocks.githubClient);
vi.mock("@dashboard/lib/state-repo", () => mocks.stateRepo);

import {
  parseTodoFileContent,
  serializeTodoFileContent,
  writeTodoFile,
  type TodoFileContent,
} from "@dashboard/lib/todos/files";

const createdAt = "2026-06-28T00:00:00.000Z";
const updatedAt = "2026-06-28T01:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.githubClient.getOctokit.mockReturnValue({});
  mocks.githubClient.getOwner.mockReturnValue("acme");
  mocks.githubClient.getRepo.mockReturnValue("widgets");
  mocks.stateRepo.resolveStateRepo.mockResolvedValue({
    owner: "acme",
    repo: "kody-state",
    basePath: "widgets",
  });
  mocks.stateRepo.stateRepoPath.mockImplementation(
    (target: { basePath: string }, path: string) =>
      [target.basePath, path].filter(Boolean).join("/"),
  );
});

describe("todo file content", () => {
  it("round-trips one todo list as JSON", () => {
    const description = "## Scope\n\nTrack checkout work.\n\n- verify cart";
    const content: TodoFileContent = {
      title: "Checkout work",
      description,
      createdAt,
      frontmatter: {
        title: "Checkout work",
        createdAt,
        state: "active",
        managed: true,
      },
      items: [
        {
          id: "item-1",
          title: "Verify cart",
          body: "Use the **preview**.",
          assignee: "aguy",
          completed: false,
          createdAt,
          completedAt: null,
          meta: { evidence: "cartVerified", stage: "verify" },
        },
      ],
    };

    const serialized = serializeTodoFileContent(content);
    const parsed = parseTodoFileContent(serialized, "checkout-work", updatedAt);
    const stored = JSON.parse(serialized) as Record<string, unknown>;

    expect(stored).toMatchObject({
      version: 1,
      title: "Checkout work",
      description,
      managed: true,
      state: "active",
    });
    expect(parsed).toMatchObject({
      ...content,
      frontmatter: {
        ...content.frontmatter,
        version: 1,
      },
    });
  });

  it("keeps a described empty list empty instead of creating a legacy item", () => {
    const serialized = serializeTodoFileContent({
      title: "Launch notes",
      description: "**Scope only**",
      createdAt,
      items: [],
    });

    const parsed = parseTodoFileContent(serialized, "launch-notes", updatedAt);

    expect(parsed.description).toBe("**Scope only**");
    expect(parsed.items).toEqual([]);
  });

  it("does not convert old markdown body files into todo items", () => {
    const parsed = parseTodoFileContent(
      [
        "---",
        'title: "Legacy list"',
        `createdAt: "${createdAt}"`,
        "---",
        "",
        "Old markdown body.",
      ].join("\n"),
      "legacy-list",
      updatedAt,
    );

    expect(parsed.description).toBe("");
    expect(parsed.items).toEqual([]);
    expect(parsed.title).toBe("legacy-list");
  });

  it("returns the written todo when a new file cannot be re-read immediately", async () => {
    mocks.stateRepo.readStateText.mockResolvedValueOnce(null);
    mocks.stateRepo.writeStateText.mockResolvedValueOnce({
      sha: "todo-sha",
      path: "widgets/todos/checkout-work.json",
      htmlUrl:
        "https://github.com/acme/kody-state/blob/kody-state/widgets/todos/checkout-work.json",
    });

    const todo = await writeTodoFile({
      octokit: {} as Parameters<typeof writeTodoFile>[0]["octokit"],
      slug: "checkout-work",
      title: "Checkout work",
      description: "Track checkout work.",
      items: [
        {
          id: "item-1",
          title: "Verify cart",
          body: "",
          assignee: null,
          completed: false,
          createdAt,
          completedAt: null,
        },
      ],
      createdAt,
    });

    expect(todo).toMatchObject({
      slug: "checkout-work",
      path: "todos/checkout-work.json",
      title: "Checkout work",
      description: "Track checkout work.",
      sha: "todo-sha",
      htmlUrl:
        "https://github.com/acme/kody-state/blob/kody-state/widgets/todos/checkout-work.json",
      items: [
        {
          id: "item-1",
          title: "Verify cart",
          completed: false,
        },
      ],
    });
    expect(Date.parse(todo.updatedAt)).not.toBeNaN();
    expect(mocks.stateRepo.readStateText).toHaveBeenCalledTimes(1);
  });
});
