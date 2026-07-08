/**
 * @fileType module
 * @domain chat-platform
 * @pattern server-tool-registry
 * @ai-summary Server half of the plugin contract (plan H3). Plugins that
 *   declare the "tools" capability export a tool FACTORY registered here;
 *   the in-process kody chat route collects tools per request via a
 *   server-only entry (Step 4). Every tool carries a zod input schema and
 *   execute() validates input through it. Phase 1 scope: in-process backend
 *   only — engine (MCP config) and brain (external server) are out.
 */

import type { z } from "zod";

export interface ChatToolServerContext {
  owner: string;
  repo: string;
  token: string;
  /** Extended by the kody route in Step 4 without breaking this contract. */
  extras?: Readonly<Record<string, unknown>>;
}

export interface ChatPluginToolDefinition {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute(input: unknown, ctx: ChatToolServerContext): Promise<unknown>;
}

export type ChatPluginServerTools = (
  ctx: ChatToolServerContext,
) => Record<string, ChatPluginToolDefinition>;

export class ChatToolRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatToolRegistrationError";
  }
}

export interface ChatServerToolRegistry {
  register(pluginId: string, factory: ChatPluginServerTools): void;
  /**
   * Materialize tools for one request. Names must be globally unique;
   * collisions throw at collect time (fail fast, not silent override).
   * Execution wraps each tool so input is zod-validated before the
   * handler runs.
   */
  collect(ctx: ChatToolServerContext): Record<string, ChatPluginToolDefinition>;
  pluginIds(): string[];
}

export function createChatServerToolRegistry(): ChatServerToolRegistry {
  const factories = new Map<string, ChatPluginServerTools>();

  return {
    register(pluginId, factory) {
      if (factories.has(pluginId)) {
        throw new ChatToolRegistrationError(
          `plugin "${pluginId}" already registered server tools`,
        );
      }
      factories.set(pluginId, factory);
    },

    collect(ctx) {
      const merged: Record<string, ChatPluginToolDefinition> = {};
      for (const [pluginId, factory] of factories) {
        for (const [name, def] of Object.entries(factory(ctx))) {
          if (merged[name]) {
            throw new ChatToolRegistrationError(
              `tool name collision: "${name}" (plugin "${pluginId}")`,
            );
          }
          merged[name] = {
            ...def,
            // async so a sync schema failure surfaces as a rejection, never
            // a sync throw into the caller's stream loop.
            execute: async (input, execCtx) =>
              def.execute(def.inputSchema.parse(input), execCtx),
          };
        }
      }
      return merged;
    },

    pluginIds() {
      return [...factories.keys()];
    },
  };
}
