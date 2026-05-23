/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern profile-api
 * @ai-summary Company-profile API — GET lists profile files
 *   (`.kody/profile/<slug>.md`), POST creates a new one. The bodies are
 *   injected into the kody-direct chat system prompt so the agent knows
 *   what the company is and does.
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
  listProfileFiles,
  readProfileFile,
  writeProfileFile,
  isValidSlug,
} from "@dashboard/lib/profile/files";
import { KODY_CHAT_STAFF } from "@dashboard/lib/profile/frontmatter";

/** A staff slug (profile slug shape) or the `*` all-staff wildcard. */
const STAFF_TOKEN_RE = /^(\*|[a-z0-9][a-z0-9_-]{0,63})$/;

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const profile = await listProfileFiles();
    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error("[Profile] Error listing profile:", error);
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
      { profile: [], error: error?.message || "Failed to list profile" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const createProfileSchema = z.object({
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
    const { slug, body, staff, actorLogin } =
      createProfileSchema.parse(payload);

    if (!isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Profile slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readProfileFile(slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Profile section "${slug}" already exists.`,
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
            "A signed-in GitHub token is required to commit profile files.",
        },
        { status: 401 },
      );
    }

    const profile = await writeProfileFile({
      octokit: userOctokit,
      slug,
      body,
      staff,
    });

    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error("[Profile] Error creating profile:", error);
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
        message: error?.message ?? "Failed to create profile",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
