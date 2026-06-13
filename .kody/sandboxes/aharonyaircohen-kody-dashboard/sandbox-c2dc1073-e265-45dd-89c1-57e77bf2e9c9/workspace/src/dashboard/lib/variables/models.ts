/**
 * @fileType utility
 * @domain variables
 * @pattern model-list
 * @ai-summary Typed accessor for the LLM_MODELS variable. Each entry binds
 *   a model to its own API key + endpoint, routed through one of two
 *   protocols: Anthropic Messages API (`@ai-sdk/anthropic`, full Claude
 *   features incl. prompt caching) or OpenAI Chat Completions
 *   (`@ai-sdk/openai-compatible`, covers everyone else — Gemini, GPT,
 *   Groq, OpenRouter, Mistral). One model entry, one secret, one provider.
 */

import { z } from "zod";

export const VAR_LLM_MODELS = "LLM_MODELS";

/**
 * Built-in provider presets. The UI uses these to auto-fill `baseURL` and
 * `protocol`. `custom` lets the user point at any endpoint (self-hosted
 * LiteLLM proxy, in-house service, etc).
 */
export const PROVIDER_PRESETS = {
  anthropic: {
    label: "Anthropic (Claude)",
    protocol: "anthropic" as const,
    baseURL: "https://api.anthropic.com/v1",
    keyHint: "ANTHROPIC_API_KEY",
  },
  google: {
    label: "Google (Gemini, OpenAI-compat)",
    protocol: "openai" as const,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyHint: "GEMINI_API_KEY",
  },
  openai: {
    label: "OpenAI",
    protocol: "openai" as const,
    baseURL: "https://api.openai.com/v1",
    keyHint: "OPENAI_API_KEY",
  },
  openrouter: {
    label: "OpenRouter",
    protocol: "openai" as const,
    baseURL: "https://openrouter.ai/api/v1",
    keyHint: "OPENROUTER_API_KEY",
  },
  groq: {
    label: "Groq",
    protocol: "openai" as const,
    baseURL: "https://api.groq.com/openai/v1",
    keyHint: "GROQ_API_KEY",
  },
  mistral: {
    label: "Mistral",
    protocol: "openai" as const,
    baseURL: "https://api.mistral.ai/v1",
    keyHint: "MISTRAL_API_KEY",
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai" as const,
    baseURL: "https://api.deepseek.com/v1",
    keyHint: "DEEPSEEK_API_KEY",
  },
  xai: {
    label: "xAI (Grok)",
    protocol: "openai" as const,
    baseURL: "https://api.x.ai/v1",
    keyHint: "XAI_API_KEY",
  },
  custom: {
    label: "Custom endpoint",
    protocol: "openai" as const,
    baseURL: "",
    keyHint: "API_KEY",
  },
} as const;

export type ProviderPreset = keyof typeof PROVIDER_PRESETS;
export const PROVIDER_PRESET_IDS = Object.keys(
  PROVIDER_PRESETS,
) as ProviderPreset[];

export const ChatProtocolSchema = z.enum(["anthropic", "openai"]);
export type ChatProtocol = z.infer<typeof ChatProtocolSchema>;

export const ChatModelSchema = z.object({
  /** Stable id, also the React key. Free-form; the UI defaults to
   * `<provider>/<modelName>` but the user can change it. */
  id: z.string().min(1).max(160),
  /** Human label for the dropdown. */
  label: z.string().min(1).max(80),
  /** Which preset this entry was created from. Drives the UI's defaults,
   * not the runtime — runtime uses `protocol` + `baseURL` directly. */
  provider: z.enum(
    PROVIDER_PRESET_IDS as [ProviderPreset, ...ProviderPreset[]],
  ),
  /** Wire protocol — picks the SDK at request time. */
  protocol: ChatProtocolSchema,
  /** Endpoint base URL (without trailing slash). Empty string means
   * "use the SDK default" (only valid for `anthropic` + api.anthropic.com,
   * which the SDK already targets). */
  baseURL: z.string().max(512).default(""),
  /** Model id exactly as the provider expects it on the wire. */
  modelName: z.string().min(1).max(160),
  /** Name of the secret in /secrets to read at request time. */
  apiKeySecret: z.string().min(1).max(128),
  /** Hide from dropdown without deleting. */
  enabled: z.boolean().optional().default(true),
  /** Marks this entry as the default selection when chat opens. At most
   * one. Beats Brain auto-default. */
  default: z.boolean().optional(),
  /** Marks this entry as the model the engine runs (kody.yml / Kody Live,
   * issue + PR runs). Written to `agent.model` in the consumer repo's
   * kody.config.json. At most one. When unset, the engine falls back to
   * the chat default. Independent from `default` so chat and engine can
   * run different models. */
  engineDefault: z.boolean().optional(),
  /** Override the chat route's per-turn tool-round cap. Unset → use the
   * route default (10 normally, 30 in goal-planner mode). Set higher to
   * let a model run a longer research chain; the function-level
   * `maxDuration` (300s) still bounds wall-clock time regardless. */
  maxSteps: z.number().int().min(1).max(500).optional(),
});

export const ChatModelsSchema = z.array(ChatModelSchema);

export type ChatModel = z.infer<typeof ChatModelSchema>;

export function pickModelById(
  models: ChatModel[],
  id: string | undefined | null,
): ChatModel | null {
  if (!id) return null;
  return models.find((m) => m.enabled !== false && m.id === id) ?? null;
}

export function pickDefaultModel(models: ChatModel[]): ChatModel | null {
  const enabled = models.filter((m) => m.enabled !== false);
  return enabled.find((m) => m.default === true) ?? enabled[0] ?? null;
}

/**
 * Pick the model the engine should run. Prefers the entry flagged
 * `engineDefault`; when none is set, falls back to the chat default so a
 * single "default" pick still drives both surfaces.
 */
export function pickEngineDefaultModel(models: ChatModel[]): ChatModel | null {
  const enabled = models.filter((m) => m.enabled !== false);
  return (
    enabled.find((m) => m.engineDefault === true) ?? pickDefaultModel(models)
  );
}

/**
 * The `provider/model` string the engine expects in `agent.model`
 * (see kody-engine `parseProviderModel`). Prefers the entry `id` when it's
 * already in `provider/model` form — that's the user's escape hatch and is
 * how non-preset providers like `minimax/MiniMax-M2.7-highspeed` are
 * spelled. Otherwise it's built from the preset provider + wire model name.
 *
 * Caveat: preset provider names mostly match LiteLLM's (anthropic, openai,
 * groq, mistral, deepseek, xai, openrouter). `google` is the exception
 * (LiteLLM wants `gemini/...`) and `custom` has no provider — for those,
 * set the `id` explicitly to the correct `provider/model`.
 */
export function engineModelSpec(m: ChatModel): string {
  const id = m.id.trim();
  if (id.includes("/")) return id;
  return `${m.provider}/${m.modelName.trim()}`;
}
