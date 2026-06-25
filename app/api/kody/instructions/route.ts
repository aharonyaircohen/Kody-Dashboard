/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern instructions-api
 * @ai-summary Per-repo user instructions document at
 *   state-repo `instructions.md`. GET reads it, PUT upserts it, DELETE
 *   removes it. The body is appended to every kody-direct chat
 *   turn so users can override tone / length / formatting without
 *   touching code.
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
  readInstructionsFile,
  writeInstructionsFile,
  deleteInstructionsFile,
} from "@dashboard/lib/instructions/files";

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
    const file = await readInstructionsFile();
    return NextResponse.json(
      { instructions: file },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: any) {
    console.error("[Instructions] read failed:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: error?.message || "Failed to read instructions" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const writeSchema = z.object({
  body: z.string().max(20_000),
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
            "A signed-in GitHub token is required to commit the instructions file.",
        },
        { status: 401 },
      );
    }

    if (body.trim().length === 0) {
      await deleteInstructionsFile(userOctokit);
      return NextResponse.json({ instructions: null });
    }

    const existing = await readInstructionsFile();
    const instructions = await writeInstructionsFile({
      octokit: userOctokit,
      body,
      sha: sha ?? existing?.sha,
    });
    return NextResponse.json({ instructions });
  } catch (error: any) {
    console.error("[Instructions] write failed:", error);
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
            "Instructions were edited from elsewhere — reload the page and try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error?.message || "Failed to save instructions" },
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
    await deleteInstructionsFile(userOctokit);
    return NextResponse.json({ instructions: null });
  } catch (error: any) {
    console.error("[Instructions] delete failed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete instructions" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
