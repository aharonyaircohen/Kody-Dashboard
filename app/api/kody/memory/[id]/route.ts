/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern memory-api
 * @ai-summary Memory detail API — GET reads one memory, PATCH updates it,
 *   DELETE removes it. Backed by `memory/<id>.md` in the state repo.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  deleteMemoryFile,
  invalidateMemoryIndexPromptCache,
  isValidMemoryId,
  MEMORY_TYPES,
  readMemoryFile,
  writeMemoryFile,
  type MemoryType,
} from "@dashboard/lib/memory-files";

const memoryTypeSchema = z.enum(MEMORY_TYPES);

const updateMemorySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(240).optional(),
    type: memoryTypeSchema.optional(),
    body: z.string().min(1).optional(),
    actorLogin: z.string().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.type !== undefined ||
      v.body !== undefined,
    {
      message:
        "At least one of `name`, `description`, `type`, or `body` must be provided.",
    },
  );

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { id } = await params;
    if (!isValidMemoryId(id)) {
      return NextResponse.json({ error: "invalid_memory_id" }, { status: 400 });
    }
    const memory = await readMemoryFile(id);
    if (!memory)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ memory });
  } catch (error: any) {
    console.error("[Memory] Error fetching memory:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch memory",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { id } = await params;
    if (!isValidMemoryId(id)) {
      return NextResponse.json({ error: "invalid_memory_id" }, { status: 400 });
    }

    const payload = await req.json();
    const { name, description, type, body, actorLogin } =
      updateMemorySchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readMemoryFile(id);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit memory files.",
        },
        { status: 401 },
      );
    }

    const memory = await writeMemoryFile({
      octokit: userOctokit,
      id,
      body: body ?? existing.body,
      sha: existing.sha,
      meta: {
        name: name ?? existing.meta.name,
        description: description ?? existing.meta.description,
        type: (type as MemoryType | undefined) ?? existing.meta.type,
        created: existing.meta.created,
      },
    });
    invalidateMemoryIndexPromptCache();

    return NextResponse.json({ memory });
  } catch (error: any) {
    console.error("[Memory] Error updating memory:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "update_failed",
        message: error?.message ?? "Failed to update memory",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { id } = await params;
    if (!isValidMemoryId(id)) {
      return NextResponse.json({ error: "invalid_memory_id" }, { status: 400 });
    }

    const existing = await readMemoryFile(id);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const actorLogin = searchParams.get("actorLogin") ?? undefined;
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to delete memory files.",
        },
        { status: 401 },
      );
    }

    await deleteMemoryFile(userOctokit, id);
    invalidateMemoryIndexPromptCache();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Memory] Error deleting memory:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete memory",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
