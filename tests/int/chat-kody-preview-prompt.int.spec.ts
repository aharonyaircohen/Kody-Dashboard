/**
 * @fileoverview Route-level regression test for preview-context issue creation.
 * @testFramework vitest
 * @domain chat-contract
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const streamTextMock = vi.hoisted(() => vi.fn());
const createUIMessageStreamResponseMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  tool: (definition: unknown) => definition,
  streamText: streamTextMock,
  stepCountIs: vi.fn(() => vi.fn()),
  createUIMessageStream: vi.fn((config: unknown) => config),
  createUIMessageStreamResponse: createUIMessageStreamResponseMock,
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "app",
    storeRepoUrl: undefined,
    storeRef: undefined,
  })),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "alice" } })),
  getUserOctokit: vi.fn(async () => ({})),
}));

vi.mock("@dashboard/lib/github-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@dashboard/lib/github-client")>();
  return {
    ...actual,
    createUserOctokit: vi.fn(() => ({})),
    setGitHubContext: vi.fn(),
    clearGitHubContext: vi.fn(),
  };
});

vi.mock("@dashboard/lib/memory-files", () => ({
  invalidateMemoryIndexPromptCache: vi.fn(),
  loadMemoryIndexForPrompt: vi.fn(async () => null),
  readMemoryFile: vi.fn(async () => null),
  writeMemoryFile: vi.fn(),
}));

vi.mock("@dashboard/lib/instructions/files", () => ({
  loadInstructionsForPrompt: vi.fn(async () => null),
}));

vi.mock("@dashboard/lib/context/files", () => ({
  loadContextForPrompt: vi.fn(async () => null),
}));

vi.mock("../../app/api/kody/chat/resolve-model", () => ({
  resolveChatModel: vi.fn(async () => ({
    model: { modelId: "test-model" },
    apiKey: "test-key",
    resolvedModel: {
      id: "test-model",
      label: "Test model",
      provider: "openai",
      protocol: "openai-compatible",
      baseURL: "https://models.test/v1",
      modelName: "test-model",
      apiKeySecret: "TEST_MODEL_API_KEY",
      enabled: true,
      default: true,
    },
  })),
}));

vi.mock("../../app/api/kody/chat/tools/cms-tools", () => ({
  createCmsTools: vi.fn(async () => ({})),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "app",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/kody/chat/kody preview prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KODY_MASTER_KEY = "kody-direct-test-secret";
    streamTextMock.mockReturnValue({
      toUIMessageStream: vi.fn(() => ({})),
    });
    createUIMessageStreamResponseMock.mockReturnValue(
      new Response("ok", { status: 200 }),
    );
  });

  it("sends preview make-page instructions in the actual model system prompt", async () => {
    const { POST } = await import("../../app/api/kody/chat/kody/route");

    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "make this page" }],
        previewContext:
          "[Preview context]\n- Source path: views/demo-123\n- Preview URL: /api/kody/views/demo-123/index.html",
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const system = streamTextMock.mock.calls[0]?.[0]?.system;
    expect(system).toContain("## Current preview reference");
    expect(system).toContain('"make this page"');
    expect(system).toContain("create a GitHub issue");
    expect(system).toContain("Do not answer with a fresh design direction");
    expect(system).toContain("Source path: views/demo-123");
  });
});
