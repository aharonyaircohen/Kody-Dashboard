/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Memory tools for the kody-direct chat agent. Persist
 *   facts/feedback/project-context/references as `.kody/memory/<id>.md`
 *   files in the connected repo. Mirrors the create_kody_duty tool: each
 *   write commits a markdown file via the GitHub contents API and rebuilds
 *   the sibling `INDEX.md` so the next chat turn can see the new entry.
 *
 *   The agent decides when to call `remember` based on the rules in
 *   `AGENT_KODY.systemPrompt`. Tools exposed:
 *     - remember        — write a new memory
 *     - recall          — fetch the full body of a memory by id
 *     - update_memory   — replace an existing memory's body/description
 *     - forget          — delete a memory
 *     - list_memories   — enumerate all memories (id + meta only)
 */

import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { logger } from "@dashboard/lib/logger";
import {
  deleteMemoryFile,
  invalidateMemoryIndexPromptCache,
  isValidMemoryId,
  listMemoryFiles,
  readMemoryFile,
  slugifyMemoryName,
  writeMemoryFile,
  type MemoryType,
} from "@dashboard/lib/memory-files";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  /** Login of the chat user. Used in commit messages for traceability. */
  actorLogin: string | null;
}

const MEMORY_TYPE_VALUES = [
  "user",
  "feedback",
  "project",
  "reference",
] as const;

const memoryTypeSchema = z
  .enum(MEMORY_TYPE_VALUES)
  .describe(
    "Memory category. " +
      "`user` = facts about the user (role, expertise, preferences). " +
      "`feedback` = guidance on how to approach work in this repo (corrections + confirmations). " +
      "`project` = ongoing initiatives, decisions, deadlines, motivations not derivable from code. " +
      "`reference` = pointers to external systems (Linear projects, Slack channels, dashboards, runbooks).",
  );

