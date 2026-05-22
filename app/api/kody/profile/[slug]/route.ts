/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern profile-api
 * @ai-summary Profile detail API — GET reads a single profile section,
 *   PATCH updates its body, DELETE removes it. Backed by
 *   `.kody/profile/<slug>.md` via the GitHub contents API. No built-ins,
 *   so a missing file is a plain 404.
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
  readProfileFile,
  writeProfileFile,
  deleteProfileFile,
  isValidSlug,
} from "@dashboard/lib/profile/files";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const file = await readProfileFile(slug);
    if (!file)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ profile: file });
  } catch (error: any) {
    console.error("[Profile] Error fetching profile:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch profile",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const updateProfileSchema = z
  .object({
    body: z.string().min(1).optional(),
    audience: z.array(z.enum(["chat", "qa"])).nonempty().optional(),
    actorLogin: z.string().optional(),
  })
  .refine((v) => v.body !== undefined || v.audience !== undefined, {
    message: "At least one of `body` or `audience` must be provided.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const payload = await req.json();
    const { body, audience, actorLogin } = updateProfileSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readProfileFile(slug);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

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

    // Partial update: keep whichever field the caller omitted. `body` and
    // `audience` are independent — changing the audience alone leaves the
    // text intact.
    const profile = await writeProfileFile({
      octokit: userOctokit,
      slug,
      body: body ?? existing.body,
      audience: audience ?? existing.audience,
      sha: existing.sha,
    });
    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error("[Profile] Error updating profile:", error);
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
        message: error?.message ?? "Failed to update profile",
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
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const existing = await readProfileFile(slug);
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
            "A signed-in GitHub token is required to delete profile files.",
        },
        { status: 401 },
      );
    }

    await deleteProfileFile(userOctokit, slug);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Profile] Error deleting profile:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete profile",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
