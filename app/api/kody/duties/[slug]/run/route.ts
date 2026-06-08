/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern duty-run
 * @ai-summary POST /api/kody/duties/:slug/run — manually trigger a single
 *   duty by posting an `@kody duty-tick --duty <slug> --force` comment on
 *   the repo's "Kody control" issue. The engine's existing `issue_comment`
 *   trigger fires kody.yml; the dispatcher routes to `duty-tick` (the
 *   engine renamed `job-tick` → `duty-tick` and `--job` → `--duty` to
 *   match the dashboard's "duty" noun).
 *
 *   Why a comment, not a chat-trigger fake: duties are autonomous primitives,
 *   not chat sessions. This path uses three established conventions
 *   (`@kody <subcommand>`, `duty-tick --duty <slug>`, `issue_comment` trigger)
 *   without overloading any of them — and crucially without needing
 *   `KODY_MASTER_KEY` for HMAC signing, since no chat session is being minted.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { isValidSlug } from "@dashboard/lib/duties-files";
import { findOrCreateControlIssue } from "@dashboard/lib/control-issue";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { buildDutyRunCommentBody } from "@dashboard/lib/duties/run-comment";

const runSchema = z.object({
  force: z.boolean().optional().default(true),
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

  let payload: { force: boolean };
  try {
    const raw =
      req.headers.get("content-length") === "0"
        ? {}
        : await req.json().catch(() => ({}));
    payload = runSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: err.issues },
        { status: 400 },
      );
    }
    payload = { force: true };
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

  try {
    const issueNumber = await findOrCreateControlIssue(octokit, owner, repo);
    // Engine renamed the dispatch: `job-tick --job` → `duty-tick --duty`.
    // `--force` still bypasses the cadence guard so the manual "Run now"
    // button on the dashboard fires regardless of `every:` / `disabled:`.
    const body = buildDutyRunCommentBody({
      slug,
      force: payload.force,
    });
    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    recordAudit(req, {
      action: "duty.run",
      resource: slug,
      duty: slug,
      resourceUrl: comment.html_url,
      detail: payload.force ? "manual run (force)" : "manual run",
    });
    return NextResponse.json({
      ok: true,
      issueNumber,
      commentId: comment.id,
      commentUrl: comment.html_url,
      force: payload.force,
    });
  } catch (err: any) {
    console.error("[duties/run] dispatch failed", err);
    return NextResponse.json(
      {
        error: "dispatch_failed",
        message: err?.message ?? "Failed to post dispatch comment",
      },
      { status: 500 },
    );
  }
}
