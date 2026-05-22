/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern prompts-api
 * @ai-summary Prompt Control API — GET lists prompts (builtins merged
 *   with `.kody/prompts/<slug>.md`), POST creates a new repo prompt.
 *   Slash commands in the chat input are populated from this endpoint.
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
  listPrompts,
  readPromptFile,
  writePromptFile,
  isValidSlug,
} from "@dashboard/lib/prompts";
import { recordAudit } from "@dashboard/lib/activity/audit";

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const prompts = await listPrompts();
    return NextResponse.json({ prompts });
  } catch (error: any) {
    console.error("[Prompts] Error listing prompts:", error);
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
      { prompts: [], error: error?.message || "Failed to list prompts" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const createPromptSchema = z.object({
  slug: z.string().min(1).max(64),
  description: z.string().default(""),
  argumentHint: z.string().optional(),
  body: z.string().min(1),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json();
    const { slug, description, argumentHint, body, actorLogin } =
      createPromptSchema.parse(payload);

    if (!isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Prompt slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readPromptFile(slug);
    if (existing) {
      return NextResponse.json(
        { error: "slug_taken", message: `Prompt "${slug}" already exists.` },
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
            "A signed-in GitHub token is required to commit prompt files.",
        },
        { status: 401 },
      );
    }

    const prompt = await writePromptFile({
      octokit: userOctokit,
      slug,
      description,
      argumentHint,
      body,
    });

    recordAudit(req, {
      action: "prompt.create",
      resource: slug,
      detail: `created prompt /${slug}`,
    });

    return NextResponse.json({ prompt });
  } catch (error: any) {
    console.error("[Prompts] Error creating prompt:", error);
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
        message: error?.message ?? "Failed to create prompt",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
