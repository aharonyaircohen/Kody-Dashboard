/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern files-api
 * @ai-summary API route to list directory contents from GitHub repository
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

const LIST_FILES_SCHEMA = z.object({
  path: z.string().default(""),
  ref: z.string().optional(),
});

const PUT_FILE_SCHEMA = z.object({
  path: z.string(),
  content: z.string(),
  message: z.string(),
  branch: z.string().optional(),
  sha: z.string().optional(), // for updates
});

const DELETE_FILE_SCHEMA = z.object({
  path: z.string(),
  ref: z.string().optional(),
  message: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  const parsed = LIST_FILES_SCHEMA.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return handleKodyApiError(parsed.error, "files");
  }

  const { path, ref } = parsed.data;

  try {
    const octokit = getOctokit();

    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: path || "",
      ref: ref || undefined,
    });

    // If path points to a file, return it directly
    if (!Array.isArray(data)) {
      const isSymlink = data.type === "symlink";
      const fileResponse: Record<string, unknown> = {
        type: isSymlink ? "symlink" : "file",
        name: data.name,
        path: data.path,
        size: data.size,
        sha: data.sha,
        download_url: data.download_url,
      };

      if (!isSymlink) {
        fileResponse.content = (data as { content?: string }).content;
        fileResponse.encoding = (data as { encoding?: string }).encoding;
      }

      return NextResponse.json(fileResponse);
    }

    // Return directory listing
    const items = data.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type, // "file" or "dir"
      size: item.size,
      sha: item.sha,
      download_url: item.download_url,
    }));

    return NextResponse.json({
      type: "dir",
      path,
      items,
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "files");
  } finally {
    clearGitHubContext();
  }
}

// PUT /api/kody/files - Create or update a file
export async function PUT(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const body = await req.json();
    const parsed = PUT_FILE_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return handleKodyApiError(parsed.error, "files");
    }

    const { path, content, message, branch, sha } = parsed.data;

    // First, get the current file to get its SHA (if it exists and no sha provided)
    let fileSha = sha;
    if (!fileSha) {
      try {
        const { data } = await getOctokit().repos.getContent({
          owner: getOwner(),
          repo: getRepo(),
          path,
          ref: branch || undefined,
        });
        if (!Array.isArray(data)) {
          fileSha = data.sha;
        }
      } catch {
        // File doesn't exist, will create new
      }
    }

    const { data } = await getOctokit().repos.createOrUpdateFileContents({
      owner: getOwner(),
      repo: getRepo(),
      path,
      message,
      content,
      branch: branch || undefined,
      sha: fileSha,
    });

    return NextResponse.json({
      commit: {
        sha: data.commit.sha,
        message: data.commit.message,
        html_url: data.commit.html_url,
      },
      content: data.content
        ? {
            name: data.content.name,
            path: data.content.path,
            sha: data.content.sha,
          }
        : null,
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "files");
  } finally {
    clearGitHubContext();
  }
}

// DELETE /api/kody/files - Delete a file
export async function DELETE(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { searchParams } = req.nextUrl;
    const path = searchParams.get("path");
    const ref = searchParams.get("ref");
    const message = searchParams.get("message") || `Delete ${path}`;

    if (!path) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    // Get the file to get its SHA
    const { data } = await getOctokit().repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path,
      ref: ref || undefined,
    });

    if (Array.isArray(data)) {
      return NextResponse.json(
        { error: "Cannot delete a directory" },
        { status: 400 },
      );
    }

    await getOctokit().repos.deleteFile({
      owner: getOwner(),
      repo: getRepo(),
      path,
      message,
      sha: data.sha,
      branch: ref || undefined,
    });

    return NextResponse.json({ success: true, path });
  } catch (error: unknown) {
    return handleKodyApiError(error, "files");
  } finally {
    clearGitHubContext();
  }
}
