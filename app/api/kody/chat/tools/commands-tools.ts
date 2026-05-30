/**
 * @fileType util
 * @domain commands
 * @pattern chat-tools
 * @ai-summary In-process chat tools that let Kody manage slash commands
 *   (`.kody/commands/<slug>.md`) by conversation — list, read, create/update,
 *   delete. Mirrors executable-tools: reads use the module-level GitHub
 *   context the chat route sets; writes pass the per-request octokit. Repo
 *   commands win over built-ins on slug collision.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listRepoCommandFiles,
  readCommandFile,
  writeCommandFile,
  deleteCommandFile,
  isValidSlug,
} from "@dashboard/lib/commands/files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createCommandTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;
  const by = actorLogin ? ` (via chat by @${actorLogin})` : "";

  return {
    list_commands: tool({
      description: `List the slash commands stored in ${repoRef} at .kody/commands/. Returns slug, description, and argument hint for each, plus whether built-ins are disabled.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { commands, builtinsDisabled } = await listRepoCommandFiles();
          return {
            builtinsDisabled,
            commands: commands.map((c) => ({
              slug: c.slug,
              description: c.description,
              argumentHint: c.argumentHint,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_command: tool({
      description: `Read one slash command from ${repoRef} in full (description, argument hint, and the prompt template body).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const command = await readCommandFile(slug, octokit);
          if (!command) return { error: `command "${slug}" not found` };
          return { command };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_or_update_command: tool({
      description: `Create or update a slash command in ${repoRef} (commits .kody/commands/<slug>.md). The body is the prompt template; use $ARGUMENTS, $0, $1 placeholders for user-supplied arguments. A repo command overrides a built-in with the same slug.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        description: z.string().default(""),
        argumentHint: z.string().default(""),
        body: z.string().min(1),
      }),
      execute: async (input) => {
        if (!isValidSlug(input.slug))
          return { error: `invalid slug "${input.slug}"` };
        try {
          const existing = await readCommandFile(input.slug, octokit);
          const command = await writeCommandFile({
            octokit,
            slug: input.slug,
            description: input.description,
            argumentHint: input.argumentHint,
            body: input.body,
            sha: existing?.sha,
            message: `${existing ? "chore" : "feat"}(commands): ${existing ? "update" : "add"} ${input.slug}${by}`,
          });
          return {
            ok: true,
            action: existing ? "updated" : "created",
            slug: command.slug,
            htmlUrl: command.htmlUrl,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_command: tool({
      description: `Delete a slash command from ${repoRef} (removes .kody/commands/<slug>.md). Built-in commands cannot be deleted this way — they only ship in code.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readCommandFile(slug, octokit);
          if (!existing) return { error: `command "${slug}" not found` };
          await deleteCommandFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
