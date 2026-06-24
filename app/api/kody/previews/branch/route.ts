/**
 * @fileType api-endpoint
 * @domain previews
 * @pattern branch-previews-api
 *
 * Manual, PR-less Fly previews for a bare branch (e.g. `dev`).
 *
 *   POST   /api/kody/previews/branch   { branch } — build + boot a preview
 *          from the branch's current HEAD. Records the branch so the list
 *          below can show + destroy it (no PR-close webhook does that here).
 *   GET    /api/kody/previews/branch              — every tracked branch
 *          preview for the connected repo, each enriched with live Fly state.
 *   DELETE /api/kody/previews/branch   { branch } — destroy the Fly app and
 *          stop tracking the branch. Idempotent.
 *
 * Repo comes from the connected-repo auth context (this is per-repo Fly
 * infra surfaced on `/fly/config`), not the body. Fly billing uses that repo's
 * own vault `FLY_API_TOKEN` via `resolvePreviewConfigForOctokit`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import {
  readDashboardConfig,
  setBranchPreview,
} from "@dashboard/lib/dashboard-config/store";
import { logger } from "@dashboard/lib/logger";
import { resolvePreviewConfigForOctokit } from "@dashboard/lib/previews/config";
import {
  createPreview,
  destroyPreview,
  getPreview,
} from "@dashboard/lib/previews/preview-lifecycle";

export const runtime = "nodejs";

const BranchBody = z.object({
  branch: z.string().min(1).max(255),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BranchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const branch = parsed.data.branch.trim();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
  if (!cfg) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message:
          "FLY_API_TOKEN not in this repo's secrets vault and no FLY_API_TOKEN env fallback.",
      },
      { status: 503 },
    );
  }

  // Pin the build to the branch's current HEAD so a re-trigger picks up new
  // commits, and a missing branch fails loudly before we spawn a builder.
  let headSha: string;
  try {
    const res = await octokit.rest.repos.getBranch({
      owner: auth.owner,
      repo: auth.repo,
      branch,
    });
    headSha = res.data.commit.sha;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return NextResponse.json(
        { error: "branch_not_found", branch },
        { status: 404 },
      );
    }
    logger.error({ err, branch }, "branch-preview: resolve HEAD failed");
    return NextResponse.json(
      { error: "branch_lookup_failed", message: (err as Error).message },
      { status: 502 },
    );
  }

  try {
    const info = await createPreview(
      {
        repo: `${auth.owner}/${auth.repo}`,
        branch,
        ref: headSha,
        // The operator's PAT lets the builder clone private repos.
        githubToken: auth.token,
      },
      cfg,
    );
    await setBranchPreview(octokit, auth.owner, auth.repo, branch, true);
    return NextResponse.json(info, { status: 201 });
  } catch (err) {
    logger.error({ err, branch }, "branch-preview: create failed");
    return NextResponse.json(
      { error: "create_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
  // No Fly token → no previews possible; report an empty, non-error list so
  // the card can render its empty state instead of an error toast.
  if (!cfg) {
    return NextResponse.json({ previews: [], flyConfigured: false });
  }

  const { doc } = await readDashboardConfig(octokit, auth.owner, auth.repo);
  const branches = doc.branchPreviews ?? [];
  const repo = `${auth.owner}/${auth.repo}`;

  const previews = await Promise.all(
    branches.map(async (branch) => {
      try {
        const info = await getPreview({ repo, branch }, cfg);
        return info
          ? { branch, ...info }
          : { branch, state: "pending" as const, url: null };
      } catch (err) {
        logger.warn({ err, branch }, "branch-preview: status failed");
        return { branch, state: "unknown" as const, url: null };
      }
    }),
  );

  return NextResponse.json({ previews, flyConfigured: true });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BranchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const branch = parsed.data.branch.trim();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }

  const cfg = await resolvePreviewConfigForOctokit({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
  });
  if (!cfg) {
    return NextResponse.json({ error: "fly_token_missing" }, { status: 503 });
  }

  try {
    await destroyPreview({ repo: `${auth.owner}/${auth.repo}`, branch }, cfg);
    await setBranchPreview(octokit, auth.owner, auth.repo, branch, false);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, branch }, "branch-preview: destroy failed");
    return NextResponse.json(
      { error: "destroy_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
