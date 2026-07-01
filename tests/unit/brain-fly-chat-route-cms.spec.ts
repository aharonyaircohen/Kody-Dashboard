import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireKodyAuth = vi.fn();
const getRequestAuth = vi.fn();
const resolveFlyContext = vi.fn();
const readBrainApp = vi.fn();
const readBrainImage = vi.fn();
const writeBrainApp = vi.fn();
const provisionBrain = vi.fn();
const waitForBrainHealth = vi.fn();
const streamBrainChat = vi.fn();
const loadContextForPrompt = vi.fn();

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: (...args: unknown[]) => requireKodyAuth(...args),
  getRequestAuth: (...args: unknown[]) => getRequestAuth(...args),
}));

vi.mock("@dashboard/lib/runners/fly-context", () => ({
  resolveFlyContext: (...args: unknown[]) => resolveFlyContext(...args),
}));

vi.mock("@dashboard/lib/brain/store", () => ({
  readBrainApp: (...args: unknown[]) => readBrainApp(...args),
  readBrainImage: (...args: unknown[]) => readBrainImage(...args),
  writeBrainApp: (...args: unknown[]) => writeBrainApp(...args),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/runners/brain-fly", () => ({
  brainAppName: (account: string) => `kody-brain-${account}`,
  provisionBrain: (...args: unknown[]) => provisionBrain(...args),
  waitForBrainHealth: (...args: unknown[]) => waitForBrainHealth(...args),
}));

vi.mock("@dashboard/lib/brain-proxy", () => ({
  streamBrainChat: (...args: unknown[]) => streamBrainChat(...args),
}));

vi.mock("@dashboard/lib/context/files", () => ({
  loadContextForPrompt: (...args: unknown[]) => loadContextForPrompt(...args),
}));

import { POST } from "../../app/api/kody/chat/brain-fly/route";

const ctx = {
  owner: "acme",
  repo: "widgets",
  account: "alice",
  engineModel: "anthropic/claude-haiku-4-5",
  githubToken: "ghp_ctx_token",
  octokit: {},
  storeRepoUrl: "https://github.com/acme/kody-store",
  storeRef: "stable",
  allSecrets: {},
  flyToken: "fly-token",
  perfTier: undefined,
};

function request(body: unknown): NextRequest {
  return new NextRequest(
    "https://dashboard.example.test/api/kody/chat/brain-fly",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://dashboard.example.test",
      },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  requireKodyAuth.mockResolvedValue(null);
  getRequestAuth.mockReturnValue(null);
  resolveFlyContext.mockResolvedValue({ ok: true, context: ctx });
  readBrainApp.mockResolvedValue(null);
  readBrainImage.mockResolvedValue(null);
  writeBrainApp.mockResolvedValue(undefined);
  provisionBrain.mockResolvedValue({
    url: "https://brain.example.test",
    apiKey: "brain-key",
    app: "brain-app",
    org: "personal",
  });
  waitForBrainHealth.mockResolvedValue(undefined);
  streamBrainChat.mockResolvedValue(new Response("ok", { status: 200 }));
  loadContextForPrompt.mockResolvedValue(null);
});

describe("POST /api/kody/chat/brain-fly CMS context", () => {
  it("uses resolveFlyContext repo and token for Brain CMS even when getRequestAuth is unavailable later", async () => {
    const res = await POST(request({ chatId: "c1", message: "show course" }));

    expect(res.status).toBe(200);
    expect(streamBrainChat).toHaveBeenCalledOnce();
    expect(streamBrainChat.mock.calls[0]![0]).toMatchObject({
      repoScope: {
        type: "repo",
        owner: "acme",
        repo: "widgets",
        repoSlug: "acme/widgets",
        key: "acme/widgets",
        storeRepoUrl: "https://github.com/acme/kody-store",
        storeRef: "stable",
      },
      repoToken: "ghp_ctx_token",
      dashboardUrl: "https://dashboard.example.test",
    });
    expect(streamBrainChat.mock.calls[0]![0]).not.toHaveProperty("repo");
    expect(streamBrainChat.mock.calls[0]![0]).not.toHaveProperty(
      "storeRepoUrl",
    );
    expect(streamBrainChat.mock.calls[0]![0]).not.toHaveProperty("storeRef");
  });
});
