/**
 * @fileType api-endpoint
 * @domain docs
 * @pattern docs-api
 *
 * GET /api/kody/docs — Lists README.md + docs/*.md from the connected repo.
 * GET /api/kody/docs?path=<path> — Returns content + metadata for a single doc.
 * Read-only: docs are maintained in PRs. Returns an empty manifest when no
 * docs exist yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { listDocs, readDoc } from "@dashboard/lib/docs/file";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const octokit = getOctokit();
    const owner = headerAuth?.owner ?? process.env.GITHUB_OWNER ?? "";
    const repo = headerAuth?.repo ?? process.env.GITHUB_REPO ?? "";
    if (!owner || !repo) {
      return NextResponse.json(
        { error: "missing_repo_context" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path");

    if (path) {
      // Return a single doc
      const file = await readDoc(octokit, owner, repo, path);
      return NextResponse.json({
        name: file.name,
        path: file.path,
        content: file.content,
        htmlUrl: file.htmlUrl,
      });
    }

    // Return the manifest (list all docs)
    const manifest = await listDocs(octokit, owner, repo);
    return NextResponse.json({ files: manifest.files });
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    if (status === 403 || message.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearGitHubContext();
  }
}
