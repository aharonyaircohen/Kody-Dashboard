/**
 * @fileType api-endpoint
 * @domain executables
 * @pattern executables-api
 * @ai-summary Run an executable on an issue by posting `@kody <slug>` as a
 *   comment — the same dispatch path the chat tools use. The engine resolves
 *   `<slug>` against `.kody/executables/` and runs it. Optional `args` are
 *   appended after the slug.
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
import { invalidateIssueCache } from "@dashboard/lib/github-client";
import { isValidSlug } from "@dashboard/lib/executables";
import { recordAudit } from "@dashboard/lib/activity/audit";

const bodySchema = z.object({
  issue: z.number().int().positive(),
  args: z.string().optional(),
  actorLogin: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const { issue, args, actorLogin } = bodySchema.parse(await req.json());

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message: "A signed-in GitHub token is required to comment.",
        },
        { status: 401 },
      );
    }

    const commentBody = `@kody ${slug}${args ? ` ${args}` : ""}`;
    const { data } = await userOctokit.rest.issues.createComment({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      issue_number: issue,
      body: commentBody,
    });

    invalidateIssueCache(issue);
    recordAudit(req, {
      action: "executable.run",
      resource: slug,
      detail: `ran ${slug} on #${issue}`,
    });

    return NextResponse.json({ success: true, commentUrl: data.html_url });
  } catch (error: any) {
    console.error("[Executables] Error running executable:", error);
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
    if (error?.status === 404) {
      return NextResponse.json(
        { error: "issue_not_found", message: `Issue #not found` },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: "run_failed",
        message: error?.message ?? "Failed to run executable",
      },
      { status: 500 },
    );
  }
}
