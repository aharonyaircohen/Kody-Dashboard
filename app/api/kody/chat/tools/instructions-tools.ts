/**
 * @fileType util
 * @domain instructions
 * @pattern chat-tools
 * @ai-summary Chat tools to manage the single repo instructions file
 *   (`instructions.md` in the state repo) — read, set, delete. The instructions body is
 *   appended to the chat system prompt, so it's how the user gives Kody
 *   standing guidance for this repo.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  readInstructionsFile,
  writeInstructionsFile,
  deleteInstructionsFile,
} from "@dashboard/lib/instructions/files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createInstructionsTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;
  const by = actorLogin ? ` (via chat by @${actorLogin})` : "";

  return {
    read_instructions: tool({
      description: `Read the standing instructions for ${repoRef} (state repo instructions.md), the markdown appended to Kody's system prompt for this repo. Returns null body if none set.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const file = await readInstructionsFile(octokit);
          return { body: file?.body ?? null, htmlUrl: file?.htmlUrl ?? null };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_instructions: tool({
      description: `Replace the standing instructions for ${repoRef} (commits instructions.md in the state repo). This OVERWRITES the whole file — read it first and include any content you want to keep. Body is plain markdown.`,
      inputSchema: z.object({ body: z.string().min(1) }),
      execute: async ({ body }) => {
        try {
          const existing = await readInstructionsFile(octokit);
          const file = await writeInstructionsFile({
            octokit,
            body,
            sha: existing?.sha,
            message: `chore(instructions): update${by}`,
          });
          return {
            ok: true,
            action: existing ? "updated" : "created",
            htmlUrl: file.htmlUrl,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_instructions: tool({
      description: `Delete the standing instructions file for ${repoRef} (removes instructions.md from the state repo).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const existing = await readInstructionsFile(octokit);
          if (!existing) return { error: "no instructions file to delete" };
          await deleteInstructionsFile(octokit);
          return { ok: true, action: "deleted" };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
