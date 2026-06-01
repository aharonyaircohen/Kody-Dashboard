/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern files-search-api
 * @ai-summary API route to search files in the repository using GitHub code search
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

const SEARCH_SCHEMA = z.object({
  q: z.string().min(1),
  ref: z.string().optional(),
  per_page: z.coerce.number().min(1).max(100).default(30),
  page: z.coerce.number().min(1).default(1),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  const parsed = SEARCH_SCHEMA.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return handleKodyApiError(parsed.error, "files/search");
  }

  const { q, ref, per_page, page } = parsed.data;

  try {
    const octokit = getOctokit();

    // Use GitHub code search
    const { data } = await octokit.search.code({
      q: `${q} repo:${getOwner()}/${getRepo()}`,
      per_page,
      page,
      ref: ref || undefined,
    });

    const results = data.items.map((item) => ({
      name: item.name,
      path: item.path,
      sha: item.sha,
      url: item.url,
      git_url: item.git_url,
      html_url: item.html_url,
      repository: {
        full_name: item.repository.full_name,
        description: item.repository.description,
      },
      score: item.score,
    }));

    return NextResponse.json({
      total_count: data.total_count,
      incomplete_results: data.incomplete_results,
      results,
      query: q,
      page,
      per_page,
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "files/search");
  } finally {
    clearGitHubContext();
  }
}
