/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern file-contents-api
 * @ai-summary API route to fetch raw file contents from GitHub
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

const FILE_CONTENTS_SCHEMA = z.object({
  path: z.string(),
  ref: z.string().optional(),
});

function decodeBase64Content(content: string, encoding: string): string | null {
  if (encoding === "base64") {
    try {
      const buffer = Buffer.from(content.replace(/\n/g, ""), "base64");
      return buffer.toString("utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  const parsed = FILE_CONTENTS_SCHEMA.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return handleKodyApiError(parsed.error, "files/contents");
  }

  const { path, ref } = parsed.data;

  try {
    const octokit = getOctokit();

    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path,
      ref: ref || undefined,
    });

    // Handle file vs directory
    if (Array.isArray(data)) {
      return NextResponse.json(
        { error: "Path is a directory, not a file" },
        { status: 400 },
      );
    }

    const fileData = data as {
      name: string;
      path: string;
      size: number;
      sha: string;
      download_url: string | null;
      content?: string;
      encoding?: string;
      type?: string;
    };
    let fileContent: string | null = null;

    // Try to decode if content is base64 encoded
    if (fileData.content && fileData.encoding) {
      fileContent = decodeBase64Content(fileData.content, fileData.encoding);
    }

    return NextResponse.json({
      name: fileData.name,
      path: fileData.path,
      size: fileData.size,
      sha: fileData.sha,
      download_url: fileData.download_url,
      content: fileContent,
      encoding: fileData.encoding,
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "files/contents");
  } finally {
    clearGitHubContext();
  }
}
