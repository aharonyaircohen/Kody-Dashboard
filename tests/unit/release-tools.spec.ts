import { describe, expect, it, vi } from "vitest";

import { createReleaseTools } from "../../app/api/kody/chat/tools/release-tools";

vi.mock("@dashboard/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeOctokit() {
  return {
    rest: {
      issues: {
        create: vi.fn().mockResolvedValue({
          data: {
            number: 42,
            title: "Release request",
            html_url: "https://github.com/acme/app/issues/42",
          },
        }),
        createComment: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
}

describe("request_release tool", () => {
  it("creates a release issue and posts the branch-aware release trigger", async () => {
    const octokit = makeOctokit();
    const tools = createReleaseTools({
      octokit: octokit as never,
      owner: "acme",
      repo: "app",
      actorLogin: "alice",
    }) as unknown as {
      request_release: {
        execute: (input: unknown) => Promise<{
          command: string;
          triggered: boolean;
        }>;
      };
    };

    const result = await tools.request_release.execute({
      bump: "minor",
      prefer: "theirs",
      dryRun: true,
      notes: "Ship the dashboard release.",
    });

    expect(result).toMatchObject({
      command: "@kody release --bump minor --prefer theirs --dry-run",
      triggered: true,
    });
    expect(octokit.rest.issues.create).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      title: "Release request",
      body: expect.stringContaining("Ship the dashboard release."),
      labels: ["release"],
      assignees: ["alice"],
    });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      issue_number: 42,
      body: "@kody release --bump minor --prefer theirs --dry-run",
    });
  });
});
