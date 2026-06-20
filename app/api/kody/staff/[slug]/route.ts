/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern staff-api
 * @ai-summary Staff detail API — GET reads a single staff file, PATCH
 *   updates the title/body, DELETE removes the file. Backed by
 *   `.kody/staff/<slug>.md` via the GitHub contents API. Duplicated
 *   from the duties detail API.
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
  readStaffFile,
  readResolvedStaffFile,
  writeStaffFile,
  deleteStaffFile,
  isValidSlug,
} from "@dashboard/lib/staff-files";
import { recordAudit } from "@dashboard/lib/activity/audit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const staffMember = await readResolvedStaffFile(slug);
    if (!staffMember) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ staffMember });
  } catch (error: any) {
    console.error("[Staff] Error fetching staff member:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch staff member",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const updateStaffSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  actorLogin: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const existing = await readStaffFile(slug);
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const payload = await req.json();
    const { title, body, actorLogin } = updateStaffSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit staff files.",
        },
        { status: 401 },
      );
    }

    const staffMember = await writeStaffFile({
      octokit: userOctokit,
      slug,
      title: title ?? existing.title,
      body: body ?? existing.body,
      sha: existing.sha,
    });

    recordAudit(req, {
      action: "staff.update",
      resource: slug,
      staff: slug,
      detail: "edited staff",
    });

    return NextResponse.json({ staffMember });
  } catch (error: any) {
    console.error("[Staff] Error updating staff member:", error);

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
        message: error?.message ?? "Failed to update staff member",
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
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const existing = await readStaffFile(slug);
    if (!existing) {
      return NextResponse.json({ success: true, alreadyMissing: true });
    }

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
            "A signed-in GitHub token is required to delete staff files.",
        },
        { status: 401 },
      );
    }

    await deleteStaffFile(userOctokit, slug);

    recordAudit(req, {
      action: "staff.delete",
      resource: slug,
      staff: slug,
      detail: "deleted staff",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Staff] Error deleting staff member:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete staff member",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
