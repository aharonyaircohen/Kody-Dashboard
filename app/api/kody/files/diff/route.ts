/**
 * @fileType endpoint
 * @domain kody
 * @pattern files-diff-api
 * @ai-summary Get diff between two commits for a file.
 *   GET ?path=&base=&head= — returns unified diff between base and head commits.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
  getOwner,
  getRepo,
} from "@dashboard/lib/github-client";

const QUERY_SCHEMA = z.object({
  path: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
  ref: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const octokit = getOctokit();
    const { searchParams } = req.nextUrl;
    const parsed = QUERY_SCHEMA.safeParse({
      path: searchParams.get("path") ?? "",
      base: searchParams.get("base") ?? "",
      head: searchParams.get("head") ?? "",
      ref: searchParams.get("ref") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }
    const { path, base, head } = parsed.data;
    const owner = getOwner();
    const repo = getRepo();

    // Get the comparison API
    const { data } = await octokit.repos.compareCommits({
      owner,
      repo,
      base: `${base}`,
      head: `${head}`,
    });

    // Find the file in the comparison
    const file = data.files?.find((f) => f.filename === path);
    if (!file) {
      return NextResponse.json(
        { error: "File not found in diff" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      patch: file.patch ?? "",
      filename: file.filename,
      status: file.status,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      changes: file.changes ?? 0,
      previous_filename: file.previous_filename ?? null,
    });
  } catch (error: unknown) {
    console.error("Diff fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch diff" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
