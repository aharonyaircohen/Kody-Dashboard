/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern files-diff-api
 * @ai-summary API route to get diff between two refs (branches, commits, etc.)
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
  getOwner,
  getRepo,
} from "@dashboard/lib/github-client";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";

const DIFF_SCHEMA = z.object({
  base: z.string(),
  head: z.string(),
  path: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  const parsed = DIFF_SCHEMA.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return handleKodyApiError(parsed.error, "files/diff");
  }

  const { base, head, path } = parsed.data;

  try {
    const octokit = getOctokit();

    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner: getOwner(),
      repo: getRepo(),
      basehead: `${base}...${head}`,
    });

    // Filter by path if provided
    let files = data.files || [];
    if (path) {
      files = files.filter(
        (file) =>
          file.filename === path || file.filename.startsWith(path + "/"),
      );
    }

    const diffData = {
      base,
      head,
      status: data.status,
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      total_commits: data.total_commits,
      files: files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
        raw_url: file.raw_url,
        contents_url: file.contents_url,
        blob_url: file.blob_url,
        previous_filename: file.previous_filename,
      })),
    };

    return NextResponse.json(diffData);
  } catch (error: unknown) {
    return handleKodyApiError(error, "files/diff");
  } finally {
    clearGitHubContext();
  }
}
