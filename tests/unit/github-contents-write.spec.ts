import { describe, expect, it, vi } from "vitest";
import {
  updateGitHubFileWithRetry,
  writeGitHubFileWithRetry,
} from "@dashboard/lib/github-contents-write";

function encode(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

function decode(content: unknown): string {
  return Buffer.from(content as string, "base64").toString("utf-8");
}

function contentResponse(content: string, sha: string) {
  return {
    data: {
      content: encode(content),
      sha,
      html_url: `https://github.test/${sha}`,
    },
  };
}

function staleShaError() {
  return Object.assign(
    new Error(
      "file.txt does not match sha-old - https://docs.github.com/rest/repos/contents#create-or-update-file-contents",
    ),
    { status: 409 },
  );
}

describe("github contents write helpers", () => {
  it("retries a fixed-content write with the latest sha", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const repos = {
      getContent: vi.fn().mockResolvedValue(contentResponse("latest", "sha-2")),
      createOrUpdateFileContents: vi
        .fn()
        .mockImplementationOnce(async (params: Record<string, unknown>) => {
          writes.push(params);
          throw staleShaError();
        })
        .mockImplementationOnce(async (params: Record<string, unknown>) => {
          writes.push(params);
          return {
            data: { content: { sha: "blob-2" }, commit: { sha: "commit-2" } },
          };
        }),
    };

    const result = await writeGitHubFileWithRetry(
      { rest: { repos } },
      {
        owner: "o",
        repo: "r",
        path: "file.txt",
        message: "save",
        content: encode("wanted"),
        sha: "sha-1",
      },
    );

    expect(result).toEqual({
      sha: "blob-2",
      commitSha: "commit-2",
      htmlUrl: null,
    });
    expect(repos.getContent).toHaveBeenCalledTimes(1);
    expect(writes.map((write) => write.sha)).toEqual(["sha-1", "sha-2"]);
    expect(decode(writes[1]?.content)).toBe("wanted");
  });

  it("reapplies update mutations to the latest file after a stale sha", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const repos = {
      getContent: vi
        .fn()
        .mockResolvedValueOnce(contentResponse("a\n", "sha-1"))
        .mockResolvedValueOnce(contentResponse("a\nb\n", "sha-2")),
      createOrUpdateFileContents: vi
        .fn()
        .mockImplementationOnce(async (params: Record<string, unknown>) => {
          writes.push(params);
          throw staleShaError();
        })
        .mockImplementationOnce(async (params: Record<string, unknown>) => {
          writes.push(params);
          return {
            data: { content: { sha: "blob-2" }, commit: { sha: "commit-2" } },
          };
        }),
    };

    const result = await updateGitHubFileWithRetry(
      { repos },
      {
        owner: "o",
        repo: "r",
        path: "file.txt",
        message: "append",
        maxAttempts: 2,
        mutate: (current) => {
          const content = current?.contentBase64
            ? decode(current.contentBase64)
            : "";
          return { content: encode(`${content}mine\n`) };
        },
      },
    );

    expect(result.written).toBe(true);
    expect(writes.map((write) => write.sha)).toEqual(["sha-1", "sha-2"]);
    expect(decode(writes[1]?.content)).toBe("a\nb\nmine\n");
  });
});
