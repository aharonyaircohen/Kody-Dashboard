/**
 * @fileType api-endpoint
 * @domain todos
 * @pattern todo-lists-api
 * @ai-summary Kody todo-lists API — GET lists state-repo `todos/*.md`, POST
 * creates a new repo-scoped todo list with optional note-like items.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  createTodoSlug,
  listTodoFiles,
  writeTodoFile,
} from "@dashboard/lib/todos/files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const todoItemSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(20_000).default(""),
  assignee: z.string().trim().max(120).nullable().optional(),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const createTodoListSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(20_000).default(""),
  items: z.array(todoItemSchema).max(200).default([]),
  actorLogin: z.string().optional(),
});

function itemId(): string {
  return `item-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeCreateItems(
  items: z.infer<typeof todoItemSchema>[],
  now: string,
) {
  return items.map((item) => ({
    id: item.id ?? itemId(),
    title: item.title,
    body: item.body,
    assignee: item.assignee?.replace(/^@+/, "") || null,
    completed: item.completed,
    createdAt: item.createdAt ?? now,
    completedAt: item.completed ? (item.completedAt ?? now) : null,
    ...(item.meta ? { meta: item.meta } : {}),
  }));
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const todos = await listTodoFiles();
    return NextResponse.json({ todos }, { headers: NO_STORE_HEADERS });
  } catch (error: unknown) {
    console.error("[Todos] Error listing todo lists:", error);
    if ((error as { status?: number })?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    if (
      (error as { status?: number })?.status === 403 ||
      (error as { message?: string })?.message?.includes("rate limit")
    ) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        todos: [],
        error:
          (error as { message?: string })?.message ||
          "Failed to list todo lists",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const payload = await req.json();
    const { title, description, items, actorLogin } =
      createTodoListSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message: "A signed-in GitHub token is required to commit todo lists.",
        },
        { status: 401 },
      );
    }

    const now = new Date().toISOString();
    const slug = await createTodoSlug(title);
    const todo = await writeTodoFile({
      octokit: userOctokit,
      slug,
      title,
      description,
      items: normalizeCreateItems(items, now),
      createdAt: now,
    });

    return NextResponse.json({ todo });
  } catch (error: unknown) {
    console.error("[Todos] Error creating todo list:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    if ((error as { status?: number })?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "create_failed",
        message:
          (error as { message?: string })?.message ??
          "Failed to create todo list",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
