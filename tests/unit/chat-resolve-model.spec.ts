import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getRequestAuth, getUserOctokit } from "@dashboard/lib/auth";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { getSecret } from "@dashboard/lib/vault/get-secret";
import { loadChatModels } from "@dashboard/lib/variables/load-chat-models";
import { resolveChatModel } from "../../app/api/kody/chat/resolve-model";

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((modelName: string) => ({ modelName }))),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() =>
    vi.fn((modelName: string) => ({ modelName })),
  ),
}));

vi.mock("@dashboard/lib/auth", () => ({
  getRequestAuth: vi.fn(),
  getUserOctokit: vi.fn(),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: vi.fn(),
}));

vi.mock("@dashboard/lib/vault/get-secret", () => ({
  getSecret: vi.fn(),
}));

vi.mock("@dashboard/lib/variables/load-chat-models", () => ({
  loadChatModels: vi.fn(),
}));

function request(): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    headers: {
      "x-kody-token": "ghp_test",
      "x-kody-owner": "owner",
      "x-kody-repo": "repo",
    },
  });
}

describe("resolveChatModel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(loadChatModels).mockResolvedValue([]);
    vi.mocked(getRequestAuth).mockReturnValue({
      owner: "owner",
      repo: "repo",
      token: "ghp_test",
    });
    vi.mocked(getUserOctokit).mockResolvedValue({} as never);
    vi.mocked(getSecret).mockResolvedValue("provider-key");
  });

  it("falls back to the repo engine model when LLM_MODELS is empty", async () => {
    vi.mocked(getEngineConfig).mockResolvedValue({
      sha: "abc123",
      config: {
        defaultImplementation: "run",
        agent: { model: "minimax/MiniMax-M3" },
      },
    });

    const result = await resolveChatModel(request());

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "engine:minimax/MiniMax-M3",
      provider: "minimax",
      protocol: "openai",
      baseURL: "https://api.minimax.io/v1",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
    });
    expect(getSecret).toHaveBeenCalledWith("MINIMAX_API_KEY", {
      req: expect.any(NextRequest),
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "minimax",
        apiKey: "provider-key",
        baseURL: "https://api.minimax.io/v1",
        transformRequestBody: expect.any(Function),
      }),
    );
  });

  it("keeps MiniMax M3 for ordinary text turns", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M3",
        label: "MiniMax M3",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M3",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M3", {
      preferVision: false,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel.modelName).toBe("MiniMax-M3");
    expect(result.model).toMatchObject({ modelName: "MiniMax-M3" });
  });

  it("uses MiniMax M3 for image turns when MiniMax M2 is selected", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax M2",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      provider: "minimax",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
    });
    expect(result.model).toMatchObject({ modelName: "MiniMax-M3" });
  });

  it("uses MiniMax M3 for image turns when the MiniMax entry is a custom endpoint", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      provider: "custom",
      baseURL: "https://api.minimax.io/v1",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "custom",
        apiKey: "provider-key",
        baseURL: "https://api.minimax.io/v1",
        transformRequestBody: expect.any(Function),
      }),
    );
  });

  it("prefers a configured MiniMax vision sibling for image turns", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax M2",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
      {
        id: "minimax/MiniMax-M3",
        label: "MiniMax M3",
        provider: "minimax",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M3",
        apiKeySecret: "MINIMAX_M3_API_KEY",
        enabled: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_M3_API_KEY",
    });
    expect(getSecret).toHaveBeenCalledWith("MINIMAX_M3_API_KEY", {
      req: expect.any(NextRequest),
    });
  });

  it("prefers a configured custom MiniMax M3 sibling for image turns", async () => {
    vi.mocked(loadChatModels).mockResolvedValue([
      {
        id: "minimax/MiniMax-M2",
        label: "MiniMax",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M2",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
        default: true,
      },
      {
        id: "minimax/MiniMax-M3",
        label: "MiniMax M3",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
        modelName: "MiniMax-M3",
        apiKeySecret: "MINIMAX_API_KEY",
        enabled: true,
      },
    ]);

    const result = await resolveChatModel(request(), "minimax/MiniMax-M2", {
      preferVision: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.resolvedModel).toMatchObject({
      id: "minimax/MiniMax-M3",
      provider: "custom",
      modelName: "MiniMax-M3",
      apiKeySecret: "MINIMAX_API_KEY",
    });
  });

  it("still returns no_models_configured when no configured or engine model exists", async () => {
    vi.mocked(getEngineConfig).mockResolvedValue({
      sha: "abc123",
      config: { defaultImplementation: "run" },
    });

    const result = await resolveChatModel(request());

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(409);
    await expect(result.error.json()).resolves.toMatchObject({
      error: "no_models_configured",
      fallback: "kody-live",
    });
  });
});
