/**
 * @fileType endpoint
 * @domain kody
 * @pattern files-contents-api
 * @ai-summary GitHub Contents API proxy for the file browser.
 *   GET ?path=&ref= — list directory OR read file (returns content + metadata).
 *   Pass a `path` ending in / for directory listing; any other path reads the file.
 *   All operations use the user token when available for write attribution.
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
  path: z.string().default(""),
  ref: z.string().optional(),
});

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { data: unknown; expires: number }>();

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

function cacheKey(owner: string, repo: string, ref: string, path: string) {
  return `files:${owner}:${repo}:${ref}:${path}`;
}

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
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }
    const { path, ref } = parsed.data;
    const branchRef = ref ?? "HEAD";
    const owner = getOwner();
    const repo = getRepo();
    const key = cacheKey(owner, repo, branchRef, path);

    // Directory listing
    if (path.endsWith("/") || path === "") {
      const cached = getCached(key);
      if (cached) return NextResponse.json(cached);

      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: path === "" ? "" : path,
        ref: branchRef,
      });

      if (!Array.isArray(data)) {
        return NextResponse.json({ error: "Not a directory" }, { status: 400 });
      }

      const entries = data.map(
        (e: {
          name: string;
          path: string;
          type: string;
          size?: number;
          sha: string;
          download_url?: string | null;
        }) => ({
          name: e.name,
          path: e.path,
          type: e.type,
          size: e.size ?? 0,
          sha: e.sha,
          downloadUrl: e.download_url ?? null,
        }),
      );

      const result = { entries, path, ref: branchRef };
      setCache(key, result);
      return NextResponse.json(result);
    }

    // File read
    const cached = getCached(key);
    if (cached) return NextResponse.json(cached);

    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branchRef,
    });

    if (Array.isArray(data)) {
      return NextResponse.json({ error: "Is a directory" }, { status: 400 });
    }

    if (!("content" in data) || !data.content) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Decode base64 content
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    // Get last commit for this file
    let lastCommit = null;
    try {
      const commits = await octokit.repos.listCommits({
        owner,
        repo,
        path,
        per_page: 1,
      });
      if (commits.data[0]) {
        const c = commits.data[0];
        lastCommit = {
          sha: c.sha,
          author: c.commit.author?.name ?? c.commit.author?.email ?? "unknown",
          date: c.commit.author?.date ?? new Date().toISOString(),
          message: c.commit.message,
        };
      }
    } catch {
      // Ignore commit fetch errors
    }

    const result = {
      content,
      path,
      ref: branchRef,
      sha: data.sha,
      size: data.size ?? 0,
      lastCommit,
      name: path.split("/").pop() ?? path,
    };

    setCache(key, result);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("Error fetching file contents:", error);
    return NextResponse.json(
      { error: "Failed to fetch contents" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
