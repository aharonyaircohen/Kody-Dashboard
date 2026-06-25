/**
 * @fileType util
 * @domain preview
 * @pattern chat-tools
 * @ai-summary Chat tools for saved preview macros (`macros.json` in the state repo):
 *   list, read (full steps), rename, delete. Recording a NEW macro stays a
 *   browser action (the extension captures clicks) — chat can't record, but
 *   it can manage what's saved and replay one by issuing its steps via
 *   preview_act in order. Reads use the module-level GitHub context; writes
 *   pass the per-request octokit.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  readMacrosFile,
  deleteMacroFromFile,
  renameMacroInFile,
} from "@dashboard/lib/macros-files";
import { formatMacroForChat } from "@dashboard/lib/macros";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createMacroTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_macros: tool({
      description: `List the saved preview macros for ${repoRef} (state repo macros.json). Returns each macro's id, name, and step count. A macro is a recorded click-through the user can replay in the preview.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { macros } = await readMacrosFile(octokit);
          return {
            macros: macros.map((m) => ({
              id: m.id,
              name: m.name,
              steps: m.steps.length,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_macro: tool({
      description: `Read one saved preview macro from ${repoRef} in full, rendered as the step-by-step instruction block. To RUN it, call preview_act once per step in order.`,
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => {
        try {
          const { macros } = await readMacrosFile(octokit);
          const macro = macros.find((m) => m.id === id);
          if (!macro) return { error: `macro "${id}" not found` };
          return {
            id: macro.id,
            name: macro.name,
            steps: macro.steps,
            instructions: formatMacroForChat(macro),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    rename_macro: tool({
      description: `Rename a saved preview macro in ${repoRef} by its id (get ids from list_macros).`,
      inputSchema: z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(64),
      }),
      execute: async ({ id, name }) => {
        try {
          const updated = await renameMacroInFile({ octokit, id, name });
          if (!updated) return { error: `macro "${id}" not found` };
          return { ok: true, id: updated.id, name: updated.name };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_macro: tool({
      description: `Delete a saved preview macro from ${repoRef} by its id.`,
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => {
        try {
          const removed = await deleteMacroFromFile({ octokit, id });
          if (!removed) return { error: `macro "${id}" not found` };
          return { ok: true, action: "deleted", id };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
