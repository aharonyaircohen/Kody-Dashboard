/**
 * @fileType utility
 * @domain variables
 * @pattern model-loader
 * @ai-summary Server-only loader for the LLM_MODELS variable. Split out of
 *   `models.ts` so the client-safe model definitions there (presets, schema,
 *   pure pickers) can be imported by client components (e.g. ModelsManager)
 *   without dragging `get-variable` → `github-client` → `node:async_hooks`
 *   into the browser bundle. Import this only from server code (API routes).
 */
import type { NextRequest } from "next/server";
import { getVariable } from "./get-variable";
import { VAR_LLM_MODELS, ChatModelsSchema, type ChatModel } from "./models";

export async function loadChatModels(req: NextRequest): Promise<ChatModel[]> {
  const raw = await getVariable(VAR_LLM_MODELS, { req });
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const result = ChatModelsSchema.safeParse(parsed);
    if (!result.success) return [];
    return result.data;
  } catch {
    return [];
  }
}
