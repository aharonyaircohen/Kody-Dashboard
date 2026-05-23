/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern docs-api
 * @ai-summary Documentation API — GET lists doc files
 *   (`.kody/docs/<slug>.md`), POST creates a new one. Docs owned by the
 *   built-in `kody` staff are injected into the kody-direct chat system
 *   prompt so the agent knows what the company is and does.
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
  listDocFiles,
  readDocFile,
  writeDocFile,
  isValidSlug,
} from "@dashboard/lib/docs/files";
import { KODY_CHAT_STAFF } from "@dashboard/lib/docs/frontmatter";

/** A staff slug (doc slug shape) or the `*` all-staff wildcard. */
const STAFF_TOKEN_RE = /^(\*|[a-z0-9][a-z0-9_-]{0,63})$/;

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const docs = await listDocFiles();
    return NextResponse.json({ docs });
  } catch (error: any) {
    console.error("[Docs] Error listing docs:", error);
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
      { docs: [], error: error?.message || "Failed to list docs" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const createDocSchema = z.object({
  slug: z.string().min(1).max(64),
  body: z.string().min(1),
  // May be empty — an unassigned doc owned by no staff member.
  staff: z.array(z.string().regex(STAFF_TOKEN_RE)).default([KODY_CHAT_STAFF]),
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
    const { slug, body, staff, actorLogin } = createDocSchema.parse(payload);

    if (!isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Doc slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readDocFile(slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Doc "${slug}" already exists.`,
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
          message: "A signed-in GitHub token is required to commit doc files.",
        },
        { status: 401 },
      );
    }

    const doc = await writeDocFile({
      octokit: userOctokit,
      slug,
      body,
      staff,
    });

    return NextResponse.json({ doc });
  } catch (error: any) {
    console.error("[Docs] Error creating doc:", error);
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
        message: error?.message ?? "Failed to create doc",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
