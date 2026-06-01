/**
 * @fileType endpoint
 * @domain kody
 * @pattern files-branches-api
 * @ai-summary List all branches for the repo (for the branch selector in the file browser).
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
  ref: z.string().optional(), // if provided, just check if branch exists
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
    const owner = getOwner();
    const repo = getRepo();

    const { searchParams } = req.nextUrl;
    const parsed = QUERY_SCHEMA.safeParse({
      ref: searchParams.get("ref") ?? undefined,
    });

    // If ref is provided, just verify the branch exists
    if (parsed.success && parsed.data.ref) {
      try {
        const { data } = await octokit.repos.getBranch({
          owner,
          repo,
          branch: parsed.data.ref,
        });
        return NextResponse.json({
          name: data.name,
          protected: data.protected,
        });
      } catch {
        return NextResponse.json(
          { error: "Branch not found" },
          { status: 404 },
        );
      }
    }

    // List all branches
    const { data: branches } = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    // Also get the default branch
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    return NextResponse.json({
      branches: branches.map((b: { name: string; protected: boolean }) => ({
        name: b.name,
        isDefault: b.name === defaultBranch,
        protected: b.protected,
      })),
      defaultBranch,
    });
  } catch (error: unknown) {
    console.error("Branches fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch branches" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
