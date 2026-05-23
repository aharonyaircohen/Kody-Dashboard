/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern docs-api
 * @ai-summary Doc detail API — GET reads a single doc, PATCH updates its
 *   body/staff, DELETE removes it. Backed by `.kody/docs/<slug>.md` via the
 *   GitHub contents API. No built-ins, so a missing file is a plain 404.
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
  readDocFile,
  writeDocFile,
  deleteDocFile,
  isValidSlug,
} from "@dashboard/lib/docs/files";

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
    const doc = await readDocFile(slug);
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ doc });
  } catch (error: any) {
    console.error("[Docs] Error fetching doc:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch doc",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

/** A staff slug (doc slug shape) or the `*` all-staff wildcard. */
const STAFF_TOKEN_RE = /^(\*|[a-z0-9][a-z0-9_-]{0,63})$/;

const updateDocSchema = z
  .object({
    body: z.string().min(1).optional(),
    // May be empty — an unassigned doc owned by no staff member.
    staff: z.array(z.string().regex(STAFF_TOKEN_RE)).optional(),
    actorLogin: z.string().optional(),
  })
  .refine((v) => v.body !== undefined || v.staff !== undefined, {
    message: "At least one of `body` or `staff` must be provided.",
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
    const { body, staff, actorLogin } = updateDocSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readDocFile(slug);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

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

    // Partial update: keep whichever field the caller omitted. `body` and
    // `staff` are independent — changing the staff list alone leaves the
    // text intact.
    const doc = await writeDocFile({
      octokit: userOctokit,
      slug,
      body: body ?? existing.body,
      staff: staff ?? existing.staff,
      sha: existing.sha,
    });
    return NextResponse.json({ doc });
  } catch (error: any) {
    console.error("[Docs] Error updating doc:", error);
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
        message: error?.message ?? "Failed to update doc",
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

    const existing = await readDocFile(slug);
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
          message: "A signed-in GitHub token is required to delete doc files.",
        },
        { status: 401 },
      );
    }

    await deleteDocFile(userOctokit, slug);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Docs] Error deleting doc:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete doc",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
