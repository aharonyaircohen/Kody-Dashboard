/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern system-prompt-api
 * @ai-summary Per-repo base system prompt override at state-repo
 *   `system-prompt.md`. GET reads it, PUT upserts it, DELETE removes it.
 *   When present, the engine chat (kody-live) uses this INSTEAD of its
 *   built-in base prompt; absent → built-in. Mirrors the instructions API.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  readSystemPromptFile,
  writeSystemPromptFile,
  deleteSystemPromptFile,
} from "@dashboard/lib/system-prompt/files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function withRepoContext(req: NextRequest): boolean {
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) return false;
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  return true;
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  if (!withRepoContext(req)) {
    return NextResponse.json(
      { error: "no_repo" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const file = await readSystemPromptFile();
    return NextResponse.json(
      { systemPrompt: file },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: any) {
    console.error("[SystemPrompt] read failed:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: error?.message || "Failed to read system prompt" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const writeSchema = z.object({
  body: z.string().max(40_000),
  sha: z.string().optional(),
  actorLogin: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  if (!withRepoContext(req)) {
    return NextResponse.json({ error: "no_repo" }, { status: 400 });
  }
  try {
    const payload = await req.json();
    const { body, sha, actorLogin } = writeSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit the system prompt file.",
        },
        { status: 401 },
      );
    }

    if (body.trim().length === 0) {
      await deleteSystemPromptFile(userOctokit);
      return NextResponse.json({ systemPrompt: null });
    }

    const existing = await readSystemPromptFile();
    const systemPrompt = await writeSystemPromptFile({
      octokit: userOctokit,
      body,
      sha: sha ?? existing?.sha,
    });
    return NextResponse.json({ systemPrompt });
  } catch (error: any) {
    console.error("[SystemPrompt] write failed:", error);
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
    if (error?.status === 409) {
      return NextResponse.json(
        {
          error: "conflict",
          message:
            "The system prompt was edited from elsewhere — reload the page and try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error?.message || "Failed to save system prompt" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  if (!withRepoContext(req)) {
    return NextResponse.json({ error: "no_repo" }, { status: 400 });
  }
  try {
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;
    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }
    await deleteSystemPromptFile(userOctokit);
    return NextResponse.json({ systemPrompt: null });
  } catch (error: any) {
    console.error("[SystemPrompt] delete failed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete system prompt" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
