/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern worker-run
 * @ai-summary POST /api/kody/workers/:slug/run — manually trigger a single
 *   worker by posting an `@kody worker-tick --job <slug> [--force]` comment
 *   on the repo's "Kody control" issue. The engine's existing `issue_comment`
 *   trigger fires kody.yml; the dispatcher routes to the `worker-tick`
 *   executable, which reads `.kody/workers/<slug>.md` (parallel to
 *   `job-tick` for `.kody/jobs/`).
 *
 *   Why a comment, not a chat-trigger fake: workers are autonomous
 *   primitives, not chat sessions. This path uses three established
 *   conventions (`@kody <subcommand>`, `worker-tick --job <slug>`,
 *   `issue_comment` trigger) without overloading any of them — and crucially
 *   without needing `KODY_MASTER_KEY` for HMAC signing, since no chat
 *   session is being minted.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { isValidSlug } from "@dashboard/lib/workers-files";
import { INTERNAL_ISSUE_LABEL } from "@dashboard/lib/constants";

const CONTROL_LABEL = "kody:control";
const CONTROL_TITLE = "Kody control";
const CONTROL_BODY = [
  "Audit trail for manual `@kody` dispatches from the dashboard.",
  "",
  'Each comment below was a "Run now" click in Job/Worker Control. The',
  "engine fires on `issue_comment` and routes to the named executable.",
  "",
  "Do not close — the dashboard reuses this issue. If you do close it,",
  "the next dispatch will create a new one.",
].join("\n");

const runSchema = z.object({
  force: z.boolean().optional().default(true),
});

async function ensureControlLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: CONTROL_LABEL });
  } catch (err: any) {
    if (err?.status !== 404) throw err;
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name: CONTROL_LABEL,
      color: "ededed",
      description:
        "Kody manual control issue — audit trail for dashboard dispatches",
    });
  }
}

async function findOrCreateControlIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<number> {
  // Reuse the most recent open kody:control issue if one exists.
  const { data: existing } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: CONTROL_LABEL,
    state: "open",
    per_page: 1,
  });
  if (existing.length > 0 && existing[0]) return existing[0].number;

  await ensureControlLabel(octokit, owner, repo);

  const { data: created } = await octokit.rest.issues.create({
    owner,
    repo,
    title: CONTROL_TITLE,
    body: CONTROL_BODY,
    // `kody:internal` is the umbrella label every infra issue carries so the
    // task list can exclude them all by one label (GitHub auto-creates it).
    labels: [CONTROL_LABEL, INTERNAL_ISSUE_LABEL],
  });
  return created.number;
}

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
    // Route to the engine's `worker-tick` executable, which reads
    // `.kody/workers/<slug>.md` (parallel to `job-tick` for jobs).
    const flags = payload.force ? `--job ${slug} --force` : `--job ${slug}`;
    const body = `@kody worker-tick ${flags}`;
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
      force: payload.force,
    });
  } catch (err: any) {
    console.error("[workers/run] dispatch failed", err);
    return NextResponse.json(
      {
        error: "dispatch_failed",
        message: err?.message ?? "Failed to post dispatch comment",
      },
      { status: 500 },
    );
  }
}
