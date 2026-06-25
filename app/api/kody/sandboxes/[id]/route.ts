/**
 * @fileType api-endpoint
 * @domain sandboxes
 * @pattern local-sandbox-delete
 *
 * DELETE one local dev sandbox profile.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import {
  deleteLocalSandbox,
  getLocalSandbox,
} from "@dashboard/lib/sandboxes/local-sandboxes";
import { githubActionsSandboxSnapshotPath } from "@dashboard/lib/sandboxes/github-actions-snapshot";
import {
  deleteStateFile,
  readStateFileMetadata,
} from "@dashboard/lib/state-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function deleteGitHubSnapshot(
  req: NextRequest,
  auth: NonNullable<ReturnType<typeof getRequestAuth>>,
  path: string,
) {
  const octokit = await getUserOctokit(req);
  if (!octokit) return;
  const existing = await readStateFileMetadata(
    octokit,
    auth.owner,
    auth.repo,
    path,
  );
  if (!existing) return;
  await deleteStateFile({
    octokit,
    owner: auth.owner,
    repo: auth.repo,
    path,
    sha: existing.sha,
    message: `chore(kody): delete sandbox snapshot [skip ci]`,
  });
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const sandbox = await getLocalSandbox(auth, id);
    if (sandbox?.runtime === "github-actions") {
      await deleteGitHubSnapshot(
        req,
        auth,
        githubActionsSandboxSnapshotPath(sandbox),
      );
    }
    const deleted = await deleteLocalSandbox(auth, id);
    if (!deleted) {
      return NextResponse.json({ error: "sandbox_not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete sandbox";
    return NextResponse.json(
      { error: "sandbox_delete_failed", message },
      { status: 500 },
    );
  }
}
