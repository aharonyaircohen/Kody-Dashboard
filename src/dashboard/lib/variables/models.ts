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

import { z } from "zod"
import type { NextRequest } from "next/server"
import { getVariable } from "./get-variable"

export const VAR_LLM_MODELS = "LLM_MODELS"

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
} as const

export type ProviderPreset = keyof typeof PROVIDER_PRESETS
export const PROVIDER_PRESET_IDS = Object.keys(PROVIDER_PRESETS) as ProviderPreset[]

export const ChatProtocolSchema = z.enum(["anthropic", "openai"])
export type ChatProtocol = z.infer<typeof ChatProtocolSchema>

export const ChatModelSchema = z.object({
  /** Stable id, also the React key. Free-form; the UI defaults to
   * `<provider>/<modelName>` but the user can change it. */
  id: z.string().min(1).max(160),
  /** Human label for the dropdown. */
  label: z.string().min(1).max(80),
  /** Which preset this entry was created from. Drives the UI's defaults,
   * not the runtime — runtime uses `protocol` + `baseURL` directly. */
  provider: z.enum(PROVIDER_PRESET_IDS as [ProviderPreset, ...ProviderPreset[]]),
  /** Wire protocol — picks the SDK at request time. */
  protocol: ChatProtocolSchema,
  /** Endpoint base URL (without trailing slash). Empty string means
   * "use the SDK default" (only valid for `anthropic` + api.anthropic.com,
   * which the SDK already targets). */
  baseURL: z.string().max(512).default(""),
  /** Model id as the provider expects it on the wire (e.g.
   * `claude-sonnet-4-6`, `gemini-2.5-flash`, `gpt-4o`). */
  modelName: z.string().min(1).max(160),
  /** Name of the secret in /secrets to read at request time. */
  apiKeySecret: z.string().min(1).max(128),
  /** Hide from dropdown without deleting. */
  enabled: z.boolean().optional().default(true),
  /** Marks this entry as the kody-speech model. At most one. */
  speech: z.boolean().optional(),
  /** Marks this entry as the default selection when chat opens. At most
   * one. Beats Brain auto-default. */
  default: z.boolean().optional(),
})

export const ChatModelsSchema = z.array(ChatModelSchema)

export type ChatModel = z.infer<typeof ChatModelSchema>

export async function loadChatModels(req: NextRequest): Promise<ChatModel[]> {
  const raw = await getVariable(VAR_LLM_MODELS, { req })
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    const result = ChatModelsSchema.safeParse(parsed)
    if (!result.success) return []
    return result.data
  } catch {
    return []
  }
}

export function pickModelById(
  models: ChatModel[],
  id: string | undefined | null,
): ChatModel | null {
  if (!id) return null
  return models.find((m) => m.enabled !== false && m.id === id) ?? null
}

export function pickSpeechModel(models: ChatModel[]): ChatModel | null {
  return (
    models.find((m) => m.enabled !== false && m.speech === true) ?? null
  )
}

export function pickDefaultModel(models: ChatModel[]): ChatModel | null {
  const enabled = models.filter((m) => m.enabled !== false)
  return enabled.find((m) => m.default === true) ?? enabled[0] ?? null
}
