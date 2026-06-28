/**
 * @fileType api-endpoint
 * @domain todos
 * @pattern todo-list-detail-api
 * @ai-summary Todo-list detail API — GET reads one state-repo `todos/<slug>.md`,
 * PATCH edits list title/items, DELETE removes it.
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
  deleteTodoFile,
  isValidTodoSlug,
  readTodoFile,
  writeTodoFile,
} from "@dashboard/lib/todos/files";

const todoItemSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(20_000).default(""),
  assignee: z.string().trim().max(120).nullable().optional(),
  completed: z.boolean().default(false),
  createdAt: z.string(),
  completedAt: z.string().nullable().optional(),
});

const updateTodoListSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(20_000).optional(),
    items: z.array(todoItemSchema).max(200).optional(),
    actorLogin: z.string().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.items !== undefined,
    {
      message: "At least one todo-list field must be provided.",
    },
  );

function normalizeUpdateItems(items: z.infer<typeof todoItemSchema>[]) {
  return items.map((item) => ({
    ...item,
    assignee: item.assignee?.replace(/^@+/, "") || null,
    completedAt: item.completed
      ? (item.completedAt ?? new Date().toISOString())
      : null,
  }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { slug } = await params;
    if (!isValidTodoSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const todo = await readTodoFile(slug);
    if (!todo)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ todo });
  } catch (error: unknown) {
    console.error("[Todos] Error fetching todo list:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message:
          (error as { message?: string })?.message ??
          "Failed to fetch todo list",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { slug } = await params;
    if (!isValidTodoSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const payload = await req.json();
    const { title, description, items, actorLogin } =
      updateTodoListSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readTodoFile(slug);
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

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

    const todo = await writeTodoFile({
      octokit: userOctokit,
      slug,
      title: title ?? existing.title,
      description: description ?? existing.description,
      items: items ? normalizeUpdateItems(items) : existing.items,
      createdAt: existing.createdAt,
      sha: existing.sha,
    });

    return NextResponse.json({ todo });
  } catch (error: unknown) {
    console.error("[Todos] Error updating todo list:", error);
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
        error: "update_failed",
        message:
          (error as { message?: string })?.message ??
          "Failed to update todo list",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { slug } = await params;
    if (!isValidTodoSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const existing = await readTodoFile(slug);
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const actorLogin = searchParams.get("actorLogin") ?? undefined;
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message: "A signed-in GitHub token is required to delete todo lists.",
        },
        { status: 401 },
      );
    }

    await deleteTodoFile(userOctokit, slug);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("[Todos] Error deleting todo list:", error);
    if ((error as { status?: number })?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message:
          (error as { message?: string })?.message ??
          "Failed to delete todo list",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
