/**
 * @fileType util
 * @domain context
 * @pattern chat-tools
 * @ai-summary Chat tools to manage curated Context entries
 *   (`.kody/context/<slug>.md`) — list, read, create/update, delete. Context
 *   is the company-curated knowledge fed to staff personas. Each entry's
 *   `staff` array scopes which personas see it ("kody" by default, "*" = all).
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  listContextFiles,
  readContextFile,
  writeContextFile,
  deleteContextFile,
  isValidSlug,
} from "@dashboard/lib/context/files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

export function createContextTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;
  const by = actorLogin ? ` (via chat by @${actorLogin})` : "";

  return {
    list_context: tool({
      description: `List curated context entries in ${repoRef} (.kody/context/). Returns slug and the staff personas each entry is scoped to.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const entries = await listContextFiles();
          return {
            entries: entries.map((e) => ({ slug: e.slug, staff: e.staff })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_context: tool({
      description: `Read one context entry from ${repoRef} in full (body markdown + the staff personas it's scoped to).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const entry = await readContextFile(slug, octokit);
          if (!entry) return { error: `context "${slug}" not found` };
          return { entry };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_or_update_context: tool({
      description: `Create or update a context entry in ${repoRef} (commits .kody/context/<slug>.md). \`staff\` lists which staff slugs see it — use ["kody"] for chat only, ["*"] for every persona, or specific slugs. The body is plain markdown (no frontmatter).`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        body: z.string().min(1),
        staff: z.array(z.string().min(1)).default(["kody"]),
      }),
      execute: async (input) => {
        if (!isValidSlug(input.slug))
          return { error: `invalid slug "${input.slug}"` };
        try {
          const existing = await readContextFile(input.slug, octokit);
          const entry = await writeContextFile({
            octokit,
            slug: input.slug,
            body: input.body,
            staff: input.staff,
            sha: existing?.sha,
            message: `${existing ? "chore" : "feat"}(context): ${existing ? "update" : "add"} ${input.slug}${by}`,
          });
          return {
            ok: true,
            action: existing ? "updated" : "created",
            slug: entry.slug,
            htmlUrl: entry.htmlUrl,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_context: tool({
      description: `Delete a context entry from ${repoRef} (removes .kody/context/<slug>.md).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readContextFile(slug, octokit);
          if (!existing) return { error: `context "${slug}" not found` };
          await deleteContextFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
