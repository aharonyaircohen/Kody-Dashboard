import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_viewer",
    owner: "acme",
    repo: "widgets",
    storeRepoUrl: "https://github.com/acme/kody-state",
    storeRef: "main",
  })),
  getUserOctokit: vi.fn(async () => ({ marker: "viewer-octokit" })),
}));

const stateRepo = vi.hoisted(() => ({
  normalizeStatePath: vi.fn((path: string) => {
    const value = path.trim().replace(/^\/+|\/+$/g, "");
    if (value.includes("..")) throw new Error("invalid state path");
    return value;
  }),
  readStateText: vi.fn(),
}));

const githubClient = vi.hoisted(() => ({
  clearGitHubContext: vi.fn(),
  setGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  normalizeStatePath: stateRepo.normalizeStatePath,
  readStateText: stateRepo.readStateText,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  clearGitHubContext: githubClient.clearGitHubContext,
  setGitHubContext: githubClient.setGitHubContext,
}));

import { GET } from "../../app/api/kody/state-files/route";

describe("GET /api/kody/state-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a runtime state evidence file from the configured state repo", async () => {
    stateRepo.readStateText.mockResolvedValue({
      path: "widgets/logs/goals/ci-health/runs/run.jsonl",
      content: '{"event":"done"}\n',
      sha: "abc1234",
      htmlUrl:
        "https://github.com/acme/kody-state/blob/main/widgets/logs/goals/ci-health/runs/run.jsonl",
      size: 17,
    });

    const res = await GET(
      new NextRequest(
        "http://localhost/api/kody/state-files?path=logs/goals/ci-health/runs/run.jsonl",
      ),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      requestedPath: "logs/goals/ci-health/runs/run.jsonl",
      path: "widgets/logs/goals/ci-health/runs/run.jsonl",
      content: '{"event":"done"}\n',
      sha: "abc1234",
    });
    expect(stateRepo.readStateText).toHaveBeenCalledWith(
      { marker: "viewer-octokit" },
      "acme",
      "widgets",
      "logs/goals/ci-health/runs/run.jsonl",
    );
    expect(githubClient.setGitHubContext).toHaveBeenCalledWith(
      "acme",
      "widgets",
      "ghp_viewer",
      "https://github.com/acme/kody-state",
      "main",
    );
    expect(githubClient.clearGitHubContext).toHaveBeenCalled();
  });

  it("rejects unsafe state paths", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/kody/state-files?path=../secret"),
    );

    expect(res.status).toBe(400);
    expect(stateRepo.readStateText).not.toHaveBeenCalled();
  });
});
