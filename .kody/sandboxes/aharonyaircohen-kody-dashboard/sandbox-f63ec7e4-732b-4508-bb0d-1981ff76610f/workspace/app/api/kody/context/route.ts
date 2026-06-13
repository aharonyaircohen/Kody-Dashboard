/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern context-api
 * @ai-summary Context API — GET lists context entries
 *   (`.kody/context/<slug>.md`), POST creates a new one. Entries owned by the
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
  listContextFiles,
  readContextFile,
  writeContextFile,
  isValidSlug,
} from "@dashboard/lib/context/files";
import { KODY_CHAT_STAFF } from "@dashboard/lib/context/frontmatter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

/** A staff slug (entry slug shape) or the `*` all-staff wildcard. */
const STAFF_TOKEN_RE = /^(\*|[a-z0-9][a-z0-9_-]{0,63})$/;

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const entries = await listContextFiles();
    return NextResponse.json({ entries }, { headers: NO_STORE_HEADERS });
  } catch (error: any) {
    console.error("[Context] Error listing context:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    if (error?.status === 403 || error?.message?.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { entries: [], error: error?.message || "Failed to list context" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const createContextSchema = z.object({
  slug: z.string().min(1).max(64),
  body: z.string().min(1),
  // May be empty — an unassigned entry owned by no staff member.
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
      createContextSchema.parse(payload);

    if (!isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Context slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readContextFile(slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Context entry "${slug}" already exists.`,
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
            "A signed-in GitHub token is required to commit context files.",
        },
        { status: 401 },
      );
    }

    const entry = await writeContextFile({
      octokit: userOctokit,
      slug,
      body,
      staff,
    });

    return NextResponse.json({ entry });
  } catch (error: any) {
    console.error("[Context] Error creating context entry:", error);
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
        message: error?.message ?? "Failed to create context entry",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
