import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@dashboard/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@dashboard/lib/github-client", () => ({
  invalidateIssueCache: vi.fn(),
  invalidatePRCache: vi.fn(),
}));

vi.mock("@dashboard/lib/agent-responsibilities-files", () => ({
  isValidSlug: vi.fn((slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)),
  readAgentResponsibilityFile: vi.fn(),
}));

const agentResponsibilityFiles =
  await import("@dashboard/lib/agent-responsibilities-files");
const { readAgentResponsibilityFile } = agentResponsibilityFiles as unknown as {
  readAgentResponsibilityFile: ReturnType<typeof vi.fn>;
};

const { createKodyTools } =
  await import("../../app/api/kody/chat/tools/kody-tools");

function createCtx({ isPr = false }: { isPr?: boolean } = {}) {
  const createComment = vi.fn().mockResolvedValue({});
  const get = vi.fn().mockResolvedValue({
    data: {
      html_url: "https://github.test/repo/issues/123",
      ...(isPr ? { pull_request: {} } : {}),
    },
  });
  const ctx = {
    owner: "test-owner",
    repo: "test-repo",
    octokit: {
      rest: {
        issues: {
          get,
          createComment,
        },
      },
    },
  } as unknown as Parameters<typeof createKodyTools>[0];
  return { createComment, ctx };
}

function executeOptions<T extends (...args: never[]) => unknown>(
  _execute: T | undefined,
): Parameters<T>[1] {
  return {} as Parameters<T>[1];
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("kody dispatch tools use agentResponsibilities", () => {
  it("refuses to run an issue command when the agentResponsibility folder is missing", async () => {
    const { ctx, createComment } = createCtx();
    readAgentResponsibilityFile.mockResolvedValue(null);

    const tools = createKodyTools(ctx);
    const result = await tools.kody_run_issue.execute?.(
      {
        issueNumber: 123,
        agentResponsibility: "feature",
      },
      executeOptions(tools.kody_run_issue.execute),
    );

    expect(result).toMatchObject({
      error:
        'Refusing to dispatch: agentResponsibility "feature" was not found.',
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("posts the agentResponsibility action for issue dispatch", async () => {
    const { ctx, createComment } = createCtx();
    readAgentResponsibilityFile.mockResolvedValue({
      slug: "feature",
      action: "feature",
      agentAction: "feature",
    });

    const tools = createKodyTools(ctx);
    const result = await tools.kody_run_issue.execute?.(
      {
        issueNumber: 123,
        agentResponsibility: "feature",
        notes: "ship this",
      },
      executeOptions(tools.kody_run_issue.execute),
    );

    expect(result).toMatchObject({
      command: "@kody feature",
      triggered: true,
    });
    expect(readAgentResponsibilityFile).toHaveBeenCalledWith(
      "feature",
      ctx.octokit,
    );
    expect(createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: "@kody feature\n\nship this",
    });
  });

  it("refuses PR dispatch when the command has no agentResponsibility", async () => {
    const { ctx, createComment } = createCtx({ isPr: true });
    readAgentResponsibilityFile.mockResolvedValue(null);

    const tools = createKodyTools(ctx);
    const result = await tools.kody_fix_pr.execute?.(
      { prNumber: 123 },
      executeOptions(tools.kody_fix_pr.execute),
    );

    expect(result).toMatchObject({
      error: 'Refusing to dispatch: agentResponsibility "fix" was not found.',
    });
    expect(createComment).not.toHaveBeenCalled();
  });
});
