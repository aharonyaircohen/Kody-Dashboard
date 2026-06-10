/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern memory-api
 * @ai-summary Memory API — GET lists `.kody/memory/<id>.md` files, POST
 *   creates one. The index file is rebuilt by the storage helper after writes.
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
  invalidateMemoryIndexPromptCache,
  isValidMemoryId,
  listMemoryFiles,
  MEMORY_TYPES,
  readMemoryFile,
  writeMemoryFile,
  type MemoryType,
} from "@dashboard/lib/memory-files";

const memoryTypeSchema = z.enum(MEMORY_TYPES);

const createMemorySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(240),
  type: memoryTypeSchema,
  body: z.string().min(1),
  actorLogin: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const memories = await listMemoryFiles();
    return NextResponse.json({ memories });
  } catch (error: any) {
    console.error("[Memory] Error listing memories:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    if (error?.status === 403 || error?.message?.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { memories: [], error: error?.message || "Failed to list memories" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json();
    const { id, name, description, type, body, actorLogin } =
      createMemorySchema.parse(payload);

    if (!isValidMemoryId(id)) {
      return NextResponse.json(
        {
          error: "invalid_memory_id",
          message:
            "Memory id must use lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readMemoryFile(id);
    if (existing) {
      return NextResponse.json(
        {
          error: "memory_taken",
          message: `Memory "${id}" already exists.`,
        },
        { status: 409 },
      );
    }

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

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
      body,
      meta: {
        name,
        description,
        type: type as MemoryType,
        created: new Date().toISOString(),
      },
    });
    invalidateMemoryIndexPromptCache();

    return NextResponse.json({ memory });
  } catch (error: any) {
    console.error("[Memory] Error creating memory:", error);
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
        error: "create_failed",
        message: error?.message ?? "Failed to create memory",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
