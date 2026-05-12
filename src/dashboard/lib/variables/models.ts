/**
 * @fileType utility
 * @domain variables
 * @pattern model-list
 * @ai-summary Typed accessor for the LLM_MODELS variable. Each entry maps to
 *   a Vercel AI Gateway model id (e.g. "anthropic/claude-sonnet-4-6"). Used by
 *   the chat route and the chat UI dropdown to keep both in sync from one
 *   source of truth in .kody/variables.json.
 */

import { z } from "zod"
import type { NextRequest } from "next/server"
import { getVariable } from "./get-variable"

export const VAR_LLM_MODELS = "LLM_MODELS"

export const ChatModelSchema = z.object({
  /** Gateway model id, e.g. "anthropic/claude-sonnet-4-6". */
  id: z.string().regex(/^[a-z0-9._-]+\/[a-zA-Z0-9._:-]+$/i, {
    message: "id must be <provider>/<model>",
  }),
  /** Human label for the dropdown. */
  label: z.string().min(1).max(80),
  /** Hide from dropdown without deleting. */
  enabled: z.boolean().optional().default(true),
  /** Marks this entry as the kody-speech model. At most one. */
  speech: z.boolean().optional(),
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
  return models.find((m) => m.enabled !== false) ?? null
}
