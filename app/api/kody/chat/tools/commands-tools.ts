/**
 * @fileType util
 * @domain commands
 * @pattern chat-tools
 * @ai-summary In-process chat tools that let Kody manage slash commands
 *   (`commands/<slug>.md` in the state repo) by conversation — list, read, create/update,
 *   delete. Mirrors agentAction-tools: reads use the module-level GitHub
 *   context the chat route sets; writes pass the per-request octokit. Repo
 *   commands win over activated Store commands and fallback built-ins on slug collision.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { listCommands } from "@dashboard/lib/commands";
import {
  listRepoCommandFiles,
  readCommandFile,
  writeCommandFile,
  deleteCommandFile,
  isValidSlug,
} from "@dashboard/lib/commands/files";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@dashboard/lib/engine/config";

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
  const activeStoreCommandSlugs = async () => {
    const { config } = await getEngineConfig(octokit, owner, repo);
    return new Set(config.company?.activeCommands ?? []);
  };

  return {
    list_commands: tool({
      description: `List slash commands available to ${repoRef}: repo-local commands, activated Store commands, and fallback built-ins. Returns slug, description, argument hint, source, and whether built-ins are disabled.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const activeStoreSlugs = await activeStoreCommandSlugs();
          const [{ builtinsDisabled }, commands] = await Promise.all([
            listRepoCommandFiles(),
            listCommands({ activeStoreSlugs }),
          ]);
          return {
            builtinsDisabled,
            commands: commands.map((c) => ({
              slug: c.slug,
              description: c.description,
              argumentHint: c.argumentHint,
              source: c.source,
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
          const activeStoreSlugs = await activeStoreCommandSlugs();
          const command = (await listCommands({ activeStoreSlugs })).find(
            (item) => item.slug === slug,
          );
          if (!command) return { error: `command "${slug}" not found` };
          return { command };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_or_update_command: tool({
      description: `Create or update a slash command in ${repoRef} (commits commands/<slug>.md in the state repo). The body is the prompt template; use $ARGUMENTS, $0, $1 placeholders for user-supplied arguments. A repo command overrides Store or built-in commands with the same slug.`,
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
      description: `Delete a repo-local slash command from ${repoRef}, or remove an imported Store command from this repo's active commands.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readCommandFile(slug, octokit);
          if (!existing) {
            const { config } = await getEngineConfig(octokit, owner, repo, {
              force: true,
            });
            const activeCommands = config.company?.activeCommands ?? [];
            if (!activeCommands.includes(slug)) {
              return { error: `command "${slug}" not found` };
            }
            const nextActiveCommands = activeCommands.filter(
              (value) => value !== slug,
            );
            await writeConfigPatch(
              octokit,
              owner,
              repo,
              {
                activeCommands:
                  nextActiveCommands.length > 0 ? nextActiveCommands : null,
              },
              `chore(kody): remove store command ${slug}${by}`,
            );
            return { ok: true, action: "removed-store-reference", slug };
          }
          await deleteCommandFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
