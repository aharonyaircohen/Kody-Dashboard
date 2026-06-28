/**
 * @fileType util
 * @domain todos
 * @pattern chat-tools
 * @ai-summary Chat tools to manage repo-scoped todo lists stored as
 * `todos/<slug>.md` in the state repo. A todo file is one list; each list owns note-like
 * items with independent completed state.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  createTodoSlug,
  deleteTodoFile,
  isValidTodoSlug,
  listTodoFiles,
  readTodoFile,
  writeTodoFile,
} from "@dashboard/lib/todos/files";
import { dashboardTodoUrl } from "@dashboard/lib/thread-link";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

const todoItemSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(20_000).default(""),
  assignee: z.string().trim().max(120).nullable().optional(),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
});

function itemId(): string {
  return `item-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeItems(items: z.infer<typeof todoItemSchema>[], now: string) {
  return items.map((item) => ({
    id: item.id ?? itemId(),
    title: item.title,
    body: item.body,
    assignee: item.assignee?.replace(/^@+/, "") || null,
    completed: item.completed,
    createdAt: item.createdAt ?? now,
    completedAt: item.completed ? (item.completedAt ?? now) : null,
  }));
}

export function createTodoTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;
  const by = actorLogin ? ` (via chat by @${actorLogin})` : "";

  return {
    list_todo_lists: tool({
      description: `List todo lists in ${repoRef} (state repo todos/). Returns each list slug/title and item completion counts.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const lists = await listTodoFiles();
          return {
            lists: lists.map((list) => {
              const total = list.items.length;
              const done = list.items.filter((item) => item.completed).length;
              return {
                slug: list.slug,
                title: list.title,
                totalItems: total,
                completedItems: done,
                openItems: total - done,
                updatedAt: list.updatedAt,
              };
            }),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_todo_list: tool({
      description: `Read one todo list from ${repoRef} in full, including note-like items and each item's completed state.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidTodoSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const list = await readTodoFile(slug, octokit);
          if (!list) return { found: false, slug };
          return { found: true, list };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_or_update_todo_list: tool({
      description:
        `Create or replace a todo list in ${repoRef}. Use this to add/edit/delete/reorder items, ` +
        "or mark individual items complete/reopened. Pass the full desired items array.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe(
            "Filename slug. Omit for a new list and it will be generated from title.",
          ),
        title: z.string().trim().min(1).max(160),
        items: z.array(todoItemSchema).max(200).default([]),
      }),
      execute: async (input) => {
        const slug = input.slug ?? (await createTodoSlug(input.title));
        if (!isValidTodoSlug(slug)) return { error: `invalid slug "${slug}"` };

        try {
          const now = new Date().toISOString();
          const existing = await readTodoFile(slug, octokit);
          const list = await writeTodoFile({
            octokit,
            slug,
            title: input.title,
            items: normalizeItems(input.items, existing?.createdAt ?? now),
            createdAt: existing?.createdAt ?? now,
            sha: existing?.sha,
            message: `${existing ? "chore" : "feat"}(todos): ${
              existing ? "update" : "add"
            } ${slug}${by}`,
          });
          return {
            ok: true,
            action: existing ? "updated" : "created",
            slug: list.slug,
            title: list.title,
            itemCount: list.items.length,
            htmlUrl: dashboardTodoUrl(list.slug),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_todo_list: tool({
      description: `Delete one todo list from ${repoRef} (removes todos/<slug>.md from the state repo).`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidTodoSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const existing = await readTodoFile(slug, octokit);
          if (!existing) return { error: `todo list "${slug}" not found` };
          await deleteTodoFile(octokit, slug);
          return { ok: true, action: "deleted", slug };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
