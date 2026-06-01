/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern files-commits-api
 * @ai-summary API route to list commit history for a file or path
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

const COMMITS_SCHEMA = z.object({
  path: z.string().optional(),
  ref: z.string().optional(),
  per_page: z.coerce.number().min(1).max(100).default(30),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  const parsed = COMMITS_SCHEMA.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return handleKodyApiError(parsed.error, "files/commits");
  }

  const { path, ref, per_page } = parsed.data;

  try {
    const octokit = getOctokit();

    const params: {
      owner: string;
      repo: string;
      per_page: number;
      sha?: string;
    } = {
      owner: getOwner(),
      repo: getRepo(),
      per_page,
    };

    if (ref) {
      params.sha = ref;
    }

    const { data: commits } = await octokit.rest.repos.listCommits(params);

    // Filter by path if provided
    let filteredCommits = commits;
    if (path) {
      filteredCommits = commits.filter((commit) =>
        commit.files?.some(
          (file) =>
            file.filename === path || file.filename.startsWith(path + "/"),
        ),
      );
    }

    const commitList = filteredCommits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author?.name,
        email: commit.commit.author?.email,
        date: commit.commit.author?.date,
      },
      committer: {
        name: commit.commit.committer?.name,
        email: commit.commit.committer?.email,
        date: commit.commit.committer?.date,
      },
      html_url: commit.html_url,
    }));

    return NextResponse.json({
      commits: commitList,
      path: path || null,
      ref: ref || null,
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "files/commits");
  } finally {
    clearGitHubContext();
  }
}
