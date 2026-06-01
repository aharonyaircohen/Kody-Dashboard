/**
 * @fileType util
 * @domain models
 * @pattern chat-tools
 * @ai-summary Chat tools for the chat-model registry (the `LLM_MODELS`
 *   variable in `.kody/variables.json`). Lists models and flips the
 *   chat/engine default + enabled flags. Adding brand-new provider bindings
 *   (with API-key secret wiring) stays in the /models page UI; chat only
 *   selects among existing entries. Mirrors the /api/kody/models PUT writer.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  readVariables,
  writeVariables,
  invalidateVariablesCache,
  type VariablesDocument,
} from "@dashboard/lib/variables/store";
import {
  ChatModelsSchema,
  VAR_LLM_MODELS,
  type ChatModel,
} from "@dashboard/lib/variables/models";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

function loadModels(doc: VariablesDocument): ChatModel[] {
  const raw = doc.variables[VAR_LLM_MODELS]?.value;
  if (!raw) return [];
  try {
    return ChatModelsSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function createModelTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;
  const by = actorLogin ? ` (via chat by @${actorLogin})` : "";

  async function persist(models: ChatModel[]) {
    const { doc, sha } = await readVariables(octokit, owner, repo, {
      force: true,
    });
    const next: VariablesDocument = {
      ...doc,
      variables: {
        ...doc.variables,
        [VAR_LLM_MODELS]: {
          value: JSON.stringify(models),
          updatedAt: new Date().toISOString(),
          ...(actorLogin ? { updatedBy: actorLogin } : {}),
        },
      },
    };
    await writeVariables(
      octokit,
      owner,
      repo,
      next,
      sha,
      `chore(models): update LLM_MODELS${by}`,
    );
    invalidateVariablesCache(owner, repo);
  }

  return {
    list_models: tool({
      description: `List the configured chat models for ${repoRef} (id, label, provider, and whether each is enabled / the chat default / the engine default).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { doc } = await readVariables(octokit, owner, repo);
          const models = loadModels(doc).map((m) => ({
            id: m.id,
            label: m.label,
            provider: m.provider,
            enabled: m.enabled !== false,
            default: !!m.default,
            engineDefault: !!m.engineDefault,
          }));
          return { models };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_default_model: tool({
      description: `Set which model is the default in ${repoRef}. \`scope\` "chat" sets the chat-UI default, "engine" sets the engine/kody.yml default, "both" sets both. Clears the same flag on every other model so there's exactly one.`,
      inputSchema: z.object({
        id: z.string().min(1),
        scope: z.enum(["chat", "engine", "both"]).default("chat"),
      }),
      execute: async ({ id, scope }) => {
        try {
          const { doc } = await readVariables(octokit, owner, repo, {
            force: true,
          });
          const models = loadModels(doc);
          if (!models.some((m) => m.id === id))
            return { error: `model "${id}" not found` };
          const next = models.map((m) => ({
            ...m,
            ...(scope === "chat" || scope === "both"
              ? { default: m.id === id }
              : {}),
            ...(scope === "engine" || scope === "both"
              ? { engineDefault: m.id === id }
              : {}),
          }));
          await persist(next);
          return { ok: true, id, scope };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_model_enabled: tool({
      description: `Enable or disable a model in ${repoRef} (a disabled model is hidden from the chat picker and can't be selected).`,
      inputSchema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
      execute: async ({ id, enabled }) => {
        try {
          const { doc } = await readVariables(octokit, owner, repo, {
            force: true,
          });
          const models = loadModels(doc);
          if (!models.some((m) => m.id === id))
            return { error: `model "${id}" not found` };
          await persist(
            models.map((m) => (m.id === id ? { ...m, enabled } : m)),
          );
          return { ok: true, id, enabled };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
