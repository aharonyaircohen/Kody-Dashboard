/**
 * @fileType endpoint
 * @domain kody
 * @pattern files-search-api
 * @ai-summary Full-text search across repo files using GitHub's search API.
 *   GET ?q=&ref=&page= — search code and return matching lines.
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
  q: z.string().min(1),
  ref: z.string().optional(),
  page: z.string().default("1"),
  per_page: z.string().default("50"),
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
      q: searchParams.get("q") ?? "",
      ref: searchParams.get("ref") ?? undefined,
      page: searchParams.get("page") ?? "1",
      per_page: searchParams.get("per_page") ?? "50",
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }
    const { q, ref, page, per_page } = parsed.data;
    const owner = getOwner();
    const repo = getRepo();

    // Use GitHub code search
    const query = `repo:${owner}/${repo} ${q}`;
    const { data } = await octokit.search.code({
      q: query,
      ref: ref,
      per_page: parseInt(per_page, 10),
      page: parseInt(page, 10),
    });

    // Group results by file
    const resultsByFile = new Map<
      string,
      {
        path: string;
        sha: string;
        text_matches: Array<{
          fragment: string;
          matches: Array<{ indices: [number, number]; text: string }>;
          object_url: string;
          object_type: string;
        }>;
      }
    >();

    for (const item of data.items) {
      if (!resultsByFile.has(item.path)) {
        resultsByFile.set(item.path, {
          path: item.path,
          sha: item.sha,
          text_matches: [],
        });
      }
      const existing = resultsByFile.get(item.path)!;
      if (item.text_matches) {
        for (const tm of item.text_matches) {
          existing.text_matches.push({
            fragment: tm.fragment ?? "",
            matches: (tm.matches ?? []).map((m) => ({
              indices: (m.indices ?? []) as [number, number],
              text: m.text ?? "",
            })),
            object_url: tm.object_url ?? "",
            object_type: tm.object_type ?? "",
          });
        }
      }
    }

    const results = Array.from(resultsByFile.values());
    return NextResponse.json({
      total: data.total_count,
      results,
      page: parseInt(page, 10),
      per_page: parseInt(per_page, 10),
    });
  } catch (error: unknown) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  } finally {
    clearGitHubContext();
  }
}