export function createMemoryTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;
  const commitSuffix = actorLogin ? ` (via chat by @${actorLogin})` : "";

  return {
    remember: tool({
      description:
        `Persist a memory in ${repoRef} as \`.kody/memory/<id>.md\`. Memories are ` +
        "loaded into every future chat turn (via the INDEX) so the agent does not " +
        "re-learn the same facts.\n\n" +
        "WRITE on signal, not on schedule. Triggers:\n" +
        '- User corrects an approach ("don\'t do X", "stop doing Y") → type `feedback`.\n' +
        '- User confirms a non-obvious choice worked ("yes that bundled PR was right") → type `feedback`.\n' +
        "- User states a fact about the repo/team/deadline that is NOT derivable from code (a freeze date, a compliance constraint, an ownership boundary) → type `project`.\n" +
        '- User points to an external system ("bugs are tracked in Linear INGEST") → type `reference`.\n' +
        "- User reveals their role / expertise / how they want to be addressed → type `user`.\n\n" +
        "DO NOT save: code patterns, file paths, architecture, anything in CLAUDE.md, " +
        "ephemeral task state, or routine successes. If the next reader could derive it " +
        "from `git log` or by reading the code, do not save it.\n\n" +
        "Before calling: check the injected `## Remembered context` block. If a similar " +
        "memory already exists, call `update_memory` instead of creating a duplicate. " +
        'Body should include "Why:" and "How to apply:" lines for `feedback` and ' +
        "`project` types so future-you can judge edge cases.",
      inputSchema: z.object({
        name: z
          .string()
          .min(3)
          .max(80)
          .describe(
            "Short title (~40 chars). Used as the H1 hint in INDEX.md and the file frontmatter.",
          ),
        description: z
          .string()
          .min(10)
          .max(200)
          .describe(
            "One-line hook (≤150 chars) shown in the INDEX. Should be specific enough that " +
              "future-you can decide whether the memory is relevant without opening the file.",
          ),
        type: memoryTypeSchema,
        body: z
          .string()
          .min(10)
          .describe(
            "Memory content. For `feedback`/`project`: lead with the rule/fact, then a " +
              "**Why:** line and a **How to apply:** line so future calls can judge edge cases. " +
              "For `user`/`reference`: a short paragraph is fine.",
          ),
        id: z
          .string()
          .optional()
          .describe(
            "Optional explicit id (lowercase letters, digits, dashes, underscores; max 64). " +
              "If omitted, derived from `name`.",
          ),
      }),
      execute: async (input) => {
        const id = (input.id ?? slugifyMemoryName(input.name)).toLowerCase();
        if (!id || !isValidMemoryId(id)) {
          return {
            error: "invalid_id",
            message: `Memory id "${id}" is not valid. Use lowercase letters, digits, dashes, underscores (max 64).`,
          };
        }
        try {
          const existing = await readMemoryFile(id);
          if (existing) {
            return {
              error: "id_taken",
              message:
                `A memory with id "${id}" already exists (${existing.meta.name}). ` +
                "Call `update_memory` to revise it, or pick a different id.",
              existingHtmlUrl: existing.htmlUrl,
            };
          }
          const file = await writeMemoryFile({
            octokit,
            id,
            meta: {
              name: input.name,
              description: input.description,
              type: input.type as MemoryType,
              created: new Date().toISOString(),
            },
            body: input.body,
            message: `chore(memory): add ${id}${commitSuffix}`,
          });
          invalidateMemoryIndexPromptCache();
          logger.info(
            { owner, repo, id, type: input.type, actorLogin },
            "remember: wrote memory file",
          );
          return {
            id: file.id,
            name: file.meta.name,
            type: file.meta.type,
            htmlUrl: file.htmlUrl,
          };
        } catch (err) {
          logger.warn({ err, owner, repo, id }, "remember failed");
          return {
            error: "write_failed",
            message:
              err instanceof Error
                ? err.message
                : "Failed to write memory file",
          };
        }
      },
    }),

    recall: tool({
      description:
        `Fetch the full body of a memory in ${repoRef} by id. Use when the injected ` +
        "`## Remembered context` index hints that a memory is relevant to the current " +
        "turn and you need its full content (not just the one-line description). " +
        "Returns `null` if the memory does not exist.",
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .describe(
            "Memory id (the filename without `.md`). See the index for valid ids.",
          ),
      }),
      execute: async (input) => {
        const id = input.id.toLowerCase();
        if (!isValidMemoryId(id)) {
          return {
            error: "invalid_id",
            message: `Memory id "${id}" is not valid.`,
          };
        }
        const file = await readMemoryFile(id);
        if (!file) return { found: false, id };
        return {
          found: true,
          id: file.id,
          name: file.meta.name,
          description: file.meta.description,
          type: file.meta.type,
          created: file.meta.created,
          updatedAt: file.updatedAt,
          body: file.body,
          htmlUrl: file.htmlUrl,
        };
      },
    }),

    update_memory: tool({
      description:
        `Replace an existing memory in ${repoRef}. Use when (a) a stored fact is now ` +
        "wrong and needs correcting, or (b) the user has refined existing guidance. " +
        "Does NOT change the id — pass the original id and the new fields you want to " +
        "overwrite. Fields not passed are left as-is. Rebuilds INDEX.md after the write.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Memory id to update."),
        name: z.string().min(3).max(80).optional(),
        description: z.string().min(10).max(200).optional(),
        type: memoryTypeSchema.optional(),
        body: z
          .string()
          .min(10)
          .optional()
          .describe(
            "New memory body. Replaces the existing body in full when provided.",
          ),
      }),
      execute: async (input) => {
        const id = input.id.toLowerCase();
        if (!isValidMemoryId(id)) {
          return {
            error: "invalid_id",
            message: `Memory id "${id}" is not valid.`,
          };
        }
        const existing = await readMemoryFile(id);
        if (!existing) {
          return {
            error: "not_found",
            message: `Memory "${id}" does not exist.`,
          };
        }
        try {
          const file = await writeMemoryFile({
            octokit,
            id,
            sha: existing.sha,
            meta: {
              name: input.name ?? existing.meta.name,
              description: input.description ?? existing.meta.description,
              type:
                (input.type as MemoryType | undefined) ?? existing.meta.type,
              created: existing.meta.created,
            },
            body: input.body ?? existing.body,
            message: `chore(memory): update ${id}${commitSuffix}`,
          });
          invalidateMemoryIndexPromptCache();
          logger.info(
            { owner, repo, id, type: file.meta.type, actorLogin },
            "update_memory: wrote memory file",
          );
          return {
            id: file.id,
            name: file.meta.name,
            type: file.meta.type,
            htmlUrl: file.htmlUrl,
          };
        } catch (err) {
          logger.warn({ err, owner, repo, id }, "update_memory failed");
          return {
            error: "write_failed",
            message:
              err instanceof Error
                ? err.message
                : "Failed to update memory file",
          };
        }
      },
    }),

    forget: tool({
      description:
        `Delete a memory from ${repoRef}. Use when the user explicitly says to forget ` +
        "something, or when a memory is clearly stale/wrong and not just due for an update. " +
        "Idempotent: returns `not_found` rather than erroring on missing ids.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Memory id to delete."),
      }),
      execute: async (input) => {
        const id = input.id.toLowerCase();
        if (!isValidMemoryId(id)) {
          return {
            error: "invalid_id",
            message: `Memory id "${id}" is not valid.`,
          };
        }
        const existing = await readMemoryFile(id);
        if (!existing) return { found: false, id };
        try {
          await deleteMemoryFile(octokit, id);
          invalidateMemoryIndexPromptCache();
          logger.info(
            { owner, repo, id, actorLogin },
            "forget: deleted memory file",
          );
          return { found: true, id, deleted: true };
        } catch (err) {
          logger.warn({ err, owner, repo, id }, "forget failed");
          return {
            error: "delete_failed",
            message:
              err instanceof Error
                ? err.message
                : "Failed to delete memory file",
          };
        }
      },
    }),

    list_memories: tool({
      description:
        `List every memory currently stored in ${repoRef} with id, name, description, ` +
        "and type — but NOT the body. Prefer the injected `## Remembered context` index " +
        'over calling this tool; only call when the user explicitly asks "what do you ' +
        'remember?" or when you suspect the index in the system prompt is truncated.',
      inputSchema: z.object({
        type: memoryTypeSchema
          .optional()
          .describe("Optional filter — return only memories of this type."),
      }),
      execute: async (input) => {
        const all = await listMemoryFiles();
        const filtered = input.type
          ? all.filter((f) => f.meta.type === (input.type as MemoryType))
          : all;
        return {
          count: filtered.length,
          memories: filtered.map((f) => ({
            id: f.id,
            name: f.meta.name,
            description: f.meta.description,
            type: f.meta.type,
            created: f.meta.created,
            updatedAt: f.updatedAt,
          })),
        };
      },
    }),

    recall_search: tool({
      description:
        `Search every memory file in ${repoRef} (under \`.kody/memory/\`) by free-text ` +
        "query, using GitHub code search. Returns up to 20 matches with file path, " +
        "snippet, and the memory id (filename without `.md`). Use this when:\n" +
        "- The injected `## Remembered context` index is truncated.\n" +
        "- The keyword you care about lives in a memory body, not its one-line hook.\n" +
        '- The user asks "do you remember anything about X" and X does not appear ' +
        "in the visible index.\n\n" +
        "After finding a match you may call `recall(id)` to read the full body. " +
        "Note: GitHub code search lags ~30–60 seconds behind a write — a memory you " +
        "just created may not appear here until indexing catches up.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'Free-text query. Examples: "deploy workflow", "merge freeze", ' +
              '"prefers terse responses". GitHub code-search syntax (path:, repo:, ' +
              "language:) is supported but already scoped to .kody/memory/ in this repo.",
          ),
      }),
      execute: async ({ query }) => {
        try {
          const scopedQuery = `${query} repo:${owner}/${repo} path:.kody/memory`;
          const res = await octokit.rest.search.code({
            q: scopedQuery,
            per_page: 20,
            mediaType: { format: "text-match" },
          });
          type TextMatch = {
            fragment?: string;
            matches?: Array<{ indices?: [number, number] }>;
          };
          interface Hit {
            id: string | null;
            path: string;
            url: string;
            snippet: string;
            lineInFragment: number | null;
          }
          const matches: Hit[] = res.data.items.flatMap<Hit>((it) => {
            const item = it as typeof it & { text_matches?: TextMatch[] };
            const filename = it.path.split("/").pop() ?? "";
            const id = filename.endsWith(".md")
              ? filename.slice(0, -".md".length)
              : null;
            // Don't surface INDEX.md hits — its content duplicates the
            // per-file descriptions and noise-blooms the result list.
            if (id === "INDEX") return [];
            const tms = item.text_matches ?? [];
            if (tms.length === 0) {
              return [
                {
                  id,
                  path: it.path,
                  url: it.html_url,
                  snippet: "",
                  lineInFragment: null,
                },
              ];
            }
            return tms.map<Hit>((tm) => {
              const fragment = tm.fragment ?? "";
              const firstIdx = tm.matches?.[0]?.indices?.[0] ?? 0;
              const lineInFragment =
                (fragment.slice(0, firstIdx).match(/\n/g)?.length ?? 0) + 1;
              const snippet =
                fragment.length > 600 ? `${fragment.slice(0, 600)}…` : fragment;
              return {
                id,
                path: it.path,
                url: it.html_url,
                snippet,
                lineInFragment,
              };
            });
          });
          return {
            total: res.data.total_count,
            matches,
          };
        } catch (err) {
          logger.warn({ err, owner, repo, query }, "recall_search failed");
          return {
            error: "search_failed",
            message:
              err instanceof Error ? err.message : "Failed to search memories",
          };
        }
      },
    }),
  };
}
