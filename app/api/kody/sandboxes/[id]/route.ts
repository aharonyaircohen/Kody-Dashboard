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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function deleteGitHubSnapshot(
  req: NextRequest,
  auth: NonNullable<ReturnType<typeof getRequestAuth>>,
  path: string,
) {
  const octokit = await getUserOctokit(req);
  if (!octokit) return;
  try {
    const existing = await octokit.repos.getContent({
      owner: auth.owner,
      repo: auth.repo,
      path,
      ref: "main",
    });
    if (Array.isArray(existing.data) || existing.data.type !== "file") return;
    await octokit.repos.deleteFile({
      owner: auth.owner,
      repo: auth.repo,
      path,
      sha: existing.data.sha,
      branch: "main",
      message: `chore(kody): delete sandbox snapshot [skip ci]`,
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      err.status === 404
    ) {
      return;
    }
    throw err;
  }
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
        `.kody/sandboxes/${sandbox.scope}/${sandbox.id}/snapshot.tar.gz.enc`,
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
