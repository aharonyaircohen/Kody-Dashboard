/**
 * @fileType endpoint
 * @domain kody
 * @pattern files-commits-api
 * @ai-summary Get commit history for a file path (for the diff viewer).
 *   GET ?path=&ref=&per_page= — list commits touching this file.
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
  ref: z.string().optional(),
  per_page: z.string().default("30"),
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
      ref: searchParams.get("ref") ?? undefined,
      per_page: searchParams.get("per_page") ?? "30",
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }
    const { path, ref, per_page } = parsed.data;
    const owner = getOwner();
    const repo = getRepo();

    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      path,
      sha: ref,
      per_page: parseInt(per_page, 10),
    });

    const commits = data.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name ?? c.commit.author?.email ?? "unknown",
      date: c.commit.author?.date ?? new Date().toISOString(),
      html_url: c.html_url,
    }));

    return NextResponse.json({ commits });
  } catch (error: unknown) {
    console.error("Commits fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch commits" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
