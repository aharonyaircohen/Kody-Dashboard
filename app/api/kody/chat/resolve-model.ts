/**
 * Shared chat-model resolution.
 *
 * Both the streaming chat route (`/api/kody/chat/kody`) and lightweight
 * one-shot routes (e.g. `/api/kody/chat/title`) need the same chain:
 * load the user-managed model list → pick one (explicit id or default) →
 * read its per-model API key from the vault → build a Vercel-AI
 * `LanguageModel` for the right wire protocol.
 *
 * Keeping this in one place means a fix to key/protocol handling lands
 * everywhere at once and the title route can't drift from the chat route.
 */
import { NextRequest, NextResponse } from "next/server";
import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getRequestAuth, getUserOctokit } from "@dashboard/lib/auth";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { getSecret } from "@dashboard/lib/vault/get-secret";
import { loadChatModels } from "@dashboard/lib/variables/load-chat-models";
import {
  PROVIDER_PRESETS,
  pickModelById,
  pickDefaultModel,
  type ChatModel,
  type ProviderPreset,
} from "@dashboard/lib/variables/models";

export type ResolvedChatModel = {
  model: LanguageModel;
  resolvedModel: ChatModel;
  apiKey: string;
};

const ENGINE_PROVIDER_ALIASES: Record<string, ProviderPreset> = {
  anthropic: "anthropic",
  claude: "anthropic",
  google: "google",
  gemini: "google",
  openai: "openai",
  openrouter: "openrouter",
  groq: "groq",
  mistral: "mistral",
  deepseek: "deepseek",
  xai: "xai",
  grok: "xai",
  minimax: "minimax",
};

function chatModelFromEngineSpec(
  modelSpec: string | undefined,
): ChatModel | null {
  const spec = modelSpec?.trim();
  if (!spec) return null;
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return null;
  const providerKey = spec.slice(0, slash).trim().toLowerCase();
  const modelName = spec.slice(slash + 1).trim();
  const provider = ENGINE_PROVIDER_ALIASES[providerKey];
  if (!provider || !modelName) return null;
  const preset = PROVIDER_PRESETS[provider];
  return {
    id: `engine:${spec}`,
    label: `Engine default (${spec})`,
    provider,
    protocol: preset.protocol,
    baseURL: preset.baseURL,
    modelName,
    apiKeySecret: preset.keyHint,
    enabled: true,
    default: true,
    engineDefault: true,
  };
}

async function loadEngineFallbackModel(
  req: NextRequest,
): Promise<ChatModel | null> {
  const auth = getRequestAuth(req);
  if (auth) {
    const octokit = await getUserOctokit(req);
    if (octokit) {
      try {
        const { config } = await getEngineConfig(
          octokit,
          auth.owner,
          auth.repo,
        );
        const model = chatModelFromEngineSpec(config.agent?.model);
        if (model) return model;
      } catch {
        // Keep the visible failure about chat model availability, not a
        // secondary config read problem.
      }
    }
  }

  return (
    chatModelFromEngineSpec(process.env.KODY_CHAT_MODEL) ??
    chatModelFromEngineSpec(process.env.KODY_ENGINE_MODEL) ??
    chatModelFromEngineSpec(process.env.E2E_CHAT_MODEL)
  );
}

/**
 * Resolve a chat model from the request, or return a 409 `NextResponse`
 * describing what's missing (same error envelope the chat route returns,
 * so existing client fallback handling keeps working).
 *
 * `modelId` is an optional client-supplied override; it must match an
 * enabled entry — arbitrary ids from the wire are never trusted.
 */
export async function resolveChatModel(
  req: NextRequest,
  modelId?: string,
): Promise<ResolvedChatModel | { error: NextResponse }> {
  const availableModels = await loadChatModels(req);
  const resolvedModel =
    pickModelById(availableModels, modelId) ??
    pickDefaultModel(availableModels) ??
    (await loadEngineFallbackModel(req));
  if (!resolvedModel) {
    return {
      error: NextResponse.json(
        {
          error: "no_models_configured",
          fallback: "kody-live",
          message:
            "No chat models configured. Add one at /models, or fall back to Kody Live.",
        },
        { status: 409 },
      ),
    };
  }

  const apiKey = await getSecret(resolvedModel.apiKeySecret, { req });
  if (!apiKey) {
    return {
      error: NextResponse.json(
        {
          error: "model_api_key_missing",
          fallback: "kody-live",
          message: `${resolvedModel.apiKeySecret} is not set. Add it under /secrets, or fall back to Kody Live.`,
        },
        { status: 409 },
      ),
    };
  }

  // Pick the SDK by wire protocol. `anthropic` keeps Claude's native
  // features; `openai` covers every OpenAI-compatible endpoint.
  let model: LanguageModel;
  if (resolvedModel.protocol === "anthropic") {
    const anthropic = createAnthropic({
      apiKey,
      ...(resolvedModel.baseURL ? { baseURL: resolvedModel.baseURL } : {}),
    });
    model = anthropic(resolvedModel.modelName);
  } else {
    if (!resolvedModel.baseURL) {
      return {
        error: NextResponse.json(
          {
            error: "model_base_url_missing",
            fallback: "kody-live",
            message: `Model ${resolvedModel.id} has no baseURL. Edit it under /models.`,
          },
          { status: 409 },
        ),
      };
    }
    const openai = createOpenAICompatible({
      name: resolvedModel.provider,
      apiKey,
      baseURL: resolvedModel.baseURL,
    });
    model = openai(resolvedModel.modelName);
  }

  return { model, resolvedModel, apiKey };
}
