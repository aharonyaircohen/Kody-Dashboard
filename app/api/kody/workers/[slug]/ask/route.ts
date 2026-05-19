/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern worker-ask
 * @ai-summary POST /api/kody/workers/:slug/ask — fire an ad-hoc, stateless
 *   worker tick from a dashboard @mention. Posts an
 *   `@kody worker-ask --worker <slug> --thread <n>` comment (followed by the
 *   message + context as the comment body) on the repo's "Kody control"
 *   issue. The engine's `issue_comment` trigger fires kody.yml; the
 *   dispatcher routes to the `worker-ask` executable, which runs the worker
 *   persona against the message and replies into discussion #<thread>.
 *
 *   Why a comment, not a chat-trigger: a worker mention is an autonomous
 *   primitive, not a chat session — same rationale as Job "Run now"
 *   ([jobs/[slug]/run]). The message rides in the comment body (not a flag)
 *   so newlines / markdown / quoted thread context survive verbatim.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { listWorkerFiles, isValidSlug } from "@dashboard/lib/workers-files";
import { findOrCreateControlIssue } from "@dashboard/lib/control-issue";

const askSchema = z.object({
  message: z.string().trim().min(1, "message is required"),
  thread: z.number().int().positive().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const { slug } = await params;
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { owner, repo } = headerAuth;

  let payload: z.infer<typeof askSchema>;
  try {
    payload = askSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      {
        error: "no_user_token",
        message:
          "A signed-in GitHub token is required to post the dispatch comment.",
      },
      { status: 401 },
    );
  }

  // The worker persona must exist before we dispatch — a dangling slug would
  // only fail deep in the engine with no dashboard-visible feedback.
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  try {
    const workers = await listWorkerFiles();
    if (!workers.some((w) => w.slug === slug)) {
      return NextResponse.json({ error: "worker_not_found" }, { status: 404 });
    }
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: "worker_lookup_failed",
        message:
          err instanceof Error ? err.message : "Failed to resolve worker",
      },
      { status: 502 },
    );
  } finally {
    clearGitHubContext();
  }

  try {
    const issueNumber = await findOrCreateControlIssue(octokit, owner, repo);
    const threadFlag =
      payload.thread !== undefined ? ` --thread ${payload.thread}` : "";
    // Directive line first (engine strips it); message + context verbatim
    // after a blank line so markdown/newlines survive.
    const body = `@kody worker-ask --worker ${slug}${threadFlag}\n\n${payload.message}`;
    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return NextResponse.json({
      ok: true,
      issueNumber,
      commentId: comment.id,
      commentUrl: comment.html_url,
    });
  } catch (err: unknown) {
    console.error("[workers/ask] dispatch failed", err);
    return NextResponse.json(
      {
        error: "dispatch_failed",
        message:
          err instanceof Error
            ? err.message
            : "Failed to post dispatch comment",
      },
      { status: 500 },
    );
  }
}
