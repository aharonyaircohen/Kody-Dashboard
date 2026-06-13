/**
 * @fileType util
 * @domain variables
 * @pattern chat-tools
 * @ai-summary Chat tools to manage non-secret dashboard variables
 *   (`.kody/variables.json`) — list, set, delete. Variables are plaintext
 *   config knobs (unlike the encrypted secrets vault). The reserved
 *   LLM_MODELS variable is managed via the models tools, not here.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  readVariables,
  updateVariables,
  listVariables,
} from "@dashboard/lib/variables/store";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

const RESERVED = new Set(["LLM_MODELS"]);

export function createVariableTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;
  const by = actorLogin ? ` (via chat by @${actorLogin})` : "";

  return {
    list_variables: tool({
      description: `List the non-secret dashboard variables for ${repoRef} (.kody/variables.json) with their values and last-updated timestamps. These are plaintext config — secrets live in the encrypted vault instead.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { doc } = await readVariables(octokit, owner, repo);
          return { variables: listVariables(doc) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_variable: tool({
      description: `Set (create or overwrite) a non-secret variable in ${repoRef}. Use this only for non-sensitive config; anything secret (API keys, tokens) must go through set_secret instead.`,
      inputSchema: z.object({
        name: z
          .string()
          .regex(
            /^[A-Za-z][A-Za-z0-9_]{0,127}$/,
            "letters/digits/underscores; start with a letter",
          ),
        value: z.string(),
      }),
      execute: async ({ name, value }) => {
        if (RESERVED.has(name))
          return {
            error: `"${name}" is reserved — manage it via the models tools.`,
          };
        try {
          await updateVariables(
            octokit,
            owner,
            repo,
            (doc) => ({
              ...doc,
              variables: {
                ...doc.variables,
                [name]: {
                  value,
                  updatedAt: new Date().toISOString(),
                  ...(actorLogin ? { updatedBy: actorLogin } : {}),
                },
              },
            }),
            `chore(variables): set ${name}${by}`,
          );
          return { ok: true, name };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_variable: tool({
      description: `Delete a non-secret variable from ${repoRef}.`,
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) => {
        if (RESERVED.has(name))
          return {
            error: `"${name}" is reserved — manage it via the models tools.`,
          };
        try {
          const { doc } = await readVariables(octokit, owner, repo);
          if (!doc.variables[name])
            return { error: `variable "${name}" not found` };
          await updateVariables(
            octokit,
            owner,
            repo,
            (d) => {
              const variables = { ...d.variables };
              delete variables[name];
              return { ...d, variables };
            },
            `chore(variables): delete ${name}${by}`,
          );
          return { ok: true, action: "deleted", name };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
