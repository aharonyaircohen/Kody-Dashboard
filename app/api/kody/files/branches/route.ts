/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern files-branches-api
 * @ai-summary API route to list branches for the files browser
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

const BRANCHES_SCHEMA = z.object({
  path: z.string().optional(),
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

    // Get repository info to find default branch
    const { data: repoData } = await octokit.repos.get({
      owner: getOwner(),
      repo: getRepo(),
    });

    // Get all branches
    const { data: branchesData } = await octokit.rest.repos.listBranches({
      owner: getOwner(),
      repo: getRepo(),
      per_page: 100,
    });

    const branches = branchesData.map((branch) => ({
      name: branch.name,
      protected: branch.protected,
      isDefault: branch.name === repoData.default_branch,
    }));

    return NextResponse.json({
      defaultBranch: repoData.default_branch,
      branches,
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "files/branches");
  } finally {
    clearGitHubContext();
  }
}
